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
 *  📏 TRUE-SCALE pass — every target was audited one-by-one against the
 *  model's MEASURED bind-pose bbox (scripts/animal-bbox.ts parses each GLB's
 *  POSITION accessors) ×1.24 — the inflation factor of the ~2.24u cast
 *  (a 2.24u survivor ≈ a 1.8m man) — so every animal reads TRUE beside the
 *  humans: the horse's head clears yours, a cow's back reaches your chest,
 *  a dog's head bumps your knee, a chicken stays knee-high. Horned/antlered
 *  species (goat · ibex · deer · stag) get targets above shoulder height so
 *  the HORNS don't silently shrink the BODY (goat bbox 1.65m is mostly horns
 *  → body ≈0.9u at 1.8; deer 2.12m incl. antlers → body ≈1.32u at 2.1;
 *  ibex 1.45m incl. horns → body ≈1.15u at 1.7; stag 2.17m → body ≈1.55u
 *  at 2.5 — the night spirit towers). The tiniest critters (frog 0.09m
 *  natural, the insects) keep deliberate readability floors instead. */
const TARGET_H: Record<ModelKind, number> = {
  // 🌲 jungle wildlife — measured bbox ×1.24 (wolf 1.07 · bear 1.42 · fox 0.95
  // alert-head · owl 0.34 · crow 0.32 · rabbit 0.37 · deer 2.12 antlers ·
  // stag 2.17 antlers) — the pack, the bear and the deer all read TRUE now
  wolf: 1.2, bear: 1.7, fox: 0.72, owl: 0.55, crow: 0.42, rabbit: 0.42, stag: 2.5,
  deer: 2.1, // antlers inflate the 2.12u bbox — the body lands ≈1.32u at chest height
  // 🏔️ alpine — ibex bbox 1.45 incl. horns (body ≈1.15u at 1.7), hare 0.53 with ears
  ibex: 1.7, hare: 0.48,
  // 🚜 farmyard — full-grown breeds beside the 2.24u cast (measured bboxes:
  // pig 1.10 alert-head · sheep 1.00 · goat 1.65 mostly HORNS · duck 0.61
  // raised-neck · cow 1.46 · chicken 0.65 · dog 0.79 · horse 1.87): the
  // horse is the headline fix — at 1.8 its head sat BELOW the cast's head
  // (a pony!); at 2.5 the head clears yours and the withers land ≈2.1u at
  // human shoulder height. A stallion at last.
  pig: 1.15, sheep: 1.25, goat: 1.8, duck: 0.5,
  cow: 1.85, chicken: 0.62, dog: 0.9, horse: 2.5,
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
    const wasArray = Array.isArray(m.material);
    const src = wasArray ? m.material : [m.material];
    const mats = src.map((s) => {
      const c = (s as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
      _rotTmp.copy(c.color).lerp(rot, mix);
      c.color.copy(_rotTmp);
      if (emissive > 0 && "emissive" in c && c.emissive) {
        c.emissive.set(color).multiplyScalar(emissive);
      }
      return c;
    });
    // ⚠️ keep the material SHAPE — an array on a group-less mesh renders
    // NOTHING (the renderer walks geometry.groups); same bug as tintGlbZombie
    m.material = wasArray ? mats : mats[0];
  });
  return root;
}
