/**
 * 7Nights — BATTLE PASS · the season reward track.
 *
 * A PUBG / Fortnite-style seasonal ladder: 50 tiers, each with a FREE reward
 * and a PREMIUM reward. Tier progression is driven by career XP (every point
 * banked in a run + every daily/quest XP counts, forever) — so the pass reads
 * your REAL save data, no fake counters.
 *
 * Claims & the premium unlock persist in localStorage:
 *   votechor_bp_v1 = { season, claimed: string[], }   (premium = owned[] via wallet)
 * Claiming pays REAL rewards: 💰 coins through the wallet, ⭐ XP through the
 * profile bonus pool — the same pipes the daily board uses.
 */

export const BP_PREMIUM_ITEM_ID = "bp-premium";
export const BP_PREMIUM_PRICE = 999;
/** XP needed to unlock one tier */
export const XP_PER_TIER = 200;
export const BP_TIERS_COUNT = 50;

/* ---------------- seasons ---------------- */

/** stable quarterly season number (SEASON 1 starts Jan 2025) — mirrors Landing */
export function seasonNo(d = new Date()): number {
  return 1 + (d.getFullYear() - 2025) * 4 + Math.floor(d.getMonth() / 3);
}

/** flavor name per season index — the pass keeps a name plate like the big BRs */
const SEASON_NAMES = [
  "CRIMSON MOON", "BLOOD HARVEST", "FROSTBITE", "ASHFALL",
  "HOLLOW LIGHTS", "GRAVEBLOOM", "NIGHTFALL PROTOCOL", "THE LAST DAWN",
] as const;

export interface SeasonWindow {
  no: number;
  name: string;
  label: string;          // "S7 · ASHFALL"
  start: Date;
  end: Date;
  daysLeft: number;
  /** local YYYY-MM-DD of the end — nice for the header chip */
  endsOn: string;
}

export function seasonWindow(d = new Date()): SeasonWindow {
  const no = seasonNo(d);
  const start = new Date(2025, 0, 1);
  // advance one quarter per season index
  start.setMonth(start.getMonth() + (no - 1) * 3);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 3);
  const msLeft = Math.max(0, end.getTime() - d.getTime());
  const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));
  const name = SEASON_NAMES[(no - 1) % SEASON_NAMES.length];
  return {
    no,
    name,
    label: `S${no} · ${name}`,
    start,
    end,
    daysLeft,
    endsOn: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
  };
}

/* ---------------- the reward track ---------------- */

export type BpRewardKind = "coins" | "xp" | "flair";

export interface BpReward {
  kind: BpRewardKind;
  /** payout amount (coins / xp) — flair rewards carry 0 */
  n: number;
  emoji: string;
  label: string;
  /** tailwind gradient for the reward tile wash */
  grad: string;
}

export interface BpTier {
  tier: number;
  /** career XP required to unlock this tier */
  xp: number;
  free: BpReward;
  premium: BpReward;
}

/** deterministic reward table — milestone tiers (×10) pay out big */
const COINS_LADDER = [40, 60, 80, 100, 120, 150];
const COIN_GRADS = [
  "from-yellow-400/85 to-amber-500/85",
  "from-amber-500/85 to-orange-500/85",
  "from-orange-500/85 to-rose-500/85",
];
const XP_GRADS = [
  "from-emerald-500/85 to-teal-500/85",
  "from-teal-500/85 to-cyan-500/85",
  "from-sky-500/85 to-indigo-500/85",
];
const FLAIRS: readonly { emoji: string; label: string }[] = [
  { emoji: "🎃", label: "Pumpkin Halo" },
  { emoji: "🧟", label: "Graveling Aura" },
  { emoji: "🩸", label: "Crimson Trail" },
  { emoji: "🕶️", label: "Night Stalker Shades" },
  { emoji: "🎒", label: "Survivor Pack Skin" },
  { emoji: "🔥", label: "Ember Nameplate" },
  { emoji: "🦇", label: "Bat Swarm Finale" },
  { emoji: "💎", label: "Diamond Badge" },
  { emoji: "🕊️", label: "Dove of Dawn Emote" },
  { emoji: "👑", label: "Legend Crown" },
  { emoji: "🧿", label: "Ward Charm" },
  { emoji: "🪦", label: "Headstone Emblem" },
];

function rewardFor(tier: number, premium: boolean): BpReward {
  const milestone = tier % 10 === 0 || tier === 50;
  // deterministic spread: coins → xp → flair cycling, milestones pay BIG
  const slot = tier % 4;
  if (milestone) {
    const coins = 250 + tier * 15;
    return premium
      ? { kind: "coins", n: coins * 2, emoji: "💰", label: `${coins * 2} cash jackpot`, grad: "from-yellow-300/90 to-amber-600/90" }
      : { kind: "xp", n: 100 + tier * 4, emoji: "⭐", label: `${100 + tier * 4} bonus XP`, grad: "from-emerald-400/90 to-teal-600/90" };
  }
  if (slot === 0) {
    const c = COINS_LADDER[tier % COINS_LADDER.length] + (premium ? 60 : 0);
    return { kind: "coins", n: c, emoji: "💰", label: `${c} cash`, grad: COIN_GRADS[tier % COIN_GRADS.length] };
  }
  if (slot === 1 || slot === 3) {
    const x = (premium ? 90 : 45) + Math.floor(tier / 2) * 5;
    return { kind: "xp", n: x, emoji: "⭐", label: `${x} bonus XP`, grad: XP_GRADS[tier % XP_GRADS.length] };
  }
  const f = FLAIRS[(tier + (premium ? 6 : 0)) % FLAIRS.length];
  return { kind: "flair", n: 0, emoji: f.emoji, label: premium ? `${f.label} · Gold` : f.label, grad: premium ? "from-fuchsia-500/85 to-rose-600/85" : "from-violet-500/85 to-purple-600/85" };
}

export const BP_TIERS: readonly BpTier[] = Array.from({ length: BP_TIERS_COUNT }, (_, i) => {
  const tier = i + 1;
  const xp = tier * XP_PER_TIER;
  return { tier, xp, free: rewardFor(tier, false), premium: rewardFor(tier, true) };
});

/* ---------------- claim state (localStorage) ---------------- */

const LS_BP = "votechor_bp_v1";

export interface BpSave { season: number; claimed: string[] }

const FRESH_BP: BpSave = { season: 0, claimed: [] };

/** safe localStorage access — the game wraps it, but a direct read keeps this module dependency-free */
function bpLoad(): BpSave {
  if (typeof window === "undefined") return { ...FRESH_BP };
  try {
    const raw = window.localStorage.getItem(LS_BP);
    if (!raw) return { ...FRESH_BP };
    const p = JSON.parse(raw) as BpSave;
    return { season: Number(p.season) || 0, claimed: Array.isArray(p.claimed) ? p.claimed : [] };
  } catch { return { ...FRESH_BP }; }
}

function bpStore(s: BpSave) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_BP, JSON.stringify(s)); } catch { /* ignore */ }
}

/** claim key: "f12" = free tier 12 · "p30" = premium tier 30 · "q<id>" = quest */
export const claimKey = (track: "f" | "p", tier: number) => `${track}${tier}`;

/** claims roll with the season — a fresh season wipes the board */
export function bpClaims(season: number): string[] {
  const s = bpLoad();
  if (s.season !== season) {
    bpStore({ season, claimed: [] });
    return [];
  }
  return s.claimed;
}

export function bpMarkClaimed(season: number, key: string): string[] {
  const s = bpLoad();
  const claimed = s.season === season && !s.claimed.includes(key) ? [...s.claimed, key] : [key];
  bpStore({ season, claimed });
  return claimed;
}
