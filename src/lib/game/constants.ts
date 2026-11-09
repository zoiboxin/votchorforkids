/** 7Nights — shared constants. A spooky (but kid-friendly) survival story. */

export const WORLD_SEED = 1337;
/** The world grew! City → farmland → BIG jungle → DEEP jungle → climbable ⛰️ mountains → wall. */
export const WALL_RADIUS = 712;
export const CITY_RADIUS = 405;
export const FARM_RADIUS = 465;
/** outer edge of the DEEP jungle band (deep jungle = DEEP_JUNGLE_RADIUS → JUNGLE_RADIUS) */
export const JUNGLE_RADIUS = 610;
/** inner edge of the DEEP jungle — the darker, denser band hugging the mountains */
export const DEEP_JUNGLE_RADIUS = 545;
/** Playable ⛰️ mountain band — rough, scary, and CLIMBABLE (see worldgen.terrainHeight). */
export const MOUNTAIN_INNER = 610;
export const MOUNTAIN_OUTER = 700;
export const GRAVEYARD = { x: -255, z: 215, r: 45 } as const;
export const SPAWN = { x: 0, z: 6 } as const;

/* ---------- 7Nights International Airport (south-east, outside the ring highway) ----------
   A working airport: the runway is flat & walkable, the terminal / tower / hangar are solid.
   Bot planes taxi out, take off, circle the city and land back — all on their own.       */
export const AIRPORT = {
  /** runway along +x at z = rz, thresholds at rx0/rx1 (take-off & landing heading east→west) */
  rx0: 225, rx1: 385, rz: 300, rw: 16,
  apronZ: 324,
  terminal: { x: 258, z: 342, w: 26, d: 10, h: 12 },
  tower: { x: 292, z: 344, r: 3.2, h: 30 },
  hangar: { x: 336, z: 342, w: 24, d: 14, h: 13 },
} as const;
export const PLANE_COUNT = 3;
export const DAY_SECONDS = 360;
export const GRAVITY = 22;

/* ---------- jump feel ---------- */
export const COYOTE_S = 0.12;        // grace window to jump after walking off an edge
export const DOUBLE_JUMP_VY = 0.92;  // double-jump power as a fraction of the ground jump
export const JUMP2_COST = 8;         // extra stamina for the mid-air double jump
export const FLIP_S = 0.55;          // front-flip duration after a double jump
export const LAND_SQUASH_S = 0.16;   // landing squash-and-stretch duration

/** The grand CITY MUSEUM rotunda on the north vista — the town's landmark.
 *  BALLOT is a legacy plaza point kept for the retired old-game chase mode. */
export const MUSEUM = { x: 0, z: -196 } as const;
export const BALLOT = { x: 0, z: -170 } as const;

/* ---------- Police stations (one per city quadrant, with a van gate + jail cage) ---------- */
export interface StationDef { x: number; z: number; name: string }
export const POLICE_STATIONS: readonly StationDef[] = [
  { x: -168.75, z: -168.75, name: "Oakwood Precinct" },
  { x: 168.75, z: -168.75, name: "Ring Road Precinct" },
  { x: -168.75, z: 168.75, name: "Lakeview Precinct" },
  { x: 168.75, z: 168.75, name: "Old Town Precinct" },
];
/** Where the van stops & the player is released — the block-side facing town. */
export const stationGate = (s: StationDef) => ({ x: s.x - Math.sign(s.x) * 17, z: s.z - Math.sign(s.z) * 17 });
/** Fenced evidence cage behind the station — confiscated loot & jailed bots live here. */
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
  "Alex", "Bella", "Coco", "Dana", "Emil", "Frida", "Gus", "Hazel",
  "Iris", "Juno", "Kai", "Luna", "Milo", "Nora", "Otis", "Pip",
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
    id: "bollywood", label: "Movie Star", emoji: "🎬",
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
    id: "dancer", label: "Dance King", emoji: "💃",
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
    id: "dada", label: "Cool Dude", emoji: "🕶️",
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
  "Alex", "Bella", "Coco", "Dana", "Emil", "Frida", "Gus", "Hazel",
  "Iris", "Juno", "Kai", "Luna", "Milo", "Nora", "Otis", "Pip",
  "Quinn", "Remy", "Sage", "Tavi",
];

/** Funny strings for the landing-page marquee ticker. */
export const TICKER_LINES: readonly string[] = [
  "🌙 NIGHT 1 of 7 — the town sleeps with one eye open.",
  "🚨 Wanted: one very fast kid with pockets full of snacks.",
  "🍫 Bakery reports: the chocolate shelf is EMPTY. Witnesses saw a sprinting silhouette.",
  "🧟 Graveyard neighbours request quiet after sunset. Zombies disagree.",
  "🏛️ Museum announces new exhibit: 'Things That Follow You At Night'. Closing night: forever.",
  "🧃 Juice stall records record profits during sprint season.",
  "🐒 Monkey union demands better banana benefits.",
  "🏃 Local kid outruns the entire zombie horde — 'it was cardio', says kid.",
  "🔥 Fire marshal rules: hiding behind a campfire is technically legal.",
  "📻 Night prediction: 100% chance of running.",
  "🪪 DMV announces: driving licenses now rain from the sky — collect one and ANY parked car is yours.",
  "🚗 Traffic update: a kid was seen doing 90 near the mall… without a license. Scandal!",
];

/* ---------- Pickups (collected into pockets, used from the HUD item bar) ----------
 * A universal snack shelf: fruits, chocolate, cake, juice & power drinks.  */
export interface ItemDef { name: string; emoji: string; hp: number; stamina: number; color: string; msg: string; kind: "fruit" | "kit" | "drink" }
export const ITEMS: readonly ItemDef[] = [
  { name: "Apple", emoji: "🍎", hp: 8, stamina: 20, color: "#e0483a", msg: "Crisp apple! Health restored.", kind: "fruit" },
  { name: "Chocolate", emoji: "🍫", hp: 12, stamina: 15, color: "#6b3f24", msg: "Rich chocolate. Yum!", kind: "fruit" },
  { name: "Cake", emoji: "🍰", hp: 10, stamina: 25, color: "#f8b9d4", msg: "Sweet cake slice: speedy!", kind: "fruit" },
  { name: "Banana", emoji: "🍌", hp: 6, stamina: 30, color: "#ffd24a", msg: "Banana power activated!", kind: "fruit" },
  { name: "First-aid kit", emoji: "🩹", hp: 45, stamina: 0, color: "#e0483a", msg: "First-aid kit! All patched up.", kind: "kit" },
  { name: "Juice", emoji: "🧃", hp: 4, stamina: 45, color: "#ffa726", msg: "Fresh juice! Energy restored.", kind: "drink" },
  { name: "Power drink", emoji: "🥤", hp: 8, stamina: 35, color: "#38e0c8", msg: "Power drink. Charged up!", kind: "drink" },
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
export const POLICE_COUNT = 22; // more police for the bigger 9×9 city
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
export const CIVILIAN_COUNT = 110; // 22 police + 110 civilians = 132 bots across the bigger city
export const RESCUE_RADIUS = 3.4;
export const RESCUE_POINTS = 60;

/* ---------- Police arrest civilians too (old-game bots homage) ---------- */
export const CIV_DETECT = 11;     // cops only notice loitering civilians this close — players are far more suspicious
export const CIV_DETAIN_S = 25;   // an arrested civilian waits in the pink bubble this long, then walks free
export const CIV_COP_CD = 18;     // after an arrest the cop patrols normally before hunting another civilian
export const CIV_FLEE_MULT = 1.9; // panic speed multiplier while a cop is chasing
export const MAX_CIV_HELD = 4;    // never arrest more than this many civilians at once — keep the city lively
export const CIV_JAIL_S = 40;     // once the van delivers a civ to the station cage, they wait this long

/* ---------- Living-city bots: human-like scavengers, de-clumped spawns ---------- */
export const SCAVENGER_COUNT = 16;      // civilians who hunt loose votes & haul them to the protest camp
export const SCAVENGER_SENSE_R = 110;   // how far a scavenger "notices" a loose vote
export const BOT_SPAWN_GAP = 15;        // min spacing (u) between bot spawn points — no clumped spawns
export const HAUL_CAMP_R = 6;           // a scavenger releases their vote once this close to the protest camp

/* ---------- Zombies ---------- */
export const ZOMBIE_COUNT = 9;
export const ZOMBIE_SPEED = 3.4;
export const ZOMBIE_NIGHT_SPEED = 4.6;
export const ZOMBIE_DMG = 8;
export const ZOMBIE_TOUCH_CD = 1.2;
export const GRAVEYARD_CENTER = GRAVEYARD;

/* ---------- Animals ---------- */
export type AnimalKind = "cow" | "chicken" | "deer" | "monkey" | "dog";
export const ANIMAL_SET: { kind: AnimalKind; count: number; zone: "farm" | "jungle" | "city" }[] = [
  { kind: "dog", count: 9, zone: "city" },
  { kind: "cow", count: 5, zone: "farm" },
  { kind: "chicken", count: 7, zone: "farm" },
  { kind: "deer", count: 4, zone: "jungle" },
  { kind: "monkey", count: 4, zone: "jungle" },
];

/* ---------- 🐕 street dogs & 🧟 zombie hounds ----------
 * Friendly strays roam the city by day — curious, they amble up to you and
 * bark hello. When night falls, EVERY stray turns into a rotting hound that
 * hunts the living: faster than any shambler, but frail (3 punches).         */
export const DOG_SPEED = 3.2;         // daytime trot toward a friendly hello
export const ZOMDOG_HP = 26;          // 3 punches / 1 sword — frail but fast
export const ZOMDOG_SPEED = 5.7;      // faster than every zombie — RUN
export const ZOMDOG_DMG = 11;         // a bite tears 11 hp
export const ZOMDOG_SENSE = 44;       // they smell you from across the block
export const ZOMDOG_TOUCH_CD = 1.0;   // seconds between bites
export const POINTS_KILL_ZOMDOG = 25; // putting a hound down pays a little

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

/* ---------- Rare super powers (glowing jungle finds & mystery spots) ----------
 *  Note: the map grew, so gems now also hide on the ⛰️ mountain slopes!        */
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
/** How many power gems the player can carry at once — each fires ONCE (G / slot tap). */
export const POWER_POCKETS = 3;
/** Alias of POWER_POCKETS kept for the 7Nights engine imports. */
export const POWER_CARRY = POWER_POCKETS;
/** 🧱 dormant builder-pool circles parked under the museum podium (moved onto build spots at runtime). */
export const BUILD_POOL = 26;
/** Power spawns: mostly deep-jungle treasures, the rest hidden at random mystery spots. */
export const POWER_JUNGLE_SHARE = 0.7;

export const SONIC_MULT = 1.9;       // run/sprint speed multiplier while Sonic Dash lasts
export const JUMP_MULT = 1.65;       // jump velocity multiplier while Kangaroo Leap lasts
export const BLINK_DIST = 15;        // teleport distance
export const BLINK_CD = 0.9;         // seconds between blinks
export const MAGNET_RADIUS = 14;     // food pull radius
export const MAGNET_PULL = 12;       // units/second snacks fly toward you
export const MORPH_ANIMALS: readonly AnimalKind[] = ["cow", "chicken", "deer", "monkey"];

/* ---------- GTA-style driving — license cards unlock every parked car ---------- */
export const LICENSE_COUNT = 8;        // glowing 🪪 cards hidden around town & farmland
export const LICENSE_PICKUP_R = 2.4;   // walk-over radius
export const CAR_ENTER_R = 3.6;        // how close you must walk to a parked car to hop in
export const CAR_MAX_SPEED = 26;       // u/s — way faster than any sprinting kid
export const CAR_REV_SPEED = 9;        // u/s reverse
export const CAR_ACCEL = 14;           // u/s² on W
export const CAR_BRAKE = 30;           // u/s² on S while rolling forward
export const CAR_COAST = 9;            // u/s² natural drag when no pedal
export const CAR_STEER = 1.75;         // rad/s at full lock
/* ---------- Vehicle fleet — 6 body styles shared by parked cars & ring traffic ----------
 * 0 sedan · 1 hatchback · 2 van · 3 pickup truck · 4 city bus · 5 jeep */
export const VEHICLE_LABELS = ["🚗 Car", "🚗 Hatchback", "🚐 Van", "🛻 Pickup truck", "🚌 City bus", "🚙 Jeep"];
/** Weighted body-style pool — sedans/hatches/vans fill the streets, buses stay rare. */
export const VEHICLE_POOL: readonly number[] = [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 5];
export const pickVehicle = (r: () => number): number => VEHICLE_POOL[Math.floor(r() * VEHICLE_POOL.length)];
/** Per body-style collision dims: the driven body collides as its two axle discs —
 *  the SAME offset/radius pair the parked cars use as colliders, so a moving vehicle
 *  can never overlap a building deeper than a parked one. Longer bodies (bus, pickup)
 *  spread their axles further apart so the nose & tail stay protected. */
export const VEHICLE_AXLE: readonly number[] = [1.25, 1.02, 1.5, 1.78, 2.35, 1.12];
export const VEHICLE_AXLE_R: readonly number[] = [1.16, 1.12, 1.26, 1.3, 1.42, 1.2];
/** Per body-style driving feel: top speed (u/s) and steering grip multiplier —
 *  a loaded bus shouldn't corner like a go-kart. */
export const VEHICLE_TOP: readonly number[] = [26, 24, 24, 23, 19, 25];
export const VEHICLE_STEER: readonly number[] = [1, 1, 0.92, 0.85, 0.7, 1];

/* ---------- Scoring ---------- */
export const POINTS_DELIVER = 120;
export const POINTS_PICKUP = 10;
export const POINTS_RESCUE = 60;
export const WIN_BONUS = 500;

export type Zone = "City" | "Farmland" | "Jungle" | "Deep Jungle" | "Graveyard" | "Mountains" | "Mountain Wall";
export function zoneOf(x: number, z: number): Zone {
  if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < 45) return "Graveyard";
  const r = Math.hypot(x, z);
  return r < CITY_RADIUS ? "City"
    : r < FARM_RADIUS ? "Farmland"
    : r < DEEP_JUNGLE_RADIUS ? "Jungle"
    : r < JUNGLE_RADIUS ? "Deep Jungle"
    : r < MOUNTAIN_OUTER ? "Mountains"
    : "Mountain Wall";
}

export const ZONE_TOAST: Record<Zone, string> = {
  City: "The city — gather supplies before dark…",
  Farmland: "Farmland — barns make good hiding spots.",
  Jungle: "The big jungle… something in here is WATCHING.",
  "Deep Jungle": "DEEP jungle — dark, dense… and it WATCHES BACK.",
  Graveyard: "Graveyard! At night the zombies wake up…",
  Mountains: "⛰️ The SCARY Mountains — high ground hides you from the beast… mostly.",
  "Mountain Wall": "The world ends here. Turn back!",
};

/* ================= 7 Nights — the survival-horror storyline =================
 * You and 7 fellow survivors must last 7 nights. Days are for gathering wood
 * & stone, building defenses and finding tools. At dusk a warning sounds —
 * ONE of the players is chosen by the dark spirit. At night they transform
 * into a beast and hunt everyone else. Survive until dawn, then decide:
 * inspect the bodies, follow the clues… and ACCUSE the suspect. The last
 * one standing — or anyone who sees the 7th dawn — wins.               */
export const NIGHTS_TOTAL = 7;
export const PHASE_DAY_S = 110;   // gather, build, accuse
export const PHASE_DUSK_S = 16;   // warning sirens — the spirit chooses its host
export const PHASE_NIGHT_S = 75;  // the beast hunts
export const PHASE_DAWN_S = 9;    // recap, then a new day
export type Phase = "day" | "dusk" | "night" | "dawn";

/* ---------- 🧱 THE WALL — PUBG-style shrinking safe zone ----------
 * After EVERY night a shimmering transparent wall slams down around the
 * town, and each night it tightens further. Anyone caught beyond the wall
 * (player, contestant, townsfolk — everyone) withers: health drains until
 * they fall. The radii walk city → downtown → a final arena:
 *   lv0 (day 1)  = whole map, no pressure
 *   lv1 (day 2)  = 430u  — farmland abandoned, camps beyond reach
 *   lv2 (day 3)  = 300u  — the jungle is gone
 *   lv3 (day 4)  = 200u  — city outskirts die
 *   lv4 (day 5)  = 130u  — downtown core only
 *   lv5 (day 6)  = 82u
 *   lv6 (day 7)  = 46u   — a screaming final arena            */
export const ZONE_RADII: readonly number[] = [712, 430, 300, 200, 130, 82, 46];
export const ZONE_DRAIN_BASE = 4;    // hp/s outside the wall at level 1
export const ZONE_DRAIN_STEP = 1.8;  // extra hp/s per extra level (late walls bite harder)
export const ZONE_GRACE_S = 14;      // seconds after a shrink before the drain hits full strength
export const ZONE_WALL_H = 26;       // visual height of the transparent wall (u)

/* ---------- arms & tools (collect multiple of the same!) ---------- */
export type ToolKind = "axe" | "sword" | "hammer" | "builder";
export interface ToolDef {
  kind: ToolKind; name: string; emoji: string; color: string;
  dmg: number;   // damage per hit vs the possessed / zombies
  tip: string;   // one-line HUD hint
}
export const TOOLS: readonly ToolDef[] = [
  { kind: "axe",     name: "Axe",     emoji: "🪓", color: "#b06a3b", dmg: 22, tip: "Hold near a tree & swing (F) — wood for building" },
  { kind: "sword",   name: "Sword",   emoji: "🗡️", color: "#aabccb", dmg: 40, tip: "Fight the beast! (F) — 2 hits slay it" },
  { kind: "hammer",  name: "Hammer",  emoji: "🔨", color: "#9aa5b1", dmg: 18, tip: "Smash boulders (F) — stone for campfires" },
  { kind: "builder", name: "Builder", emoji: "🔧", color: "#e0a458", dmg: 12, tip: "B = barricade (4🪓) · V = campfire (2🪓+2🪨)" },
];
export const TOOL_SPAWN: Record<ToolKind, number> = { axe: 5, sword: 5, hammer: 5, builder: 3 };
export const WOOD_PER_TREE = 2;
export const ROCK_PER_BOULDER = 2;
export const TREE_HITS = 3;   // axe swings to fell a tree
export const ROCK_HITS = 2;   // hammer swings to smash a boulder
export const ROCK_COUNT = 54; // boulders scattered across farmland & jungle edge
export const BARRICADE_COST = { wood: 4, rock: 0 } as const;
export const CAMPFIRE_COST = { wood: 2, rock: 2 } as const;
export const BARRICADE_HP = 100;
export const CAMPFIRE_R = 8;        // beasts & zombies shy away from fire
export const ATTACK_CD = 0.45;
export const ATTACK_RANGE = 2.7;
export const HANDS_DMG = 10;
export const TOOL_PICKUP_R = 2.1;

/* ---------- the contest — 100 players enter, ONE walks out ---------- */
/** Total souls in the 7-Nights contest: YOU + 99 AI contestants.
 *  Each dusk ~HALF of everyone still alive turns; the turned must FEED before
 *  dawn or crumble — so the lobby bleeds down night by night to one winner. */
export const PLAYERS_TOTAL = 100;
export const CREW_COUNT = PLAYERS_TOTAL - 1; // 99 AI contestants (you are #100)
const CREW_FIRSTS = ["Mia", "Ryan", "Zoe", "Kofi", "Anya", "Marco", "Luna", "Sasha", "Theo", "Ines", "Rafa", "Nova", "Elsa", "Dmitri"];
const CREW_SURNAMES = ["Stone", "Rivera", "Novak", "Hayes", "Okafor", "Lind", "Moreau"];
/** 99 unique contestant names — the originals first, then first+surname combos. */
export const CREW_NAMES: readonly string[] = Array.from({ length: CREW_COUNT }, (_, i) =>
  i < 7 ? CREW_FIRSTS[i] : `${CREW_FIRSTS[i % CREW_FIRSTS.length]} ${CREW_SURNAMES[Math.floor(i / CREW_FIRSTS.length) % CREW_SURNAMES.length]}`);
export const CREW_COLORS: readonly string[] = ["#e91e8c", "#7bc043", "#00b4d8", "#f5a524", "#8a5aa8", "#ff6b35", "#2a9d8f"];
/** Human-readable color words — body clues reference these ("torn PINK cloth…"). */
export const CREW_COLOR_NAMES: readonly string[] = ["PINK", "GREEN", "BLUE", "ORANGE", "PURPLE", "RED", "TEAL"];
export const CREW_SPEED = 4.4;
export const CREW_HP = 60;
export const HUNTER_SPEED = 6.1;    // the possessed is FAST — but barricades & fire help
export const HUNTER_HP = 70;
export const HUNTER_DMG = 24;       // hp torn from the player per hit
export const HUNTER_TOUCH_CD = 1.15;
export const CLAW_DMG = 34;         // player-as-beast hit on crew
export const ZOMBIE_HP = 36;        // zombies can be slain — punch 4 hits, sword 1
export const ZOMBIE_CREW_DMG = 20;  // hp torn from an AI contestant per zombie grab
export const POSSESS_PLAYER_CHANCE = 0.4; // per night — the spirit loves a good scare
export const PLAYER_NIGHTS = [3, 6];      // …and NEVER misses these nights
/** How MANY survivors the spirit possesses each night — the pack grows as the
 *  week wears on: night 1-3 → 2 beasts · 4-5 → 3 · 6-7 → 4 (you can be one!). */
export const beastsForNight = (n: number): number => Math.min(4, 2 + (n >= 4 ? 1 : 0) + (n >= 6 ? 1 : 0));
export const ACCUSE_RADIUS = 3.4;
export const POINTS_NIGHT = 80;
export const POINTS_KILL_BEAST = 200;
export const POINTS_KILL_ZOMBIE = 40;
export const POINTS_RIGHT_ACCUSE = 200;
export const POINTS_WRONG_ACCUSE = -60;
export const POINTS_BUILD = 30;
export const POINTS_HARVEST = 15;

/* ---------- 💰 money — the old vote chase is retired, cash rules the town ---------- */
export const MONEY_PER_PILE = 25;        // a 💰 cash pile lying around town
export const CASH_RESPAWN_S = 70;        // scattered cash re-stocks somewhere else
export const CREW_PURSE: readonly [number, number] = [40, 120]; // $ each survivor carries
export const CIV_PURSE: readonly [number, number] = [10, 60];   // $ each townsfolk carries
export const ZOMBIE_PURSE: readonly [number, number] = [10, 30]; // $ dropped by a slain zombie
export const POINTS_LOOT = 5;            // points per $ pickup (money ALSO scores)
/** Zombies & beasts terrify everyone: bots panic-flee within this range… */
export const CIV_PANIC_R = 11;
export const CREW_PANIC_R = 12;
/** …and graveyard zombies SHUFFLE after any living soul (player or townsfolk). */
export const ZOMBIE_HUNT_R = 26;

/* ---------- 🤖 bots forage too — food, money & power gems ---------- */
export const CREW_SEEK_R = 42;       // a bot walks this far off-path to grab a snack/pile
export const CREW_EAT_R = 1.7;       // close enough to scoop it up
export const CREW_BOOST_S = 22;      // ⚡ a pocketed power gem supercharges a bot this long
export const CREW_BOOST_MULT = 1.35; // …moving this much faster while it lasts

/* ---------- 👮 crime & punishment — the law is watching ---------- */
export const CRIME_SEE_R = 30;         // a cop this close (with clear sight) witnesses the crime
export const CRIME_CIV_SEE_R = 20;     // a townsfolk witness screams & runs to report it
export const CRIME_REPORT_RANGE = 120; // cops this close answer the report & walk to the scene
export const CRIME_REPORT_T = 9;       // seconds a witness report stays hot
export const WARRANT_DETECT = 20;      // while wanted (stars > 0) cops recognize you this close
export const CRIME_STAR_MURDER = 2;    // wanted stars for a witnessed murder
export const CRIME_STAR_MINOR = 1;     // wanted stars for assault / robbery

/* ---------- horror-hint ticker lines (landing page) ---------- */
export const NIGHT_TICKER: readonly string[] = [
  "🌙 NIGHT 1 of 7 — the town sleeps with one eye open.",
  "⚠️ Dusk sirens again… whose eyes went BLACK today?",
  "🪓 lumber report: the jungle is losing trees — someone is building SOMETHING.",
  "🩸 Dawn body count: 1. Clue says the killer wore PINK…",
  "🔥 Campfires keep the beast away — the town approves.",
  "🧟 graveyard quiet. TOO quiet.",
  "🔪 'It was dark. I swung. I hope it was the beast.' — local survivor",
  "🌑 3 nights left. 3 survivors. The math is not good.",
];
