"use client";

import { useEffect, useState } from "react";
import { Play, Settings, Gamepad2, UserCog, Trophy, Moon, MoonStar, Axe, Scale, Flame, Sparkles, User, BarChart3, History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NIGHT_TICKER } from "@/lib/game/constants";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { useGame } from "./store";
import { Leaderboard } from "./Creator";
import { HowToPlay, SettingsDialog, ProfileDialog, StatsDialog, HistoryDialog } from "./Panels";
import { RankBadge, RankProgress } from "./RankCard";
import { DailyCard } from "./DailyCard";

const FEATURES: { emoji: string; icon: React.ReactNode; title: string; text: string; tint: string }[] = [
  { emoji: "🌙", icon: <Moon size={18} />, title: "7 nights of suspense", text: "Eight souls, one sleepy town. Every dusk the sirens wail — and the dark picks its next victim.", tint: "text-indigo-300" },
  { emoji: "🪓", icon: <Axe size={18} />, title: "Chop, smash & build by day", text: "Fell trees, smash boulders, stack barricades and light campfires before the sun dies.", tint: "text-amber-300" },
  { emoji: "🔪", icon: <MoonStar size={18} />, title: "One player turns at night — could be YOU", text: "The possessed becomes a zombie beast and hunts the crew. Some nights, the dark chooses you…", tint: "text-rose-300" },
  { emoji: "⚖️", icon: <Scale size={18} />, title: "Inspect, follow clues, accuse", text: "At dawn, search the bodies for clues and accuse your suspect — guess right, or doom an innocent.", tint: "text-sky-300" },
  { emoji: "🔥", icon: <Flame size={18} />, title: "Campfires keep the beast away", text: "Beasts and zombies shy from firelight. Circle the flames — but the wood runs out…", tint: "text-orange-300" },
  { emoji: "🏆", icon: <Trophy size={18} />, title: "Outlast the darkness", text: "See the dawn after night 7 — or be the last one standing. Those are the only ways to win.", tint: "text-yellow-300" },
];

const FLOATERS = ["🌙", "🦇", "🔥", "🪓", "✨", "🧟"];

export function Landing() {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const look = useGame((s) => s.look);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const lifeVotes = useGame((s) => s.lifeVotes);
  const lifeRescues = useGame((s) => s.lifeRescues);
  const careerXp = useGame((s) => s.careerXp);
  const dailyStreak = useGame((s) => s.daily.streak);
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

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6">
        {/* hero */}
        <header className="flex flex-col items-center pt-4 text-center sm:pt-8" style={{ animation: "vc-pop .5s ease-out both" }}>
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

          {/* profile console: rank + identity + manage buttons */}
          <div className="mx-auto mt-4 w-full max-w-xl rounded-2xl border border-white/25 bg-black/40 p-3 text-sm text-white backdrop-blur">
            <div className="flex items-center gap-3">
              <RankBadge xp={careerXp} size={46} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-black text-red-200">{hasProfile ? `Hi, ${playerName}!` : "New survivor!"}</span>
                  <span className="shrink-0 text-white/75">{look.girl ? "👧" : "👦"} {look.age}{look.cap ? " 🧢" : ""}{look.glasses ? " 👓" : ""}</span>
                </div>
                <div className="mt-1">
                  <RankProgress xp={careerXp} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {runsPlayed > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5">🏃 {runsPlayed} run{runsPlayed === 1 ? "" : "s"}</span>}
                  {bestScore > 0 && <span className="rounded-full bg-red-400/20 px-2 py-0.5 text-red-200">🏆 best {bestScore.toLocaleString()}</span>}
                  {lifeVotes > 0 && <span className="rounded-full bg-indigo-400/15 px-2 py-0.5 text-indigo-200">🗳️ {lifeVotes} delivered</span>}
                  {lifeRescues > 0 && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-200">❤️ {lifeRescues} rescues</span>}
                  <span className={`rounded-full px-2 py-0.5 ${dailyStreak > 0 ? "bg-orange-500/20 text-orange-200" : "bg-white/10"}`}>🔥 {dailyStreak}-day streak</span>
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
            onClick={goCreator}
            className="h-16 min-w-56 rounded-2xl bg-gradient-to-r from-red-500 to-amber-400 px-8 text-xl font-black text-red-950 shadow-[0_8px_0_rgba(127,29,29,0.6)] transition-transform hover:scale-[1.03] active:scale-95"
          >
            <Play size={24} className="mr-2" fill="currentColor" /> {hasProfile ? `JOIN, ${playerName}!` : "PLAY"}
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="lg" onClick={goCreator} aria-label="Customize your survivor"
              className="h-14 rounded-2xl border-white/30 bg-black/35 px-5 font-black text-white backdrop-blur hover:bg-black/50"
            >
              <UserCog size={18} className="mr-1.5" /> {hasProfile ? "Customize survivor" : "Create survivor"}
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
            {[...NIGHT_TICKER, ...NIGHT_TICKER].map((l, i) => (
              <span key={i} className="inline-block">{l}</span>
            ))}
          </div>
        </div>

        {/* features */}
        <section aria-label="Game features" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-white/20 bg-black/40 p-4 backdrop-blur transition-all hover:-translate-y-1 hover:border-red-300/40 hover:bg-black/55">
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
          <Moon size={20} className="shrink-0 text-indigo-300" />
          <p className="text-xs font-bold text-white/85 sm:text-sm">
            Survive <b className="text-red-300">7 nights</b> · <b className="text-amber-300">Build by day</b> · <b className="text-indigo-300">Hide or hunt by night</b> · <b className="text-yellow-200">Accuse the possessed</b>
          </p>
        </div>

        {/* daily tasks + hall of fame — side by side */}
        <div className="mx-auto mt-5 grid w-full max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
          <DailyCard />
          <Leaderboard compact />
        </div>

        {/* footer */}
        <footer className="mt-auto pt-6 pb-4 text-center">
          <p className="text-[11px] text-white/60">
            7Nights is a work of spooky silliness. All possessions strictly fictional. No zombies were harmed. 🌙
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
