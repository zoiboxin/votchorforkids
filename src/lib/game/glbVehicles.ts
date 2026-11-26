/**
 * 🚓 Polyfork GLB vehicles — the police cruiser, the yellow cab & the 🏪 SHOP
 * GARAGE fleet (20 purchasable rides, priced 1 coin per triangle in the shop).
 *
 * Static prop models from the polyfork catalog (https://polyfork.dev,
 * CC BY 4.0 — see public/models/CREDITS.md), served locally like the wildlife:
 *   public/models/police-cruiser-a2d25e.glb          — 4.81u long, roof light bar
 *   public/models/yellow-cab-8df4a0.glb              — 4.62u long, roof TAXI sign
 *   public/models/vehicles/<slug>.glb                — the shop garage fleet
 *
 * All ship at real-world scale with +Z = nose (same forward axis the game's
 * placeCar/kit fleet uses — no rotation fix-up). Loading normalizes only the
 * ground contact (min.y → 0) and centers x/z; clones are cached per instance
 * and the four wheel meshes (the small round ones) spin around their own axle
 * exactly like the retro-kit fleet.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useSyncExternalStore } from "react";
import { enableGlbCulling } from "@/lib/game/glbCull";

/** Game vehicle type ids that render from these GLB bodies live in constants.ts
 *  (TAXI_TYPE = 10 — the yellow cab; the 🏪 garage fleet maps 12–31 via
 *  VEHICLE_GLB). This module only owns the model loading. */

const FILES = {
  cruiser: "/models/police-cruiser-a2d25e.glb",
  cab: "/models/yellow-cab-8df4a0.glb",
  "jackpot-prize-convertible-81bca8": "/models/vehicles/jackpot-prize-convertible-81bca8.glb",
  "stretch-limousine-284b73": "/models/vehicles/stretch-limousine-284b73.glb",
  "model-of-a-gt3-32b70d": "/models/vehicles/model-of-a-gt3-32b70d.glb",
  "touring-motorcycle-3b1ad3": "/models/vehicles/touring-motorcycle-3b1ad3.glb",
  "ranger-pickup-truck-97057d": "/models/vehicles/ranger-pickup-truck-97057d.glb",
  "follow-me-car-b3c6a5": "/models/vehicles/follow-me-car-b3c6a5.glb",
  "compact-tractor-35b84b": "/models/vehicles/compact-tractor-35b84b.glb",
  "three-wheeled-delivery-mini-744094": "/models/vehicles/three-wheeled-delivery-mini-744094.glb",
  "pickup-truck-a34bf2": "/models/vehicles/pickup-truck-a34bf2.glb",
  "semi-tractor-e9455c": "/models/vehicles/semi-tractor-e9455c.glb",
  "rental-scooter-031ee2": "/models/vehicles/rental-scooter-031ee2.glb",
  "campus-shuttle-bus-27dcaa": "/models/vehicles/campus-shuttle-bus-27dcaa.glb",
  "freestyle-bmx-ad7d9a": "/models/vehicles/freestyle-bmx-ad7d9a.glb",
  "stunt-scooter-d98af3": "/models/vehicles/stunt-scooter-d98af3.glb",
  "marigold-pickup-f4b6f9": "/models/vehicles/marigold-pickup-f4b6f9.glb",
  "scout-jeep-c02efe": "/models/vehicles/scout-jeep-c02efe.glb",
  "motorcycle-and-sidecar-7d39b8": "/models/vehicles/motorcycle-and-sidecar-7d39b8.glb",
  "medium-tank-65da6b": "/models/vehicles/medium-tank-65da6b.glb",
  "steam-mule-tractor-00badc": "/models/vehicles/steam-mule-tractor-00badc.glb",
  "delivery-moped-1aa2ce": "/models/vehicles/delivery-moped-1aa2ce.glb",
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
      // 🎯 culled rendering — static bodies, a small margin for the wheel spin
      enableGlbCulling(o, 1.1, 0.25);
    }
  });
  // ground + center: bbox min.y sits on 0, x/z centered on the origin
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  scene.position.set(-center.x, -box.min.y, -center.z);
  wrap.add(scene);
  // wheels — polyfork vehicles NAME their wheels (wheel-fr / tyre-fl /
  // wheel-f-mesh, always with steer-* siblings), so collect the top-most
  // wheel-named nodes and spin those. The old small-round-mesh heuristic
  // stays as the fallback: on narrow bodies (the motorcycle!) it grabbed
  // forks & saddlebags too, and the drive-spin twirled the whole bike over.
  const isWheelName = (n: string) => /^wheel|^tyre/i.test(n);
  const wheels: THREE.Object3D[] = [];
  let wheelR = 0.34;
  scene.traverse((o) => {
    if (!isWheelName(o.name)) return;
    if (o.parent && isWheelName(o.parent.name)) return; // wheel-fr-mesh inside wheel-fr — spin the parent only
    wheels.push(o);
  });
  if (wheels.length) {
    let bestD = 0;
    for (const w of wheels) {
      w.traverse((m) => {
        const mm = m as THREE.Mesh;
        if (!mm.isMesh) return;
        const bb = new THREE.Box3().setFromObject(mm);
        const d = bb.max.y - bb.min.y;
        if (d > bestD && d < 1.6) { bestD = d; wheelR = d / 2; }
      });
    }
  } else {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const bb = new THREE.Box3().setFromObject(m);
      const h = bb.max.y - bb.min.y;
      const w = bb.max.x - bb.min.x;
      if (h < 1.0 && h * 2.2 > w) { wheels.push(m); wheelR = h / 2; }
    });
  }
  const tpl: VehicleTemplate = { scene: wrap, wheels, wheelR };
  cache.set(kind, tpl);
  pending.delete(kind);
  bump();
  return tpl;
}

/** Load ONE vehicle kind (cache-friendly): resolves from cache when ready,
 *  rejects for good on failure. The shop stage + garage thumbs await this;
 *  the world renderer polls vehicleReady(). */
export function loadVehicle(kind: VehicleKind): Promise<VehicleTemplate> {
  const tpl = cache.get(kind);
  if (tpl) return Promise.resolve(tpl);
  if (failed.has(kind)) return Promise.reject(new Error(`vehicle ${kind} failed earlier`));
  const inflight = pending.get(kind);
  if (inflight) return inflight;
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
  return p;
}

/** Begin the background preload (safe to call repeatedly; no-op on the server).
 *  Loads the world-fleet kinds (cruiser + cab); garage/vehicle thumbs call
 *  loadVehicle(kind) for their own files on demand. */
export function preloadVehicles(): void {
  if (typeof window === "undefined") return;
  for (const kind of ["cruiser", "cab"] as VehicleKind[]) {
    void loadVehicle(kind).catch(() => { /* failed set keeps the emoji stand-in */ });
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
    if (m.isMesh) enableGlbCulling(o, 1.1, 0.25); // clones share the inflated sphere
  });
  // re-collect the wheel nodes by name (clones keep names — wheel-fr, wheel-f-mesh…).
  // Named polyfork wheels may be GROUPS (wheel-fr) wrapping the tyre mesh, so the
  // isMesh filter is dropped — the top-most wheel node is what gets spun.
  const wheels = tpl.wheels.map((w) => {
    let out: THREE.Object3D | undefined;
    root.traverse((o) => {
      if (out || o.name !== w.name) return;
      if (o.parent && tpl.wheels.some((pw) => pw !== w && pw.name === o.parent!.name)) return;
      out = o;
    });
    return out;
  }).filter(Boolean) as THREE.Object3D[];
  return { root, wheels, wheelR: tpl.wheelR };
}
