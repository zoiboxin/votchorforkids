/**
 * 🎄 SEASON KIT LOADER — generic polyfork GLB pipeline for the seasonal maps.
 *
 * Every season vendors 13–15 kit pieces (see seasonAssets.ts, downloaded from
 * polyfork.dev — CC BY 4.0). This loader mirrors the airport/gravelyard
 * pattern: background preload per season, grounded & centred templates, and
 * `spawnSeasonModel()` handing out independent clones with their template's
 * bounding size so placement can normalise scales across kits.
 *
 * The cache is keyed `${seasonId}|${file}` — switching seasons only loads the
 * new season's pieces; templates stay warm for revisits.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { SEASON_ASSETS } from "./seasonAssets";
import { enableGlbCulling } from "./glbCull";

export interface SeasonRig {
  template: THREE.Group;
  /** template bounding box dimensions (pre-grounding, authored units) */
  size: THREE.Vector3;
  clips: Record<string, THREE.AnimationClip>;
  skinned: boolean;
}

const cache = new Map<string, SeasonRig>();
const loading = new Set<string>();
const readyCbs = new Map<string, (() => void)[]>();
let loader: GLTFLoader | null = null;

const key = (seasonId: string, file: string) => `${seasonId}|${file}`;

/** All season GLB files the player may visit — used to warm the cache early. */
export function allSeasonFiles(): { seasonId: string; file: string }[] {
  const out: { seasonId: string; file: string }[] = [];
  for (const [seasonId, assets] of Object.entries(SEASON_ASSETS)) {
    for (const a of assets) out.push({ seasonId, file: a.file });
  }
  return out;
}

/** Begin the background preload for one season (safe to call repeatedly). */
export function preloadSeasonModels(seasonId: string, onReady?: () => void): void {
  if (typeof window === "undefined") return;
  if (!loader) loader = new GLTFLoader();
  const files = (SEASON_ASSETS[seasonId] ?? []).map((a) => a.file);
  if (onReady) {
    const pending = files.filter((f) => !cache.has(key(seasonId, f)));
    if (pending.length === 0) onReady();
    else {
      const list = readyCbs.get(seasonId) ?? [];
      list.push(onReady);
      readyCbs.set(seasonId, list);
    }
  }
  for (const file of files) startOne(seasonId, file);
}

function startOne(seasonId: string, file: string): void {
  const k = key(seasonId, file);
  if (cache.has(k) || loading.has(k)) return;
  loading.add(k);
  loader!.load(
    file,
    (gltf) => {
      const scene = gltf.scene;
      enableGlbCulling(scene); // restore per-mesh frustum culling the loader disabled
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = false;
        }
      });
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // ground the model (origin at its ground contact point), centre x/z
      scene.position.set(-center.x, -box.min.y, -center.z);
      const wrap = new THREE.Group();
      wrap.add(scene);
      const clips: Record<string, THREE.AnimationClip> = {};
      for (const c of gltf.animations) clips[c.name.toLowerCase()] = c;
      cache.set(k, {
        template: wrap,
        size: size.lengthSq() < 1e-6 ? new THREE.Vector3(1, 1, 1) : size,
        clips,
        skinned: false,
      });
      loading.delete(k);
      const cbs = readyCbs.get(seasonId);
      if (cbs) {
        const pending = (SEASON_ASSETS[seasonId] ?? []).some((a) => !cache.has(key(seasonId, a.file)));
        if (!pending) for (const cb of cbs.splice(0)) cb();
      }
    },
    undefined,
    () => {
      loading.delete(k);
      console.error("[season-kit] GLB failed:", file);
    },
  );
}

export const isSeasonModelReady = (seasonId: string, file: string): boolean =>
  cache.has(key(seasonId, file));

/** Template bounding size (1,1,1 while loading) — lets placement normalise. */
export function seasonModelSize(seasonId: string, file: string): THREE.Vector3 {
  return cache.get(key(seasonId, file))?.size ?? new THREE.Vector3(1, 1, 1);
}

/** A fresh independent clone of the kit piece, or null while loading. */
export function spawnSeasonModel(seasonId: string, file: string): THREE.Object3D | null {
  const rig = cache.get(key(seasonId, file));
  if (!rig) return null;
  return rig.skinned ? skeletonClone(rig.template) : rig.template.clone(true);
}

/** Progress across one season's kit (for the boot screen). */
export function seasonProgress(seasonId: string): { ready: number; total: number } {
  const files = (SEASON_ASSETS[seasonId] ?? []).map((a) => a.file);
  return { ready: files.filter((f) => cache.has(key(seasonId, f))).length, total: files.length };
}
