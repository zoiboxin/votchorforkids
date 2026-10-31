"use client";

import { useEffect, useState } from "react";
import { Play, Settings, Gamepad2, UserCog, Trophy, MapPin, ShieldAlert, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TICKER_LINES } from "@/lib/game/constants";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { useGame } from "./store";
import { Leaderboard } from "./Creator";
import { HowToPlay, SettingsDialog } from "./Panels";

const FEATURES: { icon: React.ReactNode; title: string; text: string; tint: string }[] = [
  { icon: <MapPin size={20} />, title: "Huge city", text: "City, farms, jungle & graveyard ringed by snowy mountains", tint: "text-emerald-300" },
  { icon: <ShieldAlert size={20} />, title: "Cartoon police", text: "9 bumbling cops chase you when you carry votes", tint: "text-rose-300" },
  { icon: <Sunrise size={20} />, title: "Day & night", text: "Chai stops by day… zombies wake up after dark", tint: "text-amber-300" },
  { icon: <Trophy size={20} />, title: "High scores", text: "Rescue friends, dodge cops, save democracy!", tint: "text-yellow-300" },
];

export function Landing() {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const look = useGame((s) => s.look);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    fetch("/api/scores").then((r) => r.json()).then((d) => useGame.getState().setScores(d.scores ?? [])).catch(() => {});
    const unlock = () => { primeAudio(); startMusic(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const goCreate = () => { sfx.click(); setScreen("creator"); };

  return (
    <div className="relative min-h-screen w-full overflow-y-auto bg-gradient-to-b from-sky-500 via-sky-400 to-emerald-400">
      <style>{`
        @keyframes vc-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes vc-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
        @keyframes vc-drift { 0% { transform: translateX(-12vw); } 100% { transform: translateX(112vw); } }
        @keyframes vc-pop { 0% { transform: scale(.86); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes vc-spin-slow { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>

      {/* sky life: drifting clouds + bouncing sun */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[8%] top-[12%] h-14 w-28 rounded-full bg-white/70 blur-[1px]" style={{ animation: "vc-drift 38s linear infinite" }} />
        <div className="absolute left-[30%] top-[24%] h-10 w-24 rounded-full bg-white/60 blur-[1px]" style={{ animation: "vc-drift 52s linear infinite", animationDelay: "-18s" }} />
        <div className="absolute top-[6%] h-12 w-24 rounded-full bg-white/50 blur-[1px]" style={{ animation: "vc-drift 64s linear infinite", animationDelay: "-40s" }} />
        <div className="absolute right-[6%] top-[8%] h-16 w-16 rounded-full bg-yellow-200 shadow-[0_0_60px_20px_rgba(253,224,71,0.55)]" style={{ animation: "vc-float 7s ease-in-out infinite" }} />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6">
        {/* hero */}
        <header className="flex flex-col items-center pt-6 text-center" style={{ animation: "vc-pop .5s ease-out both" }}>
          <div className="relative">
            <h1 className="text-6xl font-black tracking-tight text-white drop-shadow-[0_6px_0_rgba(0,0,0,0.35)] sm:text-7xl md:text-8xl">
              Vote<span className="text-yellow-300">Chor!</span>
            </h1>
            <span
              aria-hidden
              className="absolute -right-8 -top-3 hidden -rotate-12 rounded-lg border-[3px] border-rose-300 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-rose-200 sm:block"
              style={{ animation: "vc-spin-slow 1.2s ease-out both" }}
            >
              The Great Parliament Run
            </span>
          </div>
          <p className="mt-2 max-w-xl text-base font-bold text-emerald-100 sm:text-lg">
            The votes are missing. The protest is on. <span className="text-yellow-200">Everybody run!</span>
          </p>

          {/* player greeting card */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/25 bg-black/25 px-4 py-2 text-sm text-white backdrop-blur">
            <span className="font-black text-yellow-200">{playerName ? `Hi, ${playerName}!` : "New challenger!"}</span>
            <span className="text-white/70">· {look.girl ? "👧" : "👦"} {look.age}</span>
            {runsPlayed > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold">🏃 {runsPlayed} runs</span>}
            {bestScore > 0 && <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-xs font-bold text-yellow-200">🏆 best {bestScore}</span>}
          </div>
        </header>

        {/* CTA row */}
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={goCreate}
            className="h-16 min-w-56 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 px-8 text-xl font-black text-amber-950 shadow-[0_8px_0_rgba(180,120,0,0.55)] transition-transform hover:scale-[1.03] active:scale-95"
          >
            <Play size={24} className="mr-2" fill="currentColor" /> PLAY
          </Button>
          <div className="flex gap-2">
            <Button
              size="lg" variant="outline" onClick={() => { sfx.click(); setHelp(true); }}
              className="h-14 rounded-2xl border-white/30 bg-black/25 px-5 font-black text-white backdrop-blur hover:bg-black/40"
            >
              <Gamepad2 size={18} className="mr-1.5" /> How to play
            </Button>
            <Button
              size="lg" variant="outline" aria-label="Open settings" onClick={() => { sfx.click(); setSettingsOpen(true); }}
              className="h-14 w-14 rounded-2xl border-white/30 bg-black/25 p-0 text-white backdrop-blur hover:bg-black/40"
            >
              <Settings size={20} />
            </Button>
          </div>
        </div>
        {playerName && (
          <button
            onClick={() => { sfx.click(); setScreen("creator"); }}
            className="mx-auto mt-2 flex items-center gap-1.5 text-xs font-bold text-white/80 underline-offset-2 hover:text-white hover:underline"
          >
            <UserCog size={13} /> customize your hero
          </button>
        )}

        {/* marquee ticker */}
        <div className="mt-6 overflow-hidden rounded-full border border-white/20 bg-black/35 py-2 backdrop-blur" aria-hidden>
          <div className="flex w-max gap-10 whitespace-nowrap px-4 text-sm font-bold text-white/90" style={{ animation: "vc-marquee 36s linear infinite" }}>
            {[...TICKER_LINES, ...TICKER_LINES].map((l, i) => (
              <span key={i} className="inline-block">{l}</span>
            ))}
          </div>
        </div>

        {/* features */}
        <section aria-label="Game features" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/20 bg-black/30 p-4 backdrop-blur transition-transform hover:-translate-y-0.5">
              <div className={f.icon ? `${f.tint} mb-1.5` : ""}>{f.icon}</div>
              <div className="text-sm font-black text-white">{f.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-white/70">{f.text}</div>
            </div>
          ))}
        </section>

        {/* leaderboard */}
        <div className="mx-auto mt-6 w-full max-w-xl">
          <Leaderboard compact />
        </div>

        {/* footer */}
        <footer className="mt-auto pt-6 pb-4 text-center">
          <p className="text-[11px] text-white/60">
            VoteChor is a work of silliness. All politicians, committees and samosas are fictional. 🥸
          </p>
          <p className="mt-0.5 text-[11px] text-white/40">Rebuilt with Next.js 16 · React Three Fiber · TypeScript</p>
        </footer>
      </div>

      <HowToPlay open={help} onOpenChange={setHelp} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
