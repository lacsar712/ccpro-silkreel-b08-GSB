import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, clearToken, setToken, token } from "./api.js";
import "./app.css";

const STATUS_LABEL = { soaking: "浸茧", reeling: "缫丝中", reeled: "已缫完" };

function Login({ onOk }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456");
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(data.access_token);
      onOk();
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <div class="login">
      <h1>江口缫丝坞</h1>
      <p>汤温环盆作业台，不是列表台账。</p>
      <form onSubmit={submit} autocomplete="off">
        <label>
          用户名
          <input name="username" autocomplete="off" value={username} onInput={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          密码
          <input name="password" type="password" autocomplete="off" value={password} onInput={(e) => setPassword(e.target.value)} />
        </label>
        <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
        <button type="submit">登录</button>
      </form>
      {err && <p class="err">{err}</p>}
    </div>
  );
}

function logout() {
  clearToken();
  location.reload();
}

function TopBar({ title, subtitle, view, onNav }) {
  return (
    <div class="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <nav class="topnav">
        <button class={view === "yard" ? "active" : ""} onClick={() => onNav("yard")}>
          环盆作业台
        </button>
        <button class={view === "totals" ? "active" : ""} onClick={() => onNav("totals")}>
          落绪累计
        </button>
        <button onClick={logout}>退出</button>
      </nav>
    </div>
  );
}

function Yard({ view, onNav }) {
  const [board, setBoard] = useState(null);
  const [picked, setPicked] = useState(null);
  const [temp, setTemp] = useState("40");
  const [err, setErr] = useState("");

  async function refresh() {
    const data = await api("/api/board");
    setBoard(data);
    // 保持原有交互：未点盆前不自动开抽屉；点过则跟随库里最新数据
    setPicked((cur) =>
      cur ? data.basins.find((b) => b.id === cur.id) || null : null
    );
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  if (!board) {
    return (
      <div class="yard">
        <TopBar title="江口缫丝坞" view={view} onNav={onNav} />
        {err || "装载环盆…"}
      </div>
    );
  }

  const n = board.basins.length;
  async function writeTemp() {
    setErr("");
    try {
      // 带着看到角标时的落绪版号登记：两人同看一次落绪，只有先到的一条入库。
      const row = await api(`/api/basins/${picked.id}/readings`, {
        method: "POST",
        body: JSON.stringify({
          waterTempC: Number(temp),
          expectedVersion: picked.readingVersion,
        }),
      });
      // 登记落库后立即重拉环盆：角标与抽屉计数一起跟上库。
      await refresh();
      setPicked(row);
    } catch (ex) {
      if (ex.status === 409) {
        await refresh().catch(() => {});
      }
      setErr(ex.message);
    }
  }
  async function setStatus(status) {
    setErr("");
    try {
      const row = await api(`/api/basins/${picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await refresh();
      setPicked(row);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div class="yard">
      <TopBar
        title={board.filature}
        subtitle={`${board.riverside} · 点盆登记汤温；角标为落绪次数（汤温条数）；已缫完须最近汤温 38～42℃`}
        view={view}
        onNav={onNav}
      />
      <div class="ring">
        {board.basins.map((b, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const left = 50 + Math.cos(angle) * 38;
          const top = 50 + Math.sin(angle) * 38;
          return (
            <button
              key={b.id}
              class={`basin ${b.status}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              onClick={() => setPicked(b)}
            >
              <strong>{b.code}</strong>
              <span>{STATUS_LABEL[b.status]}</span>
              <span class="badge" title={`落绪 ${b.readingCount ?? 0} 次`}>
                {b.readingCount ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      {picked && (
        <div class="drawer">
          <h3>
            {picked.code} · {STATUS_LABEL[picked.status]}
          </h3>
          <p>最近汤温：{picked.latestTempC ?? "无"} ℃ · 落绪 {picked.readingCount ?? 0} 次</p>
          <input value={temp} onInput={(e) => setTemp(e.target.value)} />
          <button onClick={writeTemp}>登记汤温</button>
          <div>
            <button onClick={() => setStatus("soaking")}>浸茧</button>
            <button onClick={() => setStatus("reeling")}>缫丝中</button>
            <button onClick={() => setStatus("reeled")}>已缫完</button>
          </div>
          {err && <p class="err">{err}</p>}
        </div>
      )}
    </div>
  );
}

function DroppedEnds({ view, onNav }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  // 每次进专页都重新拉取，保证与环盆角标同随库，不读旧缓存。
  async function load() {
    setErr("");
    try {
      setData(await api("/api/dropped-ends"));
    } catch (ex) {
      setErr(ex.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div class="yard">
      <TopBar
        title={data ? data.filature : "江口缫丝坞"}
        subtitle="落绪累计专页 · 各盆数字等于该盆汤温记录条数，与环盆角标一致"
        view={view}
        onNav={onNav}
      />
      <div class="drawer totals">
        <div class="totals-head">
          <h3>落绪累计（按盆）</h3>
          <button onClick={load}>刷新</button>
        </div>
        {err && <p class="err">{err}</p>}
        {!data && !err && <p>装载落绪累计…</p>}
        {data && (
          <table>
            <thead>
              <tr>
                <th>盆号</th>
                <th>盆态</th>
                <th>落绪次数</th>
              </tr>
            </thead>
            <tbody>
              {data.basins.map((b) => (
                <tr key={b.id}>
                  <td>{b.code}</td>
                  <td>{STATUS_LABEL[b.status]}</td>
                  <td class="num">{b.droppedEnds}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>全坞合计</td>
                <td class="num">{data.total}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

function App() {
  const [ready, setReady] = useState(Boolean(token()));
  const [view, setView] = useState("yard");
  if (!ready) {
    return <Login onOk={() => setReady(true)} />;
  }
  return view === "totals" ? (
    <DroppedEnds view={view} onNav={setView} />
  ) : (
    <Yard view={view} onNav={setView} />
  );
}

render(<App />, document.getElementById("app"));
