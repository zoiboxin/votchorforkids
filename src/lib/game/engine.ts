import {
  AGE_STATS, ANIMAL_SET, BALLOT, BLINK_CD, BLINK_DIST, BUST_CARRY_BONUS, BUST_POINTS, BUST_TARGET, CARRY_RADIUS, CAR_ACCEL, CAR_BRAKE, CAR_COAST, CAR_ENTER_R, CAR_HIT_CD, CAR_HIT_DMG, CAR_REV_SPEED, CAR_STEER, CIV_COP_CD, CIV_DETECT, CIV_DETAIN_S, CIV_FLEE_MULT, CIV_JAIL_S,
  CIVIL_NAMES, CIVILIAN_COUNT, CITY_RADIUS, CONFISCATE_FINE, DAY_SECONDS,
  DELIVER_RADIUS, DETECT_BASE, DETECT_CARRY_BONUS, DETECT_STAR_BONUS, DETAIN_SECONDS, DROP_SCATTER,
  ESCAPE_LOST_S, FARM_RADIUS, FAINT_S, FLIP_S, GRAVEYARD, HAUL_CAMP_R, HURT_FLASH_S, ITEMS, INV_SLOTS, ITEM_COUNT,
  DEEP_JUNGLE_RADIUS, MOUNTAIN_INNER, MOUNTAIN_OUTER,
  ITEM_RESPAWN_S, JUMP_COST, JUMP2_COST, JUMP_MULT, JUNGLE_RADIUS, LAND_SQUASH_S, LICENSE_COUNT, LICENSE_PICKUP_R, MAGNET_PULL, MAGNET_RADIUS, MAX_CARRY, MAX_CIV_HELD, MORPH_ANIMALS, PICKUP_RADIUS,
  POINTS_DELIVER, POINTS_PICKUP, POINTS_RESCUE, POLICE_COUNT, POLICE_SPEED, POLICE_SPRINT, POLICE_STATIONS, POWER_COUNT, POWER_JUNGLE_SHARE, POWER_PICKUP_R, POWER_RESPAWN_S, POWERS, RELEASE_GRACE_S, RESCUE_POINTS,
  RESCUE_RADIUS, RUNNER_CATCH_CD, RUNNER_CATCH_R, RUNNER_COUNT, RUNNER_FLEE_R, RUNNER_LOSE_DELIVERIES, RUNNER_VOTE_RESPAWN_S, SCAVENGER_COUNT, SCAVENGER_SENSE_R, SPAWN, SONIC_MULT, STAR_DECAY_S, TOTAL_VOTES, TRAFFIC_COUNT, VEHICLE_AXLE, VEHICLE_AXLE_R, VEHICLE_LABELS, VEHICLE_POOL, VEHICLE_STEER, VEHICLE_TOP, VAN_AXLE, VAN_LOAD_S, VAN_RADIUS, VAN_SPEED, VAN_UNLOAD_S,
  AIRPORT, PLANE_COUNT, POWER_CARRY,
  WALL_RADIUS, ZOMBIE_DMG, ZOMBIE_NIGHT_SPEED,
  ZOMBIE_SPEED, ZOMBIE_TOUCH_CD, DOG_SPEED, ZOMDOG_DMG, ZOMDOG_HP, ZOMDOG_SENSE, ZOMDOG_SPEED, ZOMDOG_TOUCH_CD, POINTS_KILL_ZOMDOG, BOT_SPAWN_GAP, policeOutfitOf, randomAppearance, stationCage, stationGate,
  WILDLIFE,
  ACCUSE_RADIUS, ATTACK_CD, ATTACK_RANGE, BARRICADE_COST, BARRICADE_HP, CAMPFIRE_COST, CAMPFIRE_R, CLAW_DMG,
  CREW_COLORS, CREW_COLOR_NAMES, CREW_COUNT, CREW_HP, CREW_NAMES, CREW_SPEED, HANDS_DMG, HUNTER_DMG, HUNTER_HP, HUNTER_SPEED,
  HUNTER_TOUCH_CD, NIGHTS_TOTAL, PHASE_DAY_S, PHASE_DAWN_S, PHASE_DUSK_S, PHASE_NIGHT_S,
  POINTS_BUILD, POINTS_HARVEST, POINTS_KILL_BEAST, POINTS_KILL_ZOMBIE, POINTS_NIGHT, POINTS_RIGHT_ACCUSE,
  POINTS_WRONG_ACCUSE, ROCK_HITS, ROCK_PER_BOULDER, TOOL_PICKUP_R, TOOL_SPAWN, TOOLS,
  TREE_HITS, WOOD_PER_TREE, WIN_BONUS, PLAYERS_TOTAL, ZOMBIE_CREW_DMG, ZOMBIE_HP,
  ZONE_DRAIN_BASE, ZONE_DRAIN_STEP, ZONE_GRACE_S, ZONE_RADII,
  MONEY_PER_PILE, CASH_RESPAWN_S, CREW_PURSE, CIV_PURSE, ZOMBIE_PURSE, POINTS_LOOT,
  CIV_PANIC_R, CREW_PANIC_R, ZOMBIE_HUNT_R, ZOMBIE_SNIFF, ZOMBIE_SWARM_CAP,
  TREE_FALL_S, TREE_WOBBLE_S, ROCK_BREAK_S,
  CREW_SEEK_R, CREW_EAT_R, CREW_BOOST_S, CREW_BOOST_MULT,
  CRIME_SEE_R, CRIME_CIV_SEE_R, CRIME_REPORT_RANGE, CRIME_REPORT_T, WARRANT_DETECT, CRIME_STAR_MURDER, CRIME_STAR_MINOR,
  type AnimalKind, type Appearance, type Phase, type PolicePerk, type PowerKind, type Side, type ToolKind, type Zone, zoneOf, ZONE_TOAST,
} from "./constants";
import { clamp, mulberry32, range } from "./rng";
import { addDynamicCircle, freeSpot, lineClear, refreshCarCircle, resolve, RING_R, ROADS, scatterSpots, spotNear, terrainHeight, TOWN_SQUARE, type CircleCollider, type World } from "./worldgen";
import { nightFactor, newBody, stepBody, stepNpc, type Body, type SteerMemory } from "./sim";
import { sfx, startDrone, stopDrone, setInsects, stopInsects } from "./audio";
import { preloadModels } from "./models";
import type { MpEvent } from "@/lib/game/net/client";

const TAU = Math.PI * 2; // full circle — used to keep the camera yaw wrapped

export type CopMode = "patrol" | "chase" | "return" | "celebrate";
export type CivilMode = "wander" | "flee" | "detained" | "rescued";

/* ---------------- bot planes — 7Nights International's random flights ----------------
 * Purely kinematic state machines: bots taxi out, take off eastwards, circle the
 * whole map at cruise altitude, then come back and land. No collisions — they're
 * sky traffic for kids to spot (and chase across the runway if they like). */
export type PlaneMode = "parked" | "taxi" | "roll" | "climb" | "joinArc" | "cruise" | "joinFinal" | "final" | "rollout" | "taxiBack";
export interface PlaneState {
  id: number;
  c: number;                    // livery colour index
  x: number; z: number; alt: number;
  hdg: number;                  // facing (rad) — 0 = +x (down the runway)
  pitch: number;                // visual nose tilt
  spd: number;                  // ground speed (u/s)
  mode: PlaneMode;
  t: number;                    // state timer (parked delay / rollout)
  slot: number;                 // apron parking slot
  wx: number; wz: number; walt: number;  // chase waypoint (taxi/final legs)
  arcR: number; arcDir: 1 | -1; arcA: number; arcLeft: number; // cruise arc
  propT: number;                // propeller spin phase (visual)
}

/** ✈️ fuselage collider discs per plane — [offset along the heading, radius].
 *  Three overlapping circles approximate the ~11.5-long body (nose cone → tail
 *  cone) as a capsule, so a grounded airliner is genuinely SOLID: kids, bots and
 *  cars bounce off it instead of ghosting straight through. While airborne the
 *  discs fold away (air = true) and the sky traffic stays harmless. */
const PLANE_DISCS = [
  { off: 3.4, r: 1.25 },   // nose / cockpit
  { off: 0.2, r: 1.5 },    // wing root — the fattest part of the body
  { off: -3.6, r: 1.25 },  // tail cone
] as const;

const PLANE_COLORS = [0xe0483a, 0x2a9d8f, 0xf0c040, 0x4aa3df, 0x8a5aa8];
const PLANE_TAXI_SPD = 6, PLANE_VR = 40 /* rotation speed */, PLANE_CLIMB = 15, PLANE_CRUISE_SPD = 34;
const PLANE_APPR_SPD = 26, PLANE_TURN_TAXI = 2.2, PLANE_TURN_AIR = 0.55;
/** Cruise altitude — downtown towers grow to 58, so anything lower skims rooftops
 *  (the old 58 value put planes exactly level with the tallest skyscrapers). */
const PLANE_CALT = 66;
/** Below this altitude planes fly STRAIGHT OUT from the city / stay off downtown —
 *  the climb-out and approach corridors never cross a rooftop until cleared. */
const PLANE_ROOF_SAFE = 44;

export interface Npc extends SteerMemory {
  id: number; kind: "police" | "civilian";
  x: number; z: number; vx: number; vz: number; face: number;
  mode: CopMode | CivilMode;
  tx: number; tz: number; timer: number; phase: number;
  /** >0 while fleeing a horror in blind panic — drives the 😱 flail pose (decays) */
  panicT?: number;
  name: string; speed: number; alertT: number;
  /** cop only: id of the civilian being chased (unset = hunting the player) */
  targetCiv?: number;
  /** 👮 cop only: id of a CONTESTANT bot who committed a witnessed crime —
   *  the law chases bots exactly like it chases the player */
  targetCrew?: number;
  /** cop only: cooldown before this cop may arrest another civilian */
  copCd?: number;
  /** main-road marcher: stays on the protest strip instead of roaming the city */
  protest?: boolean;
  /** civilian only: id of the police van driving them to the station (unset = no van yet) */
  vanId?: number;
  /** police side only (legacy mode): this civilian smuggles loot across town for a living */
  runner?: boolean;
  /** runner only: id of the vote currently smuggled (set while carried) */
  voteId?: number;
  /** living-city: this bot hunts loose cash piles & hauls them to the town square (legacy side) */
  scav?: boolean;
  /** living-city: seconds left of a human-like loiter pause (chatting, tying a shoe…) */
  pauseT?: number;
  /** the dedicated "just joined" bot — spawns right beside the player's site on every game start */
  companion?: boolean;
  /** 💰 every townsfolk carries a purse — it drops where they fall */
  purse?: number;
  /** townsfolk can be BEATEN first (assault) — killed at 0 */
  hp?: number;
  /** 🫨 fleeing FROM the player who attacked them (crime witnesses scatter) */
  fearX?: number; fearZ?: number;
  /** 🧟 slain by the night (lies still; the town refills at dawn) */
  dead?: boolean;
  /** ⏱️ seconds since the fall — the renderer plays fall → lie → sink → gone */
  deadT?: number;
  /** true while this bot's death has already dropped its loot */
  looted?: boolean;
}
export interface Zombie extends SteerMemory {
  id: number; x: number; z: number; vx: number; vz: number; face: number; phase: number; touchCd: number; hp?: number; dead?: boolean;
  /** crew id of the contestant who turned — the contest feed/elimination link */
  owner?: number;
  /** 💰 purses this zombie swallowed off the dirt — spills back when it falls or at dawn */
  hoard?: number;
  /** ⏱️ seconds since it was cut down — the body falls, then sinks into the dirt */
  deadT?: number;
  /* 🧱 stuck memory (chk/side/block) lives in SteerMemory — stepNpc writes it.
   * avoidV/avoidT: the prey this shamber gave up reaching (walled in) — skipped
   * for avoidT seconds so the horde re-picks someone it can actually reach. */
  avoidV?: number; avoidT?: number;
  /* 🌙 idle roam — the horde spreads across the night streets instead of one
   * grave-yard blob (roamT = seconds left before a fresh wander pick) */
  roamX?: number; roamZ?: number; roamT?: number;
  /* 🎯 prey latch — the horde used to re-pick the NEAREST soul every frame, so
   * fifty hunters funneled onto one victim and butchered the lobby in a pile.
   * Now each hunter STICKS with its prey until it dies / is walled / too far. */
  preyId?: number; preyKind?: "crew" | "civ" | "you" | "remote"; preySlot?: number;
  /** ⏱️ attention-recheck cooldown — a closer soul can steal a latched hunter,
   * but the steal roll runs on this cadence so chases don't thrash every frame */
  pickT?: number;
}

/* ---------------- 7 Nights: survivors, tools & builds ---------------- */
/** One of the 7 fellow "players" who joined the 7 nights. */
export interface Crew extends SteerMemory {
  id: number; name: string; color: string; colorName: string; look: Appearance;
  x: number; z: number; vx: number; vz: number; face: number;
  alive: boolean;
  mode: "wander" | "hide" | "possessed" | "dead";
  tx: number; tz: number; timer: number; phase: number;
  hp: number; touchCd: number;
  /** 0.45s animation timer — the beast's claw swipe when it mauls someone */
  attackAnimT: number;
  deathX: number; deathZ: number;
  /** ⏱️ seconds since they fell — the renderer plays fall → lie → sink → gone */
  deathT?: number;
  /** the mystery clue their body carries (filled when they die) */
  clue: string;
  /** true once the player inspected the body */
  inspected: boolean;
  /** 🌐 true when a REAL player took over this bot's seat (100-seat contest:
   *  every real player beyond the host frees one bot's chair — total stays 100) */
  replaced?: boolean;
  /** 💰 the purse they carry — drops where they fall */
  purse: number;
  /* --- 🤖 daylight foraging — bots race you for snacks, cash & gems --- */
  /** what this bot is walking to grab (null = just wandering) */
  seek?: { kind: "food" | "loot" | "power"; id: number; x: number; z: number } | null;
  /** ⚡ seconds left of a power-gem speed rush */
  boostT?: number;
  /** 🫨 seconds left fleeing a crime scene / attacker */
  fearT?: number; fearX?: number; fearZ?: number;
  /* --- 🧱 anti-stuck: goals the bot gave up on ---
   * seekBlock: this goodie sat behind a wall/car too long — skip it t seconds.
   * avoidId/avoidT: as a BEAST, this prey is unreachable — hunt someone else. */
  seekBlock?: { kind: "food" | "loot" | "power"; id: number; t: number } | null;
  avoidId?: number; avoidT?: number;
  /* --- 👥 7-Nights contest roster bookkeeping --- */
  /** true dusk→dawn while this contestant is one of the TURNED (a contest zombie) */
  zombieTonight?: boolean;
  /** contestants this contestant's zombie devoured tonight — 0 by dawn = crumble */
  fed?: number;
  /** zombies this contestant fought off (contest stat) */
  cKills?: number;
  /* 🎯 prey latch (possessed hunters) — same anti-funnel fix as the shamblers:
   * stick with your victim instead of re-funneling onto the pack's nearest one */
  preyId?: number; preyKind?: "crew" | "civ" | "you" | "remote"; preySlot?: number;
  /* --- 🤖 human-like day jobs — bots behave like real players now ---
   * chop/mine (harvest), duel (hit another player & loot the drop),
   * license (hunt a 🪪 card), drive (joyride a stolen car). While no job is
   * active the bot falls back to the classic forage/roam behavior. */
  job?: BotJob | null;
  /** 🪪 this bot is carrying a driving-license card it plucked off the street */
  holdsLic?: boolean;
  /** 🚗 DriveState while this bot is behind the wheel (kinematic joyride) */
  drive?: DriveState | null;
  /** 🚗 seconds left of the current joyride (parks & hops out at 0) */
  driveT?: number;
  /** 🚗 seconds spent crawling (walled) while driving — 3s parks the car */
  driveStuck?: number;
  /** 🤖 cooldown before this bot considers a NEW daylight job */
  jobCd?: number;
  /** 🎯 sticky dusk shelter index — assigned ONCE per dusk so 99 contestants
   *  don't re-pick the nearest hideout every frame and pile into one doorway */
  hideHi?: number;
}

/** A daylight "human player" activity a contestant bot can be doing. */
export interface BotJob {
  kind: "chop" | "mine" | "duel" | "license" | "drive";
  /** seconds left before the bot drops the job and picks a new activity */
  t: number;
  /** chop → tree index · mine → rock index · duel → crew id · license → license ent id · drive → car index */
  tgt: number;
  /** swing / re-eval cooldown */
  cd: number;
  /** duel: punches landed */
  hits: number;
  /** walk/drive destination (duel re-reads the live victim instead) */
  tx: number; tz: number;
}

/** 💰 a dropped stash of money — purses of the fallen, zombie hoards… walk over it! */
export interface LootPile { id: number; x: number; z: number; amt: number; label: string; bob: number }

/** 🌐 a REAL player joining the 7 nights over the network (co-op soul).
 *  Positions stream in over the wire @12 Hz (see lib/game/net) and are eased
 *  into these fields — the sim treats them as prey for the pack & renders
 *  them as full survivors. Each client is authoritative over its own soul:
 *  damage crosses the wire as events, never as simulated HP here. */
export interface RemotePlayer {
  slot: number; name: string; look: Appearance;
  x: number; z: number; y: number; vx: number; vz: number; face: number;
  hp: number; alive: boolean;
  beast: boolean; drive: boolean; sprint: boolean; air: boolean; attackT: number;
  /** points reported by their client (HUD scoreboard) */
  points: number; kills: number; money: number;
  lastSeen: number;
}
export interface ToolSlot { kind: ToolKind; count: number }
export interface ToolEnt { id: number; kind: ToolKind; x: number; z: number; active: boolean; respawn: number }
export interface Build {
  id: number; kind: "barricade" | "campfire";
  x: number; z: number; rot: number;
  hp: number;
  /** index of its circle collider in world.circles */
  ci: number;
}
export interface Animal { id: number; kind: AnimalKind; x: number; z: number; vx: number; vz: number; face: number; tx: number; tz: number; timer: number; phase: number; resting: boolean;
  /* 🐕 dogs: night turns every stray into a rotting hound */
  zombie?: boolean; hp?: number; barkT?: number; touchCd?: number; dead?: boolean; deadT?: number;
  /* 🎨 coat variant index + 🍼 baby flag — every creature is an individual */
  variant?: number; baby?: boolean;
  /* 🎯 hound prey latch — same diverse-pick brain as the shamblers (crew id /
   * townsfolk id they're chasing, plus the attention-recheck cadence) */
  preyCrew?: number; preyCiv?: number; pickT?: number; }
export interface ItemEnt { id: number; def: number; x: number; z: number; active: boolean; respawn: number }
export interface VoteEnt { id: number; x: number; z: number; state: "world" | "carried" | "delivered"; /** runner only: which runner holds this vote */ carrierId?: number; /** police side: a runner-delivered vote sneaks back into the city after this timer */ respawnT?: number; /** AI vote-claim ticket: the bot currently walking to grab it (spread bots across the map) */ claimBy?: number }
/** A rare super-power gem glowing somewhere in the jungle (or a mystery spot). */
export interface PowerEnt { id: number; def: number; x: number; z: number; active: boolean; respawn: number }

/** A glowing 🪪 driving-license card — collect one and EVERY parked car is yours. */
export interface LicenseEnt { id: number; x: number; z: number; active: boolean }

/** The car the player is driving (GTA style) — the renderer re-stamps it live. */
export interface DriveState {
  ci: number;               // index into world.cars (the parked fleet)
  x: number; z: number;     // live body position
  rot: number;              // heading — forward is (sin rot, cos rot), matching parked cars
  v: number;                // signed speed along the heading (u/s; negative = reversing)
  c: number; t: number;     // colour + body style copied for the renderer
  /* --- smoothed VISUAL pose (render + camera both follow this) ---
   * Collision push-outs & heading rebuilds can jitter the sim a frame; easing the
   * pose the world SEES kills the micro-stutter, and after a bump we keep easing
   * for a beat (hitT) while clean driving snaps tight — no cornering lag, so the
   * car never reads as skating sideways. spin = wheel angle, steerVis = front wheels. */
  vx: number; vz: number; vrot: number;
  spin: number; hitT: number; steerVis: number;
  /** eased PHYSICS steering (−1..1) — keyboard A/D is digital, and feeding the
   *  raw ±1 straight into the heading snapped the body to full lock in one frame
   *  (and back on release): a jerky zig-zag. The eased value glides to the key's
   *  target (~80 ms) so the turn rate ramps like a real wheel. steerVis (the
   *  front-wheel ANGLE the renderer shows) then follows THIS, not the raw input,
   *  so the tyres always match how hard the car is actually turning. */
  steer: number;
  /** eased PEDAL (−1..1) — keyboard W/S is binary: the old code slammed full
   *  CAR_ACCEL the frame the key landed and full CAR_BRAKE the frame S did. That
   *  acceleration STEP is the launch/brake jerk. The pedal now glides to the key
   *  (like the steering does), so thrust loads up smoothly and coasting fades in
   *  instead of snapping. Analog touch joysticks just glide a tiny bit more. */
  pedal: number;
  /** last rolling direction (±1) with hysteresis — Math.sign(v) flips the turn
   *  side the instant speed crosses zero (a brake-to-reverse nose twitch). We
   *  keep the old side until the car is genuinely rolling the other way. */
  lastDir: 1 | -1;
}

/** 🎇 world FX — confetti = physical chips (harvest/hits), soul = a rising wisp
 *  burst that plays when a beast of the night is CUT DOWN (the kill finisher) */
export interface Fx { type: "confetti" | "soul"; x: number; y: number; z: number; hue: number }

/** A car cruising the ring highway — the engine owns the position, the renderer just reads it. */
export interface TrafficCar {
  a: number; r: number; dir: 1 | -1; sp: number;  // lane angle, radius, direction, angular speed
  c: number; t: number;                            // colour + body style (see placeCar)
  x: number; z: number; rot: number;               // derived each step — solid for collision
}

export type VanState = "idle" | "dispatch" | "load" | "toStation" | "unload" | "return";
/** Police van — drives captured players & civilians from the arrest spot to the nearest station. */
export interface PoliceVan {
  id: number; station: number;                     // home station index
  x: number; z: number; rot: number;
  state: VanState;
  /** road-following waypoints; the last one is the exact goal */
  path: { x: number; z: number }[];
  goal: { x: number; z: number };                  // ultimate destination (for stall rebuilds)
  timer: number; stallT: number; rebuilds: number;
  prisoner: { kind: "player" } | { kind: "civ"; id: number } | null;
}
export type ArrestState = "free" | "called" | "riding" | "locked";

export interface HudData {
  hp: number; stamina: number; stars: number; carried: number; delivered: number; total: number;
  points: number; rescues: number; support: number; zone: Zone; clock: number; night: number;
  /** 🧟 zombies YOU cut down — drives the ⚔️ FINISHER flash */
  kills: number;
  detained: boolean; detainLeft: number; prompt: string; policeNear: boolean;
  civilians: number; police: number; won: boolean; elapsed: number;
  inv: { def: number; count: number }[]; hurt: boolean; sprinting: boolean; exhausted: boolean;
  px: number; pz: number; // player world coords — bottom-center location chip
  /** bump timestamp + amounts of the last eaten item — HUD plays a floating +❤/+⚡ chip */
  gain: { hp: number; stamina: number; at: number };
  /** arrest pipeline stage — HUD swaps the banner text accordingly */
  arrest: ArrestState; station: string;
  /** active rare super power — HUD shows a countdown badge (null = none) */
  power: { kind: PowerKind; name: string; emoji: string; color: string; left: number; max: number; tip: string } | null;
  /** collected-but-not-yet-used power gems waiting in the ✨ pockets — each fires ONCE,
   *  G unleashes the first, tapping a specific slot fires that one (max POWER_CARRY) */
  pockets: { def: number; name: string; emoji: string; color: string; tip: string }[];
  /** 💰 cash banked this run — piles scooped + loot from the fallen */
  money: number;
  /** animal the player currently looks like (morph power) */
  morphKind: AnimalKind | null;
  /** true when Blink is charged and Q will teleport right now */
  blinkReady: boolean;
  /** which side the player picked in the creator — HUD & objectives swap around */
  side: Side;
  /** police side: runners busted so far (target BUST_TARGET) */
  busted: number;
  /** police side: votes the AI runners have smuggled through (lose at RUNNER_LOSE_DELIVERIES) */
  runnerDelivered: number;
  /** police side: true when the runners reached their delivery quota — shift failed */
  lost: boolean;
  /** police side: the squad outfit the officer picked on the hero page (e.g. "Traffic Police") */
  outfitLabel: string;
  /** true once a 🪪 driving-license card was collected — parked cars become drivable */
  hasLicense: boolean;
  /** true while the player is behind the wheel of a car (GTA style) */
  driving: boolean;
  /** current car speed in u/s while driving (0 on foot) — HUD speedometer */
  speed: number;
  /* --- 7 Nights --- */
  /** which night (1..7) is coming / currently dark */
  nightNo: number;
  /** story phase: day → dusk (warning) → night (the beast hunts) → dawn */
  phase: Phase;
  /** seconds left in the current phase — HUD countdown */
  phaseLeft: number;
  /** gathered resources */
  wood: number; rock: number;
  /** collected tools (stacking counts!) + which belt slot is equipped (−1 = hands) */
  tools: { kind: ToolKind; count: number }[];
  held: number;
  /** true while YOU are the possessed beast */
  youPossessed: boolean;
  /** how many beasts stalk the night — possessed crew (alive) + you if possessed */
  beastCount: number;
  /** survivors still breathing (crew only — you make crewAlive + 1) */
  crewAlive: number;
  /** total souls in the contest (99) — HUD alive counter denominator */
  aliveTotal: number;
  /* --- 🧱 THE WALL (shrinking safe zone) --- */
  /** current wall level (0 = whole map free · 1..6 after each night) */
  zoneLevel: number;
  /** current safe-zone radius in world units */
  zoneR: number;
  /** true while YOU stand outside the safe zone — HUD drain warning */
  outsideWall: boolean;
  /** 🌐 living real players (other than you) — bots freed a seat for each */
  remotesAlive: number;
  /** the roster — names, colors & who's still alive (accuse board + map) */
  crew: { name: string; color: string; alive: boolean; mode: string }[];
  /** attack cooldown ready */
  attackReady: boolean;
  /** last clue discovered by inspecting a body (null = none yet) */
  clue: string | null;
  /** 👀 free-cam spectate — on = you're riding behind another living soul */
  spec: { on: boolean; name: string };
  /* --- 🌐 multiplayer --- */
  /** true while this run is a co-op session */
  mp: boolean;
  /** room code ("ABCD") when in a session */
  mpCode: string;
  /** true when we own the story clock (host crown) */
  mpHost: boolean;
  /** relay round-trip estimate (ms) */
  mpPing: number;
  /** the real souls in town — scoreboard & presence */
  netPlayers: { slot: number; name: string; points: number; kills: number; money: number; hp: number; alive: boolean; beast: boolean; drive: boolean; self: boolean }[];
}

export type ToastFn = (msg: string, kind?: "info" | "good" | "bad") => void;

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

/** 👀 free cam: seconds before the camera drifts to another living soul */
const SPEC_SWAP_S = 12;

/** ⚔️ kill finisher: seconds of the player's 360° spin flourish after cutting a
 *  beast of the night down (zombie / hound / possessed contestant) */
export const FINISHER_S = 0.9;

/** 🩸 corpse choreography (seconds): fall time, how long the body rests before
 *  the ground reclaims it, and when it is fully gone from the world */
export const FALL_S = 0.75;
export const CORPSE_LIE_S = 11;
export const CORPSE_SINK_S = 2.4;

/** Index of the road line closest to a coordinate. */
const nearestRoadIdx = (v: number): number => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < ROADS.length; i++) {
    const d = Math.abs(ROADS[i] - v);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
};

/**
 * Route a van along the street grid — long legs always follow road centre lines
 * (guaranteed clear of buildings), with short entry/exit hops at each end.
 * Path: sideways hop onto a road → drive along it → turn → exit hop to the goal.
 */
function roadPath(fx: number, fz: number, tx: number, tz: number): { x: number; z: number }[] {
  const R0x = ROADS[nearestRoadIdx(fx)];
  const R1z = ROADS[nearestRoadIdx(tz)];
  const R1x = ROADS[nearestRoadIdx(tx)];
  const pts = [
    { x: R0x, z: fz },      // hop onto the vertical road nearest the start
    { x: R0x, z: R1z },     // cruise along it to the horizontal road nearest the goal
    { x: R1x, z: R1z },     // turn and cruise to the goal's road
    { x: tx, z: tz },       // short exit hop (goal sits near R1x by construction)
  ];
  // drop near-duplicate waypoints (van may already be on a road line)
  const out: { x: number; z: number }[] = [];
  for (const p of pts) {
    const prev = out.length ? out[out.length - 1] : { x: fx, z: fz };
    if (Math.hypot(p.x - prev.x, p.z - prev.z) > 1.6) out.push(p);
  }
  if (!out.length) out.push({ x: tx, z: tz });
  return out;
}

export class GameEngine {
  world: World;
  rnd = mulberry32(2024 + Math.floor(Math.random() * 1e6));
  look: Appearance;
  playerName = "You";

  player: Body = newBody(SPAWN.x, SPAWN.z);
  /** 🎲 where YOU dropped into the contest — random every match (see rollPlayerSpawn).
   *  Everything that used to orbit the old fixed SPAWN (cop spawns, dizzy respawn,
   *  the join bot) now orbits THIS point, so no two runs start in the same corner. */
  playerSpawn = { x: SPAWN.x, z: SPAWN.z };
  input = { f: 0, r: 0, sprint: false, jump: false, turn: 0, yaw: Math.PI, pitch: 0.32, mouseAt: 0 };
  touchMove = { active: false, sprint: false };
  hp = 100; stamina = 100;
  inv: { def: number; count: number }[] = []; // pocketed food, used from the HUD item bar
  hurtT = 0;                // red damage-flash timer
  flipT = 0;                // double-jump front-flip timer (FLIP_S → 0)
  squashT = 0;              // landing squash-and-stretch timer (LAND_SQUASH_S → 0)
  lastGain: { hp: number; stamina: number; at: number } = { hp: 0, stamina: 0, at: 0 }; // bumped on every eat
  private exhaustedAnnounced = false;
  private pocketFullT = 0;  // throttles the "pockets full" toast
  private powerFullT = 0;   // throttles the "power pocket full" toast
  clock = 0.3;
  stars = 0; starTimer = 0;
  chased = false; // true while (or just after) any cop is hunting the player
  carriedVotes: VoteEnt[] = [];
  votes: VoteEnt[] = [];
  cops: Npc[] = [];
  civs: Npc[] = [];
  zombies: Zombie[] = [];
  animals: Animal[] = [];
  /** 🌲 jungle night ambience director — countdown to the next owl / growl /
   *  twig-snap / howl while you're in the trees after dark (0 = idle, day) */
  private ambT = 0;
  /** 🐺 wolf pack howl cadence — one lonesome call every so often at night */
  private wolfT = 0;
  /** 🧟 hound wail cadence — distant zombie-hound howls after nightfall */
  private howlT = 0;
  planes: PlaneState[] = [];
  items: ItemEnt[] = [];
  traffic: TrafficCar[] = [];
  vans: PoliceVan[] = [];
  powers: PowerEnt[] = [];
  licenses: LicenseEnt[] = [];
  /** bumped whenever a license ENTITY is appended at runtime (dropped cards) —
   *  the Licenses renderer rebuilds its 3D views when this ticks up */
  licRev = 0;
  fxQueue: Fx[] = [];

  /* --- GTA-style driving (license-gated) --- */
  /** collected 🪪 card — without it the driver's seat stays locked */
  hasLicense = false;
  /** the car currently being driven (null = on foot) */
  drive: DriveState | null = null;
  /** chase-cam auto-follow LATCH (hysteresis, see stepDrive) — a single speed
   *  threshold made the follow toggle on/off around it, tugging the camera. */
  private followOn = false;
  /** hop-out cooldown — stops an E press from instantly re-entering the car */
  exitCd = 0;
  private carHome: { x: number; z: number; rot: number }[] = [];            // parked spots — reset() restores them
  private carAxles = new Map<number, [CircleCollider, CircleCollider]>();  // car idx → its two live colliders
  private driveMsgT = 0;   // throttles "you need a license" / "park first" toasts

  /* --- 🤖 bots acting like real players ---
   * goodieClaims: per-frame map goodieKey → crewId; each loose snack/pile/gem
   * can only be TARGETED by one bot at a time, so the foragers spread across
   * the map instead of all beelining the same nearest pile.
   * botDriven: car indices currently being joyridden by bot drivers — the
   * renderer re-stamps these fleet instances every frame. */
  private goodieClaims = new Map<string, number>();
  botDriven = new Set<number>();
  private invOnceT = 0;  // throttles the "one of each item only" toast
  private toolOnceT = 0; // throttles the "you already own this tool" toast

  /* --- rare super powers --- */
  activePower: PowerKind | null = null;
  powerT = 0; powerMax = 1;      // seconds left / total of the active power
  /** collected gems wait in the ✨ pockets until the player unleashes them —
   *  G fires the FIRST gem, tapping a HUD slot fires that one. Each is single-use
   *  and up to POWER_CARRY fit at once, so kids can stock a little arsenal. */
  powerPockets: number[] = [];
  morphKind: AnimalKind | null = null; // current animal look while morph lasts
  blinkCd = 0;                   // blink teleport cooldown

  /** ✈️ per plane: the 3 world.circles indices of its fuselage discs — grounded
   *  planes are SOLID, and the discs glide across the collider grid every frame */
  private planeCols: number[][] = [];

  faintT = 0;   // >0 while the world spins after a car bonk — input is ignored, stars orbit
  carHitCd = 0; // old-game hitCd — no double-bonks from the same bumper

  /* --- 💥 game-feel: trauma screen shake --- */
  /** screen-shake trauma 0..1 — hits ADD, the value decays every frame, and the
   *  CAMERA (never the simulated body) reads shakeT² as a smooth sinusoidal
   *  offset. Juice must return to rest; the sim stays untouched. */
  shakeT = 0;

  /** 💥 Add screen-shake trauma — clamped 0..1, impacts ACCUMULATE. Tiers (from
   *  the game-feel skill, scaled to importance so routine actions never shake):
   *  small ≈0.15 wall scrape · medium ≈0.4 damage taken · large ≈0.7 car bonk. */
  addShake(amount: number) { this.shakeT = Math.min(1, this.shakeT + amount); }

  /** Arrest pipeline: called (van coming) → riding (in the van) → locked (at the station) → free. */
  arrest: ArrestState = "free";
  arrestStation = -1;
  playerInVan = false;
  private vanNeeded = false;

  points = 0; rescues = 0; caughtCount = 0;
  delivered = 0;
  /** 💰 cash collected this run — replaces the old vote chase */
  money = 0;
  /** 💰 dropped stashes lying in the world (purses of the fallen, zombie hoards) */
  loot: LootPile[] = [];
  /** townsfolk the night took — refilled at dawn (living city) */
  civsLostTonight = 0;
  // daily-task counters: snacks munched & gems unleashed this run
  snacksEaten = 0; powersUsed = 0;
  detainedT = 0; invulnT = 8; elapsed = 0; // 8s spawn grace — cops can't spot or catch you
  won = false; wonAt = 0;
  /** which side the player picked — police flips the whole objective around */
  side: Side = "protester";
  /** 7Nights mode flag — the story loop replaces the vote-chase (cops never chase, votes never score) */
  readonly horror = true;
  /** police side: squad perks from the hero-page outfit (bust reach, cuffs, sprint…) */
  policePerk: PolicePerk = policeOutfitOf("").stats;
  /** police side: votes the AI runners smuggled through (lose at RUNNER_LOSE_DELIVERIES) */
  runnerDelivered = 0;
  /** police side: set when the runners hit their quota — the shift failed */
  lost = false;
  /** police side: min seconds between two busts so one crowd can't be mass-arrested */
  catchCd = 0;
  running = false;
  /** ⏸ PERSONAL pause (Esc/P): only YOU step out of the world — the town keeps
   *  living (bots forage, the pack hunts, the clock runs) like a real multiplayer
   *  server. Your body stands still, verbs are gated, and every notable event is
   *  journaled into pauseLog for the welcome-back report. */
  personalPause = false;
  /** 📜 events that happened while the player was personally paused (welcome-back feed) */
  pauseLog: { msg: string; kind: "info" | "good" | "bad" }[] = [];
  /** 👀 free-cam spectate — dead souls channel-surf the living town */
  spectating = false;
  /** ⚔️ kill finisher — seconds left of the player's 360° spin flourish */
  finisherT = 0;
  /** 🩸 seconds since the player died — the death fall plays before the recap opens */
  deathT = 0;
  /** 👀 the name of the soul the free cam is currently riding behind */
  specName = "";
  private specKey = "";
  private specSwapT = 0;
  private nextId = 1;
  private rawToast: ToastFn;
  private zone: Zone = "City";
  private hudT = 0;
  private hud: HudData;
  private groanT = 0;
  /** throttle for "a zombie gulped loot" toasts so 50 shamblers don't spam */
  private zLootCd = 0;
  /** throttle for "a bot scooped up …" toasts so 99 foragers don't spam */
  private botLootCd = 0;
  /** 👮 a reported crime still hot — cops in range walk to the scene to investigate */
  crimeReport: { x: number; z: number; t: number } | null = null;

  /* --- 7 Nights: the survival-horror storyline --- */
  /** 1..7 — which night is approaching / dark */
  nightNo = 1;
  /** day → dusk (warning) → night (the beast hunts) → dawn */
  phase: Phase = "day";
  phaseT = PHASE_DAY_S;
  /** the crew — 7 fellow "players" who joined the 7 nights */
  crew: Crew[] = [];
  /** collected tools (stacking: {kind, count}) — the belt */
  tools: ToolSlot[] = [];
  /** equipped belt slot (index into tools, −1 = bare hands) */
  held = -1;
  /** gathered resources */
  res = { wood: 0, rock: 0 };
  /** tool pickups lying around the world */
  toolEnts: ToolEnt[] = [];
  /** built barricades & campfires */
  builds: Build[] = [];
  /** axe swings taken per tree (parallel to world.trees) */
  treeHits: number[] = [];
  /** hammer hits left per boulder (parallel to world.rocks) */
  rockHp: number[] = [];
  /** felled tree indices → render as stumps (renderer reads this) */
  felled = new Set<number>();
  /** smashed boulder indices → hidden in the renderer */
  brokenRocks = new Set<number>();
  /** bump whenever felled/brokenRocks change — lets renderers invalidate cheaply */
  fellVersion = 0;
  /* --- 🪓 TIMBER feel — per-hit animation state the renderers read --- */
  /** bumped on every axe blow — the last-struck tree shudders (WorldView) */
  chopVersion = 0;
  /** the tree just struck + the swing direction (it shudders AWAY from the axe) */
  lastChop = { i: -1, dx: 0, dz: 1 };
  /** bumped on every hammer blow — the last-struck boulder jiggles (RocksView) */
  rockVersion = 0;
  lastRock = -1;
  /** tree idx → engine.elapsed when it fell (+ tip-over direction) — the tumble */
  fellTimes = new Map<number, number>();
  fellDir = new Map<number, number>();
  /** boulder idx → engine.elapsed when it smashed — the crumble-away */
  rockBreakAt = new Map<number, number>();
  attackCd = 0;
  accuseCd = 0;
  /** who the spirit possessed THIS night (crew indices — a PACK hunts at night) */
  possessed: number[] = [];
  youPossessed = false;
  /** who was possessed LAST night — the accusation pool (empty = you were one) */
  lastPossessed: number[] = [];
  /** last clue learned from a body — HUD chip */
  lastClue: string | null = null;
  /** bumped whenever the zombie roster rebuilds (dusk rise / dawn clear) — renderer rebuilds rigs */
  zRev = 0;
  kills = 0; accusesRight = 0; accusesWrong = 0; buildsMade = 0; nightsSurvived = 0;
  /** safe hiding spots the crew runs to at dusk (camp + station gates) */
  hideSpots: { x: number; z: number }[] = [];
  /* --- 🧱 THE WALL — the shrinking safe zone --- */
  /** wall level: 0 = whole map free · +1 every dawn (see ZONE_RADII) */
  zoneLevel = 0;
  /** seconds left of the post-shrink grace window (drain ramps 0→full) */
  zoneGraceT = 0;
  /** true while the PLAYER stands beyond the wall (HUD warning + wall tint) */
  outsideWall = false;
  /** throttle for the "you're outside the wall" toast */
  private zoneToastCd = 0;
  /** 🏕️ jungle camps you've walked up to — one discovery toast each */
  discCamps = new Set<number>();
  /** original static-circle radii — reset() un-fells trees & un-smashes rocks with this */
  private circleR0: number[] = [];
  private heartT = 0;

  /* ---------------- 🌐 multiplayer (co-op over the relay) ---------------- */
  /** true while this engine is part of a network session */
  mp = false;
  /** host owns the story clock & the possession roster */
  mpHost = false;
  /** our slot in the room (0..7) */
  mpSlot = -1;
  mpCode = "";
  mpPing = 0;
  /** the other REAL souls — fed by the net glue (lib/game/net/engineNet.ts) */
  remotes: RemotePlayer[] = [];
  /** remote slots currently possessed this night (roster sync) */
  mpBeastSlots: number[] = [];
  /** scoreboard for remote souls (slot → last reported) */
  netScores = new Map<number, { points: number; kills: number; money: number }>();
  /** wired by the net glue: emit a gameplay event to the room */
  netEmit: ((ev: MpEvent) => void) | null = null;
  /** wired by the net glue: called at the end of every update() tick */
  netTick: ((dt: number) => void) | null = null;

  constructor(world: World, look: Appearance, toast: ToastFn) {
    this.world = world;
    this.look = look;
    this.rawToast = toast;
    this.side = look.fac;
    // 🌲 start fetching the polyfork wildlife GLBs right away — by the time you
    // reach the jungle they should be parsed and ready to spawn
    preloadModels();
    this.policePerk = policeOutfitOf(look.fac === "police" ? look.outfit : "").stats;
    // snapshot every static collider radius so reset() can un-fell trees & un-smash rocks
    this.circleR0 = world.circles.map((c) => c.r);
    this.treeHits = new Array(world.trees.length).fill(0);
    this.rockHp = new Array(world.rocks.length).fill(ROCK_HITS);
    this.hideSpots = [
      { x: TOWN_SQUARE.x, z: TOWN_SQUARE.z },
      ...POLICE_STATIONS.map((s) => stationGate(s)),
      { x: SPAWN.x + 42, z: SPAWN.z + 18 },
      // 🏕️ the jungle camps shelter the crew at dusk too — bots gather round the safe fires
      ...this.world.camps.map((cp) => {
        const l = Math.hypot(cp.x, cp.z) || 1;
        return { x: cp.x - (cp.x / l) * 3.4, z: cp.z - (cp.z / l) * 3.4 };
      }),
    ];
    // 🎲 random drop spot FIRST — cops, the join bot & crew all spread around it
    this.rollPlayerSpawn();
    this.player.x = this.playerSpawn.x; this.player.z = this.playerSpawn.z;
    this.hud = this.buildHud();
    this.spawnAll();
    // remember where every car is parked (driving scatters them — reset brings them home)
    // and index each car's two axle colliders so a driven car can move them along
    this.carHome = this.world.cars.map((c) => ({ x: c.x, z: c.z, rot: c.rot }));
    for (const cc of this.world.circles) {
      if (cc.car === undefined) continue;
      const pair = this.carAxles.get(cc.car);
      if (pair) pair[1] = cc;
      else this.carAxles.set(cc.car, [cc, cc]);
    }
  }

  /* ---------------- 🔍 night trace: AI forensics for the stuck-horde mystery ----------------
   * Ring-buffered log lines (console.debug + `window.__vc.engine.trace()`).
   * Night sampling tracks the exact symptoms the lobby reported: hunters piling
   * into one cluster, idle zombies blobbing at the graveyard, contestants dying
   * in the same spot, and bots grinding against walls (blockT). */
  traceBuf: string[] = [];
  private traceT = 0;
  /** deaths logged tonight (position + name) — the "everyone died in one place" detector */
  private nightDeaths: { x: number; z: number; name: string; cause: string }[] = [];
  /** one forensic line — console + ring buffer, readable via window.__vc.engine.trace() */
  trace(msg: string) {
    const line = `[t${this.elapsed.toFixed(0)}s ${this.phase}${this.horror ? " n" + this.nightNo : ""}] ${msg}`;
    this.traceBuf.push(line);
    if (this.traceBuf.length > 240) this.traceBuf.shift();
    console.debug("%c7Nights", "color:#c084fc;font-weight:bold", line);
  }
  /** dump the last `n` trace lines (agent-browser / devtools debugging aid) */
  dumpTrace(n = 80): string {
    return this.traceBuf.slice(-n).join("\n");
  }

  /* ---------------- spawning ---------------- */
  private nid() { return this.nextId++; }

  /** 🎲 deterministic random city drop for a contest seat (0..99). Seeded by the
   *  seat — the SAME answer on every client — so a remote avatar materialises
   *  exactly where its soul will drop, wherever it's rendered. */
  spawnSpotFor(slot: number): { x: number; z: number } {
    const r = mulberry32(0x7e57123 ^ ((slot + 1) * 2654435761));
    return freeSpot(r, this.world, 14, CITY_RADIUS - 14);
  }
  /** 🎲 PUBG-style drop: YOU parachute into a random street every match.
   *  Multiplayer: your seat slot picks the spot (same on every client). */
  private rollPlayerSpawn() {
    if (this.mp && this.mpSlot >= 0) this.playerSpawn = this.spawnSpotFor(this.mpSlot);
    else this.playerSpawn = freeSpot(this.rnd, this.world, 14, CITY_RADIUS - 14);
    return this.playerSpawn;
  }

  /**
   * Pick a police spawn far away from the player's spawn point. Used by both the
   * first spawn AND reset() so a replay can never seed a cop next to the player
   * (which used to cause an "instant detain" right after the grace window).
   * Cops spawn ACROSS THE WHOLE CITY (area-uniform) instead of one downtown ring —
   * beats used to cluster every officer within 140u of the map centre.
   */
  private safeCopSpot(): { x: number; z: number } {
    const avoid = [{ x: this.playerSpawn.x, z: this.playerSpawn.z, r: 90 }];
    for (let i = 0; i < 14; i++) {
      const p = freeSpot(this.rnd, this.world, 24, CITY_RADIUS - 14, avoid);
      if (Math.hypot(p.x - this.playerSpawn.x, p.z - this.playerSpawn.z) >= 90) return p;
    }
    // Last resort: walk a wide ring around spawn until a point survives colliders.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + this.rnd() * 0.25;
      const p = { x: this.playerSpawn.x + Math.cos(a) * 105, z: this.playerSpawn.z + Math.sin(a) * 105 };
      resolve(p, 0.9, this.world);
      if (Math.hypot(p.x - this.playerSpawn.x, p.z - this.playerSpawn.z) >= 90) return p;
    }
    return { x: this.playerSpawn.x + 105, z: this.playerSpawn.z };
  }

  /** A free spot at least `minD` units away from the player — where cops walk to when they give up. */
  private spotAwayFromPlayer(minD: number): { x: number; z: number } {
    const p = this.player;
    let pick = { x: p.x + minD, z: p.z + minD };
    for (let i = 0; i < 10; i++) {
      const t = freeSpot(this.rnd, this.world, 10, CITY_RADIUS - 10);
      pick = t;
      if (dist2(t.x, t.z, p.x, p.z) > minD * minD) break;
    }
    return pick;
  }

  /** Player is home free — drop the wanted badge so they look/feel normal again. */
  private clearWanted(msg: string) {
    this.stars = 0;
    this.starTimer = 0;
    this.chased = false;
    this.crimeReport = null; // the case went cold — cops stand down
    sfx.rescue();
    this.toast(msg, "good");
  }

  /** Random free city spot — still used for the dizzy-stun respawn. */
  private cityRespawnSpot(): { x: number; z: number } {
    for (let i = 0; i < 24; i++) {
      const t = freeSpot(this.rnd, this.world, 10, CITY_RADIUS - 10);
      let ok = true;
      for (const cop of this.cops) {
        if (dist2(t.x, t.z, cop.x, cop.z) < 45 * 45) { ok = false; break; }
      }
      if (ok) return t;
    }
    return freeSpot(this.rnd, this.world, 10, CITY_RADIUS - 10); // fallback: any city spot
  }

  /** Index of the station closest to a point — vans always take the nearest one. */
  private nearestStationIdx(x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < POLICE_STATIONS.length; i++) {
      const s = POLICE_STATIONS[i];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private civById(id: number): Npc | undefined { return this.civs.find((c) => c.id === id); }

  /** True if some van is actually on its way to (or carrying) this civilian. */
  private vanAssigned(c: Npc): boolean {
    for (const v of this.vans) {
      const pr = v.prisoner;
      if (pr && pr.kind === "civ" && pr.id === c.id) return true;
    }
    return false;
  }

  /** Civilians currently in detention — capped so police arrests never empty the city. */
  private heldCivs(): number {
    let n = 0;
    for (const c of this.civs) if (c.mode === "detained") n++;
    return n;
  }

  private spawnAll() {
    const r = this.rnd;
    // votes — spread across the bigger city
    const bands: [number, number][] = [[16, 140], [160, 260], [280, 380]];
    for (let i = 0; i < TOTAL_VOTES; i++) {
      const [a, b] = bands[i < 7 ? 0 : i < 12 ? 1 : 2];
      const p = freeSpot(r, this.world, a, b);
      this.votes.push({ id: this.nid(), x: p.x, z: p.z, state: "world" });
    }
    // police — keep clear of the player's spawn so nobody gets spotted on frame one
    for (let i = 0; i < POLICE_COUNT; i++) {
      const p = this.safeCopSpot();
      this.cops.push({ id: this.nid(), kind: "police", x: p.x, z: p.z, vx: 0, vz: 0, face: 0, mode: "patrol", tx: p.x, tz: p.z, timer: 0, phase: Math.random() * 6, name: "Police", speed: POLICE_SPEED * 0.6, alertT: 0, copCd: 0 });
    }
    // civilians — soft Poisson-disc scatter: every bot keeps a minimum gap from its
    // neighbours, so no more “all 94 spawned in one neighbourhood” clumping.
    // 🧟 7Nights: the town is ABANDONED — only a few stubborn townsfolk never left
    // (110 ambient civilians would drown out the 100-soul contest and make the
    // alive counter read as a lie). Other modes keep the full living city.
    const civN = this.horror ? 26 : CIVILIAN_COUNT;
    const civSpots = scatterSpots(r, this.world, civN, 8, CITY_RADIUS - 8, BOT_SPAWN_GAP);
    for (let i = 0; i < civN; i++) {
      const p = civSpots[i];
      this.civs.push({ id: this.nid(), kind: "civilian", x: p.x, z: p.z, vx: 0, vz: 0, face: 0, mode: "wander", tx: p.x, tz: p.z, timer: range(r, 0, 4), phase: Math.random() * 6, name: CIVIL_NAMES[i % CIVIL_NAMES.length], speed: range(r, 2.2, 3.4), alertT: 0, purse: Math.round(range(r, CIV_PURSE[0], CIV_PURSE[1])) });
    }
    // protest march — old-game homage: a slow column of civilians walks the main road,
    // spread down its FULL length instead of bunched right at the player's spawn
    const MARCHERS = 6;
    for (let i = 0; i < MARCHERS; i++) {
      const c = this.civs[i * 3 % this.civs.length];
      c.protest = true;
      c.x = -8 + (i % 3) * 8; c.z = 24 + i * 48;
      c.tx = c.x; c.tz = c.z;
      c.speed = range(r, 1.5, 2.1);
      c.timer = range(r, 2, 6);
    }
    // 🤖 the JOIN BOT — when a real player joins, one dedicated bot drops into
    // the contest at a random street too (same anti-clump rule as everyone)
    const jx = freeSpot(r, this.world, 14, CITY_RADIUS - 14);
    this.civs.push({ id: this.nid(), kind: "civilian", x: jx.x, z: jx.z, vx: 0, vz: 0, face: 0, mode: "wander", tx: jx.x, tz: jx.z, timer: range(r, 1, 3), phase: Math.random() * 6, name: "Bijli", speed: 3.15, alertT: 0, companion: true, purse: Math.round(range(r, CIV_PURSE[0], CIV_PURSE[1])) });
    // 🧟 contest zombies never pre-spawn — each dusk the TURNED rise where they stood
    // 👥 the crew — 7 fellow "players" join you for the 7 nights
    this.spawnCrew();
    // 🪓 arms & tools — spread across the wild: city edge, farmland, jungle,
    // deep jungle and the ⛰️ mountain slopes (find them before nightfall!)
    const kinds: ToolKind[] = [];
    for (const t of TOOLS) for (let i = 0; i < TOOL_SPAWN[t.kind]; i++) kinds.push(t.kind);
    const toolZone: [number, number][] = [
      [300, 398],                                   // city outskirts
      [CITY_RADIUS + 10, FARM_RADIUS - 10],         // farmland
      [FARM_RADIUS + 8, DEEP_JUNGLE_RADIUS - 6],    // jungle
      [DEEP_JUNGLE_RADIUS + 4, JUNGLE_RADIUS - 6],  // deep jungle
      [MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 8],     // ⛰️ mountain slopes
    ];
    kinds.forEach((kind, i) => {
      const [r0, r1] = toolZone[i % toolZone.length];
      let p = freeSpot(r, this.world, r0, r1);
      if (r0 >= MOUNTAIN_INNER) {
        // mountain tools must sit on a walkable slope — retry until the ground is gentle
        for (let k = 0; k < 14; k++) {
          if (terrainHeight(p.x, p.z) < 12) break;
          p = freeSpot(r, this.world, r0, r1);
        }
      }
      this.toolEnts.push({ id: this.nid(), kind, x: p.x, z: p.z, active: true, respawn: 0 });
    });
    // animals
    let ai = 0;
    for (const set of ANIMAL_SET)
      for (let i = 0; i < set.count; i++) {
        // 🏔️ alpine wildlife spawns on WALKABLE mountain slopes only — retry a
        // few times if the pick lands on a cliff face, then settle for anything
        let p: { x: number; z: number };
        if (set.zone === "mountain") {
          p = freeSpot(r, this.world, MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 8);
          for (let tries = 0; tries < 6 && terrainHeight(p.x, p.z) > 11; tries++) {
            const q = freeSpot(r, this.world, MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 8);
            p.x = q.x; p.z = q.z;
          }
        } else if (set.zone === "grave") {
          // 🕷️ the giant yard spider is born inside the cemetery fence
          const a = range(r, 0, Math.PI * 2), d = range(r, 6, GRAVEYARD.r - 6);
          p = { x: GRAVEYARD.x + Math.cos(a) * d, z: GRAVEYARD.z + Math.sin(a) * d };
          resolve(p, 0.6, this.world);
        } else if (set.zone === "city") {
          // 🐕🐕‍⬛ strays & the black cat sleep & roam RANDOM city spots — streets, parks, alley mouths
          p = freeSpot(r, this.world, 14, CITY_RADIUS - 14);
        } else {
          p = freeSpot(r, this.world, set.zone === "farm" ? CITY_RADIUS + 10 : FARM_RADIUS + 10, set.zone === "farm" ? FARM_RADIUS - 8 : JUNGLE_RADIUS - 30);
        }
        this.animals.push({
          id: this.nid(), kind: set.kind, x: p.x, z: p.z, vx: 0, vz: 0, face: 0, tx: p.x, tz: p.z,
          timer: range(r, 0, 5), phase: Math.random() * 6, resting: false,
          variant: Math.floor(r() * 4), // 🎨 each creature picks its own coat
          // 🍼 some of the herd are babies — smaller, slower, twice as cute
          baby: set.kind !== "wolf" && set.kind !== "bear" && set.kind !== "stag" && set.kind !== "owl" && set.kind !== "crow"
            && set.kind !== "cat" && set.kind !== "spider" && r() < 0.24,
        });
        ai++;
      }
    // items
    for (let i = 0; i < ITEM_COUNT; i++) {
      const p = freeSpot(r, this.world, 10, 430);
      this.items.push({ id: this.nid(), def: Math.floor(r() * ITEMS.length), x: p.x, z: p.z, active: true, respawn: 0 });
    }
    // 🏕️ camp supplies — every jungle camp left snacks and a money stash by the fire
    for (const cp of this.world.camps) {
      for (let k = 0; k < 2; k++) {
        const sa = range(r, 0, Math.PI * 2), sd = range(r, 2.6, 3.6);
        const s = { x: cp.x + Math.cos(sa) * sd, z: cp.z + Math.sin(sa) * sd };
        resolve(s, 0.4, this.world);
        this.items.push({ id: this.nid(), def: Math.floor(r() * ITEMS.length), x: s.x, z: s.z, active: true, respawn: 0 });
      }
      const la = range(r, 0, Math.PI * 2), ld = range(r, 2.8, 3.8);
      this.dropLoot(cp.x + Math.cos(la) * ld, cp.z + Math.sin(la) * ld, 18 + Math.round(r() * 30), "Camper's stash");
    }
    // rare super powers — mostly deep-jungle treasures, a couple of mystery spots anywhere
    for (let i = 0; i < POWER_COUNT; i++) {
      const jungle = r() < POWER_JUNGLE_SHARE;
      const p = freeSpot(r, this.world, jungle ? FARM_RADIUS + 12 : 10, jungle ? JUNGLE_RADIUS - 14 : 430);
      this.powers.push({ id: this.nid(), def: i % POWERS.length, x: p.x, z: p.z, active: true, respawn: 0 });
    }
    // driving-license cards — most around town streets, two out in the farmland
    for (let i = 0; i < LICENSE_COUNT; i++) {
      const far = i >= LICENSE_COUNT - 2;
      const p = freeSpot(r, this.world, far ? CITY_RADIUS + 8 : 14, far ? FARM_RADIUS - 14 : 240);
      this.licenses.push({ id: this.nid(), x: p.x, z: p.z, active: true });
    }
    // police van fleet — one van per station, parked at its gate
    for (let i = 0; i < POLICE_STATIONS.length; i++) {
      const st = POLICE_STATIONS[i];
      const g = stationGate(st);
      const ix = g.x + Math.sign(st.x) * 4, iz = g.z + Math.sign(st.z) * 4;
      this.vans.push({ id: this.nid(), station: i, x: ix, z: iz, rot: Math.atan2(st.x - ix, st.z - iz), state: "idle", path: [], goal: { x: ix, z: iz }, timer: 0, stallT: 0, rebuilds: 0, prisoner: null });
    }
    // ring-road traffic — two lanes, both directions, the full fleet: buses, pickups,
    // vans & jeeps cruise alongside the family cars
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      this.traffic.push({
        r: RING_R + (dir > 0 ? -2.7 : 2.7),
        dir,
        a: (i / TRAFFIC_COUNT) * Math.PI * 2,
        sp: 0.034 + (i % 3) * 0.011, // ≈7–12 u/s — quicker than a walking kid, dodgeable when sprinting
        c: (i * 3 + 1) % 8,
        t: VEHICLE_POOL[i % VEHICLE_POOL.length],
        x: 0, z: 0, rot: 0,
      });
      const t = this.traffic[this.traffic.length - 1];
      t.x = Math.cos(t.a) * t.r; t.z = Math.sin(t.a) * t.r;
      t.rot = t.dir > 0 ? -t.a : Math.PI - t.a; // clockwise lane: heading = velocity (was π+a — cars drove sideways!)
    }
    // police side: a slice of the civilians become vote-runners (the player hunts THEM)
    this.assignRunners();
    // legacy side: a slice of the civilians scavenge loose cash & haul it to the town square
    this.assignScavengers();
    // bot planes — staggered so a flight is always somewhere in its cycle
    for (let i = 0; i < PLANE_COUNT; i++) {
      const slot = i % 3;
      const ax = AIRPORT.terminal.x - 26 + slot * 22, az = AIRPORT.apronZ;
      this.planes.push({
        id: this.nid(), c: (i * 2 + 1) % PLANE_COLORS.length,
        x: ax, z: az, alt: 0,
        hdg: 0, pitch: 0, spd: 0,
        mode: "parked", t: 2.5 + i * 7 + r() * 6,
        slot, wx: ax, wz: az, walt: 0,
        arcR: 340, arcDir: 1, arcA: 0, arcLeft: 0,
        propT: 0,
      });
    }
    // ✈️ grounded planes are SOLID — three fuselage discs follow each airliner so
    // kids, bots and cars bounce off parked / taxiing / rolling planes instead of
    // ghosting straight through them. Discs fold away while the plane is airborne.
    this.planeCols = this.planes.map((pl, pi) =>
      PLANE_DISCS.map((d) => addDynamicCircle(this.world, {
        x: pl.x + Math.cos(pl.hdg) * d.off,
        z: pl.z + Math.sin(pl.hdg) * d.off,
        r: d.r, plane: pi, air: false,
      })),
    );
  }

  /* ---------------- bot planes ---------------- */
  /** Turn `hdg` toward `want` at a capped rate, returning the new heading. */
  private steerHdg(hdg: number, want: number, maxTurn: number): number {
    let dh = ((want - hdg + Math.PI) % TAU + TAU) % TAU - Math.PI;
    if (dh > maxTurn) dh = maxTurn;
    if (dh < -maxTurn) dh = maxTurn;
    return hdg + dh;
  }

  private updatePlanes(dt: number) {
    for (let pi = 0; pi < this.planes.length; pi++) {
      const pl = this.planes[pi];
      pl.propT += dt * (pl.mode === "parked" ? 0.6 : 9 + pl.spd * 0.35);
      switch (pl.mode) {
        case "parked": {
          pl.t -= dt;
          if (pl.t <= 0) {
            // push back: taxi to a staging point just south of the runway threshold —
            // the dogleg (staging → threshold → line-up) makes the plane face east for the roll
            pl.mode = "taxi";
            pl.wx = AIRPORT.rx0; pl.wz = AIRPORT.rz + 10; pl.walt = 0;
          }
          break;
        }
        case "taxi": {
          pl.spd = PLANE_TAXI_SPD;
          const d = Math.hypot(pl.wx - pl.x, pl.wz - pl.z);
          if (d < 6) {
            if (pl.wz !== AIRPORT.rz) {
              // staging reached — line up on the runway heading east
              pl.wx = AIRPORT.rx0 + 44; pl.wz = AIRPORT.rz;
            } else {
              pl.mode = "roll"; pl.spd = 2;
            }
          } else {
            pl.hdg = this.steerHdg(pl.hdg, Math.atan2(pl.wz - pl.z, pl.wx - pl.x), PLANE_TURN_TAXI * dt);
            pl.x += Math.cos(pl.hdg) * pl.spd * dt;
            pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          }
          break;
        }
        case "roll": {
          // take-off roll: accelerate down the runway (firmly realigning east), lift off past the far end
          pl.hdg = this.steerHdg(pl.hdg, 0, 0.9 * dt);
          pl.spd = Math.min(PLANE_VR + 6, pl.spd + 9.5 * dt);
          pl.x += Math.cos(pl.hdg) * pl.spd * dt;
          pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          if (pl.x > AIRPORT.rx1 - 4) { pl.mode = "climb"; }
          break;
        }
        case "climb": {
          pl.spd = Math.min(PLANE_CRUISE_SPD + 2, pl.spd + 4 * dt);
          pl.alt = Math.min(PLANE_CALT + pl.slot * 9, pl.alt + PLANE_CLIMB * dt);
          // keep flying STRAIGHT OUT (away from town) until safely above every
          // rooftop — banking back at low altitude used to fly the plane right
          // through the 30-tall control tower; above PLANE_ROOF_SAFE (and past
          // the mountain-wall guard) it curves back toward the city
          const rr = Math.hypot(pl.x, pl.z);
          const want = pl.alt >= PLANE_ROOF_SAFE || rr > 560 ? Math.atan2(-pl.z, -pl.x) : Math.atan2(pl.z, pl.x);
          pl.hdg = this.steerHdg(pl.hdg, want, PLANE_TURN_AIR * 1.15 * dt);
          pl.x += Math.cos(pl.hdg) * pl.spd * dt;
          pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          if (pl.alt >= PLANE_CALT + pl.slot * 9 - 0.5) {
            pl.mode = "joinArc"; // steer onto a clean circle around the city
            pl.arcR = 336 + this.rnd() * 96;
          }
          break;
        }
        case "joinArc": {
          // chase the radially-nearest point of the cruise circle centred on the map
          pl.spd = PLANE_CRUISE_SPD;
          const ap = Math.atan2(pl.z, pl.x);
          const tx = Math.cos(ap) * pl.arcR, tz = Math.sin(ap) * pl.arcR;
          const d = Math.hypot(tx - pl.x, tz - pl.z);
          pl.hdg = this.steerHdg(pl.hdg, Math.atan2(tz - pl.z, tx - pl.x), PLANE_TURN_AIR * dt);
          pl.x += Math.cos(pl.hdg) * pl.spd * dt;
          pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          if (d < 10) {
            pl.mode = "cruise";
            pl.arcA = ap;
            // pick the arc direction whose tangent needs the smaller turn
            const dhPos = Math.abs(((ap + Math.PI / 2 - pl.hdg + Math.PI) % TAU + TAU) % TAU - Math.PI);
            const dhNeg = Math.abs(((ap - Math.PI / 2 - pl.hdg + Math.PI) % TAU + TAU) % TAU - Math.PI);
            pl.arcDir = dhPos <= dhNeg ? 1 : -1;
            pl.arcLeft = Math.PI * (2.4 + this.rnd() * 2.2); // ~1.2–2.3 laps
          }
          break;
        }
        case "cruise": {
          const w = (pl.spd / pl.arcR) * dt;
          pl.arcA += pl.arcDir * w;
          pl.arcLeft -= w;
          pl.x = Math.cos(pl.arcA) * pl.arcR;
          pl.z = Math.sin(pl.arcA) * pl.arcR;
          pl.hdg = pl.arcA + pl.arcDir * (Math.PI / 2);
          if (pl.arcLeft <= 0) {
            pl.mode = "joinFinal";
            // stay at cruise altitude while crossing back to the approach gate —
            // descending early used to clip planes straight through the downtown
            // towers on the diagonal; the descent only happens over the runway
            pl.wx = AIRPORT.rx0 - 120; pl.wz = AIRPORT.rz; pl.walt = PLANE_CALT;
          }
          break;
        }
        case "joinFinal": {
          pl.spd = PLANE_APPR_SPD;
          const d = Math.hypot(pl.wx - pl.x, pl.wz - pl.z);
          pl.alt += clamp(pl.walt - pl.alt, -12 * dt, 8 * dt);
          if (d < 16) {
            pl.mode = "final";
            pl.wx = AIRPORT.rx0 + 34; pl.wz = AIRPORT.rz; pl.walt = 0;
          } else {
            pl.hdg = this.steerHdg(pl.hdg, Math.atan2(pl.wz - pl.z, pl.wx - pl.x), PLANE_TURN_AIR * dt);
            pl.x += Math.cos(pl.hdg) * pl.spd * dt;
            pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          }
          break;
        }
        case "final": {
          const d = Math.hypot(pl.wx - pl.x, pl.wz - pl.z);
          pl.hdg = this.steerHdg(pl.hdg, Math.atan2(pl.wz - pl.z, pl.wx - pl.x), PLANE_TURN_AIR * 0.8 * dt);
          pl.x += Math.cos(pl.hdg) * pl.spd * dt;
          pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          // hold altitude until over the runway fence, then flare down onto the
          // tarmac — a steeper dive shortens the float so we still stop in range
          if (pl.x > AIRPORT.rx0 - 40) pl.alt = Math.max(0, pl.alt - 13 * dt);
          if (pl.alt <= 0.05) {
            pl.mode = "rollout"; pl.t = 0; pl.alt = 0;
          }
          break;
        }
        case "rollout": {
          pl.spd = Math.max(PLANE_TAXI_SPD, pl.spd - 8 * dt);
          pl.x += Math.cos(pl.hdg) * pl.spd * dt;
          pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          if (pl.spd <= PLANE_TAXI_SPD + 0.1 || pl.x > AIRPORT.rx1 + 20) {
            pl.mode = "taxiBack";
            const ax = AIRPORT.terminal.x - 26 + pl.slot * 22;
            pl.wx = ax; pl.wz = AIRPORT.apronZ; pl.walt = 0;
          }
          break;
        }
        case "taxiBack": {
          pl.spd = PLANE_TAXI_SPD;
          const d = Math.hypot(pl.wx - pl.x, pl.wz - pl.z);
          if (d < 6) {
            pl.mode = "parked";
            pl.t = 5 + this.rnd() * 10;   // random turn-around before the next flight
            pl.hdg = 0; pl.pitch = 0; pl.spd = 0;
            pl.x = pl.wx; pl.z = pl.wz;
          } else {
            pl.hdg = this.steerHdg(pl.hdg, Math.atan2(pl.wz - pl.z, pl.wx - pl.x), PLANE_TURN_TAXI * dt);
            pl.x += Math.cos(pl.hdg) * pl.spd * dt;
            pl.z += Math.sin(pl.hdg) * pl.spd * dt;
          }
          break;
        }
      }
      // visual pitch: nose up while climbing, down on approach, level elsewhere
      const wantPitch = pl.mode === "climb" ? 0.16 : pl.mode === "final" && pl.alt > 2 ? -0.1 : pl.mode === "roll" ? 0.05 : 0;
      pl.pitch += clamp(wantPitch - pl.pitch, -0.4 * dt, 0.4 * dt);

      // ✈️ drag the fuselage discs along the body — airborne planes fold their
      // colliders away so kids can play right underneath a cruising airliner.
      // Parked planes never move but the refresh is near-free, so it runs always
      // (keeps the discs glued even across the taxiBack → parked snap).
      const cols = this.planeCols[pi];
      if (cols) {
        const solid = pl.alt < 2.5;
        const fx = Math.cos(pl.hdg), fz = Math.sin(pl.hdg);
        for (let k = 0; k < cols.length; k++) {
          const c = this.world.circles[cols[k]];
          if (!c) continue;
          c.x = pl.x + fx * PLANE_DISCS[k].off;
          c.z = pl.z + fz * PLANE_DISCS[k].off;
          c.air = !solid;
          refreshCarCircle(this.world, cols[k]); // discs hop grid cells like a driven car's axles
        }
      }
    }
  }

  /* ---------------- lifecycle ---------------- */
  /**
   * Police side: promote a spread of civilians into vote-runners (protest marchers
   * keep marching). The join-bot is ALWAYS the first runner — the officer gets a
   * live target right at their site — and the rest are picked on a wide stride so
   * runners start scattered instead of stacked in one corner of the city.
   */
  private assignRunners() {
    if (this.side !== "police") return;
    let made = 0;
    const comp = this.civs.find((c) => c.companion);
    if (comp) { comp.runner = true; comp.timer = range(this.rnd, 2, 6); made++; }
    const stride = Math.max(1, Math.floor(this.civs.length / (RUNNER_COUNT + 1)));
    const off = Math.floor(this.rnd() * this.civs.length);
    for (let k = 0; k < this.civs.length && made < RUNNER_COUNT; k++) {
      const c = this.civs[(off + k * stride) % this.civs.length];
      if (c.protest || c.runner) continue;
      c.runner = true;
      c.timer = range(this.rnd, 2, 14); // staggered shift starts — deliveries trickle in, never a stampede
      made++;
    }
  }

  /**
   * Protester side: promote a spread of civilians into vote SCAVENGERS — bots that
   * notice loose cash piles, grab them and RUN them over to the town square on the main
   * road (the player delivers to the plaza; the bots gather loot into a lively
   * camp market). Stride-picked so they start spread across the whole city.
   */
  private assignScavengers() {
    for (const c of this.civs) { c.scav = false; c.pauseT = 0; }
    if (this.side !== "protester" || this.horror) return; // 💰 7Nights: nobody hauls votes — the cash rush is the player's game
    let made = 0;
    const comp = this.civs.find((c) => c.companion);
    if (comp) { comp.scav = true; made++; }
    const stride = Math.max(1, Math.floor(this.civs.length / (SCAVENGER_COUNT + 1)));
    const off = Math.floor(this.rnd() * this.civs.length);
    for (let k = 0; k < this.civs.length && made < SCAVENGER_COUNT; k++) {
      const c = this.civs[(off + k * stride) % this.civs.length];
      if (c.protest || c.runner || c.scav) continue;
      c.scav = true;
      c.pauseT = range(this.rnd, 0, 6); // staggered "leaving home" times
      made++;
    }
  }

  start() {
    this.running = true;
    this.toast(`🌙 Welcome, ${this.playerName}. ${PLAYERS_TOTAL} souls enter the 7 nights — each dusk, HALF turn. One walks out.`, "info");
    this.toast("🧱 THE WALL: after every night a shimmering barrier slams down TIGHTER. Beyond it, life drains fast — always stay inside the circle!", "info");
    this.toast("💰 Cash piles lie around town — scoop them up! The fallen drop their purses… first one there is richer.", "info");
    this.toast("☀️ DAY: chop trees (🪓 + F), smash rocks (🔨 + F), build defenses (🔧 + B). Find arms around town — press G to open your pack!", "info");
    this.toast("⚠️ DUSK: sirens howl… SEVERAL of us turn. Names vanish in the dark! NIGHT: the pack hunts. Hide, run… or FIGHT (🗡️ + F).", "info");
  }
  setToast(fn: ToastFn) { this.rawToast = fn; }

  /** Every event funnels through here — while the player is personally paused
   *  the feed is ALSO journaled so the welcome-back report can replay it. */
  toast(msg: string, kind: "info" | "good" | "bad" = "info") {
    if (this.personalPause && this.pauseLog.length < 60) this.pauseLog.push({ msg, kind });
    this.rawToast(msg, kind);
  }

  /** ⏸ flip the PERSONAL pause — the town keeps living, only you step out.
   *  Entering starts a fresh journal for the welcome-back report. */
  setPersonalPause(v: boolean) {
    if (v === this.personalPause) return;
    this.personalPause = v;
    if (v) this.pauseLog = [];
  }

  /* ------------ 👀 free-cam spectate — dead souls watch the town ------------ */

  /** Every living soul the free cam can hop to (bots + real remote players). */
  private specTargets(): { key: string; x: number; z: number; name: string }[] {
    const out: { key: string; x: number; z: number; name: string }[] = [];
    for (const c of this.crew) if (c.alive) out.push({ key: `c${c.id}`, x: c.x, z: c.z, name: c.name });
    for (const r of this.remotes) if (r.alive) out.push({ key: `r${r.slot}`, x: r.x, z: r.z, name: r.name });
    return out;
  }

  /** Enter free cam — the camera detaches from your corpse and follows the living. */
  startSpectate() {
    if (!this.lost) return; // only taken souls may wander the town unseen
    this.spectating = true;
    this.specKey = "";
    this.specSwapT = SPEC_SWAP_S;
    this.nextSpec();
    this.toast("👀 Free cam — you watch the town now. Click or N: next soul · Esc: death menu.", "info");
  }

  /** Leave free cam (back to the death recap menu). */
  stopSpectate() { this.spectating = false; }

  /** Hop to another random living soul (click / N / the auto-swap timer). */
  nextSpec() {
    const ts = this.specTargets();
    if (!ts.length) { this.specName = ""; return; }
    let pick = ts[Math.floor(this.rnd() * ts.length)];
    if (ts.length > 1 && pick.key === this.specKey) pick = ts[(ts.indexOf(pick) + 1) % ts.length];
    this.specKey = pick.key;
    this.specName = pick.name;
    this.specSwapT = SPEC_SWAP_S;
  }

  /** Where the free cam should float right now (null = nobody left alive). */
  specFocus(): { x: number; z: number; name: string } | null {
    if (!this.spectating) return null;
    const ts = this.specTargets();
    if (!ts.length) { this.specName = ""; return null; }
    const cur = ts.find((t) => t.key === this.specKey);
    if (cur) return cur;
    this.nextSpec(); // our soul just got taken — hop to someone else
    return ts.find((t) => t.key === this.specKey) ?? null;
  }

  reset(look: Appearance) {
    this.look = look;
    this.side = look.fac;
    this.policePerk = policeOutfitOf(look.fac === "police" ? look.outfit : "").stats;
    // 🎲 a fresh match drops you somewhere NEW (cops & crew scatter around it)
    this.rollPlayerSpawn();
    this.player = newBody(this.playerSpawn.x, this.playerSpawn.z);
    this.traceBuf = []; this.traceT = 0; this.nightDeaths = []; // fresh forensics per run
    this.hp = 100; this.stamina = 100; this.stars = 0; this.starTimer = 0; this.chased = false;
    this.crimeReport = null; this.botLootCd = 0;
    this.setPersonalPause(false); this.pauseLog = []; this.spectating = false; this.specName = ""; this.specKey = "";
    this.inv = []; this.hurtT = 0; this.exhaustedAnnounced = false; this.pocketFullT = 0; this.powerFullT = 0;
    this.invOnceT = 0; this.toolOnceT = 0; this.botDriven.clear();
    this.flipT = 0; this.squashT = 0; this.faintT = 0; this.carHitCd = 0;
    this.activePower = null; this.powerT = 0; this.powerPockets = []; this.morphKind = null; this.blinkCd = 0;
    for (const pw of this.powers) { pw.active = true; pw.respawn = 0; }
    this.carriedVotes = []; this.delivered = 0; this.points = 0; this.rescues = 0; this.caughtCount = 0;
    this.snacksEaten = 0; this.powersUsed = 0;
    this.runnerDelivered = 0; this.lost = false; this.catchCd = 0;
    // driving: hop out, re-hide the licenses, bring every car back to its parking spot
    this.hasLicense = false; this.drive = null; this.exitCd = 0; this.driveMsgT = 0;
    for (const lc of this.licenses) lc.active = true;
    this.world.cars.forEach((c, i) => {
      const h = this.carHome[i];
      c.x = h.x; c.z = h.z; c.rot = h.rot;
      const pair = this.carAxles.get(i);
      if (pair) {
        const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
        const ax = VEHICLE_AXLE[c.t] ?? 1.25;
        pair[0].x = h.x - fx * ax; pair[0].z = h.z - fz * ax;
        pair[1].x = h.x + fx * ax; pair[1].z = h.z + fz * ax;
      }
    });
    this.detainedT = 0; this.invulnT = 8; this.elapsed = 0; this.won = false; this.lost = false; this.clock = 0.3;
    this.arrest = "free"; this.arrestStation = -1; this.playerInVan = false; this.vanNeeded = false;
    /* --- 7 Nights: rewind the story --- */
    this.nightNo = 1; this.phase = "day"; this.phaseT = PHASE_DAY_S;
    this.possessed = []; this.youPossessed = false; this.lastPossessed = []; this.lastClue = null;
    this.zoneLevel = 0; this.zoneGraceT = 0; this.outsideWall = false; this.zoneToastCd = 0; // 🧱 the wall rewinds too
    this.tools = []; this.held = -1; this.res = { wood: 0, rock: 0 };
    this.attackCd = 0; this.accuseCd = 0; this.heartT = 0;
    this.kills = 0; this.accusesRight = 0; this.accusesWrong = 0; this.buildsMade = 0; this.nightsSurvived = 0;
    // fold away build colliders, then restore every static circle to its born radius
    for (const b of this.builds) { const c = this.world.circles[b.ci]; if (c) c.r = 0.02; }
    this.builds = [];
    this.world.circles.forEach((c, gi) => {
      if (c.car !== undefined || c.plane !== undefined) return; // cars/planes manage their own
      c.r = gi < this.circleR0.length ? this.circleR0[gi] : 0.02;
    });
    this.treeHits = new Array(this.world.trees.length).fill(0);
    this.rockHp = new Array(this.world.rocks.length).fill(ROCK_HITS);
    this.felled.clear(); this.brokenRocks.clear(); this.fellVersion++;
    this.fellTimes.clear(); this.fellDir.clear(); this.rockBreakAt.clear();
    this.lastChop = { i: -1, dx: 0, dz: 1 }; this.lastRock = -1;
    for (const te of this.toolEnts) { te.active = true; te.respawn = 0; }
    this.crew = [];
    this.spawnCrew();
    // 🌐 net bookkeeping starts clean — the PEOPLE (remotes) stay across resets
    this.mpBeastSlots = [];
    this.netScores.clear();
    for (const r of this.remotes) { r.beast = false; r.alive = true; r.hp = 100; }
    this.zombies = []; this.zRev++; // the dirt is empty — the contest fills it at dusk
    for (const an of this.animals) { an.dead = false; an.deadT = 0; an.zombie = false; an.hp = undefined; } // 🐕 a fresh week — every stray lives again
    this.finisherT = 0; this.deathT = 0; // ⚔️🩸 death juice rewinds
    stopDrone(); stopInsects(); // 🦗 the chorus falls silent with the light
    // 🪪 the license is NO LONGER a freebie: every survivor must physically hunt
    // down a glowing 🪪 card (or be handed one by a teammate) before any car starts
    for (const v of this.votes) { v.state = "world"; v.carrierId = undefined; v.respawnT = undefined; v.claimBy = undefined; const p = freeSpot(this.rnd, this.world, 16, 420); v.x = p.x; v.z = p.z; }
    for (const it of this.items) { it.active = true; it.respawn = 0; }
    for (const c of this.civs) { c.mode = "wander"; c.vanId = undefined; c.runner = false; c.voteId = undefined; c.pauseT = 0; }
    this.assignRunners();
    this.assignScavengers();
    // send every van home and park it at its gate
    for (const van of this.vans) {
      const st = POLICE_STATIONS[van.station];
      const g = stationGate(st);
      van.x = g.x + Math.sign(st.x) * 4; van.z = g.z + Math.sign(st.z) * 4;
      van.rot = Math.atan2(st.x - van.x, st.z - van.z);
      van.goal = { x: van.x, z: van.z };
      van.path = []; van.timer = 0; van.stallT = 0; van.rebuilds = 0;
      van.state = "idle"; van.prisoner = null;
    }
    // scatter cops away from spawn & calm them down so restarts are fair
    for (const cop of this.cops) {
      const sp = this.safeCopSpot();
      cop.x = sp.x; cop.z = sp.z; cop.vx = cop.vz = 0;
      cop.tx = sp.x; cop.tz = sp.z; cop.mode = "patrol"; cop.alertT = 0; cop.timer = 0;
      cop.targetCiv = undefined; cop.copCd = 0;
    }
    this.running = true;
  }

  /* ---------------- interactions ---------------- */
  interact() {
    if (!this.running || this.personalPause || this.lost) return;
    // in a car? E hops out first — everything else waits
    if (this.drive) { this.exitCar(); return; }
    // 🩸 7Nights: inspect a fallen survivor's body — learn the killer's clue
    const dead = this.nearestDeadCrew(3.2);
    if (dead && !dead.inspected) {
      dead.inspected = true;
      this.lastClue = `🔎 ${dead.name}: ${dead.clue}`;
      this.points += 10;
      sfx.click();
      this.toast(this.lastClue, "info");
      return;
    }
    // protester priority: rescue a detained civilian standing nearby
    if (this.side === "protester") {
      let best: Npc | null = null, bd = RESCUE_RADIUS * RESCUE_RADIUS;
      for (const c of this.civs) {
        if (c.mode !== "detained") continue;
        const d = dist2(this.player.x, this.player.z, c.x, c.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        best.mode = "rescued"; best.timer = 0;
        this.rescues++; this.points += POINTS_RESCUE;
        sfx.rescue();
        this.fxQueue.push({ type: "confetti", x: best.x, y: 1.4, z: best.z, hue: Math.random() });
        this.toast(`${best.name} is free! +${POINTS_RESCUE} support points ❤`, "good");
        return;
      }
    }
    // then: hop into the nearest parked car — GTA style, license required!
    const car = this.nearestCar(CAR_ENTER_R);
    if (car >= 0) { this.enterCar(car); return; }
    // police don't rescue their own prisoners — a friendly reminder instead
    if (this.side === "police") {
      this.toast("👮 You're the police today, Officer — no freeing the suspects! Chase runners instead.", "info");
    }
  }

  /* ---------------- GTA-style driving (license-gated) ---------------- */

  /** Index of the closest parked car within `maxD` of the player (−1 = none). */
  private nearestCar(maxD: number): number {
    let best = -1, bd = maxD * maxD;
    const cars = this.world.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const d = dist2(this.player.x, this.player.z, c.x, c.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Hop into a parked car — GTA style. A 🪪 driving license is required!
   *  Under arrest (frozen / riding the van / locked up)? No joyrides — a car
   *  entered here would never move (stepDrive is skipped) and `drive` would
   *  stick around after release, leaving the player INVISIBLE (mesh hides
   *  while driving). That was the "my car is just a shadow" bug. */
  private enterCar(ci: number) {
    if (this.exitCd > 0) return; // just hopped out — don't tumble straight back in
    if (this.detainedT > 0 || this.playerInVan) {
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 3;
        this.toast("🚔 You're under arrest — no car rides until the police let you go!", "bad");
      }
      return;
    }
    if (!this.hasLicense) {
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 3;
        sfx.alert();
        this.toast("🪪 You need a DRIVING LICENSE! Hunt the glowing blue cards — they sparkle on the map.", "info");
      }
      return;
    }
    // 🤖 a bot joyrider owns this car right now — go find your own
    if (this.botDriven.has(ci) || this.crew.some((o) => o.drive && o.drive.ci === ci)) {
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 2.5;
        this.toast("🤖 Someone is driving that car — find another ride!", "info");
      }
      return;
    }
    const car = this.world.cars[ci];
    this.drive = { ci, x: car.x, z: car.z, rot: car.rot, v: 0, c: car.c, t: car.t, vx: car.x, vz: car.z, vrot: car.rot, spin: 0, hitT: 0, steerVis: 0, steer: 0, pedal: 0, lastDir: 1 };
    const p = this.player;
    p.vx = p.vz = p.vy = 0;
    sfx.engine();
    sfx.door();
    this.toast(`${VEHICLE_LABELS[car.t % VEHICLE_LABELS.length]} Vroom! W/S gas & brake · A/D steer · E hop out · H horn!`, "good");
  }

  /** Hop out — the car stays parked where you left it (its colliders move along). */
  exitCar() {
    const d = this.drive;
    if (!d) return;
    this.drive = null;
    this.exitCd = 0.6;
    const p = this.player;
    // climb out on the door side; resolve nudges us clear of walls & the car itself
    p.x = d.x + Math.cos(d.rot) * 2.3;
    p.z = d.z - Math.sin(d.rot) * 2.3;
    // hop out ONTO the ground — on the ⛰️ band y=0 would bury us inside the mesh
    p.y = terrainHeight(p.x, p.z); p.vx = p.vz = p.vy = 0;
    p.face = d.rot;
    resolve(p, 0.45, this.world);
    const rr = Math.hypot(p.x, p.z);
    if (rr > WALL_RADIUS) { p.x *= WALL_RADIUS / rr; p.z *= WALL_RADIUS / rr; }
    sfx.door();
  }

  /** H key while driving — beep beep! */
  horn() { if (this.drive) sfx.horn(); }

  /* ---------------- 🪪 driving license — show & share ---------------- */

  /** 🤝 Hand the driving license to the closest other survivor — a REAL teammate
   *  in multiplayer (they get it over the wire), else the nearest fellow
   *  survivor bot standing next to you. Nobody within arm's reach? The card
   *  slips out of your hands and DROPS at your feet (see dropLicense). The
   *  giver is free to hunt a fresh 🪪 card afterwards. */
  giveLicense() {
    if (!this.running || this.personalPause || this.lost) return;
    if (!this.hasLicense) {
      this.toast("🪪 You don't have a driving license to give — hunt a glowing card first!", "info");
      return;
    }
    const R2 = 7 * 7; // arm's length + a bit
    let bd = R2;
    let best: { kind: "remote"; slot: number; name: string } | { kind: "crew"; name: string } | null = null;
    // real players first — the license is worth most in a teammate's pocket
    for (const r of this.remotes) {
      if (!r.alive) continue;
      const dd = dist2(this.player.x, this.player.z, r.x, r.z);
      if (dd < bd) { bd = dd; best = { kind: "remote", slot: r.slot, name: r.name }; }
    }
    if (!best) {
      for (const c of this.crew) {
        if (!c.alive) continue;
        const dd = dist2(this.player.x, this.player.z, c.x, c.z);
        if (dd < bd) { bd = dd; best = { kind: "crew", name: c.name }; }
      }
    }
    if (!best) {
      // 📦 F-fallback UX: nobody in reach → the card drops on the ground so
      // anyone (even us, after a walk back) can scoop it up again
      this.dropLicense();
      return;
    }
    this.hasLicense = false;
    sfx.click();
    this.fxQueue.push({ type: "confetti", x: this.player.x, y: 1.4, z: this.player.z, hue: 0.55 });
    if (best.kind === "remote") {
      this.netEmit?.({ t: "gift", kind: "license", toSlot: best.slot, from: this.playerName });
      this.toast(`🤝 You handed your driving license to ${best.name} — find another 🪪 card to drive again!`, "good");
    } else {
      this.toast(`🤝 ${best.name} promised to keep the license safe — find another 🪪 card to drive again!`, "good");
    }
  }

  /** 📦 Drop the driving license on the ground just ahead of us — fired from
   *  the license card (F key / Drop button) when NO survivor is close enough
   *  to hand it to, or on purpose. The card lands OUTSIDE the walk-over pickup
   *  radius (2.4u) so the dropper doesn't instantly re-collect it: anyone who
   *  strolls over it — a teammate, a bot, or us after a step back — pockets it. */
  dropLicense() {
    if (!this.hasLicense) {
      this.toast("🪪 You don't have a driving license to drop — hunt a glowing card first!", "info");
      return;
    }
    this.hasLicense = false;
    const p = this.player;
    const x = p.x + Math.sin(p.face) * 3.4, z = p.z + Math.cos(p.face) * 3.4; // past pickup radius
    this.placeDroppedLicense(x, z);
    sfx.click();
    this.toast("📦 Driving license dropped — walk over the card to scoop it back up!", "info");
    if (this.mp) this.netEmit?.({ t: "dropLicense", x, z, from: this.playerName });
  }

  /** Put a dropped 🪪 card into the world at (x,z): reuse a spent card entity
   *  when one exists (the 3D views bind per-card), else spawn a fresh one and
   *  bump licRev so the renderer rebuilds its view list. */
  private placeDroppedLicense(x: number, z: number) {
    const spent = this.licenses.find((lc) => !lc.active);
    if (spent) { spent.active = true; spent.x = x; spent.z = z; }
    else { this.licenses.push({ id: this.nid(), x, z, active: true }); this.licRev++; }
  }

  /** 🌐 a teammate dropped THEIR driving license on the ground — spawn the card
   *  here too so we can race over and snatch it for ourselves. */
  spawnDroppedLicense(x: number, z: number, fromName: string) {
    this.placeDroppedLicense(x, z);
    this.toast(`📦 ${fromName} dropped a driving license nearby — race over and grab it!`, "info");
  }

  /** 🌐 a teammate's client handed US their driving license over the wire. */
  receiveLicense(fromName: string) {
    if (this.hasLicense) return;
    this.hasLicense = true;
    sfx.power();
    this.fxQueue.push({ type: "confetti", x: this.player.x, y: 1.4, z: this.player.z, hue: 0.55 });
    this.toast(`🪪 ${fromName} handed you their DRIVING LICENSE — every parked car is yours now!`, "good");
  }

  /** Keep the driven vehicle's world entry + its two axle colliders glued to the body.
   *  The axle spread follows the body style — a bus sits on discs further apart.
   *  The moving axle circles also hop cells in the collider spatial hash, so bots
   *  (and the player on foot) keep bumping into the car wherever it drives. */
  private syncCarColliders(d: DriveState) {
    const car = this.world.cars[d.ci];
    car.x = d.x; car.z = d.z; car.rot = d.rot;
    const pair = this.carAxles.get(d.ci);
    if (!pair) return;
    const ax = VEHICLE_AXLE[d.t % VEHICLE_AXLE.length];
    const fx = Math.sin(d.rot), fz = Math.cos(d.rot);
    pair[0].x = d.x - fx * ax; pair[0].z = d.z - fz * ax;
    pair[1].x = d.x + fx * ax; pair[1].z = d.z + fz * ax;
    if (pair[0].idx !== undefined) refreshCarCircle(this.world, pair[0].idx);
    if (pair[1].idx !== undefined) refreshCarCircle(this.world, pair[1].idx);
  }

  /**
   * Push the whole vehicle body out of buildings, trees & other vehicles. The body
   * is modelled as its two axle discs — the same per-style ±axle / r pair the parked
   * fleet uses as colliders — so the nose and boot are protected, and a moving vehicle
   * can never overlap a building deeper than a parked one. Both axles are resolved,
   * then the pose (centre + heading) is rebuilt from them, which turns a head-on bonk
   * into a natural slide along the wall. Returns how far the body was shoved (the
   * caller spends it as scrape speed loss).
   */
  private resolveCarBody(d: DriveState): number {
    const ax = VEHICLE_AXLE[d.t % VEHICLE_AXLE.length];
    const axR = VEHICLE_AXLE_R[d.t % VEHICLE_AXLE_R.length];
    let moved = 0;
    for (let iter = 0; iter < 2; iter++) {
      const sn = Math.sin(d.rot), cs = Math.cos(d.rot);
      const rear = { x: d.x - sn * ax, z: d.z - cs * ax };
      const front = { x: d.x + sn * ax, z: d.z + cs * ax };
      const r0x = rear.x, r0z = rear.z, f0x = front.x, f0z = front.z;
      resolve(rear, axR, this.world, d.ci);
      resolve(front, axR, this.world, d.ci);
      const push = Math.hypot(rear.x - r0x, rear.z - r0z) + Math.hypot(front.x - f0x, front.z - f0z);
      moved += push;
      // rebuild heading from the pushed axle line (axles pushed apart won't flip it)
      const nx = front.x - rear.x, nz = front.z - rear.z;
      if (Math.hypot(nx, nz) > 0.05) d.rot = Math.atan2(nx, nz);
      d.x = (front.x + rear.x) / 2;
      d.z = (front.z + rear.z) / 2;
      if (push < 0.0005) break; // settled — no need for the second pass
    }
    return moved;
  }

  /** One arcade physics step of the player-driven vehicle — bouncy, fast, kid-friendly.
   *  Body style matters: a bus tops out slower and corners wide, a jeep zips about. */
  private stepDrive(dt: number) {
    const d = this.drive!;
    const p = this.player;
    const ti = d.t % VEHICLE_TOP.length;
    // pedal & steering both EASE toward the raw key/joystick value (see
    // DriveState.pedal / DriveState.steer) — digital keys glide, never snap.
    // EASED PEDAL — see DriveState.pedal. Pressing glides to the key in ~0.25 s
    // (responsive but never a slam); releasing fades a touch faster into coast.
    const pedalT = this.input.f;
    d.pedal += (pedalT - d.pedal) * (1 - Math.exp(-dt * (pedalT !== 0 ? 10 : 16)));
    if (pedalT === 0 && Math.abs(d.pedal) < 0.004) d.pedal = 0; // settle, don't creep
    const f = d.pedal;
    const steerT = this.input.r;
    d.steer += (steerT - d.steer) * (1 - Math.exp(-dt * (steerT !== 0 ? 14 : 18)));
    if (steerT === 0 && Math.abs(d.steer) < 0.004) d.steer = 0; // settle, don't creep
    const maxF = VEHICLE_TOP[ti] * (this.activePower === "sonic" ? 1.3 : 1);
    if (f > 0.01) d.v += CAR_ACCEL * dt * f;
    else if (f < -0.01) d.v -= (d.v > 0.5 ? CAR_BRAKE : CAR_ACCEL * 0.55) * dt * -f;
    else d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), CAR_COAST * dt);
    // Top speed is a SOFT ceiling now: when the ceiling drops (sonic wearing off)
    // the old hard clamp cut up to ~8 u/s in a single frame — a yank. Over-speed
    // bleeds off like drag instead; the clamp only hard-guards the reverse floor.
    if (d.v > maxF) d.v = maxF + (d.v - maxF) * Math.exp(-dt * 4);
    if (d.v < -CAR_REV_SPEED) d.v = -CAR_REV_SPEED;
    // Speed→grip curve: never dead at a standstill (half lock so you can always
    // wiggle out of a parking squeeze), full bite by ~5 u/s, then a gentle taper
    // toward top speed so a 26 u/s car doesn't twitch at the first touch of A/D.
    // Buses taper harder via their VEHICLE_STEER multiplier. Flips while reversing.
    const sp = Math.abs(d.v);
    const grip = (0.5 + 0.5 * Math.min(1, sp / 5)) * (1 - 0.28 * Math.min(1, sp / VEHICLE_TOP[ti])) * VEHICLE_STEER[ti];
    // integrate in small slices (a 26 u/s car covers 0.43/frame — slices make sure
    // it can never LEAP a thin wall in one step), then push the WHOLE body out of
    // buildings, trees and other cars: the old single centre probe let the nose
    // and boot hang deep inside houses, or pop clean through at speed.
    const slices = Math.max(1, Math.ceil((Math.abs(d.v) * dt) / 0.35));
    const sdt = dt / slices;
    // rolling-direction hysteresis — see DriveState.lastDir
    if (Math.abs(d.v) > 0.35) d.lastDir = d.v > 0 ? 1 : -1;
    let scrape = 0;
    for (let s = 0; s < slices; s++) {
      d.rot -= d.steer * CAR_STEER * grip * sdt * d.lastDir;
      d.x += Math.sin(d.rot) * d.v * sdt;
      d.z += Math.cos(d.rot) * d.v * sdt;
      scrape += this.resolveCarBody(d);
    }
    // cartoon scrape — walls eat speed (exp form: identical feel at 30 or 144 fps,
    // the old per-frame 0.82 multiplier braked ~4× harder on a 144 Hz screen)
    if (scrape > 0.004) { d.v *= Math.exp(-dt * 12); if (d.hitT <= 0) this.addShake(0.16); d.hitT = 0.35; }
    const rr = Math.hypot(d.x, d.z);
    if (rr > WALL_RADIUS) {
      d.x *= WALL_RADIUS / rr; d.z *= WALL_RADIUS / rr;
      if (d.v > 4) d.v = 4 + (d.v - 4) * Math.exp(-dt * 6); // bleed to wall speed — don't snap 26→4 in one frame
    }
    // ring-road traffic & police vans are solid — the vehicle bonks off, nobody gets hurt
    for (const t of this.traffic) {
      const tr = VEHICLE_AXLE_R[t.t % VEHICLE_AXLE_R.length] + VEHICLE_AXLE_R[ti] + 0.12;
      const tdx = d.x - t.x, tdz = d.z - t.z, td2 = tdx * tdx + tdz * tdz;
      if (td2 < tr * tr && td2 > 0.0001) {
        const td = Math.sqrt(td2);
        d.x = t.x + (tdx / td) * tr; d.z = t.z + (tdz / td) * tr;
        d.v *= Math.exp(-dt * 17); if (d.hitT <= 0) this.addShake(0.3); d.hitT = 0.35; // dt-based: same bonk at any fps
      }
    }
    for (const van of this.vans) {
      const vdx = d.x - van.x, vdz = d.z - van.z, vd2 = vdx * vdx + vdz * vdz;
      if (vd2 < 3.2 * 3.2 && vd2 > 0.0001) {
        const vd = Math.sqrt(vd2);
        d.x = van.x + (vdx / vd) * 3.2; d.z = van.z + (vdz / vd) * 3.2;
        d.v *= Math.exp(-dt * 17); if (d.hitT <= 0) this.addShake(0.3); d.hitT = 0.35;
      }
    }
    /* --- smoothed visual pose: what the camera & renderer SEE ---
     * Clean driving eases almost 1:1 (no cornering lag → no skating look); a
     * bump keeps the soft follow alive for a beat so push-outs read as squash,
     * not teleporting. */
    d.hitT = Math.max(0, d.hitT - dt);
    // pose stiffness BLENDS back as the hit window drains (was binary: the frame
    // the soft flag expired, easing jumped 26→90 and tugged the body)
    const softW = Math.min(1, d.hitT / 0.15);
    const kp = 1 - Math.exp(-dt * (90 - 64 * softW));
    const kr = 1 - Math.exp(-dt * (90 - 70 * softW));
    const pvx = d.vx, pvz = d.vz;
    d.vx += (d.x - d.vx) * kp;
    d.vz += (d.z - d.vz) * kp;
    let vdr = d.rot - d.vrot;
    vdr = Math.atan2(Math.sin(vdr), Math.cos(vdr));
    d.vrot += vdr * kr;
    // wheels roll by the distance the VISUAL body actually covered (±reverse)
    d.spin -= (Math.hypot(d.vx - pvx, d.vz - pvz) * Math.sign(d.v || 1)) / 0.46;
    // front wheels visibly turn into the EASED steer (they now match the real
    // turn rate — before they led it on keyboard, teleporting to full lock) and
    // flip with reverse, like the body. Exp easing: identical at any framerate.
    const wantSteer = -d.steer * Math.min(1, Math.abs(d.v) / 5) * 0.42 * Math.sign(d.v || 1);
    d.steerVis += (wantSteer - d.steerVis) * (1 - Math.exp(-dt * 10));
    this.syncCarColliders(d);
    // the driver rides inside — glue the body to the car so the camera, HUD and
    // every pickup (votes, snacks, gems, licenses) keep working off the player pos.
    // ⛰️ the body ALSO rides the terrain: on the mountain band the ground rises,
    // and the camera hangs off p.y — keeping it at a flat 0.32 sank the chase
    // camera (and every look-at) into the hillside while the car climbed.
    p.x = d.x; p.z = d.z;
    const gy = terrainHeight(d.x, d.z) + 0.32;
    // ⛰️ tracked a touch tighter (12/s): on the rolling mud-valley bumps a lazy
    // ease let the body lag below fast climbs and read as sinking into the hill
    p.y += (gy - p.y) * Math.min(1, dt * 12); // eased so bumpy ground never jolts the camera
    p.vx = Math.sin(d.rot) * d.v; p.vz = Math.cos(d.rot) * d.v; p.vy = 0;
    p.face = d.rot;
    // camera trails behind the car while it rolls (mouse look still nudges it)
    // the auto-follow pauses for a beat after any mouse/touch look so the two
    // never fight over the camera — that tug-of-war read as jerky driving
    const mouseIdle = performance.now() - this.input.mouseAt > 650;
    // engage/disengage LATCH: one 2.5 u/s threshold made the chase toggle on/off
    // around it (slow roll-over → repeated camera tugs). On above 2.5, off below 1.7.
    if (Math.abs(d.v) > 2.5) this.followOn = true;
    else if (Math.abs(d.v) < 1.7) this.followOn = false;
    if (this.followOn && mouseIdle) {
      const want = d.v < 0 ? d.rot : d.rot + Math.PI; // reversing: look the way the car backs
      let dd = want - this.input.yaw;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      this.input.yaw += dd * (1 - Math.exp(-dt * 4.2)); // exp ease, fps-safe — 4.2/s halves the cornering hang (was 2.6: the camera swung ~33° behind the tail mid-turn and the car read as sliding)
      this.input.yaw = ((this.input.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
    }
    if (mouseIdle) this.input.pitch += (0.34 - this.input.pitch) * Math.min(1, dt * 1.6);
    // driving is restful — stamina recovers at walking rate
    this.stamina = Math.min(100, this.stamina + 12 * AGE_STATS[this.look.age].regen * dt);
  }

  /* ---------------- police side: stop the vote runners ---------------- */

  /** One AI runner tick (legacy police mode) — seek loot → smuggle it to the plaza → lay low → repeat. */
  private stepRunner(c: Npc, dt: number) {
    const p = this.player;
    // 1) an AI cop is chasing them (backup helping the officer) — panic the old way
    const hunter = this.cops.find((cc) => cc.targetCiv === c.id && cc.mode === "chase");
    if (hunter) {
      const dx = c.x - hunter.x, dz = c.z - hunter.z, d = Math.hypot(dx, dz) || 1;
      stepNpc(c, c.x + (dx / d) * 10, c.z + (dz / d) * 10, c.speed * CIV_FLEE_MULT, dt, this.world);
      c.mode = "flee";
      return;
    }
    // 2) the officer (player) got close — run FROM the player, keeping their loot
    const dpx = c.x - p.x, dpz = c.z - p.z, dp = Math.hypot(dpx, dpz);
    if (dp < RUNNER_FLEE_R) {
      c.mode = "flee";
      stepNpc(c, c.x + (dpx / (dp || 1)) * 12, c.z + (dpz / (dp || 1)) * 12, c.speed * 1.55, dt, this.world);
      return;
    }
    c.mode = "wander";
    // 3) laying low after a delivery / release — amble around, then get back to work
    if (c.timer > 0 && !c.voteId) {
      c.timer -= dt;
      if (dist2(c.x, c.z, c.tx, c.tz) < 2 || Math.random() < dt * 0.5) {
        const t = freeSpot(this.rnd, this.world, 8, CITY_RADIUS - 6);
        c.tx = t.x; c.tz = t.z;
      }
      stepNpc(c, c.tx, c.tz, c.speed * 0.6, dt, this.world);
      return;
    }
    if (!c.voteId) {
      // 4) seek the nearest vote lying in the world — CLAIM it first so 14 runners
      // never stampede after the same ballot (claims spread them across the city)
      let best: VoteEnt | null = null, bd = Infinity;
      for (const v of this.votes) {
        if (v.state !== "world") continue;
        if (v.claimBy !== undefined && v.claimBy !== c.id) continue;
        const d = dist2(c.x, c.z, v.x, v.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) { // city is out of loose loot — lurk until one "sneaks back"
        if (dist2(c.x, c.z, c.tx, c.tz) < 2) { const t = spotNear(this.rnd, this.world, c.x, c.z, 12, 80); c.tx = t.x; c.tz = t.z; }
        stepNpc(c, c.tx, c.tz, c.speed * 0.6, dt, this.world);
        return;
      }
      best.claimBy = c.id;
      stepNpc(c, best.x, best.z, c.speed, dt, this.world);
      if (bd < 1.5 * 1.5) { // grabbed it — full sprint for the plaza
        best.state = "carried"; best.carrierId = c.id; best.claimBy = undefined;
        c.voteId = best.id;
      }
      return;
    }
    // 5) smuggle the vote to the ballot box
    const v = this.votes.find((vv) => vv.id === c.voteId);
    if (!v || v.state !== "carried") { c.voteId = undefined; return; } // vote lost (bust scramble) — go seek again
    stepNpc(c, BALLOT.x, BALLOT.z, c.speed * 1.12, dt, this.world);
    if (dist2(c.x, c.z, BALLOT.x, BALLOT.z) < (DELIVER_RADIUS + 0.8) * (DELIVER_RADIUS + 0.8)) {
      v.state = "delivered";
      v.carrierId = undefined;
      v.respawnT = RUNNER_VOTE_RESPAWN_S; // the stolen vote "returns" to the city a little later
      c.voteId = undefined;
      c.timer = range(this.rnd, 9, 20);   // lay low before the next run
      this.runnerDelivered++;
      sfx.alert();
      this.fxQueue.push({ type: "confetti", x: BALLOT.x, y: 1.5, z: BALLOT.z, hue: 0.02 });
      if (this.runnerDelivered >= RUNNER_LOSE_DELIVERIES) {
        this.lost = true;
        sfx.caught();
        this.toast(`🚨 The runners smuggled ${RUNNER_LOSE_DELIVERIES} loot bags across town… the shift is lost, Officer!`, "bad");
      } else {
        this.toast(`😠 A runner delivered a loot bag! (${this.runnerDelivered}/${RUNNER_LOSE_DELIVERIES}) — stop them!`, "bad");
      }
    }
  }

  /** A runner loses their smuggled vote — it scatters back into the world as a loose pickup. */
  private dropRunnerVote(c: Npc) {
    const v = c.voteId ? this.votes.find((vv) => vv.id === c.voteId) : null;
    if (v && v.state === "carried") {
      const a = Math.random() * Math.PI * 2, d = range(this.rnd, 0.8, DROP_SCATTER);
      const p = { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
      resolve(p, 0.8, this.world);
      v.x = p.x; v.z = p.z; v.state = "world"; v.carrierId = undefined; v.claimBy = undefined;
    }
    c.voteId = undefined;
  }

  /**
   * One AI vote-scavenger tick — the living-city loop that makes bots act like real
   * humans: loiter → notice a loose vote → RUN to grab it → haul it to the protest
   * camp on the main road → catch their breath → head out again. Cops can still
   * arrest a scaving bot, scattering their vote (rescue play!). The camp pile is a
   * market: anyone — the player included — can grab votes from it.
   */
  private stepScavenger(c: Npc, dt: number) {
    // human-like loiter: real people stand around, chat, tie a shoe, THEN move on
    if ((c.pauseT ?? 0) > 0) { c.pauseT = (c.pauseT ?? 0) - dt; return; }
    if (c.voteId != null) {
      // hauling: walk the vote over to the protest camp on the main road
      const v = this.votes.find((vv) => vv.id === c.voteId);
      if (!v || v.state !== "carried") { c.voteId = undefined; return; } // vote lost mid-haul
      if (dist2(c.x, c.z, TOWN_SQUARE.x, TOWN_SQUARE.z) < HAUL_CAMP_R * HAUL_CAMP_R) {
        // release it onto the camp pile — it stays a world pickup anyone can grab
        const a = Math.random() * Math.PI * 2, d = range(this.rnd, 1.6, 4.6);
        const p = { x: TOWN_SQUARE.x + Math.cos(a) * d, z: TOWN_SQUARE.z + Math.sin(a) * d };
        resolve(p, 0.8, this.world);
        v.x = p.x; v.z = p.z; v.state = "world"; v.carrierId = undefined; v.claimBy = undefined;
        c.voteId = undefined;
        c.pauseT = range(this.rnd, 4, 10); // proud of the haul — take a breather
        if (dist2(c.x, c.z, this.player.x, this.player.z) < 55 * 55) {
          this.toast(`${c.name} hauled a cash pile to the town square! 🏕️`, "info");
        }
        return;
      }
      stepNpc(c, TOWN_SQUARE.x, TOWN_SQUARE.z, c.speed * 0.85, dt, this.world); // haul = a bit slower
      return;
    }
    // hunt: the nearest loose vote nobody else claimed (votes already piled at camp stay put)
    let best: VoteEnt | null = null, bd = SCAVENGER_SENSE_R * SCAVENGER_SENSE_R;
    for (const v of this.votes) {
      if (v.state !== "world") continue;
      if (v.claimBy !== undefined && v.claimBy !== c.id) continue;
      if (dist2(v.x, v.z, TOWN_SQUARE.x, TOWN_SQUARE.z) < 25 * 25) continue;
      const d = dist2(c.x, c.z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) {
      best.claimBy = c.id;
      stepNpc(c, best.x, best.z, c.speed, dt, this.world);
      if (bd < 1.5 * 1.5) { // grabbed it — jog it to the camp
        best.state = "carried"; best.carrierId = c.id; best.claimBy = undefined;
        c.voteId = best.id;
      }
      return;
    }
    // nothing worth grabbing nearby — stroll the neighbourhood like a real human,
    // with the occasional long cross-town trip
    if (dist2(c.x, c.z, c.tx, c.tz) < 2) {
      const t = this.rnd() < 0.78
        ? spotNear(this.rnd, this.world, c.x, c.z, 10, 75)
        : freeSpot(this.rnd, this.world, 8, CITY_RADIUS - 8);
      c.tx = t.x; c.tz = t.z;
      if (this.rnd() < 0.5) c.pauseT = range(this.rnd, 0.8, 3);
    }
    stepNpc(c, c.tx, c.tz, c.speed * 0.8, dt, this.world);
  }

  /** Walked-into-a-runner arrest: detain, scatter their loot, count the bust. */
  private bustRunner(c: Npc) {
    const perk = this.policePerk;
    this.catchCd = RUNNER_CATCH_CD * perk.bustCdMult;
    c.mode = "detained"; c.timer = CIV_DETAIN_S; // the van fleet automatically drives them to the station cage
    const v = c.voteId ? this.votes.find((vv) => vv.id === c.voteId) : null;
    const carrying = !!(v && v.state === "carried");
    this.dropRunnerVote(c);
    this.caughtCount++; // police side: counts runners busted
    const pts = Math.round((BUST_POINTS + (carrying ? BUST_CARRY_BONUS : 0)) * perk.scoreMult);
    this.points += pts;
    sfx.caught();
    this.fxQueue.push({ type: "confetti", x: c.x, y: 1.3, z: c.z, hue: 0.58 });
    this.toast(carrying
      ? `🚓 Busted ${c.name} red-handed! Loot secured — +${pts}! A van is taking them in.`
      : `🚓 Busted ${c.name}! +${pts} — a van is taking them in. (${this.caughtCount}/${BUST_TARGET})`, "good");
    // nearby runners scatter in panic — they lay low for a bit before re-attempting
    for (const o of this.civs) {
      if (!o.runner || o === c || o.mode !== "wander") continue;
      if (dist2(o.x, o.z, c.x, c.z) < 16 * 16) o.timer = Math.max(o.timer, range(this.rnd, 3, 8));
    }
    if (this.caughtCount >= BUST_TARGET) {
      this.won = true; this.wonAt = Date.now();
      this.points += 500;
      sfx.win();
      this.toast(`🏆 ALL ${BUST_TARGET} RUNNERS BUSTED! The city is safe — great work, Officer!`, "good");
    }
  }

  /** Police-side per-frame tick: bust checks, vote respawn, witness panic. */
  private updatePoliceMode(dt: number) {
    const p = this.player;
    this.catchCd = Math.max(0, this.catchCd - dt);
    // 🛡️ Riot Squad: the shield gives you a wider walk-into bust reach
    const bustR = RUNNER_CATCH_R * this.policePerk.bustRMult;
    if (this.detainedT <= 0 && this.faintT <= 0 && !this.won && !this.lost && this.catchCd <= 0) {
      for (const c of this.civs) {
        // bust ANY runner on contact — wandering or fleeing. Runners panic at 9u and
        // sprint away, so requiring "wander" here made them literally uncatchable:
        // chasing them down (on foot or by car!) and touching them is the whole game.
        if (!c.runner || c.protest) continue;
        if (c.mode !== "wander" && c.mode !== "flee") continue;
        if (dist2(p.x, p.z, c.x, c.z) < bustR * bustR) {
          this.bustRunner(c);
          break; // one bust per cooldown — no crowd sweeps
        }
      }
    }
    // delivered votes "sneak back" into the city so the shift can always be played
    for (const v of this.votes) {
      if (v.state !== "delivered" || !v.respawnT) continue;
      v.respawnT -= dt;
      if (v.respawnT <= 0) {
        const spot = freeSpot(this.rnd, this.world, 14, 300);
        v.x = spot.x; v.z = spot.z; v.state = "world"; v.respawnT = undefined; v.claimBy = undefined;
      }
    }
  }

  private dropVotes(x: number, z: number) {
    for (const v of this.carriedVotes) {
      const a = Math.random() * Math.PI * 2, d = range(this.rnd, 0.8, DROP_SCATTER);
      const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
      resolve(p, 0.8, this.world);
      v.x = p.x; v.z = p.z; v.state = "world"; v.claimBy = undefined;
    }
    this.carriedVotes = [];
  }

  /* ---------------- 👮 crime & punishment ---------------- */

  /** 🚨 A crime just happened at (x, z). A cop who SAW it drops everything and
   *  chases; townsfolk witnesses scream, scatter, and radio it in — cops near
   *  the scene walk over to investigate. The warrant = wanted stars (HUD). */
  private reportCrime(kind: "murder" | "assault" | "robbery", x: number, z: number) {
    if (this.side === "police") return;                        // you ARE the law — no self-arrest
    if (this.phase !== "day" && this.phase !== "dawn") return; // night has no law — the beasts own it
    if (this.won || this.lost) return;
    let seen = false;
    for (const cop of this.cops) {
      const already = cop.mode === "chase" && cop.targetCiv == null && cop.targetCrew == null;
      const watched = dist2(cop.x, cop.z, x, z) < CRIME_SEE_R * CRIME_SEE_R && lineClear(cop.x, cop.z, x, z, this.world);
      if (already || watched) {
        seen = true;
        if (!already && cop.mode !== "chase") { cop.mode = "chase"; cop.targetCiv = undefined; cop.alertT = ESCAPE_LOST_S; cop.timer = 0; }
      }
    }
    this.starTimer = STAR_DECAY_S;
    const starAdd = kind === "murder" ? CRIME_STAR_MURDER : CRIME_STAR_MINOR;
    if (seen) {
      this.stars = Math.min(5, this.stars + starAdd);
      this.chased = true;
      sfx.alert();
      this.addShake(kind === "murder" ? 0.55 : 0.3);
      this.toast(
        kind === "murder" ? "🚨 MURDER in broad daylight! A cop saw EVERYTHING — RUN!"
        : kind === "robbery" ? "🚨 A cop saw you steal that purse — ROBBERY! They're coming!"
        : "🚨 A cop saw you attack an innocent — they're coming for you!", "bad");
    } else {
      // 👀 any townsfolk nearby becomes a witness — they bolt & the report goes out
      let witness: Npc | null = null, wd = CRIME_CIV_SEE_R * CRIME_CIV_SEE_R;
      for (const c of this.civs) {
        if (c.dead || c.mode === "detained") continue;
        const d = dist2(c.x, c.z, x, z);
        if (d < wd) { wd = d; witness = c; }
      }
      if (!witness) return; // nobody saw a thing — the street keeps your secret
      this.stars = Math.min(5, this.stars + starAdd);
      this.crimeReport = { x, z, t: CRIME_REPORT_T };
      // the crowd scatters in terror — townsfolk AND contestants who saw it
      for (const c of this.civs) {
        if (c.dead || c.mode === "detained") continue;
        if (dist2(c.x, c.z, x, z) < CRIME_CIV_SEE_R * CRIME_CIV_SEE_R) { c.panicT = 3; c.fearX = x; c.fearZ = z; }
      }
      for (const c of this.crew) {
        if (!c.alive || c.mode === "possessed") continue;
        if (dist2(c.x, c.z, x, z) < CRIME_CIV_SEE_R * CRIME_CIV_SEE_R) { c.fearT = 3.5; c.fearX = x; c.fearZ = z; c.seek = null; }
      }
      sfx.alert();
      this.toast(
        kind === "murder" ? "👀 A witness saw the MURDER and is running to tell the police…"
        : kind === "robbery" ? "👀 A witness saw you steal the purse and is off to the police…"
        : "👀 A witness saw you attack an innocent and is off to the police…", "bad");
    }
  }

  private catchPlayer(cop: Npc) {
    this.caughtCount++;
    this.stars = Math.min(5, this.stars + 1);
    this.starTimer = STAR_DECAY_S;
    this.hp = Math.max(1, this.hp - 8);
    this.hurtT = HURT_FLASH_S;
    this.drive = null; // arrested → out of the car (its colliders stay where it sits)
    this.detainedT = DETAIN_SECONDS;   // frozen during the van ride — counts down once locked up
    this.invulnT = RELEASE_GRACE_S;
    this.arrest = "called";
    this.arrestStation = this.nearestStationIdx(this.player.x, this.player.z);
    this.vanNeeded = true;             // updateVans() dispatches the nearest free van
    // the catcher celebrates, then walks ALL the way back — far away from the player
    cop.mode = "celebrate"; cop.timer = 2.5;
    const spot = this.spotAwayFromPlayer(70);
    cop.tx = spot.x; cop.tz = spot.z;
    sfx.caught();
    sfx.siren();
    const carried = this.carriedVotes.length;
    this.toast(carried > 0
      ? `🚔 Caught! Police called a van — you and your ${carried} loot bag${carried > 1 ? "s" : ""} are going to the station…`
      : `🚔 Caught for suspicious giggling! A police van is coming to take you in…`, "bad");
  }

  private deliver() {
    let n = 0;
    while (this.carriedVotes.length) {
      const v = this.carriedVotes.pop()!;
      v.state = "delivered";
      this.delivered++;
      this.points += POINTS_DELIVER;
      n++;
    }
    if (n > 0) {
      sfx.deliver();
      this.fxQueue.push({ type: "confetti", x: BALLOT.x, y: 1.6, z: BALLOT.z, hue: Math.random() });
      const left = TOTAL_VOTES - this.delivered;
      this.toast(n === 1 ? `Loot delivered! +${POINTS_DELIVER}` : `${n} loot bags delivered! +${POINTS_DELIVER * n}`, "good");
      if (left === 0) {
        this.won = true; this.wonAt = Date.now();
        this.points += 500;
        sfx.win();
        this.toast("🏆 ALL VOTES DELIVERED! Democracy saved — you legend!", "good");
      } else if (left <= 3) {
        this.toast(`Only ${left} deliveries to go!`, "info");
      }
    }
  }

  private dizzyRespawn() {
    // if a van was taking us in, call it off
    for (const van of this.vans) {
      if (van.prisoner?.kind === "player") this.abortVan(van);
    }
    this.playerInVan = false;
    this.drive = null; // bail out of the spinning car too
    this.arrest = "free"; this.arrestStation = -1; this.vanNeeded = false;
    this.crimeReport = null; this.botLootCd = 0;
    this.player.x = this.playerSpawn.x; this.player.z = this.playerSpawn.z; this.player.y = 0;
    this.player.vx = this.player.vz = 0;
    this.hp = 60;
    this.hurtT = HURT_FLASH_S;
    this.detainedT = 4;
    this.invulnT = 3;
    this.dropVotes(this.playerSpawn.x + 2, this.playerSpawn.z + 2);
    this.toast("Whoa, everything is spinning… a kind chaiwala helped you.", "bad");
  }

  /* ---------------- police van fleet: arrest transport ---------------- */

  /** Drive a van along its waypoint path; returns true once the FINAL goal is reached. */
  private stepVan(v: PoliceVan, dt: number): boolean {
    const target = v.path[0];
    if (!target) return true;
    const dx = target.x - v.x, dz = target.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const step = Math.min(d, VAN_SPEED * dt);
      const pt = { x: v.x + (dx / d) * step, z: v.z + (dz / d) * step };
      resolve(pt, VAN_RADIUS, this.world); // slide around the odd parked car
      const got = Math.hypot(pt.x - v.x, pt.z - v.z);
      // stall watchdog: wedged against a corner → skip the waypoint, rebuild if hopeless
      if (got < step * 0.25) {
        v.stallT += dt;
        if (v.stallT > 1.0) {
          v.stallT = 0;
          if (v.path.length > 1) v.path.shift();
          else if (v.rebuilds < 4) { v.rebuilds++; v.path = roadPath(v.x, v.z, v.goal.x, v.goal.z); }
          else return true; // give up gracefully — close enough for a cartoon van
        }
      } else v.stallT = 0;
      v.x = pt.x; v.z = pt.z;
      const tr = Math.atan2(dx, dz);
      let dd = tr - v.rot; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      v.rot += dd * Math.min(1, dt * 5);
    }
    if (d < 3) {
      v.path.shift();
      return v.path.length === 0;
    }
    return false;
  }

  /** Van aborted mid-job (prisoner rescued/freed) — drive home and park. */
  private abortVan(van: PoliceVan, civ?: Npc | undefined) {
    if (civ && civ.vanId === van.id) civ.vanId = undefined;
    van.prisoner = null;
    const st = POLICE_STATIONS[van.station];
    const g = stationGate(st);
    const home = { x: g.x + Math.sign(st.x) * 4, z: g.z + Math.sign(st.z) * 4 };
    van.goal = home;
    van.path = roadPath(van.x, van.z, home.x, home.z);
    van.state = "return";
  }

  /** The van doors open at the station: impound carried votes in the cage + fine, start the lock-up clock. */
  private lockUpPlayer(stationIdx: number) {
    const st = POLICE_STATIONS[stationIdx];
    const gate = stationGate(st);
    const p = this.player;
    p.x = gate.x; p.z = gate.z; p.y = 0; p.vx = p.vz = p.vy = 0;
    this.playerInVan = false;
    this.drive = null; // never leave the station still "holding" a wheel — the mesh
    this.exitCd = 0;   // hides while drive is set (the invisible-player bug)
    this.arrest = "locked";
    this.arrestStation = stationIdx;
    const cage = stationCage(st);
    const taken = this.carriedVotes.length;
    for (const v of this.carriedVotes) {
      const a = Math.random() * Math.PI * 2, d = range(this.rnd, 0.6, 2.6);
      v.x = cage.x + Math.cos(a) * d; v.z = cage.z + Math.sin(a) * d; v.state = "world";
    }
    this.carriedVotes = [];
    this.points = Math.max(0, this.points - CONFISCATE_FINE);
    this.detainedT = DETAIN_SECONDS;
    this.toast(taken > 0
      ? `⚖️ Locked up at ${st.name}! ${taken} cash pile${taken > 1 ? "s" : ""} impounded in the cage + ${CONFISCATE_FINE} point fine — steal them back after release!`
      : `⚖️ Locked up at ${st.name}! ${CONFISCATE_FINE} point fine — behave out there!`, "bad");
  }

  /** Run the whole van fleet: dispatch → pickup → transport → jail → return home. */
  private updateVans(dt: number) {
    const p = this.player;
    /* --- dispatching: player van first, then vans for detained civilians --- */
    if (this.vanNeeded) {
      let best: PoliceVan | null = null, bd = Infinity;
      for (const v of this.vans) {
        if (v.state !== "idle") continue;
        const d = (v.x - p.x) * (v.x - p.x) + (v.z - p.z) * (v.z - p.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) {
        best.state = "dispatch"; best.prisoner = { kind: "player" };
        best.goal = { x: p.x, z: p.z };
        best.path = roadPath(best.x, best.z, p.x, p.z);
        best.rebuilds = 0; best.stallT = 0;
        this.vanNeeded = false;
        sfx.siren();
      }
    }
    for (const c of this.civs) {
      if (c.mode !== "detained") { c.vanId = undefined; continue; } // lazy cleanup — never trust a stale claim
      if (this.vanAssigned(c)) continue; // a van is genuinely handling this civ
      let best: PoliceVan | null = null, bd = Infinity;
      for (const v of this.vans) {
        if (v.state !== "idle") continue;
        const d = (v.x - c.x) * (v.x - c.x) + (v.z - c.z) * (v.z - c.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) break; // fleet busy — retry next frame
      best.state = "dispatch"; best.prisoner = { kind: "civ", id: c.id };
      best.goal = { x: c.x, z: c.z };
      best.path = roadPath(best.x, best.z, c.x, c.z);
      best.rebuilds = 0; best.stallT = 0;
      c.vanId = best.id;
    }

    /* --- driving --- */
    for (const van of this.vans) {
      const pr = van.prisoner;
      switch (van.state) {
        case "idle":
          break;
        case "dispatch": {
          if (pr?.kind === "civ") {
            const c = this.civById(pr.id);
            if (!c || c.mode !== "detained") { this.abortVan(van, c); break; }
            // the runner drags the pickup point along — re-route periodically
            van.goal = { x: c.x, z: c.z };
            if (van.path.length === 0 || Math.hypot(van.path[van.path.length - 1].x - c.x, van.path[van.path.length - 1].z - c.z) > 18) {
              van.path = roadPath(van.x, van.z, c.x, c.z);
            }
          }
          if (this.stepVan(van, dt)) { van.state = "load"; van.timer = VAN_LOAD_S; }
          break;
        }
        case "load": {
          van.timer -= dt;
          if (pr?.kind === "civ") {
            const c = this.civById(pr.id);
            if (!c || c.mode !== "detained") { this.abortVan(van, c); break; }
            c.x += (van.x - c.x) * Math.min(1, dt * 4); c.z += (van.z - c.z) * Math.min(1, dt * 4);
          } else if (pr?.kind === "player") {
            p.x += (van.x - p.x) * Math.min(1, dt * 4); p.z += (van.z - p.z) * Math.min(1, dt * 4);
          }
          if (van.timer <= 0) {
            if (pr?.kind === "player") {
              this.playerInVan = true;
              this.drive = null; // yanked out of any car — hands are cuffed!
              this.arrest = "riding";
              this.toast("🚓 In the van! Riding to the police station…", "info");
            } else if (pr?.kind === "civ") {
              const c = this.civById(pr.id);
              if (c) { c.timer = CIV_JAIL_S; c.x = van.x; c.z = van.z; }
            }
            const st = POLICE_STATIONS[van.station];
            const g = stationGate(st);
            van.goal = { x: g.x, z: g.z };
            van.path = roadPath(van.x, van.z, g.x, g.z);
            van.rebuilds = 0; van.stallT = 0;
            van.state = "toStation";
            sfx.siren();
          }
          break;
        }
        case "toStation": {
          if (this.stepVan(van, dt)) { van.state = "unload"; van.timer = VAN_UNLOAD_S; }
          if (pr?.kind === "player") { p.x = van.x; p.z = van.z; p.y = 0; p.vx = p.vz = p.vy = 0; }
          else if (pr?.kind === "civ") {
            const c = this.civById(pr.id);
            if (c) { c.x = van.x; c.z = van.z; }
          }
          break;
        }
        case "unload": {
          van.timer -= dt;
          if (van.timer <= 0) {
            const st = POLICE_STATIONS[van.station];
            if (pr?.kind === "player") {
              this.lockUpPlayer(van.station);
            } else if (pr?.kind === "civ") {
              const c = this.civById(pr.id);
              if (c && c.mode === "detained") {
                const cage = stationCage(st);
                const slot = c.id % 5;
                c.x = cage.x + [0, -1.6, 1.6, -1.6, 1.6][slot];
                c.z = cage.z + [0, -1.6, -1.6, 1.6, 1.6][slot];
                c.vanId = undefined;
                if (dist2(c.x, c.z, p.x, p.z) < 60 * 60) this.toast(`${c.name} was driven to the ${st.name} cage — press E there to free them!`, "info");
              } else if (c) c.vanId = undefined;
            }
            van.prisoner = null;
            const g = stationGate(st);
            const home = { x: g.x + Math.sign(st.x) * 4, z: g.z + Math.sign(st.z) * 4 };
            van.goal = home;
            van.path = roadPath(van.x, van.z, home.x, home.z);
            van.rebuilds = 0; van.stallT = 0;
            van.state = "return";
          }
          break;
        }
        case "return": {
          if (this.stepVan(van, dt)) van.state = "idle";
          break;
        }
      }
    }
  }

  /* ---------------- inventory (food in pockets) ---------------- */
  /** Drop one unit of a pocketed item — tossed a little ahead so it doesn't bounce straight back into your pockets. */
  dropItem(def: number) {
    const idx = this.inv.findIndex((s) => s.def === def);
    if (idx < 0) return;
    const d = ITEMS[def];
    const toss = 2.6 + Math.random() * 1.2; // past the 1.9 pickup radius
    const p = { x: this.player.x + Math.sin(this.player.face) * toss, z: this.player.z + Math.cos(this.player.face) * toss };
    resolve(p, 0.6, this.world);
    this.items.push({ id: this.nid(), def, x: p.x, z: p.z, active: true, respawn: 0 });
    this.inv[idx].count--;
    if (this.inv[idx].count <= 0) this.inv.splice(idx, 1);
    sfx.click();
    this.toast(`${d.emoji} ${d.name} dropped — run over it to pocket it again.`, "info");
  }

  /** Eat/use a pocketed item: restores ❤ health and/or ⚡ energy. */
  useItem(def: number) {
    if (!this.running || this.personalPause || this.lost) return; // no snacking while paused / dead
    const idx = this.inv.findIndex((s) => s.def === def);
    if (idx < 0 || this.inv[idx].count <= 0) return;
    const d = ITEMS[def];
    if (this.hp >= 100 && this.stamina >= 100) {
      this.toast(`Already full! Save the ${d.name} for later.`, "info");
      return;
    }
    this.inv[idx].count--;
    if (this.inv[idx].count <= 0) this.inv.splice(idx, 1);
    this.snacksEaten++; // 📅 daily-task counter
    this.hp = clamp(this.hp + d.hp, 0, 100);
    this.stamina = clamp(this.stamina + d.stamina, 0, 100);
    this.player.stamina = this.stamina; // keep the movement body in sync
    // record what this snack actually restored so the HUD can float +❤/+⚡ chips
    this.lastGain = {
      hp: Math.round(d.hp > 0 ? Math.min(d.hp, Math.max(0, 100 - (this.hp - d.hp))) : 0),
      stamina: Math.round(d.stamina > 0 ? Math.min(d.stamina, Math.max(0, 100 - (this.stamina - d.stamina))) : 0),
      at: Date.now(),
    };
    if (d.kind === "fruit" || d.kind === "drink") sfx.eat(); else sfx.rescue();
    this.exhaustedAnnounced = false; // energy came back — allow the exhausted hint next time
    this.toast(`${d.emoji} ${d.msg}`, "good");
  }

  /* ---------------- rare super powers ---------------- */

  /** Blink Teleport: poof ~15u in the direction the CAMERA looks. Only while the blink power lasts. */
  tryBlink() {
    if (!this.running || this.personalPause || this.lost) return;
    if (this.drive) {
      // teleporting out of a moving car would leave it driverless — park first!
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 2.5;
        this.toast("Park the car & hop out before teleporting!", "info");
      }
      return;
    }
    if (this.activePower !== "blink") {
      // helpful nudge when a blink gem is still sitting in the pockets
      if (this.powerPockets.some((d) => POWERS[d].kind === "blink") && this.powerFullT <= 0) {
        this.powerFullT = 2.5;
        this.toast("🌀 Blink is pocketed — press G (or tap the ✨ slot) to unleash it first!", "info");
      }
      return;
    }
    if (this.blinkCd > 0 || this.detainedT > 0 || this.faintT > 0) return;
    this.blinkCd = BLINK_CD;
    const p = this.player;
    // camera convention (see stepBody/WorldView): forward = (-sin yaw, -cos yaw) —
    // blink must go where you LOOK, not where you last walked (that was the old bug)
    const dx = -Math.sin(this.input.yaw), dz = -Math.cos(this.input.yaw);
    // probe ahead in small hops from the FROZEN start point — buildings stop the
    // blink at the last clear hop instead of tunnelling through (or overshooting)
    const sx = p.x, sz = p.z;
    let landX = sx, landZ = sz;
    for (let d = 1.25; d <= BLINK_DIST; d += 1.25) {
      const rawX = sx + dx * d, rawZ = sz + dz * d;
      const probe = { x: rawX, z: rawZ };
      resolve(probe, 0.5, this.world);
      if (Math.hypot(probe.x - rawX, probe.z - rawZ) > 0.45) break; // a wall ate the rest
      landX = probe.x; landZ = probe.z;
    }
    p.x = landX; p.z = landZ;
    const rr = Math.hypot(p.x, p.z);
    if (rr > WALL_RADIUS) { p.x *= WALL_RADIUS / rr; p.z *= WALL_RADIUS / rr; }
    p.vy = 2.4; // tiny magic hop on arrival
    p.face = Math.atan2(dx, dz); // turn the body to face the blink direction
    sfx.blink();
    this.fxQueue.push({ type: "confetti", x: p.x, y: 1.1, z: p.z, hue: 0.72 });
    this.toast("🌀 Poof! Teleported!", "good");
  }

  /** Unleash the FIRST pocketed power gem — press G or tap the ✨ slot.
   *  Each gem is SINGLE-USE: firing consumes it. */
  usePower() {
    if (!this.running || this.personalPause || this.lost || this.powerPockets.length === 0) return;
    this.usePowerAt(0);
  }

  /** Unleash a SPECIFIC pocketed gem (HUD slot tap, 0 = first). Consumes it — one shot per gem. */
  usePowerAt(slot: number) {
    if (!this.running || this.personalPause || this.lost) return;
    if (slot < 0 || slot >= this.powerPockets.length) return;
    if (this.detainedT > 0 || this.faintT > 0) return;
    const def = this.powerPockets.splice(slot, 1)[0]; // the gem is spent — no refunds!
    this.powersUsed++; // 📅 daily-task counter
    this.activatePower(def, this.player.x, this.player.z);
  }

  /** Pocket a collected gem WITHOUT activating it — the player fires it with G
   *  (or by tapping its ✨ slot) when the moment is right. Up to POWER_CARRY fit. */
  private storePower(def: number, x: number, z: number) {
    this.powerPockets.push(def); // the gem waits here until usePower() unleashes it
    const d = POWERS[def];
    sfx.power();
    this.fxQueue.push({ type: "confetti", x, y: 1.3, z, hue: Math.random() });
    this.toast(`${d.emoji} ${d.name} collected! (${this.powerPockets.length}/${POWER_CARRY} pocketed) — press G to unleash the first, or tap its ✨ slot.`, "good");
  }

  /** Activate a collected gem — called by usePowerAt() when the PLAYER picks the moment. */
  private activatePower(def: number, x: number, z: number) {
    const d = POWERS[def];
    // one effect at a time — firing a second gem while one runs cuts the first short
    const replaced = this.activePower && this.activePower !== d.kind
      ? POWERS.find((pd) => pd.kind === this.activePower)
      : null;
    this.activePower = d.kind;
    this.powerT = d.duration;
    this.powerMax = d.duration;
    this.blinkCd = 0; // fresh power — first blink is instant
    this.morphKind = d.kind === "morph"
      ? MORPH_ANIMALS[Math.floor(this.rnd() * MORPH_ANIMALS.length)]
      : null;
    sfx.power();
    if (d.kind === "morph") sfx.morph();
    this.fxQueue.push({ type: "confetti", x, y: 1.3, z, hue: Math.random() });
    this.toast(d.msg, "good");
    if (replaced) this.toast(`${replaced.emoji} ${replaced.name} cut short — one power runs at a time!`, "info");
    // fresh animal scent confuses the police — any hunt on us instantly breaks off
    if (d.kind === "morph" && this.chased) {
      for (const cop of this.cops) {
        if (cop.mode === "chase" && cop.targetCiv == null) { cop.mode = "return"; cop.timer = 0; }
      }
      this.clearWanted("🐾 The police sniffed around and lost you — you smell animal now!");
    }
  }

  private grazeSpot(an: Animal, farm: boolean): { x: number; z: number } | null {
    const city = an.kind === "dog" || an.kind === "cat";         // 🐕🐕‍⬛ dogs & the black cat wander the STREETS
    const grave = an.kind === "spider";                         // 🕷️ the giant yard spider lurks in the graveyard
    const mountain = an.kind === "ibex" || an.kind === "hare";  // 🏔️ alpine wildlife keeps to the mountain band
    const minR = city ? 10 : grave ? GRAVEYARD.r + 2 : mountain ? MOUNTAIN_INNER + 4
      : farm ? CITY_RADIUS + 6 : FARM_RADIUS + 6;
    const maxR = city ? CITY_RADIUS - 16 : grave ? GRAVEYARD.r - 3 : mountain ? MOUNTAIN_OUTER - 8
      : farm ? FARM_RADIUS - 10 : JUNGLE_RADIUS - 30;
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * Math.PI * 2, d = mountain ? 4 + this.rnd() * 8 : city ? 6 + this.rnd() * 14 : 7 + this.rnd() * 16;
      const x = an.x + Math.cos(a) * d, z = an.z + Math.sin(a) * d;
      const rr = Math.hypot(x, z);
      if (grave) { // the spider's yard is a small disc around the cemetery, not a ring
        if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) > GRAVEYARD.r - 3) continue;
      } else if (rr < minR || rr > maxR) continue;
      const chk = { x, z };
      resolve(chk, 0.6, this.world);
      if (Math.abs(chk.x - x) > 0.05 || Math.abs(chk.z - z) > 0.05) continue;
      return chk;
    }
    return null;
  }

  /* ================= 7 Nights: the survival-horror storyline ================= */

  /** (Re)spawn the 99-person crew — Poisson-disc scattered across the WHOLE town
   *  (min 15u between neighbours), not ringed around the player's drop spot like
   *  the old 15…87u rings that stacked the full lobby on ~5% of the map. Same
   *  names & colors every run, so the accusation mystery stays learnable. Shirt
   *  color = identity. */
  private spawnCrew() {
    const spots = scatterSpots(this.rnd, this.world, CREW_COUNT, 14, CITY_RADIUS - 14, BOT_SPAWN_GAP);
    for (let i = 0; i < CREW_COUNT; i++) {
      const spot = spots[i];
      const look = randomAppearance(this.rnd);
      look.shirt = CREW_COLORS[i % CREW_COLORS.length]; // the color IS the identity — clues depend on it
      this.crew.push({
        id: this.nid(), name: CREW_NAMES[i], color: CREW_COLORS[i % CREW_COLORS.length], colorName: CREW_COLOR_NAMES[i % CREW_COLOR_NAMES.length], look,
        x: spot.x, z: spot.z, vx: 0, vz: 0, face: this.rnd() * Math.PI * 2,
        alive: true, mode: "wander", tx: spot.x, tz: spot.z,
        timer: range(this.rnd, 2, 6), phase: Math.random() * 6,
        hp: CREW_HP, touchCd: 0, attackAnimT: 0, deathX: 0, deathZ: 0, clue: "", inspected: false,
        purse: Math.round(range(this.rnd, CREW_PURSE[0], CREW_PURSE[1])),
      });
    }
    // 🔍 spawn-scatter forensics — the "everyone started in the same place" check
    if (CREW_COUNT > 0) {
      let dMin = Infinity, dMax = 0;
      for (const c of this.crew) {
        const d = Math.hypot(c.x - this.playerSpawn.x, c.z - this.playerSpawn.z);
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
      }
      this.trace(`🎲 crew drop: ${CREW_COUNT} seats scattered ${dMin.toFixed(0)}–${dMax.toFixed(0)}u from your drop @ (${this.playerSpawn.x.toFixed(0)},${this.playerSpawn.z.toFixed(0)})`);
    }
  }

  /* ---------------- phase machine: day → dusk → night → dawn ---------------- */

  /** 🧱 current safe-zone radius in world units (level 0 = the whole map). */
  zoneRadius(): number {
    return ZONE_RADII[Math.min(this.zoneLevel, ZONE_RADII.length - 1)];
  }

  /** 🧱 drain rate outside the wall right now (hp/s, grace ramp included). */
  private zoneDrain(): number {
    const lvl = Math.max(0, this.zoneLevel - 1);
    const graceK = this.zoneGraceT > 0 ? 1 - this.zoneGraceT / ZONE_GRACE_S : 1;
    return (ZONE_DRAIN_BASE + ZONE_DRAIN_STEP * lvl) * graceK;
  }

  /** Dawn after night N: the transparent wall slams down one ring tighter.
   *  Everyone outside it (player, bots, townsfolk) starts withering. */
  private shrinkZone() {
    if (this.zoneLevel >= ZONE_RADII.length - 1) return;
    this.zoneLevel++;
    this.zoneGraceT = ZONE_GRACE_S;
    const R = this.zoneRadius();
    sfx.howl();
    this.toast(`🧱 THE WALL CLOSED IN — safe ground is now ${R}u wide. Outside it, your life DRAINS away!`, "bad");
  }

  /** 🧱 per-frame wall tick for the PLAYER: outside = health drains to death.
   *  🏆 FIXED: an early SOLE-SURVIVOR win no longer drops the wall — the safe
   *  circle keeps shrinking every dawn through night 7, and it still bites
   *  while you roam (it just can't kill you twice). Only the dead drift free. */
  private stepZone(dt: number) {
    this.zoneGraceT = Math.max(0, this.zoneGraceT - dt);
    this.zoneToastCd = Math.max(0, this.zoneToastCd - dt);
    if (this.lost) { this.outsideWall = false; return; }
    const R = this.zoneRadius();
    const d = Math.hypot(this.player.x, this.player.z);
    this.outsideWall = d > R;
    if (this.outsideWall && this.detainedT <= 0 && !this.playerInVan) {
      const drain = this.zoneDrain();
      if (drain > 0) {
        this.hp -= drain * dt;
        if (this.won && this.hp <= 0) this.hp = 1; // 🏆 already won — the wall stings but can't kill you twice
        this.hurtT = Math.max(this.hurtT, 0.3);
        this.addShake(0.12); // 💥 small constant dread while standing in the burn
        if (this.zoneToastCd <= 0) {
          this.zoneToastCd = 4.5;
          this.toast(`☢️ OUTSIDE THE WALL — your life is draining! ${Math.round(d - R)}u to safety — RUN!`, "bad");
        }
      }
    }
  }

  /** Advance the 7-Nights story clock. The visual day/night `clock` is SYNTHESIZED
   *  from the phase so sky, fog, lamps, windows & fireflies all follow the story. */
  private stepPhase(dt: number) {
    this.phaseT -= dt;
    if (this.phaseT <= 0) {
      switch (this.phase) {
        case "day":
          this.phase = "dusk";
          this.phaseT = PHASE_DUSK_S;
          this.choosePossessed();
          break;
        case "dusk":
          this.phase = "night";
          this.phaseT = PHASE_NIGHT_S;
          this.beginNight();
          break;
        case "night":
          this.phase = "dawn";
          this.phaseT = PHASE_DAWN_S;
          this.endNight(false);
          break;
        case "dawn":
          if (this.nightNo >= NIGHTS_TOTAL) this.winGame("dawn");
          else {
            this.nightNo++;
            this.phase = "day";
            this.phaseT = PHASE_DAY_S;
            this.toast(`☀️ DAY ${this.nightNo} of ${NIGHTS_TOTAL} — gather, build… and find the suspect.`, "info");
          }
          break;
      }
    }
    let target = 0.30; // high noon
    if (this.phase === "dusk") target = 0.46 + (1 - Math.max(0, this.phaseT) / PHASE_DUSK_S) * 0.28; // sunset slide
    else if (this.phase === "night") target = 0.80; // deep night
    else if (this.phase === "dawn") target = 0.30 + (Math.max(0, this.phaseT) / PHASE_DAWN_S) * 0.44; // sunrise slide
    this.clock += (target - this.clock) * Math.min(1, dt * 2.4);
  }

  /** Dusk: the contest takes its due — ~HALF of everyone still alive TURNS.
   *  The turned must FEED on a survivor before dawn or crumble with the sunrise.
   *  You never turn — the immune outsider every pack hunts. */
  private choosePossessed() {
    // idempotent: clear last dusk's flags before re-choosing (restarts & re-entries)
    for (const c of this.crew) { c.zombieTonight = false; c.fed = 0; }
    const aliveIdx = this.crew.map((c, i) => (c.alive ? i : -1)).filter((i) => i >= 0);
    const aliveAll = aliveIdx.length + this.remotes.filter((r) => r.alive).length + (this.lost ? 0 : 1);
    this.possessed = [];
    if (aliveAll <= 1) return;
    // half turn tonight — ceil tips odd numbers toward the horde; a 2-soul dusk
    // still turns 1, so the endgame is a proper final duel
    const want = Math.min(aliveIdx.length, Math.ceil(aliveAll / 2));
    const pool = [...aliveIdx];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.possessed = pool.slice(0, want); // tonight's TURNED roster (crew indices)
    for (const i of this.possessed) { const c = this.crew[i]; c.zombieTonight = true; c.fed = 0; }
    sfx.howl();
    if (want > 0) this.toast(`🌙 DUSK — ${want} of ${aliveAll} survivors are TURNING. They must FEED before dawn… or crumble.`, "bad");
    this.trace(`🌙 dusk n${this.nightNo}: roster ${this.possessed.length} turned of ${aliveAll} alive (${aliveIdx.length} bots + ${this.remotes.filter((r) => r.alive).length} remote + ${this.lost ? 0 : 1} you); nightDeaths cleared`);
    this.nightDeaths = []; // fresh pile forensics each night
  }

  /** Night falls: the TURNED rise from the dirt where they stood — a hungering
   *  pack with everything to prove: feed before dawn, or crumble. */
  private beginNight() {
    startDrone();
    this.zombies = this.possessed
      .map((idx) => this.crew[idx])
      .filter((c) => c && c.alive)
      .map((c) => ({ id: this.nid(), owner: c.id, x: c.x, z: c.z, vx: 0, vz: 0, face: c.face, phase: Math.random() * 6, touchCd: 0, hp: ZOMBIE_HP, dead: false, hoard: 0, chkT: 0, chkX: 0, chkZ: 0, sideT: 0, sideDx: 0, sideDz: 0 }));
    this.zRev++;
    const zc = this.zombies.length;
    if (zc > 0) {
      sfx.scream();
      this.toast(`🌑 NIGHT ${this.nightNo} — ${zc} rise${zc > 1 ? "" : "s"} from the dirt where they stood. They HUNT you. FIGHT (F) or RUN!`, "bad");
    }
    // 🐕‍🦺 the dark takes the strays too — every dog in town turns into a
    // rotting hound. Faster than any shambler, but frail: 3 punches ends one.
    let hounds = 0;
    for (const an of this.animals) {
      if (an.kind !== "dog" || an.dead) continue;
      an.zombie = true;
      an.hp = ZOMDOG_HP;
      an.resting = false;
      an.touchCd = 0;
      // 💥 a visible red burst marks the TURN — even across the street you
      // watch your friendly stray fall apart into something that hunts you
      this.fxQueue.push({ type: "confetti", x: an.x, y: 0.8, z: an.z, hue: 0.0 });
      hounds++;
    }
    if (hounds > 0) {
      sfx.howl();
      this.toast(`🐕‍🦺 Even the street dogs TURNED — ${hounds} zombie hounds${hounds > 1 ? "" : ""} prowl tonight. They're fast… but frail.`, "bad");
    }
    // 🔍 horde-drop forensics: how spread out did the pack rise?
    if (zc > 1) {
      let dMin = Infinity;
      for (let i = 0; i < this.zombies.length; i++) {
        const a = this.zombies[i];
        for (let j = i + 1; j < this.zombies.length; j++) {
          const b = this.zombies[j];
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < dMin) dMin = d;
        }
      }
      this.trace(`🌑 night n${this.nightNo}: ${zc} risen + ${hounds} hounds; closest pair ${dMin.toFixed(1)}u apart (risen where they stood, latch = fresh)`);
    } else {
      this.trace(`🌑 night n${this.nightNo}: ${zc} risen + ${hounds} hounds`);
    }
  }

  /** Dawn: the contest's reckoning. The turned who never FEED crumble with the
   *  sunrise; everyone who fed walks into the day. Nights survived + recap. */
  private endNight(early: boolean) {
    let crumbled = 0;
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (!c.zombieTonight) continue;
      if (c.alive && (c.fed ?? 0) <= 0) { this.killCrew(i, false, -1, true); crumbled++; } // the hunger won
      c.zombieTonight = false; c.fed = 0;
    }
    this.possessed = [];
    this.youPossessed = false;
    this.mpBeastSlots = [];
    for (const r of this.remotes) r.beast = false;
    // 🌅 the beast forms dissolve with the light — every purse they swallowed
    // spills back where they stand, crumbled or fed: the night's takings return
    for (const zb of this.zombies) {
      if (!zb.dead && (zb.hoard ?? 0) > 0) this.dropLoot(zb.x, zb.z, zb.hoard ?? 0, "a zombie's spilled hoard");
    }
    this.zombies = [];
    this.zRev++;
    this.nightsSurvived = Math.min(NIGHTS_TOTAL, this.nightNo);
    // 🔍 dawn forensics — the "everyone died in the same place" report card
    if (this.nightDeaths.length > 0) {
      let pile = 0, px = 0, pz = 0;
      for (const d of this.nightDeaths) {
        let n = 0;
        for (const o of this.nightDeaths) if (Math.hypot(d.x - o.x, d.z - o.z) < 15) n++;
        if (n > pile) { pile = n; px = d.x; pz = d.z; }
      }
      const civNight = this.nightDeaths.filter((d) => d.cause === "civ").length;
      this.trace(`🌅 dawn n${this.nightNo}: ${this.nightDeaths.length - civNight} contestants + ${civNight} townsfolk died tonight; biggest single pile = ${pile} bodies within 15u @ (${px.toFixed(0)},${pz.toFixed(0)})${pile >= 5 ? "  ⚠️ still clustered" : " ✓ spread"}`);
    }
    // 🧱 dawn after night N — the transparent wall slams down one ring tighter
    this.shrinkZone();
    // 🐕 sunrise breaks the hounds' curse — strays shake off the rot; any you
    // slew is replaced by a fresh stray wandering in from the edge of town
    for (const an of this.animals) {
      if (an.kind === "dog") {
        an.zombie = false;
        an.hp = undefined;
        an.resting = false;
        if (an.dead) {
          const t = freeSpot(this.rnd, this.world, 14, CITY_RADIUS - 14);
          an.x = t.x; an.z = t.z; an.tx = t.x; an.tz = t.z;
          an.vx = 0; an.vz = 0; an.dead = false;
        }
        continue;
      }
      // 🌿 the wild refills too — anything the food chain took overnight is
      // replaced by a fresh wanderer in its home band
      if (!an.dead) continue;
      const farm = an.kind === "cow" || an.kind === "chicken" || an.kind === "pig" || an.kind === "sheep" || an.kind === "goat" || an.kind === "duck";
      const mountain = an.kind === "ibex" || an.kind === "hare";
      const grave = an.kind === "spider";
      const cat = an.kind === "cat";
      let t: { x: number; z: number };
      if (grave) {
        const a = range(this.rnd, 0, Math.PI * 2), d = range(this.rnd, 6, GRAVEYARD.r - 6);
        t = { x: GRAVEYARD.x + Math.cos(a) * d, z: GRAVEYARD.z + Math.sin(a) * d };
        resolve(t, 0.6, this.world);
      } else if (mountain) {
        t = freeSpot(this.rnd, this.world, MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 8);
        for (let tries = 0; tries < 6 && terrainHeight(t.x, t.z) > 11; tries++) {
          const q = freeSpot(this.rnd, this.world, MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 8);
          t.x = q.x; t.z = q.z;
        }
      } else if (cat) {
        t = freeSpot(this.rnd, this.world, 14, CITY_RADIUS - 14);
      } else {
        t = freeSpot(this.rnd, this.world,
          farm ? CITY_RADIUS + 8 : FARM_RADIUS + 10,
          farm ? FARM_RADIUS - 10 : JUNGLE_RADIUS - 24);
      }
      an.x = t.x; an.z = t.z; an.tx = t.x; an.tz = t.z;
      an.vx = 0; an.vz = 0; an.dead = false; an.resting = false; an.hp = undefined;
    }
    if (!early) this.points += POINTS_NIGHT;
    if (crumbled > 0) this.toast(`💀 ${crumbled} zombie${crumbled > 1 ? "s" : ""} crumbled at sunrise — the hunger won.`, "info");
    // 🌤️ the living city refills: everyone the night took is replaced by fresh faces
    let revived = 0;
    const revMax = Math.max(20, Math.min(CITY_RADIUS - 10, this.zoneRadius() - 12)); // 🧱 fresh faces wake INSIDE the wall
    for (const c of this.civs) {
      if (!c.dead) continue;
      const t = freeSpot(this.rnd, this.world, 12, revMax);
      c.x = t.x; c.z = t.z; c.tx = t.x; c.tz = t.z;
      c.vx = 0; c.vz = 0; c.dead = false; c.looted = false;
      c.mode = "wander"; c.timer = range(this.rnd, 1, 5);
      c.purse = Math.round(range(this.rnd, CIV_PURSE[0], CIV_PURSE[1]));
      c.hp = undefined; c.panicT = 0; c.fearX = undefined; c.fearZ = undefined; // fresh face, old fears gone
      revived++;
    }
    if (revived > 0) this.toast(`🌤️ Dawn light… ${revived} fresh face${revived > 1 ? "s" : ""} wander${revived > 1 ? "" : "s"} back into town (and 💰 loot may still lie where the fallen did).`, "info");
    this.civsLostTonight = 0;
    stopDrone(); stopInsects(); // 🦗 the chorus falls silent with the light
    sfx.bell();
    const aliveCrew = this.crew.filter((c) => c.alive).length;
    const aliveAll = aliveCrew + this.remotes.filter((r) => r.alive).length + (this.lost ? 0 : 1);
    this.toast(`🌅 DAWN — night ${this.nightNo} survived. ${aliveAll} of ${PLAYERS_TOTAL} still breathe${aliveAll > 1 && aliveAll <= 4 ? "… it's nearly over." : "."}`, "good");
  }

  private winGame(reason: "dawn" | "solo" | "beast") {
    if (this.won || this.lost) return;
    this.won = true;
    this.wonAt = this.elapsed;
    if (reason === "dawn") this.nightsSurvived = NIGHTS_TOTAL;
    this.points += WIN_BONUS;
    stopDrone(); stopInsects(); // 🦗 the chorus falls silent with the light
    sfx.win();
    if (reason === "dawn") this.toast(`🌅 DAWN AFTER NIGHT 7 — LAST ONE STANDING OUT OF ${PLAYERS_TOTAL}! The town is yours!`, "good");
    else if (reason === "solo") this.toast(`🔪 Everyone is gone… you are the SOLE SURVIVOR — #1 of ${PLAYERS_TOTAL}.`, "good");
    else this.toast("🩸 The pack is complete. None remain… but YOU.", "good");
  }

  /** The player died — in 7Nights there is no dizzy respawn. The dark takes you. */
  private die() {
    if (this.won || this.lost) return;
    this.lost = true;
    this.deathT = 0; // 🎬 the death fall starts — the recap waits until the body settles
    stopDrone(); stopInsects(); // 🦗 the chorus falls silent with the light
    sfx.lose();
    const place = this.crew.filter((c) => c.alive).length + this.remotes.filter((r) => r.alive).length + 1;
    this.toast(`🩸 The darkness took you on night ${this.nightNo}… PLACED #${place} OF ${PLAYERS_TOTAL}.`, "bad");
  }

  /* ---------------- crew AI: wander by day, hide by night, hunt when possessed ---------------- */

  private stepCrew(dt: number) {
    const p = this.player;
    // 🛖 once per frame — how many hiding souls already crowd each shelter,
    // AND how many bots are ASSIGNED to each shelter this dusk (sticky picks).
    // The dusk/night hide pass uses both to spread the lobby across EVERY
    // hideout instead of ninety contestants funneling into one doorway that
    // the pack then butchers in a single pile.
    const shelterCrowd = new Array(this.hideSpots.length).fill(0);
    const shelterAssigned = new Array(this.hideSpots.length).fill(0);
    if (this.phase !== "day" && this.phase !== "dawn") {
      for (const o of this.crew) {
        if (!o.alive || o.mode === "possessed") continue;
        if (o.hideHi !== undefined && o.hideHi >= 0 && o.hideHi < this.hideSpots.length) shelterAssigned[o.hideHi]++;
        for (let hi = 0; hi < this.hideSpots.length; hi++) {
          if (dist2(o.x, o.z, this.hideSpots[hi].x, this.hideSpots[hi].z) < 7 * 7) shelterCrowd[hi]++;
        }
      }
    }
    // 🎯 per-frame goodie claims — each loose snack/cash pile/gem can only be
    // TARGETED by one forager at a time (cleared & re-claimed every frame)
    this.goodieClaims.clear();
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (!c.alive) { c.deathT = (c.deathT ?? 0) + dt; continue; } // ⏱️ the corpse choreography clock runs
      c.phase += dt;
      c.touchCd = Math.max(0, c.touchCd - dt);
      c.boostT = Math.max(0, (c.boostT ?? 0) - dt); // ⚡ gem rush decays in real time
      c.fearT = Math.max(0, (c.fearT ?? 0) - dt);   // 🫨 crime-scene terror decays
      if (c.seekBlock) { c.seekBlock.t -= dt; if (c.seekBlock.t <= 0) c.seekBlock = null; } // 🧱 unreachable-goodie blacklist decays
      c.avoidT = Math.max(0, (c.avoidT ?? 0) - dt);              // 🧱 beast prey-avoid decays
      const d2p = dist2(c.x, c.z, p.x, p.z);

      // 🧱 THE WALL — lingering beyond the safe circle withers the body.
      // Everyone but the possessed pack marches back inside (the pack still
      // drains too — the wall spares nobody — but it hunts wherever prey runs).
      const zR = this.zoneRadius();
      const dCz = Math.hypot(c.x, c.z);
      if (dCz > zR - 2) {
        c.hp -= this.zoneDrain() * dt * 1.5; // bots wither a touch faster — keeps the lobby inside the circle
        if (c.hp <= 0) { this.killCrew(i, false, -1, false, false, true); continue; }
        if (dCz > zR - 12 && c.mode !== "possessed") {
          const k = Math.max(4, zR - 15) / (dCz || 1);
          stepNpc(c, c.x * k, c.z * k, CREW_SPEED * 1.35, dt, this.world);
          continue;
        }
      }

      if (c.mode === "possessed") {
        // 🩸 THE PACK — each beast hunts a living soul (crew, townsfolk, or you), fears fire, chews barricades
        if (c.drive) this.endBotDrive(c); // 🚗 the turning never finishes a joyride
        c.attackAnimT = Math.max(0, c.attackAnimT - dt);
        // nearest-prey scan (crew → townsfolk → real players)
        let bx = p.x, bz = p.z, bd = d2p, bVictim = -1, bCiv: Npc | null = null, bRemote: RemotePlayer | null = null;
        if (this.detainedT > 0 || this.drive) { bd = Infinity; } // can't reach you in the van / the car
        for (let j = 0; j < this.crew.length; j++) {
          const o = this.crew[j];
          if (j === i || !o.alive || o.mode === "possessed") continue; // the pack never turns on itself
          if (c.avoidT > 0 && o.id === c.avoidId) continue;            // 🧱 that soul is walled in — hunt reachable prey
          const d = dist2(c.x, c.z, o.x, o.z);
          if (d < bd) { bd = d; bx = o.x; bz = o.z; bVictim = j; bCiv = null; bRemote = null; }
        }
        // 💀 townsfolk caught out in the dark are prey too
        for (const cv of this.civs) {
          if (cv.dead) continue;
          if (c.avoidT > 0 && cv.id === c.avoidId) continue; // 🧱 skipped — can't be reached
          const d = dist2(c.x, c.z, cv.x, cv.z);
          if (d < bd) { bd = d; bx = cv.x; bz = cv.z; bVictim = -1; bCiv = cv; bRemote = null; }
        }
        // 🌐 real players are prey too — the pack SWOOPS on their avatars (the
        // drama is shared; the actual HP hit lands from the hunter inside THEIR
        // own client, so nobody takes double damage from mirrored packs)
        for (const r of this.remotes) {
          if (!r.alive) continue;
          const d = dist2(c.x, c.z, r.x, r.z);
          if (d < bd) { bd = d; bx = r.x; bz = r.z; bVictim = -1; bCiv = null; bRemote = r; }
        }
        // 🎯 anti-funnel LATCH — the pack used to re-funnel onto the globally
        // nearest soul every frame, stampeding fifty beasts into one butchering
        // pile. Now each beast sticks with its marked victim until it dies,
        // is walled, or someone else gets 2.8× closer.
        let tx = bx, tz = bz, td = bd, victim = bVictim, victimCiv = bCiv, remoteVictim = bRemote;
        let latched = false;
        if (c.preyKind === "crew" && c.preyId !== undefined) {
          const vi = this.crew.findIndex((o) => o.id === c.preyId);
          const o = vi >= 0 ? this.crew[vi] : null;
          if (o && o.alive && o.mode !== "possessed" && !(c.avoidT > 0 && o.id === c.avoidId)) {
            const d = dist2(c.x, c.z, o.x, o.z);
            if (d < 95 * 95 && d <= bd * 2.8) { tx = o.x; tz = o.z; td = d; victim = vi; victimCiv = null; remoteVictim = null; latched = true; }
          }
        } else if (c.preyKind === "civ" && c.preyId !== undefined) {
          const cv = this.civs.find((o) => o.id === c.preyId);
          if (cv && !cv.dead && !(c.avoidT > 0 && cv.id === c.avoidId)) {
            const d = dist2(c.x, c.z, cv.x, cv.z);
            if (d < 95 * 95 && d <= bd * 2.8) { tx = cv.x; tz = cv.z; td = d; victim = -1; victimCiv = cv; remoteVictim = null; latched = true; }
          }
        } else if (c.preyKind === "remote" && c.preySlot !== undefined) {
          const r = this.remotes.find((o) => o.slot === c.preySlot);
          if (r && r.alive) {
            const d = dist2(c.x, c.z, r.x, r.z);
            if (d < 95 * 95 && d <= bd * 2.8) { tx = r.x; tz = r.z; td = d; victim = -1; victimCiv = null; remoteVictim = r; latched = true; }
          }
        } else if (c.preyKind === "you" && this.detainedT <= 0 && !this.drive) {
          if (d2p < 95 * 95 && d2p <= bd * 2.8) { tx = p.x; tz = p.z; td = d2p; victim = -1; victimCiv = null; remoteVictim = null; latched = true; }
        }
        if (!latched && bd < Infinity) {
          // 🎯 diverse mark — weighted random over living souls (not always the
          // nearest one); souls already swarmed are discounted so the PACK
          // spreads across the lobby exactly like the shambler horde does
          const pick = this.pickDiversePrey(c, {
            avoidId: c.avoidId, avoidT: c.avoidT, excludeCi: i,
            includeYou: this.detainedT <= 0 && !this.drive,
            includeCivs: true, includeRemotes: true,
            sniff: 70, cap: ZOMBIE_SWARM_CAP, farHunt: false,
          });
          if (pick && pick.kind === "remote") {
            const r = this.remotes.find((o) => o.slot === pick.slot);
            if (r) { c.preyKind = "remote"; c.preySlot = pick.slot; c.preyId = undefined; remoteVictim = r; victimCiv = null; victim = -1; tx = r.x; tz = r.z; td = dist2(c.x, c.z, tx, tz); }
          } else if (pick && pick.kind === "civ" && pick.civ) {
            c.preyKind = "civ"; c.preyId = pick.civ.id; c.preySlot = undefined;
            victim = -1; victimCiv = pick.civ; remoteVictim = null;
            tx = pick.civ.x; tz = pick.civ.z; td = dist2(c.x, c.z, tx, tz);
          } else if (pick && pick.kind === "crew") {
            c.preyKind = "crew"; c.preyId = this.crew[pick.ci].id; c.preySlot = undefined;
            victim = pick.ci; victimCiv = null; remoteVictim = null;
            tx = this.crew[pick.ci].x; tz = this.crew[pick.ci].z; td = dist2(c.x, c.z, tx, tz);
          } else if (pick) {
            c.preyKind = "you"; c.preyId = undefined; c.preySlot = undefined;
            victim = -1; victimCiv = null; remoteVictim = null;
            tx = p.x; tz = p.z; td = dist2(c.x, c.z, tx, tz);
          }
        }
        // 🧱 grinding toward the same prey for 4.5s = they're behind a wall/yard —
        // blacklist them for 6s so the beast rounds on someone it can reach
        if ((c.blockT ?? 0) > 4.5) {
          const blockedCrew = victim >= 0 ? this.crew[victim] : null;
          const blocked = blockedCrew ?? victimCiv;
          if (blocked) { c.avoidId = blocked.id; c.avoidT = 6; }
          c.blockT = 0;
          c.preyKind = undefined; c.preyId = undefined; c.preySlot = undefined; // latch drops with the ban
        }
        const fire = this.nearFire(c.x, c.z);
        if (fire && dist2(fire.x, fire.z, c.x, c.z) < CAMPFIRE_R * CAMPFIRE_R) {
          const dx = c.x - fire.x, dz = c.z - fire.z, dl = Math.hypot(dx, dz) || 1;
          tx = c.x + (dx / dl) * 12; tz = c.z + (dz / dl) * 12; victim = -1; victimCiv = null; remoteVictim = null;
        }
        stepNpc(c, tx, tz, HUNTER_SPEED, dt, this.world);
        // maul barricades that block the path
        const bar = this.nearestBuildOf("barricade", c.x, c.z);
        if (bar && dist2(bar.x, bar.z, c.x, c.z) < 2.5 * 2.5) {
          bar.hp -= 26 * dt;
          if (Math.random() < dt * 2.5) {
            sfx.smash();
            this.fxQueue.push({ type: "confetti", x: bar.x, y: 1.1, z: bar.z, hue: 0.08 });
          }
          if (bar.hp <= 0) this.destroyBuild(bar, "The beast smashed a barricade apart!");
        }
        // caught someone?
        if (c.touchCd <= 0) {
          if (victim < 0 && !victimCiv && td < 1.8 * 1.8 && this.detainedT <= 0 && !this.drive) {
            c.touchCd = HUNTER_TOUCH_CD;
            c.attackAnimT = 0.45; // claw swipe animation
            this.hp = Math.max(0, this.hp - HUNTER_DMG);
            this.hurtT = HURT_FLASH_S;
            const dx = p.x - c.x, dz = p.z - c.z, dl = Math.hypot(dx, dz) || 1;
            p.vx = (dx / dl) * 11; p.vz = (dz / dl) * 11; p.vy = 5; // knockback — escapes are possible
            sfx.scream();
            this.toast("🩸 A BEAST TORE INTO YOU! RUN!", "bad");
          } else if (remoteVictim && td < 1.8 * 1.8) {
            // 🌐 maul the REAL player's avatar — their own client bleeds for it
            c.touchCd = HUNTER_TOUCH_CD;
            c.attackAnimT = 0.45;
            sfx.scream();
            this.netEmit?.({ t: "dmg", target: remoteVictim.slot, amount: HUNTER_DMG });
          } else if (victim >= 0 && td < 1.7 * 1.7) {
            c.touchCd = HUNTER_TOUCH_CD;
            c.attackAnimT = 0.45;
            this.killCrew(victim, false, i);
          } else if (victimCiv && td < 1.5 * 1.5) {
            c.touchCd = HUNTER_TOUCH_CD;
            c.attackAnimT = 0.45;
            this.killCiv(victimCiv, "beast");
          }
        }
        if (this.groanT <= 0 && d2p < 24 * 24) { this.groanT = range(this.rnd, 2.5, 5); sfx.groan(); }
        continue;
      }

      if (this.phase === "day" || this.phase === "dawn") {
        // ☀️ daylight — LIVE like a human player: forage snacks/cash/gems, chop
        // trees, smash boulders, scrap with other players & loot the drop,
        // hunt a 🪪 driving license, joyride a car… then roam & loiter.
        c.mode = "wander";
        c.hideHi = undefined; // 🌤️ dawn — shelters forgotten until the next dusk rush
        const spd = CREW_SPEED * ((c.boostT ?? 0) > 0 ? CREW_BOOST_MULT : 1);
        // 🫨 just saw a crime (or got punched) — bolt from that spot first
        if ((c.fearT ?? 0) > 0) {
          const dx = c.x - (c.fearX ?? p.x), dz = c.z - (c.fearZ ?? p.z), dl = Math.hypot(dx, dz) || 1;
          stepNpc(c, c.x + (dx / dl) * 12, c.z + (dz / dl) * 12, spd * 1.5, dt, this.world);
          continue;
        }
        // 🚗 behind the wheel — the joyride brain owns this bot
        if (c.drive) { this.stepBotDrive(c, dt); continue; }
        // 🎯 walking to a claimed snack / cash pile / gem? Finishing what we started.
        if (c.seek) {
          const gone =
            (c.seek.kind === "food" && !this.items.find((it) => it.id === c.seek!.id && it.active)) ||
            (c.seek.kind === "loot" && !this.loot.find((l) => l.id === c.seek!.id)) ||
            (c.seek.kind === "power" && !this.powers.find((pw) => pw.id === c.seek!.id && pw.active));
          if (gone) { c.seek = null; }
          else if ((c.blockT ?? 0) > 2.5) {
            // 🧱 2.5s of grinding and still not there — it's inside a yard or
            // behind a long wall. Blacklist it briefly and forage elsewhere.
            c.seekBlock = { kind: c.seek.kind, id: c.seek.id, t: 8 };
            c.seek = null;
          } else {
            this.goodieClaims.set(this.goodieKey(c.seek), c.id); // held while we walk
            stepNpc(c, c.seek.x, c.seek.z, spd * 1.12, dt, this.world);
            if (dist2(c.x, c.z, c.seek.x, c.seek.z) < CREW_EAT_R * CREW_EAT_R) this.botCollect(c);
            continue;
          }
        }
        // 🤖 human-like day job — picked every few seconds when idle
        c.jobCd = Math.max(0, (c.jobCd ?? 0) - dt);
        if (c.job && !this.stepCrewJob(c, dt, spd)) {
          c.job = null;
          c.jobCd = range(this.rnd, 4, 9);
        } else if (!c.job && (c.jobCd ?? 0) <= 0) {
          c.job = this.pickCrewJob(c, i);
          if (!c.job) c.jobCd = range(this.rnd, 4, 9); // nothing appealing — forage for a while
        }
        if (c.job) continue;
        // 🔍 eyeball the street — race the player & the zombies for loose goodies
        // (🎯 claimed goodies are SKIPPED — one forager per pile, no clumping)
        c.seek = this.nearestGoodie(c);
        if (c.seek) {
          this.goodieClaims.set(this.goodieKey(c.seek), c.id);
          stepNpc(c, c.seek.x, c.seek.z, spd * 1.12, dt, this.world);
          if (dist2(c.x, c.z, c.seek.x, c.seek.z) < CREW_EAT_R * CREW_EAT_R) this.botCollect(c);
          continue;
        }
        if (c.timer <= 0 || dist2(c.x, c.z, c.tx, c.tz) < 2.2 || (c.blockT ?? 0) > 2.2) {
          if ((c.blockT ?? 0) > 2.2) c.blockT = 0; // 🧱 waypoint unreachable — fresh pick, fresh clock
          if (this.rnd() < 0.22 && d2p < 60 * 60) {
            c.tx = p.x + range(this.rnd, -7, 7); c.tz = p.z + range(this.rnd, -7, 7);
          } else {
            const t = spotNear(this.rnd, this.world, c.x, c.z, 12, 70);
            c.tx = t.x; c.tz = t.z;
          }
          c.timer = range(this.rnd, 5, 11);
        }
        stepNpc(c, c.tx, c.tz, spd, dt, this.world);
        continue;
      }

      // 🌆 dusk & 🌑 night — run to a hideout and shiver there (spread across
      // every shelter + a personal ring slot, never one grinding blob)
      if (c.drive) this.endBotDrive(c); // 🚗 nobody hides inside a car — park & run
      c.job = null; c.seek = null; c.jobCd = 0; // night erases daylight plans
      if (c.mode !== "hide") { c.mode = "hide"; c.timer = 0; }
      const h = this.hideTargetFor(c, shelterCrowd, shelterAssigned);
      if (dist2(c.x, c.z, h.x, h.z) > 2.4 * 2.4) {
        stepNpc(c, h.x, h.z, CREW_SPEED * 1.3 * ((c.boostT ?? 0) > 0 ? CREW_BOOST_MULT : 1), dt, this.world);
      } else {
        c.vx *= 0.8; c.vz *= 0.8;
      }
      // a beast of the pack — or a graveyard zombie — nearby → blind panic away from the CLOSEST one
      let bx = 0, bz = 0, bd2 = Infinity;
      if (this.youPossessed) { bx = p.x; bz = p.z; bd2 = d2p; }
      for (const bi of this.possessed) {
        const b = this.crew[bi];
        if (!b || !b.alive) continue;
        const d = dist2(c.x, c.z, b.x, b.z);
        if (d < bd2) { bd2 = d; bx = b.x; bz = b.z; }
      }
      for (const zb of this.zombies) { // 🧟 the crew fear the shamblers too — self-preservation!
        if (zb.dead) continue;
        const d = dist2(c.x, c.z, zb.x, zb.z);
        if (d < bd2) { bd2 = d; bx = zb.x; bz = zb.z; }
      }
      if (this.phase === "night" && bd2 < 12 * 12) {
        const dx = c.x - bx, dz = c.z - bz, dl = Math.hypot(dx, dz) || 1;
        stepNpc(c, c.x + (dx / dl) * 14, c.z + (dz / dl) * 14, CREW_SPEED * 1.7, dt, this.world);
        // 🥊 cornered contestants FIGHT BACK — desperate bare-fisted swings
        if (bd2 < 1.7 * 1.7 && c.touchCd <= 0) {
          const zb = this.zombies.find((z) => !z.dead && dist2(z.x, z.z, c.x, c.z) < 1.7 * 1.7);
          if (zb) {
            c.touchCd = 1.3;
            c.attackAnimT = 0.45;
            zb.hp = (zb.hp ?? ZOMBIE_HP) - HANDS_DMG;
            if (d2p < 26 * 26) sfx.stab();
            if (zb.hp <= 0 && zb.owner != null) {
              zb.dead = true;
              zb.deadT = 0; // ⏱️ the body falls & sinks away
              this.fxQueue.push({ type: "soul", x: zb.x, y: 1.0, z: zb.z, hue: 0.45 }); // 🌫️ the rotten soul lifts free
              const oi = this.crew.findIndex((cc) => cc.id === zb.owner);
              if (oi >= 0 && this.crew[oi].alive) {
                this.crew[oi].cKills = (this.crew[oi].cKills ?? 0) + 1;
                this.killCrew(oi, true); // cut down mid-hunt — their soul leaves the contest
                if (d2p < 30 * 30) this.toast(`⚔️ ${c.name} fought off a zombie — it crumbled!`, "good");
              }
            }
          }
        }
      }
    }
  }

  /** 🤖 nearest loose food / cash pile / power gem within a bot's forage range
   *  (null = nothing). 🧱 Skips goodies the bot blacklisted as unreachable.
   *  🎯 ALSO skips goodies another bot already targeted THIS frame (goodie
   *  claims) — the crowd used to pick the SAME nearest pile and merge into
   *  one grinding blob; now each forager walks to its OWN prize. */
  private nearestGoodie(c: Crew): Crew["seek"] {
    const skip = c.seekBlock;
    const free = (key: string) => {
      const own = this.goodieClaims.get(key);
      return own === undefined || own === c.id;
    };
    let best: Crew["seek"] = null, bd = CREW_SEEK_R * CREW_SEEK_R;
    for (const it of this.items) {
      if (!it.active) continue;
      if (skip && skip.kind === "food" && skip.id === it.id) continue;
      const d = dist2(c.x, c.z, it.x, it.z);
      if (d < bd && free(`food:${it.id}`)) { bd = d; best = { kind: "food", id: it.id, x: it.x, z: it.z }; }
    }
    for (const l of this.loot) {
      if (skip && skip.kind === "loot" && skip.id === l.id) continue;
      const d = dist2(c.x, c.z, l.x, l.z);
      if (d < bd && free(`loot:${l.id}`)) { bd = d; best = { kind: "loot", id: l.id, x: l.x, z: l.z }; }
    }
    for (const pw of this.powers) {
      if (!pw.active) continue;
      if (skip && skip.kind === "power" && skip.id === pw.id) continue;
      const d = dist2(c.x, c.z, pw.x, pw.z);
      if (d < bd && free(`power:${pw.id}`)) { bd = d; best = { kind: "power", id: pw.id, x: pw.x, z: pw.z }; }
    }
    return best;
  }

  /** 🤖 a bot reached its snack / cash pile / gem — scoop it up like the player would. */
  private botCollect(c: Crew) {
    const s = c.seek;
    c.seek = null;
    if (!s) return;
    const near = dist2(c.x, c.z, this.player.x, this.player.z) < 30 * 30;
    if (s.kind === "food") {
      const it = this.items.find((i2) => i2.id === s.id && i2.active);
      if (!it) return;
      it.active = false; it.respawn = ITEM_RESPAWN_S;
      c.hp = Math.min(CREW_HP, c.hp + ITEMS[it.def].hp); // snacks mend bots too
      if (this.mp) this.netEmit?.({ t: "pickup", kind: "item", id: it.id });
      this.fxQueue.push({ type: "confetti", x: it.x, y: 1.0, z: it.z, hue: 0.32 });
      if (near && this.botLootCd <= 0) {
        this.botLootCd = 4;
        this.toast(`🥭 ${c.name} pocketed ${ITEMS[it.def].name} — the bots forage too!`, "info");
      }
    } else if (s.kind === "loot") {
      const li = this.loot.findIndex((l) => l.id === s.id);
      if (li < 0) return;
      const l = this.loot[li];
      this.loot.splice(li, 1);
      c.purse += l.amt; // fattens their purse — drops right where they fall!
      if (this.mp) this.netEmit?.({ t: "pickup", kind: "loot", id: -1, x: l.x, z: l.z });
      this.fxQueue.push({ type: "confetti", x: l.x, y: 1.0, z: l.z, hue: 0.13 });
      if (near && this.botLootCd <= 0) {
        this.botLootCd = 4;
        this.toast(`💰 ${c.name} scooped ${l.label} (+$${l.amt}) — race the bots for loot!`, "info");
      }
    } else {
      const pw = this.powers.find((p2) => p2.id === s.id && p2.active);
      if (!pw) return;
      pw.active = false; pw.respawn = POWER_RESPAWN_S;
      c.boostT = CREW_BOOST_S; // ⚡ the gem supercharges the bot — watch them sprint
      if (this.mp) this.netEmit?.({ t: "pickup", kind: "power", id: pw.id });
      this.fxQueue.push({ type: "confetti", x: pw.x, y: 1.2, z: pw.z, hue: 0.75 });
      if (near && this.botLootCd <= 0) {
        this.botLootCd = 4;
        this.toast(`✨ ${c.name} grabbed a ${POWERS[pw.def].name} gem — they're RUSHING now!`, "info");
      }
    }
  }

  /* ---------------- 🤖 bots behaving like REAL human players ----------------
   * Daylight jobs: chop trees · smash boulders · scrap with other contestants
   * and loot the drop · hunt a 🪪 driving license · joyride a car. Plus the
   * law now answers bot crimes: a witnessing cop CHASES the offender bot and
   * confiscates half their purse on catch. */

  /** Composite key for the per-frame goodie claim map. */
  private goodieKey(s: { kind: "food" | "loot" | "power"; id: number }): string {
    return `${s.kind}:${s.id}`;
  }

  /** How many contestant bots currently hold a 🪪 card (keeps cards in play). */
  private botHeldLicenses(): number {
    let n = 0;
    for (const o of this.crew) if (o.alive && o.holdsLic) n++;
    return n;
  }

  /** Nearest parked car a bot driver may take (player's ride & bot rides excluded). */
  private nearestBotCar(x: number, z: number, maxD: number): number {
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < this.world.cars.length; i++) {
      if (this.botDriven.has(i) || this.drive?.ci === i) continue;
      const car = this.world.cars[i];
      const d = dist2(x, z, car.x, car.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Nearest standing tree within `maxD` of a point (no swing arc — bots walk up). */
  private nearestBotTree(x: number, z: number, maxD: number): number {
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < this.world.trees.length; i++) {
      if (this.felled.has(i)) continue;
      const t = this.world.trees[i];
      const d = dist2(x, z, t.x, t.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Nearest intact boulder within `maxD` of a point. */
  private nearestBotRock(x: number, z: number, maxD: number): number {
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < this.world.rocks.length; i++) {
      if (this.brokenRocks.has(i)) continue;
      const rk = this.world.rocks[i];
      const d = dist2(x, z, rk.x, rk.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** A healthy nearby contestant to scrap with (bots never pick on the dying). */
  private pickDuelVictim(c: Crew, i: number, maxD: number): number {
    let best = -1, bd = maxD * maxD;
    for (let j = 0; j < this.crew.length; j++) {
      const o = this.crew[j];
      if (j === i || !o.alive || o.mode === "possessed") continue;
      if ((o.hp ?? 0) < 30) continue; // pick on someone your own size
      const d = dist2(c.x, c.z, o.x, o.z);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  /** 🤖 Roll a new daylight activity when a bot goes idle. null = plain
   *  foraging & roaming (the default hustle). Weights keep foraging dominant:
   *  ~10% chop · ~8% mine · ~9% duel · ~7% license hunt · joyrides for
   *  license-holders. Deforestation/hill-smashing caps keep the world intact. */
  private pickCrewJob(c: Crew, i: number): BotJob | null {
    const r = this.rnd();
    const mk = (kind: BotJob["kind"], tgt: number, t: number, tx: number, tz: number): BotJob =>
      ({ kind, tgt, t, cd: 0, hits: 0, tx, tz });
    // 🚗 holding a license? A joyride is IRRESISTIBLE
    if (c.holdsLic && r < 0.62) {
      const ci = this.nearestBotCar(c.x, c.z, 130);
      if (ci >= 0) {
        const car = this.world.cars[ci];
        return mk("drive", ci, range(this.rnd, 14, 22), car.x, car.z);
      }
      // no car worth the walk — toss the card back into circulation
      c.holdsLic = false;
      this.placeDroppedLicense(c.x, c.z);
      return null;
    }
    if (r < 0.16) { // 🪓 lumberjack shift
      if (this.felled.size < this.world.trees.length * 0.3) {
        const ti = this.nearestBotTree(c.x, c.z, 85);
        if (ti >= 0) {
          const t = this.world.trees[ti];
          return mk("chop", ti, range(this.rnd, 14, 26), t.x, t.z);
        }
      }
      return null;
    }
    if (r < 0.24) { // 🔨 quarry shift
      if (this.brokenRocks.size < this.world.rocks.length * 0.4) {
        const ri = this.nearestBotRock(c.x, c.z, 85);
        if (ri >= 0) {
          const rk = this.world.rocks[ri];
          return mk("mine", ri, range(this.rnd, 12, 22), rk.x, rk.z);
        }
      }
      return null;
    }
    if (r < 0.33) { // 🥊 street scuffle — hit another player, then loot the drop
      const vi = this.pickDuelVictim(c, i, 55);
      if (vi >= 0) {
        const v = this.crew[vi];
        return mk("duel", v.id, range(this.rnd, 10, 18), v.x, v.z);
      }
      return null;
    }
    if (r < 0.40 && !c.holdsLic && this.botHeldLicenses() < 3) { // 🪪 hunt a card
      let bestId = -1, bd = 150 * 150;
      for (const lc of this.licenses) {
        if (!lc.active) continue;
        const d = dist2(c.x, c.z, lc.x, lc.z);
        if (d < bd) { bd = d; bestId = lc.id; }
      }
      if (bestId >= 0) {
        const lc = this.licenses.find((l) => l.id === bestId)!;
        return mk("license", bestId, range(this.rnd, 16, 30), lc.x, lc.z);
      }
    }
    return null; // plain forage & roam
  }

  /** 🤖 Run one frame of the bot's current job. Returns false when the job is
   *  finished/invalid — the caller drops it and falls back to foraging. */
  private stepCrewJob(c: Crew, dt: number, spd: number): boolean {
    const j = c.job!;
    j.t -= dt;
    j.cd = Math.max(0, j.cd - dt);
    if (j.t <= 0) return false;
    const near = dist2(c.x, c.z, this.player.x, this.player.z) < 34 * 34;
    switch (j.kind) {
      case "chop": {
        const t = this.world.trees[j.tgt];
        if (!t || this.felled.has(j.tgt)) return false;
        const d = dist2(c.x, c.z, t.x, t.z);
        if (d > 2.5 * 2.5) { stepNpc(c, t.x, t.z, spd, dt, this.world); return true; }
        c.face = Math.atan2(t.x - c.x, t.z - c.z);
        if (j.cd <= 0) {
          j.cd = 0.72;
          this.chopTreeBot(j.tgt, t.x - c.x, t.z - c.z, c, near);
        }
        return true;
      }
      case "mine": {
        const rk = this.world.rocks[j.tgt];
        if (!rk || this.brokenRocks.has(j.tgt)) return false;
        const d = dist2(c.x, c.z, rk.x, rk.z);
        if (d > 2.6 * 2.6) { stepNpc(c, rk.x, rk.z, spd, dt, this.world); return true; }
        c.face = Math.atan2(rk.x - c.x, rk.z - c.z);
        if (j.cd <= 0) {
          j.cd = 0.85;
          this.smashRockBot(j.tgt, c, near);
        }
        return true;
      }
      case "duel": {
        const vi = this.crew.findIndex((o) => o.id === j.tgt);
        const v = vi >= 0 ? this.crew[vi] : null;
        if (!v || !v.alive || v.mode === "possessed") return false;
        const d = dist2(c.x, c.z, v.x, v.z);
        if (d > 2.2 * 2.2) { stepNpc(c, v.x, v.z, spd * 1.08, dt, this.world); return true; }
        c.face = Math.atan2(v.x - c.x, v.z - c.z);
        if (j.cd <= 0) {
          j.cd = 1.05;
          j.hits++;
          c.attackAnimT = 0.45; // the swing
          v.hp -= 9;
          v.attackAnimT = 0.45; // the flinch
          v.fearT = 3.5; v.fearX = c.x; v.fearZ = c.z; // the victim bolts
          v.seek = null; v.job = null;
          sfx.stab();
          this.fxQueue.push({ type: "confetti", x: v.x, y: 1.2, z: v.z, hue: 0.98 });
          if (v.hp <= 0) {
            // 🩸 a scuffle gone too far — that's MURDER, and the law reacts
            this.killCrew(vi, false, -1, false, false);
            this.reportBotCrime(c, "murder", v.x, v.z);
            const last = this.loot[this.loot.length - 1];
            if (last) c.seek = { kind: "loot", id: last.id, x: last.x, z: last.z }; // loot the body
            return false;
          }
          if (j.hits >= 2) {
            // 🥊 the victim caves — cash shakes loose, the winner scoops it
            const amt = Math.min(v.purse, Math.round(range(this.rnd, 10, 25)));
            if (amt > 0) {
              v.purse -= amt;
              this.dropLoot(v.x, v.z, amt, `${v.name}'s shaken loose cash`);
              const last = this.loot[this.loot.length - 1];
              if (last) c.seek = { kind: "loot", id: last.id, x: last.x, z: last.z };
            }
            this.reportBotCrime(c, "assault", v.x, v.z);
            return false;
          }
        }
        return true;
      }
      case "license": {
        const lc = this.licenses.find((l) => l.id === j.tgt);
        if (!lc || !lc.active) { c.holdsLic = false; return false; } // someone beat us to it
        const d = dist2(c.x, c.z, lc.x, lc.z);
        if (d > 1.8 * 1.8) { stepNpc(c, lc.x, lc.z, spd * 1.1, dt, this.world); return true; }
        // 🪪 plucked a driving license off the street — now hunt a car!
        lc.active = false;
        c.holdsLic = true;
        if (near && this.botLootCd <= 0) {
          this.botLootCd = 4;
          this.toast(`🪪 ${c.name} grabbed a driving license — they're hunting a car!`, "info");
        }
        return false; // next roll (likely a joyride)
      }
      case "drive": {
        const ci = j.tgt;
        const car = this.world.cars[ci];
        if (!car || this.botDriven.has(ci) || this.drive?.ci === ci) return false; // taken
        const d = dist2(c.x, c.z, car.x, car.z);
        if (d > 3.1 * 3.1) { stepNpc(c, car.x, car.z, spd * 1.15, dt, this.world); return true; }
        this.startBotDrive(c, ci);
        return false; // the joyride brain takes over next frame
      }
    }
    return false;
  }

  /** 🪓 Bot chop — same shudder/timber animation as the player's swing, but the
   *  wood goes to the bot's own pockets (i.e. nowhere — no player resources). */
  private chopTreeBot(i: number, dx: number, dz: number, by: Crew, near: boolean) {
    const t = this.world.trees[i];
    this.treeHits[i] = (this.treeHits[i] ?? 0) + 1;
    if (near) { sfx.chop(); this.addShake(0.12); }
    this.fxQueue.push({ type: "confetti", x: t.x, y: 1.6, z: t.z, hue: 0.09 });
    const dl = Math.hypot(dx, dz) || 1;
    this.lastChop = { i, dx: dx / dl, dz: dz / dl }; // shudder away from the chopper
    this.chopVersion++;
    if (this.treeHits[i] >= TREE_HITS) {
      this.felled.add(i);
      this.fellVersion++;
      this.world.circles[i].r = 0.24; // only the stump blocks now
      this.fellTimes.set(i, this.elapsed);
      this.fellDir.set(i, Math.atan2(dx / dl, dz / dl));
      if (near) {
        this.addShake(0.35);
        this.toast(`🪓 ${by.name} felled a tree — the bots work the jungle too!`, "info");
      }
    }
  }

  /** 🔨 Bot quarry — same crack/crumble animation the player's hammer gets. */
  private smashRockBot(i: number, by: Crew, near: boolean) {
    const rk = this.world.rocks[i];
    this.rockHp[i] = (this.rockHp[i] ?? ROCK_HITS) - 1;
    if (near) { sfx.smash(); this.addShake(0.14); }
    this.fxQueue.push({ type: "confetti", x: rk.x, y: 1.1, z: rk.z, hue: 0.62 });
    this.lastRock = i;
    this.rockVersion++;
    if (this.rockHp[i] <= 0) {
      this.brokenRocks.add(i);
      this.fellVersion++;
      this.world.circles[this.world.rockCi[i]].r = 0.06; // rubble
      this.rockBreakAt.set(i, this.elapsed);
      if (near) {
        this.addShake(0.3);
        this.toast(`🔨 ${by.name} cracked a boulder apart!`, "info");
      }
    }
  }

  /* --- 🚗 bot joyrides — kinematic drive over the same car physics the player gets --- */

  private startBotDrive(c: Crew, ci: number) {
    const car = this.world.cars[ci];
    if (!car) return;
    c.job = null;
    c.drive = { ci, x: car.x, z: car.z, rot: car.rot, v: 0, c: car.c, t: car.t, vx: car.x, vz: car.z, vrot: car.rot, spin: 0, hitT: 0, steerVis: 0, steer: 0, pedal: 0, lastDir: 1 };
    this.botDriven.add(ci);
    // 🛣️ cruise waypoint — bots tour the streets like any joyrider
    const spot = spotNear(this.rnd, this.world, car.x, car.z, 70, 160);
    c.tx = spot.x; c.tz = spot.z;
    c.driveT = range(this.rnd, 9, 18);
    c.driveStuck = 0;
    if (dist2(c.x, c.z, this.player.x, this.player.z) < 40 * 40 && this.botLootCd <= 0) {
      this.botLootCd = 5;
      this.toast(`🚗 ${c.name} hopped into a ${VEHICLE_LABELS[car.t % VEHICLE_LABELS.length]} — bots drive now!`, "info");
    }
  }

  /** One step of a bot-driven car — the same integration, body resolution and
   *  collider sync the player's car uses; steering comes from a waypoint. */
  private stepBotDrive(c: Crew, dt: number) {
    const d = c.drive!;
    const ti = d.t % VEHICLE_TOP.length;
    c.driveT = (c.driveT ?? 0) - dt;
    const arrived = dist2(d.x, d.z, c.tx, c.tz) < 9 * 9;
    const nightish = this.phase !== "day" && this.phase !== "dawn";
    const done = (c.driveT ?? 0) <= 0 || arrived || nightish;
    // steer toward the waypoint; slow down for tight turns like a careful driver
    const want = Math.atan2(c.tx - d.x, c.tz - d.z);
    let dd = want - d.rot;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    const steerT = Math.max(-1, Math.min(1, dd));
    d.steer += (steerT - d.steer) * (1 - Math.exp(-dt * 10));
    const pedalT = done ? -1 : Math.abs(dd) > 1.5 ? 0.3 : 1;
    d.pedal += (pedalT - d.pedal) * (1 - Math.exp(-dt * 10));
    if (done && Math.abs(d.v) < 0.7) { this.endBotDrive(c); return; }
    const maxF = 13.5; // bots cruise at city speed — no Mario kart
    if (d.pedal > 0.01) d.v += CAR_ACCEL * dt * d.pedal;
    else if (d.pedal < -0.01) d.v -= (d.v > 0.5 ? CAR_BRAKE : CAR_ACCEL * 0.55) * dt * -d.pedal;
    else d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), CAR_COAST * dt);
    if (d.v > maxF) d.v = maxF + (d.v - maxF) * Math.exp(-dt * 4);
    if (d.v < -CAR_REV_SPEED) d.v = -CAR_REV_SPEED;
    const sp = Math.abs(d.v);
    const grip = (0.5 + 0.5 * Math.min(1, sp / 5)) * (1 - 0.28 * Math.min(1, sp / VEHICLE_TOP[ti])) * VEHICLE_STEER[ti];
    const slices = Math.max(1, Math.ceil((Math.abs(d.v) * dt) / 0.35));
    const sdt = dt / slices;
    if (Math.abs(d.v) > 0.35) d.lastDir = d.v > 0 ? 1 : -1;
    let scrape = 0;
    for (let s = 0; s < slices; s++) {
      d.rot -= d.steer * CAR_STEER * grip * sdt * d.lastDir;
      d.x += Math.sin(d.rot) * d.v * sdt;
      d.z += Math.cos(d.rot) * d.v * sdt;
      scrape += this.resolveCarBody(d);
    }
    if (scrape > 0.004) { d.v *= Math.exp(-dt * 12); d.hitT = 0.35; }
    const rr = Math.hypot(d.x, d.z);
    if (rr > WALL_RADIUS) { d.x *= WALL_RADIUS / rr; d.z *= WALL_RADIUS / rr; }
    // 🧱 walled in while crawling? 3s of going-nowhere parks the joyride
    c.driveStuck = sp < 1.2 && !done ? (c.driveStuck ?? 0) + dt : 0;
    if ((c.driveStuck ?? 0) > 3) { this.endBotDrive(c); return; }
    // smoothed visual pose — same easing the player's car gets (no stutter)
    d.hitT = Math.max(0, d.hitT - dt);
    const kp = 1 - Math.exp(-dt * 90);
    const kr = 1 - Math.exp(-dt * 90);
    const pvx = d.vx, pvz = d.vz;
    d.vx += (d.x - d.vx) * kp;
    d.vz += (d.z - d.vz) * kp;
    let vdr = d.rot - d.vrot;
    vdr = Math.atan2(Math.sin(vdr), Math.cos(vdr));
    d.vrot += vdr * kr;
    d.spin -= (Math.hypot(d.vx - pvx, d.vz - pvz) * Math.sign(d.v || 1)) / 0.46;
    d.steerVis += (-d.steer * Math.min(1, Math.abs(d.v) / 5) * 0.42 * Math.sign(d.v || 1) - d.steerVis) * (1 - Math.exp(-dt * 10));
    this.syncCarColliders(d);
    // the driver rides inside — glue the body to the car
    c.x = d.x; c.z = d.z;
    c.vx = Math.sin(d.rot) * d.v; c.vz = Math.cos(d.rot) * d.v;
    c.face = d.rot;
  }

  /** Park & hop out — the car stays where the bot left it, and any 🪪 card in
   *  the driver's pocket is tossed back onto the street for the next racer. */
  private endBotDrive(c: Crew) {
    const d = c.drive;
    if (!d) return;
    c.drive = null;
    c.driveT = undefined;
    c.driveStuck = undefined;
    c.job = null;
    this.botDriven.delete(d.ci);
    // step out on the door side; resolve nudges clear of walls & the car itself
    c.x = d.x + Math.cos(d.rot) * 2.3;
    c.z = d.z - Math.sin(d.rot) * 2.3;
    resolve(c, 0.4, this.world);
    c.vx = 0; c.vz = 0;
    if (c.holdsLic) {
      c.holdsLic = false;
      this.placeDroppedLicense(c.x, c.z);
    }
    if (dist2(c.x, c.z, this.player.x, this.player.z) < 34 * 34) {
      this.toast(`${c.name} parked the car and wandered off.`, "info");
    }
  }

  /* --- 👮 the law answers BOT crimes too — a witnessing cop gives chase --- */

  /** A bot committed a crime in the open: the nearest cop who SAW it (or heard
   *  the scuffle — brawls are LOUD) chases that contestant (targetCrew),
   *  exactly like a player chase. Cops too far to see still hear it within
   *  CRIME_REPORT_RANGE and go investigate. */
  private reportBotCrime(offender: Crew, kind: "assault" | "murder" | "robbery", x: number, z: number) {
    if (this.phase !== "day" && this.phase !== "dawn") return; // night has no law
    if (!offender.alive || offender.mode === "possessed") return;
    const hearR = Math.max(CRIME_SEE_R, 42) * (kind === "murder" ? 1.6 : 1); // screams carry
    let nearest: Npc | null = null, nd = CRIME_REPORT_RANGE * CRIME_REPORT_RANGE;
    for (const cop of this.cops) {
      if (cop.mode === "chase") continue;
      const d2c = dist2(cop.x, cop.z, x, z);
      const watched = d2c < CRIME_SEE_R * CRIME_SEE_R && lineClear(cop.x, cop.z, x, z, this.world);
      const heard = d2c < hearR * hearR;
      if (watched || heard) {
        cop.mode = "chase";
        cop.targetCrew = offender.id;
        cop.targetCiv = undefined;
        cop.alertT = ESCAPE_LOST_S;
        cop.timer = 0;
        if (dist2(x, z, this.player.x, this.player.z) < 60 * 60) {
          sfx.alert();
          this.toast(kind === "murder"
            ? `🚨 Police responded to a MURDER — ${offender.name} is being chased!`
            : `🚨 Police broke up a fight — ${offender.name} is being chased!`, "info");
        }
        return;
      }
      if (d2c < nd) { nd = d2c; nearest = cop; }
    }
    // nobody close enough — the nearest officer walks over to investigate
    if (nearest && kind === "murder") {
      nearest.mode = "chase";
      nearest.targetCrew = offender.id;
      nearest.targetCiv = undefined;
      nearest.alertT = ESCAPE_LOST_S;
      nearest.timer = 0;
    }
  }

  /** 👮 A chasing cop caught the offender bot — half the purse is confiscated
   *  ON THE SPOT (dropped as loot anyone can grab), the bot bolts. */
  private catchCrewBot(cop: Npc, idx: number) {
    const c = this.crew[idx];
    cop.mode = "celebrate";
    cop.timer = 2.5;
    cop.targetCrew = undefined;
    cop.copCd = CIV_COP_CD;
    const roam = spotNear(this.rnd, this.world, cop.x, cop.z, 40, 120);
    cop.tx = roam.x; cop.tz = roam.z;
    if (!c || !c.alive) return;
    if (c.drive) this.endBotDrive(c); // dragged out of the driver's seat
    const fine = Math.min(c.purse, Math.max(8, Math.round(c.purse * 0.5)));
    if (fine > 0) {
      c.purse -= fine;
      this.dropLoot(c.x, c.z, fine, `${c.name}'s confiscated cash`);
    }
    c.fearT = 4; c.fearX = cop.x; c.fearZ = cop.z; // run from the law!
    c.seek = null; c.job = null;
    if (dist2(c.x, c.z, this.player.x, this.player.z) < 60 * 60) {
      sfx.caught();
      this.toast(`🚔 Police caught ${c.name} — ${fine > 0 ? `$${fine} confiscated` : "let off with a warning"}!`, "info");
    }
  }

  /** 💰 drop a stash of money where someone fell — first one there pockets it. */
  private dropLoot(x: number, z: number, amt: number, label: string) {
    if (amt <= 0) return;
    const s = { x: x + range(this.rnd, -1, 1), z: z + range(this.rnd, -1, 1) };
    resolve(s, 0.4, this.world);
    this.loot.push({ id: this.nid(), x: s.x, z: s.z, amt: Math.round(amt), label, bob: Math.random() * 6 });
    // 🌐 the same stash materializes in every co-op world
    if (this.mp) this.netEmit?.({ t: "loot", x: s.x, z: s.z, amt: Math.round(amt), label });
  }

  /** 🧟 a townsfolk is caught by the dark — they fall, their purse drops,
   *  and the town quietly refills them at dawn (the city stays alive). */
  private killCiv(c: Npc, by: "zombie" | "beast" | "player" | "wall") {
    if (c.dead) return;
    c.dead = true;
    c.deadT = 0; // ⏱️ fall → lie → sink → gone
    c.mode = "wander"; // frozen while dead — the renderer lays the body down
    c.vx = 0; c.vz = 0;
    if (!c.looted) {
      c.looted = true;
      this.dropLoot(c.x, c.z, c.purse ?? 0, `${c.name}'s purse`);
    }
    this.civsLostTonight++;
    const d2p = dist2(c.x, c.z, this.player.x, this.player.z);
    if (d2p < 40 * 40) {
      sfx.scream();
      this.toast(
        by === "zombie" ? `🧟 The zombies got ${c.name}! Their 💰 purse dropped — grab it!`
        : by === "beast" ? `🩸 A beast tore ${c.name} apart! Their 💰 dropped — run for it!`
        : by === "wall" ? `☠️ ${c.name} withered beyond the WALL! Their 💰 purse dropped.`
        : `🩸 You killed ${c.name}! Their 💰 purse dropped — and the law will hear of it!`, "bad");
    }
  }

  /** A crew member dies — corpse stays, a clue appears, the town shrinks.
   *  `killerIdx` = which beast of the pack did it (−1 = unknown/you).
   *  `quiet` skips the scream (mass dawn crumbles play ONE sound instead).
   *  `byYou` = the PLAYER murdered them in cold blood (crime clue + toast).
   *  `wall` = the shrinking safe zone took them (🧱 THE WALL is the killer). */
  private killCrew(idx: number, slain: boolean, killerIdx = -1, quiet = false, byYou = false, wall = false) {
    const c = this.crew[idx];
    if (!c.alive) return;
    // 🚗 the driver's seat is no protection — park first so the body lands right
    if (c.drive) this.endBotDrive(c);
    // 🪪 a license in the fallen's pocket hits the dirt with them
    if (c.holdsLic) {
      c.holdsLic = false;
      this.placeDroppedLicense(c.x, c.z);
    }
    c.alive = false;
    c.hp = 0;
    c.mode = "dead";
    c.deathX = c.x; c.deathZ = c.z;
    c.deathT = 0; // ⏱️ the fall animation starts now
    c.inspected = false;
    // 🔍 death forensics — track WHERE the lobby is falling. A growing pile at
    // one spot means hunters are still funneling somewhere they shouldn't.
    if (this.phase === "dusk" || this.phase === "night") {
      this.nightDeaths.push({ x: c.x, z: c.z, name: c.name, cause: wall ? "wall" : slain ? "slain" : byYou ? "you" : "beast" });
      let pile = 0;
      for (const d of this.nightDeaths) if (Math.hypot(c.x - d.x, c.z - d.z) < 15) pile++;
      if (pile >= 4 && pile % 4 === 0) {
        this.trace(`🩸 death pile #${pile}: ${c.name} fell @ (${c.x.toFixed(0)},${c.z.toFixed(0)}) — ${pile} bodies within 15u tonight (cause: ${wall ? "the WALL" : slain ? "slain by hunter" : byYou ? "you" : "the pack"})`);
      }
    }
    // 💰 their purse scatters where they fell — risk the night to loot it!
    this.dropLoot(c.deathX, c.deathZ, c.purse, slain ? `${c.name}'s dropped pouch` : `${c.name}'s purse`);
    if (wall) {
      c.clue = "no wounds at all… the light beyond the WALL scorched them where they stood.";
    } else if (byYou) {
      c.clue = "a clean blade wound… no beast made this cut. A HUMAN did.";
    } else if (slain) {
      c.clue = "no fibers, no footprints… the beast fell right where it stood.";
    } else if (this.youPossessed) {
      c.clue = "huge bare footprints… no cloth, no colors. The killer is NOT from the camp.";
    } else {
      const k = killerIdx >= 0 && this.crew[killerIdx] ? this.crew[killerIdx] : null;
      c.clue = k ? `torn ${k.colorName} cloth under the claws… that color belongs to someone in the camp.` : "claw marks in the dirt.";
    }
    if (!quiet) sfx.scream();
    this.fxQueue.push({ type: "confetti", x: c.x, y: 1.2, z: c.z, hue: 0.98 });
    // 🌐 every client must see the same body & the same clue — the killer's client speaks
    if (this.mp) {
      this.netEmit?.({
        t: "crewDeath", idx, clue: c.clue, slain,
        loot: c.purse > 0 ? { x: c.deathX, z: c.deathZ, amt: c.purse, label: slain ? `${c.name}'s dropped pouch` : `${c.name}'s purse` } : undefined,
      });
    }
    const alive = this.crew.filter((x) => x.alive).length;
    if (wall) {
      this.toast(`☠️ ${c.name} withered beyond the WALL — the safe circle is death ground now! (${alive} left)`, "bad");
    } else if (byYou) {
      this.toast(`🗡️ You killed ${c.name} — one less in the contest! (${alive} left)`, "bad");
    } else if (slain) {
      const left = this.possessed.filter((i) => this.crew[i].alive).length;
      this.toast(left > 0 ? `🗡️ A beast is DOWN — that was ${c.name}! ${left} still prowl…` : `🗡️ The last beast is DOWN! That was ${c.name}…`, "good");
    }
    else this.toast(`💀 ${c.name} was slain by the beast! (${alive} strangers left)`, "bad");
    // 🌐 real souls still breathing? Then nobody is the last survivor yet
    if (alive === 0 && !this.mpOthersAlive()) {
      if (this.youPossessed && this.phase === "night") this.winGame("beast");
      else if (!this.youPossessed) this.winGame("solo");
    }
  }

  /** The player slew one of the possessed — the pack thins. Slay them ALL and
   *  the spell breaks: dawn comes early. (🌐 unless a REAL beast still prowls) */
  private slayBeast(idx: number) {
    this.kills++;
    this.points += POINTS_KILL_BEAST;
    this.killCrew(idx, true);
    const vc = this.crew[idx];
    this.finisherT = FINISHER_S; // ⚔️ the spin-slash finisher plays — the spell is broken
    this.addShake(0.32); // 💥 MEDIUM — the kill lands
    this.fxQueue.push({ type: "soul", x: vc.deathX, y: 1.1, z: vc.deathZ, hue: 0.45 }); // 🌫️ the stolen soul lifts free
    const packLeft = this.possessed.filter((i) => this.crew[i].alive).length;
    if (this.phase === "night" && packLeft === 0 && !this.youPossessed && this.mpBeastSlots.length === 0) {
      this.phase = "dawn";
      this.phaseT = PHASE_DAWN_S;
      this.endNight(true);
      this.toast("🗝️ The spell is BROKEN — dawn comes early. +200", "good");
    }
  }

  /* ---------------- combat & harvesting (F) ---------------- */

  /** Swing the held arm — claws, blade, axe, hammer… or sad bare fists. */
  attack() {
    if (!this.running || this.personalPause || this.lost || this.attackCd > 0 || this.faintT > 0 || this.detainedT > 0 || this.drive) return;
    const p = this.player;
    this.attackCd = ATTACK_CD;
    // 🩸 possessed player = the beast: claws tear the crew
    if (this.youPossessed && this.phase === "night") {
      // 🌐 the claw crosses the wire — anyone within reach on THEIR screen bleeds
      if (this.mp) this.netEmit?.({ t: "claw", x: p.x, z: p.z });
      let bi = -1, bd = 2.2 * 2.2;
      for (let i = 0; i < this.crew.length; i++) {
        const c = this.crew[i];
        if (!c.alive) continue;
        const d = dist2(p.x, p.z, c.x, c.z);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) {
        const c = this.crew[bi];
        c.hp -= CLAW_DMG;
        sfx.stab();
        this.fxQueue.push({ type: "confetti", x: c.x, y: 1.2, z: c.z, hue: 0.98 });
        if (c.hp <= 0) this.killCrew(bi, false);
      } else {
        sfx.swing();
      }
      return;
    }
    const tool = this.held >= 0 && this.held < this.tools.length ? this.tools[this.held] : null;
    const kind = tool?.kind ?? null;
    const dmg = kind ? (TOOLS.find((t) => t.kind === kind)?.dmg ?? HANDS_DMG) : HANDS_DMG;
    // 1) the possessed pack — slay them ALL to end the night early!
    let hi = -1, hd = ATTACK_RANGE * ATTACK_RANGE;
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (!c.alive || c.mode !== "possessed") continue;
      const d = dist2(p.x, p.z, c.x, c.z);
      if (d < hd) { hd = d; hi = i; }
    }
    if (hi >= 0) {
      const c = this.crew[hi];
      c.hp -= dmg;
      sfx.stab();
      this.fxQueue.push({ type: "confetti", x: c.x, y: 1.2, z: c.z, hue: 0.98 });
      if (c.hp <= 0) this.slayBeast(hi);
      return;
    }
    // 2) graveyard zombies
    for (const zb of this.zombies) {
      if (zb.dead) continue;
      if (dist2(p.x, p.z, zb.x, zb.z) < 2.4 * 2.4) {
        zb.hp = (zb.hp ?? ZOMBIE_HP) - dmg;
        sfx.stab();
        this.fxQueue.push({ type: "confetti", x: zb.x, y: 1.1, z: zb.z, hue: 0.35 });
        if (zb.hp <= 0) {
          zb.dead = true;
          zb.deadT = 0; // ⏱️ the body falls & sinks into the dirt
          this.kills++;
          this.points += POINTS_KILL_ZOMBIE;
          this.finisherT = FINISHER_S; // ⚔️ the spin-slash finisher plays
          this.addShake(0.32); // 💥 MEDIUM — the kill lands
          this.fxQueue.push({ type: "soul", x: zb.x, y: 1.0, z: zb.z, hue: 0.45 }); // 🌫️ the rotten soul lifts free
          sfx.scream();
          this.dropLoot(zb.x, zb.z, range(this.rnd, ZOMBIE_PURSE[0], ZOMBIE_PURSE[1]) + (zb.hoard ?? 0), "the zombie's hoard");
          zb.hoard = 0; // its takings hit the dirt — no double-dip at dawn
          // the turned are REAL contestants — cutting one down removes its soul
          const oi = this.crew.findIndex((cc) => cc.id === zb.owner);
          if (oi >= 0 && this.crew[oi].alive) {
            this.killCrew(oi, true);
            this.toast(`⚔️ You cut down ${this.crew[oi].name} — one less in the contest! +40`, "good");
          } else {
            this.toast("🧟 The zombie crumbles — its 💰 hoard drops! +40", "good");
          }
        }
        return;
      }
    }
    // 2.5) 🧟 zombie hounds — the night's turned strays
    let bestDog: Animal | null = null, dogD = 2.3 * 2.3;
    for (const an of this.animals) {
      if (!an.zombie || an.dead) continue;
      const d = dist2(p.x, p.z, an.x, an.z);
      if (d < dogD) { dogD = d; bestDog = an; }
    }
    if (bestDog) {
      bestDog.hp = (bestDog.hp ?? ZOMDOG_HP) - dmg;
      sfx.whine();
      this.fxQueue.push({ type: "confetti", x: bestDog.x, y: 0.9, z: bestDog.z, hue: 0.35 });
      if (bestDog.hp <= 0) {
        bestDog.dead = true;      // lies where it fell; a fresh stray wanders in at dawn
        bestDog.deadT = 0;        // ⏱️ fall → sink → gone
        bestDog.zombie = false;
        this.points += POINTS_KILL_ZOMDOG;
        this.finisherT = FINISHER_S; // ⚔️ the finisher plays
        this.addShake(0.26); // 💥 the hound drops
        this.fxQueue.push({ type: "soul", x: bestDog.x, y: 0.7, z: bestDog.z, hue: 0.45 }); // 🌫️ the feral soul lifts free
        sfx.scream();
        this.dropLoot(bestDog.x, bestDog.z, range(this.rnd, 4, 14), "the hound's scavenged purse");
        this.toast("🐕‍🦺 The zombie hound falls! +25 — another one prowls the dark…", "good");
      }
      return;
    }
    // 3) innocent townsfolk — swing at them and the LAW takes notice
    let civHit: Npc | null = null, civD = 2.3 * 2.3;
    for (const c of this.civs) {
      if (c.dead) continue;
      const d = dist2(p.x, p.z, c.x, c.z);
      if (d < civD) { civD = d; civHit = c; }
    }
    if (civHit) {
      civHit.hp = (civHit.hp ?? 30) - dmg;
      civHit.panicT = 3; civHit.fearX = p.x; civHit.fearZ = p.z; // flee the attacker
      sfx.stab();
      this.fxQueue.push({ type: "confetti", x: civHit.x, y: 1.2, z: civHit.z, hue: 0.98 });
      if (civHit.hp <= 0) {
        this.killCiv(civHit, "player");
        this.reportCrime("murder", civHit.x, civHit.z);
      } else {
        this.reportCrime("assault", civHit.x, civHit.z);
      }
      return;
    }
    // 3b) innocent contestants in daylight — the contest is SECRET; blades in public are MURDER
    let innHit = -1, innD = 2.3 * 2.3;
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (!c.alive || c.mode === "possessed") continue;
      const d = dist2(p.x, p.z, c.x, c.z);
      if (d < innD) { innD = d; innHit = i; }
    }
    if (innHit >= 0) {
      const c = this.crew[innHit];
      c.hp -= dmg;
      c.attackAnimT = 0.45; // flinch
      c.fearT = 4; c.fearX = p.x; c.fearZ = p.z; c.seek = null; // flee the attacker
      sfx.stab();
      this.fxQueue.push({ type: "confetti", x: c.x, y: 1.2, z: c.z, hue: 0.98 });
      if (c.hp <= 0) {
        this.killCrew(innHit, false, -1, false, true);
        this.reportCrime("murder", c.x, c.z);
      } else {
        this.reportCrime("assault", c.x, c.z);
      }
      return;
    }
    // 4) harvest — axe fells trees, hammer cracks boulders
    const fx = -Math.sin(this.input.yaw), fz = -Math.cos(this.input.yaw);
    if (kind === "axe") {
      const ti = this.nearestTree(fx, fz);
      if (ti >= 0) { this.chopTree(ti, fx, fz); return; }
    }
    if (kind === "hammer") {
      const ri = this.nearestRock(fx, fz);
      if (ri >= 0) { this.smashRock(ri); return; }
    }
    sfx.swing();
  }

  /** Nearest standing tree in the swing arc (camera-forward). */
  private nearestTree(fx: number, fz: number): number {
    const p = this.player;
    let best = -1, bd = (ATTACK_RANGE + 1.1) * (ATTACK_RANGE + 1.1);
    for (let i = 0; i < this.world.trees.length; i++) {
      if (this.felled.has(i)) continue;
      const t = this.world.trees[i];
      const d = dist2(p.x, p.z, t.x, t.z);
      if (d >= bd) continue;
      const dx = t.x - p.x, dz = t.z - p.z, dl = Math.hypot(dx, dz) || 1;
      if ((dx / dl) * fx + (dz / dl) * fz < 0.2) continue; // swing toward it
      bd = d; best = i;
    }
    return best;
  }

  /** Nearest intact boulder in the swing arc. */
  private nearestRock(fx: number, fz: number): number {
    const p = this.player;
    let best = -1, bd = (ATTACK_RANGE + 1.2) * (ATTACK_RANGE + 1.2);
    for (let i = 0; i < this.world.rocks.length; i++) {
      if (this.brokenRocks.has(i)) continue;
      const rk = this.world.rocks[i];
      const d = dist2(p.x, p.z, rk.x, rk.z);
      if (d >= bd) continue;
      const dx = rk.x - p.x, dz = rk.z - p.z, dl = Math.hypot(dx, dz) || 1;
      if ((dx / dl) * fx + (dz / dl) * fz < 0.15) continue;
      bd = d; best = i;
    }
    return best;
  }

  private chopTree(i: number, dx = 0, dz = 1) {
    const t = this.world.trees[i];
    this.treeHits[i] = (this.treeHits[i] ?? 0) + 1;
    sfx.chop();
    this.fxQueue.push({ type: "confetti", x: t.x, y: 1.6, z: t.z, hue: 0.09 });
    // 🪓 the struck tree SHUDDERS away from the axe — renderers read lastChop +
    // chopVersion and shake exactly that trunk & canopy (damped, then settled)
    this.lastChop = { i, dx, dz };
    this.chopVersion++;
    this.addShake(0.16); // 💥 LIGHT — steel biting wood
    if (this.treeHits[i] >= TREE_HITS) {
      this.felled.add(i);
      this.fellVersion++;
      this.world.circles[i].r = 0.24; // only the stump blocks now
      this.res.wood += WOOD_PER_TREE;
      this.points += POINTS_HARVEST;
      sfx.smash();
      this.toast(`🪓 TIMBER! +${WOOD_PER_TREE} wood (🪵 ${this.res.wood})`, "good");
      // 🌳 TIMBER! the trunk tips over AWAY from the chopper and tumbles down —
      // the stump pops in only once the fall finishes (renderer reads fellTimes)
      this.fellTimes.set(i, this.elapsed);
      this.fellDir.set(i, Math.atan2(dx, dz));
      this.addShake(0.5); // 💥 BIG — a whole tree just came down
    }
  }

  private smashRock(i: number) {
    const rk = this.world.rocks[i];
    this.rockHp[i] = (this.rockHp[i] ?? ROCK_HITS) - 1;
    sfx.smash();
    this.fxQueue.push({ type: "confetti", x: rk.x, y: 1.1, z: rk.z, hue: 0.62 });
    // 🔨 the struck boulder JIGGLES under the hammer — renderers read lastRock
    this.lastRock = i;
    this.rockVersion++;
    this.addShake(0.2); // 💥 LIGHT-MED — stone ringing
    if (this.rockHp[i] <= 0) {
      this.brokenRocks.add(i);
      this.fellVersion++;
      this.world.circles[this.world.rockCi[i]].r = 0.06; // rubble
      this.res.rock += ROCK_PER_BOULDER;
      this.points += POINTS_HARVEST;
      this.toast(`🔨 CRACK! +${ROCK_PER_BOULDER} stone (🪨 ${this.res.rock})`, "good");
      // 🪨 the boulder CRUMBLES — it sinks, shrinks and rolls apart (RocksView)
      this.rockBreakAt.set(i, this.elapsed);
      this.addShake(0.45); // 💥 BIG — the boulder splits apart
    }
  }

  /* ---------------- 🧟 horde prey-spread brain ---------------- */
  /** 🎯 how many night hunters (shamblers, hounds, the possessed pack) are
   *  latched onto each crew id RIGHT NOW — rebuilt once per night frame so
   *  fresh prey picks can discount souls that are already getting swarmed. */
  private preyLoad = new Map<number, number>();
  private rebuildPreyLoad() {
    this.preyLoad.clear();
    for (const zb of this.zombies) {
      if (zb.dead || zb.preyKind !== "crew" || zb.preyId === undefined) continue;
      this.preyLoad.set(zb.preyId, (this.preyLoad.get(zb.preyId) ?? 0) + 1);
    }
    for (const c of this.crew) {
      if (!c.alive || c.mode !== "possessed") continue;
      if (c.preyKind === "crew" && c.preyId !== undefined) {
        this.preyLoad.set(c.preyId, (this.preyLoad.get(c.preyId) ?? 0) + 1);
      }
    }
    for (const an of this.animals) {
      if (!an.zombie || an.dead || an.preyCrew === undefined) continue;
      this.preyLoad.set(an.preyCrew, (this.preyLoad.get(an.preyCrew) ?? 0) + 1);
    }
  }

  /**
   * 🎯 DIVERSE PREY PICK — the fix for "every zombie attacks the same player".
   * The old fresh-pick always chose the globally NEAREST soul, so whenever a
   * latch broke the whole horde funneled onto one victim in a stampede.
   * A fresh pick is now a weighted-random roll over every living soul:
   *   • nearby souls smell stronger (weight 1/(d+8)) but ANY soul can win;
   *   • souls already swarmed by ≥ cap hunters are heavily discounted, so the
   *     horde spreads out and "finds another player" on its own;
   *   • with farHunt, a 1-in-6 roll catches a DISTANT scent and latches a prowl
   *     toward it — hunters roam the night instead of circling one corpse pile.
   */
  private pickDiversePrey(
    self: { x: number; z: number },
    o: {
      avoidId?: number; avoidT?: number;
      excludeCi?: number;                                  // the pack never hunts itself
      includeYou: boolean; includeCivs: boolean; includeRemotes: boolean;
      sniff: number;                                       // pick radius (0 = whole map)
      cap: number;                                         // swarm cap before a soul is discounted
      farHunt: boolean;                                    // may catch a far scent?
    },
  ): { kind: "crew" | "civ" | "remote" | "you"; ci: number; civ: Npc | null; slot: number } | null {
    const avoid = (o.avoidT ?? 0) > 0 ? o.avoidId : undefined;
    const far = o.farHunt && this.rnd() < 0.17;
    const sniff2 = far ? Infinity : o.sniff * o.sniff;
    const cands: { kind: "crew" | "civ" | "remote" | "you"; ci: number; civ: Npc | null; slot: number; w: number }[] = [];
    for (let ci = 0; ci < this.crew.length; ci++) {
      const c = this.crew[ci];
      if (ci === o.excludeCi || !c.alive || c.zombieTonight || c.mode === "possessed") continue;
      if (avoid !== undefined && c.id === avoid) continue; // 🧱 walled-in prey — skip
      const d2 = dist2(self.x, self.z, c.x, c.z);
      if (d2 > sniff2) continue;
      let w = 1 / (Math.sqrt(d2) + 8);
      if ((this.preyLoad.get(c.id) ?? 0) >= o.cap) w *= 0.05; // swarmed — look elsewhere
      cands.push({ kind: "crew", ci, civ: null, slot: -1, w });
    }
    if (o.includeCivs) {
      for (const cv of this.civs) {
        if (cv.dead) continue;
        if (avoid !== undefined && cv.id === avoid) continue;
        const d2 = dist2(self.x, self.z, cv.x, cv.z);
        if (d2 > sniff2) continue;
        cands.push({ kind: "civ", ci: -1, civ: cv, slot: -1, w: 1 / (Math.sqrt(d2) + 8) });
      }
    }
    if (o.includeRemotes) {
      for (const r of this.remotes) {
        if (!r.alive) continue;
        const d2 = dist2(self.x, self.z, r.x, r.z);
        if (d2 > sniff2) continue;
        cands.push({ kind: "remote", ci: -1, civ: null, slot: r.slot, w: 1 / (Math.sqrt(d2) + 8) });
      }
    }
    if (o.includeYou) {
      const d2 = dist2(self.x, self.z, this.player.x, this.player.z);
      if (d2 <= sniff2) cands.push({ kind: "you", ci: -1, civ: null, slot: -1, w: 1 / (Math.sqrt(d2) + 8) });
    }
    if (!cands.length) return null;
    // weighted roll — near prey are LIKELY, far prey are POSSIBLE
    let total = 0;
    for (const c of cands) total += c.w;
    let r = this.rnd() * total;
    for (const c of cands) {
      r -= c.w;
      if (r <= 0) return c;
    }
    return cands[cands.length - 1];
  }

  /* ---------------- tools & building ---------------- */

  /** Pocket a tool — each KIND only once (a second axe stays on the ground). */
  private addTool(kind: ToolKind, x: number, z: number) {
    const def = TOOLS.find((t) => t.kind === kind)!;
    if (this.tools.some((s) => s.kind === kind)) {
      if (this.toolOnceT <= 0) {
        this.toolOnceT = 5;
        this.toast(`${def.emoji} You already own a ${def.name} — one is all you get!`, "info");
      }
      return;
    }
    const slot = { kind, count: 1 };
    this.tools.push(slot);
    if (this.held < 0) this.held = this.tools.indexOf(slot); // first tool auto-equips
    sfx.pickup();
    this.fxQueue.push({ type: "confetti", x, y: 1.2, z, hue: 0.08 });
    this.toast(`${def.emoji} ${def.name} picked up — ${def.tip}`, "good");
  }

  /** Equip a belt slot (−1 = bare hands). Called by the HUD belt & the G wheel. */
  setHeld(i: number) {
    if (i < -1 || i >= this.tools.length) return;
    this.held = i;
    if (i >= 0) {
      const d = TOOLS.find((t) => t.kind === this.tools[i].kind);
      if (d) this.toast(`${d.emoji} ${d.name} ready — ${d.tip}`, "info");
    } else if (this.tools.length > 0) {
      this.toast("✊ Bare hands — tap a belt slot or press G to pick a tool.", "info");
    }
  }

  /** Build a barricade (B) or a campfire (V) a few units ahead of the camera. */
  placeBuild(kind: "barricade" | "campfire") {
    if (!this.running || this.personalPause || this.lost) return;
    if (this.drive) {
      // building from the driver's seat drops walls in the road ahead of the
      // moving car — park first, same rule as Blink
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 2.5;
        this.toast("Park the car first — no building from the driver's seat!", "info");
      }
      return;
    }
    if (this.youPossessed && this.phase === "night") {
      if (this.driveMsgT <= 0) { this.driveMsgT = 2; this.toast("The beast doesn't build. It HUNTS.", "info"); }
      return;
    }
    if (this.phase === "night") { this.toast("🌙 Too dangerous to build at night! Wait for daylight.", "bad"); return; }
    if (!this.tools.some((s) => s.kind === "builder")) {
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 3;
        this.toast("🔧 You need a Builder tool — they're lying around town (glowing wrench)!", "info");
      }
      return;
    }
    const cost = kind === "barricade" ? BARRICADE_COST : CAMPFIRE_COST;
    if (this.res.wood < cost.wood || this.res.rock < cost.rock) {
      this.toast(kind === "barricade"
        ? `🪵 Need ${BARRICADE_COST.wood} wood (have ${this.res.wood}) — chop trees with the 🪓!`
        : `Need ${CAMPFIRE_COST.wood}🪓 + ${CAMPFIRE_COST.rock}🪨 (have ${this.res.wood}/${this.res.rock}) — chop & smash!`, "bad");
      return;
    }
    const fx = -Math.sin(this.input.yaw), fz = -Math.cos(this.input.yaw);
    const spot = { x: this.player.x + fx * 3.4, z: this.player.z + fz * 3.4 };
    if (terrainHeight(spot.x, spot.z) > 12) {
      this.toast("🧱 Too steep to build here — find flatter ground!", "info");
      return;
    }
    resolve(spot, kind === "barricade" ? 1.2 : 0.7, this.world);
    const rr = Math.hypot(spot.x, spot.z);
    if (rr > WALL_RADIUS - 2) { spot.x *= (WALL_RADIUS - 2) / rr; spot.z *= (WALL_RADIUS - 2) / rr; }
    if (this.builds.some((b) => dist2(b.x, b.z, spot.x, spot.z) < 2.6 * 2.6)) {
      this.toast("Too close to another building — step aside a little.", "info");
      return;
    }
    this.res.wood -= cost.wood;
    this.res.rock -= cost.rock;
    const ci = addDynamicCircle(this.world, { x: spot.x, z: spot.z, r: kind === "barricade" ? 1.15 : 0.6 });
    this.builds.push({ id: this.nid(), kind, x: spot.x, z: spot.z, rot: Math.atan2(fx, fz), hp: kind === "barricade" ? BARRICADE_HP : 999, ci });
    this.buildsMade++;
    this.points = Math.max(0, this.points + POINTS_BUILD);
    sfx.build();
    // 🌐 co-op construction — everyone's world grows the same wall
    if (this.mp) this.netEmit?.({ t: "build", kind, x: spot.x, z: spot.z, rot: Math.atan2(fx, fz) });
    this.toast(kind === "barricade"
      ? "🛡️ Barricade built — the beast will have to chew through it!"
      : "🔥 Campfire built — beasts & zombies keep away from the flames (and it mends you by day)!", "good");
  }

  private destroyBuild(b: Build, msg: string) {
    const i = this.builds.indexOf(b);
    if (i >= 0) this.builds.splice(i, 1);
    const c = this.world.circles[b.ci];
    if (c) c.r = 0.02; // fold the collider away
    this.toast(`💥 ${msg}`, "bad");
  }

  /* ---------------- the morning after: inspect & accuse ---------------- */

  /** R — accuse the survivor next to you. Right call banishes the possessed;
   *  wrong call kills an innocent. The town never forgives. */
  accuse() {
    if (!this.running || this.personalPause || this.lost) return;
    if (this.drive) {
      if (this.driveMsgT <= 0) {
        this.driveMsgT = 2.5;
        this.toast("Step out of the car to accuse someone face-to-face!", "info");
      }
      return;
    }
    if (this.phase === "night" || this.phase === "dusk") { this.toast("Not now — SURVIVE the night first!", "info"); return; }
    const c = this.nearestCrewAlive(ACCUSE_RADIUS);
    if (!c) { this.toast("Stand next to a survivor to accuse them (R).", "info"); return; }
    if (this.accuseCd > 0) return;
    this.accuseCd = 2.5;
    const idx = this.crew.indexOf(c);
    if (this.lastPossessed.includes(idx)) {
      c.alive = false; c.mode = "dead";
      c.deathX = c.x; c.deathZ = c.z;
      c.clue = "they were dragged away screaming… the spirit left their body.";
      c.inspected = true;
      this.dropLoot(c.deathX, c.deathZ, c.purse, `${c.name}'s seized purse`);
      this.accusesRight++;
      this.points += POINTS_RIGHT_ACCUSE;
      sfx.mob();
      this.fxQueue.push({ type: "confetti", x: c.x, y: 1.3, z: c.z, hue: 0.55 });
      this.toast(`⚖️ ${c.name} WAS the possessed! The mob drags them away. +${POINTS_RIGHT_ACCUSE}`, "good");
    } else {
      c.alive = false; c.mode = "dead";
      c.deathX = c.x; c.deathZ = c.z;
      c.clue = "innocent… the mob fled in shame.";
      c.inspected = true;
      this.dropLoot(c.deathX, c.deathZ, c.purse, `${c.name}'s left-behind purse`);
      this.accusesWrong++;
      this.points = Math.max(0, this.points + POINTS_WRONG_ACCUSE);
      sfx.scream();
      this.toast(`😰 ${c.name} was INNOCENT… the mob flees in shame. (${POINTS_WRONG_ACCUSE})`, "bad");
    }
    // 🌐 the mob's verdict is public record — same body & clue everywhere
    if (this.mp) {
      this.netEmit?.({ t: "crewDeath", idx, clue: c.clue, slain: false, loot: c.purse > 0 ? { x: c.deathX, z: c.deathZ, amt: c.purse, label: `${c.name}'s purse` } : undefined });
    }
    if (this.crew.every((x) => !x.alive) && !this.mpOthersAlive()) this.winGame("solo");
  }

  /* ---------------- small helpers ---------------- */

  private nearestCrewAlive(maxD: number): Crew | null {
    let best: Crew | null = null, bd = maxD * maxD;
    for (const c of this.crew) {
      if (!c.alive) continue;
      const d = dist2(this.player.x, this.player.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private nearestDeadCrew(maxD: number): Crew | null {
    let best: Crew | null = null, bd = maxD * maxD;
    for (const c of this.crew) {
      if (c.alive) continue;
      const d = dist2(this.player.x, this.player.z, c.deathX, c.deathZ);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** 🌆🧱 personal dusk shelter — the old code sent EVERY bot on the street to
   *  the single nearest hideout, where they piled into one grinding blob. Now:
   *  the pick is STICKY per dusk (chosen once, kept all night) + the roster is
   *  spread across all hideouts with a per-shelter capacity tax, and each bot
   *  gets a golden-angle ring slot around its shelter so the crowd forms a
   *  circle, not a pile. */
  private hideTargetFor(c: Crew, crowd: number[], assigned: number[]): { x: number; z: number } {
    // 🧱 shelters beyond the wall are DEAD ground — only aim at hideouts the
    // shrinking circle still covers (fallback: dig in where you stand)
    const zR = this.zoneRadius() - 10;
    const ringSpot = (hi: number) => {
      const pick = this.hideSpots[hi];
      const a = (c.id % 97) * 2.399;              // golden angle — even ring spacing
      const r = 1.1 + (c.id % 5) * 0.7;           // 5 radii so rings nest, not overlap
      const spot = { x: pick.x + Math.cos(a) * r, z: pick.z + Math.sin(a) * r };
      resolve(spot, 0.45, this.world);            // never aim into a wall/tree/car
      return spot;
    };
    // 🎯 sticky pick — the shelter chosen when dusk broke stays chosen all
    // night. Re-scoring every frame is what funneled the lobby into whichever
    // doorway led the race (everyone beelined the SAME nearest one while the
    // rest sat empty).
    if (c.hideHi !== undefined && c.hideHi >= 0 && c.hideHi < this.hideSpots.length) {
      const hs = this.hideSpots[c.hideHi];
      if (Math.hypot(hs.x, hs.z) < zR) return ringSpot(c.hideHi);
      c.hideHi = undefined; // swallowed by the shrinking wall — pick again
    }
    let bestHi = -1, bestScore = Infinity;
    for (let hi = 0; hi < this.hideSpots.length; hi++) {
      const hs = this.hideSpots[hi];
      if (Math.hypot(hs.x, hs.z) >= zR) continue;
      // 🎯 8-seat hard cap — a FULL shelter is not an option, period. The old
      // score-tax lost to raw cross-map walk distance (360k beats any tax), so
      // distant bots still piled into the least-bad full doorway. Now they
      // spill into the dig-in-where-you-stand fallback and spread along the
      // ground instead of stacking 13-deep at one hideout.
      if ((assigned[hi] ?? 0) >= 8) continue;
      // score = walk distance + crowd tax + assignment tax — every body
      // huddled there OR already headed there costs real walking
      const cw = crowd[hi] ?? 0;
      const asg = assigned[hi] ?? 0;
      const score = dist2(c.x, c.z, hs.x, hs.z) + cw * cw * 64 + asg * asg * 320;
      if (score < bestScore) { bestScore = score; bestHi = hi; }
    }
    if (bestHi >= 0) {
      c.hideHi = bestHi; // 🎯 sticky — this shelter is MINE until dawn
      assigned[bestHi] = (assigned[bestHi] ?? 0) + 1;
      return ringSpot(bestHi);
    }
    // 🧱 no shelter left inside the shrinking wall — dig in WHERE YOU STAND
    // (nudged back inside the wall). The old fallback marched every survivor
    // to dead centre, where the horde slaughtered the whole endgame in one spot.
    const d = Math.hypot(c.x, c.z) || 1;
    const k = Math.max(0, Math.min(1, (zR - 5) / d));
    const ja = (c.id % 16) * 2.399;
    const spot = { x: c.x * k + Math.cos(ja) * 1.5, z: c.z * k + Math.sin(ja) * 1.5 };
    resolve(spot, 0.45, this.world);
    return spot;
  }

  private nearestBuildOf(kind: "barricade" | "campfire", x: number, z: number): Build | null {
    let best: Build | null = null, bd = Infinity;
    for (const b of this.builds) {
      if (b.kind !== kind) continue;
      const d = dist2(x, z, b.x, b.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** 🔥 nearest flame that scares the dark — a player-built campfire OR one of
   *  the always-lit 🏕️ jungle camps. Drives repel, heal and flee logic alike. */
  private nearFire(x: number, z: number): { x: number; z: number } | null {
    let bx = 0, bz = 0, bd = Infinity;
    for (const b of this.builds) {
      if (b.kind !== "campfire") continue;
      const d = dist2(x, z, b.x, b.z);
      if (d < bd) { bd = d; bx = b.x; bz = b.z; }
    }
    for (const cp of this.world.camps) {
      const d = dist2(x, z, cp.x, cp.z);
      if (d < bd) { bd = d; bx = cp.x; bz = cp.z; }
    }
    return bd === Infinity ? null : { x: bx, z: bz };
  }

  /* ---------------- main update ---------------- */
  update(dt0: number) {
    if (!this.running) return;
    const dt = Math.min(0.05, dt0);
    this.elapsed += dt;
    this.stepPhase(dt); // 🌙 7Nights — the story drives the sky clock now
    const night = nightFactor(this.clock);
    const p = this.player;

    // ⏸ PERSONAL PAUSE (or dead): the town keeps living — only YOUR body freezes.
    //  Movement/verbs stop; bots forage, the pack hunts, cops patrol, the clock
    //  runs and yes — you can even be caught (or eaten) while you were away.
    if (this.personalPause || this.lost) {
      this.input.f = 0; this.input.r = 0; this.input.sprint = false;
      this.input.jump = false; this.input.turn = 0;
    }

    // 🎮 keyboard camera turn (hold Z / X) — the fallback when the mouse cursor
    // can't be hard-locked (sandboxed preview iframes block pointer lock) and the
    // free-look cursor dies at the screen edge. Also keeps yaw wrapped to (−π, π]
    // so turning forever never inflates the float or skews atan2-based HUD maths.
    if (this.input.turn) this.input.yaw += this.input.turn * 2.4 * dt;
    this.input.yaw = ((this.input.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;

    // day/night zone toast
    const z = zoneOf(p.x, p.z);
    if (z !== this.zone) { this.zone = z; this.toast(ZONE_TOAST[z], "info"); }
    // 🦗 the jungle never goes quiet — crickets & cicadas swell at night and
    // fade to lone daytime chirps; silent the moment you leave the trees
    {
      const nf = nightFactor(this.clock);
      const inJ = z === "Jungle" ? 0.72 : z === "Deep Jungle" ? 0.95 : 0;
      setInsects(inJ === 0 ? 0 : Math.min(1.15, inJ + nf * 0.35 + (this.phase === "night" ? 0.12 : this.phase === "dusk" ? 0.08 : 0)));
    }
    // 🌲 THE JUNGLE AFTER DARK — a horror soundscape director. While YOU walk
    // the trees at night: owls hoot, something huge growls, twigs snap right
    // behind you, crows rasp, wolves answer each other. Step into the open and
    // the chorus cuts out — the silence is part of the scare.
    {
      const nf = nightFactor(this.clock);
      const inJungle = z === "Jungle" || z === "Deep Jungle";
      if (inJungle && nf > 0.4) {
        this.ambT -= dt;
        if (this.ambT <= 0) {
          this.ambT = range(this.rnd, 5.5, 14);
          const roll = this.rnd();
          if (roll < 0.3) sfx.owl();
          else if (roll < 0.52) sfx.growl();
          else if (roll < 0.72) sfx.snap();
          else if (roll < 0.86) sfx.caw();
          else sfx.wolfHowl();
        }
      } else this.ambT = 0;
      // 🐺 the pack answers the moon — a far-off howl every so often, wherever
      // you are, so the jungle always sounds alive (and haunted) at night
      if (nf > 0.5) {
        this.wolfT -= dt;
        if (this.wolfT <= 0) { this.wolfT = range(this.rnd, 16, 38); sfx.wolfHowl(); }
      } else this.wolfT = 0;
      // 🧟 hounds out there — distant rotting wails keep the night tense
      if (this.phase === "night" && this.animals.some((a) => a.zombie && !a.dead)) {
        this.howlT -= dt;
        if (this.howlT <= 0) { this.howlT = range(this.rnd, 11, 24); sfx.howl(); }
      } else this.howlT = 0;
    }

    // 🏕️ camp discovery — walking up to a lonely jungle camp is worth a line
    for (let ci = 0; ci < this.world.camps.length; ci++) {
      if (this.discCamps.has(ci)) continue;
      const cp = this.world.camps[ci];
      if (dist2(p.x, p.z, cp.x, cp.z) < 13 * 13) {
        this.discCamps.add(ci);
        this.toast("⛺ You found a hidden jungle camp — rest by the fire, the dark keeps its distance.", "info");
      }
    }

    /* --- player --- */
    this.pocketFullT = Math.max(0, this.pocketFullT - dt);
    this.powerFullT = Math.max(0, this.powerFullT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.flipT = Math.max(0, this.flipT - dt);
    this.squashT = Math.max(0, this.squashT - dt);
    this.faintT = Math.max(0, this.faintT - dt);
    this.shakeT = Math.max(0, this.shakeT - dt * 1.5); // 💥 trauma decays — juice returns to rest
    this.carHitCd = Math.max(0, this.carHitCd - dt);
    this.exitCd = Math.max(0, this.exitCd - dt);
    this.driveMsgT = Math.max(0, this.driveMsgT - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.accuseCd = Math.max(0, this.accuseCd - dt);
    this.finisherT = Math.max(0, this.finisherT - dt); // ⚔️ the finisher spin winds down
    if (this.lost) this.deathT += dt; // 🩸 the death fall plays while the town moves on
    if (this.detainedT > 0) {
      // the clock only runs once the player is locked up at the station (or dizzy-stunned) —
      // while the van is being called or riding, time itself is frozen
      const counting = this.arrest === "locked" || this.arrest === "free";
      if (counting) {
        this.detainedT -= dt;
        if (this.detainedT <= 0) {
          if (this.arrest === "locked") {
            // time served — released right at the station gate, badge cleared, cops pushed back
            const st = POLICE_STATIONS[this.arrestStation];
            this.arrest = "free"; this.arrestStation = -1;
            this.invulnT = RELEASE_GRACE_S;
            this.drive = null; // belt & suspenders — release must never leave a phantom wheel
            for (const cop of this.cops) {
              if (dist2(cop.x, cop.z, p.x, p.z) < 45 * 45) {
                const far = this.spotAwayFromPlayer(70);
                cop.tx = far.x; cop.tz = far.z;
                if (cop.mode === "chase" || cop.mode === "celebrate") { cop.mode = "return"; cop.timer = 0; }
              }
            }
            this.clearWanted(`🚪 Released at the ${st.name} gate — time served, play on!`);
          } else {
            // dizzy-stun expiry — fresh random city spot far from every cop
            const spot = this.cityRespawnSpot();
            this.player.x = spot.x; this.player.z = spot.z;
            this.player.y = 0; this.player.vx = 0; this.player.vz = 0;
            for (const cop of this.cops) {
              if (cop.mode !== "return") continue;
              const far = this.spotAwayFromPlayer(60);
              cop.tx = far.x; cop.tz = far.z;
            }
            this.clearWanted("⏰ Time served! You respawned at a new city spot — the police are far away. Play on!");
          }
        }
      }
      p.vx = p.vz = 0;
    } else if (this.drive) {
      // 🚗 behind the wheel — car physics runs, the driver enjoys the ride
      this.invulnT = Math.max(0, this.invulnT - dt);
      this.stepDrive(dt);
    } else {
      this.invulnT = Math.max(0, this.invulnT - dt);
      const prevY = p.y;
      const prevJumps = p.jumps;
      const staminaBefore = this.stamina;
      p.stamina = this.stamina; // engine stamina is the single source of truth
      // while dizzy from a car bonk the legs don't answer — momentum carries the tumble
      const faint = this.faintT > 0;
      stepBody(p, faint
        ? { f: 0, r: 0, sprint: false, jump: false }
        : { f: this.input.f, r: this.input.r, sprint: this.input.sprint, jump: this.input.jump },
        dt, this.look.age, this.world, {
          yaw: this.input.yaw,
          // 🩸 the beast inside you runs FASTER than any kid · ⚡ Sonic Dash blurs
          speedScale: this.youPossessed && this.phase === "night" ? 1.28 : this.activePower === "sonic" ? SONIC_MULT : 1,
          jumpScale: this.activePower === "jump" ? JUMP_MULT : 1,
          // 🎖️ hero-page squad perks (police side only): SWAT sprint, city fitness, army endurance
          sprintMult: this.side === "police" ? this.policePerk.sprintMult : 1,
          regenMult: this.side === "police" ? this.policePerk.regenMult : 1,
          drainMult: this.side === "police" ? this.policePerk.drainMult : 1,
        });
      this.stamina = p.stamina; // sprinting drains / walking regenerates (see stepBody)
      // 🩸 the beast never tires — sprinting costs nothing while you are possessed
      if (this.youPossessed && this.phase === "night" && this.stamina < staminaBefore) this.stamina = staminaBefore;
      // ⚡ Sonic legs don't tire — sprint costs nothing while Sonic Dash lasts
      if (this.activePower === "sonic" && this.stamina < staminaBefore) this.stamina = staminaBefore;
      if (p.jumps === 1 && prevJumps === 0) {
        sfx.jump();
        // 🦘 kangaroo legs jump for free while the power lasts
        if (this.activePower !== "jump") this.stamina = Math.max(0, this.stamina - JUMP_COST);
      } else if (p.jumps === 2 && prevJumps === 1) {
        sfx.jump2();
        if (this.activePower !== "jump") this.stamina = Math.max(0, this.stamina - JUMP2_COST);
        this.flipT = FLIP_S;
      }
      if (prevY > 0 && p.y === 0) { sfx.land(); this.squashT = LAND_SQUASH_S; }
      if (this.stamina <= 0.5 && !this.exhaustedAnnounced) {
        this.exhaustedAnnounced = true;
        this.toast("😮‍💨 Exhausted! Walk a little to catch your breath, or eat something.", "info");
      } else if (this.stamina > 25) this.exhaustedAnnounced = false;
    }
    this.hp = Math.min(100, this.hp + 1.2 * dt * AGE_STATS[this.look.age].regen);
    // 🧱 THE WALL — outside the safe circle your life drains away (PUBG blue-zone)
    this.stepZone(dt);

    /* --- ring-road traffic: solid cars that bonk careless runners --- */
    for (const t of this.traffic) {
      t.a += t.sp * t.dir * dt;
      t.x = Math.cos(t.a) * t.r;
      t.z = Math.sin(t.a) * t.r;
      t.rot = t.dir > 0 ? -t.a : Math.PI - t.a; // clockwise lane: heading = velocity (was π+a — cars drove sideways!)
      if (this.detainedT > 0 || this.drive) continue; // sitting out detention / safe inside a vehicle — traffic can't touch you
      const fx = Math.sin(t.rot), fz = Math.cos(t.rot);
      const tax = VEHICLE_AXLE[t.t % VEHICLE_AXLE.length];
      const taxR = VEHICLE_AXLE_R[t.t % VEHICLE_AXLE_R.length];
      for (const off of [tax, -tax]) { // front & rear axle circles, matching the body style's colliders
        const cx = t.x + fx * off, cz = t.z + fz * off;
        const dx = p.x - cx, dz = p.z - cz, rr = taxR + 0.55;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        // solid — shove the player out of the footprint so nobody clips through
        p.x = cx + (dx / d) * rr;
        p.z = cz + (dz / d) * rr;
        // cartoon bonk — old-game hurt(): damage + cooldown + a silly message
        if (this.carHitCd <= 0 && this.faintT <= 0) {
          this.carHitCd = CAR_HIT_CD;
          this.faintT = FAINT_S;
          const push = Math.min(9, t.sp * t.r * 0.72);
          p.vx = fx * push + (dx / d) * 2.6;
          p.vz = fz * push + (dz / d) * 2.6;
          p.vy = 4.6; // little cartoon hop
          this.hp = Math.max(1, this.hp - CAR_HIT_DMG); // cars never detain — floored at 1
          this.stamina = Math.max(0, this.stamina - 8);
          this.hurtT = HURT_FLASH_S;
          this.addShake(0.7); // 💥 LARGE — the whole world should reel from a bumper strike
          sfx.bonk();
          const BONKS = [
            "🚕 BONK! A car sent you flying — everything is spinning…",
            "🚌 Ow! Traffic: 1, you: 0. Shake it off, champ!",
            "🚗 Wham! The car won that round — up you get, runner!",
            "🛺 Oof! Watch the ring road — cars don't brake for anyone.",
          ];
          this.toast(BONKS[Math.floor(this.rnd() * BONKS.length)], "bad");
        }
        break; // one axle circle is enough — the other overlaps too
      }
    }

    /* --- police van fleet: transport prisoners to the nearest station --- */
    this.updateVans(dt);

    /* --- bot planes: taxi → take off → cruise the city → land (pure spectacle) --- */
    this.updatePlanes(dt);
    // vans are solid — shove the player out of their footprint (no bonk, police don't ram kids)
    // (while driving, stepDrive already bounces the CAR off vans instead)
    if (this.detainedT <= 0 && !this.drive) {
      for (const van of this.vans) {
        const fx = Math.sin(van.rot), fz = Math.cos(van.rot);
        for (const off of [VAN_AXLE, -VAN_AXLE]) {
          const cx = van.x + fx * off, cz = van.z + fz * off;
          const dx = p.x - cx, dz = p.z - cz, rr = VAN_RADIUS + 0.55;
          const d2v = dx * dx + dz * dz;
          if (d2v >= rr * rr) continue;
          const d = Math.sqrt(d2v) || 0.01;
          p.x = cx + (dx / d) * rr;
          p.z = cz + (dz / d) * rr;
        }
      }
    }

    // wanted star decay
    if (this.stars > 0) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) { this.stars--; this.starTimer = STAR_DECAY_S; if (this.stars === 0) this.toast("Wanted level cleared. Nice and sneaky!", "info"); }
    }

    // 👮 hot witness report — cops in range walk to the scene to investigate
    if (this.crimeReport) {
      this.crimeReport.t -= dt;
      if (this.crimeReport.t <= 0) this.crimeReport = null;
      else {
        const r = this.crimeReport;
        for (const cop of this.cops) {
          if (cop.mode !== "patrol" && cop.mode !== "return") continue;
          if (dist2(cop.x, cop.z, r.x, r.z) < CRIME_REPORT_RANGE * CRIME_REPORT_RANGE) { cop.tx = r.x; cop.tz = r.z; cop.timer = Math.max(cop.timer, 2); }
        }
      }
    }

    /* --- 💰 MONEY — the vote chase is retired; cash piles & dropped loot rule now --- */
    if (this.detainedT <= 0 && !this.won) {
      // scattered 💰 cash piles: walk over one to pocket it (a fresh pile restocks elsewhere)
      for (const v of this.votes) {
        if (v.state !== "world") {
          if (v.state === "delivered") { // horror: "delivered" = pocketed — restock it far away
            v.respawnT = (v.respawnT ?? 0) - dt;
            if (v.respawnT <= 0) {
              const np = freeSpot(this.rnd, this.world, 16, 420);
              v.x = np.x; v.z = np.z; v.state = "world";
            }
          }
          continue;
        }
        v.respawnT = undefined;
        if (dist2(p.x, p.z, v.x, v.z) < CARRY_RADIUS * CARRY_RADIUS) {
          v.state = "delivered";
          v.respawnT = CASH_RESPAWN_S;
          this.money += MONEY_PER_PILE;
          this.points += POINTS_PICKUP;
          sfx.pickup();
          // 🌐 someone else's world shouldn't still show this pile
          if (this.mp) this.netEmit?.({ t: "pickup", kind: "vote", id: v.id });
          this.toast(`💰 +$${MONEY_PER_PILE} — you have $${this.money}!`, "good");
        }
      }
      // 💰 dropped loot: purses of the fallen & zombie hoards — race the bots for them!
      for (let i = this.loot.length - 1; i >= 0; i--) {
        const l = this.loot[i];
        if (dist2(p.x, p.z, l.x, l.z) < 1.9 * 1.9) {
          this.loot.splice(i, 1);
          this.money += l.amt;
          this.points += POINTS_LOOT;
          sfx.pickup();
          this.fxQueue.push({ type: "confetti", x: l.x, y: 1.1, z: l.z, hue: 0.13 });
          // 👮 purses belong to the living — swiping one in public is ROBBERY
          // (zombie hoards are monster treasure — those are fair game)
          if (l.label.includes("'s purse") || l.label.includes("'s pouch")) this.reportCrime("robbery", l.x, l.z);
          // 🌐 loot ids are per-world — the spot identifies it everywhere
          if (this.mp) this.netEmit?.({ t: "pickup", kind: "loot", id: -1, x: l.x, z: l.z });
          this.toast(`💰 Looted ${l.label}: +$${l.amt} ($${this.money} total)!`, "good");
        }
      }
    }

    /* --- items: walk over food to pocket it, use it later from the HUD --- */
    for (const it of this.items) {
      if (!it.active) {
        it.respawn -= dt;
        if (it.respawn <= 0) it.active = true;
        continue;
      }
      if (this.detainedT > 0) continue; // locked up — no foraging from the cell
      // 🧲 Food Magnet — snacks within the aura fly straight into your pockets
      if (this.activePower === "magnet") {
        const mdx = p.x - it.x, mdz = p.z - it.z;
        const md = Math.hypot(mdx, mdz);
        if (md < MAGNET_RADIUS && md > 0.3) {
          it.x += (mdx / md) * MAGNET_PULL * dt;
          it.z += (mdz / md) * MAGNET_PULL * dt;
        }
      }
      if (dist2(p.x, p.z, it.x, it.z) < PICKUP_RADIUS * PICKUP_RADIUS) {
        const d = ITEMS[it.def];
        const slot = this.inv.find((s) => s.def === it.def);
        if (slot) {
          // 🎒 ONE of each item — a second of the same snack stays on the ground
          // (eat it to free the slot, then that kind can be collected again)
          if (this.invOnceT <= 0) {
            this.invOnceT = 5;
            this.toast(`🎒 One ${d.name} is enough — each item can be carried only once!`, "info");
          }
          continue;
        }
        if (this.inv.length >= INV_SLOTS) {
          if (this.pocketFullT <= 0) {
            this.pocketFullT = 6;
            this.toast("🎒 Pockets full! Eat something to make room (press 1-8).", "info");
          }
          continue; // no free slot — leave it on the ground
        }
        this.inv.push({ def: it.def, count: 1 });
        it.active = false; it.respawn = ITEM_RESPAWN_S;
        const n = this.inv.findIndex((s) => s.def === it.def) + 1;
        sfx.pickup();
        if (this.mp) this.netEmit?.({ t: "pickup", kind: "item", id: it.id });
        this.toast(`${d.emoji} ${d.name} pocketed — tap the bag or press ${n} to use!`, "good");
      }
    }

    /* --- 🪓 7Nights arms: walk over a glowing tool to pocket it (ONE of each!) --- */
    if (this.detainedT <= 0 && !(this.youPossessed && this.phase === "night")) {
      for (const te of this.toolEnts) {
        if (!te.active) {
          te.respawn -= dt;
          if (te.respawn <= 0) te.active = true;
          continue;
        }
        // 🎒 each TOOL can be collected exactly once — owning an axe blocks a second
        if (this.tools.some((s) => s.kind === te.kind)) {
          if (this.toolOnceT <= 0) {
            this.toolOnceT = 5;
            const td = TOOLS.find((t2) => t2.kind === te.kind)!;
            this.toast(`${td.emoji} You already own a ${td.name} — each tool can be picked up only once!`, "info");
          }
          continue;
        }
        if (dist2(p.x, p.z, te.x, te.z) < TOOL_PICKUP_R * TOOL_PICKUP_R) {
          te.active = false;
          te.respawn = 45;
          if (this.mp) this.netEmit?.({ t: "pickup", kind: "tool", id: te.id });
          this.addTool(te.kind, te.x, te.z);
        }
      }
    }

    /* --- rare super powers: pickup + active-power ticks --- */
    this.blinkCd = Math.max(0, this.blinkCd - dt);
    if (this.activePower) {
      this.powerT -= dt;
      if (this.powerT <= 0) {
        const was = this.activePower;
        this.activePower = null;
        this.morphKind = null;
        this.toast(was === "morph" ? "🐒 Morph faded — you're a kid again!" : "✨ Your super power faded away.", "info");
      }
    }
    if (this.detainedT <= 0) {
      for (const pw of this.powers) {
        if (!pw.active) {
          pw.respawn -= dt;
          if (pw.respawn <= 0) pw.active = true; // rare gems return after a long absence
          continue;
        }
        if (dist2(p.x, p.z, pw.x, pw.z) < POWER_PICKUP_R * POWER_PICKUP_R) {
          // gems are POCKETED, never auto-fired — the player unleashes them when ready
          if (this.powerPockets.length < POWER_CARRY) {
            pw.active = false;
            pw.respawn = POWER_RESPAWN_S;
            if (this.mp) this.netEmit?.({ t: "pickup", kind: "power", id: pw.id });
            this.storePower(pw.def, pw.x, pw.z);
          } else if (this.powerFullT <= 0) {
            this.powerFullT = 6;
            const held = this.powerPockets.map((d) => POWERS[d].emoji).join("");
            this.toast(`✨ Power pockets full (${held}) — press G to unleash one first!`, "info");
          }
        }
      }
    }

    /* --- driving licenses: walk over a glowing 🪪 card to unlock every car --- */
    if (!this.hasLicense && this.detainedT <= 0) {
      for (const lc of this.licenses) {
        if (!lc.active) continue;
        if (dist2(p.x, p.z, lc.x, lc.z) < LICENSE_PICKUP_R * LICENSE_PICKUP_R) {
          lc.active = false;
          this.hasLicense = true;
          sfx.power();
          this.fxQueue.push({ type: "confetti", x: lc.x, y: 1.2, z: lc.z, hue: 0.55 });
          this.toast("🪪 DRIVING LICENSE collected! Walk up to any parked car and press E to drive it!", "good");
          break;
        }
      }
    }

    /* --- police side: runner busts + vote respawn --- */
    if (this.side === "police") this.updatePoliceMode(dt);

    /* --- police --- */
    const carrying = this.carriedVotes.length;
    const detect = DETECT_BASE + carrying * DETECT_CARRY_BONUS + this.stars * DETECT_STAR_BONUS;
    for (const cop of this.cops) {
      cop.phase += dt;
      cop.copCd = Math.max(0, (cop.copCd ?? 0) - dt);
      const d2p = dist2(cop.x, cop.z, p.x, p.z);
      switch (cop.mode) {
        case "patrol": {
          // 🧱 THE WALL — officers on beat walk back inside the shrinking circle
          const copR = Math.hypot(cop.x, cop.z);
          if (copR > this.zoneRadius() - 6) {
            const k = Math.max(6, this.zoneRadius() - 12) / (copR || 1);
            stepNpc(cop, cop.x * k, cop.z * k, POLICE_SPEED * 0.9, dt, this.world);
            break;
          }
          cop.timer -= dt;
          const arrived = dist2(cop.x, cop.z, cop.tx, cop.tz) < 4;
          if (arrived || cop.timer <= 0) {
            // patrol beats relative to the CURRENT position — officers spread out
            // city-wide instead of every beat pointing back at downtown
            const target = spotNear(this.rnd, this.world, cop.x, cop.z, 30, 130);
            cop.tx = target.x; cop.tz = target.z; cop.timer = range(this.rnd, 8, 16);
          }
          stepNpc(cop, cop.tx, cop.tz, POLICE_SPEED * 0.6, dt, this.world);
          // 🐒 Animal Morph — a cow loitering with stolen loot is somehow not suspicious
          // (7Nights: the police are peaceful townsfolk — the BEAST is the hunter now)
          if (!this.horror && this.side === "protester" && this.morphKind == null && this.invulnT <= 0 && this.detainedT <= 0 && d2p < detect * detect && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; cop.timer = 0;
            this.chased = true;
            sfx.alert();
            this.toast("🚨 Police spotted you! RUN!", "bad");
            break;
          }
          // 👮 7Nights: WANTED for a witnessed crime? Any cop who recognizes you gives chase
          if (this.horror && this.stars > 0 && this.phase !== "night" && !this.youPossessed && this.morphKind == null && this.invulnT <= 0 && this.detainedT <= 0 && d2p < (WARRANT_DETECT + this.stars * 1.5) * (WARRANT_DETECT + this.stars * 1.5) && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; cop.timer = 0;
            this.chased = true;
            sfx.alert();
            this.toast("🚨 A cop recognized you — you're WANTED! RUN!", "bad");
            break;
          }
          // old-game bots homage: cops also arrest suspicious civilians they walk past
          if ((cop.copCd ?? 0) <= 0 && this.heldCivs() < MAX_CIV_HELD) {
            let best: Npc | null = null, bd = CIV_DETECT * CIV_DETECT;
            for (const c of this.civs) {
              if (c.mode !== "wander" || c.protest) continue;
              const d2c = dist2(cop.x, cop.z, c.x, c.z);
              if (d2c < bd && lineClear(cop.x, cop.z, c.x, c.z, this.world)) { bd = d2c; best = c; }
            }
            if (best) {
              cop.mode = "chase"; cop.targetCiv = best.id; cop.alertT = ESCAPE_LOST_S; cop.timer = 0;
              best.mode = "flee"; best.timer = 0;
              if (dist2(best.x, best.z, p.x, p.z) < 60 * 60) this.toast(`🚨 Police are chasing ${best.name}!`, "info");
            }
          }
          break;
        }
        case "chase": {
          // 👮 chasing a CONTESTANT bot who broke the law in broad daylight
          if (cop.targetCrew != null) {
            const bi = this.crew.findIndex((cc) => cc.id === cop.targetCrew);
            const b = bi >= 0 ? this.crew[bi] : null;
            if (!b || !b.alive || b.mode === "possessed" || this.phase === "night" || this.phase === "dusk") {
              cop.mode = "return"; cop.timer = 0; cop.targetCrew = undefined; cop.copCd = CIV_COP_CD;
              break;
            }
            stepNpc(cop, b.x, b.z, POLICE_SPRINT, dt, this.world);
            const d2b = dist2(cop.x, cop.z, b.x, b.z);
            if (d2b < 1.9 * 1.9) {
              this.catchCrewBot(cop, bi);
            } else {
              cop.alertT = d2b < 42 * 42 ? ESCAPE_LOST_S : cop.alertT - dt;
              if (cop.alertT <= 0) {
                cop.mode = "return"; cop.timer = 0; cop.targetCrew = undefined; cop.copCd = CIV_COP_CD;
              }
            }
            break;
          }
          // chasing a civilian bot — old-game cops caught anyone suspicious
          if (cop.targetCiv != null) {
            const c = this.civs.find((cc) => cc.id === cop.targetCiv);
            if (!c || c.mode !== "flee") {
              cop.mode = "return"; cop.timer = 0; cop.targetCiv = undefined; cop.copCd = CIV_COP_CD;
              break;
            }
            stepNpc(cop, c.x, c.z, POLICE_SPRINT, dt, this.world);
            const d2c = dist2(cop.x, cop.z, c.x, c.z);
            if (d2c < 1.9 * 1.9) {
              c.mode = "detained"; c.timer = CIV_DETAIN_S;
              this.dropRunnerVote(c); // a busted bot drops their smuggled vote on the spot
              cop.mode = "celebrate"; cop.timer = 2.5;
              const roam = spotNear(this.rnd, this.world, cop.x, cop.z, 40, 120);
              cop.tx = roam.x; cop.tz = roam.z;
              cop.targetCiv = undefined; cop.copCd = CIV_COP_CD;
              if (dist2(c.x, c.z, p.x, p.z) < 60 * 60) {
                sfx.alert();
                this.toast(`${c.name} got caught by the police! Press E near them to rescue.`, "bad");
              }
            } else {
              cop.alertT = d2c < 42 * 42 ? ESCAPE_LOST_S : cop.alertT - dt;
              if (cop.alertT <= 0) {
                cop.mode = "return"; cop.timer = 0; cop.targetCiv = undefined; cop.copCd = CIV_COP_CD;
                c.mode = "wander"; c.timer = 0;
              }
            }
            break;
          }
          // player is sitting out the time-out — stop hovering, walk AWAY so the
          // release never turns into an instant re-catch
          if (this.detainedT > 0) {
            const wander = this.spotAwayFromPlayer(60);
            cop.tx = wander.x; cop.tz = wander.z;
            cop.mode = "return"; cop.timer = 0; cop.alertT = 0;
            break;
          }
          // 🐒 mid-chase morph — the kid they were chasing just turned into a cow. Give up.
          // (same if the kid turned into a BEAST — no cop brawls with the night's horror)
          if (this.morphKind != null || (this.youPossessed && this.phase === "night")) {
            cop.mode = "return"; cop.timer = 0; cop.alertT = 0;
            break;
          }
          const spd = POLICE_SPRINT + this.stars * 0.22;
          stepNpc(cop, p.x, p.z, spd, dt, this.world);
          cop.alertT = d2p < detect * detect * 3 ? ESCAPE_LOST_S : cop.alertT - dt;
          // a speeding car can't be caught on foot — cops tumble after it instead
          // (and a turned beast mauls would-be arresters — they hesitate)
          if (d2p < 1.9 * 1.9 && this.detainedT <= 0 && this.invulnT <= 0 && this.morphKind == null && !this.youPossessed && !this.drive) { this.catchPlayer(cop); }
          else if (cop.alertT <= 0) { cop.mode = "return"; cop.timer = 0; }
          break;
        }
        case "celebrate":
          cop.timer -= dt;
          if (cop.timer <= 0) { cop.mode = "return"; }
          break;
        case "return": {
          if (dist2(cop.x, cop.z, cop.tx, cop.tz) < 4) cop.mode = "patrol";
          else stepNpc(cop, cop.tx, cop.tz, POLICE_SPEED * 0.7, dt, this.world);
          if (!this.horror && this.side === "protester" && this.morphKind == null && this.invulnT <= 0 && this.detainedT <= 0 && d2p < detect * 0.8 * (detect * 0.8) && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; this.chased = true; sfx.alert();
          }
          // 👮 heading home but still WANTED? A wanted face crosses your beat — chase!
          else if (this.horror && this.stars > 0 && this.phase !== "night" && !this.youPossessed && this.morphKind == null && this.invulnT <= 0 && this.detainedT <= 0 && d2p < (WARRANT_DETECT + this.stars * 1.5) * (WARRANT_DETECT + this.stars * 1.5) * 0.8 && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; this.chased = true; sfx.alert();
            this.toast("🚨 A cop recognized you — you're WANTED! RUN!", "bad");
          }
          break;
        }
      }
    }

    /* --- escape sweep: player got far / out of reach → police give up & go back --- */
    if (this.chased && this.detainedT <= 0) {
      let anyChase = false;
      for (const cop of this.cops) if (cop.mode === "chase" && cop.targetCiv == null && cop.targetCrew == null) { anyChase = true; break; }
      if (!anyChase) {
        this.clearWanted("🎉 You escaped! The police went back — wanted badge cleared. Play on!");
        // send every heading-home cop to a spot far away from the player
        for (const cop of this.cops) {
          if (cop.mode !== "return") continue;
          const far = this.spotAwayFromPlayer(75);
          cop.tx = far.x; cop.tz = far.z;
        }
      }
    }

    /* --- civilians: wander + get detained + rescue --- */
    for (const c of this.civs) {
      c.phase += dt;
      // 🧟💀 a fallen townsfolk lies still until dawn refills the town
      if (c.dead) { c.deadT = (c.deadT ?? 0) + dt; continue; } // ⏱️ the corpse choreography clock runs
      if ((c.panicT ?? 0) > 0) c.panicT = (c.panicT ?? 0) - dt;
      // 🫨 an attacker / crime scene spooked this townsfolk — flee that spot at any hour
      if ((c.panicT ?? 0) > 0 && c.fearX !== undefined) {
        const dx = c.x - (c.fearX ?? 0), dz = c.z - (c.fearZ ?? 0), dl = Math.hypot(dx, dz) || 1;
        stepNpc(c, c.x + (dx / dl) * 13, c.z + (dz / dl) * 13, c.speed * CIV_FLEE_MULT, dt, this.world);
        continue;
      }
      // 🏃 SAVE YOURSELF! zombies or beasts anywhere close → blind panic away from
      // the closest horror (dusk & night). Survival instinct beats every other job.
      if (this.phase === "dusk" || this.phase === "night") {
        let hx = 0, hz = 0, hd2 = Infinity, horror: "zombie" | "beast" | null = null;
        if (!this.youPossessed) { const d = dist2(c.x, c.z, p.x, p.z); if (d < hd2) { hd2 = d; hx = p.x; hz = p.z; horror = "beast"; } }
        for (const bi of this.possessed) {
          const b = this.crew[bi];
          if (!b || !b.alive) continue;
          const d = dist2(c.x, c.z, b.x, b.z);
          if (d < hd2) { hd2 = d; hx = b.x; hz = b.z; horror = "beast"; }
        }
        for (const zb of this.zombies) {
          if (zb.dead) continue;
          const d = dist2(c.x, c.z, zb.x, zb.z);
          if (d < hd2) { hd2 = d; hx = zb.x; hz = zb.z; horror = "zombie"; }
        }
        if (horror && hd2 < CIV_PANIC_R * CIV_PANIC_R) {
          c.panicT = 0.45; // 😱 refreshed while fleeing — drives the flail pose in render
          c.fearX = undefined; c.fearZ = undefined; // the horror outweighs yesterday's attacker
          const dx = c.x - hx, dz = c.z - hz, dl = Math.hypot(dx, dz) || 1;
          // sprint for the nearest campfire if one is roughly on the run direction — fire = safety
          const fire = this.nearFire(c.x, c.z);
          if (fire && dist2(fire.x, fire.z, c.x, c.z) < 45 * 45) {
            const fdx = fire.x - c.x, fdz = fire.z - c.z, fl = Math.hypot(fdx, fdz) || 1;
            if ((fdx / fl) * (dx / dl) + (fdz / fl) * (dz / dl) > 0.25) { stepNpc(c, fire.x, fire.z, c.speed * CIV_FLEE_MULT, dt, this.world); continue; }
          }
          stepNpc(c, c.x + (dx / dl) * 13, c.z + (dz / dl) * 13, c.speed * CIV_FLEE_MULT, dt, this.world);
          continue;
        }
      }
      // 🧱 THE WALL — townsfolk caught beyond the safe circle wither; the living
      // hurry back toward the middle (their dawn refills land inside too)
      {
        const zR = this.zoneRadius();
        const dCv = Math.hypot(c.x, c.z);
        if (dCv > zR - 2) {
          c.hp = (c.hp ?? 30) - this.zoneDrain() * dt * 1.5;
          if (c.hp <= 0) { this.killCiv(c, "wall"); continue; }
          const k = Math.max(4, zR - 10) / (dCv || 1);
          stepNpc(c, c.x * k, c.z * k, c.speed * CIV_FLEE_MULT, dt, this.world);
          continue;
        }
      }
      // 🤝 living city: passers-by scoop up dropped purses when the coast is clear
      if (this.phase === "day" || this.phase === "dawn") {
        for (let li = this.loot.length - 1; li >= 0; li--) {
          const l = this.loot[li];
          if (dist2(c.x, c.z, l.x, l.z) < 1.5 * 1.5 && this.rnd() < dt * 0.9) {
            this.loot.splice(li, 1);
            if (dist2(c.x, c.z, p.x, p.z) < 26 * 26) this.toast(`👋 ${c.name} scooped up ${l.label} ($${l.amt}) — should've been quicker!`, "info");
            break;
          }
        }
      }
      // police side: vote-runners live in their own state machine (seek → smuggle → lay low)
      if (c.runner && this.side === "police" && (c.mode === "wander" || c.mode === "flee")) { this.stepRunner(c, dt); continue; }
      // legacy side: scavengers gather loose cash piles & haul them to the town square (old game only)
      if (!this.horror && c.scav && this.side === "protester" && (c.mode === "wander" || c.mode === "flee") && !c.runner) {
        if (c.mode === "wander") { this.stepScavenger(c, dt); continue; }
        // fleeing with a cop on their heels — same panic-run as everyone else (below)
      }
      switch (c.mode) {
        case "wander": {
          // human-like loiter — real people pause at corners, chat, then walk on
          if ((c.pauseT ?? 0) > 0) { c.pauseT = (c.pauseT ?? 0) - dt; break; }
          c.timer -= dt;
          if (c.timer <= 0 || dist2(c.x, c.z, c.tx, c.tz) < 2) {
            // protest marchers stick to the main road strip and keep the line moving;
            // everyone else mostly strolls their own neighbourhood (spotNear), with
            // the occasional long cross-town trip — no more downtown beeline crowds.
            // 🧱 wander targets stay INSIDE the shrinking safe circle.
            const zMax = Math.max(20, Math.min(CITY_RADIUS - 8, this.zoneRadius() - 12));
            const t = c.protest
              ? { x: range(this.rnd, -9, 9), z: range(this.rnd, -120, 260) }
              : (this.rnd() < 0.7
                ? spotNear(this.rnd, this.world, c.x, c.z, 10, 78)
                : freeSpot(this.rnd, this.world, 8, zMax));
            c.tx = t.x; c.tz = t.z; c.timer = range(this.rnd, c.protest ? 9 : 6, c.protest ? 18 : 14);
            if (!c.protest && this.rnd() < 0.4) c.pauseT = range(this.rnd, 0.8, 2.8);
          }
          stepNpc(c, c.tx, c.tz, c.speed, dt, this.world);
          break;
        }
        case "flee": {
          // a cop is after this civilian — panic-run the other way
          const hunter = this.cops.find((cc) => cc.targetCiv === c.id);
          if (!hunter || hunter.mode !== "chase") { c.mode = "wander"; c.timer = 0; break; }
          const dx = c.x - hunter.x, dz = c.z - hunter.z, d = Math.hypot(dx, dz) || 1;
          stepNpc(c, c.x + (dx / d) * 10, c.z + (dz / d) * 10, c.speed * CIV_FLEE_MULT, dt, this.world);
          break;
        }
        case "detained":
          c.timer -= dt;
          if (c.timer <= 0) {
            c.mode = "wander"; c.timer = 0;
            if (dist2(c.x, c.z, p.x, p.z) < 45 * 45) this.toast(`${c.name} is free to go — time served!`, "info");
          }
          break;
        case "rescued":
          c.timer -= dt;
          if (c.timer < 1.2) stepNpc(c, c.tx, c.tz, c.speed * 1.6, dt, this.world);
          else { c.mode = "wander"; c.timer = 0; }
          break;
      }
    }

    /* --- 👥 7Nights: the crew — wander by day, hide at dusk, hunt when possessed --- */
    this.stepCrew(dt);

    // 🤖🧱 crew separation — foragers & shelter-seekers fan out instead of
    // stacking into one overlapping blob all grinding for the same spot
    {
      const squished: Crew[] = [];
      for (let i = 0; i < this.crew.length; i++) {
        const a = this.crew[i]; if (!a.alive) continue;
        for (let j = i + 1; j < this.crew.length; j++) {
          const b = this.crew[j]; if (!b.alive) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
          if (d > 1.25 || d < 1e-4) continue;
          const push = (1.25 - d) * 3.2 * dt;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
          if (!squished.includes(a)) squished.push(a);
          if (!squished.includes(b)) squished.push(b);
        }
      }
      for (const s of squished) resolve(s, 0.4, this.world); // never shove a bot into a wall
    }

    // 💓 the nearest beast of the pack (or a zombie) is close — your heart pounds
    this.heartT -= dt;
    if (this.phase === "night" && !this.youPossessed && this.heartT <= 0) {
      let near = Infinity;
      for (const bi of this.possessed) {
        const b = this.crew[bi];
        if (b && b.alive) near = Math.min(near, dist2(p.x, p.z, b.x, b.z));
      }
      for (const zb of this.zombies) if (!zb.dead) near = Math.min(near, dist2(p.x, p.z, zb.x, zb.z));
      if (near < 18 * 18) { this.heartT = near < 8 * 8 ? 0.55 : 0.95; sfx.heart(); }
    }

    // 🔥 campfires mend survivors by day (and keep the dark things away by night)
    // — the always-lit 🏕️ jungle camps count as campfires too
    if (this.phase === "day" || this.phase === "dawn") {
      const f = this.nearFire(p.x, p.z);
      if (f && dist2(p.x, p.z, f.x, f.z) < 5 * 5) this.hp = Math.min(100, this.hp + 2.5 * dt);
    }

    /* --- zombies (graveyard) — they rise at night, fear fire, and can be SLAIN --- */
    this.groanT -= dt;
    // 🩸 the fallen get their corpse clock ticked here (dead ones skip all logic)
    this.zLootCd = Math.max(0, this.zLootCd - dt);
    this.botLootCd = Math.max(0, this.botLootCd - dt);
    this.invOnceT = Math.max(0, this.invOnceT - dt);
    this.toolOnceT = Math.max(0, this.toolOnceT - dt);
    // 🎯 swarm census — one pass so diverse prey picks can discount victims that
    // already have enough hunters on them (see pickDiversePrey)
    if (night > 0.55) this.rebuildPreyLoad();
    for (const zb of this.zombies) {
      if (zb.dead) { zb.deadT = (zb.deadT ?? 0) + dt; continue; } // ⏱️ slain — the body falls & sinks; a fresh shambler rises next dusk
      zb.touchCd = Math.max(0, zb.touchCd - dt);
      zb.avoidT = Math.max(0, (zb.avoidT ?? 0) - dt); // 🧱 walled-in prey ban decays
      const d2p = dist2(zb.x, zb.z, p.x, p.z);
      // 🧱 THE WALL — the dead feel it too: a shambler caught beyond the safe
      // circle drags itself back toward the middle instead of hunting
      const dzC = Math.hypot(zb.x, zb.z);
      if (dzC > this.zoneRadius() + 2) {
        const k = Math.max(4, this.zoneRadius() - 6) / (dzC || 1);
        stepNpc(zb, zb.x * k, zb.z * k, ZOMBIE_SPEED * 1.05, dt, this.world);
        continue;
      }
      if (night > 0.55) {
        // 🧟 the horde hoovers dropped loot — every purse claimed off the dirt
        // fattens this beast's hoard, spilled back at dawn (or when you cut it down)
        for (let li = this.loot.length - 1; li >= 0; li--) {
          const l = this.loot[li];
          if (dist2(l.x, l.z, zb.x, zb.z) < 1.7 * 1.7) {
            zb.hoard = (zb.hoard ?? 0) + l.amt;
            this.loot.splice(li, 1);
            if (this.mp) this.netEmit?.({ t: "pickup", kind: "loot", id: -1, x: l.x, z: l.z });
            if (d2p < 18 * 18 && this.zLootCd <= 0) { this.zLootCd = 5; this.toast(`🧟 A zombie gulped down ${l.label} — $${l.amt} in its belly now!`, "info"); }
          }
        }
        const fire = this.nearFire(zb.x, zb.z);
        const scared = !!fire && dist2(fire.x, fire.z, zb.x, zb.z) < CAMPFIRE_R * CAMPFIRE_R;
        const beastYou = this.youPossessed && this.phase === "night"; // monsters don't fight monsters
        if (scared) {
          // fire wins — the zombie stumbles away from the flames
          const dx = zb.x - fire!.x, dz = zb.z - fire!.z, dl = Math.hypot(dx, dz) || 1;
          stepNpc(zb, zb.x + (dx / dl) * 9, zb.z + (dz / dl) * 9, ZOMBIE_SPEED, dt, this.world);
        } else {
          // 🧟 hunt the living — you OR any survivor still human. The fresh pick
          // is a weighted-random roll (see pickDiversePrey): nearby souls smell
          // stronger, swarmed souls are skipped, distant scents get chased —
          // the horde spreads across the night instead of ganging up on one.
          let victimCrew = -1;
          let tx = p.x, tz = p.z, td = d2p;
          if (beastYou || this.detainedT > 0 || this.drive) { td = Infinity; } // beasts are invisible to shamblers
          let latched = false;
          // 🎯 LATCH — each beast sticks with its marked victim until it dies /
          // is walled / is way out of reach (95u). When the latch breaks the
          // re-pick is DIVERSE (weighted random), never "globally nearest".
          if (zb.preyKind === "crew" && zb.preyId !== undefined) {
            const vi = this.crew.findIndex((cc) => cc.id === zb.preyId);
            const o = vi >= 0 ? this.crew[vi] : null;
            if (o && o.alive && !o.zombieTonight && !((zb.avoidT ?? 0) > 0 && zb.avoidV === o.id)) {
              const d = dist2(zb.x, zb.z, o.x, o.z);
              if (d < 95 * 95) { tx = o.x; tz = o.z; td = d; victimCrew = vi; latched = true; }
            }
          } else if (zb.preyKind === "you" && !beastYou && this.detainedT <= 0 && !this.drive) {
            if (d2p < 95 * 95) { tx = p.x; tz = p.z; td = d2p; victimCrew = -1; latched = true; }
          }
          // 👀 a much closer soul can steal a latched hunter's attention — but
          // only an under-swarmed one, and only every 0.6s (cheap, no thrash)
          zb.pickT = (zb.pickT ?? 0) - dt;
          if (latched && td > 13 * 13 && (zb.pickT ?? 0) <= 0 && !beastYou && this.detainedT <= 0 && !this.drive) {
            zb.pickT = 0.6;
            const steal = this.pickDiversePrey(zb, {
              avoidId: zb.avoidV, avoidT: zb.avoidT,
              includeYou: true, includeCivs: false, includeRemotes: false,
              sniff: 13, cap: ZOMBIE_SWARM_CAP, farHunt: false,
            });
            if (steal) {
              if (steal.kind === "crew") {
                victimCrew = steal.ci;
                zb.preyKind = "crew"; zb.preyId = this.crew[steal.ci].id;
                tx = this.crew[steal.ci].x; tz = this.crew[steal.ci].z;
                td = dist2(zb.x, zb.z, tx, tz);
              } else {
                victimCrew = -1;
                zb.preyKind = "you"; zb.preyId = undefined;
                tx = p.x; tz = p.z; td = d2p;
              }
            }
          }
          if (!latched) {
            // 🎯 fresh mark — weighted random over every living soul in sniff
            // range (swarmed souls discounted); 1-in-6 catches a far scent and
            // this beast goes FINDING that player across the night
            const pick = this.pickDiversePrey(zb, {
              avoidId: zb.avoidV, avoidT: zb.avoidT,
              includeYou: !beastYou && this.detainedT <= 0 && !this.drive,
              includeCivs: false, includeRemotes: false,
              sniff: ZOMBIE_SNIFF, cap: ZOMBIE_SWARM_CAP, farHunt: true,
            });
            if (pick) {
              zb.preyKind = pick.kind === "crew" ? "crew" : "you";
              zb.preyId = pick.kind === "crew" ? this.crew[pick.ci].id : undefined;
              if (pick.kind === "crew") {
                victimCrew = pick.ci;
                tx = this.crew[pick.ci].x; tz = this.crew[pick.ci].z;
                td = dist2(zb.x, zb.z, tx, tz);
              } else {
                victimCrew = -1; tx = p.x; tz = p.z; td = d2p;
              }
              latched = true;
            } else {
              zb.preyKind = undefined; zb.preyId = undefined;
            }
          }
          if (td < ZOMBIE_HUNT_R * ZOMBIE_HUNT_R || latched) {
            /* 🎯 pack surround (game-ai group movement): far out, each zombie
             * aims for its own golden-angle ring slot around the prey so the
             * pack encircles instead of all seeking one point; inside 5u the
             * offset fades to 0 and it's a straight lunge so kills connect.
             * The ring is 3u wide now — the old 1.7u packed hunters shoulder to
             * shoulder on one victim's chest. 🧱 wall/car sliding is all inside
             * stepNpc (whisker probe + sidestep watchdog). */
            const td1 = Math.sqrt(td);
            const offR = Math.max(0, Math.min(3, (td1 - 5) * 0.34));
            const oa = (zb.id % 97) * 2.399;
            stepNpc(zb, tx + Math.cos(oa) * offR, tz + Math.sin(oa) * offR, ZOMBIE_NIGHT_SPEED, dt, this.world);
            // 🧱 4s grinding toward the same prey = they're behind a wall/yard —
            // ban them for 6s so this beast shambles off to prey it can reach
            if ((zb.blockT ?? 0) > 4 && victimCrew >= 0) {
              zb.avoidV = this.crew[victimCrew].id; zb.avoidT = 6; zb.blockT = 0;
              zb.preyKind = undefined; zb.preyId = undefined; // latch drops with the ban
            }
            // caught a survivor — a few grabs bring them down and the zombie FEEDS
            if (victimCrew >= 0 && zb.touchCd <= 0 && td < 1.5 * 1.5) {
              zb.touchCd = ZOMBIE_TOUCH_CD;
              const victim = this.crew[victimCrew];
              victim.hp -= ZOMBIE_CREW_DMG;
              sfx.zombie();
              if (victim.hp <= 0) {
                this.killCrew(victimCrew, false);
                const owner = this.crew.find((cc) => cc.id === zb.owner);
                if (owner) owner.fed = (owner.fed ?? 0) + 1; // fed — survives the sunrise
                if (d2p < 30 * 30) this.toast(`🧟 ${victim.name} fell to the horde… their 💰 dropped!`, "bad");
              }
            }
          } else {
            // 🌙 no soul within sniff range — prowl the night streets near HERE.
            // The old drift dragged every idle shambler to ONE graveyard point,
            // milling the whole idle horde into a single blob across town.
            zb.roamT = (zb.roamT ?? 0) - dt;
            if ((zb.blockT ?? 0) > 2 || zb.roamT <= 0 || (zb.roamX !== undefined && dist2(zb.x, zb.z, zb.roamX, zb.roamZ) < 1.6)) {
              // fresh wander pick — rarely near the graveyard's WIDE haunt area
              // (thematic flavor; the old 25% odds marched a third of the idle
              // horde into one blob across town every night)
              let t = this.rnd() < 0.08
                ? spotNear(this.rnd, this.world, GRAVEYARD.x, GRAVEYARD.z, 6, GRAVEYARD.r - 4)
                : spotNear(this.rnd, this.world, zb.x, zb.z, 12, 55);
              // 🧱 never prowl beyond the shrinking wall — pull the pick back inside
              const zl = this.zoneRadius() - 8;
              const tl = Math.hypot(t.x, t.z);
              if (tl > zl) { const kk = zl / (tl || 1); t = { x: t.x * kk, z: t.z * kk }; }
              zb.roamX = t.x; zb.roamZ = t.z; zb.roamT = range(this.rnd, 7, 16);
              if ((zb.blockT ?? 0) > 2) zb.blockT = 0; // fresh spot, fresh clock
            }
            if (zb.roamX !== undefined && zb.roamZ !== undefined) {
              stepNpc(zb, zb.roamX, zb.roamZ, ZOMBIE_SPEED * 0.55, dt, this.world);
            }
          }
        }
        if (d2p < 1.6 * 1.6 && zb.touchCd <= 0 && this.detainedT <= 0 && !this.drive && !beastYou) { // the car shell keeps zombies out
          zb.touchCd = ZOMBIE_TOUCH_CD;
          this.hp = Math.max(0, this.hp - ZOMBIE_DMG);
          this.hurtT = HURT_FLASH_S;
          this.addShake(0.4); // 💥 MEDIUM — rotting hands on you
          sfx.zombie();
          if (this.hp <= 0) {
            const owner = this.crew.find((cc) => cc.id === zb.owner);
            if (owner) owner.fed = (owner.fed ?? 0) + 1; // a kill is a kill — this beast lives to see dawn
            this.die();
          }
        }
        if (this.groanT <= 0 && d2p < 20 * 20) { this.groanT = range(this.rnd, 2, 6); sfx.zombie(); }
      }
    }

    // 🧟 game-ai separation steering — the pack fans out around prey instead of
    // stacking into one overlapping blob all seeking the exact same point
    if (night > 0.55) {
      for (let i = 0; i < this.zombies.length; i++) {
        const a = this.zombies[i]; if (a.dead) continue;
        for (let j = i + 1; j < this.zombies.length; j++) {
          const b = this.zombies[j]; if (b.dead) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
          if (d > 1.35 || d < 1e-4) continue;
          const push = (1.35 - d) * 3.2 * dt;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
    }

    /* 🔍 night forensics sampler — every 2.5s the trace answers the lobby's
     * exact complaints: are the zombies piling into ONE cluster? blobbing at
     * the graveyard? grinding against walls (blockT)? dying in one spot? */
    this.traceT -= dt;
    if (night > 0.55 && this.traceT <= 0) {
      this.traceT = 2.5;
      const alive = this.zombies.filter((z) => !z.dead);
      let hunting = 0, grinding = 0;
      for (const z of alive) {
        if (z.preyKind) hunting++;
        if ((z.blockT ?? 0) > 2) grinding++;
      }
      // biggest single cluster of hunters (pairwise within 10u — flood-ish count)
      let cluster = 0, cx = 0, cz = 0;
      for (const a of alive) {
        let n = 0;
        for (const b of alive) if (Math.hypot(a.x - b.x, a.z - b.z) < 10) n++;
        if (n > cluster) { cluster = n; cx = a.x; cz = a.z; }
      }
      const graveBlob = alive.filter((z) => Math.hypot(z.x - GRAVEYARD.x, z.z - GRAVEYARD.z) < 25).length;
      const grindingCrew = this.crew.filter((c) => c.alive && (c.blockT ?? 0) > 2).length;
      const possAlive = this.possessed.filter((i) => this.crew[i].alive).length;
      const hiders = this.crew.filter((c) => c.alive && c.mode === "hide").length;
      this.trace(`🔍 horde: ${alive.length} up (${hunting} latched · ${alive.length - hunting} prowling) | biggest hunter cluster ${cluster} @ (${cx.toFixed(0)},${cz.toFixed(0)}) | grave-blob ${graveBlob} | grinding z${grinding}/c${grindingCrew} | pack ${possAlive} · hiding ${hiders} | zone ${this.zoneRadius().toFixed(0)}u`);
    }
    for (const an of this.animals) {
      an.timer -= dt;
      const d2p = dist2(an.x, an.z, p.x, p.z);
      if (an.dead) { an.deadT = (an.deadT ?? 0) + dt; continue; } // 🪦 fallen — the body sinks away till dawn's fresh stray

      /* 🧟 ZOMBIE HOUNDS — every stray turns at nightfall (see beginNight).
       * Faster than shamblers, they run down the living: you, the survivors,
       * fleeing townsfolk — but campfire fire still keeps them at bay. */
      if (an.zombie) {
        an.touchCd = Math.max(0, (an.touchCd ?? 0) - dt);
        an.barkT = Math.max(0, (an.barkT ?? 0) - dt);
        const fire = this.nearFire(an.x, an.z);
        if (fire && dist2(fire.x, fire.z, an.x, an.z) < CAMPFIRE_R * CAMPFIRE_R) {
          // fire wins — the hound paces snarling just outside the glow
          const dx = an.x - fire.x, dz = an.z - fire.z, dl = Math.hypot(dx, dz) || 1;
          stepNpc(an, an.x + (dx / dl) * 8, an.z + (dz / dl) * 8, ZOMDOG_SPEED * 0.7, dt, this.world);
        } else {
          // 🧟 hunt the living — weighted-random over nearby souls (you, a
          // survivor, a townsfolk) so the hound pack fans out like the horde
          let victimCrew = -1, victimCiv: Npc | null = null;
          let tx = p.x, tz = p.z;
          const youOk = !(this.detainedT > 0 || this.drive || (this.youPossessed && this.phase === "night"));
          let td = youOk ? d2p : Infinity;
          let latched = false;
          // 🎯 hound LATCH — stick with the marked soul until it dies or is way
          // out of reach (80u); a broken latch re-picks DIVERSELY, never nearest
          if (an.preyCrew !== undefined) {
            const vi = this.crew.findIndex((cc) => cc.id === an.preyCrew);
            const o = vi >= 0 ? this.crew[vi] : null;
            if (o && o.alive && !o.zombieTonight) {
              const d = dist2(an.x, an.z, o.x, o.z);
              if (d < 80 * 80) { td = d; tx = o.x; tz = o.z; victimCrew = vi; victimCiv = null; latched = true; }
            }
          } else if (an.preyCiv !== undefined) {
            const cv = this.civs.find((o) => o.id === an.preyCiv);
            if (cv && !cv.dead) {
              const d = dist2(an.x, an.z, cv.x, cv.z);
              if (d < 80 * 80) { td = d; tx = cv.x; tz = cv.z; victimCrew = -1; victimCiv = cv; latched = true; }
            }
          }
          // 👀 closer-soul steal — same cadence trick as the shamblers
          an.pickT = (an.pickT ?? 0) - dt;
          if (latched && td > 12 * 12 && (an.pickT ?? 0) <= 0) {
            an.pickT = 0.6;
            const steal = this.pickDiversePrey(an, {
              includeYou: youOk, includeCivs: true, includeRemotes: false,
              sniff: 12, cap: ZOMBIE_SWARM_CAP, farHunt: false,
            });
            if (steal && steal.kind === "crew") {
              an.preyCrew = this.crew[steal.ci].id; an.preyCiv = undefined;
              victimCrew = steal.ci; victimCiv = null;
              tx = this.crew[steal.ci].x; tz = this.crew[steal.ci].z;
              td = dist2(an.x, an.z, tx, tz);
            } else if (steal && steal.kind === "civ" && steal.civ) {
              an.preyCiv = steal.civ.id; an.preyCrew = undefined;
              victimCrew = -1; victimCiv = steal.civ;
              tx = steal.civ.x; tz = steal.civ.z;
              td = dist2(an.x, an.z, tx, tz);
            } else if (steal && steal.kind === "you") {
              an.preyCrew = undefined; an.preyCiv = undefined;
              victimCrew = -1; victimCiv = null;
              tx = p.x; tz = p.z; td = d2p;
            }
          }
          if (!latched) {
            // 🎯 fresh mark — weighted random over every living thing in scent
            // range; swarmed souls discounted, 1-in-6 catches a far scent
            const pick = this.pickDiversePrey(an, {
              includeYou: youOk, includeCivs: true, includeRemotes: false,
              sniff: ZOMDOG_SENSE, cap: ZOMBIE_SWARM_CAP, farHunt: true,
            });
            if (pick && pick.kind === "crew") {
              an.preyCrew = this.crew[pick.ci].id; an.preyCiv = undefined;
              victimCrew = pick.ci; victimCiv = null;
              tx = this.crew[pick.ci].x; tz = this.crew[pick.ci].z;
              td = dist2(an.x, an.z, tx, tz);
              latched = true;
            } else if (pick && pick.kind === "civ" && pick.civ) {
              an.preyCiv = pick.civ.id; an.preyCrew = undefined;
              victimCrew = -1; victimCiv = pick.civ;
              tx = pick.civ.x; tz = pick.civ.z;
              td = dist2(an.x, an.z, tx, tz);
              latched = true;
            } else if (pick) { // "you"
              an.preyCrew = undefined; an.preyCiv = undefined;
              victimCrew = -1; victimCiv = null;
              tx = p.x; tz = p.z; td = d2p;
              latched = true;
            } else {
              an.preyCrew = undefined; an.preyCiv = undefined;
            }
          }
          if (td < ZOMDOG_SENSE * ZOMDOG_SENSE || latched) {
            /* 🎯 pack surround — golden-angle ring slots, straight lunge inside 3u */
            const td1 = Math.sqrt(td);
            const offR = Math.max(0, Math.min(1.4, (td1 - 3) * 0.4));
            const oa = (an.id % 89) * 2.399;
            stepNpc(an, tx + Math.cos(oa) * offR, tz + Math.sin(oa) * offR, ZOMDOG_SPEED, dt, this.world);
            // BITE — a few grabs bring a survivor down. touchCd is only consumed
            // when a bite actually lands, so player-targeted lunges stay live
            if ((an.touchCd ?? 0) <= 0 && td < 1.45 * 1.45) {
              if (victimCrew >= 0) {
                an.touchCd = ZOMDOG_TOUCH_CD;
                const victim = this.crew[victimCrew];
                victim.hp -= ZOMDOG_DMG;
                sfx.zdog();
                if (victim.hp <= 0) {
                  this.killCrew(victimCrew, false);
                  if (d2p < 30 * 30) this.toast(`🐕‍🦺 A zombie hound brought down ${victim.name}… their 💰 dropped!`, "bad");
                }
              } else if (victimCiv) {
                an.touchCd = ZOMDOG_TOUCH_CD;
                victimCiv.hp = (victimCiv.hp ?? 30) - ZOMDOG_DMG;
                victimCiv.panicT = 3; victimCiv.fearX = an.x; victimCiv.fearZ = an.z;
                sfx.zdog();
                if (victimCiv.hp <= 0) this.killCiv(victimCiv, "zombie");
              }
            }
            // snarl when closing on YOU
            if (an.barkT <= 0 && td < 17 * 17) { an.barkT = range(this.rnd, 2.5, 5.5); sfx.zdog(); }
          } else {
            // scent lost — trot the empty streets
            if ((an.blockT ?? 0) > 2 || an.timer <= 0 || dist2(an.x, an.z, an.tx, an.tz) < 2) {
              an.timer = range(this.rnd, 4, 9);
              const spot = this.grazeSpot(an, false);
              if (spot) { an.tx = spot.x; an.tz = spot.z; }
              if ((an.blockT ?? 0) > 2) an.blockT = 0;
            }
            stepNpc(an, an.tx, an.tz, ZOMDOG_SPEED * 0.45, dt, this.world);
          }
          // 🩸 the jaws find YOU too — the car shell keeps dogs out, the beast-night keeps them off
          if (d2p < 1.5 * 1.5 && (an.touchCd ?? 0) <= 0 && this.detainedT <= 0 && !this.drive
            && !(this.youPossessed && this.phase === "night")) {
            an.touchCd = ZOMDOG_TOUCH_CD;
            this.hp = Math.max(0, this.hp - ZOMDOG_DMG);
            this.hurtT = HURT_FLASH_S;
            this.addShake(0.35); // 💥 MEDIUM — teeth in your leg
            sfx.zdog();
          }
        }
        continue;
      }

      const isDog = an.kind === "dog";
      const wild = WILDLIFE[an.kind];
      const fleeR = wild ? wild.spookR : 6;
      const arrived = dist2(an.x, an.z, an.tx, an.tz) < 2;
      const bs = an.baby ? 0.72 : 1;          // 🍼 babies waddle — everything at 72%
      an.barkT = Math.max(0, (an.barkT ?? 0) - dt); // one shared voice-cooldown
      // 👻 THE SPECTRAL STAG — the deep jungle's night spirit. It sleeps inside
      // the mist by day (the renderer fades it out); after dark it glides
      // between the trees, and if you press too close it VANISHES with a chime.
      // (Checked BEFORE the generic flee — the vanish is its signature move.)
      if (an.kind === "stag") {
        const night = nightFactor(this.clock);
        if (night < 0.35) {
          // sleeping in the spirit realm — no motion, renderer hides it
          an.resting = true; an.vx = 0; an.vz = 0;
          continue;
        }
        if (d2p < 5.5 * 5.5) {
          // too close — it dissolves and re-forms deeper in the jungle
          const spot = freeSpot(this.rnd, this.world, DEEP_JUNGLE_RADIUS + 8, JUNGLE_RADIUS - 40);
          this.fxQueue.push({ type: "confetti", x: an.x, y: 1.6, z: an.z, hue: 0.48 });
          an.x = spot.x; an.z = spot.z; an.tx = spot.x; an.tz = spot.z;
          an.vx = 0; an.vz = 0; an.resting = false; an.timer = range(this.rnd, 3, 7);
          sfx.chime();
          this.toast("👻 The spectral stag dissolved into mist before your eyes…", "info");
          continue;
        }
        if (an.timer <= 0 || (arrived && !an.resting)) {
          an.resting = false;
          const spot = this.grazeSpot(an, false);
          if (spot) { an.tx = spot.x; an.tz = spot.z; }
          an.timer = range(this.rnd, 6, 14);
        }
        if (!an.resting) stepNpc(an, an.tx, an.tz, WILDLIFE.stag.walk, dt, this.world);
        continue;
      }
      // 🐺🦊 THE FOOD CHAIN — wolves stalk rabbits & deer, foxes ghost after
      // rabbits. Chases run just under the prey's top speed, so every hunt is
      // a close thing decided by corners, luck and the juke. A catch is a puff
      // of fur (no gore) + a fed predator dozing it off; dawn repopulates.
      if ((an.kind === "wolf" && nightFactor(this.clock) <= 0.55) || an.kind === "fox") {
        if (!an.resting) {
          const wolf = an.kind === "wolf";
          let prey: Animal | null = null, pd = (wolf ? 20 : 15) * (wolf ? 20 : 15);
          for (const o of this.animals) {
            if (o === an || o.dead) continue;
            if (wolf ? o.kind !== "rabbit" && o.kind !== "deer" : o.kind !== "rabbit") continue;
            const d2o = dist2(an.x, an.z, o.x, o.z);
            if (d2o < pd) { pd = d2o; prey = o; }
          }
          if (prey) {
            if (dist2(an.x, an.z, prey.x, prey.z) < 1.3 * 1.3) {
              // 🫧 the catch — a puff of fur, then the hunter naps it off
              prey.dead = true;
              this.fxQueue.push({ type: "confetti", x: prey.x, y: 0.7, z: prey.z, hue: 0.12 });
              sfx.snap();
              an.resting = true; an.timer = range(this.rnd, 14, 26);
              an.tx = an.x; an.tz = an.z;
              continue;
            }
            stepNpc(an, prey.x, prey.z, (wild?.flee ?? 6) * 0.97 * bs, dt, this.world);
            continue;
          }
        }
      }
      // 🕷️ the giant yard spider — a shy web-dweller by day, but after dark it
      // stops fearing you and CREEPS: eight legs ghost it across the graveyard,
      // closing to a hair-raising 3.5u and just… watching. It never bites —
      // the dread is the point. (Daylight falls through to the shy graze cycle.)
      if (an.kind === "spider" && nightFactor(this.clock) > 0.5 && !this.drive && this.detainedT <= 0) {
        const hunt = d2p < 16 * 16;
        if (hunt && d2p > 3.5 * 3.5) {
          // skitter in — slow, deliberate, legs ticking
          stepNpc(an, p.x, p.z, 1.9, dt, this.world);
        } else if (hunt) {
          // close enough — freeze and stare (the whole graveyard holds its breath)
          an.vx = 0; an.vz = 0; an.resting = true;
        } else {
          // nobody to haunt — prowl its cemetery yard
          if (an.timer <= 0 || (arrived && !an.resting)) {
            an.resting = !an.resting;
            if (!an.resting) { const spot = this.grazeSpot(an, false); if (spot) { an.tx = spot.x; an.tz = spot.z; } an.timer = range(this.rnd, 4, 9); }
            else { an.tx = an.x; an.tz = an.z; an.timer = range(this.rnd, 2.5, 6); }
          }
          if (!an.resting) stepNpc(an, an.tx, an.tz, (WILDLIFE.spider?.walk ?? 1.0) * bs, dt, this.world);
        }
        continue;
      }
      if (!isDog && this.morphKind == null) {
        // 🐺 prey fears the CLOSER of (you, a hunting wolf/fox) — rabbits bolt
        // from the fox ghosting them through the ferns, not just from you
        let feared = d2p < fleeR * fleeR, fearX = p.x, fearZ = p.z, fearD2 = d2p;
        if (an.kind === "rabbit" || an.kind === "deer" || an.kind === "chicken") {
          for (const o of this.animals) {
            if (o === an || o.dead || (o.kind !== "wolf" && o.kind !== "fox")) continue;
            if (o.kind === "fox" && an.kind !== "rabbit") continue;
            const d2o = dist2(an.x, an.z, o.x, o.z);
            const R = fleeR * 1.4;
            if (d2o < R * R && (!feared || d2o < fearD2)) { feared = true; fearD2 = d2o; fearX = o.x; fearZ = o.z; }
          }
        }
        if (feared) {
          an.resting = false; // panic overrides grazing
          const dx = an.x - fearX, dz = an.z - fearZ, d = Math.hypot(dx, dz) || 1;
          const fs = (wild ? wild.flee : 5) * (an.baby ? 0.82 : 1);
          // 🐇 small prey JUKES — a sideways weave makes every chase a story
          let tx = an.x + (dx / d) * 8, tz = an.z + (dz / d) * 8;
          if (an.kind === "rabbit" || an.kind === "chicken" || an.kind === "deer") {
            const sway = Math.sin(this.clock * 5.5 + an.phase * 7) * 2.4;
            tx += (-dz / d) * sway; tz += (dx / d) * sway;
          }
          stepNpc(an, tx, tz, fs, dt, this.world);
          continue;
        }
      }
      // 🐺 wolves — harmless grazers by day, but after dark they remember they
      // are predators: a wolf within earshot stalks you through the trees,
      // circling just outside arm's reach and howling to call the pack.
      if (an.kind === "wolf" && nightFactor(this.clock) > 0.55 && !this.drive && this.detainedT <= 0) {
        const hunt = d2p < 30 * 30;
        if (hunt && d2p > 7.5 * 7.5) {
          // stalk — close the gap to the circle distance
          stepNpc(an, p.x, p.z, 2.6, dt, this.world);
        } else if (hunt) {
          // too close — back off a step (it keeps its distance… for now)
          const dx = an.x - p.x, dz = an.z - p.z, d = Math.hypot(dx, dz) || 1;
          stepNpc(an, an.x + (dx / d) * 6, an.z + (dz / d) * 6, 2.2, dt, this.world);
        } else {
          // out of earshot — regular graze cycle
          if (an.timer <= 0 || (arrived && !an.resting)) {
            an.resting = !an.resting;
            if (!an.resting) { const spot = this.grazeSpot(an, false); if (spot) { an.tx = spot.x; an.tz = spot.z; } an.timer = range(this.rnd, 5, 11); }
            else { an.tx = an.x; an.tz = an.z; an.timer = range(this.rnd, 2.5, 6); }
          }
          if (!an.resting) stepNpc(an, an.tx, an.tz, WILDLIFE.wolf.walk, dt, this.world);
        }
        // the call — one long howl when it has your scent, quieter pacing otherwise
        if (hunt && an.barkT <= 0 && d2p < 22 * 22) { an.barkT = range(this.rnd, 6, 13); sfx.wolfHowl(); }
        continue;
      }
      // 🐦‍⬛ crows do the night's grim accounting — they gather where bodies fell
      // and mutter among the feathers. Carrion duty keeps the jungle honest.
      if (an.kind === "crow") {
        let cx = 0, cz = 0, cd = 48 * 48, found = false;
        for (const c of this.crew) {
          if (c.alive) continue;
          const d2c = dist2(an.x, an.z, c.deathX, c.deathZ);
          if (d2c < cd) { cd = d2c; cx = c.deathX; cz = c.deathZ; found = true; }
        }
        for (const c of this.civs) {
          if (!c.dead) continue;
          const d2c = dist2(an.x, an.z, c.x, c.z);
          if (d2c < cd) { cd = d2c; cx = c.x; cz = c.z; found = true; }
        }
        if (found) {
          an.resting = false;
          stepNpc(an, cx, cz, (WILDLIFE.crow?.walk ?? 1.3) * 1.6, dt, this.world);
          if (an.barkT <= 0 && cd < 12 * 12) { an.barkT = range(this.rnd, 5, 11); sfx.caw(); }
          continue;
        }
      }
      // 🐻 bears bed down after dark — sneak past quietly… or wake the growl
      if (an.kind === "bear" && nightFactor(this.clock) > 0.6) {
        an.resting = true; an.vx = 0; an.vz = 0;
        if (d2p < 6.5 * 6.5 && an.barkT <= 0) {
          an.barkT = range(this.rnd, 9, 18);
          sfx.growl();
          this.addShake(0.14);
        }
        continue;
      }
      if (isDog) {
        /* 🐕 friendly strays — dogs DON'T fear you: they amble up to say hello,
         * bark a wagging welcome, then wander off to sniff the next corner */
        if (this.detainedT <= 0 && !this.drive && d2p < 13 * 13 && d2p > 2.6 * 2.6) {
          stepNpc(an, p.x, p.z, DOG_SPEED * bs, dt, this.world);
          if (an.barkT <= 0 && d2p < 9 * 9) { an.barkT = range(this.rnd, 3.5, 8); sfx.bark(); }
        } else {
          if (an.timer <= 0 || (arrived && !an.resting)) {
            if (!an.resting) {
              // reached the spot (or ran out of time en route) → sit and sniff a while
              an.resting = true;
              an.tx = an.x; an.tz = an.z;
              an.timer = range(this.rnd, 2, 5);
            } else {
              // rest over → amble to a new street corner
              an.resting = false;
              const spot = this.grazeSpot(an, false);
              if (spot) { an.tx = spot.x; an.tz = spot.z; }
              an.timer = range(this.rnd, 4, 11);
            }
          }
          if (!an.resting) {
            stepNpc(an, an.tx, an.tz, DOG_SPEED * 0.62 * bs, dt, this.world);
          }
        }
        continue;
      }
      // the farm & jungle wildlife — graze/rest cycle, with voices
      // 🐄 the world talks when you walk past — every species greets in its own tongue
      if (!isDog && an.barkT <= 0 && d2p < 11 * 11 && !this.drive && this.detainedT <= 0) {
        an.barkT = range(this.rnd, 8, 18);
        if (an.kind === "cow") sfx.moo();
        else if (an.kind === "chicken") sfx.cluck();
        else if (an.kind === "monkey") sfx.screech();
        else if (an.kind === "deer") sfx.bleat();
        else if (an.kind === "owl" && nightFactor(this.clock) > 0.45) sfx.owl();
        else if (an.kind === "crow") sfx.caw();
        else an.barkT = range(this.rnd, 4, 9); // non-voiced kinds retry sooner
      }
      if (an.timer <= 0 || (arrived && !an.resting)) {
        if (!an.resting) {
          // reached the spot (or ran out of time en route) → stop and graze a while
          an.resting = true;
          an.tx = an.x; an.tz = an.z;
          an.timer = range(this.rnd, 2.5, 6.5);
        } else {
          // rest over → amble to a nearby patch of grass
          an.resting = false;
          const farm = an.kind === "cow" || an.kind === "chicken" || an.kind === "pig" || an.kind === "sheep" || an.kind === "goat" || an.kind === "duck";
          let spot: { x: number; z: number } | null = null;
          // 🐄 herd cohesion — company is comfy: half the time an animal grazes
          // NEAR a same-kind herd-mate instead of a random patch, so flocks,
          // troops & harems form and drift around the map together
          if (this.rnd() < 0.5) {
            let mate: Animal | null = null, md = 40 * 40;
            for (const o of this.animals) {
              if (o === an || o.dead || o.kind !== an.kind) continue;
              const d2o = dist2(an.x, an.z, o.x, o.z);
              if (d2o < md) { md = d2o; mate = o; }
            }
            if (mate && md > 3 * 3) {
              const ha = this.rnd() * Math.PI * 2, hd = 2.5 + this.rnd() * 3;
              const chk = { x: mate.x + Math.cos(ha) * hd, z: mate.z + Math.sin(ha) * hd };
              resolve(chk, 0.6, this.world);
              spot = chk;
            }
          }
          if (!spot) spot = this.grazeSpot(an, farm);
          if (spot) { an.tx = spot.x; an.tz = spot.z; }
          an.timer = range(this.rnd, 5, 12);
        }
      }
      if (!an.resting) {
        stepNpc(an, an.tx, an.tz, (wild ? wild.walk : 1.8) * bs, dt, this.world);
      }
    }

    // 🩸 7Nights: at 0 hp the dark takes you — no dizzy respawn, the story ends
    if (this.hp <= 0 && this.detainedT <= 0) this.die();

    // 👀 free cam: drift the camera to a new living soul every so often
    if (this.spectating) {
      this.specSwapT -= dt;
      if (this.specSwapT <= 0) this.nextSpec();
    }

    /* --- HUD snapshot --- */
    this.hudT += dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.hud = this.buildHud(); }
    // 🌐 net glue: publish our survivor stream, sync the story clock, tick scores
    if (this.netTick) this.netTick(dt);
  }

  private buildHud(): HudData {
    const p = this.player;
    const squad = policeOutfitOf(this.look.outfit); // the officer's hero-page outfit
    let prompt = "";
    if (this.side === "police") {
      // officer guidance — nudge the player toward the next arrest
      if (!this.won && !this.lost) {
        for (const c of this.civs) {
          if (!c.runner || c.protest) continue;
          if (c.mode !== "wander" && c.mode !== "flee") continue;
          if (dist2(p.x, p.z, c.x, c.z) < 6 * 6) { prompt = c.voteId ? "Bust the carrier — walk into them!" : "Chase them down — walk into the runner to bust!"; break; }
        }
      }
    } else {
      for (const c of this.civs)
        if (c.mode === "detained" && dist2(p.x, p.z, c.x, c.z) < RESCUE_RADIUS * RESCUE_RADIUS) { prompt = `Press E to rescue ${c.name}!`; break; }
    }
    /* --- 7Nights story prompts --- */
    if (!prompt && !this.drive) {
      if (this.phase === "day" || this.phase === "dawn") {
        const c = this.nearestCrewAlive(ACCUSE_RADIUS);
        if (c) prompt = `Press R to ACCUSE ${c.name} — are they the possessed one?`;
      }
      if (!prompt) {
        const d = this.nearestDeadCrew(3.2);
        if (d && !d.inspected) prompt = `Press E to inspect ${d.name}'s body…`;
      }
      if (!prompt && this.phase !== "night" && this.tools.some((s) => s.kind === "builder")) {
        prompt = this.res.wood >= BARRICADE_COST.wood
          ? "B — build barricade · V — build campfire"
          : "Chop trees with the 🪓 to earn wood for building (B)";
      }
    }
    // 🚗 car prompts — driving clears everything (the speedo chip shows controls);
    // on foot, a parked car nearby hints how driving works (lowest priority)
    if (this.drive) {
      prompt = "";
    } else {
      const nc = this.nearestCar(CAR_ENTER_R);
      if (nc >= 0 && !prompt) {
        prompt = this.hasLicense ? "Press E to hop in and drive!" : "Find a glowing 🪪 license card to unlock cars!";
      }
    }
    let policeNear = false;
    if (this.side === "protester") {
      for (const cop of this.cops) if (cop.mode === "chase" && dist2(cop.x, cop.z, p.x, p.z) < 30 * 30) { policeNear = true; break; }
    }
    return {
      hp: Math.round(this.hp), stamina: Math.round(this.stamina), stars: this.stars,
      carried: this.carriedVotes.length, delivered: this.delivered, total: TOTAL_VOTES,
      points: this.points, rescues: this.rescues, support: this.rescues,
      zone: this.zone, clock: this.clock, night: nightFactor(this.clock),
      detained: this.detainedT > 0, detainLeft: Math.max(0, this.detainedT),
      arrest: this.arrest,
      station: this.arrestStation >= 0 ? POLICE_STATIONS[this.arrestStation].name : "",
      prompt, policeNear,
      civilians: this.civs.length, police: this.cops.length,
      won: this.won, elapsed: this.elapsed,
      side: this.side, busted: this.caughtCount, runnerDelivered: this.runnerDelivered, lost: this.lost,
      outfitLabel: this.side === "police" ? `${squad.emoji} ${squad.label}` : "",
      hasLicense: this.hasLicense, driving: !!this.drive, speed: this.drive ? Math.abs(this.drive.v) : 0,
      inv: this.inv.map((s) => ({ def: s.def, count: s.count })),
      hurt: this.hurtT > 0, sprinting: p.sprinting, exhausted: this.stamina <= 0.5,
      px: Math.round(this.player.x), pz: Math.round(this.player.z),
      gain: this.lastGain,
      power: this.activePower
        ? (() => {
            const d = POWERS.find((pd) => pd.kind === this.activePower)!;
            return { kind: d.kind, name: d.name, emoji: d.emoji, color: d.color, left: Math.max(0, this.powerT), max: this.powerMax, tip: d.tip };
          })()
        : null,
      pockets: this.powerPockets.map((def) => ({
        def, name: POWERS[def].name, emoji: POWERS[def].emoji, color: POWERS[def].color, tip: POWERS[def].tip,
      })),
      money: this.money,
      morphKind: this.morphKind,
      blinkReady: this.blinkCd <= 0,
      /* --- 7 Nights --- */
      nightNo: this.nightNo,
      phase: this.phase,
      phaseLeft: Math.max(0, this.phaseT),
      /* --- 🧱 THE WALL --- */
      zoneLevel: this.zoneLevel,
      zoneR: this.zoneRadius(),
      outsideWall: this.outsideWall,
      wood: this.res.wood,
      rock: this.res.rock,
      tools: this.tools.map((s) => ({ kind: s.kind, count: s.count })),
      held: this.held,
      youPossessed: this.youPossessed,
      beastCount: this.zombies.filter((z) => !z.dead).length, // contest: how many risen hunters roam
      kills: this.kills,
      crewAlive: this.crew.filter((c) => c.alive).length,
      aliveTotal: PLAYERS_TOTAL,
      remotesAlive: this.remotes.filter((r) => r.alive).length,
      crew: this.crew.map((c) => ({ name: c.name, color: c.color, alive: c.alive, mode: c.mode })),
      attackReady: this.attackCd <= 0,
      clue: this.lastClue,
      spec: { on: this.spectating, name: this.specName },
      /* --- 🌐 multiplayer --- */
      mp: this.mp,
      mpCode: this.mpCode,
      mpHost: this.mpHost,
      mpPing: this.mpPing,
      netPlayers: [
        ...(this.mp
          ? [{
              slot: this.mpSlot, name: this.playerName + (this.youPossessed && this.phase === "night" ? " 🐾" : ""),
              points: this.points, kills: this.kills, money: this.money,
              hp: Math.round(this.hp), alive: !this.lost, beast: this.youPossessed && this.phase === "night",
              drive: !!this.drive, self: true,
            }]
          : []),
        ...this.remotes.map((r) => ({
          slot: r.slot, name: r.name + (r.beast ? " 🐾" : ""),
          points: r.points, kills: r.kills, money: r.money,
          hp: Math.round(r.hp), alive: r.alive, beast: r.beast, drive: r.drive, self: false,
        })),
      ].sort((a, b) => b.points - a.points),
    };
  }

  getHud(): HudData { return this.hud; }

  /* ================= 🌐 multiplayer API (driven by lib/game/net/engineNet.ts) ================= */

  /** Any REAL teammate still breathing? (blocks solo-win / all-beast wins) */
  mpOthersAlive(): boolean {
    return this.mp && this.remotes.some((r) => r.alive);
  }

  /** Apply the host's possession roster: which crew bots turn + which REAL
   *  players are beasts. Also seeds lastPossessed so accusations stay fair. */
  applyRoster(possessed: number[], beastSlots: number[]) {
    if (this.mpHost) return; // the host already knows
    this.possessed = [...possessed];
    this.lastPossessed = [...possessed];
    this.mpBeastSlots = [...beastSlots];
    this.youPossessed = beastSlots.includes(this.mpSlot);
    for (const r of this.remotes) r.beast = beastSlots.includes(r.slot);
    if (this.phase === "night") {
      // roster arrived after our local beginNight — transform right now
      for (const idx of this.possessed) {
        const c = this.crew[idx];
        if (c && c.alive) { c.mode = "possessed"; c.hp = HUNTER_HP; }
      }
      if (this.youPossessed) this.held = -1;
    }
  }

  /** A teammate's client reported a crew death (or accusation) — mirror it here.
   *  Their world already dropped the purse; the event carries an identical one. */
  netCrewDeath(idx: number, clue: string, slain: boolean, loot?: { x: number; z: number; amt: number; label: string }) {
    const c = this.crew[idx];
    if (!c || !c.alive) return;
    c.alive = false;
    c.hp = 0;
    c.mode = "dead";
    c.deathX = c.x; c.deathZ = c.z;
    c.deathT = 0; // ⏱️ the fall animation starts here too
    c.clue = clue;
    c.inspected = false;
    if (loot) this.loot.push({ id: this.nid(), x: loot.x, z: loot.z, amt: Math.round(loot.amt), label: loot.label, bob: Math.random() * 6 });
    this.fxQueue.push({ type: "confetti", x: c.x, y: 1.2, z: c.z, hue: 0.98 });
    sfx.scream();
    const left = this.possessed.filter((i) => this.crew[i].alive).length;
    if (slain) this.toast(left > 0 ? `🗡️ A beast is DOWN — that was ${c.name}! (${left} still prowl…)` : `🗡️ The last beast is DOWN! That was ${c.name}…`, "good");
    else this.toast(`💀 ${c.name} was slain by the beast!`, "bad");
    if (this.crew.every((x) => !x.alive) && !this.mpOthersAlive()) {
      if (this.youPossessed && this.phase === "night") this.winGame("beast");
      else if (!this.youPossessed) this.winGame("solo");
    }
  }

  /** A teammate's beast clawed near (x,z) — if WE are within reach, we bleed. */
  netClawHit(x: number, z: number) {
    if (!this.running || this.lost || this.won) return;
    if (this.detainedT > 0 || this.drive || this.invulnT > 0) return;
    if (this.youPossessed && this.phase === "night") return; // beasts don't claw beasts
    const d2 = dist2(this.player.x, this.player.z, x, z);
    if (d2 > 2.4 * 2.4) return;
    this.hp = Math.max(0, this.hp - CLAW_DMG);
    this.hurtT = HURT_FLASH_S;
    this.addShake(0.5); // 💥 MEDIUM-LARGE — a beast just tore into you
    const dx = this.player.x - x, dz = this.player.z - z, dl = Math.hypot(dx, dz) || 1;
    this.player.vx = (dx / dl) * 10; this.player.vz = (dz / dl) * 10; this.player.vy = 4.5;
    sfx.scream();
    this.toast("🩸 A BEAST TORE INTO YOU! RUN!", "bad");
  }

  /** Wire damage addressed to US (a mirrored pack caught our avatar elsewhere). */
  netTakeDmg(amount: number) {
    if (!this.running || this.lost || this.won) return;
    if (this.detainedT > 0 || this.drive || this.invulnT > 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtT = HURT_FLASH_S;
    this.addShake(0.45); // 💥 MEDIUM
    sfx.scream();
    this.toast("🩸 A BEAST TORE INTO YOU! RUN!", "bad");
  }

  /** A teammate built something — grow the same wall in our world. */
  netBuild(kind: "barricade" | "campfire", x: number, z: number, rot: number) {
    if (this.builds.some((b) => dist2(b.x, b.z, x, z) < 1.2 * 1.2)) return;
    const ci = addDynamicCircle(this.world, { x, z, r: kind === "barricade" ? 1.15 : 0.6 });
    this.builds.push({ id: this.nid(), kind, x, z, rot, hp: kind === "barricade" ? BARRICADE_HP : 999, ci });
    sfx.build();
  }

  /** A teammate picked something up — vanish it from our world too (best effort). */
  netPickup(kind: "item" | "loot" | "tool" | "power" | "vote", id: number, x?: number, z?: number) {
    if (kind === "item") {
      const it = this.items.find((i) => i.id === id);
      if (it && it.active) { it.active = false; it.respawn = ITEM_RESPAWN_S; }
    } else if (kind === "vote") {
      const v = this.votes.find((i) => i.id === id);
      if (v && v.state === "world") { v.state = "delivered"; v.respawnT = CASH_RESPAWN_S; }
    } else if (kind === "tool") {
      const te = this.toolEnts.find((i) => i.id === id);
      if (te && te.active) { te.active = false; te.respawn = 45; }
    } else if (kind === "power") {
      const pw = this.powers.find((i) => i.id === id);
      if (pw && pw.active) { pw.active = false; pw.respawn = POWER_RESPAWN_S; }
    } else if (kind === "loot" && x !== undefined && z !== undefined) {
      // loot ids differ per world — match by position
      let best = -1, bd = 3 * 3;
      for (let i = 0; i < this.loot.length; i++) {
        const d = dist2(this.loot[i].x, this.loot[i].z, x, z);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) this.loot.splice(best, 1);
    }
  }

  /** Sync the remote roster from the lobby (adds joiners, removes leavers). */
  syncRemotes(players: { sid: string; slot: number; name: string; look: Appearance | null }[], mySid: string) {
    for (const p of players) {
      if (p.sid === mySid || p.slot === this.mpSlot) continue;
      let r = this.remotes.find((x) => x.slot === p.slot);
      if (!r) {
        r = {
          slot: p.slot, name: p.name, look: p.look ?? this.look,
          // 🎲 a joiner materialises at THEIR seat's drop spot (deterministic per
          // slot — the same answer on every client), never stacked at the map centre
          x: 0, z: 0, y: 0, vx: 0, vz: 0, face: 0,
          hp: 100, alive: true, beast: false, drive: false, sprint: false, air: false,
          attackT: 0, points: 0, kills: 0, money: 0, lastSeen: 0,
        };
        const spot = this.spawnSpotFor(p.slot);
        r.x = spot.x; r.z = spot.z;
        this.remotes.push(r);
        this.trace(`🌐 remote slot ${p.slot} (${p.name}) joined — avatar parked at their drop (${spot.x.toFixed(0)},${spot.z.toFixed(0)}) until their client streams in`);
        this.toast(`🌐 ${p.name} joined the 7 nights!`, "good");
      } else {
        r.name = p.name;
        if (p.look) r.look = p.look;
      }
    }
    // drop souls that left the room
    const slots = new Set(players.map((p) => p.slot));
    for (let i = this.remotes.length - 1; i >= 0; i--) {
      if (!slots.has(this.remotes[i].slot)) {
        this.toast(`🌐 ${this.remotes[i].name} left the town…`, "info");
        this.remotes.splice(i, 1);
      }
    }
    // 🌐 100-seat contest: every real soul except the session's native seat
    // (slot 0 = the host's own chair) takes over one bot's chair. The seat
    // list is the FULL session slot list — mine + every remote — so every
    // client, host or guest, frees the exact SAME chairs.
    this.applyBotReplacement([this.mpSlot, ...this.remotes.map((r) => r.slot)].filter((s) => s !== 0));
  }

  /* --- 🌐 100-seat contest: free one bot's chair per real player ---
   * Total contestants stays 100: 99 bots + you → 99 - (N-1) bots + N souls.
   * The seat choice is a pure function of the (sorted) slot list, so every
   * client — same seed, same roster order — frees the SAME chairs. */
  private replacedKey = "";
  private applyBotReplacement(slots: number[]) {
    if (!this.mp) return;
    const want = [...new Set(slots)].sort((a, b) => a - b).join(",");
    if (want === this.replacedKey) return;
    this.replacedKey = want;
    const taken = new Set<number>();
    for (const slot of want ? want.split(",").map(Number) : []) {
      let i = ((slot * 7919 + 13) % this.crew.length + this.crew.length) % this.crew.length;
      while (taken.has(i)) i = (i + 1) % this.crew.length;
      taken.add(i);
      const c = this.crew[i];
      if (!c || c.replaced) continue;
      c.replaced = true;          // their soul now walks as a REAL player
      c.alive = false;            // not a bot anymore — hunts/prey/accuse skip them
      c.hp = 0;
      c.mode = "dead";
      c.deathX = c.x; c.deathZ = c.z;
      c.inspected = true;         // no body to inspect — the seat was taken
      this.possessed = this.possessed.filter((pi) => pi !== i); // a real soul is never a bot-beast
      if (this.lastPossessed) this.lastPossessed = this.lastPossessed.filter((pi) => pi !== i);
    }
  }

  /** camera target helpers */
  camTarget(): { x: number; y: number; z: number } {
    const p = this.player;
    return { x: p.x, y: p.y + 1.7, z: p.z };
  }
}

export const WALL_R = WALL_RADIUS;
export const DAY_LEN = DAY_SECONDS;
