# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import asyncio
import os
import sys
from app.db.session import AsyncSessionLocal, init_db
from app.models.user import User, UserRole
from app.core.security import hash_password
from sqlalchemy import select


async def seed():
    email = os.environ.get("SEED_ADMIN_EMAIL")
    password = os.environ.get("SEED_ADMIN_PASSWORD")
    if not email or not password:
        sys.exit(
            "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set — "
            "there is no default admin account. "
            "e.g. SEED_ADMIN_EMAIL=me@example.com SEED_ADMIN_PASSWORD=... python -m app.db.seed"
        )

    await init_db()
    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(User).where(User.email == email))
        if not existing.scalar_one_or_none():
            admin = User(
                email=email,
                name="Admin",
                hashed_password=hash_password(password),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(admin)
            await db.commit()
            print(f"Seeded admin user: {email}")
        else:
            print(f"Admin user {email} already exists — nothing to do")


if __name__ == "__main__":
    asyncio.run(seed())
