import { useEffect, useRef } from "react";
import { useState } from "react";
import { getRoom, leave, squadAction } from "./net";
import { PHASE_TEXT } from "@votechor/shared";
import { useGame } from "./store";

const S = 140, K = S / 700;
function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current?.getContext("2d"), room = getRoom(); if (!c || !room) return;
      const dot = (x: number, z: number, r: number, col: string) => { c.fillStyle = col; c.beginPath(); c.arc(S / 2 + x * K, S / 2 + z * K, r, 0, 6.3); c.fill(); };
      c.clearRect(0, 0, S, S);
      dot(0, 0, 335 * K, "#1d3a22"); dot(0, 0, 200 * K, "#3a4a24"); dot(0, 0, 130 * K, "#555"); dot(-185, 165, 42 * K, "#111"); dot(0, -116, 3, "#e0483a");
      const me = room.state?.players?.get(room.sessionId); if (!me) return;
      room.state.players.forEach((p: any, id: string) => { if (id !== room.sessionId && p.fac === "police" && Math.hypot(p.x - me.x, p.z - me.z) < 90) dot(p.x, p.z, 2, "#6aa0ff"); });
      const sq = me.squad;
      if (sq) room.state.players.forEach((p: any, id: string) => { if (id !== room.sessionId && p.squad === sq) dot(p.x, p.z, 3, p.mode === 1 ? "#e0483a" : "#3fae5a"); });
      room.state.items?.forEach((it: any) => { if (it.active && Math.hypot(it.x - me.x, it.z - me.z) < 80) dot(it.x, it.z, 1.5, "#f5d03a"); });
      dot(me.x, me.z, 3.5, "#fff");
    };
    draw(); return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={S} height={S} aria-label="Minimap" />;
}

function SquadPanel() {
  const h = useGame((s) => s.hud), [code, setCode] = useState("");
  return (
    <div className="pan squad">
      <b>Squad</b>
      {h.squad ? (<>
        <div className="code" title="Share this code with friends">{h.squad}</div>
        {h.mates.length === 0 && <div className="dim">Waiting for teammates…</div>}
        {h.mates.map((m) => (<div key={m.id} className="mate"><span>{m.name}{m.detained ? " (detained)" : ""}</span><div className="bar"><i className="hp" style={{ width: `${m.hp}%` }} /></div></div>))}
        <div className="dim">Support points: {h.support}</div>
        <button className="link" onClick={() => squadAction("leave")}>Leave squad</button>
      </>) : (<>
        <button className="chip" onClick={() => squadAction("create")}>Create squad</button>
        <div className="join"><input value={code} maxLength={4} placeholder="CODE" aria-label="Squad code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="chip" onClick={() => { squadAction("join", code); setCode(""); }}>Join</button></div>
      </>)}
    </div>
  );
}

function BossPanel() {
  const b = useGame((s) => s.hud.boss), p = useGame((s) => s.hud.prompt), z = useGame((s) => s.hud.zone);
  if (b.phase === 0 && z !== "City") return null;
  const t = PHASE_TEXT[b.phase] ?? PHASE_TEXT[0];
  const extra = b.phase === 0 ? (b.timer < 5 && b.timer > 0 ? `Starting in ${Math.ceil(b.timer)}…` : "")
    : b.phase === 1 ? `${Math.ceil(b.timer)} s` : b.phase === 2 ? b.progress : b.phase === 4 ? `Hold: ${b.hold.toFixed(1)} / 3 s` : b.phase === 5 ? `Votes ${b.votes} / ${b.need}` : "";
  return (<div className="pan boss" aria-live="polite">
    <b>{t.name}</b>
    <div className="bar big"><i className="bosshp" style={{ width: `${b.hp}%` }} /></div>
    <div>{t.goal}</div>{extra && <div className="dim">{extra}</div>}{p && null}
  </div>);
}

export function Hud() {
  const h = useGame((s) => s.hud), toast = useGame((s) => s.toast), at = useGame((s) => s.toastAt), online = useGame((s) => s.online);
  const hr = h.clock * 24, time = `${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
  const showToast = Date.now() - at < 2800;
  return (<>
    <div className="pan bars">
      <label>Health</label><div className="bar"><i className="hp" style={{ width: `${h.hp}%` }} /></div>
      <label>Stamina</label><div className="bar"><i className="st" style={{ width: `${h.stamina}%` }} /></div>
      <div className="stars" aria-label={`Wanted level ${h.stars}`}>{h.stars ? "★".repeat(h.stars) + "☆".repeat(5 - h.stars) : ""}</div>
    </div>
    <div className="pan topbar">{h.zone} · {time}</div>
    <div className="pan right"><Minimap /><div>{h.real} {h.real === 1 ? "player" : "players"} online</div><div className="dim">{h.bots} AI fillers</div><button className="link" onClick={leave}>Leave game</button></div>
    <BossPanel />
    <SquadPanel />
    {h.prompt && <div className="pan prompt" role="status">{h.prompt}</div>}
    <div className="pan help">WASD move · Shift sprint · Space jump · E rescue · drag mouse to look</div>
    {showToast && <div className="pan toast" role="status">{toast}</div>}
    {h.detained && <div className="detained" role="alert">Detained for Excessive Sprinting. Please wait for release.</div>}
    {!online && <div className="detained" role="alert">Connection lost. Reconnecting…</div>}
  </>);
}
