from quart import Quart, g, jsonify, request
from quart.helpers import make_response

from app.db import SessionLocal
from app.models import Basin, Filature
from app.repositories import BasinRepo, UserRepo
from app.security import make_token, parse_token, verify_password
from app.services import (
    RuleError,
    StaleRegistration,
    assert_can_register,
    assert_can_set_status,
    latest_temp,
)

app = Quart(__name__)


def _bearer() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


@app.before_request
async def load_user():
    g.user = None
    token = _bearer()
    if not token:
        return
    username = parse_token(token)
    if not username:
        return
    async with SessionLocal() as session:
        g.user = await UserRepo(session).by_username(username)


def require_user():
    if g.user is None:
        return jsonify({"detail": "未登录"}), 401
    return None


@app.route("/api/health")
async def health():
    return {"status": "ok", "service": "SilkReel"}


@app.route("/api/auth/login", methods=["POST"])
async def login():
    body = await request.get_json(force=True)
    username = (body or {}).get("username", "")
    password = (body or {}).get("password", "")
    async with SessionLocal() as session:
        user = await UserRepo(session).by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            return jsonify({"detail": "用户名或密码错误"}), 401
        return {
            "access_token": make_token(user.username),
            "user": {"username": user.username, "role": user.role},
        }


@app.route("/api/auth/me")
async def me():
    denied = require_user()
    if denied:
        return denied
    return {"username": g.user.username, "role": g.user.role}


def _basin_json(basin: Basin) -> dict:
    return {
        "id": basin.id,
        "code": basin.code,
        "status": basin.status,
        "ringIndex": basin.ring_index,
        "latestTempC": latest_temp(basin),
        "readingCount": len(basin.readings or []),
        "readingVersion": basin.reading_version,
    }


@app.route("/api/board")
async def board():
    denied = require_user()
    if denied:
        return denied
    async with SessionLocal() as session:
        mill = await BasinRepo(session).board()
        if mill is None:
            return jsonify({"detail": "尚无缫丝坞"}), 404
        basins = sorted(mill.basins, key=lambda b: b.ring_index)
        return {
            "filature": mill.name,
            "riverside": mill.riverside,
            "basins": [_basin_json(b) for b in basins],
        }


@app.route("/api/dropped-ends")
async def dropped_ends():
    """落绪累计专页：按盆列出落绪次数（汤温记录条数）。"""
    denied = require_user()
    if denied:
        return denied
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        filature_id = await repo.first_filature_id()
        if filature_id is None:
            return jsonify({"detail": "尚无缫丝坞"}), 404
        basins = await repo.basins_flat(filature_id)
        mill = await session.get(Filature, filature_id)
        counts = await repo.dropped_end_counts(filature_id)
        return {
            "filature": mill.name,
            "basins": [
                {
                    "id": b.id,
                    "code": b.code,
                    "status": b.status,
                    "droppedEnds": counts.get(b.id, 0),
                }
                for b in basins
            ],
            "total": sum(counts.get(b.id, 0) for b in basins),
        }


@app.route("/api/basins/<int:basin_id>/readings", methods=["POST"])
async def add_reading(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await request.get_json(force=True)
    try:
        temp = float((body or {}).get("waterTempC"))
    except (TypeError, ValueError):
        return jsonify({"detail": "汤温必须是数字"}), 400
    raw_version = (body or {}).get("expectedVersion")
    try:
        expected_version = None if raw_version is None else int(raw_version)
    except (TypeError, ValueError):
        return jsonify({"detail": "落绪版号无效"}), 400
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        basin = await repo.lock_for_reading(basin_id)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_register(basin, expected_version)
        except StaleRegistration as exc:
            await session.rollback()
            return jsonify({"detail": str(exc)}), 409
        await repo.add_reading(basin, temp, g.user.username)
        basin = await repo.get(basin_id)
        return _basin_json(basin)


@app.route("/api/basins/<int:basin_id>/status", methods=["POST"])
async def set_status(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await request.get_json(force=True)
    status = (body or {}).get("status", "")
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        basin = await repo.get(basin_id)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_set_status(basin, status)
        except RuleError as exc:
            return jsonify({"detail": str(exc)}), 400
        await repo.save_status(basin, status)
        basin = await repo.get(basin_id)
        return _basin_json(basin)
