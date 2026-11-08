"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Heart, Zap, Star, Sun, Moon, MapPin, Volume2, VolumeX, Pause, Play as PlayIcon,
  Gauge, CircleHelp, Flag, Home, Settings as SettingsIcon, CheckCircle2, Siren, Info, ShieldCheck,
  ChevronUp, Timer, Package, Copy, Check, X, Map as MapIcon, Mouse,
} from "lucide-react";
import type { GameEngine } from "@/lib/game/engine";
import { DETAIN_SECONDS, ITEMS, INV_SLOTS, NIGHTS_TOTAL, POLICE_STATIONS, POWERS, TOOLS } from "@/lib/game/constants";
import { useGame } from "./store";
import { requestGameLock } from "./Scene";
import { setMuted as setAudioMuted, sfx, stopMusic, startMusic } from "@/lib/game/audio";
import { Button } from "@/components/ui/button";
import { HowToPlay, SettingsDialog } from "./Panels";

/** 🌐 per-slot colors for the co-op souls (matches the lobby chips) */
const SOUL_COLORS = ["#f472b6", "#fbbf24", "#4ade80", "#2dd4bf", "#f87171", "#c084fc", "#fb923c", "#a3e635"];

/* ------- shared world-map canvas painting (156px minimap + 440px big map).
   mini = true → clean survival view: terrain, landmarks, night zombies & YOU only —
   all the food/loot/police/contestant clutter stays on the big map (M). ------- */
function drawWorldMap(c: CanvasRenderingContext2D, S: number, engine: GameEngine, night: boolean, mini = false) {
  const K = S / 1150;         // world units → px (fits the bigger 545-radius wall)
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
  dot(0, 0, 712 * K, "#4a4038");     // ⛰️ rough mountain band hugging the wall
  dot(0, 0, 610 * K, "#1c3f24");     // deep jungle — darker outer band hugging the mountains
  dot(0, 0, 545 * K, "#2d5a2e");
  dot(0, 0, 465 * K, "#7a8f3f");
  dot(0, 0, 405 * K, "#8d8a80");
  dot(-255, 215, 45 * K, "#3a3a46");
  // VoteChor International — runway strip + apron block (south-east)
  c.fillStyle = "#54565e";
  c.fillRect(S / 2 + 215 * K, S / 2 + (300 - 8) * K, 170 * K, 16 * K);
  c.fillStyle = "#8d8d94";
  c.fillRect(S / 2 + 228 * K, S / 2 + 312 * K, 92 * K, 24 * K);
  if (S > 300) {
    // big map only: zone rings, graveyard fence and district labels
    c.strokeStyle = "rgba(255,255,255,0.22)";
    c.lineWidth = 1;
    for (const r of [405, 465, 545, 610]) { c.beginPath(); c.arc(S / 2, S / 2, r * K, 0, 6.3); c.stroke(); }
    c.setLineDash([3, 3]);
    c.beginPath(); c.arc(S / 2, S / 2, 700 * K, 0, 6.3); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.arc(S / 2 - 255 * K, S / 2 + 215 * K, 45 * K, 0, 6.3); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.font = `700 ${Math.round(7 * U)}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = "center";
    c.fillText("CITY", S / 2, S / 2 + 150 * K);
    c.fillText("FARMLAND", S / 2, S / 2 + 435 * K);
    c.fillText("JUNGLE", S / 2 - 370 * K, S / 2 - 350 * K);
    c.fillText("DEEP JUNGLE", S / 2 + 390 * K, S / 2 - 390 * K);
    c.fillText("⛰ MOUNTAINS", S / 2 + 480 * K, S / 2 + 480 * K);
    c.fillText("GRAVEYARD", S / 2 - 255 * K, S / 2 + 265 * K);
    c.fillText("✈ AIRPORT", S / 2 + 295 * K, S / 2 + 345 * K);
  }
  // parliament
  c.fillStyle = "#e0483a";
  c.fillRect(S / 2 - 4 * U, S / 2 - 196 * K - 3 * U, 8 * U, 6 * U);
  // ballot (big map only — the mini stays clean)
  if (!mini) {
    c.fillStyle = "#f7c948";
    c.beginPath(); c.arc(S / 2, S / 2 - 170 * K, 2.6 * U, 0, 6.3); c.fill();
  }
  // police stations — white squares with a navy badge
  for (const st of POLICE_STATIONS) {
    const sx = S / 2 + st.x * K, sz = S / 2 + st.z * K;
    const r = 4.6 * U;
    c.fillStyle = "#f2f4f0";
    c.strokeStyle = "#1d2a4a";
    c.lineWidth = Math.max(1, U);
    c.beginPath(); c.rect(sx - r, sz - r, r * 2, r * 2); c.fill(); c.stroke();
    c.fillStyle = "#1d2a4a";
    c.font = `900 ${Math.round(6.5 * U)}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("P", sx, sz + 0.5);
  }
  /* 🧹 mini map declutter: vans, food, licenses, power gems, votes, loot, police,
     civilians, vote-runners, animals, crew, co-op souls, dropped arms, builds and
     planes are BIG-MAP-ONLY — the corner minimap shows just terrain, landmarks,
     tonight's zombie horde and you. */
  if (!mini) {
    // police vans on an arrest run
    for (const van of engine.vans) if (van.state !== "idle") dot(van.x, van.z, 2.6 * U, "#ff4d5e", 0.95);
    for (const it of engine.items) if (it.active) dot(it.x, it.z, 1.1 * U, "#ffd166", 0.8);
    // driving-license cards — sky-blue with a white core so they pop next to food
    for (const lc of engine.licenses) if (lc.active) { dot(lc.x, lc.z, 2.7 * U, "#38bdf8", 0.95); dot(lc.x, lc.z, 1.15 * U, "#ffffff", 0.9); }
    // rare super-power gems — glowing coloured dots (hunt them in the jungle!)
    for (const pw of engine.powers) if (pw.active) dot(pw.x, pw.z, 2.8 * U, POWERS[pw.def].color, 0.95);
    for (const v of engine.votes) if (v.state === "world") dot(v.x, v.z, 2.2 * U, "#f7c948");
    // 💰 dropped loot — bright pulsing gold so you can race the bots to it
    for (const l of engine.loot) { dot(l.x, l.z, 3 * U, "#ffd447", 0.95); dot(l.x, l.z, 1.3 * U, "#fff7d6", 0.9); }
    for (const cop of engine.cops) {
      const chasing = cop.mode === "chase";
      dot(cop.x, cop.z, (chasing ? 3 : 2) * U, chasing ? "#ff4d4d" : "#6aa0ff");
    }
    for (const cv of engine.civs) if (cv.mode === "detained") dot(cv.x, cv.z, 3 * U, "#ff8fa3");
    // police side: vote-runners stand out — amber specks, carriers glow bright with loot
    if (engine.side === "police") {
      for (const cv of engine.civs) {
        if (!cv.runner || cv.mode === "detained") continue;
        dot(cv.x, cv.z, (cv.voteId ? 2.7 : 1.9) * U, cv.voteId ? "#ffb020" : "#f0b455", cv.voteId ? 1 : 0.85);
      }
    }
    // farm & jungle animals — little brown specks so the world feels alive on the map
    for (const an of engine.animals) dot(an.x, an.z, 1.3 * U, "#a97b4f", 0.8);
  }
  // night danger: the risen horde — the ONE thing the mini must never hide
  if (night) for (const zb of engine.zombies) dot(zb.x, zb.z, 2.4 * U, "#c084fc");
  if (!mini) {
    // 7 Nights: the crew — each survivor in their color; the fallen leave a dark-red ✕ where they died
    for (const cm of engine.crew) {
      if (cm.alive) dot(cm.x, cm.z, 2.7 * U, cm.color, 0.95);
      else {
        const dx = S / 2 + cm.deathX * K, dz = S / 2 + cm.deathZ * K;
        c.strokeStyle = "#7f1d1d";
        c.lineWidth = Math.max(1, 1.1 * U);
        c.beginPath();
        c.moveTo(dx - 2.2 * U, dz - 2.2 * U); c.lineTo(dx + 2.2 * U, dz + 2.2 * U);
        c.moveTo(dx + 2.2 * U, dz - 2.2 * U); c.lineTo(dx - 2.2 * U, dz + 2.2 * U);
        c.stroke();
      }
    }
    // 🌐 co-op souls — cyan-ringed dots so real players pop against the bots
    if (engine.mp) {
      for (const r of engine.remotes) {
        const col = SOUL_COLORS[r.slot % SOUL_COLORS.length];
        if (r.alive) {
          dot(r.x, r.z, 2.9 * U, col, 1);
          c.strokeStyle = "#67e8f9";
          c.lineWidth = Math.max(1, 0.9 * U);
          c.beginPath();
          c.arc(S / 2 + r.x * K, S / 2 + r.z * K, 3.6 * U, 0, Math.PI * 2);
          c.stroke();
        } else {
          dot(r.x, r.z, 2.2 * U, "#7f1d1d", 0.8);
        }
      }
    }
    // dropped arms (yellow specks) + builds — brown barricade square / ember campfire
    for (const te of engine.toolEnts) if (te.active) dot(te.x, te.z, 1.7 * U, "#facc15", 0.9);
    for (const b of engine.builds) {
      if (b.kind === "campfire") { dot(b.x, b.z, 2.7 * U, "#fb923c", 0.95); dot(b.x, b.z, 1.2 * U, "#fde68a", 0.9); }
      else {
        c.fillStyle = "#92400e";
        c.fillRect(S / 2 + b.x * K - 2.2 * U, S / 2 + b.z * K - 2.2 * U, 4.4 * U, 4.4 * U);
      }
    }
    // bot planes — sky-blue arrow heads so the random flights read on the map
    for (const pl of engine.planes) {
      const px = S / 2 + pl.x * K, pz = S / 2 + pl.z * K;
      c.save();
      c.translate(px, pz);
      c.rotate(-pl.hdg + Math.PI / 2); // heading 0 = +x (map-east)
      c.beginPath();
      c.moveTo(0, -3.4 * U); c.lineTo(2.2 * U, 2.4 * U); c.lineTo(-2.2 * U, 2.4 * U);
      c.closePath();
      c.fillStyle = pl.alt > 2 ? "#7dd3fc" : "#94a3b8";
      c.fill();
      c.restore();
    }
  }
  /* player: white direction arrow (amber outline) — rotation −yaw maps camera
     forward (−sin yaw, −cos yaw) onto the fixed-north map (up = −z) */
  c.save();
  c.translate(S / 2 + engine.player.x * K, S / 2 + engine.player.z * K);
  c.rotate(-engine.input.yaw);
  const pr = 4.6 * U;
  c.beginPath();
  c.moveTo(0, -pr); c.lineTo(pr * 0.78, pr * 0.82); c.lineTo(0, pr * 0.45); c.lineTo(-pr * 0.78, pr * 0.82);
  c.closePath();
  c.fillStyle = "#ffffff";
  c.strokeStyle = "#f59e0b";
  c.lineWidth = Math.max(1, 0.9 * U);
  c.fill();
  c.stroke();
  c.restore();
}

/* ----------------------------- minimap ----------------------------- */
function Minimap({ engine, onOpen }: { engine: GameEngine; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) drawWorldMap(c, 156, engine, hud.night > 0.5, true); // mini: decluttered survival view
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
  ["#ffffff", "You (arrow = facing)"], ["#f7c948", "💰 Cash piles"], ["#ffd166", "Food"], ["#c084fc", "Power gems (rare!)"],
  ["#38bdf8", "Driving license 🪪"], ["#6aa0ff", "Police"], ["#ff4d4d", "Chasing!"], ["#ff8fa3", "Rescue"], ["#a97b4f", "Animals"], ["#c084fc", "Zombies · night"], ["#1d2a4a", "Police stn"],
  ["#ffb020", "Vote runner (bright = carrying)"],
  ["#e2e8f0", "Crew survivors (each their color)"], ["#7f1d1d", "Fallen crew ✕"],
  ["#facc15", "Dropped arms"], ["#ffd447", "💰 Loot drops"], ["#92400e", "Barricade"], ["#fb923c", "Campfire"],
];
function BigMap({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) drawWorldMap(c, BIG_MAP_S, engine, hud.night > 0.5, false); // big map: full detail
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

/* ------- 🌙 night strip — 7-moon story tracker + phase countdown (top-center).
   Replaces the old vote/police objective cards: the 7Nights story IS the objective. ------- */
function NightStrip() {
  const nightNo = useGame((s) => s.hud.nightNo);
  const phase = useGame((s) => s.hud.phase);
  const phaseLeft = useGame((s) => s.hud.phaseLeft);
  const crewAlive = useGame((s) => s.hud.crewAlive);
  const aliveTotal = useGame((s) => s.hud.aliveTotal);
  const youPossessed = useGame((s) => s.hud.youPossessed);
  const beastCount = useGame((s) => s.hud.beastCount);
  const beast = youPossessed && phase === "night";
  const secs = Math.max(0, Math.ceil(phaseLeft));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const survived = Math.max(0, Math.min(NIGHTS_TOTAL, nightNo - 1));
  const label = beast
    ? "🔪 YOU ARE A BEAST — F to claw"
    : phase === "dusk" ? `⚠️ NIGHT FALLS IN ${secs}s`
    : phase === "night" ? `🌑 NIGHT ${nightNo} — ${beastCount > 0 ? `${beastCount} ZOMBIES HUNT YOU` : "THE HUNTED WALK"}`
    : phase === "dawn" ? "🌅 DAWN — you made it"
    : `☀️ DAY ${nightNo} — gather & build`;
  const hot = phase === "dusk" || phase === "night";
  return (
    <div className="flex items-center gap-1.5">
      <motion.div
        role="status"
        aria-label={`Night ${nightNo} of ${NIGHTS_TOTAL}, ${phase} phase, ${mm}:${ss} left, ${crewAlive + 1} of ${aliveTotal} souls alive`}
        animate={phase === "dusk" ? { opacity: [1, 0.62, 1], scale: [1, 1.03, 1] } : { opacity: 1, scale: 1 }}
        transition={phase === "dusk" ? { repeat: Infinity, duration: 1.05 } : { duration: 0.2 }}
        className={`flex items-center gap-2 rounded-full border px-3 py-1 backdrop-blur-md ${
          beast ? "border-rose-400/70 bg-rose-950/70 shadow-[0_0_16px_rgba(244,63,94,0.5)]"
            : hot ? "border-rose-400/50 bg-black/60 shadow-[0_0_14px_rgba(190,18,60,0.35)]"
            : "border-white/20 bg-black/45"
        }`}
      >
        {/* 7 moon pips — dark moons = nights survived, the current one glows half-lit */}
        <span className="flex items-center gap-0.5" aria-hidden>
          {Array.from({ length: NIGHTS_TOTAL }, (_, i) => (
            <span
              key={i}
              className={`text-[10px] leading-none sm:text-xs ${i === nightNo - 1 ? "drop-shadow-[0_0_4px_rgba(255,255,255,0.85)]" : ""} ${i < survived || i === nightNo - 1 ? "" : "opacity-25"}`}
            >
              {i < survived ? "🌑" : i === nightNo - 1 ? (phase === "night" ? "🌗" : "🌘") : "🌑"}
            </span>
          ))}
        </span>
        <span className={`whitespace-nowrap text-[10px] font-black uppercase tracking-wider sm:text-[11px] ${hot ? "text-rose-300" : "text-white/90"}`}>
          {label}
        </span>
        {!beast && phase !== "dusk" && (
          <span className="rounded bg-white/10 px-1 text-[10px] font-black tabular-nums text-white/80 sm:text-[11px]">{mm}:{ss}</span>
        )}
      </motion.div>
      <span
        title={`${crewAlive + 1} of ${aliveTotal} souls still breathing`}
        className={`rounded-full border px-2 py-1 text-[10px] font-black tabular-nums backdrop-blur-md ${crewAlive + 1 <= 10 ? "border-rose-400/60 bg-rose-950/50 text-rose-100" : "border-white/20 bg-black/45 text-white/90"}`}
      >
        🧍 {crewAlive + 1}/{aliveTotal}
      </span>
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

/* ------------- 🎒 tool belt: ✊ hands + every collected arm. Click equips
   (engine.setHeld); the tiny G badge hints at the radial tool wheel. ------------- */
function ToolBelt({ engine }: { engine: GameEngine }) {
  const tools = useGame((s) => s.hud.tools);
  const held = useGame((s) => s.hud.held);
  const pick = (i: number) => engine.setHeld(i);
  const slot = "relative flex h-10 w-10 items-center justify-center rounded-xl border-2 shadow-lg backdrop-blur-md transition-colors sm:h-12 sm:w-12";
  return (
    <div
      data-ui
      role="toolbar"
      aria-label="Tool belt — click to equip an arm; G opens the radial tool wheel"
      className="pointer-events-auto w-fit max-w-[11rem] rounded-2xl bg-black/35 p-1.5 backdrop-blur-md"
    >
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onPointerDown={(e) => { e.stopPropagation(); pick(-1); }}
          title="Bare hands — find arms around town"
          aria-label="Equip bare hands"
          aria-pressed={held === -1}
          className={`${slot} ${held === -1 ? "border-amber-300 bg-amber-400/25 shadow-[0_0_10px_rgba(252,211,77,0.55)]" : "border-white/30 bg-white/10 hover:border-amber-300/80"}`}
        >
          <span className="text-lg leading-none sm:text-2xl" aria-hidden>✊</span>
          <span className="absolute -bottom-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded bg-black/75 text-[8px] font-black text-white/90">G</span>
        </button>
        {tools.map((t, i) => {
          const d = TOOLS.find((x) => x.kind === t.kind);
          const on = held === i;
          return (
            <button
              key={t.kind}
              type="button"
              onPointerDown={(e) => { e.stopPropagation(); pick(i); }}
              title={`${d?.name ?? t.kind} — ${d?.tip ?? ""}`}
              aria-label={`Equip ${d?.name ?? t.kind}`}
              aria-pressed={on}
              className={`${slot} ${on ? "" : "border-white/30 bg-white/10 hover:border-amber-300/80"}`}
              style={on && d ? { borderColor: d.color, background: `${d.color}38`, boxShadow: `0 0 10px ${d.color}88` } : undefined}
            >
              <span className="text-lg leading-none sm:text-2xl" aria-hidden>{d?.emoji ?? "🪓"}</span>
              {t.count > 1 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-black/40 bg-amber-400 px-1 text-[10px] font-black text-amber-950">{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 w-fit rounded-lg bg-black/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/75">
        G — tool wheel
      </div>
    </div>
  );
}

/* ------------- active super-power badge (lives inside the vitals card) ------------- */
function PowerBadge() {
  const power = useGame((s) => s.hud.power);
  const blinkReady = useGame((s) => s.hud.blinkReady);
  const touch = useGame((s) => s.touch);
  if (!power) return null;
  const pct = Math.max(0, Math.min(100, (power.left / power.max) * 100));
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }}
      className="rounded-xl border-2 px-2.5 py-1 backdrop-blur-md"
      style={{ borderColor: power.color, background: "rgba(0,0,0,0.4)", boxShadow: `0 0 12px ${power.color}55` }}
      role="status"
      aria-label={`${power.name} active, ${Math.ceil(power.left)} seconds left`}
    >
      <div className="flex items-center gap-1.5">
        <motion.span
          animate={{ scale: [1, 1.22, 1], rotate: [0, -8, 8, 0] }}
          transition={{ repeat: Infinity, duration: 1.4 }}
          className="text-lg leading-none"
          aria-hidden
        >{power.emoji}</motion.span>
        <div>
          <div className="text-[11px] font-black leading-tight" style={{ color: power.color }}>{power.name}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-white/70">
            {power.kind === "blink" ? (blinkReady ? (touch ? "tap 🌀 to teleport" : "press Q to teleport") : "recharging…") : power.tip}
          </div>
        </div>
        <span className="ml-0.5 rounded-md bg-black/50 px-1 text-[11px] font-black tabular-nums text-white">{Math.ceil(power.left)}s</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: power.color }} />
      </div>
    </motion.div>
  );
}

/* ------------- pocketed power slots: every collected gem shows here, each fires ONCE.
   G unleashes the first; tapping a specific slot fires that one. ------------- */
function PowerSlots({ engine }: { engine: GameEngine }) {
  const pockets = useGame((s) => s.hud.pockets);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.5 }}
      className="pointer-events-auto flex items-end gap-2"
      role="group"
      aria-label="Pocketed super powers — tap one to unleash it"
    >
      {pockets.map((pocket, i) => (
        <motion.button
          key={`${pocket.def}-${i}`}
          data-ui
          type="button"
          whileTap={{ scale: 0.88 }}
          onClick={() => engine.usePowerAt(i)}
          title={`${pocket.name} — ${i === 0 ? "press G or tap" : "tap"} to unleash it now (one use!)`}
          aria-label={`Unleash stored ${pocket.name}`}
          className="relative flex h-12 w-12 items-center justify-center rounded-xl border-2 bg-black/45 shadow-lg backdrop-blur-md sm:h-14 sm:w-14"
          style={{ borderColor: pocket.color, boxShadow: `0 0 12px ${pocket.color}66` }}
        >
          <motion.span
            aria-hidden
            animate={{ scale: [1, 1.14, 1], rotate: [0, -7, 7, 0] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
            className="text-2xl leading-none sm:text-3xl"
          >{pocket.emoji}</motion.span>
          {i === 0 && (
            <span
              className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded text-[9px] font-black text-black"
              style={{ background: pocket.color }}
            >
              G
            </span>
          )}
        </motion.button>
      ))}
    </motion.div>
  );
}

/* ------------- 🎯 tool wheel — radial picker at screen center (G). -------------
   Opens with a FREE cursor (Scene exits pointer lock); the world keeps running.
   Mouse angle + per-slice hover both drive the selection (up = slot 0, clockwise);
   click / G / Enter arms the hovered slice, Esc or backdrop click cancels.      */
interface WheelApi { confirm: () => void; cancel: () => void }
type WheelSlice = { type: "hands" | "tool" | "power" | "license"; emoji: string; name: string; tip: string; color: string; index: number; badge?: string };

function ToolWheel({ engine, apiRef }: { engine: GameEngine; apiRef: { current: WheelApi | null } }) {
  const tools = useGame((s) => s.hud.tools);
  const pockets = useGame((s) => s.hud.pockets);
  const held = useGame((s) => s.hud.held);
  const phase = useGame((s) => s.hud.phase);
  const youPossessed = useGame((s) => s.hud.youPossessed);
  const hasLicense = useGame((s) => s.hud.hasLicense);
  const setWheelOpen = useGame((s) => s.setWheelOpen);
  const [hover, setHover] = useState(-1);
  const circleRef = useRef<HTMLDivElement>(null);

  const beast = youPossessed && phase === "night";
  const slices: WheelSlice[] = beast
    ? [{ type: "hands", emoji: "🔪", name: "Claws", tip: "You ARE the beast — F to claw", color: "#ff4d5e", index: -1 }]
    : [
        { type: "hands", emoji: "✊", name: "Bare hands", tip: "Find arms around town", color: "#94a3b8", index: -1 },
        ...tools.map((t, i) => {
          const d = TOOLS.find((x) => x.kind === t.kind);
          return { type: "tool" as const, emoji: d?.emoji ?? "🪓", name: d?.name ?? t.kind, tip: d?.tip ?? "", color: d?.color ?? "#e2e8f0", index: i, badge: `×${t.count}` };
        }),
        ...pockets.map((p, i) => ({ type: "power" as const, emoji: p.emoji, name: p.name, tip: `${p.tip} — SINGLE USE`, color: p.color, index: i, badge: "1×" })),
        // 🪪 the driving license rides in the wheel too — pick it to show the card
        // (and hand it to the survivor next to you)
        ...(hasLicense ? [{ type: "license" as const, emoji: "🪪", name: "License", tip: "Show your driving license · F 🤝 give to a survivor / 📦 drop it", color: "#38bdf8", index: -1 }] : []),
      ];
  const N = Math.max(1, slices.length);

  const close = () => { setWheelOpen(false); requestGameLock(); };
  const confirm = (i: number) => {
    const s = slices[i];
    if (s && !beast) {
      if (s.type === "tool") engine.setHeld(s.index);
      else if (s.type === "power") engine.usePowerAt(s.index);
      else if (s.type === "license") useGame.getState().setLicenseOpen(true); // 🪪 show the card
      else engine.setHeld(-1);
    }
    close(); // beast claws / empty picks just close
  };

  // keep Hud's global keydown armed with fresh closures (runs after every render)
  useEffect(() => {
    apiRef.current = { confirm: () => confirm(hover), cancel: close };
    return () => { apiRef.current = null; };
  });

  // free-cursor aiming: mouse angle from the wheel center → slice (up = 0, clockwise)
  const aim = (e: React.MouseEvent) => {
    const el = circleRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist < r.width * 0.16 || dist > r.width * 0.5) { setHover(-1); return; } // hub & backdrop = no pick
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;                  // 0° = right, screen-y down
    const fromUp = (((deg + 90) % 360) + 360) % 360;                   // rotate so up = 0°, clockwise
    const idx = Math.floor(((fromUp + 180 / N) % 360) / (360 / N));    // center each slice on its sector
    setHover(Math.max(0, Math.min(slices.length - 1, idx)));
  };

  const heldSlice = beast
    ? slices[0]
    : held >= 0 && held < tools.length ? slices[1 + held] : slices[0];
  const bareBelt = !beast && tools.length === 0 && pockets.length === 0;
  const center: WheelSlice | undefined = bareBelt
    ? { type: "hands", emoji: "✊", name: "Bare hands", tip: "No arms yet — find 🪓🗡️🔨🔧 around town!", color: "#94a3b8", index: -1 }
    : hover >= 0 ? slices[hover] : heldSlice;

  return (
    <motion.div
      data-ui
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
      role="dialog"
      aria-label="Tool wheel — pick an arm or a pocketed power"
      onClick={close} // backdrop click = cancel (the circle stops propagation)
      onMouseMove={aim}
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: "radial-gradient(circle at 50% 50%, rgba(2,6,23,0.42) 0%, rgba(2,6,23,0.72) 55%, rgba(2,6,23,0.9) 100%)" }}
    >
      <motion.div
        ref={circleRef}
        initial={{ scale: 0.85, rotate: -8 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        onClick={(e) => { e.stopPropagation(); confirm(hover); }}
        className="relative h-[min(70vw,380px)] w-[min(70vw,380px)] cursor-pointer rounded-full border border-white/15"
        style={{ background: "radial-gradient(circle, rgba(15,23,42,0.85) 0%, rgba(2,6,23,0.3) 100%)", boxShadow: "0 0 60px rgba(0,0,0,0.6)" }}
      >
        {slices.map((s, i) => {
          const ang = (360 / N) * i;
          const active = hover === i;
          return (
            <button
              key={`${s.type}-${s.index}`}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={(e) => { e.stopPropagation(); confirm(i); }}
              aria-label={`${s.name}${s.badge ? ` (${s.badge})` : ""}`}
              className="absolute left-1/2 top-1/2 flex h-16 w-20 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 backdrop-blur-md transition-[border-color,background-color,box-shadow] duration-100 sm:h-[4.5rem] sm:w-24"
              style={{
                transform: `translate(-50%, -50%) rotate(${ang}deg) translateY(calc(min(70vw, 380px) * -0.335)) rotate(${-ang}deg) scale(${active ? 1.12 : 1})`,
                borderColor: active ? s.color : "rgba(255,255,255,0.25)",
                background: active ? `${s.color}2e` : "rgba(2,6,23,0.72)",
                boxShadow: active ? `0 0 20px ${s.color}99` : "0 2px 10px rgba(0,0,0,0.45)",
              }}
            >
              <span className="text-2xl leading-none" aria-hidden>{s.emoji}</span>
              <span className="max-w-full truncate px-1 text-[9px] font-black uppercase tracking-wider text-white/85">{s.name}</span>
              {s.badge && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-black/40 bg-amber-400 px-1 text-[9px] font-black text-amber-950">{s.badge}</span>
              )}
            </button>
          );
        })}
        {/* center hub — hovered slice, else what's currently held */}
        {center && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 w-[38%] -translate-x-1/2 -translate-y-1/2 text-center">
            <div className="text-sm font-black leading-tight" style={{ color: center.color }}>{center.emoji} {center.name}</div>
            <div className="mt-0.5 text-[9px] font-semibold leading-snug text-white/70">{center.tip}</div>
          </div>
        )}
        <div className="pointer-events-none absolute left-1/2 top-[88%] -translate-x-1/2 whitespace-nowrap rounded-full bg-black/65 px-2 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-white/55">
          click / G pick · Esc close
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------- 🪪 driving-license card — shown from the G wheel. -------------
   A proper ID card: photo, name, issuing night, plus 🤝 GIVE (F) and 📦 DROP
   actions — give hands the license to the closest survivor (real teammate over
   the wire in multiplayer, else the fellow survivor next to you); with nobody
   in reach the card drops on the ground for anyone to scoop up.             */
function LicenseCard({ engine }: { engine: GameEngine }) {
  const hasLicense = useGame((s) => s.hud.hasLicense);
  const name = useGame((s) => s.playerName);
  const look = useGame((s) => s.look);
  const nightNo = useGame((s) => s.hud.nightNo);
  const side = useGame((s) => s.hud.side);
  const close = () => { useGame.getState().setLicenseOpen(false); requestGameLock(); };

  const licNo = `7N-${(name || "SURV").slice(0, 4).toUpperCase().padEnd(4, "X")}-${String(1000 + ((look.shirt.length * 731 + look.hair.length * 97) % 9000))}`;

  return (
    <motion.div
      data-ui
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
      role="dialog"
      aria-label="Driving license card"
      onClick={close}
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: "radial-gradient(circle at 50% 50%, rgba(2,6,23,0.42) 0%, rgba(2,6,23,0.72) 55%, rgba(2,6,23,0.9) 100%)" }}
    >
      <motion.div
        initial={{ scale: 0.8, y: 26, rotate: -3 }} animate={{ scale: 1, y: 0, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-sky-300/30 shadow-[0_0_60px_rgba(56,189,248,0.25)]"
        style={{ background: "linear-gradient(135deg,#0c2d4d 0%,#123a5e 55%,#0b2440 100%)" }}
      >
        {/* hologram strip */}
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#38bdf8,#a5f3fc,#38bdf8)" }} />
        <div className="flex items-start justify-between px-5 pt-4">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-sky-300/90">Republic of 7Nights</div>
            <div className="text-lg font-black leading-tight text-white">DRIVING LICENSE</div>
          </div>
          <span className="text-3xl" aria-hidden>🪪</span>
        </div>
        <div className="flex gap-4 px-5 py-4">
          {/* photo box — the survivor's own colours */}
          <div className="flex h-24 w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-xl border-2 border-sky-200/40 bg-gradient-to-b from-sky-400/25 to-sky-900/40">
            <span className="text-3xl" aria-hidden>🧍</span>
            <div className="mt-1 h-2.5 w-8 rounded-sm" style={{ background: look.shirt }} />
            <div className="mt-0.5 h-2 w-8 rounded-sm" style={{ background: look.pants }} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-base font-black text-white">{name || "Nameless Survivor"}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-sky-200/80">{side === "police" ? "On-duty officer" : "Survivor · civilian class"}</div>
            <div className="flex flex-wrap gap-1 pt-1 text-[9px] font-black">
              <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-emerald-200 ring-1 ring-emerald-300/40">✓ ALL CARS UNLOCKED</span>
              <span className="rounded-md bg-sky-400/15 px-1.5 py-0.5 text-sky-200 ring-1 ring-sky-300/30">ISSUED NIGHT {nightNo}</span>
            </div>
            <div className="pt-1 font-mono text-[10px] tracking-widest text-sky-100/60">{licNo}</div>
          </div>
        </div>
        <div className="border-t border-white/10 bg-black/25 px-5 py-3">
          {hasLicense ? (
            <>
              <div className="mb-2 text-center text-[10px] font-semibold leading-snug text-white/60">
                Press <b className="text-sky-300">F</b> to hand the license to the survivor next to you —
                nobody around? The card drops at your feet for anyone to grab.
              </div>
              <div className="flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => { engine.giveLicense(); close(); }}
                  className="shrink-0 rounded-xl bg-sky-400 text-xs font-black text-sky-950 hover:bg-sky-300"
                >
                  🤝 Give (F)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { engine.dropLicense(); close(); }}
                  className="shrink-0 rounded-xl border-sky-300/40 bg-white/5 text-xs font-black text-sky-100 hover:bg-white/10"
                >
                  📦 Drop
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center text-[10px] font-black uppercase tracking-wider text-amber-300">
              🤝 Handed away — hunt a glowing 🪪 card to drive again
            </div>
          )}
          <div className="pointer-events-none mt-2 text-center text-[8.5px] font-black uppercase tracking-widest text-white/35">
            F give / drop · Esc / G close
          </div>
        </div>
      </motion.div>
    </motion.div>
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
  // 0° = straight ahead of the camera; positive = clockwise (to the right).
  // camera-forward is (−sin yaw, −cos yaw) whose atan2(x,z) bearing is yaw+π,
  // so the correct screen rotation is π − (a − yaw) — the old formula was
  // vertically mirrored (arrow pointed AWAY from cops ahead of you).
  const deg = ((Math.PI - (best.a - engine.input.yaw)) * 180) / Math.PI;
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
  const blinkActive = useGame((s) => s.hud.power?.kind === "blink");
  const blinkReady = useGame((s) => s.hud.blinkReady);
  const pockets = useGame((s) => s.hud.pockets);
  const setWheelOpen = useGame((s) => s.setWheelOpen);
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
      {blinkActive && (
        <button
          aria-label="Blink teleport forward"
          className={`h-16 w-16 rounded-full border-2 border-white/50 text-2xl shadow-lg active:scale-95 ${blinkReady ? "bg-purple-400/90 text-purple-950" : "bg-white/20 text-white/50"}`}
          onTouchStart={(e) => { e.preventDefault(); engine.tryBlink(); }}
        >🌀</button>
      )}
      {pockets.map((pocket, i) => (
        <button
          key={`${pocket.def}-${i}`}
          aria-label={`Unleash stored ${pocket.name}`}
          className="h-16 w-16 rounded-full border-2 text-3xl shadow-lg active:scale-95"
          style={{ borderColor: pocket.color, background: "rgba(0,0,0,0.45)", boxShadow: `0 0 12px ${pocket.color}66` }}
          onTouchStart={(e) => { e.preventDefault(); engine.usePowerAt(i); }}
        >{pocket.emoji}</button>
      ))}
      {/* ⚔️ 7Nights verbs — attack, builds, accuse & the 🎒 tool wheel */}
      <div className="flex max-w-[6.75rem] flex-wrap justify-end gap-2">
        <button aria-label="Attack with held arm" className="h-14 w-14 rounded-full border-2 border-white/50 bg-rose-500/80 text-xl shadow-lg active:scale-95" onTouchStart={(e) => { e.preventDefault(); engine.attack(); }}>⚔️</button>
        <button aria-label="Place barricade" className="h-14 w-14 rounded-full border-2 border-white/50 bg-amber-700/80 text-xl shadow-lg active:scale-95" onTouchStart={(e) => { e.preventDefault(); engine.placeBuild("barricade"); }}>🛡️</button>
        <button aria-label="Light campfire" className="h-14 w-14 rounded-full border-2 border-white/50 bg-orange-500/80 text-xl shadow-lg active:scale-95" onTouchStart={(e) => { e.preventDefault(); engine.placeBuild("campfire"); }}>🔥</button>
        <button aria-label="Accuse the suspect" className="h-14 w-14 rounded-full border-2 border-white/50 bg-violet-500/80 text-xl shadow-lg active:scale-95" onTouchStart={(e) => { e.preventDefault(); engine.accuse(); }}>⚖️</button>
        <button aria-label="Open the tool wheel" className="h-14 w-14 rounded-full border-2 border-white/50 bg-slate-700/85 text-xl shadow-lg active:scale-95" onTouchStart={(e) => { e.preventDefault(); setWheelOpen(true); }}>🎒</button>
      </div>
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
    requestGameLock(); // re-weld the mouse to the camera — a fresh click gesture, so this is allowed
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
        <p className="mb-4 text-center text-xs text-white/60">Run time {mm}:{ss} · score {hud.points} · 🌙 night {hud.nightNo}</p>
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
        {hud.money > 0 && (
          <p className="mt-3 text-center text-[11px] text-emerald-300/90">
            This run: 💰 ₹{hud.money} banked · {hud.rescues} rescued · {hud.points} pts
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
  const setShowHelp = useGame((s) => s.setShowHelp);
  const showFps = useGame((s) => s.settings.showFps);
  const paused = useGame((s) => s.paused);
  const setPaused = useGame((s) => s.setPaused);
  const victoryOpen = useGame((s) => s.victoryOpen);
  const mouseLocked = useGame((s) => s.mouseLocked);
  const bigMap = useGame((s) => s.bigMapOpen);
  const setBigMap = useGame((s) => s.setBigMapOpen);
  const wheelOpen = useGame((s) => s.wheelOpen);
  const licenseOpen = useGame((s) => s.licenseOpen);
  const setLicenseOpen = useGame((s) => s.setLicenseOpen);
  // the 🎯 wheel publishes its confirm/cancel so the global keydown can G-confirm / Esc-cancel
  const wheelApi = useRef<WheelApi | null>(null);
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
  // 🪪 the license card is a modal too — free the cursor while it's up
  useEffect(() => {
    if (licenseOpen && document.pointerLockElement) document.exitPointerLock();
  }, [licenseOpen]);

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
    "Deep Jungle": "text-teal-300",
    Graveyard: "text-violet-200",
    Mountains: "text-orange-300",
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
      // 🪪 the license card is keyboard-boss while open: Esc/G/Enter put it away,
      // F hands the license to the closest survivor (nobody in reach? it drops
      // at your feet) — every other shortcut is swallowed so world keys never fire
      if (licenseOpen) {
        if (e.code === "Escape" || e.code === "KeyG" || e.code === "Enter") {
          e.preventDefault();
          setLicenseOpen(false);
          requestGameLock();
        } else if (e.code === "KeyF" && useGame.getState().hud.hasLicense) {
          e.preventDefault();
          engine.giveLicense(); // give if a survivor is close, else drop the card
          setLicenseOpen(false);
          requestGameLock();
        }
        return;
      }
      // 🎯 the open tool wheel is keyboard-boss: G/Enter confirm the hovered slice,
      // Esc cancels — and every other shortcut is swallowed while it's up
      if (wheelOpen) {
        if (e.code === "KeyG" || e.code === "Enter") { e.preventDefault(); wheelApi.current?.confirm(); }
        else if (e.code === "Escape") { e.preventDefault(); wheelApi.current?.cancel(); }
        return;
      }
      if (bigMap) {
        // the map swallows M / Esc so it always closes first
        if (e.code === "KeyM" || e.code === "Escape") { e.preventDefault(); setBigMap(false); requestGameLock(); }
        return;
      }
      if (e.code === "KeyM") { e.preventDefault(); setBigMap(true); return; }
      if (e.code === "KeyI") { e.preventDefault(); toggleHelp(); } // ⓘ goal card: show → auto-hide / toggle off
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
  }, [victoryOpen, engine, bigMap, togglePause, toggleHelp, wheelOpen, licenseOpen, setLicenseOpen]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dropToast(toasts[0].id), 3200);
    return () => clearTimeout(t);
  }, [toasts, dropToast]);

  // goal card is a HINT: every time it opens it auto-hides after 12 s —
  // press I (or tap the ⓘ button) to recall it for another round
  useEffect(() => {
    if (!showHelp) return;
    const t = setTimeout(() => setShowHelp(false), 12000);
    return () => clearTimeout(t);
  }, [showHelp, setShowHelp]);

  const toastIcon = (kind: string) =>
    kind === "good" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> :
    kind === "bad" ? <Siren size={15} className="mt-0.5 shrink-0" /> :
    <Info size={15} className="mt-0.5 shrink-0" />;

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans">
      {/* hide the OS mouse icon over the world while playing — pointer lock hides
          it natively; this covers browsers/iframes where the lock is blocked so
          the cursor never floats over the game (HUD controls keep their cursor).
          Scoped to the 3D canvas in Scene.tsx (cursor inherits to the canvas). */}

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

      {/* 🌑 night ambience — nights should feel scary even without the beast */}
      {hud.phase === "night" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-700" style={{ boxShadow: "inset 0 0 170px 60px rgba(2,6,23,0.6)" }} />
      )}

      {/* 🩸 possession warnings — the dusk transform… */}
      <AnimatePresence>
        {hud.phase === "dusk" && hud.youPossessed && (
          <motion.div key="possess-warn" aria-hidden className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <motion.div
              animate={{ opacity: [0.45, 0.85, 0.45] }}
              transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
              className="absolute inset-0"
              style={{ background: "radial-gradient(circle, transparent 26%, rgba(60,0,8,0.6) 100%)", boxShadow: "inset 0 0 200px 80px rgba(136,0,16,0.7)" }}
            />
            <motion.div
              animate={{ x: [0, -4, 3, -2, 4, 0], y: [0, 2, -3, 1, -1, 0], skewX: [0, -1.5, 1, 0] }}
              transition={{ repeat: Infinity, duration: 0.34, ease: "linear" }}
              className="relative text-center"
            >
              <div className="text-2xl font-black tracking-widest text-red-400 sm:text-5xl" style={{ textShadow: "0 0 22px rgba(255,30,30,0.95), 0 0 4px rgba(255,255,255,0.4)" }}>
                ⚠ YOU ARE BEING POSSESSED ⚠
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.35em] text-red-200/85 sm:text-xs">Fight it… or embrace it.</div>
            </motion.div>
          </motion.div>
        )}
        {hud.phase === "dusk" && !hud.youPossessed && hud.beastCount > 0 && (
          <motion.div key="pack-warn" aria-hidden className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex justify-center">
            <motion.div
              animate={{ opacity: [0.55, 1, 0.55], scale: [0.97, 1.03, 0.97] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
              className="rounded-2xl border border-amber-400/60 bg-black/70 px-5 py-2.5 text-center backdrop-blur-md"
              style={{ boxShadow: "0 0 34px rgba(251,191,36,0.35)" }}
            >
              <div className="text-lg font-black tracking-widest text-amber-300 sm:text-3xl" style={{ textShadow: "0 0 18px rgba(251,191,36,0.8)" }}>
                ⚠ {hud.beastCount > 1 ? `${hud.beastCount} SURVIVORS WILL TURN` : "ONE OF US WILL TURN"}
              </div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-amber-200/85 sm:text-xs">Watch them. Remember them. Barricade NOW.</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* …and the night you ARE the beast — persistent red haze + claw reminder */}
      {hud.phase === "night" && hud.youPossessed && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 150px 55px rgba(136,0,16,0.35)" }} />
          <motion.div
            role="status"
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
            className={`pointer-events-none absolute left-1/2 top-[58%] -translate-x-1/2 rounded-full border border-rose-400/60 bg-black/65 px-3 py-1 text-[11px] font-black tracking-wider text-rose-200 backdrop-blur-md ${hud.attackReady ? "" : "opacity-60"}`}
          >
            🔪 F — claw them all
          </motion.div>
        </>
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
        {/* 🪵🪨 gathered resources — the 7Nights build economy (B barricade · V campfire) */}
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-black tabular-nums text-amber-100 ring-1 ring-amber-200/30" title="Wood — chop trees with the axe (F)">🪵 {hud.wood}</span>
          <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-xs font-black tabular-nums text-slate-100 ring-1 ring-slate-300/30" title="Rock — smash boulders with the hammer (F)">🪨 {hud.rock}</span>
        </div>
        <motion.div layout className="flex items-center gap-0.5" aria-label={`Wanted level ${hud.stars} of 5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <motion.span key={i} animate={i < hud.stars ? { scale: [1, 1.35, 1] } : { scale: 1 }} transition={{ repeat: i < hud.stars ? Infinity : 0, duration: 1.1, delay: i * 0.12 }}>
              <Star size={16} className={i < hud.stars ? "text-red-400" : "text-white/25"} fill={i < hud.stars ? "currentColor" : "none"} />
            </motion.span>
          ))}
        </motion.div>
        {/* ✨ rare super power countdown — appears while a gem power is active */}
        <AnimatePresence>
          {hud.power && <PowerBadge key={hud.power.kind} />}
        </AnimatePresence>
        {/* 🪪 driving license badge — cars are unlocked once this shows */}
        <AnimatePresence>
          {hud.hasLicense && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
              className="w-fit rounded-full bg-sky-400/25 px-2 py-0.5 text-[10px] font-black text-sky-100 ring-1 ring-sky-300/50"
              role="status"
            >
              🪪 License — cars unlocked!
            </motion.div>
          )}
        </AnimatePresence>
        {/* 🔎 last clue learned by inspecting a body (full text on hover) */}
        {hud.clue && (
          <div title={hud.clue} role="status" className="max-w-[13rem] rounded-lg bg-rose-950/45 px-2 py-0.5 text-[10px] font-semibold leading-snug text-rose-100/90 ring-1 ring-rose-300/30">
            🔎 {hud.clue.length > 90 ? `${hud.clue.slice(0, 90)}…` : hud.clue}
          </div>
        )}
      </div>
      {/* floating +❤/+⚡ chip right after a snack is eaten */}
      <GainFlash />

      {/* top-center: 🌙 night strip (the 7Nights story tracker) + zone/clock */}
      <div className="absolute left-3 right-3 top-[172px] flex flex-col items-center gap-1.5 sm:left-1/2 sm:right-auto sm:top-3 sm:-translate-x-1/2">
        <NightStrip />
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-black/35 px-3 py-1 text-xs font-bold text-white backdrop-blur-md sm:px-4 sm:py-1.5 sm:text-sm">
            <MapPin size={14} className={`mr-1 inline ${ZONE_TINT[hud.zone] ?? "text-emerald-300"}`} />
            <span className={ZONE_TINT[hud.zone] ?? ""}>{hud.zone}</span> · {time} {night ? <Moon size={14} className="inline text-indigo-200" /> : <Sun size={14} className="inline text-yellow-300" />}
          </div>
          <div className="hidden rounded-full bg-black/35 px-3 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-md sm:block sm:text-sm">
            <Timer size={14} className="mr-1 inline text-sky-200" />{runTime}
          </div>
        </div>
        {/* (old vote/police objective progress cards removed — the night strip IS the objective now) */}
        {/* spawn grace shield (protester only — the officer needs no sneak shield) */}
        <AnimatePresence>
          {graceT && hud.side !== "police" && (
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
        {hud.mp && (
          <div className="pointer-events-auto flex flex-col items-end gap-1.5">
            {/* LIVE room chip */}
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-black text-emerald-200 backdrop-blur-md" title="Co-op session — players share this night">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              LIVE · {hud.mpCode}{hud.mpHost ? " 👑" : ""} · {hud.mpPing}ms
            </div>
            {/* souls scoreboard */}
            <div className="max-w-44 overflow-hidden rounded-xl border border-cyan-300/20 bg-black/40 backdrop-blur-md">
              <div className="border-b border-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-200">
                🌐 Souls in town ({hud.netPlayers.length})
              </div>
              <div className="max-h-36 overflow-y-auto px-1.5 py-1">
                {hud.netPlayers.map((p) => (
                  <div key={p.slot} className={`flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[11px] ${p.self ? "bg-white/10" : ""}`}>
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-black text-slate-950 ${p.alive ? "" : "opacity-40 grayscale"}`} style={{ backgroundColor: SOUL_COLORS[p.slot % SOUL_COLORS.length] }}>
                      {p.slot + 1}
                    </span>
                    <span className={`flex-1 truncate font-bold ${p.alive ? "text-slate-100" : "text-slate-500 line-through"}`}>
                      {p.name}{p.beast ? " 🐾" : ""}
                    </span>
                    <span className="tabular-nums text-yellow-300">{p.points}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-2">
          <motion.div
            key={`pts-${hud.points}`}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 16 }}
            className="rounded-xl bg-black/35 px-3 py-1 text-sm font-black tabular-nums text-yellow-300 backdrop-blur-md"
            aria-label="Score"
          >
            {hud.points} pts
          </motion.div>
          <motion.div
            key={`money-${hud.money}`}
            initial={{ scale: 1.35 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 15 }}
            className="rounded-xl bg-black/35 px-3 py-1 text-sm font-black tabular-nums text-emerald-300 backdrop-blur-md"
            aria-label="Money collected"
            title="Cash piles scooped + loot from the fallen"
          >
            💰 ₹{hud.money}
          </motion.div>
          {showFps && <FpsCounter />}
          <Button
            size="icon" variant="ghost" aria-label={muted ? "Unmute" : "Mute"}
            className="h-9 w-9 rounded-xl bg-black/35 text-white backdrop-blur-md hover:bg-black/50"
            onClick={() => { const m = !muted; setMuted(m); setAudioMuted(m); }}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </Button>
          {/* ⓘ goal-card toggle — when the hint hides itself this little (i) is all that remains */}
          <motion.div
            key={showHelp ? "goal-open" : "goal-closed"}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
          >
            <Button
              size="icon" variant="ghost"
              aria-label={showHelp ? "Hide goal card (I)" : "Show goal card (I)"}
              aria-expanded={showHelp}
              title="Goal & tips (I)"
              className={`h-9 w-9 rounded-xl bg-black/35 backdrop-blur-md hover:bg-black/50 ${showHelp ? "text-yellow-300 ring-1 ring-yellow-300/60" : "text-white"}`}
              onClick={toggleHelp}
            >
              <Info size={16} />
            </Button>
          </motion.div>
          <Button
            size="icon" variant="ghost" aria-label="Pause game"
            className="h-9 w-9 rounded-xl bg-black/35 text-white backdrop-blur-md hover:bg-black/50"
            onClick={togglePause}
          >
            <Pause size={16} />
          </Button>
        </div>
        {/* goal card — a compact hint that auto-hides; press I or tap ⓘ to recall it */}
        <AnimatePresence>
          {showHelp && (
            <motion.div
              initial={{ opacity: 0, x: 22, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 22, scale: 0.96, transition: { duration: 0.16 } }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              role="note"
              aria-label="Goal and quick tips — press I to hide"
              className="pointer-events-auto w-[248px] rounded-2xl bg-black/55 p-3 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-md sm:w-[268px]"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-semibold leading-snug">
                  <b className="text-yellow-300">🎯 Goal:</b>{" "}
                  Survive all <b className="text-rose-300">7 nights</b> of the pack. By day gather 🪵🪨, build &amp; eat; at dusk the sirens choose their hosts — several of you may turn — at night the beasts HUNT. Slay them with arms (<b>F</b>), or inspect bodies (<b>E</b>) &amp; <b>accuse (R)</b> the suspects! Have YOU noticed who's been acting strange?
                </p>
                <button
                  onClick={() => setShowHelp(false)}
                  aria-label="Hide goal card (I)"
                  className="shrink-0 rounded-md p-0.5 text-white/55 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="mt-1.5 space-y-1 border-t border-white/15 pt-1.5 text-[10px] leading-snug text-white/75">
                <p className="text-emerald-200/95">💰 Scoop cash piles &amp; loot the fallen (their purse drops where they die!) — bots grab it first if you're slow</p>
                <p className="text-rose-200/90">🌙 At night name tags VANISH — tell friends by their shirt COLOR. Dawn returns the names.</p>
                <p className="text-amber-200/90">🥭 Run over food to pocket it — eat with <b>1-8</b> (heals ❤ · refills ⚡)</p>
                <p className="text-fuchsia-200/95">🎒 Arms &amp; ✨ gem powers sit on the belt — press <b>G</b> for the tool wheel · <b>Q</b> blink</p>
                <p className="text-lime-200/95">🪓🪨 Axe fells trees, hammer smashes boulders — then <b>B</b> barricade · <b>V</b> campfire</p>
                <p className="text-sky-200/95">🪪 License card + <b>E</b> beside a car = drive (W/S gas · A/D steer · <b>H</b> horn · E hop out)</p>
                {!touch && <p className="text-white/55">WASD move · mouse camera · Space double-jump · M map · Esc pause</p>}
              </div>
              <p className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-white/40">Press <b className="text-white/70">I</b> to toggle · auto-hides</p>
            </motion.div>
          )}
        </AnimatePresence>
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
                <span>Click to lock the mouse · hold Z / X to turn the camera</span>
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

      {/* 🚗 driving speedo chip — replaces the prompt while behind the wheel */}
      {hud.driving && (
        <div role="status" className="absolute bottom-36 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-slate-900/85 px-4 py-2 text-white shadow-xl backdrop-blur-md sm:bottom-28">
          <motion.span animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="text-lg leading-none" aria-hidden>🚗</motion.span>
          <span className="text-base font-black tabular-nums text-yellow-300">{Math.round(hud.speed * 4)} km/h</span>
          <span className="hidden whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-white/70 sm:inline">W/S gas · A/D steer · E hop out · H horn</span>
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

      {/* detained / arrest-transport overlay */}
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
              <div className="text-4xl font-black tracking-wide text-rose-300">
                {hud.arrest === "riding" ? "IN THE VAN! 🚓" : hud.arrest === "called" ? "CAUGHT! 🚔" : "LOCKED UP! 😵"}
              </div>
              <div className="mt-1 text-white">
                {hud.arrest === "called" && "A police van is on its way — sirens and everything!"}
                {hud.arrest === "riding" && `Riding to ${hud.station}…`}
                {hud.arrest === "locked" && `${hud.station} — time left: ${Math.ceil(hud.detainLeft)}s`}
              </div>
              <div className="mt-1 text-xs font-bold text-rose-200/90">
                {hud.arrest === "locked"
                  ? "Your votes are impounded in the station cage — steal them back after they let you out the gate!"
                  : "The van takes you to the nearest police station — your votes get impounded there!"}
              </div>
              <div className="mx-auto mt-3 h-2.5 w-44 overflow-hidden rounded-full bg-white/15">
                {hud.arrest === "locked" ? (
                  <motion.div
                    className="h-full rounded-full bg-rose-400"
                    animate={{ width: `${(1 - hud.detainLeft / DETAIN_SECONDS) * 100}%` }}
                    transition={{ ease: "linear", duration: 0.2 }}
                  />
                ) : (
                  <motion.div
                    className="h-full w-1/3 rounded-full bg-rose-400"
                    animate={{ x: ["-100%", "300%"] }}
                    transition={{ repeat: Infinity, ease: "linear", duration: 1.1 }}
                  />
                )}
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
              useGame.getState().recordRun(useGame.getState().hud.points, useGame.getState().hud.money, useGame.getState().hud.rescues, engine.caughtCount, false, Math.round(useGame.getState().hud.elapsed * 1000));
              useGame.getState().setScreen("landing");
            }}
          />
        )}
      </AnimatePresence>

      {/* food pockets + 🎒 tool belt — desktop: bottom-left corner, with the ✨ power slots beside them */}
      {!touch && (
        <div className="absolute bottom-3 left-3 z-10 flex items-end gap-2">
          <ItemBar engine={engine} />
          <ToolBelt engine={engine} />
          <AnimatePresence>{hud.pockets.length > 0 && <PowerSlots engine={engine} />}</AnimatePresence>
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
          <Flag size={14} className="mr-1 inline" /> Run complete — free roam & keep exploring!
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
        {/* 🏟️ contest dashboard — the lobby count IS the game (no more police/civilians noise) */}
        <div
          data-ui
          className="rounded-xl border border-white/15 bg-black/45 px-3 py-1.5 text-right backdrop-blur-md"
          role="status"
          aria-label={`${hud.crewAlive + 1} of ${hud.aliveTotal} players alive, ${hud.aliveTotal - hud.crewAlive - 1} fallen, night ${hud.nightNo} of ${NIGHTS_TOTAL}${hud.phase === "night" ? `, ${hud.beastCount} zombies hunting` : ""}`}
        >
          <div className="text-xs font-black leading-4 text-white">
            🧍 {hud.crewAlive + 1}<span className="text-white/55">/{hud.aliveTotal} players</span>
          </div>
          <div className="text-[10px] font-bold leading-4 text-white/70">
            💀 {hud.aliveTotal - hud.crewAlive - 1} fallen · {hud.phase === "night" ? "🌙 Night" : "☀️ Day"} {hud.nightNo}/{NIGHTS_TOTAL}
          </div>
          {hud.phase === "night" && hud.beastCount > 0 && (
            <div className="text-[10px] font-black leading-4 text-purple-300">🧟 {hud.beastCount} zombies hunting</div>
          )}
        </div>
      </div>

      {/* bottom-center: controls hint + location chip (old-game footer, revived) —
          narrow desktops hide the center stack and tuck the coords chip bottom-right instead */}
      {!touch && (
        <div className="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-1.5 md:flex">
          <div className="hidden whitespace-nowrap rounded-full bg-black/45 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white/75 backdrop-blur-md lg:block">
            WASD move · Shift sprint · Space jump ×2 · F attack · G tools · 🪪 license · B/V build · E inspect/drive · R accuse · Q blink · 1-8 eat · M map
          </div>
          <CoordsChip px={hud.px} pz={hud.pz} />
        </div>
      )}

      {/* 🎯 tool wheel — G opens it with a free cursor; click/G arms, Esc cancels */}
      <AnimatePresence>
        {wheelOpen && <ToolWheel engine={engine} apiRef={wheelApi} />}
      </AnimatePresence>

      {/* 🪪 driving-license card — picked from the wheel's license slice */}
      <AnimatePresence>
        {licenseOpen && <LicenseCard engine={engine} />}
      </AnimatePresence>

      {/* big world map overlay */}
      <AnimatePresence>
        {bigMap && <BigMap engine={engine} onClose={() => setBigMap(false)} />}
      </AnimatePresence>
    </div>
  );
}
