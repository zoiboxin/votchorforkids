// Dump bone/joint names, animation names + durations, and bounding height of a GLB.
// Usage: bun scripts/dump-bones.ts <file.glb>
import * as fs from 'fs'

const file = process.argv[2]
if (!file) { console.error('usage: bun scripts/dump-bones.ts <file.glb>'); process.exit(1) }
const buf = fs.readFileSync(file)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
const nodes = json.nodes ?? []
console.log(`== ${file} (${(buf.length / 1048576).toFixed(2)}MB)`)
for (const s of json.skins ?? []) {
  console.log(`skin joints (${s.joints.length}): ` + s.joints.map((j: number) => nodes[j].name).join(', '))
}
for (const a of json.animations ?? []) {
  let maxT = 0
  for (const smp of a.samplers) { const acc = json.accessors[smp.input]; if (acc.max) maxT = Math.max(maxT, acc.max[0]) }
  console.log(`  anim ${a.name} ${maxT.toFixed(2)}s`)
}
for (const m of json.meshes ?? []) {
  for (const p of m.primitives) {
    const acc = json.accessors[p.attributes.POSITION]
    console.log(`  mesh ${m.name} min=${acc.min?.map((v: number) => v.toFixed(2))} max=${acc.max?.map((v: number) => v.toFixed(2))} tris~${p.indices !== undefined ? json.accessors[p.indices].count / 3 : '?'}`)
  }
}
