import type { TransmissionDTO } from "../../shared/types";
import { api } from "../api/client";

export interface AudioPlayerData {
  currentTransmission: TransmissionDTO | null;
  queue: TransmissionDTO[];
  playing: boolean;
  autoplay: boolean;
  lastPlayedId: string | null;
  pageLoadTime: number;
  currentTime: number;
  audioDuration: number;
  audio: HTMLAudioElement | null;

  init(): void;
  play(tx: TransmissionDTO): void;
  enqueue(tx: TransmissionDTO): void;
  playNext(): void;
  toggleAutoplay(): void;
  stop(): void;
  formatProgress(s: number): string;
  getAutoplayState(): { enabled: boolean; last_played_id: string | null };
}

export function audioPlayer(): AudioPlayerData {
  return {
    currentTransmission: null,
    queue: [],
    playing: false,
    autoplay: true,
    lastPlayedId: null,
    pageLoadTime: Date.now(),
    currentTime: 0,
    audioDuration: 0,
    audio: null,

    init() {
      this.audio = new Audio();

      this.audio.ontimeupdate = () => {
        this.currentTime = this.audio!.currentTime;
      };

      this.audio.onloadedmetadata = () => {
        this.audioDuration = this.audio!.duration || 0;
      };

      this.audio.onended = () => {
        const finishedId = this.currentTransmission?.id ?? null;
        if (this.currentTransmission) {
          this.lastPlayedId = this.currentTransmission.id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).$dispatch("transmission-played", { id: this.currentTransmission.id });
        }
        this.playing = false;
        this.currentTransmission = null;
        this.currentTime = 0;
        this.audioDuration = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$dispatch("playing-changed", { id: null });
        if (this.queue.length > 0) {
          setTimeout(() => this.playNext(), 500);
        } else if (this.autoplay && finishedId) {
          // Ask the transmission list for the next more-recent item
          setTimeout(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).$dispatch("request-next-transmission", { id: finishedId });
          }, 500);
        }
      };

      this.audio.onerror = () => {
        this.playing = false;
        this.currentTransmission = null;
        this.currentTime = 0;
        this.audioDuration = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$dispatch("playing-changed", { id: null });
        if (this.queue.length > 0) {
          setTimeout(() => this.playNext(), 500);
        }
      };

      // Notify of initial autoplay state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("autoplay-changed", this.getAutoplayState());
    },

    play(tx: TransmissionDTO) {
      if (!this.audio) return;
      this.audio.pause();
      this.currentTransmission = tx;
      this.currentTime = 0;
      this.audioDuration = 0;
      this.audio.src = api.getAudioUrl(tx.id);
      this.audio.load();
      this.audio.play().then(() => {
        this.playing = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$dispatch("playing-changed", { id: tx.id });
      }).catch(() => {
        this.playing = false;
        this.currentTransmission = null;
      });
    },

    enqueue(tx: TransmissionDTO) {
      // Insert in chronological order (oldest first → newest last)
      const idx = this.queue.findIndex((q) => q.recorded_at > tx.recorded_at);
      if (idx === -1) {
        this.queue.push(tx);
      } else {
        this.queue.splice(idx, 0, tx);
      }

      if (!this.playing && this.autoplay) {
        this.playNext();
      }
    },

    playNext() {
      if (!this.queue.length) return;
      const next = this.queue.shift()!;
      this.play(next);
    },

    toggleAutoplay() {
      this.autoplay = !this.autoplay;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("autoplay-changed", this.getAutoplayState());

      if (this.autoplay && !this.playing && this.queue.length > 0) {
        this.playNext();
      }
    },

    stop() {
      if (!this.audio) return;
      this.audio.pause();
      this.playing = false;
      this.currentTransmission = null;
      this.queue = [];
      this.currentTime = 0;
      this.audioDuration = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$dispatch("playing-changed", { id: null });
    },

    formatProgress(s: number): string {
      const total = Math.ceil(s);
      const m = Math.floor(total / 60);
      const sec = total % 60;
      if (m > 0) return `${m}m:${sec}s`;
      return `${sec}s`;
    },

    getAutoplayState() {
      return { enabled: this.autoplay, last_played_id: this.lastPlayedId };
    },
  };
}
