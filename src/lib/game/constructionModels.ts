/**
 * 🚧 polyfork Construction Site kit GLB loader — three real building sites
 * grow inside the city blocks (see SITEKIT in worldgen).
 *
 * Models from the polyfork construction-site kit
 * (https://polyfork.dev/kit/construction-site-9e40b0, CC BY 4.0 — see
 * public/models/CREDITS.md): tower crane (mast + slewing top), steel-frame
 * build bays with metal-deck floor plates, concrete core sections, scaffold
 * bays & material stacks, formwork wall runs, site hoarding & mesh fence
 * runs, site cabin, portable toilet, smoking shelter, site tool vault,
 * lighting tower, safety sign board, traffic cones, material pallets,
 * dumpy bags, precast concrete stacks, rebar assemblies, site generator,
 * cement mixer stand, towed air compressor, site vehicles (tracked
 * excavator, mini excavator, articulated dump truck, rigid site dumper,
 * wheeled loader, skid-steer loader, backhoe loader, telehandler, crawler
 * bulldozer, tandem road roller, mobile crane, flatbed delivery lorry,
 * concrete mixer truck, concrete pump, water bowser, chain trencher,
 * cherry picker, scissor-lift platform), open trench bays & trench plates,
 * spoil heaps, mud & broken-road tiles, compacted hardcore & fresh-concrete
 * slab tiles, crash barrier runs, temporary traffic light, pedestrian
 * walkway tunnel, loading gantry and the wheel wash.
 *
 * Every model is vertex-coloured (one MeshStandardMaterial each), so ALL
 * repeated props bake into ONE merged mesh per kind — the whole three-site
 * district renders as ~55 draw calls total. Files preload in the
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
  arrowBoard: "/models/construction/arrow-board-2eea6b.glb",
  skip: "/models/construction/builder-s-skip-191d35.glb",
  // ── the rest of the kit (the official scene composition uses these too) ──
  metalDeck: "/models/construction/metal-deck-floor-plate-6cdd1c.glb",
  formwork: "/models/construction/formwork-wall-panel-run-52e9f5.glb",
  scaffoldStack: "/models/construction/scaffold-material-stack-836dd2.glb",
  dumpyBag: "/models/construction/builder-s-dumpy-bag-89fd1b.glb",
  slabTile: "/models/construction/fresh-concrete-slab-tile-66b6a8.glb",
  hardcoreTile: "/models/construction/compacted-hardcore-tile-a7a8ee.glb",
  trenchPlate: "/models/construction/trench-plate-30c3a3.glb",
  walkwayTunnel: "/models/construction/pedestrian-walkway-tunnel-0b194e.glb",
  loadingGantry: "/models/construction/loading-gantry-34460f.glb",
  smokingShelter: "/models/construction/smoking-shelter-7e149f.glb",
  toolVault: "/models/construction/site-tool-vault-200e38.glb",
  cementMixerStand: "/models/construction/cement-mixer-on-a-8fb979.glb",
  airCompressor: "/models/construction/towed-air-compressor-11f9ea.glb",
  compactorPlate: "/models/construction/compactor-plate-e76b28.glb",
  waterBowser: "/models/construction/water-bowser-f6768c.glb",
  wheelWash: "/models/construction/wheel-wash-d1ca0f.glb",
  telehandler: "/models/construction/telehandler-88c668.glb",
  siteDumper: "/models/construction/rigid-site-dumper-224eb0.glb",
  skidSteer: "/models/construction/skid-steer-loader-268f4d.glb",
  wheeledLoader: "/models/construction/wheeled-loader-29dc45.glb",
  miniExcavator: "/models/construction/mini-excavator-cbe1ae.glb",
  bulldozer: "/models/construction/crawler-bulldozer-b851fb.glb",
  mobileCrane: "/models/construction/mobile-crane-671d3f.glb",
  flatbedLorry: "/models/construction/flatbed-delivery-lorry-571458.glb",
  concretePump: "/models/construction/concrete-pump-c073ef.glb",
  cherryPicker: "/models/construction/cherry-picker-38c4af.glb",
  scissorLift: "/models/construction/scissor-lift-platform-3eae3f.glb",
  trencher: "/models/construction/chain-trencher-215857.glb",
} as const;

export type ConstructionKind = keyof typeof FILES;

/** props whose authored ORIGIN is their mechanical pivot — the loader must NOT
 *  re-centre them in x/z (only ground Y), because their placement + the live
 *  slewing rotation pivot on that exact point. The tower-crane top is authored
 *  around its slewing-ring axis (ring at x/z ±1.5, apex ±0.6, jib hanging far
 *  out to −x): re-centring would shove the ring ~11 m off the mast head AND
 *  make the swing orbit the wrong pivot. */
const PIVOT_AT_ORIGIN = new Set<ConstructionKind>(["craneTop"]);

export interface ConstructionRig {
  template: THREE.Group;
  /** authored size (metres) — placement code scales models to fit the site */
  size: THREE.Vector3;
  /** the model's authored minimum Y BEFORE grounding — the loader lifts every
   *  model so its lowest vertex sits at y=0, so a prop with hanging parts
   *  (the crane top's hook + cables hang ~2m below its slewing ring) renders
   *  `−groundY` higher than authored. Mount points (crane top → mast) must
   *  add this back to seat the ring exactly on the mast head. */
  groundY: number;
}

const cache = new Map<ConstructionKind, ConstructionRig>();
let started = false;
let readyCount = 0;
let failedCount = 0;
const readyCbs: (() => void)[] = [];

function notify() {
  // settle = loaded OR failed — one dead URL must never hold the whole
  // construction district hostage (the ready callback would wait forever
  // and the sites would never bake)
  const settled = cache.size + failedCount;
  if (settled >= Object.keys(FILES).length) {
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
        // the box is computed BEFORE wrapping so grounding is exact.
        // PIVOT_AT_ORIGIN props keep their authored x/z (mechanical pivot),
        // everything else centres on its footprint
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const groundY = box.min.y; // remember the authored low point (crane top's hook hangs below its ring)
        const pivot = PIVOT_AT_ORIGIN.has(kind);
        scene.position.set(pivot ? 0 : -center.x, -box.min.y, pivot ? 0 : -center.z);
        const wrap = new THREE.Group();
        wrap.add(scene);
        wrap.updateMatrixWorld(true);
        cache.set(kind, { template: wrap, size, groundY });
        notify();
      },
      undefined,
      () => { failedCount++; /* a failed model just means that prop is skipped — never crash the game */ console.error("[construction-kit] GLB failed to load:", FILES[kind]); notify(); },
    );
  }
}

export const constructionProgress = () => ({ ready: readyCount, total: Object.keys(FILES).length });

/** true once every model has SETTLED (loaded or failed) — the caller can
 *  stop waiting for further rebakes (failed kinds bake as nothing). */
export const constructionAllSettled = (): boolean => cache.size + failedCount >= Object.keys(FILES).length;

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

/** A fresh CLONE of one kit template (shares geometry + material) — used for
 *  the live crane tops, which must rotate independently of the baked mesh.
 *  Returns null while the model is still streaming in. */
export function cloneConstructionModel(kind: ConstructionKind): THREE.Group | null {
  const rig = cache.get(kind);
  if (!rig) return null;
  return rig.template.clone();
}

/** The authored minimum-Y the loader lifted this model by — a mount point
 *  (crane slewing top onto the mast head) adds it back so the parts that
 *  hang BELOW the seating plane (hook + cables) don't leave the ring floating
 *  above the tower. 0 while the model is still streaming in. */
export function constructionGroundY(kind: ConstructionKind): number {
  return cache.get(kind)?.groundY ?? 0;
}

/** The authored size of one kit model (metres) — night-light seating reads the
 *  light-tower / traffic-light heights off it instead of hardcoding. 0-size
 *  while the model is still streaming in. */
export function constructionSize(kind: ConstructionKind): THREE.Vector3 {
  return cache.get(kind)?.size ?? new THREE.Vector3();
}

/** Fire the callback when every construction model has SETTLED (loaded or
 *  failed; fires immediately if so). Returns an unsubscribe fn — the caller's
 *  cleanup must always be callable. */
export function onConstructionModelsReady(cb: () => void): () => void {
  if (constructionAllSettled()) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
