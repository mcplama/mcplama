# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Policy Enforcer
--------------
Checks all active policies before forwarding a request to an MCP container.
Called from connect.py before every proxy call.

Returns: (allowed: bool, reason: str, mutated_body: bytes | None)
mutated_body is only ever set by a "webhook" policy that chose to rewrite the
request; every other policy type leaves it None, meaning "forward unchanged".
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_WEBHOOK_DEFAULT_TIMEOUT = 5
_WEBHOOK_MAX_TIMEOUT = 30


async def check_policies(
    db,
    server_id: int,
    user_id: int,
    user_role: str,
    tool_name: Optional[str],
    req_body: Optional[bytes],
) -> tuple[bool, str, Optional[bytes]]:
    """
    Check all applicable policies for this request.
    Returns (True, "", mutated_body) if allowed, (False, reason, None) if blocked.
    mutated_body is the request a webhook policy chose to rewrite, or None if
    nothing rewrote it — callers should forward the original body in that case.
    """
    from sqlalchemy import select, or_, and_
    from app.models.policy import Policy

    parsed_body = None
    if req_body:
        try:
            parsed_body = json.loads(req_body)
        except Exception:
            parsed_body = None

    # Extract tool name from body if not provided
    if not tool_name and parsed_body and parsed_body.get("method") == "tools/call":
        tool_name = parsed_body.get("params", {}).get("name")

    # Load applicable policies
    result = await db.execute(
        select(Policy).where(
            Policy.is_enabled == True,
            or_(
                Policy.server_id == server_id,
                Policy.server_id == None,
            ),
            or_(
                Policy.user_id == user_id,   # specific user match
                Policy.user_id == None,       # or applies to all users
            ),
            or_(
                Policy.role == user_role,
                Policy.role == None,
            ),
        )
    )
    policies = result.scalars().all()

    mutated_body: Optional[bytes] = None
    for policy in policies:
        allowed, reason, rewrite = await _check_policy(db, policy, user_id, server_id, tool_name, parsed_body)
        if not allowed:
            logger.warning(f"Policy '{policy.name}' blocked request: {reason}")
            return False, f"Policy '{policy.name}': {reason}", None
        if rewrite is not None:
            mutated_body = rewrite
            # Subsequent policies (tool_block/tool_allow/webhook) see the
            # rewritten request, not the original — reparse tool_name so a
            # webhook that changes the tool name is evaluated consistently.
            try:
                parsed_body = json.loads(rewrite)
                if parsed_body.get("method") == "tools/call":
                    tool_name = parsed_body.get("params", {}).get("name")
            except Exception:
                pass

    return True, "", mutated_body


async def _check_policy(
    db, policy, user_id: int, server_id: int, tool_name: Optional[str], parsed_body: Optional[dict]
) -> tuple[bool, str, Optional[bytes]]:
    cfg = policy.config or {}

    if policy.policy_type == "rate_limit":
        allowed, reason = await _check_rate_limit(db, user_id, server_id, cfg)
        return allowed, reason, None

    elif policy.policy_type == "tool_block":
        if not tool_name:
            return True, "", None
        blocked = cfg.get("tools", [])
        if tool_name in blocked:
            return False, f"Tool '{tool_name}' is blocked", None
        return True, "", None

    elif policy.policy_type == "tool_allow":
        if not tool_name:
            return True, "", None  # allow non-tool calls
        allowed_tools = cfg.get("tools", [])
        if allowed_tools and tool_name not in allowed_tools:
            return False, f"Tool '{tool_name}' is not in the allowed list", None
        return True, "", None

    elif policy.policy_type == "time_restrict":
        allowed, reason = _check_time_restrict(cfg)
        return allowed, reason, None

    elif policy.policy_type == "webhook":
        return await _check_webhook_policy(cfg, server_id, user_id, tool_name, parsed_body)

    return True, "", None


async def _check_webhook_policy(
    cfg: dict, server_id: int, user_id: int, tool_name: Optional[str], parsed_body: Optional[dict]
) -> tuple[bool, str, Optional[bytes]]:
    """
    Calls an admin-configured external webhook to allow/deny/mutate a tool
    call before it reaches the MCP server.

    Fails CLOSED on any transport error, timeout, non-2xx, or malformed
    response — an enforcer that silently passes traffic through on an
    unhandled error is not an enforcer (same philosophy as the rest of this
    file and connect.py::_check_policies).
    """
    import httpx
    from app.core.ssrf import validate_remote_url
    from app.core.config import settings

    url = cfg.get("url")
    if not url:
        logger.error("Webhook policy has no url configured — denying (fail-closed)")
        return False, "Webhook policy is misconfigured (no url)", None

    timeout = min(cfg.get("timeout_seconds", _WEBHOOK_DEFAULT_TIMEOUT), _WEBHOOK_MAX_TIMEOUT)

    try:
        # Re-validate at call time, not just at policy-creation time — DNS can
        # resolve differently than it did when the webhook URL was saved
        # (TOCTOU / DNS rebinding), same reasoning as connect.py's remote-proxy
        # revalidation.
        await validate_remote_url(
            url,
            allowed_private_hosts=settings.allowed_private_webhook_hosts,
            private_url_hint=True,
        )

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url,
                json={
                    "server_id": server_id,
                    "user_id": user_id,
                    "tool_name": tool_name,
                    "request": parsed_body,
                },
                headers=cfg.get("headers") or {},
            )
        if resp.status_code >= 300:
            return False, f"Webhook denied the request (status {resp.status_code})", None

        data = resp.json()
    except Exception as e:
        logger.error(f"Webhook policy call to {url} failed — denying (fail-closed): {e}")
        return False, "Policy webhook is unreachable, so this call was blocked", None

    if not isinstance(data, dict) or not data.get("allowed"):
        reason = data.get("reason", "Denied by webhook") if isinstance(data, dict) else "Malformed webhook response"
        return False, reason, None

    mutated_request = data.get("mutated_request")
    if mutated_request is not None:
        try:
            return True, "", json.dumps(mutated_request).encode()
        except Exception as e:
            logger.error(f"Webhook returned an unserializable mutated_request — denying (fail-closed): {e}")
            return False, "Policy webhook returned an invalid rewritten request", None

    return True, "", None


async def _check_rate_limit(db, user_id: int, server_id: int, cfg: dict) -> tuple[bool, str]:
    """
    Count this user's calls to this server inside the window.

    Counted straight off audit_logs rather than an in-process dict. Every
    proxied call already writes a `proxy.call` row (connect.py::_log), so the
    ledger is already there — and unlike the old counter it survives a restart
    and is shared by every worker/replica, so the configured limit is the limit
    that is actually enforced rather than the limit *per process*.
    """
    from sqlalchemy import select, func
    from app.models.audit import AuditLog

    limit = cfg.get("calls", 100)
    window = cfg.get("window_seconds", 3600)

    since = datetime.utcnow() - timedelta(seconds=window)
    used = (await db.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.user_id == user_id,
            AuditLog.server_id == server_id,
            AuditLog.action == "proxy.call",   # denials must not consume quota
            AuditLog.timestamp >= since,
        )
    )).scalar() or 0

    # The current call has not been logged yet, so `used` is the count *before*
    # it. Allowing exactly `limit` calls per window means denying once used has
    # already reached the limit.
    if used >= limit:
        return False, f"Rate limit exceeded: {limit} calls per {window}s"
    return True, ""


def _check_time_restrict(cfg: dict) -> tuple[bool, str]:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    tz_name = cfg.get("timezone", "UTC")
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception):
        tz = ZoneInfo("UTC")

    now = datetime.now(tz)
    allowed_days = cfg.get("days", [0, 1, 2, 3, 4])  # Mon-Fri
    start_str = cfg.get("start", "00:00")
    end_str = cfg.get("end", "23:59")

    if now.weekday() not in allowed_days:
        return False, f"Access not allowed on {now.strftime('%A')}"

    try:
        start_h, start_m = map(int, start_str.split(":"))
        end_h, end_m = map(int, end_str.split(":"))
        start = now.replace(hour=start_h, minute=start_m, second=0)
        end = now.replace(hour=end_h, minute=end_m, second=0)
    except (ValueError, AttributeError):
        logger.warning(f"Invalid time_restrict config: start={start_str!r} end={end_str!r}")
        return True, ""

    if not (start <= now <= end):
        return False, f"Access only allowed between {start_str} and {end_str} {tz_name}"

    return True, ""
