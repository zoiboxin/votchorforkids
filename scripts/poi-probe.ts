import { generateSeasonWorld } from "../src/lib/game/seasonWorld";

const w = generateSeasonWorld("s1");
const p = w.pois.find((q) => q.name === "Toy Workshop")!;
console.log("poi:", p.name, "x", p.x.toFixed(1), "z", p.z.toFixed(1), "r", p.r, "p.h", p.h.toFixed(3));
console.log("terrain(center) =", w.map.terrain(p.x, p.z).toFixed(3));
console.log("terrain(+16,0)  =", w.map.terrain(p.x + 16, p.z).toFixed(3));
// nearest other POIs
const others = w.pois.filter((q) => q !== p).map((q) => ({ n: q.name, d: Math.hypot(q.x - p.x, q.z - p.z), r: q.r, h: q.h })).sort((a, b) => a.d - b.d).slice(0, 3);
for (const o of others) console.log(`  neighbour ${o.n} d=${o.d.toFixed(0)} r=${o.r} h=${o.h.toFixed(2)} reach=${(o.r + 8).toFixed(0)}`);
// roads within 8u of the sample
const sx = p.x + 16, sz = p.z;
for (const seg of w.roads) {
  const vx = seg.x2 - seg.x1, vz = seg.z2 - seg.z1;
  const L2 = vx * vx + vz * vz || 1;
  let t = ((sx - seg.x1) * vx + (sz - seg.z1) * vz) / L2;
  t = Math.max(0, Math.min(1, t));
  const cx = seg.x1 + vx * t, cz = seg.z1 + vz * t;
  const d = Math.hypot(sx - cx, sz - cz);
  if (d < 9) console.log(`  road near sample d=${d.toFixed(1)} w=${seg.w} h1=${seg.h1?.toFixed(2)} h2=${seg.h2?.toFixed(2)} t=${t.toFixed(2)}`);
}
