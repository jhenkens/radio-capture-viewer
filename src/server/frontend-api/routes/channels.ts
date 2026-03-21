import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import type { ChannelDTO } from "../../../shared/types.js";

export async function channelsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Params: { system_id: string };
    Reply: ChannelDTO[];
  }>("/systems/:system_id/channels", async (request, reply) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.system_id, request.params.system_id));
    return reply.send(rows);
  });
}
