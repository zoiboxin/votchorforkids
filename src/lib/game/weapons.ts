/**
 * ⚔️ Shop-forged weapons — real Polyfork GLB steel in the player's fist.
 *
 * The Item Shop sells four WEAPONS (Arming Sword · Hand Axe · Jewelled
 * Dagger · Guard's Spear) plus Mystic Potions. Purchased weapons spawn with
 * the player every run (locker gear), ride the 🎒 wheel, and swing through
 * the normal fight arc — with tuned damage / cooldown / reach per weapon
 * (see TOOLS in constants.ts).
 *
 * The GLB files are tiny (51–75 KB), Y-up, grip at the origin, handle along
 * +Y — the SAME "grip space" convention buildToolMesh() uses, so they attach
 * to the hand bone exactly like the procedural tools. Each weapon gets a
 * calibrated scale + grip offset (measured from the real bounding boxes):
 *
 *   arming-sword   0.95 m blade  → ×1.05, grip at hilt (origin)
 *   hand-axe       0.60 m haft   → ×1.05, grip at origin
 *   jewelled-dagger 0.35 m       → ×1.15 (chunkier so it reads on camera)
 *   spear          2.10 m shaft  → ×1.0, fist grips 0.42 m up the shaft
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ToolKind } from "./constants";

export type WeaponKind = Extract<ToolKind, "armsword" | "handaxe" | "dagger" | "spear">;

interface WeaponAsset {
  url: string;
  scale: number;
  /** the instance sits this far below the fist (spear: hold the shaft mid-way) */
  gripY: number;
}

export const WEAPON_FILES: Record<WeaponKind, WeaponAsset> = {
  armsword: { url: "/models/weapons/arming-sword-401972.glb", scale: 1.05, gripY: 0 },
  handaxe:  { url: "/models/weapons/hand-axe-cee9e7.glb",     scale: 1.05, gripY: 0 },
  dagger:   { url: "/models/weapons/jewelled-dagger-38f556.glb", scale: 1.15, gripY: 0 },
  spear:    { url: "/models/weapons/spear-e9824e.glb",        scale: 1.0,  gripY: -0.42 },
};

export const isWeaponKind = (kind: string): kind is WeaponKind => kind in WEAPON_FILES;

const templates = new Map<WeaponKind, THREE.Group>();
const pending = new Map<WeaponKind, Promise<THREE.Group>>();
let loader: GLTFLoader | null = null;

/** Load one weapon file, normalize its scale & grip, cache the template. */
export function loadWeaponTemplate(kind: WeaponKind): Promise<THREE.Group> {
  const cached = templates.get(kind);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(kind);
  if (inflight) return inflight;
  if (!loader) loader = new GLTFLoader();
  const asset = WEAPON_FILES[kind];
  const p = new Promise<THREE.Group>((resolve, reject) => {
    loader!.load(
      asset.url,
      (gltf) => {
        const g = new THREE.Group();
        g.add(gltf.scene);
        // ⚖️ the files arrive in TRUE meters (measured: sword 0.95, axe 0.60,
        // dagger 0.35, spear 2.10) — only the per-weapon calibration factor
        // applies, never a re-normalization (that would shrink the spear!)
        gltf.scene.scale.setScalar(asset.scale);
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; }
        });
        g.userData.gripY = asset.gripY;
        templates.set(kind, g);
        pending.delete(kind);
        resolve(g);
      },
      undefined,
      (err) => { pending.delete(kind); reject(err); },
    );
  });
  pending.set(kind, p);
  return p;
}

/** True once the file is cached — buildToolMesh takes the sync GLB path. */
export const weaponReady = (kind: WeaponKind): boolean => templates.has(kind);

/** Clone a weapon instance for a hand socket (template cached). */
export function makeWeaponInstance(kind: WeaponKind): THREE.Group | null {
  const tpl = templates.get(kind);
  if (!tpl) return null;
  const inst = tpl.clone(true);
  inst.position.y = (tpl.userData.gripY as number) ?? 0;
  return inst;
}

/** Warm every weapon file at boot — by the time a run starts the steel is cached. */
export function preloadWeaponModels(): void {
  for (const kind of Object.keys(WEAPON_FILES) as WeaponKind[]) void loadWeaponTemplate(kind).catch(() => {});
}

// ⚡ auto-preload on first import (client only) — menu boot streams them in
// the background alongside the character cast
if (typeof window !== "undefined") preloadWeaponModels();
