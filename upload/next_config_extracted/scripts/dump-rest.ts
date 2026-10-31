// Compare rest-pose local TRS of matching joint names between two glTF files.
// Usage: bun scripts/dump-rest.ts <a> <b>
import * as fs from 'fs'
const read = (f: string) => {
  const b = fs.readFileSync(f)
  return b.readUInt32LE(0) === 0x46546c67 ? JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) : JSON.parse(b.toString())
}
const A = read(process.argv[2]), B = read(process.argv[3])
const byName = (j: any) => new Map<string, any>(j.nodes.map((n: any) => [n.name, n]))
const a = byName(A), b = byName(B)
const want = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'upperarm_r', 'hand_r', 'thigh_r', 'foot_r']
const f = (v?: number[]) => (v ? v.map((x) => x.toFixed(3)).join(',') : '-')
for (const n of want) {
  const x = a.get(n), y = b.get(n)
  console.log(`${n.padEnd(11)} A t=${f(x?.translation)} r=${f(x?.rotation)} | B t=${f(y?.translation)} r=${f(y?.rotation)}`)
}
