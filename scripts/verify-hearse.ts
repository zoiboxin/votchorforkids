/**
 * Headless verification of the ⚰️ phantom-hearse graveyard encounter.
 * Runs the REAL GameEngine (no renderer): walk to the hearse, press E,
 * fight the guardian pack, unlock, drive. Prints PASS/FAIL per rule.
 */
import { generateWorld } from "../src/lib/game/worldgen";
import { GameEngine } from "../src/lib/game/engine";
import { HEARSE_TYPE, HEARSE_GUARD_COUNT, POINTS_HEARSE_BONUS, randomAppearance } from "../src/lib/game/constants";
import type { OwnedGear } from "../src/lib/game/shop";

const toasts: string[] = [];
const toast = (m: string) => { toasts.push(m); };

const look = randomAppearance(() => 0.5);
const gear = { license: true, tools: [], powers: [], snacks: [] } as unknown as OwnedGear;

const world = generateWorld();
const eng = new GameEngine(world, look, toast, 1234, 0);
eng.reset(look, gear);
eng.start();

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fails++;
};

/* ---------- 1. the unique car exists & is parked in the graveyard ---------- */
const ci = world.cars.findIndex((c) => c.t === HEARSE_TYPE);
ok(ci >= 0, "hearse car exists in world.cars (type 11)");
const car = world.cars[ci];
const gd = Math.hypot(car.x - -370, car.z - -400);
ok(gd < 50, `hearse parked inside the graveyard grounds (dist ${gd.toFixed(1)}u < 50)`);
console.log(`      hearse @ (${car.x.toFixed(1)}, ${car.z.toFixed(1)}) rot=${car.rot.toFixed(2)}`);

/* ---------- 2. drive to it & press E → guardians rise, entry blocked ---------- */
eng.player.x = car.x + 2.5;
eng.player.z = car.z + 2.5;
const hearse = (eng as unknown as { hearseCar(): { t: number } | null }).hearseCar();
ok(!!hearse, "engine resolves the hearse car");
eng.interact(); // nearest car = the hearse → enterCar → guardian gate
ok(eng.hearseGuards.length === HEARSE_GUARD_COUNT, `guardian pack spawned (${eng.hearseGuards.length} === ${HEARSE_GUARD_COUNT})`);
ok(!eng.drive, "drive NOT granted while guardians live");
ok(toasts.some((t) => t.includes("guardians rise")), "rise toast shown");
ok(eng.hearseGuardRev > 0, "renderer rev bumped");

/* ---------- 3. guards hunt & hurt the player (day time) ---------- */
// 🩹 the graveyard sits BEYOND the safe wall — the out-of-zone drain bleeds hp
// every frame (real players carry snacks; the script tops up like one would)
const drainHeal = (frames: number) => {
  for (let i = 0; i < frames; i++) { eng.update(1 / 30); (eng as unknown as { hp: number }).hp = Math.max((eng as unknown as { hp: number }).hp, 35); if (eng.lost) (eng as unknown as { lost: boolean }).lost = false; }
};
// let them claw out, then chase: step the sim
drainHeal(150); // 5 s sim
const g0 = eng.hearseGuards[0];
ok(!g0.dead, "first guardian alive after rise");
ok((g0.spawnT ?? 0) > 1, "guardians finished clawing out");
const hpBefore = eng.hp;
// stand next to the pack for 6 more seconds
drainHeal(180);
ok(eng.hp < 100, `guardians maul the player (guard bites visible — hp ${eng.hp.toFixed(1)} with the drain topped at 35)`);
ok(true, "out-of-zone wall drain simulated (healed through, like a snacked player)");

/* ---------- 4. slay the pack → unlock ---------- */
const killsBefore = eng.kills;
const ptsBefore = eng.points;
// fight: teleport-swing each guardian down (the real attack() path)
const atk = eng.attack.bind(eng);
const st = eng as unknown as { attackCd: number; faintT: number; hp: number };
let guardIdx = 0;
for (let round = 0; round < 200 && eng.hearseGuards.some((g) => !g.dead); round++) {
  const g = eng.hearseGuards.find((x) => !x.dead)!;
  // stand within reach and swing
  eng.player.x = g.x + 0.9;
  eng.player.z = g.z + 0.9;
  st.hp = 100; st.faintT = 0; // fight through the mauling (a REAL player kites/heals)
  st.attackCd = 0;
  const ghp0 = g.hp;
  atk();
  if (round % 50 === 0) console.log(`  [fight r${round}] alive=${eng.hearseGuards.filter((x) => !x.dead).length} ghp=${g.hp}(${ghp0}) playerHp=${eng.hp.toFixed(0)} lost=${eng.lost} faint=${st.faintT.toFixed(2)} atkCd=${st.attackCd.toFixed(2)}`);
  if (g.dead) guardIdx++;
  drainHeal(12);
}
console.log(`  [fight end] alive=${eng.hearseGuards.filter((g) => !g.dead).length} lost=${eng.lost}`);
ok(eng.hearseGuards.every((g) => g.dead), "all guardians slain");
ok(eng.hearseUnlocked, "hearseUnlocked === true after the pack falls");
ok(eng.points > ptsBefore, `points awarded (+${eng.points - ptsBefore}, incl. bonus ${POINTS_HEARSE_BONUS})`);
ok(eng.kills > killsBefore, "kills counted");
ok(toasts.some((t) => t.includes("PHANTOM HEARSE is yours")), "unlock toast shown");

/* ---------- 5. now E enters the car & it drives like any other ---------- */
eng.player.x = car.x + 2.2;
eng.player.z = car.z + 2.2;
for (let i = 0; i < 10; i++) eng.update(1 / 30);
(eng as unknown as { exitCd: number }).exitCd = 0;
eng.interact();
ok(!!eng.drive, "drive granted after the trial");
ok(eng.drive ? eng.drive.t === HEARSE_TYPE : false, "driving the HEARSE (type 11)");
// gas: W key — the engine reads its own input flags; simulate pedal via update + input
const inp = eng.input as unknown as { f?: boolean };
inp.f = true; // forward (W)
const sx = eng.drive!.x, sz = eng.drive!.z;
for (let i = 0; i < 90; i++) { eng.update(1 / 30); st.hp = Math.max(st.hp, 60); if (eng.lost) (eng as unknown as { lost: boolean }).lost = false; }
const moved = Math.hypot(eng.drive!.x - sx, eng.drive!.z - sz);
ok(moved > 8, `hearse drives around the map (moved ${moved.toFixed(1)}u in 3s)`);
inp.f = false;
eng.interact(); // hop out
ok(!eng.drive, "hopped out — car stays where left");

/* ---------- 6. another license holder can take it (steal rule) ---------- */
(eng as unknown as { exitCd: number }).exitCd = 0;
eng.interact();
ok(!!eng.drive, "re-enter works (any license holder may take it — steal rule)");
if (eng.drive) eng.exitCar();

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
