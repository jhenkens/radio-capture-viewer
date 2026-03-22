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
