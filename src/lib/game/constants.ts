/** VoteChor 2.0 — shared constants. Tuned for a fast, kid-friendly cartoon chase game. */

export const WORLD_SEED = 1337;
export const WALL_RADIUS = 452;
export const CITY_RADIUS = 330;
export const FARM_RADIUS = 385;
export const JUNGLE_RADIUS = 455;
export const GRAVEYARD = { x: -255, z: 215, r: 45 } as const;
export const SPAWN = { x: 0, z: 6 } as const;
export const DAY_SECONDS = 360;
export const GRAVITY = 22;

/* ---------- jump feel ---------- */
export const COYOTE_S = 0.12;        // grace window to jump after walking off an edge
export const DOUBLE_JUMP_VY = 0.92;  // double-jump power as a fraction of the ground jump
export const JUMP2_COST = 8;         // extra stamina for the mid-air double jump
export const FLIP_S = 0.55;          // front-flip duration after a double jump
export const LAND_SQUASH_S = 0.16;   // landing squash-and-stretch duration

/** Parliament + ballot box where stolen votes are delivered. */
export const PARLIAMENT = { x: 0, z: -196 } as const;
export const BALLOT = { x: 0, z: -170 } as const;

/* ---------- Police stations (one per city quadrant, with a van gate + jail cage) ---------- */
export interface StationDef { x: number; z: number; name: string }
export const POLICE_STATIONS: readonly StationDef[] = [
  { x: -168.75, z: -168.75, name: "Gulmohar Chowki" },
  { x: 168.75, z: -168.75, name: "Ring Road Chowki" },
  { x: -168.75, z: 168.75, name: "Lake View Chowki" },
  { x: 168.75, z: 168.75, name: "Banyan Chowki" },
];
/** Where the van stops & the player is released — the block-side facing town. */
export const stationGate = (s: StationDef) => ({ x: s.x - Math.sign(s.x) * 17, z: s.z - Math.sign(s.z) * 17 });
/** Fenced evidence cage behind the station — confiscated votes & jailed bots live here. */
export const stationCage = (s: StationDef) => ({ x: s.x + Math.sign(s.x) * 14, z: s.z + Math.sign(s.z) * 14 });

export type AgeGroup = "kid" | "teen" | "young" | "old";

/** Age groups change stats only; none is strictly best. */
export const AGE_STATS: Record<AgeGroup, { scale: number; speed: number; regen: number; jump: number; label: string }> = {
  kid: { scale: 0.66, speed: 5.6, regen: 0.9, jump: 7.4, label: "Kid — small & nimble" },
  teen: { scale: 0.86, speed: 6.8, regen: 1, jump: 8.6, label: "Teen — fastest runner" },
  young: { scale: 1, speed: 6.3, regen: 1, jump: 7.8, label: "Young — all-rounder" },
  old: { scale: 0.94, speed: 5.2, regen: 1.8, jump: 6.6, label: "Elder — wise & tough" },
};

export const SPRINT_MULT = 1.65;

export type HairStyle = "spiky" | "bowl" | "ponytail" | "twintails" | "mohawk" | "curly" | "afro" | "bun" | "bald";

/** Which side of the law the hero plays — chosen in the creator (old-game "Side" row). */
export type Side = "protester" | "police";

export interface Appearance {
  fac: Side;
  /** police squad outfit id (POLICE_OUTFITS) — "" for protesters / legacy saves */
  outfit: string;
  skin: string;
  shirt: string;
  pants: string;
  shoe: string;
  hair: string;
  hairStyle: HairStyle;
  cap: boolean;
  capColor: string;
  glasses: boolean;
  age: AgeGroup;
  girl: boolean;
}

export const SKIN_TONES = ["#ffd9b3", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#6b4423"];
export const SHIRT_COLORS = ["#f5a524", "#e0483a", "#2a9d8f", "#f1e9d2", "#e91e8c", "#7bc043", "#ff6b35", "#00b4d8"];
/** Police uniform shirts (old-game POLICE_COLORS palette + squad extras) — creator swatches when Side = Police. */
export const POLICE_COLORS = ["#2e4f9e", "#3a5a3a", "#5a4a3a", "#eef2f7", "#23272f", "#2f3640"];
export const POLICE_UNIFORM = {
  shirt: "#2e4f9e", pants: "#1c2a4e", cap: true, capColor: "#1c2a4e",
} as const;

/* ---------- Police squad outfits — the hero page shown when Side = Police ----------
   Old game only offered 3 uniform colours; 2.0 turns each colour theme into a full
   squad with its own 3D gear (cap / helmet / beret / hi-viz / plate / trench) and a
   small gameplay perk so every pick feels different but stays kid-friendly.        */
export interface PolicePerk {
  bustRMult: number;    // riot: bigger walk-into bust radius
  bustCdMult: number;   // traffic: faster recovery between busts
  sprintMult: number;   // commando: extra sprint speed multiplier
  regenMult: number;    // city: stamina regenerates faster while walking
  drainMult: number;    // army: sprint drains stamina slower
  scoreMult: number;    // detective: bonus points per bust
}
export interface PoliceOutfitDef {
  id: string; label: string; emoji: string;
  tagline: string;  // one-line flavour shown on the hero card
  perkLabel: string; // kid-readable perk text
  stats: PolicePerk;
  look: Partial<Appearance>; // applied to the hero when the squad is picked
}

const NEUTRAL_PERK: PolicePerk = { bustRMult: 1, bustCdMult: 1, sprintMult: 1, regenMult: 1, drainMult: 1, scoreMult: 1 };

export const POLICE_OUTFITS: readonly PoliceOutfitDef[] = [
  {
    id: "city", label: "City Police", emoji: "🚓",
    tagline: "The classic beat officer — navy uniform, shiny badge, peaked cap.",
    perkLabel: "Beat fitness — stamina recovers 25% faster",
    stats: { ...NEUTRAL_PERK, regenMult: 1.25 },
    look: { outfit: "city", shirt: "#2e4f9e", pants: "#1c2a4e", shoe: "#111111", cap: true, capColor: "#1c2a4e", glasses: false },
  },
  {
    id: "traffic", label: "Traffic Police", emoji: "🚦",
    tagline: "White uniform, glowing hi-viz band — master of the busy crossing.",
    perkLabel: "Quick cuffs — bust recovery 45% faster",
    stats: { ...NEUTRAL_PERK, bustCdMult: 0.55 },
    look: { outfit: "traffic", shirt: "#eef2f7", pants: "#1c2a4e", shoe: "#111111", cap: true, capColor: "#eef2f7", glasses: false },
  },
  {
    id: "commando", label: "Commando / SWAT", emoji: "🎖️",
    tagline: "All-black tactical gear, helmet and chest plate — first one in.",
    perkLabel: "Tactical sprint — 12% faster while sprinting",
    stats: { ...NEUTRAL_PERK, sprintMult: 1.12 },
    look: { outfit: "commando", shirt: "#23272f", pants: "#16181d", shoe: "#111111", cap: true, capColor: "#101216", glasses: false },
  },
  {
    id: "army", label: "Army Soldier", emoji: "🪖",
    tagline: "Olive camo and a tilted beret — marches all day without tiring.",
    perkLabel: "March training — sprinting drains 30% slower",
    stats: { ...NEUTRAL_PERK, drainMult: 0.7 },
    look: { outfit: "army", shirt: "#4a5d3a", pants: "#33422a", shoe: "#3b2314", cap: true, capColor: "#3e4f30", glasses: false },
  },
  {
    id: "riot", label: "Riot Squad", emoji: "🛡️",
    tagline: "Heavy helmet with a visor and big shoulder pads — nothing gets past.",
    perkLabel: "Shield reach — bust radius 35% bigger",
    stats: { ...NEUTRAL_PERK, bustRMult: 1.35 },
    look: { outfit: "riot", shirt: "#2f3640", pants: "#22272e", shoe: "#111111", cap: true, capColor: "#191e24", glasses: false },
  },
  {
    id: "detective", label: "Detective / CID", emoji: "🕵️",
    tagline: "Plain trench coat, glasses, sharp eyes — solves every case.",
    perkLabel: "Case bonus — +25% score per bust",
    stats: { ...NEUTRAL_PERK, scoreMult: 1.25 },
    look: { outfit: "detective", shirt: "#b0a184", pants: "#3a3128", shoe: "#3b2314", cap: false, glasses: true, hairStyle: "bowl" },
  },
];

/** Look up a squad by id — unknown/empty ids fall back to the classic City Police. */
export function policeOutfitOf(id: string | undefined | null): PoliceOutfitDef {
  return POLICE_OUTFITS.find((o) => o.id === id) ?? POLICE_OUTFITS[0];
}
export const PANTS_COLORS = ["#2b3556", "#4a3b2a", "#7a3b3b", "#2a6f4f", "#444a55", "#8a5aa8"];
export const SHOE_COLORS = ["#3b2314", "#111111", "#f5f5f5", "#e0483a", "#2a6fdb"];
export const HAIR_COLORS = ["#1a1210", "#5a3a1a", "#c88a4a", "#e8c15a", "#d8d8d8", "#b03030", "#4a4a58"];
export const CAP_COLORS = ["#e0483a", "#2a9d8f", "#f5a524", "#2b3556", "#e91e8c", "#7bc043", "#f8f4e8", "#111111"];
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: "spiky", label: "Spiky" },
  { id: "bowl", label: "Bowl" },
  { id: "ponytail", label: "Ponytail" },
  { id: "twintails", label: "Twintails" },
  { id: "mohawk", label: "Mohawk" },
  { id: "curly", label: "Curly" },
  { id: "afro", label: "Afro" },
  { id: "bun", label: "Bun" },
  { id: "bald", label: "Bald" },
];

export const CIVIL_NAMES = [
  "Chintu", "Pintu", "Babli", "Golu", "Rani", "Munna", "Chotu", "Pinky",
  "Bholu", "Guddu", "Laddo", "Shona", "Titli", "Pappu", "Bunty", "Jhumri",
];

export const defaultAppearance = (): Appearance => ({
  fac: "protester",
  outfit: "",
  skin: SKIN_TONES[1],
  shirt: SHIRT_COLORS[0],
  pants: PANTS_COLORS[0],
  shoe: SHOE_COLORS[0],
  hair: HAIR_COLORS[0],
  hairStyle: "spiky",
  cap: true,
  capColor: "#e0483a",
  glasses: false,
  age: "young",
  girl: false,
});

/** Merge saved/legacy appearances that may predate newer fields. */
export function normalizeAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  return { ...defaultAppearance(), ...(a ?? {}) };
}

/* ---------- Outfit presets & randomizer (character creator) ---------- */
export interface OutfitPreset { id: string; label: string; emoji: string; look: Partial<Appearance> }
export const OUTFIT_PRESETS: readonly OutfitPreset[] = [
  {
    id: "cricket", label: "Cricket Star", emoji: "🏏",
    look: { shirt: "#7bc043", pants: "#444a55", shoe: "#f5f5f5", hair: "#1a1210", hairStyle: "spiky", cap: true, glasses: false, age: "kid" },
  },
  {
    id: "bollywood", label: "Film Hero", emoji: "🎬",
    look: { shirt: "#e91e8c", pants: "#2b3556", shoe: "#e0483a", hair: "#1a1210", hairStyle: "ponytail", cap: false, glasses: false, age: "young", girl: true },
  },
  {
    id: "detective", label: "Detective", emoji: "🕵️",
    look: { shirt: "#f1e9d2", pants: "#4a3b2a", shoe: "#3b2314", hair: "#5a3a1a", hairStyle: "bowl", cap: false, glasses: true, age: "teen" },
  },
  {
    id: "nana", label: "Wise Elder", emoji: "🧓",
    look: { shirt: "#f5a524", pants: "#7a3b3b", shoe: "#3b2314", hair: "#d8d8d8", hairStyle: "bald", cap: false, glasses: true, age: "old" },
  },
  {
    id: "maverick", label: "Daredevil", emoji: "🛹",
    look: { shirt: "#00b4d8", pants: "#8a5aa8", shoe: "#111111", hair: "#b03030", hairStyle: "mohawk", cap: false, glasses: true, age: "teen" },
  },
  {
    id: "dancer", label: "Bhangra King", emoji: "💃",
    look: { shirt: "#ff6b35", pants: "#2a6f4f", shoe: "#e0483a", hair: "#e8c15a", hairStyle: "curly", cap: false, glasses: false, age: "young" },
  },
  {
    id: "superkid", label: "Super Kid", emoji: "🦸",
    look: { shirt: "#2a9d8f", pants: "#2b3556", shoe: "#e0483a", hair: "#1a1210", hairStyle: "spiky", cap: true, capColor: "#e0483a", glasses: false, age: "kid" },
  },
  {
    id: "popstar", label: "Pop Star", emoji: "🎤",
    look: { shirt: "#e91e8c", pants: "#8a5aa8", shoe: "#f5f5f5", hair: "#b03030", hairStyle: "bun", cap: false, glasses: false, age: "teen", girl: true },
  },
  {
    id: "dada", label: "Cool Dada", emoji: "🕶️",
    look: { shirt: "#00b4d8", pants: "#444a55", shoe: "#111111", hair: "#4a4a58", hairStyle: "afro", cap: false, glasses: true, age: "teen" },
  },
];

/** Random look for the 🎲 button. */
export function randomAppearance(rnd: () => number = Math.random): Appearance {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const styles = HAIR_STYLES.map((h) => h.id);
  const ages = Object.keys(AGE_STATS) as AgeGroup[];
  return {
    fac: "protester", // the side stays a deliberate choice — never randomized
    outfit: "",
    skin: pick(SKIN_TONES),
    shirt: pick(SHIRT_COLORS),
    pants: pick(PANTS_COLORS),
    shoe: pick(SHOE_COLORS),
    hair: pick(HAIR_COLORS),
    hairStyle: pick(styles),
    cap: rnd() < 0.45,
    capColor: pick(CAP_COLORS),
    glasses: rnd() < 0.3,
    age: pick(ages),
    girl: rnd() < 0.5,
  };
}

/** Suggested player names for the 🎲 name button. */
export const NAME_SUGGESTIONS: readonly string[] = [
  "Chintu", "Pintu", "Babli", "Golu", "Rani", "Munna", "Chotu", "Pinky",
  "Bholu", "Guddu", "Laddo", "Shona", "Titli", "Bunty", "Jhumri", "Kaalu",
  "Bijli", "Sheru", "Gudiya", "Pappu",
];

/** Funny strings for the landing-page marquee ticker. */
export const TICKER_LINES: readonly string[] = [
  "🗳️ BREAKING: 16 votes missing from Parliament — police baffled!",
  "🚨 Wanted: one very fast child with pockets full of democracy.",
  "🐄 Cows block main road again — farmers apologise, cows do not.",
  "🧟 Graveyard neighbours request quiet after sunset. Zombies disagree.",
  "🪑 Parliament announces new record: most seats sat upon!",
  "🍵 Chai stalls report record profits during police chase season.",
  "🐒 Monkey union demands better mango benefits.",
  "🏃 Local kid outruns entire police squad — 'it was cardio', says kid.",
  "⚖️ Court rules: hiding behind a cow is technically legal.",
  "📻 Poll prediction: 100% chance of running.",
];

/* ---------- Pickups (collected into pockets, used from the HUD item bar) ---------- */
export interface ItemDef { name: string; emoji: string; hp: number; stamina: number; color: string; msg: string; kind: "fruit" | "kit" | "drink" }
export const ITEMS: readonly ItemDef[] = [
  { name: "Mango", emoji: "🥭", hp: 8, stamina: 20, color: "#ffa726", msg: "Sweet mango! Health restored.", kind: "fruit" },
  { name: "Samosa", emoji: "🥟", hp: 12, stamina: 15, color: "#e0a030", msg: "Crispy samosa. Yum!", kind: "fruit" },
  { name: "Jalebi", emoji: "🍩", hp: 6, stamina: 30, color: "#ff8c1a", msg: "Sticky jalebi: speedy!", kind: "fruit" },
  { name: "Laddu", emoji: "🍡", hp: 10, stamina: 25, color: "#f0c040", msg: "Laddu power activated!", kind: "fruit" },
  { name: "First-aid kit", emoji: "🩹", hp: 45, stamina: 0, color: "#e0483a", msg: "First-aid kit! All patched up.", kind: "kit" },
  { name: "Chai", emoji: "☕", hp: 4, stamina: 45, color: "#c88a4a", msg: "Chai break! Energy restored.", kind: "drink" },
  { name: "Coconut water", emoji: "🥥", hp: 8, stamina: 35, color: "#eeeedd", msg: "Coconut water. Hydrated!", kind: "drink" },
];
export const ITEM_COUNT = 30;
export const PICKUP_RADIUS = 1.9;
export const ITEM_RESPAWN_S = 22;

/* ---------- Inventory (HUD bottom-left item bar) ---------- */
export const INV_SLOTS = 8;    // fixed hotbar size — empty slots render as dashed boxes
export const INV_STACK = 5;    // max copies of one kind
export const JUMP_COST = 5;    // stamina per jump
export const HURT_FLASH_S = 0.55; // red vignette length after taking damage

/* ---------- Votes (the core loop) ---------- */
export const TOTAL_VOTES = 16;
export const MAX_CARRY = 3;
export const CARRY_RADIUS = 1.7;
export const DELIVER_RADIUS = 4;
export const DROP_SCATTER = 3.2;

/* ---------- Police ---------- */
export const POLICE_COUNT = 18; // more police for the bigger city
export const POLICE_SPEED = 5.9;
export const POLICE_SPRINT = 7.6;
export const DETECT_BASE = 13;
export const DETECT_CARRY_BONUS = 9;
export const DETECT_STAR_BONUS = 2.2;
export const CATCH_RADIUS = 1.35;
export const DETAIN_SECONDS = 14; // lock-up time at the station — the van ride adds travel drama
export const RELEASE_GRACE_S = 10; // post-release grace — cops can't spot or catch you while it lasts
export const STAR_DECAY_S = 45;
export const ESCAPE_LOST_S = 4.5;

/* ---------- Civilians & rescue ---------- */
export const CIVILIAN_COUNT = 94; // 18 police + 94 civilians = 112 bots in the bigger city
export const RESCUE_RADIUS = 3.4;
export const RESCUE_POINTS = 60;

/* ---------- Police arrest civilians too (old-game bots homage) ---------- */
export const CIV_DETECT = 11;     // cops only notice loitering civilians this close — players are far more suspicious
export const CIV_DETAIN_S = 25;   // an arrested civilian waits in the pink bubble this long, then walks free
export const CIV_COP_CD = 18;     // after an arrest the cop patrols normally before hunting another civilian
export const CIV_FLEE_MULT = 1.9; // panic speed multiplier while a cop is chasing
export const MAX_CIV_HELD = 4;    // never arrest more than this many civilians at once — keep the city lively
export const CIV_JAIL_S = 40;     // once the van delivers a civ to the station cage, they wait this long

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

/* ---------- Police van fleet: arrest transport to the nearest station ---------- */
export const VAN_SPEED = 22;       // u/s — vans respond fast, sirens on
export const VAN_LOAD_S = 1.6;     // seconds to load a prisoner at the capture point
export const VAN_UNLOAD_S = 1.2;   // seconds to unload at the station
export const VAN_AXLE = 1.7;       // front/rear axle offset for the solid footprint
export const VAN_RADIUS = 1.25;    // axle-circle radius for collisions
export const CONFISCATE_FINE = 40; // support points the police fine you on lock-up

/* ---------- Ring-road traffic & the cartoon car bonk (old-game hurt() homage) ---------- */
export const TRAFFIC_COUNT = 12; // cars cruising the ring highway, two lanes, both directions
export const FAINT_S = 1.7;      // how long the world spins (dizzy stars) after a car bonk
export const CAR_HIT_CD = 1.5;   // old-game hitCd — minimum seconds between two car knocks
export const CAR_HIT_DMG = 6;    // hp lost per bonk — never knocks you below 1, cars don't arrest

/* ---------- Playable Police side — "Stop the Vote Runners" ---------- */
export const RUNNER_COUNT = 14;           // AI vote-runners operating among the civilians
export const BUST_TARGET = 12;            // runners the officer must bust to win the shift
export const RUNNER_LOSE_DELIVERIES = 10; // if runners get this many votes through, the shift is lost
export const RUNNER_VOTE_RESPAWN_S = 9;   // a delivered vote "sneaks back" into the city after this long
export const RUNNER_FLEE_R = 9;           // runners panic when the officer gets this close
export const RUNNER_CATCH_R = 2.1;        // walk into a runner to bust them
export const RUNNER_CATCH_CD = 0.9;       // min seconds between two busts
export const BUST_POINTS = 150;           // score per busted runner
export const BUST_CARRY_BONUS = 100;      // extra score when the runner was carrying a vote

/* ---------- Rare super powers (glowing jungle finds & mystery spots) ---------- */
export type PowerKind = "sonic" | "jump" | "blink" | "morph" | "magnet";
export interface PowerDef {
  kind: PowerKind; name: string; emoji: string;
  color: string;        // gem + glow colour
  duration: number;     // seconds the power stays active
  msg: string;          // pickup toast
  tip: string;          // HUD badge hint
}
export const POWERS: readonly PowerDef[] = [
  { kind: "sonic",  name: "Sonic Dash",    emoji: "⚡", color: "#22d3ee", duration: 12,
    msg: "⚡ SONIC DASH unleashed! Your legs are a blur — outrun EVERYONE!", tip: "Run speed ×1.9 · free sprint" },
  { kind: "jump",   name: "Kangaroo Leap", emoji: "🦘", color: "#84cc16", duration: 14,
    msg: "🦘 KANGAROO LEAP unleashed! Jump like a superhero — bounce over anything!", tip: "Jump height ×1.65 · free jumps" },
  { kind: "blink",  name: "Blink Teleport", emoji: "🌀", color: "#c084fc", duration: 15,
    msg: "🌀 BLINK unleashed! Press Q (or tap 🌀) to teleport where you LOOK — poof!", tip: "Press Q to teleport" },
  { kind: "morph",  name: "Animal Morph",  emoji: "🐒", color: "#fbbf24", duration: 22,
    msg: "🐒 ANIMAL MORPH unleashed! You look like an animal — police can't catch you!", tip: "Police can't spot you" },
  { kind: "magnet", name: "Food Magnet",   emoji: "🧲", color: "#fb7185", duration: 15,
    msg: "🧲 FOOD MAGNET unleashed! Nearby snacks fly straight into your pockets!", tip: "Pulls nearby food" },
];
export const POWER_COUNT = 6;        // very rare — only 6 gems in the whole world
export const POWER_RESPAWN_S = 80;   // a long absence keeps them feeling special
export const POWER_PICKUP_R = 2.2;
/** Power spawns: mostly deep-jungle treasures, the rest hidden at random mystery spots. */
export const POWER_JUNGLE_SHARE = 0.7;

export const SONIC_MULT = 1.9;       // run/sprint speed multiplier while Sonic Dash lasts
export const JUMP_MULT = 1.65;       // jump velocity multiplier while Kangaroo Leap lasts
export const BLINK_DIST = 15;        // teleport distance
export const BLINK_CD = 0.9;         // seconds between blinks
export const MAGNET_RADIUS = 14;     // food pull radius
export const MAGNET_PULL = 12;       // units/second snacks fly toward you
export const MORPH_ANIMALS: readonly AnimalKind[] = ["cow", "chicken", "deer", "monkey"];

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
