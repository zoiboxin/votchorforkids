/**
 * 🚧 7Nights construction district — polyfork Construction Site kit (GLB).
 *
 * Three REAL building sites on empty city blocks (SITEKIT in worldgen):
 *   A  "Lakeshore Towers" — west midtown: a 45m tower crane over a rising
 *      steel skeleton, concrete core, scaffold, hoarding & site welfare
 *   B  "Eastside Dig"     — east belt: tracked excavator, open trench bays,
 *      spoil heaps, dump truck, crash barriers & traffic lights
 *   C  "Northgate Works"  — north boulevard: backhoe, road roller, mixer
 *      truck chewing up the road, arrow board, cones & barriers
 *
 * Every prop is the REAL kit model (see src/lib/game/constructionModels.ts);
 * ALL placements bake into ONE merged vertex-coloured mesh per kind — the
 * whole three-site district renders as ~20 draw calls with zero per-frame
 * logic, so the city stays light (same technique as the graveyard estate).
 */
import { useEffect, useState } from "react";
import * as THREE from "three";
import { SITEKIT, type ConSitePlacement } from "@/lib/game/worldgen";
import {
  bakeConstructionModel, onConstructionModelsReady, preloadConstructionModels,
  type ConstructionKind,
} from "@/lib/game/constructionModels";

/** spawn once per component + re-render when the GLBs land */
function useBakedSite(): THREE.Mesh[] {
  const [meshes, setMeshes] = useState<THREE.Mesh[]>(() => bakeAll());
  useEffect(() => {
    if (meshes.length > 0) return;
    return onConstructionModelsReady(() => setMeshes(bakeAll()));
    // SITEKIT placements are module-level constants — stable across renders
  }, [meshes.length]);
  useEffect(() => () => {
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }, [meshes]);
  return meshes;
}

const BAKE_ORDER: ConstructionKind[] = [
  "craneMast", "craneTop", "steelFrame", "coreSection", "scaffold",
  "hoarding", "meshFence", "cabin", "toilet", "lightTower", "generator",
  "pallet", "precast", "rebar", "cone", "signBoard",
  "excavator", "dumpTruck", "trench", "spoilHeap", "mudTile",
  "crashBarrier", "trafficLight", "backhoe", "roadRoller", "mixerTruck", "brokenRoad",
];

/** gather every site's placements of one kind and bake them into one mesh */
function bakeKind(kind: ConstructionKind): THREE.Mesh | null {
  const placements: ConSitePlacement[] = [];
  for (const site of SITEKIT.at) placements.push(...(site.props[kind] ?? []));
  if (placements.length === 0) return null;
  return bakeConstructionModel(kind, placements);
}

function bakeAll(): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const kind of BAKE_ORDER) {
    const m = bakeKind(kind);
    if (m) out.push(m);
  }
  return out;
}

/** the whole construction district — mount inside WorldView's city group */
export function ConstructionSites() {
  useEffect(() => preloadConstructionModels(), []);
  const meshes = useBakedSite();
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
