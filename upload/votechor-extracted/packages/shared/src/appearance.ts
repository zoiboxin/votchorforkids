import { CIVIL_COLORS, POLICE_COLORS, SHOE_COLORS, SKIN_TONES, type AgeGroup } from "./constants.ts";
import type { Appearance } from "./protocol.ts";

const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];

export function randomAppearance(r: () => number, police: boolean): Appearance {
  const age: AgeGroup = police ? (r() < 0.7 ? "young" : "old") : pick(r, ["kid", "teen", "young", "old"] as const);
  return {
    fac: police ? "police" : "protester",
    sex: r() < 0.5 ? "boy" : "girl",
    age,
    cap: police ? 1 : r() < 0.4 ? 1 : 0,
    skin: pick(r, SKIN_TONES),
    shirt: pick(r, police ? POLICE_COLORS : CIVIL_COLORS),
    shoe: police ? "#111111" : pick(r, SHOE_COLORS),
  };
}
