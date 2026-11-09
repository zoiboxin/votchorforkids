/** 7Nights — daily tasks & streaks.
 *
 *  Every local day the game picks 3 tasks (deterministic from the date, so a
 *  reload never re-rolls them). Finishing runs feeds progress into the tasks;
 *  each completed task pays bonus XP on top of the run score, and finishing
 *  all 3 pays a flat streak-fuelled bonus. Playing on consecutive days grows
 *  the 🔥 streak — skip a day and it resets to 1 on your next run.
 */

export interface DailyTaskDef {
  id: string;
  emoji: string;
  /** label with the target filled in */
  label: (n: number) => string;
  target: number;
  /** bonus XP paid on completion */
  xp: number;
}

export const DAILY_TASK_POOL: readonly DailyTaskDef[] = [
  { id: "votes",   emoji: "💰", label: (n) => `Bank $${n} — scoop 💰 cash piles & loot the fallen`, target: 150, xp: 80 },
  { id: "rescues", emoji: "❤", label: (n) => `Rescue ${n} bubbled friends`,              target: 5,   xp: 70 },
  { id: "runs",    emoji: "🏃", label: (n) => `Finish ${n} runs`,                         target: 3,   xp: 50 },
  { id: "score",   emoji: "⭐", label: (n) => `Bank ${n.toLocaleString()} points`,        target: 1500, xp: 90 },
  { id: "snacks",  emoji: "🍎", label: (n) => `Munch ${n} snacks`,                        target: 5,   xp: 60 },
  { id: "powers",  emoji: "✨", label: (n) => `Unleash ${n} super powers`,                target: 2,   xp: 60 },
  { id: "win",     emoji: "🏆", label: () => `Win a run — outlast all 7 nights or be the last one standing`, target: 1, xp: 120 },
] as const;

/** flat bonus for completing all 3 tasks of the day */
export const ALL_DONE_BONUS = 100;

export interface DailyTaskState {
  id: string;
  progress: number;
  /** target snapshot from the pool when the day rolled */
  target: number;
  xp: number;
  done: boolean;
}

export interface DailyState {
  /** local-day key the current task set belongs to (YYYY-MM-DD) */
  day: string;
  tasks: DailyTaskState[];
  /** consecutive days with at least one finished run (today counts once recorded) */
  streak: number;
  bestStreak: number;
  /** last local-day key a run was recorded on */
  lastPlayedDay: string | null;
  /** the +100 all-done bonus already paid today */
  bonusToday: boolean;
  /** lifetime completed-task count (for career stats) */
  totalDone: number;
}

/** Local-day key — daily tasks roll over at the player's own midnight. */
export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayKey(): string {
  return dayKey(new Date(Date.now() - 86_400_000));
}

/** stable little string hash — the same date must always roll the same tasks */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function freshDaily(today = dayKey()): DailyState {
  // pick 3 distinct tasks deterministically from the date seed
  const seed = hash(`7nights-${today}`);
  const idx: number[] = [];
  let x = seed;
  while (idx.length < 3) {
    x = (Math.imul(x, 48271) + 11) >>> 0; // LCG step — cheap and stable
    const pick = x % DAILY_TASK_POOL.length;
    if (!idx.includes(pick)) idx.push(pick);
  }
  return {
    day: today,
    tasks: idx.map((i) => {
      const def = DAILY_TASK_POOL[i];
      return { id: def.id, progress: 0, target: def.target, xp: def.xp, done: false };
    }),
    streak: 0,
    bestStreak: 0,
    lastPlayedDay: null,
    bonusToday: false,
    totalDone: 0,
  };
}

/** Roll the task set if the local day changed — keeps streak/bookkeeping, zeroes progress. */
export function ensureDaily(state: DailyState | undefined | null): DailyState {
  const today = dayKey();
  if (state && state.day === today && Array.isArray(state.tasks) && state.tasks.length === 3) return state;
  const next = freshDaily(today);
  if (state) {
    next.streak = state.streak ?? 0;
    next.bestStreak = state.bestStreak ?? 0;
    next.lastPlayedDay = state.lastPlayedDay ?? null;
    next.totalDone = state.totalDone ?? 0;
    // bonusToday resets with the new task set
  }
  return next;
}

export interface DailyRunFacts {
  /** 💰 money banked this run (cash piles + loot from the fallen) */
  votes: number;
  /** runners busted by a police officer */
  busts: number;
  rescues: number;
  score: number;
  won: boolean;
  snacks: number;
  powers: number;
}

export interface DailyApplyResult {
  daily: DailyState;
  /** tasks completed by THIS run (XP already accounted by the caller) */
  completed: DailyTaskDef[];
  /** true when this run completed the last of the 3 tasks (all-done bonus due) */
  allJustDone: boolean;
  /** streak value after this run (for the 🔥 toast) */
  streak: number;
  streakJustGrew: boolean;
}

/** Feed one finished run into the daily board: progress + streak + completion flags. */
export function applyRunToDaily(prevDaily: DailyState, run: DailyRunFacts): DailyApplyResult {
  const daily = ensureDaily(prevDaily);
  const today = daily.day;

  // 🔥 streak: first recorded run of a day either extends or restarts the chain
  let streakJustGrew = false;
  if (daily.lastPlayedDay !== today) {
    daily.streak = daily.lastPlayedDay === yesterdayKey() ? daily.streak + 1 : 1;
    daily.bestStreak = Math.max(daily.bestStreak, daily.streak);
    daily.lastPlayedDay = today;
    streakJustGrew = true;
  }

  // task progress — "bank money" counts the cash you scooped & looted
  const byId: Record<string, number> = {
    votes: (run.votes || 0) + (run.busts || 0),
    rescues: run.rescues || 0,
    runs: 1,
    score: run.score || 0,
    snacks: run.snacks || 0,
    powers: run.powers || 0,
    win: run.won ? 1 : 0,
  };

  const completed: DailyTaskDef[] = [];
  for (const t of daily.tasks) {
    if (t.done) continue;
    const gain = byId[t.id] ?? 0;
    if (gain <= 0) continue;
    t.progress = Math.min(t.target, t.progress + gain);
    if (t.progress >= t.target) {
      t.done = true;
      daily.totalDone++;
      completed.push(DAILY_TASK_POOL.find((d) => d.id === t.id)!);
    }
  }

  const allJustDone = !daily.bonusToday && daily.tasks.every((t) => t.done);
  if (allJustDone) daily.bonusToday = true;

  return { daily, completed, allJustDone, streak: daily.streak, streakJustGrew };
}
