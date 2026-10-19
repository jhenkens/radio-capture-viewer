import { z } from "zod";

const StorageLocalSchema = z.object({
  basePath: z.string().default("./data/audio"),
});

const StorageS3Schema = z.object({
  endpoint: z.string().optional(),
  bucket: z.string().default("radio-captures"),
  region: z.string().default("auto"),
  accessKeyId: z.string().default(""),
  secretAccessKey: z.string().default(""),
});

const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  db: z.object({
    url: z.string().default("file:./data/radio.db"),
  }).default({}),
  storage: z.object({
    provider: z.enum(["local", "s3"]).default("local"),
    local: StorageLocalSchema.default({}),
    s3: StorageS3Schema.default({}),
  }).default({}),
  cache: z.object({
    basePath: z.string().default("./data/cache"),
    maxAgeMs: z.number().int().positive().default(3_600_000),
    maxSizeBytes: z.number().int().positive().default(104_857_600),
  }).default({}),
  tasks: z.object({
    concurrency: z.number().int().min(1).default(4),
  }).default({}),
  whisper: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().default("https://api.openai.com"),
    apiKey: z.string().default(""),
    model: z.string().default("whisper-1"),
    prompt: z.string().optional(),
    hotwords: z.string().optional(),
    responseFormat: z.enum(["json", "text", "verbose_json"]).default("json"),
    concurrency: z.number().int().min(1).default(1),
  }).default({}),
  // Voice-activity gate that runs before Whisper. Talks to the transcriber's
  // /v1/audio/vad endpoint; baseUrl/apiKey fall back to the whisper settings.
  vad: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    // Per-window (32 ms) probability at or above which audio counts as speech.
    threshold: z.number().min(0).max(1).default(0.5),
    // Archive only when BOTH hold: less than minSpeechMs of speech and a peak
    // probability below confidentSilenceProb. Anything borderline goes on to Whisper.
    minSpeechMs: z.number().int().min(0).default(200),
    confidentSilenceProb: z.number().min(0).max(1).default(0.6),
    // false = record metrics only and never archive (use for a dry run).
    archive: z.boolean().default(true),
    concurrency: z.number().int().min(1).default(2),
  }).default({}),
  channels: z.object({
    autoCreate: z.boolean().default(false),
  }).default({}),
  trustProxy: z.boolean().default(false),
  // Optional HTTP Basic auth (any username) for the viewer UI, public API and WebSocket.
  // Empty = viewer is open to anyone who can reach the server. /api/admin uses API keys.
  frontend: z.object({
    password: z.string().default(""),
  }).default({}),
  limits: z.object({
    // Max accepted size of a single uploaded audio file (multipart or base64 JSON).
    maxUploadBytes: z.number().int().positive().default(100 * 1024 * 1024),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Environment variable overrides applied on top of the file config. */
function applyEnvOverrides(base: Record<string, unknown>): Record<string, unknown> {
  const cfg = structuredClone(base) as Record<string, unknown>;

  const set = (path: string[], value: unknown) => {
    let obj = cfg;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]!;
      if (typeof obj[key] !== "object" || obj[key] === null) {
        obj[key] = {} as Record<string, unknown>;
      }
      obj = obj[key] as Record<string, unknown>;
    }
    obj[path[path.length - 1]!] = value;
  };

  if (process.env["PORT"]) set(["port"], parseInt(process.env["PORT"]!, 10));
  if (process.env["DB_URL"]) set(["db", "url"], process.env["DB_URL"]);
  if (process.env["STORAGE_PROVIDER"]) set(["storage", "provider"], process.env["STORAGE_PROVIDER"]);
  if (process.env["STORAGE_LOCAL_BASE_PATH"]) set(["storage", "local", "basePath"], process.env["STORAGE_LOCAL_BASE_PATH"]);
  if (process.env["STORAGE_S3_ENDPOINT"]) set(["storage", "s3", "endpoint"], process.env["STORAGE_S3_ENDPOINT"]);
  if (process.env["STORAGE_S3_BUCKET"]) set(["storage", "s3", "bucket"], process.env["STORAGE_S3_BUCKET"]);
  if (process.env["STORAGE_S3_REGION"]) set(["storage", "s3", "region"], process.env["STORAGE_S3_REGION"]);
  if (process.env["STORAGE_S3_ACCESS_KEY_ID"]) set(["storage", "s3", "accessKeyId"], process.env["STORAGE_S3_ACCESS_KEY_ID"]);
  if (process.env["STORAGE_S3_SECRET_ACCESS_KEY"]) set(["storage", "s3", "secretAccessKey"], process.env["STORAGE_S3_SECRET_ACCESS_KEY"]);
  if (process.env["CACHE_BASE_PATH"]) set(["cache", "basePath"], process.env["CACHE_BASE_PATH"]);
  if (process.env["WHISPER_ENABLED"]) set(["whisper", "enabled"], process.env["WHISPER_ENABLED"] === "true");
  if (process.env["WHISPER_BASE_URL"]) set(["whisper", "baseUrl"], process.env["WHISPER_BASE_URL"]);
  if (process.env["WHISPER_API_KEY"]) set(["whisper", "apiKey"], process.env["WHISPER_API_KEY"]);
  if (process.env["WHISPER_MODEL"]) set(["whisper", "model"], process.env["WHISPER_MODEL"]);
  if (process.env["WHISPER_PROMPT"]) set(["whisper", "prompt"], process.env["WHISPER_PROMPT"]);
  if (process.env["WHISPER_HOTWORDS"]) set(["whisper", "hotwords"], process.env["WHISPER_HOTWORDS"]);
  if (process.env["WHISPER_CONCURRENCY"]) set(["whisper", "concurrency"], parseInt(process.env["WHISPER_CONCURRENCY"]!, 10));
  if (process.env["WHISPER_RESPONSE_FORMAT"]) set(["whisper", "responseFormat"], process.env["WHISPER_RESPONSE_FORMAT"]);
  if (process.env["VAD_ENABLED"]) set(["vad", "enabled"], process.env["VAD_ENABLED"] === "true");
  if (process.env["VAD_BASE_URL"]) set(["vad", "baseUrl"], process.env["VAD_BASE_URL"]);
  if (process.env["VAD_API_KEY"]) set(["vad", "apiKey"], process.env["VAD_API_KEY"]);
  if (process.env["VAD_THRESHOLD"]) set(["vad", "threshold"], parseFloat(process.env["VAD_THRESHOLD"]!));
  if (process.env["VAD_MIN_SPEECH_MS"]) set(["vad", "minSpeechMs"], parseInt(process.env["VAD_MIN_SPEECH_MS"]!, 10));
  if (process.env["VAD_CONFIDENT_SILENCE_PROB"]) set(["vad", "confidentSilenceProb"], parseFloat(process.env["VAD_CONFIDENT_SILENCE_PROB"]!));
  if (process.env["VAD_ARCHIVE"]) set(["vad", "archive"], process.env["VAD_ARCHIVE"] === "true");
  if (process.env["VAD_CONCURRENCY"]) set(["vad", "concurrency"], parseInt(process.env["VAD_CONCURRENCY"]!, 10));
  if (process.env["TASKS_CONCURRENCY"]) set(["tasks", "concurrency"], parseInt(process.env["TASKS_CONCURRENCY"]!, 10));
  if (process.env["CHANNELS_AUTO_CREATE"]) set(["channels", "autoCreate"], process.env["CHANNELS_AUTO_CREATE"] === "true");
  if (process.env["FRONTEND_PASSWORD"]) set(["frontend", "password"], process.env["FRONTEND_PASSWORD"]);
  if (process.env["MAX_UPLOAD_BYTES"]) set(["limits", "maxUploadBytes"], parseInt(process.env["MAX_UPLOAD_BYTES"]!, 10));
  if (process.env["TRUST_PROXY"]) set(["trustProxy"], process.env["TRUST_PROXY"] === "true");

  return cfg;
}

let _config: Config | null = null;

/**
 * Load and validate configuration. Must be called once before getConfig().
 *
 * Layer order (lowest → highest priority):
 *   1. Schema defaults (defined in Zod schema above)
 *   2. Config file  — looked up by c12:
 *        • explicit path via CONFIG_PATH env var
 *        • otherwise: radio-capture-viewer.config.{ts,js,json,…} or config.json in cwd
 *   3. Environment variables (explicit mapping in applyEnvOverrides)
 */
export async function initConfig(): Promise<Config> {
  const { loadConfig } = await import("c12");

  const configFile = process.env["CONFIG_PATH"] ?? undefined;

  const { config: fileConfig } = await loadConfig<Record<string, unknown>>({
    name: "radio-capture-viewer",
    ...(configFile ? { configFile } : {}),
    dotenv: false, // env vars are handled explicitly in applyEnvOverrides
  });

  const withEnv = applyEnvOverrides((fileConfig ?? {}) as Record<string, unknown>);

  const result = ConfigSchema.safeParse(withEnv);
  if (!result.success) {
    console.error("[config] Invalid configuration:", result.error.format());
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

/** Return the validated config. Throws if initConfig() has not been called. */
export function getConfig(): Config {
  if (!_config) {
    throw new Error("[config] getConfig() called before initConfig() — call initConfig() first in main()");
  }
  return _config;
}
