import type { ChannelDTO } from "../../shared/types";
import { api } from "../api/client";

export interface ChannelSelectorData {
  channels: ChannelDTO[];
  selectedChannelIds: string[];
  loading: boolean;
  error: string | null;

  loadChannels(systemId: string): Promise<void>;
  selectOnly(id: string): void;
  toggleChannel(id: string): void;
  isSelected(id: string): boolean;
}

export function channelSelector(): ChannelSelectorData {
  return {
    channels: [],
    selectedChannelIds: [],
    loading: false,
    error: null,

    async loadChannels(systemId: string) {
      this.loading = true;
      this.error = null;
      this.channels = [];
      this.selectedChannelIds = [];
      try {
        this.channels = await api.getChannels(systemId);
        this.selectedChannelIds = this.channels.map((c) => c.id);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("channels-changed", { ids: this.selectedChannelIds });
    },

    toggleChannel(id: string) {
      if (this.selectedChannelIds.includes(id)) {
        this.selectedChannelIds = this.selectedChannelIds.filter((c) => c !== id);
      } else {
        this.selectedChannelIds = [...this.selectedChannelIds, id];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("channels-changed", { ids: this.selectedChannelIds });
    },

    isSelected(id: string) {
      return this.selectedChannelIds.includes(id);
    },
  };
}
