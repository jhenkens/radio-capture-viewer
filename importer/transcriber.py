# -*- coding: utf-8 -*-
"""
Local transcription using faster-whisper.

Config section (config.yaml):

  transcription:
    enabled: false
    model: "large-v3"       # Fits comfortably in 4 GB RAM with int8
    device: "cpu"           # "cpu" or "cuda"
    compute_type: "int8"    # "int8" (CPU), "float16" (GPU), "float32"
    cpu_threads: 4
    language: "en"          # Set to null for auto-detect

Memory guidance (approximate, int8 on CPU):
  tiny:    ~150 MB    base:   ~200 MB
  small:   ~500 MB    medium: ~1.5 GB
  large-v3: ~2 GB    (safe default for a 4 GB budget)
"""

import logging
import threading

logger = logging.getLogger(__name__)


class Transcriber:
    """
    Wraps faster-whisper with lazy model loading and thread-safe initialization.
    The model is loaded on the first call to transcribe() and reused afterwards.
    """

    def __init__(self, config: dict):
        self.model_size = config.get("model", "large-v3")
        self.device = config.get("device", "cpu")
        self.compute_type = config.get("compute_type", "int8")
        self.cpu_threads = int(config.get("cpu_threads", 4))
        raw_lang = config.get("language", "en")
        self.language: str | None = raw_lang if raw_lang else None
        self._model = None
        self._lock = threading.Lock()

    def _load(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            from faster_whisper import WhisperModel  # type: ignore[import]
            logger.info(
                "Loading faster-whisper model '%s' (device=%s, compute_type=%s, cpu_threads=%d)…",
                self.model_size, self.device, self.compute_type, self.cpu_threads,
            )
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                cpu_threads=self.cpu_threads,
            )
            logger.info("faster-whisper model loaded.")

    def transcribe(self, filepath: str) -> str:
        """Transcribe an audio file and return the full transcript as a string."""
        self._load()
        segments, info = self._model.transcribe(
            filepath,
            language=self.language,
            beam_size=5,
            vad_filter=True,
        )
        logger.debug(
            "Transcribing %s (detected language: %s, probability: %.2f)",
            filepath, info.language, info.language_probability,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()
