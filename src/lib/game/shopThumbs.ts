/**
 * 🖼️ SHOP THUMBS — real GLB portraits for the item-shop grid, the same trick
 * the creator's hero picker uses (glbCharacters.renderThumb) extended to the
 * shop-forged WEAPON files (arming sword, hand axe, dagger, spear).
 *
 * One module-level offscreen WebGLRenderer (128²·160² canvas, single shared
 * GL context — never one context per tile) renders each weapon template once,
 * snaps a data-URL and caches it. React tiles read the cache through a
 * useSyncExternalStore hook and re-paint as portraits land; failures stay
 * silent (the emoji stand-in keeps the tile presentable).
 */
import * as THREE from "three";
import { useSyncExternalStore } from "react";
import { loadWeaponTemplate, type WeaponKind } from "./weapons";

/* ---------------- tiny external store (one version bump per portrait) ---- */

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

/** Re-render hook — tiles repaint as finished portraits arrive. */
export function useShopThumbs(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
  );
}

/* ---------------- the shared offscreen snapshot renderer ------------------ */

const SIZE = 160;
let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // the canvas is read right after the render
    });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(1);
  }
  return renderer;
}

/** Frame any object3D to fill the tile, render, snap the pixels. */
function renderObjectThumb(obj: THREE.Object3D): string {
  const r = getRenderer();
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const key = new THREE.DirectionalLight(0xfff2d0, 1.5);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8d8ff, 0.55);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  scene.add(obj);
  obj.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(0.01, size.x, size.y, size.z);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
  cam.position.set(
    center.x + maxDim * 0.42,
    center.y + maxDim * 0.34,
    center.z + maxDim * 1.18,
  );
  cam.lookAt(center);
  r.render(scene, cam);
  const url = r.domElement.toDataURL("image/png");
  scene.remove(obj);
  return url;
}

/* ---------------- weapon portraits --------------------------------------- */

const weaponThumbs = new Map<WeaponKind, string>();
const weaponPending = new Set<WeaponKind>();

/** Queue a weapon portrait (cosmetic — failures are fine, emoji stands in). */
export function ensureWeaponThumb(kind: WeaponKind): void {
  if (weaponThumbs.has(kind) || weaponPending.has(kind)) return;
  weaponPending.add(kind);
  void loadWeaponTemplate(kind)
    .then((tpl) => {
      const inst = tpl.clone(true);
      inst.position.y = 0; // ignore the grip offset — the tile frames the blade
      weaponThumbs.set(kind, renderObjectThumb(inst));
      bump();
    })
    .catch(() => { /* portraits are decoration */ })
    .finally(() => { weaponPending.delete(kind); });
}

/** Cached weapon portrait data-URL (undefined while rendering / failed). */
export const weaponThumb = (kind: WeaponKind): string | undefined =>
  weaponThumbs.get(kind);
