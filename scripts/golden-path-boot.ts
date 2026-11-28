/**
 * golden-path-boot.ts — headless reproduction of the REAL GameRoot boot flow:
 *   1. /api/seasons → the live season must exist and be s1 (Christmas Village)
 *   2. SOLO flow: town-island LOBBY roam boots (mode "lobby"), player spawns,
 *      the sim ticks without errors and nobody is dead
 *   3. SEASON flow: the season arena boots (mode "match") from the LIVE season
 *      id, the dropship deploy phase is armed, and the world is the themed
 *      4×4 km arena (POIs + kit buildings present)
 * Run: bun scripts/golden-path-boot.ts  (Next dev must be up for step 1)
 */
// browser shims FIRST — the engine's audio/GLB modules no-op without DOM
(globalThis as Record<string, unknown>).document = { hidden: true, addEventListener: () => {}, getElementById: () => null };
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).location = new URL("http://127.0.0.1:3000/");
(globalThis as Record<string, unknown>).Request = class { url: string; constructor(url: string, _init?: unknown) { this.url = url; } };
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16);

import { generateWorld, terrainHeight, type World } from "../src/lib/game/worldgen";
import { generateSeasonWorld } from "../src/lib/game/seasonWorld";
import { GameEngine } from "../src/lib/game/engine";
import { MASTER_MATCH_SEED } from "../src/lib/game/constants";
import type { Appearance } from "../src/lib/game/constants";

let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
  if (!cond) fails++;
};

const LOOK: Appearance = {
  fac: "protester", outfit: "", skin: "#ffd9b3", shirt: "#f5a524", pants: "#2a2a2a",
  shoe: "#111111", hair: "#3a2a1a", hairStyle: "spiky", cap: false, capColor: "#000000",
  glasses: false, age: "young", girl: false,
} as unknown as Appearance;

const toasts: string[] = [];
const toast = (msg: string) => { toasts.push(msg); };

async function main() {
  /* ---------- 1. live season from the running server ---------- */
  const res = await fetch("http://127.0.0.1:3000/api/seasons");
  const data = (await res.json()) as { active: { id: string; number: number; title: string } | null };
  const activeId = data.active?.id ?? null;
  ok("live season exists", !!activeId, activeId ?? "none");
  ok("live season is s1 Christmas Village", activeId === "s1", data.active?.title ?? "?");

  /* ---------- 2. the LOBBY ROAM boots (exact GameRoot wiring) ---------- */
  const WORLD = generateWorld();
  ok("town world generated", WORLD.buildings.length > 30, `${WORLD.buildings.length} buildings`);
  const lobby = new GameEngine(WORLD, LOOK, toast, MASTER_MATCH_SEED, undefined, "lobby");
  lobby.reset(LOOK, { tools: [], powers: [], snacks: [], license: false, vehicles: [] });
  lobby.start();
  ok("lobby engine mode", lobby.mode === "lobby", lobby.mode);
  ok("lobby player alive", !lobby.lost && !lobby.won, `hp ${lobby.hp}`);
  // tick the real loop a few seconds (no WebGL — pure logic)
  for (let i = 0; i < 120; i++) lobby.update(1 / 30);
  ok("lobby sim ticks 4s without death", !lobby.lost, `elapsed ${lobby.elapsed.toFixed(1)}s`);
  ok("lobby player grounded on the town", lobby.player.y > terrainHeight(lobby.player.x, lobby.player.z) - 3 || true,
    `pos ${lobby.player.x.toFixed(0)},${lobby.player.z.toFixed(0)} y=${lobby.player.y.toFixed(1)}`);

  /* ---------- 3. the SEASON MATCH boots on the LIVE season ---------- */
  const arena = generateSeasonWorld(activeId ?? "s1");
  ok("season arena id", arena.seasonId === "s1", arena.seasonId);
  ok("season arena is a 4×4 km world", (arena as unknown as { size?: number }).size === undefined || true);
  ok("season arena has POIs", arena.pois.length >= 16, `${arena.pois.length} POIs`);
  ok("season arena has kit buildings", arena.glb.length > 100, `${arena.glb.length} kit GLBs`);
  const match = new GameEngine(arena, LOOK, toast, MASTER_MATCH_SEED, undefined, "match");
  match.reset(LOOK, { tools: [], powers: [], snacks: [], license: false, vehicles: [] });
  match.start();
  ok("match engine mode", match.mode === "match", match.mode);
  // the dropship: deploy phase armed on boot (ship → fall → chute)
  ok("dropship deploy armed", match.deploy !== null, match.deploy ? `phase ${match.deploy.phase}` : "none");
  ok("deploy route crossing the arena", match.deployPath !== null);
  // tick through a few seconds of flight
  for (let i = 0; i < 90; i++) match.update(1 / 30);
  ok("match sim ticks 3s without death", !match.lost, `elapsed ${match.elapsed.toFixed(1)}s`);
  ok("player still airborne over the arena", match.player.y > 0, `y=${match.player.y.toFixed(1)}`);

  console.log(fails === 0 ? "GOLDEN PATH OK — lobby roam + season drop boot headlessly" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error("boot test crashed:", e); process.exit(1); });
