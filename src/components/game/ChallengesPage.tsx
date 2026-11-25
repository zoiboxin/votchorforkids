"use client";

/**
 * ChallengesPage — the full-page 🎯 CHALLENGES hub.
 *
 * Three boards, all reading REAL save data:
 *   • DAILY — the 3 rolled tasks from the live daily system (progress,
 *     streak, reset countdown, all-done bonus)
 *   • SEASON QUESTS — milestone quests scored against lifetime stats
 *     (runs, rescues, cash banked, zombies caught, wins) — claimable once
 *     per season, rewards pay real XP through the profile bonus pool
 *   • SUGGESTED — quick-hop pointers into tonight's action
 * Plus the game ad carousel.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronRight, Flame, Lock, Sparkles, Target, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { ALL_DONE_BONUS, DAILY_TASK_POOL } from "@/lib/game/daily";
import { AdCarousel, PageShell, Strip, XpBar } from "./PageKit";

const LS_QUESTS = "votechor_quests_v1";

/* ---------------- season quests ---------------- */

interface SeasonQuest {
  id: string;
  emoji: string;
  title: string;
  sub: string;
  target: number;
  /** progress in absolute units (same scale as target) */
  progress: (s: { runs: number; rescues: number; votes: number; caught: number; wins: number; best: number }) => number;
  rewardXp: number;
  rewardCoins: number;
}

const SEASON_QUESTS: readonly SeasonQuest[] = [
  {
    id: "q-runs", emoji: "🏃", title: "MARATHON OF NIGHTS", sub: "Finish 10 runs — every drop counts",
    target: 10, progress: (s) => s.runs, rewardXp: 150, rewardCoins: 100,
  },
  {
    id: "q-rescues", emoji: "❤️", title: "GUARDIAN ANGEL", sub: "Free 15 bubbled friends from their prisons",
    target: 15, progress: (s) => s.rescues, rewardXp: 200, rewardCoins: 150,
  },
  {
    id: "q-cash", emoji: "💰", title: "TOWN TYCOON", sub: "Bank $1,000 across your nights",
    target: 1000, progress: (s) => s.votes, rewardXp: 250, rewardCoins: 200,
  },
  {
    id: "q-caught", emoji: "🧟", title: "BEAST TAMER", sub: "Take down 5 zombie hoards",
    target: 5, progress: (s) => s.caught, rewardXp: 180, rewardCoins: 120,
  },
  {
    id: "q-win", emoji: "🏆", title: "DAWN WALKER", sub: "Outlast all 7 nights — win once",
    target: 1, progress: (s) => s.wins, rewardXp: 300, rewardCoins: 250,
  },
];

function questsLoad(season: number): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_QUESTS);
    if (!raw) return [];
    const p = JSON.parse(raw) as { season?: number; claimed?: string[] };
    if (p.season !== season || !Array.isArray(p.claimed)) return [];
    return p.claimed;
  } catch { return []; }
}

function questsSave(season: number, claimed: string[]): string[] {
  if (typeof window === "undefined") return claimed;
  try { window.localStorage.setItem(LS_QUESTS, JSON.stringify({ season, claimed })); } catch { /* ignore */ }
  return claimed;
}

/* ---------------- reset countdown ---------------- */

function resetCountdown(): string {
  const now = new Date();
  const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = mid.getTime() - now.getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ChallengesPage() {
  const daily = useGame((s) => s.daily);
  const addBonusXp = useGame((s) => s.addBonusXp);
  const bankCoins = useGame((s) => s.bankCoins);
  const pushToast = useGame((s) => s.pushToast);
  const setScreen = useGame((s) => s.setScreen);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const lifeRescues = useGame((s) => s.lifeRescues);
  const lifeVotes = useGame((s) => s.lifeVotes);
  const lifeCaught = useGame((s) => s.lifeCaught);
  const wins = useGame((s) => s.wins);
  const bestScore = useGame((s) => s.bestScore);

  const [countdown, setCountdown] = useState("");
  /* quest claims hydrate lazily — GameRoot is ssr:false so localStorage exists */
  const [claimedQuests, setClaimedQuests] = useState<ReadonlySet<string>>(() => new Set(questsLoad(1)));

  const doneCount = daily.tasks.filter((t) => t.done).length;
  const allDone = doneCount === daily.tasks.length && daily.tasks.length > 0;

  /* midnight countdown — deferred first tick like the lobby board */
  useEffect(() => {
    const tick = () => setCountdown(resetCountdown());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);

  /** claim a season quest — pays real XP + coins, once per season */
  const claimQuest = (q: SeasonQuest) => {
    if (q.progress({ runs: runsPlayed, rescues: lifeRescues, votes: lifeVotes, caught: lifeCaught, wins, best: bestScore }) < q.target) return;
    sfx.pickup();
    if (q.rewardCoins > 0) bankCoins(q.rewardCoins);
    if (q.rewardXp > 0) addBonusXp(q.rewardXp);
    pushToast(`🎯 Quest complete — ${q.emoji} +${q.rewardXp} XP & $${q.rewardCoins}!`, "good");
    setClaimedQuests(new Set(questsSave(1, [...claimedQuests, q.id])));
  };

  return (
    <PageShell
      title="CHALLENGES"
      emoji="🎯"
      subtitle="Daily tasks, season quests and streak rewards — everything feeds the pass."
      screen="challenges"
    >
      <AdCarousel placement="challenges" />

      {/* ---------- streak + daily header ---------- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <section className="relative overflow-hidden rounded-2xl border border-orange-300/30 bg-gradient-to-br from-orange-950/80 via-slate-950/85 to-slate-950/85 p-4 shadow-lg backdrop-blur">
          <Flame size={72} className="absolute -right-3 -top-3 text-orange-500/15" aria-hidden />
          <div className="text-[9px] font-black uppercase tracking-[0.16em] text-orange-300/80">login streak</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black italic tabular-nums text-white">{daily.streak}</span>
            <span className="text-xs font-black uppercase text-orange-200/80">day{daily.streak === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-1 text-[10px] font-bold text-white/55">best: {daily.bestStreak} · keep the 🔥 alive, bonuses stack</div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-yellow-300/30 bg-gradient-to-br from-yellow-950/70 via-slate-950/85 to-slate-950/85 p-4 shadow-lg backdrop-blur">
          <Target size={72} className="absolute -right-3 -top-3 text-yellow-400/15" aria-hidden />
          <div className="text-[9px] font-black uppercase tracking-[0.16em] text-yellow-300/80">today&apos;s board</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black italic tabular-nums text-white">{doneCount}</span>
            <span className="text-xs font-black uppercase text-yellow-200/80">/ {daily.tasks.length} done</span>
          </div>
          <div className="mt-1 text-[10px] font-bold text-white/55">
            {allDone ? "🎉 perfect board — bonus paid" : `all 3 done → +${ALL_DONE_BONUS} bonus XP`}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-teal-300/30 bg-gradient-to-br from-teal-950/70 via-slate-950/85 to-slate-950/85 p-4 shadow-lg backdrop-blur">
          <Zap size={72} className="absolute -right-3 -top-3 text-teal-400/15" aria-hidden />
          <div className="text-[9px] font-black uppercase tracking-[0.16em] text-teal-300/80">daily reset in</div>
          <div className="mt-1 text-4xl font-black italic tabular-nums text-white">{countdown || "…"}</div>
          <div className="mt-1 text-[10px] font-bold text-white/55">a fresh board rolls at midnight — local time</div>
        </section>
      </div>

      {/* ---------- daily tasks ---------- */}
      <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
        <Strip right={<span className="flex items-center gap-1 text-[10px] font-black text-white/85"><Flame size={11} /> {daily.streak}-day streak</span>}>
          Daily challenges
        </Strip>
        <div className="space-y-2 p-3">
          {daily.tasks.map((t) => {
            const def = DAILY_TASK_POOL.find((d) => d.id === t.id);
            const pct = Math.min(1, t.progress / t.target);
            return (
              <div
                key={t.id}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  t.done ? "border-emerald-300/45 bg-emerald-400/10" : "border-white/12 bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/35 text-lg ring-1 ring-white/15">
                    {t.done ? "✅" : (def?.emoji ?? "🎯")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-black text-white/90">{def?.label(t.target) ?? t.id}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <XpBar pct={t.done ? 1 : pct} bar="from-emerald-400 to-yellow-300" h="h-1.5" />
                      <span className="w-16 shrink-0 text-right text-[10px] font-black tabular-nums text-white/55">
                        {Math.min(Math.floor(t.progress), t.target)}/{t.target}
                      </span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${t.done ? "bg-emerald-400/25 text-emerald-200" : "bg-yellow-300/15 text-yellow-200"}`}>
                    {t.done ? "done" : `+${t.xp} XP`}
                  </span>
                </div>
              </div>
            );
          })}
          <div className={`rounded-xl border px-3 py-2.5 text-[11px] font-bold ${
            allDone ? "border-fuchsia-300/45 bg-fuchsia-400/10 text-fuchsia-200" : "border-white/12 bg-white/5 text-white/60"
          }`}>
            {allDone
              ? "🎉 All tasks cleared — the +100 XP bonus is paid. The next board rolls in " + (countdown || "…") + "."
              : `Finish all ${daily.tasks.length} for a +${ALL_DONE_BONUS} XP bonus · resets in ${countdown || "…"}`}
          </div>
        </div>
      </section>

      {/* ---------- season quests ---------- */}
      <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
        <Strip right={<span className="text-[10px] font-black text-white/85">claim once · rewards are real</span>}>
          Season quests — scored on your career
        </Strip>
        <div className="grid grid-cols-1 gap-2.5 p-3 md:grid-cols-2">
          {SEASON_QUESTS.map((q) => {
            const prog = q.progress({ runs: runsPlayed, rescues: lifeRescues, votes: lifeVotes, caught: lifeCaught, wins, best: bestScore });
            const pct = Math.min(1, prog / q.target);
            const complete = prog >= q.target;
            const claimed = claimedQuests.has(q.id);
            return (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16 }}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  claimed ? "border-emerald-300/45 bg-emerald-400/10" : complete ? "border-yellow-300/60 bg-yellow-400/10 shadow-[0_0_16px_rgba(253,224,71,0.25)]" : "border-white/12 bg-white/5"
                }`}
              >
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/35 text-xl ring-1 ring-white/15">
                  {claimed ? "✅" : complete ? "🎁" : q.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-black uppercase tracking-wide text-white/90">{q.title}</span>
                  </div>
                  <div className="truncate text-[10px] font-bold text-white/55">{q.sub}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <XpBar pct={claimed ? 1 : pct} bar={complete ? "from-yellow-300 to-amber-400" : "from-orange-400 to-rose-400"} h="h-1.5" />
                    <span className="w-16 shrink-0 text-right text-[10px] font-black tabular-nums text-white/55">
                      {Math.min(Math.floor(prog), q.target).toLocaleString()}/{q.target.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="whitespace-nowrap rounded-full bg-yellow-300/15 px-2 py-0.5 text-[10px] font-black text-yellow-200">+{q.rewardXp} XP</div>
                  <div className="mt-1 whitespace-nowrap rounded-full bg-orange-300/15 px-2 py-0.5 text-[10px] font-black text-orange-200">+${q.rewardCoins}</div>
                  {complete && !claimed ? (
                    <button
                      onClick={() => claimQuest(q)}
                      className="mt-1.5 rounded-full bg-yellow-400 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-950 shadow-[0_2px_0_rgba(161,98,7,0.55)] transition-transform hover:scale-105 active:scale-95"
                    >
                      claim
                    </button>
                  ) : claimed ? (
                    <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-black uppercase text-emerald-300"><Check size={11} strokeWidth={3} /> done</div>
                  ) : (
                    <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-black uppercase text-white/35"><Lock size={10} /> in progress</div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ---------- suggested ---------- */}
      <section className="overflow-hidden rounded-md border border-white/12 bg-slate-950/80 shadow-lg backdrop-blur-md">
        <Strip>Suggested for tonight</Strip>
        <div className="space-y-1.5 p-2.5">
          <button
            onClick={() => { sfx.click(); setScreen("landing"); }}
            className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-yellow-300/40 hover:bg-white/10"
          >
            <span aria-hidden className="text-lg">🏆</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/90">Win a run — outlast all 7 nights</span>
            <span className="shrink-0 rounded-full bg-yellow-300/15 px-2 py-0.5 text-[10px] font-black text-yellow-200">+120 XP</span>
            <ChevronRight size={14} className="shrink-0 text-white/40" />
          </button>
          <button
            onClick={() => { sfx.click(); setScreen("lobby"); }}
            className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-teal-300/40 hover:bg-white/10"
          >
            <Users size={17} className="shrink-0 text-teal-300" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/90">Play a night with a friend — host or quick join</span>
            <span className="shrink-0 rounded-full bg-teal-300/15 px-2 py-0.5 text-[10px] font-black text-teal-200">+50 XP</span>
            <ChevronRight size={14} className="shrink-0 text-white/40" />
          </button>
          <button
            onClick={() => { sfx.click(); setScreen("battlepass"); }}
            className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-fuchsia-300/40 hover:bg-white/10"
          >
            <Sparkles size={16} className="shrink-0 text-fuchsia-300" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/90">Spend today&apos;s XP — tiers are waiting on the pass</span>
            <span className="shrink-0 rounded-full bg-fuchsia-300/15 px-2 py-0.5 text-[10px] font-black text-fuchsia-200">rewards</span>
            <ChevronRight size={14} className="shrink-0 text-white/40" />
          </button>
        </div>
      </section>
    </PageShell>
  );
}
