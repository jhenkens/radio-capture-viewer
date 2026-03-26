#!/usr/bin/env python3
"""
transcriber — minimal single-threaded OpenAI-compatible transcription server
backed by faster-whisper.

Processes one request at a time (Flask threaded=False). Any concurrent
request waits at the OS socket level until the current one finishes.

Required env:
  API_KEY        Bearer token clients must present

Optional env:
  WHISPER_MODEL  faster-whisper model name (default: small.en)
  DEVICE         cpu or cuda (default: cpu)
  COMPUTE_TYPE   int8 / float16 / float32 (default: int8)
  BEAM_SIZE      beam search width (default: 5)
  VAD_FILTER     use Silero VAD to skip silent/non-voice audio (default: true)
  PORT           listen port (default: 8000)
  LOG_LEVEL      global log level: DEBUG / INFO / WARNING / ERROR (default: WARNING)
  APP_LOG_LEVEL  log level for this app: DEBUG / INFO / WARNING / ERROR (default: INFO)
"""

import logging
import os
import signal
import sys
import tempfile
import warnings

import psutil
from flask import Flask, g, request, jsonify
from faster_whisper import WhisperModel

log = logging.getLogger(__name__)

NO_VOICES_TEXT = "<no voices detected>"


# ---------------------------------------------------------------------------
# Memory helper
# ---------------------------------------------------------------------------

_proc = psutil.Process()

def _rss_mb() -> float:
    return _proc.memory_info().rss / 1024 / 1024


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class TranscriberServer:
    def __init__(self, api_key: str, model: WhisperModel, beam_size: int, vad_filter: bool, port: int) -> None:
        self.api_key    = api_key
        self.model      = model
        self.beam_size  = beam_size
        self.vad_filter = vad_filter
        self.port       = port
        self.app        = Flask(__name__)

        self.app.add_url_rule(
            "/v1/audio/transcriptions",
            view_func=self._transcribe,
            methods=["POST"],
        )
        self.app.before_request(self._before_request)
        self.app.after_request(self._after_request)

    def run(self) -> None:
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT,  self._handle_shutdown)
        log.info("Listening on port %d", self.port)
        self.app.run(host="0.0.0.0", port=self.port, threaded=False)

    def _handle_shutdown(self, signum, frame) -> None:
        log.info("Received signal %s, shutting down.", signal.Signals(signum).name)
        sys.exit(0)

    def _before_request(self) -> None:
        if log.isEnabledFor(logging.DEBUG):
            g._mem_before = _rss_mb()
            log.debug("→ %s %s | mem: %.1f MB", request.method, request.path, g._mem_before)

    def _after_request(self, response):
        if log.isEnabledFor(logging.DEBUG):
            mem = _rss_mb()
            before = getattr(g, "_mem_before", None)
            delta = f" Δ{mem - before:+.1f} MB" if before is not None else ""
            log.debug("← %s %d | mem: %.1f MB%s", request.path, response.status_code, mem, delta)
        return response

    def _transcribe(self) -> tuple:
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth[7:] != self.api_key:
            return jsonify({"error": "Unauthorized"}), 401

        if "file" not in request.files:
            return jsonify({"error": "file is required"}), 400

        audio    = request.files["file"]
        prompt   = request.form.get("prompt")   or None
        hotwords = request.form.get("hotwords") or None
        # model and response_format params are accepted but ignored

        suffix = os.path.splitext(audio.filename or "audio")[1] or ".mp3"
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                audio.save(tmp)
                tmp_path = tmp.name

            kwargs = {"beam_size": self.beam_size, "vad_filter": self.vad_filter}
            if prompt:
                kwargs["initial_prompt"] = prompt
            if hotwords:
                kwargs["hotwords"] = hotwords

            log.info(
                "Transcribing %s (prompt=%s, hotwords=%s, vad=%s)",
                audio.filename, bool(prompt), bool(hotwords), self.vad_filter,
            )
            log.debug("  prompt:   %s", prompt)
            log.debug("  hotwords: %s", hotwords)
            segments, _ = self.model.transcribe(tmp_path, **kwargs)
            text = " ".join(seg.text.strip() for seg in segments)

            if not text.strip():
                text = NO_VOICES_TEXT
                log.info("No speech detected — returning %r", NO_VOICES_TEXT)
            else:
                log.info("Done: %s", text[:120])
        finally:
            if tmp_path:
                os.unlink(tmp_path)

        return jsonify({"text": text}), 200


# ---------------------------------------------------------------------------
# Startup helpers
# ---------------------------------------------------------------------------

def configure_logging(global_level_name: str, app_level_name: str) -> None:
    def parse(name: str, env_var: str) -> int:
        level = getattr(logging, name.upper(), None)
        if not isinstance(level, int):
            raise RuntimeError(f"Invalid {env_var}: {name!r}")
        return level

    global_level = parse(global_level_name, "LOG_LEVEL")
    app_level    = parse(app_level_name,    "APP_LOG_LEVEL")

    logging.basicConfig(
        level=global_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Our app logger gets its own level independent of the global default.
    logging.getLogger(__name__).setLevel(app_level)
    # Suppress werkzeug's built-in per-request access lines — our before/after
    # hooks already cover that, and werkzeug's format would just be noise.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    # Suppress the "unauthenticated requests" warning from huggingface_hub.
    # It is emitted via warnings.warn(), which shows up both as a raw stderr
    # line and as a py.warnings log record — filterwarnings kills both.
    logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
    warnings.filterwarnings("ignore", module="huggingface_hub.*")


def load_config() -> tuple[str, str, str, str, int, bool, int]:
    """Read and validate env vars. Returns (api_key, model_name, device, compute_type, beam_size, vad_filter, port)."""
    api_key = os.environ.get("API_KEY", "")
    if not api_key:
        raise RuntimeError("API_KEY environment variable is required")

    return (
        api_key,
        os.environ.get("WHISPER_MODEL", "small.en"),
        os.environ.get("DEVICE", "cpu"),
        os.environ.get("COMPUTE_TYPE", "int8"),
        int(os.environ.get("BEAM_SIZE", "5")),
        os.environ.get("VAD_FILTER", "true").lower() not in ("false", "0", "no"),
        int(os.environ.get("PORT", "8000")),
    )


def load_model(model_name: str, device: str, compute_type: str) -> WhisperModel:
    log.info("Loading model '%s' (device=%s, compute_type=%s)…", model_name, device, compute_type)
    m = WhisperModel(model_name, device=device, compute_type=compute_type)
    log.info("Model ready. mem: %.1f MB", _rss_mb())
    return m


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        configure_logging(
            os.environ.get("LOG_LEVEL",     "WARNING"),
            os.environ.get("APP_LOG_LEVEL", "INFO"),
        )

        api_key, model_name, device, compute_type, beam_size, vad_filter, port = load_config()
        log.info("VAD filter: %s", "enabled" if vad_filter else "disabled")
        model = load_model(model_name, device, compute_type)

        TranscriberServer(api_key, model, beam_size, vad_filter, port).run()

    except RuntimeError as e:
        print(f"\nConfiguration error: {e}", file=sys.stderr)
        print("Set the required environment variables and try again.", file=sys.stderr)
        sys.exit(1)
    except MemoryError:
        print("\nOut of memory while loading the model.", file=sys.stderr)
        print("Try a smaller WHISPER_MODEL or increase available RAM.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nFatal error: {e}", file=sys.stderr)
        sys.exit(1)
