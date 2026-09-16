# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
backend/app/services/mcp_client_oauth.py

MCPlama as an MCP CLIENT — implements the full MCP OAuth spec for connecting
to upstream remote MCP servers (Notion, Linear, etc).

Flow (per MCP spec RFC 9728 + RFC 8414):
  1. Attempt connection → upstream returns 401
  2. Parse WWW-Authenticate → get resource metadata URL
  3. GET /.well-known/oauth-protected-resource → get authorization_servers
  4. GET {auth_server}/.well-known/oauth-authorization-server → get endpoints
  5. Dynamic client registration
  6. PKCE OAuth flow via MCPlama's own authorize page
  7. Store upstream token → forward on all proxy requests
  8. Auto-refresh on expiry
"""
import hashlib
import base64
import secrets
import logging
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete

logger = logging.getLogger(__name__)

# ── In-memory store for discovered OAuth metadata per MCP server URL ──────────
# { mcp_url -> { authorization_endpoint, token_endpoint, registration_endpoint } }
_discovered: dict[str, dict] = {}

# Client registrations are NOT cached here — they live on the server row (see
# get_or_register_client). They are credentials bound to users' refresh tokens,
# so they must survive a restart.


# ── Step 1+2+3+4: Full discovery ──────────────────────────────────────────────

async def discover_oauth_for_mcp(mcp_url: str) -> Optional[dict]:
    """
    Given a remote MCP server URL, discover its OAuth endpoints.
    Returns dict with: authorization_endpoint, token_endpoint,
                       registration_endpoint, code_challenge_methods_supported
    Returns None if server doesn't support OAuth.
    Caches results in memory.
    """
    if mcp_url in _discovered:
        return _discovered[mcp_url]

    # Discovery is an outbound fetch to a URL an admin supplied, so it needs the
    # same SSRF guard as the proxy path — it runs *before* _proxy_remote's check,
    # and it is the one place we follow redirects, which would otherwise let a
    # public hostname bounce us onto an internal address.
    from app.core.ssrf import validate_remote_url
    await validate_remote_url(mcp_url)

    base = mcp_url.rstrip("/")
    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    async def _guard_redirect(response):
        """
        Re-validate every hop before httpx follows it. A public hostname that
        302s to http://169.254.169.254/ would otherwise walk us straight into
        the metadata service. validate_remote_url resolves the target, so a
        redirect to an internal *hostname* is caught too, not just a literal IP.
        """
        if response.is_redirect:
            location = response.headers.get("location")
            if location:
                await validate_remote_url(str(response.url.join(location)))

    try:
        async with httpx.AsyncClient(
            timeout=10,
            follow_redirects=True,
            event_hooks={"response": [_guard_redirect]},
        ) as client:

            # Step 2: GET /.well-known/oauth-protected-resource
            # RFC 9728 §3.1 inserts the well-known segment *before* the
            # resource's own path (e.g. https://host/mcp/ ->
            # https://host/.well-known/oauth-protected-resource/mcp/) — not
            # after it. Try the spec-correct form first, then origin-root,
            # then the (incorrect but occasionally seen) path-suffixed form.
            for resource_url in [
                f"{origin}/.well-known/oauth-protected-resource{parsed.path}",
                f"{origin}/.well-known/oauth-protected-resource",
                f"{base}/.well-known/oauth-protected-resource",
            ]:
                try:
                    r = await client.get(resource_url)
                    if r.status_code == 200:
                        resource_meta = r.json()
                        break
                except Exception:
                    continue
            else:
                logger.warning(f"No protected resource metadata found for {mcp_url}")
                return None

            # Step 3: Extract authorization server
            auth_servers = resource_meta.get("authorization_servers", [])
            if not auth_servers:
                logger.warning(f"No authorization_servers in resource metadata for {mcp_url}")
                return None

            auth_server = auth_servers[0].rstrip("/")

            # Step 4: GET authorization server metadata
            # Try RFC 8414 first, then OpenID Connect discovery
            as_meta = None
            for meta_url in [
                f"{auth_server}/.well-known/oauth-authorization-server",
                f"{auth_server}/.well-known/openid-configuration",
            ]:
                try:
                    r = await client.get(meta_url)
                    if r.status_code == 200:
                        as_meta = r.json()
                        break
                except Exception:
                    continue

            if not as_meta:
                logger.warning(f"No authorization server metadata found at {auth_server}")
                return None

            # Endpoints come from the upstream metadata document, and we POST
            # credentials to token_endpoint / registration_endpoint later. Screen
            # them now so a hostile metadata doc can't point them at our LAN.
            for endpoint_key in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
                if as_meta.get(endpoint_key):
                    await validate_remote_url(as_meta[endpoint_key])

            result = {
                "authorization_endpoint": as_meta.get("authorization_endpoint"),
                "token_endpoint": as_meta.get("token_endpoint"),
                "registration_endpoint": as_meta.get("registration_endpoint"),
                "code_challenge_methods_supported": as_meta.get(
                    "code_challenge_methods_supported", ["S256"]
                ),
                "auth_server": auth_server,
                "resource_meta": resource_meta,
            }

            if not result["authorization_endpoint"] or not result["token_endpoint"]:
                logger.warning(f"Missing required OAuth endpoints for {mcp_url}")
                return None

            logger.info(
                f"Discovered OAuth for {mcp_url}: "
                f"auth={result['authorization_endpoint']} "
                f"token={result['token_endpoint']}"
            )
            _discovered[mcp_url] = result
            return result

    except Exception as e:
        logger.error(f"OAuth discovery failed for {mcp_url}: {e}")
        return None


async def discover_from_401(mcp_url: str, www_authenticate: str) -> Optional[dict]:
    """
    Parse WWW-Authenticate header from a 401 response to find the
    resource metadata URL, then run full discovery.

    WWW-Authenticate may contain:
      Bearer realm="...", oauth_protected_resource_metadata="https://..."
    or just trigger standard discovery from the MCP URL.
    """
    # Try to extract explicit metadata URL from header
    import re
    from app.core.ssrf import validate_remote_url

    m = re.search(r'oauth_protected_resource_metadata="([^"]+)"', www_authenticate)
    if m:
        resource_meta_url = m.group(1)
        try:
            # This URL comes out of the upstream server's own 401 header, so it
            # is not ours to trust — resolve and screen it before fetching.
            await validate_remote_url(resource_meta_url)
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(resource_meta_url)
                if r.status_code == 200:
                    resource_meta = r.json()
                    auth_servers = resource_meta.get("authorization_servers", [])
                    if auth_servers:
                        # Override cache with explicit URL
                        _discovered.pop(mcp_url, None)
        except Exception:
            pass

    # Fall through to standard discovery
    return await discover_oauth_for_mcp(mcp_url)


# ── Step 5: Dynamic client registration ──────────────────────────────────────

async def load_client_creds(db: AsyncSession, server_id: int) -> Optional[dict]:
    """Read a previously-persisted client registration off the server row."""
    from app.models.server import Server
    from app.core.encryption import decrypt

    server = await db.get(Server, server_id)
    if not server or not server.mcp_client_id:
        return None
    return {
        "client_id": server.mcp_client_id,
        "client_secret": decrypt(server.mcp_client_secret, f"server:{server_id}:mcp_client_secret") if server.mcp_client_secret else None,
    }


async def get_or_register_client(
    db: AsyncSession,
    server_id: int,
    mcp_url: str,
    oauth_meta: dict,
    callback_uri: str,
) -> dict:
    """
    Register MCPlama as a client with the upstream OAuth server, or return the
    existing registration. Returns { client_id, client_secret }.

    The registration is persisted (encrypted) on the server row, not just cached
    in memory: a user's refresh token is bound to the client_id it was issued
    against, so losing the client_id on restart makes every stored refresh token
    unusable and forces all users to re-authorize.

    A manually-configured oauth_client_id always wins over dynamic
    registration — providers like GitHub publish discovery metadata but have
    no registration_endpoint, so without this check every user would silently
    get registered as a bogus "mcplama" public client GitHub has never heard
    of, instead of the OAuth App the admin actually created.
    """
    from app.models.server import Server
    from app.core.encryption import encrypt, decrypt

    server = await db.get(Server, server_id)
    if server and server.oauth_client_id:
        return {
            "client_id": server.oauth_client_id,
            "client_secret": decrypt(server.oauth_client_secret, f"server:{server_id}:oauth_client_secret") if server.oauth_client_secret else None,
        }

    stored = await load_client_creds(db, server_id)
    if stored:
        return stored

    reg_endpoint = oauth_meta.get("registration_endpoint")
    result = None

    if reg_endpoint:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    reg_endpoint,
                    json={
                        "client_name": "MCPlama Gateway",
                        "client_uri": callback_uri.split("/api/")[0],
                        "redirect_uris": [callback_uri],
                        "grant_types": ["authorization_code", "refresh_token"],
                        "response_types": ["code"],
                        "token_endpoint_auth_method": "none",
                    },
                    headers={"Content-Type": "application/json"},
                )
            if r.status_code in (200, 201):
                data = r.json()
                if data.get("client_id"):
                    result = {
                        "client_id": data["client_id"],
                        "client_secret": data.get("client_secret"),
                    }
                    logger.info(
                        f"Registered client for {mcp_url}: client_id={result['client_id']}"
                    )
            else:
                logger.warning(f"Client registration failed {r.status_code}: {r.text}")
        except Exception as e:
            logger.error(f"Client registration error for {mcp_url}: {e}")

    if result is None:
        # No dynamic registration available (or it failed) — fall back to a
        # public client with no secret, as before.
        result = {"client_id": "mcplama", "client_secret": None}

    server = await db.get(Server, server_id)
    if server:
        server.mcp_client_id = result["client_id"]
        server.mcp_client_secret = (
            encrypt(result["client_secret"], f"server:{server_id}:mcp_client_secret") if result["client_secret"] else None
        )
        await db.commit()

    return result


# ── PKCE helpers ──────────────────────────────────────────────────────────────

def pkce_verifier() -> str:
    return secrets.token_urlsafe(64)

def pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()


# ── Token store (uses existing ServerToken model) ─────────────────────────────
# We store upstream MCP OAuth tokens in ServerToken with a special
# user_id convention: we use user_id directly (per_user) or None (shared).
# The token_type field is set to "mcp_upstream" to distinguish from REST tokens.

async def get_upstream_token(
    db: AsyncSession, server_id: int, user_id: int
) -> Optional[str]:
    """Get a valid upstream MCP OAuth token, auto-refreshing if needed."""
    from app.models.server_token import ServerToken
    from app.core.encryption import decrypt

    result = await db.execute(
        select(ServerToken).where(
            and_(
                ServerToken.server_id == server_id,
                ServerToken.user_id == user_id,
                ServerToken.token_type == "mcp_upstream",
            )
        )
    )
    token = result.scalar_one_or_none()
    if not token or not token.access_token:
        return None

    access = decrypt(token.access_token, f"server_token:{server_id}:{user_id}:mcp_upstream:access_token")

    # Auto-refresh if expiring within 60s
    if token.expires_at and token.expires_at < datetime.utcnow() + timedelta(seconds=60):
        if token.refresh_token:
            refreshed = await _refresh_upstream_token(db, token, server_id)
            if refreshed:
                return refreshed
        return None

    return access


async def save_upstream_token(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: Optional[int],
    mcp_url: str,
):
    """Save upstream MCP OAuth token."""
    from app.models.server_token import ServerToken
    from app.core.encryption import encrypt

    expires_at = None
    if expires_in:
        expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))

    result = await db.execute(
        select(ServerToken).where(
            and_(
                ServerToken.server_id == server_id,
                ServerToken.user_id == user_id,
                ServerToken.token_type == "mcp_upstream",
            )
        )
    )
    existing = result.scalar_one_or_none()

    enc_access = encrypt(access_token, f"server_token:{server_id}:{user_id}:mcp_upstream:access_token")
    enc_refresh = encrypt(refresh_token, f"server_token:{server_id}:{user_id}:mcp_upstream:refresh_token") if refresh_token else None

    if existing:
        existing.access_token = enc_access
        existing.refresh_token = enc_refresh
        existing.expires_at = expires_at
        existing.scope = mcp_url
        existing.connected_at = datetime.utcnow()
    else:
        db.add(ServerToken(
            server_id=server_id,
            user_id=user_id,
            access_token=enc_access,
            refresh_token=enc_refresh,
            expires_at=expires_at,
            token_type="mcp_upstream",
            scope=mcp_url,  # store mcp_url in scope for refresh
        ))
    await db.commit()
    logger.info(f"Saved upstream MCP token for server_id={server_id} user_id={user_id}")


async def _refresh_upstream_token(db, token, server_id: int) -> Optional[str]:
    """Try to refresh an upstream MCP OAuth token."""
    from app.models.server import Server
    from app.core.encryption import decrypt, encrypt

    server = await db.get(Server, server_id)
    if not server or not server.url:
        return None

    mcp_url = server.url
    oauth_meta = await discover_oauth_for_mcp(mcp_url)
    if not oauth_meta:
        return None

    # Read the client registration from the server row. Previously this read an
    # in-memory cache and fell back to {"client_id": "mcplama"} — a client the
    # upstream never issued — so after any restart every refresh was rejected
    # and the user was silently forced to re-authorize.
    client_creds = await load_client_creds(db, server_id)
    if not client_creds:
        logger.warning(
            f"No stored client registration for server_id={server_id}; "
            f"cannot refresh upstream token — user must re-authorize"
        )
        return None

    refresh_token = decrypt(token.refresh_token, f"server_token:{server_id}:{token.user_id}:mcp_upstream:refresh_token")

    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_creds["client_id"],
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
            logger.warning(f"Upstream token refresh failed {r.status_code}: {r.text}")
            return None

        resp = r.json()
        new_access = resp.get("access_token")
        if not new_access:
            return None

        token.access_token = encrypt(new_access, f"server_token:{server_id}:{token.user_id}:mcp_upstream:access_token")
        if resp.get("refresh_token"):
            token.refresh_token = encrypt(resp["refresh_token"], f"server_token:{server_id}:{token.user_id}:mcp_upstream:refresh_token")
        if resp.get("expires_in"):
            token.expires_at = datetime.utcnow() + timedelta(seconds=int(resp["expires_in"]))
        await db.commit()
        logger.info(f"Refreshed upstream MCP token for server_id={server_id}")
        return new_access

    except Exception as e:
        logger.error(f"Upstream token refresh error: {e}")
        return None


async def clear_discovery_cache(mcp_url: str, db: AsyncSession = None, server_id: int = None):
    """
    Clear cached OAuth discovery for a URL (e.g. after a config change).

    If db+server_id are given, also drop the stored client registration so the
    next authorization re-registers against the new endpoints. Discovery is a
    pure cache and safe to drop; the registration is not, so it is only cleared
    when the caller explicitly asks.
    """
    _discovered.pop(mcp_url, None)

    if db is not None and server_id is not None:
        from app.models.server import Server
        server = await db.get(Server, server_id)
        if server:
            server.mcp_client_id = None
            server.mcp_client_secret = None
            await db.commit()
