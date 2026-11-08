"use client";

import { useState } from "react";
import {
  ArrowLeft, BarChart3, History as HistoryIcon, Gamepad2, User, Pencil, Shirt, Trash2,
  Trophy, Moon, MoonStar, Axe, Scale, Flame, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AGE_STATS, HAIR_STYLES } from "@/lib/game/constants";
import { sfx } from "@/lib/game/audio";
import { useGame } from "./store";
import { RankCard } from "./RankCard";
import { DailyCard } from "./DailyCard";
import { Leaderboard } from "./Leaderboard";
import { HowToPlay, StatsDialog, HistoryDialog } from "./Panels";

/* 🎴 Game feature cards — moved off the landing page, now living on the profile page */
const FEATURES: { emoji: string; icon: React.ReactNode; title: string; text: string; tint: string }[] = [
  { emoji: "🌐", icon: <Moon size={18} />, title: "True co-op multiplayer", text: "Up to 8 real friends share ONE town — streamed over 9-byte binary packets. Any soul can turn… even yours.", tint: "text-teal-300" },
  { emoji: "🌙", icon: <Moon size={18} />, title: "7 nights of suspense", text: "Eight souls, one sleepy town. Every dusk the sirens wail — and the dark picks its next victim.", tint: "text-indigo-300" },
  { emoji: "🪓", icon: <Axe size={18} />, title: "Chop, smash & build by day", text: "Fell trees, smash boulders, stack barricades and light campfires before the sun dies.", tint: "text-amber-300" },
  { emoji: "🔪", icon: <MoonStar size={18} />, title: "One player turns at night — could be YOU", text: "The possessed becomes a zombie beast and hunts the crew. Some nights, the dark chooses you…", tint: "text-rose-300" },
  { emoji: "⚖️", icon: <Scale size={18} />, title: "Inspect, follow clues, accuse", text: "At dawn, search the bodies for clues and accuse your suspect — guess right, or doom an innocent.", tint: "text-sky-300" },
  { emoji: "🔥", icon: <Flame size={18} />, title: "Campfires keep the beast away", text: "Beasts and zombies shy from firelight. Circle the flames — but the wood runs out…", tint: "text-orange-300" },
  { emoji: "🏆", icon: <Trophy size={18} />, title: "Outlast the darkness", text: "See the dawn after night 7 — or be the last one standing. Those are the only ways to win.", tint: "text-yellow-300" },
];

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-2 py-2">
      <div className="truncate text-sm font-black text-white">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-white/55">{label}</div>
    </div>
  );
}

/* 👤 Profile — a full page (was a dialog): rank, daily tasks, hall of fame,
   account settings AND the game feature cards moved here from the landing page. */
export function Profile() {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const setName = useGame((s) => s.setName);
  const look = useGame((s) => s.look);
  const resetStats = useGame((s) => s.resetStats);
  const pushToast = useGame((s) => s.pushToast);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const careerXp = useGame((s) => s.careerXp);
  const dailyStreak = useGame((s) => s.daily.streak);

  const [name, setLocalName] = useState(playerName);
  const [confirmReset, setConfirmReset] = useState(false);
  const [help, setHelp] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasProfile = playerName.trim().length > 0;

  const saveName = () => {
    const n = name.trim().slice(0, 16);
    if (!n || n === playerName) return;
    setName(n);
    sfx.pickup();
    pushToast(`Nice to meet you, ${n}! 🎉`, "good");
  };

  const lookBits = [
    look.girl ? "👧 Girl" : "👦 Boy",
    AGE_STATS[look.age].label.split("—")[0].trim(),
    HAIR_STYLES.find((h) => h.id === look.hairStyle)?.label ?? "",
    look.cap ? "🧢 Cap" : "",
    look.glasses ? "👓 Glasses" : "",
  ].filter(Boolean);

  return (
    <div className="relative h-screen w-full overflow-y-auto bg-slate-950">
      {/* same painted night-town backdrop as the landing page */}
      <div aria-hidden className="fixed inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/hero-7nights.png)" }} />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/90 via-indigo-950/70 to-slate-950/95" />

      {/* sticky top bar: back to landing + quick dialogs */}
      <div className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/75 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2.5">
          <Button
            size="sm" variant="outline" aria-label="Back to landing"
            onClick={() => { sfx.click(); setScreen("landing"); }}
            className="h-10 rounded-full border-white/25 bg-black/45 px-4 font-black text-white backdrop-blur hover:bg-black/65"
          >
            <ArrowLeft size={16} className="mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="icon" variant="outline" aria-label="How to play"
              onClick={() => { sfx.click(); setHelp(true); }}
              className="h-10 w-10 rounded-full border-white/25 bg-black/45 text-white backdrop-blur hover:bg-black/65"
            >
              <Gamepad2 size={18} />
            </Button>
            <Button
              size="icon" variant="outline" aria-label="Career stats"
              onClick={() => { sfx.click(); setStatsOpen(true); }}
              className="h-10 w-10 rounded-full border-white/25 bg-black/45 text-white backdrop-blur hover:bg-black/65"
            >
              <BarChart3 size={18} />
            </Button>
            <Button
              size="icon" variant="outline" aria-label="Run history"
              onClick={() => { sfx.click(); setHistoryOpen(true); }}
              className="h-10 w-10 rounded-full border-white/25 bg-black/45 text-white backdrop-blur hover:bg-black/65"
            >
              <HistoryIcon size={18} />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6">
        {/* header */}
        <header className="flex flex-col items-center pt-2 text-center">
          <div className="flex items-center gap-2 text-3xl font-black tracking-tight text-white drop-shadow sm:text-4xl">
            <User size={30} className="text-yellow-300" /> My profile
          </div>
          <p className="mt-1 text-sm font-bold text-slate-200/85">
            {hasProfile ? `Welcome back, ${playerName} — the town remembers you.` : "Create your hero, then survive the seven nights."}
          </p>
        </header>

        {/* rank */}
        <div className="mx-auto mt-5 w-full max-w-2xl">
          <RankCard />
        </div>

        {/* daily tasks + hall of fame */}
        <div className="mx-auto mt-4 grid w-full max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
          <DailyCard />
          <Leaderboard />
        </div>

        {/* account settings */}
        <section aria-label="Account settings" className="mx-auto mt-4 grid w-full max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md">
            {/* name */}
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Hero name</div>
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setLocalName(e.target.value.slice(0, 16))}
                  maxLength={16}
                  aria-label="Hero name"
                  placeholder="e.g. Chintu"
                  className="border-white/25 bg-white/10 text-white placeholder:text-white/40"
                />
                <Button
                  size="sm" onClick={saveName} disabled={!name.trim() || name.trim() === playerName}
                  className="rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 font-black text-amber-950 disabled:opacity-50"
                >
                  <Pencil size={14} className="mr-1" /> Save
                </Button>
              </div>
            </div>

            {/* look summary */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-white/70"><Shirt size={13} /> Current look</span>
                <Button
                  size="sm" onClick={() => { sfx.click(); setScreen("creator"); }}
                  className="h-7 rounded-full border-white/25 bg-white/10 px-3 text-xs font-black text-white hover:bg-white/20"
                >
                  <Pencil size={12} className="mr-1" /> Edit hero
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lookBits.map((b) => (
                  <span key={b} className="rounded-full border border-white/20 bg-black/30 px-2.5 py-0.5 text-xs font-bold text-white/85">{b}</span>
                ))}
              </div>
            </div>

            {/* mini stats strip */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Runs" value={String(runsPlayed)} />
              <MiniStat label="Career XP" value={careerXp.toLocaleString()} />
              <MiniStat label="🔥 Streak" value={`${dailyStreak} day${dailyStreak === 1 ? "" : "s"}`} />
            </div>
          </div>

          {/* danger zone */}
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 backdrop-blur-md">
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-rose-300">Danger zone</div>
            {!confirmReset ? (
              <>
                <Button
                  variant="outline" onClick={() => setConfirmReset(true)}
                  className="w-full rounded-xl border-rose-300/40 bg-transparent font-black text-rose-200 hover:bg-rose-500/20"
                >
                  <Trash2 size={14} className="mr-1" /> Reset stats & history
                </Button>
                <p className="mt-2 text-[11px] font-bold leading-relaxed text-white/55">
                  Wipes ALL runs, XP and rank progress on this device. Your hero look stays.
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-bold text-rose-100">This wipes ALL runs, XP and rank progress on this device. Your hero look stays. Sure?</p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => { resetStats(); setConfirmReset(false); setLocalName(useGame.getState().playerName); pushToast("Profile stats & history cleared.", "info"); }}
                    className="flex-1 rounded-xl bg-rose-500 font-black text-white hover:bg-rose-400"
                  >
                    Yes, wipe it
                  </Button>
                  <Button
                    variant="outline" onClick={() => setConfirmReset(false)}
                    className="flex-1 rounded-xl border-white/25 bg-transparent font-black text-white hover:bg-white/10"
                  >
                    Keep it
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* game features — moved here from the landing page */}
        <section aria-label="Game features" className="mt-8">
          <div className="mb-3 flex items-center justify-center gap-2 text-center">
            <Sparkles size={16} className="text-red-300" />
            <h2 className="text-lg font-black uppercase tracking-wide text-white/90">The 7 nights — what awaits you</h2>
            <Sparkles size={16} className="text-red-300" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>
        </section>

        {/* footer */}
        <footer className="mt-auto pt-8 pb-4 text-center">
          <p className="text-[11px] text-white/60">
            7Nights is a work of spooky silliness. All possessions strictly fictional. No zombies were harmed. 🌙
          </p>
        </footer>
      </div>

      <HowToPlay open={help} onOpenChange={setHelp} />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
