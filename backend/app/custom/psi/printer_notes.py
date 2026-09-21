"""Who sliced a file: the ``User=`` convention in the slicer's printer notes.

The PSI team types two lines into the slicer's printer-notes box::

    User=alice
    alice@example.com

A line starting ``User=`` names the user; a bare token with an ``@`` and no
whitespace is their address. It is not a standard 3MF field, so it is a lossy
human channel: people forget it, share profiles, or slice on a colleague's
machine. The missing state and the repair flow exist for that reason.

This module is deliberately independent of upstream's ``ThreeMFParser``. It
reads the one value it needs straight out of the file, so it can be applied to
any stored archive or library file at any time. That is what lets PSI resolve
users lazily instead of hooking every upstream ingestion path, and what lets it
catch up on files ingested while the PSI layer was not deployed.
"""

import json
import re
import zipfile
from pathlib import Path

_PROJECT_SETTINGS = "Metadata/project_settings.config"
_GCODE_NOTES = re.compile(rb"^;\s*printer_notes\s*=\s*(.*)$", re.MULTILINE)
# Slicers put the config block at the end of the G-code, some also at the top.
_GCODE_SCAN_BYTES = 256 * 1024


def parse_printer_notes(notes: str) -> tuple[str | None, str | None]:
    """Return ``(user, email)`` found in a printer-notes blob.

    Lines matching neither shape are ignored: the box also holds real printer
    notes. The last match wins for each field, because a box edited over time
    tends to keep the stale value above the current one.
    """
    user: str | None = None
    email: str | None = None
    for raw_line in notes.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.lower().startswith("user="):
            value = line.split("=", 1)[1].strip()
            if value:
                user = value[:100]
        elif _looks_like_email(line):
            email = line[:255]
    return user, email


def split_user_input(value: str) -> tuple[str | None, str | None]:
    """Route a typed value to ``(user, email)``, the same way the parser would.

    A single token with ``@`` and no whitespace is an address, anything else a
    name. Exactly one side is set; the other is ``None`` so saving clears it.
    """
    value = value.strip()
    if not value:
        raise ValueError("user must not be empty")
    if _looks_like_email(value):
        return None, value[:255]
    return value[:100], None


def read_printer_notes(path: Path) -> str | None:
    """Read the raw printer-notes text from a 3MF or G-code file, if present."""
    try:
        if zipfile.is_zipfile(path):
            return _notes_from_3mf(path)
        if path.suffix.lower() == ".gcode":
            return _notes_from_gcode_bytes(_read_ends(path))
    except (OSError, ValueError, zipfile.BadZipFile, json.JSONDecodeError):
        return None
    return None


def read_user(path: Path) -> tuple[str | None, str | None]:
    """``(user, email)`` for a stored file; ``(None, None)`` when unreadable."""
    notes = read_printer_notes(path)
    return parse_printer_notes(notes) if notes else (None, None)


def fingerprint(file_path: str | None, file_size: int | None) -> str:
    """Identify the file a user was read from, to know when to read it again.

    Upstream can replace an archive's file later (a fallback archive whose 3MF
    arrives after the print, #2957); a changed path or size means re-read.
    """
    if not file_path:
        return NO_FILE
    return f"{file_path}|{file_size or 0}"[:600]


#: ``psi_user_checked`` value for a user typed by a human. Never overwritten by
#: a re-read of the file.
MANUAL = "manual"
#: ``psi_user_checked`` value for a record without a file to read.
NO_FILE = "nofile"


def _looks_like_email(token: str) -> bool:
    return "@" in token and not any(ch.isspace() for ch in token)


def _notes_from_3mf(path: Path) -> str | None:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if _PROJECT_SETTINGS in names:
            data = json.loads(zf.read(_PROJECT_SETTINGS))
            notes = data.get("printer_notes") if isinstance(data, dict) else None
            if isinstance(notes, list):
                notes = "\n".join(str(line) for line in notes if line is not None)
            return notes if isinstance(notes, str) else None
        for name in names:
            if name.lower().endswith(".gcode"):
                with zf.open(name) as fh:
                    head = fh.read(_GCODE_SCAN_BYTES)
                return _notes_from_gcode_bytes(head)
    return None


def _read_ends(path: Path) -> bytes:
    size = path.stat().st_size
    with path.open("rb") as fh:
        head = fh.read(_GCODE_SCAN_BYTES)
        if size <= _GCODE_SCAN_BYTES:
            return head
        fh.seek(max(size - _GCODE_SCAN_BYTES, _GCODE_SCAN_BYTES))
        return head + b"\n" + fh.read()


def _notes_from_gcode_bytes(data: bytes) -> str | None:
    matches = _GCODE_NOTES.findall(data)
    if not matches:
        return None
    # G-code config lines escape newlines as a literal backslash-n.
    return matches[-1].decode("utf-8", "replace").strip().replace("\\n", "\n")
