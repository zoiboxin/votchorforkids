import { generateSeasonWorld } from "../src/lib/game/seasonWorld";

const w = generateSeasonWorld("s1");
for (const p of w.pois) {
  const h0 = w.map.terrain(p.x, p.z);
  const samples = [[p.r * 0.3, 0], [0, p.r * 0.3], [-p.r * 0.25, -p.r * 0.25]];
  let worst = 0, worstAt = "";
  for (const [dx, dz] of samples) {
    const d = Math.abs(w.map.terrain(p.x + dx, p.z + dz) - h0);
    if (d > worst) { worst = d; worstAt = `${dx.toFixed(0)},${dz.toFixed(0)}`; }
  }
  console.log(`${p.name.padEnd(22)} type=${p.type.padEnd(8)} r=${p.r.toFixed(0)} h=${h0.toFixed(2)} worst=${worst.toFixed(2)} @${worstAt}`);
}
