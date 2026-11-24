/**
 * 🪦 7Nights cemetery estate — polyfork Halloween Night kit (GLB) scene parts.
 *
 * Every tombstone, fence run, gate, building, hearse and lantern here is the
 * REAL kit model from https://polyfork.dev/kit/halloween-night-46ade4 (see
 * src/lib/game/graveyardModels.ts), replacing the old hand-built primitive
 * boxes. Repeated props (64 fence runs, 70+ headstones, 14 mounds) are baked
 * into one merged mesh per kind; the estate one-offs (gate, haunted house,
 * mausoleum, hearse…) spawn as grounded clones.
 *
 * Placement data (GRAVEKIT) is derived from the GRAVEYARD const in worldgen —
 * colliders and rendering always agree. Orientation tweaks live in MODEL_YAW.
 */
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GRAVEKIT, TOWN_SQUARE } from "@/lib/game/worldgen";
import { GRAVEYARD } from "@/lib/game/constants";
import { nightFactor } from "@/lib/game/sim";
import { mulberry32, range } from "@/lib/game/rng";
import {
  bakeGraveyardModel, onGraveyardModelsReady, spawnGraveyardModel,
  type GraveyardKind, type GraveyardPlacement,
} from "@/lib/game/graveyardModels";

/** authored forward fixes — tune if a catalog update turns a model around
 *  (the hearse left: it's a REAL drivable car now, rendered by GlbCars) */
const MODEL_YAW: Partial<Record<GraveyardKind, number>> = {};

/** spawn once per component + re-render when the GLB lands */
function useKitModel(kind: GraveyardKind) {
  const [root, setRoot] = useState<THREE.Group | null>(() => spawnGraveyardModel(kind));
  useEffect(() => {
    if (root) return;
    return onGraveyardModelsReady(() => setRoot(spawnGraveyardModel(kind)));
  }, [kind, root]);
  return root;
}

/** generic grounded kit prop placement */
function KitProp({ kind, x, z, y = 0, rot = 0, s = 1 }: {
  kind: GraveyardKind; x: number; z: number; y?: number; rot?: number; s?: number;
}) {
  const root = useKitModel(kind);
  if (!root) return null;
  return (
    <primitive
      object={root}
      position={[x, y, z]}
      rotation-y={rot + (MODEL_YAW[kind] ?? 0)}
      scale={s}
    />
  );
}

/** MANY placements of one kind → ONE merged vertex-coloured mesh (1 draw call) */
function BakedKit({ kind, placements }: { kind: GraveyardKind; placements: GraveyardPlacement[] }) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(() => bakeGraveyardModel(kind, placements));
  useEffect(() => {
    if (mesh) return;
    return onGraveyardModelsReady(() => setMesh(bakeGraveyardModel(kind, placements)));
    // placements are module-level constants — stable across renders
  }, [kind, mesh]);
  useEffect(() => () => {
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  return mesh ? <primitive object={mesh} /> : null;
}

/* ------------------------------------------------------------------ */
/* deterministic placement tables (module scope — computed once)       */
/* ------------------------------------------------------------------ */

/** 🪦 headstones: the classic slabs, kept clear of buildings + the path strip */
function headstonePlacements(): GraveyardPlacement[] {
  const r = mulberry32(99);
  const out: GraveyardPlacement[] = [];
  const { x: gx, z: gz } = GRAVEYARD;
  for (let i = 0; i < 118 && out.length < 96; i++) {
    const a = range(r, 0, Math.PI * 2), d = range(r, 4, 38.5);
    const px = gx + Math.cos(a) * d, pz = gz + Math.sin(a) * d;
    if (Math.hypot(px - GRAVEKIT.house.x, pz - GRAVEKIT.house.z) < 12) continue;
    if (Math.hypot(px - GRAVEKIT.mausoleum.x, pz - GRAVEKIT.mausoleum.z) < 6.5) continue;
    if (Math.hypot(px - GRAVEKIT.hearse.x, pz - GRAVEKIT.hearse.z) < 5) continue;
    // keep the entrance path corridor clear (along = distance up the path)
    const ax = px - gx, az = pz - gz;
    const along = ax * GRAVEKIT.u.x + az * GRAVEKIT.u.z;
    const perp = ax * GRAVEKIT.v.x + az * GRAVEKIT.v.z;
    if (along > 0 && along < 44 && Math.abs(perp) < 4.2) continue;
    out.push({ x: px, z: pz, rot: range(r, -0.4, 0.4) });
  }
  return out;
}

/** 🪦 a scattering of small foam memorials near the fence line (scaled up ×2.2) */
function foamPlacements(): GraveyardPlacement[] {
  const r = mulberry32(321);
  const out: GraveyardPlacement[] = [];
  const { x: gx, z: gz } = GRAVEYARD;
  for (let i = 0; i < 34 && out.length < 18; i++) {
    const a = range(r, 0, Math.PI * 2), d = range(r, 31, 39);
    const px = gx + Math.cos(a) * d, pz = gz + Math.sin(a) * d;
    if (Math.hypot(px - GRAVEKIT.house.x, pz - GRAVEKIT.house.z) < 13) continue;
    if (Math.hypot(px - GRAVEKIT.mausoleum.x, pz - GRAVEKIT.mausoleum.z) < 7) continue;
    const ax = px - gx, az = pz - gz;
    const along = ax * GRAVEKIT.u.x + az * GRAVEKIT.u.z;
    const perp = ax * GRAVEKIT.v.x + az * GRAVEKIT.v.z;
    if (along > 0 && along < 44 && Math.abs(perp) < 4.5) continue;
    out.push({ x: px, z: pz, rot: range(r, -0.5, 0.5), s: 2.2 });
  }
  return out;
}

/** 🪦 fresh grave mounds hump out of the lawn near the fence */
function moundPlacements(): GraveyardPlacement[] {
  const r = mulberry32(77);
  const out: GraveyardPlacement[] = [];
  const { x: gx, z: gz } = GRAVEYARD;
  for (let i = 0; i < 14; i++) {
    const a = range(r, 0, Math.PI * 2), d = range(r, 26, 38);
    const px = gx + Math.cos(a) * d, pz = gz + Math.sin(a) * d;
    if (Math.hypot(px - GRAVEKIT.house.x, pz - GRAVEKIT.house.z) < 13) continue;
    const ax = px - gx, az = pz - gz;
    const along = ax * GRAVEKIT.u.x + az * GRAVEKIT.u.z;
    const perp = ax * GRAVEKIT.v.x + az * GRAVEKIT.v.z;
    if (along > 0 && along < 44 && Math.abs(perp) < 5) continue;
    out.push({ x: px, z: pz, rot: range(r, 0, 3), s: range(r, 1.2, 1.6) });
  }
  return out;
}

const HEADSTONES = headstonePlacements();
const FOAMSTONES = foamPlacements();
const MOUNDS = moundPlacements();
const FENCE_RUNS: GraveyardPlacement[] = GRAVEKIT.fenceRuns.map((fr) => ({ x: fr.x, z: fr.z, rot: fr.rot, s: 1.05 }));

/* ------------------------------------------------------------------ */

function CemeteryFence() {
  return (
    <group>
      <BakedKit kind="fence" placements={FENCE_RUNS} />
      {/* 🚪 the arched cemetery gate — half open, as if something just passed */}
      <KitProp kind="gate" x={GRAVEKIT.gate.x} z={GRAVEKIT.gate.z} rot={GRAVEKIT.gate.rot} s={1.2} />
    </group>
  );
}

function CemeteryGraves() {
  return (
    <group>
      <BakedKit kind="headstone" placements={HEADSTONES} />
      <BakedKit kind="gravestoneFoam" placements={FOAMSTONES} />
      <BakedKit kind="mound" placements={MOUNDS} />
    </group>
  );
}

function CemeteryEstate() {
  return (
    <group>
      {/* 🏚️ the HAUNTED VICTORIAN HOUSE looms over the far lawn */}
      <KitProp kind="house" x={GRAVEKIT.house.x} z={GRAVEKIT.house.z} rot={GRAVEKIT.house.rot} s={1.12} />
      {/* mossy steps climb to its porch */}
      <KitProp kind="steps" x={GRAVEKIT.steps.x} z={GRAVEKIT.steps.z} rot={GRAVEKIT.steps.rot} s={1.35} />
      {/* ⚰️ the family mausoleum + the coffin waiting inside */}
      <KitProp kind="mausoleum" x={GRAVEKIT.mausoleum.x} z={GRAVEKIT.mausoleum.z} rot={GRAVEKIT.mausoleum.rot} s={1.15} />
      <KitProp kind="coffin" x={GRAVEKIT.coffin.x} z={GRAVEKIT.coffin.z} y={0.18} rot={GRAVEKIT.coffin.rot} s={1.1} />
      {/* ⚰️ the vintage hearse is a REAL drivable car now (world.cars, type
          HEARSE_TYPE) — GlbCars renders the model, the engine guards it */}
    </group>
  );
}

function CemeteryDetails() {
  return (
    <group>
      {/* 🗿 weeping stone angels flank the path */}
      {GRAVEKIT.angels.map((an, i) => (
        <KitProp key={`a${i}`} kind="angel" x={an.x} z={an.z} rot={an.rot} s={1.2} />
      ))}
      {/* 💀 skeletons clawing out of the lawn */}
      {GRAVEKIT.skeletons.map((sk, i) => (
        <KitProp key={`s${i}`} kind="skeleton" x={sk.x} z={sk.z} rot={sk.rot} s={1.35} />
      ))}
      {/* 🌵 bare thorn bushes hug the fence line */}
      {GRAVEKIT.bushes.map((bu, i) => (
        <KitProp key={`b${i}`} kind="bush" x={bu.x} z={bu.z} rot={i * 1.7} s={1.3} />
      ))}
      {/* 🐦‍⬛ crows perch on the fence rails + the mausoleum roof */}
      {GRAVEKIT.crows.map((cr, i) => (
        <KitProp key={`c${i}`} kind="crow" x={cr.x} z={cr.z} y={cr.y} rot={cr.rot} s={1.5} />
      ))}
    </group>
  );
}

function CemeteryTrees() {
  return (
    <group>
      {/* 🌰 twisted dead oaks */}
      {GRAVEKIT.oaks.map((ok, i) => (
        <KitProp key={i} kind="oak" x={ok.x} z={ok.z} s={ok.s} />
      ))}
      {/* 👻 cheesecloth ghosts hang in the branches */}
      {GRAVEKIT.ghosts.map((gh, i) => (
        <KitProp key={i} kind="ghosts" x={gh.x} z={gh.z} y={gh.y} s={0.9} />
      ))}
    </group>
  );
}

/** 🏮 lantern posts + their warm flickering night glow */
function CemeteryLanterns({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const glow = useRef<THREE.InstancedMesh>(null!);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(() => {
    const nf = nightFactor(clockRef.current);
    const flick = 0.85 + Math.sin(performance.now() * 0.0053) * 0.07 + Math.sin(performance.now() * 0.0131) * 0.05;
    if (glowMat.current) {
      glowMat.current.opacity = Math.max(0, nf - 0.25) * 0.85 * flick;
      glow.current.visible = glowMat.current.opacity > 0.02;
    }
  });
  return (
    <group>
      {GRAVEKIT.lanterns.map((ln, i) => (
        <KitProp key={i} kind="lantern" x={ln.x} z={ln.z} rot={i * 1.9} />
      ))}
      <instancedMesh ref={glow} args={[undefined, undefined, GRAVEKIT.lanterns.length]} frustumCulled={false} visible={false}>
        <sphereGeometry args={[0.85, 8, 6]} />
        <meshBasicMaterial ref={glowMat} color="#ffb14a" transparent opacity={0} depthWrite={false} />
      </instancedMesh>
      <LanternGlowSetup glow={glow} />
    </group>
  );
}

/** fills the glow instanced matrices (lantern head height ≈ 2.35) */
function LanternGlowSetup({ glow }: { glow: React.RefObject<THREE.InstancedMesh> }) {
  useEffect(() => {
    const im = glow.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    GRAVEKIT.lanterns.forEach((ln, i) => {
      m.makeTranslation(ln.x, 2.35, ln.z);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  }, [glow]);
  return null;
}

/** 🎃 jack-o-lanterns grinning along the lane + one in town (halloween found the whole map) */
function CemeteryPumpkins() {
  return (
    <group>
      {GRAVEKIT.pumpkins.map((pk, i) => (
        <KitProp key={i} kind="pumpkin" x={pk.x} z={pk.z} rot={i * 2.4} s={1.6 * pk.s} />
      ))}
      <KitProp kind="pumpkin" x={TOWN_SQUARE.x + 6.5} z={TOWN_SQUARE.z - 3} rot={1.2} s={1.7} />
    </group>
  );
}

/** the whole estate — mount inside WorldView's <Graves> */
export function GraveyardEstate({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  return (
    <group>
      <CemeteryFence />
      <CemeteryGraves />
      <CemeteryEstate />
      <CemeteryDetails />
      <CemeteryTrees />
      <CemeteryLanterns clockRef={clockRef} />
      <CemeteryPumpkins />
    </group>
  );
}
