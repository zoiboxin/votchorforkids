// Summarize a .gltf/.glb: meshes (+bounds, tris, material), materials (+textures), skins, nodes.
// Usage: bun scripts/dump-gltf.ts <file.gltf|file.glb>
import * as fs from 'fs'

const file = process.argv[2]
const buf = fs.readFileSync(file)
let json: any
if (buf.readUInt32LE(0) === 0x46546c67) json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString())
else json = JSON.parse(buf.toString())
console.log(`== ${file}`)
console.log(`asset: ${JSON.stringify(json.asset)} extensionsUsed: ${json.extensionsUsed ?? []}`)
const nodes = json.nodes ?? []
nodes.forEach((n: any, i: number) => {
  if (n.mesh !== undefined) console.log(`  node[${i}] "${n.name}" mesh=${n.mesh} skin=${n.skin ?? '-'} t=${n.translation ?? '-'} r=${n.rotation ?? '-'} s=${n.scale ?? '-'}`)
})
for (const [mi, m] of (json.meshes ?? []).entries()) {
  for (const p of m.primitives) {
    const acc = json.accessors[p.attributes.POSITION]
    const mat = json.materials?.[p.material]
    console.log(`  mesh[${mi}] "${m.name}" mat="${mat?.name}" tris=${p.indices !== undefined ? json.accessors[p.indices].count / 3 : '?'} min=${acc.min?.map((v: number) => v.toFixed(3))} max=${acc.max?.map((v: number) => v.toFixed(3))} attrs=${Object.keys(p.attributes)} targets=${p.targets?.length ?? 0}`)
  }
}
for (const mat of json.materials ?? []) {
  const pbr = mat.pbrMetallicRoughness ?? {}
  const tex = (t: any) => (t ? json.images?.[json.textures[t.index].source]?.uri ?? 'embedded' : '-')
  console.log(`  material "${mat.name}" base=${tex(pbr.baseColorTexture)} color=${JSON.stringify(pbr.baseColorFactor ?? null)} mr=${tex(pbr.metallicRoughnessTexture)} rough=${pbr.roughnessFactor ?? '-'} normal=${tex(mat.normalTexture)} alpha=${mat.alphaMode ?? 'OPAQUE'} ext=${Object.keys(mat.extensions ?? {})}`)
}
for (const s of json.skins ?? []) console.log(`  skin joints(${s.joints.length}): ${s.joints.map((j: number) => nodes[j].name).join(',')}`)
const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? []
const walk = (i: number, d: number) => { const n = nodes[i]; if (d < 4) console.log(`  ${'  '.repeat(d)}${n.name} t=${(n.translation ?? []).map((v: number) => v.toFixed(3))} r=${(n.rotation ?? []).map((v: number) => v.toFixed(3))} s=${n.scale ?? ''}`); for (const c of n.children ?? []) walk(c, d + 1) }
for (const r of roots) walk(r, 0)
console.log(`  animations: ${(json.animations ?? []).length}`)
