import { AGE_STATS, GRAVITY, SPRINT_MULT, WALL_RADIUS, type AgeGroup, DAY_SECONDS } from "./constants.ts";
import { clamp } from "./rng.ts";
import { resolve, type World } from "./world.ts";
import type { PlayerInput } from "./protocol.ts";

export interface Body { x: number; y: number; z: number; vx: number; vy: number; vz: number; stamina: number; face: number; sprinting: boolean }
export const newBody = (x: number, z: number): Body => ({ x, y: 0, z, vx: 0, vy: 0, vz: 0, stamina: 100, face: 0, sprinting: false });

/**
 * Deterministic movement step shared by the server (authority) and the client (prediction).
 * Camera-relative input: forward is (-sin yaw, -cos yaw).
 */
export function stepBody(b: Body, inp: PlayerInput, dt: number, age: AgeGroup, world: World): void {
  const A = AGE_STATS[age];
  const f = clamp(inp.f, -1, 1), r = clamp(inp.r, -1, 1);
  let dx = -Math.sin(inp.yaw) * f + Math.cos(inp.yaw) * r;
  let dz = -Math.cos(inp.yaw) * f - Math.sin(inp.yaw) * r;
  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  const moving = len > 0.01;
  b.sprinting = inp.sprint && moving && b.stamina > 2;
  const speed = A.speed * (b.sprinting ? SPRINT_MULT : 1);
  b.stamina = clamp(b.stamina + (b.sprinting ? -22 : 12 * A.regen) * dt, 0, 100);
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

/** 0 = day, 1 = deep night, from clock in [0,1) where 0.5 is noon. */
export function nightFactor(clock: number): number {
  if (!Number.isFinite(clock)) return 0;
  return clamp(0.5 - Math.sin(Math.PI * 2 * (clock - 0.25)) * 2.2, 0, 1);
}
export const advanceClock = (clock: number, dt: number) => (clock + dt / DAY_SECONDS) % 1;
