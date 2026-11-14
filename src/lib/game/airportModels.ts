/**
 * ✈️ polyfork Airport Kit GLB loader — 7Nights International Airport.
 *
 * Models from the polyfork airport kit (https://polyfork.dev/kit/airport-43b137,
 * CC BY 4.0 — see public/models/CREDITS.md): utility helicopter, business jet,
 * cargo freighter, narrow-body airliner, regional turboprop, single-engine &
 * twin-piston light aircraft, fuel-farm tank, ground power unit, container
 * dolly, spare engine stand, wheeled extinguisher, self check-in kiosk, x-ray
 * conveyor, passport booth, security arch, queue stanchion run, taxi-rank
 * sign, lifting barrier arm, windsock, VOR beacon, rotating airport beacon,
 * runway distance boards, guard lights, PAPI units, approach lighting bar and
 * a flight attendant (skinned, with an Idle clip).
 *
 * Files preload in the background; every spawn hands out an independent clone
 * (skeleton-cloned for the attendant). Aircraft keep their authored real-world
 * size (metres) — placement scale is chosen by each component.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

const FILES = {
  helicopter: "/models/airport/helicopter-9d1986.glb",
  bizjet: "/models/airport/business-jet-684611.glb",
  cargo: "/models/airport/cargo-freighter-b4377e.glb",
  airliner: "/models/airport/narrow-body-airliner-619183.glb",
  widebody: "/models/airport/widebody-airliner-ae0a5a.glb",
  turboprop: "/models/airport/regional-turboprop-097f26.glb",
  singleprop: "/models/airport/single-engine-light-aircraft-24478f.glb",
  twinprop: "/models/airport/twin-engine-piston-light-f417c7.glb",
  fuelTank: "/models/airport/fuel-farm-tank-ed67f0.glb",
  gpu: "/models/airport/ground-power-unit-326361.glb",
  dolly: "/models/airport/container-dolly-0e4b32.glb",
  spareEngine: "/models/airport/spare-engine-on-transport-db14e5.glb",
  extinguisher: "/models/airport/wheeled-fire-extinguisher-4bde8b.glb",
  kiosk: "/models/airport/self-check-in-kiosk-3fe1c1.glb",
  xray: "/models/airport/x-ray-baggage-conveyor-b3d1cc.glb",
  passport: "/models/airport/passport-control-booth-7724c6.glb",
  arch: "/models/airport/walk-through-security-arch-5c2a43.glb",
  stanchions: "/models/airport/queue-barrier-stanchion-run-1836c8.glb",
  taxiSign: "/models/airport/taxi-rank-sign-f5f39d.glb",
  barrierArm: "/models/airport/lifting-barrier-arm-64a343.glb",
  windsock: "/models/airport/windsock-d5df79.glb",
  vor: "/models/airport/vor-navigation-beacon-9b32ff.glb",
  beacon: "/models/airport/rotating-airport-beacon-e1ea5a.glb",
  board: "/models/airport/runway-distance-remaining-board-9681aa.glb",
  guardLight: "/models/airport/runway-guard-light-5a6541.glb",
  papi: "/models/airport/papi-unit-adc7c4.glb",
  approachBar: "/models/airport/approach-lighting-bar-6bb554.glb",
  attendant: "/models/airport/flight-attendant-befaf4.glb",
} as const;

export type AirportKind = keyof typeof FILES;

export interface AirportRig {
  template: THREE.Group;
  clips: Record<string, THREE.AnimationClip>;
  skinned: boolean;
}

const cache = new Map<AirportKind, AirportRig>();
let started = false;
let readyCount = 0;
const readyCbs: (() => void)[] = [];

function notify() {
  readyCount = cache.size;
  if (readyCount >= Object.keys(FILES).length) {
    for (const cb of readyCbs.splice(0)) cb();
  }
}

/** Begin the background preload (safe to call repeatedly; no-op on the server). */
export function preloadAirportModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as AirportKind[]) {
    loader.load(
      FILES[kind],
      (gltf) => {
        const scene = gltf.scene;
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = false;
          }
        });
        // ground the model (origin at its tarmac contact point), centre x/z —
        // the box is computed AFTER any template scaling so grounding is exact
        const box = new THREE.Box3().setFromObject(scene);
        const center = box.getCenter(new THREE.Vector3());
        scene.position.set(-center.x, -box.min.y, -center.z);
        const wrap = new THREE.Group();
        wrap.add(scene);
        const clips: Record<string, THREE.AnimationClip> = {};
        for (const c of gltf.animations) clips[c.name.toLowerCase()] = c;
        cache.set(kind, { template: wrap, clips, skinned: kind === "attendant" });
        notify();
      },
      undefined,
      () => { /* a failed model just means that prop is skipped — never crash the game */ console.error("[airport-kit] GLB failed to load:", FILES[kind]); },
    );
  }
}

export const airportProgress = () => ({ ready: readyCount, total: Object.keys(FILES).length });

/** True once this kind's GLB has been parsed and normalized. */
export const isAirportModelReady = (kind: string): boolean =>
  kind in FILES && cache.has(kind as AirportKind);

/** A fresh independent clone of the kit model, or null while loading.
 *  The clone sits grounded at the origin — position/rotate/scale the returned
 *  group (or a parent) to place it. */
export function spawnAirportModel(kind: string): { root: THREE.Group; mixer: THREE.AnimationMixer | null; clips: Record<string, THREE.AnimationClip> } | null {
  const rig = cache.get(kind as AirportKind);
  if (!rig) return null;
  const root = rig.skinned ? skeletonClone(rig.template) : rig.template.clone(true);
  const mixer = rig.skinned ? new THREE.AnimationMixer(root) : null;
  if (mixer) {
    const idle = rig.clips["idle"];
    if (idle) mixer.clipAction(idle).play();
  }
  return { root, mixer, clips: rig.clips };
}

/** Depth-first search for a named node (rotor-main, boom, beacon-head, sway…). */
export function airportNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** Fire the callback when every airport model is in (or immediately if so).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onAirportModelsReady(cb: () => void): () => void {
  if (readyCount >= Object.keys(FILES).length) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
