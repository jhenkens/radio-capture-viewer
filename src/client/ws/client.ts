import type { ClientWSMessage, ServerWSMessage } from "../../shared/types";

type MessageHandler = (msg: ServerWSMessage) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxDelay = 30_000;
  private handlers: MessageHandler[] = [];
  private pendingSubscription: ClientWSMessage | null = null;
  private pendingQueries = new Map<string, Extract<ClientWSMessage, { type: "query" }>>();
  private destroyed = false;

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.destroyed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      console.info("[WS] Connected");
      if (this.pendingSubscription) {
        this.send(this.pendingSubscription);
      }
      // Re-send any in-flight queries after reconnect
      for (const msg of this.pendingQueries.values()) {
        this.send(msg);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerWSMessage;
        if (msg.type !== "query_result") {
          console.info(`[WS] Received type=${msg.type}`);
        }
        // Remove resolved query from pending so it won't be re-sent on reconnect
        if (msg.type === "query_result") {
          this.pendingQueries.delete(msg.query_id);
        }
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      console.info("[WS] Disconnected");
      if (!this.destroyed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      // Before reconnecting, check if we're still authenticated (handles Authelia session expiry).
      // A 401 from any API endpoint means the session is gone — reload to trigger the auth redirect.
      try {
        const res = await fetch("/api/systems", { credentials: "same-origin" });
        if (res.status === 401) {
          location.reload();
          return;
        }
      } catch {
        // Network error — proceed with reconnect attempt as usual
      }
      this.connect();
    }, this.reconnectDelay);
  }

  send(msg: ClientWSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Queue subscribe messages for after reconnect
      if (msg.type === "subscribe") {
        this.pendingSubscription = msg;
      }
    }
  }

  sendQuery(params: Omit<Extract<ClientWSMessage, { type: "query" }>, "type" | "query_id">): string {
    const query_id = `q_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const msg: Extract<ClientWSMessage, { type: "query" }> = { type: "query", query_id, ...params };
    this.pendingQueries.set(query_id, msg);
    this.send(msg);
    return query_id;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
  }

  static buildUrl(): string {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}`;
  }
}
