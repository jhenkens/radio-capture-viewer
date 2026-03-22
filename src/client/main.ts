import Alpine from "alpinejs";
import { WSClient } from "./ws/client";
import { systemSelector } from "./components/systemSelector";
import { channelSelector } from "./components/channelSelector";
import { transmissionList } from "./components/transmissionList";
import { audioPlayer } from "./components/audioPlayer";
import type { ServerWSMessage, TransmissionDTO } from "../shared/types";
import "./styles/main.css";

type QueryResultHandler = (result: { query_id: string; items: TransmissionDTO[]; next_cursor: number | null }) => void;

interface AppStore {
  // WS / subscription
  systemId: string | null;
  systemName: string;
  channelMap: Record<string, string>;
  channelIds: string[];
  wsConnected: boolean;
  wsClient: WSClient | null;
  _queryHandlers: QueryResultHandler[];

  // Transmissions (source of truth)
  transmissions: TransmissionDTO[];
  localDb: Record<string, TransmissionDTO>;

  // Playback coordination
  autoplay: boolean;
  playingId: string | null;
  lastPlayedId: string | null;
  pendingAfterId: string | null;

  // Live vs archive mode
  liveMode: boolean;

  init(): void;
  subscribe(systemId: string, channelIds: string[]): void;
  queryTransmissions(params: { system_id: string; channel_ids?: string[]; search?: string; before?: number; cursor?: number; limit?: number }): string | null;
  onQueryResult(fn: QueryResultHandler): void;
  addTransmission(tx: TransmissionDTO): void;
  mergeTransmissions(items: TransmissionDTO[]): void;
  clearTransmissions(): void;
  setPlayingId(id: string | null): void;
  onPlaybackEnded(id: string | null): void;
  toggleAutoplay(): void;
  setLiveMode(live: boolean): void;
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

const appStore: AppStore = {
  systemId: null,
  systemName: "",
  channelMap: {},
  channelIds: [],
  wsConnected: false,
  wsClient: null,
  _queryHandlers: [],

  transmissions: [],
  localDb: {},

  autoplay: true,
  playingId: null,
  lastPlayedId: null,
  pendingAfterId: null,

  liveMode: true,

  init() {
    const wsClient = new WSClient(WSClient.buildUrl());
    this.wsClient = wsClient;

    wsClient.onMessage((msg: ServerWSMessage) => {
      this.wsConnected = true;
      if (msg.type === "transmission_available") {
        this.addTransmission(msg.data);
      } else if (msg.type === "query_result") {
        for (const fn of this._queryHandlers) fn(msg);
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

  queryTransmissions(params) {
    return this.wsClient?.sendQuery(params) ?? null;
  },

  onQueryResult(fn: QueryResultHandler) {
    this._queryHandlers.push(fn);
  },

  addTransmission(tx: TransmissionDTO) {
    if (!this.liveMode) return;

    this.localDb[tx.id] = tx;
    this.transmissions = Object.values(this.localDb).sort((a, b) => b.recorded_at - a.recorded_at);

    if (this.playingId || !this.autoplay) return;

    if (this.pendingAfterId !== null) {
      // We were waiting at the live edge — check if this new item is newer than our anchor
      const idx = this.transmissions.findIndex((t) => t.id === this.pendingAfterId);
      if (idx > 0) {
        this.pendingAfterId = null;
        window.dispatchEvent(new CustomEvent("play-transmission", { detail: this.transmissions[idx - 1]! }));
      }
      // idx === 0 means the new item is older — keep waiting
    } else if (this.lastPlayedId === null) {
      // Fresh start: nothing has ever been played
      window.dispatchEvent(new CustomEvent("play-transmission", { detail: tx }));
    }
  },

  mergeTransmissions(items: TransmissionDTO[]) {
    for (const tx of items) {
      this.localDb[tx.id] = tx;
    }
    this.transmissions = Object.values(this.localDb).sort((a, b) => b.recorded_at - a.recorded_at);
  },

  clearTransmissions() {
    this.transmissions = [];
    this.localDb = {};
    this.pendingAfterId = null;
    this.lastPlayedId = null;
  },

  setPlayingId(id: string | null) {
    this.playingId = id;
    if (id !== null) this.lastPlayedId = id;
  },

  onPlaybackEnded(id: string | null) {
    if (!this.autoplay || id === null) return;

    const idx = this.transmissions.findIndex((tx) => tx.id === id);
    if (idx === -1) return; // transmission not in current list — stop

    if (idx > 0) {
      // There's a more recent item — play it after the gap
      setTimeout(() => {
        // Bail if something else started playing in the interim (manual play)
        if (this.lastPlayedId !== id) return;
        if (this.playingId) return;
        // Re-lookup in case a new item slotted in between
        const currentIdx = this.transmissions.findIndex((tx) => tx.id === id);
        if (currentIdx <= 0) {
          if (currentIdx === 0) this.pendingAfterId = id;
          return;
        }
        window.dispatchEvent(new CustomEvent("play-transmission", { detail: this.transmissions[currentIdx - 1]! }));
      }, 500);
    } else {
      // idx === 0: at the live edge — hold a reference and wait for a newer item
      this.pendingAfterId = id;
    }
  },

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    if (!this.autoplay) {
      this.pendingAfterId = null;
    } else if (!this.playingId) {
      // Resume from where we left off
      this.onPlaybackEnded(this.lastPlayedId);
    }
  },

  setLiveMode(live: boolean) {
    this.liveMode = live;
    if (!live) {
      this.pendingAfterId = null;
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Alpine as any).store("app", appStore);

document.addEventListener("DOMContentLoaded", () => {
  Alpine.start();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((Alpine as any).store("app") as AppStore).init();
});
