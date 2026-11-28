/**
 * 🚧 7Nights construction district — polyfork Construction Site kit (GLB).
 *
 * Three REAL, DISTINCT building sites digging REAL walkable pits (DIGS in
 * worldgen — graded ramp down, terraced dirt walls, machines + kit crew on
 * the floor), composed to match the kit's official live-preview scene
 * (polyfork.dev/kit/construction-site-9e40b0 — layout DNA: rising steel
 * frame built on the kit's stacking recipe (contiguous bays, 3.1m lifts,
 * metal-deck floors, full-height concrete core leading the steel), scaffold
 * hugging the frame, hoarding + mesh fence closing the whole block with
 * gated entries, walkway tunnels & loading gantry, materials yards with
 * precast/pallet rows on hardcore aprons, welfare compound with smoking
 * shelter & tool vault, machines fleet everywhere):
 *   A  "Lakeshore Towers"  — west midtown SKYSCRAPER job: 30m crane, 4-lift
 *      tower + twin cores rising out of its own deep foundation dig
 *   B  "Eastside Mega Dig" — east belt OPEN-PIT excavation: the rising
 *      structure stands ON the pit floor, two excavators, two dump trucks
 *   C  "Northgate Works"   — north boulevard BLOCK BUILD with its own crane
 *      and the mixer pouring at the ramp gate (the x26/z125 site)
 *
 * Everything static bakes into ONE merged vertex-coloured mesh per kind —
 * the whole district renders as ~55 draw calls with zero per-frame logic.
 * On top of the bake the live elements make the sites actually WORK:
 *   • <CraneTops>   — each slewing crane top is a live clone swinging slowly
 *                     (aviation beacon on the apex blinks after dark)
 *   • <DigGround>   — one static dirt heightfield per site (walls/ramp/floor)
 *   • <SandPiles>   — the preview's light aggregate stockpiles (procedural
 *                     lumpy-cone bake — the kit has no sand-pile GLB)
 *   • <SiteCrew>    — kit workers idling at their work spots (distance-gated)
 *   • <SiteLights>  — 🌙 NIGHT MODE: floodlight cones blaze under the light
 *                     towers, traffic signals cycle, cabin windows glow
 *                     (all additive materials driven by nightFactor — zero
 *                     real lights, invisible by day)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DIGS, SITEKIT, digDown, type ConSiteDef } from "@/lib/game/worldgen";
import {
  bakeConstructionModel, cloneConstructionModel, constructionAllSettled, constructionGroundY, constructionSize, onConstructionModelsReady,
  preloadConstructionModels,
  type ConstructionKind,
} from "@/lib/game/constructionModels";
import { loadGlbTemplate, makeGlbInstance } from "@/lib/game/glbCharacters";
import { nightFactor } from "@/lib/game/sim";
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
  // the rising structure + site edges (kit scene DNA: bays, deck floors, core)
  "craneMast", "steelFrame", "metalDeck", "coreSection", "scaffold", "formwork",
  "hoarding", "meshFence", "walkwayTunnel", "loadingGantry",
  // welfare + materials yards
  "cabin", "toilet", "smokingShelter", "toolVault", "lightTower", "generator",
  "pallet", "precast", "rebar", "scaffoldStack", "dumpyBag", "signBoard", "arrowBoard", "skip",
  "cementMixerStand", "airCompressor",
  // the machine fleet
  "excavator", "miniExcavator", "dumpTruck", "siteDumper", "wheeledLoader", "skidSteer",
  "telehandler", "bulldozer", "backhoe", "roadRoller", "mixerTruck", "concretePump",
  "flatbedLorry", "mobileCrane", "cherryPicker", "scissorLift", "trencher", "compactorPlate",
  "waterBowser", "wheelWash",
  // ground dressing + roadworks (tiles first, furniture last)
  "trench", "trenchPlate", "spoilHeap", "mudTile", "brokenRoad", "slabTile", "hardcoreTile",
  "crashBarrier", "trafficLight", "cone",
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

/* ---------------- ⛱️ SandPiles — the preview's aggregate stockpiles ----------------
 * The kit ships no sand-pile GLB, but its cover scene is dotted with light
 * aggregate mounds — so they're baked here: one merged lumpy-cone mesh per
 * reload (vertex-coloured sand + deterministic lumps/speckle, same Lambert
 * pipeline as the kit bakes). Sites list them as props.sandPiles {x,z,s};
 * physics tops are authored alongside in SITEKIT (steppable shoulders). */
export function SandPiles() {
  const mesh = useMemo(() => {
    const placements = SITEKIT.at.flatMap((s) => s.props.sandPiles ?? []);
    if (placements.length === 0) return null;
    const geos: THREE.BufferGeometry[] = [];
    const base = new THREE.Color("#c9b389");
    const crest = new THREE.Color("#dccaa1");
    const tmp = new THREE.Color();
    const v = new THREE.Vector3();
    for (const p of placements) {
      const s = p.s ?? 1;
      const R = 1.9 * s, H = 1.25 * s;
      const g = new THREE.ConeGeometry(R, H, 11, 3);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const hFrac = THREE.MathUtils.clamp((v.y + H / 2) / H, 0, 1);   // 0 base → 1 crest
        const ang = Math.atan2(v.z, v.x);
        // deterministic lumps so each pile reads as heaped aggregate
        const lump = 1 + 0.16 * Math.sin(3 * ang + p.x) * Math.sin(2 * ang + p.z) + 0.07 * Math.sin(5 * ang + p.z * 1.7);
        const rr = Math.max(0.02, Math.hypot(v.x, v.z)) * lump;
        v.x = Math.cos(ang) * rr;
        v.z = Math.sin(ang) * rr;
        pos.setXYZ(i, v.x, v.y, v.z);
        tmp.copy(base).lerp(crest, hFrac);
        const n = ((Math.sin((p.x + v.x) * 12.9898 + (p.z + v.z) * 78.233) * 43758.5453) % 1 + 1) % 1;
        tmp.offsetHSL(0, 0, (n - 0.5) * 0.05);
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      g.translate(p.x, p.y ?? 0, p.z);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return null;
    const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = "construction-sand-piles";
    return m;
  }, []);
  useEffect(() => () => {
    if (mesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  }, [mesh]);
  return mesh ? <primitive object={mesh} /> : null;
}

/* ---------------- 🏗️ CraneTops — the cranes actually WORK ----------------
 * Each site's slewing top is a live clone of the kit model swinging on a slow
 * sine — three draw calls + three cheap updates per frame, no bake rebuild. */
export function CraneTops({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const [tops, setTops] = useState<THREE.Group[]>([]);
  // 🌙 aviation beacon material — one shared blinking red lamp on each apex
  const beaconMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ff5a4d", transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  useEffect(() => () => beaconMat.dispose(), [beaconMat]);
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
        // 🌙 aviation beacon on the tower-head apex (model top above its
        // seating plane = authored size.y) — slews along with the top
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), beaconMat);
        beacon.position.y = constructionSize("craneTop").y;
        beacon.name = "crane-beacon";
        g.add(beacon);
        out.push(g);
      }
      setTops(out);
    };
    if (tops.length > 0) return;
    return onConstructionModelsReady(build);
    // tops are module-level constants — rebuild only once
  }, [tops.length, beaconMat]);
  useEffect(() => () => { for (const t of tops) t.clear(); }, [tops]);
  useFrame(({ clock }) => {
    for (let i = 0; i < tops.length; i++) {
      const p = SITEKIT.at[i]?.props.craneTop?.[0];
      if (p) tops[i].rotation.y = (p.rot ?? 0) + Math.sin(clock.elapsedTime * 0.14 + i * 2.1) * 1.15;
    }
    // 🌙 beacon blink — aviation strobes blink day AND night (subtle by day,
    // bright against the dark sky)
    const nf = nightFactor(clockRef.current);
    beaconMat.opacity = Math.sin(clock.elapsedTime * 3.4) > 0 ? 0.28 + nf * 0.72 : 0.05 + nf * 0.1;
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

/* ---------------- 🌙 SiteLights — the sites light up after dark ----------------
 * The kit preview has a day/night toggle — the game's day cycle does the same
 * to the sites: each lighting tower blazes a warm floodlight cone onto the
 * yard, the temporary traffic signals cycle, the site cabins get lit windows
 * and (in <CraneTops>) the tower heads blink their aviation beacons. ALL of
 * it is additive basic material driven by nightFactor — zero real lights (no
 * shader recompiles), invisible by day, and ~25 tiny meshes for the whole
 * district. */
const LAMP_H = 9.26;          // measured: lighting-tower model, ground-lifted

export function SiteLights({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const towers = useMemo(() => SITEKIT.at.flatMap((s) => s.props.lightTower ?? []), []);
  const signals = useMemo(() => SITEKIT.at.flatMap((s) => s.props.trafficLight ?? []), []);
  const cabins = useMemo(() => SITEKIT.at.flatMap((s) => s.props.cabin ?? []), []);

  const floodMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ffdf9e", transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), []);
  const poolMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ffdf9e", transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);
  const lampMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ffd76a", transparent: true, opacity: 0, depthWrite: false,
  }), []);
  const signalMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ff4d4d", transparent: true, opacity: 0, depthWrite: false,
  }), []);
  const windowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ffc966", transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide,
  }), []);
  useEffect(() => () => {
    for (const m of [floodMat, poolMat, lampMat, signalMat, windowMat]) m.dispose();
  }, [floodMat, poolMat, lampMat, signalMat, windowMat]);

  useFrame(({ clock }) => {
    const nf = nightFactor(clockRef.current);
    const on = Math.max(0, nf - 0.25);                       // lamps wake at dusk
    const flick = 0.85 + Math.sin(clock.elapsedTime * 7.3) * 0.04 + Math.sin(clock.elapsedTime * 13.7) * 0.03;
    floodMat.opacity = Math.min(0.42, on * 0.5 * flick);
    poolMat.opacity = Math.min(0.16, on * 0.2 * flick);
    lampMat.opacity = Math.min(1, on * 1.45 * flick);
    // traffic signals cycle red → green → amber (kit styling: warm glow lens)
    const ph = (clock.elapsedTime % 9) / 9;
    signalMat.color.set(ph < 0.45 ? "#ff4d4d" : ph < 0.56 ? "#ffb347" : "#57e389");
    signalMat.opacity = Math.min(1, on * 1.3);
    windowMat.opacity = Math.min(0.9, on * 1.05);
  });

  return (
    <group>
      {/* 🔆 floodlight cones — apex at the tower's lamp head, spreading down */}
      {towers.map((p, i) => (
        <group key={`tw-${i}`} position={[p.x, p.y ?? 0, p.z]} rotation-y={p.rot ?? 0}>
          <mesh material={floodMat} position-y={LAMP_H - LAMP_H / 2}>
            <coneGeometry args={[5.8, LAMP_H, 14, 1, true]} />
          </mesh>
          {/* lit ground pool under the tower */}
          <mesh material={poolMat} rotation-x={-Math.PI / 2} position-y={0.09}>
            <circleGeometry args={[6.1, 20]} />
          </mesh>
          {/* the blazing lamp head */}
          <mesh material={lampMat} position-y={LAMP_H - 0.35}>
            <sphereGeometry args={[0.62, 8, 6]} />
          </mesh>
        </group>
      ))}
      {/* 🚦 temporary traffic signal lenses */}
      {signals.map((p, i) => (
        <mesh key={`sg-${i}`} material={signalMat} position={[p.x, (p.y ?? 0) + 1.98, p.z]}>
          <sphereGeometry args={[0.3, 8, 6]} />
        </mesh>
      ))}
      {/* 🪟 site cabin windows — a warm glow on both long faces */}
      {cabins.map((p, i) => (
        <group key={`cb-${i}`} position={[p.x, p.y ?? 0, p.z]} rotation-y={p.rot ?? 0}>
          <mesh material={windowMat} position={[0, 2.08, 3.72]}>
            <planeGeometry args={[1.5, 0.85]} />
          </mesh>
          <mesh material={windowMat} position={[0, 2.08, -3.72]} rotation-y={Math.PI}>
            <planeGeometry args={[1.5, 0.85]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** the whole construction district — mount inside WorldView's city group.
 *  🚧 named "construction-district" so the static culler exempts it entirely
 *  (see staticCull.ts): the merged bakes + dig patches are ~58 draws total and
 *  must NEVER fold away — a culled dig patch once read as a sky-blue hole. */
export function ConstructionSites({ engine, clockRef }: {
  engine: GameEngine;
  clockRef: React.MutableRefObject<number>;
}) {
  useEffect(() => preloadConstructionModels(), []);
  const meshes = useBakedSite();
  return (
    <group name="construction-district">
      <DigGround />
      <SandPiles />
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <CraneTops clockRef={clockRef} />
      <SiteLights clockRef={clockRef} />
      <SiteCrew engine={engine} />
    </group>
  );
}
