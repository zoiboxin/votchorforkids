/**
 * 🦕 Prehistoric Valley — polyfork prehistoric-valley-8638dc kit (GLB).
 *
 * The south-west arc of the playable mountain band opens into a wide
 * prehistoric valley (the sector's peaks are carved away in worldgen —
 * MT_PEAKS skips this arc — so the rolling mud-valley floor stays open and
 * walkable). This module owns EVERYTHING valley:
 *
 *  1. the kit loader (39 static props + 6 dinosaurs, lazy-streamed from
 *     public/models/prehistoric — started only when the player gets close,
 *     see <PrehistoricValley> in PrehistoricValley.tsx),
 *  2. the deterministic valley layout PREHISTORIC_LAYOUT — landmark clusters
 *     (geyser row, tar pits, herd meadow, raptor ridge, bone field, nesting
 *     grounds, hot spring) plus a per-kind scatter of cycads, tree ferns,
 *     dawn redwoods, boulders, petrified logs… all generated from its own
 *     mulberry32 stream so the world's shared RNG never shifts a single draw,
 *  3. prehistoricColliders() — the solid circles worldgen pushes (geysers,
 *     tar pits, the big bones… and the four BIG dinosaurs).
 *
 * Kit convention (same as the hospital kit): models face +z at rot 0, every
 * part is vertex-coloured, statics bake into ONE merged mesh per kind and the
 * six dinosaurs are skinned with Idle/Walk/Run clips. Sizes are authored at
 * real-world scale (T-rex stands 4.5u tall) so s=1 reads right next to the
 * player. Models: https://polyfork.dev/kit/prehistoric-valley-8638dc (CC BY 4.0).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PREHISTORIC } from "./constants";
import { mulberry32, range } from "./rng";

const FILES = {
  /* --- flora --- */
  araucaria: "/models/prehistoric/araucaria-monkey-puzzle-7c109d.glb",
  cycad: "/models/prehistoric/cycad-05ad50.glb",
  dawnRedwood: "/models/prehistoric/dawn-redwood-001c29.glb",
  treeFern: "/models/prehistoric/tree-fern-78320e.glb",
  fernClump: "/models/prehistoric/fern-clump-90ff4b.glb",
  horsetail: "/models/prehistoric/giant-horsetail-stand-3a4f94.glb",
  magnolia: "/models/prehistoric/flowering-magnolia-dd76cb.glb",
  ginkgo: "/models/prehistoric/ginkgo-tree-baa895.glb",
  williamsonia: "/models/prehistoric/williamsonia-7b0a4f.glb",
  williamsoniella: "/models/prehistoric/williamsoniella-flowering-shrub-dc53ae.glb",
  clubMoss: "/models/prehistoric/club-moss-mat-edcb1b.glb",
  mushroom: "/models/prehistoric/giant-mushroom-cluster-868de6.glb",
  scorchedTree: "/models/prehistoric/scorched-tree-e927a3.glb",
  deadSnag: "/models/prehistoric/dead-snag-0b1891.glb",
  /* --- rocks & wood --- */
  basalt: "/models/prehistoric/basalt-column-outcrop-f1339d.glb",
  volcanic: "/models/prehistoric/volcanic-boulder-cluster-7e29ea.glb",
  lavaRock: "/models/prehistoric/lava-rock-pile-d56d19.glb",
  obsidian: "/models/prehistoric/obsidian-shard-cluster-c8f5d3.glb",
  geode: "/models/prehistoric/mineral-geode-cluster-299927.glb",
  fernBoulder: "/models/prehistoric/fern-covered-boulder-2e0375.glb",
  petrifiedLog: "/models/prehistoric/petrified-log-413693.glb",
  hollowLog: "/models/prehistoric/hollow-log-329fd7.glb",
  mossStump: "/models/prehistoric/moss-covered-stump-7253ab.glb",
  riverStone: "/models/prehistoric/river-stone-cluster-0b55bc.glb",
  /* --- thermal features --- */
  geyser: "/models/prehistoric/geyser-cone-2b5033.glb",
  fumarole: "/models/prehistoric/fumarole-vent-8280ba.glb",
  mudPool: "/models/prehistoric/bubbling-mud-pool-a1c8ac.glb",
  tarPit: "/models/prehistoric/tar-pit-d040f3.glb",
  hotSpring: "/models/prehistoric/hot-spring-pool-26312c.glb",
  termiteMound: "/models/prehistoric/termite-mound-9bc94b.glb",
  amber: "/models/prehistoric/amber-lump-f3a85d.glb",
  /* --- fossils & nests --- */
  bonePile: "/models/prehistoric/dinosaur-bone-pile-3c285a.glb",
  skull: "/models/prehistoric/dinosaur-skull-4c3a3c.glb",
  ribcage: "/models/prehistoric/fossil-ribcage-b243c5.glb",
  trackway: "/models/prehistoric/dinosaur-trackway-f0aec5.glb",
  dinoNest: "/models/prehistoric/dinosaur-nest-2be2b8.glb",
  sauropodMound: "/models/prehistoric/sauropod-nest-mound-36a0eb.glb",
  eggClutch: "/models/prehistoric/loose-egg-clutch-8685d2.glb",
  hatchingEgg: "/models/prehistoric/hatching-egg-ff3379.glb",
  /* --- 🦕 the locals (skinned, Idle/Walk/Run) --- */
  rex: "/models/prehistoric/tyrannosaurus-rex-adf79f.glb",
  trike: "/models/prehistoric/triceratops-6ce6f5.glb",
  stego: "/models/prehistoric/stegosaurus-96f08c.glb",
  para: "/models/prehistoric/parasaurolophus-c27741.glb",
  velo: "/models/prehistoric/velociraptor-094793.glb",
  compy: "/models/prehistoric/compsognathus-c8975e.glb",
} as const;

export type PrehistoricKind = keyof typeof FILES;
/** the six locals are skinned — SkeletonUtils clones + mixers, everything else bakes */
const SKINNED = new Set<PrehistoricKind>(["rex", "trike", "stego", "para", "velo", "compy"]);

export interface PrehistoricRig {
  template: THREE.Group;
  size: THREE.Vector3;
  clips: Record<string, THREE.AnimationClip>;
  skinned: boolean;
}

const cache = new Map<PrehistoricKind, PrehistoricRig>();
let started = false;
const readyCbs: (() => void)[] = [];

function notify() {
  if (cache.size >= Object.keys(FILES).length) for (const cb of readyCbs.splice(0)) cb();
}

/** Begin the background preload (safe to call repeatedly; no-op on the server).
 *  Started LAZILY — only once the player closes in on the valley — so nobody
 *  ever downloads 45 kit GLBs they never walk up to see. */
export function preloadPrehistoricModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const kind of Object.keys(FILES) as PrehistoricKind[]) {
    loader.load(
      FILES[kind],
      (gltf) => {
        const scene = gltf.scene;
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = false; }
        });
        // ground the model (origin at its turf contact point), centre x/z
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
      () => { /* a failed model just skips that prop — never crash the game */ console.error("[prehistoric-kit] GLB failed to load:", FILES[kind]); },
    );
  }
}

/** True once this kind's GLB has been parsed and normalized. */
export const isPrehistoricModelReady = (kind: string): boolean =>
  kind in FILES && cache.has(kind as PrehistoricKind);

/** A fresh independent clone of the kit model, or null while loading.
 *  Dinosaurs get a SkeletonUtils clone + a mixer the caller drives (so it can
 *  switch between Idle and Walk); statics get a plain clone. */
export function spawnPrehistoricModel(kind: string): { root: THREE.Object3D; mixer: THREE.AnimationMixer | null; clips: Record<string, THREE.AnimationClip> } | null {
  const rig = cache.get(kind as PrehistoricKind);
  if (!rig) return null;
  const root = rig.skinned ? skeletonClone(rig.template) : rig.template.clone(true);
  let mixer: THREE.AnimationMixer | null = null;
  if (rig.skinned) mixer = new THREE.AnimationMixer(root);
  return { root, mixer, clips: rig.clips };
}

/** Bake MANY placements of one kit kind into a single merged mesh — every
 *  valley prop kind renders as ONE draw call (vertex-coloured Lambert).
 *  Returns null while still loading. */
export function bakePrehistoricModel(kind: PrehistoricKind, placements: PrehistoricPlacement[]): THREE.Mesh | null {
  const rig = cache.get(kind);
  if (!rig || placements.length === 0) return null;
  const parts: { geo: THREE.BufferGeometry; rel: THREE.Matrix4 }[] = [];
  rig.template.updateMatrixWorld(true);
  rig.template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const rel = mesh.matrixWorld.clone()
      .premultiply(rig.template.matrixWorld.clone().invert());
    parts.push({ geo: mesh.geometry.clone(), rel });
  });
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  for (const p of placements) {
    e.set(0, p.rot, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, one.clone().multiplyScalar(p.s));
    for (const { geo, rel } of parts) {
      const g = geo.clone().applyMatrix4(rel).applyMatrix4(m);
      if (!g.attributes.color) {
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

/** Fire the callback when every kit model is in (or immediately if so).
 *  Returns an unsubscribe fn — the caller's cleanup must always be callable. */
export function onPrehistoricModelsReady(cb: () => void): () => void {
  if (cache.size >= Object.keys(FILES).length) { cb(); return () => {}; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}

/* =====================================================================
 *  THE VALLEY LAYOUT — deterministic, own RNG stream, zero world impact
 * =====================================================================
 *  Polar frame: the valley is the sector PREHISTORIC (a0..a1 rad, rIn..rOut).
 *  Landmark clusters sit on hand-picked (angle, radius) anchors along the
 *  arc; the per-kind scatter fills the rest with min-distance rules.        */

export interface PrehistoricPlacement { x: number; z: number; rot: number; s: number }
export interface PrehistoricDino {
  kind: "rex" | "trike" | "stego" | "para" | "velo" | "compy";
  x: number; z: number; rot: number; s: number;
  /** null → stationary grazer (big locals, colliders pushed); otherwise the
   *  little locals pad around these points with the Walk clip. */
  wander: { x: number; z: number }[] | null;
  /** walk speed (u/s) — herd animals amble, raptors prowl */
  walkS: number;
}
export interface PrehistoricLayout {
  props: { [K in Exclude<PrehistoricKind, "rex" | "trike" | "stego" | "para" | "velo" | "compy">]: PrehistoricPlacement[] };
  dinos: PrehistoricDino[];
  /** solid circles worldgen pushes into the collider grid */
  colliders: { x: number; z: number; r: number }[];
}

const pol = (a: number, r: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
/** face a kit model (front = +z at rot 0) toward a world point */
const faceTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

export const PREHISTORIC_LAYOUT: PrehistoricLayout = (() => {
  const rnd = mulberry32(0x00CAFE + 4242); // dedicated stream — the world's RNG never feels this
  const props: Record<string, PrehistoricPlacement[]> = {};
  const add = (kind: string, x: number, z: number, rot: number, s: number) =>
    (props[kind] ??= []).push({ x, z, rot, s });
  const dinos: PrehistoricDino[] = [];
  const colliders: { x: number; z: number; r: number }[] = [];

  /* cluster anchors along the arc — hand-tuned so the valley reads as a
   * journey: steam vents → tar pits → herd meadow → raptor ridge → bone
   * field → nesting grounds → hot spring, all linked by a trackway trail. */
  const CL = {
    geyserRow: pol(2.42, 648),
    tarPits: pol(2.62, 660),
    herdMeadow: pol(2.52, 640),
    raptorRidge: pol(2.30, 668),
    boneField: pol(2.72, 650),
    nesting: pol(2.47, 672),
    hotSpring: pol(2.35, 635),
  };
  /** scatter keeps off these cores (r per cluster) so landmarks breathe */
  const cores: { x: number; z: number; r: number }[] = [
    { ...CL.geyserRow, r: 12 }, { ...CL.tarPits, r: 13 }, { ...CL.herdMeadow, r: 11 },
    { ...CL.raptorRidge, r: 10 }, { ...CL.boneField, r: 11 }, { ...CL.nesting, r: 10 },
    { ...CL.hotSpring, r: 9 },
  ];
  const inCore = (x: number, z: number, pad = 0) =>
    cores.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

  /* ---------------- landmarks: the geyser row ---------------- */
  {
    const { x: cx, z: cz } = CL.geyserRow;
    add("geyser", cx - 6, cz + 2, 0.4, 1.55);
    add("geyser", cx, cz, -0.2, 1.8);
    add("geyser", cx + 7, cz - 1, 0.9, 1.4);
    add("fumarole", cx + 3.5, cz + 4.5, 1.2, 1.2);
    add("fumarole", cx - 4, cz + 5.5, -0.8, 1.1);
    add("basalt", cx - 11, cz + 3, 0.6, 2.2);            // the ridge sentinel column
    add("volcanic", cx + 11, cz + 3, 1.7, 1.5);
    add("lavaRock", cx + 2, cz - 5, 0.3, 1.6);
    add("lavaRock", cx - 8, cz - 4, 2.1, 1.3);
    add("amber", cx + 5.5, cz + 6, 0, 1.2);
    colliders.push({ x: cx, z: cz, r: 1.5 }, { x: cx - 6, z: cz + 2, r: 1.3 }, { x: cx + 7, z: cz - 1, r: 1.2 });
  }
  /* ---------------- landmarks: the tar pits (La Brea of the valley) ---------------- */
  {
    const { x: cx, z: cz } = CL.tarPits;
    add("tarPit", cx, cz, 0.15, 1.8);
    add("tarPit", cx - 7.5, cz - 3, 0.9, 1.5);
    add("tarPit", cx + 6, cz + 4, -0.5, 1.4);
    add("bonePile", cx - 3, cz + 6.5, 0.5, 1.3);         // the tar claimed them
    add("ribcage", cx - 10, cz + 7, -0.7, 1.8);
    add("skull", cx + 3.5, cz + 8.5, 1.1, 1.6);
    add("deadSnag", cx + 12, cz - 4, 0.8, 1.0);
    for (const t of [{ x: cx, z: cz }, { x: cx - 7.5, z: cz - 3 }, { x: cx + 6, z: cz + 4 }])
      colliders.push({ x: t.x, z: t.z, r: 1.7 });
    // 🦖 the tyrant lizard overlooks its pantry — static, solid, roaring idle
    const rx = CL.tarPits.x, rz = CL.tarPits.z;
    const rp = pol(2.585, 649.5);
    dinos.push({ kind: "rex", x: rp.x, z: rp.z, rot: faceTo(rp.x, rp.z, rx, rz), s: 1, wander: null, walkS: 0 });
    colliders.push({ x: rp.x, z: rp.z, r: 2.0 });
  }
  /* ---------------- landmarks: the herd meadow ---------------- */
  {
    const { x: cx, z: cz } = CL.herdMeadow;
    add("mudPool", cx, cz, 0.2, 1.7);
    add("mudPool", cx - 6.5, cz + 2, 1.4, 1.35);
    add("mudPool", cx + 5.5, cz - 2.5, -0.9, 1.45);
    add("horsetail", cx + 3, cz + 4, 0.7, 1.1);
    add("horsetail", cx - 3.5, cz - 4, 1.9, 0.95);
    add("cycad", cx + 9, cz + 3, 0.4, 1.1);
    add("cycad", cx - 9, cz - 2, 1.3, 0.95);
    add("clubMoss", cx + 4, cz - 5.5, 0.2, 2.2);
    // the herd: two parasaurolophus graze the pools, two triceratops watch the trackway
    const p1 = { x: cx - 3, z: cz - 6 }, p2 = { x: cx + 2.5, z: cz + 6.5 };
    const t1 = { x: cx + 8, z: cz - 7 }, t2 = { x: cx - 11, z: cz + 6 };
    dinos.push(
      { kind: "para", x: p1.x, z: p1.z, rot: faceTo(p1.x, p1.z, cx, cz), s: 1, wander: null, walkS: 0 },
      { kind: "para", x: p2.x, z: p2.z, rot: faceTo(p2.x, p2.z, cx - 6.5, cz + 2), s: 0.94, wander: null, walkS: 0 },
      { kind: "trike", x: t1.x, z: t1.z, rot: faceTo(t1.x, t1.z, cx, cz), s: 1, wander: null, walkS: 0 },
      { kind: "trike", x: t2.x, z: t2.z, rot: faceTo(t2.x, t2.z, cx, cz), s: 0.92, wander: null, walkS: 0 },
    );
    for (const d of [{ ...p1, r: 1.8 }, { ...p2, r: 1.7 }, { ...t1, r: 1.8 }, { ...t2, r: 1.7 }])
      colliders.push({ x: d.x, z: d.z, r: d.r });
  }
  /* ---------------- landmarks: raptor ridge ---------------- */
  {
    const { x: cx, z: cz } = CL.raptorRidge;
    add("basalt", cx, cz, -0.4, 1.45);
    add("basalt", cx + 4.5, cz + 2.5, 0.9, 1.15);
    add("obsidian", cx - 4, cz - 2, 0.3, 1.6);
    add("obsidian", cx + 2, cz - 4, 1.5, 1.4);
    add("geode", cx - 6.5, cz + 3.5, 0.8, 1.5);
    add("fernBoulder", cx + 7, cz - 3, 0.5, 1.4);
    // 🦖 the pack: three velociraptors prowl their ridge (little locals wander)
    const home = { x: cx + 1, z: cz + 6 };
    const pts = [
      { x: home.x + 7, z: home.z + 4 }, { x: home.x - 6, z: home.z + 7 },
      { x: home.x - 8, z: home.z - 5 }, { x: home.x + 5, z: home.z - 6 },
    ];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      dinos.push({
        kind: "velo", x: home.x + Math.cos(a) * 3, z: home.z + Math.sin(a) * 3,
        rot: faceTo(home.x, home.z, pts[i].x, pts[i].z), s: 1.08, wander: pts, walkS: 2.1,
      });
    }
    colliders.push({ x: cx, z: cz, r: 1.3 });
  }
  /* ---------------- landmarks: the bone field ---------------- */
  {
    const { x: cx, z: cz } = CL.boneField;
    add("ribcage", cx, cz, 0.3, 2.0);                    // the old giant
    add("skull", cx - 4.5, cz + 3, 0.9, 1.8);
    add("bonePile", cx + 4, cz + 4.5, -0.4, 1.4);
    add("bonePile", cx - 7, cz - 3, 1.6, 1.2);
    add("sauropodMound", cx + 8.5, cz - 5, 0.2, 1.6);
    add("petrifiedLog", cx + 2, cz - 6, 0.9, 2.2);
    add("mossStump", cx - 9, cz + 1, 0.7, 1.3);
    colliders.push({ x: cx, z: cz, r: 1.9 }, { x: cx - 4.5, z: cz + 3, r: 1.0 });
    // 🦖 a stegosaurus browses the field's edge, back to the wall
    const sp = pol(2.735, 656.5);
    dinos.push({ kind: "stego", x: sp.x, z: sp.z, rot: faceTo(sp.x, sp.z, cx, cz), s: 1, wander: null, walkS: 0 });
    colliders.push({ x: sp.x, z: sp.z, r: 1.9 });
  }
  /* ---------------- landmarks: the nesting grounds ---------------- */
  {
    const { x: cx, z: cz } = CL.nesting;
    add("sauropodMound", cx - 4, cz, 0.5, 1.7);
    add("sauropodMound", cx + 5, cz + 3, -0.8, 1.4);
    add("dinoNest", cx + 1, cz - 3.5, 0.3, 1.2);
    add("dinoNest", cx - 6.5, cz - 4, 1.2, 1.05);
    add("dinoNest", cx + 7, cz - 2, -1.1, 1.15);
    add("eggClutch", cx + 1, cz - 3.5, 0.9, 1.5);
    add("eggClutch", cx - 6.5, cz - 4, -0.3, 1.4);
    add("eggClutch", cx + 7, cz - 2, 1.8, 1.45);
    add("hatchingEgg", cx - 1.5, cz + 5, 0.4, 1.4);      // one is hatching!
    add("termiteMound", cx + 10, cz + 5, 0.7, 1.4);
    add("mushroom", cx - 9, cz + 6, 0.5, 1.3);
    colliders.push({ x: cx - 4, z: cz, r: 1.6 }, { x: cx + 5, z: cz + 3, r: 1.4 });
    // 🦖 four compsognathus scuttle the grounds — the valley's chickens
    const home = { x: cx, z: cz + 7 };
    const pts = [
      { x: home.x + 6, z: home.z + 3 }, { x: home.x - 7, z: home.z + 2 },
      { x: home.x - 5, z: home.z - 6 }, { x: home.x + 4, z: home.z - 7 },
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      dinos.push({
        kind: "compy", x: home.x + Math.cos(a) * 2.5, z: home.z + Math.sin(a) * 2.5,
        rot: faceTo(home.x, home.z, pts[i].x, pts[i].z), s: 1, wander: pts, walkS: 1.9,
      });
    }
  }
  /* ---------------- landmarks: the hot spring ---------------- */
  {
    const { x: cx, z: cz } = CL.hotSpring;
    add("hotSpring", cx, cz, 0.2, 1.5);
    add("riverStone", cx + 3.5, cz + 2.5, 0.8, 1.8);
    add("riverStone", cx - 3, cz - 3, -0.6, 1.6);
    add("termiteMound", cx - 7, cz + 4, 0.4, 1.2);
    add("clubMoss", cx + 6, cz - 3, 0.1, 2.0);
    colliders.push({ x: cx, z: cz, r: 1.8 });
  }
  /* ---------------- the trackway trail — someone HUGE passed through ---------------- */
  {
    const a0 = 2.265, a1 = 2.775, r0 = 621, r1 = 683, N = 15;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const a = a0 + (a1 - a0) * t;
      const r = r0 + (r1 - r0) * t + Math.sin(t * Math.PI * 2.2) * 7;
      const p = pol(a, r);
      // tiles lie along the walk direction (tangent of the arc)
      add("trackway", p.x, p.z, -a + Math.PI / 2, 2.3);
    }
  }

  /* ---------------- the wild scatter — prehistoric undergrowth & rocks ---------------- */
  const placed: { x: number; z: number }[] = [...cores, ...colliders];
  /** every scatter point: inside the sector, off the landmark cores, off the
   *  trackway, and not stacked on an earlier prop */
  const spot = (minR: number): { x: number; z: number } | null => {
    for (let tries = 0; tries < 60; tries++) {
      const a = range(rnd, PREHISTORIC.a0 + 0.03, PREHISTORIC.a1 - 0.03);
      const r = range(rnd, PREHISTORIC.rIn + 6, PREHISTORIC.rOut - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (inCore(x, z, 1.5)) continue;
      const t = (a - 2.265) / (2.775 - 2.265);
      if (t > -0.02 && t < 1.02) {
        const rr = 621 + (683 - 621) * Math.max(0, Math.min(1, t)) + Math.sin(Math.max(0, Math.min(1, t)) * Math.PI * 2.2) * 7;
        if (Math.hypot(Math.cos(a) * r - Math.cos(a) * rr, Math.sin(a) * r - Math.sin(a) * rr) < 4) continue;
      }
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minR)) continue;
      placed.push({ x, z });
      return { x, z };
    }
    return null;
  };
  /** scatter a kind n times between two scales, facing anywhere */
  const scatter = (kind: string, n: number, s0: number, s1: number, minR = 3.4) => {
    for (let i = 0; i < n; i++) {
      const p = spot(minR);
      if (p) add(kind, p.x, p.z, range(rnd, 0, Math.PI * 2), range(rnd, s0, s1));
    }
  };

  /* trees — an open woodland of kit conifers & early angiosperms */
  scatter("dawnRedwood", 13, 0.62, 0.95, 6);
  scatter("araucaria", 9, 0.5, 0.78, 6.5);
  scatter("ginkgo", 11, 0.68, 1.0, 5.5);
  scatter("treeFern", 15, 0.72, 1.15, 4.5);
  scatter("magnolia", 7, 0.8, 1.1, 5.5);
  scatter("scorchedTree", 4, 0.7, 1.0, 6);
  scatter("deadSnag", 7, 0.8, 1.2, 5);
  /* mid storey */
  scatter("cycad", 18, 0.8, 1.4, 3.2);
  scatter("horsetail", 14, 0.7, 1.2, 3.0);
  scatter("williamsonia", 12, 0.7, 1.2, 3.2);
  scatter("williamsoniella", 14, 0.8, 1.4, 3.0);
  /* ground cover */
  scatter("clubMoss", 18, 1.4, 2.6, 2.6);
  scatter("fernClump", 24, 0.9, 1.7, 2.6);
  scatter("mushroom", 9, 0.9, 1.6, 2.6);
  scatter("riverStone", 12, 1.2, 2.2, 2.8);
  /* rocks & dead wood */
  scatter("basalt", 8, 0.8, 1.5, 4.5);
  scatter("volcanic", 12, 0.9, 1.8, 3.4);
  scatter("lavaRock", 10, 1.0, 1.9, 3.2);
  scatter("obsidian", 6, 0.9, 1.7, 3.0);
  scatter("geode", 6, 0.9, 1.6, 3.0);
  scatter("fernBoulder", 9, 0.9, 1.6, 3.4);
  scatter("petrifiedLog", 8, 1.4, 2.4, 3.6);
  scatter("hollowLog", 6, 0.9, 1.3, 3.4);
  scatter("mossStump", 8, 0.9, 1.5, 3.0);
  /* thermal leftovers + amber drops */
  scatter("fumarole", 3, 1.0, 1.5, 5);
  scatter("mudPool", 3, 1.2, 1.7, 5);
  scatter("termiteMound", 4, 1.0, 1.7, 3.6);
  scatter("amber", 2, 1.0, 1.5, 3);
  /* lone bones the tar pits missed */
  scatter("skull", 1, 1.3, 1.6, 4);
  scatter("bonePile", 1, 1.1, 1.4, 4);
  scatter("eggClutch", 1, 1.2, 1.5, 3.4);

  return { props: props as PrehistoricLayout["props"], dinos, colliders };
})();

/** Solid circles for worldgen — landmark thermal features + the BIG locals
 *  (the little raptors & compys wander collider-free; they're knee-high). */
export function prehistoricColliders(): { x: number; z: number; r: number }[] {
  return PREHISTORIC_LAYOUT.colliders;
}
