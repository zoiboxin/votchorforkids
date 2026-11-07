"use client";

import { Trophy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGame, type ScoreRow } from "./store";

/** 🏆 Hall of Fame — global top runs (API-backed). Shown in the profile
 *    dialog and on the multiplayer lobby screen. */
export function Leaderboard({ compact = false }: { compact?: boolean }) {
  const scores = useGame((s) => s.scores);
  return (
    <div className="rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-center gap-2 font-black text-yellow-300">
        <Trophy size={16} /> Hall of Fame
      </div>
      {scores.length === 0 ? (
        <div className="text-sm text-white/60">No runs yet — be the first legend!</div>
      ) : (
        <ScrollArea className={compact ? "h-36" : "h-48"}>
          <div className="pr-2">
            {scores.map((s: ScoreRow, i: number) => (
              <div key={s.id} className="flex items-center gap-2 border-b border-white/10 py-1.5 text-sm text-white last:border-0">
                <span className={`w-6 text-center font-black ${i === 0 ? "text-yellow-300" : i === 1 ? "text-slate-200" : i === 2 ? "text-amber-600" : "text-white/50"}`}>
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-bold">{s.name}</span>
                {s.won && <span title="Survived the 7 nights">🏆</span>}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-black text-yellow-200">{s.points}</span>
                <span className="w-10 text-right text-xs text-white/50">{Math.round(s.timeMs / 1000)}s</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
