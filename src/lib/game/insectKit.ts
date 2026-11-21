/**
 * 🐜 Insect World kit loader — the meadow's micro-scaled landmarks.
 *
 * Props from the polyfork INSECT WORLD kit (https://polyfork.dev/kit/insect-world-e44b9f,
 * CC BY 4.0): glowing mushrooms, daisies, clover, moss cushions, ant nests &
 * chambers, orb webs, an insect hotel, a wild honeycomb panel, a wasp paper
 * nest — plus the kit's tiny human-scale treasures (bottle cap, glass marble,
 * lost button, matchbox house…) that sell the "shrunk-down meadow" fantasy.
 *
 * These are STATIC props (no clips, no colliders — walk right through them).
 * Files stream on demand per slug; clones are plain .clone() (no skins) and
 * normalized to a per-slug target size by the worldgen scatter's `s` factor.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const INSECT_KIT_FILES = {
  acorn: "/models/insect-world/acorn-cup-0ed13c.glb",
  nestMound: "/models/insect-world/ant-nest-entrance-mound-f6136c.glb",
  nestChamber: "/models/insect-world/ant-nest-chamber-6b786b.glb",
  cocoon: "/models/insect-world/ant-pupa-cocoon-3e6ebd.glb",
  bottleCap: "/models/insect-world/bottle-cap-cd96db.glb",
  daisy: "/models/insect-world/common-daisy-6b2004.glb",
  dandelion: "/models/insect-world/dandelion-ff19ee.glb",
  dandelionSeed: "/models/insect-world/dandelion-seed-c6a8b7.glb",
  dewdrop: "/models/insect-world/dewdrop-18a51f.glb",
  eggshell: "/models/insect-world/eggshell-half-d30a1c.glb",
  feather: "/models/insect-world/fallen-bird-feather-ffbc11.glb",
  blackberry: "/models/insect-world/fallen-blackberry-27dc5a.glb",
  oakLeaf: "/models/insect-world/fallen-oak-leaf-5b15fe.glb",
  petal: "/models/insect-world/fallen-rose-petal-8b0c24.glb",
  twig: "/models/insect-world/fallen-twig-4c64de.glb",
  marble: "/models/insect-world/glass-marble-4772bb.glb",
  glowShroom: "/models/insect-world/glowing-bonnet-mushroom-13f518.glb",
  hotel: "/models/insect-world/insect-hotel-14d870.glb",
  button: "/models/insect-world/lost-button-46f22a.glb",
  matchbox: "/models/insect-world/matchbox-house-2d2689.glb",
  matchstick: "/models/insect-world/matchstick-b3147f.glb",
  grassPlant: "/models/insect-world/meadow-grass-plant-7085e0.glb",
  moss: "/models/insect-world/moss-cushion-2eabef.glb",
  orbWeb: "/models/insect-world/orb-web-133aba.glb",
  pineCone: "/models/insect-world/pine-cone-e36f37.glb",
  waspPot: "/models/insect-world/potter-wasp-pot-8ebfee.glb",
  puffball: "/models/insect-world/puffball-mushroom-3b1324.glb",
  pebble: "/models/insect-world/quartz-pebble-path-stone-23c014.glb",
  slate: "/models/insect-world/slate-flake-path-stone-514513.glb",
  seedling: "/models/insect-world/sprouting-seedling-e0b9f1.glb",
  sugarCube: "/models/insect-world/sugar-cube-4a50a5.glb",
  sunflowerSeed: "/models/insect-world/sunflower-seed-b4fbbd.glb",
  chrysalis: "/models/insect-world/swallowtail-chrysalis-bde444.glb",
  flowerpot: "/models/insect-world/upturned-clay-flowerpot-de9221.glb",
  waspNest: "/models/insect-world/wasp-paper-nest-68a6c0.glb",
  clover: "/models/insect-world/white-clover-plant-6ed185.glb",
  honeycomb: "/models/insect-world/wild-honeycomb-panel-877542.glb",
} as const;

export type InsectKitKind = keyof typeof INSECT_KIT_FILES;

const cache = new Map<InsectKitKind, THREE.Group>();
const pending = new Map<InsectKitKind, Promise<THREE.Group>>();
let loader: GLTFLoader | null = null;

/** Begin streaming one kit prop (idempotent). Resolves with a normalized
 *  template — grounded at y=0, centred on x/z, scaled to ~1u tall; the
 *  renderer multiplies by the scatter's per-prop size factor. */
export function loadInsectKit(kind: InsectKitKind): Promise<THREE.Group> {
  const hit = cache.get(kind);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(kind);
  if (inflight) return inflight;
  loader ??= new GLTFLoader();
  const p = new Promise<THREE.Group>((resolve, reject) => {
    loader!.load(
      INSECT_KIT_FILES[kind],
      (gltf) => {
        const scene = gltf.scene;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = false;
            m.receiveShadow = false;
            m.frustumCulled = false;
          }
        });
        const box = new THREE.Box3().setFromObject(scene);
        const h = Math.max(0.001, box.max.y - box.min.y);
        const s = 1 / h;
        const center = box.getCenter(new THREE.Vector3());
        const wrap = new THREE.Group();
        scene.position.set(-center.x, -box.min.y, -center.z);
        scene.scale.setScalar(s);
        wrap.add(scene);
        cache.set(kind, wrap);
        pending.delete(kind);
        resolve(wrap);
      },
      undefined,
      (err) => {
        pending.delete(kind);
        reject(err);
      },
    );
  });
  pending.set(kind, p);
  return p;
}

/** A fresh independent clone of a loaded kit prop (null while streaming). */
export function spawnInsectKit(kind: InsectKitKind): THREE.Group | null {
  const tpl = cache.get(kind);
  if (!tpl) return null;
  const root = tpl.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.frustumCulled = false;
  });
  return root;
}

export const insectKitReady = (kind: InsectKitKind): boolean => cache.has(kind);
