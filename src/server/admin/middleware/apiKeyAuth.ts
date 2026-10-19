import crypto from "crypto";
import { eq } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import { getDb, schema } from "../../db/index.js";

declare module "fastify" {
  interface FastifyRequest {
    system?: typeof schema.systems.$inferSelect;
  }
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Per-IP throttle on failed auth attempts (in-memory; resets on restart).
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

function isBlocked(ip: string, now: number): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (now > f.resetAt) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function recordFailure(ip: string, now: number): void {
  if (failures.size > 10_000) failures.clear();
  const f = failures.get(ip);
  if (!f || now > f.resetAt) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else f.count++;
}

export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const now = Date.now();
  if (isBlocked(request.ip, now)) {
    reply.status(429).header("Retry-After", "60").send({ error: "Too many failed attempts" });
    return;
  }

  const key =
    (request.headers["x-api-key"] as string | undefined) ??
    (request.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "");

  if (!key) {
    recordFailure(request.ip, now);
    reply.status(401).send({ error: "Missing API key" });
    return;
  }

  const hash = hashKey(key);
  const db = getDb();

  const rows = await db
    .select({ apiKey: schema.api_keys, system: schema.systems })
    .from(schema.api_keys)
    .innerJoin(schema.systems, eq(schema.api_keys.system_id, schema.systems.id))
    .where(eq(schema.api_keys.key_hash, hash));

  if (!rows.length) {
    recordFailure(request.ip, now);
    reply.status(401).send({ error: "Invalid API key" });
    return;
  }

  const { apiKey, system } = rows[0]!;

  // Update last_used_at
  await db
    .update(schema.api_keys)
    .set({ last_used_at: Date.now() })
    .where(eq(schema.api_keys.id, apiKey.id));

  request.system = system;
}
