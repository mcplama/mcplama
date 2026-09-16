# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import secrets
import httpx
from datetime import datetime, timedelta
from typing import Optional
from app.services import registry

_states: dict[str, dict] = {}


def build_authorize_url(server_entry: dict, client_id: str, redirect_uri: str, state: str) -> str:
    from urllib.parse import urlencode
    auth = server_entry.get("auth", {})
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
    }
    scopes = auth.get("scopes", [])
    if scopes:
        params["scope"] = " ".join(scopes)
    extra = auth.get("extra_params", {})
    params.update(extra)
    return auth["authorization_url"] + "?" + urlencode(params)


def create_state(server_id: int, user_id: int, registry_id: str) -> str:
    state = secrets.token_urlsafe(32)
    _states[state] = {
        "server_id": server_id,
        "user_id": user_id,
        "registry_id": registry_id,
        "expires": datetime.utcnow() + timedelta(minutes=10),
    }
    return state


def consume_state(state: str) -> Optional[dict]:
    data = _states.pop(state, None)
    if not data:
        return None
    if datetime.utcnow() > data["expires"]:
        return None
    return data


async def exchange_code(
    server_entry: dict,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    auth = server_entry.get("auth", {})
    token_url = auth["token_url"]
    method = auth.get("token_method", "body")

    async with httpx.AsyncClient(timeout=15) as client:
        if method == "basic_auth":
            resp = await client.post(
                token_url,
                data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
                auth=(client_id, client_secret),
                headers={"Accept": "application/json"},
            )
        else:
            resp = await client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
        resp.raise_for_status()
        return resp.json()


def parse_token_response(data: dict) -> dict:
    access_token = (
        data.get("access_token") or
        data.get("authed_user", {}).get("access_token")
    )
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "scope": data.get("scope"),
    }
