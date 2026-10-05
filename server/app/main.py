# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import asyncio
import logging
from contextlib import asynccontextmanager
from app.models import policy as _policy_model
from app.api.v1.endpoints.policies_endpoint import policies_router
from app.models.alert import Alert as _Alert
from app.api.v1.endpoints.alert_endpoint import alerts_router
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from fastapi import FastAPI, Depends
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from app.api.v1.endpoints.auth import get_current_user, require_admin
from app.models.user import User
from app.core.config import settings
from app.db.session import init_db
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.servers import router as servers_router
from app.api.v1.endpoints.oauth import router as oauth_router
from app.api.v1.endpoints.connect import router as connect_router
from app.api.v1.endpoints.mcp_auth import router as mcp_auth_router
from app.api.v1.endpoints.connections import router as connections_router
from app.api.v1.endpoints.registry_ep import router as registry_router
from app.api.v1.endpoints.misc import (
    gateway_router, users_router, policies_router, audit_router
)
from app.services import container_manager as cm
from app.models import invite as _invite_model
from app.models.smtp_config import SmtpConfig as _SmtpConfig
from app.api.v1.endpoints.smtp_endpoint import smtp_router
from app.models.gateway_config import GatewayConfig as _GatewayConfig
from app.models.server_request import ServerRequest as _ServerRequest
from app.models.oauth_state import OAuthState as _OAuthState
from app.api.v1.endpoints.gateway_config_endpoint import gateway_config_router
from app.api.v1.endpoints.requests_endpoint import requests_router
from app.api.v1.endpoints.oauth_flow import oauth_router as oauth_flow_router
from app.api.v1.endpoints.diagnostics import diagnostics_router
from app.api.v1.endpoints.version_check import router as version_router
from app.services.diagnostics import install_handler

install_handler()
logger = logging.getLogger(__name__)


async def _reconcile_shared_sessions():
    """
    Session-multiplexed shared servers (see container_manager.open_session)
    track their per-session supergateway instances and backing containers
    only in memory. A backend restart forgets all of it while the actual
    Docker resources keep running — invisible orphans that idle-reaping can
    never find again, and a stale port that could collide with a freshly
    allocated one. Since nothing can be legitimately tracked yet this early
    in startup, it's safe to just clear out every such server's shared
    container and any standalone containers running its image; each
    recreates cheaply and lazily on the next real client connection.
    """
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.server import Server
        from sqlalchemy import select

        # A restart that brings backend and broker up together races this
        # against the broker not being reachable yet — every removal/sweep
        # call below would silently no-op (caught internally, just logged),
        # defeating the whole point. Wait for it first.
        for _ in range(30):
            if await cm._docker_available():
                break
            await asyncio.sleep(1)
        else:
            logger.warning("Reconcile: broker never became available, skipping")
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Server).where(Server.is_enabled == True))
            servers = result.scalars().all()

        for server in servers:
            if not server.runtime or server.runtime.value == "remote":
                continue
            effective_auth_mode = server.auth_mode.value
            if effective_auth_mode == "none":
                effective_auth_mode = "shared"
            transport = getattr(server, "transport", None) or "http"
            if not cm.needs_session_multiplexing(server.runtime.value, transport, effective_auth_mode):
                continue

            name = cm._container_name(server.slug, None, "shared")
            try:
                await cm.stop_container(name)
            except Exception as e:
                logger.warning(f"Reconcile: failed to remove {name}: {e}")

            if server.runtime.value == "docker":
                image = server.docker_image or server.package
                if image:
                    try:
                        await cm._broker("POST", "/sweep-image", json={"image": image})
                    except Exception as e:
                        logger.warning(f"Reconcile: failed to sweep image {image}: {e}")
        logger.info(f"Reconciled {len(servers)} servers' shared sessions on startup")
    except Exception as e:
        logger.error(f"Error reconciling shared sessions: {e}")


async def _start_existing_containers():
    """On startup, start containers for all active connections."""
    await _reconcile_shared_sessions()
    await asyncio.sleep(3)
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.connection import Connection
        from app.models.server import Server
        from app.services.token_store import get_token
        from app.core.encryption import decrypt_dict
        from app.services.stdio_bridge import wait_for_container
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Connection, Server)
                .join(Server, Connection.server_id == Server.id)
                .where(Connection.is_active == True, Server.is_enabled == True)
            )
            rows = result.all()

        logger.info(f"Starting containers for {len(rows)} active connections...")

        for conn, server in rows:
            if not server.runtime or server.runtime.value == "remote":
                continue
            try:
                env = {}
                if server.auth_mode.value == "shared":
                    env = {k: v for k, v in decrypt_dict(server.auth_config or {}, context_prefix=f"server:{server.id}:auth_config").items() if v}
                elif server.auth_mode.value == "per_user":
                    async with AsyncSessionLocal() as db:
                        stored = await get_token(db, server.id, conn.user_id)
                    if stored and stored.access_token:
                        schema = server.user_config_schema or []
                        key = schema[0].get("key", "API_TOKEN") if schema else "API_TOKEN"
                        env[key] = stored.access_token

                if not env and server.auth_mode.value != "none":
                    continue

                # Use shared container for auth_mode=none
                effective_auth_mode = server.auth_mode.value
                if effective_auth_mode == "none":
                    effective_auth_mode = "shared"
                effective_user_id = conn.user_id if effective_auth_mode != "shared" else None

                existing = await cm.get_container(server.slug, effective_user_id, effective_auth_mode)
                if existing:
                    continue

                server_transport = getattr(server, 'transport', None) or 'http'
                container = await cm.start_container(
                    server_slug=server.slug,
                    runtime=server.runtime.value,
                    docker_image=server.docker_image,
                    package=server.package,
                    args=server.args or [],
                    docker_args=server.docker_args or [],
                    container_port=server.container_port or 8000,
                    env=env,
                    user_id=effective_user_id,
                    auth_mode=effective_auth_mode,
                    transport=server_transport,
                    cpu_limit=server.cpu_limit,
                    memory_limit=server.memory_limit,
                )
                # Session-multiplexed shared servers idle at startup — nothing
                # listens on container_port until a real client opens a
                # session (see stdio_bridge/open_session), so there's nothing
                # to health-check here.
                if not cm.needs_session_multiplexing(server.runtime.value, server_transport, effective_auth_mode):
                    cp = server.container_port or 8000
                    await wait_for_container(container.name, timeout=15, port=cp, mcp_path=server.effective_mcp_path)
                logger.info(f"Started container for {server.name} (user {conn.user_id}, mode={effective_auth_mode})")
            except Exception as e:
                logger.warning(f"Failed to start container for {server.name}: {e}")

    except Exception as e:
        logger.error(f"Error starting existing containers: {e}")


async def _run_alert_checks():
    """Check all enabled alerts and send emails if firing."""
    try:
        from app.db.session import AsyncSessionLocal
        from app.models.alert import Alert
        from app.models.server import Server
        from app.models.user import User
        from app.api.v1.endpoints.alert_endpoint import _evaluate_alert
        from app.services.email_service import send_email, alert_email
        from sqlalchemy import select
        from datetime import datetime

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Alert).where(Alert.is_enabled == True))
            alerts = result.scalars().all()

            for alert in alerts:
                try:
                    status, value = await _evaluate_alert(alert, db)
                    if status != "firing":
                        continue
                    if not (alert.config or {}).get("notify_by_email"):
                        continue

                    # Get users to notify
                    notify_ids = alert.notify_user_ids or []
                    if notify_ids:
                        ur = await db.execute(select(User).where(User.id.in_(notify_ids), User.is_active == True))
                    else:
                        ur = await db.execute(select(User).where(User.role == "admin", User.is_active == True))
                    notify_users = ur.scalars().all()

                    # Get server name
                    server_name = ""
                    if alert.server_id:
                        sr = await db.execute(select(Server).where(Server.id == alert.server_id))
                        s = sr.scalar_one_or_none()
                        server_name = s.name if s else ""

                    # Cooldown — don't re-send if already sent recently
                    cooldown = (alert.config or {}).get("cooldown_seconds", 3600)
                    if alert.last_triggered_at:
                        elapsed = (datetime.utcnow() - alert.last_triggered_at).total_seconds()
                        if elapsed < cooldown:
                            logger.info(f"Alert '{alert.name}' in cooldown ({int(elapsed)}s/{cooldown}s) — skipping")
                            continue

                    try:
                        from app.api.v1.endpoints.gateway_config_endpoint import get_effective_gateway_url
                        _gurl = await get_effective_gateway_url(db)
                    except Exception:
                        _gurl = settings.GATEWAY_URL
                    subject, html = alert_email(
                        alert_name=alert.name,
                        severity=alert.severity,
                        current_value=value,
                        server_name=server_name,
                        dashboard_url=_gurl,
                        logo_url=f"{_gurl.rstrip('/')}/icons/mcplama-icon-128.png",
                    )

                    for user in notify_users:
                        sent = await send_email(db, user.email, subject, html)
                        if sent:
                            logger.info(f"Alert email sent: '{alert.name}' → {user.email}")

                    alert.triggered_count = (alert.triggered_count or 0) + 1
                    alert.last_triggered_at = datetime.utcnow()

                except Exception as e:
                    logger.warning(f"Error checking alert '{alert.name}': {e}")

            await db.commit()

    except Exception as e:
        logger.error(f"Alert check failed: {e}")


async def _cleanup_oauth_states():
    """Clean up OAuth states older than 10 minutes."""
    from app.models.oauth_state import OAuthState
    from sqlalchemy import delete
    from datetime import datetime, timedelta
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        cutoff = datetime.utcnow() - timedelta(minutes=10)
        await db.execute(delete(OAuthState).where(OAuthState.created_at < cutoff))
        await db.commit()


async def _cleanup_loop():
    from datetime import datetime
    last_reset_day = datetime.utcnow().day
    alert_check_counter = 0

    while True:
        await asyncio.sleep(60)

        # Idle container cleanup
        try:
            await cm.cleanup_idle()
        except Exception:
            pass

        # Reset calls_today at midnight UTC
        try:
            now = datetime.utcnow()
            if now.day != last_reset_day:
                from app.db.session import AsyncSessionLocal
                from app.models.server import Server
                from sqlalchemy import select
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(Server))
                    for s in result.scalars().all():
                        s.calls_today = 0
                    await db.commit()
                last_reset_day = now.day
        except Exception:
            pass

        # Check alerts every 5 minutes
        alert_check_counter += 1
        if alert_check_counter >= 5:
            alert_check_counter = 0
            await _run_alert_checks()
            try:
                await _cleanup_oauth_states()
            except Exception:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Auto-seed disabled — use /setup wizard for first admin creation
    task = asyncio.create_task(_cleanup_loop())
    asyncio.create_task(_start_existing_containers())
    yield
    task.cancel()
    try:
        await cm.cleanup_all()
    except Exception:
        pass


app = FastAPI(
    title="MCPlama",
    version=settings.VERSION,
    description="MCP Gateway — observe, control and audit all MCP tool calls",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

P = "/api/v1"
app.include_router(auth_router, prefix=P)
app.include_router(servers_router, prefix=P)
app.include_router(oauth_router, prefix=P)
app.include_router(connections_router, prefix=P)
app.include_router(registry_router, prefix=P)
app.include_router(gateway_router, prefix=P)
app.include_router(users_router, prefix=P)
app.include_router(policies_router, prefix=P)
app.include_router(audit_router, prefix=P)
app.include_router(alerts_router, prefix=P)
app.include_router(smtp_router, prefix=P)
app.include_router(gateway_config_router, prefix=P)
app.include_router(requests_router, prefix=P)
app.include_router(oauth_flow_router, prefix=P)
app.include_router(diagnostics_router, prefix=P)
app.include_router(version_router, prefix=P)
app.include_router(connect_router)
app.include_router(mcp_auth_router)


PUBLIC_OPENAPI_PATHS = {
    "/health",
    "/api/v1/auth/setup-status",
    "/api/v1/auth/setup",
    "/api/v1/auth/login",
    "/api/v1/auth/logout",
    "/api/v1/auth/me",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/auth/invite",
    "/api/v1/auth/invite/{token}",
    "/api/v1/auth/invite/{token}/accept",
    "/api/v1/auth/invites",
    "/api/v1/auth/invites/{invite_id}",
    "/api/v1/servers",
    "/api/v1/servers/{server_id}",
    "/api/v1/servers/{server_id}/test",
    "/api/v1/servers/{server_id}/auth-status",
    "/api/v1/servers/{server_id}/credentials/status",
    "/api/v1/servers/{server_id}/credentials",
    "/api/v1/connections",
    "/api/v1/connections/{connection_id}",
    "/api/v1/connections/config/claude-desktop",
    "/api/v1/servers/{server_id}/request",
    "/api/v1/servers/{server_id}/assign/{user_id}",
    "/api/v1/servers/{server_id}/members",
    "/api/v1/servers/{server_id}/members/{user_id}",
    "/api/v1/requests",
    "/api/v1/requests/mine",
    "/api/v1/requests/{request_id}/approve",
    "/api/v1/requests/{request_id}/deny",
    "/api/v1/registry",
    "/api/v1/registry/categories",
    "/api/v1/registry/{server_id}",
    "/api/v1/oauth/{server_id}/authorize",
    "/api/v1/oauth/callback",
    "/api/v1/oauth/{server_id}/mcp-authorize",
    "/api/v1/oauth/mcp-callback",
    "/api/v1/oauth/{server_id}/token-status",
    "/api/v1/oauth/{server_id}/disconnect",
    "/api/v1/oauth/{server_id}/token",
    "/api/v1/oauth/{server_id}/refresh",
    "/api/v1/oauth/{server_id}/mcp-token-status",
    "/api/v1/audit",
    "/api/v1/policies",
    "/api/v1/policies/{policy_id}",
    "/api/v1/policies/{policy_id}/toggle",
    "/api/v1/users",
    "/api/v1/users/{user_id}",
    "/api/v1/gateway/stats",
    "/api/v1/gateway/config",
    "/api/v1/smtp",
    "/api/v1/smtp/test",
}


PUBLIC_OPENAPI_TAGS = [
    {"name": "auth", "description": "Login, initial setup, password reset, and invite acceptance."},
    {"name": "servers", "description": "Install, inspect, test, update, and remove MCP servers."},
    {"name": "connections", "description": "Create and revoke per-user MCP connection links."},
    {"name": "requests", "description": "Request, approve, assign, and revoke server access."},
    {"name": "registry", "description": "Read-only MCP server catalog endpoints."},
    {"name": "oauth", "description": "User-facing upstream OAuth authorization flows."},
    {"name": "audit", "description": "Activity and audit log query endpoints."},
    {"name": "policies", "description": "Access policy management endpoints."},
    {"name": "users", "description": "User administration endpoints."},
    {"name": "gateway", "description": "Gateway status and dashboard metrics."},
    {"name": "gateway-config", "description": "Gateway name and public URL settings."},
    {"name": "smtp", "description": "Outbound email configuration and test send."},
    {"name": "health", "description": "Gateway health check."},
]


DOC_GROUPS = [
    {
        "title": "Auth and Setup",
        "description": "Initial setup, login, password reset, and invite acceptance.",
        "endpoints": [
            ("GET", "/api/v1/auth/setup-status", "Check whether the first admin setup is complete."),
            ("POST", "/api/v1/auth/setup", "Create the first admin account during initial setup."),
            ("POST", "/api/v1/auth/login", "Sign in and receive the httpOnly auth cookie."),
            ("POST", "/api/v1/auth/logout", "Clear the auth cookie."),
            ("GET", "/api/v1/auth/me", "Return the current authenticated user."),
            ("POST", "/api/v1/auth/forgot-password", "Start a password reset email flow."),
            ("POST", "/api/v1/auth/reset-password", "Redeem a password reset token."),
            ("POST", "/api/v1/auth/invite", "Admin create an invite link for a user."),
            ("GET", "/api/v1/auth/invite/{token}", "Inspect an invite before accepting it."),
            ("POST", "/api/v1/auth/invite/{token}/accept", "Accept an invite and create the user account."),
            ("GET", "/api/v1/auth/invites", "Admin list pending and accepted invites."),
            ("DELETE", "/api/v1/auth/invites/{invite_id}", "Admin delete an invite."),
        ],
    },
    {
        "title": "MCP Servers",
        "description": "Create, read, update, delete, test, and configure MCP servers.",
        "endpoints": [
            ("GET", "/api/v1/servers", "List installed MCP servers."),
            ("POST", "/api/v1/servers", "Create a custom MCP server."),
            ("GET", "/api/v1/servers/{server_id}", "Get one MCP server."),
            ("PATCH", "/api/v1/servers/{server_id}", "Update an MCP server."),
            ("DELETE", "/api/v1/servers/{server_id}", "Delete an MCP server."),
            ("POST", "/api/v1/servers/{server_id}/test", "Start and test a server, then discover tools."),
            ("GET", "/api/v1/servers/{server_id}/auth-status", "Check configured shared/OAuth auth status."),
            ("GET", "/api/v1/servers/{server_id}/credentials/status", "Check whether the current user saved credentials."),
            ("POST", "/api/v1/servers/{server_id}/credentials", "Save per-user credentials for a server."),
        ],
    },
    {
        "title": "Access and Connections",
        "description": "Request access and create MCP connection links for approved users.",
        "endpoints": [
            ("POST", "/api/v1/servers/{server_id}/request", "Request access to a server."),
            ("GET", "/api/v1/requests/mine", "List the current user's access requests."),
            ("GET", "/api/v1/requests", "Admin list of access requests."),
            ("POST", "/api/v1/requests/{request_id}/approve", "Approve an access request."),
            ("POST", "/api/v1/requests/{request_id}/deny", "Deny an access request."),
            ("POST", "/api/v1/servers/{server_id}/assign/{user_id}", "Admin pre-assign a user to a server."),
            ("GET", "/api/v1/servers/{server_id}/members", "List users with server access."),
            ("DELETE", "/api/v1/servers/{server_id}/members/{user_id}", "Revoke a user's server access."),
            ("GET", "/api/v1/connections", "List MCP connection links."),
            ("POST", "/api/v1/connections", "Create a per-user MCP connection link."),
            ("DELETE", "/api/v1/connections/{connection_id}", "Revoke a connection link."),
            ("GET", "/api/v1/connections/config/claude-desktop", "Generate Claude Desktop MCP config."),
        ],
    },
    {
        "title": "Catalog and OAuth",
        "description": "Browse the registry and authorize upstream OAuth-backed MCP servers.",
        "endpoints": [
            ("GET", "/api/v1/registry", "List registry entries."),
            ("GET", "/api/v1/registry/categories", "List registry categories."),
            ("GET", "/api/v1/registry/{server_id}", "Get one registry entry."),
            ("GET", "/api/v1/oauth/{server_id}/authorize", "Start upstream OAuth for a server."),
            ("GET", "/api/v1/oauth/callback", "OAuth callback for configured providers."),
            ("GET", "/api/v1/oauth/{server_id}/mcp-authorize", "Start OAuth discovered from a remote MCP server."),
            ("GET", "/api/v1/oauth/mcp-callback", "Callback for remote MCP OAuth providers."),
            ("GET", "/api/v1/oauth/{server_id}/token-status", "Check provider OAuth token status."),
            ("POST", "/api/v1/oauth/{server_id}/disconnect", "Disconnect provider OAuth token."),
            ("DELETE", "/api/v1/oauth/{server_id}/token", "Delete provider OAuth token."),
            ("POST", "/api/v1/oauth/{server_id}/refresh", "Refresh provider OAuth token."),
            ("GET", "/api/v1/oauth/{server_id}/mcp-token-status", "Check remote MCP OAuth token status."),
        ],
    },
    {
        "title": "Gateway",
        "description": "Operational settings and health.",
        "endpoints": [
            ("GET", "/health", "Health check."),
            ("GET", "/api/v1/gateway/stats", "Dashboard gateway stats."),
            ("GET", "/api/v1/gateway/config", "Read gateway display/public URL settings."),
            ("POST", "/api/v1/gateway/config", "Update gateway display/public URL settings."),
            ("GET", "/api/v1/smtp", "Read outbound email settings."),
            ("POST", "/api/v1/smtp", "Update outbound email settings."),
            ("POST", "/api/v1/smtp/test", "Send an SMTP test email."),
        ],
    },
    {
        "title": "Activity, Policies, and Users",
        "description": "Admin-facing endpoints for audit history, access policies, and user management.",
        "endpoints": [
            ("GET", "/api/v1/audit", "List activity and audit log events."),
            ("GET", "/api/v1/policies", "List access policies."),
            ("POST", "/api/v1/policies", "Create an access policy."),
            ("PATCH", "/api/v1/policies/{policy_id}", "Update an access policy."),
            ("DELETE", "/api/v1/policies/{policy_id}", "Delete an access policy."),
            ("PATCH", "/api/v1/policies/{policy_id}/toggle", "Enable or disable an access policy."),
            ("GET", "/api/v1/users", "List users."),
            ("PATCH", "/api/v1/users/{user_id}", "Update a user."),
            ("DELETE", "/api/v1/users/{user_id}", "Delete a user."),
        ],
    },
]


def _public_openapi_schema():
    if app.openapi_schema:
        return app.openapi_schema

    public_routes = [
        route
        for route in app.routes
        if getattr(route, "path", None) in PUBLIC_OPENAPI_PATHS
    ]
    schema = get_openapi(
        title="MCPlama Public API",
        version=settings.VERSION,
        description=(
            "Public MCPlama endpoints for setup, login, invite acceptance, "
            "catalog discovery, MCP client authorization, and MCP connections. "
            "Administrative and internal operational endpoints are intentionally omitted."
        ),
        routes=public_routes,
        tags=PUBLIC_OPENAPI_TAGS,
    )
    schema["tags"] = PUBLIC_OPENAPI_TAGS
    app.openapi_schema = schema
    return app.openapi_schema


def _docs_html() -> str:
    examples = {
        "POST /api/v1/auth/login": {
            "request": '{\n  "email": "admin@example.com",\n  "password": "correct-horse-battery"\n}',
            "response": '{\n  "access_token": "eyJ...",\n  "token_type": "bearer",\n  "user": {\n    "id": 1,\n    "email": "admin@example.com",\n    "role": "admin"\n  }\n}',
        },
        "POST /api/v1/auth/invite": {
            "request": '{\n  "email": "teammate@example.com",\n  "role": "member",\n  "send_email": true\n}',
            "response": '{\n  "id": 42,\n  "email": "teammate@example.com",\n  "role": "member",\n  "accepted": false,\n  "invite_url": "https://gateway.example.com/invite/..."\n}',
        },
        "POST /api/v1/servers": {
            "request": '{\n  "name": "GitHub",\n  "runtime": "npx",\n  "package": "@modelcontextprotocol/server-github",\n  "auth_mode": "per_user",\n  "user_config_schema": [\n    {"key": "GITHUB_PERSONAL_ACCESS_TOKEN", "label": "GitHub token", "type": "secret"}\n  ]\n}',
            "response": '{\n  "id": 7,\n  "name": "GitHub",\n  "slug": "github",\n  "runtime": "npx",\n  "status": "pending",\n  "is_enabled": true\n}',
        },
        "POST /api/v1/connections": {
            "request": '{\n  "server_id": 7,\n  "label": "GitHub for Claude"\n}',
            "response": '{\n  "id": 88,\n  "server_id": 7,\n  "token": "mcp_...",\n  "mcp_url": "https://gateway.example.com/connect/mcp_..."\n}',
        },
        "POST /api/v1/policies": {
            "request": '{\n  "name": "Block repo deletion",\n  "server_id": 7,\n  "policy_type": "tool_block",\n  "config": {"tools": ["delete_repository"]},\n  "action": "block"\n}',
            "response": '{\n  "id": 12,\n  "name": "Block repo deletion",\n  "policy_type": "tool_block",\n  "is_enabled": true\n}',
        },
        "GET /api/v1/audit": {
            "request": 'GET /api/v1/audit?limit=20&status=error',
            "response": '[\n  {\n    "id": 1001,\n    "action": "mcp.call",\n    "server_name": "GitHub",\n    "tool": "create_issue",\n    "status_code": 200,\n    "latency_ms": 184\n  }\n]',
        },
    }

    nav = []
    sections = []
    for i, group in enumerate(DOC_GROUPS, start=1):
        gid = group["title"].lower().replace(" and ", "-").replace(",", "").replace(" ", "-")
        nav.append(f'<a href="#{gid}">{group["title"]}</a>')
        endpoint_blocks = []
        for method, path, summary in group["endpoints"]:
            key = f"{method} {path}"
            example = examples.get(key)
            example_html = ""
            if example:
                example_html = (
                    '<div class="example-grid">'
                    '<div><h4>Request</h4><pre class="code">' + example["request"] + '</pre></div>'
                    '<div><h4>Response</h4><pre class="code">' + example["response"] + '</pre></div>'
                    '</div>'
                )
            endpoint_blocks.append(
                f'<article class="endpoint-card">'
                f'<div class="endpoint-head"><span class="method {method.lower()}">{method}</span><code>{path}</code></div>'
                f'<p>{summary}</p>'
                f'{example_html}'
                f'</article>'
            )
        sections.append(
            f'<section class="doc-section" id="{gid}">'
            f'<h2><span class="num">{i}</span>{group["title"]}</h2>'
            f'<p class="section-copy">{group["description"]}</p>'
            f'<div class="endpoint-list">{"".join(endpoint_blocks)}</div>'
            f'</section>'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCPlama API Documentation</title>
<style>
  :root {{
    color-scheme: light dark;
    --bg: #f8fafc;
    --surface: #ffffff;
    --card: #ffffff;
    --text: #101828;
    --muted: #667085;
    --border: #e4e7ec;
    --border2: #d0d5dd;
    --accent: #465fff;
    --green: #039855;
    --orange: #dc6803;
    --red: #d92d20;
    --purple: #6941c6;
    --code-bg: #0b1220;
    --code-text: #e6edf7;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #0b1220;
      --surface: #111827;
      --card: #151f2f;
      --text: #f8fafc;
      --muted: #98a2b3;
      --border: #253141;
      --border2: #344054;
      --code-bg: #050814;
      --code-text: #e6edf7;
    }}
  }}
  * {{ box-sizing: border-box; }}
  html {{ scroll-behavior: smooth; }}
  body {{
    margin: 0;
    background:
      radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 28rem),
      var(--bg);
    color: var(--text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6;
  }}
  a {{ color: inherit; text-decoration: none; }}
  .wrap {{ max-width: 1180px; margin: 0 auto; padding: 0 28px; }}
  .doc-nav {{ position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: blur(16px); }}
  .doc-nav-inner {{ height: 64px; display: flex; align-items: center; justify-content: space-between; }}
  .brand {{ font-weight: 800; letter-spacing: -0.01em; }}
  .nav-actions {{ display: flex; gap: 10px; align-items: center; }}
  .btn {{ display: inline-flex; align-items: center; min-height: 38px; padding: 8px 13px; border-radius: 8px; border: 1px solid var(--border2); font-size: 14px; font-weight: 650; background: color-mix(in srgb, var(--surface) 82%, transparent); }}
  .btn.primary {{ border-color: var(--accent); background: var(--accent); color: #fff; }}
  .hero {{ padding: 74px 0 44px; }}
  .eyebrow {{ display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 82%, transparent); color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }}
  h1 {{ max-width: 840px; margin: 18px 0 0; font-size: clamp(38px, 5vw, 64px); line-height: 1.02; letter-spacing: -0.025em; }}
  .lead {{ max-width: 760px; margin: 18px 0 0; color: var(--muted); font-size: 17px; }}
  .quick-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 28px; max-width: 900px; }}
  .quick-grid a {{ display: grid; gap: 5px; min-height: 96px; padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--surface) 90%, transparent); }}
  .quick-grid strong {{ font-size: 14px; }}
  .quick-grid span {{ color: var(--muted); font-size: 13px; }}
  .doc-body {{ padding: 34px 0 70px; }}
  .docs-layout {{ display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 30px; align-items: start; }}
  .docs-toc {{ position: sticky; top: 86px; display: grid; gap: 8px; padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--surface) 90%, transparent); }}
  .docs-toc h5 {{ margin: 0 0 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }}
  .docs-toc a {{ padding: 7px 8px; border-radius: 6px; color: var(--muted); font-size: 13px; }}
  .docs-toc a:hover {{ background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text); }}
  .docs-content {{ display: grid; gap: 18px; }}
  .doc-section {{ scroll-margin-top: 86px; padding: 24px; border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--surface) 92%, transparent); }}
  h2 {{ display: flex; align-items: center; gap: 10px; margin: 0; font-size: 24px; letter-spacing: -0.01em; }}
  .num {{ display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 800; }}
  .section-copy {{ margin: 10px 0 18px; color: var(--muted); }}
  .endpoint-list {{ display: grid; gap: 12px; }}
  .endpoint-card {{ border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--card) 94%, transparent); padding: 15px; }}
  .endpoint-head {{ display: flex; align-items: center; gap: 10px; min-width: 0; }}
  .endpoint-head code {{ overflow-wrap: anywhere; font-size: 13px; font-weight: 700; color: var(--text); }}
  .endpoint-card p {{ margin: 9px 0 0; color: var(--muted); font-size: 14px; }}
  .method {{ display: inline-flex; justify-content: center; min-width: 64px; border-radius: 6px; padding: 4px 7px; color: #fff; font-weight: 800; font-size: 11px; letter-spacing: .04em; }}
  .get {{ background: var(--green); }} .post {{ background: var(--accent); }} .patch {{ background: var(--orange); }} .delete {{ background: var(--red); }} .put {{ background: var(--purple); }}
  .example-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }}
  .example-grid h4 {{ margin: 0 0 7px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }}
  .code {{ margin: 0; min-height: 84px; overflow: auto; border-radius: 8px; background: var(--code-bg); color: var(--code-text); padding: 13px; font-size: 12.5px; line-height: 1.55; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
  .note {{ color: var(--muted); font-size: 13px; margin-top: 12px; }}
  @media (max-width: 960px) {{ .docs-layout {{ grid-template-columns: 1fr; }} .docs-toc {{ position: static; }} .quick-grid, .example-grid {{ grid-template-columns: 1fr; }} }}
</style>
</head>
<body>
  <nav class="doc-nav">
    <div class="wrap doc-nav-inner">
      <a class="brand" href="/docs">MCPlama API</a>
      <div class="nav-actions">
        <a class="btn" href="/openapi.json">OpenAPI JSON</a>
        <a class="btn primary" href="/swagger">Interactive tester</a>
      </div>
    </div>
  </nav>
  <header class="hero">
    <div class="wrap">
      <span class="eyebrow">API Documentation</span>
      <h1>Build against the MCPlama gateway API.</h1>
      <p class="lead">Use these app-facing endpoints to manage MCP servers, invite teammates, grant access, create connection links, configure policies, and inspect activity. Low-level MCP protocol routes are intentionally omitted here.</p>
      <div class="quick-grid">
        <a href="#mcp-servers"><strong>MCP Servers</strong><span>Create, update, test, and manage server credentials.</span></a>
        <a href="#access-connections"><strong>Access</strong><span>Request, approve, assign, and create connection links.</span></a>
        <a href="#activity-policies-users"><strong>Admin</strong><span>Audit activity, policies, and users.</span></a>
      </div>
    </div>
  </header>
  <div class="doc-body">
    <div class="wrap docs-layout">
      <aside class="docs-toc">
        <h5>Sections</h5>
        {"".join(nav)}
      </aside>
      <main class="docs-content">
        {"".join(sections)}
        <section class="doc-section" id="schema">
          <h2><span class="num">S</span>Schema and Testing</h2>
          <p class="section-copy">The examples above cover common request and response shapes. For full generated schemas, use the OpenAPI document. For direct endpoint execution, use the interactive tester.</p>
          <p><a class="btn" href="/openapi.json">OpenAPI JSON</a> <a class="btn primary" href="/swagger">Interactive tester</a></p>
        </section>
      </main>
    </div>
  </div>
</body>
</html>"""


@app.get("/openapi.json", include_in_schema=False)
async def public_openapi_json(_: User = Depends(get_current_user)):
    return _public_openapi_schema()


@app.get("/docs", include_in_schema=False)
async def docs_page(_: User = Depends(get_current_user)):
    return HTMLResponse(_docs_html())


@app.get("/redoc", include_in_schema=False)
async def docs_alias(_: User = Depends(get_current_user)):
    return HTMLResponse(_docs_html())


@app.get("/swagger", include_in_schema=False)
async def swagger_ui(_: User = Depends(get_current_user)):
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="MCPlama API Tester",
        oauth2_redirect_url="/docs/oauth2-redirect",
    )


@app.get("/health")
async def health():
    from app.services.container_manager import list_running
    containers = await list_running()
    return {
        "status": "ok",
        "version": settings.VERSION,
        "app": settings.APP_NAME,
        "running_containers": len(containers),
    }


@app.get("/api/v1/containers")
async def list_containers(_: "User" = Depends(require_admin)):
    from app.services.container_manager import list_running
    return await list_running()


@app.get("/api/v1/debug/docker")
async def debug_docker(_: "User" = Depends(require_admin)):
    # This process cannot reach the Docker socket — ask the broker.
    from app.services.container_manager import docker_info
    info = await docker_info()
    info.setdefault("error", None)
    return info

@app.get("/api/v1/r/debug")
async def debug_registry(_: "User" = Depends(require_admin)):
    import urllib.request, urllib.error, json
    url = settings.REGISTRY_URL  # or hardcode to test
    result = {"url": url, "status": None, "error": None, "raw_preview": None, "parsed_count": None}
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            result["status"] = resp.status
            raw = resp.read().decode()
            result["raw_preview"] = raw[:500]
            parsed = json.loads(raw)
            result["parsed_count"] = len(parsed) if isinstance(parsed, list) else f"not a list: {type(parsed)}"
    except Exception as e:
        result["error"] = str(e)
    return result
