import {
  AGE_STATS, ANIMAL_SET, BALLOT, BLINK_CD, BLINK_DIST, CARRY_RADIUS, CAR_HIT_CD, CAR_HIT_DMG, CIV_COP_CD, CIV_DETECT, CIV_DETAIN_S, CIV_FLEE_MULT, CIV_JAIL_S,
  CIVIL_NAMES, CIVILIAN_COUNT, CITY_RADIUS, CONFISCATE_FINE, DAY_SECONDS,
  DELIVER_RADIUS, DETECT_BASE, DETECT_CARRY_BONUS, DETECT_STAR_BONUS, DETAIN_SECONDS, DROP_SCATTER,
  ESCAPE_LOST_S, FARM_RADIUS, FAINT_S, FLIP_S, GRAVEYARD, HURT_FLASH_S, ITEMS, INV_SLOTS, INV_STACK, ITEM_COUNT,
  ITEM_RESPAWN_S, JUMP_COST, JUMP2_COST, JUMP_MULT, JUNGLE_RADIUS, LAND_SQUASH_S, MAGNET_PULL, MAGNET_RADIUS, MAX_CARRY, MAX_CIV_HELD, MORPH_ANIMALS, PICKUP_RADIUS,
  POINTS_DELIVER, POINTS_PICKUP, POINTS_RESCUE, POLICE_COUNT, POLICE_SPEED, POLICE_SPRINT, POLICE_STATIONS, POWER_COUNT, POWER_JUNGLE_SHARE, POWER_PICKUP_R, POWER_RESPAWN_S, POWERS, RELEASE_GRACE_S, RESCUE_POINTS,
  RESCUE_RADIUS, SPAWN, SONIC_MULT, STAR_DECAY_S, TOTAL_VOTES, TRAFFIC_COUNT, VAN_AXLE, VAN_LOAD_S, VAN_RADIUS, VAN_SPEED, VAN_UNLOAD_S,
  WALL_RADIUS, ZOMBIE_COUNT, ZOMBIE_DMG, ZOMBIE_NIGHT_SPEED,
  ZOMBIE_SPEED, ZOMBIE_TOUCH_CD, stationCage, stationGate, type AnimalKind, type Appearance, type PowerKind, type Zone, zoneOf, ZONE_TOAST,
} from "./constants";
import { clamp, mulberry32, range } from "./rng";
import { freeSpot, lineClear, resolve, RING_R, ROADS, type World } from "./worldgen";
import { advanceClock, nightFactor, newBody, stepBody, stepNpc, type Body } from "./sim";
import { sfx } from "./audio";

export type CopMode = "patrol" | "chase" | "return" | "celebrate";
export type CivilMode = "wander" | "flee" | "detained" | "rescued";

export interface Npc {
  id: number; kind: "police" | "civilian";
  x: number; z: number; vx: number; vz: number; face: number;
  mode: CopMode | CivilMode;
  tx: number; tz: number; timer: number; phase: number;
  name: string; speed: number; alertT: number;
  /** cop only: id of the civilian being chased (unset = hunting the player) */
  targetCiv?: number;
  /** cop only: cooldown before this cop may arrest another civilian */
  copCd?: number;
  /** main-road marcher: stays on the protest strip instead of roaming the city */
  protest?: boolean;
  /** civilian only: id of the police van driving them to the station (unset = no van yet) */
  vanId?: number;
}
export interface Zombie { id: number; x: number; z: number; vx: number; vz: number; face: number; phase: number; touchCd: number }
export interface Animal { id: number; kind: AnimalKind; x: number; z: number; vx: number; vz: number; face: number; tx: number; tz: number; timer: number; phase: number; resting: boolean }
export interface ItemEnt { id: number; def: number; x: number; z: number; active: boolean; respawn: number }
export interface VoteEnt { id: number; x: number; z: number; state: "world" | "carried" | "delivered" }
/** A rare super-power gem glowing somewhere in the jungle (or a mystery spot). */
export interface PowerEnt { id: number; def: number; x: number; z: number; active: boolean; respawn: number }

export interface Fx { type: "confetti"; x: number; y: number; z: number; hue: number }

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
  /** animal the player currently looks like (morph power) */
  morphKind: AnimalKind | null;
  /** true when Blink is charged and Q will teleport right now */
  blinkReady: boolean;
}

export type ToastFn = (msg: string, kind?: "info" | "good" | "bad") => void;

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

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
  input = { f: 0, r: 0, sprint: false, jump: false, yaw: Math.PI, pitch: 0.32 };
  touchMove = { active: false, sprint: false };
  hp = 100; stamina = 100;
  inv: { def: number; count: number }[] = []; // pocketed food, used from the HUD item bar
  hurtT = 0;                // red damage-flash timer
  flipT = 0;                // double-jump front-flip timer (FLIP_S → 0)
  squashT = 0;              // landing squash-and-stretch timer (LAND_SQUASH_S → 0)
  lastGain: { hp: number; stamina: number; at: number } = { hp: 0, stamina: 0, at: 0 }; // bumped on every eat
  private exhaustedAnnounced = false;
  private pocketFullT = 0;  // throttles the "pockets full" toast
  clock = 0.3;
  stars = 0; starTimer = 0;
  chased = false; // true while (or just after) any cop is hunting the player
  carriedVotes: VoteEnt[] = [];
  votes: VoteEnt[] = [];
  cops: Npc[] = [];
  civs: Npc[] = [];
  zombies: Zombie[] = [];
  animals: Animal[] = [];
  items: ItemEnt[] = [];
  traffic: TrafficCar[] = [];
  vans: PoliceVan[] = [];
  powers: PowerEnt[] = [];
  fxQueue: Fx[] = [];

  /* --- rare super powers --- */
  activePower: PowerKind | null = null;
  powerT = 0; powerMax = 1;      // seconds left / total of the active power
  morphKind: AnimalKind | null = null; // current animal look while morph lasts
  blinkCd = 0;                   // blink teleport cooldown

  faintT = 0;   // >0 while the world spins after a car bonk — input is ignored, stars orbit
  carHitCd = 0; // old-game hitCd — no double-bonks from the same bumper

  /** Arrest pipeline: called (van coming) → riding (in the van) → locked (at the station) → free. */
  arrest: ArrestState = "free";
  arrestStation = -1;
  playerInVan = false;
  private vanNeeded = false;

  points = 0; rescues = 0; caughtCount = 0;
  delivered = 0;
  detainedT = 0; invulnT = 8; elapsed = 0; // 8s spawn grace — cops can't spot or catch you
  won = false; wonAt = 0;
  running = false;
  private nextId = 1;
  private toast: ToastFn;
  private zone: Zone = "City";
  private hudT = 0;
  private hud: HudData;
  private groanT = 0;

  constructor(world: World, look: Appearance, toast: ToastFn) {
    this.world = world;
    this.look = look;
    this.toast = toast;
    this.hud = this.buildHud();
    this.spawnAll();
  }

  /* ---------------- spawning ---------------- */
  private nid() { return this.nextId++; }

  /**
   * Pick a police spawn far away from the player's spawn point. Used by both the
   * first spawn AND reset() so a replay can never seed a cop next to the player
   * (which used to cause an "instant detain" right after the grace window).
   */
  private safeCopSpot(): { x: number; z: number } {
    const avoid = [{ x: SPAWN.x, z: SPAWN.z, r: 90 }];
    for (let i = 0; i < 14; i++) {
      const p = freeSpot(this.rnd, this.world, 60, 140, avoid);
      if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) >= 90) return p;
    }
    // Last resort: walk a wide ring around spawn until a point survives colliders.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + this.rnd() * 0.25;
      const p = { x: SPAWN.x + Math.cos(a) * 105, z: SPAWN.z + Math.sin(a) * 105 };
      resolve(p, 0.9, this.world);
      if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) >= 90) return p;
    }
    return { x: SPAWN.x + 105, z: SPAWN.z };
  }

  /** A free spot at least `minD` units away from the player — where cops walk to when they give up. */
  private spotAwayFromPlayer(minD: number): { x: number; z: number } {
    const p = this.player;
    let pick = { x: p.x + minD, z: p.z + minD };
    for (let i = 0; i < 10; i++) {
      const t = freeSpot(this.rnd, this.world, 10, 120);
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
    // civilians
    for (let i = 0; i < CIVILIAN_COUNT; i++) {
      const p = freeSpot(r, this.world, 8, CITY_RADIUS - 8);
      this.civs.push({ id: this.nid(), kind: "civilian", x: p.x, z: p.z, vx: 0, vz: 0, face: 0, mode: "wander", tx: p.x, tz: p.z, timer: range(r, 0, 4), phase: Math.random() * 6, name: CIVIL_NAMES[i % CIVIL_NAMES.length], speed: range(r, 2.2, 3.4), alertT: 0 });
    }
    // protest march — old-game homage: a slow column of civilians walks the main road
    const MARCHERS = 6;
    for (let i = 0; i < MARCHERS; i++) {
      const c = this.civs[i * 3 % this.civs.length];
      c.protest = true;
      c.x = -8 + (i % 3) * 8; c.z = 10 + i * 26;
      c.tx = c.x; c.tz = c.z;
      c.speed = range(r, 1.5, 2.1);
      c.timer = range(r, 2, 6);
    }
    // zombies (graveyard)
    for (let i = 0; i < ZOMBIE_COUNT; i++) {
      const a = range(r, 0, Math.PI * 2), d = range(r, 4, 36);
      this.zombies.push({ id: this.nid(), x: GRAVEYARD.x + Math.cos(a) * d, z: GRAVEYARD.z + Math.sin(a) * d, vx: 0, vz: 0, face: 0, phase: Math.random() * 6, touchCd: 0 });
    }
    // animals
    let ai = 0;
    for (const set of ANIMAL_SET)
      for (let i = 0; i < set.count; i++) {
        const p = freeSpot(r, this.world, set.zone === "farm" ? CITY_RADIUS + 10 : FARM_RADIUS + 10, set.zone === "farm" ? FARM_RADIUS - 8 : JUNGLE_RADIUS - 30);
        this.animals.push({ id: this.nid(), kind: set.kind, x: p.x, z: p.z, vx: 0, vz: 0, face: 0, tx: p.x, tz: p.z, timer: range(r, 0, 5), phase: Math.random() * 6, resting: false });
        ai++;
      }
    // items
    for (let i = 0; i < ITEM_COUNT; i++) {
      const p = freeSpot(r, this.world, 10, 430);
      this.items.push({ id: this.nid(), def: Math.floor(r() * ITEMS.length), x: p.x, z: p.z, active: true, respawn: 0 });
    }
    // rare super powers — mostly deep-jungle treasures, a couple of mystery spots anywhere
    for (let i = 0; i < POWER_COUNT; i++) {
      const jungle = r() < POWER_JUNGLE_SHARE;
      const p = freeSpot(r, this.world, jungle ? FARM_RADIUS + 12 : 10, jungle ? JUNGLE_RADIUS - 14 : 430);
      this.powers.push({ id: this.nid(), def: i % POWERS.length, x: p.x, z: p.z, active: true, respawn: 0 });
    }
    // police van fleet — one van per station, parked at its gate
    for (let i = 0; i < POLICE_STATIONS.length; i++) {
      const st = POLICE_STATIONS[i];
      const g = stationGate(st);
      const ix = g.x + Math.sign(st.x) * 4, iz = g.z + Math.sign(st.z) * 4;
      this.vans.push({ id: this.nid(), station: i, x: ix, z: iz, rot: Math.atan2(st.x - ix, st.z - iz), state: "idle", path: [], goal: { x: ix, z: iz }, timer: 0, stallT: 0, rebuilds: 0, prisoner: null });
    }
    // ring-road traffic — two lanes, both directions, mixed body styles
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      this.traffic.push({
        r: RING_R + (dir > 0 ? -2.7 : 2.7),
        dir,
        a: (i / TRAFFIC_COUNT) * Math.PI * 2,
        sp: 0.034 + (i % 3) * 0.011, // ≈7–12 u/s — quicker than a walking kid, dodgeable when sprinting
        c: (i * 3 + 1) % 8,
        t: i % 3,
        x: 0, z: 0, rot: 0,
      });
      const t = this.traffic[this.traffic.length - 1];
      t.x = Math.cos(t.a) * t.r; t.z = Math.sin(t.a) * t.r;
      t.rot = t.dir > 0 ? -t.a : Math.PI + t.a;
    }
  }

  /* ---------------- lifecycle ---------------- */
  start() { this.running = true; }
  setToast(fn: ToastFn) { this.toast = fn; }

  reset(look: Appearance) {
    this.look = look;
    this.player = newBody(SPAWN.x, SPAWN.z);
    this.hp = 100; this.stamina = 100; this.stars = 0; this.starTimer = 0; this.chased = false;
    this.inv = []; this.hurtT = 0; this.exhaustedAnnounced = false; this.pocketFullT = 0;
    this.flipT = 0; this.squashT = 0; this.faintT = 0; this.carHitCd = 0;
    this.activePower = null; this.powerT = 0; this.morphKind = null; this.blinkCd = 0;
    for (const pw of this.powers) { pw.active = true; pw.respawn = 0; }
    this.carriedVotes = []; this.delivered = 0; this.points = 0; this.rescues = 0; this.caughtCount = 0;
    this.detainedT = 0; this.invulnT = 8; this.elapsed = 0; this.won = false; this.clock = 0.3;
    this.arrest = "free"; this.arrestStation = -1; this.playerInVan = false; this.vanNeeded = false;
    for (const v of this.votes) { v.state = "world"; const p = freeSpot(this.rnd, this.world, 16, 420); v.x = p.x; v.z = p.z; }
    for (const it of this.items) { it.active = true; it.respawn = 0; }
    for (const c of this.civs) { c.mode = "wander"; c.vanId = undefined; }
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
    // rescue a detained civilian nearby
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
    }
  }

  private dropVotes(x: number, z: number) {
    for (const v of this.carriedVotes) {
      const a = Math.random() * Math.PI * 2, d = range(this.rnd, 0.8, DROP_SCATTER);
      const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
      resolve(p, 0.8, this.world);
      v.x = p.x; v.z = p.z; v.state = "world";
    }
    this.carriedVotes = [];
  }

  private catchPlayer(cop: Npc) {
    this.caughtCount++;
    this.stars = Math.min(5, this.stars + 1);
    this.starTimer = STAR_DECAY_S;
    this.hp = Math.max(1, this.hp - 8);
    this.hurtT = HURT_FLASH_S;
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
      ? `🚔 Caught! Police called a van — you and your ${carried} vote${carried > 1 ? "s" : ""} are going to the station…`
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
      this.toast(n === 1 ? `Vote delivered! +${POINTS_DELIVER}` : `${n} votes delivered! +${POINTS_DELIVER * n}`, "good");
      if (left === 0) {
        this.won = true; this.wonAt = Date.now();
        this.points += 500;
        sfx.win();
        this.toast("🏆 ALL VOTES DELIVERED! Democracy saved — you legend!", "good");
      } else if (left <= 3) {
        this.toast(`Only ${left} votes to go!`, "info");
      }
    }
  }

  private dizzyRespawn() {
    // if a van was taking us in, call it off
    for (const van of this.vans) {
      if (van.prisoner?.kind === "player") this.abortVan(van);
    }
    this.playerInVan = false;
    this.arrest = "free"; this.arrestStation = -1; this.vanNeeded = false;
    this.player.x = SPAWN.x; this.player.z = SPAWN.z; this.player.y = 0;
    this.player.vx = this.player.vz = 0;
    this.hp = 60;
    this.hurtT = HURT_FLASH_S;
    this.detainedT = 4;
    this.invulnT = 3;
    this.dropVotes(SPAWN.x + 2, SPAWN.z + 2);
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
      ? `⚖️ Locked up at ${st.name}! ${taken} vote${taken > 1 ? "s" : ""} impounded in the cage + ${CONFISCATE_FINE} point fine — steal them back after release!`
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
    const idx = this.inv.findIndex((s) => s.def === def);
    if (idx < 0 || this.inv[idx].count <= 0) return;
    const d = ITEMS[def];
    if (this.hp >= 100 && this.stamina >= 100) {
      this.toast(`Already full! Save the ${d.name} for later.`, "info");
      return;
    }
    this.inv[idx].count--;
    if (this.inv[idx].count <= 0) this.inv.splice(idx, 1);
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

  /** Blink Teleport: poof ~15u forward. Only while the blink gem's power lasts. */
  tryBlink() {
    if (!this.running || this.activePower !== "blink") return;
    if (this.blinkCd > 0 || this.detainedT > 0 || this.faintT > 0) return;
    this.blinkCd = BLINK_CD;
    const p = this.player;
    const dx = Math.sin(p.face), dz = Math.cos(p.face);
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
    sfx.blink();
    this.fxQueue.push({ type: "confetti", x: p.x, y: 1.1, z: p.z, hue: 0.72 });
    this.toast("🌀 Poof! Teleported!", "good");
  }

  /** Collect a rare gem — the new power replaces whatever was active (one at a time). */
  private activatePower(def: number, x: number, z: number) {
    const d = POWERS[def];
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
    // fresh animal scent confuses the police — any hunt on us instantly breaks off
    if (d.kind === "morph" && this.chased) {
      for (const cop of this.cops) {
        if (cop.mode === "chase" && cop.targetCiv == null) { cop.mode = "return"; cop.timer = 0; }
      }
      this.clearWanted("🐾 The police sniffed around and lost you — you smell animal now!");
    }
  }

  private grazeSpot(an: Animal, farm: boolean): { x: number; z: number } | null {
    const minR = farm ? CITY_RADIUS + 6 : FARM_RADIUS + 6;
    const maxR = farm ? FARM_RADIUS - 10 : JUNGLE_RADIUS - 30;
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * Math.PI * 2, d = 7 + this.rnd() * 16;
      const x = an.x + Math.cos(a) * d, z = an.z + Math.sin(a) * d;
      const rr = Math.hypot(x, z);
      if (rr < minR || rr > maxR) continue;
      const chk = { x, z };
      resolve(chk, 0.6, this.world);
      if (Math.abs(chk.x - x) > 0.05 || Math.abs(chk.z - z) > 0.05) continue;
      return chk;
    }
    return null;
  }

  /* ---------------- main update ---------------- */
  update(dt0: number) {
    if (!this.running) return;
    const dt = Math.min(0.05, dt0);
    this.elapsed += dt;
    this.clock = advanceClock(this.clock, dt);
    const night = nightFactor(this.clock);
    const p = this.player;

    // day/night zone toast
    const z = zoneOf(p.x, p.z);
    if (z !== this.zone) { this.zone = z; this.toast(ZONE_TOAST[z], "info"); }

    /* --- player --- */
    this.pocketFullT = Math.max(0, this.pocketFullT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.flipT = Math.max(0, this.flipT - dt);
    this.squashT = Math.max(0, this.squashT - dt);
    this.faintT = Math.max(0, this.faintT - dt);
    this.carHitCd = Math.max(0, this.carHitCd - dt);
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
    } else {
      this.invulnT = Math.max(0, this.invulnT - dt);
      const prevY = p.y;
      const prevJumps = p.jumps;
      p.stamina = this.stamina; // engine stamina is the single source of truth
      // while dizzy from a car bonk the legs don't answer — momentum carries the tumble
      const faint = this.faintT > 0;
      stepBody(p, faint
        ? { f: 0, r: 0, sprint: false, jump: false }
        : { f: this.input.f, r: this.input.r, sprint: this.input.sprint, jump: this.input.jump },
        dt, this.look.age, this.world, {
          yaw: this.input.yaw,
          // ⚡ Sonic Dash — legs become a blur · 🦘 Kangaroo Leap — superhero jumps
          speedScale: this.activePower === "sonic" ? SONIC_MULT : 1,
          jumpScale: this.activePower === "jump" ? JUMP_MULT : 1,
        });
      this.stamina = p.stamina; // sprinting drains / walking regenerates (see stepBody)
      if (p.jumps === 1 && prevJumps === 0) {
        sfx.jump();
        this.stamina = Math.max(0, this.stamina - JUMP_COST);
      } else if (p.jumps === 2 && prevJumps === 1) {
        sfx.jump2();
        this.stamina = Math.max(0, this.stamina - JUMP2_COST);
        this.flipT = FLIP_S;
      }
      if (prevY > 0 && p.y === 0) { sfx.land(); this.squashT = LAND_SQUASH_S; }
      if (this.stamina <= 0.5 && !this.exhaustedAnnounced) {
        this.exhaustedAnnounced = true;
        this.toast("😮‍💨 Exhausted! Walk a little to catch your breath, or eat something.", "info");
      } else if (this.stamina > 25) this.exhaustedAnnounced = false;
    }
    this.hp = Math.min(100, this.hp + 1.2 * dt * AGE_STATS[this.look.age].regen);

    /* --- ring-road traffic: solid cars that bonk careless runners --- */
    for (const t of this.traffic) {
      t.a += t.sp * t.dir * dt;
      t.x = Math.cos(t.a) * t.r;
      t.z = Math.sin(t.a) * t.r;
      t.rot = t.dir > 0 ? -t.a : Math.PI + t.a;
      if (this.detainedT > 0) continue; // sitting out detention — traffic can't touch you
      const fx = Math.sin(t.rot), fz = Math.cos(t.rot);
      for (const off of [1.25, -1.25]) { // front & rear axle circles, matching parked-car colliders
        const cx = t.x + fx * off, cz = t.z + fz * off;
        const dx = p.x - cx, dz = p.z - cz, rr = 1.16 + 0.55;
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
          sfx.bonk();
          const BONKS = [
            "🚕 BONK! A car sent you flying — everything is spinning…",
            "🚌 Ow! Traffic: 1, you: 0. Shake it off, champ!",
            "🚗 Wham! The car won that round — up you get, runner!",
            "🛺 Oof! Watch the ring road — cars don't brake for vote thieves.",
          ];
          this.toast(BONKS[Math.floor(this.rnd() * BONKS.length)], "bad");
        }
        break; // one axle circle is enough — the other overlaps too
      }
    }

    /* --- police van fleet: transport prisoners to the nearest station --- */
    this.updateVans(dt);
    // vans are solid — shove the player out of their footprint (no bonk, police don't ram kids)
    if (this.detainedT <= 0) {
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

    /* --- votes --- */
    if (this.detainedT <= 0 && !this.won) {
      if (this.carriedVotes.length < MAX_CARRY) {
        for (const v of this.votes) {
          if (v.state !== "world") continue;
          if (dist2(p.x, p.z, v.x, v.z) < CARRY_RADIUS * CARRY_RADIUS) {
            v.state = "carried";
            this.carriedVotes.push(v);
            this.points += POINTS_PICKUP;
            sfx.pickup();
            this.toast(`Vote snatched! (${this.carriedVotes.length}/${MAX_CARRY} carried)`, "good");
            break;
          }
        }
      }
      if (this.carriedVotes.length > 0 && dist2(p.x, p.z, BALLOT.x, BALLOT.z) < DELIVER_RADIUS * DELIVER_RADIUS) this.deliver();
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
        let slot = this.inv.find((s) => s.def === it.def);
        if (slot) {
          if (slot.count >= INV_STACK) continue; // stack full — leave it on the ground
          slot.count++;
        } else {
          if (this.inv.length >= INV_SLOTS) {
            if (this.pocketFullT <= 0) {
              this.pocketFullT = 6;
              this.toast("🎒 Pockets full! Eat something to make room (press 1-8).", "info");
            }
            continue; // no free slot — leave it on the ground
          }
          this.inv.push({ def: it.def, count: 1 });
          slot = this.inv[this.inv.length - 1];
        }
        it.active = false; it.respawn = ITEM_RESPAWN_S;
        const n = this.inv.findIndex((s) => s.def === it.def) + 1;
        sfx.pickup();
        this.toast(`${d.emoji} ${d.name} pocketed (x${slot.count}) — tap the bag or press ${n} to use!`, "good");
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
          pw.active = false;
          pw.respawn = POWER_RESPAWN_S;
          this.activatePower(pw.def, pw.x, pw.z);
        }
      }
    }

    /* --- police --- */
    const carrying = this.carriedVotes.length;
    const detect = DETECT_BASE + carrying * DETECT_CARRY_BONUS + this.stars * DETECT_STAR_BONUS;
    for (const cop of this.cops) {
      cop.phase += dt;
      cop.copCd = Math.max(0, (cop.copCd ?? 0) - dt);
      const d2p = dist2(cop.x, cop.z, p.x, p.z);
      switch (cop.mode) {
        case "patrol": {
          cop.timer -= dt;
          const arrived = dist2(cop.x, cop.z, cop.tx, cop.tz) < 4;
          if (arrived || cop.timer <= 0) {
            const target = freeSpot(this.rnd, this.world, 10, 120);
            cop.tx = target.x; cop.tz = target.z; cop.timer = range(this.rnd, 8, 16);
          }
          stepNpc(cop, cop.tx, cop.tz, POLICE_SPEED * 0.6, dt, this.world);
          // 🐒 Animal Morph — a cow loitering with stolen votes is somehow not suspicious
          if (this.morphKind == null && this.invulnT <= 0 && this.detainedT <= 0 && d2p < detect * detect && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; cop.timer = 0;
            this.chased = true;
            sfx.alert();
            this.toast("🚨 Police spotted you! RUN!", "bad");
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
              cop.mode = "celebrate"; cop.timer = 2.5;
              const roam = freeSpot(this.rnd, this.world, 10, 120);
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
          if (this.morphKind != null) {
            cop.mode = "return"; cop.timer = 0; cop.alertT = 0;
            break;
          }
          const spd = POLICE_SPRINT + this.stars * 0.22;
          stepNpc(cop, p.x, p.z, spd, dt, this.world);
          cop.alertT = d2p < detect * detect * 3 ? ESCAPE_LOST_S : cop.alertT - dt;
          if (d2p < 1.9 * 1.9 && this.detainedT <= 0 && this.invulnT <= 0 && this.morphKind == null) { this.catchPlayer(cop); }
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
          if (this.morphKind == null && this.invulnT <= 0 && this.detainedT <= 0 && d2p < detect * 0.8 * (detect * 0.8) && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; this.chased = true; sfx.alert();
          }
          break;
        }
      }
    }

    /* --- escape sweep: player got far / out of reach → police give up & go back --- */
    if (this.chased && this.detainedT <= 0) {
      let anyChase = false;
      for (const cop of this.cops) if (cop.mode === "chase" && cop.targetCiv == null) { anyChase = true; break; }
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
      switch (c.mode) {
        case "wander": {
          c.timer -= dt;
          if (c.timer <= 0 || dist2(c.x, c.z, c.tx, c.tz) < 2) {
            // protest marchers stick to the main road strip and keep the line moving
            const t = c.protest
              ? { x: range(this.rnd, -9, 9), z: range(this.rnd, -120, 200) }
              : freeSpot(this.rnd, this.world, 6, CITY_RADIUS - 4);
            c.tx = t.x; c.tz = t.z; c.timer = range(this.rnd, c.protest ? 9 : 6, c.protest ? 18 : 14);
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

    /* --- zombies --- */
    this.groanT -= dt;
    for (const zb of this.zombies) {
      zb.touchCd = Math.max(0, zb.touchCd - dt);
      const d2p = dist2(zb.x, zb.z, p.x, p.z);
      if (night > 0.55) {
        const inGrave = dist2(zb.x, zb.z, GRAVEYARD.x, GRAVEYARD.z) < 55 * 55;
        if (inGrave && d2p < 26 * 26) stepNpc(zb, p.x, p.z, ZOMBIE_NIGHT_SPEED, dt, this.world);
        else {
          zb.vx *= 0.95; zb.vz *= 0.95;
          if (Math.random() < dt * 0.2) { const t = freeSpot(this.rnd, this.world, 4, 34); stepNpc(zb, GRAVEYARD.x + t.x * 0.2, GRAVEYARD.z + t.z * 0.2, ZOMBIE_SPEED * 0.4, dt, this.world); }
        }
        if (d2p < 1.6 * 1.6 && zb.touchCd <= 0 && this.detainedT <= 0) {
          zb.touchCd = ZOMBIE_TOUCH_CD;
          this.hp = Math.max(0, this.hp - ZOMBIE_DMG);
          this.hurtT = HURT_FLASH_S;
          sfx.zombie();
          if (this.hp <= 0) this.dizzyRespawn();
        }
        if (this.groanT <= 0 && d2p < 20 * 20) { this.groanT = range(this.rnd, 2, 6); sfx.zombie(); }
      }
    }

    /* --- animals (a morphed player smells like family — nobody runs away) --- */
    for (const an of this.animals) {
      an.timer -= dt;
      const d2p = dist2(an.x, an.z, p.x, p.z);
      const fleeR = an.kind === "cow" ? 4.5 : 6;
      if (this.morphKind == null && d2p < fleeR * fleeR) {
        an.resting = false; // panic overrides grazing
        const dx = an.x - p.x, dz = an.z - p.z, d = Math.hypot(dx, dz) || 1;
        const fs = an.kind === "cow" ? 2.4 : an.kind === "chicken" ? 4.6 : an.kind === "deer" ? 6.2 : 5;
        stepNpc(an, an.x + (dx / d) * 8, an.z + (dz / d) * 8, fs, dt, this.world);
      } else {
        const arrived = dist2(an.x, an.z, an.tx, an.tz) < 2;
        if (an.timer <= 0 || (arrived && !an.resting)) {
          const farm = an.kind === "cow" || an.kind === "chicken";
          if (!an.resting) {
            // reached the spot (or ran out of time en route) → stop and graze a while
            an.resting = true;
            an.tx = an.x; an.tz = an.z;
            an.timer = range(this.rnd, 2.5, 6.5);
          } else {
            // rest over → amble to a nearby patch of grass
            an.resting = false;
            const spot = this.grazeSpot(an, farm);
            if (spot) { an.tx = spot.x; an.tz = spot.z; }
            an.timer = range(this.rnd, 5, 12);
          }
        }
        if (!an.resting) {
          stepNpc(an, an.tx, an.tz, an.kind === "cow" ? 1.1 : an.kind === "chicken" ? 1.6 : 1.8, dt, this.world);
        }
      }
    }

    // dizzy check (zombies can't be the only source)
    if (this.hp <= 0 && this.detainedT <= 0) this.dizzyRespawn();

    /* --- HUD snapshot --- */
    this.hudT += dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.hud = this.buildHud(); }
  }

  private buildHud(): HudData {
    const p = this.player;
    let prompt = "";
    for (const c of this.civs)
      if (c.mode === "detained" && dist2(p.x, p.z, c.x, c.z) < RESCUE_RADIUS * RESCUE_RADIUS) { prompt = `Press E to rescue ${c.name}!`; break; }
    if (!prompt && this.carriedVotes.length > 0 && dist2(p.x, p.z, BALLOT.x, BALLOT.z) < DELIVER_RADIUS * DELIVER_RADIUS * 1.8) prompt = "Walk closer to the ballot box to deliver!";
    let policeNear = false;
    for (const cop of this.cops) if (cop.mode === "chase" && dist2(cop.x, cop.z, p.x, p.z) < 30 * 30) { policeNear = true; break; }
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
      morphKind: this.morphKind,
      blinkReady: this.blinkCd <= 0,
    };
  }

  getHud(): HudData { return this.hud; }

  /** camera target helpers */
  camTarget(): { x: number; y: number; z: number } {
    const p = this.player;
    return { x: p.x, y: p.y + 1.7, z: p.z };
  }
}

export const WALL_R = WALL_RADIUS;
export const DAY_LEN = DAY_SECONDS;
