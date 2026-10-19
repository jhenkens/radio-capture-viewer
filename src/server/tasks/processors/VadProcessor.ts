import { eq } from "drizzle-orm";
import type { TaskProcessor, Task, Transmission, TaskProcessorContext } from "../TaskProcessor.js";
import { schema } from "../../db/index.js";

// Same sentinel the transcriber returns, so archived rows read like older no-voice rows.
export const NO_VOICES_TEXT = "<no voices detected>";

export interface VadMetrics {
  duration_ms: number;
  speech_ms: number;
  max_prob: number;
  mean_prob: number;
  p95_prob: number;
  longest_run_ms: number;
}

export interface VadArchiveRule {
  minSpeechMs: number;
  confidentSilenceProb: number;
}

/** Archive only when we are confident nothing was said: little speech AND no strong peak. */
export function isConfidentSilence(
  speechMs: number,
  maxProb: number,
  rule: VadArchiveRule
): boolean {
  return speechMs < rule.minSpeechMs && maxProb < rule.confidentSilenceProb;
}

export interface VadProcessorOptions {
  baseUrl: string;
  apiKey: string;
  threshold: number;
  rule: VadArchiveRule;
  archive: boolean;
}

export class VadProcessor implements TaskProcessor {
  readonly type = "vad";

  constructor(private readonly opts: VadProcessorOptions) {}

  async process(task: Task, transmission: Transmission, ctx: TaskProcessorContext): Promise<void> {
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

    const ext = file.path.split(".").pop() ?? "mp3";
    let metrics: VadMetrics;
    try {
      metrics = await this.callVad(audioBuffer, `${transmission.id}.${ext}`);
    } catch (err) {
      // VAD is an optimisation, not a gate: when the transcriber stays unreachable
      // through every retry, let the transmission through unchecked rather than
      // leaving its required task incomplete (which would keep it unavailable).
      if (task.failure_count + 1 >= task.retry_limit) {
        console.warn(`[VadProcessor] Giving up on ${transmission.id}, passing through unchecked: ${String(err)}`);
        return;
      }
      throw err;
    }

    const archive =
      this.opts.archive &&
      isConfidentSilence(metrics.speech_ms, metrics.max_prob, this.opts.rule);

    await db
      .update(schema.transmissions)
      .set({
        vad_speech_ms: metrics.speech_ms,
        vad_max_prob: metrics.max_prob,
        vad_checked_at: Date.now(),
        ...(archive ? { archived: true, transcript: NO_VOICES_TEXT } : {}),
      })
      .where(eq(schema.transmissions.id, transmission.id));

    console.info(
      `[VadProcessor] ${transmission.id} speech=${metrics.speech_ms}ms max_prob=${metrics.max_prob} -> ${archive ? "archived" : "kept"}`
    );
  }

  private async callVad(audio: Buffer, filename: string): Promise<VadMetrics> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), filename);
    form.append("threshold", String(this.opts.threshold));

    const res = await fetch(`${this.opts.baseUrl}/v1/audio/vad`, {
      method: "POST",
      headers: this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`VAD request failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as VadMetrics;
  }
}
