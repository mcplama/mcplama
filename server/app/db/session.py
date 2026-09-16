# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Bring the schema up to date. Runs `alembic upgrade head` as a
    subprocess — Alembic's own async support expects to own the event loop,
    which conflicts with running inside FastAPI's already-running loop here.
    """
    import asyncio
    import os
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parents[2]
    proc = await asyncio.create_subprocess_exec(
        "alembic", "upgrade", "head",
        cwd=str(backend_dir),
        env=os.environ.copy(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output = (await proc.stdout.read()).decode()
    await proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"alembic upgrade head failed:\n{output}")
