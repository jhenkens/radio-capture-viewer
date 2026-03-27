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
  pause(): void;
  resume(): void;
  stop(): void;
  seek(fraction: number): void;
  formatProgress(s: number): string;
  _trySetDuration(): void;
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
        if (this.audioDuration === 0) this._trySetDuration();
      };
      this.audio.onloadedmetadata = () => this._trySetDuration();
      this.audio.ondurationchange = () => this._trySetDuration();

      this.audio.onended = () => {
        const finishedId = this.currentTransmission?.id ?? null;
        this.playing = false;
        this.currentTransmission = null;
        this.currentTime = 0;
        this.audioDuration = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.playing = false;
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
        (this as any).$store.app.playing = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setPlayingId(null);
      };
    },

    _trySetDuration() {
      if (!this.audio) return;
      const d = this.audio.duration;
      if (isFinite(d) && d > 0) {
        this.audioDuration = d;
        return;
      }
      // Safari fallback: use seekable end when duration is NaN/Infinity
      const seekable = this.audio.seekable;
      if (seekable && seekable.length > 0) {
        const s = seekable.end(seekable.length - 1);
        if (isFinite(s) && s > 0) this.audioDuration = s;
      }
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
        (this as any).$store.app.playing = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setPlayingId(tx.id);
      }).catch(() => {
        this.playing = false;
        this.currentTransmission = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.playing = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.setPlayingId(null);
      });
    },

    pause() {
      if (!this.audio) return;
      this.audio.pause();
      this.playing = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$store.app.playing = false;
    },

    resume() {
      if (!this.audio || !this.currentTransmission) return;
      this.audio.play().then(() => {
        this.playing = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.playing = true;
      }).catch(() => {
        this.playing = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).$store.app.playing = false;
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
      (this as any).$store.app.playing = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$store.app.setPlayingId(null);
    },

    seek(fraction: number) {
      if (!this.audio || this.audioDuration <= 0) return;
      this.audio.currentTime = Math.max(0, Math.min(1, fraction)) * this.audioDuration;
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
