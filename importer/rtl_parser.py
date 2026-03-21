# -*- coding: utf-8 -*-
"""
Parse rtl-airband libconfig files to extract channel→filename-template mappings.

Supports the subset of libconfig used by rtl-airband:
  channels: ( { freq = <hz>; labels = ("label"); outputs: ({ type = "file";
    filename_template = "tpl"; include_freq = true; }); }, ... );
"""

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ChannelEntry:
    freq_hz: int
    label: str          # first entry from labels = (...)
    template: str       # filename_template from the file output
    include_freq: bool  # whether freq is appended to filename


def parse_rtl_configs(paths: list[str]) -> list[ChannelEntry]:
    """Parse one or more rtl-airband config files and return all channel entries."""
    entries: list[ChannelEntry] = []
    for path in paths:
        entries.extend(_parse_file(path))
    return entries


def _parse_file(path: str) -> list[ChannelEntry]:
    text = Path(path).read_text(encoding="utf-8")
    # Strip single-line comments
    text = re.sub(r"#[^\n]*", "", text)

    entries: list[ChannelEntry] = []
    # Find all channels: (...) sections (may appear in multiple device blocks)
    for section in re.finditer(r"\bchannels\s*:\s*\(", text):
        body = _extract_paren_body(text, section.end() - 1)
        if body is None:
            continue
        for block in _extract_brace_blocks(body):
            entry = _parse_channel_block(block)
            if entry is not None:
                entries.append(entry)

    return entries


def _extract_paren_body(text: str, open_pos: int) -> str | None:
    """
    Given the index of an opening '(' in text, return the content inside
    the matching closing ')'.
    """
    assert text[open_pos] == "("
    depth = 0
    for i in range(open_pos, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_pos + 1 : i]
    return None


def _extract_brace_blocks(text: str) -> list[str]:
    """Return the contents of every top-level { ... } block in text."""
    blocks: list[str] = []
    depth = 0
    start: int | None = None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                blocks.append(text[start + 1 : i])
                start = None
    return blocks


def _parse_channel_block(block: str) -> ChannelEntry | None:
    """Parse a single channel { ... } block and return a ChannelEntry if it has a file output."""
    freq_m = re.search(r"\bfreq\s*=\s*(\d+)\s*;", block)
    if not freq_m:
        return None
    freq_hz = int(freq_m.group(1))

    label_m = re.search(r'\blabels\s*=\s*\(\s*"([^"]+)"', block)
    if not label_m:
        return None
    label = label_m.group(1)

    # Find the outputs: (...) section
    outputs_m = re.search(r"\boutputs\s*:\s*\(", block)
    if not outputs_m:
        return None
    outputs_body = _extract_paren_body(block, outputs_m.end() - 1)
    if outputs_body is None:
        return None

    # Look for a file-type output block
    for ob in _extract_brace_blocks(outputs_body):
        type_m = re.search(r'\btype\s*=\s*"([^"]+)"', ob)
        if not type_m or type_m.group(1) != "file":
            continue

        tmpl_m = re.search(r'\bfilename_template\s*=\s*"([^"]+)"', ob)
        if not tmpl_m:
            continue

        freq_flag_m = re.search(r"\binclude_freq\s*=\s*(true|false)\s*;", ob)
        include_freq = bool(freq_flag_m and freq_flag_m.group(1) == "true")

        return ChannelEntry(
            freq_hz=freq_hz,
            label=label,
            template=tmpl_m.group(1),
            include_freq=include_freq,
        )

    return None


def build_lookup(entries: list[ChannelEntry]) -> dict[tuple[str, int | None], ChannelEntry]:
    """
    Build a lookup dict keyed by (template, freq_hz) for include_freq=True entries,
    or (template, None) for include_freq=False entries.
    """
    lookup: dict[tuple[str, int | None], ChannelEntry] = {}
    for entry in entries:
        key: tuple[str, int | None] = (
            (entry.template, entry.freq_hz) if entry.include_freq else (entry.template, None)
        )
        if key in lookup:
            existing = lookup[key]
            if existing.label != entry.label:
                import logging
                logging.getLogger(__name__).warning(
                    "Duplicate key %r: labels '%s' and '%s' — keeping first",
                    key, existing.label, entry.label,
                )
        else:
            lookup[key] = entry
    return lookup
