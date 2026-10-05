# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import asyncio
import re
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends

from app.api.v1.endpoints.auth import require_admin
from app.core.config import settings
from app.models.user import User

router = APIRouter(prefix="/version", tags=["version"])
_CACHE_SECONDS = 24 * 60 * 60
_cache = {"checked_at": 0.0, "checked_at_iso": None, "latest_version": None, "release_url": None, "published_at": None}
_lock = asyncio.Lock()


def _version_key(value: str):
    # Accept common stable tags such as 1.2.3 and v1.2.3; ignore prereleases.
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", value.strip())
    return tuple(map(int, match.groups())) if match else None


async def _check(force: bool):
    async with _lock:
        now = time.monotonic()
        if not force and _cache["checked_at"] and now - _cache["checked_at"] < _CACHE_SECONDS:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                response = await client.get(
                    "https://api.github.com/repos/mcplama/mcplama/releases/latest",
                    headers={"Accept": "application/vnd.github+json", "User-Agent": "MCPlama-version-check"},
                )
                response.raise_for_status()
                release = response.json()
                latest = release.get("tag_name", "")
                checked_at_iso = datetime.now(timezone.utc).isoformat()
                if _version_key(latest):
                    _cache.update({
                        "checked_at": now,
                        "checked_at_iso": checked_at_iso,
                        "latest_version": latest.lstrip("v"),
                        "release_url": release.get("html_url"),
                        "published_at": release.get("published_at"),
                        "error": None,
                    })
                else:
                    _cache.update({"checked_at": now, "checked_at_iso": checked_at_iso, "error": "Release version is not a stable x.y.z tag."})
        except Exception:
            # Preserve the last known release; set checked_at to avoid hammering GitHub.
            _cache.update({"checked_at": now, "checked_at_iso": datetime.now(timezone.utc).isoformat(), "error": "Could not check GitHub releases."})


@router.get("/check")
async def check_version(force: bool = False, _: User = Depends(require_admin)):
    await _check(force)
    current = settings.VERSION.lstrip("v")
    current_key = _version_key(current)
    latest = _cache["latest_version"]
    latest_key = _version_key(latest) if latest else None
    return {
        "current_version": current,
        "latest_version": latest,
        "update_available": bool(current_key and latest_key and latest_key > current_key),
        "release_url": _cache["release_url"],
        "published_at": _cache["published_at"],
        "checked_at": _cache["checked_at_iso"],
        "error": _cache.get("error"),
    }
