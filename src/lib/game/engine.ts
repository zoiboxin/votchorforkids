import {
  AGE_STATS, ANIMAL_SET, BALLOT, CARRY_RADIUS, CIVIL_NAMES, CIVILIAN_COUNT, CITY_RADIUS, DAY_SECONDS,
  DELIVER_RADIUS, DETECT_BASE, DETECT_CARRY_BONUS, DETECT_STAR_BONUS, DETAIN_SECONDS, DROP_SCATTER,
  ESCAPE_LOST_S, FARM_RADIUS, GRAVEYARD, ITEMS, ITEM_COUNT, ITEM_RESPAWN_S, JUNGLE_RADIUS, MAX_CARRY, PICKUP_RADIUS,
  POINTS_DELIVER, POINTS_PICKUP, POINTS_RESCUE, POLICE_COUNT, POLICE_SPEED, POLICE_SPRINT, RESCUE_POINTS,
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
}
export interface Zombie { id: number; x: number; z: number; vx: number; vz: number; face: number; phase: number; touchCd: number }
export interface Animal { id: number; kind: AnimalKind; x: number; z: number; vx: number; vz: number; face: number; tx: number; tz: number; timer: number; phase: number }
export interface ItemEnt { id: number; def: number; x: number; z: number; active: boolean; respawn: number }
export interface VoteEnt { id: number; x: number; z: number; state: "world" | "carried" | "delivered" }

export interface Fx { type: "confetti"; x: number; y: number; z: number; hue: number }

export interface HudData {
  hp: number; stamina: number; stars: number; carried: number; delivered: number; total: number;
  points: number; rescues: number; support: number; zone: Zone; clock: number; night: number;
  detained: boolean; detainLeft: number; prompt: string; policeNear: boolean;
  civilians: number; police: number; won: boolean; elapsed: number;
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
  clock = 0.3;
  stars = 0; starTimer = 0;
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
      this.cops.push({ id: this.nid(), kind: "police", x: p.x, z: p.z, vx: 0, vz: 0, face: 0, mode: "patrol", tx: p.x, tz: p.z, timer: 0, phase: Math.random() * 6, name: "Police", speed: POLICE_SPEED * 0.6, alertT: 0 });
    }
    // civilians
    for (let i = 0; i < CIVILIAN_COUNT; i++) {
      const p = freeSpot(r, this.world, 8, CITY_RADIUS - 8);
      this.civs.push({ id: this.nid(), kind: "civilian", x: p.x, z: p.z, vx: 0, vz: 0, face: 0, mode: "wander", tx: p.x, tz: p.z, timer: range(r, 0, 4), phase: Math.random() * 6, name: CIVIL_NAMES[i % CIVIL_NAMES.length], speed: range(r, 2.2, 3.4), alertT: 0 });
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
        this.animals.push({ id: this.nid(), kind: set.kind, x: p.x, z: p.z, vx: 0, vz: 0, face: 0, tx: p.x, tz: p.z, timer: range(r, 0, 5), phase: Math.random() * 6 });
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
    this.hp = 100; this.stamina = 100; this.stars = 0; this.starTimer = 0;
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
    this.detainedT = DETAIN_SECONDS;
    this.invulnT = 6; // grace window after release so cops can't instantly re-catch
    cop.mode = "celebrate"; cop.timer = 2.5;
    sfx.caught();
    this.toast(carried > 0
      ? `Caught! The police took back ${carried} vote${carried > 1 ? "s" : ""}… ⭐ Wanted level up!`
      : "Caught for suspicious giggling! Sit in the time-out corner…", "bad");
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
    this.detainedT = 4;
    this.invulnT = 3;
    this.dropVotes(SPAWN.x + 2, SPAWN.z + 2);
    this.toast("Whoa, everything is spinning… a kind chaiwala helped you.", "bad");
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
    if (this.detainedT > 0) {
      this.detainedT -= dt;
      p.vx = p.vz = 0;
    } else {
      this.invulnT = Math.max(0, this.invulnT - dt);
      const prevY = p.y;
      stepBody(p, { f: this.input.f, r: this.input.r, sprint: this.input.sprint, jump: this.input.jump }, dt, this.look.age, this.world, { yaw: this.input.yaw });
      if (prevY <= 0 && p.y > 0) sfx.jump();
      if (prevY > 0 && p.y === 0) sfx.land();
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

    /* --- items --- */
    for (const it of this.items) {
      if (!it.active) {
        it.respawn -= dt;
        if (it.respawn <= 0) it.active = true;
        continue;
      }
      if (dist2(p.x, p.z, it.x, it.z) < PICKUP_RADIUS * PICKUP_RADIUS) {
        const d = ITEMS[it.def];
        this.hp = clamp(this.hp + d.hp, 0, 100);
        this.stamina = clamp(this.stamina + d.stamina, 0, 100);
        it.active = false; it.respawn = ITEM_RESPAWN_S;
        if (d.kind === "fruit") sfx.eat(); else sfx.pickup();
        this.toast(`${d.name}: ${d.msg}`, "good");
      }
    }

    /* --- police --- */
    const carrying = this.carriedVotes.length;
    const detect = DETECT_BASE + carrying * DETECT_CARRY_BONUS + this.stars * DETECT_STAR_BONUS;
    for (const cop of this.cops) {
      cop.phase += dt;
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
            sfx.alert();
            this.toast("🚨 Police spotted you! RUN!", "bad");
          }
          break;
        }
        case "chase": {
          const spd = POLICE_SPRINT + this.stars * 0.22;
          stepNpc(cop, p.x, p.z, spd, dt, this.world);
          cop.alertT = d2p < detect * detect * 3 ? ESCAPE_LOST_S : cop.alertT - dt;
          if (d2p < 1.9 * 1.9 && this.detainedT <= 0 && this.invulnT <= 0) { this.catchPlayer(cop); }
          else if (cop.alertT <= 0) { cop.mode = "return"; cop.timer = 0; if (this.stars > 0) this.toast("You lost them! Phew…", "info"); }
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
            cop.mode = "chase"; cop.alertT = ESCAPE_LOST_S; sfx.alert();
          }
          break;
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
            const t = freeSpot(this.rnd, this.world, 6, CITY_RADIUS - 4);
            c.tx = t.x; c.tz = t.z; c.timer = range(this.rnd, 6, 14);
          }
          stepNpc(c, c.tx, c.tz, c.speed, dt, this.world);
          // random arrest event (only near player so it's participatory)
          if (Math.random() < dt * 0.02 && dist2(c.x, c.z, p.x, p.z) < 70 * 70) {
            c.mode = "detained"; c.timer = 35;
            this.toast(`${c.name} got caught by the police! Press E near them to rescue.`, "bad");
          }
          break;
        }
        case "detained":
          c.timer -= dt;
          if (c.timer <= 0) { c.mode = "wander"; c.timer = 0; }
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
        const dx = an.x - p.x, dz = an.z - p.z, d = Math.hypot(dx, dz) || 1;
        const fs = an.kind === "cow" ? 2.4 : an.kind === "chicken" ? 4.6 : an.kind === "deer" ? 6.2 : 5;
        stepNpc(an, an.x + (dx / d) * 8, an.z + (dz / d) * 8, fs, dt, this.world);
      } else {
        if (an.timer <= 0 || dist2(an.x, an.z, an.tx, an.tz) < 2) {
          const farm = an.kind === "cow" || an.kind === "chicken";
          const base = farm ? CITY_RADIUS + 10 : FARM_RADIUS + 10;
          const t = freeSpot(this.rnd, this.world, base, farm ? FARM_RADIUS - 8 : JUNGLE_RADIUS - 30);
          an.tx = t.x; an.tz = t.z; an.timer = range(this.rnd, 4, 12);
        }
        stepNpc(an, an.tx, an.tz, an.kind === "cow" ? 1.1 : an.kind === "chicken" ? 1.6 : 1.8, dt, this.world);
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
