import { CITY_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, WORLD_SEED } from "./constants";
import { mulberry32, range } from "./rng";

export interface BoxCollider { x: number; z: number; w: number; d: number } // half extents
export interface CircleCollider { x: number; z: number; r: number }
export interface Building extends BoxCollider { h: number; color: number; roof: number }
export interface Tree { x: number; z: number; r: number; s: number; kind: 0 | 1 }
export interface Flower { x: number; z: number; c: number; s: number }
export interface World {
  buildings: Building[];
  trees: Tree[];
  flowers: Flower[];
  boxes: BoxCollider[];
  circles: CircleCollider[];
}

const PALETTE = [0xe9c46a, 0xf4a261, 0xe76f51, 0x2a9d8f, 0x8ecae6, 0xf7b2bd, 0xcdb4db, 0xffb4a2];
const ROOFS = [0xd62828, 0x457b9d, 0x8a5a44, 0x588157];

export function generateWorld(seed = WORLD_SEED): World {
  const rnd = mulberry32(seed);
  const buildings: Building[] = [];
  for (let i = -2; i < 2; i++)
    for (let j = -1; j < 2; j++)
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const w = range(rnd, 13, 18) / 2, d = range(rnd, 13, 18) / 2, h = range(rnd, 9, 40);
          buildings.push({
            x: i * 60 + 30 + a * 11, z: j * 60 + 30 + b * 11, w, d, h,
            color: PALETTE[buildings.length % PALETTE.length],
            roof: ROOFS[buildings.length % ROOFS.length],
          });
        }
  const boxes: BoxCollider[] = buildings.map(({ x, z, w, d }) => ({ x, z, w, d }));
  boxes.push({ x: 0, z: -116, w: 35, d: 5 }); // Parliament

  const trees: Tree[] = [];
  while (trees.length < 560) {
    const a = range(rnd, 0, Math.PI * 2);
    const r = trees.length < 500 ? range(rnd, 205, 320) : range(rnd, 135, 195);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < 48) continue;
    const s = range(rnd, 0.8, 1.5);
    trees.push({ x, z, r: 0.7 * s, s, kind: rnd() < 0.75 ? 0 : 1 });
  }

  // Flowers & little bushes scattered in farmland + city lawns (no colliders).
  const flowers: Flower[] = [];
  for (let i = 0; i < 240; i++) {
    const a = range(rnd, 0, Math.PI * 2), d = range(rnd, CITY_RADIUS + 4, FARM_RADIUS - 6);
    flowers.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, c: range(rnd, 0, 1), s: range(rnd, 0.5, 1) });
  }

  return { buildings, trees, flowers, boxes, circles: trees.map(({ x, z, r }) => ({ x, z, r })) };
}

/** Push a point out of every collider it overlaps. */
export function resolve(p: { x: number; z: number }, radius: number, world: World): void {
  for (const b of world.boxes) {
    const dx = p.x - b.x, dz = p.z - b.z;
    const ox = b.w + radius - Math.abs(dx), oz = b.d + radius - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1);
      else p.z += oz * (dz < 0 ? -1 : 1);
    }
  }
  for (const c of world.circles) {
    const dx = p.x - c.x, dz = p.z - c.z;
    if (Math.abs(dx) > 3.2 || Math.abs(dz) > 3.2) continue;
    const rr = c.r + radius, d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.01;
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
}

/** True if the segment between two points is roughly clear of buildings (cheap LOS). */
export function lineClear(ax: number, az: number, bx: number, bz: number, world: World): boolean {
  const steps = Math.min(24, Math.max(4, Math.floor(Math.hypot(bx - ax, bz - az) / 2)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    for (const b of world.boxes)
      if (Math.abs(x - b.x) < b.w + 0.4 && Math.abs(z - b.z) < b.d + 0.4) return false;
  }
  return true;
}

/** Find a random free spot in a ring/disk, nudged out of colliders. */
export function freeSpot(
  r: () => number, world: World,
  inner: number, outer: number,
  avoid: { x: number; z: number; r: number }[] = [],
): { x: number; z: number } {
  for (let i = 0; i < 40; i++) {
    const a = range(r, 0, Math.PI * 2), d = range(r, inner, outer);
    let x = Math.cos(a) * d, z = Math.sin(a) * d;
    const before = { x, z };
    resolve(before, 0.9, world);
    if (Math.abs(before.x - x) > 0.05 || Math.abs(before.z - z) > 0.05) continue;
    x = before.x; z = before.z;
    let ok = true;
    for (const av of avoid) if (Math.hypot(x - av.x, z - av.z) < av.r) { ok = false; break; }
    if (ok) return { x, z };
  }
  return { x: 0, z: 12 };
}
