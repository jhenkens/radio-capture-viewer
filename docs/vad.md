# VAD gate (voice-activity detection)

Before Whisper runs, each transmission goes through a `vad` task that asks the transcriber's
`POST /v1/audio/vad` for Silero speech metrics (the same model faster-whisper uses internally,
but without a Whisper pass). If we are *confident* there is no speech the transmission is
archived and Whisper is skipped.

Task order: `analyze_file` ‖ `vad` → `whisper`. `vad` is required (a transmission is published only
after it was checked) but fails open: if the transcriber is unreachable through all retries the
transmission passes through unchecked.

## Archiving

`archived` hides a transmission from lists, search, live push and `npm run stats`. The audio and row
are kept. Archiving sets the transcript to `<no voices detected>`; `unarchive` clears it again.

A transmission is archived only when **both** hold (all tunable):

| setting (env)                                | default | meaning |
|----------------------------------------------|---------|---------|
| `vad.minSpeechMs` (`VAD_MIN_SPEECH_MS`)      | 200     | less than this much speech |
| `vad.confidentSilenceProb` (`VAD_CONFIDENT_SILENCE_PROB`) | 0.6 | and no 32 ms window peaked above this |
| `vad.threshold` (`VAD_THRESHOLD`)            | 0.5     | per-window probability that counts as speech |

Anything borderline (short but strong blip, e.g. "copy") is sent on to Whisper.

## Enabling

Set `VAD_ENABLED=true` on the viewer (it reuses `whisper.baseUrl` / `whisper.apiKey`; override with
`VAD_BASE_URL` / `VAD_API_KEY`). The transcriber image must include `vad.py` (rebuild it).
`VAD_ARCHIVE=false` records metrics but never archives.

## Running it over existing transmissions

Metrics (`vad_speech_ms`, `vad_max_prob`, `vad_checked_at`) are stored, so you can tune the rule
without re-running the model. With the CLI (`docker exec radio-capture-viewer rcv-seed ...`):

1. Start the viewer with `VAD_ENABLED=true VAD_ARCHIVE=false`.
2. `backfill-vad-tasks [--limit n] [--force]` — queue a `vad` task for every transmission with audio
   (`--force` re-runs ones already checked).
3. `vad-report` — histogram of results and how many the current rule would archive.
4. `archive-by-vad --dry-run`, then `archive-by-vad` — apply the rule to stored metrics.
5. Restart with `VAD_ARCHIVE=true` for new transmissions.
6. `unarchive --transmission-id <id> | --all` to undo (then `backfill-whisper-tasks` to re-transcribe).

Clients with a page already open keep archived rows until they refresh.
