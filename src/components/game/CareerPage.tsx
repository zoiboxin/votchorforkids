"use client";

/**
 * CareerPage — the full-page 📊 CAREER hub.
 *
 * Twelve-stat overview computed from the live profile (runs, best score, wins,
 * win-rate, rescues, cash banked, zombies caught, avg score, XP, playtime,
 * streaks, pass tier), the rank ladder card, the recent match history table
 * (from the 60-run rolling record) and the GLOBAL Hall of Fame leaderboard
 * (Prisma-backed /api/scores). Plus achievement badges and the ad carousel.
 */

import { motion } from "framer-motion";
import { Award, BarChart3, Crown, History as HistoryIcon, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { RANKS, rankFor } from "@/lib/game/ranks";
import { AdCarousel, PageShell, Strip, XpBar } from "./PageKit";
import { RankBadge } from "./RankCard";

/** XP needed per account LEVEL (Fortnite-style) — mirrors Landing */
const LEVEL_STEP = 500;

/* ---------------- achievements ---------------- */

interface Ach { id: string; emoji: string; name: string; test: boolean; tip: string }

function StatTile({ value, label, accent = "text-white", icon }: { value: string; label: string; accent?: string; icon?: string }) {
  return (
    <div className="rounded-xl border border-white/12 bg-white/5 px-2 py-3 text-center backdrop-blur">
      {icon && <div aria-hidden className="text-base leading-none">{icon}</div>}
      <div className={`mt-0.5 truncate text-lg font-black tabular-nums ${accent}`}>{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-wide text-white/50">{label}</div>
    </div>
  );
}

export function CareerPage() {
  const setScreen = useGame((s) => s.setScreen);
  const playerName = useGame((s) => s.playerName);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const wins = useGame((s) => s.wins);
  const lifeRescues = useGame((s) => s.lifeRescues);
  const lifeVotes = useGame((s) => s.lifeVotes);
  const lifeCaught = useGame((s) => s.lifeCaught);
  const careerXp = useGame((s) => s.careerXp);
  const bonusXp = useGame((s) => s.bonusXp);
  const playtimeMs = useGame((s) => s.playtimeMs);
  const history = useGame((s) => s.history);
  const daily = useGame((s) => s.daily);
  const scores = useGame((s) => s.scores);

  const { rank, next, progress, toNext } = rankFor(careerXp);
  const level = Math.floor(careerXp / LEVEL_STEP) + 1;
  const tier = RANKS.findIndex((r) => r.id === rank.id) + 1;
  const winRate = runsPlayed > 0 ? Math.round((wins / runsPlayed) * 100) : 0;
  const avgScore = runsPlayed > 0 ? Math.round((careerXp - bonusXp) / runsPlayed) : 0;
  const playMin = Math.max(1, Math.round(playtimeMs / 60_000));

  const recent = [...history].reverse().slice(0, 8);
  const top = scores.slice(0, 10);

  const achievements: readonly Ach[] = [
    { id: "first-blood", emoji: "🩸", name: "First Night", test: runsPlayed >= 1, tip: "Survive (or die in) your first night" },
    { id: "veteran", emoji: "🎖️", name: "Veteran — 10 runs", test: runsPlayed >= 10, tip: "Finish 10 runs" },
    { id: "centurion", emoji: "🏛️", name: "Centurion — 50 runs", test: runsPlayed >= 50, tip: "Finish 50 runs" },
    { id: "rich", emoji: "💰", name: "Town Tycoon — $1000", test: lifeVotes >= 1000, tip: "Bank $1,000 lifetime" },
    { id: "medic", emoji: "❤️", name: "Guardian — 15 rescues", test: lifeRescues >= 15, tip: "Free 15 bubbled friends" },
    { id: "winner", emoji: "🏆", name: "Dawn Walker — 1 win", test: wins >= 1, tip: "Outlast all 7 nights" },
    { id: "sharpshooter", emoji: "🧟", name: "Beast Tamer — 5 hoards", test: lifeCaught >= 5, tip: "Take down 5 zombie hoards" },
    { id: "streaker", emoji: "🔥", name: "Flame Keeper — 3 streak", test: daily.bestStreak >= 3, tip: "A 3-day login streak" },
    { id: "legend", emoji: "👑", name: "Night Legend", test: careerXp >= 5000, tip: "Reach the top rank" },
  ];

  return (
    <PageShell
      title="CAREER"
      emoji="📊"
      subtitle={`${playerName || "Unnamed survivor"} — every stat below is your real save, not decoration.`}
      screen="career"
    >
      <AdCarousel placement="career" />

      {/* ---------- hero: rank card + level ---------- */}
      <section className="relative overflow-hidden rounded-2xl border border-yellow-300/30 bg-gradient-to-r from-slate-950/85 via-amber-950/60 to-slate-950/85 p-4 shadow-lg backdrop-blur sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-3">
            <RankBadge xp={careerXp} size={64} />
            <div className="min-w-0">
              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-yellow-300/80">current rank</div>
              <div className="truncate text-xl font-black italic uppercase text-white">{rank.name}</div>
              <div className="text-[10px] font-bold text-white/55">
                {next ? `${toNext.toLocaleString()} XP → ${next.emoji} ${next.name}` : "Top rank — you are a 7Nights legend!"}
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/55">account level</span>
              <span className="text-[10px] font-black tabular-nums text-white/70">
                LVL <span className="text-yellow-300">{level}</span> · tier {tier}/{RANKS.length}
              </span>
            </div>
            <div className="mt-1.5"><XpBar pct={progress} bar={rank.bar} /></div>
            <div className="mt-1 text-[10px] font-bold tabular-nums text-white/50">
              {careerXp.toLocaleString()} career XP · {bonusXp.toLocaleString()} from bonuses
            </div>
          </div>
          <Button
            onClick={() => { sfx.click(); setScreen("profile"); }}
            className="shrink-0 rounded-lg bg-white/10 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-white ring-1 ring-white/20 hover:bg-white/20"
            aria-label="Open full profile"
          >
            <User size={14} className="mr-1.5" /> profile
          </Button>
        </div>
      </section>

      {/* ---------- 12-stat grid ---------- */}
      <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
        <Strip right={<span className="flex items-center gap-1 text-[10px] font-black text-white/85"><BarChart3 size={11} /> lifetime</span>}>
          Career stats
        </Strip>
        <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatTile icon="🏃" value={String(runsPlayed)} label="runs" />
          <StatTile icon="⭐" value={bestScore.toLocaleString()} label="best score" accent="text-yellow-300" />
          <StatTile icon="🏆" value={String(wins)} label="7-night wins" accent="text-amber-300" />
          <StatTile icon="🎯" value={`${winRate}%`} label="win rate" accent="text-emerald-300" />
          <StatTile icon="❤️" value={lifeRescues.toLocaleString()} label="rescues" accent="text-rose-300" />
          <StatTile icon="💰" value={`$${lifeVotes.toLocaleString()}`} label="cash banked" accent="text-yellow-300" />
          <StatTile icon="🧟" value={lifeCaught.toLocaleString()} label="hoards felled" accent="text-orange-300" />
          <StatTile icon="📈" value={avgScore.toLocaleString()} label="avg score" accent="text-sky-300" />
          <StatTile icon="⭐" value={careerXp.toLocaleString()} label="career XP" accent="text-sky-300" />
          <StatTile icon="⏱️" value={`${playMin}m`} label="playtime" accent="text-teal-300" />
          <StatTile icon="🔥" value={String(daily.bestStreak)} label="best streak" accent="text-orange-300" />
          <StatTile icon="🎫" value={`${tier}/${RANKS.length}`} label="pass tier" accent="text-fuchsia-300" />
        </div>
      </section>

      {/* ---------- history + hall of fame ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* match history */}
        <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
          <Strip right={<span className="flex items-center gap-1 text-[10px] font-black text-white/85"><HistoryIcon size={11} /> last {recent.length} of {history.length}</span>}>
            Match history
          </Strip>
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto p-2.5 lobby-scroll [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar]:w-2">
            {recent.length === 0 && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-center text-[11px] font-bold text-white/50">
                No nights survived yet — the town is waiting. 🌙
              </div>
            )}
            {recent.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.14, delay: i * 0.03 }}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${r.won ? "border-amber-300/45 bg-amber-400/10" : "border-white/10 bg-white/5"}`}
              >
                <span aria-hidden className="text-base">{r.won ? "🏆" : "🥀"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] font-black text-white/90">
                    <span className="tabular-nums">{r.score.toLocaleString()} pts</span>
                    {r.won && <span className="rounded-full bg-amber-400/25 px-1.5 py-px text-[9px] font-black uppercase text-amber-200">won</span>}
                  </div>
                  <div className="text-[9px] font-bold tabular-nums text-white/45">
                    💰 {r.votes} · ❤️ {r.rescues} · 🧟 {r.caught} · {Math.max(1, Math.round(r.timeMs / 1000))}s
                  </div>
                </div>
                <span className="shrink-0 text-[9px] font-black uppercase text-white/35">
                  {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </motion.div>
            ))}
          </div>
        </section>

        {/* hall of fame */}
        <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
          <Strip right={<span className="flex items-center gap-1 text-[10px] font-black text-white/85"><Crown size={11} /> global · live</span>}>
            Hall of fame
          </Strip>
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto p-2.5 lobby-scroll [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar]:w-2">
            {top.length === 0 && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-center text-[11px] font-bold text-white/50">
                The hall stands empty… bank a score to carve your name.
              </div>
            )}
            {top.map((s, i) => {
              const me = playerName && s.name === playerName;
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                    me ? "border-yellow-300/50 bg-yellow-400/10" : i < 3 ? "border-white/15 bg-white/8" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black tabular-nums ${
                    i === 0 ? "bg-yellow-400 text-slate-950" : i === 1 ? "bg-slate-300 text-slate-950" : i === 2 ? "bg-amber-600 text-white" : "bg-black/40 text-white/60"
                  }`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-white/90">
                      {s.name}{me && <span className="ml-1.5 rounded-full bg-yellow-400 px-1.5 py-px text-[9px] font-black uppercase text-slate-950">you</span>}
                    </div>
                    <div className="text-[9px] font-bold tabular-nums text-white/45">
                      💰 {s.votes} · ❤️ {s.rescues} · {s.won ? "🏆 won" : "🥀 fell"} {s.won ? "" : `· 🧟 ${s.caught}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-black tabular-nums text-yellow-300">{s.points.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ---------- achievements ---------- */}
      <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
        <Strip right={<span className="flex items-center gap-1 text-[10px] font-black text-white/85"><Award size={11} /> {achievements.filter((a) => a.test).length}/{achievements.length} unlocked</span>}>
          Achievements
        </Strip>
        <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-5 lg:grid-cols-9">
          {achievements.map((a) => (
            <div
              key={a.id}
              title={a.tip}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center transition-colors ${
                a.test ? "border-yellow-300/45 bg-yellow-400/10 shadow-[0_0_12px_rgba(253,224,71,0.18)]" : "border-white/10 bg-black/30 opacity-55"
              }`}
            >
              <span aria-hidden className={`text-2xl leading-none ${a.test ? "" : "grayscale"}`}>{a.test ? a.emoji : "🔒"}</span>
              <span className={`text-[9px] font-black uppercase leading-tight ${a.test ? "text-yellow-200" : "text-white/45"}`}>{a.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- quick links ---------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          { label: "Battle Pass", emoji: "🎫", go: "battlepass" as const },
          { label: "Challenges", emoji: "🎯", go: "challenges" as const },
          { label: "Item Shop", emoji: "🛒", go: "shop" as const },
          { label: "Play Tonight", emoji: "🌙", go: "landing" as const },
        ]).map((b) => (
          <Button
            key={b.label}
            onClick={() => { sfx.click(); setScreen(b.go); }}
            className="h-11 rounded-lg border-white/15 bg-black/40 text-xs font-black uppercase tracking-wider text-white hover:bg-black/60"
            variant="outline"
          >
            <span aria-hidden className="mr-1.5">{b.emoji}</span> {b.label}
          </Button>
        ))}
      </div>
    </PageShell>
  );
}
