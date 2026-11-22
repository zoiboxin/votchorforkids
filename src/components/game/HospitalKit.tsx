/**
 * 🏥 St. Cross Medical Campus — polyfork Hospital Kit (GLB) scene parts.
 *
 * Every building, vehicle and prop here is the REAL kit model from
 * https://polyfork.dev/kit/hospital-kit-2ebfcb (see src/lib/game/hospitalModels.ts),
 * replacing the old hand-built white box. The whole grid block grew into a
 * proper hospital zone: 3-storey ward block with a rooftop helipad + air
 * ambulance, emergency block with a marked ambulance bay, clinic annexe,
 * entrance canopy, wayfinding totem, paved plaza, mesh-fence perimeter with a
 * gated drive, hedges, bollards, generator, gas cylinders, bins, wheelchairs
 * and five kit staff idling out front (doctor, nurse, paramedic, patient,
 * surgeon — each with a live Idle clip).
 *
 * Placement data (HOSPKIT) is derived from the HOSPITAL const in worldgen —
 * colliders and rendering always agree. Orientation tweaks live in MODEL_YAW.
 */
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOSPKIT } from "@/lib/game/worldgen";
import {
  bakeHospitalModel, onHospitalModelsReady, spawnHospitalModel,
  type HospitalKind, type HospitalPlacement,
} from "@/lib/game/hospitalModels";
import type { GameEngine } from "@/lib/game/engine";

/** authored forward fixes — tune if a catalog update turns a model around */
const MODEL_YAW: Partial<Record<HospitalKind, number>> = {};

/** spawn once per component + re-render when the GLB lands (mixer driven) */
function useKitModel(kind: HospitalKind) {
  const [spawn, setSpawn] = useState(() => spawnHospitalModel(kind));
  useEffect(() => {
    if (spawn) return;
    return onHospitalModelsReady(() => setSpawn(spawnHospitalModel(kind)));
  }, [kind, spawn]);
  useFrame((_, dt) => { if (spawn?.mixer) spawn.mixer.update(dt); });
  return spawn;
}

/** like useKitModel but WITHOUT the automatic mixer tick — the staff bots
 *  drive their own mixers (Walk↔Idle crossfade, distance-gated) */
function useStaffModel(kind: HospitalKind) {
  const [spawn, setSpawn] = useState(() => spawnHospitalModel(kind));
  useEffect(() => {
    if (spawn) return;
    return onHospitalModelsReady(() => setSpawn(spawnHospitalModel(kind)));
  }, [kind, spawn]);
  return spawn;
}

/** generic grounded kit prop placement */
function KitProp({ kind, x, z, y = 0, rot = 0, s = 1 }: {
  kind: HospitalKind; x: number; z: number; y?: number; rot?: number; s?: number;
}) {
  const spawn = useKitModel(kind);
  if (!spawn) return null;
  return (
    <primitive
      object={spawn.root}
      position={[x, y, z]}
      rotation-y={rot + (MODEL_YAW[kind] ?? 0)}
      scale={s}
    />
  );
}

/** MANY placements of one kind → ONE merged vertex-coloured mesh (1 draw call) */
function BakedKit({ kind, placements }: { kind: HospitalKind; placements: HospitalPlacement[] }) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(() => bakeHospitalModel(kind, placements));
  useEffect(() => {
    if (mesh) return;
    return onHospitalModelsReady(() => setMesh(bakeHospitalModel(kind, placements)));
    // placements are module-level constants — stable across renders
  }, [kind, mesh]);
  useEffect(() => () => {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  return mesh ? <primitive object={mesh} /> : null;
}

const FENCE_PANELS: HospitalPlacement[] = HOSPKIT.fencePanels;
const HEDGES: HospitalPlacement[] = HOSPKIT.hedges;
const PAVING: HospitalPlacement[] = HOSPKIT.paving;
const BOLLARDS: HospitalPlacement[] = HOSPKIT.bollards;
const STRIPES: HospitalPlacement[] = HOSPKIT.stripes.map((st) => ({ x: st.x, z: st.z, y: st.y, rot: Math.PI / 2 }));
const BAY_DECALS: HospitalPlacement[] = HOSPKIT.bayDecals;

/* ---------------- grounds: lawn, drive, rooftop pad marking ---------------- */

function CampusGrounds() {
  const { drive, deck, padTop } = HOSPKIT;
  const driveLen = drive.z1 - drive.z0;
  return (
    <group>
      {/* the campus lawn — a soft green inside the fence ring */}
      <mesh rotation-x={-Math.PI / 2} position={[101.25, 0.05, 101.75]}>
        <planeGeometry args={[45.4, 46.4]} />
        <meshLambertMaterial color="#8aa468" />
      </mesh>
      {/* the gated drive: south road edge → plaza */}
      <mesh rotation-x={-Math.PI / 2} position={[drive.x, 0.061, (drive.z0 + drive.z1) / 2]}>
        <planeGeometry args={[drive.w, driveLen + 1.4]} />
        <meshLambertMaterial color="#4a4a52" />
      </mesh>
      {/* rooftop helipad markings — yellow ring + white H on the deck top */}
      <mesh rotation-x={-Math.PI / 2} position={[deck.x, padTop + 0.03, deck.z]}>
        <ringGeometry args={[2.35, 2.75, 32]} />
        <meshBasicMaterial color="#f2c020" />
      </mesh>
      {[-0.85, 0.85].map((dx) => (
        <mesh key={dx} rotation-x={-Math.PI / 2} position={[deck.x + dx, padTop + 0.03, deck.z]}>
          <planeGeometry args={[0.5, 2.6]} />
          <meshBasicMaterial color="#f5f5f0" />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[deck.x, padTop + 0.03, deck.z]}>
        <planeGeometry args={[1.2, 0.5]} />
        <meshBasicMaterial color="#f5f5f0" />
      </mesh>
    </group>
  );
}

/* ---------------- buildings ---------------- */

function CampusBuildings() {
  const { ward, core, annexe, er, canopy } = HOSPKIT;
  return (
    <group>
      <KitProp kind="ward" x={ward.x} z={ward.z} rot={ward.rot} />
      <KitProp kind="core" x={core.x} z={core.z} rot={core.rot} />
      <KitProp kind="annexe" x={annexe.x} z={annexe.z} rot={annexe.rot} />
      <KitProp kind="er" x={er.x} z={er.z} rot={er.rot} />
      <KitProp kind="canopy" x={canopy.x} z={canopy.z} rot={canopy.rot} />
    </group>
  );
}

/* ---------------- vehicles: ambulances + the rooftop air ambulance ---------------- */

function CampusVehicles() {
  const { heli, deck } = HOSPKIT;
  return (
    <group>
      {HOSPKIT.ambulances.map((am, i) => (
        <KitProp key={i} kind="ambulance" x={am.x} z={am.z} rot={am.rot} />
      ))}
      <KitProp kind="helipadDeck" x={deck.x} z={deck.z} y={deck.y} rot={deck.rot} s={deck.s} />
      <KitProp kind="helicopter" x={heli.x} z={heli.z} y={heli.y} rot={heli.rot} s={heli.s} />
    </group>
  );
}

/* ---------------- fence, hedges, plaza, bollards, decals ---------------- */

function CampusFence() {
  return (
    <group>
      <BakedKit kind="fence" placements={FENCE_PANELS} />
      <BakedKit kind="hedge" placements={HEDGES} />
    </group>
  );
}

function CampusPlaza() {
  return (
    <group>
      <BakedKit kind="paving" placements={PAVING} />
      <BakedKit kind="stripe" placements={STRIPES} />
      <BakedKit kind="bayDecal" placements={BAY_DECALS} />
      <BakedKit kind="bollard" placements={BOLLARDS} />
    </group>
  );
}

/* ---------------- yard furniture ---------------- */

function CampusYard() {
  const { generator, totem, wetSign } = HOSPKIT;
  return (
    <group>
      <KitProp kind="generator" x={generator.x} z={generator.z} rot={generator.rot} />
      <KitProp kind="totem" x={totem.x} z={totem.z} rot={totem.rot} />
      <KitProp kind="wetSign" x={wetSign.x} z={wetSign.z} rot={wetSign.rot} />
      {HOSPKIT.gasCylinders.map((gc, i) => (
        <KitProp key={`g${i}`} kind="gasCylinder" x={gc.x} z={gc.z} rot={gc.rot} />
      ))}
      {HOSPKIT.bins.map((bn, i) => (
        <KitProp key={`b${i}`} kind="bin" x={bn.x} z={bn.z} rot={bn.rot} />
      ))}
      {HOSPKIT.wheelchairs.map((wc, i) => (
        <KitProp key={`w${i}`} kind="wheelchair" x={wc.x} z={wc.z} rot={wc.rot} />
      ))}
    </group>
  );
}

/* ---------------- the kit crew — WORKING staff bots, not statues ----------------
 * The five kit characters used to idle forever at their spawn spots. Now each
 * one walks a real shift loop on the campus grounds: the doctor does the
 * rounds (canopy → plaza → clinic annexe → back), the nurse tends the parked
 * wheelchairs and checks the benches, the paramedic walks the ambulance bay
 * checking each vehicle at the ER doors, the surgeon holds the ER forecourt,
 * and the patient shuffles slowly between the annexe and the plaza benches
 * for fresh air. Walk clip while moving, Idle clip while pausing — both play
 * permanently and crossfade by weight, and the whole mixer gates on player
 * distance so far-away staff cost nothing.                                   */

/** one shift loop: waypoints + idle seconds at each + walk speed (u/s) */
interface StaffShift { pts: [number, number][]; stops: number[]; walkS: number }

const STAFF_SHIFTS: StaffShift[] = [
  // doctor — ward rounds from the canopy to the clinic annexe and back
  {
    pts: [[100, 104.6], [98.6, 99.5], [89.5, 100.05], [86.9, 100.1], [89.5, 100.05], [98.6, 99.5]],
    stops: [2.4, 1.8, 1.0, 3.2, 1.0, 1.4],
    walkS: 1.6,
  },
  // nurse — wheelchair check under the canopy, then the plaza benches
  {
    pts: [[103.4, 99.8], [102.9, 105.7], [102.6, 104.6], [99.2, 101.8], [94.3, 97.3], [98.8, 99.6]],
    stops: [1.0, 3.0, 1.4, 0, 2.6, 0.8],
    walkS: 1.5,
  },
  // paramedic — ambulance bay checklist, bay 1 → bay 2 → ER doors
  {
    pts: [[108.6, 91.6], [111.6, 89.5], [108.6, 91.6], [111.6, 93.5], [114.3, 92.2]],
    stops: [1.2, 2.6, 0, 2.6, 2.2],
    walkS: 1.7,
  },
  // patient — a slow shuffle from the annexe to the benches and back
  {
    pts: [[89.6, 99.2], [92.2, 96.4], [93.4, 92.6], [96.8, 98.3], [93.6, 99.8]],
    stops: [2.0, 0, 4.2, 2.0, 1.6],
    walkS: 0.95,
  },
  // surgeon — holds the ER forecourt, checks the bay then the wet-sign corner
  {
    pts: [[110.8, 95.8], [113.2, 92.0], [114.5, 92.6], [110.6, 91.7], [108.7, 94.9]],
    stops: [1.0, 1.8, 2.4, 1.4, 2.0],
    walkS: 1.6,
  },
];

const STAFF_SEE = 120; // mixer distance gate (u)

function StaffBot({ kind, shift, engine }: { kind: HospitalKind; shift: StaffShift; engine: GameEngine }) {
  const spawn = useStaffModel(kind);
  const st = useRef({
    pos: { x: shift.pts[0][0], z: shift.pts[0][1] },
    wp: 1,
    idleT: shift.stops[0] ?? 0,
    face: 0,
    primed: false,
    walk: null as THREE.AnimationAction | null,
    idle: null as THREE.AnimationAction | null,
  });
  // face the first leg when the clone lands (KitProp-style transform below)
  useEffect(() => {
    if (!spawn || st.current.primed) return;
    st.current.primed = true;
    const s = st.current;
    const t = shift.pts[1 % shift.pts.length];
    s.face = Math.atan2(t[0] - s.pos.x, t[1] - s.pos.z);
    if (spawn.mixer) {
      const w = spawn.clips["walk"], id = spawn.clips["idle"];
      if (w) { const a = spawn.mixer.clipAction(w); a.play(); s.walk = a; s.walk.setEffectiveWeight(0); }
      if (id) { const a = spawn.mixer.clipAction(id); a.play(); s.idle = a; }
    }
  }, [spawn, shift]);
  useFrame((_, dt) => {
    const s = st.current;
    const root = spawn?.root, mixer = spawn?.mixer;
    if (!root || !mixer) return;
    // distance gate — the campus sits at the city's edge; far away, they sleep
    const p = engine.player;
    if (p && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) > STAFF_SEE) return;
    const n = shift.pts.length;
    if (s.idleT > 0) {
      s.idleT -= dt;
    } else {
      const t = shift.pts[s.wp % n];
      const dx = t[0] - s.pos.x, dz = t[1] - s.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.22) {
        s.wp = (s.wp + 1) % n;
        s.idleT = Math.max(0, shift.stops[(s.wp + n - 1) % n]);
      } else {
        const step = Math.min(dist, shift.walkS * dt);
        s.pos.x += (dx / dist) * step;
        s.pos.z += (dz / dist) * step;
        const want = Math.atan2(dx, dz);
        let da = want - s.face;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        s.face += da * Math.min(1, 9 * dt);
      }
    }
    // Walk↔Idle crossfade — both actions play, weights ease toward the state
    const moving = s.idleT <= 0;
    if (s.walk) s.walk.setEffectiveWeight(s.walk.weight + ((moving ? 1 : 0) - s.walk.weight) * Math.min(1, dt * 6));
    if (s.idle) s.idle.setEffectiveWeight(s.idle.weight + ((moving ? 0 : 1) - s.idle.weight) * Math.min(1, dt * 6));
    root.position.set(s.pos.x, 0.062, s.pos.z); // ride the paving slabs
    root.rotation.y = s.face;
    mixer.update(dt);
  });
  if (!spawn) return null;
  return (
    <primitive
      object={spawn.root}
      position={[shift.pts[0][0], 0.062, shift.pts[0][1]]}
      rotation-y={0}
    />
  );
}

function CampusStaff({ engine }: { engine: GameEngine }) {
  return (
    <group>
      {HOSPKIT.staff.map((st, i) => (
        <StaffBot key={i} kind={st.kind as HospitalKind} shift={STAFF_SHIFTS[i % STAFF_SHIFTS.length]} engine={engine} />
      ))}
    </group>
  );
}

/** the whole campus — mount inside WorldView's static cull root */
export function HospitalCampus({ engine }: { engine: GameEngine }) {
  return (
    <group>
      <CampusGrounds />
      <CampusBuildings />
      <CampusVehicles />
      <CampusFence />
      <CampusPlaza />
      <CampusYard />
      <CampusStaff engine={engine} />
    </group>
  );
}
