"""缫丝盆门槛：标成已缫完须最近一次汤温落在 38～42℃。"""

from datetime import datetime, timedelta, timezone

from app.models import Basin

MIN_TEMP = 38.0
MAX_TEMP = 42.0

# 未带版本号的裸登记（只可能来自两名工同时点下的在途窗口）：
# 1 秒内同盆已有一条汤温，即判为同一次落绪的重复登记，只入一条。
DUP_WINDOW = timedelta(seconds=1)


class RuleError(ValueError):
    pass


class StaleRegistration(RuleError):
    """两名工交叉登记同一次落绪：后到的一条基于旧版号，不许入库。"""


def latest_temp(basin: Basin) -> float | None:
    if not basin.readings:
        return None
    latest = max(basin.readings, key=lambda r: r.taken_at)
    return latest.water_temp_c


def assert_can_register(
    basin: Basin, expected_version: int | None, now: datetime | None = None
) -> None:
    """登记汤温前的落绪去重门槛。

    expected_version 是登记人看到角标时盆上的 reading_version：
    两名工看的是同一次落绪前的版号，先到的入库并把版号加 1，
    后到的 expected_version 落在当前版号之后 → StaleRegistration。
    """
    if expected_version is not None:
        if expected_version != basin.reading_version:
            raise StaleRegistration("该盆落绪次数已被另一人登记，本条不重复入库")
        return
    moment = now or datetime.now(timezone.utc)
    recent = [
        r
        for r in (basin.readings or [])
        if r.taken_at is not None and moment - _aware(r.taken_at) < DUP_WINDOW
    ]
    if recent:
        raise StaleRegistration("该盆刚登记过落绪，本条不重复入库")


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def assert_can_set_status(basin: Basin, new_status: str) -> None:
    allowed = {Basin.STATUS_SOAKING, Basin.STATUS_REELING, Basin.STATUS_REELED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Basin.STATUS_REELED:
        return
    temp = latest_temp(basin)
    if temp is None:
        raise RuleError("该盆尚无汤温记录，不能标已缫完")
    if temp < MIN_TEMP or temp > MAX_TEMP:
        raise RuleError(
            f"最近汤温 {temp}℃ 不在 {MIN_TEMP:.0f}～{MAX_TEMP:.0f}℃，不能标已缫完"
        )
