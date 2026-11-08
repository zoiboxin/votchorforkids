import { AGE_STATS, COYOTE_S, DAY_SECONDS, DOUBLE_JUMP_VY, GRAVITY, MOUNTAIN_INNER, MOUNTAIN_OUTER, SPRINT_MULT, WALL_RADIUS, type AgeGroup } from "./constants";
import { clamp } from "./rng";
import { resolve, terrainHeight, type World } from "./worldgen";

export interface Body {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  stamina: number; face: number; sprinting: boolean;
  jumps: number;      // 0 grounded · 1 after ground/coyote jump · 2 after double jump
  jumpLatch: boolean; // one press = one jump (prevents hold-to-double-jump)
  airT: number;       // seconds since last grounded (coyote-time window)
}
export const newBody = (x: number, z: number): Body => ({ x, y: 0, z, vx: 0, vy: 0, vz: 0, stamina: 100, face: 0, sprinting: false, jumps: 0, jumpLatch: false, airT: 0 });

export interface MoveInput { f: number; r: number; sprint: boolean; jump: boolean }

/**
 * Deterministic movement step. Camera-relative: yaw is the camera heading;
 * forward is (-sin yaw, -cos yaw).
 *
 * Jump feel: coyote time lets you jump just after walking off an edge, and the
 * latch means each press fires exactly one jump — tap Space again mid-air for
 * the double-jump flip.
 */
export function stepBody(
  b: Body, inp: MoveInput, dt: number, age: AgeGroup, world: World,
  opts: { yaw: number; speedScale?: number; jumpScale?: number; maxStamina?: number;
          sprintMult?: number; regenMult?: number; drainMult?: number },
): void {
  const A = AGE_STATS[age];
  const f = clamp(inp.f, -1, 1), r = clamp(inp.r, -1, 1);
  let dx = -Math.sin(opts.yaw) * f + Math.cos(opts.yaw) * r;
  let dz = -Math.cos(opts.yaw) * f - Math.sin(opts.yaw) * r;
  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  const moving = len > 0.01;
  const maxSt = opts.maxStamina ?? 100;
  b.sprinting = inp.sprint && moving && b.stamina > 2;
  // 🎖️ police squad perks ride along here: SWAT sprint boost, city-beat fitness,
  // army march endurance — all default to 1 for protesters & unpicked squads
  // ⛰️ rough ground slows the climb — the steeper the slope, the harder the hike
  // (gradient sampled ±0.8u; on the flat it's 1, a 45° scree slope ≈ 0.5, cliffs floor at 0.38)
  let climb = 1;
  // ⛰️ RADIAL band check (was an axis box — a body at (430,430) sits at r≈608,
  // inside the visual mountain band, yet x/z both stayed under 598 so the old
  // check skipped the ground sample and the survivor waded INSIDE the mud-valley
  // mesh instead of walking on top of it)
  if (Math.hypot(b.x, b.z) > MOUNTAIN_INNER - 12) {
    const hx = terrainHeight(b.x + 0.8, b.z) - terrainHeight(b.x - 0.8, b.z);
    const hz = terrainHeight(b.x, b.z + 0.8) - terrainHeight(b.x, b.z - 0.8);
    const slope = Math.hypot(hx, hz) / 1.6;
    climb = clamp(1 - slope * 0.62, 0.38, 1);
  }
  const speed = A.speed * (opts.speedScale ?? 1) * (b.sprinting ? SPRINT_MULT * (opts.sprintMult ?? 1) : 1) * climb;
  b.stamina = clamp(
    b.stamina + (b.sprinting ? -20 * (opts.drainMult ?? 1) : 12 * A.regen * (opts.regenMult ?? 1)) * dt,
    0, maxSt,
  );
  // slightly floatier steering while airborne — momentum keeps you committed
  const k = Math.min(1, dt * (b.y > 0.05 ? 6.5 : 10));
  b.vx += (dx * speed - b.vx) * k;
  b.vz += (dz * speed - b.vz) * k;

  // ---- jump / double jump (edge-detected via latch) ----
  // ⛰️ "ground" is the terrain height in the mountain band — hills are jumpable,
  // and walking up a slope pops you onto it like a ramp
  const ground = terrainHeight(b.x, b.z);
  if (inp.jump && !b.jumpLatch) {
    const js = opts.jumpScale ?? 1;
    b.jumpLatch = true;
    if (b.y <= ground + 0.02 || b.airT < COYOTE_S) {
      b.vy = A.jump * js;                  // ground (or coyote) jump
      if (b.y <= ground) b.y = ground + 0.01;
      b.jumps = 1;
    } else if (b.jumps < 2) {
      b.vy = A.jump * DOUBLE_JUMP_VY * js; // mid-air double jump — a touch weaker
      b.jumps = 2;
    }
  }
  if (!inp.jump) b.jumpLatch = false;

  b.vy -= GRAVITY * dt;
  b.y += b.vy * dt;
  if (b.y <= ground) {
    b.y = ground;      // landed (or the hill rose to meet us)
    b.vy = 0;
    b.jumps = 0;
    b.airT = 0;
  } else {
    b.airT += dt;
  }
  b.x += b.vx * dt; b.z += b.vz * dt;
  resolve(b, 0.45, world);
  const rr = Math.hypot(b.x, b.z);
  if (rr > WALL_RADIUS) { b.x *= WALL_RADIUS / rr; b.z *= WALL_RADIUS / rr; }
  if (moving) b.face = Math.atan2(b.vx, b.vz);
}

/* ---------------- 🧱 anti-stuck steering brain ----------------
 * Every stepNpc body carries this little memory (optional props — any entity
 * passes as-is). stepNpc writes it: a whisker probe keeps bots sliding along
 * walls/cars BEFORE they touch them, a displacement watchdog catches whatever
 * grinding is left and orders a sidestep detour, and `blockT` tells callers
 * "this goal is unreachable — pick another one". */
export interface SteerMemory {
  chkT?: number; chkX?: number; chkZ?: number;     // periodic displacement probe
  sideT?: number; sideDx?: number; sideDz?: number; // active sidestep detour heading
  sideS?: number;                                   // persistent detour side (+1/-1)
  sideN?: number;                                   // detours in a row without progress
  blockT?: number;                                  // seconds spent grinding (callers read this)
}

/** How much a wall/car eats a hop of `len` units from (x,z) toward (dx,dz):
 *  0 = clear road, ~1 = solid obstacle right there. One cheap grid resolve. */
function whisker(x: number, z: number, dx: number, dz: number, len: number, world: World): number {
  const probe = { x: x + dx * len, z: z + dz * len };
  const ox = probe.x, oz = probe.z;
  resolve(probe, 0.45, world);
  return Math.hypot(probe.x - ox, probe.z - oz) / len;
}

/** Move a simple ground-hugging NPC toward a point with wall sliding.
 *
 *  🧱 game-ai anti-stuck pass: bots used to grind into walls/cars whenever the
 *  straight line was blocked (targets behind buildings, goodies in yards, cars
 *  parked across the street). Now the body feels ahead with a whisker probe and
 *  banks toward the freer tangent before touching anything, and a watchdog
 *  turns any remaining grind into a sidestep detour around the obstacle. */
export function stepNpc(
  b: { x: number; z: number; vx: number; vz: number; face: number } & SteerMemory,
  tx: number, tz: number, speed: number, dt: number, world: World,
): void {
  const rdx = tx - b.x, rdz = tz - b.z, rd = Math.hypot(rdx, rdz);
  if (rd < 0.05) { // at the goal — decay the grinding clock so the next trip starts clean
    b.blockT = Math.max(0, (b.blockT ?? 0) - dt * 2);
    return;
  }
  let dx = rdx / rd, dz = rdz / rd;
  const want = speed;

  if ((b.sideT ?? 0) > 0) {
    // 🧱 sidestep detour in progress — slide along the obstacle first
    b.sideT = (b.sideT ?? 0) - dt;
    dx = b.sideDx ?? dx; dz = b.sideDz ?? dz;
  } else {
    // 🧱 whisker lookahead — is something eating the road straight ahead? Bias
    // toward the freer tangent NOW: real sliding around buildings & cars.
    const ahead = whisker(b.x, b.z, dx, dz, 1.7, world);
    if (ahead > 0.25) {
      const rot = (s: number) => {
        const c = Math.cos(s), sn = Math.sin(s);
        return { x: dx * c - dz * sn, z: dx * sn + dz * c };
      };
      const L = rot(-0.96), R = rot(0.96); // ±55°
      const eatL = whisker(b.x, b.z, L.x, L.z, 1.5, world);
      const eatR = whisker(b.x, b.z, R.x, R.z, 1.5, world);
      // score = clearance + bonus for keeping progress toward the goal
      const scoreL = (1 - eatL) + 0.45 * Math.max(0, L.x * dx + L.z * dz);
      const scoreR = (1 - eatR) + 0.45 * Math.max(0, R.x * dx + R.z * dz);
      const straight = (1 - ahead) + 0.45; // what grinding straight would score
      if (Math.max(scoreL, scoreR) > straight + 0.12) {
        if (scoreL >= scoreR) { dx = L.x; dz = L.z; } else { dx = R.x; dz = R.z; }
      }
    }
  }

  const k = Math.min(1, dt * 8);
  b.vx += (dx * want - b.vx) * k;
  b.vz += (dz * want - b.vz) * k;
  b.x += b.vx * dt; b.z += b.vz * dt;
  resolve(b, 0.4, world);
  b.face = Math.atan2(b.vx, b.vz);

  // 🧱 watchdog: every 0.45s compare actual displacement vs intent — grinding
  // means the whisker wasn't enough (corner pocket, crowd, car door) → sidestep
  b.chkT = (b.chkT ?? 0) - dt;
  if ((b.chkT ?? 0) <= 0) {
    const moved = Math.hypot(b.x - (b.chkX ?? b.x), b.z - (b.chkZ ?? b.z));
    if (moved < Math.max(0.22, want * 0.2)) {
      b.blockT = (b.blockT ?? 0) + 0.45;
      b.sideN = (b.sideN ?? 0) + 1;
      if ((b.sideN ?? 0) % 3 === 0) b.sideS = -(b.sideS ?? (Math.random() < 0.5 ? 1 : -1)); // dead end? try the other side
      const s = b.sideS ?? 1;
      b.sideDx = dz * s; b.sideDz = -dx * s; // perpendicular to the intended heading
      b.sideT = 0.55 + Math.min(0.5, (b.sideN ?? 0) * 0.12);
    } else {
      b.blockT = Math.max(0, (b.blockT ?? 0) - 0.9);
      if ((b.sideN ?? 0) > 0) b.sideN = (b.sideN ?? 0) - 1;
    }
    b.chkT = 0.45; b.chkX = b.x; b.chkZ = b.z;
  }
}

/** 0 = day, 1 = deep night, from clock in [0,1) where 0.5 is noon. */
export function nightFactor(clock: number): number {
  if (!Number.isFinite(clock)) return 0;
  return clamp(0.5 - Math.sin(Math.PI * 2 * (clock - 0.25)) * 2.2, 0, 1);
}
export const advanceClock = (clock: number, dt: number) => (clock + dt / DAY_SECONDS) % 1;
