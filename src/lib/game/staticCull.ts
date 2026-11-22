/**
 * 🏙️ STATIC WORLD CULLER — the distance fog does the visual work, this does
 * the frame-time work.
 *
 * The town is a 1,200u map of hand-built decor (camps, cabins, kiosks, farm
 * props, graveyard stones, insect landmarks, parked & cruising cars…). The
 * camera's far plane is 900 (the mountain ring must stay visible), so on a
 * clear day THREE renders essentially EVERY structure on the map every frame —
 * measured ~3.8k draw calls / 2.4M triangles, with 76% of the draws sitting
 * beyond 300u where fog already washes them out. Every draw call is JS-side
 * state setup in the renderer, so the cost lands on the CPU and the whole
 * game feels heavy — exactly the "it was fast yesterday, now it's laggy" drag
 * that grew with each new kit.
 *
 * Fix: collect locally-clustered static subtrees ("clusters" — a camp, a
 * cabin, one car, one insect prop) into a registry, then every 0.25 s toggle
 * each cluster's `visible` by distance from the camera:
 *
 *   show when   dist < BASE + radius + height × TALL_SCALE
 *
 * Taller clusters stay visible farther so silhouettes (chimneys, towers,
 * landmarks) don't pop against the sky; small props vanish into the fog line.
 * One full re-collection every 2 s picks up late-streaming GLB props and
 * remounts (HMR, resets) without leaking stale nodes.
 *
 * Safety rules (why clusters never fight the systems that own them):
 *  - a subtree containing a LIGHT or a SKINNED MESH is never a cluster —
 *    lights change the shader's light count when toggled (recompiles every
 *    material → stutter), and skinned bodies are owned by the entity views
 *    (Npcs / Zombies / CrewRig / Animals) which already distance-cull
 *    themselves;
 *  - clusters only HIDE things beyond ~240u, where gameplay visibility
 *    toggles (corpses sinking, kit-car beams) never reach — near the camera
 *    the per-frame owner always wins the last write.
 */
import * as THREE from "three";

/** A locally-clustered cullable subtree. */
interface Cluster {
  obj: THREE.Object3D;
  /** world-space center (refreshed every pass for dynamic clusters) */
  cx: number;
  cz: number;
  /** bounding-sphere radius (world units) */
  r: number;
  /** bounding-box height (world units) — taller clusters cull farther */
  h: number;
  /** moving clusters (cars) re-read their world position every pass */
  dynamic: boolean;
  /** last state we wrote — skip redundant visible writes */
  shown: boolean;
}

/** Cluster max bounding-sphere radius — anything wider spans the map and is
 *  left to its own (already frustum-culled) fate. */
const MAX_R = 56;
/** Base cull distance: small props vanish at ~250u (fog ≈ 17% there). */
const BASE = 250;
/** Tall clusters (a 24u lookout tower) push their cull line out by height —
 *  the silhouette reads against the sky long after its walls wash into fog. */
const TALL_SCALE = 2.4;

const clusters: Cluster[] = [];
const roots: { obj: THREE.Object3D; dynamic: boolean }[] = [];
/** Clusters the CULLER itself hid — lets re-collection distinguish "hidden
 *  by us, may re-show" from "hidden by its owner, never touch" (e.g. the
 *  procedural car slots the kit/GLB bodies replaced are hidden forever). */
const culledByUs = new Set<THREE.Object3D>();
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _size = new THREE.Vector3();

/** Subtree scan — true when it must NOT be distance-toggled. Lights change
 *  the shader program set when their count changes (stutter for every
 *  material); skinned meshes belong to the entity views that cull
 *  themselves. */
function hasGuardedContent(o: THREE.Object3D): boolean {
  const stack: THREE.Object3D[] = [o];
  while (stack.length) {
    const n = stack.pop()!;
    if ((n as THREE.SkinnedMesh).isSkinnedMesh || (n as THREE.Light).isLight) return true;
    for (const c of n.children) stack.push(c);
  }
  return false;
}

/** Walk a registered root, collecting the top-most local clusters (no
 *  descent below one — parents and children must never both toggle). */
function collect(obj: THREE.Object3D, dynamic: boolean): void {
  const stack: { o: THREE.Object3D; depth: number }[] = [{ o: obj, depth: 0 }];
  while (stack.length) {
    const { o, depth } = stack.pop()!;
    if (depth > 0) {
      // owner-hidden and never culled by us → its visibility belongs to its
      // owner; do not register and do not descend (its children are hidden
      // with it, so there is nothing to gain)
      if (!o.visible && !culledByUs.has(o)) continue;
      if (hasGuardedContent(o)) continue;
      o.updateMatrixWorld(false);
      _box.setFromObject(o);
      if (_box.isEmpty()) continue;
      _size.set(_box.max.x - _box.min.x, _box.max.y - _box.min.y, _box.max.z - _box.min.z);
      const r = _size.length() * 0.5;
      if (r <= MAX_R) {
        o.getWorldPosition(_c);
        clusters.push({
          obj: o, cx: _c.x, cz: _c.z, r,
          h: _size.y,
          dynamic,
          shown: o.visible,
        });
        continue; // do not descend — children of a cluster ride its visibility
      }
    }
    for (const c of o.children) stack.push({ o: c, depth: depth + 1 });
  }
}

/** Register a subtree root for distance culling (idempotent). `dynamic` for
 *  roots whose clusters move every frame (the car fleets). */
export function registerCullRoot(obj: THREE.Object3D | null, dynamic = false): void {
  if (!obj) return;
  if (roots.some((r) => r.obj === obj)) return;
  roots.push({ obj, dynamic });
  clusters.length = 0; // force a re-collection next pass
}

/** Drop every registration & cluster (world teardown / HMR). */
export function resetCullRoots(): void {
  roots.length = 0;
  clusters.length = 0;
  culledByUs.clear();
  acc = 0;
  collectAcc = COLLECT_EVERY; // collect on the first frame
}

const PASS_EVERY = 0.25;
const COLLECT_EVERY = 2;
let acc = 0;
let collectAcc = COLLECT_EVERY; // collect on the first frame
let camRef: THREE.Vector3 | null = null;

/** Per-frame tick (call from a useFrame with the live camera). Cheap: the
 *  pass loops a flat array of numbers; the collection walk runs every 2 s. */
export function tickStaticCull(camera: THREE.Camera, dt: number): void {
  camRef = camera.position;
  acc += dt;
  collectAcc += dt;
  if (collectAcc >= COLLECT_EVERY) {
    collectAcc = 0;
    clusters.length = 0;
    for (const { obj, dynamic } of roots) collect(obj, dynamic);
  }
  if (acc < PASS_EVERY) return;
  acc = 0;
  if (!clusters.length) return;
  const cam = camera.position;
  for (const c of clusters) {
    let cx = c.cx, cz = c.cz;
    if (c.dynamic) {
      c.obj.getWorldPosition(_c);
      cx = _c.x; cz = _c.z;
      c.cx = cx; c.cz = cz;
    }
    const dx = cx - cam.x, dz = cz - cam.z;
    const d = Math.sqrt(dx * dx + dz * dz) - c.r;
    const want = d < BASE + c.h * TALL_SCALE;
    if (want === c.shown) continue;
    c.obj.visible = want;
    c.shown = want;
    if (want) culledByUs.delete(c.obj);
    else culledByUs.add(c.obj);
  }
}

/** Live counts for the debug HUD / verification. */
export const cullStats = () => ({
  clusters: clusters.length,
  shown: clusters.reduce((n, c) => n + (c.shown ? 1 : 0), 0),
  roots: roots.length,
});
