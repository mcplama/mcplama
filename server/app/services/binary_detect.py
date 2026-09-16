# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Missing-binary / missing-env-var detection
-------------------------------------------
Two distinct ways an MCP server can be missing something it needs, both
silent to the admin:

1. Missing system binary — an npx/uvx package crashes at startup when it
   shells out to a binary the sandbox image doesn't have (e.g.
   `mcp-server-git` needs `git`). The crash happens before `initialize`
   responds, so it shows up as an HTTP failure or empty tools/list — see
   `detect_missing_package`, which scans crashed-process stdout/stderr.

2. Missing required env var / credential — the process starts fine and
   `initialize`/`tools/list` succeed, but a real `tools/call` returns a
   normal 200 JSON-RPC response with `result.isError: true` because it
   needed e.g. `GITHUB_TOKEN` and never got it. Nothing about that is an
   HTTP or JSON-RPC-level error, so it's invisible to Test Connection's
   probe — see `detect_missing_env_var`, which scans that isError text.
"""
import re
from typing import Optional

# (pattern, apt package to suggest). Checked in order; first match wins.
_KNOWN_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"Bad git executable", re.IGNORECASE), "git"),
    (re.compile(r"GitCommandNotFound", re.IGNORECASE), "git"),
    (re.compile(r"\bgcc\b.{0,20}not found", re.IGNORECASE), "gcc"),
    (re.compile(r"\bmake\b.{0,20}not found", re.IGNORECASE), "make"),
    (re.compile(r"error: Microsoft Visual C\+\+", re.IGNORECASE), "gcc"),
]

# Generic "shell couldn't find this binary" patterns — the suggested package
# is a guess (binary name == package name), which holds for the common case
# (git, gcc, make, curl, jq...) but isn't universal for every apt package.
_GENERIC_PATTERNS: list[re.Pattern] = [
    re.compile(r"/bin/(?:sh|bash):.*?[:\s]([\w][\w.+-]*):\s*(?:command )?not found"),
    re.compile(r"command not found:\s*([\w][\w.+-]*)", re.IGNORECASE),
    re.compile(r"No such file or directory.*?'([\w][\w.+-]*)'"),
]


def detect_missing_package(log_text: str) -> Optional[str]:
    """Best-effort guess at the apt package a crashed server is missing, from
    its combined stdout+stderr. Returns None if nothing recognizable."""
    if not log_text:
        return None
    for pattern, pkg in _KNOWN_PATTERNS:
        if pattern.search(log_text):
            return pkg
    for pattern in _GENERIC_PATTERNS:
        m = pattern.search(log_text)
        if m:
            return m.group(1)
    return None


# A tool's own error text naming the env var it needed, e.g. "GITHUB_TOKEN
# environment variable not set" or "Missing required env var: NOTION_TOKEN".
_ENV_VAR_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b([A-Z][A-Z0-9_]{2,})\b\s+environment variable.*?not set", re.IGNORECASE),
    re.compile(r"\b([A-Z][A-Z0-9_]{2,})\b\s+is not set", re.IGNORECASE),
    re.compile(r"missing (?:required )?env(?:ironment)? var(?:iable)?s?:?\s*\b([A-Z][A-Z0-9_]{2,})\b", re.IGNORECASE),
]


def detect_missing_env_var(text: str) -> Optional[str]:
    """Best-effort guess at a missing required env var name from a tool
    call's `result.isError` text. Returns None if nothing recognizable —
    callers should treat that as "not this failure mode" rather than warn,
    since most isError responses are ordinary tool failures (bad args,
    404s, ...), not missing credentials."""
    if not text:
        return None
    for pattern in _ENV_VAR_PATTERNS:
        m = pattern.search(text)
        if m:
            return m.group(1).upper()
    return None
