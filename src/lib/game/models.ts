/**
 * 🌲 polyfork GLB wildlife loader — the jungle's new animals.
 *
 * Models from the polyfork catalog (https://polyfork.dev, CC BY 4.0 — see
 * public/models/CREDITS.md): Wolf · Black Bear · Red Fox · Owl · Crow ·
 * Forest Rabbit · Crystal-Antlered Spectral Stag.
 *
 * Every model ships with baked skeletal clips (Idle / Walk / Run — the birds
 * add Fly), so the Animals renderer drives a real AnimationMixer per beast
 * instead of fake bobbing. Files preload in the background; clones are
 * SkeletonUtils-cloned (they're skinned meshes) and cached per instance.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

const FILES = {
  wolf: "/models/wolf-base.glb",
  bear: "/models/black-bear-adbdc7.glb",
  fox: "/models/red-fox-5c3bc0.glb",
  owl: "/models/owl-base.glb",
  crow: "/models/crow-base.glb",
  rabbit: "/models/forest-rabbit-ea2da0.glb",
  stag: "/models/spectral-stag-d19dc1.glb",
  // 🏔️ alpine & snow kit — the mountain band gains its own wildlife
  ibex: "/models/alpine-ibex-2a288a.glb",
  hare: "/models/mountain-hare-d9c64c.glb",
  // 🚜 cozy farm kit — the barnyard menagerie grows
  pig: "/models/pig-868bda.glb",
  sheep: "/models/sheep-7b0187.glb",
  goat: "/models/goat-1dedee.glb",
  duck: "/models/duck-357dc6.glb",
  // 🎃 halloween night kit — a black cat prowls the town, a giant spider haunts the graveyard
  cat: "/models/arched-black-cat-407cf6.glb",
  spider: "/models/giant-yard-spider-70ddce.glb",
} as const;

export type ModelKind = keyof typeof FILES;

/** Height-normalize then per-kind artistic scale (world units). */
const TARGET_H: Record<ModelKind, number> = {
  wolf: 1.0, bear: 1.5, fox: 0.72, owl: 0.55, crow: 0.5, rabbit: 0.5, stag: 2.1,
  ibex: 1.15, hare: 0.45, pig: 0.75, sheep: 0.8, goat: 0.85, duck: 0.45,
  cat: 0.5, spider: 1.25,
};

/** Clip name fallbacks — every model has Idle+Walk+Run, birds add Fly. */
export interface Rig {
  template: THREE.Group;
  clips: Record<string, THREE.AnimationClip>;
}

const cache = new Map<ModelKind, Rig>();
let total = Object.keys(FILES).length;
let readyCount = 0;
let started = false;
const readyCbs: (() => void)[] = [];

function notify() {
  readyCount = cache.size;
  if (readyCount >= total) {
    const cbs = readyCbs.splice(0);
    for (const cb of cbs) cb();
  }
}

/** Begin the background preload (safe to call repeatedly; no-op on the server). */
export function preloadModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as ModelKind[]) {
    loader.load(
      FILES[kind],
      (gltf) => {
        const clips: Record<string, THREE.AnimationClip> = {};
        for (const c of gltf.animations) clips[c.name.toLowerCase()] = c;
        const template = gltf.scene;
        template.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false;
          }
        });
        // normalize: ground the feet, center x/z, scale to the target height
        const box = new THREE.Box3().setFromObject(template);
        const h = Math.max(0.001, box.max.y - box.min.y);
        const s = TARGET_H[kind] / h;
        const center = box.getCenter(new THREE.Vector3());
        const wrap = new THREE.Group();
        template.position.set(-center.x, -box.min.y, -center.z);
        template.scale.setScalar(s);
        wrap.add(template);
        cache.set(kind, { template: wrap, clips });
        notify();
      },
      undefined,
      () => { /* a failed model just means that species stays hidden — never crash the game */ },
    );
  }
}

export const modelProgress = () => ({ ready: readyCount, total });

/** True once this species' GLB has been parsed and normalized. */
export const isModelReady = (kind: string): boolean => kind in FILES && cache.has(kind as ModelKind);

/** A fresh independent instance (own skeleton + mixer state), or null while loading. */
export function spawnModel(kind: string): { root: THREE.Group; mixer: THREE.AnimationMixer; clips: Record<string, THREE.AnimationClip> } | null {
  const rig = cache.get(kind as ModelKind);
  if (!rig) return null;
  const root = skeletonClone(rig.template);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, clips: rig.clips };
}

/** Fire the callback when every model is in (or immediately if already true).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onModelsReady(cb: () => void): () => void {
  if (readyCount >= total) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
