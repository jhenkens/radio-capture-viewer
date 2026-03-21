import path from "path";
import os from "os";
import fs from "fs/promises";
import { execFile } from "child_process";
import { eq } from "drizzle-orm";
import type { TaskProcessor, Task, Transmission, TaskProcessorContext } from "../TaskProcessor.js";
import { schema } from "../../db/index.js";

function ffprobeDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const d = parseFloat(stdout.trim());
        resolve(isNaN(d) ? null : d);
      }
    );
  });
}

export class AnalyzeFileProcessor implements TaskProcessor {
  readonly type = "analyze_file";

  async process(_task: Task, transmission: Transmission, ctx: TaskProcessorContext): Promise<void> {
    const { db, cache, storage } = ctx;

    const files = await db
      .select()
      .from(schema.transmission_files)
      .where(eq(schema.transmission_files.transmission_id, transmission.id));

    if (!files.length) {
      throw new Error(`No files found for transmission ${transmission.id}`);
    }

    const file = files[0]!;

    let audioBuffer: Buffer;
    const cached = cache.get(file.path);
    if (cached) {
      audioBuffer = cached;
    } else {
      audioBuffer = await storage.get(file.path);
      cache.set(file.path, audioBuffer);
    }

    const ext = path.extname(file.path).toLowerCase();
    const tmpPath = path.join(os.tmpdir(), `rcv-analyze-${transmission.id}${ext}`);
    let durationSec: number | null = null;

    try {
      await fs.writeFile(tmpPath, audioBuffer);
      durationSec = await ffprobeDuration(tmpPath);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }

    if (durationSec == null) {
      throw new Error(`[AnalyzeFileProcessor] ffprobe failed for transmission ${transmission.id} — ensure ffprobe is installed`);
    }

    await db
      .update(schema.transmissions)
      .set({ duration_ms: Math.round(durationSec * 1000) })
      .where(eq(schema.transmissions.id, transmission.id));
  }
}
