import path from "path";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, schema } from "../../db/index.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { computeStoragePath } from "../../storage/StorageProvider.js";
import { getConfig } from "../../config/index.js";
import type {
  UploadInitiateResponse,
  UploadCompleteResponse,
  UploadDirectResponse,
} from "../../../shared/types.js";

const PRESIGN_EXPIRES_S = 3600; // 1 hour

const InitiateBody = z.object({
  channel_id: z.string().uuid(),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  duration_ms: z.number().int().positive().optional(),
  recorded_at: z.number().int().positive().optional(),
  frequency_hz: z.number().int().positive().optional(),
});

const CompleteBody = z.object({
  upload_session_id: z.string().uuid(),
});

export async function uploadRoutes(
  fastify: FastifyInstance,
  options: {
    taskRunner: { wake(): void };
    storage: import("../../storage/StorageProvider.js").StorageProvider;
    cache: import("../../cache/FileCache.js").FileCache;
  }
): Promise<void> {
  const { taskRunner, storage, cache } = options;

  // POST /api/admin/upload/initiate
  fastify.post<{ Body: unknown; Reply: UploadInitiateResponse | { error: string } }>(
    "/initiate",
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      if (!storage.supportsPresign()) {
        return reply.status(400).send({ error: "Storage provider does not support presigned uploads" });
      }

      const parsed = InitiateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const body = parsed.data;
      const system = request.system!;
      const db = getDb();

      // Validate channel belongs to system
      const channels = await db
        .select()
        .from(schema.channels)
        .where(
          and(
            eq(schema.channels.id, body.channel_id),
            eq(schema.channels.system_id, system.id)
          )
        );

      if (!channels.length) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      const transmissionId = uuidv4();
      const ext = path.extname(body.filename) || ".bin";
      const storageKey = computeStoragePath(transmissionId, ext);

      const { url, key } = await storage.presignUpload(
        storageKey,
        body.content_type,
        PRESIGN_EXPIRES_S
      );

      const now = Date.now();
      const expiresAt = now + PRESIGN_EXPIRES_S * 1000;

      // Create transmission
      await db.insert(schema.transmissions).values({
        id: transmissionId,
        system_id: system.id,
        channel_id: body.channel_id,
        available: false,
        transcript: null,
        duration_ms: body.duration_ms ?? null,
        frequency_hz: body.frequency_hz ?? null,
        recorded_at: body.recorded_at ?? now,
        created_at: now,
      });

      // Create upload session
      const sessionId = uuidv4();
      await db.insert(schema.upload_sessions).values({
        id: sessionId,
        transmission_id: transmissionId,
        signed_url: url,
        signed_url_key: key,
        expires_at: expiresAt,
        completed_at: null,
        created_at: now,
      });

      return reply.send({
        upload_session_id: sessionId,
        upload_url: url,
        transmission_id: transmissionId,
        expires_at: expiresAt,
      });
    }
  );

  // POST /api/admin/upload/complete
  fastify.post<{ Body: unknown; Reply: UploadCompleteResponse | { error: string } }>(
    "/complete",
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = CompleteBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const db = getDb();
      const sessions = await db
        .select()
        .from(schema.upload_sessions)
        .where(eq(schema.upload_sessions.id, parsed.data.upload_session_id));

      if (!sessions.length) {
        return reply.status(404).send({ error: "Upload session not found" });
      }

      const session = sessions[0]!;

      if (session.completed_at) {
        return reply.status(409).send({ error: "Upload session already completed" });
      }

      if (Date.now() > session.expires_at) {
        return reply.status(410).send({ error: "Upload session expired" });
      }

      const now = Date.now();

      // Download from S3 into cache
      let fileBuffer: Buffer;
      try {
        fileBuffer = await storage.get(session.signed_url_key);
      } catch (err) {
        return reply.status(422).send({ error: `Could not fetch uploaded file: ${String(err)}` });
      }

      cache.set(session.signed_url_key, fileBuffer);

      // Create transmission file record
      const fileId = uuidv4();
      await db.insert(schema.transmission_files).values({
        id: fileId,
        transmission_id: session.transmission_id,
        provider: "s3",
        path: session.signed_url_key,
        size_bytes: fileBuffer.length,
        created_at: now,
      });

      // Mark session complete
      await db
        .update(schema.upload_sessions)
        .set({ completed_at: now })
        .where(eq(schema.upload_sessions.id, session.id));

      // Fetch transmission for system/channel context
      const txRows = await db
        .select()
        .from(schema.transmissions)
        .where(eq(schema.transmissions.id, session.transmission_id));
      const tx = txRows[0];

      // Create tasks or mark available
      const hasTasks = tx
        ? await createTasksOrMarkAvailable(
            db,
            session.transmission_id,
            tx.system_id,
            tx.channel_id,
            now
          )
        : false;
      if (hasTasks) taskRunner.wake();

      return reply.send({ transmission_id: session.transmission_id, status: "processing" });
    }
  );

  // POST /api/admin/upload/direct
  fastify.post<{ Reply: UploadDirectResponse | { error: string } }>(
    "/direct",
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const system = request.system!;
      const db = getDb();
      const now = Date.now();

      let fileBuffer: Buffer;
      let channel_id: string;
      let filename: string;
      let content_type: string;
      let duration_ms: number | undefined;
      let recorded_at: number | undefined;
      let frequency_hz: number | undefined;

      const contentType = request.headers["content-type"] ?? "";

      if (contentType.startsWith("multipart/")) {
        // Multipart form upload
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({ error: "No file provided" });
        }

        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
        filename = data.filename;
        content_type = data.mimetype;

        const fields = data.fields as Record<string, { value: string }>;
        channel_id = fields["channel_id"]?.value ?? "";
        duration_ms = fields["duration_ms"]?.value
          ? parseInt(fields["duration_ms"].value, 10)
          : undefined;
        recorded_at = fields["recorded_at"]?.value
          ? parseInt(fields["recorded_at"].value, 10)
          : undefined;
        frequency_hz = fields["frequency_hz"]?.value
          ? parseInt(fields["frequency_hz"].value, 10)
          : undefined;
      } else {
        // JSON + base64
        const body = request.body as {
          channel_id?: string;
          file_data?: string;
          content_type?: string;
          filename?: string;
          duration_ms?: number;
          recorded_at?: number;
          frequency_hz?: number;
        };

        if (!body.file_data || !body.channel_id || !body.filename || !body.content_type) {
          return reply.status(400).send({ error: "Missing required fields" });
        }

        fileBuffer = Buffer.from(body.file_data, "base64");
        channel_id = body.channel_id;
        filename = body.filename;
        content_type = body.content_type;
        duration_ms = body.duration_ms;
        recorded_at = body.recorded_at;
        frequency_hz = body.frequency_hz;
      }

      if (!channel_id) {
        return reply.status(400).send({ error: "channel_id is required" });
      }

      // Validate channel
      const channels = await db
        .select()
        .from(schema.channels)
        .where(
          and(
            eq(schema.channels.id, channel_id),
            eq(schema.channels.system_id, system.id)
          )
        );

      if (!channels.length) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      const transmissionId = uuidv4();
      const ext = path.extname(filename) || ".bin";
      const storageKey = computeStoragePath(transmissionId, ext);

      // Store file
      await storage.put(storageKey, fileBuffer, content_type);
      cache.set(storageKey, fileBuffer);

      // Create records
      await db.insert(schema.transmissions).values({
        id: transmissionId,
        system_id: system.id,
        channel_id,
        available: false,
        transcript: null,
        duration_ms: duration_ms ?? null,
        frequency_hz: frequency_hz ?? null,
        recorded_at: recorded_at ?? now,
        created_at: now,
      });

      const fileId = uuidv4();
      await db.insert(schema.transmission_files).values({
        id: fileId,
        transmission_id: transmissionId,
        provider: storage.supportsPresign() ? "s3" : "local",
        path: storageKey,
        size_bytes: fileBuffer.length,
        created_at: now,
      });

      const hasTasks = await createTasksOrMarkAvailable(
        db,
        transmissionId,
        system.id,
        channel_id,
        now
      );
      if (hasTasks) taskRunner.wake();

      return reply.send({ transmission_id: transmissionId, status: "processing" });
    }
  );
}

/**
 * Creates required tasks for a new transmission.
 * analyze_file is always created first; whisper is added when enabled.
 * The transmission becomes available once all required tasks complete (via TaskRunner).
 */
async function createTasksOrMarkAvailable(
  db: ReturnType<typeof getDb>,
  transmissionId: string,
  _systemId: string,
  _channelId: string,
  now: number
): Promise<boolean> {
  const config = getConfig();

  const tasks: (typeof schema.tasks.$inferInsert)[] = [
    {
      id: uuidv4(),
      transmission_id: transmissionId,
      type: "analyze_file",
      required: true,
      complete: false,
      processing_start_time: null,
      processing_end_time: null,
      failure_count: 0,
      retry_limit: 3,
      retry_delay_ms: 5_000,
      created_at: now,
    },
  ];

  if (config.whisper.enabled) {
    tasks.push({
      id: uuidv4(),
      transmission_id: transmissionId,
      type: "whisper",
      required: true,
      complete: false,
      processing_start_time: null,
      processing_end_time: null,
      failure_count: 0,
      retry_limit: 3,
      retry_delay_ms: 30_000,
      created_at: now,
    });
  }

  await db.insert(schema.tasks).values(tasks);
  const types = tasks.map((t) => t.type).join(", ");
  console.info(`[upload] Created tasks for transmission ${transmissionId}: ${types}`);
  return true;
}
