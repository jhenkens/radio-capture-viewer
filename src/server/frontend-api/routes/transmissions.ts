import path from "path";
import fs from "fs";
import { eq, and, lt, gt, inArray, like, desc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb, schema } from "../../db/index.js";
import type { TransmissionDTO, PaginatedTransmissions } from "../../../shared/types.js";
import type { StorageProvider } from "../../storage/StorageProvider.js";
import type { FileCache } from "../../cache/FileCache.js";

interface TransmissionsOptions {
  storage: StorageProvider;
  cache: FileCache;
}

export async function transmissionsRoutes(
  fastify: FastifyInstance,
  options: TransmissionsOptions
): Promise<void> {
  const { storage, cache } = options;

  // GET /api/transmissions
  fastify.get<{
    Querystring: {
      system_id?: string;
      channel_ids?: string;
      search?: string;
      cursor?: string;
      limit?: string;
      direction?: string;
    };
    Reply: PaginatedTransmissions | { error: string };
  }>("/transmissions", async (request, reply) => {
    const { system_id, channel_ids, search, cursor, limit: limitStr, direction } = request.query;

    if (!system_id || system_id === "null") {
      return reply.status(400).send({ error: "system_id is required" });
    }

    const db = getDb();
    const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);
    const dir = direction === "after" ? "after" : "before";
    const cursorVal = cursor ? parseInt(cursor, 10) : undefined;

    const conditions = [
      eq(schema.transmissions.system_id, system_id),
      eq(schema.transmissions.available, true),
    ];

    if (channel_ids) {
      const ids = channel_ids.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        conditions.push(inArray(schema.transmissions.channel_id, ids));
      }
    }

    if (search) {
      conditions.push(like(schema.transmissions.transcript, `%${search}%`));
    }

    if (cursorVal !== undefined) {
      if (dir === "before") {
        conditions.push(lt(schema.transmissions.recorded_at, cursorVal));
      } else {
        conditions.push(gt(schema.transmissions.recorded_at, cursorVal));
      }
    }

    const rows = await db
      .select()
      .from(schema.transmissions)
      .where(and(...conditions))
      .orderBy(desc(schema.transmissions.recorded_at))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const next_cursor =
      hasMore && items.length > 0
        ? items[items.length - 1]!.recorded_at
        : null;

    const dtos: TransmissionDTO[] = items.map((tx) => ({
      id: tx.id,
      system_id: tx.system_id,
      channel_id: tx.channel_id,
      available: tx.available,
      transcript: tx.transcript,
      duration_ms: tx.duration_ms,
      frequency_hz: tx.frequency_hz,
      recorded_at: tx.recorded_at,
      created_at: tx.created_at,
    }));

    return reply.send({ items: dtos, next_cursor });
  });

  // GET /api/transmissions/:id
  fastify.get<{
    Params: { id: string };
    Reply: TransmissionDTO | { error: string };
  }>("/transmissions/:id", async (request, reply) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.transmissions)
      .where(eq(schema.transmissions.id, request.params.id));

    if (!rows.length) {
      return reply.status(404).send({ error: "Not found" });
    }

    const tx = rows[0]!;
    return reply.send({
      id: tx.id,
      system_id: tx.system_id,
      channel_id: tx.channel_id,
      available: tx.available,
      transcript: tx.transcript,
      duration_ms: tx.duration_ms,
      frequency_hz: tx.frequency_hz,
      recorded_at: tx.recorded_at,
      created_at: tx.created_at,
    });
  });

  // GET /api/transmissions/:id/audio
  fastify.get<{
    Params: { id: string };
  }>("/transmissions/:id/audio", async (request, reply) => {
    const db = getDb();

    const files = await db
      .select()
      .from(schema.transmission_files)
      .where(eq(schema.transmission_files.transmission_id, request.params.id));

    if (!files.length) {
      return reply.status(404).send({ error: "Audio not found" });
    }

    const file = files[0]!;

    // If storage supports presign, redirect
    if (storage.supportsPresign()) {
      const url = await storage.presignDownload(file.path, 3600);
      return reply.redirect(url);
    }

    // Serve from cache or local storage
    const cached = cache.getPath(file.path);
    if (cached) {
      const ext = path.extname(cached).toLowerCase();
      const mimeType = ext === ".mp3" ? "audio/mpeg" : ext === ".ogg" ? "audio/ogg" : "audio/mpeg";
      return reply
        .header("Content-Type", mimeType)
        .header("Cache-Control", "public, max-age=3600")
        .send(fs.createReadStream(cached));
    }

    // Fetch from storage
    try {
      const data = await storage.get(file.path);
      cache.set(file.path, data);

      const ext = path.extname(file.path).toLowerCase();
      const mimeType = ext === ".mp3" ? "audio/mpeg" : ext === ".ogg" ? "audio/ogg" : "audio/mpeg";
      return reply
        .header("Content-Type", mimeType)
        .header("Cache-Control", "public, max-age=3600")
        .send(data);
    } catch {
      return reply.status(404).send({ error: "Audio not found in storage" });
    }
  });
}
