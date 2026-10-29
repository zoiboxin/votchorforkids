import { create } from "zustand";
import { defaultAppearance, type Appearance } from "@votechor/shared";

export type Screen = "creator" | "connecting" | "play" | "error";
export interface Mate { id: string; name: string; hp: number; detained: boolean }
export interface BossHud { phase: number; hp: number; timer: number; votes: number; need: number; hold: number; round: number; progress: string }
export interface Hud { boss: BossHud; squad: string; support: number; mates: Mate[]; prompt: string; hp: number; stamina: number; stars: number; zone: string; clock: number; real: number; bots: number; detained: boolean }

interface GameStore {
  screen: Screen; look: Appearance; name: string; error: string;
  online: boolean; ids: string[]; hud: Hud; toast: string; toastAt: number;
  setLook: (p: Partial<Appearance>) => void;
}
export const useGame = create<GameStore>()((set) => ({
  screen: "creator", look: defaultAppearance(), name: "", error: "", online: true, ids: [],
  hud: { boss: { phase: 0, hp: 100, timer: 0, votes: 0, need: 1, hold: 0, round: 1, progress: "" }, squad: "", support: 0, mates: [], prompt: "", hp: 100, stamina: 100, stars: 0, zone: "City", clock: 0.33, real: 0, bots: 0, detained: false },
  toast: "", toastAt: 0,
  setLook: (p) => set((s) => ({ look: { ...s.look, ...p } })),
}));
export const toast = (toast: string) => useGame.setState({ toast, toastAt: Date.now() });
