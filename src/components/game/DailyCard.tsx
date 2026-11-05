"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, Flame, PartyPopper } from "lucide-react";
import { DAILY_TASK_POOL, ALL_DONE_BONUS } from "@/lib/game/daily";
import { useGame } from "./store";

/** how long until the local-midnight rollover, as "5h 12m" */
function resetCountdown(): string {
  const now = new Date();
  const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = mid.getTime() - now.getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** 📅 Daily tasks + 🔥 streak board — lives on the landing page, in the profile
 *    and in career stats. Progress comes from finished runs (any side). */
export function DailyCard({ className = "" }: { className?: string }) {
  const daily = useGame((s) => s.daily);
  const ensureDailyToday = useGame((s) => s.ensureDailyToday);
  const [countdown, setCountdown] = useState("");

  // roll the board at local midnight even if the page stays open (countdown
  // refreshes on the same timer — async so the effect body stays setState-free)
  useEffect(() => {
    ensureDailyToday();
    const tick = () => { ensureDailyToday(); setCountdown(resetCountdown()); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [ensureDailyToday]);

  const doneCount = daily.tasks.filter((t) => t.done).length;
  const allDone = doneCount === daily.tasks.length;

  return (
    <div className={`rounded-2xl border border-emerald-300/25 bg-black/40 p-4 backdrop-blur-md ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-black text-emerald-300">
          <CalendarDays size={16} /> Daily tasks
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-black tabular-nums text-emerald-200">
            {doneCount}/{daily.tasks.length}
          </span>
        </div>
        {/* 🔥 streak flame — burns brighter the longer the chain */}
        <motion.div
          key={daily.streak}
          initial={{ scale: 1.35 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 16 }}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
            daily.streak > 0 ? "bg-orange-500/20 text-orange-200" : "bg-white/10 text-white/60"
          }`}
          title={daily.streak > 0 ? `Best streak: ${daily.bestStreak} days` : "Finish a run today to start a streak!"}
        >
          <Flame size={14} className={daily.streak >= 3 ? "animate-pulse text-orange-300" : "text-orange-200/80"} />
          {daily.streak > 0 ? `${daily.streak}-day streak` : "No streak yet"}
        </motion.div>
      </div>

      <div className="space-y-2">
        {daily.tasks.map((t) => {
          const def = DAILY_TASK_POOL.find((d) => d.id === t.id);
          const emoji = def?.emoji ?? "🎯";
          const label = def?.label(t.target) ?? t.id;
          const pct = Math.min(100, Math.round((t.progress / t.target) * 100));
          return (
            <div key={t.id} className={`rounded-xl border p-2.5 ${t.done ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex items-center gap-2 text-xs font-bold text-white/90">
                <span aria-hidden className="text-base leading-none">{t.done ? "✅" : emoji}</span>
                <span className={`min-w-0 flex-1 truncate ${t.done ? "text-emerald-200" : ""}`}>{label}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${t.done ? "bg-emerald-400/25 text-emerald-200" : "bg-yellow-300/15 text-yellow-200"}`}>
                  {t.done ? "done!" : `+${t.xp} XP`}
                </span>
              </div>
              {!t.done && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-yellow-300"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[10px] font-black tabular-nums text-white/55">
                    {Math.floor(t.progress)}/{t.target}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-white/45">
        {allDone ? (
          <span className="flex items-center gap-1 font-black text-fuchsia-200">
            <PartyPopper size={12} /> All done — bonus XP paid! See you tomorrow!
          </span>
        ) : (
          <span>Finish all 3 for a <b className="text-yellow-200">+{ALL_DONE_BONUS} XP</b> bonus</span>
        )}
        <span>resets in {countdown}</span>
      </div>
    </div>
  );
}
