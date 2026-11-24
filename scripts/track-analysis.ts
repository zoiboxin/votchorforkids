/* Analyze straight-track GLB: per-mesh bounds + rail direction detection. */
import { readFileSync } from "node:fs";

const buf = readFileSync("public/models/railway/straight-track-d4cf38.glb");
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;

const verts = (accIdx: number) => {
  const a = j.accessors[accIdx];
  const bv = j.bufferViews[a.bufferView];
  const base = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < a.count; i++) {
    const o = base + i * 12;
    out.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
  }
  return out;
};

const walk = (ni: number, path: string) => {
  const n = j.nodes[ni];
  const label = path + "/" + (n.name ?? ni);
  if (n.mesh !== undefined) {
    for (const p of j.meshes[n.mesh].primitives ?? []) {
      const vs = verts(p.attributes.POSITION).map(([x, y, z]) => {
        const t = n.translation ?? [0, 0, 0];
        const s = n.scale ?? [1, 1, 1];
        return [x * s[0] + t[0], y * s[1] + t[1], z * s[2] + t[2]];
      });
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const v of vs) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
      console.log(label.padEnd(30), "n=" + vs.length,
        "x[" + mn[0].toFixed(2) + "," + mx[0].toFixed(2) + "]",
        "y[" + mn[1].toFixed(2) + "," + mx[1].toFixed(2) + "]",
        "z[" + mn[2].toFixed(2) + "," + mx[2].toFixed(2) + "]");
      // rail detection: vertices at railhead height (top of the piece)
      if (mx[1] - mn[1] < 0.35) {
        const top = vs.filter((v) => v[1] > mx[1] - 0.12);
        if (top.length > 4) {
          // PCA-lite: how does x vary with z along the top band?
          const xs = top.map((v) => v[0]), zs = top.map((v) => v[2]);
          const corr = (() => {
            const n1 = top.length;
            const mx1 = xs.reduce((a, b) => a + b, 0) / n1, mz1 = zs.reduce((a, b) => a + b, 0) / n1;
            let sxy = 0, sxx = 0, szz = 0;
            for (let i = 0; i < n1; i++) { sxy += (xs[i] - mx1) * (zs[i] - mz1); sxx += (xs[i] - mx1) ** 2; szz += (zs[i] - mz1) ** 2; }
            return sxx + szz > 0 ? sxy / Math.sqrt(sxx * szz) : 0;
          })();
          console.log("   top-band x↔z correlation:", corr.toFixed(3), "(near ±1 = diagonal rail, near 0 = axis-aligned rail)");
          console.log("   top-band x range", Math.min(...xs).toFixed(2), "..", Math.max(...xs).toFixed(2), " z range", Math.min(...zs).toFixed(2), "..", Math.max(...zs).toFixed(2));
        }
      }
    }
  }
  for (const c of n.children ?? []) walk(c, label);
};
for (const ni of j.scenes[0].nodes ?? []) walk(ni, "");
