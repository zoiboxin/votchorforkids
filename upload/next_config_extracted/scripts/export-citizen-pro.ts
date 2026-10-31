/**
 * VoteChor — CITIZEN PRO body exporter (bun, no DOM).
 *
 * The "mix the best of both" character the user asked for:
 *   • FLEXIBILITY from Junior Citizen — reuses the exact human skeleton (19 skin
 *     joints) + the 14 biomechanical clips (scripts/human-rig.ts), so walk / run
 *     / jump / double-jump / slide / etc. and the knee/elbow/foot-roll + blink
 *     facial rig all work identically with ZERO engine changes.
 *   • LOOK from Protester (and a GTA-Vice-City adult vibe) — a genuinely
 *     better BODY on that skeleton: realistic adult proportions, SMOOTH skinned
 *     shoulders (no deltoid ball), higher-resolution lofts, and PBR materials
 *     with procedural micro-texture (skin / fabric / denim) + a face.
 *
 * Output: public/models/votechor-citizenpro-{male,female}.glb
 * Bone + clip + facial-node names are the SAME as the human family, so
 * avatar-look.ts reuses the 'human' attachment branch and the tint map.
 */
import * as THREE from 'three'
import {
  type Prop, type SkeletonDef, type Seg,
  buildSkeleton, buildSegments, skinnify, legTopOverride, buildClips,
  loft, armLoft, mergeGeoms, mkMesh, exportGlb, assemble,
} from './human-rig'

// ============================================================================
// 1. PROPORTIONS — believable adult (GTA-VC silhouette: broad shoulders, taper
//    to waist, solid thighs). Heights: male ~1.82 m, female ~1.70 m.
// ============================================================================
const MALE: Prop = {
  hipY: 0.96, thighLen: 0.46, calfLen: 0.44, footH: 0.11,
  torsoTop: 0.56, spineY: 0.11, chestY: 0.30,
  shoulderY: 1.50, shoulderX: 0.225, hipX: 0.098,
  upperLen: 0.30, foreLen: 0.26, handLen: 0.12,
  headR: 0.112, headCY: 0.12, neckLen: 0.07,
  // V-taper torso: wide chest/shoulders → cinched waist → hip flare
  rings: [
    { y: 0.00, rx: 0.150, rz: 0.108 }, // hip line
    { y: 0.07, rx: 0.150, rz: 0.106 }, // waist low
    { y: 0.15, rx: 0.140, rz: 0.100 }, // waist (narrowest)
    { y: 0.24, rx: 0.158, rz: 0.112 }, // lower rib
    { y: 0.33, rx: 0.188, rz: 0.126 }, // chest
    { y: 0.42, rx: 0.214, rz: 0.132 }, // upper chest / lats
    { y: 0.47, rx: 0.232, rz: 0.128 }, // shoulder line — reaches the arm top (x≈0.225) to close the seam
    { y: 0.52, rx: 0.150, rz: 0.100 }, // trapezius slope to the neck
    { y: 0.56, rx: 0.110, rz: 0.086 }, // neck base
  ],
  pelvis: { rx: 0.160, rz: 0.118, h: 0.15 },
  armR1: 0.056, armR2: 0.046, armR3: 0.032,
  legR1: 0.094, legR2: 0.068, legR3: 0.044,
}

const FEMALE: Prop = {
  hipY: 0.90, thighLen: 0.44, calfLen: 0.42, footH: 0.085,
  torsoTop: 0.52, spineY: 0.10, chestY: 0.27,
  shoulderY: 1.38, shoulderX: 0.185, hipX: 0.094,
  upperLen: 0.27, foreLen: 0.24, handLen: 0.10,
  headR: 0.104, headCY: 0.115, neckLen: 0.06,
  rings: [
    { y: 0.00, rx: 0.156, rz: 0.110 }, // hip (wider)
    { y: 0.07, rx: 0.148, rz: 0.104 },
    { y: 0.15, rx: 0.126, rz: 0.092 }, // cinched waist
    { y: 0.23, rx: 0.138, rz: 0.100 },
    { y: 0.30, rx: 0.150, rz: 0.110, bust: 0.26 }, // bust
    { y: 0.37, rx: 0.152, rz: 0.104 },
    { y: 0.44, rx: 0.192, rz: 0.112 }, // shoulder line — reaches the arm top (narrower than male)
    { y: 0.49, rx: 0.130, rz: 0.094 }, // trapezius slope
    { y: 0.53, rx: 0.100, rz: 0.080 },
  ],
  pelvis: { rx: 0.166, rz: 0.116, h: 0.14 },
  armR1: 0.044, armR2: 0.037, armR3: 0.027,
  legR1: 0.086, legR2: 0.060, legR3: 0.038,
}

type Gender = 'male' | 'female'
const PROP: Record<Gender, Prop> = { male: MALE, female: FEMALE }

// ============================================================================
// 2. MATERIALS
// ============================================================================
interface Mats {
  skin: THREE.MeshStandardMaterial
  shirt: THREE.MeshStandardMaterial
  shirtDark: THREE.MeshStandardMaterial
  pants: THREE.MeshStandardMaterial
  hair: THREE.MeshStandardMaterial
  shoe: THREE.MeshStandardMaterial
  sole: THREE.MeshStandardMaterial
  belt: THREE.MeshStandardMaterial
  eyeWhite: THREE.MeshStandardMaterial
  iris: THREE.MeshStandardMaterial
  pupil: THREE.MeshStandardMaterial
  brow: THREE.MeshStandardMaterial
  lip: THREE.MeshStandardMaterial
  mouthIn: THREE.MeshStandardMaterial
}

interface Pal { skin: number; shirt: number; pants: number; hair: number; shoe: number; sole: number; belt: number }
const PALETTES: Record<Gender, Pal> = {
  // GTA-VC inspired: tropical shirt + light trousers. The runtime tint pipeline
  // recolors shirt/pants/skin by name anyway; these are the baked defaults.
  male: { skin: 0xc68a60, shirt: 0xd9663f, pants: 0x3a4454, hair: 0x241a12, shoe: 0x2b2824, sole: 0xbdb6a6, belt: 0x2a2018 },
  female: { skin: 0xd19970, shirt: 0xb84a63, pants: 0x3f4a5c, hair: 0x1c130d, shoe: 0x6b3a44, sole: 0xbdb6a6, belt: 0x2a2018 },
}

function makeMaterials(g: Gender): Mats {
  const P = PALETTES[g]
  const named = (m: THREE.MeshStandardMaterial, name: string) => { m.name = `human_${name}`; return m }
  const dark = (c: number, f = 0.8) => new THREE.Color(c).multiplyScalar(f).getHex()
  // Solid PBR (no texture maps — the bun GLTFExporter can't encode image data
  // without a DOM canvas). Surface richness comes from tuned roughness, the
  // smoother high-res geometry, and the runtime image-based lighting (envMap).
  return {
    skin: named(new THREE.MeshStandardMaterial({ color: P.skin, roughness: 0.66, metalness: 0.0 }), 'skin'),
    shirt: named(new THREE.MeshStandardMaterial({ color: P.shirt, roughness: 0.78, metalness: 0.0 }), 'shirt'),
    shirtDark: named(new THREE.MeshStandardMaterial({ color: dark(P.shirt, 0.78), roughness: 0.82, metalness: 0.0 }), 'shirtDark'),
    pants: named(new THREE.MeshStandardMaterial({ color: P.pants, roughness: 0.88, metalness: 0.0 }), 'pants'),
    hair: named(new THREE.MeshStandardMaterial({ color: P.hair, roughness: 0.5, metalness: 0.04 }), 'hair'),
    shoe: named(new THREE.MeshStandardMaterial({ color: P.shoe, roughness: 0.5, metalness: 0.06 }), 'shoe'),
    sole: named(new THREE.MeshStandardMaterial({ color: P.sole, roughness: 0.88, metalness: 0.0 }), 'sole'),
    belt: named(new THREE.MeshStandardMaterial({ color: P.belt, roughness: 0.45, metalness: 0.2 }), 'belt'),
    eyeWhite: named(new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.2, metalness: 0.0 }), 'eyeWhite'),
    iris: named(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.25, metalness: 0.0 }), 'iris'),
    pupil: named(new THREE.MeshStandardMaterial({ color: 0x14100b, roughness: 0.1, metalness: 0.0 }), 'pupil'),
    brow: named(new THREE.MeshStandardMaterial({ color: dark(P.hair, 1.0), roughness: 0.7, metalness: 0.0 }), 'brow'),
    lip: named(new THREE.MeshStandardMaterial({ color: new THREE.Color(P.skin).multiplyScalar(0.74).getHex(), roughness: 0.45, metalness: 0.0 }), 'lip'),
    mouthIn: named(new THREE.MeshStandardMaterial({ color: 0x3a1a16, roughness: 0.6, metalness: 0.0 }), 'mouthIn'),
  }
}

// ============================================================================
// 3. HEAD — rounded adult head with simple, clean face features
// ============================================================================
const HEAD_RX = 0.94, HEAD_RY = 1.18, HEAD_RZ = 1.0
function faceZ(p: Prop, yLocal: number, x = 0): number {
  const R = p.headR, cy = p.headCY
  const dx = x / (R * HEAD_RX), dy = (yLocal - cy) / (R * HEAD_RY)
  return R * HEAD_RZ * Math.sqrt(Math.max(0.03, 1 - dx * dx - dy * dy))
}

function buildHead(p: Prop, M: Mats, female: boolean): THREE.Group {
  const g = new THREE.Group()
  g.name = 'HeadGroup'
  const R = p.headR, cy = p.headCY

  // skull — ellipsoid, jaw taper toward the chin
  const skull = new THREE.SphereGeometry(R, 28, 22)
  skull.scale(HEAD_RX, HEAD_RY, HEAD_RZ)
  skull.translate(0, cy, 0.006)
  {
    const pos = skull.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i), vz = pos.getZ(i)
      if (vy < cy - R * 0.2) {
        const f = THREE.MathUtils.smoothstep((cy - R * 0.2 - vy) / (R * 0.95), 0, 1) * (female ? 0.4 : 0.32)
        pos.setX(i, pos.getX(i) * (1 - f * 0.34))
        pos.setZ(i, vz + (R * 0.26 - vz) * f * 0.3)
      }
    }
    skull.computeVertexNormals()
  }
  g.add(mkMesh(skull, M.skin, 'HumanHead'))

  // ears
  for (const s of [-1, 1] as const) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 10, 8), M.skin)
    ear.name = s < 0 ? 'EarL' : 'EarR'
    ear.scale.set(0.4, 0.92, 0.66)
    ear.position.set(s * R * HEAD_RX * 0.96, cy - R * 0.02, 0.0)
    g.add(ear)
  }

  // nose — bridge + tip
  const noseY = cy - R * 0.06
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(R * 0.09, R * 0.28, R * 0.1), M.skin)
  bridge.name = 'NoseBridge'
  bridge.position.set(0, noseY + R * 0.12, faceZ(p, noseY + R * 0.12) - R * 0.03)
  g.add(bridge)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 10, 8), M.skin)
  nose.name = 'Nose'
  nose.scale.set(1.0, 0.82, 1.05)
  nose.position.set(0, noseY, faceZ(p, noseY) + R * 0.01)
  g.add(nose)

  // eyes — sclera + iris + pupil + blink lids
  const eyeY = cy + R * 0.04
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R'
    const ex = s * R * 0.34
    const z = faceZ(p, eyeY, ex)
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 14, 10), M.eyeWhite)
    sclera.name = `Eye${side}`
    sclera.scale.set(1.0, 0.86, 0.44)
    sclera.position.set(ex, eyeY, z - R * 0.075)
    g.add(sclera)
    const iris = new THREE.Mesh(new THREE.SphereGeometry(R * 0.1, 12, 8), M.iris)
    iris.name = `Iris${side}`
    iris.scale.set(1, 1, 0.4)
    iris.position.set(ex, eyeY, z + R * 0.006)
    g.add(iris)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(R * 0.05, 8, 6), M.pupil)
    pupil.name = `Pupil${side}`
    pupil.scale.set(1, 1, 0.4)
    pupil.position.set(ex, eyeY, z + R * 0.02)
    g.add(pupil)
    // upper lid shell (blink driven by facial-rig; rotation.x = LID_OPEN at rest)
    const lid = new THREE.Mesh(new THREE.SphereGeometry(R * 0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), M.skin)
    lid.name = `LidTop${side}`
    lid.scale.set(1.12, 1.0, 0.62)
    lid.position.set(ex, eyeY + R * 0.01, z - R * 0.055)
    lid.rotation.x = -1.2
    g.add(lid)
    const lidB = new THREE.Mesh(new THREE.SphereGeometry(R * 0.21, 10, 6, 0, Math.PI * 2, Math.PI * 0.74, Math.PI * 0.18), M.skin)
    lidB.name = `LidBot${side}`
    lidB.scale.set(1.06, 0.9, 0.58)
    lidB.position.set(ex, eyeY, z - R * 0.055)
    g.add(lidB)
  }

  // brows (facial-rig drives them)
  const browY = cy + R * 0.22
  for (const s of [-1, 1] as const) {
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.028, R * 0.16, 3, 6), M.brow)
    brow.name = s < 0 ? 'BrowL' : 'BrowR'
    brow.rotation.z = Math.PI / 2 + s * 0.12
    brow.position.set(s * R * 0.34, browY, faceZ(p, browY, s * R * 0.34) + R * 0.012)
    g.add(brow)
  }

  // mouth — lips + interior + jaw group
  const mouthY = cy - R * 0.34
  const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.036, R * 0.16, 3, 8), M.lip)
  upperLip.name = 'UpperLip'
  upperLip.rotation.z = Math.PI / 2
  upperLip.position.set(0, mouthY + R * 0.02, faceZ(p, mouthY + R * 0.02) + R * 0.008)
  g.add(upperLip)
  const interior = new THREE.Mesh(new THREE.SphereGeometry(R * 0.1, 10, 6), M.mouthIn)
  interior.name = 'MouthInterior'
  interior.scale.set(1.1, 0.5, 0.3)
  interior.position.set(0, mouthY, faceZ(p, mouthY) - R * 0.016)
  g.add(interior)
  const jaw = new THREE.Group()
  jaw.name = 'Jaw'
  jaw.position.set(0, mouthY - R * 0.05, faceZ(p, mouthY - R * 0.05) * 0.55)
  g.add(jaw)
  const lowerLip = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.04, R * 0.14, 3, 8), M.lip)
  lowerLip.name = 'LowerLip'
  lowerLip.rotation.z = Math.PI / 2
  lowerLip.position.set(0, 0, R * 0.12)
  jaw.add(lowerLip)
  const chin = new THREE.Mesh(new THREE.SphereGeometry(R * 0.12, 10, 6), M.skin)
  chin.name = 'ChinPad'
  chin.scale.set(1.0, 0.52, 0.76)
  chin.position.set(0, -R * 0.06, R * 0.06)
  jaw.add(chin)

  // HAIR — clean short adult cut. A FULL cap (thetaLength 0.66π) that comes down
  // past the hairline on top/sides/back, sitting slightly bigger than the skull
  // so it reads as hair, not a skullcap. Front edge pulled DOWN to the forehead.
  const crown = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 24, 18, 0, Math.PI * 2, 0, Math.PI * (female ? 0.72 : 0.62)), M.hair)
  crown.name = 'Hair'
  crown.scale.set(HEAD_RX * 1.05, HEAD_RY * 1.0, HEAD_RZ * 1.07)
  crown.position.set(0, cy + R * 0.3, -R * 0.02)
  crown.rotation.x = -0.08
  g.add(crown)
  // forehead hairline block so the front is not a hard dome edge over bare skin
  const front = new THREE.Mesh(new THREE.BoxGeometry(R * 1.3, R * 0.2, R * 0.3), M.hair)
  front.name = 'HairFront'
  front.position.set(0, cy + R * 0.5, faceZ(p, cy + R * 0.5) - R * 0.12)
  front.rotation.x = 0.12
  g.add(front)
  const nape = new THREE.Mesh(new THREE.SphereGeometry(R * 0.62, 16, 12), M.hair)
  nape.name = 'HairNape'
  nape.scale.set(1.5, 1.3, 1.1)
  nape.position.set(0, cy + R * 0.1, -R * 0.5)
  g.add(nape)
  if (female) {
    // gathered bun + physics ponytail node (SecondaryMotion springs it)
    const pony = new THREE.Group()
    pony.name = 'Ponytail'
    pony.position.set(0, cy + R * 0.2, -R * 0.9)
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.16, R * 0.9, 4, 10), M.hair)
    tail.name = 'PonytailMesh'
    tail.position.set(0, -R * 0.5, -R * 0.04)
    tail.rotation.x = 0.2
    pony.add(tail)
    g.add(pony)
  } else {
    // short front fringe tuft so the hairline isn't a hard dome edge
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(R * 0.6, R * 0.12, R * 0.16), M.hair)
    fringe.name = 'Fringe'
    fringe.position.set(0, cy + R * 0.46, faceZ(p, cy + R * 0.46) - R * 0.08)
    fringe.rotation.x = 0.2
    g.add(fringe)
  }
  return g
}

// ============================================================================
// 4. BODY + CLOTHES — smooth skinned shoulders, no deltoid ball
// ============================================================================
function buildBody(p: Prop, M: Mats, skel: SkeletonDef, segs: Seg[], female: boolean): { skinned: THREE.SkinnedMesh[]; rigid: THREE.Object3D[] } {
  const skinned: THREE.SkinnedMesh[] = []
  const rigid: THREE.Object3D[] = []

  // ---- torso loft (hip → neck, shirt). High res (32 segs). The top rings carry
  // the deltoid shelf so the shoulder line is built into the torso silhouette. ----
  const rings = p.rings.map((r) => ({ y: p.hipY + r.y, rx: r.rx, rz: r.rz, bust: r.bust ?? 0 }))
  const torsoGeo = loft(rings, 32)
  skinnify(torsoGeo, segs, skel.index, 4, ['Hips', 'Torso', 'Chest', 'Neck', 'ClavicleL', 'ClavicleR'])
  const torso = new THREE.SkinnedMesh(torsoGeo, M.shirt)
  torso.name = 'HumanTorso'
  skinned.push(torso)

  // ---- pelvis (rigid, pants) ----
  const pelvisGeo = loft([
    { y: -p.pelvis.h * 0.55, rx: p.pelvis.rx * 0.86, rz: p.pelvis.rz * 0.82 },
    { y: -p.pelvis.h * 0.2, rx: p.pelvis.rx, rz: p.pelvis.rz },
    { y: p.pelvis.h * 0.16, rx: p.pelvis.rx * 1.0, rz: p.pelvis.rz * 0.98 },
    { y: p.pelvis.h * 0.34, rx: p.pelvis.rx * 0.9, rz: p.pelvis.rz * 0.92 },
  ], 28)
  rigid.push(mkMesh(pelvisGeo, M.pants, 'HumanPelvis'))

  // ---- belt (rigid, at the waist) — small GTA detail ----
  const beltGeo = new THREE.CylinderGeometry(p.pelvis.rx * 1.02, p.pelvis.rx * 1.02, 0.05, 28)
  beltGeo.translate(0, p.pelvis.h * 0.3, 0)
  rigid.push(mkMesh(beltGeo, M.belt, 'Belt'))

  // ---- neck (rigid, skin) ----
  const neckTop = p.hipY + p.torsoTop + 0.19
  const neckBot = p.hipY + p.torsoTop - p.neckLen - 0.05
  const neckGeo = new THREE.CylinderGeometry(p.headR * 0.4, p.headR * 0.36, neckTop - neckBot, 14)
  neckGeo.translate(0, (neckTop + neckBot) / 2 - (p.hipY + p.chestY), 0)
  rigid.push(mkMesh(neckGeo, M.skin, 'HumanNeck'))

  // ---- collar (rigid, shirtDark) ----
  const collarGeo = new THREE.CylinderGeometry(p.headR * 0.5, p.headR * 0.78, 0.06, 16)
  collarGeo.translate(0, p.hipY + p.torsoTop - 0.04 - (p.hipY + p.chestY), 0)
  rigid.push(mkMesh(collarGeo, M.shirtDark, 'Collar'))

  // ---- arms (per side): SMOOTH shoulder → wrist, skinned across the joints.
  // A shoulder cap LOFT (not a sphere) blends the deltoid into the sleeve, and
  // it is SKINNED to Clavicle+Arm so it moves with the shoulder (no rigid ball). ----
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const sh = skel.world[`Arm${L}`]
    const el = skel.world[`Elbow${L}`]
    const wr = skel.world[`Hand${L}`]
    // ONE continuous arm loft shoulder→wrist (shirt). Multi-ring radius profile:
    // fat deltoid at the top that tapers to the elbow, swells slightly at the
    // forearm, then necks down to the wrist. Skinned across Clavicle/Arm/Elbow/
    // Hand so it bends smoothly with NO gaps or shelves. The upper portion is the
    // sleeve; the wrist end meets the hand exactly at skel.world[Hand].
    // The arm is a clean tapered tube that does NOT balloon at the top (no wing).
    // The shoulder roundness comes from the TORSO shoulder shelf (built below),
    // which reaches out to the arm. The arm top ring is rounded (dome via a tiny
    // cap ring) but no wider than the upper arm.
    // Pull the arm's lower half INBOARD so the hand rests against the thigh (the
    // skeleton splays Hand out to shoulderX+0.06; we keep the mesh axis closer to
    // the body). The top is a DOME (small rings closing over) so there is NO
    // pointed shoulder tip. Radii swell at the forearm so the wrist matches the
    // hand width (no thin-stick → wide-hand step).
    const wrIn = wr.clone(); wrIn.x = sh.x + (wr.x - sh.x) * 0.45 // hand drawn ~halfway inboard
    const elIn = el.clone(); elIn.x = sh.x + (el.x - sh.x) * 0.6
    const armRings: { a: THREE.Vector3; r: number }[] = [
      { a: sh.clone().add(new THREE.Vector3(0, p.armR1 * 0.5, 0)), r: p.armR1 * 0.34 }, // dome tip (small → rounds over)
      { a: sh.clone().add(new THREE.Vector3(0, p.armR1 * 0.28, 0)), r: p.armR1 * 0.78 },
      { a: sh, r: p.armR1 * 1.02 },                         // shoulder (deltoid)
      { a: sh.clone().lerp(elIn, 0.5), r: p.armR1 * 0.9 },  // mid upper arm
      { a: elIn, r: p.armR2 * 1.0 },                        // elbow
      { a: elIn.clone().lerp(wrIn, 0.45), r: p.armR2 * 0.98 }, // forearm
      { a: elIn.clone().lerp(wrIn, 0.82), r: p.armR3 * 1.35 }, // widen toward the wrist (meets hand)
      { a: wrIn, r: p.armR3 * 1.25 },                       // wrist
    ]
    const armGeo = loft(armRings.map((q) => ({ y: q.a.y, rx: q.r, rz: q.r, cz: q.a.z })), 22)
    {
      const pos = armGeo.attributes.position as THREE.BufferAttribute
      const y0 = armRings[0].a.y, y1 = wrIn.y
      // piecewise x along the ring list so the inboard bend follows the rings
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i)
        // find bracketing rings by y and lerp their x centers
        let xc = sh.x
        for (let k = 0; k < armRings.length - 1; k++) {
          const ay = armRings[k].a.y, by = armRings[k + 1].a.y
          if ((y <= ay && y >= by) || (y >= ay && y <= by)) {
            const tt = THREE.MathUtils.clamp((y - ay) / Math.max(1e-6, by - ay), 0, 1)
            xc = THREE.MathUtils.lerp(armRings[k].a.x, armRings[k + 1].a.x, tt)
            break
          }
        }
        if (y >= y0) xc = armRings[0].a.x
        if (y <= y1) xc = wrIn.x
        pos.setX(i, pos.getX(i) + xc)
      }
      pos.needsUpdate = true
      armGeo.computeVertexNormals()
    }
    skinnify(armGeo, segs, skel.index, 4, [`Clavicle${L}`, `Arm${L}`, `Elbow${L}`, `Hand${L}`])
    const arm = new THREE.SkinnedMesh(armGeo, M.shirt)
    arm.name = `HumanArm${L}`
    skinned.push(arm)
    // hand (rigid on Hand bone) pulled inboard to match the arm's inboard wrist,
    // so the hand sits by the thigh, not out to the side.
    const hand = mkMesh(buildHandGeo(p, s), M.skin, `HumanHand${L}`)
    hand.position.x = wrIn.x - wr.x // Hand bone sits at wr; shift mesh to the inboard wrist
    rigid.push(hand)
  }

  // ---- legs (per side): full trouser leg spanning the knee, skinned smooth ----
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const hp = skel.world[`Leg${L}`]
    const an = skel.world[`Foot${L}`]
    const legGeo = armLoft(hp, an, p.legR1 * 1.16, p.legR3 * 1.1, 24, 12)
    skinnify(legGeo, segs, skel.index, 4, ['Hips', `Leg${L}`, `Knee${L}`, `Foot${L}`], legTopOverride(p, `Leg${L}`))
    const leg = new THREE.SkinnedMesh(legGeo, M.pants)
    leg.name = `HumanLeg${L}`
    skinned.push(leg)
    rigid.push(mkMesh(buildShoeGeo(p), M.shoe, `HumanShoe${L}`))
    rigid.push(mkMesh(buildSoleGeo(p), M.sole, `HumanSole${L}`))
  }

  // parent rigid parts to bones
  rigid.forEach((o) => {
    if (o.name === 'HumanPelvis' || o.name === 'Belt') skel.bones[skel.index.Hips].add(o)
    else if (o.name === 'HumanNeck' || o.name === 'Collar') skel.bones[skel.index.Chest].add(o)
    else if (o.name.startsWith('HumanHand')) skel.bones[skel.index[o.name.replace('HumanHand', 'Hand')]].add(o)
    else if (o.name.startsWith('HumanShoe') || o.name.startsWith('HumanSole')) skel.bones[skel.index[o.name.endsWith('L') ? 'FootL' : 'FootR']].add(o)
  })
  return { skinned, rigid }
}

function buildHandGeo(p: Prop, side: -1 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const w = p.armR3 * 1.2
  const palmLen = p.handLen * 0.5
  const fingLen = p.handLen * 0.56
  const palm = loft([
    { y: 0.1, rx: w * 0.9, rz: w * 0.5 },     // extend higher INTO the sleeve (closes the wrist gap)
    { y: 0.045, rx: w * 0.98, rz: w * 0.52 },
    { y: 0.012, rx: w * 1.06, rz: w * 0.52 },
    { y: -palmLen * 0.5, rx: w * 1.2, rz: w * 0.56 },
    { y: -palmLen, rx: w * 1.28, rz: w * 0.5 },
  ], 14)
  parts.push(palm)
  const fingers = loft([
    { y: 0, rx: w * 1.26, rz: w * 0.46 },
    { y: -fingLen * 0.55, rx: w * 1.18, rz: w * 0.44 },
    { y: -fingLen * 0.92, rx: w * 1.02, rz: w * 0.4 },
    { y: -fingLen, rx: w * 0.72, rz: w * 0.3 },
  ], 14)
  fingers.translate(0, -palmLen + 0.004, 0.004)
  fingers.rotateX(-0.22)
  parts.push(fingers)
  const thumb = new THREE.CapsuleGeometry(w * 0.42, p.handLen * 0.34, 3, 8)
  thumb.translate(0, -p.handLen * 0.2, 0)
  thumb.rotateZ(-side * 0.95)
  thumb.rotateX(-0.3)
  thumb.translate(side * -w * 1.05, -palmLen * 0.45, w * 0.55)
  parts.push(thumb)
  const g = mergeGeoms(parts)
  g.computeVertexNormals()
  return g
}

function buildShoeGeo(p: Prop): THREE.BufferGeometry {
  // adult leather/casual shoe: longer, sleeker than the kid sneaker
  const r = p.legR3
  const toe = p.footH * 3.0
  const rings = [
    { y: -p.footH * 0.16, rx: r * 1.1, rz: 0.044, cz: -toe * 0.2 },
    { y: -p.footH * 0.44, rx: r * 1.26, rz: 0.062, cz: toe * 0.0 },
    { y: -p.footH * 0.6, rx: r * 1.42, rz: 0.078, cz: toe * 0.28 },
    { y: -p.footH * 0.68, rx: r * 1.4, rz: 0.08, cz: toe * 0.56 },
    { y: -p.footH * 0.72, rx: r * 1.2, rz: 0.066, cz: toe * 0.78 },
    { y: -p.footH * 0.74, rx: r * 0.82, rz: 0.044, cz: toe * 0.94 },
  ]
  const g = loft(rings, 18)
  g.computeVertexNormals()
  return g
}

function buildSoleGeo(p: Prop): THREE.BufferGeometry {
  const r = p.legR3
  const toe = p.footH * 3.0
  const g = new THREE.BoxGeometry(r * 3.0, 0.035, toe * 1.2, 3, 1, 4)
  g.translate(0, -p.footH + 0.018, toe * 0.36)
  return g
}

// ============================================================================
// 5. ASSEMBLY + EXPORT
// ============================================================================
function buildVariant(g: Gender): { root: THREE.Group; clips: THREE.AnimationClip[] } {
  const p = PROP[g]
  const female = g === 'female'
  const M = makeMaterials(g)
  // buildSkeleton already parents bones to each other and records world[] from
  // the rest positions, so buildSegments/buildBody can read skel.world directly.
  const skel = buildSkeleton(p)
  const segs = buildSegments(p, skel.world)
  const { skinned, rigid } = buildBody(p, M, skel, segs, female)
  // assemble() adds the root bone(s) under an Armature, binds skinned meshes, and
  // attaches the head group. rigid parts were parented to their bones in buildBody,
  // so they travel into the scene with the armature — nothing else to add.
  void rigid
  const root = assemble(skel, skinned, buildHead(p, M, female), `VoteChorCitizenPro${g[0].toUpperCase()}${g.slice(1)}`)
  const clips = buildClips(p, false, female)
  return { root, clips }
}

const t0 = Date.now()
const timer = setInterval(() => { if (Date.now() - t0 > 30000) { console.error('TIMEOUT'); process.exit(1) } }, 100)

const maleV = buildVariant('male')
const femaleV = buildVariant('female')
Promise.all([
  exportGlb(maleV.root, maleV.clips, 'public/models/votechor-citizenpro-male.glb'),
  exportGlb(femaleV.root, femaleV.clips, 'public/models/votechor-citizenpro-female.glb'),
])
  .then(() => { clearInterval(timer); console.log('DONE'); process.exit(0) })
  .catch((e) => { console.error('FAIL', e); process.exit(1) })
