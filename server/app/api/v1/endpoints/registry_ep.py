# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Query
from typing import Optional
from app.services import registry as reg_svc
from app.core.config import settings

router = APIRouter(prefix="/registry", tags=["registry"])


@router.get("")
async def list_registry(q: Optional[str] = Query(None), category: Optional[str] = Query(None)):
    servers = reg_svc.search(q or "", category or "")
    for s in servers:
        _resolve_urls(s)
    return servers


@router.get("/categories")
async def get_categories():
    return reg_svc.get_categories()


@router.get("/{server_id}")
async def get_registry_entry(server_id: str):
    entry = reg_svc.get_by_id(server_id)
    if not entry:
        from fastapi import HTTPException
        raise HTTPException(404, "Registry entry not found")
    _resolve_urls(entry)
    return entry


@router.post("/refresh")
async def refresh_registry():
    reg_svc.refresh()
    return {"ok": True, "count": len(reg_svc.get_all())}


def _resolve_urls(entry: dict):
    auth = entry.get("auth", {})
    steps = auth.get("setup_steps", [])
    for step in steps:
        if "description" in step:
            step["description"] = step["description"].replace("{GATEWAY_URL}", settings.GATEWAY_URL)
