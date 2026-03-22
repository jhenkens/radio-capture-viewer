#!/usr/bin/env tsx
/**
 * Database stats dump — last 7 days.
 *
 * Usage:
 *   npm run stats
 *   npm run stats -- --days 14
 */

import { sql, and, gte, eq } from "drizzle-orm";
import { initConfig } from "../config/index.js";
import { getDb, schema } from "../db/index.js";

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || ms === 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  const pad = " ".repeat(Math.max(0, width - str.length));
  return right ? str + pad : pad + str;
}

async function main(): Promise<void> {
  await initConfig();
  const db = getDb();

  const args = process.argv.slice(2);
  const daysArg = args.indexOf("--days");
  const days = daysArg !== -1 && args[daysArg + 1] ? parseInt(args[daysArg + 1]!, 10) : 7;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  console.log(`\nDatabase Stats — Last ${days} Day${days !== 1 ? "s" : ""}`);
  console.log("=".repeat(66));

  // Daily summary
  const dailyRows = await db
    .select({
      day: sql<string>`date(${schema.transmissions.recorded_at} / 1000, 'unixepoch')`.as("day"),
      count: sql<number>`count(*)`.as("count"),
      total_ms: sql<number>`coalesce(sum(${schema.transmissions.duration_ms}), 0)`.as("total_ms"),
      transcribed: sql<number>`sum(case when ${schema.transmissions.transcript} is not null then 1 else 0 end)`.as("transcribed"),
    })
    .from(schema.transmissions)
    .where(
      and(
        gte(schema.transmissions.recorded_at, since),
        eq(schema.transmissions.available, true)
      )
    )
    .groupBy(sql`date(${schema.transmissions.recorded_at} / 1000, 'unixepoch')`)
    .orderBy(sql`date(${schema.transmissions.recorded_at} / 1000, 'unixepoch') desc`);

  console.log("\nDaily Summary (UTC)");
  console.log("-".repeat(66));
  console.log(
    `${pad("Date", 12, true)}  ${pad("Transmissions", 14, true)}  ${pad("Duration", 14, true)}  ${pad("Transcribed", 12, true)}`
  );
  console.log("-".repeat(66));

  let totalCount = 0;
  let totalMs = 0;
  let totalTranscribed = 0;

  if (dailyRows.length === 0) {
    console.log("  No transmissions in this period.");
  } else {
    for (const row of dailyRows) {
      const pct =
        row.count > 0 ? `${Math.round((row.transcribed / row.count) * 100)}%` : "—";
      console.log(
        `${pad(row.day, 12, true)}  ${pad(row.count, 14)}  ${pad(fmtDuration(row.total_ms), 14)}  ${pad(`${row.transcribed} (${pct})`, 12)}`
      );
      totalCount += row.count;
      totalMs += row.total_ms;
      totalTranscribed += row.transcribed;
    }
  }

  console.log("-".repeat(66));
  const totalPct =
    totalCount > 0 ? `${Math.round((totalTranscribed / totalCount) * 100)}%` : "—";
  console.log(
    `${pad("TOTAL", 12, true)}  ${pad(totalCount, 14)}  ${pad(fmtDuration(totalMs), 14)}  ${pad(`${totalTranscribed} (${totalPct})`, 12)}`
  );

  // Channel breakdown
  const channelRows = await db
    .select({
      name: schema.channels.name,
      count: sql<number>`count(*)`.as("count"),
      total_ms: sql<number>`coalesce(sum(${schema.transmissions.duration_ms}), 0)`.as("total_ms"),
    })
    .from(schema.transmissions)
    .innerJoin(schema.channels, eq(schema.transmissions.channel_id, schema.channels.id))
    .where(
      and(
        gte(schema.transmissions.recorded_at, since),
        eq(schema.transmissions.available, true)
      )
    )
    .groupBy(schema.channels.id)
    .orderBy(sql`sum(${schema.transmissions.duration_ms}) desc nulls last`);

  console.log("\nChannel Breakdown");
  console.log("-".repeat(66));
  console.log(
    `${pad("Channel", 30, true)}  ${pad("Transmissions", 14)}  ${pad("Duration", 14)}`
  );
  console.log("-".repeat(66));

  if (channelRows.length === 0) {
    console.log("  No data.");
  } else {
    for (const row of channelRows) {
      const name = row.name.length > 28 ? row.name.slice(0, 27) + "…" : row.name;
      console.log(
        `${pad(name, 30, true)}  ${pad(row.count, 14)}  ${pad(fmtDuration(row.total_ms), 14)}`
      );
    }
  }

  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
