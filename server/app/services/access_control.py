# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import select
from app.models.server_request import ServerRequest
from app.models.user_group import GroupMembership, GroupServerAccess


async def has_server_access(db, user_id: int, server_id: int) -> bool:
    direct = await db.execute(
        select(ServerRequest.id).where(
            ServerRequest.user_id == user_id,
            ServerRequest.server_id == server_id,
            ServerRequest.status == "approved",
        ).limit(1)
    )
    if direct.scalar_one_or_none() is not None:
        return True

    group_grant = await db.execute(
        select(GroupMembership.id)
        .join(GroupServerAccess, GroupServerAccess.group_id == GroupMembership.group_id)
        .where(GroupMembership.user_id == user_id, GroupServerAccess.server_id == server_id)
        .limit(1)
    )
    return group_grant.scalar_one_or_none() is not None
