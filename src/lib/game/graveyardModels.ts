/**
 * 🪦 polyfork Halloween Night Kit GLB loader — the out-of-town cemetery estate.
 *
 * Models from the polyfork halloween-night kit
 * (https://polyfork.dev/kit/halloween-night-46ade4, CC BY 4.0 — see
 * public/models/CREDITS.md): carved headstones, foam yard gravestones, grave
 * mounds, wrought-iron cemetery fence runs, arched cemetery gate, haunted
 * Victorian house, family mausoleum, vintage hearse, twisted dead oak,
 * cemetery lantern post, jack-o-lantern, weeping stone angel, crawling
 * skeleton, crow, bare thorn bush, coffin prop, hanging cheesecloth ghosts
 * and mossy stone steps.
 *
 * Every model is vertex-coloured (one MeshStandardMaterial each), so repeated
 * props (fence runs, headstones, mounds) can be baked into ONE merged mesh per
 * kind — 64 fence runs + 82 gravestones render as 3 draw calls. Files preload
 * in the background; a failed model just skips that prop, never crashes.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const FILES = {
  headstone: "/models/graveyard/carved-headstone-09d9f8.glb",
  gravestoneFoam: "/models/graveyard/foam-yard-gravestone-d64ffc.glb",
  mound: "/models/graveyard/grave-mound-169ec3.glb",
  fence: "/models/graveyard/wrought-iron-cemetery-fence-f1a113.glb",
  gate: "/models/graveyard/arched-cemetery-gate-bdca7c.glb",
  house: "/models/graveyard/haunted-victorian-house-886931.glb",
  mausoleum: "/models/graveyard/family-mausoleum-c2a009.glb",
  hearse: "/models/graveyard/vintage-hearse-3b2ec1.glb",
  oak: "/models/graveyard/twisted-dead-oak-49457b.glb",
  lantern: "/models/graveyard/cemetery-lantern-post-fed352.glb",
  pumpkin: "/models/graveyard/jack-o-lantern-0b1ddb.glb",
  angel: "/models/graveyard/weeping-stone-angel-644ce3.glb",
  skeleton: "/models/graveyard/skeleton-crawling-out-of-24b6ae.glb",
  crow: "/models/graveyard/crow-194434.glb",
  bush: "/models/graveyard/bare-thorn-bush-91a238.glb",
  coffin: "/models/graveyard/coffin-prop-d62082.glb",
  ghosts: "/models/graveyard/hanging-cheesecloth-ghosts-c569cf.glb",
  steps: "/models/graveyard/mossy-stone-steps-1beb4d.glb",
} as const;

export type GraveyardKind = keyof typeof FILES;

export interface GraveyardRig {
  template: THREE.Group;
  /** authored size (metres) — placement code scales models to fit the estate */
  size: THREE.Vector3;
}

const cache = new Map<GraveyardKind, GraveyardRig>();
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
export function preloadGraveyardModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as GraveyardKind[]) {
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
        // ground the model (origin at its turf contact point), centre x/z —
        // the box is computed BEFORE wrapping so grounding is exact
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        scene.position.set(-center.x, -box.min.y, -center.z);
        const wrap = new THREE.Group();
        wrap.add(scene);
        wrap.updateMatrixWorld(true);
        cache.set(kind, { template: wrap, size });
        notify();
      },
      undefined,
      () => { /* a failed model just means that prop is skipped — never crash the game */ console.error("[graveyard-kit] GLB failed to load:", FILES[kind]); },
    );
  }
}

export const graveyardProgress = () => ({ ready: readyCount, total: Object.keys(FILES).length });

/** True once this kind's GLB has been parsed and normalized. */
export const isGraveyardModelReady = (kind: string): boolean =>
  kind in FILES && cache.has(kind as GraveyardKind);

/** A fresh independent grounded clone — position/rotate/scale it to place. */
export function spawnGraveyardModel(kind: GraveyardKind): THREE.Group | null {
  const rig = cache.get(kind);
  if (!rig) return null;
  return rig.template.clone(true);
}

/** Authored model size in metres (0,0,0 while loading). */
export function graveyardModelSize(kind: GraveyardKind): THREE.Vector3 {
  return cache.get(kind)?.size ?? new THREE.Vector3();
}

export interface GraveyardPlacement {
  x: number; y?: number; z: number;
  /** yaw (radians) — the kit models face +z (hearse/gate) or sit symmetric */
  rot?: number;
  /** uniform scale, default 1 */
  s?: number;
  /** pitch (radians) — used by hanging ghosts etc. */
  rx?: number;
}

/**
 * Bake MANY placements of one kit kind into a single merged mesh — the 64
 * fence runs, 70+ headstones and 14 mounds each collapse into ONE draw call.
 * All Halloween-kit models are vertex-coloured, so one vertexColors Lambert
 * material carries every baked instance. Returns null while still loading.
 */
export function bakeGraveyardModel(kind: GraveyardKind, placements: GraveyardPlacement[]): THREE.Mesh | null {
  const rig = cache.get(kind);
  if (!rig || placements.length === 0) return null;
  const parts: THREE.BufferGeometry[] = [];
  rig.template.updateMatrixWorld(true);
  rig.template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const rel = mesh.matrixWorld.clone()
      .premultiply(rig.template.matrixWorld.clone().invert()); // node → template-root space
    parts.push({ geo: mesh.geometry.clone(), rel });
  });
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  for (const p of placements) {
    const s = p.s ?? 1;
    e.set(p.rx ?? 0, p.rot ?? 0, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q, one.clone().multiplyScalar(s));
    for (const { geo, rel } of parts) {
      const g = geo.clone().applyMatrix4(rel).applyMatrix4(m);
      if (!g.attributes.color) {
        // kit models are vertex-coloured; a stray uncoloured part gets white
        const n = g.attributes.position.count;
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      geos.push(g);
    }
  }
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos, false);
  if (!merged) return null;
  geos.forEach((g) => g.dispose());
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  return mesh;
}

/** Fire the callback when every graveyard model is in (or immediately if so).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onGraveyardModelsReady(cb: () => void): () => void {
  if (readyCount >= Object.keys(FILES).length) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
