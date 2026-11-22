/**
 * 🚓 Polyfork GLB vehicles — the police cruiser & the yellow cab.
 *
 * Static prop models from the polyfork catalog (https://polyfork.dev,
 * CC BY 4.0 — see public/models/CREDITS.md), served locally like the wildlife:
 *   public/models/police-cruiser-a2d25e.glb  — 4.81u long, roof light bar
 *   public/models/yellow-cab-8df4a0.glb      — 4.62u long, roof TAXI sign
 *
 * Both ship at real-world scale with +Z = nose (same forward axis the game's
 * placeCar/kit fleet uses — no rotation fix-up). Loading normalizes only the
 * ground contact (min.y → 0) and centers x/z; clones are cached per instance
 * and the four wheel meshes (the small round ones) spin around their own axle
 * exactly like the retro-kit fleet.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useSyncExternalStore } from "react";

/** Game vehicle type ids that render from these GLB bodies live in constants.ts
 *  (TAXI_TYPE = 10 — the yellow cab). This module only owns the model loading. */

const FILES = {
  cruiser: "/models/police-cruiser-a2d25e.glb",
  cab: "/models/yellow-cab-8df4a0.glb",
} as const;

export type VehicleKind = keyof typeof FILES;

interface VehicleTemplate {
  scene: THREE.Group;
  /** the four wheel meshes (spin .rotation.x = distance / wheelR) */
  wheels: THREE.Object3D[];
  /** front wheel z offset for the rolling math */
  wheelR: number;
}

const cache = new Map<VehicleKind, VehicleTemplate>();
const failed = new Set<VehicleKind>();
const pending = new Map<VehicleKind, Promise<VehicleTemplate>>();

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

/** React hook — re-renders whenever a vehicle GLB finished (or failed) loading. */
export function useVehicles(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
  );
}

const loader = new GLTFLoader();

function register(kind: VehicleKind, gltf: { scene: THREE.Object3D }): VehicleTemplate {
  const scene = gltf.scene as THREE.Group;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
  // ground + center: bbox min.y sits on 0, x/z centered on the origin
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  scene.position.set(-center.x, -box.min.y, -center.z);
  wrap.add(scene);
  // wheels = the small meshes (body mesh spans the full width, wheels don't)
  const wheels: THREE.Object3D[] = [];
  let wheelR = 0.34;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const bb = new THREE.Box3().setFromObject(m);
    const h = bb.max.y - bb.min.y;
    const w = bb.max.x - bb.min.x;
    if (h < 1.0 && h * 2.2 > w) { wheels.push(m); wheelR = h / 2; }
  });
  const tpl: VehicleTemplate = { scene: wrap, wheels, wheelR };
  cache.set(kind, tpl);
  pending.delete(kind);
  bump();
  return tpl;
}

/** Begin the background preload (safe to call repeatedly; no-op on the server). */
export function preloadVehicles(): void {
  if (typeof window === "undefined") return;
  for (const kind of Object.keys(FILES) as VehicleKind[]) {
    if (cache.has(kind) || failed.has(kind) || pending.has(kind)) continue;
    const p = new Promise<VehicleTemplate>((resolve, reject) => {
      loader.load(
        FILES[kind],
        (gltf) => {
          try { resolve(register(kind, gltf)); }
          catch (e) { failed.add(kind); pending.delete(kind); bump(); reject(e); }
        },
        undefined,
        (err) => { failed.add(kind); pending.delete(kind); bump(); reject(err); },
      );
    });
    pending.set(kind, p);
  }
}

/** True once this vehicle's GLB has parsed (or failed for good). */
export const vehicleReady = (kind: VehicleKind): boolean => cache.has(kind);
export const vehicleFailed = (kind: VehicleKind): boolean => failed.has(kind);

/** A fresh clone of the vehicle body (null while loading / on failure). */
export function spawnVehicle(kind: VehicleKind): { root: THREE.Group; wheels: THREE.Object3D[]; wheelR: number } | null {
  const tpl = cache.get(kind);
  if (!tpl) return null;
  const root = tpl.scene.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.frustumCulled = false;
  });
  // re-collect the wheel meshes by position (clones keep names — mesh_1..4)
  const wheels = tpl.wheels.map((w) => {
    let out: THREE.Object3D | undefined;
    root.traverse((o) => { if (!out && o.name === w.name && (o as THREE.Mesh).isMesh) out = o; });
    return out;
  }).filter(Boolean) as THREE.Object3D[];
  return { root, wheels, wheelR: tpl.wheelR };
}
