"use client";

import { create } from "zustand";
import { defaultAppearance, normalizeAppearance, type Appearance } from "@/lib/game/constants";
import type { HudData } from "@/lib/game/engine";

export type Screen = "landing" | "creator" | "connecting" | "play";
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

const freshStats = (): PlayerStats => ({ runs: 0, best: 0, votes: 0, rescues: 0, wins: 0, caught: 0, totalScore: 0, playtimeMs: 0 });

function loadProfile(): { name: string; look: Appearance; stats: PlayerStats; history: RunRecord[] } {
  const fresh = { name: "", look: defaultAppearance(), stats: freshStats(), history: [] as RunRecord[] };
  if (typeof window === "undefined") return fresh;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PROFILE) ?? localStorage.getItem(LS_PROFILE_V2) ?? "null");
    if (raw && typeof raw === "object") {
      const st = (raw.stats && typeof raw.stats === "object" ? raw.stats : {}) as Partial<PlayerStats>;
      const hist = Array.isArray(raw.history) ? raw.history : [];
      return {
        name: typeof raw.name === "string" ? raw.name : "",
        look: normalizeAppearance(raw.look),
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
      };
    }
  } catch { /* ignore */ }
  return fresh;
}

function loadSettings(): Settings {
  if (typeof window === "undefined") return { music: 0.7, sfx: 0.8, showFps: false };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) ?? "null");
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

function saveProfile(name: string, look: Appearance, stats: PlayerStats, history: RunRecord[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PROFILE, JSON.stringify({ name, look, stats, history: history.slice(0, HISTORY_CAP) }));
    if (localStorage.getItem(LS_PROFILE_V2)) localStorage.removeItem(LS_PROFILE_V2);
  } catch { /* ignore */ }
}

function saveSettings(s: Settings) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface GameStore {
  screen: Screen;
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
  /** true while the big world map overlay is open (M) */
  bigMapOpen: boolean;
  /** true while the browser pointer is hard-bound to the game (pointer lock) */
  mouseLocked: boolean;
  settings: Settings;
  runsPlayed: number;
  bestScore: number;
  lifeVotes: number;
  lifeRescues: number;
  careerXp: number;
  wins: number;
  lifeCaught: number;
  playtimeMs: number;
  history: RunRecord[];
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
  setVictoryOpen: (v: boolean) => void;
  setPaused: (p: boolean) => void;
  setBigMapOpen: (v: boolean) => void;
  setMouseLocked: (v: boolean) => void;
  patchSettings: (p: Partial<Settings>) => void;
  recordRun: (score: number, votes?: number, rescues?: number, caught?: number, won?: boolean, timeMs?: number) => RunRecord;
  clearHistory: () => void;
  resetStats: () => void;
}

export const emptyHud: HudData = {
  hp: 100, stamina: 100, stars: 0, carried: 0, delivered: 0, total: 16,
  points: 0, rescues: 0, support: 0, zone: "City", clock: 0.3, night: 0,
  detained: false, detainLeft: 0, prompt: "", policeNear: false,
  civilians: 0, police: 0, won: false, elapsed: 0,
  inv: [], hurt: false, sprinting: false, exhausted: false,
  px: 0, pz: 0,
  gain: { hp: 0, stamina: 0, at: 0 },
  power: null, pocketPower: null, morphKind: null, blinkReady: true,
};

let toastId = 1;

/** Hydrate persisted player identity once at module load (client only). */
const saved = typeof window !== "undefined"
  ? loadProfile()
  : { name: "", look: defaultAppearance(), stats: freshStats(), history: [] as RunRecord[] };

export const useGame = create<GameStore>()((set, get) => ({
  screen: "landing",
  look: saved.look,
  playerName: saved.name,
  hud: emptyHud,
  toasts: [],
  muted: false,
  touch: false,
  scores: [],
  showHelp: true,
  victoryOpen: false,
  paused: false,
  bigMapOpen: false,
  settings: typeof window !== "undefined" ? loadSettings() : { music: 0.7, sfx: 0.8, showFps: false },
  runsPlayed: saved.stats.runs,
  bestScore: saved.stats.best,
  lifeVotes: saved.stats.votes,
  lifeRescues: saved.stats.rescues,
  careerXp: saved.stats.totalScore,
  wins: saved.stats.wins,
  lifeCaught: saved.stats.caught,
  playtimeMs: saved.stats.playtimeMs,
  history: saved.history,
  setLook: (p) => {
    set((s) => {
      const look = { ...s.look, ...p };
      saveProfile(s.playerName, look, {
        runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
        wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp, playtimeMs: s.playtimeMs,
      }, s.history);
      return { look };
    });
  },
  applyLook: (a) => {
    set((s) => {
      saveProfile(s.playerName, a, {
        runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
        wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp, playtimeMs: s.playtimeMs,
      }, s.history);
      return { look: a };
    });
  },
  setName: (n) => {
    set((s) => {
      saveProfile(n, s.look, {
        runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
        wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp, playtimeMs: s.playtimeMs,
      }, s.history);
      return { playerName: n };
    });
  },
  setScreen: (s) => set({ screen: s }),
  setHud: (h) => set({ hud: h }),
  pushToast: (msg, kind = "info") => set((s) => ({ toasts: [...s.toasts.slice(-3), { msg, kind, id: toastId++ }] })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setMuted: (m) => set({ muted: m }),
  setTouch: (t) => set({ touch: t }),
  setScores: (sc) => set({ scores: sc }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  setVictoryOpen: (v) => set({ victoryOpen: v }),
  setPaused: (p) => set({ paused: p }),
  setMouseLocked: (v) => set({ mouseLocked: v }),
  setBigMapOpen: (v) => set({ bigMapOpen: v }),
  patchSettings: (p) => {
    set((s) => {
      const settings = { ...s.settings, ...p };
      saveSettings(settings);
      return { settings };
    });
  },
  recordRun: (score, votes = 0, rescues = 0, caught = 0, won = false, timeMs = 0) => {
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
    set((s) => {
      const stats: PlayerStats = {
        runs: s.runsPlayed + 1,
        best: Math.max(s.bestScore, rec.score),
        votes: s.lifeVotes + rec.votes,
        rescues: s.lifeRescues + rec.rescues,
        wins: s.wins + (rec.won ? 1 : 0),
        caught: s.lifeCaught + rec.caught,
        totalScore: s.careerXp + rec.score,
        playtimeMs: s.playtimeMs + rec.timeMs,
      };
      const history = [rec, ...s.history].slice(0, HISTORY_CAP);
      saveProfile(s.playerName, s.look, stats, history);
      return {
        runsPlayed: stats.runs, bestScore: stats.best, lifeVotes: stats.votes, lifeRescues: stats.rescues,
        careerXp: stats.totalScore, wins: stats.wins, lifeCaught: stats.caught, playtimeMs: stats.playtimeMs,
        history,
      };
    });
    return rec;
  },
  clearHistory: () => set((s) => {
    saveProfile(s.playerName, s.look, {
      runs: s.runsPlayed, best: s.bestScore, votes: s.lifeVotes, rescues: s.lifeRescues,
      wins: s.wins, caught: s.lifeCaught, totalScore: s.careerXp, playtimeMs: s.playtimeMs,
    }, []);
    return { history: [] };
  }),
  resetStats: () => set((s) => {
    saveProfile(s.playerName, s.look, freshStats(), []);
    return {
      runsPlayed: 0, bestScore: 0, lifeVotes: 0, lifeRescues: 0,
      careerXp: 0, wins: 0, lifeCaught: 0, playtimeMs: 0, history: [],
    };
  }),
}));

// Apply persisted volumes to the audio engine on boot.
if (typeof window !== "undefined") {
  const st = useGame.getState();
  import("@/lib/game/audio").then(({ setVolumes }) => setVolumes(st.settings.sfx, st.settings.music)).catch(() => {});
}
