from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import DATABASE_URL
from app.models import Base

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 旧库没有 reading_version 列时补列，并按现有汤温条数回填，
        # 让角标与累计专页在升级瞬间也与库里的落绪次数对齐。
        cols = await conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'basins' AND column_name = 'reading_version'"
            )
        )
        if cols.first() is None:
            await conn.execute(
                text("ALTER TABLE basins ADD COLUMN reading_version INTEGER NOT NULL DEFAULT 0")
            )
        await conn.execute(
            text(
                "UPDATE basins SET reading_version = ("
                "SELECT COUNT(*) FROM bath_readings WHERE bath_readings.basin_id = basins.id)"
            )
        )


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
