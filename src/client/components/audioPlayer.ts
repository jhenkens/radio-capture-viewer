import type { TransmissionDTO } from "../../shared/types";
import { api } from "../api/client";

export interface AudioPlayerData {
  currentTransmission: TransmissionDTO | null;
  playing: boolean;
  currentTime: number;
  audioDuration: number;
  audio: HTMLAudioElement | null;

  init(): void;
  play(tx: TransmissionDTO): void;
  stop(): void;
  formatProgress(s: number): string;
}

export function audioPlayer(): AudioPlayerData {
  return {
    currentTransmission: null,
    playing: false,
    currentTime: 0,
    audioDuration: 0,
    audio: null,

    init() {
      this.audio = new Audio();

      this.audio.ontimeupdate = () => {
        this.currentTime = this.audio!.currentTime;
      };

      this.audio.onloadedmetadata = () => {
        const d = this.audio!.duration;
        this.audioDuration = isFinite(d) ? d : 0;
      };

      this.audio.onended = () => {
        const finishedId = this.currentTransmission?.id ?? null;
        this.playing = false;
        this.currentTransmission = null;
        this.currentTime = 0;
        this.audioDuration = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setPlayingId(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.onPlaybackEnded(finishedId);
      };

      this.audio.onerror = () => {
        this.playing = false;
        this.currentTransmission = null;
        this.currentTime = 0;
        this.audioDuration = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setPlayingId(null);
      };
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
        (this as any).$store.app.setPlayingId(tx.id);
      }).catch(() => {
        this.playing = false;
        this.currentTransmission = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setPlayingId(null);
      });
    },

    stop() {
      if (!this.audio) return;
      this.audio.pause();
      this.playing = false;
      this.currentTransmission = null;
      this.currentTime = 0;
      this.audioDuration = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$store.app.setPlayingId(null);
    },

    formatProgress(s: number): string {
      const total = Math.ceil(s);
      const m = Math.floor(total / 60);
      const sec = total % 60;
      if (m > 0) return `${m}m:${sec}s`;
      return `${sec}s`;
    },
  };
}
