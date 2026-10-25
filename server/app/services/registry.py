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
            payload = resp.json()
            servers = payload.get("servers") if isinstance(payload, dict) and payload.get("version") == 2 else payload
            if isinstance(servers, list):
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
    if not os.path.isdir(path):
        path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../registry"))
    v2_path = os.path.join(path, "v2.json")
    if os.path.isfile(v2_path):
        try:
            with open(v2_path) as f:
                payload = json.load(f)
            if isinstance(payload, dict) and payload.get("version") == 2 and isinstance(payload.get("servers"), list):
                return payload["servers"]
        except Exception:
            pass
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


def search(query: str = "", category: str = "", runtime: str = "", auth_type: str = "") -> list:
    results = get_all()
    if category:
        results = [s for s in results if s.get("category") == category]
    if runtime:
        results = [s for s in results if s.get("runtime") == runtime]
    if auth_type:
        results = [s for s in results if (s.get("auth_type") or "none") == auth_type]
    if query:
        q = query.lower()
        fields = ("name", "description", "id", "publisher", "category", "runtime",
                  "transport", "auth_type", "docs_url", "requirements")
        results = [s for s in results if any(q in str(s.get(key) or "").lower() for key in fields)]
    return results


def resolve_gateway_url(text: str) -> str:
    return text.replace("{GATEWAY_URL}", settings.GATEWAY_URL)


def refresh():
    _cache.clear()
    _cache["servers"] = _load()
