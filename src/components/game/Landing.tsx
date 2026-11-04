"use client";

import { useEffect, useState } from "react";
import { Play, Settings, Gamepad2, UserCog, Trophy, ShieldAlert, Sunrise, MapPin, Sparkles, Vote, User, BarChart3, History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TICKER_LINES } from "@/lib/game/constants";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { useGame } from "./store";
import { Leaderboard } from "./Creator";
import { HowToPlay, SettingsDialog, ProfileDialog, StatsDialog, HistoryDialog } from "./Panels";
import { RankBadge, RankProgress } from "./RankCard";

const FEATURES: { emoji: string; icon: React.ReactNode; title: string; text: string; tint: string }[] = [
  { emoji: "🏙️", icon: <MapPin size={18} />, title: "Huge GTA-style city", text: "Towers, shops, homes, a mega mall, farms, jungle, deep jungle & graveyard — all explorable", tint: "text-emerald-300" },
  { emoji: "🚓", icon: <ShieldAlert size={18} />, title: "Cartoon police chase", text: "9 bumbling cops hunt you the moment you pocket votes — sprint, juke, hide!", tint: "text-rose-300" },
  { emoji: "🌙", icon: <Sunrise size={18} />, title: "Day & night cycle", text: "Chai stops by day… when the sun sets, the graveyard wakes up 🧟", tint: "text-amber-300" },
  { emoji: "🏆", icon: <Trophy size={18} />, title: "High scores", text: "Rescue friends, dodge cops, deliver 16 votes and save democracy!", tint: "text-yellow-300" },
];

const FLOATERS = ["🗳️", "💨", "🥁", "✊", "🌼", "🕊️"];

export function Landing() {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const look = useGame((s) => s.look);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const lifeVotes = useGame((s) => s.lifeVotes);
  const lifeRescues = useGame((s) => s.lifeRescues);
  const careerXp = useGame((s) => s.careerXp);
  const [help, setHelp] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasProfile = playerName.trim().length > 0;

  useEffect(() => {
    fetch("/api/scores").then((r) => r.json()).then((d) => useGame.getState().setScores(d.scores ?? [])).catch(() => {});
    const unlock = () => { primeAudio(); startMusic(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // PLAY: the hero-selection flow — everyone picks a side first (protester
  // runner or police), police continue to the squad-uniform page
  const goPlay = () => {
    sfx.click();
    setScreen("select");
  };
  const goCreate = () => { sfx.click(); setScreen("creator"); };

  return (
    <div className="relative h-screen w-full overflow-y-auto">
      <style>{`
        @keyframes vc-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes vc-float { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-16px) rotate(3deg); } }
        @keyframes vc-drift { 0% { transform: translateX(-12vw); } 100% { transform: translateX(112vw); } }
        @keyframes vc-pop { 0% { transform: scale(.86); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes vc-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
        @keyframes vc-spin-slow { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>

      {/* painted hero backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-votechor.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-sky-900/55 via-sky-800/40 to-slate-950/80" />

      {/* sky life: drifting clouds + bouncing sun + floating props */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[6%] top-[10%] h-14 w-28 rounded-full bg-white/50 blur-[1px]" style={{ animation: "vc-drift 38s linear infinite" }} />
        <div className="absolute left-[30%] top-[20%] h-10 w-24 rounded-full bg-white/40 blur-[1px]" style={{ animation: "vc-drift 52s linear infinite", animationDelay: "-18s" }} />
        <div className="absolute top-[5%] h-12 w-24 rounded-full bg-white/30 blur-[1px]" style={{ animation: "vc-drift 64s linear infinite", animationDelay: "-40s" }} />
        <div className="absolute right-[6%] top-[7%] h-16 w-16 rounded-full bg-yellow-200 shadow-[0_0_70px_26px_rgba(253,224,71,0.45)]" style={{ animation: "vc-float 7s ease-in-out infinite" }} />
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

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6">
        {/* hero */}
        <header className="flex flex-col items-center pt-4 text-center sm:pt-8" style={{ animation: "vc-pop .5s ease-out both" }}>
          <div className="mb-3 flex items-center gap-2 rounded-full border border-yellow-300/40 bg-black/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-200 backdrop-blur sm:text-xs">
            <Sparkles size={13} className="text-yellow-300" /> The Great Parliament Run · v2
          </div>
          <div className="relative">
            <h1 className="text-6xl font-black tracking-tight text-white drop-shadow-[0_6px_0_rgba(0,0,0,0.4)] sm:text-7xl md:text-8xl" style={{ animation: "vc-breathe 4s ease-in-out infinite" }}>
              Vote<span className="text-yellow-300">Chor!</span>
            </h1>
            <span
              aria-hidden
              className="absolute -right-10 -top-4 hidden -rotate-12 rounded-lg border-[3px] border-rose-300/90 bg-rose-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-rose-100 sm:block"
              style={{ animation: "vc-spin-slow 1.2s ease-out both" }}
            >
              Everybody run!
            </span>
          </div>
          <p className="mt-2 max-w-xl text-base font-bold text-emerald-100 drop-shadow sm:text-lg">
            The votes are missing. The protest is on. <span className="text-yellow-200">Everybody run!</span>
          </p>

          {/* profile console: rank + identity + manage buttons */}
          <div className="mx-auto mt-4 w-full max-w-xl rounded-2xl border border-white/25 bg-black/40 p-3 text-sm text-white backdrop-blur">
            <div className="flex items-center gap-3">
              <RankBadge xp={careerXp} size={46} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-black text-yellow-200">{hasProfile ? `Hi, ${playerName}!` : "New challenger!"}</span>
                  <span className="shrink-0 text-white/75">{look.girl ? "👧" : "👦"} {look.age}{look.cap ? " 🧢" : ""}{look.glasses ? " 👓" : ""}</span>
                </div>
                <div className="mt-1">
                  <RankProgress xp={careerXp} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {runsPlayed > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5">🏃 {runsPlayed} run{runsPlayed === 1 ? "" : "s"}</span>}
                  {bestScore > 0 && <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-yellow-200">🏆 best {bestScore.toLocaleString()}</span>}
                  {lifeVotes > 0 && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-200">🗳️ {lifeVotes} delivered</span>}
                  {lifeRescues > 0 && <span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-rose-200">❤️ {lifeRescues} rescued</span>}
                </div>
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Button
                size="sm" aria-label="Manage profile" onClick={() => { sfx.click(); setProfileOpen(true); }}
                className="h-9 rounded-xl border border-white/20 bg-white/10 text-xs font-black text-white backdrop-blur hover:bg-white/20"
              >
                <User size={14} className="mr-1" /> Profile
              </Button>
              <Button
                size="sm" aria-label="View career stats" onClick={() => { sfx.click(); setStatsOpen(true); }}
                className="h-9 rounded-xl border border-white/20 bg-white/10 text-xs font-black text-white backdrop-blur hover:bg-white/20"
              >
                <BarChart3 size={14} className="mr-1" /> Stats
              </Button>
              <Button
                size="sm" aria-label="View run history" onClick={() => { sfx.click(); setHistoryOpen(true); }}
                className="h-9 rounded-xl border border-white/20 bg-white/10 text-xs font-black text-white backdrop-blur hover:bg-white/20"
              >
                <HistoryIcon size={14} className="mr-1" /> History
              </Button>
            </div>
          </div>
        </header>

        {/* CTA row */}
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={goPlay}
            className="h-16 min-w-56 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 px-8 text-xl font-black text-amber-950 shadow-[0_8px_0_rgba(180,120,0,0.55)] transition-transform hover:scale-[1.03] active:scale-95"
          >
            <Play size={24} className="mr-2" fill="currentColor" /> {hasProfile ? `PLAY, ${playerName}!` : "PLAY"}
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="lg" onClick={goCreate} aria-label="Customize your hero"
              className="h-14 rounded-2xl border-white/30 bg-black/35 px-5 font-black text-white backdrop-blur hover:bg-black/50"
            >
              <UserCog size={18} className="mr-1.5" /> {hasProfile ? "Customize hero" : "Create hero"}
            </Button>
            <Button
              size="lg" variant="outline" onClick={() => { sfx.click(); setHelp(true); }}
              className="h-14 rounded-2xl border-white/30 bg-black/35 px-5 font-black text-white backdrop-blur hover:bg-black/50"
            >
              <Gamepad2 size={18} className="mr-1.5" /> How to play
            </Button>
            <Button
              size="lg" variant="outline" aria-label="Open settings" onClick={() => { sfx.click(); setSettingsOpen(true); }}
              className="h-14 w-14 rounded-2xl border-white/30 bg-black/35 p-0 text-white backdrop-blur hover:bg-black/50"
            >
              <Settings size={20} />
            </Button>
          </div>
        </div>

        {/* marquee ticker */}
        <div className="mt-6 overflow-hidden rounded-full border border-white/20 bg-black/45 py-2 backdrop-blur" aria-hidden>
          <div className="flex w-max gap-10 whitespace-nowrap px-4 text-sm font-bold text-white/90" style={{ animation: "vc-marquee 36s linear infinite" }}>
            {[...TICKER_LINES, ...TICKER_LINES].map((l, i) => (
              <span key={i} className="inline-block">{l}</span>
            ))}
          </div>
        </div>

        {/* features */}
        <section aria-label="Game features" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-white/20 bg-black/40 p-4 backdrop-blur transition-all hover:-translate-y-1 hover:border-yellow-300/40 hover:bg-black/55">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-2xl transition-transform group-hover:scale-125">{f.emoji}</span>
                <span className={f.tint}>{f.icon}</span>
              </div>
              <div className="text-sm font-black text-white">{f.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-white/70">{f.text}</div>
            </div>
          ))}
        </section>

        {/* objective strip */}
        <div className="mx-auto mt-5 flex w-full max-w-2xl items-center justify-center gap-3 rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-center backdrop-blur">
          <Vote size={20} className="shrink-0 text-yellow-300" />
          <p className="text-xs font-bold text-white/85 sm:text-sm">
            Snatch the <b className="text-yellow-300">16 missing votes</b>, dodge <b className="text-rose-300">9 cartoon cops</b>, rescue jailed friends —
            then deliver everything to the Parliament ballot box before nightfall. <span className="text-emerald-300">Democracy is counting on you!</span>
          </p>
        </div>

        {/* leaderboard */}
        <div className="mx-auto mt-5 w-full max-w-xl">
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
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
