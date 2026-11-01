import {
  AGE_STATS, ANIMAL_SET, BALLOT, CARRY_RADIUS, CIV_COP_CD, CIV_DETECT, CIV_DETAIN_S, CIV_FLEE_MULT,
  CIVIL_NAMES, CIVILIAN_COUNT, CITY_RADIUS, DAY_SECONDS,
  DELIVER_RADIUS, DETECT_BASE, DETECT_CARRY_BONUS, DETECT_STAR_BONUS, DETAIN_SECONDS, DROP_SCATTER,
  ESCAPE_LOST_S, FARM_RADIUS, FLIP_S, GRAVEYARD, HURT_FLASH_S, ITEMS, INV_SLOTS, INV_STACK, ITEM_COUNT,
  ITEM_RESPAWN_S, JUMP_COST, JUMP2_COST, JUNGLE_RADIUS, LAND_SQUASH_S, MAX_CARRY, MAX_CIV_HELD, PICKUP_RADIUS,
  POINTS_DELIVER, POINTS_PICKUP, POINTS_RESCUE, POLICE_COUNT, POLICE_SPEED, POLICE_SPRINT, RELEASE_GRACE_S, RESCUE_POINTS,
  RESCUE_RADIUS, SPAWN, STAR_DECAY_S, TOTAL_VOTES, WALL_RADIUS, ZOMBIE_COUNT, ZOMBIE_DMG, ZOMBIE_NIGHT_SPEED,
  ZOMBIE_SPEED, ZOMBIE_TOUCH_CD, type AnimalKind, type Appearance, type Zone, zoneOf, ZONE_TOAST,
} from "./constants";
import { clamp, mulberry32, range } from "./rng";
import { freeSpot, lineClear, resolve, type World } from "./worldgen";
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
}
export interface Zombie { id: number; x: number; z: number; vx: number; vz: number; face: number; phase: number; touchCd: number }
export interface Animal { id: number; kind: AnimalKind; x: number; z: number; vx: number; vz: number; face: number; tx: number; tz: number; timer: number; phase: number; resting: boolean }
export interface ItemEnt { id: number; def: number; x: number; z: number; active: boolean; respawn: number }
export interface VoteEnt { id: number; x: number; z: number; state: "world" | "carried" | "delivered" }

export interface Fx { type: "confetti"; x: number; y: number; z: number; hue: number }

export interface HudData {
  hp: number; stamina: number; stars: number; carried: number; delivered: number; total: number;
  points: number; rescues: number; support: number; zone: Zone; clock: number; night: number;
  detained: boolean; detainLeft: number; prompt: string; policeNear: boolean;
  civilians: number; police: number; won: boolean; elapsed: number;
  inv: { def: number; count: number }[]; hurt: boolean; sprinting: boolean; exhausted: boolean;
  px: number; pz: number; // player world coords — bottom-center location chip
  /** bump timestamp + amounts of the last eaten item — HUD plays a floating +❤/+⚡ chip */
  gain: { hp: number; stamina: number; at: number };
}

export type ToastFn = (msg: string, kind?: "info" | "good" | "bad") => void;

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

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
  fxQueue: Fx[] = [];

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

  /** Random free city spot for the post-detention respawn — comfortably away from every cop. */
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

  /** Civilians currently in detention — capped so police arrests never empty the city. */
  private heldCivs(): number {
    let n = 0;
    for (const c of this.civs) if (c.mode === "detained") n++;
    return n;
  }

  private spawnAll() {
    const r = this.rnd;
    // votes
    const bands: [number, number][] = [[16, 120], [150, 215], [235, 335]];
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
      const p = freeSpot(r, this.world, 10, 340);
      this.items.push({ id: this.nid(), def: Math.floor(r() * ITEMS.length), x: p.x, z: p.z, active: true, respawn: 0 });
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
    this.flipT = 0; this.squashT = 0;
    this.carriedVotes = []; this.delivered = 0; this.points = 0; this.rescues = 0; this.caughtCount = 0;
    this.detainedT = 0; this.invulnT = 8; this.elapsed = 0; this.won = false; this.clock = 0.3;
    for (const v of this.votes) { v.state = "world"; const p = freeSpot(this.rnd, this.world, 16, 330); v.x = p.x; v.z = p.z; }
    for (const it of this.items) { it.active = true; it.respawn = 0; }
    for (const c of this.civs) c.mode = "wander";
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
    const carried = this.carriedVotes.length;
    this.dropVotes(this.player.x, this.player.z);
    this.caughtCount++;
    this.stars = Math.min(5, this.stars + 1);
    this.starTimer = STAR_DECAY_S;
    this.hp = Math.max(1, this.hp - 8);
    this.hurtT = HURT_FLASH_S;
    this.detainedT = DETAIN_SECONDS;
    this.invulnT = RELEASE_GRACE_S; // long grace after release — time to run the other way
    // the catcher celebrates, then walks ALL the way back — far away from the player
    cop.mode = "celebrate"; cop.timer = 2.5;
    const spot = this.spotAwayFromPlayer(70);
    cop.tx = spot.x; cop.tz = spot.z;
    sfx.caught();
    this.toast(carried > 0
      ? `Caught! The police took back ${carried} vote${carried > 1 ? "s" : ""}… ⭐ Wanted up! Sit out ${DETAIN_SECONDS}s, then respawn in the city.`
      : `Caught for suspicious giggling! Sit out ${DETAIN_SECONDS}s — then respawn somewhere new in the city.`, "bad");
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
    this.player.x = SPAWN.x; this.player.z = SPAWN.z; this.player.y = 0;
    this.player.vx = this.player.vz = 0;
    this.hp = 60;
    this.hurtT = HURT_FLASH_S;
    this.detainedT = 4;
    this.invulnT = 3;
    this.dropVotes(SPAWN.x + 2, SPAWN.z + 2);
    this.toast("Whoa, everything is spinning… a kind chaiwala helped you.", "bad");
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

  /** Pick a nearby free patch of grass for an animal to wander to (local hops, not cross-map treks). */
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
    if (this.detainedT > 0) {
      this.detainedT -= dt;
      p.vx = p.vz = 0;
      if (this.detainedT <= 0) {
        // time served — respawn at a random city spot far from every cop, badge cleared
        const spot = this.cityRespawnSpot();
        this.player.x = spot.x; this.player.z = spot.z;
        this.player.y = 0; this.player.vx = 0; this.player.vz = 0;
        // re-aim every walking-home cop away from the fresh respawn
        for (const cop of this.cops) {
          if (cop.mode !== "return") continue;
          const far = this.spotAwayFromPlayer(60);
          cop.tx = far.x; cop.tz = far.z;
        }
        this.clearWanted("⏰ Time served! You respawned at a new city spot — the police are far away. Play on!");
      }
    } else {
      this.invulnT = Math.max(0, this.invulnT - dt);
      const prevY = p.y;
      const prevJumps = p.jumps;
      p.stamina = this.stamina; // engine stamina is the single source of truth
      stepBody(p, { f: this.input.f, r: this.input.r, sprint: this.input.sprint, jump: this.input.jump }, dt, this.look.age, this.world, { yaw: this.input.yaw });
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

    // wanted star decay
    if (this.stars > 0) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) { this.stars--; this.starTimer = STAR_DECAY_S; if (this.stars === 0) this.toast("Wanted level cleared. Nice and sneaky!", "info"); }
    }

    /* --- votes --- */
    if (this.carriedVotes.length < MAX_CARRY && !this.won) {
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

    /* --- items: walk over food to pocket it, use it later from the HUD --- */
    for (const it of this.items) {
      if (!it.active) {
        it.respawn -= dt;
        if (it.respawn <= 0) it.active = true;
        continue;
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
          if (this.invulnT <= 0 && this.detainedT <= 0 && d2p < detect * detect && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
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
          const spd = POLICE_SPRINT + this.stars * 0.22;
          stepNpc(cop, p.x, p.z, spd, dt, this.world);
          cop.alertT = d2p < detect * detect * 3 ? ESCAPE_LOST_S : cop.alertT - dt;
          if (d2p < 1.9 * 1.9 && this.detainedT <= 0 && this.invulnT <= 0) { this.catchPlayer(cop); }
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
          if (this.invulnT <= 0 && this.detainedT <= 0 && d2p < detect * 0.8 * (detect * 0.8) && lineClear(cop.x, cop.z, p.x, p.z, this.world)) {
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

    /* --- animals --- */
    for (const an of this.animals) {
      an.timer -= dt;
      const d2p = dist2(an.x, an.z, p.x, p.z);
      const fleeR = an.kind === "cow" ? 4.5 : 6;
      if (d2p < fleeR * fleeR) {
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
      prompt, policeNear,
      civilians: this.civs.length, police: this.cops.length,
      won: this.won, elapsed: this.elapsed,
      inv: this.inv.map((s) => ({ def: s.def, count: s.count })),
      hurt: this.hurtT > 0, sprinting: p.sprinting, exhausted: this.stamina <= 0.5,
      px: Math.round(this.player.x), pz: Math.round(this.player.z),
      gain: this.lastGain,
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
