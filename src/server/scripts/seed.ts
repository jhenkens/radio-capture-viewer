#!/usr/bin/env tsx
/**
 * CLI seed script for creating systems, channels, and API keys.
 *
 * Usage:
 *   npx tsx src/server/scripts/seed.ts create-system --name "My Radio"
 *   npx tsx src/server/scripts/seed.ts create-channel --system-id <id> --name "Fire Dispatch"
 *   npx tsx src/server/scripts/seed.ts create-api-key --system-id <id> --name "importer"
 *   npx tsx src/server/scripts/seed.ts list
 */

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { initConfig } from "../config/index.js";
import { getDb, schema } from "../db/index.js";
import { eq, isNull, gt } from "drizzle-orm";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

async function createSystem(name: string, description?: string): Promise<void> {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  await db.insert(schema.systems).values({ id, name, description: description ?? null, created_at: now });
  console.log(`Created system: ${name}`);
  console.log(`  ID: ${id}`);
}

async function createChannel(systemId: string, name: string, description?: string): Promise<void> {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  await db.insert(schema.channels).values({
    id,
    system_id: systemId,
    name,
    description: description ?? null,
    created_at: now,
  });
  console.log(`Created channel: ${name}`);
  console.log(`  ID: ${id}`);
}

async function createApiKey(systemId: string, keyName: string): Promise<void> {
  const db = getDb();
  const rawKey = `rcv_${crypto.randomBytes(32).toString("hex")}`;
  const hash = hashKey(rawKey);
  const id = uuidv4();
  const now = Date.now();

  await db.insert(schema.api_keys).values({
    id,
    key_hash: hash,
    system_id: systemId,
    name: keyName,
    created_at: now,
    last_used_at: null,
  });

  console.log(`Created API key: ${keyName}`);
  console.log(`  Key: ${rawKey}`);
  console.log(`  (Store this key securely — it will not be shown again)`);
}

async function backfillAnalyzeTasks(): Promise<void> {
  const db = getDb();
  const now = Date.now();

  // Reset all existing analyze_file tasks so they rerun with ffprobe
  await db
    .update(schema.tasks)
    .set({ complete: false, processing_start_time: null, processing_end_time: null, failure_count: 0 })
    .where(eq(schema.tasks.type, "analyze_file"));

  // Insert tasks for transmissions that have none
  const analyzeTaskAlias = db
    .select({ transmission_id: schema.tasks.transmission_id })
    .from(schema.tasks)
    .where(eq(schema.tasks.type, "analyze_file"))
    .as("at");

  const rows = await db
    .select({ id: schema.transmissions.id })
    .from(schema.transmissions)
    .leftJoin(analyzeTaskAlias, eq(analyzeTaskAlias.transmission_id, schema.transmissions.id))
    .where(isNull(analyzeTaskAlias.transmission_id));

  if (rows.length) {
    const tasks = rows.map((row) => ({
      id: uuidv4(),
      transmission_id: row.id,
      type: "analyze_file",
      required: true,
      complete: false,
      processing_start_time: null,
      processing_end_time: null,
      failure_count: 0,
      retry_limit: 3,
      retry_delay_ms: 5_000,
      created_at: now,
    }));
    await db.insert(schema.tasks).values(tasks);
    console.log(`Created ${tasks.length} new analyze_file task(s).`);
  }

  console.log("All analyze_file tasks reset to complete=false — they will rerun on next poll.");
}

async function backfillWhisperTasks(): Promise<void> {
  const db = getDb();
  const now = Date.now();

  // Reset all existing whisper tasks so they rerun immediately
  await db
    .update(schema.tasks)
    .set({ complete: false, processing_start_time: null, processing_end_time: null, failure_count: 0 })
    .where(eq(schema.tasks.type, "whisper"));

  // Insert whisper tasks only for transmissions that don't have one yet
  const whisperTaskAlias = db
    .select({ transmission_id: schema.tasks.transmission_id })
    .from(schema.tasks)
    .where(eq(schema.tasks.type, "whisper"))
    .as("wt");

  const rows = await db
    .select({ id: schema.transmissions.id })
    .from(schema.transmissions)
    .leftJoin(whisperTaskAlias, eq(whisperTaskAlias.transmission_id, schema.transmissions.id))
    .where(isNull(whisperTaskAlias.transmission_id));

  if (!rows.length) {
    console.log("All transmissions already have a whisper task.");
    return;
  }

  const tasks = rows.map((row) => ({
    id: uuidv4(),
    transmission_id: row.id,
    type: "whisper",
    required: true,
    complete: false,
    processing_start_time: null,
    processing_end_time: null,
    failure_count: 0,
    retry_limit: 3,
    retry_delay_ms: 30_000,
    created_at: now,
  }));

  await db.insert(schema.tasks).values(tasks);
  console.log(`Created ${tasks.length} whisper task(s).`);
}

async function clearTranscripts(): Promise<void> {
  const db = getDb();
  const result = await db
    .update(schema.transmissions)
    .set({ transcript: null })
    .returning({ id: schema.transmissions.id });
  console.log(`Cleared transcripts on ${result.length} transmission(s).`);
}

async function retryFailedTasks(type?: string): Promise<void> {
  const db = getDb();

  const where = type
    ? eq(schema.tasks.type, type)
    : gt(schema.tasks.failure_count, 0);

  const result = await db
    .update(schema.tasks)
    .set({ failure_count: 0, processing_start_time: null, processing_end_time: null, retry_after: null })
    .where(where)
    .returning({ id: schema.tasks.id, type: schema.tasks.type });

  if (!result.length) {
    console.log("No failed tasks found.");
    return;
  }

  const byType: Record<string, number> = {};
  for (const t of result) {
    byType[t.type] = (byType[t.type] ?? 0) + 1;
  }
  for (const [t, count] of Object.entries(byType)) {
    console.log(`  Reset ${count} ${t} task(s)`);
  }
  console.log(`Retrying ${result.length} task(s) total.`);
}

async function list(): Promise<void> {
  const db = getDb();

  const systems = await db.select().from(schema.systems);
  console.log(`\nSystems (${systems.length}):`);
  for (const sys of systems) {
    console.log(`  [${sys.id}] ${sys.name}`);

    const channels = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.system_id, sys.id));
    for (const ch of channels) {
      console.log(`    Channel: [${ch.id}] ${ch.name}`);
    }

    const keys = await db
      .select()
      .from(schema.api_keys)
      .where(eq(schema.api_keys.system_id, sys.id));
    for (const k of keys) {
      const lastUsed = k.last_used_at ? new Date(k.last_used_at).toISOString() : "never";
      console.log(`    API Key: ${k.name} (last used: ${lastUsed})`);
    }
  }
}

async function main(): Promise<void> {
  await initConfig();
  const args = process.argv.slice(2);
  const command = args[0];

  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (key && args[i + 1]) {
      flags[key] = args[i + 1]!;
    }
  }

  switch (command) {
    case "create-system":
      if (!flags["name"]) {
        console.error("Usage: seed create-system --name <name> [--description <desc>]");
        process.exit(1);
      }
      await createSystem(flags["name"]!, flags["description"]);
      break;

    case "create-channel":
      if (!flags["systemId"] || !flags["name"]) {
        console.error("Usage: seed create-channel --system-id <id> --name <name> [--description <desc>]");
        process.exit(1);
      }
      await createChannel(flags["systemId"]!, flags["name"]!, flags["description"]);
      break;

    case "create-api-key":
      if (!flags["systemId"] || !flags["name"]) {
        console.error("Usage: seed create-api-key --system-id <id> --name <name>");
        process.exit(1);
      }
      await createApiKey(flags["systemId"]!, flags["name"]!);
      break;

    case "list":
      await list();
      break;

    case "backfill-analyze-tasks":
      await backfillAnalyzeTasks();
      break;

    case "backfill-whisper-tasks":
      await backfillWhisperTasks();
      break;

    case "retry-failed-tasks":
      await retryFailedTasks(flags["type"]);
      break;

    case "clear-transcripts":
      await clearTranscripts();
      break;

    default:
      console.log("Commands:");
      console.log("  create-system --name <name> [--description <desc>]");
      console.log("  create-channel --system-id <id> --name <name> [--description <desc>]");
      console.log("  create-api-key --system-id <id> --name <name>");
      console.log("  list");
      console.log("  backfill-analyze-tasks");
      console.log("  backfill-whisper-tasks");
      console.log("  retry-failed-tasks [--type <task-type>]");
      console.log("  clear-transcripts");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
