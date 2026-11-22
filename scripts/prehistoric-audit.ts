/**
 * Prehistoric kit audit — parses each GLB in public/models/prehistoric and
 * reports: animation clip names, bind-pose bbox (h/w/d in metres) and total
 * triangle count. Run: bun scripts/prehistoric-audit.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "public", "models", "prehistoric");

interface GltfNode { mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; children?: number[] }
interface Gltf {
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: { POSITION?: number }; indices?: number } }[];
  accessors?: { min?: number[]; max?: number[]; count?: number; componentType?: number; type?: string }[];
  animations?: { name?: string; channels: unknown[] }[];
}

function trsToMat(n: GltfNode): number[] {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const q = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    t[0], t[1], t[2], 1,
  ];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
  return m;
}
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function xform(m: number[], v: number[]): number[] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function audit(file: string): string {
  const buf = readFileSync(join(DIR, file));
  if (buf.readUInt32LE(0) !== 0x46546c67) return `${file}: NOT A GLB`;
  const jsonLen = buf.readUInt32LE(12);
  const gltf: Gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const walk = (ni: number, pm: number[]) => {
    const n = gltf.nodes?.[ni];
    if (!n) return;
    const m = mul(pm, trsToMat(n));
    if (n.mesh != null) {
      for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes?.POSITION ?? -1];
        if (acc?.min && acc?.max) {
          const lo = xform(m, acc.min), hi = xform(m, acc.max);
          for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], lo[a], hi[a]); max[a] = Math.max(max[a], lo[a], hi[a]); }
        }
        const idx = gltf.accessors?.[prim.indices ?? -1];
        tris += idx ? idx.count! / 3 : (acc?.count ?? 0) / 3;
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const ni of gltf.scenes?.[0]?.nodes ?? []) walk(ni, [1,0,0,0, 0,1,0,0, 0,0,1,0,0,0,0,1]);
  const anims = (gltf.animations ?? []).map((a) => a.name || "?").join(",") || "NONE";
  const kb = Math.round(buf.length / 1024);
  if (min[0] === Infinity) return `${file} (${kb}KB, ${Math.round(tris)} tris) NO MESH — anims: ${anims}`;
  const h = max[1] - min[1], w = max[0] - min[0], d = max[2] - min[2];
  return `${file} (${kb}KB, ${Math.round(tris)} tris) h=${h.toFixed(2)} w=${w.toFixed(2)} d=${d.toFixed(2)} minZ=${min[2].toFixed(2)} — anims: ${anims}`;
}

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".glb")).sort()) console.log(audit(f));
