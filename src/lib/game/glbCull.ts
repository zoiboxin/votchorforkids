/**
 * 🎯 GLB frustum culling — restore the culled-render the loaders gave away.
 *
 * Every GLB loader used to stamp `frustumCulled = false` on every mesh. That
 * was the cheap way to dodge a classic three.js trap — a skinned mesh culls
 * on its BIND-POSE bounding sphere, and clip animation (idle sway, walk,
 * dance arms, jump tucks) displaces vertices beyond it — but the price was
 * that EVERY streamed body, car and prop rendered every frame even when the
 * camera faced the other way. With the whole polyfork cast, wildlife, insect
 * kit and vehicle fleet in the scene that flag alone forced ~1,000 extra
 * draw calls per frame.
 *
 * Fix: compute each geometry's bind-pose bounding sphere ONCE and inflate it
 * by an animation margin, then leave frustum culling ON. Geometry is shared
 * between every SkeletonUtils clone of a template, so one inflate per
 * geometry covers every instance that will ever wear it. The margin is
 * generous on purpose — a rare pop at the screen edge costs less than a
 * thousand permanent draws.
 */
import * as THREE from "three";

/** Geometries already sized for culling (shared across clones — set once). */
const culledGeos = new WeakSet<THREE.BufferGeometry>();

/**
 * Enable frustum culling on `o`'s meshes with an animation-safe bounding
 * sphere: radius' = radius × mul + pad (model-space units — the sphere rides
 * the mesh's own transform, so this holds at any instance scale).
 */
export function enableGlbCulling(o: THREE.Object3D, mul = 1.2, pad = 0.55): void {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry) return;
  const g = m.geometry as THREE.BufferGeometry;
  if (culledGeos.has(g)) {
    m.frustumCulled = true; // per-mesh flag — clones need it re-asserted
    return;
  }
  culledGeos.add(g);
  g.computeBoundingSphere();
  const bs = g.boundingSphere;
  if (bs && Number.isFinite(bs.radius) && bs.radius > 0) {
    bs.radius = bs.radius * mul + pad;
  }
  m.frustumCulled = true;
}
