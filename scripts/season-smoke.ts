/**
 * season-smoke.ts — generate every season's 4x4km world headlessly and
 * report entity counts, so a bad palette/foliage/asset def can never ship.
 * Run: bun scripts/season-smoke.ts
 */
import { SEASONS } from "../src/lib/game/seasons";
import { generateSeasonWorld } from "../src/lib/game/seasonWorld";
import { SEASON_ASSETS } from "../src/lib/game/seasonAssets";

let failures = 0;
for (const def of SEASONS) {
  try {
    const w = generateSeasonWorld(def.id);
    const assets = SEASON_ASSETS[def.id] ?? [];
    const kitPlaced = w.glb.length;
    const buildings = w.buildings.length;
    const trees = w.trees.length;
    const pois = w.pois.length;
    const roads = w.roads.length;
    const ok =
      pois >= 16 && roads >= 40 && buildings > 60 && trees > 600 &&
      (def.id === "s20" || kitPlaced > 100);
    if (!ok) failures++;
    console.log(
      `${ok ? "OK " : "BAD"} ${def.id} ${def.title.padEnd(24)} pois:${pois} roads:${roads} bld:${buildings} trees:${trees} kitGLB:${kitPlaced} assets:${assets.length}`,
    );
  } catch (err) {
    failures++;
    console.log(`ERR ${def.id} ${def.title}: ${err}`);
  }
}
console.log(failures === 0 ? "ALL 27 SEASON WORLDS OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
