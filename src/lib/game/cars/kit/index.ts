/**
 * 🚗 polyfork Retro Cars Kit — the town's new vehicle fleet.
 *
 * Source: https://github.com/lucas-martinic/polyfork-catalog
 *         kits/racing-cars-kit-660d53.md (8 road vehicles)
 *
 * Every model is a parametric low-poly three.js module: createAsset() returns
 * a ready Group (one merged body mesh + named wheel/steer part groups), real
 * -world scale, +Z = nose (headlights sit at +Z — same forward axis the game's
 * placeCar/physics use, so no rotation fix-up is needed).
 *
 * LICENSE (each module header): personal & commercial use in games OK,
 * no attribution required. We use them as shipped — nothing resold.
 *
 * GAME MAPPING (game vehicle type → kit model):
 *   0 sedan        → boxy-sedan-70s
 *   1 hatchback    → hatchback-80s
 *   2 delivery van → camper-van
 *   3 pickup truck → pickup-truck-70s
 *   4 city bus     → (kept procedural — no bus in the kit)
 *   5 jeep         → (kept procedural — no jeep in the kit)
 *   6 muscle car   → muscle-car-60s   (NEW)
 *   7 convertible  → convertible-60s  (NEW)
 *   8 station wgn  → station-wagon-70s (NEW)
 *   9 sports coupe → wedge-coupe-80s  (NEW)
 */
import { createAsset as buildBoxySedan } from "./boxy-sedan-70s-7d55f7.mjs";
import { createAsset as buildHatchback } from "./hatchback-80s-e95554.mjs";
import { createAsset as buildCamperVan } from "./camper-van-8d10e2.mjs";
import { createAsset as buildPickup } from "./pickup-truck-70s-8c0080.mjs";
import { createAsset as buildMuscle } from "./muscle-car-60s-524d46.mjs";
import { createAsset as buildConvertible } from "./convertible-60s-b76f89.mjs";
import { createAsset as buildWagon } from "./station-wagon-70s-11d67b.mjs";
import { createAsset as buildCoupe } from "./wedge-coupe-80s-9f8b5e.mjs";

export interface KitSpec {
  build: (colorway?: string) => import("three").Group;
  /** the kit's own preset colorways — cycled by the car's paint index */
  colorways: string[];
  /** wheel radius for rolling-spin math (≈ AXLE_Y in each module) */
  wheelR: number;
  /** visual scale to sit inside the game's axle-circle collider footprints */
  scale: number;
}

export const KIT_TYPES: Record<number, KitSpec> = {
  0: { build: buildBoxySedan, colorways: ["navy-tan", "teal-cream", "cherry-tan"], wheelR: 0.335, scale: 1.0 },
  1: { build: buildHatchback, colorways: ["teal-cream", "cherry-cream", "blue-cream"], wheelR: 0.335, scale: 1.0 },
  2: { build: buildCamperVan, colorways: ["meadow-green", "ocean-blue", "brick-red"], wheelR: 0.328, scale: 1.04 },
  3: { build: buildPickup, colorways: ["canyon-cream", "fleet-blue", "orchard-rust"], wheelR: 0.38, scale: 1.0 },
  6: { build: buildMuscle, colorways: ["cream-tan", "cherry-cream", "lagoon-cream"], wheelR: 0.3315, scale: 1.0 },
  7: { build: buildConvertible, colorways: ["blush-cream", "teal-cream", "cherry-cream", "sky-cream"], wheelR: 0.34, scale: 1.0 },
  8: { build: buildWagon, colorways: ["woodie-brown", "harvest-sand", "pine-green", "atlantic-blue"], wheelR: 0.3315, scale: 1.0 },
  9: { build: buildCoupe, colorways: ["aqua-silver", "sunset-graphite", "midnight-pearl", "ember-black"], wheelR: 0.3315, scale: 1.02 },
};

/** Which game vehicle types render as kit models (4 bus + 5 jeep stay procedural). */
export const isKitType = (t: number): boolean => t in KIT_TYPES;

export const kitWheelR = (t: number): number => KIT_TYPES[t]?.wheelR ?? 0.35;

const WHEEL_PARTS = ["wheel-fr", "wheel-fl", "wheel-rr", "wheel-rl"];
const STEER_PARTS = ["steer-fl", "steer-fr"];

export interface KitCarRig {
  obj: import("three").Group;
  wheels: import("three").Object3D[];
  steer: import("three").Object3D[];
}

const templates = new Map<string, import("three").Group>();

/**
 * One fresh car Group for game vehicle type `t` in paint index `c`.
 * Templates are cached per (type, colorway) — clones share geometry + material,
 * so a street full of kit cars stays cheap. Returns null for non-kit types.
 */
export function makeKitCar(t: number, c: number): KitCarRig | null {
  const spec = KIT_TYPES[t];
  if (!spec) return null;
  const cw = spec.colorways[((c % spec.colorways.length) + spec.colorways.length) % spec.colorways.length];
  const key = `${t}:${cw}`;
  let tpl = templates.get(key);
  if (!tpl) {
    tpl = spec.build({ colorway: cw });
    tpl.scale.setScalar(spec.scale);
    templates.set(key, tpl);
  }
  const obj = tpl.clone(true);
  const wheels = WHEEL_PARTS.map((n) => obj.getObjectByName(n)).filter(Boolean) as import("three").Object3D[];
  const steer = STEER_PARTS.map((n) => obj.getObjectByName(n)).filter(Boolean) as import("three").Object3D[];
  return { obj, wheels, steer };
}
