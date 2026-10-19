"""
Standalone voice-activity check using the Silero VAD model that ships with
faster-whisper (no extra dependency, no Whisper pass).

Returns raw metrics rather than a verdict so callers can tune thresholds
without redeploying the transcriber.
"""

import numpy as np
from faster_whisper.audio import decode_audio
from faster_whisper.vad import get_vad_model

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 512  # Silero's fixed window: 32 ms at 16 kHz
WINDOW_MS = WINDOW_SAMPLES * 1000 / SAMPLE_RATE


def analyze(path: str, threshold: float = 0.5) -> dict:
    """
    Run Silero over the file and summarise the per-window speech probabilities.

      duration_ms     decoded audio length
      speech_ms       total time in windows with probability >= threshold
      max_prob        highest single-window probability
      mean_prob       mean probability over the whole file
      p95_prob        95th percentile window probability (robust to one-off spikes)
      longest_run_ms  longest unbroken run of windows >= threshold
    """
    audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
    if audio.size == 0:
        return {
            "duration_ms": 0, "speech_ms": 0, "max_prob": 0.0,
            "mean_prob": 0.0, "p95_prob": 0.0, "longest_run_ms": 0,
        }

    padded = np.pad(audio, (0, WINDOW_SAMPLES - audio.shape[0] % WINDOW_SAMPLES))
    probs = np.asarray(get_vad_model()(padded), dtype=np.float32).reshape(-1)
    voiced = probs >= threshold

    longest = run = 0
    for v in voiced:
        run = run + 1 if v else 0
        longest = max(longest, run)

    return {
        "duration_ms": int(round(audio.shape[0] * 1000 / SAMPLE_RATE)),
        "speech_ms": int(round(voiced.sum() * WINDOW_MS)),
        "max_prob": round(float(probs.max()), 4),
        "mean_prob": round(float(probs.mean()), 4),
        "p95_prob": round(float(np.percentile(probs, 95)), 4),
        "longest_run_ms": int(round(longest * WINDOW_MS)),
    }
