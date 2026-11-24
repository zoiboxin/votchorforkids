/**
 * Headless verification of the 🪪 VIP-license → drive flow (the "purchased
 * license but the game doesn't show it / can't drive" bug).
 * Runs the REAL GameEngine (no renderer):
 *   1. reset() with locker gear carrying the purchased license → hasLicense
 *   2. the run-start toast advertises the license (gearSummary)
 *   3. E beside a parked car → driving, gas moves the car, hop out
 *   4. buildHud() exposes hasLicense so the HUD badge shows
 *   5. without the license the same E is refused with a clear toast
 */
import { generateWorld } from "../src/lib/game/worldgen";
import { GameEngine } from "../src/lib/game/engine";
import { randomAppearance } from "../src/lib/game/constants";
import { ownedGear, gearSummary } from "../src/lib/game/shop";

const toasts: string[] = [];
const toast = (m: string) => { toasts.push(m); };

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fails++;
};

/* ---------- the wallet state after buying perk-license in the shop ---------- */
const owned = ["perk-license"];
const gear = ownedGear(owned);
ok(gear.license === true, "ownedGear(['perk-license']) grants license:true");

const look = randomAppearance(() => 0.5);
const world = generateWorld();
const eng = new GameEngine(world, look, toast, 4321, 0);

/* ---------- 1. run start: the locker gear grants the license ---------- */
eng.reset(look, gear);
ok(eng.hasLicense === true, "engine.hasLicense === true after reset with purchased license");
const gs = gearSummary(gear);
ok(gs.includes("License"), `locker-gear toast advertises it ("${gs}")`);

/* ---------- 4. the HUD snapshot exposes it ---------- */
const hud = eng.getHud();
ok(hud.hasLicense === true, "buildHud exposes hasLicense (HUD badge can render)");

/* ---------- 5. E beside a parked car drives it ---------- */
const cars = world.cars;
let best = -1, bd = Infinity;
for (let i = 0; i < cars.length; i++) {
  const d = Math.hypot(cars[i].x - eng.player.x, cars[i].z - eng.player.z);
  if (d < bd) { bd = d; best = i; }
}
ok(best >= 0, `a parked car exists (car #${best}, ${bd.toFixed(0)}u from spawn)`);
eng.player.x = cars[best].x + 2.2;
eng.player.z = cars[best].z + 2.2;
for (let i = 0; i < 5; i++) eng.update(1 / 30); // settle exitCd etc.
(eng as unknown as { exitCd: number }).exitCd = 0;
eng.interact();
ok(!!eng.drive, "E beside the car WITH the license → driving");

/* gas: drive forward like a player holding W */
const inp = eng.input as unknown as { f?: boolean };
inp.f = true;
const sx = eng.drive!.x, sz = eng.drive!.z;
for (let i = 0; i < 90; i++) eng.update(1 / 30);
const moved = Math.hypot(eng.drive!.x - sx, eng.drive!.z - sz);
ok(moved > 8, `the car actually drives (moved ${moved.toFixed(1)}u in 3s)`);
inp.f = false;
eng.interact(); // hop out
ok(!eng.drive, "E again hops out");

/* ---------- 6. no license → refused with a helpful toast ---------- */
const eng2 = new GameEngine(world, look, toast, 4321, 0);
eng2.reset(look, ownedGear([]));
ok(eng2.hasLicense === false, "no purchase → hasLicense stays false");
eng2.player.x = cars[best].x + 2.2;
eng2.player.z = cars[best].z + 2.2;
for (let i = 0; i < 5; i++) eng2.update(1 / 30);
(eng2 as unknown as { exitCd: number }).exitCd = 0;
const toastsBefore = toasts.length;
eng2.interact();
ok(!eng2.drive, "E without the license is refused");
ok(toasts.length > toastsBefore && toasts.slice(toastsBefore).some((t) => t.toLowerCase().includes("license")), "the refusal toast explains the license requirement");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
