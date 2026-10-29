import { GRAVEYARD } from "./constants.ts";
import { range } from "./rng.ts";

/** kind: 0 zombie (hostile, graveyard) - 1 deer, 2 boar, 3 monkey (harmless, flee). */
export const ZOMBIE_COUNT = 14, ANIMAL_COUNT = 26;
export interface Creature { id: string; kind: number; x: number; z: number; ry: number; spd: number; dir: number; t: number }
export interface CreatureTarget { id: string; x: number; z: number; safe: boolean }

export function spawnCreatures(rnd: () => number): Creature[] {
  const out: Creature[] = [];
  for (let i = 0; i < ZOMBIE_COUNT; i++) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 5, 32);
    out.push({ id: `z-${i}`, kind: 0, x: GRAVEYARD.x + Math.cos(a) * r, z: GRAVEYARD.z + Math.sin(a) * r, ry: 0, spd: 0, dir: range(rnd, 0, 6.28), t: 0 });
  }
  for (let i = 0; i < ANIMAL_COUNT; i++) {
    const a = range(rnd, 0, Math.PI * 2), r = i < 8 ? range(rnd, 140, 195) : range(rnd, 210, 315);
    out.push({ id: `a-${i}`, kind: 1 + (i % 3), x: Math.cos(a) * r, z: Math.sin(a) * r, ry: 0, spd: 0, dir: range(rnd, 0, 6.28), t: range(rnd, 0, 3) });
  }
  return out;
}

const nearest = (c: Creature, ts: CreatureTarget[], skipSafe: boolean) => {
  let best: CreatureTarget | null = null, bd = Infinity;
  for (const t of ts) { if (skipSafe && t.safe) continue; const d = Math.hypot(t.x - c.x, t.z - c.z); if (d < bd) { bd = d; best = t; } }
  return { t: best, d: bd };
};

/** One AI step. Zombies chase unprotected players (faster at night); animals wander and flee. */
export function stepCreature(c: Creature, dt: number, night: number, targets: CreatureTarget[], rnd: () => number, onTouch: (id: string) => void) {
  if (c.kind === 0) {
    const { t, d } = nearest(c, targets, true);
    if (t && d < 30) {
      const sp = night > 0.5 ? 3.2 : 2;
      c.x += ((t.x - c.x) / d) * sp * dt; c.z += ((t.z - c.z) / d) * sp * dt;
      c.dir = Math.atan2(t.x - c.x, t.z - c.z); c.spd = sp;
      if (d < 1.3) onTouch(t.id);
    } else {
      c.dir += range(rnd, -0.5, 0.5) * dt;
      c.x += Math.sin(c.dir) * dt; c.z += Math.cos(c.dir) * dt; c.spd = 1;
      if (Math.hypot(c.x - GRAVEYARD.x, c.z - GRAVEYARD.z) > 38) c.dir = Math.atan2(GRAVEYARD.x - c.x, GRAVEYARD.z - c.z);
    }
    c.ry = c.dir; return;
  }
  const { t, d } = nearest(c, targets, false);
  let sp = 1.3;
  c.t -= dt;
  if (t && d < 9) { c.dir = Math.atan2(c.x - t.x, c.z - t.z); sp = 5; }
  else if (c.t <= 0) { c.t = range(rnd, 2, 5); c.dir = range(rnd, 0, 6.28); }
  c.x += Math.sin(c.dir) * sp * dt; c.z += Math.cos(c.dir) * sp * dt;
  const r = Math.hypot(c.x, c.z);
  if (r < 135 || r > 318) c.dir = Math.atan2((c.x / r) * 226 - c.x, (c.z / r) * 226 - c.z);
  c.ry = c.dir; c.spd = sp;
}
