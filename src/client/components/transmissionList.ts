import type { TransmissionDTO } from "../../shared/types";

export interface TransmissionListData {
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  cursor: number | null;
  systemId: string | null;
  channelIds: string[];
  searchQuery: string;
  selectedDate: string;
  beforeTs: number | null;
  lastScrollTime: number;
  currentQueryId: string | null;
  currentMoreQueryId: string | null;

  init(): void;
  load(systemId: string, channelIds?: string[]): void;
  loadMore(): void;
  search(query: string): void;
  onDateChange(value: string): void;
  handleQueryResult(result: { query_id: string; items: TransmissionDTO[]; next_cursor: number | null }): void;
  scrollToPlaying(): void;
  formatTime(ts: number): string;
  formatDuration(ms: number | null): string;
}

export function transmissionList(): TransmissionListData {
  return {
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    cursor: null,
    systemId: null,
    channelIds: [],
    searchQuery: "",
    selectedDate: "",
    beforeTs: null,
    lastScrollTime: 0,
    currentQueryId: null,
    currentMoreQueryId: null,

    init() {
      this.lastScrollTime = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$store.app.onQueryResult(
        (result: Parameters<typeof this.handleQueryResult>[0]) => this.handleQueryResult(result)
      );

      setInterval(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(this as any).$store.app.playingId) return;
        if (Date.now() - this.lastScrollTime < 15_000) return;
        this.scrollToPlaying();
      }, 2_000);

      const sentinel = document.getElementById("tx-list-sentinel");
      if (sentinel && "IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          (entries) => { if (entries[0]?.isIntersecting) this.loadMore(); },
          { rootMargin: "200px" }
        );
        observer.observe(sentinel);
      }
    },

    load(systemId: string, channelIds: string[] = []) {
      this.systemId = systemId;
      this.channelIds = channelIds;
      this.cursor = null;
      this.hasMore = false;
      this.currentMoreQueryId = null;
      this.error = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$store.app.clearTransmissions();

      if (!channelIds.length) return;

      this.loading = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryId = (this as any).$store.app.queryTransmissions({
        system_id: systemId,
        channel_ids: channelIds,
        search: this.searchQuery || undefined,
        before: this.beforeTs ?? undefined,
        limit: 50,
      }) as string | null;
      this.currentQueryId = queryId;
    },

    loadMore() {
      if (!this.systemId || !this.hasMore || this.loadingMore || this.loading) return;
      this.loadingMore = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryId = (this as any).$store.app.queryTransmissions({
        system_id: this.systemId,
        channel_ids: this.channelIds.length ? this.channelIds : undefined,
        search: this.searchQuery || undefined,
        before: this.beforeTs ?? undefined,
        cursor: this.cursor ?? undefined,
        limit: 50,
      }) as string | null;
      this.currentMoreQueryId = queryId;
    },

    search(query: string) {
      this.searchQuery = query;
      if (this.systemId) this.load(this.systemId, this.channelIds);
    },

    onDateChange(value: string) {
      this.selectedDate = value;
      if (value) {
        // Compute start of the next day in local time (exclusive upper bound)
        const [year, month, day] = value.split("-").map(Number);
        this.beforeTs = new Date(year!, month! - 1, day! + 1).getTime();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setLiveMode(false);
      } else {
        this.beforeTs = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setLiveMode(true);
      }
      if (this.systemId) this.load(this.systemId, this.channelIds);
    },

    handleQueryResult(result: { query_id: string; items: TransmissionDTO[]; next_cursor: number | null }) {
      if (result.query_id === this.currentQueryId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.mergeTransmissions(result.items);
        this.cursor = result.next_cursor;
        this.hasMore = result.next_cursor !== null;
        this.loading = false;
        this.currentQueryId = null;
      } else if (result.query_id === this.currentMoreQueryId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.mergeTransmissions(result.items);
        this.cursor = result.next_cursor;
        this.hasMore = result.next_cursor !== null;
        this.loadingMore = false;
        this.currentMoreQueryId = null;
      }
    },

    scrollToPlaying() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = (this as any).$store.app.playingId as string | null;
      if (!id) return;
      const el = document.querySelector(`[data-tx-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },

    formatTime(ts: number): string {
      return new Date(ts).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    },

    formatDuration(ms: number | null): string {
      if (ms == null) return "";
      const s = Math.ceil(ms / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      if (m > 0) return `${m}m:${sec}s`;
      return `${s}s`;
    },
  };
}
