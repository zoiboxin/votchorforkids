/**
 * 🗺️ SEASON WORLDGEN — the themed battle-royale arenas.
 *
 * Every season (see seasons.ts) generates its own arena: a capital town at
 * the heart, ring roads and eight radials threading the map, 17 named POIs
 * (villages, landmarks, farms) dressed with the kit's vendored GLB pieces,
 * themed tree lines, boulder fields, camps, ponds and lamp-lit avenues. The
 * same deterministic stream builds physics (boxes/circles/grid) and the
 * renderer's placement lists, so what you see is what you collide with.
 *
 * The play field is a disc of `def.sizeKm / 2` km radius (S1 Christmas
 * Village is a tight 2×2 km village arena; every other season spans 4×4 km)
 * — walls, dropship route, safe-zone ladder and spawn rings all scale from
 * the MapInfo attached to the world (see mapInfo.ts).
 */
import { buildColliderGrid, type BoxCollider, type Building, type Car, type CircleCollider, type Rock, type Tree, type World, type Camp, type Flower, type Field, type Lamp, type Bench, type Sign, type Pond, type FloorProp } from "./worldgen";
import { mulberry32, range } from "./rng";
import { SEASON_ZONE_RADII, type MapInfo } from "./mapInfo";
import { CAR_ROOF_TOP, VEHICLE_AXLE, VEHICLE_AXLE_R, type Zone } from "./constants";
import { SEASON_BY_ID, type SeasonDef } from "./seasons";
import { SEASON_ASSETS } from "./seasonAssets";

export interface SeasonPoi {
  name: string;
  x: number; z: number;
  /** keep-out radius (buildings + plaza) */
  r: number;
  /** terrain height the whole POI sits on */
  h: number;
  type: "capital" | "town" | "landmark" | "farm";
}

export interface RoadSeg {
  x1: number; z1: number; x2: number; z2: number; w: number;
  /** legacy flat profile (kept in sync = (h1+h2)/2) for non-seasonal readers */
  h: number;
  /** ⛰️ terrain height at each END — the road GRADES between them (chunk
   *  chains share endpoints, so the tarmac never terraces at chunk joints) */
  h1?: number; h2?: number;
}

/** the road surface height at parameter t∈[0,1] along a segment — the graded
 *  profile when the segment carries endpoint heights, else its flat legacy h */
export const roadProfileH = (seg: RoadSeg, t: number): number =>
  seg.h1 !== undefined && seg.h2 !== undefined
    ? seg.h1 + (seg.h2 - seg.h1) * t
    : seg.h;

/** one vendored kit piece placed in the world — the renderer spawns clones */
export interface GlbPlace { file: string; name: string; role: "building" | "landmark" | "tree" | "prop"; x: number; z: number; rot: number; s: number; h: number }

export interface SeasonWorld extends World {
  map: MapInfo;
  seasonId: string;
  def: SeasonDef;
  pois: SeasonPoi[];
  roads: RoadSeg[];
  glb: GlbPlace[];
}

/* ---------------- 🌄 terrain ---------------- */

const smooth01 = (k: number) => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };

/** rolling hills for the big arenas — cheap (5 sin pairs + a valley carve),
 *  flat near POIs & roads. The layered octaves read as REAL countryside:
 *  broad ridges (~600 u wavelength), rolling mounds (~180 u) and a fine bumpy
 *  skin (~55 u) — mountains stay in the rim band, villages stay buildable. */
function makeSeasonTerrain(pois: SeasonPoi[], roads: RoadSeg[], wallR: number) {
  const base = (x: number, z: number) =>
    3.1 * Math.sin(x * 0.0031 + z * 0.0027) * Math.cos(x * 0.0018 - z * 0.0035) +
    1.55 * Math.sin(x * 0.0063 + 1.7) * Math.sin(z * 0.0057 + 0.6) +
    0.9 * Math.sin(x * 0.0115 - z * 0.0092 + 2.4) * Math.cos(x * 0.0071 + z * 0.0121) +
    0.5 * Math.sin(x * 0.0231 + z * 0.0197) * Math.sin(z * 0.0263 - 1.1) +
    0.18 * Math.sin(x * 0.0621 + 0.8) * Math.sin(z * 0.0553 - 0.4);
  const rimStart = wallR * 0.89, rimBand = wallR * 0.16;
  // ⛰️ the rim rises gently toward the wall so the boundary reads as hills —
  // part of the NATURAL ground: POI plateau heights & road endpoint profiles
  // bake it in (a village on the rim band sits on rimmed ground, flat)
  const rimmed = (x: number, z: number): number => {
    const h = base(x, z);
    const r = Math.hypot(x, z);
    return r > rimStart ? h + smooth01((r - rimStart) / rimBand) * 10 : h;
  };
  const terrain = (x: number, z: number): number => {
    let h = rimmed(x, z);
    // 🛣️ roads grade FIRST (their tarmac profile slopes between endpoint
    // heights — one flat strip would trench through the hills like a canal,
    // and per-chunk flat heights would terrace at every chunk joint)
    for (const seg of roads) {
      const vx = seg.x2 - seg.x1, vz = seg.z2 - seg.z1;
      const L2 = vx * vx + vz * vz || 1;
      let t = ((x - seg.x1) * vx + (z - seg.z1) * vz) / L2;
      if (t <= -0.05 || t >= 1.05) continue; // quick reject past the ends
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = seg.x1 + vx * t, cz = seg.z1 + vz * t;
      const d = Math.hypot(x - cx, z - cz);
      const half = seg.w / 2 + 2.5;
      if (d < half) {
        const rh = roadProfileH(seg, t);
        h = rh + (h - rh) * smooth01((d - seg.w / 2) / 2.5);
      }
    }
    // 🏘️ POIs sit on shared plateaus — applied AFTER the roads so a village
    // square stays truly flat (roads still grade into its skirt outside the
    // core, and stub roads end ON the plateau height anyway). The CLOSEST
    // POI relative to its size owns the point: overlapping village skirts
    // never fight over a plaza corner.
    let own: SeasonPoi | undefined, ownK = Infinity;
    for (const p of pois) {
      const dx = x - p.x, dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      const reach = (p.r + 8) * (p.r + 8);
      if (d2 < reach) {
        const k = Math.sqrt(d2) / p.r;
        if (k < ownK) { ownK = k; own = p; }
      }
    }
    if (own) h = own.h + (h - own.h) * smooth01((ownK - 0.55) / (0.45 + 8 / own.r));
    return h;
  };
  return { base: rimmed, terrain };
}

/** distance from a point to a road segment's centreline */
function roadDist(x: number, z: number, seg: RoadSeg): number {
  const vx = seg.x2 - seg.x1, vz = seg.z2 - seg.z1;
  const L2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - seg.x1) * vx + (z - seg.z1) * vz) / L2));
  return Math.hypot(x - (seg.x1 + vx * t), z - (seg.z1 + vz * t));
}

/** approximate solid footprints for vendored kit pieces (half extents + height) */
function kitFootprint(role: GlbPlace["role"], rnd: () => number): { w: number; d: number; h: number; stand: boolean } {
  switch (role) {
    case "building": return { w: range(rnd, 3.8, 5.6), d: range(rnd, 3.8, 5.6), h: range(rnd, 6.5, 10), stand: true };
    case "landmark": return { w: range(rnd, 4.6, 7), d: range(rnd, 4.6, 7), h: range(rnd, 9, 14), stand: true };
    case "tree": return { w: 0.7, d: 0.7, h: 5, stand: false };
    default: return { w: range(rnd, 0.8, 1.3), d: range(rnd, 0.8, 1.3), h: 1.4, stand: false };
  }
}

const cache = new Map<string, SeasonWorld>();

/**
 * Build (and cache) a season arena. Deterministic per season id: every client
 * regenerates a byte-identical world (S1: 2×2 km · others: 4×4 km) with no
 * network exchange.
 */
export function generateSeasonWorld(seasonId: string): SeasonWorld {
  const hit = cache.get(seasonId);
  if (hit) return hit;
  const def = SEASON_BY_ID[seasonId] ?? SEASON_BY_ID.s1;
  const seed = 0x51ea50 ^ [...seasonId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  const rnd = mulberry32(seed);
  const pal = def.pal;

  /* ---- arena scale: S1 is a tight 2×2 km village, the rest span 4×4 km.
   * Distances scale with K; POI footprints stay village-sized so the map
   * reads DENSER, not simply smaller. ---- */
  const KM = def.sizeKm ?? 4;
  const K = KM / 4;
  const WALL_R = 2000 * K;

  /* ---- POI layout: capital + 3 rings of named settlements ---- */
  const names = def.poiNames;
  const pois: SeasonPoi[] = [];
  const pushPoi = (name: string, x: number, z: number, r: number, type: SeasonPoi["type"]) =>
    pois.push({ name, x, z, r, h: 0, type }); // h filled after terrain exists
  pushPoi(names[0] ?? "Capital", 0, 0, 130, "capital");
  const ringA: [number, SeasonPoi["type"], number][] = [
    [520, "town", 62], [520 + 90, "town", 58], [520 + 180, "town", 60], [520 + 270, "town", 56],
  ];
  const ringB: [number, SeasonPoi["type"], number][] = [
    [1080, "town", 66], [1080 + 60, "landmark", 58], [1080 + 120, "farm", 62],
    [1080 + 180, "town", 60], [1080 + 240, "landmark", 54], [1080 + 300, "farm", 64],
  ];
  const ringC: [number, SeasonPoi["type"], number][] = [
    [1620, "landmark", 60], [1620 + 60, "town", 56], [1620 + 120, "landmark", 52],
    [1620 + 180, "town", 58], [1620 + 240, "landmark", 52], [1620 + 300, "town", 54],
  ];
  let ni = 1;
  const nameNext = () => names[ni++ % names.length] ?? `Settlement ${ni}`;
  for (let i = 0; i < ringA.length; i++) {
    const [r, type, pr] = ringA[i];
    const a = (i / ringA.length) * Math.PI * 2 + range(rnd, -0.08, 0.08);
    pushPoi(nameNext(), Math.cos(a) * r * K, Math.sin(a) * r * K, pr, type);
  }
  for (let i = 0; i < ringB.length; i++) {
    const [r, type, pr] = ringB[i];
    const a = (i / ringB.length) * Math.PI * 2 + range(rnd, -0.1, 0.1) + 0.31;
    pushPoi(nameNext(), Math.cos(a) * r * K, Math.sin(a) * r * K, pr, type);
  }
  for (let i = 0; i < ringC.length; i++) {
    const [r, type, pr] = ringC[i];
    const a = (i / ringC.length) * Math.PI * 2 + range(rnd, -0.12, 0.12) + 0.52;
    pushPoi(nameNext(), Math.cos(a) * r * K, Math.sin(a) * r * K, pr, type);
  }

  /* ---- roads: 8 radials + 2 ring roads + POI stubs ----
   * ⛰️ radials are SUBDIVIDED into ~120 u chunks so every chunk grades to its
   * own hill height — one flat strip would trench through the rolling hills
   * like a canal (the terrain function flattens toward each segment's own h). */
  const roads: RoadSeg[] = [];
  const radials: number[] = [];
  const chunk = 120 * Math.max(0.7, K);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + range(rnd, -0.06, 0.06);
    radials.push(a);
    const r0 = 150, r1 = WALL_R - 40;
    const n = Math.max(1, Math.round((r1 - r0) / chunk));
    let px = Math.cos(a) * r0, pz = Math.sin(a) * r0;
    for (let k = 1; k <= n; k++) {
      const rr = r0 + ((r1 - r0) * k) / n;
      const nx = Math.cos(a) * rr, nz = Math.sin(a) * rr;
      roads.push({ x1: px, z1: pz, x2: nx, z2: nz, w: 11, h: 0 });
      px = nx; pz = nz;
    }
  }
  const ringRoad = (r: number) => {
    const N = Math.max(16, Math.round((2 * Math.PI * r) / chunk));
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      roads.push({ x1: Math.cos(a0) * r, z1: Math.sin(a0) * r, x2: Math.cos(a1) * r, z2: Math.sin(a1) * r, w: 10, h: 0 });
    }
  };
  ringRoad(520 * K);
  ringRoad(1620 * K);
  for (const p of pois) {
    const pr = Math.hypot(p.x, p.z);
    if (pr < 200) continue; // the capital already owns every radial head
    // stub from the POI edge to the nearest radial
    let best = radials[0], bd = Infinity;
    for (const a of radials) {
      const rx = Math.cos(a), rz = Math.sin(a);
      const d = Math.abs(p.x * rz - p.z * rx); // perpendicular distance to the ray
      if (d < bd) { bd = d; best = a; }
    }
    const rx = Math.cos(best), rz = Math.sin(best);
    const along = p.x * rx + p.z * rz;
    roads.push({ x1: rx * along, z1: rz * along, x2: p.x, z2: p.z, w: 8, h: 0 });
  }

  /* ---- terrain (needs POI heights) ---- */
  const { base, terrain } = makeSeasonTerrain(pois, roads, WALL_R);
  for (const p of pois) p.h = base(p.x, p.z);
  // ⛰️ every road carries a graded profile: its END heights (snapped to a POI
  // plateau when the end lands inside one — stub roads melt INTO the square,
  // never step onto it). Chunk chains share endpoints, so heights chain
  // seamlessly around radials and the ring roads.
  const endH = (x: number, z: number): number => {
    for (const p of pois) {
      if (Math.hypot(x - p.x, z - p.z) < p.r * 0.75) return p.h;
    }
    return base(x, z);
  };
  for (const seg of roads) {
    seg.h1 = endH(seg.x1, seg.z1);
    seg.h2 = endH(seg.x2, seg.z2);
    seg.h = (seg.h1 + seg.h2) / 2;
  }

  /* ---- buildings ---- */
  const buildings: Building[] = [];
  const glb: GlbPlace[] = [];
  const assets = SEASON_ASSETS[def.id] ?? [];

  const addBuilding = (x: number, z: number, w: number, d: number, h: number, kind: Building["kind"]) => {
    const wall = pal.wall[Math.floor(rnd() * pal.wall.length)];
    const roof = pal.roof[Math.floor(rnd() * pal.roof.length)];
    buildings.push({
      x, z, w, d, h, color: wall, roof, kind, awn: rnd() < 0.5 ? 1 : 0, fz: 1,
    });
  };

  /**
   * a cluster of kit buildings + procedural filler around a POI centre.
   * Dressed to read like a REAL village (the kit-preview look): centrepiece
   * landmark on the plaza, a second landmark framing it, kit homes huddled
   * close, a market-stall row facing the square, garland lamps, and a gate
   * arch over the road in.
   */
  const buildPoi = (p: SeasonPoi) => {
    const n = p.type === "capital" ? 26 : p.type === "town" ? 12 : p.type === "farm" ? 5 : 7;
    const kitB = assets.filter((a) => a.role === "building");
    const kitL = assets.filter((a) => a.role === "landmark");
    const kitP = assets.filter((a) => a.role === "prop");
    const kitT = assets.filter((a) => a.role === "tree");
    // themed prop families for the structured plaza dressing
    const stallLike = kitP.filter((a) => /stall|stand|market|cart|booth|kiosk|well|stage|bench/i.test(a.name));
    const lampLike = kitP.filter((a) => /lamp|post|light/i.test(a.name));
    const archLike = kitP.filter((a) => /arch|gate|entrance/i.test(a.name));

    if (p.type === "landmark" && kitL.length > 0) {
      const a = kitL[Math.floor(rnd() * kitL.length)];
      glb.push({ file: a.file, name: a.name, role: "landmark", x: p.x, z: p.z + range(rnd, -4, 4), rot: rnd() * Math.PI * 2, s: 1, h: terrain(p.x, p.z) });
    } else if (p.type === "capital" && kitL.length > 0) {
      // 🎄 kit-image plaza: the kit's iconic centrepiece (tree/statue/tower…)
      // dead centre, a second landmark framing it from behind
      const centre = kitL.find((a) => /tree|skeleton|pyramid|moai|tower|dome|flag|statue|kiosco|fountain|carousel|lighthouse|throne|keep|shrine|obelisk|mausoleum|well/i.test(a.name)) ?? kitL[0];
      glb.push({ file: centre.file, name: centre.name, role: "landmark", x: p.x, z: p.z, rot: rnd() * Math.PI * 2, s: 1, h: terrain(p.x, p.z) });
      const back = kitL.find((a) => a.file !== centre.file) ?? centre;
      const bA = rnd() * Math.PI * 2;
      const bx = p.x + Math.cos(bA) * p.r * 0.3, bz = p.z + Math.sin(bA) * p.r * 0.3;
      glb.push({ file: back.file, name: back.name, role: "landmark", x: bx, z: bz, rot: Math.atan2(p.x - bx, p.z - bz), s: 1, h: terrain(bx, bz) });
    }
    // kit buildings huddled tight around the plaza (facing the centre)
    const kitCount = p.type === "capital" ? 6 : p.type === "town" ? 5 : 4;
    for (let i = 0; i < Math.min(kitCount, n); i++) {
      if (kitB.length === 0) break;
      const a = kitB[Math.floor(rnd() * kitB.length)];
      const ang = (i / kitCount) * Math.PI * 2 + rnd() * 0.55;
      const dist = p.r * (p.type === "capital" ? range(rnd, 0.36, 0.58) : range(rnd, 0.42, 0.62));
      const gx = p.x + Math.cos(ang) * dist, gz = p.z + Math.sin(ang) * dist;
      glb.push({ file: a.file, name: a.name, role: "building", x: gx, z: gz, rot: Math.atan2(p.x - gx, p.z - gz) + range(rnd, -0.2, 0.2), s: 1, h: terrain(gx, gz) });
    }
    // procedural filler homes/shops on the outer band
    const forI = p.type === "capital" ? 22 : p.type === "town" ? 10 : p.type === "farm" ? 5 : 6;
    for (let i = 0; i < forI; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = p.r * range(rnd, 0.52, 0.92);
      const bx = p.x + Math.cos(ang) * dist, bz = p.z + Math.sin(ang) * dist;
      // keep clear of the stub road entrance
      let clear = true;
      for (const seg of roads) if (roadDist(bx, bz, seg) < seg.w / 2 + 4) { clear = false; break; }
      if (!clear) continue;
      const w = range(rnd, 3.6, 6.2), d = range(rnd, 3.6, 6.2);
      const kind: Building["kind"] = p.type === "farm" ? (rnd() < 0.6 ? 6 : 2) : rnd() < 0.34 ? 2 : rnd() < 0.6 ? 1 : 0;
      const h = kind === 2 ? range(rnd, 3.2, 4.4) : kind === 0 ? range(rnd, 7, p.type === "capital" && i % 6 === 0 ? 30 : 14) : range(rnd, 4, 7.5);
      addBuilding(bx, bz, w, d, h, kind);
    }
    // 🏕️ structured plaza dressing — market row + lamps + gate arch
    if (p.type === "capital") {
      // market stalls in an arc facing the square (the kit-preview market row)
      for (let i = 0; i < 6 && stallLike.length > 0; i++) {
        const a = stallLike[i % stallLike.length];
        const ang = (i / 6) * Math.PI * 2 + 0.26;
        const px = p.x + Math.cos(ang) * p.r * 0.3, pz = p.z + Math.sin(ang) * p.r * 0.3;
        glb.push({ file: a.file, name: a.name, role: "prop", x: px, z: pz, rot: Math.atan2(p.x - px, p.z - pz), s: 1, h: terrain(px, pz) });
      }
      // garland lamps ringing the square
      for (let i = 0; i < 4 && lampLike.length > 0; i++) {
        const a = lampLike[i % lampLike.length];
        const ang = (i / 4) * Math.PI * 2 + 0.7;
        const px = p.x + Math.cos(ang) * p.r * 0.18, pz = p.z + Math.sin(ang) * p.r * 0.18;
        glb.push({ file: a.file, name: a.name, role: "prop", x: px, z: pz, rot: rnd() * Math.PI * 2, s: 1, h: terrain(px, pz) });
      }
      // kit gate arches over two opposite avenues
      for (let i = 0; i < 2 && archLike.length > 0; i++) {
        const a = archLike[i % archLike.length];
        const ang = i === 0 ? 0.3 : 0.3 + Math.PI;
        const px = p.x + Math.cos(ang) * p.r * 0.62, pz = p.z + Math.sin(ang) * p.r * 0.62;
        glb.push({ file: a.file, name: a.name, role: "prop", x: px, z: pz, rot: ang + Math.PI / 2, s: 1, h: terrain(px, pz) });
      }
    } else if (archLike.length > 0) {
      // every village greets you with its gate arch over the road in
      const a = archLike[Math.floor(rnd() * archLike.length)];
      const ang = Math.atan2(p.z, p.x);
      const px = p.x + Math.cos(ang) * p.r * 0.62, pz = p.z + Math.sin(ang) * p.r * 0.62;
      glb.push({ file: a.file, name: a.name, role: "prop", x: px, z: pz, rot: ang + Math.PI / 2, s: 1, h: terrain(px, pz) });
    }
    // kit props scattered across the plaza band
    const props = p.type === "capital" ? 6 : 6;
    for (let i = 0; i < props && kitP.length > 0; i++) {
      const a = kitP[Math.floor(rnd() * kitP.length)];
      const ang = rnd() * Math.PI * 2;
      const dist = p.r * range(rnd, 0.3, 0.9);
      glb.push({ file: a.file, name: a.name, role: "prop", x: p.x + Math.cos(ang) * dist, z: p.z + Math.sin(ang) * dist, rot: rnd() * Math.PI * 2, s: 1, h: terrain(p.x + Math.cos(ang) * dist, p.z + Math.sin(ang) * dist) });
    }
    // kit trees sprinkled at the POI rim
    const rimTrees = p.type === "capital" ? 5 : 3;
    for (let i = 0; i < rimTrees && kitT.length > 0; i++) {
      const a = kitT[Math.floor(rnd() * kitT.length)];
      const ang = rnd() * Math.PI * 2;
      const dist = p.r * range(rnd, 0.75, 1.05);
      glb.push({ file: a.file, name: a.name, role: "tree", x: p.x + Math.cos(ang) * dist, z: p.z + Math.sin(ang) * dist, rot: rnd() * Math.PI * 2, s: 1, h: terrain(p.x + Math.cos(ang) * dist, p.z + Math.sin(ang) * dist) });
    }
  };
  for (const p of pois) buildPoi(p);

  /* ---- trees (themed pool indexes) — K-scaled field, denser per km² ---- */
  const trees: Tree[] = [];
  const nFoliage = def.foliage.length;
  const poolOf = (): number => {
    const x = rnd();
    return x < 0.68 ? 0 : x < 0.93 ? (nFoliage > 1 ? 1 : 0) : (nFoliage > 2 ? 2 : 0);
  };
  const TREE_COUNT = Math.round(1500 * K * 1.35);
  for (let i = 0; i < TREE_COUNT; i++) {
    const r = Math.sqrt(rnd()) * (WALL_R - 40);
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (r > WALL_R - 55) continue; // off the playable rim
    let blocked = false;
    for (const p of pois) if (Math.hypot(x - p.x, z - p.z) < p.r + 5) { blocked = true; break; }
    if (blocked) continue;
    for (const seg of roads) if (roadDist(x, z, seg) < seg.w / 2 + 5) { blocked = true; break; }
    if (blocked) continue;
    // dense forest bands mid-field, thinner near the rim
    const density = r < WALL_R * 0.35 ? 0.62 : r < WALL_R * 0.75 ? 0.92 : 0.8;
    if (rnd() > density) continue;
    trees.push({ x, z, r: 0.62, s: range(rnd, 0.85, 1.4), kind: poolOf() as Tree["kind"] });
  }

  /* ---- 🚗 parked cars — the village fleet along every big road + plaza lot ----
   * The town island parks a car every ~48 u along its streets; the season maps
   * do the same on their radial + ring roads (never on the narrow POI stubs),
   * nose-in toward the tarmac, alternating kerb sides. The capital gets a real
   * market parking row facing the square. Kit-bodied types only (the season
   * renderer draws every car from the polyfork Retro Cars Kit — no town-GLB
   * taxis/hearses stream on seasonal maps). Colliders land with the rest below. */
  const cars: Car[] = [];
  const SEASON_FLEET: readonly number[] = [0, 0, 1, 1, 2, 2, 3, 3, 6, 6, 7, 7, 8, 8, 9, 9];
  /** ON the tarmac or overlapping a junction/stub mouth — a parked kerb-side
   *  car sits at roadDist ≈ w/2 + 2.9 from its OWN segment, so the thresholds
   *  here must stay INSIDE that (the old +4.2 blanket rejected every car). */
  const carBlocked = (x: number, z: number): boolean => {
    for (const seg of roads) {
      const d = roadDist(x, z, seg);
      if (d < seg.w / 2 + 1.2) return true; // on the tarmac
      if (d < seg.w / 2 + 5.5) {
        // near the kerb of ANOTHER segment → this is a junction or stub mouth
        for (const o of roads) {
          if (o === seg) continue;
          if (roadDist(x, z, o) < o.w / 2 + 6.5) return true;
        }
      }
    }
    return false;
  };
  /** the inner plaza itself — buildings, stalls & the landmark keep this clear */
  const inPlaza = (x: number, z: number): boolean => {
    for (const p of pois) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.42) return true;
    return false;
  };
  for (const seg of roads) {
    if (seg.w < 9) continue; // the 8-wide POI stubs stay pedestrian
    const vx = seg.x2 - seg.x1, vz = seg.z2 - seg.z1;
    const L = Math.hypot(vx, vz);
    if (L < 40) continue;
    const step = 62 * K;
    const n = Math.min(Math.floor(L / step), seg.w >= 10.5 ? 2 : 1);
    const ux = vx / L, uz = vz / L;
    const heading = Math.atan2(vx, vz);
    let side = 1;
    for (let k = 1; k <= n; k++, side = -side) {
      const t = k / (n + 1);
      const off = side * (seg.w / 2 + 2.9);
      const cx = seg.x1 + vx * t - uz * off, cz = seg.z1 + vz * t + ux * off;
      if (Math.hypot(cx, cz) > WALL_R - 30) continue;
      if (carBlocked(cx, cz) || inPlaza(cx, cz)) continue;
      cars.push({
        x: cx + ux * range(rnd, -3, 3), z: cz + uz * range(rnd, -3, 3),
        rot: heading + (side > 0 ? 0 : Math.PI), c: cars.length % 8,
        t: SEASON_FLEET[(cars.length * 7 + 3) % SEASON_FLEET.length],
      });
    }
  }
  // 🎄 capital market lot — a row of nose-in parking facing the square
  if (pois.length > 0) {
    const cap = pois[0];
    for (let i = 0; i < 6; i++) {
      const a = 2.2 + i * 0.16;
      const d = cap.r * 0.78;
      const px = cap.x + Math.cos(a) * d, pz = cap.z + Math.sin(a) * d;
      if (carBlocked(px, pz)) continue;
      cars.push({ x: px, z: pz, rot: a + Math.PI, c: (i + 2) % 8, t: SEASON_FLEET[(i * 5 + 1) % SEASON_FLEET.length] });
    }
    // 🚜 one farm pickup parked by each farm's field gate
    for (const p of pois) {
      if (p.type !== "farm") continue;
      const a = Math.atan2(p.z, p.x);
      const px = p.x + Math.cos(a) * p.r * 0.5, pz = p.z + Math.sin(a) * p.r * 0.5;
      if (carBlocked(px, pz) || inPlaza(px, pz)) continue;
      cars.push({ x: px, z: pz, rot: a + Math.PI / 2, c: 6, t: 3 });
    }
  }
  // 🧊 fleet budget — 300+ kit-car clones burst the 4 GB sandbox's draw call
  // pool; decimate deterministically down to ~150 (every Nth car stays, so the
  // kerb rows keep their rhythm instead of clumping)
  if (cars.length > 150) {
    const keep = Math.ceil(cars.length / 150);
    for (let i = cars.length - 1; i >= 0; i--) {
      if (i % keep !== 0) cars.splice(i, 1);
    }
  }

  /* ---- rocks, ponds, camps, lamps, fields, flowers ---- */
  const rocks: Rock[] = [];
  for (let i = 0; i < Math.round(90 * K * 1.2); i++) {
    const r = Math.sqrt(rnd()) * (WALL_R - 100), a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let blocked = false;
    for (const p of pois) if (Math.hypot(x - p.x, z - p.z) < p.r + 6) { blocked = true; break; }
    if (!blocked) for (const seg of roads) if (roadDist(x, z, seg) < seg.w / 2 + 4) { blocked = true; break; }
    if (!blocked) rocks.push({ x, z, s: range(rnd, 0.7, 1.6) });
  }
  const ponds: Pond[] = [];
  for (let i = 0; i < Math.max(1, Math.round(2 * K)); i++) {
    const a = rnd() * Math.PI * 2, r = range(rnd, WALL_R * 0.45, WALL_R * 0.85);
    ponds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: range(rnd, 10, 16) });
  }
  const camps: Camp[] = [];
  for (let i = 0; i < Math.max(2, Math.round(3 * K)); i++) {
    const a = rnd() * Math.PI * 2, r = range(rnd, WALL_R * 0.6, WALL_R * 0.92);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const tents = [0, 1, 2].map(() => {
      const ta = rnd() * Math.PI * 2, td = range(rnd, 3.2, 5.4);
      return { dx: Math.cos(ta) * td, dz: Math.sin(ta) * td, rot: Math.atan2(-Math.cos(ta), -Math.sin(ta)), c: Math.floor(rnd() * 3), s: range(rnd, 0.9, 1.2) };
    });
    camps.push({
      x: cx, z: cz, rot: rnd() * Math.PI * 2, tents,
      logs: [0, 1, 2, 3].map((k) => { const la = (k / 4) * Math.PI * 2 + 0.4; return { dx: Math.cos(la) * 2.1, dz: Math.sin(la) * 2.1, rot: la + Math.PI / 2 }; }),
      crates: [{ dx: range(rnd, -2, 2), dz: range(rnd, -2, 2), rot: rnd() * 3 }],
      pole: { dx: -3.2, dz: 2.8 },
      kit: { picnic: [], leanTo: null, outhouse: null, barrel: null },
    });
  }
  const lamps: Lamp[] = [];
  for (const seg of roads) {
    if (seg.w < 9) continue; // lamp only the big roads
    const vx = seg.x2 - seg.x1, vz = seg.z2 - seg.z1;
    const L = Math.hypot(vx, vz);
    const step = 105 * Math.max(0.6, K);
    const n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const ox = -vz / L, oz = vx / L;
      const side = k % 2 === 0 ? 1 : -1;
      lamps.push({ x: seg.x1 + vx * t + ox * side * (seg.w / 2 + 1.2), z: seg.z1 + vz * t + oz * side * (seg.w / 2 + 1.2) });
    }
  }
  const benches: Bench[] = [];
  const fields: Field[] = [];
  const flowers: Flower[] = [];
  for (const p of pois) {
    if (p.type !== "farm") continue;
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2, d = p.r * range(rnd, 0.7, 1.1);
      fields.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, w: range(rnd, 10, 16), d: range(rnd, 7, 11), rot: rnd() * Math.PI, crop: Math.floor(rnd() * 4) });
    }
  }
  for (let i = 0; i < Math.round(220 * K * 1.3); i++) {
    const r = Math.sqrt(rnd()) * (WALL_R - 100), a = rnd() * Math.PI * 2;
    flowers.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, c: Math.floor(rnd() * 3), s: range(rnd, 0.7, 1.2) });
  }
  const signs: Sign[] = [];
  for (const p of pois) {
    const pr = Math.hypot(p.x, p.z);
    if (pr < 200) continue;
    const a = Math.atan2(p.z, p.x);
    const d = pr - p.r - 4;
    signs.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rot: a + Math.PI, text: p.name, c: 0 });
  }
  const ferns: FloorProp[] = [];
  const tufts: FloorProp[] = [];
  const bushes: FloorProp[] = [];
  for (let i = 0; i < Math.round(160 * K * 1.3); i++) {
    const r = Math.sqrt(rnd()) * (WALL_R - 100), a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const fp: FloorProp = { x, z, rot: rnd() * Math.PI * 2, s: range(rnd, 0.7, 1.3), c: Math.floor(rnd() * 3) };
    (i % 3 === 0 ? ferns : i % 3 === 1 ? tufts : bushes).push(fp);
  }

  /* ---- colliders: trees FIRST (tree i = circle i), rocks right after ---- */
  const boxes: BoxCollider[] = buildings.map((b) => ({
    x: b.x, z: b.z, w: b.w, d: b.d, h: b.h,
    top: b.kind === 2 || b.kind === 6 ? b.h + (b.kind === 6 ? 3.4 : 2.3) * 0.55 : b.h + 0.9,
  }));
  const circles: CircleCollider[] = trees.map(({ x, z, r }) => ({ x, z, r }));
  const rockCi: number[] = [];
  rocks.forEach((rk, i) => {
    rockCi.push(circles.length);
    circles.push({ x: rk.x, z: rk.z, r: 0.8 * rk.s, rock: i, top: terrain(rk.x, rk.z) + 0.85 * rk.s });
  });
  // kit pieces: solid boxes for buildings/landmarks (standable roofs), posts for props
  const kitRnd = mulberry32(seed ^ 0x9e3779b9);
  for (const g of glb) {
    const fp = kitFootprint(g.role, kitRnd);
    if (g.role === "building" || g.role === "landmark") {
      boxes.push({ x: g.x, z: g.z, w: fp.w, d: fp.d, h: fp.h, top: fp.h + 0.4 });
    } else if (g.role === "prop") {
      circles.push({ x: g.x, z: g.z, r: fp.w });
    } else {
      circles.push({ x: g.x, z: g.z, r: 0.55 });
    }
  }
  // 🚗 every parked car is two axle discs (front + rear, tagged with its car
  // index) — solid metal the player can't walk through, a STANDABLE roof to
  // hop on (the engine's drive system moves these along when a car is driven)
  cars.forEach((c, ci) => {
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    const ax = VEHICLE_AXLE[c.t % VEHICLE_AXLE.length], rr = VEHICLE_AXLE_R[c.t % VEHICLE_AXLE_R.length];
    circles.push({ x: c.x - fx * ax, z: c.z - fz * ax, r: rr, car: ci, top: terrain(c.x - fx * ax, c.z - fz * ax) + CAR_ROOF_TOP });
    circles.push({ x: c.x + fx * ax, z: c.z + fz * ax, r: rr, car: ci, top: terrain(c.x + fx * ax, c.z + fz * ax) + CAR_ROOF_TOP });
  });
  for (const l of lamps) circles.push({ x: l.x, z: l.z, r: 0.3 });
  for (const s of signs) circles.push({ x: s.x, z: s.z, r: 0.45 });
  for (const cp of camps) {
    circles.push({ x: cp.x, z: cp.z, r: 0.95 });
    for (const t of cp.tents) circles.push({ x: cp.x + t.dx, z: cp.z + t.dz, r: 1.55 });
    for (const cr of cp.crates) circles.push({ x: cp.x + cr.dx, z: cp.z + cr.dz, r: 0.55, top: terrain(cp.x + cr.dx, cp.z + cr.dz) + 0.9 });
    if (cp.pole) circles.push({ x: cp.x + cp.pole.dx, z: cp.z + cp.pole.dz, r: 0.3 });
  }
  for (const pd of ponds) circles.push({ x: pd.x, z: pd.z, r: pd.r * 0.82 }); // wade-into-the-edge shallow ring

  /* ---- MapInfo — everything scales off the arena size ---- */
  const wallR = WALL_R;
  const cityR = 1650 * K;
  const zones = (x: number, z: number): Zone => {
    const r = Math.hypot(x, z);
    return r < wallR * 0.3 ? "City" : r < wallR * 0.56 ? "Farmland" : r < wallR * 0.82 ? "Jungle" : "Deep Jungle";
  };
  const map: MapInfo = {
    id: def.id,
    name: def.title,
    seasonal: true,
    wallR,
    cityR,
    farmR: 1780 * K,
    deepR: 1860 * K,
    jungleR: 1940 * K,
    mountInner: 1500 * K,
    mountOuter: 1740 * K,
    zoneRadii: SEASON_ZONE_RADII.map((r) => Math.round(r * K)),
    dropOuter: 2400 * K,
    autoEjectR: 1650 * K,
    dropAlt: 90,
    ringR: 520 * K,
    terrain,
    zones,
  };

  const world: SeasonWorld = {
    buildings,
    trees,
    rocks,
    rockCi,
    flowers,
    boxes,
    circles,
    cars,
    lamps,
    benches,
    fields,
    silos: [],
    umbrellas: [],
    signs,
    windmills: [],
    camps,
    ponds,
    ferns,
    tufts,
    shrooms: [],
    bushes,
    wilds: [],
    stumps: [],
    logs: [],
    reeds: [],
    pads: [],
    stones: [],
    spires: [],
    cabins: [],
    ranger: null,
    lookout: null,
    trucks: [],
    bridges: [],
    docks: [],
    boats: [],
    kiosks: [],
    trailPosts: [],
    trails: [],
    birdhouses: [],
    handcarts: [],
    chopBlocks: [],
    firewood: [],
    woodsheds: [],
    insectProps: [],
    grid: buildColliderGrid(boxes, circles),
    map,
    seasonId: def.id,
    def,
    pois,
    roads,
    glb,
  };
  cache.set(seasonId, world);
  return world;
}
