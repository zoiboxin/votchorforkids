/** 7Nights — career rank ladder. XP = total points earned across every run. */

export interface Rank {
  id: string;
  name: string;
  emoji: string;
  /** minimum career XP to hold this rank */
  min: number;
  /** tailwind classes for the badge */
  chip: string;
  text: string;
  bar: string;
}

export const RANKS: readonly Rank[] = [
  { id: "rookie",  name: "Rookie Runner",     emoji: "🥚", min: 0,    chip: "from-stone-400/40 to-stone-600/40",   text: "text-stone-200",  bar: "from-stone-400 to-stone-300" },
  { id: "bronze",  name: "Bronze Sprinter",   emoji: "🥉", min: 300,  chip: "from-amber-700/50 to-amber-900/50",   text: "text-amber-300",  bar: "from-amber-600 to-amber-400" },
  { id: "silver",  name: "Silver Chaser",     emoji: "🥈", min: 800,  chip: "from-slate-300/40 to-slate-500/40",   text: "text-slate-100",  bar: "from-slate-300 to-slate-200" },
  { id: "gold",    name: "Gold Hero",         emoji: "🥇", min: 1600, chip: "from-yellow-400/50 to-amber-600/50",  text: "text-yellow-300", bar: "from-yellow-400 to-amber-300" },
  { id: "diamond", name: "Diamond Dash",      emoji: "💎", min: 3000, chip: "from-teal-300/45 to-emerald-500/45",  text: "text-teal-200",   bar: "from-teal-300 to-emerald-300" },
  { id: "legend",  name: "Night Legend", emoji: "🏆", min: 5000, chip: "from-fuchsia-500/45 to-rose-600/45",  text: "text-fuchsia-200",bar: "from-fuchsia-400 to-rose-400" },
] as const;

export interface RankInfo {
  rank: Rank;
  next: Rank | null;
  /** 0..1 progress into the current rank tier */
  progress: number;
  /** XP still needed for the next rank (0 when maxed) */
  toNext: number;
}

export function rankFor(xp: number): RankInfo {
  const v = Math.max(0, Math.floor(xp || 0));
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (v >= RANKS[i].min) idx = i;
  const rank = RANKS[idx];
  const next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;
  const progress = next ? Math.min(1, (v - rank.min) / (next.min - rank.min)) : 1;
  return { rank, next, progress, toNext: next ? next.min - v : 0 };
}

/** Rank right above — used for "how much to rank up" hints. */
export function nextRankName(xp: number): string | null {
  return rankFor(xp).next?.name ?? null;
}
