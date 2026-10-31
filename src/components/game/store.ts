"use client";

import { create } from "zustand";
import { defaultAppearance, type Appearance } from "@/lib/game/constants";
import type { HudData } from "@/lib/game/engine";

export type Screen = "creator" | "connecting" | "play";
export interface Toast { msg: string; kind: "info" | "good" | "bad"; id: number }

export interface ScoreRow { id: string; name: string; points: number; votes: number; rescues: number; won: boolean; timeMs: number; createdAt: string }

interface GameStore {
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
  setLook: (p: Partial<Appearance>) => void;
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
}

export const emptyHud: HudData = {
  hp: 100, stamina: 100, stars: 0, carried: 0, delivered: 0, total: 16,
  points: 0, rescues: 0, support: 0, zone: "City", clock: 0.3, night: 0,
  detained: false, detainLeft: 0, prompt: "", policeNear: false,
  civilians: 0, police: 0, won: false, elapsed: 0,
};

let toastId = 1;
export const useGame = create<GameStore>()((set) => ({
  screen: "creator",
  look: defaultAppearance(),
  playerName: "",
  hud: emptyHud,
  toasts: [],
  muted: false,
  touch: false,
  scores: [],
  showHelp: true,
  victoryOpen: false,
  setLook: (p) => set((s) => ({ look: { ...s.look, ...p } })),
  setName: (n) => set({ playerName: n }),
  setScreen: (s) => set({ screen: s }),
  setHud: (h) => set({ hud: h }),
  pushToast: (msg, kind = "info") => set((s) => ({ toasts: [...s.toasts.slice(-3), { msg, kind, id: toastId++ }] })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setMuted: (m) => set({ muted: m }),
  setTouch: (t) => set({ touch: t }),
  setScores: (sc) => set({ scores: sc }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  setVictoryOpen: (v) => set({ victoryOpen: v }),
}));
