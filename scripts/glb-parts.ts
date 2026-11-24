/* Per-mesh x/y/z bounds for the crane top GLB — verify the seat/ring axis. */
import { readFileSync } from "node:fs";

const path = process.argv[2];
const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;

const sample = (acc: any, n = 400) => {
  const bv = json.bufferViews[acc.bufferView];
  const base = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[][] = [];
  const step = Math.max(1, Math.floor(acc.count / n));
  for (let i = 0; i < acc.count; i += step) {
    const o = base + i * 12;
    out.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
  }
  return out;
};

const walk = (ni: number, ox: number, oy: number, oz: number) => {
  const n = json.nodes[ni];
  const t = n.translation ?? [0, 0, 0];
  const s = n.scale ?? [1, 1, 1];
  const x = ox * s[0] + t[0], y = oy * s[1] + t[1], z = oz * s[2] + t[2];
  if (n.mesh !== undefined) {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of json.meshes[n.mesh].primitives ?? []) {
      const acc = json.accessors[p.attributes.POSITION];
      for (const v of sample(acc)) {
        const w = [x + v[0] * s[0], y + v[1] * s[1], z + v[2] * s[2]];
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], w[i]); mx[i] = Math.max(mx[i], w[i]); }
      }
    }
    console.log(
      (n.name ?? "mesh").padEnd(14),
      "x[" + mn[0].toFixed(2) + "," + mx[0].toFixed(2) + "]",
      "y[" + mn[1].toFixed(2) + "," + mx[1].toFixed(2) + "]",
      "z[" + mn[2].toFixed(2) + "," + mx[2].toFixed(2) + "]",
    );
  }
  for (const c of n.children ?? []) walk(c, x, y, z);
};
for (const ni of json.scenes[0].nodes ?? []) walk(ni, 0, 0, 0);
