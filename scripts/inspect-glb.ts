/* Inspect construction GLB bounding boxes from accessor min/max (POSITION). */
import { readFileSync } from "node:fs";

const FILES = {
  craneMast: "public/models/construction/tower-crane-mast-1784a3.glb",
  craneTop: "public/models/construction/tower-crane-top-d8d9c9.glb",
};

function glbBounds(path: string) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  const binStart = 20 + jsonLen + 8;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const acc = json.accessors[prim.attributes.POSITION];
      if (!acc?.min || !acc?.max) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], acc.min[i]);
        max[i] = Math.max(max[i], acc.max[i]);
      }
    }
  }
  // apply scene-node transforms (top-level children usually identity, but check)
  const nodeXf = (ni: number): number[] => {
    const n = json.nodes[ni];
    if (n.matrix) return n.matrix;
    const t = n.translation ?? [0, 0, 0];
    const s = n.scale ?? [1, 1, 1];
    return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1];
  };
  // walk scene graph: accumulate translation+scale per node path (rotation ignored for bounds estimate)
  const applyNodes = (ni: number, off: number[]) => {
    const n = json.nodes[ni];
    const t = n.translation ?? [0, 0, 0];
    const s = n.scale ?? [1, 1, 1];
    const o = [off[0] * s[0] + t[0], off[1] * s[1] + t[1], off[2] * s[2] + t[2]];
    if (n.mesh !== undefined) {
      for (const prim of (json.meshes[n.mesh].primitives ?? [])) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc?.min) continue;
        for (let vi = 0; vi < acc.count; vi += Math.max(1, Math.floor(acc.count / 500))) {
          // sample positions from the BIN chunk for transformed nodes
          const v = sampleVertex(json, buf, binStart, acc, vi);
          const w = [o[0] + v[0] * s[0], o[1] + v[1] * s[1], o[2] + v[2] * s[2]];
          for (let i = 0; i < 3; i++) {
            if (w[i] < min[i]) min[i] = w[i];
            if (w[i] > max[i]) max[i] = w[i];
          }
        }
      }
    }
    for (const c of n.children ?? []) applyNodes(c, o);
  };
  function sampleVertex(j: any, b: Buffer, binStart: number, acc: any, vi: number): number[] {
    const bv = j.bufferViews[acc.bufferView];
    const off = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + vi * 12;
    return [b.readFloatLE(off), b.readFloatLE(off + 4), b.readFloatLE(off + 8)];
  }
  for (const scene of json.scenes ?? []) {
    for (const ni of scene.nodes ?? []) applyNodes(ni, [0, 0, 0]);
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

for (const [k, f] of Object.entries(FILES)) {
  const b = glbBounds(f);
  console.log(k, "size", b.size.map((v) => v.toFixed(2)).join(" x "),
    "min.y", b.min[1].toFixed(2), "max.y", b.max[1].toFixed(2),
    "min.x", b.min[0].toFixed(2), "max.x", b.max[0].toFixed(2),
    "min.z", b.min[2].toFixed(2), "max.z", b.max[2].toFixed(2));
}
