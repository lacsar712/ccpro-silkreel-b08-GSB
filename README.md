# SilkReel-01 · 江口缫丝坞

缫丝盆环状作业台。登录后看到的是沿汤池围成一圈的盆位，点盆登记汤温并改状态——不是侧栏双列表 CRUD。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Quart（异步 Flask 族）· Hypercorn |
| 结构 | `repositories.py` 仓储 + `services.py` 门槛，路由不直接拼 SQL |
| 数据 | SQLAlchemy 2 async · asyncpg · PostgreSQL 15 |
| 前端 | Preact 10 · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4760
- API：http://localhost:8760
- PostgreSQL：localhost:6160

## 演示账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `123456` | 管理员 |
| `worker` | `123456` | 缫丝工 |

## 业务规则

盆状态不可标成「已缫完」，除非该盆**最近一条**汤温记录落在 **38～42℃**。规则在 `backend/app/services.py`。

每盆挂一个**落绪次数角标**，次数 = 该盆汤温记录条数（空盆为 0，按库现算）。顶栏可进「环盆作业台」与「落绪累计」专页，专页按盆列出同一数字，两边差恒为 0——登记汤温后两侧一起重取，只刷一侧不算完成。改盆态不涉及这条角标规矩。

两名工交叉给同一盆各登一条汤温时，盆级咨询锁（`pg_try_advisory_xact_lock`）只放行一笔入库，另一笔回 409，角标与累计专页都只加 1。

- `GET /api/drops`：落绪累计专页数据，按盆给出 `dropCount` 与合计。

## 快速启动

```bash
cd SilkReel/SilkReel-01
docker compose up --build
```
