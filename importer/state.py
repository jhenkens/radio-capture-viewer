# -*- coding: utf-8 -*-
"""
Persistent state database for tracking uploaded files.

Used when delete_after_upload is False to prevent re-uploading files
that have already been successfully processed.
"""

import sqlite3
import threading
import time


class StateDB:
    def __init__(self, path: str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                filepath        TEXT    PRIMARY KEY,
                transmission_id TEXT    NOT NULL,
                uploaded_at     INTEGER NOT NULL
            )
        """)
        self._conn.commit()

    def is_uploaded(self, filepath: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM uploaded_files WHERE filepath = ?", (filepath,)
            ).fetchone()
            return row is not None

    def mark_uploaded(self, filepath: str, transmission_id: str) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT OR REPLACE INTO uploaded_files
                   (filepath, transmission_id, uploaded_at) VALUES (?, ?, ?)""",
                (filepath, transmission_id, int(time.time() * 1000)),
            )
            self._conn.commit()

    def close(self) -> None:
        self._conn.close()
