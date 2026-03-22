# -*- coding: utf-8 -*-
"""Handles all HTTP calls to the radio-capture-viewer admin API."""

import os
import logging
import requests

logger = logging.getLogger(__name__)


class Uploader:
    def __init__(self, server_url: str, api_key: str):
        self.server_url = server_url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({"x-api-key": api_key})

    # ------------------------------------------------------------------
    # Station / channel helpers
    # ------------------------------------------------------------------

    def get_station(self) -> dict | None:
        """
        Fetch system info and channel list for the authenticated API key.
        Returns the parsed JSON dict or None on failure.
        """
        try:
            resp = self.session.get(
                f"{self.server_url}/api/admin/station",
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            logger.error("Failed to fetch station info: %s", e)
            return None

    def create_channel(self, name: str, description: str | None = None) -> str | None:
        """
        Find or create a channel by name under the authenticated system.
        Returns the channel_id on success, None on failure.
        """
        payload: dict = {"name": name}
        if description:
            payload["description"] = description

        try:
            resp = self.session.post(
                f"{self.server_url}/api/admin/channels",
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json()["id"]
        except requests.RequestException as e:
            logger.error("Failed to create channel '%s': %s", name, e)
            return None

    # ------------------------------------------------------------------
    # Upload flows
    # ------------------------------------------------------------------

    def upload_file(
        self,
        filepath: str,
        channel_id: str,
        recorded_at: int | None = None,
        duration_ms: int | None = None,
        frequency_hz: int | None = None,
        transcript: str | None = None,
    ) -> str | None:
        """
        Upload using the presigned URL flow (S3/R2).
        Returns transmission_id on success, None on failure.
        """
        filename = os.path.basename(filepath)
        content_type = self._get_content_type(filename)

        # Step 1: Initiate
        payload: dict = {
            "channel_id": channel_id,
            "filename": filename,
            "content_type": content_type,
        }
        if recorded_at is not None:
            payload["recorded_at"] = recorded_at
        if duration_ms is not None:
            payload["duration_ms"] = duration_ms
        if frequency_hz is not None:
            payload["frequency_hz"] = frequency_hz

        resp = None
        try:
            resp = self.session.post(
                f"{self.server_url}/api/admin/upload/initiate",
                json=payload,
                timeout=30,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            if resp is not None:
                logger.debug("Initiate response body: %r", resp.text[:500])
            logger.error("Failed to initiate upload for %s: %s", filepath, e)
            return None

        try:
            data = resp.json()
            upload_session_id = data["upload_session_id"]
            upload_url = data["upload_url"]
            transmission_id = data["transmission_id"]
        except Exception as e:
            logger.debug("Initiate response body: %r", resp.text[:500])
            logger.error("Unexpected initiate response for %s (%s): %r", filepath, e, resp.text[:200])
            return None

        # Step 2: PUT to presigned URL
        try:
            with open(filepath, "rb") as f:
                put_resp = requests.put(
                    upload_url,
                    data=f,
                    headers={"Content-Type": content_type},
                    timeout=300,
                )
                put_resp.raise_for_status()
        except (requests.RequestException, OSError) as e:
            logger.error("Failed to upload to presigned URL for %s: %s", filepath, e)
            return None

        # Step 3: Complete
        try:
            complete_payload: dict = {"upload_session_id": upload_session_id}
            if transcript:
                complete_payload["transcript"] = transcript
            complete_resp = self.session.post(
                f"{self.server_url}/api/admin/upload/complete",
                json=complete_payload,
                timeout=60,
            )
            complete_resp.raise_for_status()
        except requests.RequestException as e:
            logger.error("Failed to complete upload for %s: %s", filepath, e)
            return None

        logger.info("Uploaded %s → transmission %s", filepath, transmission_id)
        return transmission_id

    def upload_direct(
        self,
        filepath: str,
        channel_id: str,
        recorded_at: int | None = None,
        duration_ms: int | None = None,
        frequency_hz: int | None = None,
        transcript: str | None = None,
    ) -> str | None:
        """
        Upload directly as multipart form data (local storage or fallback).
        Returns transmission_id on success, None on failure.
        """
        filename = os.path.basename(filepath)
        content_type = self._get_content_type(filename)

        resp = None
        try:
            with open(filepath, "rb") as f:
                form_data: dict = {
                    "channel_id": channel_id,
                    "content_type": content_type,
                }
                if recorded_at is not None:
                    form_data["recorded_at"] = str(recorded_at)
                if duration_ms is not None:
                    form_data["duration_ms"] = str(duration_ms)
                if frequency_hz is not None:
                    form_data["frequency_hz"] = str(frequency_hz)
                if transcript:
                    form_data["transcript"] = transcript

                resp = self.session.post(
                    f"{self.server_url}/api/admin/upload/direct",
                    files={"file": (filename, f, content_type)},
                    data=form_data,
                    timeout=300,
                )
                resp.raise_for_status()
        except (requests.RequestException, OSError) as e:
            if resp is not None:
                logger.debug("Upload response body: %r", resp.text[:500])
            logger.error("Failed to upload (direct) %s: %s", filepath, e)
            return None

        try:
            transmission_id = resp.json()["transmission_id"]
        except Exception as e:
            logger.debug("Upload response body: %r", resp.text[:500])
            logger.error("Unexpected upload response for %s (%s): %r", filepath, e, resp.text[:200])
            return None

        logger.info("Uploaded (direct) %s -> transmission %s", filepath, transmission_id)
        return transmission_id

    @staticmethod
    def _get_content_type(filename: str) -> str:
        ext = os.path.splitext(filename)[1].lower()
        return {
            ".mp3": "audio/mpeg",
            ".ogg": "audio/ogg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".aac": "audio/aac",
        }.get(ext, "application/octet-stream")
