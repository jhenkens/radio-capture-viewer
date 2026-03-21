import { v4 as uuidv4 } from "uuid";
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../db/index.js";
import type { AdminStationResponse } from "../../../shared/types.js";

const CreateChannelBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

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

  // POST /api/admin/channels — find or create a channel by name under the authenticated system
  fastify.post<{ Body: unknown; Reply: { id: string; name: string } | { error: string } }>(
    "/channels",
    async (request, reply) => {
      const parsed = CreateChannelBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const system = request.system!;
      const db = getDb();

      // Find existing channel with same name (case-sensitive)
      const existing = await db
        .select({ id: schema.channels.id, name: schema.channels.name })
        .from(schema.channels)
        .where(
          and(
            eq(schema.channels.system_id, system.id),
            eq(schema.channels.name, parsed.data.name)
          )
        );

      if (existing.length) {
        return reply.send({ id: existing[0]!.id, name: existing[0]!.name });
      }

      const id = uuidv4();
      await db.insert(schema.channels).values({
        id,
        system_id: system.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        created_at: Date.now(),
      });

      return reply.status(201).send({ id, name: parsed.data.name });
    }
  );
}
