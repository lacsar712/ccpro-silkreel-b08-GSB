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

function Yard({ board, onReadingLogged, onStatusChanged }) {
  const [picked, setPicked] = useState(null);
  const [temp, setTemp] = useState("40");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (picked) {
      setPicked(board.basins.find((b) => b.id === picked.id) || null);
    }
  }, [board]);

  const n = board.basins.length;

  async function writeTemp() {
    setErr("");
    try {
      await api(`/api/basins/${picked.id}/readings`, {
        method: "POST",
        body: JSON.stringify({ waterTempC: Number(temp) }),
      });
      await onReadingLogged();
    } catch (ex) {
      setErr(ex.message);
      // 登记被拒（如交叉登记冲突）也要重新对齐库，角标与累计专页不留在旧数上
      try {
        await onReadingLogged();
      } catch (_) {
        /* 保留原错误提示 */
      }
    }
  }
  async function setStatus(status) {
    setErr("");
    try {
      await api(`/api/basins/${picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await onStatusChanged();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div>
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
              <span class="badge" title="落绪次数">
                {b.dropCount}
              </span>
              <strong>{b.code}</strong>
              <span>{STATUS_LABEL[b.status]}</span>
            </button>
          );
        })}
      </div>
      {picked && (
        <div class="drawer">
          <h3>
            {picked.code} · {STATUS_LABEL[picked.status]}
          </h3>
          <p>
            最近汤温：{picked.latestTempC ?? "无"} ℃ · 记录 {picked.readingCount} 次 · 落绪 {picked.dropCount} 次
          </p>
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

function Drops({ drops }) {
  return (
    <div class="drops">
      <h2>落绪累计</h2>
      <p class="hint">按盆列出落绪次数，与环盆作业台角标同库同数，两边差为 0。</p>
      <table>
        <thead>
          <tr>
            <th>盆位</th>
            <th>落绪次数</th>
          </tr>
        </thead>
        <tbody>
          {drops.items.map((item) => (
            <tr key={item.basinId}>
              <td>{item.code}</td>
              <td>{item.dropCount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>合计</td>
            <td>{drops.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Shell() {
  const [view, setView] = useState("yard");
  const [board, setBoard] = useState(null);
  const [drops, setDrops] = useState(null);
  const [err, setErr] = useState("");

  async function refreshBoard() {
    setBoard(await api("/api/board"));
  }
  async function refreshDrops() {
    setDrops(await api("/api/drops"));
  }
  // 登记汤温后两侧一起跟上库：作业台角标与落绪累计专页同时重取，只刷一侧算错
  async function refreshAll() {
    await Promise.all([refreshBoard(), refreshDrops()]);
  }

  useEffect(() => {
    refreshAll().catch((e) => setErr(e.message));
  }, []);

  async function switchView(next) {
    setErr("");
    setView(next);
    try {
      await refreshAll();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div class="yard">
      <div class="topbar">
        <div>
          <h1>{board ? board.filature : "江口缫丝坞"}</h1>
          <p>
            {board ? `${board.riverside} · ` : ""}
            点盆登记汤温；已缫完须最近汤温 38～42℃
          </p>
        </div>
        <nav class="topnav">
          <button class={view === "yard" ? "active" : ""} onClick={() => switchView("yard")}>
            环盆作业台
          </button>
          <button class={view === "drops" ? "active" : ""} onClick={() => switchView("drops")}>
            落绪累计
          </button>
          <button
            onClick={() => {
              clearToken();
              location.reload();
            }}
          >
            退出
          </button>
        </nav>
      </div>
      {err && <p class="err">{err}</p>}
      {!board || !drops ? (
        <p>{err ? "" : "装载环盆…"}</p>
      ) : view === "yard" ? (
        <Yard board={board} onReadingLogged={refreshAll} onStatusChanged={refreshBoard} />
      ) : (
        <Drops drops={drops} />
      )}
    </div>
  );
}

function App() {
  const [ready, setReady] = useState(Boolean(token()));
  return ready ? <Shell /> : <Login onOk={() => setReady(true)} />;
}

render(<App />, document.getElementById("app"));
