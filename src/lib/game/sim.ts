import { AGE_STATS, DAY_SECONDS, GRAVITY, SPRINT_MULT, WALL_RADIUS, type AgeGroup } from "./constants";
import { clamp } from "./rng";
import { resolve, type World } from "./worldgen";

export interface Body { x: number; y: number; z: number; vx: number; vy: number; vz: number; stamina: number; face: number; sprinting: boolean }
export const newBody = (x: number, z: number): Body => ({ x, y: 0, z, vx: 0, vy: 0, vz: 0, stamina: 100, face: 0, sprinting: false });

export interface MoveInput { f: number; r: number; sprint: boolean; jump: boolean }

/**
 * Deterministic movement step. Camera-relative: yaw is the camera heading;
 * forward is (-sin yaw, -cos yaw).
 */
export function stepBody(
  b: Body, inp: MoveInput, dt: number, age: AgeGroup, world: World,
  opts: { yaw: number; speedScale?: number; maxStamina?: number },
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
  const speed = A.speed * (opts.speedScale ?? 1) * (b.sprinting ? SPRINT_MULT : 1);
  b.stamina = clamp(b.stamina + (b.sprinting ? -20 : 12 * A.regen) * dt, 0, maxSt);
  const k = Math.min(1, dt * 10);
  b.vx += (dx * speed - b.vx) * k;
  b.vz += (dz * speed - b.vz) * k;
  if (b.y <= 0 && inp.jump) { b.vy = A.jump; b.y = 0.01; }
  b.vy -= GRAVITY * dt;
  b.y = Math.max(0, b.y + b.vy * dt);
  if (b.y === 0) b.vy = 0;
  b.x += b.vx * dt; b.z += b.vz * dt;
  resolve(b, 0.45, world);
  const rr = Math.hypot(b.x, b.z);
  if (rr > WALL_RADIUS) { b.x *= WALL_RADIUS / rr; b.z *= WALL_RADIUS / rr; }
  if (moving) b.face = Math.atan2(b.vx, b.vz);
}

/** Move a simple ground-hugging NPC toward a point with wall sliding. */
export function stepNpc(
  b: { x: number; z: number; vx: number; vz: number; face: number },
  tx: number, tz: number, speed: number, dt: number, world: World,
): void {
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  const k = Math.min(1, dt * 8);
  b.vx += ((dx / d) * speed - b.vx) * k;
  b.vz += ((dz / d) * speed - b.vz) * k;
  b.x += b.vx * dt; b.z += b.vz * dt;
  resolve(b, 0.4, world);
  b.face = Math.atan2(b.vx, b.vz);
}

/** 0 = day, 1 = deep night, from clock in [0,1) where 0.5 is noon. */
export function nightFactor(clock: number): number {
  if (!Number.isFinite(clock)) return 0;
  return clamp(0.5 - Math.sin(Math.PI * 2 * (clock - 0.25)) * 2.2, 0, 1);
}
export const advanceClock = (clock: number, dt: number) => (clock + dt / DAY_SECONDS) % 1;
