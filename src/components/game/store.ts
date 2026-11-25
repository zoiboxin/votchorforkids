"use client";

import { create } from "zustand";
import { defaultAppearance, normalizeAppearance, DEFAULT_HERO_SLUG, type Appearance } from "@/lib/game/constants";
import { glbCharDef } from "@/lib/game/glbCharacters";
import type { HudData } from "@/lib/game/engine";
import { DAILY_TASK_POOL, ALL_DONE_BONUS, applyRunToDaily, ensureDaily, freshDaily, type DailyState, type DailyRunFacts } from "@/lib/game/daily";
import { shopItem } from "@/lib/game/shop";
import { lsGet, lsRemove, lsSet } from "@/lib/game/storage";

export type Screen = "landing" | "profile" | "shop" | "battlepass" | "challenges" | "career" | "news" | "select" | "outfit" | "creator" | "connecting" | "lobby" | "matchlobby" | "play";
export interface Toast { msg: string; kind: "info" | "good" | "bad"; id: number }

export interface ScoreRow { id: string; name: string; points: number; votes: number; rescues: number; won: boolean; timeMs: number; createdAt: string }

export interface Settings {
  music: number; // 0..1
  sfx: number;   // 0..1
  showFps: boolean;
}

export interface PlayerStats { runs: number; best: number; votes: number; rescues: number; wins: number; caught: number; totalScore: number; playtimeMs: number }

/** One saved run (per-device). Newest first in store.history. */
export interface RunRecord {
  id: string;
  at: number;
  score: number;
  votes: number;
  rescues: number;
  caught: number;
  won: boolean;
  timeMs: number;
}

const LS_PROFILE = "votechor_profile_v3";
const LS_PROFILE_V2 = "votechor_profile_v2"; // migrated once, then rewritten as v3
const LS_SETTINGS = "votechor_settings_v2";
const HISTORY_CAP = 60;

/* ---------- 🛒 the wallet — banked cash + purchased items (own save slot) ----------
 * Kept separate from the big profile blob so run-end banking and shop buys
 * never rewrite the whole save. First boot seeds the coins from the money the
 * old profile already banked (stats.votes = "Money banked"). */
const LS_WALLET = "votechor_wallet_v1";

function loadWallet(): { coins: number; owned: string[] } {
  if (typeof window === "undefined") return { coins: 0, owned: [] };
  try {
    const raw = JSON.parse(lsGet(LS_WALLET) ?? "null");
    if (raw && typeof raw === "object") {
      return {
        coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
        owned: Array.isArray(raw.owned) ? raw.owned.filter((x: unknown) => typeof x === "string" && !!shopItem(x as string)) : [],
      };
    }
    // first wallet boot — carry over the cash the profile already banked
    const prof = JSON.parse(lsGet(LS_PROFILE) ?? lsGet(LS_PROFILE_V2) ?? "null") as { stats?: { votes?: number } } | null;
    return { coins: Math.max(0, Math.floor(Number(prof?.stats?.votes) || 0)), owned: [] };
  } catch { return { coins: 0, owned: [] }; }
}

function saveWallet(coins: number, owned: string[]) {
  if (typeof window === "undefined") return;
  try { lsSet(LS_WALLET, JSON.stringify({ coins: Math.max(0, Math.floor(coins)), owned })); } catch { /* ignore */ }
}

/* ---------- 🍪 cookie consent — gates the cloud profile sync ---------- */
const LS_CONSENT = "votechor_consent_v1";
const consentAccepted = (): boolean =>
  typeof window !== "undefined" && lsGet(LS_CONSENT) === "1";

/* ---------- ☁️ cloud profile sync — LOCAL-FIRST, minimal server load ----------
 * The game NEVER waits on the network: every mutation writes localStorage
 * instantly, then one DEBOUNCED upsert (4 s after the last change) pushes the
 * whole profile blob to /api/profile. A sendBeacon covers tab closes and the
 * profile is PULLED once per session on boot/login. The server stores exactly
 * one JSON row per player — no per-action chatter, no sync loops. */
let cloudTimer: ReturnType<typeof setTimeout> | null = null;
let cloudDirty = false;
let pullInFlight = false; // pushes yield while a pull is adopting the cloud copy

function profileStatsOf(s: {
  runsPlayed: number; bestScore: number; lifeVotes: number; lifeRescues: number;
  wins: number; lifeCaught: number; careerXp: number; bonusXp: number; playtimeMs: number;
}): PlayerStats {
  return {
    runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
    wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp - s.bonusXp, playtimeMs: s.playtimeMs,
  };
}

/** the full profile as ONE JSON blob (also the file the player downloads) */
function cloudBlob(s: {
  playerName: string; look: Appearance; history: RunRecord[]; bonusXp: number; daily: DailyState;
  coins: number; owned: string[]; runsPlayed: number; bestScore: number; lifeVotes: number;
  lifeRescues: number; wins: number; lifeCaught: number; careerXp: number; bonusXp: number; playtimeMs: number;
}): string {
  return JSON.stringify({
    name: s.playerName,
    look: s.look,
    stats: profileStatsOf(s),
    history: s.history.slice(0, HISTORY_CAP),
    bonusXp: s.bonusXp,
    daily: s.daily,
    coins: s.coins,
    owned: s.owned,
    savedAt: Date.now(),
  });
}

async function pushCloudNow() {
  cloudTimer = null;
  if (pullInFlight) { scheduleCloudSave(3000); return; } // never clobber a pull that is mid-adopt
  const s = useGame.getState();
  const name = s.playerName.trim();
  if (!name) { useGame.setState({ syncStatus: "idle" }); return; }
  cloudDirty = false;
  try {
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data: cloudBlob(s) }),
    });
    useGame.setState({ syncStatus: r.ok ? "saved" : "offline" });
  } catch {
    useGame.setState({ syncStatus: "offline" });
    cloudDirty = true; // retry lands on the next mutation
  }
  // "saved" glows for a beat, then the chip calms down
  setTimeout(() => {
    if (useGame.getState().syncStatus === "saved") useGame.setState({ syncStatus: "idle" });
  }, 2600);
}

/** schedule ONE debounced cloud upsert (call after any profile mutation) */
function scheduleCloudSave(delayMs = 4000) {
  cloudDirty = true;
  if (typeof window === "undefined" || !consentAccepted()) return; // consent gates the cloud
  if (!useGame.getState().playerName.trim()) return; // no account yet — nothing to sync
  useGame.setState({ syncStatus: "saving" });
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => { void pushCloudNow(); }, delayMs);
}

const freshStats = (): PlayerStats => ({ runs: 0, best: 0, votes: 0, rescues: 0, wins: 0, caught: 0, totalScore: 0, playtimeMs: 0 });

/** 🩹 a hero slug that isn't in the catalog (corrupt save, hand-edit, old
 *  test data) can never stream — normalize it back to the default Traveller
 *  so the lobby always has a survivor instead of the failure banner. */
function healHero(look: Appearance): Appearance {
  if (!look.char || !glbCharDef(look.char)) return { ...look, char: DEFAULT_HERO_SLUG };
  return look;
}

function loadProfile(): {
  name: string; look: Appearance; stats: PlayerStats; history: RunRecord[]; bonusXp: number; daily: DailyState;
} {
  const fresh = { name: "", look: defaultAppearance(), stats: freshStats(), history: [] as RunRecord[], bonusXp: 0, daily: freshDaily() };
  if (typeof window === "undefined") return fresh;
  try {
    const raw = JSON.parse(lsGet(LS_PROFILE) ?? lsGet(LS_PROFILE_V2) ?? "null");
    if (raw && typeof raw === "object") {
      const st = (raw.stats && typeof raw.stats === "object" ? raw.stats : {}) as Partial<PlayerStats>;
      const hist = Array.isArray(raw.history) ? raw.history : [];
      return {
        name: typeof raw.name === "string" ? raw.name : "",
        look: healHero(normalizeAppearance(raw.look)),
        stats: {
          runs: Number(st.runs) || 0,
          best: Number(st.best) || 0,
          votes: Number(st.votes) || 0,
          rescues: Number(st.rescues) || 0,
          wins: Number(st.wins) || 0,
          caught: Number(st.caught) || 0,
          totalScore: Number(st.totalScore) || 0,
          playtimeMs: Number(st.playtimeMs) || 0,
        },
        history: hist
          .filter((h: unknown) => !!h && typeof h === "object")
          .slice(0, HISTORY_CAP)
          .map((h: Partial<RunRecord>, i: number) => ({
            id: typeof h.id === "string" ? h.id : `r${i}-${h.at ?? i}`,
            at: Number(h.at) || Date.now(),
            score: Number(h.score) || 0,
            votes: Number(h.votes) || 0,
            rescues: Number(h.rescues) || 0,
            caught: Number(h.caught) || 0,
            won: h.won === true,
            timeMs: Number(h.timeMs) || 0,
          })),
        bonusXp: Number(raw.bonusXp) || 0,
        daily: ensureDaily(raw.daily),
      };
    }
  } catch { /* ignore */ }
  return fresh;
}

function loadSettings(): Settings {
  if (typeof window === "undefined") return { music: 0.7, sfx: 0.8, showFps: false };
  try {
    const raw = JSON.parse(lsGet(LS_SETTINGS) ?? "null");
    if (raw && typeof raw === "object") {
      return {
        music: typeof raw.music === "number" ? Math.min(1, Math.max(0, raw.music)) : 0.7,
        sfx: typeof raw.sfx === "number" ? Math.min(1, Math.max(0, raw.sfx)) : 0.8,
        showFps: !!raw.showFps,
      };
    }
  } catch { /* ignore */ }
  return { music: 0.7, sfx: 0.8, showFps: false };
}

function saveProfile(name: string, look: Appearance, stats: PlayerStats, history: RunRecord[], bonusXp: number, daily: DailyState) {
  if (typeof window === "undefined") return;
  try {
    lsSet(LS_PROFILE, JSON.stringify({ name, look, stats, history: history.slice(0, HISTORY_CAP), bonusXp, daily, savedAt: Date.now() }));
    if (lsGet(LS_PROFILE_V2)) lsRemove(LS_PROFILE_V2);
  } catch { /* ignore */ }
}

function saveSettings(s: Settings) {
  if (typeof window === "undefined") return;
  try { lsSet(LS_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface GameStore {
  screen: Screen;
  /** 🗂️ which lobby tab is open — lets any panel (locker, victory…) deep-link
   *  straight into a tab, e.g. "Open the Item Shop" → the store tab */
  landingTab: "lobby" | "battlepass" | "challenges" | "store" | "career" | "news";
  setLandingTab: (t: GameStore["landingTab"]) => void;
  look: Appearance;
  playerName: string;
  hud: HudData;
  toasts: Toast[];
  muted: boolean;
  touch: boolean;
  scores: ScoreRow[];
  showHelp: boolean;
  victoryOpen: boolean;
  paused: boolean;
  /** true while the ⏸ pause menu shows the welcome-back report (what happened while you were away) */
  pauseReport: boolean;
  /** 🏁 epoch ms when the finished run auto-returns the idle player to the main
   *  screen (0 = none). Armed only while the run is over AND the player sits at
   *  the pause menu — the town kept living, so nothing is left to wait for. */
  endKickAt: number;
  /** true while the big world map overlay is open (M) */
  bigMapOpen: boolean;
  /** true while the 🎒 tool wheel is open at screen center (G) — cursor is free, world keeps running */
  wheelOpen: boolean;
  /** true while the 🪪 driving-license card overlay is open (G wheel → license slice) */
  licenseOpen: boolean;
  /** true while the browser pointer is hard-bound to the game (pointer lock) */
  mouseLocked: boolean;
  settings: Settings;
  runsPlayed: number;
  bestScore: number;
  lifeVotes: number;
  lifeRescues: number;
  careerXp: number;
  /** XP earned outside runs — daily tasks, streak & all-done bonuses (part of careerXp) */
  bonusXp: number;
  /** 📅 today's tasks, 🔥 streak & bookkeeping (rolls over at local midnight) */
  daily: DailyState;
  wins: number;
  lifeCaught: number;
  playtimeMs: number;
  history: RunRecord[];
  /** 💰 spendable wallet — the cash banked from roaming the town (piles, purses,
   *  zombie hoards). Funds the ITEM SHOP. Banked at the end of every run. */
  coins: number;
  /** 💰 lifetime money collected — career-stat flavour ("Money banked") */
  lifeMoney: number;
  /** 🛒 ids of every shop item PURCHASED — gear/gems/snacks/license spawn with
   *  you every run; outfits are worn from the shop or the locker */
  owned: string[];
  /** buy a shop item — true on success (coins deducted, id added to owned) */
  buyItem: (id: string) => boolean;
  /** 💰 bank run earnings straight into the wallet (also used by tests/debug) */
  bankCoins: (n: number) => void;
  /** 🍪 true once the player ACCEPTED the cookies/progress banner — gates the
   *  cloud profile sync (local play works regardless) */
  consent: boolean;
  setConsent: (v: boolean) => void;
  /** ☁️ cloud profile sync status for the lobby chip */
  syncStatus: "idle" | "saving" | "saved" | "offline";
  /** ☁️ pull the cloud profile (once on login/boot) — adopts the server copy
   *  when it is NEWER than this device's save, so nothing is ever lost when a
   *  player signs in from another PC */
  pullProfile: () => Promise<void>;
  /** 🌐 multiplayer lobby state — the Multiplayer panel renders from this */
  mp: {
    open: boolean;
    busy: boolean;
    error: string;
    code: string;
    isHost: boolean;
    ping: number;
    slot: number;
    players: { sid: string; slot: number; name: string; ready: boolean; self: boolean }[];
    chat: { name: string; msg: string; at: number }[];
    /** 🏟️ epoch ms when the PUBG-style match lobby countdown fires (0 = none).
     *  ONE shared deadline — the relay stamps it, every client renders it. */
    matchEndsAt: number;
    /** lobby flavor for the UI copy: "gather" (pre-match) · "relobby" (a night
     *  is running and restarts so everyone plays together) · "solo" (relay off) */
    matchMode: "" | "gather" | "relobby" | "solo";
  };
  setMpOpen: (v: boolean) => void;
  patchMp: (p: Partial<GameStore["mp"]>) => void;
  pushMpChat: (name: string, msg: string) => void;
  /** 🌐 registered by GameRoot: flips everyone into "connecting" and boots a net run */
  mpStartRun: (() => void) | null;
  setMpStartRun: (fn: (() => void) | null) => void;
  setLook: (p: Partial<Appearance>) => void;
  applyLook: (a: Appearance) => void;
  setName: (n: string) => void;
  setScreen: (s: Screen) => void;
  setHud: (h: HudData) => void;
  pushToast: (msg: string, kind?: "info" | "good" | "bad") => void;
  dropToast: (id: number) => void;
  setMuted: (m: boolean) => void;
  setTouch: (t: boolean) => void;
  setScores: (s: ScoreRow[]) => void;
  toggleHelp: () => void;
  setShowHelp: (v: boolean) => void;
  setVictoryOpen: (v: boolean) => void;
  setPaused: (p: boolean) => void;
  setPauseReport: (v: boolean) => void;
  setEndKickAt: (t: number) => void;
  setBigMapOpen: (v: boolean) => void;
  setWheelOpen: (v: boolean) => void;
  setLicenseOpen: (v: boolean) => void;
  setMouseLocked: (v: boolean) => void;
  patchSettings: (p: Partial<Settings>) => void;
  recordRun: (score: number, votes?: number, rescues?: number, caught?: number, won?: boolean, timeMs?: number, extra?: Partial<DailyRunFacts>) => RunRecord;
  addBonusXp: (n: number) => void;
  /** roll the daily board if the local day changed (called by UI on a timer) */
  ensureDailyToday: () => void;
  clearHistory: () => void;
  resetStats: () => void;
}

export const emptyHud: HudData = {
  hp: 100, stamina: 100, stars: 0, carried: 0, delivered: 0, total: 16,
  points: 0, rescues: 0, support: 0, zone: "City", clock: 0.3, night: 0,
  kills: 0,
  aliveTotal: 100,
  detained: false, detainLeft: 0, prompt: "", policeNear: false,
  arrest: "free", station: "",
  civilians: 0, police: 0, won: false, elapsed: 0,
  inv: [], hurt: false, sprinting: false, exhausted: false,
  px: 0, pz: 0,
  gain: { hp: 0, stamina: 0, at: 0 },
  power: null, pockets: [], money: 0, morphKind: null, blinkReady: true,
  side: "protester", busted: 0, runnerDelivered: 0, lost: false, outfitLabel: "",
  hasLicense: false, driving: false, riding: false, speed: 0,
  /* --- 7 Nights --- */
  nightNo: 1, phase: "day", phaseLeft: 0, wood: 0, rock: 0,
  tools: [], held: -1, youPossessed: false, beastCount: 0, crewAlive: 99, crew: [],
  attackReady: true, clue: null,
  /* --- 🧱 THE WALL + 🌅 pre-dawn warning --- */
  zoneLevel: 0, zoneR: 712, outsideWall: false, dawnLeft: 0, dawnOutside: false, dawnR: 430,
  spec: { on: false, name: "" },
  mp: false, mpCode: "", mpHost: false, mpPing: 0, netPlayers: [], remotesAlive: 0,
};

let toastId = 1;

const freshMp = () => ({
  open: false, busy: false, error: "", code: "", isHost: false, ping: 0, slot: 0,
  players: [] as GameStore["mp"]["players"], chat: [] as GameStore["mp"]["chat"],
  matchEndsAt: 0, matchMode: "" as GameStore["mp"]["matchMode"],
});

/** Hydrate persisted player identity once at module load (client only). */
const saved = typeof window !== "undefined"
  ? loadProfile()
  : { name: "", look: defaultAppearance(), stats: freshStats(), history: [] as RunRecord[], bonusXp: 0, daily: freshDaily() };
const savedWallet = typeof window !== "undefined" ? loadWallet() : { coins: 0, owned: [] as string[] };

export const useGame = create<GameStore>()((set, get) => ({
  screen: "landing",
  landingTab: "lobby",
  setLandingTab: (t) => set({ landingTab: t }),
  look: saved.look,
  playerName: saved.name,
  hud: emptyHud,
  toasts: [],
  muted: false,
  touch: false,
  scores: [],
  mp: freshMp(),
  showHelp: true,
  victoryOpen: false,
  paused: false,
  pauseReport: false,
  endKickAt: 0,
  bigMapOpen: false,
  wheelOpen: false,
  licenseOpen: false,
  mouseLocked: false,
  settings: typeof window !== "undefined" ? loadSettings() : { music: 0.7, sfx: 0.8, showFps: false },
  runsPlayed: saved.stats.runs,
  bestScore: saved.stats.best,
  lifeVotes: saved.stats.votes,
  lifeRescues: saved.stats.rescues,
  careerXp: saved.stats.totalScore + saved.bonusXp,
  bonusXp: saved.bonusXp,
  daily: saved.daily,
  wins: saved.stats.wins,
  lifeCaught: saved.stats.caught,
  playtimeMs: saved.stats.playtimeMs,
  history: saved.history,
  coins: savedWallet.coins,
  lifeMoney: saved.stats.votes,
  owned: savedWallet.owned,
  buyItem: (id) => {
    const it = shopItem(id);
    const s = get();
    if (!it) return false;            // unknown item
    if (s.owned.includes(id)) return true; // already ours — no double charge
    if (s.coins < it.price) return false;  // 💰 not enough banked cash — the buy is refused
    const coins = s.coins - it.price;      // 💰 the price leaves the wallet right here
    const owned = [...s.owned, id];
    saveWallet(coins, owned);
    // 🛡️ purchases are PERMANENT — bump the profile's savedAt as well, because
    // the cloud push stamps savedAt ~4 s AFTER saveProfile wrote it (the debounce
    // delay), so the server copy is always slightly "newer" than the local one.
    // A pull that ran before this purchase reached the cloud would otherwise
    // adopt the pre-purchase server wallet and silently WIPE the buy (the
    // "purchased the license but the game doesn't show it" bug).
    saveProfile(s.playerName, s.look, profileStatsOf(s), s.history, s.bonusXp, s.daily);
    set({ coins, owned });
    scheduleCloudSave(600); // 🛒 purchases reach the cloud FAST — tiny loss window
    return true;
  },
  bankCoins: (n) => set((s) => {
    const coins = s.coins + Math.max(0, Math.floor(n));
    const lifeMoney = s.lifeMoney + Math.max(0, Math.floor(n));
    saveWallet(coins, s.owned);
    scheduleCloudSave();
    return { coins, lifeMoney };
  }),
  consent: typeof window !== "undefined" ? consentAccepted() : false,
  setConsent: (v) => {
    if (typeof window !== "undefined") lsSet(LS_CONSENT, v ? "1" : "0");
    set({ consent: v });
    if (v) {
      // 🍪 accepted → the cloud profile comes alive: pull whatever the server
      // holds for this name, then let the debounced push take over
      void get().pullProfile();
      scheduleCloudSave(1500);
    }
  },
  syncStatus: "idle",
  pullProfile: async () => {
    if (typeof window === "undefined" || !consentAccepted()) return;
    const name = get().playerName.trim();
    if (!name) return;
    pullInFlight = true;
    try {
      const r = await fetch(`/api/profile?name=${encodeURIComponent(name)}`);
      const d = await r.json().catch(() => null);
      const p = d && typeof d === "object" ? (d as { profile?: unknown }).profile : null;
      if (!p || typeof p !== "object") {
        useGame.setState({ syncStatus: "idle" }); // nothing in the cloud yet — local is the truth
        return;
      }
      const blob = p as {
        savedAt?: number; look?: Partial<Appearance>; stats?: Partial<PlayerStats>;
        history?: unknown; bonusXp?: number; daily?: DailyState; coins?: number; owned?: unknown;
      };
      const localRaw = JSON.parse(lsGet(LS_PROFILE) ?? "null") as { savedAt?: number } | null;
      const localAt = Number(localRaw?.savedAt) || 0;
      const serverAt = Number(blob.savedAt) || 0;
      const st = (blob.stats && typeof blob.stats === "object" ? blob.stats : {}) as Partial<PlayerStats>;
      const hist = Array.isArray(blob.history) ? blob.history : [];
      const serverOwned = Array.isArray(blob.owned) ? (blob.owned as unknown[]).filter((x): x is string => typeof x === "string" && !!shopItem(x)) : [];
      const s0 = get();
      // 🛡️ purchases are PERMANENT — the adopted wallet UNIONs the cloud owned
      // with the local one, so a pull can ADD cloud purchases but NEVER remove
      // a buy this device made whose push hadn't landed yet (offline blip, tab
      // closed inside the debounce, sandboxed preview storage). Owned is
      // idempotent — items are one-time buys — so the union is always safe.
      const mergedOwned = Array.from(new Set([...serverOwned, ...s0.owned]));
      // how much LIFE lives on each side — a brand-new device (empty wallet, no
      // runs, no purchases) must adopt the cloud even if its timestamp is newer
      const serverProgress = Math.max(0, Number(blob.coins) || 0)
        + serverOwned.length * 50 + Math.max(0, Number(st.runs) || 0) * 10
        + Math.max(0, Number(st.totalScore) || 0) + hist.length * 5;
      const localProgress = s0.coins + s0.owned.length * 50 + s0.runsPlayed * 10
        + Math.max(0, s0.careerXp - s0.bonusXp) + s0.history.length * 5;
      if (serverAt <= localAt && !(serverProgress > 0 && localProgress === 0)) {
        useGame.setState({ syncStatus: "saved" }); // local is newer — the next push will refresh the cloud
        return;
      }
      // 🌩️ the cloud copy is NEWER (or this device is fresh) — adopt it wholesale
      // so the player sees everything they own, no matter which device they signed in from
      const stats: PlayerStats = {
        runs: Number(st.runs) || 0, best: Number(st.best) || 0, votes: Number(st.votes) || 0,
        rescues: Number(st.rescues) || 0, wins: Number(st.wins) || 0, caught: Number(st.caught) || 0,
        totalScore: Number(st.totalScore) || 0, playtimeMs: Number(st.playtimeMs) || 0,
      };
      const history: RunRecord[] = hist
        .filter((h: unknown) => !!h && typeof h === "object")
        .slice(0, HISTORY_CAP)
        .map((h: Partial<RunRecord>, i: number) => ({
          id: typeof h.id === "string" ? h.id : `r${i}-${h.at ?? i}`,
          at: Number(h.at) || Date.now(),
          score: Number(h.score) || 0,
          votes: Number(h.votes) || 0,
          rescues: Number(h.rescues) || 0,
          caught: Number(h.caught) || 0,
          won: h.won === true,
          timeMs: Number(h.timeMs) || 0,
        }));
      const coins = Math.max(0, Math.floor(Number(blob.coins) || 0));
      const look = healHero(normalizeAppearance(blob.look));
      const bonusXp = Math.max(0, Math.floor(Number(blob.bonusXp) || 0));
      const daily = ensureDaily(blob.daily);
      const lifeMoney = stats.votes;
      // write the adopted copy back to localStorage (local-first, instant)
      saveProfile(name, look, stats, history, bonusXp, daily);
      saveWallet(coins, mergedOwned);
      cloudDirty = false; // the adopted copy IS the cloud copy — no urgent push needed
      set({
        look, stats, history, bonusXp, daily, owned: mergedOwned, coins, lifeMoney,
        careerXp: stats.totalScore + bonusXp,
        runsPlayed: stats.runs, bestScore: stats.best, lifeVotes: stats.votes,
        lifeRescues: stats.rescues, wins: stats.wins, lifeCaught: stats.caught,
        playtimeMs: stats.playtimeMs,
        syncStatus: "saved",
      });
    } catch {
      useGame.setState({ syncStatus: "offline" });
    } finally {
      pullInFlight = false;
    }
  },
  setLook: (p) => {
    set((s) => {
      const look = { ...s.look, ...p };
      saveProfile(s.playerName, look, {
        runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
        wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp - s.bonusXp, playtimeMs: s.playtimeMs,
      }, s.history, s.bonusXp, s.daily);
      return { look };
    });
    scheduleCloudSave();
  },
  applyLook: (a) => {
    set((s) => {
      saveProfile(s.playerName, a, {
        runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
        wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp - s.bonusXp, playtimeMs: s.playtimeMs,
      }, s.history, s.bonusXp, s.daily);
      return { look: a };
    });
    scheduleCloudSave();
  },
  setName: (n) => {
    set((s) => {
      saveProfile(n, s.look, {
        runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
        wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp - s.bonusXp, playtimeMs: s.playtimeMs,
      }, s.history, s.bonusXp, s.daily);
      return { playerName: n };
    });
    scheduleCloudSave();
    // 🌐 the name IS the account — signing in/out pulls that player's cloud life
    if (consentAccepted()) void get().pullProfile();
  },
  setScreen: (s) => set({ screen: s }),
  setHud: (h) => set({ hud: h }),
  setMpOpen: (v) => set((s) => ({ mp: { ...s.mp, open: v } })),
  patchMp: (p) => set((s) => ({ mp: { ...s.mp, ...p } })),
  pushMpChat: (name, msg) => set((s) => ({ mp: { ...s.mp, chat: [...s.mp.chat.slice(-30), { name, msg, at: Date.now() }] } })),
  mpStartRun: null,
  setMpStartRun: (fn) => set({ mpStartRun: fn }),
  pushToast: (msg, kind = "info") => set((s) => ({ toasts: [...s.toasts.slice(-3), { msg, kind, id: toastId++ }] })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setMuted: (m) => set({ muted: m }),
  setTouch: (t) => set({ touch: t }),
  setScores: (sc) => set({ scores: sc }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  setShowHelp: (v) => set({ showHelp: v }),
  setVictoryOpen: (v) => set({ victoryOpen: v }),
  setPaused: (p) => set({ paused: p }),
  setPauseReport: (v) => set({ pauseReport: v }),
  setEndKickAt: (t) => set({ endKickAt: t }),
  setMouseLocked: (v) => set({ mouseLocked: v }),
  setBigMapOpen: (v) => set({ bigMapOpen: v }),
  setWheelOpen: (v) => set({ wheelOpen: v }),
  setLicenseOpen: (v) => set({ licenseOpen: v }),
  patchSettings: (p) => {
    set((s) => {
      const settings = { ...s.settings, ...p };
      saveSettings(settings);
      return { settings };
    });
  },
  recordRun: (score, votes = 0, rescues = 0, caught = 0, won = false, timeMs = 0, extra?) => {
    const rec: RunRecord = {
      id: `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      at: Date.now(),
      score: Math.max(0, Math.floor(score)),
      votes: Math.max(0, Math.floor(votes)),
      rescues: Math.max(0, Math.floor(rescues)),
      caught: Math.max(0, Math.floor(caught)),
      won,
      timeMs: Math.max(0, Math.floor(timeMs)),
    };
    const toasts: { msg: string; kind: "good" }[] = [];
    set((s) => {
      // 📅 daily board: 🔥 streak + task progress + bonus-XP rewards (clone first —
      // applyRunToDaily mutates its input and the store object must stay immutable)
      const res = applyRunToDaily(
        { ...s.daily, tasks: s.daily.tasks.map((t) => ({ ...t })) },
        {
          votes: extra?.votes ?? 0, busts: extra?.busts ?? 0, rescues: rec.rescues,
          score: rec.score, won: rec.won, snacks: extra?.snacks ?? 0, powers: extra?.powers ?? 0,
        },
      );
      let bonus = 0;
      for (const t of res.completed) bonus += t.xp;
      if (res.allJustDone) bonus += ALL_DONE_BONUS;
      // totalScore keeps counting RUN points only — bonus XP lives in bonusXp so
      // "average score" in career stats stays honest
      const runScoreTotal = s.careerXp - s.bonusXp + rec.score;
      const stats: PlayerStats = {
        runs: s.runsPlayed + 1,
        best: Math.max(s.bestScore, rec.score),
        votes: s.lifeVotes + rec.votes,
        rescues: s.lifeRescues + rec.rescues,
        wins: s.wins + (rec.won ? 1 : 0),
        caught: s.lifeCaught + rec.caught,
        totalScore: runScoreTotal,
        playtimeMs: s.playtimeMs + rec.timeMs,
      };
      const history = [rec, ...s.history].slice(0, HISTORY_CAP);
      const bonusXp = s.bonusXp + bonus;
      const careerXp = runScoreTotal + bonusXp;
      // 💰 every dollar scooped while roaming banks into the wallet — the ITEM
      // SHOP funds itself from the money lying around town
      const coins = s.coins + rec.votes;
      const lifeMoney = s.lifeMoney + rec.votes;
      saveWallet(coins, s.owned);
      saveProfile(s.playerName, s.look, stats, history, bonusXp, res.daily);
      if (res.streakJustGrew) toasts.push({ msg: `🔥 Day ${res.streak} streak! Play daily for bonus XP!`, kind: "good" });
      for (const t of res.completed) toasts.push({ msg: `📅 Daily task done: ${t.emoji} +${t.xp} XP!`, kind: "good" });
      if (res.allJustDone) toasts.push({ msg: `🌟 All 3 daily tasks complete! +${ALL_DONE_BONUS} XP bonus!`, kind: "good" });
      if (rec.votes > 0) toasts.push({ msg: `💰 $${rec.votes} banked — wallet $${coins}. Spend it in the ITEM SHOP!`, kind: "good" });
      return {
        runsPlayed: stats.runs, bestScore: stats.best, lifeVotes: stats.votes, lifeRescues: stats.rescues,
        careerXp, bonusXp, daily: res.daily, wins: stats.wins, lifeCaught: stats.caught, playtimeMs: stats.playtimeMs,
        history, coins, lifeMoney,
      };
    });
    for (const t of toasts) useGame.getState().pushToast(t.msg, t.kind);
    scheduleCloudSave(); // 💾 the run's earnings/progress reach the cloud in one debounced upsert
    return rec;
  },
  addBonusXp: (n) => set((s) => {
    const bonusXp = s.bonusXp + Math.max(0, Math.floor(n));
    const careerXp = s.careerXp - s.bonusXp + bonusXp;
    saveProfile(s.playerName, s.look, {
      runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
      wins: s.wins, caught: s.lifeCaught, totalScore: careerXp - bonusXp, playtimeMs: s.playtimeMs,
    }, s.history, bonusXp, s.daily);
    scheduleCloudSave();
    return { bonusXp, careerXp };
  }),
  ensureDailyToday: () => set((s) => {
    const daily = ensureDaily(s.daily);
    if (daily === s.daily) return {};
    saveProfile(s.playerName, s.look, {
      runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
      wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp - s.bonusXp, playtimeMs: s.playtimeMs,
    }, s.history, s.bonusXp, daily);
    scheduleCloudSave();
    return { daily };
  }),
  clearHistory: () => set((s) => {
    saveProfile(s.playerName, s.look, {
      runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
      wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp - s.bonusXp, playtimeMs: s.playtimeMs,
    }, [], s.bonusXp, s.daily);
    scheduleCloudSave();
    return { history: [] };
  }),
  resetStats: () => set((s) => {
    const daily = freshDaily();
    saveProfile(s.playerName, s.look, freshStats(), [], 0, daily);
    saveWallet(0, s.owned); // purchases survive a stat reset — only the cash resets
    scheduleCloudSave();
    return {
      runsPlayed: 0, bestScore: 0, lifeVotes: 0, lifeRescues: 0,
      careerXp: 0, bonusXp: 0, daily, wins: 0, lifeCaught: 0, playtimeMs: 0, history: [],
      coins: 0, lifeMoney: 0,
    };
  }),
}));

// Apply persisted volumes to the audio engine on boot.
if (typeof window !== "undefined") {
  const st = useGame.getState();
  import("@/lib/game/audio").then(({ setVolumes }) => setVolumes(st.settings.sfx, st.settings.music)).catch(() => {});
}

/* ☁️ tab close safety net — one sendBeacon flushes any pending profile change
 * so nothing is lost even when the player closes the browser mid-session. */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (!cloudDirty || !cloudTimer) return;
    const s = useGame.getState();
    if (!s.playerName.trim()) return;
    clearTimeout(cloudTimer);
    cloudTimer = null;
    try {
      navigator.sendBeacon(
        "/api/profile",
        new Blob([JSON.stringify({ name: s.playerName, data: cloudBlob(s) })], { type: "application/json" }),
      );
    } catch { /* ignore */ }
  });
}

/** 💾 download the player profile as a JSON backup file (locker/profile UI) —
 *  the player keeps a copy on their PC even without cookies/cloud sync. */
export function downloadProfile() {
  if (typeof window === "undefined") return;
  const s = useGame.getState();
  const file = new Blob([cloudBlob(s)], { type: "application/json" });
  const a = document.createElement("a");
  const tag = (s.playerName || "guest").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "guest";
  a.href = URL.createObjectURL(file);
  a.download = `7nights-profile-${tag}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
