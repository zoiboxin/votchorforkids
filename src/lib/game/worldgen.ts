import { AIRPORT, BUILD_POOL, CAR_ROOF_TOP, CITY_RADIUS, DEEP_JUNGLE_RADIUS, FARM_RADIUS, GRAVEYARD, HEARSE_TYPE, JUNGLE_RADIUS, MOUNTAIN_INNER, MOUNTAIN_OUTER, MUSEUM, POLICE_STATIONS, PREHISTORIC, ROCK_COUNT, TAXI_TYPE, VEHICLE_AXLE, VEHICLE_AXLE_R, VEHICLE_POOL, WALL_RADIUS, WORLD_SEED, inPrehistoricValley, pickVehicle, stationCage, stationGate } from "./constants";
import { PREHISTORIC_LAYOUT, prehistoricColliders } from "./prehistoric";
import { mulberry32, range } from "./rng";

export interface BoxCollider { x: number; z: number; w: number; d: number; /** building height (top y) — lets the chase camera ignore roofs above it */ h?: number; /** 🧍 standable surface height (absolute y) — a body whose feet are at/above this stands ON TOP instead of being pushed out (crates, low walls, scaffolds…) */ top?: number } // half extents
export interface CircleCollider { x: number; z: number; r: number; /** set for the two axle circles of a parked car — lets a DRIVEN car skip its own colliders */ car?: number; /** set on the ✈️ fuselage discs that follow a grounded plane (index into engine.planes) */ plane?: number; /** plane discs fold away once the plane climbs — false while grounded/taxiing */ air?: boolean; /** index inside world.circles — lets a DRIVEN car refresh its grid cells on every move */ idx?: number; /** set on the 🔨 breakable boulder this circle belongs to (index into world.rocks) */ rock?: number; /** set on the 🧱 builder pool circles — they MOVE onto built spots via moveCircle */ build?: number; /** 🧍 standable surface height (absolute y) — boulders, crates, hay bales, CAR ROOFS: jump on and stand (see standTopAt) */ top?: number }

/**
 * 🗺️ Spatial hash over every collider — the old resolve() scanned ALL ~1,424 boxes
 * & circles on every call, and it gets called ~150× per frame (133 bots + the
 * player + the driven car's sub-steps). That linear grind was the single biggest
 * frame-time hog, and it showed worst while driving (the car alone spends up to
 * 16 resolve calls per frame). The grid registers each collider in every cell it
 * overlaps, so a query only touches the handful of colliders around the point.
 * The player's driven car MOVES its two axle circles every frame — those are
 * re-registered on the fly (see refreshCarCircle), tracked in `carCells`.
 */
export interface ColliderGrid {
  cs: number;               // cell size (world units)
  x0: number; z0: number;   // world origin of cell (0,0)
  cols: number; rows: number;
  nb: number;               // boxes.length — indices < nb are boxes, ≥ nb are circles (idx - nb)
  cells: number[][];        // flattened grid, each cell holds combined item indices
  carCells: Map<number, number[]>; // circle idx → cell ids it currently occupies (dynamic circles)
}

const GRID_CS = 16;

function gridCellsFor(g: ColliderGrid, x: number, z: number, r: number, out: number[]): void {
  out.length = 0;
  const gx0 = Math.max(0, Math.floor((x - r - g.x0) / g.cs));
  const gx1 = Math.min(g.cols - 1, Math.floor((x + r - g.x0) / g.cs));
  const gz0 = Math.max(0, Math.floor((z - r - g.z0) / g.cs));
  const gz1 = Math.min(g.rows - 1, Math.floor((z + r - g.z0) / g.cs));
  for (let gz = gz0; gz <= gz1; gz++)
    for (let gx = gx0; gx <= gx1; gx++) out.push(gz * g.cols + gx);
}

/** Build the collider grid from the finished boxes/circles arrays (call once at world-gen). */
function buildColliderGrid(boxes: BoxCollider[], circles: CircleCollider[]): ColliderGrid {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const grow = (x: number, z: number, r: number) => {
    if (x - r < minX) minX = x - r; if (x + r > maxX) maxX = x + r;
    if (z - r < minZ) minZ = z - r; if (z + r > maxZ) maxZ = z + r;
  };
  for (const b of boxes) grow(b.x, b.z, Math.max(b.w, b.d));
  for (const c of circles) grow(c.x, c.z, c.r);
  const pad = GRID_CS * 2;
  const x0 = minX - pad, z0 = minZ - pad;
  const cols = Math.max(1, Math.ceil((maxX + pad - x0) / GRID_CS));
  const rows = Math.max(1, Math.ceil((maxZ + pad - z0) / GRID_CS));
  const g: ColliderGrid = { cs: GRID_CS, x0, z0, cols, rows, nb: boxes.length, cells: Array.from({ length: cols * rows }, () => []), carCells: new Map() };
  const ids: number[] = [];
  for (let i = 0; i < boxes.length; i++) {
    gridCellsFor(g, boxes[i].x, boxes[i].z, Math.max(boxes[i].w, boxes[i].d), ids);
    for (const id of ids) g.cells[id].push(i);
  }
  for (let j = 0; j < circles.length; j++) insertCircleGrid(g, circles[j], j);
  return g;
}

function insertCircleGrid(g: ColliderGrid, c: CircleCollider, j: number): void {
  const ids: number[] = [];
  gridCellsFor(g, c.x, c.z, c.r, ids);
  const combined = g.nb + j;
  for (const id of ids) g.cells[id].push(combined);
  // car axles, plane fuselage discs AND builder pool circles are DYNAMIC — their
  // cells are tracked so refreshCarCircle()/moveCircle() can unregister them first
  if (c.car !== undefined || c.plane !== undefined || c.build !== undefined) {
    let list = g.carCells.get(j);
    if (!list) { list = []; g.carCells.set(j, list); }
    list.push(...ids);
  }
}

/**
 * Register a NEW dynamic circle (✈️ plane fuselage discs, 🛡️ 7Nights barricades
 * & campfires) — appends it to the world AND slots it straight into the built
 * spatial hash. Returns the circle's index inside world.circles so the engine
 * can move it every frame via refreshCarCircle.
 */
export function addDynamicCircle(world: World, c: CircleCollider): number {
  const i = world.circles.length;
  c.idx = i;
  world.circles.push(c);
  if (world.grid) insertCircleGrid(world.grid, c, i);
  return i;
}

/**
 * Re-register a car's axle circle after it moved (the driven vehicle glides along
 * the roads, so its two colliders hop cells every frame while driving). Cheap:
 * removal is a swap-pop from the few cells the circle occupied, then a fresh insert.
 */
export function refreshCarCircle(world: World, gi: number): void {
  const g = world.grid;
  if (!g) return;
  const c = world.circles[gi];
  if (!c) return;
  const ids = g.carCells.get(gi);
  if (ids) {
    const combined = g.nb + gi;
    for (const id of ids) {
      const arr = g.cells[id];
      const k = arr.lastIndexOf(combined);
      if (k >= 0) { arr[k] = arr[arr.length - 1]; arr.pop(); }
    }
    ids.length = 0;
  }
  insertCircleGrid(g, c, gi);
}

/**
 * Building kinds:
 * 0 tower/office (flat roof, window grid)   1 shop (awning + sign + storefront)
 * 2 home (pyramid roof + yard)              3 mall
 * 4 school                                  5 hospital
 * 6 barn                                    7 police station (white, flat roof, garage)
 */
export interface Building extends BoxCollider { h: number; color: number; roof: number; kind: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; awn: number; fz: 1 | -1 }
/** 🌲 tree species — nature & forest kit grew the forest from 2 kinds to 7:
 *  0 pine (3 stacked cone tiers)       1 round broadleaf (5 blob puffs)
 *  2 birch (white bark, airy canopy)   3 oak (wide spreading crown)
 *  4 maple (warm autumn crown)         5 young pine (2 small tiers)
 *  6 dead snag (bare trunk + crooked branches) */
export interface Tree { x: number; z: number; r: number; s: number; kind: 0 | 1 | 2 | 3 | 4 | 5 | 6 }

/** Weighted species roll for a biome mix table — keeps the forest VARIED,
 *  not cloned (every biome gets its own recipe, still fully deterministic). */
function treeKindRoll(r: () => number, mix: [Tree["kind"], number][]): Tree["kind"] {
  let x = r();
  for (const [k, w] of mix) { x -= w; if (x <= 0) return k; }
  return mix[mix.length - 1][0];
}

/** biome recipes — outer jungle mixes everything, the deep band stays dark &
 *  claustrophobic, the farm ring favours birches & autumn maples. */
const OUTER_TREE_MIX: [Tree["kind"], number][] = [[0, 0.36], [1, 0.23], [2, 0.14], [3, 0.11], [4, 0.08], [5, 0.04], [6, 0.04]];
const DEEP_TREE_MIX: [Tree["kind"], number][] = [[1, 0.5], [0, 0.24], [6, 0.07], [3, 0.07], [2, 0.06], [4, 0.04], [5, 0.02]];
const FARM_TREE_MIX: [Tree["kind"], number][] = [[2, 0.32], [4, 0.28], [3, 0.2], [1, 0.12], [0, 0.08]];
export interface Flower { x: number; z: number; c: number; s: number }
export interface Car {
  x: number; z: number; rot: number; c: number;
  /** body style: 0 sedan · 1 hatchback · 2 van · 3 pickup truck · 4 city bus · 5 jeep */
  t: number;
}
export interface Lamp { x: number; z: number }
export interface Bench { x: number; z: number; rot: number }
export interface Field { x: number; z: number; w: number; d: number; rot: number; crop: number }
export interface Silo { x: number; z: number }
export interface Umbrella { x: number; z: number; c: number }
export interface Sign { x: number; z: number; rot: number; text: string; c: number }

export interface Rock { x: number; z: number; s: number }

/** 🏕️ A lonely camper site deep in the jungle — a cleared glade around a
 *  stone-ringed fire pit that NEVER goes out (see <CampFires> in WorldView).
 *  All offsets are relative to the camp centre (the fire pit itself). */
export interface Camp {
  x: number; z: number; rot: number;
  /** A-frame tents — rot aims the doorway back at the fire; c = canvas tint index */
  tents: { dx: number; dz: number; rot: number; c: number; s: number }[];
  /** split-log seats ringing the fire (no colliders — step over them) */
  logs: { dx: number; dz: number; rot: number }[];
  /** supply crates the campers left behind */
  crates: { dx: number; dz: number; rot: number }[];
  /** lantern pole — glows warm at dusk */
  pole: { dx: number; dz: number } | null;
  /** 🌲 nature & forest kit — the camp comforts (cook tripod over the fire,
   *  picnic tables, a lean-to shelter, maybe an outhouse & a water barrel) */
  kit: {
    picnic: { dx: number; dz: number; rot: number }[];
    leanTo: { dx: number; dz: number; rot: number } | null;
    outhouse: { dx: number; dz: number; rot: number } | null;
    barrel: { dx: number; dz: number } | null;
  };
}

/* ---------------- 🌲 nature & forest kit — the wild band grows up ----------------
 * Forest floor (ferns, tufts, toadstools, bushes, wildflowers, stumps, fallen
 * logs — all steppable), jungle ponds with docks & boats, winding dirt trails
 * with signposts & lantern posts, log cabins, a ranger station with its pickup,
 * a fire lookout tower, rock spires and a plank bridge over the creek. */
export interface Pond { x: number; z: number; r: number; /** angle of the little creek that feeds it (bridge crosses there) */ creek?: number }
/** decorative scatter prop — never solid, always a joy to walk through */
export interface FloorProp { x: number; z: number; rot: number; s: number; c: number }
export interface TrailPost { x: number; z: number; rot: number; lantern: boolean }

export interface World {
  buildings: Building[];
  trees: Tree[];
  /** 🪨 boulders — the hammer breaks these for stone. */
  rocks: Rock[];
  /** circle-collider index of each rock (parallel to rocks) — shrinking it makes the boulder passable */
  rockCi: number[];
  flowers: Flower[];
  boxes: BoxCollider[];
  circles: CircleCollider[];
  cars: Car[];
  lamps: Lamp[];
  benches: Bench[];
  fields: Field[];
  silos: Silo[];
  umbrellas: Umbrella[];
  signs: Sign[];
  windmills: { x: number; z: number; rot: number }[];
  /** 🏕️ jungle camps — lit glades that double as night shelters (beasts & zombies shy from fire) */
  camps: Camp[];
  /* 🌲 nature & forest kit — the wild band */
  ponds: Pond[];
  ferns: FloorProp[];
  tufts: FloorProp[];
  shrooms: FloorProp[];
  bushes: FloorProp[];
  wilds: FloorProp[];
  stumps: FloorProp[];
  logs: FloorProp[];
  reeds: FloorProp[];
  pads: FloorProp[];
  stones: FloorProp[];
  spires: FloorProp[];
  cabins: { x: number; z: number; rot: number }[];
  ranger: { x: number; z: number; rot: number } | null;
  lookout: { x: number; z: number } | null;
  trucks: { x: number; z: number; rot: number }[];
  bridges: { x: number; z: number; rot: number; s: number }[];
  docks: { x: number; z: number; rot: number }[];
  boats: { x: number; z: number; rot: number; kind: 0 | 1 }[];
  kiosks: { x: number; z: number; rot: number }[];
  trailPosts: TrailPost[];
  trails: { x: number; z: number }[][];
  birdhouses: { x: number; z: number }[];
  handcarts: { x: number; z: number; rot: number }[];
  chopBlocks: { x: number; z: number; rot: number }[];
  firewood: { x: number; z: number; rot: number }[];
  woodsheds: { x: number; z: number; rot: number }[];
  /** 🐜 insect world kit — meadow micro-landmarks: mushroom rings, ant nests,
   *  daisies & clover, orb webs, an insect hotel, wasp nests + tiny treasures.
   *  k = kit key (see insectKit.ts), s = target height in world units. */
  insectProps: { k: string; x: number; z: number; rot: number; s: number }[];
  /** 🗺️ spatial hash over boxes+circles — makes resolve() O(neighbours) instead of O(world) */
  grid: ColliderGrid;
}

/* ---------------- ⛰️ playable mountain band — rough, scary & CLIMBABLE ----------------
 * A ring of jagged peaks between the deep jungle and the world wall. The SAME
 * deterministic height field drives (a) the 3D terrain mesh in WorldView and
 * (b) the player's ground in sim.stepBody — so what you see is what you walk on. */
interface MTPeak { x: number; z: number; R: number; h: number; k: number; r1: number; r2: number; p1: number; p2: number }
const MT_PEAKS: MTPeak[] = (() => {
  const rnd = mulberry32(WORLD_SEED + 777);
  const list: MTPeak[] = [];
  // major summits — clustered by sector so some directions are huge dark ranges
  // 🦕 the PREHISTORIC sector arc is SKIPPED entirely — its band stays open
  // rolling valley floor (the mud-valley bumps only) so the dinosaurs get a
  // proper valley instead of a summit fence. Skipped peaks shift nothing:
  // this IIFE has its own dedicated RNG stream.
  const N = 15;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + range(rnd, -0.1, 0.1);
    if (a > PREHISTORIC.a0 - 0.18 && a < PREHISTORIC.a1 + 0.18) continue;
    const cl = 0.5 + 0.5 * Math.sin(2 * a + 2.3) * Math.sin(3 * a + 0.9);
    const d = MOUNTAIN_INNER + 30 + cl * 34 + range(rnd, -12, 12);
    list.push({
      x: Math.cos(a) * d, z: Math.sin(a) * d,
      R: range(rnd, 30, 44), h: range(rnd, 14, 26) + cl * 6, k: range(rnd, 1.35, 1.8),
      r1: 2 + Math.floor(rnd() * 2), r2: 4 + Math.floor(rnd() * 2),
      p1: range(rnd, 0, 6.283), p2: range(rnd, 0, 6.283),
    });
  }
  // shoulder bumps — fill the valleys so the band reads as one rough massif
  // (the prehistoric arc keeps its own exclusion — no bumps in the valley)
  for (let i = 0; i < 12; i++) {
    const a = range(rnd, 0, Math.PI * 2), d = range(rnd, MOUNTAIN_INNER + 16, MOUNTAIN_OUTER - 8);
    if (a > PREHISTORIC.a0 - 0.12 && a < PREHISTORIC.a1 + 0.12) continue;
    list.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, R: range(rnd, 15, 23), h: range(rnd, 6, 13), k: 1.5, r1: 3, r2: 5, p1: range(rnd, 0, 6.283), p2: range(rnd, 0, 6.283) });
  }
  return list;
})();

/* ---------------- 🕳️ walkable construction digs ----------------
 * Each building site carves a REAL pit into the ground — terraced dirt walls
 * and a graded ramp the player walks DOWN and back UP (never a blocked "hole").
 * terrainHeight returns the negative depth so the whole physics stack (player,
 * bots, cars, camera) follows for free; the render side reads the SAME profile
 * (the CityGround disc is holed over each pit and a dirt DigGround patch builds
 * the walls/floor/ramp), so visuals and physics can never disagree.
 * depth is metres below grade — 0 means solid ground.                          */
export interface DigDef {
  id: string;
  cx: number; cz: number;        // site centre
  hx: number; hz: number;        // dirt yard footprint (half extents, visual patch)
  px: number; pz: number;        // pit rectangle (half extents, inside the yard)
  depth: number;                 // floor depth below grade
  rampSide: 0 | 1 | 2 | 3;       // 0 = north (+z) · 1 = east (+x) · 2 = south (−z) · 3 = west (−x)
  rampW: number;                 // ramp corridor width
}

export const DIGS: DigDef[] = [
  // A · Lakeshore Towers — deep foundation dig under the rising tower
  { id: "A", cx: -168.75, cz: 33.75, hx: 24, hz: 23, px: 13, pz: 11.5, depth: 3.0, rampSide: 2, rampW: 5.4 },
  // B · Eastside Mega Dig — the flagship open-pit excavation (deepest, 4.3m)
  { id: "B", cx: 236.25, cz: -101.25, hx: 24.5, hz: 23.5, px: 18, pz: 15.5, depth: 4.3, rampSide: 0, rampW: 6.2 },
  // C · Northgate Works — the block-build foundation dig (the x26/z125 site)
  { id: "C", cx: 33.75, cz: 168.75, hx: 24, hz: 24, px: 12.5, pz: 11, depth: 2.7, rampSide: 3, rampW: 5.2 },
];

const smooth01 = (k: number) => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };

/** terraced wall fall — t 0 = floor edge … 1 = rim; returns depth fraction
 *  1 → 0 in four levels (floor · lower terrace · upper terrace · grade) with
 *  each dug face easing over the middle of its band, so the walls read as the
 *  flat-shelved terraces in the kit cover art */
function terraceFall(t: number): number {
  const s = Math.min(4, Math.max(0, t * 4));
  const i = Math.floor(s);
  const f = s - i;
  const step = Math.min(4, i + smooth01((f - 0.25) / 0.5)); // shelf … face … shelf
  return Math.max(0, 1 - step / 4);
}

/** Excavation depth (metres below grade, ≥ 0) at world (x, z) — shared by
 *  terrainHeight (physics), the CityGround hole and the DigGround patch mesh.
 *  NEVER make this expensive: it runs per frame via terrainHeight. */
export function digDown(x: number, z: number): number {
  for (const d of DIGS) {
    const ax = Math.abs(x - d.cx), az = Math.abs(z - d.cz);
    if (ax > d.px + 0.6 || az > d.pz + 0.6) continue;      // quick reject (outside pit + rim lip)
    const wallIn = Math.min(d.px - ax, d.pz - az);         // distance in from the NEAREST wall
    const WALL_W = 5.2;                                    // terraced wall band width
    let depth = d.depth * terraceFall(1 - Math.max(0, Math.min(1, wallIn / WALL_W)));
    // the ramp corridor cuts a graded walkway through the wall terraces
    const across = d.rampSide === 1 || d.rampSide === 3 ? z - d.cz : x - d.cx; // cross axis
    const along = d.rampSide === 1 || d.rampSide === 3 ? ax : az;              // descent axis (≥ 0)
    const onSide = d.rampSide === 0 ? z >= d.cz : d.rampSide === 2 ? z <= d.cz : d.rampSide === 1 ? x >= d.cx : x <= d.cx;
    if (onSide) {
      const half = d.rampW / 2;
      const blend = 1 - smooth01((Math.abs(across) - half) / 1.1);        // soft corridor edges
      if (blend > 0) {
        // u 0 at the rim (grade) → 1 at the floor: the graded walkway descent
        const u = 1 - Math.min(1, Math.max(0, (along - 2.5) / (d[along === az ? "pz" : "px"] - 2.5)));
        depth = depth * (1 - blend) + d.depth * smooth01(u) * blend;
      }
    }
    return depth;
  }
  return 0;
}

/** Ground height of the playable ⛰️ band (0 everywhere else). Climbing slows you
 *  the steeper it gets — see stepBody. NEVER make this expensive: it runs per frame. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < MOUNTAIN_INNER - 10 || r > MOUNTAIN_OUTER + 14) {
    return -digDown(x, z); // 🕳️ the city digs — real walkable construction pits
  }
  let h = 0;
  for (const p of MT_PEAKS) {
    const dx = x - p.x, dz = z - p.z;
    const dd = Math.hypot(dx, dz);
    if (dd >= p.R) continue;
    const ang = Math.atan2(dz, dx);
    // fluted ridges → the silhouette reads craggy, and flat-shaded facets look rough
    const ridge = 1 + 0.17 * Math.sin(p.r1 * ang + p.p1) + 0.1 * Math.sin(p.r2 * ang + p.p2);
    const ph = p.h * Math.pow(1 - dd / p.R, p.k) * ridge;
    if (ph > h) h = ph;
  }
  if (h <= 0) {
    // rolling scary valley floor between peaks — never a flat ring
    h = 1.6 + 1.25 * Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.05 - 0.6) + 0.9 * Math.sin(x * 0.11) * Math.sin(z * 0.13);
    if (h < 0) h = 0;
  }
  const inner = Math.min(1, (r - (MOUNTAIN_INNER - 10)) / 16); // rises out of the jungle floor
  const outer = Math.min(1, (MOUNTAIN_OUTER + 14 - r) / 16);   // falls back down at the wall
  return h * Math.max(0, Math.min(inner, outer));
}

/* ---------------- town layout (GTA-style grid + grand central vista) ---------------- */
export const ROADS = [-270, -202.5, -135, -67.5, 0, 67.5, 135, 202.5, 270]; // road centre lines, both axes — 9×9 grid city
export const ROAD_W = 14;                          // full width
/** The MAIN ROAD: x=0 south of the grid — wider, the town march strip lives here. */
export const MAIN_ROAD = { x: 0, z0: -135, z1: 368, w: 24 };
export const RING_R = 355;                         // ring highway centre radius
export const RING_W = 12;

/* ---------- ring-highway airport bypass ----------
 * The SE arc of the ring used to drive straight across the airport's west lawn —
 * over the runway threshold's approach lights, the windsock and two parked light
 * aircraft. The ring now BREAKS for a 13.5° gap and a straight connector chord
 * swings it around the airport's north-west corner (through empty grass, well
 * clear of the runway slab, the taxi connector and the approach bars). Traffic
 * rides the chord with speed continuity: chord length ≈ arc length.           */
const DEG = Math.PI / 180;
/* ✈️ gap widened to [45°, 68°]: the old chord squeezed just 5.5m past the runway
 * slab's NW corner (the ring circle at ~55° grazes the slab edge). The wider
 * swing keeps the bypass ~10m clear of the slab corner and ~16m clear of the
 * approach light bars — and its north end still lands on empty grass clear of
 * the parked cars along the x=270 street. */
export const RING_GAP = { a0: 45 * DEG, a1: 68 * DEG } as const;
const GAP_A = { x: RING_R * Math.cos(RING_GAP.a0), z: RING_R * Math.sin(RING_GAP.a0) };
const GAP_B = { x: RING_R * Math.cos(RING_GAP.a1), z: RING_R * Math.sin(RING_GAP.a1) };
const GAP_DX = GAP_B.x - GAP_A.x, GAP_DZ = GAP_B.z - GAP_A.z;
const GAP_LEN = Math.hypot(GAP_DX, GAP_DZ);
/** Position + heading of a ring vehicle at angle `a` on lane radius `r`.
 *  Inside the airport gap the car rides the straight connector chord (offset
 *  sideways by its lane offset), keeping the highway off the airport plot.
 *  Heading convention: forward = (sin rot, cos rot), matching parked cars. */
export function ringTrafficPoint(a: number, r: number, dir: 1 | -1): { x: number; z: number; rot: number } {
  const na = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (na >= RING_GAP.a0 && na <= RING_GAP.a1) {
    const s = (na - RING_GAP.a0) / (RING_GAP.a1 - RING_GAP.a0);
    // outward lane offset — the chord's outward side matches the arc's
    const off = r - RING_R;
    const x = GAP_A.x + GAP_DX * s + (GAP_DZ / GAP_LEN) * off;
    const z = GAP_A.z + GAP_DZ * s + (-GAP_DX / GAP_LEN) * off;
    return { x, z, rot: Math.atan2(dir * GAP_DX, dir * GAP_DZ) };
  }
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, rot: dir > 0 ? -a : Math.PI - a };
}
export const AVENUE = { x: 0, z0: -135, z1: -188, w: 24 }; // central vista up to the museum
export const PARK = { x: -33.75, z: -33.75, r: 27 };
export const MALL = { x: 33.75, z: 47 };
export const SCHOOL = { x: -33.75, z: 118 };
export const HOSPITAL = { x: 101.25, z: 106 };
export const GATE = { x: 0, z: -162 };             // stone memorial arch on the vista
export const TOWN_SQUARE = { x: 0, z: 48 };        // welcome-banner arch over the main road

/** True while (x,z) sits on the airport plot — runway + apron + buildings + a margin.
 *  Trees, cottages and flowers all keep out of the flight ops area. */
export function inAirportPlot(x: number, z: number): boolean {
  return x > AIRPORT.rx0 - 46 && x < AIRPORT.rx1 + 26 && z > AIRPORT.rz - 34 && z < AIRPORT.terminal.z + AIRPORT.terminal.d + 12;
}

/** ✈️ Strict flight-zone keep-out — the airport plot PLUS the climb-out corridor
 *  east of the runway (planes lift off past the east threshold and climb straight
 *  out before banking back, so no tree/rock/pond may sprout under that path).
 *  The jungle bands (r 472–610) overlap the plot's far corner and the corridor —
 *  without this check trees spawned ON the runway and INSIDE the hangar. */
export function inFlightZone(x: number, z: number): boolean {
  if (inAirportPlot(x, z)) return true;
  return x > AIRPORT.rx1 && x < AIRPORT.rx1 + 80 && z > AIRPORT.rz - 40 && z < AIRPORT.rz + 40;
}

/* ---------------- 🚂 countryside railway — the loop line through the farm band ----------------
 * A single-track branch line arcs through the farmland (kept WELL clear of the
 * ⚠️ airport sector, the graveyard and the city), with a country station, a
 * level crossing where the farm lane leaves the main road, telegraph poles and
 * a steam train parked at the platform. Track bed is visual-only; the solid
 * furniture (house, tower, box, poles, stock, buffers) gets colliders. */
export interface RailwayCfg {
  R: number;                       // arc radius about the town centre
  a0: number; a1: number;          // arc start/end angles (radians)
  station: { a: number };          // platform centre angle
  crossing: { a: number };         // level crossing angle (farm lane x=0)
  poles: { x: number; z: number; rot: number }[];
  stock: { x: number; z: number; rot: number; kind: 0 | 1 | 2 }[]; // 0 loco · 1 carriage · 2 brake van
  ends: { x: number; z: number; rot: number }[];                   // buffer stops at both arc ends
}
const RAIL_R = 437, RAIL_A0 = 1.15, RAIL_A1 = 5.4;
export const RAILWAY: RailwayCfg = (() => {
  // telegraph poles march along the OUTside of the embankment
  const poles: RailwayCfg["poles"] = [];
  for (let a = RAIL_A0 + 0.14; a < RAIL_A1 - 0.1; a += 0.24) {
    poles.push({
      x: Math.cos(a) * (RAIL_R + 6.5), z: Math.sin(a) * (RAIL_R + 6.5),
      rot: -a,
    });
  }
  // the 15:07 to somewhere — locomotive + two carriages + brake van at the platform
  const stock: RailwayCfg["stock"] = [];
  const kinds: (0 | 1 | 2)[] = [0, 1, 1, 2];
  for (let i = 0; i < 4; i++) {
    const a = 1.945 + i * 0.0208;
    stock.push({ x: Math.cos(a) * RAIL_R, z: Math.sin(a) * RAIL_R, rot: -a, kind: kinds[i] });
  }
  const ends = [RAIL_A0, RAIL_A1].map((a) => ({
    x: Math.cos(a) * RAIL_R, z: Math.sin(a) * RAIL_R, rot: -a,
  }));
  return { R: RAIL_R, a0: RAIL_A0, a1: RAIL_A1, station: { a: 2.05 }, crossing: { a: Math.PI / 2 }, poles, stock, ends };
})();

/** 🚂 helper — world position + facing of a point at angle `a` offset `off` from the rail centre.
 *  rot = -a turns the kit models' LENGTH axis (local +Z for the Z-forward
 *  majority: track sections join end-to-end along their rails, coaches sit ON
 *  the rails, pole/fence runs march the line) along the arc tangent. The few
 *  X-forward props (platform & canopy runs, seat furniture) add a ±π/2 rot
 *  offset via RAILKIT's `ro` option — verified against each GLB's geometry:
 *  the straight-track's railheads + sleeper spacing, platform-run's ramp and
 *  edge wall, fence-run's panel, stock box lengths. */
export function railPoint(a: number, off = 0): { x: number; z: number; rot: number } {
  const r = RAILWAY.R + off;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, rot: -a };
}

/** 🚂 true while (x,z) sits within `margin` of the branch line's track bed —
 *  the arc only spans angles [a0, a1] (the eastern wedge is rail-free), so
 *  points outside that sweep are always clear. Farms, sheds, fields and
 *  props all keep off the rails with this check. */
export function nearRailway(x: number, z: number, margin: number): boolean {
  const a = Math.atan2(z, x);
  if (!(a >= RAILWAY.a0 || a <= RAILWAY.a1 - Math.PI * 2)) return false;
  return Math.abs(Math.hypot(x, z) - RAILWAY.R) < margin;
}
/** the country station house sits just inside the platform — the map landmark
 *  marker anchors here (the REAL kit station building renders nearby) */
export const RAILWAY_stationHouse = railPoint(RAILWAY.station.a, -14.5);

/* ---------------- 🚂 RAILKIT — the polyfork Countryside Railway kit ----------------
 * The branch line grows a REAL country station, goods yard and crossing built
 * from the countryside-railway kit GLBs (see railwayModels.ts / <RailwayKit>):
 *   · 4m straight-track sections carry the ENTIRE arc (ballast + twin rails +
 *     sleepers baked into one mesh — replaces the hand-made bed entirely)
 *   · the blue country station building fronts a real platform (runs, canopy,
 *     shelter, benches, lamps, clock post, bookstall, posters, barrow, trolley)
 *   · the station footbridge spans the rails just down the line
 *   · the goods yard behind the track: engine shed + goods shed, water tower +
 *     water crane + pump house, coal stage + merchant's bin, weighbridge, yard
 *     crane, fuel tank, cattle dock, loading gauge, 20m turntable, sleeper /
 *     rail stacks and ballast heaps — with the diesel shunter + railbus parked
 *   · the 15:07 is REAL stock — tank loco, coal tender, two coaches and a brake
 *     van — and a full goods rake parks further down the line
 *   · the level crossing gains its keeper's cottage and real gates; semaphore
 *     + disc signals, pole runs, fence runs, huts and lineside trees dress the
 *     whole branch; the kit crew (station master, crossing keeper, platelayer,
 *     driver, fireman, passenger, trainspotter) idles at their posts
 * Every position derives from railPoint(angle, offset) so colliders + rendering
 * stay in lock-step (same contract as SITEKIT/GRAVEKIT). */

export interface RailPlacement { x: number; y?: number; z: number; rot?: number; s?: number }
export interface RailKitDef {
  props: Record<string, RailPlacement[]>;
  /** kit crew — skinned characters idling at their posts */
  crew: { slug: string; x: number; z: number; rot: number }[];
  /** solid props → physics circles (r) */
  cols: { x: number; z: number; r: number }[];
}

export const RAILKIT: RailKitDef = (() => {
  const props: Record<string, RailPlacement[]> = {};
  const cols: { x: number; z: number; r: number }[] = [];
  const crew: RailKitDef["crew"] = [];
  const ST = RAILWAY.station.a, CR = Math.PI / 2;
  /** place a kit prop at (angle, radial offset); rot defaults to the arc tangent.
   *  `ro` = extra rot OFFSET in radians for the X-forward props (platform &
   *  canopy runs need +π/2 so their length axis rides the tangent; the seat
   *  furniture keeps its authored facing with -π/2). */
  const P = (kind: string, a: number, off: number, o: { y?: number; da?: number; rot?: number; ro?: number; s?: number } = {}) => {
    const p = railPoint(a + (o.da ?? 0), off);
    (props[kind] ??= []).push({ x: p.x, y: o.y, z: p.z, rot: (o.rot ?? p.rot) + (o.ro ?? 0), s: o.s });
  };
  /** one solid circle at (angle, offset) */
  const col = (a: number, off: number, r: number, da = 0) => {
    const p = railPoint(a + da, off);
    cols.push({ x: p.x, z: p.z, r });
  };
  /** a parked vehicle: circles at ±len/4 so walkers can slip between pieces */
  const veh = (kind: string, a: number, off: number, len: number, o: { y?: number; rot?: number } = {}) => {
    P(kind, a, off, o);
    col(a, off, Math.max(1.2, len / 4), -(len / 4) / RAILWAY.R);
    col(a, off, Math.max(1.2, len / 4), +(len / 4) / RAILWAY.R);
  };

  /* ---- the track itself: 4m kit sections chord the whole arc (sagitta ~5mm) ---- */
  for (let a = RAILWAY.a0; a < RAILWAY.a1; a += 4.0 / RAILWAY.R) P("track", a, 0, { y: 0.02 });

  /* ---- the 15:07 — tank loco, coal tender, two coaches, brake van ---- */
  {
    const rake: [string, number][] = [["tankLoco", 9], ["coalTender", 7.3], ["coach", 18], ["coach", 18], ["brakeCoach", 18]];
    let head = ST - (rake.reduce((s, [, l]) => s + l, 0) / 2) / RAILWAY.R;
    for (const [kind, len] of rake) {
      veh(kind, head + (len / 2) / RAILWAY.R, 0, len, { y: 0.02 });
      head += len / RAILWAY.R;
    }
  }

  /* ---- the goods rake parked further down the line (angle 3.42) ---- */
  {
    const wagons: [string, number][] = [
      ["guardsVan", 7.2], ["goodsVan", 6.5], ["openWagon", 6], ["cattleWagon", 6.5],
      ["flatWagon", 9], ["hopperWagon", 7], ["tankWagon", 6.2],
    ];
    let head = 3.42 - (wagons.reduce((s, [, l]) => s + l, 0) / 2) / RAILWAY.R;
    for (const [kind, len] of wagons) {
      veh(kind, head + (len / 2) / RAILWAY.R, 0, len, { y: 0.02 });
      head += len / RAILWAY.R;
    }
  }

  /* ---- the country station (inside the arc, fronting the platform) ---- */
  for (let i = 0; i < 4; i++) P("platformRun", ST, -3.2, { da: (i - 1.5) * (4.0 / RAILWAY.R), ro: Math.PI / 2 }); // 16m platform edge — X-forward sections join along the line
  for (let i = 0; i < 3; i++) P("canopyRun", ST, -3.0, { da: (i - 1) * (6.2 / RAILWAY.R), ro: Math.PI / 2 });     // canopy over the middle — X-forward 6.2m modules
  P("shelter", ST, -3.2, { da: -0.0165, ro: -Math.PI / 2 });
  P("bench", ST, -3.7, { da: -0.006, ro: -Math.PI / 2 });
  P("bench", ST, -3.7, { da: 0, ro: -Math.PI / 2 });
  P("bench", ST, -3.7, { da: 0.006, ro: -Math.PI / 2 });
  P("lampPost", ST, -4.7, { da: -0.013 });
  P("lampPost", ST, -4.7, { da: 0.002 });
  P("lampPost", ST, -4.7, { da: 0.013 });
  P("clockPost", ST, -4.1, { da: 0.008 });
  P("bookstall", ST, -4.4, { da: -0.0105, ro: -Math.PI / 2 });
  P("posterBoard", ST, -4.6, { da: 0.004, ro: -Math.PI / 2 });
  P("posterBoard", ST, -4.6, { da: 0.0065, ro: -Math.PI / 2 });
  P("barrow", ST, -3.4, { da: 0.011 });
  P("trolley", ST, -3.3, { da: -0.009 });
  P("runningBoard", ST, -2.3, { da: -0.022 });
  P("gardenBed", ST, -7.6, { da: -0.010, ro: -Math.PI / 2 });
  P("gardenBed", ST, -7.6, { da: 0.010, ro: -Math.PI / 2 });
  P("stationBuilding", ST, -13.5);                     // the blue station house
  P("footbridge", ST, 0, { da: 0.030 });               // spans the rails down the platform
  P("semaphore", ST, -2.1, { da: -0.026 });
  P("semaphore", ST, -2.1, { da: 0.028 });
  P("handcar", ST, 0, { da: 0.045, y: 0.02 });         // parked on the rails past the bridge
  col(ST, -13.5, 6.8);                                 // station building
  col(ST, 0, 1.0, 0.030 - 0.0114);                     // footbridge stair legs
  col(ST, 0, 1.0, 0.030 + 0.0114);
  col(ST, -4.7, 0.35, -0.013); col(ST, -4.7, 0.35, 0.002); col(ST, -4.7, 0.35, 0.013); // lamp posts
  col(ST, -4.1, 0.4, 0.008);                           // clock post
  col(ST, -4.4, 1.6, -0.0105);                         // bookstall
  col(ST, -3.2, 1.8, -0.0165);                         // shelter
  col(ST, -2.1, 0.5, -0.026); col(ST, -2.1, 0.5, 0.028); // semaphore posts
  col(ST, 0, 1.2, 0.045);                              // handcar

  /* ---- the goods yard (outside the arc, behind the sheds) ---- */
  P("engineShed", ST, 16.5, { da: -0.009, rot: -(ST - 0.009) + Math.PI }); // doors face the line
  P("goodsShed", ST, 16.5, { da: 0.0185, rot: -(ST + 0.0185) + Math.PI });
  P("weighbridge", ST, 9.5, { da: 0.004 });
  P("yardCrane", ST, 10, { da: 0.026 });
  P("waterTower", ST, 13, { da: 0.028 });
  P("waterCrane", ST, 2.2, { da: 0.020 });
  P("pumpHouse", ST, 13, { da: 0.036 });
  P("coalStage", ST, 11, { da: 0.043 });
  P("coalBin", ST, 6.5, { da: 0.036 });
  P("fuelTank", ST, 13, { da: 0.033 });
  P("cattleDock", ST, 21, { da: 0.027 });
  P("loadingGauge", ST, 3.2, { da: 0.012 });
  P("turntable", ST, 14, { da: -0.052 });
  P("sleeperStack", ST, 8, { da: 0.006 });
  P("sleeperStack", ST, 8.6, { da: 0.010 });
  P("railStack", ST, 7.5, { da: 0.014 });
  P("ballastHeap", ST, 6.5, { da: -0.004 });
  P("ballastHeap", ST, 6, { da: 0.024 });
  P("ballastHeap", ST, 6.5, { da: 0.047 });
  P("signalBox", ST, -20, { da: -0.055 });             // classic box across from the platform
  P("discSignal", ST, 3.4, { da: 0.058 });
  P("shunter", ST, 8.5, { da: -0.002 });               // the yard pilot waits by the shed road
  P("railbus", ST, -6.5, { da: 0.060 });               // single-car railbus limps home on the far side
  col(ST, 16.5, 7.2, -0.009);                          // engine shed
  col(ST, 16.5, 7.2, 0.0185);                          // goods shed
  col(ST, 9.5, 2.8, 0.004);                            // weighbridge
  col(ST, 10, 1.8, 0.026);                             // yard crane
  col(ST, 13, 2.2, 0.028);                             // water tower
  col(ST, 2.2, 0.6, 0.020);                            // water crane
  col(ST, 13, 2.2, 0.036);                             // pump house
  col(ST, 11, 2.6, 0.043);                             // coal stage
  col(ST, 6.5, 1.8, 0.036);                            // coal bin
  col(ST, 13, 2.6, 0.033);                             // fuel tank
  col(ST, 21, 1.8, 0.027);                             // cattle dock
  col(ST, 3.2, 0.5, 0.012);                            // loading gauge
  col(ST, 8.5, 1.8, 0.006);                            // sleeper stacks
  col(ST, 7.5, 0.8, 0.014);                            // rail stack
  col(ST, 6.5, 1.3, -0.004); col(ST, 6, 1.3, 0.024); col(ST, 6.5, 1.3, 0.047); // ballast heaps
  col(ST, -20, 2.8, -0.055);                           // signal box
  col(ST, 3.4, 0.3, 0.058);                            // disc signal
  col(ST, 8.5, 1.6, -0.002 - (2.1 / RAILWAY.R)); col(ST, 8.5, 1.6, -0.002 + (2.1 / RAILWAY.R)); // shunter
  col(ST, -6.5, 1.6, 0.060 - (3 / RAILWAY.R)); col(ST, -6.5, 1.6, 0.060 + (3 / RAILWAY.R));     // railbus

  /* ---- telegraph pole runs march the whole line (replaces hand-made poles) ---- */
  for (let a = RAILWAY.a0 + 0.06; a < RAILWAY.a1 - 0.05; a += 12.4 / RAILWAY.R) {
    P("poleRun", a, 6.5);
    col(a, 6.5, 0.4);
  }

  /* ---- lineside dressing: fences near the station + yard, huts, trees, signs ---- */
  for (let i = 0; i < 6; i++) P("fenceRun", ST, -6.3, { da: (-0.052 + i * 4.0 / RAILWAY.R) });
  for (let i = 0; i < 5; i++) P("fenceRun", ST, 5.5, { da: (0.014 + i * 4.0 / RAILWAY.R) });
  P("hut", ST, 8, { da: 0.052 });
  P("tree", ST, -9, { da: -0.034 });
  P("tree", ST, 10, { da: -0.062 });
  P("tree", ST, -10, { da: 0.044 });
  P("tree", ST, 9.5, { da: 0.070 });
  P("tree", CR, -9.5, { da: 0.028 });
  P("signPost", ST, -7.4, { da: -0.020 });
  P("signPost", CR, -6.5, { da: -0.016 });
  col(ST, 8, 1.8, 0.052);                              // lineside hut
  for (const [da, off] of [[-0.034, -9], [-0.062, 10], [0.044, -10], [0.070, 9.5]] as const) col(ST, off, 0.8, da);
  col(ST, -7.4, 0.3, -0.020);

  /* ---- the level crossing: real deck, gates + the keeper's cottage ---- */
  P("levelCrossing", CR, 0, { y: 0.02 });
  P("crossingGate", CR, -5.6, { da: -0.0103 });
  P("crossingGate", CR, 5.6, { da: 0.0103 });
  P("cottage", CR, -13, { da: -0.02 });
  col(CR, -5.6, 0.45, -0.0103);
  col(CR, 5.6, 0.45, 0.0103);
  col(CR, -13, 3.4, -0.02);

  /* ---- buffer stops close both ends of the branch ---- */
  P("bufferStop", RAILWAY.a0 + 0.006, 0, { y: 0.02 });
  P("bufferStop", RAILWAY.a1 - 0.006, 0, { y: 0.02 });
  col(RAILWAY.a0 + 0.006, 0, 1.6);
  col(RAILWAY.a1 - 0.006, 0, 1.6);

  /* ---- the kit crew at their posts ---- */
  {
    const sm = railPoint(ST, -3.9);
    crew.push({ slug: "station-master-1d6a0a", x: sm.x, z: sm.z, rot: sm.rot });
    const ck = railPoint(CR - 0.0103, -4.9);
    crew.push({ slug: "crossing-keeper-e13207", x: ck.x, z: ck.z, rot: ck.rot });
    const pl = railPoint(ST, 7.2);
    crew.push({ slug: "platelayer-47dbe6", x: pl.x, z: pl.z, rot: pl.rot });
    const ed = railPoint(ST, 9.8);
    crew.push({ slug: "engine-driver-1ba1e2", x: ed.x, z: ed.z, rot: ed.rot });
    const fm = railPoint(ST, 11.5);
    crew.push({ slug: "fireman-96bf23", x: fm.x, z: fm.z, rot: fm.rot });
    const pa = railPoint(ST, -4.9);
    crew.push({ slug: "passenger-ac425a", x: pa.x, z: pa.z, rot: pa.rot });
    const ts = railPoint(ST, -2.9);
    crew.push({ slug: "trainspotter-ffd141", x: ts.x, z: ts.z, rot: ts.rot });
  }

  return { props, crew, cols };
})();

/** 🚂 the railway's station + yard + crossing zones keep the countryside scatter
 *  (trees, rocks, flowers, tufts, woodsheds) out of the kit furniture */
export function inRailwayYard(x: number, z: number, pad = 0): boolean {
  const r = Math.hypot(x, z);
  if (Math.abs(r - RAILWAY.R) > 30 + pad) return false;
  const a = Math.atan2(z, x);
  const da = pad / RAILWAY.R;
  const ST = RAILWAY.station.a;
  if (a > ST - 0.13 - da && a < ST + 0.12 + da) return true;  // station + goods yard band
  if (Math.abs(a - Math.PI / 2) < 0.035 + da) return true;    // the level crossing
  return false;
}

/* ---------------- 🚜 cozy farm kit — the farmsteads grow real furniture ----------------
 * Everything is derived from the barn positions + crop fields so worldgen
 * colliders and the WorldView render stay in lock-step. Deterministic. */
export const FIELDS_BASE: { x: number; z: number; rot: number; crop: number }[] = [
  { x: 410, z: -85, rot: 0.3, crop: 0 }, { x: 434, z: -159, rot: -0.2, crop: 1 },
  { x: 366, z: 222, rot: 0.5, crop: 0 }, { x: 407, z: 198, rot: -0.4, crop: 2 },
  // 🚂 west-arc paddocks sit INSIDE the branch line (the old -403/-368/-430
  // plots had corners on the track bed); the north-west one moved OUTSIDE it
  { x: -390, z: 133, rot: 0.2, crop: 1 }, { x: -359, z: -205, rot: -0.3, crop: 2 },
  // 🚜 three fresh paddocks — more to harvest, more to guard at night
  { x: 430, z: -60, rot: 0.15, crop: 1 }, { x: -411, z: 38, rot: -0.35, crop: 0 }, { x: -373, z: 271, rot: 0.25, crop: 1 },
];
// 🚂 the third barn slid out past the branch line — its old corner (and the
// woodshed it spawned) stood right on the track bed
// ✈️ the second barn slid north out of the airport plot — it, its farmhouse,
// coop and silo used to sit on the runway's north grass (inside the fence)
export const BARN_BASE: [number, number][] = [[425, -122], [374, 242], [-453, 101]];

export const FARMKIT = (() => {
  const farmhouses = BARN_BASE.map(([x, z]) => ({ x: x - 17, z: z + 10, rot: Math.atan2(-z, -x) }));
  const greenhouse = { x: BARN_BASE[0][0] + 20, z: BARN_BASE[0][1] + 13 };
  const coops = [
    { x: BARN_BASE[1][0] - 14, z: BARN_BASE[1][1] + 9 },
    { x: BARN_BASE[2][0] + 13, z: BARN_BASE[2][1] + 10 },
  ];
  // hay bales sleep in rings around every barn
  const bales: { x: number; z: number; rot: number }[] = [];
  BARN_BASE.forEach(([bx, bz], bi) => {
    const cnt = 4 + (bi % 2);
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * Math.PI * 2 + bi * 0.7;
      bales.push({ x: bx + Math.cos(a) * (12 + (i % 2) * 4), z: bz + Math.sin(a) * (12 + (i % 2) * 4) + 3, rot: a });
    }
  });
  // a scarecrow guards every field's heart — the crows know which ones blink
  const scarecrows = FIELDS_BASE.map((f) => {
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const lx = 8, lz = 5; // local offset inside the field
    return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c, rot: f.rot + 0.4 };
  });
  const well = { x: farmhouses[0].x + 7, z: farmhouses[0].z + 6 };
  const tractor = { x: BARN_BASE[0][0] - 11, z: BARN_BASE[0][1] - 11, rot: 0.5 };
  // fence runs trace every field's edge (visual-only — bots slip through gates)
  const fences: { x: number; z: number; rot: number; len: number }[] = [];
  for (const f of FIELDS_BASE) {
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const W = 12, D = 8; // matches generateWorld's w/d half-extents
    const edge = (lx: number, lz: number, along: "x" | "z") => {
      const px = f.x + lx * c + lz * s, pz = f.z - lx * s + lz * c;
      fences.push({ x: px, z: pz, rot: along === "x" ? f.rot : f.rot + Math.PI / 2, len: (along === "x" ? W * 2 : D * 2) + 2 });
    };
    edge(0, -D, "x"); edge(0, D, "x"); edge(-W, 0, "z"); edge(W, 0, "z");
  }
  return { farmhouses, greenhouse, coops, bales, scarecrows, well, tractor, fences };
})();

/* ---------------- 🗽 NYC city-kit district — a slice of Manhattan in the east midtown belt ----------------
 * Inspired by the Polyfork "New York City Kit" (82 low-poly parts): art-deco
 * setback towers with rooftop water tanks, a brownstone row with stoops &
 * fire escapes, tenements, a parking garage, a movie theatre, and the full
 * street-level furniture set — subway entrance, newsstand, hot-dog cart,
 * yellow cabs, globe lamps, traffic lights, hydrants, mailboxes, steam.
 * Occupies the FREE column of city blocks at x=168.75 (roads x=135 / x=202.5),
 * z −135…135 — everything here is deterministic; generateWorld() pushes the
 * boxBuildings (auto colliders) + solidBoxes/solidCircles into the world. */
export interface NycBoxBuilding { x: number; z: number; w: number; d: number; h: number; kind: 0 | 1; color: number; roof: number; awn: number; fz: 1 | -1 }
export const NYC = (() => {
  const bx = 168.75; // district column centre (between roads x=135 and x=202.5)
  const BROWNSTONE_COLS = [0x8a5a3c, 0x9e6a48, 0xa4714e, 0x7c4a34, 0x96613e, 0x8f5a42];
  const BROWNSTONE_ROOFS = [0x5c4436, 0x6a4e3e, 0x5f4a3a, 0x54382c, 0x68503c, 0x614a38];
  const SHOP_NYC = [0xf4a261, 0xe76f51, 0x2a9d8f, 0xf7b2bd, 0xe9c46a];
  const AWN_NYC = [0xd62828, 0x2a6f4f, 0xe07b39, 0x7a3b8f, 0x1d7a8f];

  /* box buildings — pushed via generateWorld's push() (instanced walls + auto colliders) */
  const boxBuildings: NycBoxBuilding[] = [
    // Block A (z −135…−67.5) — art-deco skyline: base tiers only, upper tiers render in <NycDistrict>
    { x: 164, z: -102, w: 8, d: 8, h: 30, kind: 0, color: 0xd8cfc0, roof: 0x8a8178, awn: 0, fz: 1 },  // "The Dorsett" limestone base
    { x: 180, z: -94, w: 6.5, d: 6.5, h: 24, kind: 0, color: 0xc9b8a0, roof: 0x8a8178, awn: 0, fz: 1 }, // Chrysler-ish tower base
    { x: 176, z: -116, w: 6.5, d: 5, h: 13, kind: 0, color: 0xb0a090, roof: 0x6c645c, awn: 0, fz: 1 },  // low office (billboard roof)
    // Block B (z −67.5…0) — brownstone row + tenement + walk-up + cast-iron loft
    ...BROWNSTONE_COLS.map((color, i) => ({ x: 152, z: -60 + i * 8.5, w: 4, d: 3.5, h: 11, kind: 0 as const, color, roof: BROWNSTONE_ROOFS[i], awn: 0, fz: 1 as const })),
    { x: 170, z: -20, w: 5, d: 4.5, h: 16, kind: 0, color: 0x9e4a3a, roof: 0x4a3028, awn: 0, fz: 1 },   // brick tenement (wall ad + water tank)
    { x: 182, z: -30, w: 2.8, d: 4, h: 13, kind: 0, color: 0xb0a894, roof: 0x5c544a, awn: 0, fz: 1 },   // narrow walk-up
    { x: 170, z: -52, w: 6, d: 4.5, h: 13, kind: 0, color: 0xa8b0a0, roof: 0x6c746c, awn: 0, fz: 1 },   // cast-iron loft
    // Block C (z 0…67.5) — one-storey shop row facing road z=0 (fz −1 → awnings/doors toward the street)
    ...SHOP_NYC.map((color, i) => ({ x: 154 + i * 8.5, z: 11.5, w: 4, d: 3.5, h: 6.2, kind: 1 as const, color, roof: 0x5c544a, awn: AWN_NYC[i], fz: -1 as const })),
    // Block D (z 67.5…135) — parking garage, tenement, movie theatre
    { x: 172, z: 92, w: 7, d: 6, h: 9, kind: 0, color: 0xb8b8b0, roof: 0x8a8a82, awn: 0, fz: 1 },      // parking garage
    { x: 160, z: 114, w: 5, d: 4.5, h: 15, kind: 0, color: 0x8e4436, roof: 0x4a3028, awn: 0, fz: 1 },  // tenement (fire escape + water tank)
    { x: 182, z: 114, w: 6, d: 5, h: 10, kind: 0, color: 0xd8cbb0, roof: 0x8a5a44, awn: 0, fz: 1 },    // movie theatre (marquee + blade sign)
  ];

  /* 🏙️ setback towers — tier stacks render in <NycDistrict> above the pushed bases */
  const decTower = { x: 164, z: -102, base: 30, tiers: [{ s: 5.75, h: 13, y: 30 }, { s: 3.6, h: 8, y: 43 }], color: 0xd8cfc0, dark: 0x8a8178, spire: 9 };
  const chrTower = { x: 180, z: -94, base: 24, tiers: [{ s: 4.4, h: 10, y: 24 }], color: 0xc9b8a0, dark: 0x7e7264, crown: 5, spire: 6 };
  const billboard = { x: 176, z: -116, y: 13, w: 8, h: 4.5, rot: Math.PI / 2, face: 1 }; // rooftop billboard facing road x=202.5

  /* 🧱 brownstone detail */
  const brownstones = BROWNSTONE_COLS.map((color, i) => ({ x: 152, z: -60 + i * 8.5, color, roof: BROWNSTONE_ROOFS[i], stoop: true, escape: i % 2 === 1, scaffold: i === 2 }));
  const stoops = brownstones.map((b) => ({ x: 147.4, z: b.z }));
  const fireEscapes = [
    ...brownstones.filter((b) => b.escape).map((b) => ({ x: 148.3, z: b.z, floors: 3, flip: false })),
    { x: 164.7, z: -20, floors: 3, flip: false },  // tenement west face
    { x: 154.7, z: 114, floors: 2, flip: false },  // tenement D west face (road x=135 side)
  ];
  const scaffolding = { x: 147.2, z: -43, len: 8 };
  const wallAd = { x: 175.3, z: -20, y: 8, w: 8.6, h: 6.5, rot: Math.PI / 2 }; // painted ad on tenement east wall

  /* 🚕 street level */
  const subway = { x: 147, z: 28 };
  const newsstand = { x: 151, z: 20 };
  const hotdog = { x: 145, z: -9, rot: 0.4 };
  const mailboxes = [{ x: 158, z: 6.8 }, { x: 194.8, z: 110 }];
  const hydrants = [{ x: 144.5, z: 14 }, { x: 195.3, z: 96 }];
  const trafficLights = [{ x: 141.5, z: -8.5, rot: Math.PI }, { x: 194.5, z: 61.5, rot: 0 }];
  const globeLamps = [{ x: 144, z: 12 }, { x: 144, z: 52 }, { x: 193.5, z: 12 }, { x: 193.5, z: 52 }];
  const bikeRack = { x: 163, z: 15, rot: 0 };
  const busShelter = { x: 144, z: 46, rot: Math.PI / 2 };
  const diningShed = { x: 161, z: 9.8 };
  const trash = [{ x: 150, z: 5 }, { x: 188, z: 8 }];
  const bollards = [{ x: 145.5, z: 25.5 }, { x: 148.5, z: 25.5 }, { x: 145.5, z: 30.5 }, { x: 148.5, z: 30.5 }];
  const manholes = [{ x: 148, z: 38 }, { x: 156, z: 52 }, { x: 190, z: 30 }];
  const cellarHatch = { x: 151, z: 44, rot: 0 };
  const cabs = [{ x: 160, z: 34, rot: Math.PI / 2 }, { x: 166.5, z: 34, rot: Math.PI / 2 }];
  const streetTrees = [{ x: 146, z: 4 }, { x: 146, z: 36 }, { x: 146, z: 60 }];
  const bladeSigns = [{ x: 162.5, z: 7.6, y: 4.4, text: "DELI" }, { x: 179.5, z: 7.6, y: 4.4, text: "NEWS" }]; // projecting shop signs

  /* 🅿️ garage + 🎬 theatre + 🚧 construction corner */
  const garage = { x: 172, z: 92, w: 7, d: 6, h: 9 };
  const theatre = { x: 182, z: 114, w: 6, d: 5, h: 10, blade: { x: 189.3, z: 117, y: 6.6, w: 1.9, h: 6.8 } };
  const steam = [
    { x: 168.6, z: -96.8, y: 30, s: 0.8 },   // "The Dorsett" setback ledge
    { x: 146.5, z: -70.5, y: 0, s: 1 },      // sidewalk steam pipe
    { x: 176.5, z: 88.5, y: 9, s: 0.7 },     // garage roof corner
  ];
  const waterTowers = [
    { x: 168.3, z: -102, y: 30.45, s: 0.9 },  // Dorsett setback ledge
    { x: 171.5, z: -22.5, y: 16.45, s: 1 },   // tenement roof
    { x: 161.5, z: 116, y: 15.45, s: 0.95 },  // tenement D roof
  ];
  const acUnits = [
    { x: 160.5, z: -105.5, y: 30.45, rot: 0 },
    { x: 152, z: -58.5, y: 11.45, rot: 0 },
    { x: 171.5, z: -50, y: 13.45, rot: 0.3 },
    { x: 184, z: 112, y: 10.45, rot: 0 },
  ];
  const construction = {
    x: 155, z: 78,
    hoardings: [{ x: 155, z: 74.6, rot: 0, len: 7 }, { x: 151.3, z: 78, rot: Math.PI / 2, len: 6 }],
    dumpster: { x: 156.5, z: 79.5, rot: 0.1 },
    cones: [{ x: 153, z: 81 }, { x: 155.5, z: 82.5 }, { x: 153.5, z: 84 }],
    dirt: { x: 155.5, z: 80 },
  };

  /* colliders for the solid street furniture (buildings collide automatically) */
  const solidBoxes: { x: number; z: number; w: number; d: number; h: number }[] = [
    { x: subway.x, z: subway.z, w: 2.2, d: 2.6, h: 1.4 },      // subway stair railings
    { x: newsstand.x, z: newsstand.z, w: 1.6, d: 1.2, h: 2.4 }, // newsstand kiosk
    { x: diningShed.x, z: diningShed.z, w: 1.8, d: 2.6, h: 2.6 }, // curbside dining shed
    { x: busShelter.x, z: busShelter.z, w: 1.0, d: 1.9, h: 2.6 }, // bus shelter
    ...construction.hoardings.map((h) => ({ x: h.x, z: h.z, w: h.rot === 0 ? h.len / 2 : 0.3, d: h.rot === 0 ? 0.3 : h.len / 2, h: 2.2 })),
    { x: construction.dumpster.x, z: construction.dumpster.z, w: 1.6, d: 1.1, h: 1.5 },
  ];
  const solidCircles: { x: number; z: number; r: number }[] = [
    { x: hotdog.x, z: hotdog.z, r: 1.1 },
    ...mailboxes.map((m) => ({ x: m.x, z: m.z, r: 0.5 })),
    ...hydrants.map((h) => ({ x: h.x, z: h.z, r: 0.35 })),
    ...trafficLights.map((t) => ({ x: t.x, z: t.z, r: 0.3 })),
    ...globeLamps.map((g) => ({ x: g.x, z: g.z, r: 0.3 })),
    ...trash.map((t) => ({ x: t.x, z: t.z, r: 0.4 })),
    ...bollards.map((b) => ({ x: b.x, z: b.z, r: 0.22 })),
    ...streetTrees.map((t) => ({ x: t.x, z: t.z, r: 0.6 })),
    { x: bikeRack.x, z: bikeRack.z, r: 0.7 },
    ...construction.cones.map((c) => ({ x: c.x, z: c.z, r: 0.3 })),
    // yellow cabs — two axle discs each, like every other vehicle
    ...cabs.flatMap((c) => {
      const fx = Math.sin(c.rot), fz2 = Math.cos(c.rot);
      return [
        { x: c.x - fx * 1.25, z: c.z - fz2 * 1.25, r: 1.3 },
        { x: c.x + fx * 1.25, z: c.z + fz2 * 1.25, r: 1.3 },
      ];
    }),
  ];

  return { bx, boxBuildings, decTower, chrTower, billboard, brownstones, stoops, fireEscapes, scaffolding, wallAd, subway, newsstand, hotdog, mailboxes, hydrants, trafficLights, globeLamps, bikeRack, busShelter, diningShed, trash, bollards, manholes, cellarHatch, cabs, streetTrees, bladeSigns, garage, theatre, steam, waterTowers, acUnits, construction, solidBoxes, solidCircles };
})();

/* ---------------- 🎃 halloween night kit — the OUT-OF-TOWN cemetery estate ----------------
 * The graveyard moved deep into the north-west jungle (GRAVEYARD const): no
 * city road crosses the grounds any more. Access is a dedicated dirt lane from
 * the x=-270 street's south end to the arched cemetery gate — the gate, fence
 * runs, haunted Victorian house, family mausoleum, vintage hearse, lantern
 * posts, dead oaks and jack-o-lanterns are the REAL polyfork Halloween-kit
 * GLB models (see graveyardModels.ts / <GraveyardEstate>), and every position
 * here is derived from GRAVEYARD so colliders + rendering stay in lock-step. */
export const GRAVEKIT = (() => {
  const { x: gx, z: gz } = GRAVEYARD;
  /* the lane starts at the south end of the x=-270 street (roads span ±320) —
   * that road end is the cemetery's "bus stop", so the gate faces it exactly */
  const ax = -270, az = -318;
  const al = Math.hypot(ax - gx, az - gz);
  const u = { x: (ax - gx) / al, z: (az - gz) / al };      // gate faces the road end
  const v = { x: -u.z, z: u.x };                           // lane perpendicular
  // placement rots follow the kit convention: rot = atan2(dx, dz) turns the
  // model's authored +z front toward the direction (dx, dz)
  const gate = { x: gx + u.x * 42, z: gz + u.z * 42, rot: Math.atan2(u.x, u.z) };
  // the dirt cemetery lane: a strip from the road end to the gate
  const laneLen = al - 42;
  const lane = {
    x: (ax + gate.x) / 2, z: (az + gate.z) / 2,
    len: laneLen, w: 7.2, rot: -Math.atan2(u.z, u.x),
  };
  // a narrower dirt path carries visitors from the gate to the heart of the grounds
  const pathLen = 36;
  const path = { x: gx + u.x * 23, z: gz + u.z * 23, len: pathLen, w: 2.6, rot: -Math.atan2(u.z, u.x) };
  // the haunted Victorian house looms on the far side, facing the entrance
  const house = { x: gx - u.x * 24, z: gz - u.z * 24, rot: Math.atan2(u.x, u.z) };
  // the family mausoleum stands on the lane's far flank, door turned to the path
  const mausoleum = { x: gx + v.x * 24 - u.x * 4, z: gz + v.z * 24 - u.z * 4, rot: Math.atan2(-v.x, -v.z) };
  // mossy steps climb to the house porch; the coffin waits inside the mausoleum
  const steps = { x: house.x + u.x * 7.4, z: house.z + u.z * 7.4, rot: house.rot };
  const coffin = { x: mausoleum.x, z: mausoleum.z, rot: mausoleum.rot };
  // the vintage hearse parked beside the lane just inside the gate
  const hearse = { x: gate.x - u.x * 9 + v.x * 6.4, z: gate.z - u.z * 9 + v.z * 6.4, rot: gate.rot + Math.PI / 2 };
  // weeping stone angels flank the entrance path, each facing across it
  const angels = [
    { x: gx + u.x * 12 + v.x * 4.6, z: gz + u.z * 12 + v.z * 4.6, rot: Math.atan2(-v.x, -v.z) },
    { x: gx + u.x * 19 - v.x * 5.4, z: gz + u.z * 19 - v.z * 5.4, rot: Math.atan2(v.x, v.z) },
  ];
  // skeletons clawing out of the lawn, away from the path
  const skeletons = [
    { x: gx + v.x * 13 + u.x * 3, z: gz + v.z * 13 + u.z * 3, rot: range(seededDerive(1), 0, 6.28) },
    { x: gx - v.x * 10 - u.x * 11, z: gz - v.z * 10 - u.z * 11, rot: range(seededDerive(2), 0, 6.28) },
  ];
  // lantern posts light the grounds (clear of the path sector)
  const lanterns = [1.6, 2.7, 3.8, 5.2].map((a) => ({ x: gx + Math.cos(a) * 30, z: gz + Math.sin(a) * 30 }));
  // twisted dead oaks around the lawn; cheesecloth ghosts hang in their branches
  const oaks = [1.5, 3.2, 5.0].map((a) => ({ x: gx + Math.cos(a) * 36, z: gz + Math.sin(a) * 36, s: 1 + (a % 1) * 0.4 }));
  const ghosts = oaks.map((ok) => ({ x: ok.x + 1.4, z: ok.z - 1.2, y: 3.4 }));
  // bare thorn bushes hug the fence line, never the path sector
  const bushes = [1.35, 2.25, 3.05, 3.95, 5.55].map((a) => ({ x: gx + Math.cos(a) * 37.5, z: gz + Math.sin(a) * 37.5 }));
  // jack-o-lanterns line the cemetery lane — lit every night, no exceptions
  const pumpkins = [0.3, 0.55, 0.8].flatMap((t) => {
    const px = lane.x - u.x * (laneLen / 2 - laneLen * t), pz = lane.z - u.z * (laneLen / 2 - laneLen * t);
    return [
      { x: px + v.x * 4.4, z: pz + v.z * 4.4, s: 1 },
      { x: px - v.x * 4.4, z: pz - v.z * 4.4, s: 0.85 },
    ];
  });
  /* wrought-iron fence runs tile the ring (authored 4u long); the run strip is
   * broken ONLY for the gate span — a solid fence with one real entrance     */
  const FENCE_R = 42, FENCE_L = 4.05, ARC = Math.PI * 2 * FENCE_R;
  const gateAng = Math.atan2(u.z, u.x);
  const gateArc = ((gateAng % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * FENCE_R;
  const fenceRuns: { x: number; z: number; rot: number }[] = [];
  for (let s = 0; s < ARC; s += FENCE_L) {
    // signed distance from the gate centre along the ring
    let d = s + FENCE_L / 2 - gateArc;
    d = ((d % ARC) + ARC * 1.5) % ARC - ARC / 2;
    if (Math.abs(d) < FENCE_L / 2 + 2.4) continue;          // the gateway
    const a = (s + FENCE_L / 2) / FENCE_R;
    fenceRuns.push({ x: gx + Math.cos(a) * FENCE_R, z: gz + Math.sin(a) * FENCE_R, rot: Math.atan2(-Math.cos(a), -Math.sin(a)) });
  }
  // crows perch on a few fence runs (indices into fenceRuns) + one on the mausoleum
  const crows = [3, 17, 31, 45].filter((i) => i < fenceRuns.length).map((i) => ({
    x: fenceRuns[i].x, z: fenceRuns[i].z, y: 1.62, rot: fenceRuns[i].rot + Math.PI / 2,
  }));
  crows.push({ x: mausoleum.x + v.x * 0.9, z: mausoleum.z + v.z * 0.9, y: 4.62, rot: mausoleum.rot });
  // solid fence collision ring — dense 2u spacing so nothing slips through the
  // iron rails (the gateway span stays open: enter like a person, not a ghost)
  const fenceCols: { x: number; z: number }[] = [];
  for (let s = 0; s < ARC; s += 2) {
    let d = s - gateArc;
    d = ((d % ARC) + ARC * 1.5) % ARC - ARC / 2;
    if (Math.abs(d) < 2.3) continue;
    const a = s / FENCE_R;
    fenceCols.push({ x: gx + Math.cos(a) * FENCE_R, z: gz + Math.sin(a) * FENCE_R });
  }
  return { ax, az, u, v, gate, lane, path, house, mausoleum, steps, coffin, hearse, angels, skeletons, lanterns, oaks, ghosts, bushes, pumpkins, fenceRuns, crows, fenceCols, FENCE_R };
})();

/** deterministic rand for GRAVEKIT prop derivation (keeps worldgen seed-free) */
function seededDerive(n: number): () => number {
  let a = (0x9e3779b9 ^ (n * 0x85ebca6b)) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 🚧 Construction sites — polyfork Construction Site kit ----------------
 * Three REAL building sites, each with its own character, all digging REAL
 * walkable pits (DIGS above — graded ramp in, terraced dirt walls, machines
 * on the floor), composed to match the kit's official live-preview scene
 * (polyfork.dev/kit/construction-site-9e40b0): rising steel frame + METAL-DECK
 * floor plates + concrete-core cluster, formwork runs, hoarding to the street
 * with WALKWAY TUNNEL + LOADING GANTRY at the gate, WHEEL WASH on the haul
 * road, materials yards (scaffold stacks, dumpy bags, hardcore & slab tiles),
 * a welfare compound (smoking shelter, tool vault, air compressor, cement
 * mixer stand) and the FULL machine fleet (telehandler, skid-steer, wheeled
 * loader, site dumper, mini excavator, bulldozer, mobile crane, concrete
 * pump, flatbed lorry, water bowser, trencher, compactor, cherry picker,
 * scissor lift) — plus the classic roadworks dressing on the streets:
 *   A  "Lakeshore Towers"  — west midtown SKYSCRAPER job: 30m tower crane over
 *      a tower rising straight out of its deep foundation pit, excavator +
 *      dump truck working the floor, welfare corner and materials yard NW/NE
 *   B  "Eastside Mega Dig" — east belt OPEN-PIT excavation (deepest, 4.3m):
 *      the rising structure sits ON the pit floor, two excavators + two dump
 *      trucks, spoil heaps ringing the rim, trench bays, haul-road mud tiles
 *   C  "Northgate Works"   — north boulevard BLOCK BUILD: its own tower crane,
 *      mixer truck pouring at the west ramp gate, backhoe + roller, roadworks
 *      dressing on the boulevard outside (this is the x26/z125 site)
 * Every prop is the REAL kit model (also arrowBoard + skip — files were on
 * disk but never wired). craneTop is NOT baked: <CraneTops> renders each
 * slewing top as a live clone so the cranes actually WORK (slow yaw swing).
 * Kit crew: real kit characters idle at their work spots (see site.crew).
 * Placements + colliders are derived here so the render and the physics grid
 * can never disagree (same contract as GRAVEKIT). The GLBs render via
 * <ConstructionSites> (src/components/game/ConstructionSites.tsx) — every
 * repeated prop is baked into ONE merged mesh per kind (~55 draw calls total,
 * plus 3 dig meshes + 3 crane tops + crew — all static but the cranes). */
export interface ConSitePlacement { x: number; y?: number; z: number; rot?: number; s?: number }
export interface ConSiteDef {
  name: string;
  /** block centre — also the cottage-exclusion anchor */
  cx: number; cz: number;
  props: Record<string, ConSitePlacement[]>;
  /** kit crew — real character slugs idling at their work spots (y = pit floor) */
  crew?: { slug: string; x: number; z: number; y?: number; rot: number }[];
  /** solid props → physics circles (r) */
  cols: { x: number; z: number; r: number }[];
  /** solid buildings (cabin) → physics boxes */
  boxes: { x: number; z: number; w: number; d: number; h: number }[];
}

/** tiny helper — a row of fence/hoarding runs stepping `step` units along a
 *  yaw direction from (x,z); rot follows the run's 4m authored length */
function runRow(x: number, z: number, n: number, step: number, rot: number): ConSitePlacement[] {
  const out: ConSitePlacement[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: x + Math.sin(rot) * step * i, z: z + Math.cos(rot) * step * i, rot });
  }
  return out;
}

/** 🚧 construction-site collider — optional standable top (precast stacks,
 *  spoil heaps, pallets, scaffold bays and cones are all climbable furniture) */
const conCol = (x: number, z: number, r: number, top?: number) => (top === undefined ? { x, z, r } : { x, z, r, top });
/** standable top for furniture standing INSIDE a dig — the deck sits rel metres
 *  above the dirt surface at that spot (−digDown), not above street grade, so
 *  a pit scaffold deck lands under your feet instead of floating mid-air */
const pitTop = (x: number, z: number, rel: number) => -digDown(x, z) + rel;

export const SITEKIT = (() => {
  /* ---- Site A · LAKESHORE TOWERS — west midtown block (-168.75, 33.75) ----
   * THE SKYSCRAPER JOB. Foundation pit (DIGS A, ramp south): the tower climbs
   * straight out of it, built exactly on the kit preview's stacking recipe —
   * FOUR 3.1m lifts of contiguous steel bays (4m bays butted together so the
   * chords overlap into one continuous frame), every lift above the pit slab
   * floored with metal-deck plates, and a two-column concrete core pouring
   * full-height (one 18.6m lift each) beside the frame, leading the steel by
   * ~5m like the kit scene. 13m scaffold HUGS the north face from the pit
   * floor. Crane NE, welfare NW, materials yard NE (precast/pallets staged in
   * neat rows on a hardcore apron). The whole block is FENCED — hoarding to
   * the west + south streets, mesh fence closing north + east — with the
   * south gate at the walkway tunnel / loading gantry and temporary signals
   * on the approach. */
  const A: ConSiteDef = {
    name: "Lakeshore Towers", cx: -168.75, cz: 33.75,
    props: {
      // ⭐ the tower crane: two 15m mast sections stacked + the slewing top
      craneMast: [{ x: -189, z: 14 }, { x: -189, z: 14, y: 15 }],
      craneTop: [{ x: -189, z: 14, y: 30, rot: Math.PI * 0.25 }],
      // the rising tower — kit stacking DNA: 4 lifts × 3 contiguous bays
      steelFrame: [
        { x: -162.5, z: 30, y: -3, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: -3, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: -3, rot: Math.PI / 2 },
        { x: -162.5, z: 30, y: 0.1, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: 0.1, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: 0.1, rot: Math.PI / 2 },
        { x: -162.5, z: 30, y: 3.2, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: 3.2, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: 3.2, rot: Math.PI / 2 },
        { x: -162.5, z: 30, y: 6.3, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: 6.3, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: 6.3, rot: Math.PI / 2 },
      ],
      // metal-deck floors on every lift above the pit slab (kit DNA)
      metalDeck: [
        { x: -162.5, z: 30, y: 0.1, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: 0.1, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: 0.1, rot: Math.PI / 2 },
        { x: -162.5, z: 30, y: 3.2, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: 3.2, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: 3.2, rot: Math.PI / 2 },
        { x: -162.5, z: 30, y: 6.3, rot: Math.PI / 2 }, { x: -162.5, z: 34, y: 6.3, rot: Math.PI / 2 }, { x: -162.5, z: 38, y: 6.3, rot: Math.PI / 2 },
      ],
      // the concrete core — two full-height pours BUTTED against the frame's
      // west face (kit scene DNA: core bolted flush to the steel, leading it)
      coreSection: [
        { x: -165.5, z: 30.5, y: -3, rot: Math.PI / 2 }, { x: -165.5, z: 34.5, y: -3, rot: Math.PI / 2 },
      ],
      // scaffold HUGS the tower (kit DNA): two 13m bays against the north
      // face from the pit floor (topped out level with the frame) + the east
      // grade platform + the pit-floor bay by the spoil
      scaffold: [
        { x: -164.5, z: 27.5, y: -3, rot: 0 }, { x: -160.5, z: 27.5, y: -3, rot: 0 },
        { x: -152, z: 34, rot: Math.PI / 2 }, { x: -168, z: 41.5, y: -3, rot: 0 },
      ],
      // machines working the foundation pit + spoil heaps rim & floor — plus
      // the kit scene's pit-floor fleet (lift, cherry picker, mini digger)
      excavator: [{ x: -175.5, z: 26.5, y: -3, rot: 0.55 }],
      dumpTruck: [{ x: -161.5, z: 40, y: -3, rot: -0.9 }],
      cherryPicker: [{ x: -170.5, z: 27, y: -3, rot: 0.5 }],
      scissorLift: [{ x: -167, z: 38.5, y: -3, rot: 1.2 }],
      miniExcavator: [{ x: -179, z: 38, y: -3, rot: -0.5 }],
      spoilHeap: [{ x: -177, z: 42, y: -3, s: 1.2 }, { x: -155.5, z: 25, s: 1.1 }, { x: -158.5, z: 21.5, s: 0.9 }],
      // 🚧 the BORDER — hoarding to the west + south streets (gate gap at the
      // south entrance), mesh fence closing north + east
      hoarding: [
        ...runRow(-192.2, 12, 11, 4.2, 0),               // west street flank
        ...runRow(-192.2, 11.4, 6, 4.2, Math.PI / 2),    // south flank, west of the gate
        ...runRow(-158.6, 11.4, 3, 4.2, Math.PI / 2),    // south flank, east of the gate
      ],
      meshFence: [
        ...runRow(-191.9, 56.4, 12, 4.2, Math.PI / 2),   // north flank
        ...runRow(-145.4, 12, 11, 4.2, 0),               // east flank
      ],
      // welfare corner (NW): cabin, loos, generator, light tower + kit scene
      // extras (smoking shelter, tool vault, air compressor)
      cabin: [{ x: -186, z: 44, rot: 0 }],
      toilet: [{ x: -181.5, z: 52.5, rot: 0 }, { x: -179.5, z: 52.5, rot: 0 }],
      lightTower: [{ x: -190.5, z: 50 }, { x: -154.5, z: 40, rot: 0.5 }],
      generator: [{ x: -183, z: 48, rot: 0.4 }],
      smokingShelter: [{ x: -178.5, z: 54.6, rot: 0 }],
      toolVault: [{ x: -183.5, z: 51.6, rot: 0.2 }],
      airCompressor: [{ x: -180.5, z: 47.5, rot: Math.PI / 2 }],
      // materials yard (NE) — the kit's bricks/blocks staged in neat rows:
      // precast wall units butt-together, a pallet cluster, rebar cages,
      // dumpy bags + scaffold stacks — all on a hardcore hardstanding apron
      precast: [
        { x: -149, z: 44, rot: 0 }, { x: -149, z: 48.2, rot: 0 }, { x: -149, z: 52.4, rot: 0 },
      ],
      pallet: [
        { x: -152.6, z: 44.6, rot: 0.1 }, { x: -152.6, z: 46.2, rot: -0.1 },
        { x: -151.2, z: 44.6, rot: 0.15 }, { x: -151.2, z: 46.2, rot: 0 },
        // block/brick pallets staged ON the build — the kit scene keeps a
        // masonry supply right at the frame (pit NE terrace shelf)
        { x: -161, z: 44, y: -3, rot: 0 }, { x: -161, z: 46, y: -3, rot: 0.05 },
      ],
      dumpyBag: [{ x: -154.4, z: 48.8, rot: 0.3 }, { x: -153.2, z: 49.2, rot: -0.2 }, { x: -163.2, z: 45.2, y: -3, rot: 0.3 }],
      rebar: [{ x: -152.5, z: 54, rot: 0 }, { x: -167.5, z: 32.5, y: -3, rot: 0 }],
      scaffoldStack: [{ x: -149.5, z: 35.5, rot: Math.PI / 2 }, { x: -149.5, z: 39.5, rot: Math.PI / 2 }],
      hardcoreTile: [
        { x: -150.5, z: 44, rot: 0 }, { x: -150.5, z: 48, rot: 0 }, { x: -150.5, z: 52, rot: 0 },
        { x: -146, z: 33, rot: 0.2 }, { x: -146, z: 29, rot: 0 },
      ],
      slabTile: [{ x: -154.5, z: 46, rot: 0 }, { x: -154.5, z: 50, rot: 0 }, { x: -148.5, z: 30, rot: 0 }, { x: -148.5, z: 26, rot: 0 }],
      telehandler: [{ x: -156.8, z: 46.5, rot: -Math.PI / 2 }],
      skidSteer: [{ x: -156.2, z: 52.5, rot: 2.8 }],
      // the pour: pump + mixer truck parked on the south frontage (kit scene)
      concretePump: [{ x: -177.5, z: 15.6, rot: -Math.PI / 2 }],
      mixerTruck: [{ x: -170.8, z: 15.2, rot: Math.PI / 2 }],
      cementMixerStand: [{ x: -178.5, z: 22, rot: 0.4 }],
      // gate + haul frontage: walkway tunnel + loading gantry at the entrance
      // (temporary signals flank the approach), wheel wash across the street
      // exit, flatbed lorry + bowser on the flanks
      walkwayTunnel: [{ x: -165.5, z: 13.5, rot: 0 }],
      loadingGantry: [{ x: -161.5, z: 13.5, rot: 0 }],
      trafficLight: [{ x: -173, z: 10.5, rot: Math.PI / 2 }, { x: -157, z: 10.5, rot: -Math.PI / 2 }],
      wheelWash: [{ x: -168.75, z: 7.5, rot: 0 }],
      flatbedLorry: [{ x: -195.5, z: 45, rot: -Math.PI / 2 }],
      waterBowser: [{ x: -147.5, z: 30, rot: 1.2 }],
      formwork: [{ x: -176.5, z: 17.6, rot: 0 }, { x: -172.5, z: 17.6, rot: 0 },
        { x: -168, z: 46, rot: 0 }, { x: -172, z: 46, rot: 0 }],
      skip: [{ x: -147, z: 22, rot: 0.3 }],
      arrowBoard: [{ x: -193.6, z: 33.5, rot: Math.PI / 2 }],
      signBoard: [{ x: -160, z: 12.6, rot: 0.2 }],
      mudTile: [{ x: -152.5, z: 28, rot: 0.2 }, { x: -157, z: 44, rot: 0.5 }],
      crashBarrier: [{ x: -165, z: 20.4, rot: 0 }, { x: -172.5, z: 20.4, rot: 0 }],
      cone: [{ x: -165.5, z: 19.5, rot: 0.2 }, { x: -172, z: 20 }, { x: -168.75, z: 16.5 }, { x: -147.5, z: 24, rot: 0.4 }, { x: -150, z: 18.5 }, { x: -189, z: 18 }, { x: -163.5, z: 15.5, rot: 0.6 }, { x: -174, z: 9.2, rot: 0.2 }, { x: -169.3, z: 11.4, rot: 0.1 }],
    },
    crew: [
      { slug: "groundworker-083f5c", x: -164.5, z: 31, y: -3, rot: 2.2 },
      { slug: "site-manager-d60b95", x: -183.5, z: 46.5, rot: 0.9 },
      { slug: "steel-erector-124bef", x: -162.5, z: 34, y: 6.3, rot: -2.4 },   // on the tower's top lift
      { slug: "crane-banksman-3994e0", x: -166, z: 17.5, rot: Math.PI },       // banking the south gate
      { slug: "surveyor-82e5c7", x: -188.5, z: 48.5, rot: -1.1 },              // levelling by the light tower
    ],
    cols: [
      conCol(-189, 14, 2.5),                                     // crane base
      conCol(-175.5, 26.5, 2.6), conCol(-161.5, 40, 2.5),        // pit machines
      conCol(-170.5, 27, 1.5), conCol(-167, 38.5, 1.6), conCol(-179, 38, 1.7), // pit fleet (picker/lift/mini)
      conCol(-168, 41.5, 1.8, pitTop(-168, 41.5, 2.3)),          // pit scaffold bay — jump platform
      conCol(-164.5, 27.5, 1.7, pitTop(-164.5, 27.5, 2.3)), conCol(-160.5, 27.5, 1.7, pitTop(-160.5, 27.5, 2.3)), // tower scaffold — jump platforms
      conCol(-152, 34, 1.8, 2.3),                                // east grade scaffold — jump platform
      conCol(-177, 42, 1.5), conCol(-155.5, 25, 1.4), conCol(-158.5, 21.5, 1.2), // spoil heaps
      conCol(-190.5, 50, 0.9), conCol(-154.5, 40, 0.9),          // light towers
      conCol(-183, 48, 1.2),                                     // generator
      conCol(-181.5, 52.5, 0.8), conCol(-179.5, 52.5, 0.8),      // portable toilets
      conCol(-178.5, 54.6, 1.2), conCol(-183.5, 51.6, 1.0), conCol(-180.5, 47.5, 1.3), // shelter/vault/compressor
      conCol(-149, 44, 1.5, 1.25), conCol(-149, 48.2, 1.5, 1.25), conCol(-149, 52.4, 1.5, 1.25), // precast run — climbable
      conCol(-152.6, 44.6, 0.7, 0.55), conCol(-152.6, 46.2, 0.7, 0.55), conCol(-151.2, 44.6, 0.7, 0.55), conCol(-151.2, 46.2, 0.7, 0.55), // pallets — steppable
      conCol(-154.4, 48.8, 0.75, 0.95), conCol(-153.2, 49.2, 0.75, 0.95), // dumpy bags — steppable
      conCol(-152.5, 54, 1.1), conCol(-167.5, 32.5, 1.1),        // rebar cages (yard + core pour)
      conCol(-149.5, 35.5, 0.7, 1.3), conCol(-149.5, 39.5, 0.7, 1.3), // scaffold stacks — climbable
      conCol(-156.8, 46.5, 2.2), conCol(-156.2, 52.5, 1.6),      // telehandler + skid-steer
      conCol(-177.5, 15.6, 2.4), conCol(-170.8, 15.2, 2.7),      // pump + mixer on the frontage
      conCol(-178.5, 22, 1.1),                                   // cement mixer stand
      conCol(-195.5, 45, 2.6), conCol(-147.5, 30, 1.6),          // flatbed lorry + water bowser
      conCol(-176.5, 17.6, 0.7), conCol(-172.5, 17.6, 0.7),      // formwork runs
      conCol(-147, 22, 1.7, 1.45),                               // skip — hop on the rim
      conCol(-193.6, 33.5, 0.6), conCol(-160, 12.6, 0.6),        // arrow + sign boards
      conCol(-173, 10.5, 0.55), conCol(-157, 10.5, 0.55),        // temporary signals
      conCol(-163.5, 15.5, 0.35), conCol(-174, 9.2, 0.35), conCol(-169.3, 11.4, 0.35), // cones (gate dressing)
      conCol(-161, 44, 0.7, pitTop(-161, 44, 0.55)), conCol(-161, 46, 0.7, pitTop(-161, 46, 0.55)), // build-side block pallets — steppable
      conCol(-163.2, 45.2, 0.75, pitTop(-163.2, 45.2, 0.95)),    // terrace dumpy bag — steppable
      conCol(-168, 46, 0.7), conCol(-172, 46, 0.7),              // staged formwork runs
    ],
    boxes: [{ x: -186, z: 44, w: 4.4, d: 8.4, h: 3.4 }],         // site cabin
  };
  for (const h of A.props.hoarding!) A.cols.push(conCol(h.x, h.z, 0.5));
  for (const f of A.props.meshFence!) A.cols.push(conCol(f.x, f.z, 0.45));
  for (const b of A.props.crashBarrier!) A.cols.push(conCol(b.x, b.z, 0.5));

  /* ---- Site B · EASTSIDE MEGA DIG — east belt block (236.25, -101.25) ----
   * THE OPEN-PIT MEGA DIG (the kit cover-art site). The whole block is one
   * terraced 4.3m excavation with a north haul ramp; the rising structure
   * stands ON the pit floor (y −4.3) — four kit-recipe lifts of contiguous
   * bays with deck floors above, the core pouring full-height, and 13m
   * scaffold hugging the north face. Two excavators + two dump trucks work
   * it, spoil heaps ring the rim, trench bays + mud-tile haul road. Hoarding
   * fronts the west + haul-road sides (gate at the ramp exit), mesh fence
   * closes south + east. */
  const B: ConSiteDef = {
    name: "Eastside Mega Dig", cx: 236.25, cz: -101.25,
    props: {
      craneMast: [{ x: 250, z: -83.5 }],
      craneTop: [{ x: 250, z: -83.5, y: 15, rot: -Math.PI * 0.3 }],
      // the rising structure ON the pit floor — four kit-recipe lifts of
      // contiguous bays + deck floors above the pit slab
      steelFrame: [
        { x: 243, z: -94, y: -4.3, rot: Math.PI / 2 }, { x: 243, z: -98, y: -4.3, rot: Math.PI / 2 },
        { x: 243, z: -94, y: -1.2, rot: Math.PI / 2 }, { x: 243, z: -98, y: -1.2, rot: Math.PI / 2 },
        { x: 243, z: -94, y: 1.9, rot: Math.PI / 2 }, { x: 243, z: -98, y: 1.9, rot: Math.PI / 2 },
        { x: 243, z: -94, y: 5, rot: Math.PI / 2 }, { x: 243, z: -98, y: 5, rot: Math.PI / 2 },
      ],
      metalDeck: [
        { x: 243, z: -94, y: -1.2, rot: Math.PI / 2 }, { x: 243, z: -98, y: -1.2, rot: Math.PI / 2 },
        { x: 243, z: -94, y: 1.9, rot: Math.PI / 2 }, { x: 243, z: -98, y: 1.9, rot: Math.PI / 2 },
        { x: 243, z: -94, y: 5, rot: Math.PI / 2 }, { x: 243, z: -98, y: 5, rot: Math.PI / 2 },
      ],
      // the core pours FLUSH against the frame's east face (kit scene DNA),
      // leading the steel one bay south
      coreSection: [{ x: 246, z: -99, y: -4.3, rot: Math.PI / 2 }],
      // scaffold HUGS the tower's north face from the pit floor (kit DNA)
      scaffold: [{ x: 241, z: -92.7, y: -4.3, rot: 0 }, { x: 245, z: -92.7, y: -4.3, rot: 0 }],
      scaffoldStack: [{ x: 236.5, z: -92.5, y: -4.3, rot: Math.PI / 2 }, { x: 236.5, z: -96.5, y: -4.3, rot: Math.PI / 2 }],
      // the FULL fleet working the mega dig (kit scene cover-art composition)
      excavator: [{ x: 230.5, z: -90.5, y: -4.3, rot: 2.7 }, { x: 257.5, z: -95, rot: -0.8 }],
      dumpTruck: [{ x: 228, z: -104, y: -4.3, rot: 0.8 }, { x: 244.5, z: -81, rot: Math.PI }],
      miniExcavator: [{ x: 250, z: -106, y: -4.3, rot: -1.2 }],
      siteDumper: [{ x: 222, z: -118, y: -4.3, rot: 0.6 }],
      bulldozer: [{ x: 252, z: -116, rot: -2.6 }],
      wheeledLoader: [{ x: 240, z: -80, rot: 2.6 }],
      mobileCrane: [{ x: 217, z: -99, rot: 1.5 }],
      skidSteer: [{ x: 218, z: -97, rot: 0.9 }],
      trencher: [{ x: 228, z: -108, y: -4.3, rot: 0.2 }],
      compactorPlate: [{ x: 234, z: -107.5, y: -4.3, rot: 0.7 }],
      trenchPlate: [{ x: 234, z: -110.8, y: -4.28, rot: 0.15 }],   // cover plate over a trench bay
      spoilHeap: [
        { x: 216, z: -92, s: 1.5 }, { x: 219, z: -86.5, s: 1.2 }, { x: 256, z: -102, s: 1.6 }, { x: 252.5, z: -108.5, s: 1.3 },
        { x: 222, z: -112, y: -4.3, s: 1.4 }, { x: 248, z: -112.5, y: -4.3, s: 1.1 },
      ],
      trench: [{ x: 232, z: -110, y: -4.3, rot: 0.15 }, { x: 236, z: -111.5, y: -4.3, rot: 0.15 }],
      mudTile: [{ x: 236, z: -80, rot: 0 }, { x: 232.5, z: -84, rot: 0.3 }, { x: 240, z: -76.5, rot: 0.6 }],
      hardcoreTile: [{ x: 244, z: -78, rot: 0 }, { x: 248, z: -78, rot: 0 }, { x: 257.6, z: -88, rot: 0 }, { x: 257.6, z: -92, rot: 0 }],
      slabTile: [{ x: 252, z: -78.5, rot: 0 }],
      formwork: [{ x: 258.5, z: -100, rot: -Math.PI / 2 }, { x: 258.5, z: -104, rot: -Math.PI / 2 }],
      // 🚧 the BORDER — hoarding west + along the haul road (gate gap at the
      // ramp exit), mesh fence closing south + east
      hoarding: [
        ...runRow(212.3, -123, 11, 4.2, 0),              // west flank
        ...runRow(212.3, -78.6, 3, 4.2, Math.PI / 2),    // haul road, west of the gate
        ...runRow(249.4, -78.6, 3, 4.2, Math.PI / 2),    // haul road, east of the gate
      ],
      meshFence: [
        ...runRow(212.3, -124.2, 12, 4.2, Math.PI / 2),  // south flank
        ...runRow(260.2, -123, 11, 4.2, 0),              // east flank
      ],
      // north gate dressing: walkway tunnel + gantry at the haul exit, wheel
      // wash across the street, flatbed lorry parked on the frontage
      walkwayTunnel: [{ x: 229.5, z: -78.8, rot: 0 }],
      loadingGantry: [{ x: 243, z: -78.8, rot: 0 }],
      wheelWash: [{ x: 247, z: -75.5, rot: 0 }],
      flatbedLorry: [{ x: 226, z: -74.5, rot: 0.1 }],
      waterBowser: [{ x: 219, z: -75.8, rot: -0.6 }],
      cabin: [{ x: 254, z: -90, rot: -Math.PI / 2 }],
      toilet: [{ x: 249.5, z: -83.2, rot: 0 }, { x: 251.5, z: -83.2, rot: 0 }],
      smokingShelter: [{ x: 246.5, z: -85.5, rot: 0 }],
      toolVault: [{ x: 252, z: -92.5, rot: 0.3 }],
      generator: [{ x: 256.5, z: -97, rot: 0.5 }],
      airCompressor: [{ x: 253.5, z: -86.5, rot: 0.9 }],
      cementMixerStand: [{ x: 250.5, z: -97, rot: -0.5 }],
      lightTower: [{ x: 216.5, z: -80.5 }, { x: 214, z: -95, rot: 1.1 }],
      pallet: [{ x: 259.5, z: -88, rot: 0.3 }, { x: 257.5, z: -85.5, rot: -0.5 },
        // block/brick supply INSIDE the frame bays (kit scene: masonry staged
        // right under the decks it builds) + the core pour supply
        { x: 242, z: -96, y: -4.3, rot: 0 }, { x: 244, z: -96, y: -4.3, rot: 0.05 }],
      dumpyBag: [{ x: 256.5, z: -81.5, rot: 0.3 }, { x: 255.4, z: -82.2, rot: 0.8 }, { x: 244, z: -94, y: -4.3, rot: -0.2 }],
      telehandler: [{ x: 258.8, z: -94.5, rot: -Math.PI / 2 }],
      rebar: [{ x: 256, z: -112, rot: 1 }, { x: 246, z: -95.8, y: -4.3, rot: 0 }],
      skip: [{ x: 214.5, z: -104, rot: 0.4 }],
      signBoard: [{ x: 218.5, z: -79.5, rot: -Math.PI / 4 }],
      arrowBoard: [{ x: 214, z: -127, rot: 0.2 }],
      crashBarrier: [{ x: 231.5, z: -78.4, rot: Math.PI / 2 }, { x: 241, z: -78.4, rot: Math.PI / 2 }],
      trafficLight: [{ x: 228.5, z: -72.6, rot: -Math.PI / 2 }, { x: 244.5, z: -72.6, rot: Math.PI / 2 }],
      cone: [{ x: 233, z: -79 }, { x: 239.5, z: -79 }, { x: 236.25, z: -76.5 }, { x: 220, z: -88 }, { x: 253, z: -90.5, rot: 0.3 }, { x: 224, z: -114.5 }, { x: 247.5, z: -114.5, rot: 0.4 }, { x: 216, z: -100 }, { x: 226, z: -77, rot: 0.5 }, { x: 250, z: -73.5, rot: 0.3 }],
    },
    crew: [
      { slug: "steel-erector-124bef", x: 240, z: -96, y: -4.3, rot: -0.8 },
      { slug: "crane-banksman-3994e0", x: 238.5, z: -80.5, rot: 0.4 },
      { slug: "steel-erector-124bef", x: 243, z: -99, y: 1.9, rot: 0.6 },       // bolting the third lift
      { slug: "groundworker-083f5c", x: 247, z: -104, y: -4.3, rot: 1.4 },      // trench crew on the floor
      { slug: "surveyor-82e5c7", x: 254, z: -93.5, rot: -2.2 },                 // checking the cabin corner
    ],
    cols: [
      conCol(250, -83.5, 2.2),                                   // crane base
      conCol(230.5, -90.5, 2.6), conCol(257.5, -95, 2.6),        // excavators (pit + yard)
      conCol(228, -104, 2.5), conCol(244.5, -81, 2.7),           // dump trucks (pit + ramp top)
      conCol(250, -106, 1.7), conCol(222, -118, 1.8),            // mini excavator + site dumper (floor)
      conCol(252, -116, 2.6), conCol(240, -80, 2.3),             // bulldozer + wheeled loader
      conCol(217, -99, 2.5), conCol(218, -97, 1.6),              // mobile crane + skid-steer
      conCol(228, -108, 2.3), conCol(234, -107.5, 0.8),          // trencher + compactor (floor)
      conCol(232, -110, 2.4), conCol(236, -111.5, 2.4),          // trench bays on the floor
      conCol(216, -92, 1.5, 1.35), conCol(219, -86.5, 1.2, 1.15), conCol(256, -102, 1.6, 1.45), conCol(252.5, -108.5, 1.3, 1.2), // rim spoil heaps — climbable mounds
      conCol(228.5, -72.6, 0.55), conCol(244.5, -72.6, 0.55),    // traffic lights
      conCol(216.5, -80.5, 0.9), conCol(214, -95, 0.9),          // light towers
      conCol(249.5, -83.2, 0.8), conCol(251.5, -83.2, 0.8),      // loos
      conCol(246.5, -85.5, 1.2), conCol(252, -92.5, 1.0), conCol(253.5, -86.5, 1.3), conCol(250.5, -97, 1.1), // shelter/vault/compressor/mixer
      conCol(259.5, -88, 0.7, 0.55), conCol(257.5, -85.5, 0.7, 0.55), // pallets — steppable
      conCol(256.5, -81.5, 0.75, 0.95), conCol(255.4, -82.2, 0.75, 0.95), // dumpy bags — steppable
      conCol(242, -96, 0.7, pitTop(242, -96, 0.55)), conCol(244, -96, 0.7, pitTop(244, -96, 0.55)), // bay block pallets — steppable
      conCol(244, -94, 0.75, pitTop(244, -94, 0.95)),            // bay dumpy bag — steppable
      conCol(258.8, -94.5, 2.1),                                 // telehandler
      conCol(236.5, -92.5, 0.7, pitTop(236.5, -92.5, 0.75)), conCol(236.5, -96.5, 0.7, pitTop(236.5, -96.5, 0.75)), // scaffold stacks (floor) — climbable
      conCol(241, -92.7, 1.7, pitTop(241, -92.7, 2.3)), conCol(245, -92.7, 1.7, pitTop(245, -92.7, 2.3)), // tower scaffold — jump platforms
      conCol(226, -74.5, 2.6), conCol(219, -75.8, 1.6),          // flatbed lorry + water bowser
      conCol(258.5, -100, 0.7), conCol(258.5, -104, 0.7),        // formwork runs
      conCol(256, -112, 1.1), conCol(214.5, -104, 1.7, 1.45),    // rebar + skip
      conCol(246, -95.8, 1.1),                                   // core-pour rebar cage
      conCol(218.5, -79.5, 0.6), conCol(214, -127, 0.6),         // sign + arrow boards
      conCol(226, -77, 0.35), conCol(250, -73.5, 0.35),          // new cones
    ],
    boxes: [{ x: 254, z: -90, w: 8.4, d: 4.4, h: 3.4 }],         // site cabin (rot −π/2 → length along x)
  };
  for (const b of B.props.crashBarrier!) B.cols.push(conCol(b.x, b.z, 0.5));
  for (const h of B.props.hoarding!) B.cols.push(conCol(h.x, h.z, 0.5));
  for (const f of B.props.meshFence!) B.cols.push(conCol(f.x, f.z, 0.45));

  /* ---- Site C · NORTHGATE WORKS — north block (33.75, 168.75) ----
   * THE BLOCK BUILD — this is the site the player walks to from x26/z125.
   * Its own tower crane, a mid-rise rising from the 2.7m foundation dig (west
   * ramp) — four kit-recipe lifts of contiguous bays, deck floors above, the
   * core pouring full-height, scaffold hugging the east face — the mixer
   * truck pouring at the gate, backhoe on the floor, and the roller +
   * roadworks dressing still chewing up the boulevard outside. Hoarding
   * fronts the south boulevard + east flank, mesh fence closes north + west
   * with the player gate at the walkway tunnel. */
  const C: ConSiteDef = {
    name: "Northgate Works", cx: 33.75, cz: 168.75,
    props: {
      craneMast: [{ x: 15, z: 185 }],
      craneTop: [{ x: 15, z: 185, y: 15, rot: Math.PI * 0.4 }],
      // the rising block — four kit-recipe lifts of contiguous bays
      steelFrame: [
        { x: 30, z: 165, y: -2.7, rot: Math.PI / 2 }, { x: 34, z: 165, y: -2.7, rot: Math.PI / 2 },
        { x: 30, z: 165, y: 0.4, rot: Math.PI / 2 }, { x: 34, z: 165, y: 0.4, rot: Math.PI / 2 },
        { x: 30, z: 165, y: 3.5, rot: Math.PI / 2 }, { x: 34, z: 165, y: 3.5, rot: Math.PI / 2 },
        { x: 30, z: 165, y: 6.6, rot: Math.PI / 2 }, { x: 34, z: 165, y: 6.6, rot: Math.PI / 2 },
      ],
      metalDeck: [
        { x: 30, z: 165, y: 0.4, rot: Math.PI / 2 }, { x: 34, z: 165, y: 0.4, rot: Math.PI / 2 },
        { x: 30, z: 165, y: 3.5, rot: Math.PI / 2 }, { x: 34, z: 165, y: 3.5, rot: Math.PI / 2 },
        { x: 30, z: 165, y: 6.6, rot: Math.PI / 2 }, { x: 34, z: 165, y: 6.6, rot: Math.PI / 2 },
      ],
      coreSection: [{ x: 41, z: 172, y: -2.7, rot: Math.PI / 2 }],
      // scaffold HUGS the block's east face from the pit floor (kit DNA) +
      // the two yard platforms by the precast
      scaffold: [
        { x: 36.7, z: 165, y: -2.7, rot: Math.PI / 2 },
        { x: 50, z: 168, rot: 0 }, { x: 50, z: 172.5, rot: 0 },
      ],
      scaffoldStack: [{ x: 52.5, z: 170, rot: 0 }, { x: 52.5, z: 174, rot: 0 }],
      // pit-floor fleet + machines around the block build
      excavator: [{ x: 27.5, z: 176.5, y: -2.7, rot: 2.2 }],
      cherryPicker: [{ x: 36, z: 172, y: -2.7, rot: -0.4 }],
      scissorLift: [{ x: 26, z: 168, y: -2.7, rot: 1.4 }],
      miniExcavator: [{ x: 39, z: 166, y: -2.7, rot: 2.8 }],
      siteDumper: [{ x: 24, z: 172, y: -2.7, rot: -0.9 }],
      dumpTruck: [{ x: 44, z: 184, rot: -0.7 }],
      wheeledLoader: [{ x: 39.5, z: 183.5, rot: 2.4 }],
      bulldozer: [{ x: 52, z: 190, rot: -0.8 }],
      mixerTruck: [{ x: 14.5, z: 162, rot: 0.6 }],
      backhoe: [{ x: 12, z: 178, rot: 1.2 }],
      roadRoller: [{ x: 30, z: 197.5, rot: 0.2 }],
      skidSteer: [{ x: 19.5, z: 159.5, rot: 0.4 }],
      telehandler: [{ x: 54, z: 181, rot: -Math.PI / 2 }],
      brokenRoad: [{ x: 26, z: 200, rot: 0.3 }, { x: 33, z: 199, rot: -0.15 }, { x: 40, z: 200.5, rot: 0.5 }],
      mudTile: [{ x: 20, z: 176, rot: 0.9 }, { x: 26, z: 186, rot: 0.2 }],
      slabTile: [{ x: 24, z: 190, rot: 0.2 }, { x: 47, z: 188, rot: 0 }],
      hardcoreTile: [{ x: 28, z: 190.5, rot: 0 }, { x: 32, z: 191, rot: 0.1 }, { x: 46, z: 180, rot: 0.05 }, { x: 46, z: 184, rot: 0.1 }],
      formwork: [{ x: 46.5, z: 175.5, rot: Math.PI / 2 }, { x: 46.5, z: 179.5, rot: Math.PI / 2 },
        { x: 37.5, z: 169, y: -2.7, rot: 0 }],
      cementMixerStand: [{ x: 44.5, z: 169.5, rot: 0.8 }],
      arrowBoard: [{ x: 44, z: 196.5, rot: Math.PI }],
      trafficLight: [{ x: 20, z: 196.5, rot: -Math.PI / 2 }, { x: 48, z: 196.5, rot: Math.PI / 2 }],
      // 🚧 the BORDER — hoarding to the south boulevard + east flank, mesh
      // fence closing north (roadworks stay visible) + west (gate gap at the
      // player entrance)
      hoarding: [
        ...runRow(10.4, 145.4, 12, 4.2, Math.PI / 2),    // south boulevard frontage
        ...runRow(57.2, 146, 11, 4.2, 0),                // east flank
      ],
      meshFence: [
        ...runRow(10.7, 192.4, 12, 4.2, Math.PI / 2),    // north roadworks flank
        ...runRow(10.4, 146, 4, 4.2, 0),                 // west flank, south of the gate
        ...runRow(10.4, 172, 6, 4.2, 0),                 // west flank, north of the gate
      ],
      // west gate dressing (the x26/z125 entrance): walkway tunnel + loading
      // gantry in the fence gap, wheel wash across the west street
      walkwayTunnel: [{ x: 10.4, z: 164.2, rot: Math.PI / 2 }],
      loadingGantry: [{ x: 10.4, z: 169, rot: Math.PI / 2 }],
      wheelWash: [{ x: 3.5, z: 168.75, rot: 0 }],
      cabin: [{ x: 50, z: 152, rot: -Math.PI / 2 }],
      toilet: [{ x: 46, z: 147, rot: Math.PI / 2 }, { x: 44, z: 147, rot: Math.PI / 2 }],
      smokingShelter: [{ x: 41.5, z: 149, rot: Math.PI / 2 }],
      toolVault: [{ x: 47, z: 156, rot: 0.2 }],
      generator: [{ x: 54.5, z: 158, rot: 0.3 }],
      airCompressor: [{ x: 55.5, z: 155.5, rot: -1.2 }],
      lightTower: [{ x: 12.5, z: 150.5 }, { x: 48, z: 162, rot: -0.6 }],
      waterBowser: [{ x: 16, z: 152.5, rot: 0.5 }],
      compactorPlate: [{ x: 21.5, z: 182, rot: 0.5 }],
      pallet: [{ x: 44, z: 176, rot: 0.4 }, { x: 42, z: 178.5, rot: -0.7 },
        // block/brick supply at the core pour (pit floor, east of the slab)
        { x: 43.5, z: 171, y: -2.7, rot: 0 }, { x: 43.5, z: 173, y: -2.7, rot: 0.05 }],
      dumpyBag: [{ x: 45.5, z: 177, rot: 0.4 }, { x: 46.5, z: 175.8, rot: -0.3 }, { x: 44.9, z: 176.5, y: -2.7, rot: 0.4 }],
      precast: [{ x: 50, z: 182, rot: 0.3 }, { x: 50, z: 178, rot: -0.2 }],
      rebar: [{ x: 38, z: 188, rot: 0.7 }, { x: 41, z: 175.5, y: -2.7, rot: 0 }],
      skip: [{ x: 54.5, z: 168, rot: 0.2 }],
      signBoard: [{ x: 14.5, z: 160, rot: Math.PI / 2 }],
      crashBarrier: [{ x: 18.4, z: 163.5, rot: 0 }, { x: 18.4, z: 174, rot: 0 }],
      cone: [{ x: 18, z: 165.5 }, { x: 18, z: 172, rot: 0.3 }, { x: 14.5, z: 168.75 }, { x: 48, z: 160, rot: 0.4 }, { x: 24, z: 158 }, { x: 44, z: 164, rot: 0.2 }, { x: 12, z: 190, rot: 0.5 }, { x: 13, z: 165.5, rot: 0.4 }, { x: 7.5, z: 173, rot: 0.9 }, { x: 10.4, z: 166.6, rot: 0.2 }],
    },
    crew: [
      { slug: "surveyor-82e5c7", x: 47, z: 165.5, rot: -1.2 },
      { slug: "groundworker-083f5c", x: 32, z: 179, y: -2.7, rot: 0.8 },
      { slug: "steel-erector-124bef", x: 33, z: 165, y: 3.5, rot: -2 },          // up on the block's third lift
      { slug: "crane-banksman-3994e0", x: 12.5, z: 176, rot: 1.2 },              // waving the ramp traffic through
    ],
    cols: [
      conCol(15, 185, 2.2),                                      // crane base
      conCol(27.5, 176.5, 2.5),                                  // excavator (pit floor)
      conCol(36, 172, 1.5), conCol(26, 168, 1.6), conCol(39, 166, 1.7), conCol(24, 172, 1.8), // pit fleet
      conCol(14.5, 162, 2.7), conCol(12, 178, 2.3), conCol(30, 197.5, 2.4), // mixer, backhoe, roller
      conCol(44, 184, 2.5), conCol(39.5, 183.5, 2.3), conCol(52, 190, 2.6),  // dump truck, wheeled loader, bulldozer
      conCol(19.5, 159.5, 1.6), conCol(54, 181, 2.1),            // skid-steer + telehandler
      conCol(50, 168, 1.8, 2.3), conCol(50, 172.5, 1.8, 2.3),    // scaffold bays — jump platforms
      conCol(36.7, 165, 1.7, pitTop(36.7, 165, 2.3)),            // tower scaffold — jump platform
      conCol(52.5, 170, 0.7, 1.3), conCol(52.5, 174, 0.7, 1.3),  // scaffold stacks — climbable
      conCol(50, 182, 2.1, 1.25), conCol(50, 178, 2.1, 1.25),    // precast stacks — climbable
      conCol(44, 176, 0.7, 0.55), conCol(42, 178.5, 0.7, 0.55),  // pallets — steppable
      conCol(43.5, 171, 0.7, pitTop(43.5, 171, 0.55)), conCol(43.5, 173, 0.7, pitTop(43.5, 173, 0.55)), // core-side block pallets — steppable
      conCol(44.9, 176.5, 0.75, pitTop(44.9, 176.5, 0.95)),      // pit dumpy bag — steppable
      conCol(45.5, 177, 0.75, 0.95), conCol(46.5, 175.8, 0.75, 0.95), // dumpy bags — steppable
      conCol(38, 188, 1.1),                                      // rebar cage
      conCol(41, 175.5, 1.1),                                    // core-pour rebar cage
      conCol(37.5, 169, 0.7),                                    // staged formwork run
      conCol(46.5, 175.5, 0.7), conCol(46.5, 179.5, 0.7),        // formwork runs
      conCol(44.5, 169.5, 1.1), conCol(21.5, 182, 0.6),          // cement mixer stand + compactor plate
      conCol(54.5, 168, 1.7, 1.45),                              // skip — hop on the rim
      conCol(46, 147, 0.8), conCol(44, 147, 0.8),                // loos
      conCol(41.5, 149, 1.2), conCol(47, 156, 1.0),              // smoking shelter + tool vault
      conCol(54.5, 158, 1.2), conCol(12.5, 150.5, 0.9), conCol(48, 162, 0.9), // generator + light towers
      conCol(55.5, 155.5, 1.3), conCol(16, 152.5, 1.6),          // air compressor + water bowser
      conCol(14.5, 160, 0.6), conCol(44, 196.5, 0.6), conCol(20, 196.5, 0.55), conCol(48, 196.5, 0.55), // boards + lights
      conCol(13, 165.5, 0.35), conCol(7.5, 173, 0.35),           // new cones
      conCol(10.4, 166.6, 0.35),                                 // gate-sliver cone
    ],
    boxes: [{ x: 50, z: 152, w: 8.4, d: 4.4, h: 3.4 }],          // site cabin (rot −π/2 → length along x)
  };
  for (const b of C.props.crashBarrier!) C.cols.push(conCol(b.x, b.z, 0.5));
  for (const h of C.props.hoarding!) C.cols.push(conCol(h.x, h.z, 0.5));
  for (const f of C.props.meshFence!) C.cols.push(conCol(f.x, f.z, 0.45));

  /* 🕳️ pit-floor grounding pass — anything PLACED INSIDE a dig (negative y
   *  means "on the pit floor") sits at −digDown(x,z) so machines, trench
   *  props, spoil heaps and crew follow the real dirt profile. The hardcoded
   *  floor depths (−3 / −4.3 / −2.7) are only exact on the FLAT bottom: a
   *  machine parked one metre onto a terrace was buried to its cab, and the
   *  site dumper south of pit B actually stood 4.3 m UNDER the yard. The
   *  rising-structure kinds are EXEMPT — their lower lifts carry structural
   *  offsets (site B's second storey rides −1.2 above its −4.3 base), and
   *  storeys above grade keep their positive offsets either way. */
  const GROUNDED_KINDS = new Set<string>(["steelFrame", "metalDeck", "coreSection"]);
  for (const site of [A, B, C]) {
    for (const [kind, list] of Object.entries(site.props)) {
      if (GROUNDED_KINDS.has(kind)) continue;
      for (const p of list) if (p.y !== undefined && p.y < 0) p.y = -digDown(p.x, p.z);
    }
    for (const c of site.crew ?? []) if (c.y !== undefined && c.y < 0) c.y = -digDown(c.x, c.z);
  }

  return { at: [A, B, C] as ConSiteDef[] };
})();

/** any of the three construction sites (cottage & prop scatter keep-off guard) */
export const inConstructionSite = (x: number, z: number, pad = 0): boolean =>
  SITEKIT.at.some((s) => Math.hypot(x - s.cx, z - s.cz) < 34 + pad);

/* ---------------- 🏥 St. Cross Medical Campus — polyfork Hospital Kit ----------------
 * The hospital block (grid roads x=67.5/135 & z=67.5/135) grew from one white
 * box into a REAL hospital campus built from the hospital-kit-2ebfcb GLB set
 * (see hospitalModels.ts / <HospitalCampus>): the 3-storey ward block with a
 * rooftop helipad + air-ambulance helicopter, an emergency-entrance block with
 * an ambulance bay, a clinic annexe, entrance canopy, wayfinding totem, paved
 * plaza, mesh-fence perimeter with a gated drive, hedges, bollards, generator,
 * gas cylinders, waste bins, wheelchairs — plus kit staff idling out front.
 * Every position derives from HOSPITAL so colliders + rendering stay in
 * lock-step. Kit convention: models face +z at rot 0 (rot = atan2(dx, dz)
 * points the authored front toward (dx, dz)).                                  */
export const HOSPKIT = (() => {
  const { x: hx } = HOSPITAL;
  // the campus fills the block interior; the fence ring + its gate span
  const FENCE = { x0: 79, x1: 123.5, z0: 79, z1: 124.5 };
  const GATE = { x0: hx - 4.05, x1: hx + 4.05 };                 // gate span on the north edge (drive side)
  // the asphalt drive: south road edge (z≈74.4) up to the plaza
  const drive = { x: hx, z0: 74, z1: 88.8, w: 6.2 };
  // buildings — ward block fronts the plaza (rot π → authored +z front faces north)
  const ward = { x: hx, z: 112, rot: Math.PI, w: 6, d: 4, h: 9.85 };
  const core = { x: 109.3, z: ward.z, rot: Math.PI, w: 2, d: 2, h: 10.35 };  // stair & lift core hugs the ward's east wall
  const annexe = { x: 85, z: 100, rot: Math.PI / 2, w: 3, d: 4, h: 3 };      // clinic annexe, doors east toward the plaza
  const er = { x: 117, z: 92, rot: -Math.PI / 2, w: 3, d: 6, h: 3.45 };      // emergency block, garage doors face the forecourt (west)
  const canopy = { x: hx, z: 105.2, rot: Math.PI };                          // entrance canopy over the ward doors
  // rooftop helipad — deck on the ward roof, air ambulance parked on top
  const DECK_S = 0.62, HELI_S = 0.45;
  const deckY = ward.h;                                      // deck legs stand on the roof slab
  const padTop = ward.h + 3.0 * DECK_S;                      // platform surface (authored deck h = 3)
  const deck = { x: hx, z: ward.z, y: deckY, rot: Math.PI / 2, s: DECK_S };
  const heli = { x: hx, z: ward.z, y: padTop, rot: 0, s: HELI_S };
  // ambulances BACKED into the ER bay doors (rear toward the garage, nose west)
  const ambulances = [
    { x: 111, z: 89.5, rot: -Math.PI / 2 },
    { x: 111, z: 93.5, rot: -Math.PI / 2 },
  ];
  // plaza + ER bay apron paving (2×2 kit tiles, baked into one mesh). The bay
  // apron strip runs from the plaza's east edge to the ER doors so the
  // ambulances park ON tiles; hatching decals ride 5mm above the tile tops.
  // Tiles bake 12mm above the lawn plane (y=0.05) so the slab never sinks
  // under it; stripes ride on the drive asphalt (y=0.061).
  const PAVING_Y = 0.062, STRIPE_Y = 0.07;
  const paving: { x: number; z: number; y: number }[] = [];
  for (let cx = 93.5; cx <= 105.5; cx += 2) for (let cz = 89.5; cz <= 99.5; cz += 2) paving.push({ x: cx, z: cz, y: PAVING_Y });
  for (let cx = 108.5; cx <= 112.5; cx += 2) for (let cz = 87.5; cz <= 95.5; cz += 2) paving.push({ x: cx, z: cz, y: PAVING_Y });
  // lane stripes down the drive centre
  const stripes: { x: number; z: number; y: number }[] = [];
  for (let sz = 75.2; sz <= 85.2; sz += 2) stripes.push({ x: hx, z: sz, y: STRIPE_Y });
  // ambulance-bay hatching: two bays + apron wings, over the bay tiles
  const BAY_DECAL_Y = 0.115;
  const bayDecals = [
    { x: 112.8, z: 89.5, y: BAY_DECAL_Y }, { x: 112.8, z: 93.5, y: BAY_DECAL_Y },
    { x: 112.8, z: 86.9, y: BAY_DECAL_Y }, { x: 112.8, z: 96.1, y: BAY_DECAL_Y },
  ];
  // mesh-fence panels tile the ring; the north edge breaks for the gate
  const fencePanels: { x: number; z: number; rot: number }[] = [];
  const pushEdge = (fixed: "x0" | "x1" | "z0" | "z1", along: "x" | "z") => {
    const a0 = along === "x" ? FENCE.x0 : FENCE.z0;
    const a1 = along === "x" ? FENCE.x1 : FENCE.z1;
    for (let a = a0 + 1; a <= a1 - 1; a += 2) {
      const isNorthGate = fixed === "z0" && a > GATE.x0 - 1 && a < GATE.x1 + 1;
      if (isNorthGate) continue;
      fencePanels.push(along === "x"
        ? { x: a, z: FENCE[fixed], rot: 0 }
        : { x: FENCE[fixed], z: a, rot: Math.PI / 2 });
    }
  };
  pushEdge("x0", "z"); pushEdge("x1", "z"); pushEdge("z0", "x"); pushEdge("z1", "x");
  // solid fence collision ring (2u spacing, gate span stays open)
  const fenceCols: { x: number; z: number }[] = [];
  for (let a = FENCE.x0; a <= FENCE.x1; a += 2) {
    if (!(a > GATE.x0 && a < GATE.x1)) fenceCols.push({ x: a, z: FENCE.z0 });
    fenceCols.push({ x: a, z: FENCE.z1 });
  }
  for (let a = FENCE.z0 + 2; a <= FENCE.z1 - 2; a += 2) {
    fenceCols.push({ x: FENCE.x0, z: a });
    fenceCols.push({ x: FENCE.x1, z: a });
  }
  // gate-marker bollards flank the drive opening
  const gateBollards = [{ x: GATE.x0 + 0.3, z: FENCE.z0 }, { x: GATE.x1 - 0.3, z: FENCE.z0 }];
  // drive-edge bollards light the way in
  const bollards: { x: number; z: number }[] = [...gateBollards];
  for (const bx of [hx - 3.35, hx + 3.35]) for (let bz = 75.4; bz <= 83.8; bz += 2.8) bollards.push({ x: bx, z: bz });
  // clipped hedges dress the north lawn (gate span stays open)
  const hedges: { x: number; z: number; rot: number }[] = [];
  for (let a = FENCE.x0 + 2.4; a <= FENCE.x1 - 2.4; a += 2.2) {
    if (a > GATE.x0 - 1.6 && a < GATE.x1 + 1.6) continue;
    hedges.push({ x: a, z: FENCE.z0 + 1.3, rot: 0 });
  }
  hedges.push({ x: hx - 5.4, z: 82.4, rot: 0 }, { x: hx + 5.4, z: 82.4, rot: 0 }); // flanking the drive inside the gate
  // back-of-house: standby generator + medical gas cylinders + waste bins
  const generator = { x: 99, z: 120.6, rot: Math.PI / 2 };
  const gasCylinders = [{ x: 104.2, z: 120.2, rot: 0.4 }, { x: 105.1, z: 121.1, rot: 1.6 }, { x: 104.5, z: 119.3, rot: 2.6 }];
  const bins = [{ x: 110.6, z: 118.4, rot: 0.3 }, { x: 111.4, z: 119.2, rot: -0.2 }, { x: 81.4, z: 103, rot: 1.1 }];
  // wayfinding totem by the gate, wheelchairs parked at the doors, wet sign at the ER
  const totem = { x: 96.6, z: 81.2, rot: 0.35 };
  const wheelchairs = [{ x: 99.6, z: 106, rot: 0.5 }, { x: 102.9, z: 105.7, rot: -0.8 }, { x: 89.4, z: 95.4, rot: 1.2 }];
  const wetSign = { x: 113.2, z: 91.5, rot: -Math.PI / 2 };
  // the kit crew idles where staff idles — doors, bays and the forecourt
  const staff = [
    { kind: "doctor", x: 100, z: 104.6, rot: Math.PI },          // under the canopy, greeting the plaza
    { kind: "nurse", x: 103.4, z: 99.8, rot: -Math.PI / 2 },     // plaza, facing the doors
    { kind: "paramedic", x: 108.6, z: 91.6, rot: Math.PI / 2 },  // by the ambulances
    { kind: "patient", x: 89.6, z: 99.2, rot: Math.PI / 2 },     // outside the annexe
    { kind: "surgeon", x: 110.8, z: 95.8, rot: Math.PI / 2 },    // ER forecourt
  ] as const;
  // visitor parking along the west fence — cars nose-in perpendicular to the
  // fence (t: vehicle pool index resolved in worldgen)
  const visitorParking = [84.6, 88.8, 93, 97.2].map((z, i) => ({ x: 83.4, z, rot: i % 2 ? Math.PI : 0 }));
  // plaza lawn lamps (pushLamp refuses road positions; these are deep in-block)
  const lamps = [{ x: 91.8, z: 85.4 }, { x: 111.2, z: 85.4 }, { x: 96.2, z: 77.6 }, { x: 106.3, z: 77.6 }];
  // benches on the plaza lawn edge
  const benches = [{ x: 94.3, z: 92, rot: Math.PI / 2 }, { x: 94.3, z: 96, rot: Math.PI / 2 }];
  // the whole grounds (lawn + drive stub outside the fence) for scatter guards
  const rect = { x0: FENCE.x0 - 0.9, x1: FENCE.x1 + 0.9, z0: FENCE.z0 - 0.9, z1: FENCE.z1 + 0.9 };
  return { FENCE, GATE, drive, ward, core, annexe, er, canopy, deck, heli, padTop, DECK_S, HELI_S, ambulances, paving, stripes, bayDecals, fencePanels, fenceCols, gateBollards, bollards, hedges, generator, gasCylinders, bins, totem, wheelchairs, wetSign, staff, visitorParking, lamps, benches, rect };
})();

/** 🏥 true while (x,z) stands on the medical campus (fence ring + drive stub).
 *  Wild scatter, fringe cottages and wildflower patches all keep off the plot. */
export function inHospitalCampus(x: number, z: number, pad = 0): boolean {
  const r = HOSPKIT.rect;
  if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
  // the drive stub south of the fence down to the road kerb
  const d = HOSPKIT.drive;
  return Math.abs(x - d.x) < d.w / 2 + pad && z > 71 && z < d.z1 + pad;
}

/** 🪦 distance from (x,z) to the cemetery access corridor — the dirt lane
 *  (road end → arched gate) plus the visitor path (gate → grounds centre).
 *  Every wild scatter (trees, boulders, rocks, ferns, camps, ponds, trails…)
 *  keeps OFF this strip so the drive out to the graveyard stays open.       */
export function graveyardLaneDist(x: number, z: number): number {
  const { ax, az, gate } = GRAVEKIT;
  let best = Infinity;
  const segs: [number, number, number, number][] = [
    [ax, az, gate.x, gate.z],
    [gate.x, gate.z, GRAVEYARD.x, GRAVEYARD.z],
  ];
  for (const [x0, z0, x1, z1] of segs) {
    const vx = x1 - x0, vz = z1 - z0;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - (x0 + vx * t), z - (z0 + vz * t)));
  }
  return best;
}

/* ---------------- 🏙️ CITY KIT — the empty plots grow real buildings ----------------
 * Every one of the city's vacant blocks is filled from the polyfork catalog
 * (https://github.com/lucas-martinic/polyfork-catalog · models/buildings.md,
 * CC BY 4.0 — files in public/models/city/, loader in cityModels.ts): five
 * themed districts — Civic squares (NYC kit), Little Tokyo, a Mediterranean
 * plaza, a Frontier Town corner and brownstone/tenement/loft rows — plus
 * suburban house rows, the downtown skyline upgrade (art-deco + office GLB
 * towers) and two blocks of real kit houses replacing the plain box homes.
 *
 * Each entry is ONE building: render placement (slug, x, z, rot, s) + its
 * collider box (w/d = half extents, h = roof height, top = standable y —
 * pitched roofs stand ~55-80% up the rise, flat roofs at the slab). `col`
 * adds extra collider boxes (the art-deco tower's base skirt). The renderer
 * (<CityDistricts> in WorldView) streams the GLBs; worldgen bakes the boxes
 * so the roofs are standable from day one — skydive onto the bank and STAND.
 * Facades are authored facing +Z, so rot 0 faces south, π north, ±π/2 east/west. */
export interface CityGlm {
  /** cityModels.ts FILES key */
  slug: string;
  x: number; z: number;
  /** rotation-y (radians) + uniform scale (model is grounded & centred by the loader) */
  rot: number; s: number;
  /** collider half-extents + height (the roof y) — optional standable top override */
  w: number; d: number; h: number; top?: number;
  /** extra collider boxes — tower base skirts etc. (offsets from x/z) */
  col?: { dx: number; dz: number; w: number; d: number; h: number }[];
}
export const CITYKIT = {
  at: [
    /* ---- Civic Square East (-101.25, -168.75) — bank, church, clock tower ---- */
    { slug: "classicalBank", x: -106.25, z: -175.75, rot: 0, s: 1.2, w: 7.2, d: 7.2, h: 12.2 },
    { slug: "brickChurch", x: -88.25, z: -165.75, rot: Math.PI / 2, s: 1.1, w: 6.6, d: 4.4, h: 18, top: 14.5 },
    { slug: "clockTower", x: -106.25, z: -156.75, rot: 0, s: 1.7, w: 2.6, d: 2.6, h: 21.8, top: 20.5 },
    { slug: "newsstand", x: -91.25, z: -154.75, rot: -Math.PI / 2, s: 1.6, w: 2, d: 1.4, h: 3.7 },
    /* ---- Civic Square West (101.25, -168.75) — department store & movie night ---- */
    { slug: "departmentStore", x: 94.25, z: -176.75, rot: 0, s: 1.1, w: 8.8, d: 7, h: 25.4 },
    { slug: "movieTheater", x: 113.25, z: -160.75, rot: Math.PI, s: 1.2, w: 7.2, d: 4.8, h: 15.6 },
    { slug: "streetDiner", x: 115.25, z: -180.75, rot: -Math.PI / 2, s: 1.4, w: 2.8, d: 5.6, h: 7.6 },
    { slug: "newsstand", x: 85.25, z: -156.75, rot: 0, s: 1.6, w: 2, d: 1.4, h: 3.7 },
    { slug: "subway", x: 101.25, z: -153.75, rot: Math.PI, s: 1.5, w: 3, d: 3, h: 7.7 },
    /* ---- Little Tokyo North (-236.25, -101.25) — apartment over the shophouses ---- */
    { slug: "tokyoApartment", x: -236.25, z: -114.25, rot: 0, s: 1.2, w: 7.2, d: 2.4, h: 11.3 },
    { slug: "bathhouse", x: -248.25, z: -94.25, rot: Math.PI, s: 1.1, w: 4.4, d: 4.4, h: 12.1 },
    { slug: "cornerShophouse", x: -233.25, z: -92.25, rot: Math.PI, s: 1.4, w: 2.8, d: 2.8, h: 13.3 },
    { slug: "shophouse3", x: -225.25, z: -92.25, rot: Math.PI, s: 1.4, w: 2.8, d: 2.8, h: 13.2 },
    { slug: "shophouse2", x: -219.25, z: -92.25, rot: Math.PI, s: 1.4, w: 2.8, d: 2.8, h: 10.7 },
    /* ---- Little Tokyo South (-168.75, -101.25) — shrine court & bar alley ---- */
    { slug: "shrineHall", x: -170.75, z: -108.25, rot: 0, s: 1.9, w: 3.8, d: 3.8, h: 6.8 },
    { slug: "alleyBarHut", x: -182.75, z: -114.25, rot: Math.PI / 2, s: 1.5, w: 3, d: 3, h: 5 },
    { slug: "alleyBarHut", x: -156.75, z: -114.25, rot: -Math.PI / 2, s: 1.5, w: 3, d: 3, h: 5 },
    { slug: "amusementParlour", x: -158.75, z: -93.25, rot: Math.PI, s: 1.3, w: 5.2, d: 2.6, h: 12.2 },
    { slug: "convenienceStore", x: -179.75, z: -91.25, rot: Math.PI, s: 1.5, w: 6, d: 3, h: 5.1 },
    { slug: "shophouseWide", x: -166.75, z: -88.25, rot: Math.PI, s: 1.2, w: 4.8, d: 2.4, h: 9.9 },
    /* ---- Mediterranean Plaza (-101.25, -101.25) — whitewash & domes ---- */
    { slug: "domedChurch", x: -101.25, z: -110.25, rot: 0, s: 1.2, w: 4.8, d: 7.2, h: 12.7, top: 11.5 },
    { slug: "bellTower", x: -113.25, z: -103.25, rot: 0, s: 1.6, w: 3.2, d: 3.2, h: 15.8, top: 14.5 },
    { slug: "blueChapel", x: -89.25, z: -103.25, rot: -Math.PI / 2, s: 1.3, w: 5.2, d: 2.6, h: 8.5, top: 7.3 },
    { slug: "kafeneio", x: -105.25, z: -89.25, rot: Math.PI, s: 1.6, w: 6.4, d: 3.2, h: 4.8 },
    { slug: "villageShop", x: -96.25, z: -88.25, rot: Math.PI, s: 1.5, w: 3, d: 3.3, h: 4.5 },
    { slug: "cubeHouse", x: -88.25, z: -89.25, rot: Math.PI, s: 1.6, w: 3.2, d: 3.2, h: 4.8 },
    { slug: "dovecote", x: -85.25, z: -113.25, rot: 0, s: 1.7, w: 3.4, d: 3.4, h: 11.8, top: 10.6 },
    { slug: "archPassage", x: -115.25, z: -97.25, rot: Math.PI / 2, s: 1.7, w: 0.4, d: 0.4, h: 5.1 },
    /* ---- Frontier Town (-168.75, -33.75) — the old west corner ---- */
    { slug: "saloon", x: -180.75, z: -30.75, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 7.2 },
    { slug: "generalStore", x: -168.75, z: -29.75, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 7.2 },
    { slug: "frontierHotel", x: -155.75, z: -31.75, rot: Math.PI, s: 1.2, w: 3.6, d: 6, h: 8.8 },
    { slug: "barberBath", x: -181.75, z: -42.75, rot: 0, s: 1.2, w: 2.4, d: 4.8, h: 6.8 },
    { slug: "blacksmith", x: -171.75, z: -42.75, rot: 0, s: 1.2, w: 3.6, d: 3.6, h: 7.4 },
    { slug: "telegraphOffice", x: -164.75, z: -43.75, rot: 0, s: 1.2, w: 2.4, d: 3.6, h: 7.8 },
    { slug: "clapboardChurch", x: -156.75, z: -44.75, rot: 0, s: 1.1, w: 3.3, d: 5.5, h: 11, top: 8.8 },
    { slug: "undertaker", x: -185.75, z: -50.75, rot: 0, s: 1.2, w: 2.4, d: 4.8, h: 6.6 },
    { slug: "liveryStable", x: -155.75, z: -20.75, rot: Math.PI, s: 1.1, w: 4.4, d: 5.5, h: 7.5, top: 6 },
    /* ---- Brownstone Row North (-236.25, 33.75) ---- */
    { slug: "brownstoneRowHouse", x: -250.25, z: 24.75, rot: 0, s: 1.1, w: 4.4, d: 4.4, h: 18.8 },
    { slug: "brownstoneRowHouse", x: -236.25, z: 24.75, rot: 0, s: 1.1, w: 4.4, d: 4.4, h: 18.8 },
    { slug: "brownstoneRowHouse", x: -222.25, z: 24.75, rot: 0, s: 1.1, w: 4.4, d: 4.4, h: 18.8 },
    { slug: "brickTenement", x: -245.25, z: 43.75, rot: Math.PI, s: 1.1, w: 4.4, d: 5.1, h: 25.4 },
    { slug: "brickTenement", x: -229.25, z: 43.75, rot: Math.PI, s: 1.1, w: 4.4, d: 5.1, h: 25.4 },
    { slug: "narrowWalkUp", x: -220.25, z: 42.75, rot: Math.PI, s: 1.1, w: 2.2, d: 5.2, h: 14.3 },
    /* ---- Eastside Heights (236.25, 33.75) — the postwar slab anchors the east ---- */
    { slug: "postwarSlab", x: 230.25, z: 42.75, rot: Math.PI, s: 1.05, w: 8.4, d: 6.3, h: 52.6 },
    { slug: "brownstoneRowHouse", x: 223.25, z: 22.75, rot: 0, s: 1.1, w: 4.4, d: 4.4, h: 18.8 },
    { slug: "narrowWalkUp", x: 237.25, z: 22.75, rot: 0, s: 1.1, w: 2.2, d: 5.2, h: 14.3 },
    { slug: "castIronLoft", x: 250.25, z: 24.75, rot: 0, s: 1.1, w: 6.6, d: 4.9, h: 22.1 },
    { slug: "parkingGarage", x: 249.25, z: 43.75, rot: Math.PI, s: 1.05, w: 6.3, d: 6.3, h: 17.9 },
    /* ---- University Green (-168.75, 101.25) — school, clock tower, services ---- */
    { slug: "publicSchool", x: -168.75, z: 92.25, rot: 0, s: 1.05, w: 10.5, d: 6.3, h: 13.9 },
    { slug: "clockTower", x: -168.75, z: 112.25, rot: 0, s: 2.2, w: 3.3, d: 3.3, h: 28.2, top: 26.5 },
    { slug: "fireStation", x: -182.75, z: 112.25, rot: Math.PI, s: 1.1, w: 4.4, d: 4.4, h: 7.7 },
    { slug: "newsstand", x: -154.75, z: 114.25, rot: Math.PI / 2, s: 1.5, w: 1.9, d: 1.3, h: 3.5 },
    /* ---- Loft District (-101.25, 168.75) ---- */
    { slug: "castIronLoft", x: -109.25, z: 159.75, rot: 0, s: 1.1, w: 6.6, d: 4.9, h: 22.1 },
    { slug: "autoRepair", x: -91.25, z: 160.75, rot: 0, s: 1.1, w: 6.6, d: 4.4, h: 7.9 },
    { slug: "fireStation", x: -111.25, z: 177.75, rot: Math.PI, s: 1.15, w: 4.6, d: 4.6, h: 8.1 },
    { slug: "cornerShop", x: -92.25, z: 178.75, rot: Math.PI, s: 1.1, w: 4.9, d: 4.9, h: 7.7 },
    { slug: "newsstand", x: -100.25, z: 153.75, rot: Math.PI / 2, s: 1.6, w: 2, d: 1.4, h: 3.7 },
    /* ---- Tenement Row (101.25, 168.75) ---- */
    { slug: "cornerTenement", x: 90.25, z: 166.75, rot: -Math.PI / 2, s: 1.1, w: 7.3, d: 4.8, h: 22.1 },
    { slug: "brickTenement", x: 109.25, z: 159.75, rot: 0, s: 1.1, w: 4.4, d: 5.1, h: 25.4 },
    { slug: "brownstoneRowHouse", x: 114.25, z: 178.75, rot: Math.PI, s: 1.1, w: 4.4, d: 4.4, h: 18.8 },
    { slug: "narrowWalkUp", x: 102.25, z: 179.75, rot: Math.PI, s: 1.1, w: 2.2, d: 5.2, h: 14.3 },
    { slug: "streetDiner", x: 93.25, z: 181.75, rot: 0, s: 1.3, w: 5.2, d: 2.6, h: 7.1 },
    /* ---- Market Street (-33.75, 168.75) ---- */
    { slug: "shopRow", x: -42.75, z: 159.75, rot: 0, s: 1.2, w: 7.2, d: 5.4, h: 5.6 },
    { slug: "shophouse2", x: -47.75, z: 177.75, rot: Math.PI, s: 1.4, w: 2.8, d: 2.8, h: 10.7 },
    { slug: "shophouse2", x: -37.75, z: 177.75, rot: Math.PI, s: 1.4, w: 2.8, d: 2.8, h: 10.7 },
    { slug: "shophouse3", x: -27.75, z: 177.75, rot: Math.PI, s: 1.4, w: 2.8, d: 2.8, h: 13.2 },
    { slug: "cornerShophouse", x: -18.75, z: 166.75, rot: -Math.PI / 2, s: 1.4, w: 2.8, d: 2.8, h: 13.3 },
    { slug: "shophouseWide", x: -19.75, z: 179.75, rot: Math.PI, s: 1.2, w: 4.8, d: 2.4, h: 9.9 },
    { slug: "newsstand", x: -31.75, z: 153.75, rot: Math.PI / 2, s: 1.5, w: 1.9, d: 1.3, h: 3.5 },
    /* ---- Orchard Row (-101.25, 236.25) — suburban kit houses ---- */
    { slug: "aFrameCabin", x: -115.25, z: 224.25, rot: 0, s: 1.2, w: 2.4, d: 4.8, h: 7.4, top: 4.4 },
    { slug: "alpineChalet", x: -99.25, z: 225.25, rot: 0, s: 1.1, w: 5.5, d: 4.4, h: 8.2, top: 6.2 },
    { slug: "gabledFarmhouse", x: -87.25, z: 226.25, rot: 0, s: 1.3, w: 3.9, d: 3.3, h: 8.1, top: 6.1 },
    { slug: "colonialHouse", x: -113.25, z: 246.25, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 10.2, top: 8.2 },
    { slug: "frenchTownhouse", x: -98.25, z: 247.25, rot: Math.PI, s: 1.1, w: 5.4, d: 4.1, h: 11.8, top: 10.6 },
    { slug: "aFrameCabin", x: -87.25, z: 246.25, rot: Math.PI, s: 1.2, w: 2.4, d: 4.8, h: 7.4, top: 4.4 },
    /* ---- Hacienda Row (-33.75, 236.25) ---- */
    { slug: "adobeFarmhouse", x: -43.75, z: 226.25, rot: 0, s: 0.85, w: 6.8, d: 3.4, h: 4.6, top: 3.9 },
    { slug: "adobeFarmhouse", x: -24.75, z: 226.25, rot: 0, s: 0.85, w: 6.8, d: 3.4, h: 4.6, top: 3.9 },
    { slug: "colonialHouse", x: -45.75, z: 245.25, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 10.2, top: 8.2 },
    { slug: "gabledFarmhouse", x: -33.75, z: 246.25, rot: Math.PI, s: 1.3, w: 3.9, d: 3.3, h: 8.1, top: 6.1 },
    { slug: "colonialHouse", x: -22.75, z: 246.25, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 10.2, top: 8.2 },
    /* ---- Lakeside Cabins (33.75, -236.25) ---- */
    { slug: "aFrameCabin", x: 20.75, z: -246.25, rot: 0, s: 1.25, w: 2.5, d: 5, h: 7.7, top: 4.6 },
    { slug: "aFrameCabin", x: 32.75, z: -246.25, rot: 0, s: 1.25, w: 2.5, d: 5, h: 7.7, top: 4.6 },
    { slug: "alpineChalet", x: 45.75, z: -245.25, rot: 0, s: 1.1, w: 5.5, d: 4.4, h: 8.2, top: 6.2 },
    { slug: "gabledFarmhouse", x: 25.75, z: -225.25, rot: Math.PI, s: 1.3, w: 3.9, d: 3.3, h: 8.1, top: 6.1 },
    { slug: "colonialHouse", x: 39.75, z: -225.25, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 10.2, top: 8.2 },
    /* ---- NW Homestead (-236.25, 236.25) ---- */
    { slug: "liveryStable", x: -248.25, z: 228.25, rot: 0, s: 1.1, w: 4.4, d: 5.5, h: 7.5, top: 6 },
    { slug: "gabledFarmhouse", x: -232.25, z: 225.25, rot: 0, s: 1.3, w: 3.9, d: 3.3, h: 8.1, top: 6.1 },
    { slug: "alpineChalet", x: -224.25, z: 245.25, rot: Math.PI, s: 1.1, w: 5.5, d: 4.4, h: 8.2, top: 6.2 },
    { slug: "aFrameCabin", x: -239.25, z: 247.25, rot: Math.PI, s: 1.2, w: 2.4, d: 4.8, h: 7.4, top: 4.4 },
    /* ---- 🌆 DOWNTOWN SKYLINE UPGRADE — the plain box towers grow real faces ----
     * The two downtown blocks (33.75,-33.75) & (-33.75,33.75) swap their four
     * procedural towers each for the art-deco setback tower (60u — the new
     * city landmark) and the glass office tower. Base skirts are separate
     * colliders so skydivers settle on the setback tiers instead of clipping. */
    { slug: "artDecoTower", x: 46.25, z: -21.25, rot: 0, s: 1, w: 6.5, d: 6.5, h: 60, col: [{ dx: 0, dz: 0, w: 8, d: 8, h: 18 }] },
    { slug: "artDecoTower", x: 21.25, z: -46.25, rot: Math.PI, s: 1, w: 6.5, d: 6.5, h: 60, col: [{ dx: 0, dz: 0, w: 8, d: 8, h: 18 }] },
    { slug: "officeTower", x: 46.25, z: -46.25, rot: Math.PI, s: 1.3, w: 5.2, d: 5.2, h: 41.7 },
    { slug: "officeTower", x: 21.25, z: -21.25, rot: 0, s: 1.3, w: 5.2, d: 5.2, h: 41.7 },
    { slug: "artDecoTower", x: -46.25, z: 21.25, rot: Math.PI / 2, s: 1, w: 6.5, d: 6.5, h: 60, col: [{ dx: 0, dz: 0, w: 8, d: 8, h: 18 }] },
    { slug: "artDecoTower", x: -21.25, z: 46.25, rot: -Math.PI / 2, s: 1, w: 6.5, d: 6.5, h: 60, col: [{ dx: 0, dz: 0, w: 8, d: 8, h: 18 }] },
    { slug: "officeTower", x: -46.25, z: 46.25, rot: Math.PI, s: 1.3, w: 5.2, d: 5.2, h: 41.7 },
    { slug: "officeTower", x: -21.25, z: 21.25, rot: 0, s: 1.3, w: 5.2, d: 5.2, h: 41.7 },
    /* ---- 🏡 suburb home upgrade — two blocks of real kit houses ---- */
    { slug: "frenchTownhouse", x: -118.75, z: 92.5, rot: Math.PI, s: 1.05, w: 5.1, d: 3.8, h: 11.1, top: 10 },
    { slug: "colonialHouse", x: -101.25, z: 92.5, rot: Math.PI, s: 1.2, w: 3.6, d: 4.8, h: 10.2, top: 8.2 },
    { slug: "alpineChalet", x: -83.75, z: 92.5, rot: Math.PI, s: 1.05, w: 5.3, d: 4.4, h: 7.8, top: 5.9 },
    { slug: "gabledFarmhouse", x: -118.75, z: 110, rot: Math.PI, s: 1.3, w: 3.9, d: 3.3, h: 8.1, top: 6.1 },
    { slug: "aFrameCabin", x: -101.25, z: 110, rot: Math.PI, s: 1.2, w: 2.4, d: 4.8, h: 7.4, top: 4.4 },
    { slug: "colonialHouse", x: -83.75, z: 110, rot: Math.PI, s: 1.15, w: 3.5, d: 4.6, h: 9.8, top: 7.9 },
    { slug: "aFrameCabin", x: 16.25, z: -110, rot: 0, s: 1.2, w: 2.4, d: 4.8, h: 7.4, top: 4.4 },
    { slug: "alpineChalet", x: 33.75, z: -110, rot: 0, s: 1.1, w: 5.5, d: 4.4, h: 8.2, top: 6.2 },
    { slug: "gabledFarmhouse", x: 51.25, z: -110, rot: 0, s: 1.3, w: 3.9, d: 3.3, h: 8.1, top: 6.1 },
    { slug: "frenchTownhouse", x: 16.25, z: -92.5, rot: 0, s: 1.05, w: 5.1, d: 3.8, h: 11.1, top: 10 },
    { slug: "colonialHouse", x: 33.75, z: -92.5, rot: 0, s: 1.2, w: 3.6, d: 4.8, h: 10.2, top: 8.2 },
    { slug: "aFrameCabin", x: 51.25, z: -92.5, rot: 0, s: 1.15, w: 2.3, d: 4.6, h: 7.1, top: 4.2 },
  ] as CityGlm[],
  /** True when (x,z) sits on/near any kit building (pad in world units) —
   *  fringe cottages, wildflower patches & floor scatter all keep off. */
  hit(x: number, z: number, pad = 0): boolean {
    for (const g of this.at) {
      if (Math.abs(x - g.x) < g.w + pad && Math.abs(z - g.z) < g.d + pad) return true;
      if (g.col) for (const c of g.col) if (Math.abs(x - (g.x + c.dx)) < c.w + pad && Math.abs(z - (g.z + c.dz)) < c.d + pad) return true;
    }
    return false;
  },
};

const TOWER_ROOF = 0x3d434c;
const OFFICE_COLS = [0xe0c9a0, 0xc9b8a0, 0xd8d2c4, 0xbfae94, 0xc4cec4, 0xd0c0b0];
const SHOP_COLS = [0xf4a261, 0xe76f51, 0x2a9d8f, 0xf7b2bd, 0xffb4a2, 0xe9c46a, 0x8ecae6, 0xcdb4db];
const AWN_COLS = [0xd62828, 0x2a6f4f, 0xe07b39, 0x7a3b8f, 0x1d7a8f, 0xb03030];
const HOME_COLS = [0xf2e3c6, 0xf7d9c4, 0xd9e8dd, 0xe8d0e8, 0xfdf0d5, 0xd8e4f0, 0xf5c9b8, 0xe4efd9];
const HOME_ROOFS = [0xc0392b, 0x8a5a44, 0x457b9d, 0x588157, 0xb0553a, 0x6d4a7a];
const CAR_COLS = [0xe0483a, 0x2a9d8f, 0xf0c040, 0xf2f2f2, 0x8a5aa8, 0xff8c42, 0x4aa3df, 0x67b05f];
const CROP_COLS = [0x9ec24a, 0xd8c25a, 0x6faf4e];

export function generateWorld(seed = WORLD_SEED): World {
  const rnd = mulberry32(seed);
  const buildings: Building[] = [];
  const benches: Bench[] = [];
  const umbrellas: Umbrella[] = [];
  const lamps: Lamp[] = [];
  const cars: Car[] = [];
  const push = (
    x: number, z: number, w: number, d: number, h: number,
    kind: Building["kind"], color: number, roof: number, awn = 0, fz: 1 | -1 = 1,
  ) => buildings.push({ x, z, w, d, h, color, roof, kind, awn, fz });
  /** Every street lamp goes through here — a pole standing IN the tarmac blocks
   *  the chase camera dead-centre and reads as "my car vanished, only a shadow!".
   *  Lamps that would land on a road are simply not planted. */
  const pushLamp = (x: number, z: number) => {
    if (Math.abs(x) < 12.9 && z > MAIN_ROAD.z0 - 4 && z < MAIN_ROAD.z1 + 4) return; // 24-wide main road
    for (const o of ROADS) if (Math.abs(x - o) < 8.2 || Math.abs(z - o) < 8.2) return; // 14-wide grid roads
    lamps.push({ x, z });
  };

  /* ---- downtown towers — ✨ CITY KIT UPGRADE: the two downtown blocks now
   *  render REAL polyfork towers (art-deco setback + glass office) straight
   *  from <CityDistricts>; their standable colliders bake from CITYKIT below.
   *  (the old procedural box towers are gone — TOWER_COLS stays for the
   *  remaining midtown offices.) */

  /* ---- shopping streets (3 blocks, 5 shops facing the road + plaza) ---- */
  const SHOP_BLOCKS = [[101.25, -33.75], [33.75, 101.25], [-101.25, 33.75]] as const;
  for (let si = 0; si < SHOP_BLOCKS.length; si++) {
    const [bx, bz] = SHOP_BLOCKS[si];
    for (let i = 0; i < 5; i++) {
      const c = SHOP_COLS[(buildings.length + i) % SHOP_COLS.length];
      push(bx + (i - 2) * 11.5, bz + 21.5, 5.2, 3.6, range(rnd, 7, 9.2), 1, c,
        AWN_COLS[(i + si) % AWN_COLS.length], AWN_COLS[(i + si + 2) % AWN_COLS.length], 1);
      benches.push({ x: bx + (i - 2) * 11.5 + 4.5, z: bz + 13, rot: 0 });
    }
    umbrellas.push({ x: bx - 8, z: bz - 4, c: si % 2 }, { x: bx + 8, z: bz - 4, c: (si + 1) % 2 });
    // two small offices at the back of the block
    push(bx - 13, bz - 16, 6.5, 5, range(rnd, 12, 17), 0, OFFICE_COLS[buildings.length % OFFICE_COLS.length], TOWER_ROOF);
    push(bx + 13, bz - 16, 6.5, 5, range(rnd, 12, 17), 0, OFFICE_COLS[buildings.length % OFFICE_COLS.length], TOWER_ROOF);
    pushLamp(bx - 27.5, bz + 27.5); pushLamp(bx + 27.5, bz - 27.5);
  }

  /* ---- midtown mixed blocks (offices / shops / homes) ---- */
  const MIXED = [[-101.25, -33.75], [101.25, 33.75], [-33.75, -101.25], [101.25, -101.25]] as const;
  for (const [bx, bz] of MIXED) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const lx = bx + (i - 1) * 17, lz = bz + (j - 0.5) * 17.5;
      const roll = rnd();
      if (roll < 0.45) {
        push(lx, lz, 6.5, 5.5, range(rnd, 13, 23), 0, OFFICE_COLS[buildings.length % OFFICE_COLS.length], TOWER_ROOF);
      } else if (roll < 0.78) {
        const fz: 1 | -1 = j === 0 ? -1 : 1;
        push(lx, lz, 5.5, 4, range(rnd, 7.2, 9), 1, SHOP_COLS[buildings.length % SHOP_COLS.length],
          TOWER_ROOF, AWN_COLS[buildings.length % AWN_COLS.length], fz);
      } else {
        push(lx, lz, 4.4, 3.8, range(rnd, 5.2, 6.4), 2, HOME_COLS[buildings.length % HOME_COLS.length],
          HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, lz > bz ? 1 : -1);
      }
    }
  }

  /* ---- suburb home blocks (5 blocks × 6 homes with yards) ---- */
  // NOTE: [±101.25,-101.25] used to appear here AND in the mixed list — 12 overlapping
  // buildings in one block. Fixed by giving those blocks to mixed only and adding
  // three brand-new home blocks (city is bigger now).
  // 🏡 [-101.25,101.25] & [33.75,-101.25] upgraded to real CITY KIT houses
  // (CITYKIT renders them + bakes their colliders) — the other three blocks
  // keep their procedural homes (hospital / school / mall share those blocks).
  const HOME_BLOCKS = [[101.25, 101.25], [-33.75, 101.25], [33.75, 33.75]] as const;
  for (const [bx, bz] of HOME_BLOCKS) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const fz: 1 | -1 = bz < 0 ? 1 : -1;
      const hx2 = bx + (i - 1) * 17.5, hz2 = bz + (j - 0.5) * 17.5;
      // 🏥 the [101.25, 101.25] block belongs to St. Cross Medical Campus now
      if (inHospitalCampus(hx2, hz2, 3)) continue;
      push(hx2, hz2, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
        HOME_COLS[buildings.length % HOME_COLS.length],
        HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, fz);
    }
  }

  /* ---- grand central vista + full museum district ----
   * Built BEFORE the fringe cottages so cottages never spawn on these plots.
   * Fills the grounds around the CITY MUSEUM rotunda: gallery row, flank
   * offices, a vista mall, shop arcades and annexe homes. */
  const SANDSTONE = 0xd8c8a4;
  // North Gallery / South Gallery style offices flanking the vista
  push(-28, -170, 11, 16, 13, 0, SANDSTONE, TOWER_ROOF);
  push(28, -170, 11, 16, 13, 0, SANDSTONE, TOWER_ROOF);
  // second gallery row beside the podium — a classical ring around the rotunda
  push(-33, -194, 11, 14, 12, 0, SANDSTONE, TOWER_ROOF);
  push(33, -194, 11, 14, 12, 0, SANDSTONE, TOWER_ROOF);
  // outer flank offices
  push(-46, -192, 11, 14, 13, 0, SANDSTONE, TOWER_ROOF);
  push(46, -192, 11, 14, 13, 0, SANDSTONE, TOWER_ROOF);
  // vista mall (west of the rotunda) + city gallery (east)
  push(-52, -176, 14, 11, 14, 3, 0xe8e4da, 0x9aa5b1);
  push(52, -174, 14, 11, 12, 0, SANDSTONE, TOWER_ROOF);
  // shop arcades facing the vista court (east + west of the gate)
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      push(side * (20 + i * 10.5), -146 - i * 2, 5.2, 3.6, range(rnd, 7, 9.2), 1,
        SHOP_COLS[buildings.length % SHOP_COLS.length],
        AWN_COLS[(buildings.length + 1) % AWN_COLS.length],
        AWN_COLS[(buildings.length + 3) % AWN_COLS.length], -1);
    }
  }
  // benches on the mall/museum forecourt
  benches.push({ x: -52, z: -165, rot: 0 }, { x: 52, z: -164, rot: 0 });
  // annexe homes tucked behind the flank offices, inside the ring highway
  for (const side of [-1, 1] as const) {
    push(side * 34, -204, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
      HOME_COLS[buildings.length % HOME_COLS.length],
      HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, -1);
    push(side * 43, -202, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
      HOME_COLS[buildings.length % HOME_COLS.length],
      HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, -1);
  }
  // stone memorial arch legs (the span is drawn by <VistaGate>)
  push(GATE.x - 10.5, GATE.z, 2.6, 2.6, 14, 0, SANDSTONE, TOWER_ROOF);
  push(GATE.x + 10.5, GATE.z, 2.6, 2.6, 14, 0, SANDSTONE, TOWER_ROOF);
  // welcome-banner arch poles over the main road (cloth drawn by <TownBanner>)
  push(TOWN_SQUARE.x - 13.5, TOWN_SQUARE.z, 1.5, 1.5, 10.5, 0, 0x8a6b4a, TOWER_ROOF);
  push(TOWN_SQUARE.x + 13.5, TOWN_SQUARE.z, 1.5, 1.5, 10.5, 0, 0x8a6b4a, TOWER_ROOF);

  /* ---- outer suburb home blocks (between the new outer road and the ring highway) ----
   * Pushed BEFORE the fringe cottages so cottages never overlap these plots. */
  /** 🛣️ the ring highway is a ROAD — no block home may stand in its lanes
   *  (the ±236 corner blocks used to drop a cottage right on the ring at
   *  (±253.75, ±245) — dead centre of the tarmac near the airport). */
  const onRingHighway = (x: number, z: number, pad = 9) =>
    Math.abs(Math.hypot(x, z) - RING_R) < RING_W / 2 + pad;
  const OUTER_BLOCKS = [
    [-168.75, -236.25], [168.75, -236.25], [-168.75, 236.25], [168.75, 236.25],
    [-236.25, -168.75], [236.25, -168.75], [-236.25, 168.75], [236.25, 168.75],
  ] as const;
  for (const [bx, bz] of OUTER_BLOCKS) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const hx = bx + (i - 1) * 17.5, hz = bz + (j - 0.5) * 17.5;
      if (onRingHighway(hx, hz)) continue;    // 🛣️ same ring guard (future-proof)
      const fz: 1 | -1 = bz < 0 ? 1 : -1;
      push(hx, hz, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
        HOME_COLS[buildings.length % HOME_COLS.length],
        HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, fz);
    }
  }

  /* ---- new-belt blocks (between the outer road at ±202.5 and the new ±270 roads) ----
   * The 9×9 grid grew two roads per axis — fill the fresh belt with offices, shops
   * and homes so the bigger city feels lived-in, not empty. */
  const BELT_MIXED = [
    [-236.25, -33.75], [236.25, -33.75], [-236.25, 101.25], [236.25, 101.25],
  ] as const;
  for (const [bx, bz] of BELT_MIXED) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const lx = bx + (i - 1) * 17, lz = bz + (j - 0.5) * 17.5;
      const roll = rnd();
      if (roll < 0.45) {
        push(lx, lz, 6.5, 5.5, range(rnd, 13, 23), 0, OFFICE_COLS[buildings.length % OFFICE_COLS.length], TOWER_ROOF);
      } else if (roll < 0.78) {
        const fz: 1 | -1 = j === 0 ? -1 : 1;
        push(lx, lz, 5.5, 4, range(rnd, 7.2, 9), 1, SHOP_COLS[buildings.length % SHOP_COLS.length],
          TOWER_ROOF, AWN_COLS[buildings.length % AWN_COLS.length], fz);
      } else {
        push(lx, lz, 4.4, 3.8, range(rnd, 5.2, 6.4), 2, HOME_COLS[buildings.length % HOME_COLS.length],
          HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, lz > bz ? 1 : -1);
      }
    }
  }
  const BELT_HOMES = [
    [-33.75, -236.25], [33.75, 236.25], [-101.25, -236.25], [101.25, 236.25],
    [-236.25, -236.25], [236.25, 236.25],
  ] as const;
  for (const [bx, bz] of BELT_HOMES) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const hx = bx + (i - 1) * 17.5, hz = bz + (j - 0.5) * 17.5;
      if (onRingHighway(hx, hz)) continue;    // 🛣️ skip homes that would stand in the ring lanes
      const fz: 1 | -1 = bz < 0 ? 1 : -1;
      push(hx, hz, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
        HOME_COLS[buildings.length % HOME_COLS.length],
        HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, fz);
    }
  }

  /* ---- 🏙️ city-kit district furnishing — plaza benches & corner lamps ----
   * The new districts get their street furniture: benches on the civic plazas,
   * the Mediterranean court, the shrine gravel, the university green and the
   * frontier boardwalk; lamps on the district corners (pushLamp refuses roads). */
  benches.push(
    { x: -106.25, z: -162.5, rot: 0 }, { x: -97, z: -160, rot: Math.PI / 2 },        // civic east plaza
    { x: 101.25, z: -160.5, rot: 0 }, { x: 108, z: -153, rot: 0 },                   // civic west plaza
    { x: -101.25, z: -98.5, rot: 0 }, { x: -95.5, z: -97.5, rot: 0 },                // mediterranean court
    { x: -170.75, z: -103.5, rot: 0 }, { x: -176, z: -108, rot: 0 },                 // shrine gravel
    { x: -168.75, z: 103.5, rot: 0 }, { x: -162, z: 103.5, rot: 0 },                 // university green
    { x: -168.75, z: -25, rot: 0 }, { x: -163.75, z: -25, rot: 0 },                  // frontier boardwalk
    { x: 26.75, z: -238, rot: 0 }, { x: 38.75, z: -238, rot: 0 },                    // lakeside cabins
  );
  pushLamp(-101.25, -166); pushLamp(101.25, -166); pushLamp(-168.75, -97); pushLamp(-168.75, 105);
  pushLamp(-41, 166); pushLamp(-236.25, -103); pushLamp(236.25, 26); pushLamp(-227, 236.25);

  /* ---- 🗽 NYC city-kit district (east midtown column x=168.75) ----
   * Pushed BEFORE the fringe-cottage loops so cottages keep off the plots. */
  for (const n of NYC.boxBuildings) push(n.x, n.z, n.w, n.d, n.h, n.kind, n.color, n.roof, n.awn, n.fz);

  /* ---- police stations: one per quadrant, white kind-7 block with a van gate + jail cage ----
   * Pushed BEFORE fringe cottages so cottages never spawn on the station plots. */
  const POLICE_WALL = 0xf2f4f0;
  const POLICE_ROOF = 0x2b3556;
  for (const st of POLICE_STATIONS) {
    push(st.x, st.z, 13, 10, 9.5, 7, POLICE_WALL, POLICE_ROOF);
    // evidence cage fence posts (bars drawn by <PoliceStations>)
    const cage = stationCage(st);
    for (const [px, pz] of [[cage.x - 3.4, cage.z - 3.4], [cage.x + 3.4, cage.z - 3.4], [cage.x - 3.4, cage.z + 3.4], [cage.x + 3.4, cage.z + 3.4], [cage.x - 3.4, cage.z], [cage.x + 3.4, cage.z], [cage.x, cage.z - 3.4], [cage.x, cage.z + 3.4]] as const)
      push(px, pz, 0.35, 0.35, 2.6, 0, 0x6a7284, POLICE_ROOF);
    const gate = stationGate(st);
    pushLamp(gate.x + Math.sign(st.x) * 5, gate.z);
    pushLamp(gate.x, gate.z + Math.sign(st.z) * 5);
  }

  /* ---- suburban fringe cottages (between the outer grid road and the ring highway) ---- */
  let fc = 0;
  while (fc < 26) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 225, 268);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // clear of every grid road line (+ sidewalks) and of existing buildings & stations
    if (ROADS.some((o) => Math.abs(x - o) < 12 || Math.abs(z - o) < 12)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 6 && Math.abs(z - b.z) < b.d + 6)) continue;
    if (CITYKIT.hit(x, z, 6)) continue;                                      // 🏙️ the kit districts keep the fringe clear
    if (POLICE_STATIONS.some((st) => Math.hypot(x - st.x, z - st.z) < 32)) continue;
    if (Math.hypot(x - MALL.x, z - MALL.z) < 30 || Math.hypot(x - SCHOOL.x, z - SCHOOL.z) < 26) continue;
    if (inHospitalCampus(x, z, 6)) continue;                                 // 🏥 the medical campus took this whole block
    if (inConstructionSite(x, z, 6)) continue;                               // 🚧 the three building sites keep the fringe clear
    push(x, z, 4.4, 3.8, range(rnd, 5, 6.2), 2,
      HOME_COLS[buildings.length % HOME_COLS.length],
      HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, z > 0 ? -1 : 1);
    fc++;
  }
  /* ---- outer belt cottages (between the ±270 roads and the ring highway) ---- */
  fc = 0;
  while (fc < 30) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 288, 336);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (ROADS.some((o) => Math.abs(x - o) < 12 || Math.abs(z - o) < 12)) continue;
    if (inAirportPlot(x, z)) continue;                       // keep the flight path clear
    if (inConstructionSite(x, z, 6)) continue;               // 🚧 the three building sites keep the fringe clear
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 6 && Math.abs(z - b.z) < b.d + 6)) continue;
    if (POLICE_STATIONS.some((st) => Math.hypot(x - st.x, z - st.z) < 32)) continue;
    push(x, z, 4.4, 3.8, range(rnd, 5, 6.2), 2,
      HOME_COLS[buildings.length % HOME_COLS.length],
      HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, z > 0 ? -1 : 1);
    fc++;
  }

  /* ---- landmarks ---- */
  push(MALL.x, MALL.z, 20, 11, 15, 3, 0xe8e4da, 0x9aa5b1);                 // MEGA MALL
  push(SCHOOL.x, SCHOOL.z, 16, 5.5, 9, 4, 0xf2d59b, 0xb0553a);             // school
  // 🏥 the hospital box is GONE — the whole block is now the St. Cross Medical
  // Campus built from the polyfork hospital-kit GLBs (HOSPKIT above +
  // <HospitalCampus>): ward block, ER wing, annexe, helipad, fence, plaza…
  // Its colliders + staff cars are laid out in the campus section below.
  // mall parking cars — the full fleet: sedans, vans, pickups, buses & jeeps
  for (let i = 0; i < 4; i++) for (const zr of [-6, 5]) {
    cars.push({ x: MALL.x - 15 + i * 10, z: MALL.z - 26 + zr, rot: Math.PI / 2, c: (i + (zr > 0 ? 2 : 0)) % CAR_COLS.length, t: pickVehicle(rnd) });
  }
  // 🚕 the TAXI RANK — a row of real polyfork yellow cabs waits by the mall
  // (rendered from yellow-cab-8df4a0.glb by GlbCars; hail one, it's drivable)
  for (let i = 0; i < 3; i++) cars.push({ x: MALL.x - 15 + i * 10, z: MALL.z - 40, rot: Math.PI / 2, c: 0, t: TAXI_TYPE });
  // 🏥 campus visitor parking along the west fence (was: 3 cars north of the box)
  for (const vp of HOSPKIT.visitorParking) {
    cars.push({ x: vp.x, z: vp.z, rot: vp.rot, c: cars.length % CAR_COLS.length, t: pickVehicle(rnd) });
  }
  for (const [lx, lz] of [
    [MALL.x - 21, MALL.z - 27], [MALL.x + 21, MALL.z - 27],
    [MALL.x - 21, MALL.z - 5], [MALL.x + 21, MALL.z - 5],
    [SCHOOL.x - 18, SCHOOL.z - 20], [SCHOOL.x + 18, SCHOOL.z - 20],
  ] as const) pushLamp(lx, lz);
  // 🏥 campus lawn lamps (was: two lamps by the old hospital box)
  for (const lp of HOSPKIT.lamps) pushLamp(lp.x, lp.z);
  // park benches around the fountain + school yard + mall front
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    benches.push({ x: PARK.x + Math.cos(a) * 6.8, z: PARK.z + Math.sin(a) * 6.8, rot: -a + Math.PI / 2 });
  }
  benches.push({ x: SCHOOL.x - 8, z: SCHOOL.z - 17, rot: Math.PI }, { x: SCHOOL.x + 2, z: SCHOOL.z - 17, rot: Math.PI }, { x: SCHOOL.x + 10, z: SCHOOL.z - 17, rot: Math.PI });
  benches.push({ x: MALL.x - 8, z: MALL.z - 32.5, rot: 0 }, { x: MALL.x + 8, z: MALL.z - 32.5, rot: 0 });
  for (const bn of HOSPKIT.benches) benches.push(bn);                                      // 🏥 campus plaza benches

  /* ---- parked cars along road edges ----
   * Airport plot (runway, apron, taxi paths) stays CAR-FREE — the old loop let
   * road-edge spawns from the x≈270 street land right on the runway, where bot
   * planes then taxied straight through them. */
  for (const k of ROADS) {
    for (const vertical of [true, false]) {
      let side = 1;
      for (let d = -368; d <= 368; d += 48, side = -side) {
        if (ROADS.some((o) => Math.abs(d - o) < 15)) continue;
        // the wide main road (k=0 vertical) needs deeper parking + no cars past its ends
        const main = vertical && k === 0;
        if (main && (d < MAIN_ROAD.z0 + 45 || d > MAIN_ROAD.z1 - 8)) continue;
        // keep station gates clear so the van always has room to stop
        if (POLICE_STATIONS.some((st) => { const g = stationGate(st); return Math.hypot((vertical ? k + side * 5.2 : d) - g.x, (vertical ? d : k + side * 5.2) - g.z) < 18; })) continue;
        const spot = vertical
          ? { x: k + side * 5.2, z: d }
          : { x: d, z: k + side * 5.2 };
        // ✈️ the z=270 street ends at the airport fence (x=171) — no cars on
        // the grass stub east of its dead-end
        if (!vertical && k === 270 && d > 171) continue;
        if (inAirportPlot(spot.x, spot.z)) continue; // never park on the runway / apron / taxi paths
        if (inHospitalCampus(spot.x, spot.z, 1.5)) continue; // 🏥 keep the campus drive mouth car-free
        const off = main ? 9.5 : 5.2;
        // 🚕 every 9th street-parked car is a yellow cab — random taxis all over town
        const taxi = cars.length % 9 === 4;
        cars.push(vertical
          ? { x: k + side * off, z: d + range(rnd, -4, 4), rot: side > 0 ? 0 : Math.PI, c: 0, t: taxi ? TAXI_TYPE : pickVehicle(rnd) }
          : { x: d + range(rnd, -4, 4), z: k + side * 5.2, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2, c: 0, t: taxi ? TAXI_TYPE : pickVehicle(rnd) });
      }
    }
  }

  /* ---- street lamps: 2 per intersection + ring + avenue ----
   * Main-road crossings get their pair pushed to the kerb: the ±8.5 corners sit
   * INSIDE the 24-wide tarmac, and a lamp mid-road stares straight down the
   * chase camera's lens (the "car is only a shadow" bug). */
  const inMainRoad = (x: number, z: number) => Math.abs(x) < 12.9 && z > MAIN_ROAD.z0 - 4 && z < MAIN_ROAD.z1 + 4;
  for (const kx of ROADS) for (const kz of ROADS) {
    const lx = inMainRoad(kx + 8.5, kz + 8.5) ? 12.9 : kx + 8.5;
    const rx = inMainRoad(kx - 8.5, kz - 8.5) ? -12.9 : kx - 8.5;
    pushLamp(lx, kz + 8.5); pushLamp(rx, kz - 8.5);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // ✈️ skip the lamp inside the ring's airport bypass gap (the road swings inside there)
    if (a > RING_GAP.a0 - 0.06 && a < RING_GAP.a1 + 0.06) continue;
    pushLamp(Math.cos(a) * (RING_R + RING_W / 2 + 2), Math.sin(a) * (RING_R + RING_W / 2 + 2));
  }
  pushLamp(15, -150); pushLamp(-15, -164); pushLamp(15, -178);
  pushLamp(15, 24); pushLamp(-15, 96); pushLamp(15, 160);

  /* ---- central park trees + landmark trees ---- */
  const trees: Tree[] = [];
  const addTree = (x: number, z: number, s: number, kind: Tree["kind"]) =>
    trees.push({ x, z, r: 0.7 * s, s, kind });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    addTree(PARK.x + Math.cos(a) * 21, PARK.z + Math.sin(a) * 21, range(rnd, 0.72, 0.95), 1);
  }
  addTree(SCHOOL.x - 12, SCHOOL.z - 16, 0.8, 1);
  addTree(SCHOOL.x + 12, SCHOOL.z - 16, 0.85, 1);
  addTree(MALL.x - 24, MALL.z - 29, 0.8, 0);
  addTree(MALL.x + 24, MALL.z - 29, 0.8, 0);

  /* ---- town placards along the main road + museum plaza (survival posters) ---- */
  const SLOGANS = [
    "SURVIVE THE NIGHT!", "STAY NEAR THE FIRES", "BARRICADE YOUR STREET", "7 NIGHTS. ONE TOWN.",
    "FIRES KEEP THEM OUT", "TRUST NO ONE AT DUSK", "MUSEUM IS SAFE ZONE", "FRUIT & WATER STALL",
    "NO SHOUTING AFTER DARK", "HONK IF YOU'RE HUMAN",
  ];
  const signs: Sign[] = [];
  let si = 0;
  for (let z = -110; z <= 330; z += 24) {
    for (const side of [-1, 1]) {
      if (si >= SLOGANS.length * 2) break;
      signs.push({
        x: side * (14.5 + range(rnd, 0, 1.6)), z: z + range(rnd, -6, 6),
        rot: side > 0 ? Math.PI : 0,
        text: SLOGANS[si % SLOGANS.length], c: si % 3,
      });
      si++;
    }
  }
  // a proud cluster right on the museum plaza, clear of the rotunda and galleries
  for (let i = 0; i < 6; i++) {
    signs.push({
      x: (i % 2 === 0 ? -1 : 1) * (13 + (i >> 1) * 3), z: -166 - (i % 3) * 2.4,
      rot: (i % 2 === 0 ? 1 : -1) * 0.4,
      text: SLOGANS[(si + i) % SLOGANS.length], c: (si + i) % 3,
    });
  }

  /* ---- farm: barns, silos, crop fields, windmills (moved out to the wider farm ring) ----
   * The whole farm band slid outward when the city grew to r=405 — every farm prop
   * scaled by ~1.22 so fields sit between the city edge and the jungle again.
   * 🚜 cozy farm kit: each barn gained a farmhouse, the fields grew (9 paddocks),
   * and a glass greenhouse joins the first steading. */
  const barns = BARN_BASE;
  for (const [x, z] of barns) push(x, z, 8, 5.5, 7, 6, 0xc0442e, 0x7a3322);
  const silos: Silo[] = barns.map(([x, z]) => ({ x: x + 11.5, z: z + 2 }));
  for (const fh of FARMKIT.farmhouses) push(fh.x, fh.z, 6, 4.5, 5.2, 2, 0xd8c8a8, 0x8a5a3a); // farmhouse with a pyramid roof
  push(FARMKIT.greenhouse.x, FARMKIT.greenhouse.z, 4.2, 2.8, 3.4, 0, 0x9fc4d8, 0x5a6472);     // glasshouse shell (glazing drawn in <Farm>)
  // 🚂 the kit crossing keeper's cottage + country station house are REAL kit
  // models now (see RAILKIT / <RailwayKit>) — their colliders ride RAILKIT.cols
  const fields: Field[] = FIELDS_BASE.map((f) => ({ ...f, w: 12, d: 8 }) as Field);
  const windmills = [
    { x: 425, z: -68, rot: 0 }, { x: 403, z: 195, rot: 1.2 }, { x: -412, z: 193, rot: 2.1 },
  ];

  /* ---- 🏕️ jungle camps — lonely camper glades in the wild band ----
   * Six cleared sites between the farm ring and the deep jungle: A-frame tents
   * facing a stone-ringed fire pit, split-log seats, supply crates and a
   * lantern pole. The fire is ALWAYS burning (rendered by <CampFires>) and the
   * glow keeps beasts & zombies at arm's length — a night shelter for the brave.
   * Placed BEFORE the tree pass so every camp keeps its own clearing. */
  const camps: Camp[] = [];
  const TENT_CANVAS = [0xd9a441, 0xb0553a, 0x7a8c5a, 0xc9b28a, 0x9a6a8a];
  let campTries = 0;
  while (camps.length < 6 && campTries++ < 500) {
    const a = range(rnd, 0, Math.PI * 2), cr = range(rnd, 486, 576);
    const x = Math.cos(a) * cr, z = Math.sin(a) * cr;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 42 || graveyardLaneDist(x, z) < 40) continue;
    if (inAirportPlot(x, z)) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 95)) continue;
    const baseRot = range(rnd, 0, Math.PI * 2);
    const tents: Camp["tents"] = [];
    const logs: Camp["logs"] = [];
    const crates: Camp["crates"] = [];
    const tentN = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let ti = 0; ti < tentN; ti++) {
      // tents ring the pit on the far side, doorways turned toward the fire
      const ta = baseRot + Math.PI + (ti - (tentN - 1) / 2) * 1.2 + range(rnd, -0.15, 0.15);
      const td = range(rnd, 4.4, 5.2);
      tents.push({
        dx: Math.cos(ta) * td, dz: Math.sin(ta) * td,
        rot: Math.atan2(-Math.cos(ta), -Math.sin(ta)), // doorway (+z of the mesh) looks at the pit
        c: Math.floor(rnd() * TENT_CANVAS.length), s: range(rnd, 0.9, 1.12),
      });
    }
    const logN = 3 + Math.floor(rnd() * 2);
    for (let li = 0; li < logN; li++) {
      const la = baseRot + (li / logN) * Math.PI * 2 + range(rnd, -0.2, 0.2);
      const ld = range(rnd, 2.1, 2.7);
      logs.push({ dx: Math.cos(la) * ld, dz: Math.sin(la) * ld, rot: la + Math.PI / 2 + range(rnd, -0.3, 0.3) });
    }
    const crateN = 1 + Math.floor(rnd() * 2);
    for (let ki = 0; ki < crateN; ki++) {
      const ka = baseRot + range(rnd, 0, Math.PI * 2), kd = range(rnd, 2.6, 3.4);
      crates.push({ dx: Math.cos(ka) * kd, dz: Math.sin(ka) * kd, rot: range(rnd, 0, Math.PI * 2) });
    }
    const pa = baseRot + Math.PI / 3 + range(rnd, -0.4, 0.4), pd = 2.9;
    // 🌲 nature & forest kit — every camp gains cook-fire comforts: a picnic
    // table on the open side, a lean-to or an outhouse at the glade's edge,
    // and often a water barrel. The tripod over the fire is drawn in <Camps>.
    const kit: Camp["kit"] = { picnic: [], leanTo: null, outhouse: null, barrel: null };
    const picnicN = 1 + (rnd() < 0.45 ? 1 : 0);
    for (let pi = 0; pi < picnicN; pi++) {
      const pra = baseRot + Math.PI + (pi === 0 ? 0 : Math.PI * 0.62) + range(rnd, -0.3, 0.3);
      const prd = range(rnd, 5.2, 6.0);
      kit.picnic.push({ dx: Math.cos(pra) * prd, dz: Math.sin(pra) * prd, rot: -pra + Math.PI / 2 });
    }
    if (camps.length % 2 === 0) {
      const la = baseRot + Math.PI * 0.72 + range(rnd, -0.2, 0.2), ld = range(rnd, 5.8, 6.5);
      kit.leanTo = { dx: Math.cos(la) * ld, dz: Math.sin(la) * ld, rot: Math.atan2(-Math.cos(la), -Math.sin(la)) };
    }
    if (camps.length % 3 === 1) {
      const oa = baseRot - Math.PI * 0.7 + range(rnd, -0.2, 0.2), od = range(rnd, 6.0, 6.8);
      kit.outhouse = { dx: Math.cos(oa) * od, dz: Math.sin(oa) * od, rot: Math.atan2(-Math.cos(oa), -Math.sin(oa)) };
    }
    if (rnd() < 0.65) {
      const ba = baseRot + Math.PI * 1.32 + range(rnd, -0.3, 0.3), bd = range(rnd, 3.2, 3.9);
      kit.barrel = { dx: Math.cos(ba) * bd, dz: Math.sin(ba) * bd };
    }
    camps.push({
      x, z, rot: baseRot, tents, logs, crates,
      pole: { dx: Math.cos(pa) * pd, dz: Math.sin(pa) * pd },
      kit,
    });
  }

  /* ---- 🌲 jungle ponds — dark forest pools with docks, boats & reeds ----
   * Two lonely ponds deep in the outer jungle band: water blobs with lily pads
   * and cattail reeds, one with a plank dock and a moored canoe, one with a
   * rowboat pulled up on the bank. The park pond stays the city's pond — these
   * belong to the wild. Collider circles block swimmers. */
  const ponds: Pond[] = [];
  let pn = 0;
  while (pn < 2 && pn < 40) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 486, 556);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (inFlightZone(x, z)) continue;        // ✈️ never a jungle pond flooding the runway / taxiway
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 30 || graveyardLaneDist(x, z) < 30) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 46)) continue;    // not in a camp glade
    if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < 130)) continue;      // spread apart
    ponds.push({ x, z, r: range(rnd, 6.5, 8.5) });
    pn++;
  }

  /* ---- jungle forest (outer ring) + DEEP jungle (denser, darker band hugging the mountains) ----
   * The map grew: the outer jungle band is now 465 → 545 and the deep band 545 → 610.
   * The deep band is where rare gems & rocks hide: nearly double tree density, bigger
   * canopies and mostly round dark crowns so it reads visually darker than the regular
   * jungle ring. Trees keep out of the ⛰️ mountain band (that's rock country),
   * out of the 🏕️ camp glades — and OUT of the new 🌲 ponds.
   * 🌲 nature & forest kit: 7 species now (see OUTER_TREE_MIX / DEEP_TREE_MIX) —
   * birches, oaks, maples, young pines and dead snags join the pines & broadleafs. */
  let n = 0;
  while (n < 560) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 472, DEEP_JUNGLE_RADIUS);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (inFlightZone(x, z)) continue;        // ✈️ no trees ON the runway / INSIDE the hangar / under the climb-out
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8 || graveyardLaneDist(x, z) < 9) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 10.5)) continue; // keep camp glades clear
    if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 3.4)) continue; // 🌲 pond banks stay open
    addTree(x, z, range(rnd, 0.85, 1.55), treeKindRoll(rnd, OUTER_TREE_MIX));
    n++;
  }
  n = 0;
  while (n < 520) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, DEEP_JUNGLE_RADIUS + 2, JUNGLE_RADIUS - 2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (inFlightZone(x, z)) continue;        // ✈️ keep the climb-out corridor east of the runway forest-free too
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8 || graveyardLaneDist(x, z) < 9) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 10.5)) continue; // keep camp glades clear
    addTree(x, z, range(rnd, 1.1, 1.95), treeKindRoll(rnd, DEEP_TREE_MIX)); // dark round canopies still dominate
    n++;
  }

  /* ---- 🔨 breakable boulders: scattered on the ⛰️ mountain slopes, through the
   * deep jungle and along its inner edge — hammer food for the wild explorer ---- */
  const rocks: Rock[] = [];
  const rockCi: number[] = [];
  n = 0;
  while (n < 26) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 4);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h < 0.8 || h > 15) continue; // on the slopes, not buried in a summit or the flat rim
    rocks.push({ x, z, s: range(rnd, 1, 2.1) });
    n++;
  }
  while (n < 40) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, DEEP_JUNGLE_RADIUS + 3, JUNGLE_RADIUS - 6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (inFlightZone(x, z)) continue;        // ✈️ no boulders under the climb-out path either
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 6 || graveyardLaneDist(x, z) < 7) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 7)) continue; // not inside a camp glade
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue;
    rocks.push({ x, z, s: range(rnd, 0.9, 1.8) });
    n++;
  }

  /* ---- sparse farmland trees (avoid fields, buildings, the railway & the airport plot) ---- */
  n = 0;
  while (n < 80) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 412, 458);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8 || graveyardLaneDist(x, z) < 9) continue;
    if (inAirportPlot(x, z)) continue;
    if (Math.abs(Math.hypot(x, z) - RAILWAY.R) < 5.5 || inRailwayYard(x, z, 4)) continue; // 🚂 the branch line + its yard stay clear
    if (fields.some((f) => Math.abs(x - f.x) < f.w + 3 && Math.abs(z - f.z) < f.d + 3)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 3 && Math.abs(z - b.z) < b.d + 3)) continue;
    addTree(x, z, range(rnd, 0.8, 1.3), treeKindRoll(rnd, FARM_TREE_MIX)); // 🌲 birches & maples shade the lanes
    n++;
  }

  /* ---- 🌲 nature & forest kit — the wild band grows its undergrowth ----
   * Forest-floor scatter (ferns, grass tufts, toadstools, bushes, wildflower
   * patches, old stumps, fallen logs — all steppable), the landmark kit (log
   * cabins deep in the woods, a ranger station by the pond with its pickup
   * parked outside, a fire lookout tower on a mountain shoulder, rock spires),
   * winding dirt trails with signposts, lanterns & map kiosks, plank docks,
   * moored boats and a bridge over the creek. Everything is deterministic. */
  const ferns: FloorProp[] = [];
  const tufts: FloorProp[] = [];
  const shrooms: FloorProp[] = [];
  const bushes: FloorProp[] = [];
  const wilds: FloorProp[] = [];
  const stumps: FloorProp[] = [];
  const logs: FloorProp[] = [];
  const spires: FloorProp[] = [];
  const cabins: { x: number; z: number; rot: number }[] = [];
  let lookout: { x: number; z: number } | null = null;
  const trucks: { x: number; z: number; rot: number }[] = [];
  const bridges: { x: number; z: number; rot: number; s: number }[] = [];
  const docks: { x: number; z: number; rot: number }[] = [];
  const boats: { x: number; z: number; rot: number; kind: 0 | 1 }[] = [];
  const reeds: FloorProp[] = [];
  const pads: FloorProp[] = [];
  const kiosks: { x: number; z: number; rot: number }[] = [];
  const trailPosts: TrailPost[] = [];
  const stones: FloorProp[] = [];
  const birdhouses: { x: number; z: number }[] = [];
  const handcarts: { x: number; z: number; rot: number }[] = [];
  const chopBlocks: { x: number; z: number; rot: number }[] = [];
  const firewood: { x: number; z: number; rot: number }[] = [];
  const woodsheds: { x: number; z: number; rot: number }[] = [];

  /** distance from a point to a segment — trails & creeks keep the scatter honest */
  const segDist = (px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const L2 = dx * dx + dz * dz || 1;
    let t = ((px - a.x) * dx + (pz - a.z) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
  };
  const trailPts: { x: number; z: number }[][] = [];
  const trailDist = (x: number, z: number) => {
    let d = Infinity;
    for (const tr of trailPts) for (let i = 0; i < tr.length - 1; i++) d = Math.min(d, segDist(x, z, tr[i], tr[i + 1]));
    return d;
  };

  /* winding dirt trails — two paths from the farm ring down into the deep
   * jungle, the way a ranger would cut them: gentle wobble, no shortcuts */
  n = 0;
  while (trailPts.length < 2 && n++ < 300) {
    const a0 = range(rnd, 0, Math.PI * 2);
    const wob = range(rnd, 0.1, 0.22), drift = range(rnd, -0.12, 0.12);
    const pts: { x: number; z: number }[] = [];
    let ok = true;
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const rr = 452 + t * range(rnd, 116, 132);
      const a = a0 + Math.sin(t * 5.0 + a0 * 3.1) * wob + t * drift;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (inAirportPlot(x, z)) { ok = false; break; }
      if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 12 || graveyardLaneDist(x, z) < 12) { ok = false; break; }
      if (fields.some((f) => Math.abs(x - f.x) < f.w + 4 && Math.abs(z - f.z) < f.d + 4)) { ok = false; break; }
      if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 7.5)) { ok = false; break; }
      if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 6)) { ok = false; break; }
      pts.push({ x, z });
    }
    if (ok && trailPts.every((tp) => Math.hypot(tp[0].x - pts[0].x, tp[0].z - pts[0].z) > 140)) trailPts.push(pts);
  }
  // trail furniture: a map kiosk at every trailhead, signposts mid-path,
  // lantern posts deeper out (they glow at night — your way home), and
  // round & slab path stones edging the route
  for (const pts of trailPts) {
    const head = pts[0];
    const headA = Math.atan2(head.z, head.x);
    kiosks.push({ x: head.x + Math.cos(headA) * 3.4, z: head.z + Math.sin(headA) * 3.4, rot: Math.PI / 2 - (headA + Math.PI) });
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const perp = { x: -dz / L, z: dx / L };
      if (k === 6) trailPosts.push({ x: p.x + perp.x * 1.5, z: p.z + perp.z * 1.5, rot: Math.PI / 2 - headA, lantern: false });
      else if (k === 2 || k === 4 || k === 8 || k === 10)
        trailPosts.push({ x: p.x + perp.x * 1.8, z: p.z + perp.z * 1.8, rot: Math.PI / 2 - (headA + Math.PI), lantern: true });
      if (k < pts.length - 1) {
        const side = k % 2 === 0 ? 1 : -1;
        stones.push({ x: p.x + perp.x * 1.9 * side + dx * 0.18, z: p.z + perp.z * 1.9 * side + dz * 0.18, rot: range(rnd, 0, 6.283), s: range(rnd, 0.75, 1.25), c: (stones.length + k) % 2 });
        stones.push({ x: p.x + perp.x * 2.3 * -side - dx * 0.1, z: p.z + perp.z * 2.3 * -side - dz * 0.1, rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.2), c: (stones.length + k + 1) % 2 });
      }
    }
  }

  /** every scatter prop must clear the landmarks, water, paths, tree trunks & the branch line */
  const clearOf = (x: number, z: number, pad: number) => {
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + pad) return false;
    if (graveyardLaneDist(x, z) < pad) return false;
    if (inFlightZone(x, z)) return false; // ✈️ plot + climb-out corridor stay prop-free
    if (inHospitalCampus(x, z, pad)) return false; // 🏥 the medical campus grounds stay prop-free
    if (nearRailway(x, z, 5 + pad) || inRailwayYard(x, z, pad)) return false; // 🚂 no tufts/bushes/ferns sprouting on the rails or in the yard
    if (CITYKIT.hit(x, z, pad)) return false;                                // 🏙️ nothing sprouts through the kit buildings
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + pad && Math.abs(z - b.z) < b.d + pad)) return false;
    if (fields.some((f) => Math.abs(x - f.x) < f.w + pad && Math.abs(z - f.z) < f.d + pad)) return false;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 8.5)) return false;
    if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + pad)) return false;
    if (trailDist(x, z) < 2.4) return false;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.9)) return false;
    if (cabins.some((c2) => Math.hypot(c2.x - x, c2.z - z) < 5)) return false;
    return true;
  };

  // ferns carpet the deep jungle floor
  n = 0;
  while (n < 90 && n < 2000) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, DEEP_JUNGLE_RADIUS - 4, JUNGLE_RADIUS - 6);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 1.6)) continue;
    ferns.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.8, 1.5), c: Math.floor(rnd() * 3) });
    n++;
  }
  // grass tufts everywhere the wilds reach
  n = 0;
  while (n < 140 && n < 3000) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 420, JUNGLE_RADIUS - 8);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 1.4)) continue;
    tufts.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.35), c: Math.floor(rnd() * 3) });
    n++;
  }
  // toadstools — the deep jungle's poison-fairies
  n = 0;
  while (n < 46 && n < 1500) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, DEEP_JUNGLE_RADIUS - 2, JUNGLE_RADIUS - 6);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 1.5)) continue;
    shrooms.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.6, 1.2), c: Math.floor(rnd() * 2) });
    n++;
  }
  // round bushes — outer jungle & the farm hedgerows
  n = 0;
  while (n < 64 && n < 2000) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 420, 560);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 2.1)) continue;
    bushes.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.8, 1.6), c: Math.floor(rnd() * 2) });
    n++;
  }
  // wildflower patches — town verges & the farm lanes
  n = 0;
  while (n < 26 && n < 1200) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 30, 386);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (ROADS.some((o) => Math.abs(x - o) < 7.5 || Math.abs(z - o) < 7.5)) continue;
    if (Math.abs(x) < 13 && z > MAIN_ROAD.z0 - 3 && z < MAIN_ROAD.z1 + 3) continue;
    if (Math.abs(rr - RING_R) < 9) continue;
    if (inHospitalCampus(x, z, 1.8)) continue;                                              // 🏥 no wildflowers in the hospital lawn
    if (CITYKIT.hit(x, z, 1.8)) continue;                                                   // 🏙️ none in the kit districts either
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 1.8 && Math.abs(z - b.z) < b.d + 1.8)) continue;
    wilds.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.2), c: Math.floor(rnd() * 3) });
    n++;
  }
  n = 0;
  while (n < 34 && n < 1200) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, CITY_RADIUS + 8, FARM_RADIUS - 10);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 1.6)) continue;
    wilds.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.25), c: Math.floor(rnd() * 3) });
    n++;
  }
  // old stumps & fallen logs — the forest remembers its dead wood
  n = 0;
  while (n < 26 && n < 1200) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 472, 552);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 2.1)) continue;
    stumps.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.8, 1.3), c: 0 });
    n++;
  }
  n = 0;
  while (n < 30 && n < 1200) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 472, JUNGLE_RADIUS - 10);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 2.3)) continue;
    logs.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 0.8, 1.4), c: 0 });
    n++;
  }
  // 🪵 log cabins — three homesteads deep in the dark band, porches to the city
  n = 0;
  while (cabins.length < 3 && n++ < 400) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 548, 600);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 4.2)) continue;
    if (cabins.some((c2) => Math.hypot(c2.x - x, c2.z - z) < 120)) continue;
    cabins.push({ x, z, rot: Math.atan2(-z, -x) });
  }
  // 🗼 fire lookout tower — on a gentle mountain shoulder, legs on even ground
  n = 0;
  while (!lookout && n++ < 300) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, MOUNTAIN_INNER + 8, MOUNTAIN_INNER + 46);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = terrainHeight(x, z);
    if (h < 1.2 || h > 9) continue;
    let mn = 99, mx = -99;
    for (const [ox, oz] of [[2.4, 2.4], [-2.4, 2.4], [2.4, -2.4], [-2.4, -2.4]] as const) {
      const hh = terrainHeight(x + ox, z + oz);
      mn = Math.min(mn, hh); mx = Math.max(mx, hh);
    }
    if (mx - mn > 2.6) continue;
    lookout = { x, z };
  }
  // 🗿 rock spires — mountain crags & deep-jungle needles
  n = 0;
  while (n < 14 && n < 800) {
    const onMtn = n % 2 === 0;
    const a = range(rnd, 0, Math.PI * 2);
    const rr = onMtn ? range(rnd, MOUNTAIN_INNER + 4, MOUNTAIN_OUTER - 6) : range(rnd, DEEP_JUNGLE_RADIUS + 4, JUNGLE_RADIUS - 6);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (onMtn && (terrainHeight(x, z) < 1 || terrainHeight(x, z) > 12)) continue;
    if (!clearOf(x, z, 2.2)) continue;
    spires.push({ x, z, rot: range(rnd, 0, 6.283), s: range(rnd, 1.1, 2.2), c: n % 2 });
    n++;
  }
  // 🏕️ ranger station — by the first pond when there is one, deep jungle otherwise
  let rangerPos: { x: number; z: number; rot: number } | null = null;
  if (ponds.length > 0) {
    const p0 = ponds[0];
    const aOut = Math.atan2(p0.z, p0.x);
    const rx = p0.x + Math.cos(aOut) * (p0.r + 14), rz = p0.z + Math.sin(aOut) * (p0.r + 14);
    if (clearOf(rx, rz, 4.5)) rangerPos = { x: rx, z: rz, rot: Math.atan2(-rz, -rx) };
  }
  let rTries = 0;
  while (!rangerPos && rTries++ < 300) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 490, 545);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 4.5)) continue;
    rangerPos = { x, z, rot: Math.atan2(-z, -x) };
  }
  // 🚙 the ranger's pickup — parked outside the station, another abandoned by the first cabin
  if (rangerPos) trucks.push({ x: rangerPos.x + Math.cos(rangerPos.rot) * 2.2 + Math.sin(rangerPos.rot) * 7.4, z: rangerPos.z + Math.sin(rangerPos.rot) * 2.2 - Math.cos(rangerPos.rot) * 7.4, rot: rangerPos.rot + Math.PI / 2 + 0.18 });
  if (cabins.length > 0) trucks.push({ x: cabins[0].x + Math.cos(cabins[0].rot) * 6.4, z: cabins[0].z + Math.sin(cabins[0].rot) * 6.4, rot: cabins[0].rot - 0.5 });
  // pond dressing: a creek feeds the first pond (a plank bridge crosses it),
  // the other pond gets a plank dock with a moored canoe, plus reeds & pads
  if (ponds[0]) {
    const ca = range(rnd, 0, Math.PI * 2);
    ponds[0].creek = ca;
    const bx = ponds[0].x + Math.cos(ca) * (ponds[0].r + 1.7);
    const bz = ponds[0].z + Math.sin(ca) * (ponds[0].r + 1.7);
    bridges.push({ x: bx, z: bz, rot: -ca, s: ponds[0].r / 7 });
    const ra = ca + 1.15;
    boats.push({ x: ponds[0].x + Math.cos(ra) * (ponds[0].r + 1.5), z: ponds[0].z + Math.sin(ra) * (ponds[0].r + 1.5), rot: Math.PI / 2 - (ra + Math.PI), kind: 1 });
  }
  const dockPond = ponds[1] ?? ponds[0];
  if (dockPond) {
    const da = Math.atan2(dockPond.z, dockPond.x) + Math.PI;
    const bx = dockPond.x + Math.cos(da) * (dockPond.r + 1.1);
    const bz = dockPond.z + Math.sin(da) * (dockPond.r + 1.1);
    docks.push({ x: bx + Math.cos(da) * 1.7, z: bz + Math.sin(da) * 1.7, rot: Math.PI / 2 - da });
    boats.push({ x: bx + Math.cos(da) * 5.0 + Math.cos(da + Math.PI / 2) * 1.35, z: bz + Math.sin(da) * 5.0 + Math.sin(da + Math.PI / 2) * 1.35, rot: Math.PI / 2 - da + 0.08, kind: 0 });
  }
  // cattail reeds ring every pond bank (the park pond too) & lily pads drift inside
  for (const p of ponds) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + p.x * 0.31 + range(rnd, -0.2, 0.2);
      const rr = p.r + range(rnd, -0.6, 0.9);
      reeds.push({ x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr, rot: range(rnd, 0, 6.283), s: range(rnd, 0.75, 1.3), c: Math.floor(rnd() * 2) });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + p.z * 0.17 + range(rnd, -0.3, 0.3);
      const rr = p.r * range(rnd, 0.28, 0.6);
      pads.push({ x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr, rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.25), c: 0 });
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + i * 1.7;
    reeds.push({ x: PARK.x - 11 + Math.cos(a) * (8.2 + range(rnd, -0.5, 0.7)), z: PARK.z + 11 + Math.sin(a) * (8.2 + range(rnd, -0.5, 0.7)), rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.2), c: Math.floor(rnd() * 2) });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const rr = 8.2 * range(rnd, 0.3, 0.55);
    pads.push({ x: PARK.x - 11 + Math.cos(a) * rr, z: PARK.z + 11 + Math.sin(a) * rr, rot: range(rnd, 0, 6.283), s: range(rnd, 0.7, 1.1), c: 0 });
  }
  // 🪵 open woodsheds — one per barnyard, stacked with split logs
  for (const [bx, bz] of BARN_BASE) {
    const a = Math.atan2(bz, bx);
    const wx = bx + Math.cos(a + 0.9) * 16, wz = bz + Math.sin(a + 0.9) * 16;
    if (fields.some((f) => Math.abs(wx - f.x) < f.w + 2 && Math.abs(wz - f.z) < f.d + 2)) continue;
    if (nearRailway(wx, wz, 8) || inRailwayYard(wx, wz, 4)) continue; // 🚂 never a woodshed on the branch line or in its yard
    if (inFlightZone(wx, wz)) continue;   // ✈️ nor one parked on the airfield
    woodsheds.push({ x: wx, z: wz, rot: a + Math.PI });
  }
  // 🛒 hand carts lean against two farmhouses
  handcarts.push({ x: FARMKIT.farmhouses[1].x + 6, z: FARMKIT.farmhouses[1].z + 5, rot: 0.6 });
  handcarts.push({ x: FARMKIT.farmhouses[2].x - 6, z: FARMKIT.farmhouses[2].z + 4, rot: -0.4 });
  // 🏠 birdhouse posts — the park & every farmstead hang a bird box
  birdhouses.push({ x: PARK.x + 14, z: PARK.z - 10 }, { x: PARK.x - 13, z: PARK.z + 14 });
  for (const fh of FARMKIT.farmhouses) birdhouses.push({ x: fh.x + 4.5, z: fh.z - 4.5 });
  // 🪓 chopping blocks & 🔥 firewood — at the cabins and the first camps
  for (const c2 of cabins) {
    chopBlocks.push({ x: c2.x + Math.cos(c2.rot) * 3.4, z: c2.z + Math.sin(c2.rot) * 3.4, rot: c2.rot });
    firewood.push({ x: c2.x - Math.sin(c2.rot) * 3.8, z: c2.z + Math.cos(c2.rot) * 3.8, rot: c2.rot + 0.3 });
  }
  for (const cp of camps.slice(0, 3)) {
    chopBlocks.push({ x: cp.x + 4.4, z: cp.z - 3.6, rot: range(rnd, 0, 6.283) });
    firewood.push({ x: cp.x - 4.8, z: cp.z + 3.2, rot: range(rnd, 0, 6.283) });
  }

  /* ---- 🍎 farmstead orchards — apple & plum trees shade every farmhouse yard ---- */
  for (const fh of FARMKIT.farmhouses) {
    for (let i = 0; i < 3; i++) {
      const oa = (i / 3) * Math.PI * 2 + fh.x * 0.13;
      const x = fh.x + Math.cos(oa) * 9.5, z = fh.z + Math.sin(oa) * 9.5;
      if (fields.some((f) => Math.abs(x - f.x) < f.w + 2.5 && Math.abs(z - f.z) < f.d + 2.5)) continue;
      if (buildings.some((b) => Math.abs(x - b.x) < b.w + 2.5 && Math.abs(z - b.z) < b.d + 2.5)) continue;
      if (inFlightZone(x, z)) continue;     // ✈️ no orchard trees shading the runway
      if (Math.hypot(x, z) > FARM_RADIUS - 6) continue;
      addTree(x, z, range(rnd, 0.85, 1.2), 1); // round crown = orchard look
    }
  }

  /* ---- 🪨 boulders (7Nights): smashable rock nodes near the town & farm ----
   * Easy early-game wood/stone access — clear of roads, buildings, the
   * airport plot and the graveyard. Colliders recorded in rockCi.    */
  n = 0;
  while (n < ROCK_COUNT) {
    const a = range(rnd, 0, Math.PI * 2), rr = range(rnd, 70, 532);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8 || graveyardLaneDist(x, z) < 8) continue;
    if (inAirportPlot(x, z)) continue;
    if (Math.abs(Math.hypot(x, z) - RAILWAY.R) < 6 || inRailwayYard(x, z, 3)) continue; // 🚂 no boulders blocking the branch line or the yard
    // keep the ring road, main road, avenues and the street grid drivable
    if (Math.abs(rr - RING_R) < RING_W / 2 + 4) continue;
    if (Math.abs(x) < ROAD_W / 2 + 4 && z > MAIN_ROAD.z0 - 4 && z < MAIN_ROAD.z1 + 4) continue;
    if (ROADS.some((rd) => Math.abs(x - rd) < ROAD_W / 2 + 3 || Math.abs(z - rd) < ROAD_W / 2 + 3)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 4 && Math.abs(z - b.z) < b.d + 4)) continue;
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < 2.6)) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 7)) continue; // not inside a camp glade
    if (FARMKIT.bales.some((hb) => Math.hypot(hb.x - x, hb.z - z) < 3.4)) continue; // 🚜 not rolled onto the hay
    rocks.push({ x, z, s: range(rnd, 0.85, 1.7) });
    n++;
  }

  /* ---- flowers: farm ring, park, home yards ---- */
  const flowers: Flower[] = [];
  const addFlower = (x: number, z: number) =>
    flowers.push({ x, z, c: rnd(), s: range(rnd, 0.5, 1) });
  for (let i = 0; i < 200; i++) {
    const a = range(rnd, 0, Math.PI * 2), d = range(rnd, CITY_RADIUS + 6, FARM_RADIUS - 8);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (inAirportPlot(x, z)) continue;                         // keep the apron pretty
    if (nearRailway(x, z, 7) || inRailwayYard(x, z, 2)) continue;              // 🚂 no flowers on the branch line or in the yard
    if (fields.some((f) => Math.abs(x - f.x) < f.w + 1 && Math.abs(z - f.z) < f.d + 1)) continue;
    addFlower(x, z);
  }
  for (let i = 0; i < 34; i++) {
    const a = range(rnd, 0, Math.PI * 2), d = range(rnd, 10, PARK.r - 3);
    const x = PARK.x + Math.cos(a) * d, z = PARK.z + Math.sin(a) * d;
    if (Math.abs(x - PARK.x) < 5.5 || Math.abs(z - PARK.z) < 5.5) continue; // keep paths clear
    addFlower(x, z);
  }
  for (const b of buildings) {
    if (b.kind !== 2) continue;
    for (let i = 0; i < 4; i++) addFlower(b.x + range(rnd, -3.4, 3.4), b.z + b.fz * (b.d + range(rnd, 1.6, 4.6)));
  }

  /* ---- 7Nights International Airport (south-east, outside the ring highway) ----
   * Terminal + control tower are solid boxes; the hangar is three walk-through
   * walls with an OPEN front shutter — kids can walk in and admire the bizjet
   * parked inside. The runway & apron stay flat and walkable so kids can race
   * the planes. Planes live in the engine. */
  const AP_WALL = 0xe8e6e0;      // terminal shell
  const AP_GLASS = 0x9fc4d8;     // glass band colour (visuals drawn in WorldView)
  const AP_ROOF = 0x5a6472;
  push(AIRPORT.terminal.x, AIRPORT.terminal.z, AIRPORT.terminal.w, AIRPORT.terminal.d, AIRPORT.terminal.h, 0, AP_WALL, AP_ROOF);
  // tower shaft (the glazed cab + rotating radar are drawn by <Airport> in WorldView)
  push(AIRPORT.tower.x, AIRPORT.tower.z, AIRPORT.tower.r, AIRPORT.tower.r, AIRPORT.tower.h, 0, 0xd8d5cc, AP_ROOF);
  // hangar — three solid walls; the front (runway side) stays open under the
  // rolled-up shutter (header + drum + roof drawn by <Airport> in WorldView)
  const HW = AIRPORT.hangar.w, HD = AIRPORT.hangar.d, HH = AIRPORT.hangar.h;
  push(AIRPORT.hangar.x, AIRPORT.hangar.z + HD - 0.5, HW, 0.5, HH, 3, 0xb8bec8, 0x7a828e);          // back wall
  push(AIRPORT.hangar.x - HW + 0.5, AIRPORT.hangar.z, 0.5, HD, HH, 3, 0xb8bec8, 0x7a828e);          // west wall
  push(AIRPORT.hangar.x + HW - 0.5, AIRPORT.hangar.z, 0.5, HD, HH, 3, 0xb8bec8, 0x7a828e);          // east wall
  // apron floodlights + a few staff cars by the terminal
  pushLamp(AIRPORT.terminal.x - 18, AIRPORT.terminal.z - 14); pushLamp(AIRPORT.terminal.x + 18, AIRPORT.terminal.z - 14);
  pushLamp(AIRPORT.hangar.x + HW + 4, AIRPORT.hangar.z - 10);          // east yard (moved out of the now-walkable hangar)
  pushLamp(AIRPORT.hangar.x - HW - 6, AIRPORT.hangar.z + 6);           // west service yard (twin-prop parking)
  pushLamp(AIRPORT.windsock.x + 1, AIRPORT.helipad.z - 5);             // south lawn — the new helipad works after dark too
  // freight-ramp & fuel-farm floodlights (the east end of the airport works after dark too)
  pushLamp(AIRPORT.cargo.x - 8, AIRPORT.cargo.z + 6); pushLamp(AIRPORT.fuelTanks[1].x - 4, AIRPORT.fuelTanks[1].z - 8);
  for (let i = 0; i < 3; i++) cars.push({ x: AIRPORT.terminal.x - 10 + i * 9, z: AIRPORT.terminal.z + 8, rot: 0, c: (i + 5) % CAR_COLS.length, t: VEHICLE_POOL[(i * 3 + 2) % VEHICLE_POOL.length] });
  /* ⚰️ THE PHANTOM HEARSE — the graveyard's ONE unique car, parked on the
   * cemetery lane just inside the gate where the static prop always stood.
   * A real drivable vehicle now: walk up and the restless dead rise to
   * defend it (engine raiseHearseGuards) — slay the pack to claim the
   * fastest ride in town. Its axle colliders come from the cars.forEach
   * below like every other vehicle (the old static pair is gone).        */
  cars.push({ x: GRAVEKIT.hearse.x, z: GRAVEKIT.hearse.z, rot: GRAVEKIT.hearse.rot, c: 0, t: HEARSE_TYPE });
  // windsock pole near the runway threshold — the kit windsock draws its own mast

  /* ---- colliders ----
   * NOTE: tree circles are pushed FIRST, in tree order — tree index i is
   * ALWAYS circle index i, which is how the axe finds the collider to shrink
   * when a tree falls. Rock circles come right after, recorded in rockCi. */
  /* 🧍 ROOFTOPS ARE FLOORS — every building box carries a standable `top` (see
   * standTopAt): parachute onto a roof and STAND on it, hop tower-to-tower,
   * camp the night above the horde. Flat-roof kinds (towers, shops, mall,
   * school, hospital, police) stand on the roof slab — walls top out at h and
   * the slab spans h → h + 0.9. Pyramid roofs (homes & barns) stand at 55% up
   * the rise: boots read on the slope instead of sinking to the knees at the
   * apex or floating a body-length over the eaves. */
  const PYR_RISE = (kind: Building["kind"]) => (kind === 6 ? 3.4 : 2.3); // matches <Buildings> cone heights
  const boxes: BoxCollider[] = buildings.map((b) => ({
    x: b.x, z: b.z, w: b.w, d: b.d, h: b.h,
    top: b.kind === 2 || b.kind === 6 ? b.h + PYR_RISE(b.kind) * 0.55 : b.h + 0.9,
  }));
  /* 🏙️ CITY KIT — every kit building bakes a solid, STANDABLE collider box
   * (rooftops are floors: skydive onto the bank and stand on it). Tower base
   * skirts ride along as their own boxes so the setback tiers catch landings. */
  for (const g of CITYKIT.at) {
    boxes.push({ x: g.x, z: g.z, w: g.w, d: g.d, h: g.h, top: g.top ?? g.h });
    if (g.col) for (const c of g.col) boxes.push({ x: g.x + c.dx, z: g.z + c.dz, w: c.w, d: c.d, h: c.h, top: c.h });
  }
  const circles: CircleCollider[] = trees.map(({ x, z, r }) => ({ x, z, r }));
  circles.push({ x: PARK.x - 11, z: PARK.z + 11, r: 8.2 });               // park pond
  circles.push({ x: PARK.x, z: PARK.z, r: 3.6 });                          // fountain
  circles.push({ x: MUSEUM.x, z: MUSEUM.z, r: 26 });                       // museum rotunda podium (matches the visual base)
  for (const s of signs) circles.push({ x: s.x, z: s.z, r: 0.45 });        // placard posts
  // two circles per vehicle (front + rear axle) — a single centre circle let players
  // clip through the hood and boot. The axle spread follows the body style: a 7-long
  // city bus sits on discs 2.35 apart at r 1.42, a hatchback on 1.02 at r 1.12 —
  // so every body length stays protected. Tagged with the car index so a DRIVEN
  // vehicle can move its own colliders along (and skip them).
  cars.forEach((c, ci) => {
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    const ax = VEHICLE_AXLE[c.t] ?? 1.25, rr = VEHICLE_AXLE_R[c.t] ?? 1.16;
    // 🧍 every car is FURNITURE — its roof is a standable platform (jump on, sit,
    // hop roof-to-roof across a parking lot). The axle discs carry the top height.
    circles.push({ x: c.x - fx * ax, z: c.z - fz * ax, r: rr, car: ci, top: terrainHeight(c.x - fx * ax, c.z - fz * ax) + CAR_ROOF_TOP });
    circles.push({ x: c.x + fx * ax, z: c.z + fz * ax, r: rr, car: ci, top: terrainHeight(c.x + fx * ax, c.z + fz * ax) + CAR_ROOF_TOP });
  });
  for (const s of silos) circles.push({ x: s.x, z: s.z, r: 3.3 });
  for (const w of windmills) circles.push({ x: w.x, z: w.z, r: 0.8 });
  // 🏕️ jungle camps — the fire pit, every tent and the supply crates are SOLID
  // (log seats stay steppable — they're knee-high). The pit circle also doubles
  // as the anchor the engine's fire-logic reads via world.camps.
  for (const cp of camps) {
    circles.push({ x: cp.x, z: cp.z, r: 0.95 }); // fire pit — don't walk into the flames
    for (const t of cp.tents) circles.push({ x: cp.x + t.dx, z: cp.z + t.dz, r: 1.55 });
    for (const cr of cp.crates) circles.push({ x: cp.x + cr.dx, z: cp.z + cr.dz, r: 0.55, top: terrainHeight(cp.x + cr.dx, cp.z + cr.dz) + 0.9 });
    if (cp.pole) circles.push({ x: cp.x + cp.pole.dx, z: cp.z + cp.pole.dz, r: 0.3 });
  }
  /* ---- 🦕 prehistoric valley carve-out — the shared RNG stream never feels
   *  this: items already landed wherever the stream put them, and anything
   *  that drew a spot INSIDE the valley sector rotates +0.42 rad around the
   *  origin (same radius, same look) so the kit grounds stay unobstructed.
   *  Applied BEFORE any collider/render consumer reads these arrays.      */
  const unwrapOut = (x: number, z: number): { x: number; z: number } => {
    if (!inPrehistoricValley(x, z)) return { x, z };
    const a = Math.atan2(z, x) + 0.42, r = Math.hypot(x, z);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };
  for (let i = 0; i < rocks.length; i++) { const p = unwrapOut(rocks[i].x, rocks[i].z); rocks[i].x = p.x; rocks[i].z = p.z; }
  for (const sp of spires) { const p = unwrapOut(sp.x, sp.z); sp.x = p.x; sp.z = p.z; }
  if (lookout) { const p = unwrapOut(lookout.x, lookout.z); lookout.x = p.x; lookout.z = p.z; }

  // 🔨 breakable boulders — each rock owns one solid collider tagged with its
  // index (rock:i); its slot is ALSO recorded in rockCi so the hammer can
  // shrink it to rubble when it finally cracks.
  rocks.forEach((rk, i) => {
    rockCi.push(circles.length);
    // 🪨 boulders are climbable — hop on top and use them as watch perches
    circles.push({ x: rk.x, z: rk.z, r: 0.8 * rk.s, rock: i, top: terrainHeight(rk.x, rk.z) + 0.85 * rk.s });
  });
  // 🧱 builder pool — dormant circles parked under the museum podium (r≈0 never
  // collides). moveCircle() teleports one onto a build spot; reset() brings it back.
  for (let i = 0; i < BUILD_POOL; i++) circles.push({ x: MUSEUM.x, z: MUSEUM.z, r: 0.001, build: i });
  /* ---- 🚂 countryside railway — the kit furniture is solid (the track bed stays walkable) ---- */
  for (const c of RAILKIT.cols) circles.push(c);
  /* ---- 🚜 cozy farm kit — the barnyard is solid ---- */
  for (const hb of FARMKIT.bales) circles.push({ x: hb.x, z: hb.z, r: 1.05, top: terrainHeight(hb.x, hb.z) + 1.05 });  // hay bales — big soft stepping stones
  for (const sc of FARMKIT.scarecrows) circles.push({ x: sc.x, z: sc.z, r: 0.4 });        // scarecrow posts
  for (const cp of FARMKIT.coops) circles.push({ x: cp.x, z: cp.z, r: 1.6, top: terrainHeight(cp.x, cp.z) + 1.35 });          // chicken coops
  circles.push({ x: FARMKIT.tractor.x, z: FARMKIT.tractor.z, r: 1.5, top: terrainHeight(FARMKIT.tractor.x, FARMKIT.tractor.z) + 1.55 }); // parked tractor
  circles.push({ x: FARMKIT.well.x, z: FARMKIT.well.z, r: 1.2, top: terrainHeight(FARMKIT.well.x, FARMKIT.well.z) + 1.25 });               // stone well
  /* ---- 🎃 graveyard estate — fenced all around, one real gate ---- */
  boxes.push({ x: GRAVEKIT.house.x, z: GRAVEKIT.house.z, w: 10, d: 10, h: 13 });          // haunted Victorian house (kit, 12u footprint)
  boxes.push({ x: GRAVEKIT.mausoleum.x, z: GRAVEKIT.mausoleum.z, w: 3.4, d: 3.4, h: 5 }); // family mausoleum (kit)
  // (the vintage hearse is a REAL drivable car now — its axle colliders are
  // pushed by the cars.forEach above, tagged with its car index)
  for (const ln of GRAVEKIT.lanterns) circles.push({ x: ln.x, z: ln.z, r: 0.3 });         // lantern posts
  for (const ok of GRAVEKIT.oaks) circles.push({ x: ok.x, z: ok.z, r: 0.55 });            // twisted dead oaks (kit, 8u crown)
  for (const fc of GRAVEKIT.fenceCols) circles.push({ x: fc.x, z: fc.z, r: 0.4 });        // iron fence ring (solid, gate span open)
  circles.push({ x: GRAVEKIT.gate.x + GRAVEKIT.v.x * 1.9, z: GRAVEKIT.gate.z + GRAVEKIT.v.z * 1.9, r: 0.35 }); // gate arch posts
  circles.push({ x: GRAVEKIT.gate.x - GRAVEKIT.v.x * 1.9, z: GRAVEKIT.gate.z - GRAVEKIT.v.z * 1.9, r: 0.35 });
  for (const bu of GRAVEKIT.bushes) circles.push({ x: bu.x, z: bu.z, r: 0.5 });           // bare thorn bushes
  for (const an of GRAVEKIT.angels) circles.push({ x: an.x, z: an.z, r: 0.5 });           // weeping stone angels
  /* ---- 🚧 construction sites — the machines & yard furniture are solid ---- */
  for (const site of SITEKIT.at) {
    for (const b of site.boxes) boxes.push(b);
    for (const c of site.cols) circles.push(c);
  }
  /* ---- 🏥 St. Cross Medical Campus — kit buildings & yard furniture are solid ---- */
  boxes.push({ x: HOSPKIT.ward.x, z: HOSPKIT.ward.z, w: HOSPKIT.ward.w, d: HOSPKIT.ward.d, h: HOSPKIT.ward.h });       // ward block (kit, 12×8 footprint)
  boxes.push({ x: HOSPKIT.core.x, z: HOSPKIT.core.z, w: HOSPKIT.core.w, d: HOSPKIT.core.d, h: HOSPKIT.core.h });       // stair & lift core
  boxes.push({ x: HOSPKIT.annexe.x, z: HOSPKIT.annexe.z, w: HOSPKIT.annexe.w, d: HOSPKIT.annexe.d, h: HOSPKIT.annexe.h }); // clinic annexe
  boxes.push({ x: HOSPKIT.er.x, z: HOSPKIT.er.z, w: HOSPKIT.er.w, d: HOSPKIT.er.d, h: HOSPKIT.er.h });                 // emergency block
  boxes.push({ x: HOSPKIT.generator.x, z: HOSPKIT.generator.z, w: 1.9, d: 0.9, h: 3.55 }); // standby generator enclosure
  for (const fc of HOSPKIT.fenceCols) circles.push({ x: fc.x, z: fc.z, r: 0.35 });         // mesh-fence ring (gate span open)
  for (const am of HOSPKIT.ambulances) {                                                   // ambulances — two axle circles each
    const fx = Math.sin(am.rot), fz2 = Math.cos(am.rot);
    circles.push({ x: am.x - fx * 1.6, z: am.z - fz2 * 1.6, r: 1.3 });
    circles.push({ x: am.x + fx * 1.6, z: am.z + fz2 * 1.6, r: 1.3 });
  }
  for (const bo of HOSPKIT.bollards) circles.push({ x: bo.x, z: bo.z, r: 0.28 });          // illuminated bollards
  circles.push({ x: HOSPKIT.totem.x, z: HOSPKIT.totem.z, r: 0.45 });                       // wayfinding totem
  for (const wc of HOSPKIT.wheelchairs) circles.push({ x: wc.x, z: wc.z, r: 0.4 });        // parked wheelchairs
  for (const gc of HOSPKIT.gasCylinders) circles.push({ x: gc.x, z: gc.z, r: 0.25 });      // medical gas cylinders
  for (const bn of HOSPKIT.bins) circles.push({ x: bn.x, z: bn.z, r: 0.4 });               // clinical waste bins
  /* ---- 🦕 prehistoric valley — thermal features, big bones & the BIG locals
   *  are solid (layout + colliders generated together in prehistoric.ts so
   *  the render and the grid can never disagree). Little raptors & compys
   *  wander collider-free — they're knee-high.                            ---- */
  for (const pc of prehistoricColliders()) circles.push({ x: pc.x, z: pc.z, r: pc.r });
  /* ---- 🗽 NYC district — solid street furniture (subway rails, kiosks, cabs…) ---- */
  for (const sb of NYC.solidBoxes) boxes.push(sb);
  for (const sc of NYC.solidCircles) circles.push(sc);
  /* ---- ✈️ airport city-kit — fuel farm, parked aircraft & terminal furniture are solid ---- */
  for (const ft of AIRPORT.fuelTanks)                        // one clean box per tank shell
    boxes.push({ x: ft.x, z: ft.z, w: 6.5, d: 6.5, h: 5.5 });
  boxes.push({ x: AIRPORT.pumpHouse.x, z: AIRPORT.pumpHouse.z, w: 1.1, d: 0.85, h: 3 });   // fuel pump house
  boxes.push({ x: AIRPORT.gate.x, z: AIRPORT.gate.z, w: 0.85, d: 0.85, h: 3.2 });          // barrier gate house
  circles.push({ x: AIRPORT.gate.x + 5, z: AIRPORT.gate.z, r: 0.35 });                     // barrier pivot post
  circles.push({ x: AIRPORT.vorCol.x, z: AIRPORT.vorCol.z, r: AIRPORT.vorCol.r });         // VOR antenna pad
  for (const c of AIRPORT.jetCols) circles.push(c);          // parked business jet fuselage
  for (const c of AIRPORT.cargoCols) circles.push(c);        // parked cargo freighter fuselage
  for (const c of AIRPORT.airlinerCols) circles.push(c);     // parked narrow-body airliner fuselage
  for (const c of AIRPORT.turbopropCols) circles.push(c);    // parked regional turboprop fuselage
  for (const c of AIRPORT.heliCols) circles.push(c);         // helicopter on the pad
  for (const c of AIRPORT.pistonCols) circles.push(c);       // twin-piston light aircraft (service yard, hangar side)
  circles.push(AIRPORT.singlepropCol);                       // single-prop light aircraft (back lawn storage)
  for (const k of AIRPORT.kiosks) circles.push({ x: k.x, z: k.z, r: 0.5 });                // check-in kiosks
  boxes.push({ x: AIRPORT.xray.x, z: AIRPORT.xray.z, w: 3.75, d: 0.7, h: 1.5 });           // x-ray conveyor
  circles.push({ x: AIRPORT.passport.x, z: AIRPORT.passport.z, r: 1.25 });                 // passport booth
  circles.push({ x: AIRPORT.arch.x - 0.8, z: AIRPORT.arch.z, r: 0.28 });                   // security arch legs
  circles.push({ x: AIRPORT.arch.x + 0.8, z: AIRPORT.arch.z, r: 0.28 });
  circles.push({ x: AIRPORT.windsock.x, z: AIRPORT.windsock.z, r: 0.35 });                 // windsock mast (south lawn, by the helipad)
  /* ---- 🌲 nature & forest kit — the wild band's solid furniture ---- */
  for (const c2 of cabins) boxes.push({ x: c2.x, z: c2.z, w: 2.9, d: 2.9, h: 4.2 });       // log cabins
  if (rangerPos) boxes.push({ x: rangerPos.x, z: rangerPos.z, w: 3.4, d: 2.9, h: 4.6 });   // ranger station
  if (lookout) for (const [lx, lz] of [[2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]] as const)
    circles.push({ x: lookout.x + lx, z: lookout.z + lz, r: 0.5 });                          // lookout tower legs
  for (const tr of trucks) circles.push({ x: tr.x, z: tr.z, r: 1.55 });                     // parked ranger pickups
  for (const sp of spires) circles.push({ x: sp.x, z: sp.z, r: 0.75 * sp.s });              // rock spires
  for (const k of kiosks) circles.push({ x: k.x, z: k.z, r: 0.85 });                        // trail map kiosks
  for (const tp of trailPosts) circles.push({ x: tp.x, z: tp.z, r: 0.22 });                 // signpost & lantern posts
  for (const bh of birdhouses) circles.push({ x: bh.x, z: bh.z, r: 0.16 });                 // birdhouse posts
  for (const hc of handcarts) circles.push({ x: hc.x, z: hc.z, r: 0.7 });                   // wooden hand carts
  for (const cb of chopBlocks) circles.push({ x: cb.x, z: cb.z, r: 0.5 });                  // chopping blocks
  for (const fw of firewood) circles.push({ x: fw.x, z: fw.z, r: 0.75 });                   // firewood stacks
  for (const ws of woodsheds) boxes.push({ x: ws.x, z: ws.z, w: 2.6, d: 1.7, h: 3.4 });     // open woodsheds
  // 🌲 jungle ponds — the deep middle blocks waders; banks, docks & bridges stay walkable
  for (const p of ponds) circles.push({ x: p.x, z: p.z, r: p.r * 0.62 });
  // 🌲 camp kit — picnic tables, lean-to, outhouse & water barrel are solid
  for (const cp of camps) {
    for (const pc of cp.kit.picnic) circles.push({ x: cp.x + pc.dx, z: cp.z + pc.dz, r: 0.95 });
    if (cp.kit.leanTo) circles.push({ x: cp.x + cp.kit.leanTo.dx, z: cp.z + cp.kit.leanTo.dz, r: 1.5 });
    if (cp.kit.outhouse) circles.push({ x: cp.x + cp.kit.outhouse.dx, z: cp.z + cp.kit.outhouse.dz, r: 0.85 });
    if (cp.kit.barrel) circles.push({ x: cp.x + cp.kit.barrel.dx, z: cp.z + cp.kit.barrel.dz, r: 0.5 });
  }
  // every circle remembers its array slot — the driven car refreshes its grid cells via this
  for (let i = 0; i < circles.length; i++) circles[i].idx = i;

  /* ---- 🐜 INSECT WORLD — the meadow's micro-scaled landmarks ----
   * Bug villages (ant nests + mushroom rings + flower patches + tiny human
   * treasures) in the GRASS FIELDS between city & farm, a few near the farm
   * fields themselves, and singles scattered at random anywhere wild enough.
   * All steppable decor — nothing solid, pure world flavour. */
  const insectProps: { k: string; x: number; z: number; rot: number; s: number }[] = [];
  /** per-kit-key target height (world units) — the shrink-ray sizes */
  const KIT_SIZE: Record<string, number> = {
    glowShroom: 0.5, puffball: 0.42, daisy: 0.45, dandelion: 0.55, clover: 0.3,
    grassPlant: 0.62, moss: 0.3, seedling: 0.28, nestMound: 1.0, nestChamber: 0.9,
    orbWeb: 0.9, hotel: 1.5, waspNest: 1.1, waspPot: 0.4, honeycomb: 1.2,
    flowerpot: 0.8, matchbox: 0.5, bottleCap: 0.22, marble: 0.18, button: 0.16,
    matchstick: 0.5, sugarCube: 0.16, sunflowerSeed: 0.2, eggshell: 0.35,
    acorn: 0.3, pineCone: 0.45, oakLeaf: 0.35, twig: 0.5, feather: 0.4,
    petal: 0.18, blackberry: 0.3, dewdrop: 0.14, pebble: 0.25, slate: 0.2,
    cocoon: 0.3, chrysalis: 0.22, dandelionSeed: 0.12,
  };
  const FLORA_KEYS = ["daisy", "dandelion", "clover", "grassPlant", "moss", "glowShroom", "puffball", "seedling", "oakLeaf", "twig"] as const;
  const TREASURE_KEYS = ["bottleCap", "marble", "button", "acorn", "matchstick", "sugarCube", "sunflowerSeed", "eggshell", "dewdrop", "feather", "petal", "pineCone", "blackberry", "chrysalis", "cocoon", "dandelionSeed", "pebble", "slate"] as const;
  const pushInsect = (k: string, x: number, z: number, rot = range(rnd, 0, 6.283)) => {
    const s = KIT_SIZE[k];
    if (s) insectProps.push({ k, x, z, rot, s: s * range(rnd, 0.8, 1.25) });
  };
  // 🐜 six bug villages — three in the grass fields near the farm, three deeper out
  for (let v = 0; v < 6; v++) {
    const deep = v >= 3;
    let cx = 0, cz = 0, placed = false;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const a = range(rnd, 0, Math.PI * 2);
      const rr = deep ? range(rnd, DEEP_JUNGLE_RADIUS - 55, DEEP_JUNGLE_RADIUS - 8) : range(rnd, CITY_RADIUS + 14, FARM_RADIUS + 46);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!clearOf(x, z, 3.2)) continue;
      if (fields.some((f) => Math.abs(x - f.x) < f.w + 3 && Math.abs(z - f.z) < f.d + 3)) continue;
      cx = x; cz = z; placed = true;
    }
    if (!placed) continue;
    // the village heart: an ant nest complex (mound + chamber + tunnel run of pupae)
    pushInsect("nestMound", cx, cz);
    pushInsect("nestChamber", cx + range(rnd, 1.6, 2.6), cz + range(rnd, -1.8, 1.8));
    if (v % 2 === 0) pushInsect("cocoon", cx + range(rnd, -2.4, -1.4), cz + range(rnd, 1.2, 2.4));
    // landmark extras alternate per village — insect hotel, orb web, wasp nest, honeycomb
    const landmark = (["hotel", "orbWeb", "waspNest", "honeycomb", "waspPot", "flowerpot"] as const)[v];
    pushInsect(landmark, cx + range(rnd, -3.4, 3.4), cz + range(rnd, -3.4, 3.4));
    // the meadow floor: daisies, clover, mushrooms, grass, moss…
    for (let i = 0; i < 11; i++) {
      const a = range(rnd, 0, Math.PI * 2), d = range(rnd, 1.8, 7.5);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!clearOf(x, z, 0.8)) continue;
      pushInsect(FLORA_KEYS[Math.floor(rnd() * FLORA_KEYS.length)], x, z);
    }
    // the kit's shrunk treasures — a bottle cap here, a lost button there
    for (let i = 0; i < 5; i++) {
      const a = range(rnd, 0, Math.PI * 2), d = range(rnd, 2.2, 8.5);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!clearOf(x, z, 0.6)) continue;
      pushInsect(TREASURE_KEYS[Math.floor(rnd() * TREASURE_KEYS.length)], x, z);
    }
  }
  // 🍄 stray singles — glowing mushrooms & webs anywhere wild, treasures near trails
  n = 0;
  while (n < 46 && n < 900) {
    const a = range(rnd, 0, Math.PI * 2);
    const rr = range(rnd, 26, DEEP_JUNGLE_RADIUS - 10);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!clearOf(x, z, 1.1)) continue;
    const pool = rr < CITY_RADIUS + 4
      ? TREASURE_KEYS
      : Math.floor(rnd() * 3) === 0 ? (["glowShroom", "puffball", "orbWeb", "nestMound", "waspPot"] as const) : FLORA_KEYS;
    pushInsect(pool[Math.floor(rnd() * pool.length)], x, z);
    n++;
  }

  /* 🧍 every remaining BUILT structure is standable too — kit buildings (the
   * hospital ward/core/annexe/ER, the Victorian house, airport terminal &
   * tower, log cabins, ranger station, site cabins, construction cores, NYC
   * solids, fuel tanks, woodsheds): their `h` already IS their roof height.
   * Boxes that tagged their own lower tops earlier (crate stacks, scaffold
   * bays) keep theirs — the blanket only fills the gaps. */
  for (const b of boxes) {
    if (b.top === undefined && b.h !== undefined && b.h >= 1.1) b.top = b.h;
  }

  return { buildings, trees, rocks, rockCi, flowers, boxes, circles, cars, lamps, benches, fields, silos, umbrellas, signs, windmills, camps, ponds, ferns, tufts, shrooms, bushes, wilds, stumps, logs, reeds, pads, stones, spires, cabins, ranger: rangerPos, lookout, trucks, bridges, docks, boats, kiosks, trailPosts, trails: trailPts, birdhouses, handcarts, chopBlocks, firewood, woodsheds, insectProps, grid: buildColliderGrid(boxes, circles) };
}

/**
 * Teleport a DYNAMIC circle (builder pool) to a new spot & radius, re-registering
 * its collider-grid cells — the same trick the driven car uses, for player-built
 * 🧱 barricades. Call with r=0.001 at the pool origin to "remove" a build.
 */
export function moveCircle(world: World, gi: number, x: number, z: number, r: number): void {
  const c = world.circles[gi];
  if (!c) return;
  c.x = x; c.z = z; c.r = r;
  refreshCarCircle(world, gi);
}

/** Push a point out of every collider it overlaps. skipCar: while driving car #n,
 *  that car's own axle circles are skipped so the body doesn't shove itself.
 *  feetY (optional): the body's foot height — colliders with a standable `top`
 *  the feet are already at/above don't push sideways anymore (the body is ON
 *  that platform). This is what lets a kid climb crates, boulders & car roofs.
 *  Uses the spatial hash (a handful of neighbouring colliders) instead of the
 *  old full-world scan — the single biggest frame-time win, especially while
 *  driving, where the car spends up to 16 resolve calls per frame. Colliders are
 *  gathered from every cell the sweep circle touches, sorted box-then-circle (the
 *  old scan's order) and the pass repeats until stable, so a push that slides the
 *  point into a collider one cell over is still caught. */
const resolveScratch: number[] = [];
export function resolve(p: { x: number; z: number }, radius: number, world: World, skipCar = -1, feetY?: number): void {
  const g = world.grid;
  const boxes = world.boxes, circles = world.circles;
  if (g) {
    for (let iter = 0; iter < 4; iter++) {
      // gather every collider registered in the cells the sweep circle touches
      resolveScratch.length = 0;
      const gx0 = Math.max(0, Math.floor((p.x - radius - g.x0) / g.cs));
      const gx1 = Math.min(g.cols - 1, Math.floor((p.x + radius - g.x0) / g.cs));
      const gz0 = Math.max(0, Math.floor((p.z - radius - g.z0) / g.cs));
      const gz1 = Math.min(g.rows - 1, Math.floor((p.z + radius - g.z0) / g.cs));
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const cell = g.cells[gz * g.cols + gx];
          for (let k = 0; k < cell.length; k++) resolveScratch.push(cell[k]);
        }
      }
      if (resolveScratch.length === 0) return;
      // same order as the old linear scan: all boxes first, then circles (a collider
      // registered in two queried cells appears twice — the second test always no-ops)
      if (resolveScratch.length > 1) resolveScratch.sort((a, b) => a - b);
      let pushed = false;
      for (let k = 0; k < resolveScratch.length; k++) {
        const idx = resolveScratch[k];
        if (idx < g.nb) {
          const b = boxes[idx];
          // 🧍 standing on a climbable box (crate stack, low wall) — no side push
          if (b.top !== undefined && feetY !== undefined && feetY >= b.top - 0.55) continue;
          const dx = p.x - b.x, dz = p.z - b.z;
          const ox = b.w + radius - Math.abs(dx), oz = b.d + radius - Math.abs(dz);
          if (ox > 0 && oz > 0) {
            if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1);
            else p.z += oz * (dz < 0 ? -1 : 1);
            pushed = true;
          }
        } else {
          const c = circles[idx - g.nb];
          if (skipCar >= 0 && c.car === skipCar) continue;
          // 🧍 feet at/above a climbable top (boulder, crate, CAR ROOF) — the
          // body is standing ON it, so no sideways shove (walking across works)
          if (c.top !== undefined && feetY !== undefined && feetY >= c.top - 0.55) continue;
          const dx = p.x - c.x, dz = p.z - c.z;
          const rr = c.r + radius;
          if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            pushed = true;
            const d = Math.sqrt(d2);
            // dead-centre inside the circle has no push direction — pick east so the
            // point can never get permanently stuck (e.g. teleports into a collider)
            if (d < 0.01) { p.x = c.x + rr; continue; }
            p.x = c.x + (dx / d) * rr;
            p.z = c.z + (dz / d) * rr;
          }
        }
      }
      if (!pushed) return; // fully clear — done (the usual case: one cheap gather)
    }
    return;
  }
  for (const b of boxes) {
    if (b.top !== undefined && feetY !== undefined && feetY >= b.top - 0.55) continue;
    const dx = p.x - b.x, dz = p.z - b.z;
    const ox = b.w + radius - Math.abs(dx), oz = b.d + radius - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1);
      else p.z += oz * (dz < 0 ? -1 : 1);
    }
  }
  for (const c of circles) {
    if (skipCar >= 0 && c.car === skipCar) continue;
    if (c.top !== undefined && feetY !== undefined && feetY >= c.top - 0.55) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const rr = c.r + radius;
    if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2);
      if (d < 0.01) { p.x = c.x + rr; continue; }
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
}

/** 🧍 the highest STANDABLE surface at (x, z) the feet can rest on — cars' roofs,
 *  boulders, crates, hay bales, scaffold bays, precast stacks… Only colliders
 *  tagged with a `top` count, and only ones whose surface is at or below
 *  `feetY + gate` (the gate = how far a step-up can lift you: 0.02 while
 *  falling → you land ON it; 0.55 while walking → low bricks step up like ramps).
 *  Returns −Infinity when nothing standable is underfoot, so the caller's
 *  max(terrain, platform) falls through to the TERRAIN — with the old 0 floor
 *  a body could never descend below grade and floated over the 🚧 construction
 *  digs on invisible ground. */
export function standTopAt(world: World, x: number, z: number, feetY: number, gate = 0.02): number {
  const g = world.grid;
  const boxes = world.boxes, circles = world.circles;
  let best = -Infinity;
  const probe = (bx: number, bz: number) => {
    // gather the handful of colliders around the point straight from the grid
    if (!g) {
      for (const b of boxes) {
        if (b.top !== undefined && b.top <= feetY + gate
          && Math.abs(bx - b.x) <= b.w + 0.12 && Math.abs(bz - b.z) <= b.d + 0.12 && b.top > best) best = b.top;
      }
      for (const c of circles) {
        const dx = bx - c.x, dz = bz - c.z;
        if (c.top !== undefined && c.top <= feetY + gate && dx * dx + dz * dz <= (c.r + 0.3) * (c.r + 0.3) && c.top > best) best = c.top;
      }
      return;
    }
    const gx0 = Math.max(0, Math.floor((bx - 1 - g.x0) / g.cs));
    const gx1 = Math.min(g.cols - 1, Math.floor((bx + 1 - g.x0) / g.cs));
    const gz0 = Math.max(0, Math.floor((bz - 1 - g.z0) / g.cs));
    const gz1 = Math.min(g.rows - 1, Math.floor((bz + 1 - g.z0) / g.cs));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cell = g.cells[gz * g.cols + gx];
        for (let k = 0; k < cell.length; k++) {
          const idx = cell[k];
          if (idx < g.nb) {
            const b = boxes[idx];
            if (b.top === undefined || b.top > feetY + gate) continue;
            if (Math.abs(bx - b.x) <= b.w + 0.12 && Math.abs(bz - b.z) <= b.d + 0.12 && b.top > best) best = b.top;
          } else {
            const c = circles[idx - g.nb];
            if (c.top === undefined || c.top > feetY + gate) continue;
            const dx = bx - c.x, dz = bz - c.z;
            if (dx * dx + dz * dz <= (c.r + 0.3) * (c.r + 0.3) && c.top > best) best = c.top;
          }
        }
      }
    }
  };
  probe(x, z);
  return best;
}

/** All boxes overlapping the disk (x, z, r) — fed by the spatial hash. */
function boxesNear(world: World, x: number, z: number, r: number, out: BoxCollider[]): void {
  out.length = 0;
  const g = world.grid;
  if (!g) { for (const b of world.boxes) out.push(b); return; }
  const gx0 = Math.max(0, Math.floor((x - r - g.x0) / g.cs));
  const gx1 = Math.min(g.cols - 1, Math.floor((x + r - g.x0) / g.cs));
  const gz0 = Math.max(0, Math.floor((z - r - g.z0) / g.cs));
  const gz1 = Math.min(g.rows - 1, Math.floor((z + r - g.z0) / g.cs));
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      for (const idx of g.cells[gz * g.cols + gx]) {
        if (idx < g.nb) {
          const b = world.boxes[idx];
          if (!out.includes(b)) out.push(b); // cells overlap — same box can show up twice
        }
      }
    }
  }
}

/** True if the segment between two points is roughly clear of buildings (cheap LOS). */
export function lineClear(ax: number, az: number, bx: number, bz: number, world: World): boolean {
  const steps = Math.min(24, Math.max(4, Math.floor(Math.hypot(bx - ax, bz - az) / 2)));
  const near: BoxCollider[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    boxesNear(world, x, z, 0.4, near);
    for (const b of near)
      if (Math.abs(x - b.x) < b.w + 0.4 && Math.abs(z - b.z) < b.d + 0.4) return false;
  }
  return true;
}

/**
 * Is a 3D sample point inside anything TALL enough to block the chase camera —
 * a building, a tree canopy or a street lamp? The camera pull-in test samples a
 * handful of points along the focus→camera segment with this, so a lamp post or
 * a hedge can never stare straight down the lens and read as "my car vanished".
 * (Trees: canopy base 2.6·s wide topping at ~9.3·s with r = 0.7·s — see <Forest>.)
 */
export function camBlocked(x: number, y: number, z: number, world: World): boolean {
  for (const b of world.boxes)
    if (Math.abs(x - b.x) < b.w + 0.4 && Math.abs(z - b.z) < b.d + 0.4 && y < (b.h ?? 5) + 0.6) return true;
  for (const t of world.trees)
    if (y < 13.4 * t.r && (x - t.x) * (x - t.x) + (z - t.z) * (z - t.z) < 3.7 * t.r * (3.7 * t.r)) return true;
  for (const l of world.lamps)
    if (y < 6.2 && (x - l.x) * (x - l.x) + (z - l.z) * (z - l.z) < 0.75 * 0.75) return true;
  return false;
}

/**
 * Find a random free spot in a ring/disk, nudged out of colliders.
 * The radius is AREA-uniform (d = √lerp) so spawns spread evenly across the whole
 * disk — a plain `range(inner, outer)` radius piles 3× more bots into the downtown
 * core than the outskirts, which read as "every bot spawns in the same place".
 */
export function freeSpot(
  r: () => number, world: World,
  inner: number, outer: number,
  avoid: { x: number; z: number; r: number }[] = [],
): { x: number; z: number } {
  for (let i = 0; i < 40; i++) {
    const a = range(r, 0, Math.PI * 2), d = Math.sqrt(range(r, inner * inner, outer * outer));
    let x = Math.cos(a) * d, z = Math.sin(a) * d;
    const before = { x, z };
    resolve(before, 0.9, world);
    if (Math.abs(before.x - x) > 0.05 || Math.abs(before.z - z) > 0.05) continue;
    x = before.x; z = before.z;
    let ok = true;
    for (const av of avoid) if (Math.hypot(x - av.x, z - av.z) < av.r) { ok = false; break; }
    if (ok) return { x, z };
  }
  // Fallback: start at the classic fallback point but always push it OUT of every
  // avoid circle (never next to the player spawn). Avoid-push runs LAST because
  // collider overlaps self-heal every frame (stepBody/stepNpc re-resolve) while
  // avoid-circle overlaps would permanently re-create the spawn-camping bug.
  let fx = 0, fz = 12;
  const fb = { x: fx, z: fz };
  for (const av of avoid) {
    const dx = fb.x - av.x, dz = fb.z - av.z;
    const d = Math.hypot(dx, dz) || 0.01;
    if (d < av.r + 4) { fb.x = av.x + (dx / d) * (av.r + 4); fb.z = av.z + (dz / d) * (av.r + 4); }
  }
  resolve(fb, 0.9, world);
  for (const av of avoid) {
    const dx = fb.x - av.x, dz = fb.z - av.z;
    const d = Math.hypot(dx, dz) || 0.01;
    if (d < av.r + 2) { fb.x = av.x + (dx / d) * (av.r + 2); fb.z = av.z + (dz / d) * (av.r + 2); }
  }
  return { x: fb.x, z: fb.z };
}

/**
 * A free spot in a ring AROUND a moving anchor (bot's current position) — used for
 * wander targets & patrol beats so bots stroll their own neighbourhood instead of
 * beelining across the whole city (and all bunching up downtown).
 */
export function spotNear(
  r: () => number, world: World,
  x: number, z: number, rMin: number, rMax: number,
): { x: number; z: number } {
  for (let i = 0; i < 24; i++) {
    const a = range(r, 0, Math.PI * 2);
    const d = Math.sqrt(range(r, rMin * rMin, rMax * rMax));
    const p = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
    const rr = Math.hypot(p.x, p.z);
    if (rr > CITY_RADIUS - 6) continue; // keep strolls inside the city walls
    const before = { x: p.x, z: p.z };
    resolve(before, 0.9, world);
    if (Math.abs(before.x - p.x) > 0.05 || Math.abs(before.z - p.z) > 0.05) continue;
    return { x: before.x, z: before.z };
  }
  return { x, z }; // nowhere clear nearby — just loiter where you are
}

/**
 * `count` free spawn points with a minimum gap between them (soft Poisson-disc).
 * Each pick takes the first candidate that clears `minGap` from every accepted
 * point; after 22 tries it takes the widest-gap candidate seen so far — spawns
 * never come out clumped in one corner of the map.
 */
export function scatterSpots(
  r: () => number, world: World,
  count: number, inner: number, outer: number, minGap: number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    let best: { x: number; z: number } | null = null;
    let bestGap = -1;
    for (let t = 0; t < 22; t++) {
      const a = range(r, 0, Math.PI * 2);
      const d = Math.sqrt(range(r, inner * inner, outer * outer));
      const before = { x: Math.cos(a) * d, z: Math.sin(a) * d };
      resolve(before, 0.9, world);
      if (Math.abs(before.x - Math.cos(a) * d) > 0.05 || Math.abs(before.z - Math.sin(a) * d) > 0.05) continue;
      let gap = Infinity;
      for (const q of out) gap = Math.min(gap, Math.hypot(before.x - q.x, before.z - q.z));
      if (gap >= minGap) { best = { x: before.x, z: before.z }; break; }
      if (gap > bestGap) { bestGap = gap; best = { x: before.x, z: before.z }; }
    }
    out.push(best ?? { x: 0, z: 12 });
  }
  return out;
}
