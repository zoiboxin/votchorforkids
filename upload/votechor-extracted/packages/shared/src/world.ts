import { CITY_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, WORLD_SEED } from "./constants.ts";
import { mulberry32, range } from "./rng.ts";

export interface BoxCollider { x: number; z: number; w: number; d: number } // half extents
export interface CircleCollider { x: number; z: number; r: number }
export interface Building extends BoxCollider { h: number; color: number }
export interface Tree extends CircleCollider { s: number }
export interface World {
  buildings: Building[];
  trees: Tree[];
  boxes: BoxCollider[];
  circles: CircleCollider[];
}
const PALETTE = [0xe9c46a, 0xf4a261, 0xe76f51, 0x2a9d8f, 0x8ecae6, 0xf7b2bd, 0xcdb4db];

export function generateWorld(seed = WORLD_SEED): World {
  const rnd = mulberry32(seed);
  const buildings: Building[] = [];
  for (let i = -2; i < 2; i++)
    for (let j = -1; j < 2; j++)
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const w = range(rnd, 14, 19) / 2, d = range(rnd, 14, 19) / 2, h = range(rnd, 10, 46);
          buildings.push({ x: i * 60 + 30 + a * 11, z: j * 60 + 30 + b * 11, w, d, h, color: PALETTE[buildings.length % PALETTE.length] });
        }
  const boxes: BoxCollider[] = buildings.map(({ x, z, w, d }) => ({ x, z, w, d }));
  boxes.push({ x: 0, z: -116, w: 35, d: 5 }); // Parliament
  const trees: Tree[] = [];
  while (trees.length < 650) {
    const a = range(rnd, 0, Math.PI * 2);
    const r = trees.length < 580 ? range(rnd, 205, 325) : range(rnd, 135, 195);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < 48) continue;
    const s = range(rnd, 0.8, 1.5);
    trees.push({ x, z, r: 0.7 * s, s });
  }
  return { buildings, trees, boxes, circles: trees };
}

export type Zone = "City" | "Farmland" | "Jungle" | "Graveyard" | "Mountain Wall";
export function zoneOf(x: number, z: number): Zone {
  if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < 45) return "Graveyard";
  const r = Math.hypot(x, z);
  return r < CITY_RADIUS ? "City" : r < FARM_RADIUS ? "Farmland" : r < JUNGLE_RADIUS - 10 ? "Jungle" : "Mountain Wall";
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
    if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
    const rr = c.r + radius, d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.01;
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
}
