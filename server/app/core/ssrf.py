# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
SSRF guard for outbound requests to user-supplied remote MCP server URLs.
Used at server create/update time, again at proxy time, and before OAuth
discovery (DNS can resolve differently between any two of those — TOCTOU /
DNS-rebinding).

Fails closed: anything we cannot positively prove is a public address is
rejected, including hostnames that fail to resolve.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse
from fastapi import HTTPException


def is_ssrf_ip(ip_str: str) -> bool:
    """True if the address is anything other than a routable public address."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        # Not parseable as an IP — treat as unsafe rather than waving it through.
        return True

    # An IPv4-mapped IPv6 address (::ffff:127.0.0.1) reports False for
    # is_loopback/is_private on the IPv6 object — unwrap it to the v4 address
    # and classify that instead.
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped

    return (
        ip.is_private          # 10/8, 172.16/12, 192.168/16, 127/8, 0.0.0.0/8, fc00::/7, ...
        or ip.is_loopback
        or ip.is_link_local    # 169.254/16 (cloud metadata), fe80::/10
        or ip.is_reserved      # 240/4, and the IETF-reserved v6 space
        or ip.is_multicast
        or ip.is_unspecified   # 0.0.0.0, ::
        or ip in _CGNAT        # 100.64/10 — routable-looking, but carrier-internal
        or ip in _BENCHMARK    # 198.18/15
    )


_CGNAT = ipaddress.ip_network("100.64.0.0/10")
_BENCHMARK = ipaddress.ip_network("198.18.0.0/15")


async def validate_remote_url(
    url: str | None,
    *,
    allowed_private_hosts: set[str] | None = None,
    private_url_hint: bool = False,
) -> None:
    """
    Raise HTTPException(422) unless every address `url`'s hostname resolves to
    is a public, routable address.

    Deliberately fails closed: an unresolvable hostname, an unparseable URL, or
    a resolver error is a rejection, not a pass. A guard that opens on error is
    not a guard.
    """
    if not url:
        return

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(422, "Remote URL must use http or https scheme")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(422, "Remote URL must have a valid hostname")

    loop = asyncio.get_event_loop()
    try:
        infos = await loop.run_in_executor(None, socket.getaddrinfo, hostname, None)
    except socket.gaierror:
        raise HTTPException(422, f"Remote URL hostname ({hostname}) could not be resolved")
    except Exception:
        raise HTTPException(422, "Remote URL could not be validated")

    if not infos:
        raise HTTPException(422, f"Remote URL hostname ({hostname}) could not be resolved")

    for info in infos:
        ip_str = info[4][0]
        private_allowed = (
            hostname.lower() in (allowed_private_hosts or set())
            or ip_str.lower() in (allowed_private_hosts or set())
        )
        if is_ssrf_ip(ip_str) and not private_allowed:
            hint = (
                " Add the exact trusted host or IP to ALLOWED_PRIVATE_WEBHOOK_HOSTS."
                if private_url_hint else ""
            )
            raise HTTPException(
                422,
                f"Remote URL resolves to an internal address ({ip_str}) — "
                f"internal URLs are blocked for security reasons.{hint}",
            )
