// Sum exact triangle counts per GLB (indices accessor /3, else POSITION /3)
import { readFileSync, readdirSync } from "node:fs";

const dir = "public/models/heroes";
const names = process.argv.slice(2);
const files = names.length
  ? names.map((n) => `${dir}/${n}.glb`)
  : readdirSync(dir).filter((f) => f.endsWith(".glb")).map((f) => `${dir}/${f}`);

const out = [];
for (const f of files) {
  let buf;
  try { buf = readFileSync(f); } catch { console.log(`${f}: MISSING`); continue; }
  if (buf.readUInt32LE(0) !== 0x46546c67) { console.log(`${f}: not GLB`); continue; }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const accs = json.accessors ?? [];
  let tris = 0;
  for (const m of json.meshes ?? []) {
    for (const prim of m.primitives ?? []) {
      if (prim.indices !== undefined && accs[prim.indices]) tris += accs[prim.indices].count / 3;
      else if (accs[prim.attributes?.POSITION]) tris += accs[prim.attributes.POSITION].count / 3;
    }
  }
  const slug = f.split("/").pop().replace(/\.glb$/, "");
  console.log(`${slug}: ${tris}`);
  out.push([slug, tris]);
}
console.log("\nTS tuple list:");
for (const [slug, tris] of out) console.log(`  ["${slug}", ${tris}],`);
