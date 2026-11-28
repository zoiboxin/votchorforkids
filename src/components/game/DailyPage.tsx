"use client";

/**
 * DailyPage — the full-page 📅 DAILY CHALLENGES BOARD (the Item-Shop pattern).
 *
 * The lobby's old pop-open daily card, expanded into a proper page: the three
 * rolled tasks of the day with animated progress bars and XP chips, the streak
 * furnace (current / best with a per-second reset countdown), the all-done
 * bonus banner and the "how it works" walkthrough. Everything reads the same
 * deterministic local-day board the game feeds run results into.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, Flame, Gift, Info, Sparkles, Trophy } from "lucide-react";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";
import { ALL_DONE_BONUS, DAILY_TASK_POOL } from "@/lib/game/daily";
import { PageShell, Panel, Strip, XpBar } from "./PageKit";

/** live "resets in 5h 12m 09s" — rolls the board at the player's own midnight */
function useResetCountdown(): string {
  const [text, setText] = useState("…");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ms = mid.getTime() - now.getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setText(h > 0 ? `${h}h ${m}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

export function DailyPage() {
  const daily = useGame((s) => s.daily);
  const ensureDailyToday = useGame((s) => s.ensureDailyToday);
  const setScreen = useGame((s) => s.setScreen);
  const resetIn = useResetCountdown();

  /* keep the board fresh while the page is open (midnight rollover) */
  useEffect(() => {
    const id = setInterval(() => ensureDailyToday(), 30_000);
    return () => clearInterval(id);
  }, [ensureDailyToday]);

  const doneCount = daily.tasks.filter((t) => t.done).length;
  const allDone = doneCount === daily.tasks.length;

  /** the other task ids in the pool — "tomorrow's pool" teaser */
  const poolRest = useMemo(
    () => DAILY_TASK_POOL.filter((d) => !daily.tasks.some((t) => t.id === d.id)).slice(0, 4),
    [daily.tasks],
  );

  return (
    <PageShell
      title="DAILY CHALLENGES"
      emoji="📅"
      subtitle="Three fresh tasks every night — finish the board, grow the streak, bank the bonus."
      screen="daily"
    >
      {/* ---------- streak furnace hero ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative overflow-hidden rounded-2xl border border-orange-400/30 shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
      >
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-orange-950/90 via-slate-950/92 to-rose-950/85" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(249,115,22,0.28),transparent_55%),radial-gradient(circle_at_8%_85%,rgba(244,63,94,0.2),transparent_50%)]" />
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <motion.span
            aria-hidden
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-black/35 text-5xl ring-2 ring-orange-300/40"
            animate={{ scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            style={{ boxShadow: "0 0 34px rgba(249,115,22,0.45)" }}
          >
            🔥
          </motion.span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-orange-500/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200 ring-1 ring-orange-300/50">
                streak furnace
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/25">
                <CalendarClock size={11} /> resets in {resetIn}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-1">
              <div>
                <span className="text-5xl font-black italic leading-none text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.4)]">
                  {daily.streak}
                </span>
                <span className="ml-2 text-xs font-black uppercase tracking-wider text-orange-200">
                  day streak
                </span>
              </div>
              <div className="text-[11px] font-bold text-white/55">
                best <b className="text-white/90">{daily.bestStreak}</b> · lifetime tasks{" "}
                <b className="text-white/90">{daily.totalDone}</b>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-white/60">
              Any finished run lights the furnace — miss a day and it cools back to 1. Longer streaks, hotter bonuses.
            </p>
          </div>
        </div>
      </motion.section>

      {/* ---------- all-done bonus banner ---------- */}
      {allDone ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 rounded-xl border border-emerald-300/40 bg-emerald-400/10 px-4 py-3"
        >
          <CheckCircle2 size={20} className="shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1 text-xs font-black uppercase tracking-wide text-emerald-200">
            Board cleared — the +{ALL_DONE_BONUS} XP all-done bonus is banked for today
          </div>
          <span className="rounded-full bg-emerald-400/25 px-3 py-1 text-[10px] font-black text-emerald-100 ring-1 ring-emerald-300/50">
            +{ALL_DONE_BONUS} XP
          </span>
        </motion.div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-300/30 bg-yellow-400/10 px-4 py-3">
          <Gift size={20} className="shrink-0 text-yellow-300" />
          <div className="min-w-0 flex-1 text-xs font-black uppercase tracking-wide text-yellow-100">
            Clear all {daily.tasks.length} tasks for a flat +{ALL_DONE_BONUS} XP bonus
          </div>
          <span className="rounded-full bg-yellow-400/20 px-3 py-1 text-[10px] font-black text-yellow-100 ring-1 ring-yellow-300/50">
            {doneCount}/{daily.tasks.length}
          </span>
        </div>
      )}

      {/* ---------- the board ---------- */}
      <Panel>
        <Strip right={<span className="text-[10px] font-black text-white/85">{doneCount}/{daily.tasks.length} done</span>}>
          Today&apos;s board — {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </Strip>
        <div className="grid grid-cols-1 gap-2.5 p-3 lg:grid-cols-3">
          {daily.tasks.map((t, i) => {
            const def = DAILY_TASK_POOL.find((d) => d.id === t.id);
            const pct = Math.min(1, t.progress / t.target);
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.06 }}
                className={`flex flex-col rounded-xl border p-3.5 ${
                  t.done ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/12 bg-slate-950/80"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ring-1 ${
                      t.done ? "bg-emerald-400/15 ring-emerald-300/40" : "bg-black/35 ring-white/15"
                    }`}
                  >
                    {t.done ? "✅" : (def?.emoji ?? "🎯")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-black uppercase leading-snug tracking-wide text-white/90">
                      {def?.label(t.target) ?? t.id}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                          t.done ? "bg-emerald-400/25 text-emerald-200" : "bg-yellow-300/15 text-yellow-200"
                        }`}
                      >
                        {t.done ? "done" : `+${t.xp} XP`}
                      </span>
                      <span className="text-[10px] font-black tabular-nums text-white/50">
                        {Math.floor(t.progress)}/{t.target}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <XpBar pct={t.done ? 1 : pct} bar={t.done ? "from-emerald-400 to-emerald-300" : "from-amber-400 to-yellow-300"} h="h-2" />
                </div>
              </motion.div>
            );
          })}
        </div>
      </Panel>

      {/* ---------- how it works + tomorrow's pool ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <Strip right={<Info size={12} className="text-white/80" />}>How the board works</Strip>
          <div className="space-y-1.5 p-3 text-[11px] font-bold leading-relaxed text-white/70">
            <p>
              <b className="text-white/90">Rolls at YOUR midnight</b> — the same three tasks for everyone who loads the
              game on that date; a reload never re-rolls the board.
            </p>
            <p>
              <b className="text-white/90">Runs feed progress</b> — every finished night banks its loot, rescues, score
              and wins straight into the tasks.
            </p>
            <p>
              <b className="text-white/90">XP lands on the run recap</b> — task XP pays on top of the run score; the
              all-done bonus pays once per day.
            </p>
            <p>
              <b className="text-white/90">Streaks compound</b> — consecutive daily runs keep the 🔥 alive; the best
              streak lives on your career page forever.
            </p>
          </div>
        </Panel>
        <Panel>
          <Strip right={<span className="text-[10px] font-black text-white/85">rotating pool</span>}>
            In tomorrow&apos;s mix
          </Strip>
          <div className="space-y-1.5 p-3">
            {poolRest.map((d) => (
              <div key={d.id} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <span aria-hidden className="text-lg">{d.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/70">{d.label(d.target)}</span>
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-white/60">
                  +{d.xp} XP
                </span>
              </div>
            ))}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <button
                onClick={() => { sfx.click(); setScreen("challenges"); }}
                className="flex flex-1 items-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-[11px] font-bold text-white/85 transition-colors hover:border-yellow-300/40 hover:bg-white/10"
                aria-label="Open season challenges"
              >
                <Trophy size={15} className="shrink-0 text-yellow-300" /> Season quests
              </button>
              <button
                onClick={() => { sfx.click(); setScreen("suggested"); }}
                className="flex flex-1 items-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-[11px] font-bold text-white/85 transition-colors hover:border-teal-300/40 hover:bg-white/10"
                aria-label="Open suggested picks"
              >
                <Sparkles size={15} className="shrink-0 text-teal-300" /> Suggested for you
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* ---------- play CTA ---------- */}
      <button
        onClick={() => { sfx.pickup(); useGame.getState().quickPlay?.(); }}
        className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-yellow-400 py-4 text-base font-black uppercase tracking-wide text-slate-950 shadow-[0_6px_0_rgba(161,98,7,0.55)] transition-all hover:bg-yellow-300 active:translate-y-0.5 active:shadow-[0_3px_0_rgba(161,98,7,0.55)]"
        aria-label="Queue into tonight's run"
      >
        <Flame size={20} className="shrink-0" />
        Play tonight — feed the board
      </button>
    </PageShell>
  );
}
