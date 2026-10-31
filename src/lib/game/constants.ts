/** VoteChor 2.0 — shared constants. Tuned for a fast, kid-friendly cartoon chase game. */

export const WORLD_SEED = 1337;
export const WALL_RADIUS = 375;
export const CITY_RADIUS = 245;
export const FARM_RADIUS = 320;
export const JUNGLE_RADIUS = 400;
export const GRAVEYARD = { x: -255, z: 215, r: 45 } as const;
export const SPAWN = { x: 0, z: 6 } as const;
export const DAY_SECONDS = 360;
export const GRAVITY = 22;

/** Parliament + ballot box where stolen votes are delivered. */
export const PARLIAMENT = { x: 0, z: -196 } as const;
export const BALLOT = { x: 0, z: -174 } as const;

export type AgeGroup = "kid" | "teen" | "young" | "old";

/** Age groups change stats only; none is strictly best. */
export const AGE_STATS: Record<AgeGroup, { scale: number; speed: number; regen: number; jump: number; label: string }> = {
  kid: { scale: 0.66, speed: 5.6, regen: 0.9, jump: 7.4, label: "Kid — small & nimble" },
  teen: { scale: 0.86, speed: 6.8, regen: 1, jump: 8.6, label: "Teen — fastest runner" },
  young: { scale: 1, speed: 6.3, regen: 1, jump: 7.8, label: "Young — all-rounder" },
  old: { scale: 0.94, speed: 5.2, regen: 1.8, jump: 6.6, label: "Elder — wise & tough" },
};

export const SPRINT_MULT = 1.65;

export type HairStyle = "spiky" | "bowl" | "ponytail" | "twintails" | "mohawk" | "curly" | "bald";

export interface Appearance {
  skin: string;
  shirt: string;
  pants: string;
  shoe: string;
  hair: string;
  hairStyle: HairStyle;
  cap: boolean;
  age: AgeGroup;
  girl: boolean;
}

export const SKIN_TONES = ["#ffd9b3", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#6b4423"];
export const SHIRT_COLORS = ["#f5a524", "#e0483a", "#2a9d8f", "#f1e9d2", "#e91e8c", "#7bc043", "#ff6b35", "#00b4d8"];
export const PANTS_COLORS = ["#2b3556", "#4a3b2a", "#7a3b3b", "#2a6f4f", "#444a55", "#8a5aa8"];
export const SHOE_COLORS = ["#3b2314", "#111111", "#f5f5f5", "#e0483a", "#2a6fdb"];
export const HAIR_COLORS = ["#1a1210", "#5a3a1a", "#c88a4a", "#e8c15a", "#d8d8d8", "#b03030", "#4a4a58"];
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: "spiky", label: "Spiky" },
  { id: "bowl", label: "Bowl" },
  { id: "ponytail", label: "Ponytail" },
  { id: "twintails", label: "Twintails" },
  { id: "mohawk", label: "Mohawk" },
  { id: "curly", label: "Curly" },
  { id: "bald", label: "Bald" },
];

export const CIVIL_NAMES = [
  "Chintu", "Pintu", "Babli", "Golu", "Rani", "Munna", "Chotu", "Pinky",
  "Bholu", "Guddu", "Laddo", "Shona", "Titli", "Pappu", "Bunty", "Jhumri",
];

export const defaultAppearance = (): Appearance => ({
  skin: SKIN_TONES[1],
  shirt: SHIRT_COLORS[0],
  pants: PANTS_COLORS[0],
  shoe: SHOE_COLORS[0],
  hair: HAIR_COLORS[0],
  hairStyle: "spiky",
  cap: true,
  age: "young",
  girl: false,
});

/* ---------- Pickups ---------- */
export interface ItemDef { name: string; hp: number; stamina: number; color: string; msg: string; kind: "fruit" | "kit" | "drink" }
export const ITEMS: readonly ItemDef[] = [
  { name: "Mango", hp: 8, stamina: 20, color: "#ffa726", msg: "Sweet mango! Health restored.", kind: "fruit" },
  { name: "Samosa", hp: 12, stamina: 15, color: "#e0a030", msg: "Crispy samosa. Yum!", kind: "fruit" },
  { name: "Jalebi", hp: 6, stamina: 30, color: "#ff8c1a", msg: "Sticky jalebi: speedy!", kind: "fruit" },
  { name: "Laddu", hp: 10, stamina: 25, color: "#f0c040", msg: "Laddu power activated!", kind: "fruit" },
  { name: "First-aid kit", hp: 45, stamina: 0, color: "#e0483a", msg: "First-aid kit! All patched up.", kind: "kit" },
  { name: "Chai", hp: 4, stamina: 45, color: "#c88a4a", msg: "Chai break! Energy restored.", kind: "drink" },
  { name: "Coconut water", hp: 8, stamina: 35, color: "#eeeedd", msg: "Coconut water. Hydrated!", kind: "drink" },
];
export const ITEM_COUNT = 26;
export const PICKUP_RADIUS = 1.9;
export const ITEM_RESPAWN_S = 22;

/* ---------- Votes (the core loop) ---------- */
export const TOTAL_VOTES = 16;
export const MAX_CARRY = 3;
export const CARRY_RADIUS = 1.7;
export const DELIVER_RADIUS = 4;
export const DROP_SCATTER = 3.2;

/* ---------- Police ---------- */
export const POLICE_COUNT = 9;
export const POLICE_SPEED = 5.9;
export const POLICE_SPRINT = 7.6;
export const DETECT_BASE = 13;
export const DETECT_CARRY_BONUS = 9;
export const DETECT_STAR_BONUS = 2.2;
export const CATCH_RADIUS = 1.35;
export const DETAIN_SECONDS = 8;
export const STAR_DECAY_S = 45;
export const ESCAPE_LOST_S = 4.5;

/* ---------- Civilians & rescue ---------- */
export const CIVILIAN_COUNT = 18;
export const RESCUE_RADIUS = 3.4;
export const RESCUE_POINTS = 60;

/* ---------- Zombies ---------- */
export const ZOMBIE_COUNT = 9;
export const ZOMBIE_SPEED = 3.4;
export const ZOMBIE_NIGHT_SPEED = 4.6;
export const ZOMBIE_DMG = 8;
export const ZOMBIE_TOUCH_CD = 1.2;
export const GRAVEYARD_CENTER = GRAVEYARD;

/* ---------- Animals ---------- */
export type AnimalKind = "cow" | "chicken" | "deer" | "monkey";
export const ANIMAL_SET: { kind: AnimalKind; count: number; zone: "farm" | "jungle" }[] = [
  { kind: "cow", count: 5, zone: "farm" },
  { kind: "chicken", count: 7, zone: "farm" },
  { kind: "deer", count: 4, zone: "jungle" },
  { kind: "monkey", count: 4, zone: "jungle" },
];

/* ---------- Scoring ---------- */
export const POINTS_DELIVER = 120;
export const POINTS_PICKUP = 10;
export const POINTS_RESCUE = 60;
export const WIN_BONUS = 500;

export type Zone = "City" | "Farmland" | "Jungle" | "Graveyard" | "Mountain Wall";
export function zoneOf(x: number, z: number): Zone {
  if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < 45) return "Graveyard";
  const r = Math.hypot(x, z);
  return r < CITY_RADIUS ? "City" : r < FARM_RADIUS ? "Farmland" : r < JUNGLE_RADIUS - 10 ? "Jungle" : "Mountain Wall";
}

export const ZONE_TOAST: Record<Zone, string> = {
  City: "Welcome to the city! Grab those votes!",
  Farmland: "Farmland — mind the cows!",
  Jungle: "The jungle… listen, the monkeys are watching.",
  Graveyard: "Graveyard! At night the zombies wake up…",
  "Mountain Wall": "The mountains say no. Turn back!",
};
