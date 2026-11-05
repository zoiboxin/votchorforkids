import { AIRPORT, BUILD_POOL, CITY_RADIUS, DEEP_JUNGLE_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, MOUNTAIN_INNER, MOUNTAIN_OUTER, PARLIAMENT, POLICE_STATIONS, ROCK_COUNT, VEHICLE_AXLE, VEHICLE_AXLE_R, VEHICLE_POOL, WALL_RADIUS, WORLD_SEED, pickVehicle, stationCage, stationGate } from "./constants";
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

/* ---------------- town layout (GTA-style grid + Delhi-style central vista) ---------------- */
export const ROADS = [-270, -202.5, -135, -67.5, 0, 67.5, 135, 202.5, 270]; // road centre lines, both axes — 9×9 grid city
export const ROAD_W = 14;                          // full width
/** The MAIN ROAD: x=0 south of the grid — wider, protest march lives here (old-game homage). */
export const MAIN_ROAD = { x: 0, z0: -135, z1: 368, w: 24 };
export const RING_R = 355;                         // ring highway centre radius
export const RING_W = 12;
export const AVENUE = { x: 0, z0: -135, z1: -188, w: 24 }; // central vista up to parliament
export const PARK = { x: -33.75, z: -33.75, r: 27 };
export const MALL = { x: 33.75, z: 47 };
export const SCHOOL = { x: -33.75, z: 118 };
export const HOSPITAL = { x: 101.25, z: 106 };
export const GATE = { x: 0, z: -162 };             // India-Gate-style arch on the vista
export const PROTEST_CAMP = { x: 0, z: 48 };       // banner arch over the main road

/** True while (x,z) sits on the airport plot — runway + apron + buildings + a margin.
 *  Trees, cottages and flowers all keep out of the flight ops area. */
export function inAirportPlot(x: number, z: number): boolean {
  return x > AIRPORT.rx0 - 46 && x < AIRPORT.rx1 + 26 && z > AIRPORT.rz - 34 && z < AIRPORT.terminal.z + AIRPORT.terminal.d + 12;
}

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

  /* ---- Delhi-style central vista + full parliament district ----
   * Built BEFORE the fringe cottages so cottages never spawn on these plots.
   * Fills the once-empty grounds around Sansad Bhavan: second secretariat row,
   * flank offices, a vista mall, a national museum, shop arcades and annexe homes. */
  const SANDSTONE = 0xd8c8a4;
  // North Block / South Block style offices flanking the vista
  push(-28, -170, 11, 16, 13, 0, SANDSTONE, TOWER_ROOF);
  push(28, -170, 11, 16, 13, 0, SANDSTONE, TOWER_ROOF);
  // second secretariat row beside the podium — Lutyens-style ring around the house
  push(-33, -194, 11, 14, 12, 0, SANDSTONE, TOWER_ROOF);
  push(33, -194, 11, 14, 12, 0, SANDSTONE, TOWER_ROOF);
  // outer flank offices
  push(-46, -192, 11, 14, 13, 0, SANDSTONE, TOWER_ROOF);
  push(46, -192, 11, 14, 13, 0, SANDSTONE, TOWER_ROOF);
  // vista mall (west of the podium) + national museum (east)
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
  // India-Gate-style arch legs (the span is drawn by <VistaGate>)
  push(GATE.x - 10.5, GATE.z, 2.6, 2.6, 14, 0, SANDSTONE, TOWER_ROOF);
  push(GATE.x + 10.5, GATE.z, 2.6, 2.6, 14, 0, SANDSTONE, TOWER_ROOF);
  // protest banner arch poles over the main road (cloth drawn by <ProtestBanner>)
  push(PROTEST_CAMP.x - 13.5, PROTEST_CAMP.z, 1.5, 1.5, 10.5, 0, 0x8a6b4a, TOWER_ROOF);
  push(PROTEST_CAMP.x + 13.5, PROTEST_CAMP.z, 1.5, 1.5, 10.5, 0, 0x8a6b4a, TOWER_ROOF);

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

  /* ---- protest placards along the main road + parliament plaza (old-game homage) ---- */
  const SLOGANS = [
    "GIVE OUR VOTES BACK!", "VOTE CHOR GO!", "WE WANT VOTES", "CHAI > CORRUPTION",
    "KIDS FOR DEMOCRACY", "VOTES FOR ALL", "PARLIAMENT LISTEN!", "MANGO PARTY NOW",
    "NO VOTE, NO CHILL", "HONK FOR VOTES",
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
  // a proud cluster right on the parliament plaza, clear of the podium and secretariats
  for (let i = 0; i < 6; i++) {
    signs.push({
      x: (i % 2 === 0 ? -1 : 1) * (13 + (i >> 1) * 3), z: -166 - (i % 3) * 2.4,
      rot: (i % 2 === 0 ? 1 : -1) * 0.4,
      text: SLOGANS[(si + i) % SLOGANS.length], c: (si + i) % 3,
    });
  }

  /* ---- farm: barns, silos, crop fields, windmills (moved out to the wider farm ring) ----
   * The whole farm band slid outward when the city grew to r=405 — every farm prop
   * scaled by ~1.22 so fields sit between the city edge and the jungle again. */
  const barns = [[425, -122], [374, 271], [-418, 93]] as const;
  for (const [x, z] of barns) push(x, z, 8, 5.5, 7, 6, 0xc0442e, 0x7a3322);
  const silos: Silo[] = barns.map(([x, z]) => ({ x: x + 11.5, z: z + 2 }));
  const fields: Field[] = [
    { x: 410, z: -85, rot: 0.3, crop: 0 }, { x: 434, z: -159, rot: -0.2, crop: 1 },
    { x: 366, z: 222, rot: 0.5, crop: 0 }, { x: 407, z: 198, rot: -0.4, crop: 2 },
    { x: -403, z: 137, rot: 0.2, crop: 1 }, { x: -368, z: -210, rot: -0.3, crop: 2 },
  ].map((f) => ({ ...f, w: 12, d: 8 }) as Field);
  const windmills = [
    { x: 425, z: -68, rot: 0 }, { x: 403, z: 195, rot: 1.2 }, { x: -412, z: 193, rot: 2.1 },
  ];

  /* ---- jungle forest (outer ring) + DEEP jungle (denser, darker band hugging the mountains) ----
   * The map grew: the outer jungle band is now 465 → 545 and the deep band 545 → 610.
   * The deep band is where rare gems & rocks hide: nearly double tree density, bigger
   * canopies and mostly round dark crowns so it reads visually darker than the regular
   * jungle ring. Trees keep out of the ⛰️ mountain band (that's rock country). */
  let n = 0;
  while (n < 560) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 472, DEEP_JUNGLE_RADIUS);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    addTree(x, z, range(rnd, 0.85, 1.55), rnd() < 0.75 ? 0 : 1);
    n++;
  }
  n = 0;
  while (n < 520) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, DEEP_JUNGLE_RADIUS + 2, JUNGLE_RADIUS - 2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
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
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue;
    rocks.push({ x, z, s: range(rnd, 0.9, 1.8) });
    n++;
  }

  /* ---- sparse farmland trees (avoid fields, buildings & the airport plot) ---- */
  n = 0;
  while (n < 80) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 412, 458);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    if (inAirportPlot(x, z)) continue;
    if (fields.some((f) => Math.abs(x - f.x) < f.w + 3 && Math.abs(z - f.z) < f.d + 3)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 3 && Math.abs(z - b.z) < b.d + 3)) continue;
    addTree(x, z, range(rnd, 0.8, 1.3), rnd() < 0.5 ? 0 : 1);
    n++;
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
    // keep the ring road, main road, avenues and the street grid drivable
    if (Math.abs(rr - RING_R) < RING_W / 2 + 4) continue;
    if (Math.abs(x) < ROAD_W / 2 + 4 && z > MAIN_ROAD.z0 - 4 && z < MAIN_ROAD.z1 + 4) continue;
    if (ROADS.some((rd) => Math.abs(x - rd) < ROAD_W / 2 + 3 || Math.abs(z - rd) < ROAD_W / 2 + 3)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w + 4 && Math.abs(z - b.z) < b.d + 4)) continue;
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < 2.6)) continue;
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

  /* ---- VoteChor International Airport (south-east, outside the ring highway) ----
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
  circles.push({ x: PARLIAMENT.x, z: PARLIAMENT.z, r: 26 });               // parliament podium (matches the visual base)
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
  // 🔨 breakable boulders — each rock owns one solid collider tagged with its
  // index (rock:i); its slot is ALSO recorded in rockCi so the hammer can
  // shrink it to rubble when it finally cracks.
  rocks.forEach((rk, i) => {
    rockCi.push(circles.length);
    circles.push({ x: rk.x, z: rk.z, r: 0.8 * rk.s, rock: i });
  });
  // 🧱 builder pool — dormant circles parked under the parliament podium (r≈0 never
  // collides). moveCircle() teleports one onto a build spot; reset() brings it back.
  for (let i = 0; i < BUILD_POOL; i++) circles.push({ x: PARLIAMENT.x, z: PARLIAMENT.z, r: 0.001, build: i });
  // every circle remembers its array slot — the driven car refreshes its grid cells via this
  for (let i = 0; i < circles.length; i++) circles[i].idx = i;

  return { buildings, trees, rocks, rockCi, flowers, boxes, circles, cars, lamps, benches, fields, silos, umbrellas, signs, windmills, grid: buildColliderGrid(boxes, circles) };
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
