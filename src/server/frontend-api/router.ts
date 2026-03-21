import type { FastifyInstance } from "fastify";
import { systemsRoutes } from "./routes/systems.js";
import { channelsRoutes } from "./routes/channels.js";
import { transmissionsRoutes } from "./routes/transmissions.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { FileCache } from "../cache/FileCache.js";

interface FrontendApiOptions {
  storage: StorageProvider;
  cache: FileCache;
}

export async function frontendApiRouter(
  fastify: FastifyInstance,
  options: FrontendApiOptions
): Promise<void> {
  await fastify.register(systemsRoutes);
  await fastify.register(channelsRoutes);
  await fastify.register(transmissionsRoutes, {
    storage: options.storage,
    cache: options.cache,
  });
}
