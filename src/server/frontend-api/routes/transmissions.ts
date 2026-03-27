import path from "path";
import fs from "fs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb, schema } from "../../db/index.js";
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

    // If storage supports presign, redirect (S3/R2 handles range requests natively)
    if (storage.supportsPresign()) {
      const url = await storage.presignDownload(file.path, 3600);
      return reply.redirect(url);
    }

    const total = file.size_bytes ?? 0;
    const ext = path.extname(file.path).toLowerCase();
    const mimeType = ext === ".mp3" ? "audio/mpeg" : ext === ".ogg" ? "audio/ogg" : "audio/mpeg";

    // Parse range header
    const rangeHeader = request.headers.range;
    let start = 0;
    let end = total - 1;
    let partial = false;
    if (rangeHeader && total > 0) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (match) {
        start = match[1] ? parseInt(match[1], 10) : total - parseInt(match[2]!, 10);
        end   = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
        partial = true;
      }
    }
    const chunkSize = total > 0 ? end - start + 1 : undefined;

    reply
      .header("Content-Type", mimeType)
      .header("Cache-Control", "public, max-age=3600")
      .header("Accept-Ranges", "bytes");

    if (partial) {
      reply
        .status(206)
        .header("Content-Range", `bytes ${start}-${end}/${total}`)
        .header("Content-Length", chunkSize!);
    } else if (total > 0) {
      reply.header("Content-Length", total);
    }

    // Serve from cache
    const cached = cache.getPath(file.path);
    if (cached) {
      return reply.send(fs.createReadStream(cached, total > 0 ? { start, end } : {}));
    }

    // Fetch from storage
    try {
      const data = await storage.get(file.path);
      cache.set(file.path, data);
      return reply.send(partial ? data.subarray(start, end + 1) : data);
    } catch {
      return reply.status(404).send({ error: "Audio not found in storage" });
    }
  });
}
