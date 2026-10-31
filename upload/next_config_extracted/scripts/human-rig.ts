/**
 * Shared humanoid RIG ENGINE for VoteChor skinned characters (bun, no DOM).
 *
 * Extracted from scripts/export-human-character.ts so multiple body designs
 * (the original "human/Junior Citizen" look AND the new "Citizen Pro" GTA-style
 * body) can share ONE skeleton + ONE animation clip set + the skinning/geometry
 * helpers. The bone names and clip names are the engine contract — anim.ts,
 * facial-rig.ts and avatar-look.ts all key off them, so every body that binds to
 * this skeleton animates identically with zero engine changes.
 *
 * Skeleton (19 skin joints): Hips → Torso → Chest → Neck → Head,
 *   Clavicle/Arm/Elbow/Hand ×2 (off Chest), Leg/Knee/Foot ×2 (off Hips).
 * 14 clips: idle walk run jump doubleJump fall land slide hit detained recover
 *   celebrate throw heal — real keyframes (biomechanical gait, foot-roll).
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync } from 'node:fs'

// ---- bun has no FileReader; GLTFExporter needs it to read its output Blob ----
class FileReaderShim {
  result: ArrayBuffer | null = null
  onload: ((ev?: unknown) => void) | null = null
  onloadend: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then(
      (ab) => { this.result = ab; this.onload?.({ target: this }); this.onloadend?.({ target: this }) },
      (e) => { this.onerror?.(e); this.onloadend?.(e) },
    )
  }
}
;(globalThis as unknown as { FileReader: unknown }).FileReader = FileReaderShim

// ============================================================================
// PROPORTIONS
// ============================================================================
export interface Prop {
  hipY: number
  thighLen: number
  calfLen: number
  footH: number
  torsoTop: number
  spineY: number
  chestY: number
  shoulderY: number
  shoulderX: number
  hipX: number
  upperLen: number
  foreLen: number
  handLen: number
  headR: number
  headCY: number
  neckLen: number
  rings: { y: number; rx: number; rz: number; bust?: number }[]
  pelvis: { rx: number; rz: number; h: number }
  armR1: number
  armR2: number
  armR3: number
  legR1: number
  legR2: number
  legR3: number
}

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================
export const mkMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat)
  m.name = name
  return m
}

function ringPositions(y: number, rx: number, rz: number, segs: number, cz = 0, bust = 0): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2
    const s = Math.sin(a)
    const rzEff = rz * (1 + bust * Math.max(0, s) ** 2)
    pts.push(new THREE.Vector3(Math.cos(a) * rx, y, cz + s * rzEff))
  }
  return pts
}

export function loft(rings: { y: number; rx: number; rz: number; cz?: number; bust?: number }[], segs: number, capTop = true, capBottom = true): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const rows: THREE.Vector3[][] = []
  for (const r of rings) {
    const row = ringPositions(r.y, r.rx, r.rz, segs, r.cz ?? 0, r.bust ?? 0)
    rows.push(row)
    for (const p of row) pos.push(p.x, p.y, p.z)
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const o0 = i * segs, o1 = (i + 1) * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      idx.push(o0 + j, o1 + j, o0 + j1, o0 + j1, o1 + j, o1 + j1)
    }
  }
  const capRow = (rowIdx: number, dir: 1 | -1) => {
    const row = rows[rowIdx]
    let cy = 0, cz = 0
    for (const p of row) { cy += p.y; cz += p.z }
    cy /= row.length; cz /= row.length
    const c = new THREE.Vector3(0, cy + dir * 0.004, cz)
    const ci = pos.length / 3
    pos.push(c.x, c.y, c.z)
    const o = rowIdx * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      if (dir > 0) idx.push(o + j, ci, o + j1)
      else idx.push(o + j1, ci, o + j)
    }
  }
  if (capTop) capRow(rows.length - 1, 1)
  if (capBottom) capRow(0, -1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

export function mergeGeoms(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 1) return list[0]
  let vCount = 0, iCount = 0
  for (const g of list) { vCount += g.attributes.position.count; iCount += (g.index as THREE.BufferAttribute).count }
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const idx = new Uint32Array(iCount)
  let vo = 0, io = 0
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const gi = g.index as THREE.BufferAttribute
    pos.set(p.array as Float32Array, vo * 3)
    nor.set(n.array as Float32Array, vo * 3)
    for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo
    vo += p.count
    io += gi.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setIndex(new THREE.Uint32BufferAttribute(idx, 1))
  return out
}

/** Loft along an arbitrary near-vertical limb axis a→b with linear radius taper. */
export function armLoft(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, segs: number, rows: number): THREE.BufferGeometry {
  const rings: { y: number; rx: number; rz: number; cz?: number }[] = []
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    const pt = a.clone().lerp(b, t)
    const rr = THREE.MathUtils.lerp(r0, r1, t)
    rings.push({ y: pt.y, rx: rr, rz: rr, cz: pt.z })
  }
  const geo = loft(rings, segs)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const tt = THREE.MathUtils.clamp((y - a.y) / Math.max(1e-6, b.y - a.y), 0, 1)
    pos.setX(i, pos.getX(i) + THREE.MathUtils.lerp(a.x, b.x, tt))
    pos.setZ(i, pos.getZ(i) + THREE.MathUtils.lerp(a.z, b.z, tt))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

export const capsule = (r: number, len: number, mat: THREE.Material, name: string, seg = 8): THREE.Mesh =>
  mkMesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 3, seg), mat, name)

function distPointSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a)
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1)
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)))
}

// ============================================================================
// SKELETON
// ============================================================================
export interface SkeletonDef {
  bones: THREE.Bone[]
  index: Record<string, number>
  world: Record<string, THREE.Vector3>
}

export function buildSkeleton(p: Prop): SkeletonDef {
  const bones: THREE.Bone[] = []
  const world: Record<string, THREE.Vector3> = {}
  const add = (name: string, parent: THREE.Bone | null, w: THREE.Vector3): THREE.Bone => {
    const b = new THREE.Bone()
    b.name = name
    if (parent) {
      b.position.copy(w).sub(parent.getWorldPosition(new THREE.Vector3()))
      parent.add(b)
    } else {
      b.position.copy(w)
    }
    bones.push(b)
    world[name] = w.clone()
    return b
  }
  const hips = add('Hips', null, new THREE.Vector3(0, p.hipY, 0))
  const torso = add('Torso', hips, new THREE.Vector3(0, p.hipY + p.spineY, 0))
  const chest = add('Chest', torso, new THREE.Vector3(0, p.hipY + p.chestY, 0))
  const neck = add('Neck', chest, new THREE.Vector3(0, p.hipY + p.torsoTop - p.neckLen, 0))
  add('Head', neck, new THREE.Vector3(0, p.hipY + p.torsoTop, 0))
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const shW = new THREE.Vector3(s * p.shoulderX, p.shoulderY, 0)
    const elW = new THREE.Vector3(s * (p.shoulderX + 0.03), p.shoulderY - p.upperLen, 0)
    const wrW = new THREE.Vector3(s * (p.shoulderX + 0.06), p.shoulderY - p.upperLen - p.foreLen, 0)
    const clav = add(`Clavicle${L}`, chest, new THREE.Vector3(s * (p.shoulderX * 0.33), p.shoulderY - 0.02, 0))
    add(`Arm${L}`, clav, shW)
    add(`Elbow${L}`, bones[bones.length - 1], elW)
    add(`Hand${L}`, bones[bones.length - 1], wrW)
  }
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    add(`Leg${L}`, hips, new THREE.Vector3(s * p.hipX, p.hipY - 0.02, 0))
    add(`Knee${L}`, bones[bones.length - 1], new THREE.Vector3(s * (p.hipX + 0.004), p.hipY - 0.02 - p.thighLen, 0))
    add(`Foot${L}`, bones[bones.length - 1], new THREE.Vector3(s * (p.hipX + 0.004), p.footH, 0.015))
  }
  return { bones, index: Object.fromEntries(bones.map((b, i) => [b.name, i])), world }
}

// ============================================================================
// SKIN WEIGHTS — smooth distance-to-segment binding
// ============================================================================
export interface Seg { name: string; a: THREE.Vector3; b: THREE.Vector3; r: number }

export function buildSegments(p: Prop, w: Record<string, THREE.Vector3>): Seg[] {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const segs: Seg[] = [
    { name: 'Hips', a: V(0, p.hipY - 0.10, 0), b: V(0, p.hipY + p.spineY, 0), r: p.pelvis.rx * 0.92 },
    { name: 'Torso', a: V(0, p.hipY + p.spineY, 0), b: V(0, p.hipY + p.chestY, 0), r: 0.118 },
    { name: 'Chest', a: V(0, p.hipY + p.chestY, 0), b: V(0, p.hipY + p.torsoTop - p.neckLen, 0), r: 0.128 },
    { name: 'Neck', a: V(0, p.hipY + p.torsoTop - p.neckLen, 0), b: V(0, p.hipY + p.torsoTop + 0.02, 0), r: 0.038 },
  ]
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    segs.push({ name: `Clavicle${L}`, a: V(s * p.shoulderX * 0.33, p.shoulderY - 0.02, 0), b: V(s * p.shoulderX, p.shoulderY, 0), r: 0.05 })
    segs.push({ name: `Arm${L}`, a: w[`Arm${L}`], b: w[`Elbow${L}`], r: p.armR1 })
    segs.push({ name: `Elbow${L}`, a: w[`Elbow${L}`], b: w[`Hand${L}`], r: p.armR2 })
    segs.push({ name: `Hand${L}`, a: w[`Hand${L}`], b: w[`Hand${L}`].clone().add(V(s * 0.03, -p.handLen, 0)), r: p.armR3 })
    segs.push({ name: `Leg${L}`, a: w[`Leg${L}`], b: w[`Knee${L}`], r: p.legR1 })
    segs.push({ name: `Knee${L}`, a: w[`Knee${L}`], b: w[`Foot${L}`], r: p.legR2 })
    segs.push({ name: `Foot${L}`, a: w[`Foot${L}`], b: w[`Foot${L}`].clone().add(V(0, 0, 0.12)), r: p.legR3 })
  }
  return segs
}

export function skinnify(geo: THREE.BufferGeometry, segs: Seg[], index: Record<string, number>, maxInf = 4,
  allow?: string[], overrides?: { yMin: number; yMax: number; weights: [string, number][] }[]): void {
  const usable = allow ? segs.filter((s) => allow.includes(s.name)) : segs
  const pos = geo.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const skinIdx = new Uint16Array(n * 4)
  const skinW = new Float32Array(n * 4)
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i)
    const ov = overrides?.find((o) => v.y >= o.yMin && v.y <= o.yMax)
    if (ov) {
      let k = 0
      for (const [nm, wt] of ov.weights) { skinIdx[i * 4 + k] = index[nm]; skinW[i * 4 + k] = wt; k++ }
      for (; k < 4; k++) { skinIdx[i * 4 + k] = index[ov.weights[0][0]]; skinW[i * 4 + k] = 0 }
      continue
    }
    const ds = usable.map((s) => ({ si: index[s.name], d: Math.max(0.004, distPointSeg(v, s.a, s.b) - s.r) }))
    ds.sort((x, y) => x.d - y.d)
    let total = 0
    const inf: { si: number; w: number }[] = []
    for (let k = 0; k < Math.min(maxInf, ds.length); k++) {
      const wgt = 1 / ds[k].d ** 3
      inf.push({ si: ds[k].si, w: wgt })
      total += wgt
    }
    for (let k = 0; k < 4; k++) {
      if (k < inf.length) { skinIdx[i * 4 + k] = inf[k].si; skinW[i * 4 + k] = inf[k].w / total }
      else { skinIdx[i * 4 + k] = inf[0].si; skinW[i * 4 + k] = 0 }
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4))
}

/** Kill crotch webbing: force a leg loft's top rows to follow Hips. */
export function legTopOverride(p: Prop, leg: 'LegL' | 'LegR'): { yMin: number; yMax: number; weights: [string, number][] }[] {
  return [
    { yMin: p.hipY - 0.02, yMax: 99, weights: [['Hips', 0.8], [leg, 0.2]] },
    { yMin: p.hipY - 0.1, yMax: p.hipY - 0.02, weights: [['Hips', 0.45], [leg, 0.55]] },
  ]
}

// ============================================================================
// ANIMATION — biomechanical gait with foot roll + full 14-state set
// (verbatim from the proven human exporter so motion is identical)
// ============================================================================
type Q = [number, number, number, number]
const quat = (x: number, y: number, z: number): Q => {
  const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
  return [e.x, e.y, e.z, e.w]
}
const qTrack = (node: string, times: number[], qs: Q[]) => new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, qs.flat())
const pTrack = (node: string, times: number[], vs: [number, number, number][]) => new THREE.VectorKeyframeTrack(`${node}.position`, times, vs.flat())
const qAnim = (node: string, poses: [number, number, number, number][], loop: boolean) => {
  const times = poses.map((pp) => pp[0])
  const qs = poses.map((pp) => quat(pp[1], pp[2], pp[3]))
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); qs.push(qs[0]) }
  return qTrack(node, times, qs)
}
const bobAnim = (node: string, baseY: number, poses: [number, number][], loop: boolean) => {
  const times = poses.map((pp) => pp[0])
  const vs = poses.map((pp) => [0, baseY + pp[1], 0] as [number, number, number])
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); vs.push(vs[0]) }
  return pTrack(node, times, vs)
}

interface GaitSpec {
  duration: number; stride: number; kneeSwing: number; kneeBase: number
  armSwing: number; elbowBase: number; elbowSwing: number
  bob: number; lean: number; yaw: number; footRoll: number
}
function kneeAngle(ph: number, s: GaitSpec): number {
  const swing = Math.max(0, Math.sin(Math.PI * ((ph - 0.5) / 0.5))) ** 1.25
  const load = 0.3 * Math.exp(-(((ph - 0.12) / 0.09) ** 2))
  return s.kneeBase + s.kneeSwing * swing + s.kneeSwing * 0.3 * load
}
function footPitch(ph: number, s: GaitSpec): number {
  if (ph < 0.06) return -0.16 * (1 - ph / 0.06)
  if (ph < 0.34) return 0
  if (ph < 0.52) { const t = (ph - 0.34) / 0.18; return s.footRoll * Math.sin(t * Math.PI * 0.6) }
  if (ph < 0.72) return -0.10
  return -0.02
}
function gaitClip(name: string, s: GaitSpec, p: Prop): THREE.AnimationClip {
  const N = 18
  const legL: Q[] = [], legR: Q[] = [], kneeL: Q[] = [], kneeR: Q[] = [], footL: Q[] = [], footR: Q[] = []
  const armL: Q[] = [], armR: Q[] = [], elbL: Q[] = [], elbR: Q[] = [], torso: Q[] = [], head: Q[] = [], neck: Q[] = [], hipsRot: Q[] = []
  const bob: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * s.duration
    const ph = i / N
    const wv = 2 * Math.PI * ph
    const c = Math.cos(wv), sn = Math.sin(wv)
    legL.push([t, -s.stride * c, 0, 0]); legR.push([t, s.stride * c, 0, 0])
    kneeL.push([t, kneeAngle(ph, s), 0, 0]); kneeR.push([t, kneeAngle((ph + 0.5) % 1, s), 0, 0])
    footL.push([t, footPitch(ph, s), 0, 0]); footR.push([t, footPitch((ph + 0.5) % 1, s), 0, 0])
    armL.push([t, s.armSwing * c, 0, 0.06 + 0.03 * sn]); armR.push([t, -s.armSwing * c, 0, -0.06 + 0.03 * sn])
    elbL.push([t, -(s.elbowBase + s.elbowSwing * Math.max(0, -c) ** 1.4), 0, 0])
    elbR.push([t, -(s.elbowBase + s.elbowSwing * Math.max(0, c) ** 1.4), 0, 0])
    torso.push([t, s.lean + 0.016 * Math.sin(2 * wv), s.yaw * sn, 0])
    head.push([t, -0.42 * s.lean + 0.012 * Math.sin(2 * wv + 0.5), -0.6 * s.yaw * sn, 0])
    neck.push([t, -0.18 * s.lean, -0.25 * s.yaw * sn, 0])
    hipsRot.push([t, 0, -0.5 * s.yaw * sn, 0.028 * c])
    bob.push([t, s.bob * (0.5 - 0.5 * Math.cos(2 * wv)) - p.legR1 * 0.06])
  }
  return new THREE.AnimationClip(name, s.duration, [
    qAnim('Torso', torso, true), qAnim('Head', head, true), qAnim('Neck', neck, true), qAnim('Hips', hipsRot, true),
    qAnim('LegL', legL, true), qAnim('LegR', legR, true), qAnim('KneeL', kneeL, true), qAnim('KneeR', kneeR, true),
    qAnim('FootL', footL, true), qAnim('FootR', footR, true), qAnim('ArmL', armL, true), qAnim('ArmR', armR, true),
    qAnim('ElbowL', elbL, true), qAnim('ElbowR', elbR, true), bobAnim('Hips', p.hipY, bob, true),
  ])
}

export function buildClips(p: Prop, isChild: boolean, isFemale: boolean): THREE.AnimationClip[] {
  const H = 'Hips', T = 'Torso', HD = 'Head', NK = 'Neck'
  const AL = 'ArmL', AR = 'ArmR', EL = 'ElbowL', ER = 'ElbowR'
  const LL = 'LegL', LR = 'LegR', KL = 'KneeL', KR = 'KneeR', FL = 'FootL', FR = 'FootR'
  const hipY = p.hipY
  const clips: THREE.AnimationClip[] = []
  const walkDur = isChild ? 0.75 : isFemale ? 0.88 : 0.95
  clips.push(gaitClip('walk', { duration: walkDur, stride: 0.52, kneeSwing: 0.72, kneeBase: 0.10, armSwing: 0.38, elbowBase: 0.22, elbowSwing: 0.34, bob: 0.024, lean: 0.05, yaw: 0.09, footRoll: 0.30 }, p))
  const runDur = isChild ? 0.48 : 0.58
  clips.push(gaitClip('run', { duration: runDur, stride: 0.92, kneeSwing: 1.42, kneeBase: 0.20, armSwing: 0.65, elbowBase: 0.95, elbowSwing: 0.25, bob: 0.052, lean: 0.24, yaw: 0.15, footRoll: 0.42 }, p))
  clips.push(new THREE.AnimationClip('idle', 4.4, [
    qAnim(T, [[0, 0.025, 0, 0], [1.4, 0.045, 0.02, 0.008], [2.6, 0.03, 0, -0.008], [4.4, 0.025, 0, 0]], false),
    qAnim(HD, [[0, 0.01, 0, 0], [1.2, 0.04, 0.07, 0], [2.4, -0.02, -0.06, 0], [3.4, 0.02, 0.04, 0], [4.4, 0.01, 0, 0]], false),
    qAnim(NK, [[0, 0, 0, 0], [1.2, 0.015, 0.03, 0], [2.4, -0.01, -0.025, 0], [4.4, 0, 0, 0]], false),
    qAnim(AL, [[0, 0.06, 0, 0.055], [2.2, 0.11, 0, 0.075], [4.4, 0.06, 0, 0.055]], false),
    qAnim(AR, [[0, 0.06, 0, -0.055], [2.2, 0.11, 0, -0.075], [4.4, 0.06, 0, -0.055]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [2.2, -0.19, 0, 0], [4.4, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [2.2, -0.19, 0, 0], [4.4, -0.14, 0, 0]], false),
    qAnim(H, [[0, 0, 0, 0.012], [2.2, 0, 0.008, -0.01], [4.4, 0, 0, 0.012]], false),
    bobAnim(H, hipY, [[0, 0], [1.1, 0.008], [2.2, 0], [3.3, 0.008], [4.4, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('jump', 0.85, [
    qAnim(T, [[0, 0, 0, 0], [0.16, 0.30, 0, 0], [0.38, 0.05, 0, 0], [0.85, 0.10, 0, 0]], false),
    qAnim(KL, [[0, 0.10, 0, 0], [0.16, 1.45, 0, 0], [0.38, 0.45, 0, 0], [0.85, 0.85, 0, 0]], false),
    qAnim(KR, [[0, 0.10, 0, 0], [0.16, 1.15, 0, 0], [0.38, 0.7, 0, 0], [0.85, 0.8, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.16, -0.8, 0, 0], [0.38, -0.45, 0, 0], [0.85, -0.5, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.16, -0.5, 0, 0], [0.38, 0.32, 0, 0], [0.85, 0.28, 0, 0]], false),
    qAnim(FL, [[0, 0, 0, 0], [0.16, 0.25, 0, 0], [0.38, -0.3, 0, 0], [0.85, -0.2, 0, 0]], false),
    qAnim(FR, [[0, 0, 0, 0], [0.16, 0.2, 0, 0], [0.38, -0.25, 0, 0], [0.85, -0.18, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.16, 0.5, 0, 0], [0.5, -2.6, 0, 0], [0.85, -2.6, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.16, 0.5, 0, 0], [0.5, -2.6, 0, 0], [0.85, -2.6, 0, 0]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.16, -0.45, 0, 0], [0.5, -0.15, 0, 0], [0.85, -0.15, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.16, -0.45, 0, 0], [0.5, -0.15, 0, 0], [0.85, -0.15, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.16, -0.16], [0.38, 0.05], [0.85, 0.05]], false),
  ]))
  clips.push(new THREE.AnimationClip('doubleJump', 0.7, [
    qAnim(T, [[0, 0.05, 0, 0], [0.22, -0.35, 0, 0], [0.45, -0.15, 0, 0], [0.7, 0.1, 0, 0]], false),
    qAnim(KL, [[0, 0.4, 0, 0], [0.22, 1.9, 0, 0], [0.45, 1.5, 0, 0], [0.7, 0.7, 0, 0]], false),
    qAnim(KR, [[0, 0.4, 0, 0], [0.22, 1.9, 0, 0], [0.45, 1.5, 0, 0], [0.7, 0.7, 0, 0]], false),
    qAnim(LL, [[0, -0.3, 0, 0], [0.22, -1.1, 0, 0], [0.45, -0.7, 0, 0], [0.7, -0.35, 0, 0]], false),
    qAnim(LR, [[0, -0.3, 0, 0], [0.22, -1.1, 0, 0], [0.45, -0.7, 0, 0], [0.7, -0.35, 0, 0]], false),
    qAnim(AL, [[0, -1.2, 0, 0.4], [0.22, -2.9, 0, 0.5], [0.7, -2.4, 0, 0.4]], false),
    qAnim(AR, [[0, -1.2, 0, -0.4], [0.22, -2.9, 0, -0.5], [0.7, -2.4, 0, -0.4]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.22, -0.3, 0, 0], [0.7, 0.1, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.22, 0.04], [0.7, 0.02]], false),
  ]))
  clips.push(new THREE.AnimationClip('fall', 1.2, [
    qAnim(T, [[0, -0.13, 0, 0], [0.6, -0.19, 0, 0.06], [1.2, -0.13, 0, 0]], false),
    qAnim(HD, [[0, -0.26, 0, 0], [1.2, -0.26, 0, 0]], false),
    qAnim(AL, [[0, -2.3, 0, 0.34], [0.3, -2.7, 0, 0.52], [0.6, -2.3, 0, 0.34], [0.9, -2.7, 0, 0.52], [1.2, -2.3, 0, 0.34]], false),
    qAnim(AR, [[0, -2.3, 0, -0.34], [0.3, -2.7, 0, -0.52], [0.6, -2.3, 0, -0.34], [0.9, -2.7, 0, -0.52], [1.2, -2.3, 0, -0.34]], false),
    qAnim(EL, [[0, -0.85, 0, 0], [0.6, -1.1, 0, 0], [1.2, -0.85, 0, 0]], false),
    qAnim(ER, [[0, -0.85, 0, 0], [0.6, -1.1, 0, 0], [1.2, -0.85, 0, 0]], false),
    qAnim(LL, [[0, -0.42, 0, 0], [0.6, -0.14, 0, 0], [1.2, -0.42, 0, 0]], false),
    qAnim(LR, [[0, 0.28, 0, 0], [0.6, 0.06, 0, 0], [1.2, 0.28, 0, 0]], false),
    qAnim(KL, [[0, 1.05, 0, 0], [0.6, 0.5, 0, 0], [1.2, 1.05, 0, 0]], false),
    qAnim(KR, [[0, 0.7, 0, 0], [0.6, 0.32, 0, 0], [1.2, 0.7, 0, 0]], false),
    qAnim(FL, [[0, -0.2, 0, 0], [1.2, -0.2, 0, 0]], false),
    qAnim(FR, [[0, -0.15, 0, 0], [1.2, -0.15, 0, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('land', 0.5, [
    qAnim(T, [[0, 0.44, 0, 0], [0.5, 0.05, 0, 0]], false),
    qAnim(KL, [[0, 1.65, 0, 0], [0.5, 0.10, 0, 0]], false),
    qAnim(KR, [[0, 1.55, 0, 0], [0.5, 0.10, 0, 0]], false),
    qAnim(LL, [[0, -1.02, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(LR, [[0, -0.92, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(FL, [[0, 0.15, 0, 0], [0.5, 0, 0, 0]], false),
    qAnim(FR, [[0, 0.15, 0, 0], [0.5, 0, 0, 0]], false),
    qAnim(AL, [[0, -1.3, 0, 0.44], [0.5, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -1.3, 0, -0.44], [0.5, 0.05, 0, -0]], false),
    qAnim(EL, [[0, -0.5, 0, 0], [0.5, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.5, 0, 0], [0.5, -0.14, 0, 0]], false),
    bobAnim(H, hipY, [[0, -0.27], [0.5, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('slide', 0.8, [
    qAnim(T, [[0, -1.12, 0, 0], [0.4, -1.06, 0, 0.05], [0.8, -1.12, 0, 0]], false),
    qAnim(HD, [[0, 0.44, 0, 0], [0.8, 0.44, 0, 0]], false),
    qAnim(LL, [[0, 0.45, 0, 0], [0.8, 0.45, 0, 0]], false),
    qAnim(KL, [[0, 0.16, 0, 0], [0.8, 0.16, 0, 0]], false),
    qAnim(LR, [[0, -0.18, 0, 0], [0.8, -0.18, 0, 0]], false),
    qAnim(KR, [[0, 0.95, 0, 0], [0.8, 0.95, 0, 0]], false),
    qAnim(FL, [[0, -0.25, 0, 0], [0.8, -0.25, 0, 0]], false),
    qAnim(FR, [[0, 0.2, 0, 0], [0.8, 0.2, 0, 0]], false),
    qAnim(AL, [[0, -2.9, 0, 0.26], [0.8, -2.9, 0, 0.26]], false),
    qAnim(EL, [[0, -0.3, 0, 0], [0.8, -0.3, 0, 0]], false),
    qAnim(AR, [[0, -2.7, 0, -0.26], [0.8, -2.7, 0, -0.26]], false),
    qAnim(ER, [[0, -0.36, 0, 0], [0.8, -0.36, 0, 0]], false),
    bobAnim(H, hipY * 0.62, [[0, 0], [0.8, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('hit', 0.6, [
    qAnim(T, [[0, 0, 0, 0], [0.15, -0.58, 0, 0.12], [0.6, -0.3, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.2, -0.34, 0.22, 0], [0.45, -0.16, -0.15, 0], [0.6, -0.2, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.2, -1.42, 0, 0.74], [0.6, -0.62, 0, 0.42]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, -1.42, 0, -0.74], [0.6, -0.62, 0, -0.42]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.2, -1.05, 0, 0], [0.6, -0.55, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.2, -1.05, 0, 0], [0.6, -0.55, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.2, 0.36, 0, 0], [0.6, 0.2, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.2, -0.32, 0, 0], [0.6, -0.15, 0, 0]], false),
    qAnim(KL, [[0, 0.1, 0, 0], [0.2, 0.9, 0, 0], [0.6, 0.55, 0, 0]], false),
    qAnim(KR, [[0, 0.1, 0, 0], [0.2, 0.7, 0, 0], [0.6, 0.45, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.2, -0.1], [0.6, -0.02]], false),
  ]))
  clips.push(new THREE.AnimationClip('detained', 2.2, [
    qAnim(T, [[0, 0.13, 0, 0], [1.1, 0.15, 0, 0], [2.2, 0.13, 0, 0]], false),
    qAnim(HD, [[0, 0.36, 0, 0], [0.7, 0.44, 0.08, 0], [1.6, 0.4, -0.08, 0], [2.2, 0.36, 0, 0]], false),
    qAnim(AL, [[0, 0.58, 0, 0.52], [2.2, 0.58, 0, 0.52]], false),
    qAnim(AR, [[0, 0.58, 0, -0.52], [2.2, 0.58, 0, -0.52]], false),
    qAnim(EL, [[0, -0.28, 0, 0], [2.2, -0.28, 0, 0]], false),
    qAnim(ER, [[0, -0.28, 0, 0], [2.2, -0.28, 0, 0]], false),
    qAnim(KL, [[0, 0.16, 0, 0], [2.2, 0.16, 0, 0]], false),
    qAnim(KR, [[0, 0.13, 0, 0], [2.2, 0.13, 0, 0]], false),
    qAnim(LL, [[0, 0.06, 0, 0], [2.2, 0.06, 0, 0]], false),
    qAnim(LR, [[0, -0.06, 0, 0], [2.2, -0.06, 0, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('recover', 0.9, [
    qAnim(T, [[0, 0.5, 0, 0], [0.55, 0.13, 0, 0], [0.9, 0.03, 0, 0]], false),
    qAnim(KL, [[0, 1.8, 0, 0], [0.55, 0.48, 0, 0], [0.9, 0.10, 0, 0]], false),
    qAnim(KR, [[0, 1.7, 0, 0], [0.55, 0.44, 0, 0], [0.9, 0.10, 0, 0]], false),
    qAnim(LL, [[0, -1.12, 0, 0], [0.55, -0.3, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LR, [[0, -1.02, 0, 0], [0.55, -0.26, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(AL, [[0, -0.82, 0, 0.32], [0.9, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -0.82, 0, -0.32], [0.9, 0.05, 0, -0]], false),
    qAnim(EL, [[0, -0.48, 0, 0], [0.9, -0.15, 0, 0]], false),
    qAnim(ER, [[0, -0.48, 0, 0], [0.9, -0.15, 0, 0]], false),
    bobAnim(H, hipY, [[0, -0.3], [0.55, -0.06], [0.9, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('celebrate', 1.5, [
    qAnim(T, [[0, -0.07, 0, 0], [0.75, 0, 0, 0], [1.5, -0.07, 0, 0]], false),
    qAnim(HD, [[0, -0.16, 0, 0], [1.5, -0.16, 0, 0]], false),
    qAnim(AL, [[0, -2.9, 0, 0.34], [0.75, -2.6, 0, 0.5], [1.5, -2.9, 0, 0.34]], false),
    qAnim(AR, [[0, -2.9, 0, -0.34], [0.75, -2.6, 0, -0.5], [1.5, -2.9, 0, -0.34]], false),
    qAnim(EL, [[0, -0.22, 0, 0], [0.75, -0.4, 0, 0], [1.5, -0.22, 0, 0]], false),
    qAnim(ER, [[0, -0.22, 0, 0], [0.75, -0.4, 0, 0], [1.5, -0.22, 0, 0]], false),
    qAnim(KL, [[0, 0.12, 0, 0], [0.3, 0.8, 0, 0], [0.75, 0.1, 0, 0], [1.05, 0.8, 0, 0], [1.5, 0.12, 0, 0]], false),
    qAnim(KR, [[0, 0.12, 0, 0], [0.3, 0.8, 0, 0], [0.75, 0.1, 0, 0], [1.05, 0.8, 0, 0], [1.5, 0.12, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.35, 0.13], [0.75, 0], [1.1, 0.13], [1.5, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('throw', 0.7, [
    qAnim(T, [[0, 0, 0, 0], [0.2, 0.19, 0, -0.27], [0.42, 0.29, 0, 0.19], [0.7, 0.05, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, 1.02, 0, 0], [0.42, -2.42, 0, 0], [0.7, -1.22, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.2, -1.85, 0, 0], [0.42, -0.2, 0, 0], [0.7, -0.3, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.42, 0.44, 0, 0], [0.7, 0, 0, 0]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.42, -0.44, 0, 0], [0.7, -0.14, 0, 0]], false),
    qAnim(KL, [[0, 0.1, 0, 0], [0.2, 0.4, 0, 0], [0.42, 0.3, 0, 0], [0.7, 0.13, 0, 0]], false),
    qAnim(KR, [[0, 0.1, 0, 0], [0.2, 0.34, 0, 0], [0.42, 0.55, 0, 0], [0.7, 0.17, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.42, 0.03], [0.7, 0]], false),
  ]))
  clips.push(new THREE.AnimationClip('heal', 1.0, [
    qAnim(T, [[0, 0, 0, 0], [0.35, -0.08, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.35, 0.11, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.3, -1.72, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.3, -1.72, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.3, -1.0, 0, 0], [1.0, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.3, -1.0, 0, 0], [1.0, -0.14, 0, 0]], false),
  ]))
  return clips
}

// ============================================================================
// EXPORT
// ============================================================================
export function exportGlb(root: THREE.Object3D, clips: THREE.AnimationClip[], out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      root,
      (result) => {
        const buf = result as ArrayBuffer
        if (new DataView(buf).getUint32(0, true) !== 0x46546c67) { reject(new Error('not GLB')); return }
        writeFileSync(out, Buffer.from(buf))
        console.log(`OK ${out} — ${(buf.byteLength / 1024).toFixed(1)} KB, ${clips.length} clips`)
        resolve()
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true, animations: clips },
    )
  })
}

/** Bind a list of skinned meshes to a fresh skeleton, add rigid parts + head. */
export function assemble(skel: SkeletonDef, skinned: THREE.SkinnedMesh[], headGroup: THREE.Group, rootName: string): THREE.Group {
  const root = new THREE.Group()
  root.name = rootName
  const armature = new THREE.Group()
  armature.name = 'Armature'
  for (const b of skel.bones) if (!b.parent) armature.add(b)
  root.add(armature)
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(skel.bones)
  const identity = new THREE.Matrix4()
  for (const sm of skinned) { root.add(sm); sm.bind(skeleton, identity); sm.normalizeSkinWeights() }
  skel.bones[skel.index.Head].add(headGroup)
  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  return root
}
