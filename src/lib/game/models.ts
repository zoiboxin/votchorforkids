/**
 * 🌲 polyfork GLB wildlife loader — every animal in the world.
 *
 * Models from the polyfork catalog (https://polyfork.dev, CC BY 4.0 — see
 * public/models/CREDITS.md): Wolf · Black Bear · Red Fox · Owl · Crow ·
 * Forest Rabbit · Crystal-Antlered Spectral Stag · plus the farm & meadow
 * menagerie (cow, chicken, dog, horse, frog) and the biting creepy-crawlies
 * (wood ant, common wasp, honeybee, praying mantis, stag beetle, ladybird,
 * meadow grasshopper, stone centipede, tarantula, garden orb-weaver).
 *
 * Every model ships with baked skeletal clips (Idle / Walk / Run — the bee
 * & wasp add Fly), so the Animals renderer drives a real AnimationMixer per
 * beast instead of fake bobbing. Files preload in the background; clones are
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
  // 🚜 the last procedural beasts go GLB — the farm & city menagerie is fully rigged now
  cow: "/models/cow-base.glb",
  chicken: "/models/chicken-base.glb",
  dog: "/models/dog-base.glb",
  horse: "/models/horse-base.glb",
  // 🐸 the jungle monkey swaps its cartoon body for a real rigged frog
  frog: "/models/frog-base.glb",
  // 🐜 insect world — the biting crawlers & flyers of the grass fields
  ant: "/models/wood-ant-base.glb",
  wasp: "/models/common-wasp-base.glb",
  bee: "/models/honeybee-base.glb",
  mantis: "/models/praying-mantis-base.glb",
  beetle: "/models/stag-beetle-base.glb",
  ladybird: "/models/seven-spot-ladybird-base.glb",
  grasshopper: "/models/meadow-grasshopper-base.glb",
  centipede: "/models/stone-centipede-base.glb",
  tarantula: "/models/tarantula-base.glb",
  orbweaver: "/models/garden-orb-weaver-b32844.glb",
} as const;

export type ModelKind = keyof typeof FILES;

/** Height-normalize then per-kind artistic scale (world units).
 *  📏 NORMAL-SIZE pass — the zoo now sits at believable real-world heights
 *  next to the ~2.24u survivors: a cow towers to your chest, a dog reaches
 *  your thigh, a chicken is knee-high. Nothing renders as an ankle-height
 *  speck (0.3u floor on the tiniest crawlers), but the giant-inflated old
 *  targets are gone — animals read as ANIMALS, not monsters.
 *  ⚠️ normalization divides by the model's FULL bounding-box height, so for
 *  horned/antlered species (goat · ibex · deer · stag) the horns inflate that
 *  height and silently shrink the BODY — their targets sit above shoulder
 *  height to keep the body mass true (see polyfork SPECS: goat 1.65 m,
 *  deer 2.12 m, ibex 1.45 m, stag 2.16 m incl. headgear). */
const TARGET_H: Record<ModelKind, number> = {
  // 🌲 jungle wildlife — real sizes
  wolf: 1.0, bear: 1.55, fox: 0.68, owl: 0.5, crow: 0.4, rabbit: 0.4, stag: 2.2,
  deer: 1.9, // antlers inflate the 2.12u bbox — target ≈ spec so the body lands ≈1.35u
  // 🏔️ alpine
  ibex: 1.5, hare: 0.42,
  // 🚜 farmyard — the big domestic breeds. Sheep & goat read NEXT to the 2.24u
  // cast, so they scale with the town's inflated humans (a 2.24u survivor ≈ a
  // 1.8m man, ×1.24): the sheep model is exactly 1.0u tall (no headgear) so it
  // gets a chunky 1.2u ram; the goat's bbox is 1.65u of mostly HORNS — its
  // target sits at the polyfork spec height (1.65m incl. headgear) so the BODY
  // lands ≈0.85u and stops rendering as a knee-high speck.
  pig: 0.95, sheep: 1.2, goat: 1.55, duck: 0.45,
  cow: 1.5, chicken: 0.55, dog: 0.72, horse: 1.8,
  // 🐸 jungle floor
  frog: 0.32,
  // 🎃 town & graveyard
  cat: 0.42, spider: 1.6,
  // 🐜 insect world — small but never invisible; the biters stay readable
  ant: 0.34, wasp: 0.42, bee: 0.4, mantis: 0.62, beetle: 0.42, ladybird: 0.3,
  grasshopper: 0.42, centipede: 0.45, tarantula: 0.55, orbweaver: 0.6,
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

const _rotCol = new THREE.Color();
const _rotTmp = new THREE.Color();

/** 🧟 Rot a cloned animal body — a sickly graveyard wash over every material.
 *  Used for the zombie hounds: same rig, rotten flesh. `mix` 0..1 controls
 *  how far the fur leans toward the rot colour. Returns the SAME root (fluent).
 *  Must run on a skeletonClone (own materials) — never on the shared template. */
export function tintRot(root: THREE.Group, color: string, mix: number, emissive = 0): THREE.Group {
  const rot = _rotCol.set(color);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    m.material = mats.map((src) => {
      const c = (src as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
      _rotTmp.copy(c.color).lerp(rot, mix);
      c.color.copy(_rotTmp);
      if (emissive > 0 && "emissive" in c && c.emissive) {
        c.emissive.set(color).multiplyScalar(emissive);
      }
      return c;
    });
  });
  return root;
}
