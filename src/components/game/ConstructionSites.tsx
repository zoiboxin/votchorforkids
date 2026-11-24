/**
 * 🚧 7Nights construction district — polyfork Construction Site kit (GLB).
 *
 * Three REAL, DISTINCT building sites digging REAL walkable pits (DIGS in
 * worldgen — graded ramp down, terraced dirt walls, machines + kit crew on
 * the floor):
 *   A  "Lakeshore Towers"  — west midtown SKYSCRAPER job: 30m crane, tower
 *      rising out of its own deep foundation dig
 *   B  "Eastside Mega Dig" — east belt OPEN-PIT excavation: the rising
 *      structure stands ON the pit floor, two excavators, two dump trucks
 *   C  "Northgate Works"   — north boulevard BLOCK BUILD with its own crane
 *      and the mixer pouring at the ramp gate (the x26/z125 site)
 *
 * Everything static bakes into ONE merged vertex-coloured mesh per kind — the
 * whole district renders as ~25 draw calls with zero per-frame logic. On top
 * of the bake three small live elements make the sites actually WORK:
 *   • <CraneTops>  — each slewing crane top is a live clone swinging slowly
 *   • <DigGround>  — one static dirt heightfield per site (walls/ramp/floor)
 *   • <SiteCrew>   — kit workers idling at their work spots (distance-gated)
 */
import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DIGS, SITEKIT, digDown, type ConSiteDef } from "@/lib/game/worldgen";
import {
  bakeConstructionModel, cloneConstructionModel, constructionAllSettled, constructionGroundY, onConstructionModelsReady,
  preloadConstructionModels,
  type ConstructionKind,
} from "@/lib/game/constructionModels";
import { loadGlbTemplate, makeGlbInstance } from "@/lib/game/glbCharacters";
import type { GameEngine } from "@/lib/game/engine";

/** spawn once per component + re-render when the GLBs land */
function useBakedSite(): THREE.Mesh[] {
  // first paint bakes whatever is already cached (a Fast-Refresh remount may
  // catch a PARTIAL cache); the settle callback re-bakes the missing kinds
  const [meshes, setMeshes] = useState<THREE.Mesh[]>(() => bakeAll());
  const settled = constructionAllSettled();
  useEffect(() => {
    if (settled) return;
    return onConstructionModelsReady(() => setMeshes(bakeAll()));
    // SITEKIT placements are module-level constants — stable across renders
  }, [settled]);
  useEffect(() => () => {
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }, [meshes]);
  return meshes;
}

const BAKE_ORDER: ConstructionKind[] = [
  "craneMast", "steelFrame", "coreSection", "scaffold",
  "hoarding", "meshFence", "cabin", "toilet", "lightTower", "generator",
  "pallet", "precast", "rebar", "cone", "signBoard", "arrowBoard", "skip",
  "excavator", "dumpTruck", "trench", "spoilHeap", "mudTile",
  "crashBarrier", "trafficLight", "backhoe", "roadRoller", "mixerTruck", "brokenRoad",
];
// (craneTop is NOT baked — <CraneTops> swings each top live)

/** gather every site's placements of one kind and bake them into one mesh */
function bakeKind(kind: ConstructionKind): THREE.Mesh | null {
  const placements: ConSiteDef["props"][string] = [];
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

/* ---------------- 🕳️ DigGround — one dirt heightfield per site ----------------
 * Reads the SAME digDown() profile the physics uses, so the walls, the graded
 * ramp and the floor the player walks are exactly the geometry they touch.
 * Vertex colours: dirt tan yard → wet-earth gradient down the pit. Three
 * static meshes, zero per-frame cost. */
function DigGround() {
  const meshes = useMemo(() => {
    const out: THREE.Mesh[] = [];
    const yard = new THREE.Color("#a08663");
    const edge = new THREE.Color("#9b958b"); // feather to the city asphalt
    const top = new THREE.Color("#a58a60");
    const deep = new THREE.Color("#6b533b");
    const tmp = new THREE.Color();
    for (const d of DIGS) {
      const STEP = 1.25;
      const nx = Math.ceil((d.hx * 2) / STEP);
      const nz = Math.ceil((d.hz * 2) / STEP);
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= nz; j++) {
          const x = d.cx - d.hx + (i * d.hx * 2) / nx;
          const z = d.cz - d.hz + (j * d.hz * 2) / nz;
          const depth = digDown(x, z);
          pos.push(x, 0.06 - depth, z);
          // yard dirt feathers to asphalt at the patch border, pit dirt darkens
          const rimDist = Math.min(d.hx - Math.abs(x - d.cx), d.hz - Math.abs(z - d.cz));
          if (depth > 0.01) tmp.copy(top).lerp(deep, Math.min(1, depth / d.depth));
          else tmp.copy(yard).lerp(edge, 1 - Math.min(1, rimDist / 3));
          // deterministic speckle so the dirt doesn't read flat
          const n = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;
          tmp.offsetHSL(0, 0, (n - 0.5) * 0.035);
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const a = i * (nz + 1) + j, b = a + nz + 1;
          // counter-clockwise seen from above (+Y normals)
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      // DoubleSide: the terraced walls read edge-on from the ramp and the rim,
      // and the grid's culling subtleties must never let the pit floor vanish
      // (verified in-game: FrontSide dropped the whole patch against the sky)
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      m.name = `digground-${d.id}`;
      out.push(m);
    }
    return out;
  }, []);
  useEffect(() => () => {
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }, [meshes]);
  return (
    <group>
      {meshes.map((m, i) => <primitive key={i} object={m} />)}
    </group>
  );
}

/* ---------------- 🏗️ CraneTops — the cranes actually WORK ----------------
 * Each site's slewing top is a live clone of the kit model swinging on a slow
 * sine — three draw calls + three cheap updates per frame, no bake rebuild. */
function CraneTops() {
  const [tops, setTops] = useState<THREE.Group[]>([]);
  useEffect(() => {
    const build = () => {
      const out: THREE.Group[] = [];
      for (const site of SITEKIT.at) {
        const p = site.props.craneTop?.[0];
        if (!p) continue;
        const g = cloneConstructionModel("craneTop");
        if (!g) continue;
        // seat the SLEWING RING on the mast head: p.y is the mast-top height,
        // but the loader lifted the whole top by −groundY (its hook + cables
        // hang ~2m below the ring) — without this the ring floats above the
        // tower with only the cables bridging the gap (the "crane top in the
        // air" bug)
        g.position.set(p.x, (p.y ?? 0) + constructionGroundY("craneTop"), p.z);
        g.rotation.y = p.rot ?? 0;
        g.name = `crane-top-${out.length}`; // 🏗️ named for headless verification
        out.push(g);
      }
      setTops(out);
    };
    if (tops.length > 0) return;
    return onConstructionModelsReady(build);
    // tops are module-level constants — rebuild only once
  }, [tops.length]);
  useEffect(() => () => { for (const t of tops) t.clear(); }, [tops]);
  useFrame(({ clock }) => {
    for (let i = 0; i < tops.length; i++) {
      const p = SITEKIT.at[i]?.props.craneTop?.[0];
      if (p) tops[i].rotation.y = (p.rot ?? 0) + Math.sin(clock.elapsedTime * 0.14 + i * 2.1) * 1.15;
    }
  });
  return (
    <group>
      {tops.map((t, i) => <primitive key={i} object={t} />)}
    </group>
  );
}

/* ---------------- ⛑️ SiteCrew — the kit workers on shift ----------------
 * Real kit characters idle at their work spots (pit floor, ramp gate, yard).
 * Mixers gate on player distance so far-away crews cost nothing. */
const CREW_SEE = 120;

function CrewBot({ c, engine }: { c: NonNullable<ConSiteDef["crew"]>[number]; engine: GameEngine }) {
  const inst = useMemo(() => makeGlbInstance(c.slug, 1), [c.slug]);
  useEffect(() => {
    if (!inst) return;
    const keys = Object.keys(inst.actions);
    const idle = inst.actions["idle"] ?? (keys.length > 0 ? inst.actions[keys[0]] : null);
    if (idle) idle.play();
  }, [inst]);
  useFrame((_, dt) => {
    if (!inst) return;
    const p = engine.player;
    if (p && Math.hypot(p.x - c.x, p.z - c.z) > CREW_SEE) return;
    inst.mixer.update(dt);
  });
  if (!inst) return null;
  return <primitive object={inst.body} position={[c.x, c.y ?? 0, c.z]} rotation-y={c.rot} />;
}

function SiteCrew({ engine }: { engine: GameEngine }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const slugs = new Set<string>();
    for (const site of SITEKIT.at) for (const c of site.crew ?? []) slugs.add(c.slug);
    let alive = true;
    Promise.all([...slugs].map((s) => loadGlbTemplate(s).catch(() => null)))
      .then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  if (!ready) return null;
  return (
    <group>
      {SITEKIT.at.flatMap((site, si) =>
        (site.crew ?? []).map((c, ci) => <CrewBot key={`${si}-${ci}`} c={c} engine={engine} />))}
    </group>
  );
}

/** the whole construction district — mount inside WorldView's city group */
export function ConstructionSites({ engine }: { engine: GameEngine }) {
  useEffect(() => preloadConstructionModels(), []);
  const meshes = useBakedSite();
  return (
    <group>
      <DigGround />
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <CraneTops />
      <SiteCrew engine={engine} />
    </group>
  );
}
