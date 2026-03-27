import type { ChannelDTO } from "../../shared/types";
import { api } from "../api/client";

function storageKey(systemId: string) {
  return `rcv:channelIds:${systemId}`;
}

function loadSaved(systemId: string, available: ChannelDTO[]): string[] {
  try {
    const raw = localStorage.getItem(storageKey(systemId));
    if (!raw) return available.map((c) => c.id);
    const saved: string[] = JSON.parse(raw);
    const valid = saved.filter((id) => available.some((c) => c.id === id));
    return valid.length > 0 ? valid : available.map((c) => c.id);
  } catch {
    return available.map((c) => c.id);
  }
}

export interface ChannelSelectorData {
  channels: ChannelDTO[];
  selectedChannelIds: string[];
  currentSystemId: string | null;
  loading: boolean;
  error: string | null;

  loadChannels(systemId: string): Promise<void>;
  selectOnly(id: string): void;
  toggleChannel(id: string): void;
  isSelected(id: string): boolean;
  _saveSelection(): void;
}

export function channelSelector(): ChannelSelectorData {
  return {
    channels: [],
    selectedChannelIds: [],
    currentSystemId: null,
    loading: false,
    error: null,

    async loadChannels(systemId: string) {
      this.loading = true;
      this.error = null;
      this.channels = [];
      this.selectedChannelIds = [];
      this.currentSystemId = systemId;
      try {
        this.channels = await api.getChannels(systemId);
        this.selectedChannelIds = loadSaved(systemId, this.channels);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$dispatch("channels-loaded", { channels: this.channels });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$dispatch("channels-changed", { ids: this.selectedChannelIds });
      } catch (err) {
        this.error = String(err);
      } finally {
        this.loading = false;
      }
    },

    selectOnly(id: string) {
      this.selectedChannelIds = [id];
      this._saveSelection();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("channels-changed", { ids: this.selectedChannelIds });
    },

    toggleChannel(id: string) {
      if (this.selectedChannelIds.includes(id)) {
        this.selectedChannelIds = this.selectedChannelIds.filter((c) => c !== id);
      } else {
        this.selectedChannelIds = [...this.selectedChannelIds, id];
      }
      this._saveSelection();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("channels-changed", { ids: this.selectedChannelIds });
    },

    isSelected(id: string) {
      return this.selectedChannelIds.includes(id);
    },

    _saveSelection() {
      if (this.currentSystemId) {
        localStorage.setItem(storageKey(this.currentSystemId), JSON.stringify(this.selectedChannelIds));
      }
    },
  };
}
