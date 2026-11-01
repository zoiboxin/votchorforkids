"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Heart, Zap, Star, Sun, Moon, Vote, MapPin, Volume2, VolumeX, Pause, Play as PlayIcon,
  Keyboard, Gauge, CircleHelp, Flag, Home, Settings as SettingsIcon, CheckCircle2, Siren, Info, ShieldCheck,
  ChevronUp, Timer, Package, Copy, Check, X, Map as MapIcon, Mouse,
} from "lucide-react";
import type { GameEngine } from "@/lib/game/engine";
import { DETAIN_SECONDS, ITEMS, INV_SLOTS } from "@/lib/game/constants";
import { useGame } from "./store";
import { setMuted as setAudioMuted, sfx, stopMusic, startMusic } from "@/lib/game/audio";
import { Button } from "@/components/ui/button";
import { HowToPlay, SettingsDialog } from "./Panels";

/* ------- shared world-map canvas painting (156px minimap + 440px big map) ------- */
function drawWorldMap(c: CanvasRenderingContext2D, S: number, engine: GameEngine, night: boolean) {
  const K = S / 700;          // world units → px
  const U = S / 156;          // scale for the hand-tuned 156px marker sizes
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
  if (S > 300) {
    // big map only: zone rings, graveyard fence and district labels
    c.strokeStyle = "rgba(255,255,255,0.22)";
    c.lineWidth = 1;
    for (const r of [245, 320, 390]) { c.beginPath(); c.arc(S / 2, S / 2, r * K, 0, 6.3); c.stroke(); }
    c.beginPath(); c.arc(S / 2 - 255 * K, S / 2 + 215 * K, 45 * K, 0, 6.3); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.font = `700 ${Math.round(7 * U)}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = "center";
    c.fillText("CITY", S / 2, S / 2 + 90 * K);
    c.fillText("FARMLAND", S / 2, S / 2 + 290 * K);
    c.fillText("JUNGLE", S / 2 - 270 * K, S / 2 - 255 * K);
    c.fillText("GRAVEYARD", S / 2 - 255 * K, S / 2 + 265 * K);
  }
  // parliament
  c.fillStyle = "#e0483a";
  c.fillRect(S / 2 - 4 * U, S / 2 - 118 * K - 3 * U, 8 * U, 6 * U);
  // ballot
  c.fillStyle = "#f7c948";
  c.beginPath(); c.arc(S / 2, S / 2 - 100 * K, 2.6 * U, 0, 6.3); c.fill();
  for (const it of engine.items) if (it.active) dot(it.x, it.z, 1.1 * U, "#ffd166", 0.8);
  for (const v of engine.votes) if (v.state === "world") dot(v.x, v.z, 2.2 * U, "#f7c948");
  for (const cop of engine.cops) {
    const chasing = cop.mode === "chase";
    dot(cop.x, cop.z, (chasing ? 3 : 2) * U, chasing ? "#ff4d4d" : "#6aa0ff");
  }
  for (const cv of engine.civs) if (cv.mode === "detained") dot(cv.x, cv.z, 3 * U, "#ff8fa3");
  if (night) for (const zb of engine.zombies) dot(zb.x, zb.z, 2.4 * U, "#c084fc");
  dot(engine.player.x, engine.player.z, 3.6 * U, "#ffffff");
}

/* ----------------------------- minimap ----------------------------- */
function Minimap({ engine, onOpen }: { engine: GameEngine; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) drawWorldMap(c, 156, engine, hud.night > 0.5);
  }, [engine, hud]);
  return (
    <button
      data-ui type="button" onClick={onOpen}
      title="Open the big world map (M)"
      aria-label="Open the big world map"
      className="pointer-events-auto relative block origin-top-right scale-[0.72] cursor-pointer transition-transform hover:scale-90 sm:scale-100 sm:hover:scale-105"
    >
      <canvas ref={ref} width={156} height={156} aria-hidden className="rounded-xl border-2 border-white/30 shadow-lg" />
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full border border-white/30 bg-black/70 px-1.5 text-[9px] font-black leading-3 text-white">N</span>
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-1.5 text-[8px] font-black uppercase tracking-widest text-white/85">M — big map</span>
    </button>
  );
}

/* ----------------------------- big map overlay ----------------------------- */
const BIG_MAP_S = 440;
const MAP_LEGEND: [string, string][] = [
  ["#ffffff", "You"], ["#f7c948", "Votes"], ["#ffd166", "Food"], ["#6aa0ff", "Police"],
  ["#ff4d4d", "Chasing!"], ["#ff8fa3", "Rescue"], ["#c084fc", "Zombies · night"],
];
function BigMap({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) drawWorldMap(c, BIG_MAP_S, engine, hud.night > 0.5);
  }, [engine, hud]);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      data-ui role="dialog" aria-label="Big map of the world"
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(94vw,480px)] rounded-3xl border border-white/20 bg-slate-900/95 p-4 shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black uppercase tracking-widest text-white">
            <MapIcon size={14} className="mr-1 inline text-yellow-300" /> World map
          </div>
          <Button size="icon" variant="ghost" aria-label="Close big map" onClick={onClose} className="h-8 w-8 rounded-lg bg-white/10 text-white hover:bg-white/20">
            <X size={16} />
          </Button>
        </div>
        <canvas
          ref={ref} width={BIG_MAP_S} height={BIG_MAP_S} aria-label="World map canvas"
          className="h-[min(78vw,440px)] w-[min(78vw,440px)] rounded-2xl border border-white/20"
        />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-bold text-white/80">
          {MAP_LEGEND.map(([col, label]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: col }} aria-hidden /> {label}
            </span>
          ))}
        </div>
        <div className="mt-1 text-center text-[10px] font-black uppercase tracking-widest text-white/45">M or Esc to close</div>
      </motion.div>
    </motion.div>
  );
}

/* ------------- bottom-center location chip — tap to copy "X · Z" ------------- */
function CoordsChip({ px, pz }: { px: number; pz: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`X ${px} · Z ${pz}`); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      data-ui type="button" onClick={copy}
      title="Click to copy your coordinates"
      aria-label={`Your location: X ${px}, Z ${pz}. Click to copy.`}
      className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/25 bg-black/55 px-3 py-1 text-[10px] font-black tabular-nums tracking-wide text-white/90 backdrop-blur-md transition-colors hover:border-amber-300/70 hover:text-amber-200"
    >
      {copied ? <Check size={11} className="text-emerald-300" /> : <MapPin size={11} className="text-yellow-300" />}
      <span>X {px} · Z {pz}</span>
      <span className="hidden items-center gap-0.5 rounded bg-white/10 px-1 text-[8px] font-black uppercase tracking-widest text-white/55 sm:flex">
        <Copy size={9} /> copy
      </span>
    </button>
  );
}

/* ----------------------------- bars ----------------------------- */
function Bar({ v, color, icon, low = false }: { v: number; color: string; icon: React.ReactNode; low?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white drop-shadow">{icon}</span>
      <div className={`h-3.5 w-28 overflow-hidden rounded-full border border-white/30 bg-black/35 sm:w-36 ${low ? "animate-pulse ring-1 ring-rose-300/70" : ""}`}>
        <div className={`h-full rounded-full ${color} transition-[width] duration-200`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/* --------------------- carried-vote pips (3 slots) --------------------- */
function VotePips({ carried }: { carried: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Vote size={16} className="text-yellow-300" />
      <div className="flex gap-1" aria-label={`Carrying ${carried} of 3 votes`}>
        {Array.from({ length: 3 }, (_, i) => (
          <motion.div
            key={i}
            animate={i < carried ? { scale: [1, 1.35, 1] } : { scale: 1 }}
            transition={i < carried ? { repeat: Infinity, duration: 1.3, delay: i * 0.15 } : { duration: 0.2 }}
            className={`h-3.5 w-3.5 rounded-full border ${
              i < carried
                ? "border-yellow-100 bg-gradient-to-br from-yellow-200 to-amber-400 shadow-[0_0_7px_rgba(250,204,21,0.85)]"
                : "border-white/30 bg-black/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------- floating +health / +energy chips after eating (1.6s) ------------- */
function GainFlash() {
  const gain = useGame((s) => s.hud.gain);
  const [flash, setFlash] = useState<typeof gain | null>(null);
  const [shownAt, setShownAt] = useState(0);
  // adjust-state-during-render pattern: react to a new gain bump without an effect
  if (gain.at !== shownAt) {
    setShownAt(gain.at);
    setFlash(gain.at && (gain.hp > 0 || gain.stamina > 0) ? { ...gain } : null);
  }
  // auto-hide shortly after the chip pops
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);
  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          key={flash.at}
          aria-hidden
          initial={{ opacity: 0, y: 12, scale: 0.75 }}
          animate={{ opacity: 1, y: -4, scale: 1 }}
          exit={{ opacity: 0, y: -18, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 330, damping: 21 }}
          className="pointer-events-none absolute left-[14rem] top-8 z-20 flex flex-col items-start gap-1"
        >
          {flash.hp > 0 && (
            <span className="w-fit rounded-full border border-rose-200/40 bg-rose-500/90 px-2.5 py-0.5 text-xs font-black text-white shadow-lg shadow-rose-900/40">
              +{flash.hp} ❤
            </span>
          )}
          {flash.stamina > 0 && (
            <span className="w-fit rounded-full border border-amber-200/40 bg-amber-400/95 px-2.5 py-0.5 text-xs font-black text-amber-950 shadow-lg shadow-amber-900/40">
              +{flash.stamina} ⚡
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------- food pockets: fixed 8-slot hotbar (old-game bottom-left bar, revived) ------------- */
function ItemBar({ engine, vertical = false }: { engine: GameEngine; vertical?: boolean }) {
  const inv = useGame((s) => s.hud.inv);
  const touch = useGame((s) => s.touch);
  // Fixed hotbar: always INV_SLOTS boxes; pocketed food fills them from the left.
  // Slot n matches the Digit-n hotkey (hud.inv[n-1]) on desktop.
  const cells = Array.from({ length: INV_SLOTS }, (_, i) => inv[i] ?? null);
  const size = vertical ? "h-10 w-10" : "h-10 w-10 sm:h-12 sm:w-12";
  return (
    <div
      data-ui
      role="toolbar"
      aria-label="Food pockets — click a snack to eat it and restore health or energy"
      className={`pointer-events-auto rounded-2xl bg-black/35 p-1.5 backdrop-blur-md ${vertical ? "" : "inline-block"}`}
    >
      <div className={`flex flex-wrap gap-1 ${vertical ? "max-w-[13rem]" : "max-w-[13rem] lg:max-w-none lg:flex-nowrap"}`}>
        {cells.map((slot, i) => {
          const keyNo = i + 1;
          if (!slot) {
            return (
              <span
                key={`empty-${i}`}
                aria-hidden
                className={`flex ${size} items-center justify-center rounded-xl border-2 border-dashed border-white/25 bg-black/20`}
              >
                <Package size={15} className="text-white/30" />
                {/* faint hotkey label on empty slots too — teaches the 1-8 mapping */}
                <span className="absolute -bottom-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded bg-black/55 text-[8px] font-black text-white/45">
                  {keyNo}
                </span>
              </span>
            );
          }
          const d = ITEMS[slot.def];
          return (
            <motion.button
              key={slot.def}
              layout
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 380, damping: 20 }}
              onClick={() => engine.useItem(slot.def)}
              onContextMenu={!vertical ? (e) => { e.preventDefault(); engine.dropItem(slot.def); } : undefined}
              title={`${d.name} — +${d.hp} ❤ ${d.stamina > 0 ? `+${d.stamina} ⚡` : ""} · click to eat${touch ? "" : " · right-click to drop"}`}
              aria-label={`Use ${d.name}: restores ${d.hp} health and ${d.stamina} energy`}
              className={`relative flex ${size} items-center justify-center rounded-xl border-2 border-white/30 bg-white/10 shadow-lg backdrop-blur-md transition-colors hover:border-amber-300/80 hover:bg-amber-400/25`}
            >
              <span className="text-lg leading-none sm:text-2xl" aria-hidden>{d.emoji}</span>
              {slot.count > 1 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-black/40 bg-amber-400 px-1 text-[10px] font-black text-amber-950">
                  {slot.count}
                </span>
              )}
              <span className="absolute -bottom-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded bg-black/75 text-[8px] font-black text-white/90">
                {keyNo}
              </span>
            </motion.button>
          );
        })}
      </div>
      <div className="mt-1 w-fit rounded-lg bg-black/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/75">
        {touch ? "tap slot = eat it" : "1-8 use · right-click drop"}
      </div>
    </div>
  );
}

/* ------------- danger compass: arrow toward nearest chasing cop ------------- */
function DangerCompass({ engine }: { engine: GameEngine }) {
  const hud = useGame((s) => s.hud);
  if (!hud.policeNear || hud.detained) return null;
  let best: { d: number; a: number } | null = null;
  for (const cop of engine.cops) {
    if (cop.mode !== "chase") continue;
    const dx = cop.x - engine.player.x, dz = cop.z - engine.player.z;
    const d = Math.hypot(dx, dz);
    if (!best || d < best.d) best = { d, a: Math.atan2(dx, dz) };
  }
  if (!best) return null;
  // 0° = straight ahead of the camera; positive = clockwise (to the right)
  const deg = ((best.a - engine.input.yaw) * 180) / Math.PI;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
      className="pointer-events-none absolute left-1/2 top-1/2 z-[5]"
      aria-label={`Police ${Math.round(best.d)} meters away`}
    >
      <div style={{ transform: `rotate(${deg}deg)` }}>
        <div
          className="flex flex-col items-center"
          style={{ transform: `translate(-50%, -128px)` }}
        >
          <motion.span animate={{ y: [0, 4, 0] }} transition={{ repeat: Infinity, duration: 0.8 }}>
            <ChevronUp size={26} className="text-rose-400 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]" strokeWidth={3.5} />
          </motion.span>
          <span className="rounded-full bg-rose-600/85 px-1.5 text-[9px] font-black leading-4 text-white shadow">
            🚓 {Math.round(best.d)}m
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ----------------------------- FPS counter ----------------------------- */
function FpsCounter() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0, last = performance.now(), raf = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) { setFps(Math.round((frames * 1000) / (now - last))); frames = 0; last = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div aria-label="Frames per second" className="rounded-lg bg-black/40 px-2 py-0.5 text-[10px] font-black tabular-nums text-emerald-300 backdrop-blur">
      {fps} FPS
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

/* ----------------------------- pause menu ----------------------------- */
function PauseMenu({ engine, onQuit }: { engine: GameEngine; onQuit: () => void }) {
  const setPaused = useGame((s) => s.setPaused);
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hud = useGame((s) => s.hud);

  const resume = () => {
    sfx.click();
    engine.running = true;
    startMusic();
    setPaused(false);
  };

  const secs = Math.floor(hud.elapsed);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
      data-ui
    >
      <motion.div
        initial={{ scale: 0.9, y: 14 }} animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="w-[min(92vw,380px)] rounded-3xl border border-white/20 bg-slate-900/95 p-6 text-white shadow-2xl"
      >
        <div className="mb-1 text-center text-3xl font-black text-yellow-300">Paused ⏸</div>
        <p className="mb-4 text-center text-xs text-white/60">Run time {mm}:{ss} · score {hud.points} · votes {hud.delivered}/{hud.total}</p>
        <div className="space-y-2">
          <Button onClick={resume} className="h-12 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 text-lg font-black text-amber-950">
            <PlayIcon size={18} className="mr-2" fill="currentColor" /> Resume
          </Button>
          <Button onClick={() => setHelp(true)} variant="outline" className="h-11 w-full rounded-2xl border-white/25 bg-white/10 font-bold text-white hover:bg-white/20">
            <CircleHelp size={16} className="mr-2" /> How to play
          </Button>
          <Button onClick={() => setSettingsOpen(true)} variant="outline" className="h-11 w-full rounded-2xl border-white/25 bg-white/10 font-bold text-white hover:bg-white/20">
            <SettingsIcon size={16} className="mr-2" /> Settings
          </Button>
          <Button onClick={onQuit} variant="outline" className="h-11 w-full rounded-2xl border-rose-300/40 bg-rose-500/15 font-bold text-rose-200 hover:bg-rose-500/30">
            <Home size={16} className="mr-2" /> Quit to menu
          </Button>
        </div>
        {hud.delivered > 0 && (
          <p className="mt-3 text-center text-[11px] text-emerald-300/90">
            This run: {hud.delivered} votes delivered · {hud.rescues} rescued · {hud.points} pts
          </p>
        )}
      </motion.div>
      <HowToPlay open={help} onOpenChange={setHelp} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </motion.div>
  );
}

/* ----------------------------- main HUD ----------------------------- */
export function Hud({ engine, onQuit }: { engine: GameEngine; onQuit?: () => void }) {
  const hud = useGame((s) => s.hud);
  const toasts = useGame((s) => s.toasts);
  const dropToast = useGame((s) => s.dropToast);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  const touch = useGame((s) => s.touch);
  const showHelp = useGame((s) => s.showHelp);
  const toggleHelp = useGame((s) => s.toggleHelp);
  const showFps = useGame((s) => s.settings.showFps);
  const paused = useGame((s) => s.paused);
  const setPaused = useGame((s) => s.setPaused);
  const victoryOpen = useGame((s) => s.victoryOpen);
  const mouseLocked = useGame((s) => s.mouseLocked);
  const bigMap = useGame((s) => s.bigMapOpen);
  const setBigMap = useGame((s) => s.setBigMapOpen);
  // after the cursor gets hard-bound, remind the player how to free it (4 s)
  const [lockTip, setLockTip] = useState(false);
  useEffect(() => {
    if (!mouseLocked) { setLockTip(false); return; }
    setLockTip(true);
    const t = setTimeout(() => setLockTip(false), 4000);
    return () => clearTimeout(t);
  }, [mouseLocked]);
  // opening the big map needs a visible cursor
  useEffect(() => {
    if (bigMap && document.pointerLockElement) document.exitPointerLock();
  }, [bigMap]);

  const hr = hud.clock * 24;
  const time = `${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
  const night = hud.night > 0.5;
  const graceT = engine.invulnT > 0 && hud.elapsed < 10 && !hud.detained;
  const runSecs = Math.floor(hud.elapsed);
  const runTime = `${String(Math.floor(runSecs / 60)).padStart(2, "0")}:${String(runSecs % 60).padStart(2, "0")}`;
  const ZONE_TINT: Record<string, string> = {
    City: "text-sky-200",
    Farmland: "text-lime-200",
    Jungle: "text-emerald-200",
    Graveyard: "text-violet-200",
    "Mountain Wall": "text-slate-200",
  };

  const togglePause = () => {
    if (victoryOpen) return;
    const next = !useGame.getState().paused;
    sfx.click();
    engine.running = !next;
    if (next) stopMusic(); else startMusic();
    setPaused(next);
  };

  // P / Escape toggles pause · 1-8 eats pocketed food · M opens the big map
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (useGame.getState().victoryOpen) return;
      if (bigMap) {
        // the map swallows M / Esc so it always closes first
        if (e.code === "KeyM" || e.code === "Escape") { e.preventDefault(); setBigMap(false); }
        return;
      }
      if (e.code === "KeyM") { e.preventDefault(); setBigMap(true); return; }
      if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); togglePause(); }
      // top-row Digit keys AND keypad Numpad keys both eat pocketed food
      const dig = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
      if (dig) {
        const slot = useGame.getState().hud.inv[Number(dig[1]) - 1];
        if (slot) engine.useItem(slot.def);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [victoryOpen, engine, bigMap, togglePause]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dropToast(toasts[0].id), 3200);
    return () => clearTimeout(t);
  }, [toasts, dropToast]);

  // auto-hide the help card on touch devices so the view stays clear
  useEffect(() => {
    if (!touch) return;
    const t = setTimeout(() => useGame.setState({ showHelp: false }), 9000);
    return () => clearTimeout(t);
  }, [touch]);

  const toastIcon = (kind: string) =>
    kind === "good" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> :
    kind === "bad" ? <Siren size={15} className="mt-0.5 shrink-0" /> :
    <Info size={15} className="mt-0.5 shrink-0" />;

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans">
      {/* police proximity vignette */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${hud.policeNear ? "opacity-100" : "opacity-0"}`}
        style={{ boxShadow: "inset 0 0 90px 18px rgba(220,40,40,0.26)" }}
      />

      {/* damage flash — police hit or zombie catch */}
      <AnimatePresence>
        {hud.hurt && (
          <motion.div
            key="hurt-flash"
            aria-hidden
            initial={{ opacity: 0.95 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="absolute inset-0"
            style={{ boxShadow: "inset 0 0 150px 46px rgba(220,38,38,0.55)" }}
          />
        )}
      </AnimatePresence>

      {/* low-hp heartbeat vignette */}
      {hud.hp <= 30 && !hud.detained && (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          animate={{ opacity: [0.35, 0.85, 0.35] }}
          transition={{ repeat: Infinity, duration: 1.15, ease: "easeInOut" }}
          style={{ boxShadow: "inset 0 0 110px 26px rgba(190,18,60,0.4)" }}
        />
      )}

      {/* directional warning toward the closest chasing cop */}
      <AnimatePresence>{hud.policeNear && <DangerCompass engine={engine} />}</AnimatePresence>

      {/* top-left: vitals */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-2xl bg-black/35 p-3 backdrop-blur-md">
        <Bar v={hud.hp} color="bg-gradient-to-r from-rose-500 to-rose-400" icon={<Heart size={16} className="text-rose-300" fill="currentColor" />} low={hud.hp <= 30} />
        <Bar v={hud.stamina} color="bg-gradient-to-r from-amber-500 to-yellow-300" icon={<Zap size={16} className="text-amber-300" fill="currentColor" />} low={hud.stamina <= 15} />
        {hud.exhausted && (
          <div className="animate-pulse text-[10px] font-black uppercase tracking-wider text-amber-300">
            😮‍💨 Exhausted — walking to recover…
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 text-sm text-white">
          <VotePips carried={hud.carried} />
          <span className="ml-1 rounded-full bg-yellow-400/90 px-2 py-0.5 text-xs font-black text-yellow-950">
            {hud.delivered}/{hud.total} delivered
          </span>
        </div>
        <motion.div layout className="flex items-center gap-0.5" aria-label={`Wanted level ${hud.stars} of 5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <motion.span key={i} animate={i < hud.stars ? { scale: [1, 1.35, 1] } : { scale: 1 }} transition={{ repeat: i < hud.stars ? Infinity : 0, duration: 1.1, delay: i * 0.12 }}>
              <Star size={16} className={i < hud.stars ? "text-red-400" : "text-white/25"} fill={i < hud.stars ? "currentColor" : "none"} />
            </motion.span>
          ))}
        </motion.div>
      </div>
      {/* floating +❤/+⚡ chip right after a snack is eaten */}
      <GainFlash />

      {/* top-center: objective tracker + zone/clock */}
      <div className="absolute left-3 right-3 top-[172px] flex flex-col items-center gap-1.5 sm:left-1/2 sm:right-auto sm:top-3 sm:-translate-x-1/2">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-black/35 px-3 py-1 text-xs font-bold text-white backdrop-blur-md sm:px-4 sm:py-1.5 sm:text-sm">
            <MapPin size={14} className={`mr-1 inline ${ZONE_TINT[hud.zone] ?? "text-emerald-300"}`} />
            <span className={ZONE_TINT[hud.zone] ?? ""}>{hud.zone}</span> · {time} {night ? <Moon size={14} className="inline text-indigo-200" /> : <Sun size={14} className="inline text-yellow-300" />}
          </div>
          <div className="hidden rounded-full bg-black/35 px-3 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-md sm:block sm:text-sm">
            <Timer size={14} className="mr-1 inline text-sky-200" />{runTime}
          </div>
        </div>
        {/* objective progress */}
        <div className="flex w-52 flex-col rounded-xl bg-black/35 px-3 py-1.5 backdrop-blur-md sm:w-64">
          <div className="flex items-center justify-between text-[11px] font-black text-white/90">
            <span className="flex items-center gap-1"><Flag size={11} className="text-emerald-300" /> {hud.won ? "Democracy saved!" : "Deliver votes to Parliament"}</span>
            <span className="text-yellow-300">{hud.delivered}/{hud.total}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/15">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-yellow-300"
              animate={{ width: `${(hud.delivered / hud.total) * 100}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>
        {/* spawn grace shield */}
        <AnimatePresence>
          {graceT && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-500/25 px-3 py-1 text-xs font-black text-emerald-100 backdrop-blur"
            >
              <ShieldCheck size={14} /> Sneak shield: police can&apos;t spot you ({Math.ceil(engine.invulnT)}s)
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* top-right: minimap + score */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <Minimap engine={engine} onOpen={() => setBigMap(true)} />
        <div className="pointer-events-auto flex items-center gap-2">
          <motion.div
            key={hud.points}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 16 }}
            className="rounded-xl bg-black/35 px-3 py-1 text-sm font-black tabular-nums text-yellow-300 backdrop-blur-md"
            aria-label="Score"
          >
            {hud.points} pts
          </motion.div>
          {showFps && <FpsCounter />}
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
          <Button
            size="icon" variant="ghost" aria-label="Pause game"
            className="h-9 w-9 rounded-xl bg-black/35 text-white backdrop-blur-md hover:bg-black/50"
            onClick={togglePause}
          >
            <Pause size={16} />
          </Button>
        </div>
        {showHelp && (
          <div className="max-w-[220px] rounded-xl bg-black/40 px-3 py-2 text-xs leading-relaxed text-white/90 backdrop-blur-md">
            <b className="text-yellow-300">Goal:</b> snatch 🗳 votes, deliver them at the Parliament ballot box. Rescue pink-bubbled friends with <b>E</b>. Dodge the police — sprint with <b>Shift</b>!
            <div className="mt-1 text-amber-200/90">⚡ Sprinting drains energy · run over 🥭☕🩹 food to pocket it, then tap the bag (or press <b>1-8</b>) to eat: heals ❤ and refills ⚡.</div>
            {!touch && <div className="mt-1 text-white/70">WASD move · mouse steers the camera (click = lock cursor) · Shift sprint · Space jump ×2 (flip!) · E rescue · 1-8 eat · right-click drop · M map · Esc / P pause</div>}
          </div>
        )}
      </div>

      {/* mouse steering hint — the cursor is bound to the game while playing */}
      {!touch && !paused && !victoryOpen && !hud.detained && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2">
          <AnimatePresence mode="wait">
            {mouseLocked ? (
              lockTip ? (
                <motion.div
                  key="lock-tip" role="status"
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="rounded-full bg-black/45 px-4 py-1.5 text-xs font-bold text-white/90 backdrop-blur-md"
                >
                  Mouse locked to the game — press <b className="text-yellow-300">Esc</b> to pause
                </motion.div>
              ) : null
            ) : (
              <motion.div
                key="steer-tip" role="status"
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-1.5 rounded-full bg-black/45 px-4 py-1.5 text-xs font-bold text-white/90 backdrop-blur-md"
              >
                <Mouse size={13} aria-hidden />
                <span>Move the mouse to steer — click to lock the cursor</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* prompt */}
      {hud.prompt && (
        <div role="status" className="absolute bottom-36 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-emerald-500/90 px-5 py-2 font-black text-white shadow-xl sm:bottom-28">
          {hud.prompt}
        </div>
      )}

      {/* toasts */}
      <div className="absolute bottom-24 left-1/2 z-10 flex w-[90%] max-w-md -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-24">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
              className={`flex max-w-full items-start gap-1.5 rounded-2xl px-4 py-1.5 text-center text-sm font-bold shadow-lg backdrop-blur-md ${
                t.kind === "good" ? "bg-emerald-500/85 text-white" : t.kind === "bad" ? "bg-rose-600/85 text-white" : "bg-slate-800/80 text-white"
              }`}
            >
              {toastIcon(t.kind)}
              <span>{t.msg}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* detained overlay */}
      <AnimatePresence>
        {hud.detained && (
          <motion.div
            role="alert"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-rose-950/40 backdrop-blur-[2px]"
          >
            <motion.div
              initial={{ scale: 2.6, rotate: -24, opacity: 0 }}
              animate={{ scale: 1, rotate: -8, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="rounded-3xl border-4 border-rose-400/70 bg-black/60 px-10 py-7 text-center"
            >
              <div className="text-4xl font-black tracking-wide text-rose-300">CAUGHT! 😵</div>
              <div className="mt-1 text-white">Police time-out: {Math.ceil(hud.detainLeft)}s</div>
              <div className="mt-1 text-xs font-bold text-rose-200/90">
                Then you respawn at a random city spot — fresh start, police far away!
              </div>
              <div className="mx-auto mt-3 h-2.5 w-44 overflow-hidden rounded-full bg-white/15">
                <motion.div
                  className="h-full rounded-full bg-rose-400"
                  animate={{ width: `${(1 - hud.detainLeft / DETAIN_SECONDS) * 100}%` }}
                  transition={{ ease: "linear", duration: 0.2 }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* pause menu */}
      <AnimatePresence>
        {paused && (
          <PauseMenu
            engine={engine}
            onQuit={() => {
              if (onQuit) { onQuit(); return; }
              // fallback when no GameRoot handler is wired
              engine.running = false;
              stopMusic();
              setPaused(false);
              useGame.getState().setVictoryOpen(false);
              useGame.getState().recordRun(useGame.getState().hud.points, useGame.getState().hud.delivered, useGame.getState().hud.rescues, engine.caughtCount, false, Math.round(useGame.getState().hud.elapsed * 1000));
              useGame.getState().setScreen("landing");
            }}
          />
        )}
      </AnimatePresence>

      {/* food pockets — desktop: bottom-left corner */}
      {!touch && (
        <div className="absolute bottom-3 left-3 z-10">
          <ItemBar engine={engine} />
        </div>
      )}

      {/* mobile controls */}
      {touch && !paused && (
        <>
          <div className="absolute bottom-[10rem] left-4 z-10"><ItemBar engine={engine} vertical /></div>
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

      {/* bottom-right: big-map shortcut + coords (narrow) + city life */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
        {!touch && (
          <button
            data-ui type="button" onClick={() => setBigMap(true)} title="Big map (M)"
            aria-label="Open big map"
            className="pointer-events-auto flex items-center gap-1 rounded-lg bg-black/45 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white/80 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-yellow-200"
          >
            <MapIcon size={11} /> M — big map
          </button>
        )}
        {!touch && (
          <div className="md:hidden">
            <CoordsChip px={hud.px} pz={hud.pz} />
          </div>
        )}
        <div className="rounded-xl bg-black/30 px-3 py-1 text-xs text-white/80 backdrop-blur-md">
          🚓 {hud.police} police · 🧍 {hud.civilians} civilians
        </div>
      </div>

      {/* bottom-center: controls hint + location chip (old-game footer, revived) —
          narrow desktops hide the center stack and tuck the coords chip bottom-right instead */}
      {!touch && (
        <div className="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-1.5 md:flex">
          <div className="hidden whitespace-nowrap rounded-full bg-black/45 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white/75 backdrop-blur-md lg:block">
            WASD move · Shift sprint · Space jump ×2 · E rescue · 1-8 eat
          </div>
          <CoordsChip px={hud.px} pz={hud.pz} />
        </div>
      )}

      {/* big world map overlay */}
      <AnimatePresence>
        {bigMap && <BigMap engine={engine} onClose={() => setBigMap(false)} />}
      </AnimatePresence>
    </div>
  );
}
