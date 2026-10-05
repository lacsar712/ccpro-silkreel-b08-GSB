from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Basin, BathReading, Filature, User


class UserRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def by_username(self, username: str) -> User | None:
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()


class BasinRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def board(self) -> Filature | None:
        result = await self.session.execute(
            select(Filature).options(
                selectinload(Filature.basins).selectinload(Basin.readings)
            )
        )
        return result.scalars().first()

    async def get(self, basin_id: int) -> Basin | None:
        result = await self.session.execute(
            select(Basin)
            .options(selectinload(Basin.readings))
            .where(Basin.id == basin_id)
        )
        return result.scalar_one_or_none()

    async def lock_for_reading(self, basin_id: int) -> Basin | None:
        """锁住盆行再登记，两名工并发时第二人排在锁后，读到的是已加过的版号。"""
        result = await self.session.execute(
            select(Basin).where(Basin.id == basin_id).with_for_update()
        )
        basin = result.scalar_one_or_none()
        if basin is None:
            return None
        # 兜底窗口要看到最新一条汤温；显式再查一次，不依赖身份映射里的旧状态。
        await self.session.refresh(basin, attribute_names=["readings"])
        return basin

    async def add_reading(self, basin: Basin, temp_c: float, operator: str) -> BathReading:
        row = BathReading(basin=basin, water_temp_c=temp_c, operator=operator)
        basin.reading_version += 1
        self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        return row

    async def save_status(self, basin: Basin, status: str) -> None:
        basin.status = status
        await self.session.commit()

    async def dropped_end_counts(self, filature_id: int) -> dict[int, int]:
        """按盆统计汤温条数——落绪次数的唯一出处，角标与专页同数。"""
        result = await self.session.execute(
            select(Basin.id, func.count(BathReading.id))
            .outerjoin(BathReading, BathReading.basin_id == Basin.id)
            .where(Basin.filature_id == filature_id)
            .group_by(Basin.id)
        )
        return {basin_id: count for basin_id, count in result.all()}

    async def basins_flat(self, filature_id: int) -> list[Basin]:
        """只要盆位本身（号、态、序），不装汤温明细。"""
        result = await self.session.execute(
            select(Basin)
            .where(Basin.filature_id == filature_id)
            .order_by(Basin.ring_index)
        )
        return list(result.scalars().all())

    async def first_filature_id(self) -> int | None:
        result = await self.session.execute(select(Filature.id))
        return result.scalars().first()
