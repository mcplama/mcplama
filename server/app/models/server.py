# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, JSON, Text, Integer, Float, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base
import enum


class ServerStatus(str, enum.Enum):
    pending    = "pending"
    installing = "installing"
    running    = "running"
    stopped    = "stopped"
    error      = "error"


class AuthMode(str, enum.Enum):
    shared   = "shared"
    per_user = "per_user"
    none     = "none"


class Runtime(str, enum.Enum):
    docker = "docker"
    npx    = "npx"
    uvx    = "uvx"
    remote = "remote"   # existing HTTP proxy behaviour


class Server(Base):
    __tablename__ = "servers"

    id:          Mapped[int]           = mapped_column(primary_key=True, autoincrement=True)
    name:        Mapped[str]           = mapped_column(String(255))
    slug:        Mapped[str]           = mapped_column(String(255), unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    icon:        Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    color:       Mapped[Optional[str]] = mapped_column(String(32), default="gray")
    logo_url:         Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    remote_auth:        Mapped[Optional[str]] = mapped_column(String(32), nullable=True)    # none|bearer|header|oauth
    auth_header_name:   Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    auth_header_value:  Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    # Additional static headers merged into every proxied request to a "remote"
    # server, on top of whatever remote_auth already sets (Authorization/OAuth/
    # the single auth_header_name+value pair above). remote_auth can only ever
    # express one auth header; this is for servers that need more than one
    # (e.g. a Bearer token *and* a required tenant-ID header).
    # [{"key": "X-Tenant-Id", "value": "<encrypted>"}, ...]
    remote_headers:     Mapped[Optional[list]] = mapped_column(JSON, default=list)
    # OAuth 2.0 fields
    oauth_client_id:    Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    oauth_client_secret:Mapped[Optional[str]] = mapped_column(Text, nullable=True)        # should be encrypted
    oauth_auth_url:     Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    oauth_token_url:    Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    oauth_scopes:       Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    oauth_pkce:         Mapped[bool]           = mapped_column(default=True)               # use PKCE by default
    
    oauth_token_auth: Mapped[str] = mapped_column(String(16), nullable=False, server_default="basic")

    # ── Upstream MCP OAuth: dynamic client registration (RFC 7591) ────────────
    # Distinct from oauth_client_id/secret above, which an admin types in for
    # REST-style OAuth. These are issued to *us* by the upstream MCP server's
    # auth server when we self-register, and they must outlive the process:
    # refreshing a user's upstream token requires presenting the same client_id
    # the token was issued against. Cached only in memory, they were lost on
    # every restart, and refresh then fell back to a bogus client_id — silently
    # forcing every user to re-authorize.
    mcp_client_id:     Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    mcp_client_secret: Mapped[Optional[str]] = mapped_column(Text, nullable=True)   # encrypted

    # Presence-only flags for API responses — never serialize the encrypted
    # secret itself back to the client, just whether one is set. A blank
    # field on save is then treated as "leave unchanged", not "clear it".
    @property
    def has_auth_header_value(self) -> bool:
        return bool(self.auth_header_value)

    @property
    def has_oauth_client_secret(self) -> bool:
        return bool(self.oauth_client_secret)

    @property
    def remote_header_keys(self) -> list:
        """Header names only, for API responses — never the encrypted values."""
        return [h.get("key", "") for h in (self.remote_headers or []) if h.get("key")]

    @property
    def configured_user_config_keys(self) -> list:
        """Names of stored shared credentials, without exposing their values."""
        if not self.auth_config:
            return []
        try:
            from app.core.encryption import decrypt_dict
            config = decrypt_dict(self.auth_config, context_prefix=f"server:{self.id}:auth_config")
            return [key for key, value in config.items() if value]
        except Exception:
            # A malformed/undecryptable value should not make the server form
            # itself unavailable. The normal enable/test validation will still
            # report the missing configuration.
            return []

    @property
    def effective_mcp_path(self) -> str:
        """
        The HTTP path to send MCP requests to inside the container.

        Only docker-runtime servers can override this — npx/uvx always run
        through our supergateway wrapper, which normalizes every package to
        /mcp regardless of what the underlying package would otherwise expose.
        """
        if self.runtime == Runtime.docker and self.mcp_path:
            return self.mcp_path
        return "/mcp"


    category:    Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    registry_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    docs_url:    Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    version:     Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # ── Runtime ───────────────────────────────────────────────────────────────
    runtime:      Mapped[Runtime]       = mapped_column(SAEnum(Runtime), default=Runtime.remote)
    # docker: image name  e.g. "mcp/notion"
    docker_image: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # npx/uvx: package name  e.g. "@modelcontextprotocol/server-filesystem"
    package:      Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # npx/uvx: apt package names the server needs on top of the base sandbox
    # image (e.g. ["git"]) — installed via apt-get at container start so an
    # admin can unblock a server without building a custom Docker image.
    system_packages: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    # extra CLI args passed to the process  e.g. ["/data"]
    args:         Mapped[Optional[list]] = mapped_column(JSON, default=list)
    # args passed to docker run command e.g. ["--transport", "http", "--port", "3000"]
    docker_args:  Mapped[Optional[list]] = mapped_column(JSON, default=list)
    # port the container listens on internally (default 8000)
    container_port: Mapped[int] = mapped_column(Integer, default=8000)
    # docker only: HTTP path the image's MCP endpoint is mounted at, e.g.
    # "/api/mcp". npx/uvx always run through our supergateway wrapper, which
    # is always mounted at /mcp regardless of this field — see
    # effective_mcp_path below.
    mcp_path: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # per-server resource overrides, e.g. "1.5" / "512m" — clamped broker-side
    # against BROKER_MAX_CPU_LIMIT/BROKER_MEM_LIMIT, never honored as-is
    cpu_limit:    Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    memory_limit: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    # transport: http or stdio (stdio wraps with supergateway)
    transport: Mapped[Optional[str]] = mapped_column(String(16), default="http")
    # remote: URL for HTTP proxy  e.g. "https://mcp.example.com/mcp"
    url:          Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    # ── Auth ──────────────────────────────────────────────────────────────────
    auth_type:   Mapped[str]            = mapped_column(String(32), default="none")
    auth_mode:   Mapped[AuthMode]       = mapped_column(SAEnum(AuthMode), default=AuthMode.none)
    # shared credentials set by admin (encrypted)
    auth_config: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    # schema of what the user must supply e.g. [{"key":"NOTION_TOKEN","label":"Notion API Token","type":"secret"}]
    user_config_schema: Mapped[Optional[list]] = mapped_column(JSON, default=list)

    # ── State ─────────────────────────────────────────────────────────────────
    tools:        Mapped[Optional[list]] = mapped_column(JSON, default=list)
    status:       Mapped[ServerStatus]   = mapped_column(SAEnum(ServerStatus), default=ServerStatus.pending)
    is_enabled:   Mapped[bool]           = mapped_column(Boolean, default=True)
    is_published: Mapped[bool]           = mapped_column(Boolean, default=True)

    # ── Stats ─────────────────────────────────────────────────────────────────
    calls_today:    Mapped[int]   = mapped_column(Integer, default=0)
    calls_total:    Mapped[int]   = mapped_column(Integer, default=0)
    avg_latency_ms: Mapped[int]   = mapped_column(Integer, default=0)
    error_rate:     Mapped[float] = mapped_column(Float, default=0.0)

    created_at: Mapped[datetime]       = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime]       = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by: Mapped[Optional[int]]  = mapped_column(Integer, nullable=True)
