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
  // 🌲 nature & forest kit — the jungle deer becomes the real polyfork Forest Deer
  deer: "/models/forest-deer-fe648d.glb",
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

/** Height-normalize then per-kind artistic scale (world units).
 *  📏 sized to READ next to ~2.24u survivors — the tiny critters were
 *  ankle-height specks players couldn't even spot, so every small species
 *  got a visibility bump (game readability over strict realism).
 *  ⚠️ normalization divides by the model's FULL bounding-box height, so for
 *  horned/antlered species (goat · ibex · deer · stag) the horns inflate that
 *  height and silently shrink the BODY — every GLB is authored at real-world
 *  scale (see polyfork SPECS: goat 1.65 m, deer 2.12 m, ibex 1.45 m, stag
 *  2.16 m tall incl. headgear), so their targets sit AT/ABOVE real height to
 *  keep the body mass true (goat was rendering at 0.67×, its body half a
 *  sheep's length; the deer's body came out shorter than the wolf's).
 *  📏⬆️ SECOND VISIBILITY PASS — small species (fox/owl/crow/rabbit/hare/
 *  duck/cat) were still easy to lose against the tall cartoon cast; every
 *  under-1u species now sits ≥1u, mid species +0.2-0.3u. */
const TARGET_H: Record<ModelKind, number> = {
  wolf: 1.5, bear: 2.0, fox: 1.18, owl: 1.0, crow: 0.95, rabbit: 1.05, stag: 2.6,
  deer: 2.5,
  ibex: 1.85, hare: 1.05, pig: 1.4, sheep: 1.3, goat: 1.8, duck: 1.0,
  cat: 1.05, spider: 1.75,
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
