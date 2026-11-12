import { AIRPORT, BUILD_POOL, CITY_RADIUS, DEEP_JUNGLE_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, MOUNTAIN_INNER, MOUNTAIN_OUTER, MUSEUM, POLICE_STATIONS, ROCK_COUNT, VEHICLE_AXLE, VEHICLE_AXLE_R, VEHICLE_POOL, WALL_RADIUS, WORLD_SEED, pickVehicle, stationCage, stationGate } from "./constants";
import { mulberry32, range } from "./rng";

export interface BoxCollider { x: number; z: number; w: number; d: number; /** building height (top y) — lets the chase camera ignore roofs above it */ h?: number } // half extents
export interface CircleCollider { x: number; z: number; r: number; /** set for the two axle circles of a parked car — lets a DRIVEN car skip its own colliders */ car?: number; /** set on the ✈️ fuselage discs that follow a grounded plane (index into engine.planes) */ plane?: number; /** plane discs fold away once the plane climbs — false while grounded/taxiing */ air?: boolean; /** index inside world.circles — lets a DRIVEN car refresh its grid cells on every move */ idx?: number; /** set on the 🔨 breakable boulder this circle belongs to (index into world.rocks) */ rock?: number; /** set on the 🧱 builder pool circles — they MOVE onto built spots via moveCircle */ build?: number }

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
export interface Tree { x: number; z: number; r: number; s: number; kind: 0 | 1 }
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
}

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
  const N = 15;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + range(rnd, -0.1, 0.1);
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
  for (let i = 0; i < 12; i++) {
    const a = range(rnd, 0, Math.PI * 2), d = range(rnd, MOUNTAIN_INNER + 16, MOUNTAIN_OUTER - 8);
    list.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, R: range(rnd, 15, 23), h: range(rnd, 6, 13), k: 1.5, r1: 3, r2: 5, p1: range(rnd, 0, 6.283), p2: range(rnd, 0, 6.283) });
  }
  return list;
})();

/** Ground height of the playable ⛰️ band (0 everywhere else). Climbing slows you
 *  the steeper it gets — see stepBody. NEVER make this expensive: it runs per frame. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < MOUNTAIN_INNER - 10 || r > MOUNTAIN_OUTER + 14) return 0;
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
      rot: -(a + Math.PI / 2),
    });
  }
  // the 15:07 to somewhere — locomotive + two carriages + brake van at the platform
  const stock: RailwayCfg["stock"] = [];
  const kinds: (0 | 1 | 2)[] = [0, 1, 1, 2];
  for (let i = 0; i < 4; i++) {
    const a = 1.945 + i * 0.0208;
    stock.push({ x: Math.cos(a) * RAIL_R, z: Math.sin(a) * RAIL_R, rot: -(a + Math.PI / 2), kind: kinds[i] });
  }
  const ends = [RAIL_A0, RAIL_A1].map((a) => ({
    x: Math.cos(a) * RAIL_R, z: Math.sin(a) * RAIL_R, rot: -(a + Math.PI / 2),
  }));
  return { R: RAIL_R, a0: RAIL_A0, a1: RAIL_A1, station: { a: 2.05 }, crossing: { a: Math.PI / 2 }, poles, stock, ends };
})();

/** 🚂 helper — world position + facing of a point at angle `a` offset `off` from the rail centre */
export function railPoint(a: number, off = 0): { x: number; z: number; rot: number } {
  const r = RAILWAY.R + off;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, rot: -(a + Math.PI / 2) };
}
/** the country station house sits just inside the platform, and the crossing
 *  keeper's cottage guards the farm lane at the level crossing */
export const RAILWAY_stationHouse = railPoint(RAILWAY.station.a, -14.5);
export const RAILWAY_crossCottage = { x: 9.5, z: RAILWAY.R - 9 };
export const RAILWAY_waterTower = railPoint(RAILWAY.station.a + 0.055, -20);
export const RAILWAY_signalBox = railPoint(RAILWAY.station.a - 0.055, -20);

/* ---------------- 🚜 cozy farm kit — the farmsteads grow real furniture ----------------
 * Everything is derived from the barn positions + crop fields so worldgen
 * colliders and the WorldView render stay in lock-step. Deterministic. */
export const FIELDS_BASE: { x: number; z: number; rot: number; crop: number }[] = [
  { x: 410, z: -85, rot: 0.3, crop: 0 }, { x: 434, z: -159, rot: -0.2, crop: 1 },
  { x: 366, z: 222, rot: 0.5, crop: 0 }, { x: 407, z: 198, rot: -0.4, crop: 2 },
  { x: -403, z: 137, rot: 0.2, crop: 1 }, { x: -368, z: -210, rot: -0.3, crop: 2 },
  // 🚜 three fresh paddocks — more to harvest, more to guard at night
  { x: 430, z: -60, rot: 0.15, crop: 1 }, { x: -430, z: 40, rot: -0.35, crop: 0 }, { x: -360, z: 262, rot: 0.25, crop: 1 },
];
export const BARN_BASE: [number, number][] = [[425, -122], [374, 271], [-418, 93]];

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

/* ---------------- 🎃 halloween night kit — the graveyard gets HAUNTED ----------------
 * A rotten Victorian house looms over the cemetery, an arched gate guards the
 * city-side entrance, wrought-iron posts ring the grounds, a mausoleum and a
 * vintage hearse complete the estate. Jack-o-lanterns burn here all night. */
export const GRAVEKIT = (() => {
  const { x: gx, z: gz } = GRAVEYARD;
  // direction from the graveyard toward the city centre (the public entrance)
  const gl = Math.hypot(gx, gz) || 1;
  const dx = -gx / gl, dz = -gz / gl;
  const house = { x: gx, z: gz - 24, rot: Math.PI };            // looming over the north edge
  const mausoleum = { x: gx + 24, z: gz + 18, rot: -0.5 };
  const gate = { x: gx + dx * 42, z: gz + dz * 42, rot: Math.atan2(dz, dx) };
  // gate pillars flank the entrance path (perpendicular to the city direction)
  const px0 = -dz, pz0 = dx;
  const gatePillars = [
    { x: gate.x + px0 * 3.6, z: gate.z + pz0 * 3.6 },
    { x: gate.x - px0 * 3.6, z: gate.z - pz0 * 3.6 },
  ];
  const hearse = { x: gx + dx * 32 - dz * 6, z: gz + dz * 32 + dx * 6, rot: gate.rot + Math.PI / 2 };
  const lanterns = [0.7, 2.3, 3.9, 5.4].map((a) => ({ x: gx + Math.cos(a) * 30, z: gz + Math.sin(a) * 30 }));
  const oaks = [1.5, 3.2, 5.0].map((a) => ({ x: gx + Math.cos(a) * 36, z: gz + Math.sin(a) * 36, s: 1 + (a % 1) * 0.4 }));
  // wrought-iron fence posts ring the grounds (gate sector left open)
  const fencePosts: { x: number; z: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const px = gx + Math.cos(a) * 42, pz = gz + Math.sin(a) * 42;
    const ga = Math.atan2(pz - gz, px - gx);             // angle of this post
    const dg = Math.atan2(dz, dx);                        // gate angle
    let d = Math.abs(ga - dg); d = Math.min(d, Math.PI * 2 - d);
    if (d < 0.16) continue;                               // the gateway
    fencePosts.push({ x: px, z: pz });
  }
  // 🎃 jack-o-lanterns line the entrance path — lit every night, no exceptions
  const pumpkins = [0.35, 0.55, 0.75].flatMap((t) => {
    const px = gx + dx * (14 + t * 22), pz = gz + dz * (14 + t * 22);
    const perp = { x: -dz, z: dx };
    return [
      { x: px + perp.x * 2.6, z: pz + perp.z * 2.6, s: 1 },
      { x: px - perp.x * 2.6, z: pz - perp.z * 2.6, s: 0.85 },
    ];
  });
  return { house, mausoleum, gate, gatePillars, hearse, lanterns, oaks, fencePosts, pumpkins };
})();

const TOWER_COLS = [0x9fc4d8, 0xb8d0da, 0xc9d2cf, 0xa8b8c4, 0xd8cfc0, 0x8fb0a8, 0xc4b8d0, 0xb0c4b8];
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

  /* ---- downtown towers (2 blocks × 4 towers) ---- */
  for (const [bx, bz] of [[33.75, -33.75], [-33.75, 33.75]] as const) {
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const tall = rnd() < 0.5;
      push(
        bx + a * 12.5, bz + b * 12.5,
        range(rnd, 8.5, 12), range(rnd, 8.5, 12),
        tall ? range(rnd, 38, 58) : range(rnd, 22, 38),
        0, TOWER_COLS[buildings.length % TOWER_COLS.length], TOWER_ROOF,
      );
    }
  }

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
  const HOME_BLOCKS = [[-101.25, 101.25], [33.75, -101.25], [101.25, 101.25], [-33.75, 101.25], [33.75, 33.75]] as const;
  for (const [bx, bz] of HOME_BLOCKS) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const fz: 1 | -1 = bz < 0 ? 1 : -1;
      push(bx + (i - 1) * 17.5, bz + (j - 0.5) * 17.5, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
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
  const OUTER_BLOCKS = [
    [-168.75, -236.25], [168.75, -236.25], [-168.75, 236.25], [168.75, 236.25],
    [-236.25, -168.75], [236.25, -168.75], [-236.25, 168.75], [236.25, 168.75],
  ] as const;
  for (const [bx, bz] of OUTER_BLOCKS) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const fz: 1 | -1 = bz < 0 ? 1 : -1;
      push(bx + (i - 1) * 17.5, bz + (j - 0.5) * 17.5, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
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
      const fz: 1 | -1 = bz < 0 ? 1 : -1;
      push(bx + (i - 1) * 17.5, bz + (j - 0.5) * 17.5, 4.2, 3.6, range(rnd, 5.2, 6.6), 2,
        HOME_COLS[buildings.length % HOME_COLS.length],
        HOME_ROOFS[buildings.length % HOME_ROOFS.length], 0, fz);
    }
  }

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
    if (POLICE_STATIONS.some((st) => Math.hypot(x - st.x, z - st.z) < 32)) continue;
    if (Math.hypot(x - MALL.x, z - MALL.z) < 30 || Math.hypot(x - SCHOOL.x, z - SCHOOL.z) < 26) continue;
    if (Math.hypot(x - HOSPITAL.x, z - HOSPITAL.z) < 26) continue;
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
  push(HOSPITAL.x, HOSPITAL.z, 13, 6.5, 17, 5, 0xf4f6f8, 0xc7ccd4);        // hospital
  // mall + hospital parking cars — the full fleet: sedans, vans, pickups, buses & jeeps
  for (let i = 0; i < 4; i++) for (const zr of [-6, 5]) {
    cars.push({ x: MALL.x - 15 + i * 10, z: MALL.z - 26 + zr, rot: Math.PI / 2, c: (i + (zr > 0 ? 2 : 0)) % CAR_COLS.length, t: pickVehicle(rnd) });
  }
  for (let i = 0; i < 3; i++) cars.push({ x: HOSPITAL.x - 10 + i * 10, z: HOSPITAL.z - 15, rot: Math.PI / 2, c: (i + 4) % CAR_COLS.length, t: pickVehicle(rnd) });
  for (const [lx, lz] of [
    [MALL.x - 21, MALL.z - 27], [MALL.x + 21, MALL.z - 27],
    [MALL.x - 21, MALL.z - 5], [MALL.x + 21, MALL.z - 5],
    [HOSPITAL.x - 16, HOSPITAL.z - 16], [HOSPITAL.x + 16, HOSPITAL.z - 16],
    [SCHOOL.x - 18, SCHOOL.z - 20], [SCHOOL.x + 18, SCHOOL.z - 20],
  ] as const) pushLamp(lx, lz);
  // park benches around the fountain + school yard + mall front
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    benches.push({ x: PARK.x + Math.cos(a) * 6.8, z: PARK.z + Math.sin(a) * 6.8, rot: -a + Math.PI / 2 });
  }
  benches.push({ x: SCHOOL.x - 8, z: SCHOOL.z - 17, rot: Math.PI }, { x: SCHOOL.x + 2, z: SCHOOL.z - 17, rot: Math.PI }, { x: SCHOOL.x + 10, z: SCHOOL.z - 17, rot: Math.PI });
  benches.push({ x: MALL.x - 8, z: MALL.z - 32.5, rot: 0 }, { x: MALL.x + 8, z: MALL.z - 32.5, rot: 0 });

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
        if (inAirportPlot(spot.x, spot.z)) continue; // never park on the runway / apron / taxi paths
        const off = main ? 9.5 : 5.2;
        cars.push(vertical
          ? { x: k + side * off, z: d + range(rnd, -4, 4), rot: side > 0 ? 0 : Math.PI, c: Math.floor(rnd() * CAR_COLS.length), t: pickVehicle(rnd) }
          : { x: d + range(rnd, -4, 4), z: k + side * 5.2, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2, c: Math.floor(rnd() * CAR_COLS.length), t: pickVehicle(rnd) });
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
    pushLamp(Math.cos(a) * (RING_R + RING_W / 2 + 2), Math.sin(a) * (RING_R + RING_W / 2 + 2));
  }
  pushLamp(15, -150); pushLamp(-15, -164); pushLamp(15, -178);
  pushLamp(15, 24); pushLamp(-15, 96); pushLamp(15, 160);

  /* ---- central park trees + landmark trees ---- */
  const trees: Tree[] = [];
  const addTree = (x: number, z: number, s: number, kind: 0 | 1) =>
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
  push(RAILWAY_crossCottage.x, RAILWAY_crossCottage.z, 5.5, 4.5, 5, 2, 0xc8b08a, 0x7a4a34);   // crossing keeper's cottage
  push(RAILWAY_stationHouse.x, RAILWAY_stationHouse.z, 7, 5, 5.5, 1, 0x8a5a3a, 0x4a3a2e, 1);  // country station house + canopy awning
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
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 42) continue;
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
    camps.push({
      x, z, rot: baseRot, tents, logs, crates,
      pole: { dx: Math.cos(pa) * pd, dz: Math.sin(pa) * pd },
    });
  }

  /* ---- jungle forest (outer ring) + DEEP jungle (denser, darker band hugging the mountains) ----
   * The map grew: the outer jungle band is now 465 → 545 and the deep band 545 → 610.
   * The deep band is where rare gems & rocks hide: nearly double tree density, bigger
   * canopies and mostly round dark crowns so it reads visually darker than the regular
   * jungle ring. Trees keep out of the ⛰️ mountain band (that's rock country)
   * and out of the 🏕️ camp glades. */
  let n = 0;
  while (n < 560) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 472, DEEP_JUNGLE_RADIUS);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 10.5)) continue; // keep camp glades clear
    addTree(x, z, range(rnd, 0.85, 1.55), rnd() < 0.75 ? 0 : 1);
    n++;
  }
  n = 0;
  while (n < 520) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, DEEP_JUNGLE_RADIUS + 2, JUNGLE_RADIUS - 2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    if (camps.some((cp) => Math.hypot(cp.x - x, cp.z - z) < 10.5)) continue; // keep camp glades clear
    addTree(x, z, range(rnd, 1.1, 1.95), rnd() < 0.28 ? 0 : 1); // big dark round canopies dominate
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
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 6) continue;
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
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    if (inAirportPlot(x, z)) continue;
    if (Math.abs(Math.hypot(x, z) - RAILWAY.R) < 5.5) continue; // 🚂 the branch line stays clear
    if (fields.some((f) => Math.abs(x - f.x) < f.w + 3 && Math.abs(z - f.z) < f.d + 3)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 3 && Math.abs(z - b.z) < b.d + 3)) continue;
    addTree(x, z, range(rnd, 0.8, 1.3), rnd() < 0.5 ? 0 : 1);
    n++;
  }

  /* ---- 🍎 farmstead orchards — apple & plum trees shade every farmhouse yard ---- */
  for (const fh of FARMKIT.farmhouses) {
    for (let i = 0; i < 3; i++) {
      const oa = (i / 3) * Math.PI * 2 + fh.x * 0.13;
      const x = fh.x + Math.cos(oa) * 9.5, z = fh.z + Math.sin(oa) * 9.5;
      if (fields.some((f) => Math.abs(x - f.x) < f.w + 2.5 && Math.abs(z - f.z) < f.d + 2.5)) continue;
      if (buildings.some((b) => Math.abs(x - b.x) < b.w + 2.5 && Math.abs(z - b.z) < b.d + 2.5)) continue;
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
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    if (inAirportPlot(x, z)) continue;
    if (Math.abs(Math.hypot(x, z) - RAILWAY.R) < 6) continue; // 🚂 no boulders blocking the branch line
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
   * Terminal + control tower + hangar are solid boxes; the runway & apron stay
   * flat and walkable so kids can race the planes. Planes live in the engine. */
  const AP_WALL = 0xe8e6e0;      // terminal shell
  const AP_GLASS = 0x9fc4d8;     // glass band colour (visuals drawn in WorldView)
  const AP_ROOF = 0x5a6472;
  push(AIRPORT.terminal.x, AIRPORT.terminal.z, AIRPORT.terminal.w, AIRPORT.terminal.d, AIRPORT.terminal.h, 0, AP_WALL, AP_ROOF);
  // tower shaft (the glazed cab + rotating radar are drawn by <Airport> in WorldView)
  push(AIRPORT.tower.x, AIRPORT.tower.z, AIRPORT.tower.r, AIRPORT.tower.r, AIRPORT.tower.h, 0, 0xd8d5cc, AP_ROOF);
  // hangar
  push(AIRPORT.hangar.x, AIRPORT.hangar.z, AIRPORT.hangar.w, AIRPORT.hangar.d, AIRPORT.hangar.h, 0, 0xb8bec8, 0x7a828e);
  // apron floodlights + a few staff cars by the terminal
  pushLamp(AIRPORT.terminal.x - 18, AIRPORT.terminal.z - 14); pushLamp(AIRPORT.terminal.x + 18, AIRPORT.terminal.z - 14); pushLamp(AIRPORT.hangar.x + 16, AIRPORT.hangar.z - 12);
  for (let i = 0; i < 3; i++) cars.push({ x: AIRPORT.terminal.x - 10 + i * 9, z: AIRPORT.terminal.z + 8, rot: 0, c: (i + 5) % CAR_COLS.length, t: VEHICLE_POOL[(i * 3 + 2) % VEHICLE_POOL.length] });
  // windsock pole near the runway threshold (cloth drawn by <Airport>)
  push(AIRPORT.rx0 - 14, AIRPORT.rz - 12, 0.5, 0.5, 6.5, 0, 0xd8d5cc, AP_ROOF);

  /* ---- colliders ----
   * NOTE: tree circles are pushed FIRST, in tree order — tree index i is
   * ALWAYS circle index i, which is how the axe finds the collider to shrink
   * when a tree falls. Rock circles come right after, recorded in rockCi. */
  const boxes: BoxCollider[] = buildings.map(({ x, z, w, d, h }) => ({ x, z, w, d, h }));
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
    circles.push({ x: c.x - fx * ax, z: c.z - fz * ax, r: rr, car: ci });
    circles.push({ x: c.x + fx * ax, z: c.z + fz * ax, r: rr, car: ci });
  });
  for (const s of silos) circles.push({ x: s.x, z: s.z, r: 3.3 });
  for (const w of windmills) circles.push({ x: w.x, z: w.z, r: 0.8 });
  // 🏕️ jungle camps — the fire pit, every tent and the supply crates are SOLID
  // (log seats stay steppable — they're knee-high). The pit circle also doubles
  // as the anchor the engine's fire-logic reads via world.camps.
  for (const cp of camps) {
    circles.push({ x: cp.x, z: cp.z, r: 0.95 }); // fire pit — don't walk into the flames
    for (const t of cp.tents) circles.push({ x: cp.x + t.dx, z: cp.z + t.dz, r: 1.55 });
    for (const cr of cp.crates) circles.push({ x: cp.x + cr.dx, z: cp.z + cr.dz, r: 0.55 });
    if (cp.pole) circles.push({ x: cp.x + cp.pole.dx, z: cp.z + cp.pole.dz, r: 0.3 });
  }
  // 🔨 breakable boulders — each rock owns one solid collider tagged with its
  // index (rock:i); its slot is ALSO recorded in rockCi so the hammer can
  // shrink it to rubble when it finally cracks.
  rocks.forEach((rk, i) => {
    rockCi.push(circles.length);
    circles.push({ x: rk.x, z: rk.z, r: 0.8 * rk.s, rock: i });
  });
  // 🧱 builder pool — dormant circles parked under the museum podium (r≈0 never
  // collides). moveCircle() teleports one onto a build spot; reset() brings it back.
  for (let i = 0; i < BUILD_POOL; i++) circles.push({ x: MUSEUM.x, z: MUSEUM.z, r: 0.001, build: i });
  /* ---- 🚂 countryside railway — solid furniture (the track bed itself stays walkable) ---- */
  boxes.push({ x: RAILWAY_waterTower.x, z: RAILWAY_waterTower.z, w: 2.4, d: 2.4, h: 12 }); // water tower legs
  boxes.push({ x: RAILWAY_signalBox.x, z: RAILWAY_signalBox.z, w: 2.2, d: 1.8, h: 5.5 }); // signal box
  for (const pl of RAILWAY.poles) circles.push({ x: pl.x, z: pl.z, r: 0.35 });            // telegraph poles
  for (const st of RAILWAY.stock) circles.push({ x: st.x, z: st.z, r: 1.8 });             // parked rolling stock
  for (const en of RAILWAY.ends) circles.push({ x: en.x, z: en.z, r: 0.9 });              // buffer stops
  // level-crossing posts — four corners of the farm-lane × track intersection
  const RAIL_CROSS = railPoint(RAILWAY.crossing.a);
  for (const [gx0, gz0] of [[-6.5, -5.5], [6.5, -5.5], [-6.5, 5.5], [6.5, 5.5]] as const)
    circles.push({ x: RAIL_CROSS.x + gx0, z: RAIL_CROSS.z + gz0, r: 0.42 });
  /* ---- 🚜 cozy farm kit — the barnyard is solid ---- */
  for (const hb of FARMKIT.bales) circles.push({ x: hb.x, z: hb.z, r: 1.05 });            // hay bales
  for (const sc of FARMKIT.scarecrows) circles.push({ x: sc.x, z: sc.z, r: 0.4 });        // scarecrow posts
  for (const cp of FARMKIT.coops) circles.push({ x: cp.x, z: cp.z, r: 1.6 });             // chicken coops
  circles.push({ x: FARMKIT.tractor.x, z: FARMKIT.tractor.z, r: 1.5 });                   // parked tractor
  circles.push({ x: FARMKIT.well.x, z: FARMKIT.well.z, r: 1.2 });                         // stone well
  /* ---- 🎃 graveyard estate — the haunted grounds are fenced ---- */
  boxes.push({ x: GRAVEKIT.house.x, z: GRAVEKIT.house.z, w: 6.5, d: 5, h: 11 });          // haunted Victorian house
  boxes.push({ x: GRAVEKIT.mausoleum.x, z: GRAVEKIT.mausoleum.z, w: 2.8, d: 2.4, h: 6 }); // family mausoleum
  circles.push({ x: GRAVEKIT.hearse.x, z: GRAVEKIT.hearse.z, r: 1.6 });                   // vintage hearse
  for (const ln of GRAVEKIT.lanterns) circles.push({ x: ln.x, z: ln.z, r: 0.3 });         // lantern posts
  for (const ok of GRAVEKIT.oaks) circles.push({ x: ok.x, z: ok.z, r: 0.5 });             // twisted dead oaks
  for (const fp of GRAVEKIT.fencePosts) circles.push({ x: fp.x, z: fp.z, r: 0.28 });      // wrought-iron fence posts
  for (const gp of GRAVEKIT.gatePillars) circles.push({ x: gp.x, z: gp.z, r: 0.45 });     // gate pillars
  // every circle remembers its array slot — the driven car refreshes its grid cells via this
  for (let i = 0; i < circles.length; i++) circles[i].idx = i;

  return { buildings, trees, rocks, rockCi, flowers, boxes, circles, cars, lamps, benches, fields, silos, umbrellas, signs, windmills, camps, grid: buildColliderGrid(boxes, circles) };
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
 *  Uses the spatial hash (a handful of neighbouring colliders) instead of the
 *  old full-world scan — the single biggest frame-time win, especially while
 *  driving, where the car spends up to 16 resolve calls per frame. Colliders are
 *  gathered from every cell the sweep circle touches, sorted box-then-circle (the
 *  old scan's order) and the pass repeats until stable, so a push that slides the
 *  point into a collider one cell over is still caught. */
const resolveScratch: number[] = [];
export function resolve(p: { x: number; z: number }, radius: number, world: World, skipCar = -1): void {
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
    const dx = p.x - b.x, dz = p.z - b.z;
    const ox = b.w + radius - Math.abs(dx), oz = b.d + radius - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1);
      else p.z += oz * (dz < 0 ? -1 : 1);
    }
  }
  for (const c of circles) {
    if (skipCar >= 0 && c.car === skipCar) continue;
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
