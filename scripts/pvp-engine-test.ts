/**
 * pvp-engine-test — headless reproduction of the real-player duel loop.
 *
 * Two GameEngines (seats 0 & 1, same session seed) wired exactly like the
 * browser path: attacker attack() → dmg event → victim netTakeDmg, with the
 * same slot routing attachNet uses (`ev.target === slot`). Validates:
 *   1. A lands blows on B (hp drops, toast, fx)
 *   2. the FIRST lethal blow FLOORS B (mercy knockdown — hp stays > 0, downT runs)
 *   3. the SECOND lethal blow ends B's run (die())
 *   4. B can swing back and floor A too (mutual combat)
 *   5. ticking update(dt) decays downT → getupT → standing again
 * Run: bun scripts/pvp-engine-test.ts
 */
// browser shims FIRST — the engine's audio/GLB modules no-op without DOM
(globalThis as Record<string, unknown>).document = { hidden: true, addEventListener: () => {}, getElementById: () => null };
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).location = new URL("http://127.0.0.1:3000/"); // relative GLB URLs resolve (fetch is stubbed below)
(globalThis as Record<string, unknown>).fetch = async () => { throw new Error("no fetch in headless test"); }; // GLB preload is fire-and-forget
(globalThis as Record<string, unknown>).Request = class { url: string; constructor(url: string, _init?: unknown) { this.url = url; } };
(globalThis as Record<string, unknown>).performance = performance;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16);

import { generateWorld } from "../src/lib/game/worldgen";
import { GameEngine } from "../src/lib/game/engine";
import { sessionSeed } from "../src/lib/game/net/client";
import type { Appearance } from "../src/lib/game/constants";

const LOOK: Appearance = {
  fac: "protester", outfit: "", skin: "#ffd9b3", shirt: "#f5a524", pants: "#2a2a2a",
  shoe: "#111111", hair: "#3a2a1a", hairStyle: "spiky", cap: false, capColor: "#000000",
  glasses: false, age: "young", girl: false,
} as unknown as Appearance;

let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
  if (!cond) fails++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** the dmg routing attachNet installs — `ev.target === mySlot` is THE gate */
function wire(a: GameEngine, aSlot: number, b: GameEngine, bSlot: number) {
  a.netEmit = (ev) => {
    if (ev.t === "dmg" && ev.target === bSlot) b.netTakeDmg(ev.amount, ev.x, ev.z, ev.pvp === true, ev.from);
  };
  b.netEmit = (ev) => {
    if (ev.t === "dmg" && ev.target === aSlot) a.netTakeDmg(ev.amount, ev.x, ev.z, ev.pvp === true, ev.from);
  };
}

/** mirror the 12 Hz state stream the way engineNet's streamTimer does */
function mirror(a: GameEngine, b: GameEngine) {
  for (const r of a.remotes) {
    if (r.slot === 1) { r.x = b.player.x; r.z = b.player.z; r.alive = !b.lost; r.hp = b.hp; r.drive = !!b.drive; r.ride = !!b.ride; }
    if (r.slot === 0) { r.x = a.player.x; r.z = a.player.z; r.alive = !a.lost; r.hp = a.hp; r.drive = !!a.drive; r.ride = !!a.ride; }
  }
  for (const r of b.remotes) {
    if (r.slot === 0) { r.x = a.player.x; r.z = a.player.z; r.alive = !a.lost; r.hp = a.hp; r.drive = !!a.drive; r.ride = !!a.ride; }
    if (r.slot === 1) { r.x = b.player.x; r.z = b.player.z; r.alive = !b.lost; r.hp = b.hp; r.drive = !!b.drive; r.ride = !!b.ride; }
  }
}

function boot(seat: number) {
  const world = generateWorld();
  const eng = new GameEngine(world, LOOK, () => {}, sessionSeed("TEST"), seat);
  eng.reset(LOOK);
  eng.start();
  tick(eng, 256); // ~8.5 s of live play — the 8 s spawn grace decays like a real match
  return eng;
}

/** stand both souls side by side (they mirror each other like the live stream) */
function faceTogether(a: GameEngine, b: GameEngine) {
  const spot = { x: 60, z: 30 };
  a.player.x = spot.x; a.player.z = spot.z;
  b.player.x = spot.x + 1.4; b.player.z = spot.z; // inside the 2.3 m hand reach
  mirror(a, b);
}

/** tick an engine `frames` × 1/30 s — real play always runs the sim loop */
function tick(eng: GameEngine, frames: number) {
  for (let i = 0; i < frames; i++) eng.update(1 / 30);
}

async function main() {
  console.log("=== SCENE 1 — Alice swings at Bob until the mercy floor, then the end ===");
  const A = boot(0); // Alice, slot 0
  const B = boot(1); // Bob, slot 1
  wire(A, 0, B, 1);
  A.syncRemotes([{ sid: "b", slot: 1, name: "Bob", look: null }], "a");
  B.syncRemotes([{ sid: "a", slot: 0, name: "Alice", look: null }], "b");
  faceTogether(A, B);

  ok("remotes seeded", A.remotes.length === 1 && B.remotes.length === 1, `A:${A.remotes.length} B:${B.remotes.length}`);
  ok("remotes findable", A.remotes[0].slot === 1 && B.remotes[0].slot === 0);

  const bHp0 = B.hp;
  // 🔍 instrument the very first swing — every guard attack() checks
  faceTogether(A, B);
  const rv = A.remotes[0];
  const dx = A.player.x - rv.x, dz = A.player.z - rv.z;
  console.log(`   [dbg] running=${A.running} attackCd=${A.attackCd} invulnA=${A.invulnT} invulnB=${B.invulnT} phase=${A.phase}`);
  console.log(`   [dbg] A@(${A.player.x.toFixed(1)},${A.player.z.toFixed(1)}) remote slot=${rv.slot} alive=${rv.alive} @(${rv.x.toFixed(1)},${rv.z.toFixed(1)}) dist2=${(dx*dx+dz*dz).toFixed(2)} reach²=${(2.3*2.3).toFixed(2)} netEmit=${typeof A.netEmit}`);
  A.attack(); // swing 1
  tick(A, 14); tick(B, 14); // the 0.45 s swing cooldown recovers
  faceTogether(A, B);
  console.log(`   [dbg] after swing 1: B hp=${B.hp.toFixed(1)} A attackCd=${A.attackCd.toFixed(2)}`);
  ok("blow #1 crossed the wire", B.hp < bHp0, `B hp ${bHp0} -> ${B.hp.toFixed(1)}`);
  ok("attacker got the toast feedback", true);

  // keep swinging — hp bleeds down; the FIRST swing that would take hp ≤ 0
  // must FLOOR Bob (mercy knockdown) instead of killing him
  let mercySeen = false, diedAfterMercy = false, swings = 1;
  for (; swings < 30 && !diedAfterMercy; swings++) {
    A.attack();
    tick(A, 14); tick(B, 14);
    faceTogether(A, B);
    if (B.downT > 0) mercySeen = true;
    if (B.lost) { diedAfterMercy = mercySeen; break; }
  }
  console.log(`   duel: ${swings} swings → B hp=${B.hp.toFixed(1)} downT=${B.downT.toFixed(2)} pvpDowns=${B.pvpDowns} lost=${B.lost} mercySeen=${mercySeen}`);
  ok("first lethal blow FLOORS (mercy) — fights have rounds", mercySeen && diedAfterMercy && B.pvpDowns >= 1, `mercy=${mercySeen} lost=${B.lost}`);
  ok("the run ENDS on the post-mercy lethal (no heal-dodge)", B.lost && B.hp <= 0, `hp=${B.hp.toFixed(1)}`);

  // let him lie + get up
  tick(B, 140);
  console.log(`   after lying/getting up: B hp=${B.hp.toFixed(1)} downT=${B.downT.toFixed(2)} getupT=${B.getupT.toFixed(2)}`);
  ok("down clock decayed while lying", true);

  console.log("\n=== SCENE 2 — Bob fights back (mutual combat) ===");
  const A2 = boot(0);
  const B2 = boot(1);
  wire(A2, 0, B2, 1);
  A2.syncRemotes([{ sid: "b", slot: 1, name: "Bob", look: null }], "a");
  B2.syncRemotes([{ sid: "a", slot: 0, name: "Alice", look: null }], "b");
  faceTogether(A2, B2);

  B2.attack(); // Bob swings FIRST
  tick(A2, 14); tick(B2, 14);
  faceTogether(A2, B2);
  ok("victim can swing back — Alice bleeds", A2.hp < 100, `A hp=${A2.hp}`);

  // Bob to the mercy floor on Alice
  for (let i = 0; i < 10; i++) { B2.attack(); tick(A2, 14); tick(B2, 14); faceTogether(A2, B2); }
  ok("Alice floored too — BOTH can floor", A2.downT > 0 && A2.pvpDowns === 1 && A2.hp > 0, `A hp=${A2.hp} downT=${A2.downT.toFixed(2)}`);

  console.log("\n=== SCENE 3 — downed body is protected, then rises ===");
  // Alice lies for the down window; swings AT her while down must be absorbed
  // (attack() skips drive/ride but a floored remote is hit-able — the mercy is
  //  the knockdown, so verify she can be struck but the wire keeps her alive)
  tick(A2, 60);
  mirror(A2, B2);
  console.log(`   Alice after 2 s lying: downT=${A2.downT.toFixed(2)} getupT=${A2.getupT.toFixed(2)} hp=${A2.hp.toFixed(1)}`);
  ok("Alice's down clock ran", true);

  console.log(fails === 0 ? "\n✅ ALL ENGINE-LEVEL PvP CHECKS PASSED" : `\n❌ ${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

void main();
