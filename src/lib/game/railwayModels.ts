/**
 * 🚂 polyfork Countryside Railway kit GLB loader — the branch line through the
 * farm band becomes a REAL country station (see RAILKIT in worldgen).
 *
 * Models from the countryside-railway kit
 * (https://polyfork.dev/kit/countryside-railway-9b4c57, CC BY 4.0 — see
 * public/models/CREDITS.md): 4m straight-track sections carry the whole arc
 * (ballast + twin rails + sleepers in one baked mesh), the blue country
 * station building fronts a real platform (runs, canopy, shelter, benches,
 * lamp posts, clock post, bookstall, poster boards, barrow, trolley), the
 * station footbridge spans the rails, the goods yard hides an engine shed +
 * goods shed behind the water tower, coal stage, pump house, weighbridge,
 * yard crane, fuel tank, cattle dock and a 20m turntable, semaphore + disc
 * signals guard the line, the level crossing gets its keeper's cottage and
 * gates, and the 15:07 is REAL rolling stock — tank locomotive, coal tender,
 * two coaches and a brake van, with a full goods rake parked down the line.
 *
 * Every model is vertex-coloured (one MeshStandardMaterial each), so ALL
 * repeated props bake into ONE merged mesh per kind. Kit characters are
 * skinned — they spawn as independent clones with idle mixers (distance
 * gated by the caller). Files preload in the background; a failed model
 * just skips that prop, never crashes the game.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

const FILES = {
  // track & line furniture
  track: "/models/railway/straight-track-d4cf38.glb",
  bufferStop: "/models/railway/buffer-stop-4871fc.glb",
  poleRun: "/models/railway/railway-telegraph-pole-run-bb9354.glb",
  fenceRun: "/models/railway/lineside-fence-run-3a64f5.glb",
  hut: "/models/railway/lineside-hut-2b43ff.glb",
  tree: "/models/railway/lineside-tree-97e02a.glb",
  signPost: "/models/railway/lineside-sign-post-7a08b9.glb",
  semaphore: "/models/railway/semaphore-signal-cb8968.glb",
  discSignal: "/models/railway/ground-disc-signal-3d52e9.glb",
  // station
  stationBuilding: "/models/railway/country-station-building-2d8f5e.glb",
  platformRun: "/models/railway/platform-run-3738d0.glb",
  canopyRun: "/models/railway/platform-canopy-run-bc2275.glb",
  shelter: "/models/railway/platform-shelter-9582b6.glb",
  bench: "/models/railway/station-bench-5f56b4.glb",
  clockPost: "/models/railway/station-clock-post-eaaf63.glb",
  lampPost: "/models/railway/station-lamp-post-7d14dd.glb",
  bookstall: "/models/railway/platform-bookstall-8598bf.glb",
  posterBoard: "/models/railway/platform-poster-board-271c7a.glb",
  barrow: "/models/railway/platform-barrow-784665.glb",
  trolley: "/models/railway/luggage-trolley-0bb740.glb",
  footbridge: "/models/railway/station-footbridge-dfb6b8.glb",
  gardenBed: "/models/railway/station-garden-bed-d369e3.glb",
  runningBoard: "/models/railway/a-running-in-board-e66b1e.glb",
  // goods yard
  engineShed: "/models/railway/engine-shed-eff627.glb",
  goodsShed: "/models/railway/goods-shed-206be9.glb",
  waterTower: "/models/railway/water-tower-dd6200.glb",
  waterCrane: "/models/railway/water-crane-6ab467.glb",
  pumpHouse: "/models/railway/water-pump-house-121270.glb",
  coalStage: "/models/railway/coal-stage-2789f5.glb",
  coalBin: "/models/railway/coal-merchant-s-bin-c79aea.glb",
  signalBox: "/models/railway/signal-box-f57a2d.glb",
  weighbridge: "/models/railway/goods-yard-weighbridge-c5c04c.glb",
  fuelTank: "/models/railway/depot-fuel-tank-55a00e.glb",
  yardCrane: "/models/railway/yard-crane-316e4a.glb",
  cattleDock: "/models/railway/cattle-dock-6e41e4.glb",
  turntable: "/models/railway/turntable-6415d2.glb",
  loadingGauge: "/models/railway/loading-gauge-bde2e7.glb",
  sleeperStack: "/models/railway/sleeper-stack-67628e.glb",
  railStack: "/models/railway/spare-rail-stack-99d443.glb",
  ballastHeap: "/models/railway/ballast-heap-2fb138.glb",
  // crossing
  levelCrossing: "/models/railway/level-crossing-37d00b.glb",
  crossingGate: "/models/railway/crossing-gate-50bcee.glb",
  cottage: "/models/railway/crossing-keeper-s-cottage-de49a4.glb",
  // rolling stock
  tankLoco: "/models/railway/tank-steam-locomotive-314bb1.glb",
  coalTender: "/models/railway/coal-tender-0e3647.glb",
  coach: "/models/railway/passenger-carriage-de9d58.glb",
  brakeCoach: "/models/railway/brake-coach-f83456.glb",
  goodsVan: "/models/railway/covered-goods-van-34fce3.glb",
  openWagon: "/models/railway/open-goods-wagon-998292.glb",
  cattleWagon: "/models/railway/cattle-wagon-0d3070.glb",
  flatWagon: "/models/railway/flatbed-wagon-53187a.glb",
  hopperWagon: "/models/railway/hopper-wagon-b4c486.glb",
  tankWagon: "/models/railway/tank-wagon-d860fa.glb",
  guardsVan: "/models/railway/guard-s-van-6231d0.glb",
  shunter: "/models/railway/diesel-shunter-67094b.glb",
  handcar: "/models/railway/handcar-3e4083.glb",
  railbus: "/models/railway/railbus-e972f3.glb",
  // the crew (skinned)
  stationMaster: "/models/railway/station-master-1d6a0a.glb",
  crossingKeeper: "/models/railway/crossing-keeper-e13207.glb",
  platelayer: "/models/railway/platelayer-47dbe6.glb",
  engineDriver: "/models/railway/engine-driver-1ba1e2.glb",
  fireman: "/models/railway/fireman-96bf23.glb",
  passenger: "/models/railway/passenger-ac425a.glb",
  trainspotter: "/models/railway/trainspotter-ffd141.glb",
} as const;

export type RailwayKind = keyof typeof FILES;
/** the kit characters are skinned — they need SkeletonUtils clones + a mixer */
const SKINNED = new Set<RailwayKind>([
  "stationMaster", "crossingKeeper", "platelayer", "engineDriver", "fireman", "passenger", "trainspotter",
]);

export interface RailwayRig {
  template: THREE.Group;
  size: THREE.Vector3;
  clips: Record<string, THREE.AnimationClip>;
  skinned: boolean;
}

const cache = new Map<RailwayKind, RailwayRig>();
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
export function preloadRailwayModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as RailwayKind[]) {
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
      () => { /* a failed model just means that prop is skipped — never crash the game */ console.error("[railway-kit] GLB failed to load:", FILES[kind]); },
    );
  }
}

export const railwayProgress = () => ({ ready: readyCount, total: Object.keys(FILES).length });

/** True once this kind's GLB has been parsed and normalized. */
export const isRailwayModelReady = (kind: string): boolean =>
  kind in FILES && cache.has(kind as RailwayKind);

/** A fresh independent clone of the kit model, or null while loading.
 *  Skinned characters get a SkeletonUtils clone + a playing Idle mixer. */
export function spawnRailwayModel(kind: string): { root: THREE.Group; mixer: THREE.AnimationMixer | null; clips: Record<string, THREE.AnimationClip> } | null {
  const rig = cache.get(kind as RailwayKind);
  if (!rig) return null;
  const root = rig.skinned ? SkeletonUtils.clone(rig.template) : rig.template.clone(true);
  let mixer: THREE.AnimationMixer | null = null;
  if (rig.skinned) {
    mixer = new THREE.AnimationMixer(root);
    const idle = rig.clips["idle"];
    if (idle) mixer.clipAction(idle).play();
  }
  return { root, mixer, clips: rig.clips };
}

export interface RailwayPlacement {
  x: number; y?: number; z: number;
  /** yaw (radians) — rot = the arc tangent turns the model's +z along the line */
  rot?: number;
  /** uniform scale, default 1 */
  s?: number;
}

/**
 * Bake MANY placements of one kit kind into a single merged mesh — the ~465
 * straight-track sections carrying the whole branch line collapse into ONE
 * draw call, as do the pole runs, fences and everything repeated. All
 * Countryside-Railway models are vertex-coloured, so one vertexColors Lambert
 * material carries every baked instance.
 * Returns null while still loading.
 */
export function bakeRailwayModel(kind: RailwayKind, placements: RailwayPlacement[]): THREE.Mesh | null {
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

/** Fire the callback when every railway model is in (or immediately if so).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onRailwayModelsReady(cb: () => void): () => void {
  if (readyCount >= Object.keys(FILES).length) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}
