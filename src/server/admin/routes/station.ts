import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import type { AdminStationResponse } from "../../../shared/types.js";

export async function stationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/admin/station — return system info + channels for the authenticated key
  fastify.get<{ Reply: AdminStationResponse }>(
    "/station",
    async (request, reply) => {
      const system = request.system!;
      const db = getDb();

      const channels = await db
        .select({ id: schema.channels.id, name: schema.channels.name })
        .from(schema.channels)
        .where(eq(schema.channels.system_id, system.id));

      return reply.send({
        system: { id: system.id, name: system.name },
        channels,
      });
    }
  );
}
