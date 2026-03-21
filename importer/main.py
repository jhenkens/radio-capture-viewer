#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Radio Capture Importer Daemon

Watches a directory for new audio files produced by rtl-airband and uploads
them to the radio-capture-viewer server.

Supported filename formats:

  With include_freq = true in rtl-airband config (frequency in filename):
    {template}_{YYYYMMDD}_{HHMMSS}_{freq_hz}.{ext}
    e.g.  bv_20260319_182122_462062500.mp3

  Without include_freq (per-directory/per-template channel separation):
    {template}_{YYYYMMDD}_{HHMMSS}.{ext}
    e.g.  bv-ch1_20260319_182122.mp3

The rtl-airband config file(s) are parsed to map (template, freq_hz) → channel
label. Labels are matched against channels registered on the server. New channels
are created automatically when auto_create_channels is enabled.

rtl-airband writes files with a .tmp extension and renames them to the final
name when recording is complete. The importer listens for rename (move) events
so files are always fully written before upload.

If delete_after_upload is false, a state file (SQLite) is required to avoid
re-uploading files on periodic retry scans. It defaults to
{watch_dir}/.importer-state.db when not explicitly set.

Usage:
    python main.py [--config config.yaml]
"""

import argparse
import glob
import logging
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import yaml
from watchdog.events import FileSystemEventHandler, FileMovedEvent, FileCreatedEvent
from watchdog.observers import Observer

from rtl_parser import ChannelEntry, build_lookup, parse_rtl_configs
from state import StateDB
from uploader import Uploader

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Matches: {template}_{YYYYMMDD}_{HHMMSS}_{freq_hz}.{ext}
FILENAME_WITH_FREQ = re.compile(
    r"^(?P<template>.+)_(?P<date>\d{8})_(?P<time>\d{6})_(?P<freq>\d+)\.(?P<ext>mp3|ogg|wav|m4a|aac)$",
    re.IGNORECASE,
)

# Matches: {template}_{YYYYMMDD}_{HHMMSS}.{ext}
FILENAME_NO_FREQ = re.compile(
    r"^(?P<template>.+)_(?P<date>\d{8})_(?P<time>\d{6})\.(?P<ext>mp3|ogg|wav|m4a|aac)$",
    re.IGNORECASE,
)

# Warn if filename timestamp and mtime differ by more than this
MTIME_DRIFT_WARN_S = 300

# ---------------------------------------------------------------------------
# Filename parsing
# ---------------------------------------------------------------------------

def parse_recorded_at(date_str: str, time_str: str) -> int:
    """Parse YYYYMMDD and HHMMSS into Unix milliseconds (UTC)."""
    dt = datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M%S")
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def match_filename(
    filename: str,
    lookup: dict[tuple[str, int | None], ChannelEntry],
) -> tuple[ChannelEntry, int] | None:
    """
    Try to match a filename against the channel lookup built from the rtl config.
    Returns (ChannelEntry, recorded_at_ms) or None if no match.
    """
    m = FILENAME_WITH_FREQ.match(filename)
    if m:
        entry = lookup.get((m.group("template"), int(m.group("freq"))))
        if entry is not None:
            return entry, parse_recorded_at(m.group("date"), m.group("time"))

    m = FILENAME_NO_FREQ.match(filename)
    if m:
        entry = lookup.get((m.group("template"), None))
        if entry is not None:
            return entry, parse_recorded_at(m.group("date"), m.group("time"))

    return None


def is_audio_filename(filename: str) -> bool:
    """Return True if the filename matches either rtl-airband naming pattern."""
    return bool(FILENAME_WITH_FREQ.match(filename) or FILENAME_NO_FREQ.match(filename))


def validate_mtime(filepath: str, recorded_at_ms: int) -> None:
    """Log a warning if the file mtime deviates significantly from the filename timestamp."""
    try:
        drift_s = abs(os.stat(filepath).st_mtime * 1000 - recorded_at_ms) / 1000
        if drift_s > MTIME_DRIFT_WARN_S:
            logger.warning(
                "%s: filename timestamp and mtime differ by %.0fs — using filename timestamp",
                os.path.basename(filepath),
                drift_s,
            )
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Work queue — thread-pool based, deduplicates in-flight entries
# ---------------------------------------------------------------------------

class WorkQueue:
    """
    Thread-safe work queue backed by a ThreadPoolExecutor.

    Files are deduplicated: a filepath already in-flight will not be submitted
    a second time. Each file is processed concurrently.
    """

    def __init__(self, process_fn: "Callable[[str], None]", max_workers: int = 4):  # type: ignore[name-defined]
        self._in_flight: set[str] = set()
        self._lock = threading.Lock()
        self._process_fn = process_fn
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="uploader")

    def start(self) -> None:
        pass  # Executor manages its own threads

    def enqueue(self, filepath: str) -> bool:
        """
        Submit filepath for processing.
        Returns True if submitted, False if already in-flight.
        """
        with self._lock:
            if filepath in self._in_flight:
                return False
            self._in_flight.add(filepath)
        logger.debug("Queued: %s (in-flight: %d)", os.path.basename(filepath), len(self._in_flight))
        self._executor.submit(self._run, filepath)
        return True

    def _run(self, filepath: str) -> None:
        try:
            self._process_fn(filepath)
        except Exception as e:
            logger.error("Unexpected error processing %s: %s", filepath, e, exc_info=True)
        finally:
            with self._lock:
                self._in_flight.discard(filepath)


# ---------------------------------------------------------------------------
# File processor
# ---------------------------------------------------------------------------

class FileProcessor:
    """
    Resolves a filepath to a channel and uploads it. Intended to be called
    from a worker thread via WorkQueue.
    """

    def __init__(
        self,
        config: dict,
        uploader: Uploader,
        lookup: dict[tuple[str, int | None], ChannelEntry],
        label_to_channel_id: dict[str, str],
        state_db: StateDB | None,
    ):
        self.uploader = uploader
        self.lookup = lookup
        self.label_to_channel_id = label_to_channel_id
        self.state_db = state_db
        self.auto_create = config.get("auto_create_channels", False)
        self.delete_after = config.get("delete_after_upload", False)
        self.use_presign = config.get("use_presign", False)

    def __call__(self, filepath: str) -> None:
        # Skip if already recorded in the state DB
        if self.state_db and self.state_db.is_uploaded(filepath):
            logger.debug("Already uploaded, skipping: %s", os.path.basename(filepath))
            return

        filename = os.path.basename(filepath)
        result = match_filename(filename, self.lookup)
        if result is None:
            logger.debug("No rtl config match for: %s", filename)
            return

        entry, recorded_at = result

        if not os.path.exists(filepath):
            logger.debug("File disappeared before upload: %s", filename)
            return

        validate_mtime(filepath, recorded_at)

        channel_id = self._resolve_channel(entry.label)
        if channel_id is None:
            logger.warning("No channel for label '%s' — skipping %s", entry.label, filename)
            return

        if self.use_presign:
            transmission_id = self.uploader.upload_file(
                filepath, channel_id, recorded_at=recorded_at, frequency_hz=entry.freq_hz
            )
        else:
            transmission_id = self.uploader.upload_direct(
                filepath, channel_id, recorded_at=recorded_at, frequency_hz=entry.freq_hz
            )

        if transmission_id:
            if self.state_db:
                self.state_db.mark_uploaded(filepath, transmission_id)
            if self.delete_after:
                try:
                    os.unlink(filepath)
                    logger.info("Deleted local file: %s", filename)
                except OSError as e:
                    logger.warning("Failed to delete %s: %s", filename, e)

    def _resolve_channel(self, label: str) -> str | None:
        """Return channel_id for label, creating the channel if auto_create is on."""
        if label in self.label_to_channel_id:
            return self.label_to_channel_id[label]

        if not self.auto_create:
            return None

        channel_id = self.uploader.create_channel(label)
        if channel_id:
            self.label_to_channel_id[label] = channel_id
            logger.info("Auto-created channel '%s' → %s", label, channel_id)
        return channel_id


# ---------------------------------------------------------------------------
# File watcher
# ---------------------------------------------------------------------------

class AudioFileHandler(FileSystemEventHandler):
    """
    Listens for move and create events.
    rtl-airband renames .tmp → final file (on_moved), but on_created
    is also handled for writers that create files directly.
    """

    def __init__(self, work_queue: WorkQueue):
        self.work_queue = work_queue

    def on_moved(self, event: FileMovedEvent) -> None:  # type: ignore[override]
        if not event.is_directory and is_audio_filename(os.path.basename(event.dest_path)):
            self.work_queue.enqueue(event.dest_path)

    def on_created(self, event: FileCreatedEvent) -> None:  # type: ignore[override]
        if not event.is_directory and is_audio_filename(os.path.basename(event.src_path)):
            self.work_queue.enqueue(event.src_path)


# ---------------------------------------------------------------------------
# Directory scans
# ---------------------------------------------------------------------------

AUDIO_EXTENSIONS = ("*.mp3", "*.ogg", "*.wav", "*.m4a", "*.aac")


def startup_scan(watch_dir: str, work_queue: WorkQueue, state_db: StateDB | None) -> None:
    """
    Enqueue all audio files found in watch_dir that haven't been uploaded yet.
    Runs once at startup to catch files created while the importer was offline.
    """
    count = 0
    for ext in AUDIO_EXTENSIONS:
        for filepath in glob.glob(os.path.join(watch_dir, "**", ext), recursive=True):
            if state_db and state_db.is_uploaded(filepath):
                continue
            if work_queue.enqueue(filepath):
                count += 1
    if count:
        logger.info("Startup scan: queued %d file(s)", count)


def retry_scan(
    watch_dir: str,
    max_age_hours: int,
    work_queue: WorkQueue,
    state_db: StateDB | None,
) -> None:
    """
    Enqueue audio files older than max_age_hours that haven't been uploaded.
    Called periodically to retry failed uploads.
    """
    cutoff = time.time() - max_age_hours * 3600
    count = 0
    for ext in AUDIO_EXTENSIONS:
        for filepath in glob.glob(os.path.join(watch_dir, "**", ext), recursive=True):
            try:
                if os.stat(filepath).st_mtime >= cutoff:
                    continue
            except OSError:
                continue
            if state_db and state_db.is_uploaded(filepath):
                continue
            if work_queue.enqueue(filepath):
                count += 1
    if count:
        logger.info("Retry scan: queued %d file(s)", count)


# ---------------------------------------------------------------------------
# Station bootstrap
# ---------------------------------------------------------------------------

def fetch_station(uploader: Uploader, retries: int = 5, delay: float = 5.0) -> dict:
    """Fetch station info with retries. Exits on permanent failure."""
    for attempt in range(1, retries + 1):
        result = uploader.get_station()
        if result is not None:
            return result
        if attempt < retries:
            logger.warning(
                "Station fetch failed (attempt %d/%d), retrying in %.0fs…",
                attempt, retries, delay,
            )
            time.sleep(delay)
    logger.error(
        "Could not fetch station info after %d attempts — check server_url and api_key",
        retries,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Radio Capture Importer")
    parser.add_argument("--config", default="config.yaml", help="Path to config file")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        logger.error("Config file not found: %s", config_path)
        sys.exit(1)

    with open(config_path) as f:
        config = yaml.safe_load(f)

    log_level = config.get("log_level", "INFO").upper()
    logging.getLogger().setLevel(getattr(logging, log_level, logging.INFO))

    server_url = config.get("server_url", "http://localhost:3000")
    api_key = config.get("api_key", "")
    watch_dir = config.get("watch_dir", "./recordings")
    retry_interval_s = config.get("retry_interval_minutes", 5) * 60
    max_age_hours = config.get("max_age_hours", 24)
    delete_after = config.get("delete_after_upload", False)

    if not api_key:
        logger.error("api_key is required in config")
        sys.exit(1)

    # Validate / set up state DB
    state_db: StateDB | None = None
    if not delete_after:
        state_file = config.get("state_file") or os.path.join(watch_dir, ".importer-state.db")
        os.makedirs(os.path.dirname(os.path.abspath(state_file)), exist_ok=True)
        state_db = StateDB(state_file)
        logger.info("State DB: %s", state_file)

    # Collect rtl-airband config paths
    rtl_paths: list[str] = []
    if "rtl_config" in config:
        rtl_paths.append(config["rtl_config"])
    rtl_paths.extend(config.get("rtl_configs", []))

    if not rtl_paths:
        logger.error("No rtl_config or rtl_configs specified in config")
        sys.exit(1)

    for p in rtl_paths:
        if not os.path.exists(p):
            logger.error("rtl config not found: %s", p)
            sys.exit(1)

    # Parse rtl config(s) → filename lookup
    channel_entries = parse_rtl_configs(rtl_paths)
    if not channel_entries:
        logger.error("No channel entries found in rtl config(s): %s", rtl_paths)
        sys.exit(1)

    lookup = build_lookup(channel_entries)
    logger.info("Loaded %d channel entries from rtl config(s)", len(lookup))
    for (template, freq), entry in lookup.items():
        logger.info("  %-20s  freq=%-12s  → %s", template, freq or "any", entry.label)

    os.makedirs(watch_dir, exist_ok=True)

    uploader = Uploader(server_url, api_key)

    # Fetch system info and build label → channel_id map
    station = fetch_station(uploader)
    system_name = station["system"]["name"]
    label_to_channel_id: dict[str, str] = {
        ch["name"]: ch["id"] for ch in station.get("channels", [])
    }
    logger.info(
        "Connected to system '%s' with %d channel(s)",
        system_name, len(label_to_channel_id),
    )

    # Wire up the work queue and processor
    max_workers = config.get("upload_workers", 4)
    processor = FileProcessor(config, uploader, lookup, label_to_channel_id, state_db)
    work_queue = WorkQueue(processor, max_workers=max_workers)
    work_queue.start()

    # Startup scan — pick up files that arrived while we were offline
    startup_scan(watch_dir, work_queue, state_db)

    # File watcher
    observer = Observer()
    observer.schedule(AudioFileHandler(work_queue), watch_dir, recursive=True)
    observer.start()
    logger.info("Watching %s for new audio files", watch_dir)

    last_retry = time.time()  # don't double-scan immediately after startup
    try:
        while True:
            time.sleep(10)
            if time.time() - last_retry >= retry_interval_s:
                retry_scan(watch_dir, max_age_hours, work_queue, state_db)
                last_retry = time.time()
    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        observer.stop()
        observer.join()
        if state_db:
            state_db.close()


if __name__ == "__main__":
    main()
