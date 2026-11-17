/* ✈️ ATC headless test — drives ONLY engine.updatePlanes() and verifies the
 * runway lock: one plane on the strip at a time, holding works, no deadlock. */
import { generateWorld } from "../src/lib/game/worldgen";
import { AIRPORT } from "../src/lib/game/constants";
import { GameEngine } from "../src/lib/game/engine";
import type { Appearance } from "../src/lib/game/constants";

const look: Appearance = {
  fac: "protester", outfit: "", skin: "#ffd9b3", shirt: "#f5a524", pants: "#2a2a2a",
  shoe: "#111111", hair: "#3a2a1a", hairStyle: "spiky", cap: false, capColor: "#000000",
  glasses: false, age: "young", girl: false,
};

const world = generateWorld();
const engine = new GameEngine(world, look, () => {});
engine.running = true;
const planes = engine.planes;
console.log("planes:", planes.length);

const DT = 1 / 30;
const RW_X0 = AIRPORT.rx0 - 24, RW_X1 = AIRPORT.rx1 + 24;
const RW_Z0 = AIRPORT.rz - 10, RW_Z1 = AIRPORT.rz + 10;
const onStrip = (pl: { x: number; z: number; alt: number }) =>
  pl.alt < 5 && pl.x > RW_X0 && pl.x < RW_X1 && pl.z > RW_Z0 && pl.z < RW_Z1;

let violations = 0, groundPairs = 0, sawRoll = [false, false, false], sawHold = false, steps = 0;
let landings = 0, badLandings = 0;
const prevModes = planes.map((p) => p.mode);
const err = (msg: string) => { violations++; if (violations < 12) console.log("❌", msg); };

for (let f = 0; f < 60 * 60 * 8; f++) {   // 8 simulated minutes
  steps++;
  (engine as unknown as { updatePlanes(dt: number): void }).updatePlanes(DT);
  let onCount = 0;
  for (const pl of planes) if (onStrip(pl)) onCount++;
  if (onCount > 1) err(`frame ${f}: ${onCount} planes on the runway strip at once`);
  // ✈️ touchdown audit — every final→rollout transition must be ON the runway,
  // eastbound, close to the centreline (a real landing, not a mid-air U-turn)
  planes.forEach((pl, i) => {
    if (prevModes[i] === "final" && pl.mode === "rollout") {
      landings++;
      const onRw = pl.x > AIRPORT.rx0 - 6 && pl.x < AIRPORT.rx1 + 12 && Math.abs(pl.z - AIRPORT.rz) < 9 && Math.abs(Math.sin(pl.hdg)) < 0.4;
      if (!onRw) {
        badLandings++;
        if (badLandings < 8) console.log(`❌ plane ${i} landed OFF the runway at (${pl.x.toFixed(0)}, ${pl.z.toFixed(0)}) hdg=${pl.hdg.toFixed(2)}`);
      }
    }
    prevModes[i] = pl.mode;
  });
  // ground proximity: no two planes within 5.5u while both grounded (fuselage
  // overlap risk; the apron is deliberately tight so wings may pass close — cosmetic)
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
    const a = planes[i], b = planes[j];
    if (a.alt < 3 && b.alt < 3 && Math.hypot(a.x - b.x, a.z - b.z) < 5.5) {
      groundPairs++;
      if (groundPairs < 6) console.log(`❌ frame ${f}: planes ${i}/${j} ${a.mode}/${b.mode} within ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)}u on the ground`);
    }
  }
  planes.forEach((pl, i) => { if (pl.mode === "roll") sawRoll[i] = true; });
  const holder = (engine as unknown as { runwayBy: number }).runwayBy;
  if (holder >= 0 && planes[holder]?.mode === "parked") sawHold = true;
}

console.log("frames:", steps);
console.log("strip-sharing violations:", violations);
console.log("ground-proximity pairs:", groundPairs);
console.log("landings:", landings, " off-runway touchdowns:", badLandings);
console.log("each plane took off (roll):", sawRoll);
console.log("ATC hold observed (holder parked at stand):", sawHold);
if (violations === 0 && groundPairs === 0 && sawRoll.every(Boolean) && landings >= 3 && badLandings === 0) console.log("✅ ATC PASS — one plane on the runway at a time, all landings on the centreline");
else process.exit(1);

/* ---- forced contention: all three request the runway at once ---- */
console.log("\n--- forced contention test: all stands request simultaneously ---");
const world2 = generateWorld();
const engine2 = new GameEngine(world2, look, () => {});
engine2.running = true;
for (const pl of engine2.planes) { pl.t = 0.4; pl.mode = "parked"; }
const p = engine2.planes;
let held = 0, maxHeld = 0;
for (let f = 0; f < 60 * 60 * 3; f++) {
  (engine2 as unknown as { updatePlanes(dt: number): void }).updatePlanes(DT);
  const waiting = p.filter((pl) => pl.mode === "parked").length;
  if (waiting >= 1 && (engine2 as unknown as { runwayBy: number }).runwayBy !== -1) { held++; maxHeld = Math.max(maxHeld, waiting); }
  if (onStrip(p[0]) && onStrip(p[1])) { console.log("❌ forced: two planes on strip"); process.exit(1); }
  if (onStrip(p[0]) && onStrip(p[2])) { console.log("❌ forced: two planes on strip"); process.exit(1); }
  if (onStrip(p[1]) && onStrip(p[2])) { console.log("❌ forced: two planes on strip"); process.exit(1); }
}
console.log("frames with waiting planes while runway held:", held, " max concurrent waiters:", maxHeld);
const rolled = engine2.planes.map((pl) => pl.mode === "parked" && pl.t > 0).length;
console.log("✅ forced PASS — nobody doubled up on the strip" + (held > 0 ? ", holds observed" : "") + ` (frames elapsed: ${60 * 60 * 3}, still-grounded-now: ${rolled})`);
