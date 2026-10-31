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

const LS_PROFILE = "votechor_profile_v2";
const LS_SETTINGS = "votechor_settings_v2";

function loadProfile(): { name: string; look: Appearance } {
  if (typeof window === "undefined") return { name: "", look: defaultAppearance() };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PROFILE) ?? "null");
    if (raw && typeof raw === "object") {
      return { name: typeof raw.name === "string" ? raw.name : "", look: normalizeAppearance(raw.look) };
    }
  } catch { /* ignore */ }
  return { name: "", look: defaultAppearance() };
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

function saveProfile(name: string, look: Appearance) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_PROFILE, JSON.stringify({ name, look })); } catch { /* ignore */ }
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
  settings: Settings;
  runsPlayed: number;
  bestScore: number;
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
  patchSettings: (p: Partial<Settings>) => void;
  recordRun: (score: number) => void;
}

export const emptyHud: HudData = {
  hp: 100, stamina: 100, stars: 0, carried: 0, delivered: 0, total: 16,
  points: 0, rescues: 0, support: 0, zone: "City", clock: 0.3, night: 0,
  detained: false, detainLeft: 0, prompt: "", policeNear: false,
  civilians: 0, police: 0, won: false, elapsed: 0,
};

let toastId = 1;

/** Hydrate persisted player identity once at module load (client only). */
const saved = typeof window !== "undefined" ? loadProfile() : { name: "", look: defaultAppearance() };

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
  settings: typeof window !== "undefined" ? loadSettings() : { music: 0.7, sfx: 0.8, showFps: false },
  runsPlayed: 0,
  bestScore: 0,
  setLook: (p) => {
    set((s) => {
      const look = { ...s.look, ...p };
      saveProfile(s.playerName, look);
      return { look };
    });
  },
  applyLook: (a) => {
    set((s) => {
      saveProfile(s.playerName, a);
      return { look: a };
    });
  },
  setName: (n) => {
    set((s) => {
      saveProfile(n, s.look);
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
  patchSettings: (p) => {
    set((s) => {
      const settings = { ...s.settings, ...p };
      saveSettings(settings);
      return { settings };
    });
  },
  recordRun: (score) => set((s) => ({
    runsPlayed: s.runsPlayed + 1,
    bestScore: Math.max(s.bestScore, score),
  })),
}));

// Apply persisted volumes to the audio engine on boot.
if (typeof window !== "undefined") {
  const st = useGame.getState();
  import("@/lib/game/audio").then(({ setVolumes }) => setVolumes(st.settings.sfx, st.settings.music)).catch(() => {});
}
