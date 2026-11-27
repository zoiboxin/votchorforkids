/**
 * 🏙️ polyfork City Kit GLB loader — the town fills its empty plots.
 *
 * Models from the polyfork catalog (https://polyfork.dev, CC BY 4.0 — see
 * public/models/CREDITS.md), downloaded from
 * https://github.com/lucas-martinic/polyfork-catalog (models/buildings.md):
 * five themed districts grow on the city's empty blocks —
 *   • Civic squares   (NYC kit: classical bank, department store, movie theater)
 *   • Little Tokyo    (japanese-suburban-city-street kit: shophouses, shrine)
 *   • Mediterranean   (mediterranean-island-village kit: domed church, kafeneio)
 *   • Frontier Town   (frontier-town kit: saloon, general store, hotel)
 *   • brownstone / tenement / loft rows + suburban house rows
 * plus the downtown skyline upgrade: the plain box towers are replaced by the
 * art-deco setback tower & office tower, and two suburb blocks swap their box
 * homes for real kit houses.
 *
 * Placements & colliders live in CITYKIT (worldgen.ts — same contract as
 * SITEKIT/GRAVEKIT/HOSPKIT); this module only owns loading. Every model is
 * vertex-coloured low-poly; files stream in the background, a failed model
 * just skips that building — never crashes the game.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useSyncExternalStore } from "react";

const FILES = {
  /* ---- New York City kit ---- */
  brownstoneRowHouse: "/models/city/brownstone-row-house-1b84fd.glb",
  brickTenement: "/models/city/brick-tenement-7d2014.glb",
  narrowWalkUp: "/models/city/narrow-walk-up-41f10c.glb",
  cornerTenement: "/models/city/corner-tenement-92fb62.glb",
  postwarSlab: "/models/city/postwar-apartment-slab-cee5f9.glb",
  prewarApartment: "/models/city/prewar-apartment-house-1081a6.glb",
  artDecoTower: "/models/city/art-deco-setback-tower-b3a788.glb",
  officeTower: "/models/city/office-tower-1538cc.glb",
  classicalBank: "/models/city/classical-bank-04954e.glb",
  brickChurch: "/models/city/brick-church-322885.glb",
  cornerShop: "/models/city/corner-shop-5aec8c.glb",
  departmentStore: "/models/city/department-store-ffbd58.glb",
  movieTheater: "/models/city/movie-theater-40eeef.glb",
  shopRow: "/models/city/one-storey-shop-row-83c958.glb",
  fireStation: "/models/city/fire-station-e2b756.glb",
  parkingGarage: "/models/city/parking-garage-6e4f2c.glb",
  autoRepair: "/models/city/auto-repair-garage-b91464.glb",
  castIronLoft: "/models/city/cast-iron-loft-b04b5a.glb",
  newsstand: "/models/city/newsstand-6dfd65.glb",
  streetDiner: "/models/city/street-diner-40fc87.glb",
  subway: "/models/city/subway-entrance-9ccc8b.glb",
  /* ---- Little Tokyo kit ---- */
  tokyoApartment: "/models/city/apartment-block-6445af.glb",
  alleyBarHut: "/models/city/alley-bar-hut-3e41f8.glb",
  amusementParlour: "/models/city/amusement-parlour-7eb45f.glb",
  bathhouse: "/models/city/bathhouse-4ac41a.glb",
  convenienceStore: "/models/city/convenience-store-c30e1d.glb",
  cornerShophouse: "/models/city/corner-shophouse-ad15c2.glb",
  shrineHall: "/models/city/small-shrine-hall-cb8b25.glb",
  shophouse3: "/models/city/three-storey-shophouse-2f6378.glb",
  shophouse2: "/models/city/two-storey-shophouse-183790.glb",
  shophouseWide: "/models/city/wide-shophouse-089f20.glb",
  /* ---- Mediterranean Island Village kit ---- */
  blueChapel: "/models/city/blue-domed-chapel-297391.glb",
  domedChurch: "/models/city/domed-church-dcbe85.glb",
  kafeneio: "/models/city/kafeneio-25e357.glb",
  villageShop: "/models/city/village-shopfront-d3088e.glb",
  cubeHouse: "/models/city/cube-house-module-a9b8e8.glb",
  dovecote: "/models/city/dovecote-tower-db7d30.glb",
  bellTower: "/models/city/tiered-bell-tower-e1b706.glb",
  caveHouse: "/models/city/cave-house-front-ed6b36.glb",
  archPassage: "/models/city/arched-passage-56393e.glb",
  /* ---- Frontier Town kit ---- */
  saloon: "/models/city/saloon-6dda1c.glb",
  generalStore: "/models/city/general-store-a2187a.glb",
  frontierHotel: "/models/city/hotel-b43f66.glb",
  barberBath: "/models/city/barber-and-bath-house-e0ff5c.glb",
  blacksmith: "/models/city/blacksmith-s-shop-9c5f43.glb",
  clapboardChurch: "/models/city/clapboard-church-03a6f5.glb",
  telegraphOffice: "/models/city/telegraph-and-post-office-71d3ff.glb",
  liveryStable: "/models/city/livery-stable-c01ee0.glb",
  undertaker: "/models/city/undertaker-s-3e1285.glb",
  /* ---- houses & landmarks ---- */
  gabledFarmhouse: "/models/city/gabled-farmhouse-c7534f.glb",
  colonialHouse: "/models/city/colonial-house-d6f8fd.glb",
  frenchTownhouse: "/models/city/french-quarter-townhouse-fd109f.glb",
  aFrameCabin: "/models/city/a-frame-cabin-6cb550.glb",
  clockTower: "/models/city/clock-tower-752081.glb",
  publicSchool: "/models/city/public-school-19ade5.glb",
  alpineChalet: "/models/city/alpine-chalet-47d59e.glb",
  adobeFarmhouse: "/models/city/adobe-colonial-farmhouse-cf13d8.glb",
} as const;

export type CityModelKind = keyof typeof FILES;

interface CityRig {
  template: THREE.Group;
  /** raw model footprint (full width / depth / height, before placement scale) */
  size: THREE.Vector3;
}

const cache = new Map<CityModelKind, CityRig>();
const failed = new Set<CityModelKind>();
let started = false;

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

/** React hook — re-renders whenever a city GLB finished (or failed) loading. */
export function useCityModels(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
  );
}

const loader = new GLTFLoader();

function register(kind: CityModelKind, gltf: { scene: THREE.Object3D }): void {
  const scene = gltf.scene as THREE.Group;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;  // the procedural city casts no building shadows — match it
      mesh.receiveShadow = false;
    }
  });
  // ground the model (origin at its turf contact point) and centre x/z —
  // the box is computed BEFORE wrapping so grounding is exact
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  scene.position.set(-center.x, -box.min.y, -center.z);
  const wrap = new THREE.Group();
  wrap.add(scene);
  wrap.updateMatrixWorld(true);
  cache.set(kind, { template: wrap, size });
  bump();
}

/** Begin the background preload (safe to call repeatedly; no-op on the server). */
export function preloadCityModels(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  for (const kind of Object.keys(FILES) as CityModelKind[]) {
    loader.load(
      FILES[kind],
      (gltf) => {
        try { register(kind, gltf); }
        catch { failed.add(kind); bump(); }
      },
      undefined,
      () => { failed.add(kind); bump(); /* a failed model just skips that building */ },
    );
  }
}

/** True once this building's GLB has been parsed (or failed for good). */
export const cityModelReady = (kind: string): boolean =>
  (kind in FILES && cache.has(kind as CityModelKind)) || failed.has(kind as CityModelKind);

/** A fresh clone of the building template (null while loading / on failure). */
export function spawnCityModel(kind: string): THREE.Group | null {
  const rig = cache.get(kind as CityModelKind);
  if (!rig) return null;
  return rig.template.clone(true);
}
