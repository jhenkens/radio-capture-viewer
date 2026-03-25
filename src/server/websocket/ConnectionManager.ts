import type WebSocket from "ws";
import { eq, and, lt, gte, inArray, like, or, desc } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DB } from "../db/index.js";
import type { NotificationService, TransmissionAvailableEvent } from "../notifications/NotificationService.js";
import type { TransmissionDTO, ServerWSMessage } from "../../shared/types.js";

interface ConnectionState {
  system_id: string | null;
  channel_ids: string[] | null; // null = all channels
}

export class ConnectionManager {
  private readonly connections = new Map<WebSocket, ConnectionState>();

  constructor(
    private readonly db: DB,
    private readonly notifications: NotificationService
  ) {
    this.notifications.onTransmissionAvailable(this.onTransmissionAvailable.bind(this));
  }

  add(ws: WebSocket): void {
    this.connections.set(ws, {
      system_id: null,
      channel_ids: null,
    });
    console.info(`[WS] Client connected (total: ${this.connections.size})`);
  }

  remove(ws: WebSocket): void {
    this.connections.delete(ws);
    console.info(`[WS] Client disconnected (total: ${this.connections.size})`);
  }

  subscribe(ws: WebSocket, system_id: string, channel_ids?: string[]): void {
    const state = this.connections.get(ws);
    if (!state) return;
    state.system_id = system_id;
    state.channel_ids = channel_ids ?? null;
  }

  private async onTransmissionAvailable(event: TransmissionAvailableEvent): Promise<void> {
    const { system_id, channel_id, transmission_id } = event;

    // Fetch full transmission DTO
    const rows = await this.db
      .select()
      .from(schema.transmissions)
      .where(eq(schema.transmissions.id, transmission_id));

    if (!rows.length) return;
    const tx = rows[0]!;

    const dto: TransmissionDTO = {
      id: tx.id,
      system_id: tx.system_id,
      channel_id: tx.channel_id,
      available: tx.available,
      transcript: tx.transcript,
      duration_ms: tx.duration_ms,
      frequency_hz: tx.frequency_hz,
      recorded_at: tx.recorded_at,
      created_at: tx.created_at,
    };

    const message: ServerWSMessage = {
      type: "transmission_available",
      data: dto,
    };

    for (const [ws, state] of this.connections) {
      if (ws.readyState !== 1 /* OPEN */) continue;
      if (state.system_id !== system_id) continue;
      if (state.channel_ids !== null && !state.channel_ids.includes(channel_id)) continue;
      this.send(ws, message);
    }
  }

  async handleQuery(
    ws: WebSocket,
    msg: { query_id: string; system_id: string; channel_ids?: string[]; search?: string; after?: number; before?: number; cursor?: number; limit?: number }
  ): Promise<void> {
    const { query_id, system_id, channel_ids, search, after, before, cursor, limit: lim } = msg;
    const limit = Math.min(lim ?? 50, 200);

    const conditions = [
      eq(schema.transmissions.system_id, system_id),
      eq(schema.transmissions.available, true),
    ];

    if (channel_ids?.length) {
      conditions.push(inArray(schema.transmissions.channel_id, channel_ids));
    }
    if (search) {
      conditions.push(or(
        like(schema.transmissions.transcript, `%${search}%`),
        eq(schema.transmissions.id, search)
      )!);
    }
    if (after !== undefined) {
      conditions.push(gte(schema.transmissions.recorded_at, after));
    }
    if (before !== undefined) {
      conditions.push(lt(schema.transmissions.recorded_at, before));
    }
    if (cursor !== undefined) {
      conditions.push(lt(schema.transmissions.recorded_at, cursor));
    }

    const rows = await this.db
      .select()
      .from(schema.transmissions)
      .where(and(...conditions))
      .orderBy(desc(schema.transmissions.recorded_at))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore && items.length > 0 ? items[items.length - 1]!.recorded_at : null;

    const dtos: TransmissionDTO[] = items.map((tx) => ({
      id: tx.id,
      system_id: tx.system_id,
      channel_id: tx.channel_id,
      available: tx.available,
      transcript: tx.transcript,
      duration_ms: tx.duration_ms,
      frequency_hz: tx.frequency_hz,
      recorded_at: tx.recorded_at,
      created_at: tx.created_at,
    }));

    this.send(ws, { type: "query_result", query_id, items: dtos, next_cursor });
  }

  send(ws: WebSocket, message: ServerWSMessage): void {
    if (ws.readyState !== 1 /* OPEN */) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // ignore send errors
    }
  }
}
