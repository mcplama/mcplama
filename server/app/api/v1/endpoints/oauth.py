# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
backend/app/api/v1/endpoints/oauth.py

Upstream OAuth 2.0 flow — Notion, GitHub, Google, Stripe, etc.
Universal provider compatibility via configurable token auth method.
"""
import base64
import hashlib
import httpx
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete

from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.oauth_state import OAuthState
from app.models.server import Server
from app.models.user import User
from app.api.v1.endpoints.auth import get_current_user
from app.core.security import decode_token
from app.core.config import settings
from app.services import token_store
from app.services.mcp_client_oauth import (
    discover_oauth_for_mcp, get_or_register_client,
    pkce_verifier as mcp_pkce_verifier, pkce_challenge as mcp_pkce_challenge,
    save_upstream_token, get_upstream_token,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/oauth", tags=["oauth"])


# ── Auth helper ───────────────────────────────────────────────────────────────

async def _resolve_user(request: Request, db: AsyncSession) -> Optional[User]:
    """
    Resolve user from (in order):
      1. ?token=JWT  — browser navigation from McpAuthorize
      2. Authorization: Bearer header
      3. access_token cookie
    """
    raw = request.headers.get("Authorization", "")
    token = (
        request.query_params.get("token")
        or (raw[7:] if raw.startswith("Bearer ") else None)
        or request.cookies.get("access_token")
    )
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    uid = payload.get("sub")
    if not uid:
        return None
    user = await db.get(User, int(uid))
    return user if user and user.is_active else None


# ── PKCE helpers ──────────────────────────────────────────────────────────────

def _pkce_verifier() -> str:
    return secrets.token_urlsafe(64)

def _pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()


# ── Universal token request builder ──────────────────────────────────────────

def _build_token_request(
    grant_type: str,
    client_id: str,
    client_secret: Optional[str],
    token_auth_method: str,   # 'basic' | 'body' | 'none'
    extra: dict,
) -> tuple[dict, dict]:
    """
    Returns (form_data, headers) for a token endpoint request.

    token_auth_method:
      'basic' — HTTP Basic auth header (Notion, Stripe, Asana, Dropbox, Spotify)
      'body'  — client_id + client_secret as form fields (GitHub, GitLab, Linear,
                Google, Microsoft, Slack, HubSpot, Salesforce, Atlassian)
      'none'  — no credentials sent; PKCE-only / public clients
    """
    data = {"grant_type": grant_type, **extra}
    headers = {"Accept": "application/json"}

    if token_auth_method == "basic" and client_id and client_secret:
        creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"

    elif token_auth_method == "body":
        data["client_id"] = client_id
        if client_secret:
            data["client_secret"] = client_secret

    else:  # 'none' or fallback — public client, PKCE only
        data["client_id"] = client_id

    return data, headers


# ── Resolve OAuth config from server ─────────────────────────────────────────

async def _resolve_oauth_config(server: Server, db: AsyncSession):
    """
    Returns (auth_url, token_url, client_id, client_secret, scopes,
             use_pkce, token_auth_method).

    Tries server model fields first, then legacy auth_config dict.
    """
    from app.core.encryption import decrypt_dict, decrypt

    if getattr(server, "oauth_auth_url", None) and getattr(server, "oauth_client_id", None):
        # Strip any query params accidentally saved into oauth_auth_url
        p = urlparse(server.oauth_auth_url)
        clean_auth_url = urlunparse((p.scheme, p.netloc, p.path, "", "", ""))
        raw_secret = getattr(server, "oauth_client_secret", None)
        return (
            clean_auth_url,
            server.oauth_token_url,
            server.oauth_client_id,
            decrypt(raw_secret, f"server:{server.id}:oauth_client_secret") if raw_secret else None,
            getattr(server, "oauth_scopes", None),
            getattr(server, "oauth_pkce", False),
            getattr(server, "oauth_token_auth", "basic"),  # default basic for safety
        )

    # Legacy: credentials stored in encrypted auth_config dict + registry for URLs
    cfg = decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config")
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")

    if server.registry_id:
        try:
            from app.services import registry as reg_svc
            entry = reg_svc.get_by_id(server.registry_id)
            if entry and client_id:
                auth_url = getattr(entry, "oauth_auth_url", None) or entry.get("auth_url", "")
                token_url = getattr(entry, "oauth_token_url", None) or entry.get("token_url", "")
                p = urlparse(auth_url)
                clean_auth_url = urlunparse((p.scheme, p.netloc, p.path, "", "", ""))
                return (
                    clean_auth_url,
                    token_url,
                    client_id,
                    client_secret,
                    getattr(entry, "oauth_scopes", None) or entry.get("scopes"),
                    getattr(entry, "oauth_pkce", False),
                    getattr(entry, "oauth_token_auth", "basic"),
                )
        except Exception as e:
            logger.warning(f"Registry lookup failed for server {server.id}: {e}")

    if not client_id:
        raise HTTPException(
            400,
            "OAuth not configured — set Client ID and Auth URL in server settings."
        )
    raise HTTPException(400, "OAuth URLs not configured for this server.")


# ── Effective URLs ────────────────────────────────────────────────────────────

async def _callback_uri(db: AsyncSession) -> str:
    try:
        from app.api.v1.endpoints.gateway_config_endpoint import get_effective_gateway_url
        gw = await get_effective_gateway_url(db)
    except Exception:
        gw = settings.GATEWAY_URL
    return f"{gw}/api/v1/oauth/callback"

async def _frontend_url(db: AsyncSession) -> str:
    try:
        from app.models.gateway_config import GatewayConfig
        result = await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))
        cfg = result.scalar_one_or_none()
        if cfg and cfg.app_url:
            return cfg.app_url
    except Exception:
        pass
    return getattr(settings, "FRONTEND_URL", "http://localhost:5173")


# ── Step 1: Start OAuth ───────────────────────────────────────────────────────

@router.get("/{server_id}/authorize")
async def start_oauth(
    server_id: int,
    request: Request,
    resume_pending: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    current_user = await _resolve_user(request, db)
    if not current_user:
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
        return RedirectResponse(f"{frontend_url}/login?next={request.url}", status_code=302)

    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")
    if server.remote_auth != "oauth":
        raise HTTPException(400, "This server does not use OAuth")

    auth_url, token_url, client_id, client_secret, scopes, use_pkce, token_auth_method = \
        await _resolve_oauth_config(server, db)

    cb_uri = await _callback_uri(db)
    state = secrets.token_urlsafe(32)
    code_verifier = _pkce_verifier() if use_pkce else None
    code_challenge = _pkce_challenge(code_verifier) if code_verifier else None

    # Clean up old states for this user+server
    await db.execute(
        delete(OAuthState).where(
            and_(OAuthState.user_id == current_user.id, OAuthState.server_id == server_id)
        )
    )

    db.add(OAuthState(
        server_id=server_id,
        user_id=current_user.id,
        state=state,
        code_verifier=code_verifier,
        redirect_uri=cb_uri,           # clean — providers validate this exactly
        resume_pending=resume_pending, # stored separately, never in redirect_uri
    ))
    await db.commit()

    params = {
        "client_id": client_id,
        "redirect_uri": cb_uri,
        "response_type": "code",
        "state": state,
    }
    if scopes:
        params["scope"] = scopes
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"

    full_url = auth_url + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(full_url)


# ── Step 2: Callback ──────────────────────────────────────────────────────────

@router.get("/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    frontend_url = await _frontend_url(db)

    if error:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error={error_description or error}")

    result = await db.execute(select(OAuthState).where(OAuthState.state == state))
    oauth_state = result.scalar_one_or_none()
    if not oauth_state:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=Invalid+or+expired+state")

    if (datetime.utcnow() - oauth_state.created_at).total_seconds() > 600:
        await db.delete(oauth_state)
        await db.commit()
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=OAuth+state+expired")

    server = await db.get(Server, oauth_state.server_id)
    if not server:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=Server+not+found")

    try:
        _, token_url, client_id, client_secret, _, _, token_auth_method = \
            await _resolve_oauth_config(server, db)
    except HTTPException as e:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error={e.detail}")

    token_data, token_headers = _build_token_request(
        grant_type="authorization_code",
        client_id=client_id,
        client_secret=client_secret,
        token_auth_method=token_auth_method,
        extra={
            "code": code,
            "redirect_uri": oauth_state.redirect_uri,
            **({"code_verifier": oauth_state.code_verifier} if oauth_state.code_verifier else {}),
        },
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(token_url, data=token_data, headers=token_headers)
        if resp.status_code >= 400:
            logger.error(f"Token exchange failed {resp.status_code}: {resp.text}")
            return RedirectResponse(
                f"{frontend_url}/oauth/callback?oauth_error=Token+exchange+failed+({resp.status_code})"
            )
        token_resp = resp.json()
    except Exception as e:
        logger.error(f"Token exchange error: {e}")
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=Token+exchange+error")

    access_token = token_resp.get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=No+access+token+in+response")

    expires_in = token_resp.get("expires_in")
    expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in)) if expires_in else None
    uid = oauth_state.user_id if str(server.auth_mode).endswith("per_user") else None

    await token_store.save_token(
        db, server.id, uid,
        access_token,
        token_resp.get("refresh_token"),
        expires_at,
        token_resp.get("scope"),
    )
    db.add(AuditLog(
        user_id=oauth_state.user_id, action="oauth.connected",
        resource_type="server", resource_id=str(server.id), status_code=200,
    ))

    resume_pending = oauth_state.resume_pending
    await db.delete(oauth_state)
    await db.commit()

    # If triggered mid-MCP-auth flow, complete it now
    if resume_pending:
        from app.api.v1.endpoints.mcp_auth import _auth_codes
        from urllib.parse import urlencode
        pending_data = _auth_codes.pop(f"pending:{resume_pending}", None)
        if pending_data and datetime.utcnow() < pending_data["expires"]:
            auth_code = secrets.token_urlsafe(32)
            _auth_codes[auth_code] = {
                "connection_token": pending_data["connection_token"],
                "redirect_uri": pending_data["redirect_uri"],
                "code_challenge": pending_data["code_challenge"],
                "code_challenge_method": pending_data["code_challenge_method"],
                "expires": datetime.utcnow() + timedelta(seconds=60),
            }
            params = {"code": auth_code}
            if pending_data.get("state"):
                params["state"] = pending_data["state"]
            return RedirectResponse(f"{pending_data['redirect_uri']}?{urlencode(params)}")
        else:
            return RedirectResponse(
                f"{frontend_url}/oauth/callback?oauth_success=1&server_id={server.id}&mcp_expired=1"
            )

    return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_success=1&server_id={server.id}")


# ── Token status ──────────────────────────────────────────────────────────────

@router.get("/{server_id}/token-status")
async def token_status(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    token = await get_valid_oauth_token(server_id, current_user.id, db)
    return {"has_token": token is not None, "server_id": server_id}


# ── Disconnect ────────────────────────────────────────────────────────────────

@router.post("/{server_id}/disconnect")
@router.delete("/{server_id}/token")
async def disconnect(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")
    uid = user.id if str(server.auth_mode).endswith("per_user") else None
    await token_store.delete_token(db, server_id, uid)
    return {"ok": True}


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/{server_id}/refresh")
async def refresh_token_endpoint(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(404, "Server not found")

    uid = current_user.id if str(server.auth_mode).endswith("per_user") else None
    stored = await token_store.get_token(db, server_id, uid)
    if not stored or not stored.refresh_token:
        raise HTTPException(400, "No refresh token — please re-authenticate")

    _, token_url, client_id, client_secret, _, _, token_auth_method = \
        await _resolve_oauth_config(server, db)

    ref_data, ref_headers = _build_token_request(
        grant_type="refresh_token",
        client_id=client_id,
        client_secret=client_secret,
        token_auth_method=token_auth_method,
        extra={"refresh_token": stored.refresh_token},
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(token_url, data=ref_data, headers=ref_headers)
        if resp.status_code >= 400:
            raise HTTPException(400, f"Refresh failed ({resp.status_code}) — please re-authenticate")
        data = resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Refresh error: {e}")

    stored.access_token = data.get("access_token", stored.access_token)
    if data.get("refresh_token"):
        stored.refresh_token = data["refresh_token"]
    if data.get("expires_in"):
        stored.expires_at = datetime.utcnow() + timedelta(seconds=int(data["expires_in"]))
    await db.commit()
    return {"ok": True, "expires_at": stored.expires_at}


# ── Helper: get valid token (used by connect.py / mcp_auth.py) ───────────────

async def get_valid_oauth_token(server_id: int, user_id: int, db: AsyncSession) -> Optional[str]:
    """Return a valid access token, auto-refreshing if expired."""
    server = await db.get(Server, server_id)
    if not server:
        return None
    uid = user_id if str(server.auth_mode).endswith("per_user") else None
    stored = await token_store.get_token(db, server_id, uid)
    if not stored or not stored.access_token:
        return None

    if stored.expires_at and stored.expires_at < datetime.utcnow() + timedelta(seconds=60):
        if not stored.refresh_token:
            return None
        try:
            _, token_url, client_id, client_secret, _, _, token_auth_method = \
                await _resolve_oauth_config(server, db)
            ref_data, ref_headers = _build_token_request(
                grant_type="refresh_token",
                client_id=client_id,
                client_secret=client_secret,
                token_auth_method=token_auth_method,
                extra={"refresh_token": stored.refresh_token},
            )
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(token_url, data=ref_data, headers=ref_headers)
            if resp.status_code < 400:
                data = resp.json()
                stored.access_token = data.get("access_token", stored.access_token)
                if data.get("refresh_token"):
                    stored.refresh_token = data["refresh_token"]
                if data.get("expires_in"):
                    stored.expires_at = datetime.utcnow() + timedelta(seconds=int(data["expires_in"]))
                await db.commit()
        except Exception:
            return None

    return stored.access_token


@router.get("/{server_id}/mcp-authorize")
async def mcp_upstream_authorize(
    server_id: int,
    request: Request,
    resume_pending: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Start OAuth flow with an upstream remote MCP server's auth server.
    Called when connecting to servers like mcp.notion.com.
    Discovers OAuth endpoints via RFC 9728 + RFC 8414, then redirects user.
    """
    from app.services.mcp_client_oauth import (
        discover_oauth_for_mcp, get_or_register_client,
        pkce_verifier, pkce_challenge,
    )

    current_user = await _resolve_user(request, db)
    if not current_user:
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
        return RedirectResponse(f"{frontend_url}/login?next={request.url}", status_code=302)

    server = await db.get(Server, server_id)
    if not server or not server.url:
        raise HTTPException(404, "Server not found or has no URL")

    mcp_url = server.url.rstrip("/")

    # Discover OAuth endpoints from the remote MCP server
    oauth_meta = await discover_oauth_for_mcp(mcp_url)
    if not oauth_meta:
        raise HTTPException(400,
            f"Could not discover OAuth endpoints for {mcp_url}. "
            "The server may not support OAuth or is unreachable."
        )

    cb_uri = await _callback_uri(db)
    # Use a distinct callback path for upstream MCP OAuth
    mcp_cb_uri = cb_uri.replace("/oauth/callback", "/oauth/mcp-callback")

    client_creds = await get_or_register_client(db, server.id, mcp_url, oauth_meta, mcp_cb_uri)

    state = secrets.token_urlsafe(32)
    verifier = pkce_verifier()
    challenge = pkce_challenge(verifier)

    # Clean up old states for this user+server
    await db.execute(
        delete(OAuthState).where(
            and_(OAuthState.user_id == current_user.id, OAuthState.server_id == server_id)
        )
    )

    # Store state — reuse OAuthState model, store verifier in code_verifier
    db.add(OAuthState(
        server_id=server_id,
        user_id=current_user.id,
        state=state,
        code_verifier=verifier,
        redirect_uri=mcp_cb_uri,
        resume_pending=resume_pending,
    ))
    await db.commit()

    params = {
        "response_type": "code",
        "client_id": client_creds["client_id"],
        "redirect_uri": mcp_cb_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }

    auth_url = oauth_meta["authorization_endpoint"] + "?" + "&".join(
        f"{k}={v}" for k, v in params.items()
    )
    return RedirectResponse(auth_url)


@router.get("/mcp-callback")
async def mcp_upstream_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Callback from upstream MCP server's OAuth provider.
    Exchanges code for token, stores it, resumes MCP auth if needed.
    """
    from app.services.mcp_client_oauth import (
        discover_oauth_for_mcp, get_or_register_client, save_upstream_token,
    )

    frontend_url = await _frontend_url(db)

    if error:
        return RedirectResponse(
            f"{frontend_url}/oauth/callback?oauth_error={error_description or error}"
        )

    result = await db.execute(select(OAuthState).where(OAuthState.state == state))
    oauth_state = result.scalar_one_or_none()
    if not oauth_state:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=Invalid+state")

    if (datetime.utcnow() - oauth_state.created_at).total_seconds() > 600:
        await db.delete(oauth_state)
        await db.commit()
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=State+expired")

    server = await db.get(Server, oauth_state.server_id)
    if not server or not server.url:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=Server+not+found")

    mcp_url = server.url.rstrip("/")
    oauth_meta = await discover_oauth_for_mcp(mcp_url)
    if not oauth_meta:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=OAuth+discovery+failed")

    cb_uri = await _callback_uri(db)
    mcp_cb_uri = cb_uri.replace("/oauth/callback", "/oauth/mcp-callback")
    client_creds = await get_or_register_client(db, server.id, mcp_url, oauth_meta, mcp_cb_uri)

    # Exchange code for tokens
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": mcp_cb_uri,
        "client_id": client_creds["client_id"],
        "code_verifier": oauth_state.code_verifier,
    }
    if client_creds.get("client_secret"):
        data["client_secret"] = client_creds["client_secret"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                oauth_meta["token_endpoint"],
                data=data,
                headers={"Accept": "application/json"},
            )
        if r.status_code >= 400:
            logger.error(f"MCP upstream token exchange failed {r.status_code}: {r.text}")
            return RedirectResponse(
                f"{frontend_url}/oauth/callback?oauth_error=Token+exchange+failed+({r.status_code})"
            )
        token_resp = r.json()
    except Exception as e:
        logger.error(f"MCP upstream token exchange error: {e}")
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=Token+exchange+error")

    access_token = token_resp.get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend_url}/oauth/callback?oauth_error=No+access+token")

    await save_upstream_token(
        db=db,
        server_id=oauth_state.server_id,
        user_id=oauth_state.user_id,
        access_token=access_token,
        refresh_token=token_resp.get("refresh_token"),
        expires_in=token_resp.get("expires_in"),
        mcp_url=mcp_url,
    )

    db.add(AuditLog(
        user_id=oauth_state.user_id, action="mcp_upstream.connected",
        resource_type="server", resource_id=str(server.id), status_code=200,
    ))

    resume_pending = oauth_state.resume_pending
    await db.delete(oauth_state)
    await db.commit()

    # Resume MCP auth flow if this was triggered mid-connect
    if resume_pending:
        from app.api.v1.endpoints.mcp_auth import _auth_codes
        from urllib.parse import urlencode
        pending_data = _auth_codes.pop(f"pending:{resume_pending}", None)
        if pending_data and datetime.utcnow() < pending_data["expires"]:
            auth_code = secrets.token_urlsafe(32)
            _auth_codes[auth_code] = {
                "connection_token": pending_data["connection_token"],
                "redirect_uri": pending_data["redirect_uri"],
                "code_challenge": pending_data["code_challenge"],
                "code_challenge_method": pending_data["code_challenge_method"],
                "expires": datetime.utcnow() + timedelta(seconds=60),
            }
            params = {"code": auth_code}
            if pending_data.get("state"):
                params["state"] = pending_data["state"]
            return RedirectResponse(
                f"{pending_data['redirect_uri']}?{urlencode(params)}"
            )

    return RedirectResponse(
        f"{frontend_url}/oauth/callback?oauth_success=1&server_id={server.id}"
    )


@router.get("/{server_id}/mcp-token-status")
async def mcp_upstream_token_status(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check if user has a valid upstream MCP OAuth token."""
    from app.services.mcp_client_oauth import get_upstream_token
    token = await get_upstream_token(db, server_id, current_user.id)
    return {"has_token": token is not None, "server_id": server_id}
