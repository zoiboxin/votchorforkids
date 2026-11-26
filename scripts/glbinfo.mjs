// Parse GLB JSON chunks: bounding box + wheel-ish node names
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
for (const f of files) {
  const buf = readFileSync(f);
  if (buf.readUInt32LE(0) !== 0x46546c67) { console.log(`${f}: not GLB`); continue; }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const accs = json.accessors ?? [];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const names = [];
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    if (/wheel|tyre|tire|track|tread/i.test(node.name)) names.push(node.name);
    const m = json.meshes?.[node.mesh];
    for (const prim of m?.primitives ?? []) {
      const pa = accs[prim.attributes?.POSITION];
      if (!pa?.min || !pa?.max) continue;
      for (let i = 0; i < 3; i++) {
        if (pa.min[i] < min[i]) min[i] = pa.min[i];
        if (pa.max[i] > max[i]) max[i] = pa.max[i];
      }
    }
  }
  const size = max.map((v, i) => (v - min[i]).toFixed(2));
  console.log(`\n### ${f.split("/").pop()}`);
  console.log(`  raw mesh-space bbox: size ${size.join(" x ")} (x,y,z)  min ${min.map(v => v.toFixed(2))} max ${max.map(v => v.toFixed(2))}`);
  console.log(`  wheel/track nodes: ${names.length ? names.join(", ") : "(none named)"}`);
  console.log(`  nodes: ${(json.nodes ?? []).length}, meshes: ${(json.meshes ?? []).length}`);
}
