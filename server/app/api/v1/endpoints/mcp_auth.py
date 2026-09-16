# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
MCP OAuth 2.0 Authorization Server (PKCE flow).
VS Code and other MCP clients expect the gateway to implement OAuth
when connecting via URL transport. The connection token IS the credential —
we just wrap it in a proper OAuth PKCE flow so clients like VS Code work
without any extra configuration.

Flow:
1. VS Code discovers /.well-known/oauth-authorization-server
2. VS Code redirects user to /authorize?client_id={conn_token}&...
3. MCPlama validates the connection token, generates auth code, redirects back
4. VS Code calls /token with the auth code
5. MCPlama returns the connection token as the access token
6. VS Code uses the token as Bearer on /connect/{token} requests
"""
import secrets
import hashlib
import base64
from datetime import datetime, timedelta
from urllib.parse import urlencode
from fastapi import APIRouter, Depends, Request, Query, Form, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from sqlalchemy import select
from app.db.session import AsyncSessionLocal, get_db
from app.models.connection import Connection
from app.models.connection_access_token import ConnectionAccessToken
from app.core.security import decode_token

router = APIRouter(tags=["mcp-auth"])

# In-memory store for auth codes (short-lived, 60s) and pending authorizations
# (5 min). Process-local: a restart or a second worker invalidates in-flight
# authorizations, and the client simply retries. See _sweep_expired — entries
# abandoned mid-flow (user closes the tab) are never popped by the happy path,
# so without a sweep this dict grows without bound.
_auth_codes: dict[str, dict] = {}


def _sweep_expired() -> None:
    """Drop expired codes and pending authorizations."""
    now = datetime.utcnow()
    for key in [k for k, v in _auth_codes.items() if v.get("expires") and v["expires"] < now]:
        _auth_codes.pop(key, None)


@router.get("/.well-known/oauth-authorization-server")
async def oauth_metadata():
    base = settings.GATEWAY_URL
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/authorize",
        "token_endpoint": f"{base}/token",
        "registration_endpoint": f"{base}/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/{path:path}")
async def protected_resource_metadata(request: Request, path: str = ""):
    base = settings.GATEWAY_URL.rstrip("/")
    # Per RFC 9728, resource must EXACTLY match the protected URL
    if path:
        resource = f"{base}/{path}"
    else:
        resource = base
    return {
        "resource": resource,
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
    }


@router.post("/register")
async def dynamic_client_registration(request: Request):
    """
    VS Code tries dynamic client registration first.
    We accept any client and return a client_id = their redirect_uri hash.
    """
    body = await request.json()
    client_id = "mcplama-" + secrets.token_urlsafe(8)
    return JSONResponse({
        "client_id": client_id,
        "redirect_uris": body.get("redirect_uris", []),
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }, status_code=201)


@router.get("/authorize")
async def authorize(
    request: Request,
    client_id: str = Query(...),
    response_type: str = Query("code"),
    redirect_uri: str = Query(...),
    state: str = Query(None),
    code_challenge: str = Query(None),
    code_challenge_method: str = Query(None),
    resource: str = Query(None),
):
    """
    Authorization endpoint.
    VS Code sends the connection URL as `resource` param.
    We extract the token from it and store it for the token exchange.
    """
    # Extract real connection token from resource URL
    # resource = "http://localhost:8000/connect/nxs_abc123"
    connection_token = client_id  # fallback
    if resource:
        import re
        m = re.search(r"/connect/([^/?]+)", resource)
        if m:
            connection_token = m.group(1)

    # Validate token exists
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Connection).where(
                Connection.token == connection_token,
                Connection.is_active == True
            )
        )
        conn = result.scalar_one_or_none()

    if not conn:
        # Also try client_id as token directly
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Connection).where(
                    Connection.token == client_id,
                    Connection.is_active == True
                )
            )
            conn = result.scalar_one_or_none()
        if conn:
            connection_token = client_id

    # Validate redirect_uri — only allow localhost/loopback and custom app schemes
    _allowed_schemes = ("http://localhost", "http://127.0.0.1", "https://localhost",
                        "vscode://", "cursor://", "windsurf://", "claude://", "mcp://")
    if not any(redirect_uri.startswith(s) for s in _allowed_schemes):
        raise HTTPException(400, {"error": "invalid_request", "error_description": "redirect_uri not allowed"})

    if response_type != "code":
        raise HTTPException(400, {"error": "unsupported_response_type"})

    # ── PKCE is mandatory ─────────────────────────────────────────────────────
    # The MCP authorization spec makes PKCE a MUST for public clients, and every
    # client we issue tokens to is public (token_endpoint_auth_method=none). An
    # authorization request without a challenge would yield a code redeemable by
    # anyone who intercepts it, so refuse it here rather than at exchange time.
    if not code_challenge:
        raise HTTPException(400, {
            "error": "invalid_request",
            "error_description": "code_challenge is required (PKCE, S256)",
        })

    # RFC 7636 defaults an omitted method to "plain"; we never accept plain, and
    # our metadata advertises S256 only, so an omitted method is read as S256 and
    # anything else is rejected outright. Accepting "plain" would let a client
    # downgrade itself out of PKCE entirely.
    if code_challenge_method is None:
        code_challenge_method = "S256"
    if code_challenge_method != "S256":
        raise HTTPException(400, {
            "error": "invalid_request",
            "error_description": "code_challenge_method must be S256",
        })

    # Store pending auth request — wait for user to login via browser
    _sweep_expired()
    pending_id = secrets.token_urlsafe(16)

    # Get server_id from connection token for upstream OAuth check
    server_id = None
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Connection).where(Connection.token == connection_token, Connection.is_active == True)
        )
        c = result.scalar_one_or_none()
        if c:
            server_id = c.server_id

    _auth_codes[f"pending:{pending_id}"] = {
        "connection_token": connection_token,
        "server_id": server_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "state": state,
        "expires": datetime.utcnow() + timedelta(minutes=5),
    }

    # Redirect user to MCPlama login page with pending_id
    frontend_url = getattr(settings, "FRONTEND_URL", settings.FRONTEND_URL)
    login_url = f"{frontend_url}/mcp-authorize?pending={pending_id}"
    return RedirectResponse(login_url)


@router.get("/authorize/complete")
async def authorize_complete(
    request: Request,
    pending: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Called by frontend after user logs in. Issues auth code and redirects to MCP client.

    Reads the session JWT from the Authorization header (Bearer) OR the `access_token`
    cookie, then decodes it manually via decode_token — avoids using oauth2_scheme
    (which only reads Authorization headers and conflicts with MCP client Bearer tokens
    on the same router).
    """
    # --- Resolve current user from JWT manually ---
    token: str | None = None

    # 1. Try Authorization: Bearer <token>
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]

    # 2. Fall back to cookie (frontend sets this after login)
    if not token:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(401, "Not authenticated — please log in first")

    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired session token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Malformed token — missing subject claim")

    # Load user from DB
    from app.models.user import User
    user = await db.get(User, int(user_id))
    if not user or not user.is_active:
        raise HTTPException(401, "User not found or deactivated")

    # --- Validate pending auth request ---
    pending_data = _auth_codes.get(f"pending:{pending}")
    if not pending_data:
        raise HTTPException(400, "Invalid or expired authorization request")

    if datetime.utcnow() > pending_data["expires"]:
        _auth_codes.pop(f"pending:{pending}", None)
        raise HTTPException(400, "Authorization request expired. Please reconnect.")

    # --- Check upstream OAuth if server requires it ---
    server_id = pending_data.get("server_id")
    if server_id:
        from app.models.server import Server
        from app.api.v1.endpoints.oauth_flow import get_valid_oauth_token
        server = await db.get(Server, server_id)
        if server and server.remote_auth == "oauth":
            oauth_token = await get_valid_oauth_token(server_id, user.id, db)
            if not oauth_token:
                gateway_url = settings.GATEWAY_URL.rstrip("/")
                # Use mcp-authorize for remote servers (RFC 9728 discovery flow)
                # Use authorize for servers using REST API OAuth
                from app.models.server import Runtime
                auth_route = "mcp-authorize" if server.runtime == Runtime.remote else "authorize"
                upstream_auth_url = f"{gateway_url}/api/v1/oauth/{server_id}/{auth_route}?resume_pending={pending}"
                _auth_codes[f"pending:{pending}"]["upstream_pending"] = True
                return JSONResponse({
                    "status": "upstream_oauth_required",
                    "upstream_oauth_url": upstream_auth_url,
                    "message": f"Please authorize with {server.name} first",
                })

    # --- Verify the connection actually belongs to the user authorizing it ----
    # The connection token arrives from the client's `resource`/`client_id`
    # query param, i.e. it is attacker-controllable. Without this check, whoever
    # crafts the /authorize URL decides which connection the logged-in user ends
    # up handing to their MCP client — letting an attacker bind a victim's editor
    # to a connection the attacker owns (their credentials, their audit trail).
    cr = await db.execute(
        select(Connection).where(
            Connection.token == pending_data["connection_token"],
            Connection.is_active == True,
        )
    )
    target_conn = cr.scalar_one_or_none()
    if not target_conn:
        raise HTTPException(400, "Unknown or inactive connection")
    if target_conn.user_id != user.id:
        raise HTTPException(403, "This connection belongs to a different user")

    # --- Issue auth code ---
    _auth_codes.pop(f"pending:{pending}", None)
    _sweep_expired()

    default_lifetime = 86400
    from app.models.gateway_config import GatewayConfig
    gw_cfg = (await db.execute(select(GatewayConfig).where(GatewayConfig.id == 1))).scalar_one_or_none()
    if gw_cfg and gw_cfg.mcp_access_token_lifetime_hours:
        default_lifetime = gw_cfg.mcp_access_token_lifetime_hours * 3600

    expires_in = default_lifetime
    if target_conn.expires_at:
        remaining = int((target_conn.expires_at - datetime.utcnow()).total_seconds())
        if remaining <= 0:
            raise HTTPException(400, "Connection has expired")
        expires_in = remaining

    code = secrets.token_urlsafe(32)
    _auth_codes[code] = {
        "connection_token": pending_data["connection_token"],
        "redirect_uri": pending_data["redirect_uri"],
        "code_challenge": pending_data["code_challenge"],
        "code_challenge_method": pending_data["code_challenge_method"],
        "expires_in": expires_in,
        "expires": datetime.utcnow() + timedelta(seconds=60),
    }

    params = {"code": code}
    if pending_data.get("state"):
        params["state"] = pending_data["state"]

    redirect_url = f"{pending_data['redirect_uri']}?{urlencode(params)}"

    # Return redirect URL in body so frontend JS can navigate to it
    # (axios can't follow cross-origin redirects to localhost ports like 127.0.0.1:33418)
    return JSONResponse({
        "redirect_url": redirect_url,
        "status": "authorized",
    })


@router.post("/token")
async def token_exchange(
    request: Request,
    grant_type: str = Form("authorization_code"),
    code: str = Form(None),
    redirect_uri: str = Form(None),
    client_id: str = Form(None),
    code_verifier: str = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Token endpoint. Exchange auth code for a rotated access token.

    The access token is deliberately NOT the raw connection token (that
    value is already exposed in the /connect/{token} URL) — it's a fresh
    secret minted here, only reachable after authorize_complete has already
    verified the logged-in user owns the connection. Returning the raw
    connection token instead would let anyone holding a leaked /connect URL
    self-supply it as a Bearer header and skip the login step entirely.
    """
    if grant_type != "authorization_code":
        raise HTTPException(400, {"error": "unsupported_grant_type"})

    code_data = _auth_codes.pop(code, None)
    if not code_data:
        raise HTTPException(400, {"error": "invalid_grant", "error_description": "Invalid or expired authorization code"})

    if datetime.utcnow() > code_data["expires"]:
        raise HTTPException(400, {"error": "invalid_grant", "error_description": "Authorization code expired"})

    # ── Bind the redirect_uri (RFC 6749 §4.1.3) ───────────────────────────────
    # The redirect_uri presented here must be the one the code was issued
    # against. Without this check a code intercepted from one client can be
    # redeemed by another.
    if redirect_uri != code_data["redirect_uri"]:
        raise HTTPException(400, {
            "error": "invalid_grant",
            "error_description": "redirect_uri does not match the authorization request",
        })

    # ── Verify PKCE (mandatory) ───────────────────────────────────────────────
    # /authorize refuses to issue a code without an S256 challenge, so a code
    # reaching this point always carries one. Verify unconditionally — never
    # branch on whether a challenge is present, or a code minted through some
    # other path would skip verification entirely.
    challenge = code_data.get("code_challenge")
    if not challenge or code_data.get("code_challenge_method") != "S256":
        raise HTTPException(400, {
            "error": "invalid_grant",
            "error_description": "Authorization code is missing a valid PKCE challenge",
        })
    if not code_verifier:
        raise HTTPException(400, {"error": "invalid_grant", "error_description": "code_verifier required"})

    digest = hashlib.sha256(code_verifier.encode()).digest()
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    if not secrets.compare_digest(computed, challenge):
        raise HTTPException(400, {"error": "invalid_grant", "error_description": "PKCE verification failed"})

    connection_token = code_data["connection_token"]

    conn_result = await db.execute(
        select(Connection).where(Connection.token == connection_token, Connection.is_active == True)
    )
    conn = conn_result.scalar_one_or_none()
    if not conn:
        raise HTTPException(400, {"error": "invalid_grant", "error_description": "Connection no longer exists"})

    expires_in = code_data.get("expires_in", 86400)
    access_token = "mat_" + secrets.token_urlsafe(32)
    db.add(ConnectionAccessToken(
        connection_id=conn.id,
        token=access_token,
        expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
    ))
    await db.commit()

    return JSONResponse({
        "access_token": access_token,
        "token_type": "Bearer",
        # Mirrors the connection's own lifetime so clients re-auth when it
        # actually expires, instead of caching a revoked token for a year.
        "expires_in": expires_in,
        "scope": "mcp",
    })