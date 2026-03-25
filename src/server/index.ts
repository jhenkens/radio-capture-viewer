import path from "path";
import fs from "fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { WebSocketServer } from "ws";
import { initConfig, getConfig } from "./config/index.js";
import { getDb, runMigrations } from "./db/index.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
import { S3StorageProvider } from "./storage/S3StorageProvider.js";
import { FileCache } from "./cache/FileCache.js";
import { getNotificationService } from "./notifications/NotificationService.js";
import { TaskRunner } from "./tasks/TaskRunner.js";
import { AnalyzeFileProcessor } from "./tasks/processors/AnalyzeFileProcessor.js";
import { WhisperProcessor } from "./tasks/processors/WhisperProcessor.js";
import { ConnectionManager } from "./websocket/ConnectionManager.js";
import { handleWebSocket } from "./websocket/handler.js";
import { adminRouter } from "./admin/router.js";
import { frontendApiRouter } from "./frontend-api/router.js";
import type { StorageProvider } from "./storage/StorageProvider.js";

async function main() {
  await initConfig();
  const config = getConfig();
  const db = getDb();

  // Run DB migrations
  await runMigrations();

  // Set up storage
  let storage: StorageProvider;
  if (config.storage.provider === "s3") {
    storage = new S3StorageProvider(config.storage.s3);
  } else {
    storage = new LocalStorageProvider(config.storage.local.basePath);
  }

  // Set up cache
  const cache = new FileCache(
    config.cache.basePath,
    config.cache.maxAgeMs,
    config.cache.maxSizeBytes
  );

  // Set up notification service
  const notifications = getNotificationService();

  // Set up task runner
  const taskRunner = new TaskRunner(db, cache, storage, notifications, config.tasks.concurrency);

  if (config.whisper.enabled) {
    taskRunner.registerProcessor(
      new WhisperProcessor(config.whisper.baseUrl, config.whisper.apiKey, config.whisper.model, config.whisper.prompt, config.whisper.hotwords, config.whisper.responseFormat),
      config.whisper.concurrency
    );
  }

  taskRunner.registerProcessor(new AnalyzeFileProcessor());

  taskRunner.start();

  // Set up Fastify
  const fastify = Fastify({ logger: true, trustProxy: config.trustProxy });

  await fastify.register(cors, { origin: true });
  await fastify.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  });

  // API routes
  await fastify.register(adminRouter, {
    prefix: "/api/admin",
    storage,
    cache,
    taskRunner,
  });

  await fastify.register(frontendApiRouter, {
    prefix: "/api",
    storage,
    cache,
  });

  // Serve static frontend from dist/public
  const publicDir = path.resolve(process.cwd(), "dist/public");
  if (fs.existsSync(publicDir)) {
    await fastify.register(staticFiles, {
      root: publicDir,
      prefix: "/",
    });

    // SPA fallback
    fastify.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html");
    });
  } else {
    fastify.get("/", async (_req, reply) => {
      reply.type("text/html").send(`
        <html><body>
          <h1>Radio Capture Viewer</h1>
          <p>Frontend not built yet. Run <code>npm run build:client</code></p>
        </body></html>
      `);
    });
  }

  // Start HTTP server
  await fastify.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`[server] Listening on port ${config.port}`);

  // Set up WebSocket server on the same port via the underlying http server
  const connectionManager = new ConnectionManager(db, notifications);
  const wss = new WebSocketServer({ server: fastify.server });

  wss.on("connection", (ws) => {
    handleWebSocket(ws, connectionManager);
  });

  wss.on("error", (err) => {
    console.error("[WSS] Error:", err);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[server] Shutting down...");
    taskRunner.stop();
    wss.close();
    await fastify.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
