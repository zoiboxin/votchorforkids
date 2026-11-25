import { clamp } from "./rng";

/* ---------------- 🧠 the bots are WATCHING you — a learning brain ----------------
 *
 * Every street fight teaches the town something. This module watches how the
 * REAL player fights — accuracy, aggression, how often they get floored, how
 * many bots they put down — and distills it into a 0..1 SKILL score the AI
 * plugs into its reactions:
 *
 *   • brave rolls      — how many bots dare square up instead of bolting
 *   • retaliation      — chase range, pursuit speed, aim-lead, dodge rate
 *   • punch cadence    — sharp bots swing on a shorter beat
 *   • discipline       — skilled bots retreat later (they trust their guard)
 *
 * The score blends the LIVE session (what you did this match) with a slow
 * cross-session memory saved to localStorage — lose five matches in a row and
 * the whole town fights a little softer next time; go on a win streak and the
 * bots remember you as the undefeated street legend and get meaner. Bots also
 * earn PERSONAL xp mid-fight (see engine stepBotRetaliate) — a bot that lands
 * punches on you or survives your car literally learns on the job.
 *
 * This is the "bots learn from real players and improve themselves" loop —
 * no servers, no training set, just a kid-shaped opponent model that grows.
 */

const KEY = "votechor_botbrain_v2";

/** 📊 one live session of observed player behaviour (reset each match) */
const session = { attacks: 0, hits: 0, taken: 0, dodges: 0, downs: 0, kills: 0, runS: 0 };

/** 🧠 slow cross-session memory of how dangerous this player is (0..1) */
let ema = 0.22;
let runs = 0;
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as { ema?: number; runs?: number };
    if (typeof s.ema === "number") ema = clamp(s.ema, 0.05, 0.95);
    if (typeof s.runs === "number") runs = Math.max(0, Math.min(500, s.runs));
  } catch { /* private mode / quota — bots just start naive */ }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ema, runs: Math.min(500, runs) } satisfies { ema: number; runs: number }));
  } catch { /* ignore */ }
}

export type BrainEvent =
  | "attack"  // the player took a swing (whiffs count — accuracy matters)
  | "hit"     // the player's swing CONNECTED
  | "taken"   // the player took damage from a bot
  | "dodge"   // the player slipped out of a bot's punch
  | "down"    // the player got knocked flat (car / big punch)
  | "kill";   // the player put a bot down for good

export const botBrain = {
  /** 🎬 a fresh match — wipe the live observation counters (memory persists) */
  session(): void {
    session.attacks = 0; session.hits = 0; session.taken = 0;
    session.dodges = 0; session.downs = 0; session.kills = 0; session.runS = 0;
    load();
  },

  /** 📝 record one observed player action — called from the engine's combat sites */
  record(kind: BrainEvent): void {
    session[kind === "attack" ? "attacks" : kind === "hit" ? "hits" : kind === "taken" ? "taken" : kind === "dodge" ? "dodges" : kind === "down" ? "downs" : "kills"]++;
  },

  /** ⏱️ per-frame clock — how far into the match we are (weights the live blend) */
  tick(dt: number): void {
    session.runS += dt;
  },

  /**
   * The current skill model of the player, 0..1.
   *  acc  — swing accuracy this match (hits / swings)
   *  aggr — how much punishment they dished out (normalized)
   *  surv — how rarely they got floored
   * Blended with the cross-session EMA; early in a match the memory carries
   * more weight until the live evidence accumulates (~90 s to full trust).
   */
  skill(): number {
    const attacks = Math.max(1, session.attacks);
    const acc = session.attacks >= 5 ? clamp(session.hits / attacks, 0, 1) : 0.4;
    const aggr = clamp(session.hits / 20, 0, 1);
    const surv = clamp(1 - session.downs / 4, 0, 1);
    const fresh = clamp(0.34 * acc + 0.4 * aggr + 0.26 * surv, 0, 1);
    const w = clamp(session.runS / 90, 0.25, 1); // live evidence gains trust over time
    return clamp(fresh * w + ema * (1 - w), 0.05, 0.96);
  },

  /** 😤 how many bots dare to fight back when hit (adds to the base brave roll) */
  braveBonus(): number {
    return botBrain.skill() * 0.22;
  },

  /** 🏃 chase range a grudge survives (u) — sharp players get hunted further */
  chaseRange(): number {
    return 20 + 14 * botBrain.skill(); // was a flat 26
  },

  /** 🩸 hp under which a bot cuts its losses and bolts — sharp bots last longer */
  fleeHp(): number {
    return 9 + 13 * botBrain.skill(); // was a flat 12
  },

  /** 🥊 punch cooldown multiplier — students of the street swing tighter */
  punchCdMult(): number {
    return 1.12 - 0.3 * botBrain.skill(); // 1.12× for a green player → 0.82× for a legend
  },

  /** 🌀 chance a bot sidesteps while the player's swing is winding up */
  dodgeP(): number {
    return 0.1 + 0.45 * botBrain.skill();
  },

  /** 📈 commit the match's lesson into the long-term memory (call on match end + autosave) */
  flush(): void {
    const s = botBrain.skill();
    ema = clamp(ema * 0.72 + s * 0.28, 0.05, 0.95);
    runs += 1;
    save();
  },

  /** 🧪 debug peek — HUD/easter-egg surfaces can show how feared the player is */
  stats(): { skill: number; ema: number; runs: number; hits: number; taken: number } {
    return { skill: botBrain.skill(), ema, runs, hits: session.hits, taken: session.taken };
  },
};
