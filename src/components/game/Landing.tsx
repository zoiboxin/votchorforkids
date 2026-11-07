"use client";

import { useEffect, useState } from "react";
import { Play, Settings, Info, UserCog, Moon, Sparkles, BarChart3, History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NIGHT_TICKER } from "@/lib/game/constants";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { useGame } from "./store";
import { HowToPlay, SettingsDialog, StatsDialog, HistoryDialog } from "./Panels";
import { RankBadge } from "./RankCard";

const FLOATERS = ["🌙", "🦇", "🔥", "🪓", "✨", "🧟"];

export function Landing() {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const careerXp = useGame((s) => s.careerXp);
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasProfile = playerName.trim().length > 0;

  useEffect(() => {
    fetch("/api/scores").then((r) => r.json()).then((d) => useGame.getState().setScores(d.scores ?? [])).catch(() => {});
    const unlock = () => { primeAudio(); startMusic(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // PLAY: there are no sides anymore — everyone joins the same 7 nights,
  // straight through the survivor creator (pick a name + look, then start)
  const goCreator = () => { sfx.click(); setScreen("creator"); };

  return (
    <div className="relative h-screen w-full overflow-y-auto bg-slate-950">
      <style>{`
        @keyframes vc-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes vc-float { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-16px) rotate(3deg); } }
        @keyframes vc-drift { 0% { transform: translateX(-12vw); } 100% { transform: translateX(112vw); } }
        @keyframes vc-pop { 0% { transform: scale(.86); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes vc-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
        @keyframes vc-spin-slow { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>

      {/* painted night-town backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-7nights.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-indigo-950/65 to-slate-950/90" />

      {/* night sky: drifting clouds + a pale moon + floating spooky props */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[6%] top-[10%] h-14 w-28 rounded-full bg-white/20 blur-[1px]" style={{ animation: "vc-drift 38s linear infinite" }} />
        <div className="absolute left-[30%] top-[20%] h-10 w-24 rounded-full bg-white/15 blur-[1px]" style={{ animation: "vc-drift 52s linear infinite", animationDelay: "-18s" }} />
        <div className="absolute top-[5%] h-12 w-24 rounded-full bg-white/10 blur-[1px]" style={{ animation: "vc-drift 64s linear infinite", animationDelay: "-40s" }} />
        <div className="absolute right-[7%] top-[6%] h-14 w-14 rounded-full bg-slate-100 shadow-[0_0_70px_26px_rgba(199,210,254,0.3)]" style={{ animation: "vc-float 7s ease-in-out infinite" }} />
        {FLOATERS.map((e, i) => (
          <span
            key={i}
            className="absolute select-none text-2xl opacity-70 drop-shadow-lg sm:text-3xl"
            style={{
              left: `${[4, 88, 14, 78, 46, 66][i]}%`,
              top: `${[58, 22, 76, 64, 12, 80][i]}%`,
              animation: `vc-float ${5.5 + i * 0.9}s ease-in-out infinite`,
              animationDelay: `${i * 0.7}s`,
            }}
          >
            {e}
          </span>
        ))}
      </div>

      {/* floating top-right toolbar — transparent icons only (profile · info · stats · history · settings) */}
      <div className="fixed right-2 top-2 z-40 flex items-center gap-0.5 sm:right-3 sm:top-3 sm:gap-1">
        <Button
          size="icon" variant="ghost" aria-label="Open profile" title="Profile"
          onClick={() => { sfx.click(); setScreen("profile"); }}
          className="h-10 w-10 rounded-full text-white/85 shadow-none drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)] hover:bg-white/10 hover:text-white sm:h-11 sm:w-11"
        >
          <RankBadge xp={careerXp} size={26} />
        </Button>
        <Button
          size="icon" variant="ghost" aria-label="How to play" title="How to play"
          onClick={() => { sfx.click(); setHelp(true); }}
          className="h-10 w-10 rounded-full text-white/85 shadow-none drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)] hover:bg-white/10 hover:text-white sm:h-11 sm:w-11"
        >
          <Info size={20} />
        </Button>
        <Button
          size="icon" variant="ghost" aria-label="Career stats" title="Career stats"
          onClick={() => { sfx.click(); setStatsOpen(true); }}
          className="h-10 w-10 rounded-full text-white/85 shadow-none drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)] hover:bg-white/10 hover:text-white sm:h-11 sm:w-11"
        >
          <BarChart3 size={20} />
        </Button>
        <Button
          size="icon" variant="ghost" aria-label="Run history" title="Run history"
          onClick={() => { sfx.click(); setHistoryOpen(true); }}
          className="h-10 w-10 rounded-full text-white/85 shadow-none drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)] hover:bg-white/10 hover:text-white sm:h-11 sm:w-11"
        >
          <HistoryIcon size={20} />
        </Button>
        <span aria-hidden className="mx-0.5 h-6 w-px bg-white/20" />
        <Button
          size="icon" variant="ghost" aria-label="Open settings" title="Settings"
          onClick={() => { sfx.click(); setSettingsOpen(true); }}
          className="h-10 w-10 rounded-full text-white/85 shadow-none drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)] hover:bg-white/10 hover:text-white sm:h-11 sm:w-11"
        >
          <Settings size={20} />
        </Button>
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6">
        {/* hero */}
        <header className="flex flex-col items-center pt-16 text-center sm:pt-8" style={{ animation: "vc-pop .5s ease-out both" }}>
          <div className="mb-3 flex items-center gap-2 rounded-full border border-red-300/40 bg-black/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-red-200 backdrop-blur sm:text-xs">
            <Sparkles size={13} className="text-red-300" /> Survive the Seven Nights · A cozy horror story
          </div>
          <div className="relative">
            <h1 className="text-6xl font-black tracking-tight text-white drop-shadow-[0_6px_0_rgba(0,0,0,0.4)] sm:text-7xl md:text-8xl" style={{ animation: "vc-breathe 4s ease-in-out infinite" }}>
              7<span className="text-red-400 drop-shadow-[0_0_22px_rgba(248,113,113,0.55)]">Nights</span>
            </h1>
            <span
              aria-hidden
              className="absolute -right-10 -top-4 hidden -rotate-12 rounded-lg border-[3px] border-red-300/90 bg-red-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-red-100 sm:block"
              style={{ animation: "vc-spin-slow 1.2s ease-out both" }}
            >
              Don&apos;t trust anyone!
            </span>
          </div>
          <p className="mt-2 max-w-xl text-base font-bold text-slate-200 drop-shadow sm:text-lg">
            One of us won&apos;t see dawn. Days are for building. <span className="text-red-300">Nights are for surviving.</span>
          </p>
        </header>

        {/* CTA row — the three main actions, centered on the page */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 sm:flex-row sm:gap-4 sm:py-6">
          <Button
            size="lg"
            onClick={goCreator}
            className="h-16 min-w-56 rounded-2xl bg-gradient-to-r from-red-500 to-amber-400 px-10 text-xl font-black text-red-950 shadow-[0_8px_0_rgba(127,29,29,0.6)] transition-transform hover:scale-[1.03] active:scale-95"
          >
            <Play size={24} className="mr-2" fill="currentColor" /> {hasProfile ? `JOIN, ${playerName}!` : "PLAY"}
          </Button>
          <Button
            size="lg" onClick={() => { sfx.click(); setScreen("lobby"); }} aria-label="Play multiplayer"
            className="h-14 rounded-2xl border border-teal-300/40 bg-teal-500/20 px-6 font-black text-teal-100 backdrop-blur hover:bg-teal-500/35"
          >
            🌐 Multiplayer
          </Button>
          <Button
            size="lg" onClick={goCreator} aria-label="Customize your survivor"
            className="h-14 rounded-2xl border-white/30 bg-black/35 px-6 font-black text-white backdrop-blur hover:bg-black/50"
          >
            <UserCog size={18} className="mr-1.5" /> {hasProfile ? "Customize survivor" : "Create survivor"}
          </Button>
        </div>

        {/* bottom block — belt + objective pinned to the page end as plain transparent text (no cards) */}
        <div className="mt-auto pt-10">
          {/* marquee ticker belt — transparent scrolling text, no card chrome */}
          <div className="overflow-hidden py-1" aria-hidden>
            <div className="flex w-max gap-10 whitespace-nowrap text-sm font-bold text-white/65" style={{ animation: "vc-marquee 36s linear infinite" }}>
              {[...NIGHT_TICKER, ...NIGHT_TICKER].map((l, i) => (
                <span key={i} className="inline-block">{l}</span>
              ))}
            </div>
          </div>

          {/* objective line — transparent text, no card */}
          <div className="mt-3 flex items-center justify-center gap-2 px-4 text-center">
            <Moon size={16} className="shrink-0 text-indigo-300" />
            <p className="text-xs font-bold text-white/75 sm:text-sm">
              Survive <b className="text-red-300">7 nights</b> · <b className="text-amber-300">Build by day</b> · <b className="text-indigo-300">Hide or hunt by night</b> · <b className="text-yellow-200">Accuse the possessed</b>
            </p>
          </div>

          {/* footer */}
          <footer className="pt-6 pb-4 text-center">
            <p className="text-[11px] text-white/60">
              7Nights is a work of spooky silliness. All possessions strictly fictional. No zombies were harmed. 🌙
            </p>
            <p className="mt-0.5 text-[11px] text-white/40">Rebuilt with Next.js 16 · React Three Fiber · TypeScript</p>
          </footer>
        </div>
      </div>

      <HowToPlay open={help} onOpenChange={setHelp} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
