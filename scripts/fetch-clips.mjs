/**
 * Downloads the Polyfork CC0 action clips (Quaternius' Universal Animation
 * Library, retargeted to the shared Mixamo skeleton) into public/models/clips/
 * so the game serves them from its own origin — no polyfork.dev dependency
 * at runtime. Source: https://polyfork.dev/cdn/anim-<slug>.json (see
 * polyfork.dev/llms.txt and /cdn/clips.mjs — the clip format and the
 * toClip() runtime binding are Polyfork's own documented API).
 *
 * Run: bun run scripts/fetch-clips.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

const CDN = "https://polyfork.dev/cdn";
const OUT = "public/models/clips";

/** The clips the game consumes (kick & drinking don't exist on the CDN — 404). */
const CLIPS = [
  "Jump start", "Jump in air",
  "Flip jump start", "Flip jump in air", "Flip jump land",
  "Punch jab", "Punch cross", "Hook punch",
  "Sword idle", "Sword attack", "Sword slash A", "Sword slash B", "Sword slash C",
  "Pick up", "Knockback", "Get up",
  "Zombie attack", "Zombie idle", "Zombie walk",
  "Dance", "Eating",
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const name of CLIPS) {
  const res = await fetch(`${CDN}/anim-${slug(name)}.json`);
  if (!res.ok) { console.log(`✗ ${name}: HTTP ${res.status}`); continue; }
  const raw = await res.json();
  if (!raw.times?.length || !raw.tracks || !raw.hips?.length) { console.log(`✗ ${name}: bad shape`); continue; }
  writeFileSync(`${OUT}/anim-${slug(name)}.json`, JSON.stringify(raw));
  ok++;
  console.log(`✓ ${name} (${(JSON.stringify(raw).length / 1024).toFixed(0)} KB, ${raw.times.length} keys, ${Object.keys(raw.tracks).length} bones)`);
}
console.log(`\n${ok}/${CLIPS.length} clips saved to ${OUT}/`);
