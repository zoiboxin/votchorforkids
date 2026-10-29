export const ROOM_CAPACITY = 100;
export const TICK_HZ = 20;
export const WORLD_SEED = 1337;
export const WALL_RADIUS = 322;
export const CITY_RADIUS = 130;
export const FARM_RADIUS = 200;
export const JUNGLE_RADIUS = 335;
export const GRAVEYARD = { x: -185, z: 165, r: 42 } as const;
export const SPAWN = { x: 0, z: 6 } as const;
export const DAY_SECONDS = 300;
export const GRAVITY = 22;

export type Faction = "protester" | "police";
export type Sex = "boy" | "girl";
export type AgeGroup = "kid" | "teen" | "young" | "old";

/** Age groups change stats only; none is strictly best. */
export const AGE_STATS: Record<AgeGroup, { scale: number; speed: number; regen: number; jump: number }> = {
  kid: { scale: 0.68, speed: 5.4, regen: 0.8, jump: 7 },
  teen: { scale: 0.88, speed: 6.6, regen: 1, jump: 8.4 },
  young: { scale: 1, speed: 6.2, regen: 1, jump: 7.6 },
  old: { scale: 0.96, speed: 5, regen: 1.7, jump: 6.4 },
};
export const SPRINT_MULT = 1.7;
export const POLICE_COLORS = ["#2f4a7a", "#3a5a3a", "#5a4a3a"];
export const CIVIL_COLORS = ["#f5a524", "#e0483a", "#2a9d8f", "#f1e9d2", "#7a5cff"];
export const SKIN_TONES = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#6b4423"];
export const SHOE_COLORS = ["#3b2314", "#111111", "#f5f5f5", "#e0483a", "#2a6fdb"];
