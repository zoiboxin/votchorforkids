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
import { useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOSPKIT } from "@/lib/game/worldgen";
import {
  bakeHospitalModel, onHospitalModelsReady, spawnHospitalModel,
  type HospitalKind, type HospitalPlacement,
} from "@/lib/game/hospitalModels";

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

/* ---------------- the kit crew (skinned, idling) ---------------- */

function CampusStaff() {
  return (
    <group>
      {HOSPKIT.staff.map((st, i) => (
        <KitProp key={i} kind={st.kind} x={st.x} z={st.z} rot={st.rot} />
      ))}
    </group>
  );
}

/** the whole campus — mount inside WorldView's static cull root */
export function HospitalCampus() {
  return (
    <group>
      <CampusGrounds />
      <CampusBuildings />
      <CampusVehicles />
      <CampusFence />
      <CampusPlaza />
      <CampusYard />
      <CampusStaff />
    </group>
  );
}
