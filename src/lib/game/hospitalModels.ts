/**
 * 🏥 polyfork Hospital Kit GLB loader — St. Cross Medical Campus.
 *
 * Models from the polyfork hospital kit
 * (https://polyfork.dev/kit/hospital-kit-2ebfcb, CC BY 4.0 — see
 * public/models/CREDITS.md): multi-storey ward block, clinic annexe,
 * emergency entrance block, stair & lift core, entrance canopy, rooftop
 * helipad deck, air-ambulance helicopter, ambulance van, mesh fence panels,
 * clipped hedge sections, illuminated bollards, wayfinding totem sign,
 * ambulance-bay hatching decal, precast paving tiles, wayfinding stripe
 * decals, standby generator enclosure, clinical waste bins, medical gas
 * cylinders, wheelchair, wet-floor sign — plus five skinned staff/patient
 * characters (doctor, paramedic, ward nurse, surgeon, patient in gown) that
 * each carry Idle/Walk/Run clips.
 *
 * Every model is vertex-coloured (one palette), so repeated props (fence
 * runs, hedges, bollards, paving tiles) bake into ONE merged mesh per kind —
 * ~90 fence panels + 50 paving tiles render as a handful of draw calls.
 * Files preload in the background; a failed model just skips that prop,
 * never crashes the game.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const FILES = {
  ward: "/models/hospital/multi-storey-ward-block-2bac82.glb",
  annexe: "/models/hospital/clinic-annexe-0f56d1.glb",
  er: "/models/hospital/emergency-entrance-block-9e5caf.glb",
  core: "/models/hospital/stair-and-lift-core-a13dd9.glb",
  canopy: "/models/hospital/entrance-canopy-8378c5.glb",
  helipadDeck: "/models/hospital/rooftop-helipad-deck-24e53c.glb",
  helicopter: "/models/hospital/air-ambulance-helicopter-ed9acc.glb",
  ambulance: "/models/hospital/ambulance-van-29919a.glb",
  fence: "/models/hospital/mesh-fence-panel-11d4e2.glb",
  hedge: "/models/hospital/clipped-hedge-section-11a067.glb",
  bollard: "/models/hospital/illuminated-bollard-9af752.glb",
  totem: "/models/hospital/wayfinding-totem-sign-dbb4be.glb",
  bayDecal: "/models/hospital/ambulance-bay-hatching-decal-106ff2.glb",
  paving: "/models/hospital/precast-paving-tile-967791.glb",
  stripe: "/models/hospital/wayfinding-stripe-decal-017b76.glb",
  generator: "/models/hospital/standby-generator-enclosure-9d48f6.glb",
  bin: "/models/hospital/clinical-waste-bin-471ff3.glb",
  gasCylinder: "/models/hospital/medical-gas-cylinder-a2d6a7.glb",
  wheelchair: "/models/hospital/wheelchair-0584dc.glb",
  wetSign: "/models/hospital/wet-floor-sign-d39967.glb",
  doctor: "/models/hospital/doctor-d49de0.glb",
  paramedic: "/models/hospital/paramedic-b0f358.glb",
  nurse: "/models/hospital/ward-nurse-84b61d.glb",
  surgeon: "/models/hospital/surgeon-in-scrubs-4f1360.glb",
  patient: "/models/hospital/patient-in-gown-fdab75.glb",
} as const;

export type HospitalKind = keyof typeof FILES;
/** the kit characters are skinned — they need SkeletonUtils clones + a mixer */
const SKINNED = new Set<HospitalKind>(["doctor", "paramedic", "nurse", "surgeon", "patient"]);

export interface HospitalRig {
  template: THREE.Group;
  size: THREE.Vector3;
  clips: Record<string, THREE.AnimationClip>;
  skinned: boolean;
}

const cache = new Map<HospitalKind, HospitalRig>();
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
export function preloadHospitalModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as HospitalKind[]) {
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
        const clips: Record<string, THREE.AnimationClip> = {};
        for (const c of gltf.animations) clips[c.name.toLowerCase()] = c;
        cache.set(kind, { template: wrap, size, clips, skinned: SKINNED.has(kind) });
        notify();
      },
      undefined,
      () => { /* a failed model just means that prop is skipped — never crash the game */ console.error("[hospital-kit] GLB failed to load:", FILES[kind]); },
    );
  }
}

export const hospitalProgress = () => ({ ready: readyCount, total: Object.keys(FILES).length });

/** True once this kind's GLB has been parsed and normalized. */
export const isHospitalModelReady = (kind: string): boolean =>
  kind in FILES && cache.has(kind as HospitalKind);

/** A fresh independent clone of the kit model, or null while loading.
 *  Skinned characters get a SkeletonUtils clone + a playing Idle mixer; the
 *  full clip table rides along so callers (the staff bots) can also play
 *  Walk/Run and crossfade between them. */
export function spawnHospitalModel(kind: string): { root: THREE.Object3D; mixer: THREE.AnimationMixer | null; clips: Record<string, THREE.AnimationClip> } | null {
  const rig = cache.get(kind as HospitalKind);
  if (!rig) return null;
  const root = rig.skinned ? skeletonClone(rig.template) : rig.template.clone(true);
  let mixer: THREE.AnimationMixer | null = null;
  if (rig.skinned) {
    mixer = new THREE.AnimationMixer(root);
    const idle = rig.clips["idle"];
    if (idle) mixer.clipAction(idle).play();
  }
  return { root, mixer, clips: rig.clips };
}

/** Authored model size in metres (0,0,0 while loading). */
export function hospitalModelSize(kind: HospitalKind): THREE.Vector3 {
  return cache.get(kind)?.size ?? new THREE.Vector3();
}

export interface HospitalPlacement {
  x: number; y?: number; z: number;
  /** yaw (radians) — kit models face +z (characters & vehicles) or sit symmetric */
  rot?: number;
  /** uniform scale, default 1 */
  s?: number;
}

/**
 * Bake MANY placements of one kit kind into a single merged mesh — the ~84
 * fence panels, 50 paving tiles and 16 hedge sections each collapse into ONE
 * draw call. All Hospital-kit models are vertex-coloured, so one
 * vertexColors Lambert material carries every baked instance.
 * Returns null while still loading.
 */
export function bakeHospitalModel(kind: HospitalKind, placements: HospitalPlacement[]): THREE.Mesh | null {
  const rig = cache.get(kind);
  if (!rig || placements.length === 0) return null;
  const parts: { geo: THREE.BufferGeometry; rel: THREE.Matrix4 }[] = [];
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
    e.set(0, p.rot ?? 0, 0);
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

/** Fire the callback when every hospital model is in (or immediately if so).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onHospitalModelsReady(cb: () => void): () => void {
  if (readyCount >= Object.keys(FILES).length) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
