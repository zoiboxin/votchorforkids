"use client";

import { useEffect, useRef, useState } from "react";
import {
  Heart, Zap, Star, Sun, Moon, Vote, MapPin, Volume2, VolumeX, Pause, Keyboard,
  Gauge, CircleHelp, Flag,
} from "lucide-react";
import type { GameEngine } from "@/lib/game/engine";
import { useGame } from "./store";
import { setMuted as setAudioMuted, sfx } from "@/lib/game/audio";
import { Button } from "@/components/ui/button";

/* ----------------------------- minimap ----------------------------- */
function Minimap({ engine }: { engine: GameEngine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const S = 148, K = S / 700;
    const dot = (x: number, z: number, r: number, col: string, alpha = 1) => {
      c.globalAlpha = alpha;
      c.fillStyle = col;
      c.beginPath();
      c.arc(S / 2 + x * K, S / 2 + z * K, r, 0, 6.3);
      c.fill();
      c.globalAlpha = 1;
    };
    c.clearRect(0, 0, S, S);
    dot(0, 0, 335 * K, "#2d5a2e");
    dot(0, 0, 200 * K, "#7a8f3f");
    dot(0, 0, 130 * K, "#8d8a80");
    dot(-185, 165, 42 * K, "#3a3a46");
    // parliament
    c.fillStyle = "#e0483a";
    c.fillRect(S / 2 - 4, S / 2 - 118 * K - 3, 8, 6);
    // ballot
    c.fillStyle = "#f7c948";
    c.beginPath(); c.arc(S / 2, S / 2 - 100 * K, 2.6, 0, 6.3); c.fill();
    for (const it of engine.items) if (it.active) dot(it.x, it.z, 1.1, "#ffd166", 0.8);
    for (const v of engine.votes) if (v.state === "world") dot(v.x, v.z, 2.2, "#f7c948");
    for (const cop of engine.cops) {
      const chasing = cop.mode === "chase";
      dot(cop.x, cop.z, chasing ? 3 : 2, chasing ? "#ff4d4d" : "#6aa0ff");
    }
    for (const cv of engine.civs) if (cv.mode === "detained") dot(cv.x, cv.z, 3, "#ff8fa3");
    dot(engine.player.x, engine.player.z, 3.6, "#ffffff");
  }, [engine, hud]);
  return (
    <canvas
      ref={ref} width={148} height={148}
      aria-label="Minimap"
      className="rounded-xl border-2 border-white/30 shadow-lg"
    />
  );
}

/* ----------------------------- bars ----------------------------- */
function Bar({ v, color, icon }: { v: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white drop-shadow">{icon}</span>
      <div className="h-3.5 w-28 sm:w-36 overflow-hidden rounded-full border border-white/30 bg-black/35">
        <div className={`h-full rounded-full ${color} transition-[width] duration-200`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/* ----------------------------- mobile controls ----------------------------- */
function Joystick({ engine }: { engine: GameEngine }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);

  const move = (cx: number, cy: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = Math.max(-1, Math.min(1, (cx - (r.left + r.width / 2)) / (r.width / 2)));
    const dy = Math.max(-1, Math.min(1, (cy - (r.top + r.height / 2)) / (r.height / 2)));
    setKnob({ x: dx * 34, y: dy * 34 });
    engine.touchMove.active = true;
    engine.input.f = -dy;
    engine.input.r = dx;
  };
  const end = () => {
    activeId.current = null;
    engine.touchMove.active = false;
    engine.input.f = 0; engine.input.r = 0;
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div
      ref={ref} data-ui
      className="relative h-32 w-32 rounded-full border-2 border-white/40 bg-white/10 backdrop-blur-sm"
      onTouchStart={(e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        activeId.current = t.identifier;
        move(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches))
          if (t.identifier === activeId.current) move(t.clientX, t.clientY);
      }}
      onTouchEnd={end}
      onTouchCancel={end}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60 bg-white/30"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

function MobileButtons({ engine }: { engine: GameEngine }) {
  const [sprint, setSprint] = useState(false);
  return (
    <div data-ui className="flex flex-col items-end gap-3">
      <button
        aria-label="Jump"
        className="h-16 w-16 rounded-full border-2 border-white/50 bg-amber-400/80 text-lg font-black text-amber-950 shadow-lg active:scale-95"
        onTouchStart={(e) => {
          e.preventDefault();
          engine.input.jump = true;
          setTimeout(() => { engine.input.jump = false; }, 120);
        }}
      >JUMP</button>
      <button
        aria-label="Rescue"
        className="h-16 w-16 rounded-full border-2 border-white/50 bg-emerald-400/80 text-lg font-black text-emerald-950 shadow-lg active:scale-95"
        onTouchStart={(e) => { e.preventDefault(); engine.interact(); }}
      >E</button>
      <button
        aria-label="Toggle sprint"
        className={`h-14 w-14 rounded-full border-2 border-white/50 text-sm font-black shadow-lg active:scale-95 ${sprint ? "bg-rose-500/90 text-white" : "bg-white/25 text-white"}`}
        onClick={() => { const s = !sprint; setSprint(s); engine.touchMove.sprint = s; }}
      ><Gauge className="mx-auto" /></button>
    </div>
  );
}

/* ----------------------------- main HUD ----------------------------- */
export function Hud({ engine }: { engine: GameEngine }) {
  const hud = useGame((s) => s.hud);
  const toasts = useGame((s) => s.toasts);
  const dropToast = useGame((s) => s.dropToast);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  const touch = useGame((s) => s.touch);
  const showHelp = useGame((s) => s.showHelp);
  const toggleHelp = useGame((s) => s.toggleHelp);

  const hr = hud.clock * 24;
  const time = `${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
  const night = hud.night > 0.5;

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dropToast(toasts[0].id), 2800);
    return () => clearTimeout(t);
  }, [toasts, dropToast]);

  // auto-hide the help card on touch devices so the view stays clear
  useEffect(() => {
    if (!touch) return;
    const t = setTimeout(() => useGame.setState({ showHelp: false }), 9000);
    return () => clearTimeout(t);
  }, [touch]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans">
      {/* police proximity vignette */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${hud.policeNear ? "opacity-100" : "opacity-0"}`}
        style={{ boxShadow: "inset 0 0 90px 18px rgba(220,40,40,0.26)" }}
      />

      {/* top-left: vitals */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-2xl bg-black/35 p-3 backdrop-blur-md">
        <Bar v={hud.hp} color="bg-gradient-to-r from-rose-500 to-rose-400" icon={<Heart size={16} className="text-rose-300" fill="currentColor" />} />
        <Bar v={hud.stamina} color="bg-gradient-to-r from-amber-500 to-yellow-300" icon={<Zap size={16} className="text-amber-300" fill="currentColor" />} />
        <div className="mt-1 flex items-center gap-2 text-sm text-white">
          <Vote size={16} className="text-yellow-300" />
          <span className="font-bold">{hud.carried > 0 ? `🗳️ ${hud.carried}/3` : "—"}</span>
          <span className="ml-1 rounded-full bg-yellow-400/90 px-2 py-0.5 text-xs font-black text-yellow-950">
            {hud.delivered}/{hud.total} delivered
          </span>
        </div>
        <div className="flex items-center gap-0.5" aria-label={`Wanted level ${hud.stars}`}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={16} className={i < hud.stars ? "text-red-400" : "text-white/25"} fill={i < hud.stars ? "currentColor" : "none"} />
          ))}
        </div>
      </div>

      {/* top-center: zone + clock */}
      <div className="absolute left-3 top-[122px] rounded-full bg-black/35 px-3 py-1 text-xs font-bold text-white backdrop-blur-md sm:left-1/2 sm:top-3 sm:-translate-x-1/2 sm:px-4 sm:py-1.5 sm:text-sm">
        <MapPin size={14} className="mr-1 inline text-emerald-300" />
        {hud.zone} · {time} {night ? <Moon size={14} className="inline text-indigo-200" /> : <Sun size={14} className="inline text-yellow-300" />}
      </div>

      {/* top-right: minimap + score */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <Minimap engine={engine} />
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="rounded-xl bg-black/35 px-3 py-1 text-sm font-black text-yellow-300 backdrop-blur-md">
            {hud.points} pts
          </div>
          <Button
            size="icon" variant="ghost" aria-label={muted ? "Unmute" : "Mute"}
            className="h-9 w-9 rounded-xl bg-black/35 text-white backdrop-blur-md hover:bg-black/50"
            onClick={() => { const m = !muted; setMuted(m); setAudioMuted(m); }}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </Button>
          <Button
            size="icon" variant="ghost" aria-label="Toggle controls help"
            className="h-9 w-9 rounded-xl bg-black/35 text-white backdrop-blur-md hover:bg-black/50"
            onClick={toggleHelp}
          >
            {showHelp ? <Keyboard size={16} /> : <CircleHelp size={16} />}
          </Button>
        </div>
        {showHelp && (
          <div className="max-w-[220px] rounded-xl bg-black/40 px-3 py-2 text-xs leading-relaxed text-white/90 backdrop-blur-md">
            <b className="text-yellow-300">Goal:</b> snatch 🗳 votes, deliver them at the Parliament ballot box. Rescue pink-bubbled friends with <b>E</b>. Dodge the police — sprint with <b>Shift</b>!
            {!touch && <div className="mt-1 text-white/70">WASD move · Shift sprint · Space jump · E rescue · drag to look</div>}
          </div>
        )}
      </div>

      {/* prompt */}
      {hud.prompt && (
        <div role="status" className="absolute bottom-36 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-emerald-500/90 px-5 py-2 font-black text-white shadow-xl sm:bottom-28">
          {hud.prompt}
        </div>
      )}

      {/* toasts */}
      <div className="absolute bottom-24 left-1/2 z-10 flex w-[90%] max-w-md -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-16">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-full px-4 py-1.5 text-center text-sm font-bold shadow-lg backdrop-blur-md ${
              t.kind === "good" ? "bg-emerald-500/85 text-white" : t.kind === "bad" ? "bg-rose-600/85 text-white" : "bg-slate-800/80 text-white"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {/* detained overlay */}
      {hud.detained && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-rose-950/40 backdrop-blur-[2px]">
          <div className="rounded-3xl border-4 border-rose-400/70 bg-black/60 px-8 py-6 text-center">
            <div className="text-3xl font-black text-rose-300">CAUGHT! 😵</div>
            <div className="mt-1 text-white">Time-out: {Math.ceil(hud.detainLeft)}s</div>
          </div>
        </div>
      )}

      {/* mobile controls */}
      {touch && (
        <>
          <div className="absolute bottom-6 left-4 z-10"><Joystick engine={engine} /></div>
          <div className="absolute bottom-6 right-4 z-10"><MobileButtons engine={engine} /></div>
        </>
      )}

      {/* win flag hint */}
      {hud.won && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-yellow-400/90 px-4 py-1.5 text-sm font-black text-yellow-950 shadow-lg">
          <Flag size={14} className="mr-1 inline" /> All votes delivered — free roam & keep rescuing!
        </div>
      )}

      {/* police count / city life */}
      <div className="absolute bottom-3 right-3 rounded-xl bg-black/30 px-3 py-1 text-xs text-white/80 backdrop-blur-md">
        🚓 {hud.police} police · 🧍 {hud.civilians} civilians
      </div>
    </div>
  );
}
