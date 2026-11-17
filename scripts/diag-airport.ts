/* Diagnostic: what sits on the runway / inside the hangar / near (260,248)? */
import { generateWorld, inAirportPlot, inFlightZone, ROADS, ROAD_W, RING_R, RING_W, RING_GAP } from "../src/lib/game/worldgen";
import { AIRPORT } from "../src/lib/game/constants";

const w = generateWorld();

// runway slab as rendered in <Airport>: rwLen = rx1-rx0+36, centered rwCx, width rw
const rwLen = AIRPORT.rx1 - AIRPORT.rx0 + 36;
const rwCx = (AIRPORT.rx0 + AIRPORT.rx1) / 2;
const rwX0 = rwCx - rwLen / 2, rwX1 = rwCx + rwLen / 2;
const rwZ0 = AIRPORT.rz - AIRPORT.rw / 2, rwZ1 = AIRPORT.rz + AIRPORT.rw / 2;

// hangar interior (open front faces -z toward runway)
const hgx0 = AIRPORT.hangar.x - AIRPORT.hangar.w, hgx1 = AIRPORT.hangar.x + AIRPORT.hangar.w;
const hgz0 = AIRPORT.hangar.z - AIRPORT.hangar.d, hgz1 = AIRPORT.hangar.z + AIRPORT.hangar.d;

const inRect = (x: number, z: number, x0: number, z0: number, x1: number, z1: number, pad = 0) =>
  x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad;

let bad = 0;
const fail = (msg: string) => { bad++; console.log("❌", msg); };

console.log("=== 1. TREES on runway slab / hangar / flight zone ===");
for (const t of w.trees) {
  if (inRect(t.x, t.z, rwX0, rwZ0, rwX1, rwZ1, 3)) fail(`tree on runway (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
  if (inRect(t.x, t.z, hgx0, hgz0, hgx1, hgz1, 1)) fail(`tree in hangar (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
  if (inFlightZone(t.x, t.z)) fail(`tree in flight zone (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) r=${Math.hypot(t.x, t.z).toFixed(0)}`);
}
console.log("checked", w.trees.length, "trees");

console.log("=== 2. SCATTER + rocks + ponds in flight zone ===");
const lists: [string, { x: number; z: number }[] | undefined][] = [
  ["bush", w.bushes as unknown as { x: number; z: number }[]],
  ["fern", w.ferns as unknown as { x: number; z: number }[]],
  ["tuft", w.tufts as unknown as { x: number; z: number }[]],
  ["stump", w.stumps as unknown as { x: number; z: number }[]],
  ["log", w.logs as unknown as { x: number; z: number }[]],
  ["rock", w.rocks as unknown as { x: number; z: number }[]],
];
for (const [name, list] of lists) {
  if (!list) continue;
  for (const p of list) if (inFlightZone(p.x, p.z)) fail(`${name} in flight zone (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
}
console.log("done");

console.log("=== 3. BUILDINGS on ring highway (the (260,248) fix) ===");
for (const b of w.buildings) {
  const r = Math.hypot(b.x, b.z);
  if (Math.abs(r - RING_R) < RING_W / 2 + Math.max(b.w, b.d)) fail(`building kind=${b.kind} at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) sits ON the ring (r=${r.toFixed(1)})`);
}
console.log("checked", w.buildings.length, "buildings");

console.log("=== 4. BUILDINGS inside the airport plot ===");
for (const b of w.buildings) {
  if (inAirportPlot(b.x, b.z)) console.log(`  plot building kind=${b.kind} at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) — must be airport-only furniture`);
}

console.log("=== 5. PONDS in flight zone ===");
const ponds = (w as unknown as { ponds?: { x: number; z: number }[] }).ponds ?? [];
for (const p of ponds) if (inFlightZone(p.x, p.z)) fail(`pond in flight zone (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
console.log("checked", ponds.length, "ponds");

console.log("=== 6. Bypass chord clearance (new RING_GAP", (RING_GAP.a0 * 180 / Math.PI).toFixed(1), "→", (RING_GAP.a1 * 180 / Math.PI).toFixed(1), ") ===");
const ax = RING_R * Math.cos(RING_GAP.a0), az = RING_R * Math.sin(RING_GAP.a0);
const bx = RING_R * Math.cos(RING_GAP.a1), bz = RING_R * Math.sin(RING_GAP.a1);
const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
const distTo = (px: number, pz: number) => Math.abs(dx * (pz - az) - dz * (px - ax)) / L;
console.log("  chord", L.toFixed(1), "u; arc", ((RING_GAP.a1 - RING_GAP.a0) * RING_R).toFixed(1), "u");
console.log("  → slab NW corner (207, 292):", distTo(207, 292).toFixed(1), "u");
console.log("  → slab SW corner (207, 308):", distTo(207, 308).toFixed(1), "u");
console.log("  → approach crossbar (206, 300):", distTo(206, 300).toFixed(1), "u");
console.log("  → threshold (225, 300):", distTo(225, 300).toFixed(1), "u");
if (distTo(207, 292) < 9 || distTo(206, 300) < 12) fail("chord too close to the runway/approach");

console.log("=== 7. Roads drawn inside the airport plot ===");
// vertical tarmacs stop at zEnd = rz-34; z=270 horizontal ends at STREET_END=171
const STREET_END = 171;
for (const k of ROADS) {
  if (k > AIRPORT.rx0 - 46 && k < AIRPORT.rx1 + 26) {
    console.log(`  vertical x=${k} tarmac stops at z=${AIRPORT.rz - 34} ✓`);
  }
  if (k > AIRPORT.rz - 34 && k < AIRPORT.terminal.z + AIRPORT.terminal.d + 12) {
    console.log(`  horizontal z=${k} tarmac stops at x=${STREET_END}${STREET_END < AIRPORT.rx0 - 46 ? " (outside plot) ✓" : " (INSIDE plot) ✗"}`);
    if (STREET_END > AIRPORT.rx0 - 46) fail("z=270 street still runs into the plot");
  }
}

console.log("=== 8. Barn/farm buildings vs plot & road z=270 ===");
for (const b of w.buildings) {
  if (b.kind === 6) {
    const inPlot = inAirportPlot(b.x, b.z);
    console.log(`  barn at (${b.x}, ${b.z}) inPlot=${inPlot}`);
    if (inPlot) fail("barn still inside the airport plot");
    const nearRoad = Math.abs(b.z - 270) < ROAD_W / 2 + b.d;
    if (nearRoad) fail(`barn at (${b.x}, ${b.z}) touches the z=270 road corridor`);
  }
}

console.log(bad === 0 ? "\n✅ WORLD PASS — airport area clean, no home on the ring, roads clear" : `\n❌ ${bad} problems found`);
if (bad > 0) process.exit(1);
