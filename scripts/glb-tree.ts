/* Dump node tree + part names of a GLB to locate the slewing ring plane. */
import { readFileSync } from "node:fs";

const path = process.argv[2];
const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));

const dump = (ni: number, depth: number, px = 0, py = 0, pz = 0) => {
  const n = json.nodes[ni];
  const t = n.translation ?? [0, 0, 0];
  const s = n.scale ?? [1, 1, 1];
  const wx = px * s[0] + t[0], wy = py * s[1] + t[1], wz = pz * s[2] + t[2];
  const meshInfo = n.mesh !== undefined ? ` MESH[${json.meshes[n.mesh].name ?? n.mesh}]` : "";
  console.log(`${"  ".repeat(depth)}${n.name ?? "(node)"} t=(${t.map((v: number) => v.toFixed(2))})${meshInfo}`);
  for (const c of n.children ?? []) dump(c, depth + 1, wx, wy, wz);
};
for (const ni of json.scenes[0].nodes ?? []) dump(ni, 0);
console.log("--- meshes ---");
for (const [i, m] of (json.meshes ?? []).entries()) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of m.primitives ?? []) {
    const acc = json.accessors[p.attributes.POSITION];
    minY = Math.min(minY, acc.min[1]); maxY = Math.max(maxY, acc.max[1]);
  }
  console.log(`${i}: ${m.name ?? "?"} localY [${minY.toFixed(2)}, ${maxY.toFixed(2)}] prims=${m.primitives?.length}`);
}
