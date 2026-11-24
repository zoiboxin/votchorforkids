/**
 * 🚧 polyfork Construction Site kit GLB loader — three real building sites
 * grow inside the city blocks (see SITEKIT in worldgen).
 *
 * Models from the polyfork construction-site kit
 * (https://polyfork.dev/kit/construction-site-9e40b0, CC BY 4.0 — see
 * public/models/CREDITS.md): tower crane (mast + slewing top), steel-frame
 * build bays, concrete core sections, scaffold bays, site hoarding & mesh
 * fence runs, site cabin, portable toilet, lighting tower, safety sign
 * board, traffic cones, material pallets, precast concrete stacks, rebar
 * assemblies, site generator, tracked excavator, articulated dump truck,
 * open trench bays, spoil heaps, mud & broken-road tiles, crash barrier
 * runs, temporary traffic light, backhoe loader, tandem road roller and
 * the concrete mixer truck.
 *
 * Every model is vertex-coloured (one MeshStandardMaterial each), so ALL
 * repeated props bake into ONE merged mesh per kind — the whole three-site
 * district renders as ~20 draw calls total. Files preload in the
 * background; a failed model just skips that prop, never crashes.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const FILES = {
  craneMast: "/models/construction/tower-crane-mast-1784a3.glb",
  craneTop: "/models/construction/tower-crane-top-d8d9c9.glb",
  steelFrame: "/models/construction/steel-frame-bay-91d3b6.glb",
  scaffold: "/models/construction/scaffold-bay-4e051b.glb",
  coreSection: "/models/construction/concrete-core-section-39af7c.glb",
  hoarding: "/models/construction/site-hoarding-run-0273b4.glb",
  meshFence: "/models/construction/mesh-site-fence-run-a798a0.glb",
  cabin: "/models/construction/site-cabin-e9ee10.glb",
  toilet: "/models/construction/portable-toilet-a3f1a2.glb",
  lightTower: "/models/construction/site-lighting-tower-674c45.glb",
  signBoard: "/models/construction/site-safety-sign-board-5408d5.glb",
  cone: "/models/construction/site-traffic-cone-d3ce94.glb",
  pallet: "/models/construction/material-pallet-6af263.glb",
  precast: "/models/construction/precast-concrete-stack-8945ac.glb",
  rebar: "/models/construction/rebar-assembly-889031.glb",
  generator: "/models/construction/site-generator-298792.glb",
  excavator: "/models/construction/tracked-excavator-8ebd3c.glb",
  dumpTruck: "/models/construction/articulated-dump-truck-ee50f3.glb",
  trench: "/models/construction/open-trench-bay-45eddb.glb",
  spoilHeap: "/models/construction/spoil-heap-9aaa11.glb",
  mudTile: "/models/construction/mud-and-rut-tile-858785.glb",
  brokenRoad: "/models/construction/broken-out-road-tile-c9e990.glb",
  crashBarrier: "/models/construction/crash-barrier-run-b47d1d.glb",
  trafficLight: "/models/construction/temporary-traffic-light-04c866.glb",
  backhoe: "/models/construction/backhoe-loader-66dccb.glb",
  roadRoller: "/models/construction/tandem-road-roller-f7d8f3.glb",
  mixerTruck: "/models/construction/concrete-mixer-truck-4a8d94.glb",
} as const;

export type ConstructionKind = keyof typeof FILES;

export interface ConstructionRig {
  template: THREE.Group;
  /** authored size (metres) — placement code scales models to fit the site */
  size: THREE.Vector3;
}

const cache = new Map<ConstructionKind, ConstructionRig>();
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
export function preloadConstructionModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as ConstructionKind[]) {
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
      () => { /* a failed model just means that prop is skipped — never crash the game */ console.error("[construction-kit] GLB failed to load:", FILES[kind]); },
    );
  }
}

export const constructionProgress = () => ({ ready: readyCount, total: Object.keys(FILES).length });

/** True once this kind's GLB has been parsed and normalized. */
export const isConstructionModelReady = (kind: string): boolean =>
  kind in FILES && cache.has(kind as ConstructionKind);

export interface ConstructionPlacement {
  x: number; y?: number; z: number;
  /** yaw (radians) — rot = atan2(dx,dz) turns the model's authored +z front to (dx,dz) */
  rot?: number;
  /** uniform scale, default 1 */
  s?: number;
}

/**
 * Bake MANY placements of one kit kind into a single merged mesh — every
 * cone, fence run, hoarding panel, barrier and tile across all three sites
 * collapses into ONE draw call. Construction-kit models are vertex-coloured,
 * so one vertexColors Lambert material carries every baked instance.
 * Returns null while still loading.
 */
export function bakeConstructionModel(kind: ConstructionKind, placements: ConstructionPlacement[]): THREE.Mesh | null {
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

/** Fire the callback when every construction model is in (or immediately if so).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onConstructionModelsReady(cb: () => void): () => void {
  if (readyCount >= Object.keys(FILES).length) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
