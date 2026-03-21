import type { FastifyInstance } from "fastify";
import { stationRoutes } from "./routes/station.js";
import { uploadRoutes } from "./routes/upload.js";
import { apiKeyAuth } from "./middleware/apiKeyAuth.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { FileCache } from "../cache/FileCache.js";
import type { TaskRunner } from "../tasks/TaskRunner.js";

interface AdminRouterOptions {
  storage: StorageProvider;
  cache: FileCache;
  taskRunner: TaskRunner;
}

export async function adminRouter(
  fastify: FastifyInstance,
  options: AdminRouterOptions
): Promise<void> {
  fastify.addHook("preHandler", apiKeyAuth);

  await fastify.register(stationRoutes);
  await fastify.register(uploadRoutes, {
    prefix: "/upload",
    storage: options.storage,
    cache: options.cache,
    taskRunner: options.taskRunner,
  });
}
