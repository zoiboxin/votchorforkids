"use client";

/**
 * BootScreen — the professional 7Nights loading screen shown while the game
 * chunks download (the old "black screen with a bouncing chip").
 *
 * Pure CSS animation + one hero JPEG-style PNG, zero heavy deps, so it paints
 * instantly before the big three.js bundle arrives:
 *   • photoreal blood-moon backdrop with a slow Ken Burns drift
 *   • drifting fog banks, twinkling stars, rising embers, pulsing moon halo
 *   • the angled 7NIGHTS logo band with a light-sweep sheen
 *   • indeterminate ember progress bar with shimmer + staged status lines
 *   • prefers-reduced-motion collapses every animation safely
 *
 * Two variants:
 *   "boot"  — fixed fullscreen (page-level GameRoot chunk load)
 *   "scene" — absolute fullscreen (GameRoot's lazy 3D Scene chunk load)
 */

import { useEffect, useState } from "react";

const MESSAGES = [
  "Summoning the blood moon",
  "Kindling the campfire",
  "Rallying the survivors",
  "Fueling the dropship",
  "Sharpening axes and wits",
  "Barricading the windows",
  "Waking the town",
  "Unlocking the vault",
] as const;

/** deterministic star field (upper sky) — no randomness, stable every render */
const STARS = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 149 + 13) % 100,
  top: (i * 73 + 7) % 40,
  size: i % 7 === 0 ? 3 : 2,
  dur: 2.2 + (i % 4) * 0.8,
  delay: (i % 9) * 0.45,
}));

/** deterministic rising embers along the ground */
const EMBERS = Array.from({ length: 12 }, (_, i) => ({
  left: (i * 83 + 9) % 100,
  size: 2 + ((i * 7) % 3),
  dur: 9 + (i % 5) * 2.6,
  delay: (i * 1.63) % 12,
  drift: ((i % 3) - 1) * 34,
}));

export function BootScreen({ variant = "boot" }: { variant?: "boot" | "scene" }) {
  const [msg, setMsg] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setMsg((m) => (m + 1) % MESSAGES.length), 2000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div
      className={`${variant === "boot" ? "fixed inset-0 z-[60]" : "absolute inset-0"} overflow-hidden bg-slate-950`}
      role="status"
      aria-busy="true"
      aria-label="Loading 7Nights"
    >
      <style>{`
        .bs-kenburns { animation: bs-kenburns 26s ease-in-out infinite alternate; }
        @keyframes bs-kenburns {
          0% { transform: scale(1) translateY(0); }
          100% { transform: scale(1.1) translateY(-1.5%); }
        }
        .bs-sheen { animation: bs-sheen 2.8s ease-in-out infinite; }
        @keyframes bs-sheen {
          0% { transform: translateX(-170%); }
          55%, 100% { transform: translateX(240%); }
        }
        .bs-progress { animation: bs-progress 7s cubic-bezier(.45,.05,.35,1) infinite; }
        @keyframes bs-progress {
          0% { width: 3%; }
          18% { width: 34%; }
          42% { width: 52%; }
          62% { width: 68%; }
          80% { width: 82%; }
          100% { width: 96%; }
        }
        .bs-shimmer { animation: bs-shimmer 1.8s linear infinite; }
        @keyframes bs-shimmer {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(220%); }
        }
        .bs-fade { animation: bs-fade .45s ease both; }
        @keyframes bs-fade {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .bs-moon { animation: bs-moon 7s linear infinite; }
        @keyframes bs-moon { to { transform: rotate(360deg); } }
        .bs-glow { animation: bs-glow 4.5s ease-in-out infinite; }
        @keyframes bs-glow { 0%, 100% { opacity: .4; } 50% { opacity: .95; } }
        .bs-twinkle { animation: bs-twinkle 3s ease-in-out infinite; }
        @keyframes bs-twinkle { 0%, 100% { opacity: .12; } 50% { opacity: .85; } }
        .bs-fog-a { animation: bs-fog-a 30s ease-in-out infinite alternate; }
        @keyframes bs-fog-a { from { transform: translateX(-7%); } to { transform: translateX(7%); } }
        .bs-fog-b { animation: bs-fog-b 38s ease-in-out infinite alternate; }
        @keyframes bs-fog-b { from { transform: translateX(6%); } to { transform: translateX(-6%); } }
        .bs-rise { animation: bs-rise linear infinite; }
        @keyframes bs-rise {
          0% { transform: translate(0, 0) scale(1); opacity: 0; }
          12% { opacity: .9; }
          70% { opacity: .5; }
          100% { transform: translate(var(--bs-drift, 0px), -105vh) scale(.5); opacity: 0; }
        }
        .bs-blink { animation: bs-blink 1.4s ease-in-out infinite; }
        @keyframes bs-blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .bs-kenburns, .bs-sheen, .bs-progress, .bs-shimmer, .bs-fade, .bs-moon,
          .bs-glow, .bs-twinkle, .bs-fog-a, .bs-fog-b, .bs-rise, .bs-blink {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>

      {/* photoreal blood-moon backdrop with a slow cinematic drift */}
      <div
        aria-hidden
        className="bs-kenburns absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-lobby-night.png)" }}
      />
      {/* readability scrims — darker top and bottom, vignette edges */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/45 to-slate-950/92" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_32%,rgba(2,6,23,0.6)_100%)]" />

      {/* pulsing halo that amplifies the moon in the artwork */}
      <div aria-hidden className="bs-glow absolute left-1/2 top-[6%] h-64 w-64 -translate-x-1/2 rounded-full bg-rose-500/15 blur-3xl" />

      {/* twinkling stars */}
      <div aria-hidden className="absolute inset-0">
        {STARS.map((s, i) => (
          <span
            key={i}
            className="bs-twinkle absolute rounded-full bg-white"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              animationDuration: `${s.dur}s`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* drifting fog banks near the ground */}
      <div aria-hidden className="bs-fog-a absolute bottom-[-12%] left-[-10%] h-[45%] w-[130%] rounded-[100%] bg-white/[0.05] blur-2xl" />
      <div aria-hidden className="bs-fog-b absolute bottom-[6%] left-[-15%] h-[38%] w-[140%] rounded-[100%] bg-slate-400/[0.07] blur-3xl" />

      {/* rising embers */}
      <div aria-hidden className="absolute inset-0">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="bs-rise absolute rounded-full bg-orange-400"
            style={
              {
                left: `${e.left}%`,
                bottom: -8,
                width: e.size,
                height: e.size,
                boxShadow: "0 0 6px 2px rgba(251,146,60,.55)",
                animationDuration: `${e.dur}s`,
                animationDelay: `${e.delay}s`,
                "--bs-drift": `${e.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* ===== center: glass card with logo + progress ===== */}
      <div className="relative z-10 flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-white/12 bg-slate-950/45 px-6 py-9 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-md sm:px-10">
          {/* spinning crescent — doubles as the activity spinner */}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="bs-moon mx-auto mb-5 h-9 w-9 fill-orange-300/90 drop-shadow-[0_0_14px_rgba(251,146,60,0.55)]"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>

          {/* angled logo band with light-sweep sheen — matches the lobby header */}
          <div className="relative mx-auto w-fit select-none overflow-hidden rounded-[4px] border border-white/15 bg-slate-950/90 px-5 py-2.5 shadow-xl -skew-x-[10deg]">
            <span
              aria-hidden
              className="bs-sheen pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            />
            <span className="block skew-x-[10deg] text-4xl font-black italic leading-none tracking-tight text-white sm:text-5xl">
              7<span className="text-orange-500 drop-shadow-[0_0_16px_rgba(249,115,22,0.6)]">NIGHTS</span>
            </span>
          </div>

          <p className="mt-3 text-center text-[10px] font-black uppercase tracking-[0.4em] text-orange-200/75 sm:text-[11px]">
            Survive the Seven Nights
          </p>

          {/* ember progress bar — indeterminate stepped fill with shimmer */}
          <div className="mt-8 w-full">
            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.28em]">
              <span className="text-orange-300/80">Loading the night</span>
              <span className="text-white/40">Please wait</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-950/85 ring-1 ring-white/15">
              <div className="bs-progress relative h-full overflow-hidden rounded-full bg-gradient-to-r from-orange-700 via-orange-500 to-amber-400">
                <span
                  aria-hidden
                  className="bs-shimmer absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                />
              </div>
            </div>
          </div>

          {/* staged status line — fades in on every change */}
          <p
            key={msg}
            aria-live="polite"
            className="bs-fade mt-4 h-5 text-center text-xs font-semibold text-amber-100/85"
          >
            {MESSAGES[msg]}
            <span aria-hidden className="ml-1 inline-flex">
              <span className="bs-blink" style={{ animationDelay: "0s" }}>.</span>
              <span className="bs-blink" style={{ animationDelay: ".2s" }}>.</span>
              <span className="bs-blink" style={{ animationDelay: ".4s" }}>.</span>
            </span>
          </p>
        </div>
      </div>

      {/* footer strip */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[10px] font-bold uppercase tracking-wider text-white/35 sm:px-6">
        <span>7Nights — Survive the Seven Nights</span>
        <span>Build Night-07</span>
      </div>
    </div>
  );
}
