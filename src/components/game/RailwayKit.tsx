/**
 * 🚂 7Nights countryside railway — polyfork Countryside Railway kit (GLB).
 *
 * The branch line through the farm band becomes a REAL country railway (see
 * RAILKIT in worldgen): 4m kit track sections carry the whole arc, the blue
 * country station fronts a real platform with canopy/shelter/benches/lamps,
 * the footbridge spans the rails, the goods yard hides engine + goods sheds
 * behind a water tower / coal stage / weighbridge / turntable, the 15:07 is a
 * REAL tank loco + tender + coaches + brake van, a goods rake parks down the
 * line, the level crossing gains its keeper's cottage and gates, and the kit
 * crew idles at their posts.
 *
 * ALL static props bake into ONE merged vertex-coloured mesh per kind — the
 * whole railway (track included) renders as ~45 draw calls with zero per-frame
 * logic; only the 7 skinned crew members run mixers, distance-gated.
 */
import { useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RAILKIT } from "@/lib/game/worldgen";
import {
  bakeRailwayModel, onRailwayModelsReady, preloadRailwayModels, spawnRailwayModel,
  type RailwayKind,
} from "@/lib/game/railwayModels";
import type { GameEngine } from "@/lib/game/engine";

/** spawn once per component + re-render when the GLBs land */
function useBakedRail(): THREE.Mesh[] {
  const [meshes, setMeshes] = useState<THREE.Mesh[]>(() => bakeAll());
  useEffect(() => {
    if (meshes.length > 0) return;
    return onRailwayModelsReady(() => setMeshes(bakeAll()));
    // RAILKIT placements are module-level constants — stable across renders
  }, [meshes.length]);
  useEffect(() => () => {
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }, [meshes]);
  return meshes;
}

const BAKE_ORDER: RailwayKind[] = [
  // the line itself first (biggest bake — 465 track sections)
  "track", "poleRun", "bufferStop", "fenceRun", "semaphore", "discSignal", "signPost",
  // station
  "platformRun", "canopyRun", "shelter", "bench", "clockPost", "lampPost", "bookstall",
  "posterBoard", "barrow", "trolley", "footbridge", "gardenBed", "runningBoard", "stationBuilding",
  // goods yard
  "engineShed", "goodsShed", "waterTower", "waterCrane", "pumpHouse", "coalStage", "coalBin",
  "signalBox", "weighbridge", "fuelTank", "yardCrane", "cattleDock", "turntable", "loadingGauge",
  "sleeperStack", "railStack", "ballastHeap", "hut", "tree",
  // crossing
  "levelCrossing", "crossingGate", "cottage",
  // rolling stock
  "tankLoco", "coalTender", "coach", "brakeCoach", "goodsVan", "openWagon", "cattleWagon",
  "flatWagon", "hopperWagon", "tankWagon", "guardsVan", "shunter", "handcar", "railbus",
];

/** gather every placement of one kind and bake them into one mesh */
function bakeKind(kind: RailwayKind): THREE.Mesh | null {
  const placements = RAILKIT.props[kind] ?? [];
  if (placements.length === 0) return null;
  return bakeRailwayModel(kind, placements);
}

function bakeAll(): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const kind of BAKE_ORDER) {
    const m = bakeKind(kind);
    if (m) out.push(m);
  }
  return out;
}

/* ---------------- ⛑️ the kit crew on shift ----------------
 * Real kit characters idle at their posts (platform, crossing, yard). Mixers
 * gate on player distance so far-away crews cost nothing. */
const CREW_SEE = 120;

function CrewBot({ slug, x, z, rot, engine }: {
  slug: string; x: number; z: number; rot: number; engine: GameEngine;
}) {
  const [spawn, setSpawn] = useState(() => spawnRailwayModel(slug));
  useEffect(() => {
    if (spawn) return;
    return onRailwayModelsReady(() => setSpawn(spawnRailwayModel(slug)));
  }, [spawn]);
  useEffect(() => () => { spawn?.mixer?.stopAllAction(); }, [spawn]);
  useFrame((_, dt) => {
    if (!spawn?.mixer) return;
    const p = engine.player;
    if (p && Math.hypot(p.x - x, p.z - z) > CREW_SEE) return;
    spawn.mixer.update(dt);
  });
  if (!spawn) return null;
  return <primitive object={spawn.root} position={[x, 0, z]} rotation-y={rot} />;
}

/** the whole countryside railway kit — mount inside WorldView's static cull root */
export function RailwayKit({ engine }: { engine: GameEngine }) {
  useEffect(() => preloadRailwayModels(), []);
  const meshes = useBakedRail();
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {RAILKIT.crew.map((c, i) => (
        <CrewBot key={i} slug={c.slug} x={c.x} z={c.z} rot={c.rot} engine={engine} />
      ))}
    </group>
  );
}
