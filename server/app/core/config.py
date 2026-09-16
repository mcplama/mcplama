# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import logging
import os
from pydantic_settings import BaseSettings
from typing import ClassVar, List

_DEF_SECRET = "dev-secret-change-in-production"
_DEF_ENC_KEY = "dev-encryption-key-32-chars-min!"


class Settings(BaseSettings):
    APP_NAME: str = "MCPlama"
    VERSION: str = "1.0.0"
    # Set ENVIRONMENT=production to make the default-secret check fatal instead
    # of a warning.
    ENVIRONMENT: str = "development"
    DATABASE_URL: str = "postgresql+asyncpg://mcplama:mcplama_secret@localhost:5432/mcplama"
    SECRET_KEY: str = _DEF_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    TOKEN_ENCRYPTION_KEY: str = _DEF_ENC_KEY
    GATEWAY_URL: str = "http://localhost:8000"
    REGISTRY_URL: str = "https://raw.githubusercontent.com/mcplama/mcplama/refs/heads/main/registry.json"
    FRONTEND_URL: str = "http://localhost:5173"   
    REGISTRY_LOCAL_PATH: str = "./registry"
    CORS_ORIGINS: str = "http://localhost:5173"
    # Extra hostnames/IPs (besides localhost/127.0.0.1/private LAN addresses, which are
    # always trusted) allowed to appear in the incoming Host header when deriving the
    # gateway's externally-visible base URL — e.g. a public domain in production.
    ALLOWED_GATEWAY_HOSTS: str = ""
    # Comma-separated exact hostnames/IPs allowed for trusted internal webhooks.
    # Empty by default; all private webhook destinations remain blocked.
    ALLOWED_PRIVATE_WEBHOOK_HOSTS: str = ""
    # Community edition caps. ClassVar, not a pydantic field — deliberately NOT
    # environment-configurable, so a self-hosted deployment can't lift them by
    # passing -e MAX_USERS=0. <= 0 means unlimited (used by the Enterprise build).
    MAX_USERS: ClassVar[int] = 10
    MAX_SERVERS: ClassVar[int] = 100

    @property
    def cors_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def allowed_gateway_hosts_list(self) -> List[str]:
        return [h.strip().lower() for h in self.ALLOWED_GATEWAY_HOSTS.split(",") if h.strip()]

    @property
    def allowed_private_webhook_hosts(self) -> set[str]:
        return {h.strip().lower() for h in self.ALLOWED_PRIVATE_WEBHOOK_HOSTS.split(",") if h.strip()}

    class Config:
        env_file = ".env"


settings = Settings()

# The bundled image serves the dashboard and API from the same origin as
# GATEWAY_URL and never sets FRONTEND_URL (see deploy/entrypoint.sh) — so an
# unset FRONTEND_URL should follow GATEWAY_URL rather than fall back to the
# packaged dev default (localhost:5173), which would send OAuth/mcp-authorize
# redirects to the wrong host entirely.
if "FRONTEND_URL" not in os.environ:
    settings.FRONTEND_URL = settings.GATEWAY_URL

_log = logging.getLogger(__name__)

_insecure_defaults = []
if settings.SECRET_KEY == _DEF_SECRET:
    _insecure_defaults.append("SECRET_KEY")
if settings.TOKEN_ENCRYPTION_KEY == _DEF_ENC_KEY:
    _insecure_defaults.append("TOKEN_ENCRYPTION_KEY")

if _insecure_defaults:
    _names = ", ".join(_insecure_defaults)
    if settings.ENVIRONMENT.lower() in ("production", "prod"):
        # Refuse to boot rather than sign JWTs and encrypt stored credentials
        # with a value that is published in the source tree. A log warning is
        # not a control — nobody reads startup logs.
        raise RuntimeError(
            f"Refusing to start: {_names} still set to the default dev value(s) "
            f"while ENVIRONMENT=production. Generate secrets and set them as env vars "
            f"(e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`)."
        )
    _log.warning(
        f"⚠️  {_names} using default dev value(s) — set them as env vars before "
        f"production use (startup will hard-fail when ENVIRONMENT=production)"
    )
