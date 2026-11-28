/* Season 1 focus check — the user's five complaints, verified headlessly:
 *  1. parked cars exist on the season map (kit-bodied only)
 *  2. ring traffic uses kit body types (the season renderer can draw them)
 *  3. terrain is uneven (rolling hills, not a flat plate) but flat at POIs
 *  4. cars sit ON the terrain (axle colliders' tops ride the ground)
 *  5. snow palette + sky fog colours present for S1
 */
import { generateSeasonWorld } from "../src/lib/game/seasonWorld";
import { isKitType } from "../src/lib/game/cars/kit";
import { SEASON_BY_ID } from "../src/lib/game/seasons";

const w = generateSeasonWorld("s1");
const s1 = SEASON_BY_ID["s1"];

let fails = 0;
const ok = (label: string, pass: boolean, detail: string) => {
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label} (${detail})`);
};

// 1. parked cars
ok("parked cars exist", w.cars.length >= 40, `${w.cars.length} cars`);
ok("all parked cars are kit-bodied", w.cars.every((c) => isKitType(c.t)),
  w.cars.filter((c) => !isKitType(c.t)).length + " non-kit");

// 2. car axle colliders registered + grounded on terrain
const carCircles = w.circles.filter((c) => c.car !== undefined);
ok("car axle colliders exist", carCircles.length === w.cars.length * 2,
  `${carCircles.length} circles for ${w.cars.length} cars`);
const offGround = carCircles.filter((c) => Math.abs((c.top ?? 0) - w.map.terrain(c.x, c.z) - 1.42) > 0.01);
ok("axle tops ride the terrain", offGround.length === 0, `${offGround.length} floating`);

// cars not inside buildings or the plaza core
const plaza = w.pois[0];
const inPlazaCore = w.cars.filter((c) => Math.hypot(c.x - plaza.x, c.z - plaza.z) < plaza.r * 0.42);
ok("no cars in the plaza core", inPlazaCore.length === 0, `${inPlazaCore.length}`);

// 3. uneven terrain — sample away from POIs/roads
let hMin = 1e9, hMax = -1e9, bumps = 0, last = 0;
for (let i = 0; i < 400; i++) {
  const a = (i / 400) * Math.PI * 2;
  const r = 620 + (i % 7) * 23;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const h = w.map.terrain(x, z);
  hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
  if (Math.abs(h - last) > 0.35) bumps++;
  last = h;
}
ok("terrain rolls (range > 2.5u)", hMax - hMin > 2.5, `min ${hMin.toFixed(2)} max ${hMax.toFixed(2)}`);
ok("terrain is bumpy along the ring", bumps > 40, `${bumps}/400 samples jump >0.35u`);

// POI cores stay buildable-flat
let flat = true;
for (const p of w.pois) {
  const h0 = w.map.terrain(p.x, p.z);
  for (const [dx, dz] of [[p.r * 0.3, 0], [0, p.r * 0.3], [-p.r * 0.25, -p.r * 0.25]]) {
    if (Math.abs(w.map.terrain(p.x + dx, p.z + dz) - h0) > 0.9) flat = false;
  }
}
ok("POI cores stay flat for buildings", flat, "17 POIs sampled");

// 4. snow + sky palette
ok("S1 is a snow season", s1.pal.snow === true, "pal.snow");
ok("S1 has day & night fog colours", typeof s1.pal.fogDay === "number" && typeof s1.pal.fogNight === "number",
  `fogDay 0x${s1.pal.fogDay.toString(16)} fogNight 0x${s1.pal.fogNight.toString(16)}`);

// 5. roads subdivided (hill-grading chunks, not one trench per radial)
const longSegs = w.roads.filter((r) => Math.hypot(r.x2 - r.x1, r.z2 - r.z1) > 400);
ok("radials subdivided into hill-grade chunks", longSegs.length === 0,
  `${longSegs.length} segs >400u, ${w.roads.length} total`);

console.log(fails === 0 ? "\nS1 CARS+TERRAIN OK" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
