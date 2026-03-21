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

export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const key =
    (request.headers["x-api-key"] as string | undefined) ??
    (request.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "");

  if (!key) {
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
