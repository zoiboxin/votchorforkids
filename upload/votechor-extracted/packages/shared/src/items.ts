import { clamp, range } from "./rng.ts";
import { resolve, type World } from "./world.ts";

export interface ItemDef { name: string; hp: number; stamina: number; color: string; msg: string; weight: number }
/** Index in this table is the wire id (`kind`). Effects are applied only by the server. */
export const ITEMS: readonly ItemDef[] = [
  { name: "Chai", hp: 4, stamina: 35, color: "#c88a4a", msg: "Chai break! Energy restored.", weight: 5 },
  { name: "Samosa", hp: 10, stamina: 20, color: "#e0a030", msg: "Samosa acquired. Health improves.", weight: 5 },
  { name: "Jalebi", hp: 6, stamina: 30, color: "#ff8c1a", msg: "Jalebi: sticky, sweet, speedy.", weight: 4 },
  { name: "Coconut water", hp: 8, stamina: 30, color: "#eeeedd", msg: "Coconut water. Hydration achieved.", weight: 4 },
  { name: "First-aid kit", hp: 45, stamina: 0, color: "#e0483a", msg: "First-aid kit! Back in the fight.", weight: 2 },
  { name: "Energy bar", hp: 0, stamina: 60, color: "#4aa8ff", msg: "Energy bar. Sprint responsibly.", weight: 3 },
];
export const ITEM_COUNT = 45;
export const PICKUP_RADIUS = 1.8;
export const ITEM_RESPAWN_S = 25;

export function applyItem(hp: number, stamina: number, kind: number) {
  const d = ITEMS[kind];
  if (!d) return { hp, stamina };
  return { hp: clamp(hp + d.hp, 0, 100), stamina: clamp(stamina + d.stamina, 0, 100) };
}
export function pickItemKind(r: () => number): number {
  const total = ITEMS.reduce((s, i) => s + i.weight, 0);
  let t = r() * total;
  for (let i = 0; i < ITEMS.length; i++) { t -= ITEMS[i].weight; if (t <= 0) return i; }
  return 0;
}
/** Random spot in the city lanes, farmland or jungle that is not inside a building or tree. */
export function randomItemPos(r: () => number, world: World): { x: number; z: number } {
  for (let i = 0; i < 30; i++) {
    let x: number, z: number;
    const t = r();
    if (t < 0.5) {
      const k = Math.round(range(r, -2, 2)) * 60;
      if (r() < 0.5) { x = k + range(r, -6, 6); z = range(r, -120, 120); } else { x = range(r, -120, 120); z = k + range(r, -6, 6); }
    } else {
      const a = range(r, 0, Math.PI * 2), d = t < 0.7 ? range(r, 135, 195) : range(r, 205, 315);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
    }
    const p = { x, z };
    resolve(p, 1, world);
    if (Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01) return p;
  }
  return { x: 0, z: 12 };
}
