# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Small, bounded diagnostic log buffer for support reports."""
from collections import deque
import logging
import re

_records = deque(maxlen=500)

_SECRET_RE = re.compile(
    r"(?i)(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|"
    r"client[_-]?secret|password|secret|cookie)(['\"]?\s*[:=]\s*['\"]?|\s+)"
    r"[^'\"\s,;}]+(?:\s+[^'\"\s,;}]+)?"
)


def redact(value: str) -> str:
    """Remove common credential-shaped values before diagnostics leave the app."""
    return _SECRET_RE.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", value)


class DiagnosticLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _records.append(redact(self.format(record)))
        except Exception:
            # Diagnostics must never interfere with normal application logging.
            pass


def install_handler() -> None:
    root = logging.getLogger()
    if any(isinstance(handler, DiagnosticLogHandler) for handler in root.handlers):
        return
    handler = DiagnosticLogHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)


def backend_logs() -> list[str]:
    return list(_records)
