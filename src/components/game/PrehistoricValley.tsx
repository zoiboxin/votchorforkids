/**
 * 🦕 Prehistoric Valley — the south-west arc of the mountain band, rebuilt
 * with the polyfork prehistoric-valley-8638dc kit (see prehistoric.ts).
 *
 * Render plan (same discipline as the hospital campus):
 *  - the valley floor gets a sandy sector overlay that hugs terrainHeight
 *    (6cm above it) so the zone reads as its own land, not mossy scree,
 *  - every static kit kind bakes into ONE merged vertex-coloured mesh,
 *  - the six dinosaur kinds are skinned clones driven by AnimationMixers:
 *    the four BIG locals (rex, triceratops ×2, stegosaurus, parasaurolophus
 *    ×2) stand their ground with a live Idle clip, while the little locals
 *    (3 velociraptors, 4 compsognathus) pad around their home range —
 *    Walk clip while moving, Idle while pausing, so the valley feels alive,
 *  - ALL mixer updates gate on player distance (the valley is far away and
 *    fog-hidden for most of a run — distant bones cost nothing),
 *  - the 45 GLB stream only STARTS when the player closes in on the valley
 *    (lazy by proximity), so nobody downloads the kit they never visit.
 *
 * Mounted inside WorldView's static cull root, next to <HospitalCampus>.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PREHISTORIC } from "@/lib/game/constants";
import { terrainHeight } from "@/lib/game/worldgen";
import {
  PREHISTORIC_LAYOUT, bakePrehistoricModel, onPrehistoricModelsReady,
  preloadPrehistoricModels, spawnPrehistoricModel,
  type PrehistoricDino, type PrehistoricKind, type PrehistoricPlacement,
} from "@/lib/game/prehistoric";
import type { GameEngine } from "@/lib/game/engine";

/** deterministic 2-D hash → [0,1) (ground-palette noise) */
const hash2 = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* ---------------- the valley floor: sandy sector overlay ---------------- */

function ValleyFloor() {
  const geo = useMemo(() => {
    const { a0, a1, rIn, rOut } = PREHISTORIC;
    // RingGeometry theta runs in the XY plane; after rotateX(-π/2) a ring
    // angle θ lands at world atan2(-sinθ, cosθ) — so the world sector
    // [a0, a1] needs thetaStart −a1 and length a1−a0.
    const rg = new THREE.RingGeometry(rIn - 3, rOut + 3, 72, 14, -a1, a1 - a0);
    rg.rotateX(-Math.PI / 2);
    const pos = rg.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z) + 0.09);
      const r = Math.hypot(x, z);
      // dry sandy valley floor, greening toward the jungle rim, with mud
      // patches and dirt noise so it never reads as a flat paint fill
      const t = (r - rIn) / (rOut - rIn);
      c.set("#8a7a52");
      c.lerp(new THREE.Color("#5f7a3f"), Math.max(0, 1 - t) * 0.4);        // jungle-side green
      const h = hash2(x * 0.31, z * 0.27);
      if (h < 0.2) c.lerp(new THREE.Color("#6d5c40"), 0.65);               // mud patch
      else if (h > 0.86) c.lerp(new THREE.Color("#9c8f6a"), 0.5);          // dry dust
      c.offsetHSL(0, 0, (hash2(x * 0.13 + 4.7, z * 0.17) - 0.5) * 0.07);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    rg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    rg.computeVertexNormals();
    return rg;
  }, []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), []);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

/* ---------------- baked statics: ONE mesh per kit kind ---------------- */

function BakedValley({ kind, placements }: { kind: PrehistoricKind; placements: PrehistoricPlacement[] }) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(() => bakePrehistoricModel(kind, placements));
  useEffect(() => {
    if (mesh) return;
    return onPrehistoricModelsReady(() => setMesh(bakePrehistoricModel(kind, placements)));
    // placements are module-level constants — stable across renders
  }, [kind, mesh]);
  useEffect(() => () => {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  return mesh ? <primitive object={mesh} /> : null;
}

const PROP_KINDS = Object.keys(PREHISTORIC_LAYOUT.props) as (keyof typeof PREHISTORIC_LAYOUT.props)[];

function ValleyProps() {
  return (
    <group>
      {PROP_KINDS.map((k) => (
        <BakedValley key={k} kind={k as PrehistoricKind} placements={PREHISTORIC_LAYOUT.props[k]} />
      ))}
    </group>
  );
}

/* ---------------- 🦕 the locals: skinned, clipped, distance-gated ----------------
 * Big locals hold their ground with an Idle clip; little locals pad between
 * home-range points with a Walk↔Idle blend. The mixer only ticks while the
 * player is close enough to see it — far away the valley is fog-hidden.     */

const DINO_SEE = 175;   // mixer distance gate (u)
const DINO_TURN = 7;    // little-local turn rate (1/s)

function Dino({ d, engine }: { d: PrehistoricDino; engine: GameEngine }) {
  const [spawn, setSpawn] = useState(() => spawnPrehistoricModel(d.kind));
  useEffect(() => {
    if (spawn) return;
    return onPrehistoricModelsReady(() => setSpawn(spawnPrehistoricModel(d.kind)));
  }, [d.kind, spawn]);
  const st = useRef({
    pos: { x: d.x, z: d.z },
    face: d.rot,
    wp: 0,          // current wander target index
    idleT: 0,       // >0 while pausing on the spot
    walk: null as THREE.AnimationAction | null,
    idle: null as THREE.AnimationAction | null,
    primed: false,  // actions started once
    kick: Math.random() * 3, // desync the Idle clips so a herd never pumps in sync
  });

  useEffect(() => {
    if (!spawn?.mixer || st.current.primed) return;
    st.current.primed = true;
    const w = spawn.clips["walk"], id = spawn.clips["idle"];
    if (w) { const a = spawn.mixer.clipAction(w); a.play(); a.setEffectiveWeight(0); st.current.walk = a; }
    if (id) { const a = spawn.mixer.clipAction(id); a.play(); st.current.idle = a; }
    spawn.mixer.time = st.current.kick; // offset phase
  }, [spawn]);

  useFrame((_, dt) => {
    const s = st.current;
    const root = spawn?.root, mixer = spawn?.mixer;
    if (!root || !mixer) return;
    // distance gate — mixers and wander brains sleep when nobody is watching
    const p = engine.player;
    const near = p ? Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < DINO_SEE : false;
    if (!near) return;

    if (d.wander && d.walkS > 0) {
      if (s.idleT > 0) {
        s.idleT -= dt;
      } else {
        const t = d.wander[s.wp % d.wander.length];
        const dx = t.x - s.pos.x, dz = t.z - s.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.6) {
          s.wp = (s.wp + 1) % d.wander.length;
          s.idleT = 1.4 + Math.random() * 2.6; // sniff around before the next leg
        } else {
          const step = Math.min(dist, d.walkS * dt);
          s.pos.x += (dx / dist) * step;
          s.pos.z += (dz / dist) * step;
          const want = Math.atan2(dx, dz);
          let da = want - s.face;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          s.face += da * Math.min(1, DINO_TURN * dt);
        }
      }
      // Walk↔Idle crossfade — both actions play, weights ease toward the state
      const moving = s.idleT <= 0;
      if (s.walk) s.walk.setEffectiveWeight((s.walk.weight + ((moving ? 1 : 0) - s.walk.weight) * Math.min(1, dt * 6)));
      if (s.idle) s.idle.setEffectiveWeight((s.idle.weight + ((moving ? 0 : 1) - s.idle.weight) * Math.min(1, dt * 6)));
    } else if (s.idle) {
      s.idle.setEffectiveWeight(1);
      if (s.walk) s.walk.setEffectiveWeight(0);
    }

    root.position.set(s.pos.x, terrainHeight(s.pos.x, s.pos.z), s.pos.z);
    root.rotation.y = s.face;
    mixer.update(dt);
  });

  if (!spawn) return null;
  return <primitive object={spawn.root} position={[d.x, terrainHeight(d.x, d.z), d.z]} rotation-y={d.rot} scale={d.s} />;
}

function Dinos({ engine }: { engine: GameEngine }) {
  return (
    <group>
      {PREHISTORIC_LAYOUT.dinos.map((d, i) => (
        <Dino key={i} d={d} engine={engine} />
      ))}
    </group>
  );
}

/* ---------------- the whole valley — mounts inside the static cull root ---------------- */

export function PrehistoricValley({ engine }: { engine: GameEngine }) {
  // 🛰️ lazy stream — the first time the player closes in on the valley, the
  // 45 kit GLBs start loading in the background; before that, zero bytes.
  const tried = useRef(false);
  useFrame(() => {
    if (tried.current) return;
    const p = engine.player;
    if (p && Math.hypot(p.x - PREHISTORIC.cx, p.z - PREHISTORIC.cz) < 340) {
      tried.current = true;
      preloadPrehistoricModels();
    }
  });
  const [ready, setReady] = useState(false);
  useEffect(() => onPrehistoricModelsReady(() => setReady(true)), []);

  return ready ? (
    <group>
      <ValleyFloor />
      <ValleyProps />
      <Dinos engine={engine} />
    </group>
  ) : null;
}
