import Alpine from "alpinejs";
import { WSClient } from "./ws/client";
import { systemSelector } from "./components/systemSelector";
import { channelSelector } from "./components/channelSelector";
import { transmissionList } from "./components/transmissionList";
import { audioPlayer } from "./components/audioPlayer";
import type { ServerWSMessage } from "../shared/types";
import "./styles/main.css";

interface AppStore {
  systemId: string | null;
  systemName: string;
  channelMap: Record<string, string>;
  channelIds: string[];
  wsConnected: boolean;
  wsClient: WSClient | null;
  init(): void;
  subscribe(systemId: string, channelIds: string[]): void;
  setAutoplay(enabled: boolean, lastPlayedId: string | null): void;
  queryTransmissions(params: { system_id: string; channel_ids?: string[]; search?: string; cursor?: number; limit?: number }): string | null;
}

// Register Alpine components
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Alpine as any).data("systemSelector", systemSelector);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Alpine as any).data("channelSelector", channelSelector);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Alpine as any).data("transmissionList", transmissionList);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Alpine as any).data("audioPlayer", audioPlayer);

// Alpine store for global app state
const appStore: AppStore = {
  systemId: null,
  systemName: "",
  channelMap: {},
  channelIds: [],
  wsConnected: false,
  wsClient: null,

  init() {
    const wsUrl = WSClient.buildUrl();
    const wsClient = new WSClient(wsUrl);
    this.wsClient = wsClient;

    wsClient.onMessage((msg: ServerWSMessage) => {
      this.wsConnected = true;
      if (msg.type === "transmission_available") {
        document.dispatchEvent(
          new CustomEvent("ws:transmission-available", { detail: msg.data })
        );
      } else if (msg.type === "query_result") {
        document.dispatchEvent(
          new CustomEvent("ws:query-result", { detail: msg })
        );
      }
    });

    wsClient.connect();
  },

  subscribe(systemId: string, channelIds: string[]) {
    this.systemId = systemId;
    this.channelIds = channelIds;
    this.wsClient?.send({
      type: "subscribe",
      system_id: systemId,
      channel_ids: channelIds.length ? channelIds : undefined,
    });
  },

  setAutoplay(enabled: boolean, lastPlayedId: string | null) {
    this.wsClient?.send({
      type: "autoplay",
      enabled,
      last_played_id: lastPlayedId ?? undefined,
    });
  },

  queryTransmissions(params: { system_id: string; channel_ids?: string[]; search?: string; cursor?: number; limit?: number }): string | null {
    return this.wsClient?.sendQuery(params) ?? null;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Alpine as any).store("app", appStore);

// Boot Alpine after DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  Alpine.start();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((Alpine as any).store("app") as AppStore).init();
});
