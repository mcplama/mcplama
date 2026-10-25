# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Query, Depends, HTTPException
from typing import Optional
from app.services import registry as reg_svc
from app.core.config import settings
from app.api.v1.endpoints.auth import require_admin
from app.models.user import User

router = APIRouter(prefix="/registry", tags=["registry"])


@router.get("")
async def list_registry(q: Optional[str] = Query(None), category: Optional[str] = Query(None),
                        runtime: Optional[str] = Query(None), auth_type: Optional[str] = Query(None)):
    servers = reg_svc.search(q or "", category or "", runtime or "", auth_type or "")
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


@router.post("/{server_id}/inspect")
async def inspect_registry_entry(server_id: str, _: User = Depends(require_admin)):
    """Read-only initialize/tools/list against a public remote MCP endpoint."""
    import json
    import httpx
    entry = reg_svc.get_by_id(server_id)
    if not entry:
        raise HTTPException(404, "Registry entry not found")
    _resolve_urls(entry)
    if entry.get("runtime") != "remote" or not entry.get("url"):
        raise HTTPException(422, "Live inspection is currently available for remote entries with a URL")

    url = reg_svc.resolve_gateway_url(entry["url"])
    from app.core.ssrf import validate_remote_url
    await validate_remote_url(url)
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

    async def rpc(client, method, request_id=None, session_id=None):
        request_headers = dict(headers)
        if session_id:
            request_headers["Mcp-Session-Id"] = session_id
        body = {"jsonrpc": "2.0", "method": method}
        if request_id is not None:
            body.update(id=request_id, params={"protocolVersion": "2024-11-05", "capabilities": {},
                                               "clientInfo": {"name": "mcplama-registry-inspector", "version": "1.0"}} if method == "initialize" else {})
        response = await client.post(url, json=body, headers=request_headers)
        response.raise_for_status()
        sid = response.headers.get("mcp-session-id") or session_id
        if request_id is None:
            return None, sid
        content = response.text
        if content.startswith("event:") or content.startswith("data:"):
            content = next((line[5:].strip() for line in content.splitlines() if line.startswith("data:")), "")
        return json.loads(content), sid

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=8), follow_redirects=False) as client:
            initialized, session_id = await rpc(client, "initialize", 1)
            if initialized.get("error"):
                raise ValueError(initialized["error"].get("message", "initialize failed"))
            await rpc(client, "notifications/initialized", session_id=session_id)
            discovered, _ = await rpc(client, "tools/list", 2, session_id)
        if discovered.get("error"):
            raise ValueError(discovered["error"].get("message", "tools/list failed"))
        info = (initialized.get("result") or {}).get("serverInfo") or {}
        tools = (discovered.get("result") or {}).get("tools") or []
        return {"ok": True, "server_info": info,
                "version_mismatch": bool(entry.get("version") and info.get("version") and entry["version"] != info["version"]),
                "registry_version": entry.get("version"), "server_version": info.get("version"),
                "tool_count": len(tools), "tools": [{"name": t.get("name", ""), "description": t.get("description", ""),
                  "annotations": t.get("annotations") if isinstance(t.get("annotations"), dict) else None} for t in tools]}
    except Exception as exc:
        raise HTTPException(400, f"Registry inspection failed: {exc}")


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
