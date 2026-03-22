import type WebSocket from "ws";
import type { ClientWSMessage, ServerWSMessage } from "../../shared/types.js";
import type { ConnectionManager } from "./ConnectionManager.js";

export function handleWebSocket(ws: WebSocket, manager: ConnectionManager): void {
  manager.add(ws);

  ws.on("message", (raw) => {
    let msg: ClientWSMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientWSMessage;
    } catch {
      const err: ServerWSMessage = { type: "error", message: "Invalid JSON" };
      manager.send(ws, err);
      return;
    }

    console.info(`[WS] Message type=${msg.type}`);

    if (msg.type === "subscribe") {
      if (!msg.system_id) {
        manager.send(ws, { type: "error", message: "system_id is required" });
        return;
      }
      manager.subscribe(ws, msg.system_id, msg.channel_ids);
      manager.send(ws, { type: "subscribed" });
    } else if (msg.type === "query") {
      if (!msg.query_id || !msg.system_id) {
        manager.send(ws, { type: "error", message: "query_id and system_id are required" });
        return;
      }
      manager.handleQuery(ws, msg).catch((err) => {
        console.error("[WS] Query error:", err);
        manager.send(ws, { type: "error", message: "Query failed" });
      });
    } else {
      manager.send(ws, { type: "error", message: "Unknown message type" });
    }
  });

  ws.on("close", () => {
    manager.remove(ws);
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err.message);
    manager.remove(ws);
  });
}
