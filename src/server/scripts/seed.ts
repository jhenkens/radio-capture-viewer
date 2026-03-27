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
import { and, eq, isNull, gt, inArray, desc } from "drizzle-orm";

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

async function setWhisperField(
  field: "whisper_prompt" | "whisper_hotwords",
  systemId: string,
  value: string | null,
  channelId?: string
): Promise<void> {
  const db = getDb();

  if (channelId) {
    const ch = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
    if (!ch.length) {
      console.error(`Channel not found: ${channelId}`);
      process.exit(1);
    }
    if (ch[0]!.system_id !== systemId) {
      console.error(`Channel ${channelId} does not belong to system ${systemId}`);
      process.exit(1);
    }
    await db.update(schema.channels).set({ [field]: value }).where(eq(schema.channels.id, channelId));
    console.log(`Set ${field} on channel ${channelId} (${ch[0]!.name}): ${value ?? "(cleared)"}`);
  } else {
    const sys = await db.select().from(schema.systems).where(eq(schema.systems.id, systemId));
    if (!sys.length) {
      console.error(`System not found: ${systemId}`);
      process.exit(1);
    }
    await db.update(schema.systems).set({ [field]: value }).where(eq(schema.systems.id, systemId));
    console.log(`Set ${field} on system ${systemId} (${sys[0]!.name}): ${value ?? "(cleared)"}`);
  }
}

const setPrompt = (systemId: string, value: string | null, channelId?: string) =>
  setWhisperField("whisper_prompt", systemId, value, channelId);

const setHotwords = (systemId: string, value: string | null, channelId?: string) =>
  setWhisperField("whisper_hotwords", systemId, value, channelId);

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

async function backfillWhisperTasks(limit?: number, clearTranscripts = false): Promise<void> {
  const db = getDb();
  const now = Date.now();

  // When a limit is given, scope everything to the N most-recent transmissions.
  let scopedIds: string[] | undefined;
  if (limit !== undefined) {
    const recent = await db
      .select({ id: schema.transmissions.id })
      .from(schema.transmissions)
      .orderBy(desc(schema.transmissions.recorded_at))
      .limit(limit);
    scopedIds = recent.map((r) => r.id);
    if (!scopedIds.length) {
      console.log("No transmissions found.");
      return;
    }
    console.log(`Scoping to the ${scopedIds.length} most-recent transmission(s).`);
  }

  let whereClause: any = eq(schema.tasks.type, "whisper");
  if (scopedIds) {
    whereClause = and(whereClause, inArray(schema.tasks.transmission_id, scopedIds));
  }


  // Optionally clear existing transcripts so the WS push can be tested end-to-end.
  if (clearTranscripts) {
    let txWhere: any = scopedIds ? inArray(schema.transmissions.id, scopedIds) : undefined;
    const cleared = await db
      .update(schema.transmissions)
      .set({ transcript: null })
      .where(txWhere)
      .returning({ id: schema.transmissions.id });
    console.log(`Cleared transcripts on ${cleared.length} transmission(s).`);
  }

  // Reset existing whisper tasks in scope so they rerun immediately.
  await db
    .update(schema.tasks)
    .set({ complete: false, processing_start_time: null, processing_end_time: null, failure_count: 0 })
    .where(whereClause);

  // Insert whisper tasks for transmissions in scope that don't have one yet.
  const whisperTaskAlias = db
    .select({ transmission_id: schema.tasks.transmission_id })
    .from(schema.tasks)
    .where(eq(schema.tasks.type, "whisper"))
    .as("wt");

  let transmissionsWhereClause: any = isNull(whisperTaskAlias.transmission_id);
  if (scopedIds) {
    transmissionsWhereClause = and(transmissionsWhereClause, inArray(schema.transmissions.id, scopedIds));
  }

  const rows = await db
    .select({ id: schema.transmissions.id })
    .from(schema.transmissions)
    .leftJoin(whisperTaskAlias, eq(whisperTaskAlias.transmission_id, schema.transmissions.id))
    .where(transmissionsWhereClause);

  if (rows.length) {
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

  // Link whisper tasks to their corresponding analyze_file tasks as prerequisites.
  const allWhisperTasks = await db
    .select({ id: schema.tasks.id, transmission_id: schema.tasks.transmission_id })
    .from(schema.tasks)
    .where(eq(schema.tasks.type, "whisper"));

  let linked = 0;
  for (const wt of allWhisperTasks) {
    const analyzeTasks = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.transmission_id, wt.transmission_id), eq(schema.tasks.type, "analyze_file")));
    if (analyzeTasks.length) {
      await db
        .update(schema.tasks)
        .set({ prerequisite_task_id: analyzeTasks[0]!.id })
        .where(eq(schema.tasks.id, wt.id));
      linked++;
    }
  }
  if (linked) console.log(`Linked ${linked} whisper task(s) to their analyze_file prerequisite.`);

  console.log("Done — whisper tasks will rerun on next poll.");
}

async function completeTask(transmissionId: string, type: string, transcript?: string): Promise<void> {
  const db = getDb();
  const now = Date.now();

  const tx = await db.select().from(schema.transmissions).where(eq(schema.transmissions.id, transmissionId));
  if (!tx.length) {
    console.error(`Transmission not found: ${transmissionId}`);
    process.exit(1);
  }

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.transmission_id, transmissionId), eq(schema.tasks.type, type)));

  if (!tasks.length) {
    console.error(`No ${type} task found for transmission ${transmissionId}`);
    process.exit(1);
  }

  await db
    .update(schema.tasks)
    .set({ complete: true, processing_start_time: now, processing_end_time: now, failure_count: 0 })
    .where(and(eq(schema.tasks.transmission_id, transmissionId), eq(schema.tasks.type, type)));
  console.log(`Marked ${tasks.length} ${type} task(s) as complete.`);

  if (transcript !== undefined) {
    await db
      .update(schema.transmissions)
      .set({ transcript })
      .where(eq(schema.transmissions.id, transmissionId));
    console.log(`Set transcript: ${transcript}`);
  }

  await db
    .update(schema.transmissions)
    .set({ available: true })
    .where(eq(schema.transmissions.id, transmissionId));
  console.log(`Transmission ${transmissionId} marked available.`);
}

async function deleteTransmission(transmissionId: string): Promise<void> {
  const db = getDb();

  const tx = await db.select().from(schema.transmissions).where(eq(schema.transmissions.id, transmissionId));
  if (!tx.length) {
    console.error(`Transmission not found: ${transmissionId}`);
    process.exit(1);
  }

  const deletedTasks = await db.delete(schema.tasks).where(eq(schema.tasks.transmission_id, transmissionId)).returning({ id: schema.tasks.id });
  const deletedFiles = await db.delete(schema.transmission_files).where(eq(schema.transmission_files.transmission_id, transmissionId)).returning({ id: schema.transmission_files.id });
  const deletedSessions = await db.delete(schema.upload_sessions).where(eq(schema.upload_sessions.transmission_id, transmissionId)).returning({ id: schema.upload_sessions.id });
  const deletedEventLinks = await db.delete(schema.event_transmissions).where(eq(schema.event_transmissions.transmission_id, transmissionId)).returning({ event_id: schema.event_transmissions.event_id });
  await db.delete(schema.transmissions).where(eq(schema.transmissions.id, transmissionId));

  console.log(`Deleted transmission: ${transmissionId}`);
  if (deletedTasks.length)        console.log(`  tasks:              ${deletedTasks.length}`);
  if (deletedFiles.length)        console.log(`  transmission_files: ${deletedFiles.length}`);
  if (deletedSessions.length)     console.log(`  upload_sessions:    ${deletedSessions.length}`);
  if (deletedEventLinks.length)   console.log(`  event_transmissions:${deletedEventLinks.length}`);
}

async function clearTranscripts(): Promise<void> {
  const db = getDb();
  const result = await db
    .update(schema.transmissions)
    .set({ transcript: null })
    .returning({ id: schema.transmissions.id });
  console.log(`Cleared transcripts on ${result.length} transmission(s).`);
}

async function retryFailedTasks(opts: { type?: string; limit?: number; since?: number }): Promise<void> {
  const db = getDb();
  const { type, limit, since } = opts;

  // Build filter: failed tasks optionally scoped by type and/or creation time
  let whereClause: any = and(gt(schema.tasks.failure_count, 0), eq(schema.tasks.complete, false));
  if (type) whereClause = and(whereClause, eq(schema.tasks.type, type));
  if (since !== undefined) whereClause = and(whereClause, gt(schema.tasks.created_at, since));

  // When a limit is specified, find the N most-recently-created matching task IDs first
  let ids: string[] | undefined;
  if (limit !== undefined) {
    const rows = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(whereClause)
      .orderBy(desc(schema.tasks.created_at))
      .limit(limit);
    ids = rows.map((r) => r.id);
    if (!ids.length) {
      console.log("No failed tasks found.");
      return;
    }
    console.log(`Scoping to the ${ids.length} most-recent failed task(s).`);
    whereClause = inArray(schema.tasks.id, ids);
  }

  const result = await db
    .update(schema.tasks)
    .set({ failure_count: 0, processing_start_time: null, processing_end_time: null, retry_after: null })
    .where(whereClause)
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

    if (sys.whisper_prompt) console.log(`    whisper_prompt: ${sys.whisper_prompt}`);
    if (sys.whisper_hotwords) console.log(`    whisper_hotwords: ${sys.whisper_hotwords}`);

    const channels = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.system_id, sys.id));
    for (const ch of channels) {
      console.log(`    Channel: [${ch.id}] ${ch.name}`);
      if (ch.whisper_prompt) console.log(`      whisper_prompt: ${ch.whisper_prompt}`);
      if (ch.whisper_hotwords) console.log(`      whisper_hotwords: ${ch.whisper_hotwords}`);
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
  for (let i = 1; i < args.length; ) {
    const raw = args[i];
    if (!raw?.startsWith("--")) { i++; continue; }
    const key = raw.replace(/^--/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      // Boolean flag
      flags[key] = "true";
      i++;
    } else {
      flags[key] = next;
      i += 2;
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
      await backfillWhisperTasks(
        flags["limit"] ? parseInt(flags["limit"]!, 10) : undefined,
        flags["clear"] === "true"
      );
      break;

    case "retry-failed-tasks": {
      let sinceMs: number | undefined;
      if (flags["since"] !== undefined) {
        const parsed = Date.parse(flags["since"]!);
        if (isNaN(parsed)) {
          console.error(`Invalid --since value: ${flags["since"]} (use ISO date or Unix ms timestamp)`);
          process.exit(1);
        }
        sinceMs = parsed;
      }
      await retryFailedTasks({
        type: flags["type"],
        limit: flags["limit"] ? parseInt(flags["limit"]!, 10) : undefined,
        since: sinceMs,
      });
      break;
    }

    case "delete-transmission":
      if (!flags["transmissionId"]) {
        console.error("Usage: seed delete-transmission --transmission-id <id>");
        process.exit(1);
      }
      await deleteTransmission(flags["transmissionId"]!);
      break;

    case "complete-task":
      if (!flags["transmissionId"]) {
        console.error("Usage: seed complete-task --transmission-id <id> [--type <task-type>] [--transcript <text>]");
        console.error("Example: seed complete-task --transmission-id e02b3254-17c7-46cd-b451-391861a5b824 --transcript 'All units respond'");
        process.exit(1);
      }
      await completeTask(
        flags["transmissionId"]!,
        flags["type"] ?? "whisper",
        flags["transcript"],
      );
      break;

    case "clear-transcripts":
      await clearTranscripts();
      break;

    case "set-prompt":
      if (!flags["systemId"]) {
        console.error("Usage: seed set-prompt --system-id <id> [--channel-id <id>] --prompt <text>");
        console.error("       seed set-prompt --system-id <id> [--channel-id <id>] --clear");
        process.exit(1);
      }
      if (flags["clear"] === "true") {
        await setPrompt(flags["systemId"]!, null, flags["channelId"]);
      } else if (flags["prompt"] !== undefined) {
        await setPrompt(flags["systemId"]!, flags["prompt"]!, flags["channelId"]);
      } else {
        console.error("Usage: seed set-prompt --system-id <id> [--channel-id <id>] --prompt <text>");
        console.error("       seed set-prompt --system-id <id> [--channel-id <id>] --clear");
        process.exit(1);
      }
      break;

    case "set-hotwords":
      if (!flags["systemId"]) {
        console.error("Usage: seed set-hotwords --system-id <id> [--channel-id <id>] --hotwords <word1,word2,...>");
        console.error("       seed set-hotwords --system-id <id> [--channel-id <id>] --clear");
        process.exit(1);
      }
      if (flags["clear"] === "true") {
        await setHotwords(flags["systemId"]!, null, flags["channelId"]);
      } else if (flags["hotwords"] !== undefined) {
        await setHotwords(flags["systemId"]!, flags["hotwords"]!, flags["channelId"]);
      } else {
        console.error("Usage: seed set-hotwords --system-id <id> [--channel-id <id>] --hotwords <word1,word2,...>");
        console.error("       seed set-hotwords --system-id <id> [--channel-id <id>] --clear");
        process.exit(1);
      }
      break;

    default:
      console.log("Commands:");
      console.log("  create-system --name <name> [--description <desc>]");
      console.log("  create-channel --system-id <id> --name <name> [--description <desc>]");
      console.log("  create-api-key --system-id <id> --name <name>");
      console.log("  list");
      console.log("  set-prompt --system-id <id> [--channel-id <id>] --prompt <text>");
      console.log("  set-prompt --system-id <id> [--channel-id <id>] --clear");
      console.log("  set-hotwords --system-id <id> [--channel-id <id>] --hotwords <word1,word2,...>");
      console.log("  set-hotwords --system-id <id> [--channel-id <id>] --clear");
      console.log("  backfill-analyze-tasks");
      console.log("  backfill-whisper-tasks [--limit <n>] [--clear]");
      console.log("  retry-failed-tasks [--type <task-type>] [--limit <n>] [--since <ISO-date>]");
      console.log("  delete-transmission --transmission-id <id>");
      console.log("  complete-task --transmission-id <id> [--type <task-type>] [--transcript <text>]");
      console.log("  clear-transcripts");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
