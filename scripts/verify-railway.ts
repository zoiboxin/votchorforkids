/**
 * 🚂 Railway kit integrity check — parses every GLB on disk with the REAL
 * GLTFLoader (bun-friendly: readFileSync + loader.parse). Proves no kit file
 * is corrupt — combined with the tracks rendering in-game, the station bake
 * (same pipeline) fires once all files land; a failed URL can only ever skip
 * one prop now, never hold the whole railway hostage.
 * Run: bun scripts/verify-railway.ts
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "/home/z/my-project/public/models/railway";
const files = readdirSync(dir).filter((f) => f.endsWith(".glb"));

const loader = new GLTFLoader();
const parser = loader.parse.bind(loader) as unknown as (
  data: ArrayBuffer, path: string, onLoad: (g: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) => void, onError: (e: unknown) => void,
) => void;

let done = 0, bad = 0, skinned = 0, idleClips = 0;
const results: string[] = [];
const t0 = Date.now();

for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  parser(ab, "", (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    let hasSkin = false, tris = 0;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry?.attributes?.position) {
        tris += Math.round(m.geometry.attributes.position.count / 3);
        if (m instanceof THREE.SkinnedMesh || m.geometry.attributes.skinIndex) hasSkin = true;
      }
    });
    if (hasSkin) skinned++;
    if (gltf.animations.some((c) => c.name.toLowerCase() === "idle")) idleClips++;
    results.push(`OK    ${f}  ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}m  ${tris.toLocaleString()} tris${hasSkin ? "  skinned" : ""}`);
    if (++done === files.length) report();
  }, (e) => {
    bad++;
    results.push(`BAD   ${f}  ${String(e).slice(0, 100)}`);
    if (++done === files.length) report();
  });
}

function report() {
  console.log(results.sort().join("\n"));
  console.log(`\n${files.length} files · ${files.length - bad} parse OK · ${bad} corrupt · ${skinned} skinned characters · ${idleClips} with Idle clip · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  /* the station-critical files must all parse */
  const critical = [
    "country-station-building-2d8f5e.glb", "platform-run-3738d0.glb",
    "platform-canopy-run-bc2275.glb", "station-footbridge-dfb6b8.glb",
    "straight-track-d4cf38.glb", "signal-box-f57a2d.glb", "tank-steam-locomotive-314bb1.glb",
  ];
  const fails: string[] = [];
  for (const c of critical) if (!results.find((r) => r.startsWith(`OK    ${c} `))) fails.push(c);
  if (fails.length) { console.log(`STATION-CRITICAL FAILURES: ${fails.join(", ")}`); process.exit(1); }
  console.log("ALL STATION-CRITICAL FILES PARSE OK");
  process.exit(bad === 0 ? 0 : 2);
}
