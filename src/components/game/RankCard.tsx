"use client";

import { motion } from "framer-motion";
import { rankFor } from "@/lib/game/ranks";
import { useGame } from "./store";

/* Circular rank emblem with gradient + emoji */
export function RankBadge({ xp, size = 44 }: { xp: number; size?: number }) {
  const { rank } = rankFor(xp);
  return (
    <div
      aria-label={`Rank: ${rank.name}`}
      className={`flex shrink-0 items-center justify-center rounded-full border-2 border-white/30 bg-gradient-to-br shadow-lg ${rank.chip}`}
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      <span aria-hidden>{rank.emoji}</span>
    </div>
  );
}

/* Progress bar from current rank to the next one */
export function RankProgress({ xp }: { xp: number }) {
  const { rank, next, progress, toNext } = rankFor(xp);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide">
        <span className={rank.text}>{rank.name}</span>
        <span className="text-white/60">{next ? `${toNext} XP → ${next.emoji} ${next.name}` : "MAX RANK 👑"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/15">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${rank.bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(progress * 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

/* Full rank card (landing + stats modal) */
export function RankCard({ className = "" }: { className?: string }) {
  const careerXp = useGame((s) => s.careerXp);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const bestScore = useGame((s) => s.bestScore);
  const { rank, progress } = rankFor(careerXp);

  return (
    <div className={`rounded-2xl border border-white/20 bg-black/40 p-4 backdrop-blur-md ${className}`}>
      <div className="flex items-center gap-3">
        <RankBadge xp={careerXp} size={52} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-black ${rank.text}`}>{rank.name}</div>
          <div className="text-[11px] font-bold text-white/60">
            {careerXp.toLocaleString()} career XP · {runsPlayed} run{runsPlayed === 1 ? "" : "s"} · best {bestScore.toLocaleString()}
          </div>
          <div className="mt-1.5">
            <RankProgress xp={careerXp} />
          </div>
        </div>
      </div>
      {progress >= 1 && (
        <div className="mt-2 text-center text-[11px] font-black text-fuchsia-200">
          👑 Top rank reached — you are a 7Nights legend!
        </div>
      )}
    </div>
  );
}
