import OpenAI, { toFile } from "openai";
import { eq } from "drizzle-orm";
import type { TaskProcessor, Task, Transmission, TaskProcessorContext } from "../TaskProcessor.js";
import { schema } from "../../db/index.js";

export class WhisperProcessor implements TaskProcessor {
  readonly type = "whisper";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly prompt: string | undefined,
    private readonly responseFormat: "json" | "text" | "verbose_json"
  ) {}

  async process(task: Task, transmission: Transmission, ctx: TaskProcessorContext): Promise<void> {
    const { db, cache, storage } = ctx;

    // Find the transmission file
    const files = await db
      .select()
      .from(schema.transmission_files)
      .where(eq(schema.transmission_files.transmission_id, transmission.id));

    if (!files.length) {
      throw new Error(`No files found for transmission ${transmission.id}`);
    }

    const file = files[0]!;
    const cacheKey = file.path;

    // Fetch from cache or storage
    let audioBuffer: Buffer;
    const cached = cache.get(cacheKey);
    if (cached) {
      audioBuffer = cached;
    } else {
      audioBuffer = await storage.get(file.path);
      cache.set(cacheKey, audioBuffer);
    }

    // Determine file extension from path
    const ext = file.path.split(".").pop() ?? "mp3";
    const filename = `audio.${ext}`;

    // Call Whisper API
    const client = new OpenAI({
      baseURL: this.baseUrl + "/v1",
      apiKey: this.apiKey || "none",
    });

    const audioFile = await toFile(audioBuffer, filename);

    const response = await client.audio.transcriptions.create({
      file: audioFile,
      model: this.model,
      ...(this.prompt ? { prompt: this.prompt } : {}),
      response_format: this.responseFormat,
    });

    const transcript = typeof response === "string" ? response : response.text;

    // Update transmission with transcript
    await db
      .update(schema.transmissions)
      .set({ transcript })
      .where(eq(schema.transmissions.id, transmission.id));
  }
}
