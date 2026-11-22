/**
 * One-by-one animal height audit — parses each animal GLB in public/models
 * and reports the bind-pose bounding-box height (glTF POSITION accessor
 * min/max, transformed through the node tree). Run: bun scripts/animal-bbox.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "public", "models");
const ANIMALS = [
  "wolf-base.glb", "black-bear-adbdc7.glb", "red-fox-5c3bc0.glb", "owl-base.glb",
  "crow-base.glb", "forest-rabbit-ea2da0.glb", "spectral-stag-d19dc1.glb",
  "forest-deer-fe648d.glb", "alpine-ibex-2a288a.glb", "mountain-hare-d9c64c.glb",
  "pig-868bda.glb", "sheep-7b0187.glb", "goat-1dedee.glb", "duck-357dc6.glb",
  "arched-black-cat-407cf6.glb", "giant-yard-spider-70ddce.glb",
  "cow-base.glb", "chicken-base.glb", "dog-base.glb", "horse-base.glb", "frog-base.glb",
  "wood-ant-base.glb", "common-wasp-base.glb", "honeybee-base.glb", "praying-mantis-base.glb",
  "stag-beetle-base.glb", "seven-spot-ladybird-base.glb", "meadow-grasshopper-base.glb",
  "stone-centipede-base.glb", "tarantula-base.glb", "garden-orb-weaver-b32844.glb",
];

interface GltfNode { mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; children?: number[] }
interface Gltf {
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: { POSITION?: number } } }[];
  accessors?: { min?: number[]; max?: number[] }[];
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
  // apply scale (column-major: scale the 3x3 part)
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
  return m;
}
function mul(a: number[], b: number[]): number[] { // a × b (column-major)
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

function measure(file: string): { h: number; w: number; d: number } | null {
  const buf = readFileSync(join(DIR, file));
  if (buf.readUInt32LE(0) !== 0x46546c67) return null;
  const jsonLen = buf.readUInt32LE(12);
  const gltf: Gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const walk = (ni: number, pm: number[]) => {
    const n = gltf.nodes?.[ni];
    if (!n) return;
    const m = mul(pm, trsToMat(n));
    if (n.mesh != null) {
      for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes?.POSITION ?? -1];
        if (!acc?.min || !acc?.max) continue;
        const lo = xform(m, acc.min), hi = xform(m, acc.max);
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], lo[a], hi[a]); max[a] = Math.max(max[a], lo[a], hi[a]); }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const ni of gltf.scenes?.[0]?.nodes ?? []) walk(ni, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  if (min[0] === Infinity) return null;
  return { h: max[1] - min[1], w: max[0] - min[0], d: max[2] - min[2] };
}

const onDisk = new Set(readdirSync(DIR).filter((f) => f.endsWith(".glb")));
for (const f of ANIMALS) {
  if (!onDisk.has(f)) { console.log(`${f.padEnd(34)} MISSING ON DISK`); continue; }
  const m = measure(f);
  console.log(m ? `${f.padEnd(34)} h=${m.h.toFixed(3)}m  w=${m.w.toFixed(2)}  d=${m.d.toFixed(2)}` : `${f} PARSE FAIL`);
}
