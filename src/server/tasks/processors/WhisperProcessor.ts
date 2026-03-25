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
    private readonly globalPrompt: string | undefined,
    private readonly globalHotwords: string | undefined,
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
    const filename = `${transmission.id}.${ext}`;

    // Fetch system + channel rows once for both prompt and hotwords
    const systemRows = await db
      .select({ whisper_prompt: schema.systems.whisper_prompt, whisper_hotwords: schema.systems.whisper_hotwords })
      .from(schema.systems)
      .where(eq(schema.systems.id, transmission.system_id));

    const channelRows = await db
      .select({ whisper_prompt: schema.channels.whisper_prompt, whisper_hotwords: schema.channels.whisper_hotwords })
      .from(schema.channels)
      .where(eq(schema.channels.id, transmission.channel_id));

    // Build prompt: global + system + channel (all non-empty, joined with space)
    const promptParts = [
      this.globalPrompt,
      systemRows[0]?.whisper_prompt,
      channelRows[0]?.whisper_prompt,
    ].filter((p): p is string => !!p);
    const prompt = promptParts.length ? promptParts.join(" ") : undefined;

    // Build hotwords: global + system + channel (all non-empty, joined with comma)
    const hotwordsParts = [
      this.globalHotwords,
      systemRows[0]?.whisper_hotwords,
      channelRows[0]?.whisper_hotwords,
    ].filter((p): p is string => !!p);
    const hotwords = hotwordsParts.length ? hotwordsParts.join(",") : undefined;

    // Call Whisper API
    const client = new OpenAI({
      baseURL: this.baseUrl + "/v1",
      apiKey: this.apiKey || "none",
    });

    const audioFile = await toFile(audioBuffer, filename);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.audio.transcriptions.create as any)({
      file: audioFile,
      model: this.model,
      ...(prompt ? { prompt } : {}),
      ...(hotwords ? { hotwords } : {}),
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
