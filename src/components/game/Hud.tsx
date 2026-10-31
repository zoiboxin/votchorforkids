"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Heart, Zap, Star, Sun, Moon, Vote, MapPin, Volume2, VolumeX, Pause, Play as PlayIcon,
  Keyboard, Gauge, CircleHelp, Flag, Home, Settings as SettingsIcon, CheckCircle2, Siren, Info, ShieldCheck,
} from "lucide-react";
import type { GameEngine } from "@/lib/game/engine";
import { useGame } from "./store";
import { setMuted as setAudioMuted, sfx, stopMusic, startMusic } from "@/lib/game/audio";
import { Button } from "@/components/ui/button";
import { HowToPlay, SettingsDialog } from "./Panels";

/* ----------------------------- minimap ----------------------------- */
function Minimap({ engine }: { engine: GameEngine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const S = 156, K = S / 700;
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
    <div className="relative">
      <canvas
        ref={ref} width={156} height={156}
        aria-label="Minimap, north at the top"
        className="rounded-xl border-2 border-white/30 shadow-lg"
      />
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full border border-white/30 bg-black/70 px-1.5 text-[9px] font-black leading-3 text-white">N</span>
    </div>
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
      </motion.div>
      <HowToPlay open={help} onOpenChange={setHelp} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </motion.div>
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
  const showFps = useGame((s) => s.settings.showFps);
  const paused = useGame((s) => s.paused);
  const setPaused = useGame((s) => s.setPaused);
  const victoryOpen = useGame((s) => s.victoryOpen);

  const hr = hud.clock * 24;
  const time = `${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
  const night = hud.night > 0.5;
  const graceT = engine.invulnT > 0 && hud.elapsed < 8 && !hud.detained;

  const togglePause = () => {
    if (victoryOpen) return;
    const next = !paused;
    sfx.click();
    engine.running = !next;
    if (next) stopMusic(); else startMusic();
    setPaused(next);
  };

  // P / Escape toggles pause while playing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (useGame.getState().victoryOpen) return;
      if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); togglePause(); }
      if (e.code === "KeyM") { const m = !useGame.getState().muted; setMuted(m); setAudioMuted(m); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [victoryOpen]);

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

      {/* top-left: vitals */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-2xl bg-black/35 p-3 backdrop-blur-md">
        <Bar v={hud.hp} color="bg-gradient-to-r from-rose-500 to-rose-400" icon={<Heart size={16} className="text-rose-300" fill="currentColor" />} low={hud.hp <= 30} />
        <Bar v={hud.stamina} color="bg-gradient-to-r from-amber-500 to-yellow-300" icon={<Zap size={16} className="text-amber-300" fill="currentColor" />} />
        <div className="mt-1 flex items-center gap-2 text-sm text-white">
          <Vote size={16} className="text-yellow-300" />
          <span className="font-bold">{hud.carried > 0 ? `🗳️ ${hud.carried}/3` : "—"}</span>
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

      {/* top-center: objective tracker + zone/clock */}
      <div className="absolute left-3 right-3 top-[122px] flex flex-col items-center gap-1.5 sm:left-1/2 sm:right-auto sm:top-3 sm:-translate-x-1/2">
        <div className="rounded-full bg-black/35 px-3 py-1 text-xs font-bold text-white backdrop-blur-md sm:px-4 sm:py-1.5 sm:text-sm">
          <MapPin size={14} className="mr-1 inline text-emerald-300" />
          {hud.zone} · {time} {night ? <Moon size={14} className="inline text-indigo-200" /> : <Sun size={14} className="inline text-yellow-300" />}
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
        <Minimap engine={engine} />
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="rounded-xl bg-black/35 px-3 py-1 text-sm font-black text-yellow-300 backdrop-blur-md">
            {hud.points} pts
          </div>
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
            {!touch && <div className="mt-1 text-white/70">WASD move · Shift sprint · Space jump · E rescue · P pause</div>}
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
              <div className="mt-1 text-white">Time-out: {Math.ceil(hud.detainLeft)}s</div>
              <div className="mx-auto mt-3 h-2.5 w-44 overflow-hidden rounded-full bg-white/15">
                <motion.div
                  className="h-full rounded-full bg-rose-400"
                  animate={{ width: `${(1 - hud.detainLeft / 8) * 100}%` }}
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
              engine.running = false;
              stopMusic();
              setPaused(false);
              useGame.getState().setVictoryOpen(false);
              useGame.getState().recordRun(useGame.getState().hud.points);
              useGame.getState().setScreen("landing");
            }}
          />
        )}
      </AnimatePresence>

      {/* mobile controls */}
      {touch && !paused && (
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
