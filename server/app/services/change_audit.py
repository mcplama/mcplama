# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from app.models.audit import ChangeAuditLog
from app.models.user import User


def record_change(
    db,
    actor: User,
    action: str,
    resource_type: str,
    *,
    resource_id=None,
    resource_name=None,
    server_id=None,
    server_name=None,
    fields=None,
    scopes=None,
    details=None,
    changes=None,
):
    """Queue a change summary; callers must never pass credential/config values."""
    meta = {
        "changed_fields": sorted(set(fields or [])),
        "credential_scopes": sorted(set(scopes or [])),
    }
    if details:
        meta["details"] = details
    if changes:
        meta["changes"] = changes
    db.add(ChangeAuditLog(
        user_id=actor.id,
        user_email=actor.email,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        resource_name=resource_name,
        server_id=server_id,
        server_name=server_name,
        meta=meta,
    ))
