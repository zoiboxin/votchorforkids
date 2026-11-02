import { AIRPORT, CITY_RADIUS, FARM_RADIUS, GRAVEYARD, PARLIAMENT, POLICE_STATIONS, WORLD_SEED, stationCage, stationGate } from "./constants";
import { mulberry32, range } from "./rng";

export interface BoxCollider { x: number; z: number; w: number; d: number } // half extents
export interface CircleCollider { x: number; z: number; r: number; /** set for the two axle circles of a parked car — lets a DRIVEN car skip its own colliders */ car?: number }

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
export interface Car { x: number; z: number; rot: number; c: number; /** body style: 0 sedan · 1 hatchback · 2 van */ t: number }
export interface Lamp { x: number; z: number }
export interface Bench { x: number; z: number; rot: number }
export interface Field { x: number; z: number; w: number; d: number; rot: number; crop: number }
export interface Silo { x: number; z: number }
export interface Umbrella { x: number; z: number; c: number }
export interface Sign { x: number; z: number; rot: number; text: string; c: number }

export interface World {
  buildings: Building[];
  trees: Tree[];
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
    lamps.push({ x: bx - 27.5, z: bz + 27.5 }, { x: bx + 27.5, z: bz - 27.5 });
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
    lamps.push({ x: gate.x + Math.sign(st.x) * 5, z: gate.z });
    lamps.push({ x: gate.x, z: gate.z + Math.sign(st.z) * 5 });
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
  // mall + hospital parking cars
  for (let i = 0; i < 4; i++) for (const zr of [-6, 5]) {
    cars.push({ x: MALL.x - 15 + i * 10, z: MALL.z - 26 + zr, rot: Math.PI / 2, c: (i + (zr > 0 ? 2 : 0)) % CAR_COLS.length, t: Math.floor(rnd() * 3) });
  }
  for (let i = 0; i < 3; i++) cars.push({ x: HOSPITAL.x - 10 + i * 10, z: HOSPITAL.z - 15, rot: Math.PI / 2, c: (i + 4) % CAR_COLS.length, t: Math.floor(rnd() * 3) });
  lamps.push(
    { x: MALL.x - 21, z: MALL.z - 27 }, { x: MALL.x + 21, z: MALL.z - 27 },
    { x: MALL.x - 21, z: MALL.z - 5 }, { x: MALL.x + 21, z: MALL.z - 5 },
    { x: HOSPITAL.x - 16, z: HOSPITAL.z - 16 }, { x: HOSPITAL.x + 16, z: HOSPITAL.z - 16 },
    { x: SCHOOL.x - 18, z: SCHOOL.z - 20 }, { x: SCHOOL.x + 18, z: SCHOOL.z - 20 },
  );
  // park benches around the fountain + school yard + mall front
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    benches.push({ x: PARK.x + Math.cos(a) * 6.8, z: PARK.z + Math.sin(a) * 6.8, rot: -a + Math.PI / 2 });
  }
  benches.push({ x: SCHOOL.x - 8, z: SCHOOL.z - 17, rot: Math.PI }, { x: SCHOOL.x + 2, z: SCHOOL.z - 17, rot: Math.PI }, { x: SCHOOL.x + 10, z: SCHOOL.z - 17, rot: Math.PI });
  benches.push({ x: MALL.x - 8, z: MALL.z - 32.5, rot: 0 }, { x: MALL.x + 8, z: MALL.z - 32.5, rot: 0 });

  /* ---- parked cars along road edges ---- */
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
        const off = main ? 9.5 : 5.2;
        cars.push(vertical
          ? { x: k + side * off, z: d + range(rnd, -4, 4), rot: side > 0 ? 0 : Math.PI, c: Math.floor(rnd() * CAR_COLS.length), t: Math.floor(rnd() * 3) }
          : { x: d + range(rnd, -4, 4), z: k + side * 5.2, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2, c: Math.floor(rnd() * CAR_COLS.length), t: Math.floor(rnd() * 3) });
      }
    }
  }

  /* ---- street lamps: 2 per intersection + ring + avenue ---- */
  for (const kx of ROADS) for (const kz of ROADS) {
    lamps.push({ x: kx + 8.5, z: kz + 8.5 }, { x: kx - 8.5, z: kz - 8.5 });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    lamps.push({ x: Math.cos(a) * (RING_R + RING_W / 2 + 2), z: Math.sin(a) * (RING_R + RING_W / 2 + 2) });
  }
  lamps.push({ x: 15, z: -150 }, { x: -15, z: -164 }, { x: 15, z: -178 });
  lamps.push({ x: 15, z: 24 }, { x: -15, z: 96 }, { x: 15, z: 160 });

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

  /* ---- jungle forest (dense ring) + decorative outer band ---- */
  let n = 0;
  while (n < 560) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 472, 528);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < GRAVEYARD.r + 8) continue;
    addTree(x, z, range(rnd, 0.85, 1.55), rnd() < 0.75 ? 0 : 1);
    n++;
  }
  for (let i = 0; i < 46; i++) {
    const a = range(rnd, 0, Math.PI * 2), r = range(rnd, 528, 542);
    addTree(Math.cos(a) * r, Math.sin(a) * r, range(rnd, 0.9, 1.5), rnd() < 0.7 ? 0 : 1);
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
  lamps.push({ x: AIRPORT.terminal.x - 18, z: AIRPORT.terminal.z - 14 }, { x: AIRPORT.terminal.x + 18, z: AIRPORT.terminal.z - 14 }, { x: AIRPORT.hangar.x + 16, z: AIRPORT.hangar.z - 12 });
  for (let i = 0; i < 3; i++) cars.push({ x: AIRPORT.terminal.x - 10 + i * 9, z: AIRPORT.terminal.z + 8, rot: 0, c: (i + 5) % CAR_COLS.length, t: i % 3 });
  // windsock pole near the runway threshold (cloth drawn by <Airport>)
  push(AIRPORT.rx0 - 14, AIRPORT.rz - 12, 0.5, 0.5, 6.5, 0, 0xd8d5cc, AP_ROOF);

  /* ---- colliders ---- */
  const boxes: BoxCollider[] = buildings.map(({ x, z, w, d }) => ({ x, z, w, d }));
  const circles: CircleCollider[] = trees.map(({ x, z, r }) => ({ x, z, r }));
  circles.push({ x: PARK.x - 11, z: PARK.z + 11, r: 8.2 });               // park pond
  circles.push({ x: PARK.x, z: PARK.z, r: 3.6 });                          // fountain
  circles.push({ x: PARLIAMENT.x, z: PARLIAMENT.z, r: 26 });               // parliament podium (matches the visual base)
  for (const s of signs) circles.push({ x: s.x, z: s.z, r: 0.45 });        // placard posts
  // two circles per car (front + rear axle) — a single centre circle let players
  // clip through the hood and boot of the 4.4-long bodies. Tagged with the car
  // index so a driven car can move its own colliders along (and skip them).
  cars.forEach((c, ci) => {
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    circles.push({ x: c.x - fx * 1.25, z: c.z - fz * 1.25, r: 1.16, car: ci });
    circles.push({ x: c.x + fx * 1.25, z: c.z + fz * 1.25, r: 1.16, car: ci });
  });
  for (const s of silos) circles.push({ x: s.x, z: s.z, r: 3.3 });
  for (const w of windmills) circles.push({ x: w.x, z: w.z, r: 0.8 });

  return { buildings, trees, flowers, boxes, circles, cars, lamps, benches, fields, silos, umbrellas, signs, windmills };
}

/** Push a point out of every collider it overlaps. skipCar: while driving car #n,
 *  that car's own axle circles are skipped so the body doesn't shove itself. */
export function resolve(p: { x: number; z: number }, radius: number, world: World, skipCar = -1): void {
  for (const b of world.boxes) {
    const dx = p.x - b.x, dz = p.z - b.z;
    const ox = b.w + radius - Math.abs(dx), oz = b.d + radius - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1);
      else p.z += oz * (dz < 0 ? -1 : 1);
    }
  }
  for (const c of world.circles) {
    if (skipCar >= 0 && c.car === skipCar) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const rr = c.r + radius;
    if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2);
      // dead-centre inside the circle has no push direction — pick east so the
      // point can never get permanently stuck (e.g. teleports into a collider)
      if (d < 0.01) { p.x = c.x + rr; continue; }
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
}

/** True if the segment between two points is roughly clear of buildings (cheap LOS). */
export function lineClear(ax: number, az: number, bx: number, bz: number, world: World): boolean {
  const steps = Math.min(24, Math.max(4, Math.floor(Math.hypot(bx - ax, bz - az) / 2)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    for (const b of world.boxes)
      if (Math.abs(x - b.x) < b.w + 0.4 && Math.abs(z - b.z) < b.d + 0.4) return false;
  }
  return true;
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
