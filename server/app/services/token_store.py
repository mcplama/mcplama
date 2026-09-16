# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.server_token import ServerToken
from app.core.encryption import encrypt, decrypt


def _ctx(field: str, server_id: int, user_id: Optional[int]) -> str:
    return f"server_token:{server_id}:{user_id}:{field}"


async def save_token(
    db: AsyncSession,
    server_id: int,
    user_id: Optional[int],
    access_token: str,
    refresh_token: Optional[str] = None,
    expires_at: Optional[datetime] = None,
    scope: Optional[str] = None,
):
    result = await db.execute(
        select(ServerToken).where(and_(ServerToken.server_id == server_id, ServerToken.user_id == user_id))
    )
    existing = result.scalar_one_or_none()

    enc_access = encrypt(access_token, _ctx("access_token", server_id, user_id))
    enc_refresh = encrypt(refresh_token, _ctx("refresh_token", server_id, user_id)) if refresh_token else None

    if existing:
        existing.access_token = enc_access
        existing.refresh_token = enc_refresh
        existing.expires_at = expires_at
        existing.scope = scope
        existing.connected_at = datetime.utcnow()
    else:
        token = ServerToken(
            server_id=server_id,
            user_id=user_id,
            access_token=enc_access,
            refresh_token=enc_refresh,
            expires_at=expires_at,
            scope=scope,
        )
        db.add(token)
    await db.commit()


async def get_token(db: AsyncSession, server_id: int, user_id: Optional[int]) -> Optional[ServerToken]:
    result = await db.execute(
        select(ServerToken).where(and_(ServerToken.server_id == server_id, ServerToken.user_id == user_id))
    )
    token = result.scalar_one_or_none()
    if token and token.access_token:
        token.access_token = decrypt(token.access_token, _ctx("access_token", server_id, user_id))
        if token.refresh_token:
            token.refresh_token = decrypt(token.refresh_token, _ctx("refresh_token", server_id, user_id))
    return token


async def delete_token(db: AsyncSession, server_id: int, user_id: Optional[int]):
    result = await db.execute(
        select(ServerToken).where(and_(ServerToken.server_id == server_id, ServerToken.user_id == user_id))
    )
    token = result.scalar_one_or_none()
    if token:
        await db.delete(token)
        await db.commit()


async def get_status(db: AsyncSession, server_id: int, user_id: Optional[int]) -> str:
    token = await get_token(db, server_id, user_id)
    if not token:
        return "not_connected"
    if token.expires_at and datetime.utcnow() > token.expires_at:
        return "expired"
    return "connected"
