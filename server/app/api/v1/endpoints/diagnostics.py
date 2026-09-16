# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.api.v1.endpoints.auth import require_admin
from app.models.user import User
from app.services import container_manager as cm
from app.services.diagnostics import backend_logs, redact

diagnostics_router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@diagnostics_router.get("/logs")
async def diagnostic_logs(_: User = Depends(require_admin)):
    """Return a bounded, redacted diagnostic snapshot for an admin support report."""
    containers = []
    total_container_bytes = 0
    for container in (await cm.list_running())[:50]:
        name = container.get("Names") or container.get("name") or ""
        if not name or not name.startswith("mcplama-"):
            continue
        logs = redact((await cm.get_container_logs(name, tail=120))[-12000:])
        if total_container_bytes + len(logs) > 60000:
            logs = logs[:max(0, 60000 - total_container_bytes)]
        total_container_bytes += len(logs)
        containers.append({
            "name": redact(name),
            "image": redact(container.get("Image") or container.get("image") or ""),
            "logs": logs,
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "backend_logs": backend_logs()[-250:],
        "containers": containers,
        "notice": "Diagnostic data is bounded and credential-like values are redacted. Review before sending.",
    }
