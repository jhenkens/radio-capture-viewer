import type { FastifyInstance } from "fastify";
import { getDb, schema } from "../../db/index.js";
import type { SystemDTO } from "../../../shared/types.js";

export async function systemsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: SystemDTO[] }>("/systems", async (_request, reply) => {
    const db = getDb();
    const rows = await db.select().from(schema.systems);
    return reply.send(rows);
  });
}
