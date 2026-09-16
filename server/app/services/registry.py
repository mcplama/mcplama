# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import json
import os
from typing import Optional
from app.core.config import settings


_cache: dict = {}


def _load() -> list:
    """Load the official MCPlama registry, falling back to bundled metadata."""
    url = settings.REGISTRY_URL
    
    if url:
        try:
            import httpx
            resp = httpx.get(url, timeout=10, follow_redirects=True)
            resp.raise_for_status()
            servers = resp.json()
            if isinstance(servers, list):
                for server in servers:
                    server["verified_by_mcplama"] = True
                servers.sort(key=lambda s: s.get("pull_count", 0), reverse=True)
                return servers
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                f"Failed to fetch registry from {url}: {e} — falling back to local"
            )

    return _load_local()


def _load_local() -> list:
    path = getattr(settings, "REGISTRY_LOCAL_PATH", None)
    if not path:
        return []
    servers = []
    servers_dir = os.path.join(path, "servers")
    if not os.path.exists(servers_dir):
        return servers
    for fname in os.listdir(servers_dir):
        if fname.endswith(".json") and not fname.startswith("_"):
            try:
                with open(os.path.join(servers_dir, fname)) as f:
                    servers.append(json.load(f))
            except Exception:
                pass
    servers.sort(key=lambda s: s.get("pull_count", 0), reverse=True)
    return servers


def get_all() -> list:
    if "servers" not in _cache:
        _cache["servers"] = _load()
    return _cache["servers"]


def get_by_id(server_id: str) -> Optional[dict]:
    return next((s for s in get_all() if s["id"] == server_id), None)


def get_categories() -> list:
    cats = list({s.get("category", "other") for s in get_all()})
    return sorted(cats)


def search(query: str = "", category: str = "") -> list:
    results = get_all()
    if category:
        results = [s for s in results if s.get("category") == category]
    if query:
        q = query.lower()
        results = [s for s in results if
                   q in s["name"].lower() or
                   q in s.get("description", "").lower() or
                   q in s.get("id", "").lower()]
    return results


def resolve_gateway_url(text: str) -> str:
    return text.replace("{GATEWAY_URL}", settings.GATEWAY_URL)


def refresh():
    _cache.clear()
    _cache["servers"] = _load()
