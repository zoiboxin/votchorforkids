import * as THREE from "three";
import { AGE_STATS, type Appearance } from "./constants";

/* ------------------------------------------------------------------ */
/* Shared geometry / material caches — one GL program, tiny memory.    */
/* ------------------------------------------------------------------ */
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function G<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g as T;
}

/* --- cel-shaded gradient map (4 soft steps) shared by all toon mats --- */
let gradientMap: THREE.DataTexture | null = null;
function getGradient(): THREE.DataTexture {
  if (!gradientMap) {
    const steps = new Uint8Array([110, 160, 210, 255]);
    gradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

function M(color: string, opts: { basic?: boolean; transparent?: number; toon?: boolean } = {}): THREE.Material {
  const key = `${color}|${opts.basic ? 1 : 0}|${opts.transparent ?? 1}|${opts.toon ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    const transparent = opts.transparent !== undefined && opts.transparent < 1;
    const opacity = opts.transparent ?? 1;
    if (opts.basic) m = new THREE.MeshBasicMaterial({ color, transparent, opacity });
    else if (opts.toon) m = new THREE.MeshToonMaterial({ color, transparent, opacity, gradientMap: getGradient() });
    else m = new THREE.MeshLambertMaterial({ color, transparent, opacity });
    matCache.set(key, m);
  }
  return m;
}

const sphere = (r: number, w = 12, h = 10, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) =>
  G(`s${r},${w},${h},${ps},${pl},${ts},${tl}`, () => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl));
const capsule = (r: number, len: number) => G(`c${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const box = (w: number, h: number, d: number) => G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 10) => G(`y${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const cone = (r: number, h: number, seg = 8) => G(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const torus = (r: number, t: number, arc = Math.PI) => G(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 6, 14, arc));

const EYE_W = M("#ffffff", { basic: true });
const EYE_B = M("#1c1410", { basic: true });
const IRIS = M("#4a2c14", { basic: true });
const GLINT = M("#ffffff", { basic: true });
const SMILE = M("#5a2418", { basic: true });
const TONGUE = M("#ff7d92", { basic: true });
const BLUSH = M("#ff96a8", { transparent: 0.5 });
const GOLD = M("#ffd447", { basic: true });

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Blob shadow (one shared radial texture)                             */
/* ------------------------------------------------------------------ */
let shadowTex: THREE.CanvasTexture | null = null;
function getShadowTex(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(0,0,0,0.34)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}
export function blobShadow(r = 0.55): THREE.Mesh {
  const m = new THREE.Mesh(
    G("shadowPlane", () => new THREE.PlaneGeometry(1, 1)),
    new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(r * 2);
  m.position.y = 0.11;
  return m;
}

/* ------------------------------------------------------------------ */
/* Face — huge glossy cartoon eyes with iris + glint + blinking lids,  */
/* brows, button nose, ears, blush and a big happy smile.              */
/* ------------------------------------------------------------------ */
const LID_OPEN = -1.35;
const LID_CLOSED = 0.5;

function addFace(head: THREE.Group, skin: string, opts: { droopy?: boolean; scale?: number } = {}) {
  const s = opts.scale ?? 1;
  const brows: THREE.Group[] = [];
  const lids: THREE.Group[] = [];

  for (const side of [-1, 1]) {
    /* eye group so brows/lids move together if needed */
    const ex = side * 0.155 * s;
    // white of the eye — big oval
    const white = part(head, sphere(0.105 * s, 10, 8), EYE_W, ex, 0.03 * s, 0.315 * s);
    white.scale.set(1, 1.32, 0.5);
    // iris + pupil + two glints
    const iris = part(head, sphere(0.062 * s, 8, 6), IRIS, ex, 0.028 * s, 0.36 * s);
    iris.scale.set(1, 1.25, 0.45);
    part(head, sphere(0.031 * s, 6, 5), EYE_B, ex, 0.022 * s, 0.393 * s);
    part(head, sphere(0.018 * s, 6, 5), GLINT, ex + 0.022 * s, 0.062 * s, 0.402 * s);
    part(head, sphere(0.009 * s, 5, 4), GLINT, ex - 0.024 * s, -0.005 * s, 0.402 * s);

    // eyelid — skin dome pivoting at the eye centre (rotates closed to blink)
    const lid = new THREE.Group();
    lid.position.set(ex, 0.03 * s, 0.315 * s);
    const dome = new THREE.Mesh(sphere(0.115 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(skin, { toon: true }));
    dome.scale.set(1.02, 1.34, 0.62);
    lid.add(dome);
    lid.rotation.x = opts.droopy ? -0.35 : LID_OPEN;
    head.add(lid);
    lids.push(lid);

    // brow — chunky rounded capsule
    const brow = new THREE.Group();
    brow.position.set(ex, 0.235 * s, 0.325 * s);
    const b = part(brow, capsule(0.021 * s, 0.085 * s), M(opts.droopy ? "#2a3218" : "#241a12", { toon: true }));
    b.rotation.z = Math.PI / 2;
    brow.rotation.z = side * -0.08;
    head.add(brow);
    brows.push(brow);

    // blush
    const bl = part(head, sphere(0.052 * s, 8, 6), BLUSH, side * 0.25 * s, -0.12 * s, 0.285 * s);
    bl.scale.set(1.35, 0.85, 0.45);
  }

  // button nose
  part(head, sphere(0.045 * s, 8, 6), M(skin, { toon: true }), 0, -0.045 * s, 0.395 * s).scale.set(1.1, 0.9, 0.9);

  // big open smile — arc + tiny tongue
  const smile = new THREE.Mesh(torus(0.095 * s, 0.023 * s, Math.PI), SMILE);
  smile.position.set(0, -0.145 * s, 0.36 * s);
  smile.rotation.set(0.12, 0, Math.PI);
  head.add(smile);
  const tongue = part(head, sphere(0.038 * s, 8, 6), TONGUE, 0, -0.175 * s, 0.375 * s);
  tongue.scale.set(1.1, 0.55, 0.6);

  // ears
  for (const side of [-1, 1]) {
    const ear = part(head, sphere(0.085 * s, 8, 6), M(skin, { toon: true }), side * 0.385 * s, 0.01 * s, -0.02 * s);
    ear.scale.set(0.42, 0.85, 0.72);
  }

  return { brows, lids, smile };
}

/* ------------------------------------------------------------------ */
/* Character builder — chibi cartoon style with toon shading           */
/* ------------------------------------------------------------------ */
export interface CharRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
  carried: THREE.Group;
  brows: THREE.Group[];
  lids: THREE.Group[];
}

export function buildCharacter(a: Appearance, opts: { police?: boolean; zombie?: boolean; mustache?: boolean } = {}): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const police = !!opts.police, zombie = !!opts.zombie;
  const shirt = police ? "#2e4f9e" : zombie ? "#77874f" : a.shirt;
  const pants = police ? "#1c2a4e" : zombie ? "#49513c" : a.pants;
  const skin = zombie ? "#93c06f" : a.skin;
  const hairCol = zombie ? "#3d4d2a" : a.age === "old" ? "#dcdcdc" : a.hair;

  /* torso — rounded capsule with toon shading */
  part(body, capsule(0.28, 0.42), M(shirt, { toon: true }), 0, 1.2, 0);
  // shorts / trousers hip
  part(body, cyl(0.3, 0.31, 0.2, 12), M(pants, { toon: true }), 0, 0.84, 0);

  if (police) {
    // badge + belt + epaulettes
    part(body, cyl(0.055, 0.055, 0.02), GOLD, 0.16, 1.34, 0.26).rotation.x = Math.PI / 2;
    part(body, cyl(0.315, 0.315, 0.09, 12), M("#161e38", { toon: true }), 0, 1.02, 0);
    part(body, box(0.11, 0.07, 0.04), GOLD, 0, 1.02, 0.31);
    for (const sd of [-1, 1]) part(body, box(0.16, 0.05, 0.24), M("#1c2a4e", { toon: true }), sd * 0.26, 1.5, 0);
  } else if (!zombie) {
    // playful stripe across the shirt for kids' charm
    part(body, cyl(0.292, 0.3, 0.07, 12), M("#ffffff", { toon: true, transparent: 0.85 }), 0, 1.28, 0);
  }
  if (zombie) {
    // patchy shirt patches
    part(body, box(0.16, 0.14, 0.02), M("#5a6840", { toon: true }), 0.15, 1.22, 0.27);
    part(body, box(0.13, 0.1, 0.02), M("#5a6840", { toon: true }), -0.18, 1.05, 0.27);
  }

  /* head — the big expressive chibi head */
  const head = new THREE.Group();
  head.position.set(0, 1.84, 0);
  body.add(head);
  const skull = part(head, sphere(0.4, 16, 13), M(skin, { toon: true }), 0, 0, 0);
  skull.scale.set(1, 0.95, 0.94);
  const face = addFace(head, skin, { droopy: zombie, scale: 1.05 });

  if (zombie) {
    // lolling tongue + underbite tooth
    const tg = part(head, sphere(0.05, 8, 6), TONGUE, 0.03, -0.24, 0.37);
    tg.scale.set(0.8, 0.5, 1.3);
    part(head, box(0.06, 0.05, 0.03), M("#f8f4e8", { basic: true }), -0.07, -0.2, 0.38);
  }
  if (opts.mustache && !zombie) {
    const mu = part(head, capsule(0.024, 0.1), M(a.age === "old" ? "#dcdcdc" : "#241a12", { toon: true }), 0, -0.1, 0.38);
    mu.rotation.z = Math.PI / 2;
  }

  /* hair — expressive styles */
  const style = a.hairStyle;
  if (style !== "bald" && !police) {
    if (style === "mohawk") {
      for (let i = 0; i < 5; i++) {
        const z = 0.26 - i * 0.13;
        const spk = part(head, cone(0.075, 0.26 - Math.abs(i - 2) * 0.05, 6), M(hairCol, { toon: true }), 0, 0.4 - Math.abs(i - 2) * 0.012, z);
        spk.rotation.x = (2 - i) * 0.14;
      }
      part(head, sphere(0.41, 12, 9, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.36), M(hairCol, { toon: true }), 0, 0.01, 0);
    } else if (style === "curly") {
      const r = 0.145;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const bob = part(head, sphere(i % 2 ? 0.16 : 0.13, 8, 6), M(hairCol, { toon: true }), Math.cos(a) * 0.24, 0.3 + (i % 3) * 0.05, Math.sin(a) * 0.24 - 0.04);
        bob.scale.setScalar(1);
      }
      part(head, sphere(0.17, 8, 6), M(hairCol, { toon: true }), 0, 0.42, -0.05);
    } else {
      // base cap for spiky / bowl / ponytail / twintails
      const domeTheta = style === "bowl" ? Math.PI * 0.62 : Math.PI * 0.5;
      const hair = part(head, sphere(0.425, 14, 10, 0, Math.PI * 2, 0, domeTheta), M(hairCol, { toon: true }), 0, 0.015, style === "bowl" ? 0.03 : 0);
      hair.scale.set(1.04, style === "bowl" ? 1.02 : 1.08, 1.04);
      if (style === "spiky") {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.35;
          const spk = part(head, cone(0.085, 0.24, 6), M(hairCol, { toon: true }), Math.cos(a) * 0.19, 0.4, Math.sin(a) * 0.19 - 0.04);
          spk.rotation.set(Math.sin(i * 1.3) * 0.35, 0, Math.cos(i * 1.7) * 0.35);
        }
      }
      if (style === "bowl") {
        // straight fringe across the forehead
        for (let i = -2; i <= 2; i++)
          part(head, sphere(0.062, 7, 5), M(hairCol, { toon: true }), i * 0.105, 0.21, 0.37);
      }
      if (style === "ponytail") {
        part(head, sphere(0.11, 8, 6), M(hairCol, { toon: true }), 0, 0.05, -0.42);
        part(head, sphere(0.085, 8, 6), M(hairCol, { toon: true }), 0, -0.16, -0.46);
        part(head, sphere(0.06, 8, 6), M(hairCol, { toon: true }), 0, -0.32, -0.42);
        if (a.girl) part(head, sphere(0.055, 7, 5), M("#ff5a7a", { basic: true }), 0.1, 0.12, -0.4);
      }
      if (style === "twintails") {
        for (const sd of [-1, 1]) {
          const tail = new THREE.Group();
          tail.position.set(sd * 0.4, 0.16, -0.12);
          tail.rotation.z = sd * 0.5;
          part(tail, sphere(0.1, 8, 6), M(hairCol, { toon: true }), 0, 0, 0);
          part(tail, sphere(0.08, 8, 6), M(hairCol, { toon: true }), 0, -0.15, -0.02);
          part(tail, sphere(0.06, 8, 6), M(hairCol, { toon: true }), 0, -0.28, 0.0);
          head.add(tail);
          part(head, sphere(0.05, 7, 5), M("#ff5a7a", { basic: true }), sd * 0.38, 0.28, -0.1);
        }
      }
    }
  }

  /* cap — police cap with badge or casual cap */
  if (police || (a.cap && !zombie)) {
    const capCol = police ? "#1c2a4e" : a.shirt;
    part(head, sphere(0.415, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2.35), M(capCol, { toon: true }), 0, 0.13, 0);
    const brim = part(head, cyl(0.2, 0.28, 0.045, 12), M(police ? "#10182e" : capCol, { toon: true }), 0, 0.24, 0.32);
    brim.rotation.x = -0.32;
    if (police) {
      part(head, cyl(0.05, 0.05, 0.025), GOLD, 0, 0.4, 0.26).rotation.x = Math.PI / 2;
      // cap band
      part(head, cyl(0.418, 0.424, 0.08, 14), M("#10182e", { toon: true }), 0, 0.15, 0);
    }
  }

  // elders get round glasses
  if (a.age === "old" && style !== "bald" && !police && !zombie) {
    for (const sd of [-1, 1]) part(head, torus(0.082, 0.014, Math.PI * 2), M("#333333", { basic: true }), sd * 0.155, 0.03, 0.385);
    part(head, box(0.1, 0.014, 0.014), M("#333333", { basic: true }), 0, 0.03, 0.385);
  }

  /* arms — sleeve + mitten hand, pivot at the shoulder */
  const arms: THREE.Group[] = [];
  for (const sd of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sd * 0.37, 1.44, 0);
    part(arm, capsule(0.098, 0.3), M(shirt, { toon: true }), 0, -0.18, 0);
    part(arm, sphere(0.105, 9, 7), M(skin, { toon: true }), 0, -0.44, 0);
    body.add(arm);
    arms.push(arm);
  }

  /* legs — pants + chunky sneaker, pivot at the hip */
  const legs: THREE.Group[] = [];
  for (const sd of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sd * 0.15, 0.86, 0);
    part(leg, capsule(0.115, 0.42), M(pants, { toon: true }), 0, -0.28, 0);
    const shoe = part(leg, sphere(0.145, 9, 7), M(zombie ? "#3a3a2a" : a.shoe, { toon: true }), 0, -0.66, 0.06);
    shoe.scale.set(1, 0.7, 1.45);
    // white toe cap
    part(leg, sphere(0.1, 8, 6), M("#f8f4e8", { toon: true }), 0, -0.68, 0.19).scale.set(0.9, 0.5, 0.7);
    body.add(leg);
    legs.push(leg);
  }

  root.add(blobShadow(0.64));

  root.scale.setScalar(AGE_STATS[a.age].scale);
  const rig: CharRig = { root, body, head, legs, arms, carried: new THREE.Group(), brows: face.brows, lids: face.lids };
  root.userData.rig = rig;
  root.userData.look = { ...a };
  root.userData.blink = { next: 1.5 + Math.random() * 3, t: -1, amt: 0 };
  if (zombie) head.rotation.z = 0.16;
  return root;
}

export const rigOf = (g: THREE.Object3D): CharRig => g.userData.rig as CharRig;

/* ------------------------------------------------------------------ */
/* Posing — walk / run / jump / idle / sit + auto-blink & expressions  */
/* ------------------------------------------------------------------ */
export interface PoseOpts { phase?: number; airborne?: boolean; detained?: boolean; zombie?: boolean }

function updateBlink(g: THREE.Object3D, rig: CharRig, t: number) {
  const st = g.userData.blink as { next: number; t: number; amt: number } | undefined;
  if (!st || rig.lids.length < 2) return;
  if (st.t < 0) st.t = t; // first frame sync
  if (t >= st.next) { st.t = t; st.next = t + 1.6 + Math.random() * 3.4; }
  const p = (t - st.t) / 0.16; // 160 ms blink
  st.amt = p >= 1 ? 0 : Math.sin(Math.min(1, p) * Math.PI);
  const rot = LID_OPEN + (LID_CLOSED - LID_OPEN) * st.amt;
  rig.lids[0].rotation.x = rot;
  rig.lids[1].rotation.x = rot;
}

export function poseCharacter(g: THREE.Object3D, speed: number, t: number, o: PoseOpts = {}) {
  const rig = rigOf(g);
  if (!rig) return;
  const { legs, arms, body, head } = rig;
  const phase = o.phase ?? 0;

  updateBlink(g, rig, t);

  /* brows: sad when detained, raised while running, calm otherwise */
  if (rig.brows.length === 2) {
    const sad = o.detained ? 0.3 : 0;
    rig.brows[0].rotation.z = -0.08 + sad;
    rig.brows[1].rotation.z = 0.08 - sad;
    const lift = o.detained ? -0.02 : Math.min(0.03, speed * 0.004);
    rig.brows[0].position.y = 0.235 + lift;
    rig.brows[1].position.y = 0.235 + lift;
  }

  if (o.detained) { // sit down, look sad, sniff
    body.position.y = -0.34 + Math.sin(t * 2.2 + phase) * 0.015;
    body.rotation.x = 0.12;
    legs[0].rotation.x = legs[1].rotation.x = -1.4;
    arms[0].rotation.x = arms[1].rotation.x = 0.3;
    arms[0].rotation.z = 0.15; arms[1].rotation.z = -0.15;
    head.rotation.x = 0.32;
    body.scale.y = 1;
    return;
  }

  head.rotation.x = 0;
  body.rotation.x = 0;
  body.rotation.z = 0;

  if (o.airborne) { // flying leap — arms up, legs tucked, joyful
    legs[0].rotation.x = -0.75; legs[1].rotation.x = 0.45;
    arms[0].rotation.x = -2.5; arms[1].rotation.x = -2.5;
    arms[0].rotation.z = 0.25; arms[1].rotation.z = -0.25;
    body.rotation.x = -0.1;
    body.position.y = 0;
    body.scale.y = 1.06; body.scale.x = body.scale.z = 0.97;
    return;
  }

  const sp = Math.min(1.6, speed / 4.5);
  if (sp < 0.06) { // idle — breathe, sway, look around
    const b = Math.sin(t * 2 + phase);
    body.position.y = b * 0.02;
    body.scale.y = 1 + b * 0.014;
    body.scale.x = body.scale.z = 1;
    legs[0].rotation.x = legs[1].rotation.x = 0;
    arms[0].rotation.x = b * 0.07; arms[1].rotation.x = -b * 0.07;
    arms[0].rotation.z = 0.07; arms[1].rotation.z = -0.07;
    head.rotation.y = Math.sin(t * 0.6 + phase) * 0.16;
    head.rotation.z = Math.sin(t * 0.9 + phase) * 0.03;
    return;
  }

  /* walk / run cycle */
  const sprinting = speed > 6.9;
  const freq = t * (5.4 + speed * 1.45) + phase;
  const k = Math.sin(freq) * sp * 0.98;
  legs[0].rotation.x = k;
  legs[1].rotation.x = -k;
  arms[0].rotation.x = -k * 0.9;
  arms[1].rotation.x = k * 0.9;
  arms[0].rotation.z = 0.12;
  arms[1].rotation.z = -0.12;
  const bounce = Math.abs(Math.cos(freq));
  body.position.y = bounce * 0.06 * sp;
  body.scale.y = 1 - bounce * 0.035 * sp; // squash each landing step
  body.scale.x = body.scale.z = 1 + bounce * 0.02 * sp;
  body.rotation.x = Math.min(0.3, sp * 0.13) + (sprinting ? 0.1 : 0);
  head.rotation.x = -0.05 * sp - (sprinting ? 0.08 : 0);
  head.rotation.z = Math.sin(freq) * 0.035 * sp;
  head.rotation.y = 0;

  if (o.zombie) { // classic shamble
    arms[0].rotation.x = -1.4 + Math.sin(t * 3 + phase) * 0.14;
    arms[1].rotation.x = -1.4 + Math.sin(t * 3 + phase + 1) * 0.14;
    arms[0].rotation.z = 0.1; arms[1].rotation.z = -0.1;
    body.rotation.z = Math.sin(t * 2.4 + phase) * 0.07;
    head.rotation.x = 0.12;
  }
}

/* ------------------------------------------------------------------ */
/* Animals — cute cartoon quadrupeds with bigger glossy eyes           */
/* ------------------------------------------------------------------ */
export type AnimalKind3 = "cow" | "chicken" | "deer" | "monkey";

export function buildAnimal(kind: AnimalKind3): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rig: { legs: THREE.Group[]; head: THREE.Group; body: THREE.Group } = { legs: [], head: new THREE.Group(), body };

  const conf = {
    cow: { c: "#f7f2e8", s: 1.5, headY: 0.95, headZ: 0.85, spots: true },
    chicken: { c: "#fff3d6", s: 0.55, headY: 0.5, headZ: 0.4, spots: false },
    deer: { c: "#c98a4b", s: 1.1, headY: 1.0, headZ: 0.8, spots: false },
    monkey: { c: "#8a5a3a", s: 0.7, headY: 0.75, headZ: 0.55, spots: false },
  }[kind];
  const dark = kind === "cow" ? "#3a3a3a" : kind === "deer" ? "#8a5a2b" : "#6a4426";
  const belly = kind === "cow" ? "#f7f2e8" : "#e8d5b0";

  part(body, sphere(0.5, 10, 8), M(conf.c, { toon: true }), 0, 0.62, 0).scale.set(0.85, 0.75, 1.15);
  part(body, sphere(0.36, 10, 8), M(belly, { toon: true }), 0, 0.48, 0.12).scale.set(0.7, 0.55, 0.9);

  const head = new THREE.Group();
  head.position.set(0, conf.headY, conf.headZ);
  body.add(head);
  part(head, sphere(0.3, 12, 9), M(conf.c, { toon: true }), 0, 0, 0).scale.set(0.95, 0.9, 1);
  // muzzle
  part(head, sphere(0.16, 8, 6), M(kind === "cow" ? "#ffc0cb" : belly, { toon: true }), 0, -0.08, 0.24).scale.set(1, 0.75, 0.8);
  // big cartoon eyes with glints
  for (const s of [-1, 1]) {
    const e = part(head, sphere(0.082, 8, 6), EYE_W, s * 0.14, 0.1, 0.22);
    e.scale.set(1, 1.25, 0.55);
    part(head, sphere(0.04, 6, 5), EYE_B, s * 0.145, 0.105, 0.272);
    part(head, sphere(0.014, 5, 4), GLINT, s * 0.16, 0.135, 0.288);
  }
  // ears / horns
  if (kind === "cow") {
    part(head, cone(0.06, 0.14, 6), M("#e8e0d0", { toon: true }), -0.2, 0.24, 0).rotation.z = 0.6;
    part(head, cone(0.06, 0.14, 6), M("#e8e0d0", { toon: true }), 0.2, 0.24, 0).rotation.z = -0.6;
  }
  if (kind === "deer") {
    part(head, cone(0.04, 0.3, 5), M("#8a5a2b", { toon: true }), -0.12, 0.4, 0).rotation.z = 0.25;
    part(head, cone(0.04, 0.3, 5), M("#8a5a2b", { toon: true }), 0.12, 0.4, 0).rotation.z = -0.25;
  }
  for (const s of [-1, 1]) part(head, sphere(0.07, 6, 5), M(dark, { toon: true }), s * 0.28, 0.02, -0.02).scale.set(0.5, 0.9, 0.6);

  for (const [x, z] of [[-0.24, 0.34], [0.24, 0.34], [-0.24, -0.34], [0.24, -0.34]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.5, z);
    part(leg, capsule(0.075, 0.3), M(dark, { toon: true }), 0, -0.2, 0);
    body.add(leg);
    rig.legs.push(leg);
  }
  if (kind === "chicken") {
    part(body, sphere(0.1, 8, 6), M("#e8443a", { toon: true }), 0, 0.95, 0.05); // comb
    part(head, cone(0.05, 0.18, 5), M("#ffb347", { toon: true }), 0, -0.04, 0.4).rotation.x = Math.PI / 2;
  }
  if (kind === "monkey") {
    part(head, sphere(0.18, 8, 6), M("#d8b088", { toon: true }), 0, 0, 0.18).scale.set(0.8, 0.8, 0.6);
    // curly tail
    part(body, sphere(0.07, 6, 5), M("#8a5a3a", { toon: true }), 0, 0.72, -0.5);
    part(body, sphere(0.06, 6, 5), M("#8a5a3a", { toon: true }), 0, 0.86, -0.56);
    part(body, sphere(0.05, 6, 5), M("#8a5a3a", { toon: true }), 0, 0.96, -0.5);
  }
  if (conf.spots) {
    for (let i = 0; i < 4; i++)
      part(body, sphere(0.13, 7, 5), M("#3a3a3a", { toon: true }), Math.cos(i * 2.2) * 0.3, 0.75 + (i % 2) * 0.1, Math.sin(i * 2.2) * 0.4).scale.set(1, 0.5, 1);
  }
  root.scale.setScalar(conf.s);
  root.add(blobShadow(0.7 * conf.s));
  root.userData.rig = rig;
  return root;
}

export function poseAnimal(g: THREE.Object3D, speed: number, t: number, phase = 0) {
  const rig = g.userData.rig as { legs: THREE.Group[]; head: THREE.Group; body: THREE.Group } | undefined;
  if (!rig) return;
  const sp = Math.min(1.4, speed / 3.5);
  const k = Math.sin(t * (6 + speed * 2) + phase) * sp * 0.7;
  rig.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? k : -k) * (i < 2 ? 1 : -1); });
  rig.body.position.y = Math.abs(Math.cos(t * (6 + speed * 2) + phase)) * 0.04 * sp;
  rig.head.rotation.x = Math.sin(t * 1.5 + phase) * 0.08;
  rig.head.rotation.z = Math.sin(t * 0.9 + phase) * 0.05;
}

/* ------------------------------------------------------------------ */
/* Props: vote token, food pickup, ballot box, help bubble, name tag   */
/* ------------------------------------------------------------------ */
export function buildVoteToken(): THREE.Group {
  const g = new THREE.Group();
  part(g, box(0.5, 0.34, 0.06), GOLD);
  const flap = part(g, cone(0.25, 0.2, 4), M("#e8b028", { basic: true }), 0, 0.06, 0);
  flap.rotation.x = Math.PI;
  flap.scale.set(1, 1, 0.18);
  part(g, box(0.2, 0.2, 0.07), M("#ffffff", { basic: true }), 0, -0.03, 0.01);
  const star = part(g, cone(0.08, 0.16, 5), M("#e0483a", { basic: true }), 0, 0.12, 0.05);
  star.rotation.x = Math.PI / 2;
  return g;
}

export function buildFood(kind: string, color: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === "fruit") {
    part(g, sphere(0.26, 10, 8), M(color, { toon: true })).scale.set(1, 0.9, 1);
    part(g, cyl(0.03, 0.04, 0.12, 6), M("#4a7a2a", { toon: true }), 0, 0.28, 0);
    part(g, sphere(0.03, 5, 4), GLINT, -0.09, 0.12, 0.14);
  } else if (kind === "kit") {
    part(g, box(0.42, 0.28, 0.2), M("#ffffff", { basic: true }));
    part(g, box(0.12, 0.04, 0.21), M("#e0483a", { basic: true }));
    part(g, box(0.04, 0.14, 0.21), M("#e0483a", { basic: true }));
  } else {
    part(g, cyl(0.14, 0.1, 0.3, 10), M(color, { toon: true }));
    part(g, cyl(0.1, 0.1, 0.03, 10), M("#e8d5b0", { basic: true }), 0, 0.16, 0);
  }
  return g;
}

export function buildBallotBox(): THREE.Group {
  const g = new THREE.Group();
  part(g, box(1.5, 1.1, 1.0), M("#f8f4e8", { transparent: 0.92 }));
  part(g, box(0.7, 0.08, 0.1), M("#333333", { basic: true }), 0, 0.35, 0.5);
  const glow = new THREE.Mesh(
    G("ballotGlow", () => new THREE.CylinderGeometry(1.05, 1.05, 0.03, 24)),
    new THREE.MeshBasicMaterial({ color: "#f7c948", transparent: true, opacity: 0.4 }),
  );
  glow.position.y = -0.53;
  g.add(glow);
  return g;
}

let bubbleTex: THREE.CanvasTexture | null = null;
export function helpBubble(): THREE.Sprite {
  if (!bubbleTex) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e0483a";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 58, 44, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(52, 96); ctx.lineTo(64, 122); ctx.lineTo(76, 96);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.fillStyle = "#e0483a";
    ctx.font = "bold 64px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("!", 64, 60);
    bubbleTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false }));
  s.scale.set(0.9, 0.9, 1);
  return s;
}

const tagCache = new Map<string, THREE.CanvasTexture>();
export function nameTag(text: string, bg = "rgba(20,24,40,0.72)"): THREE.Sprite {
  let tex = tagCache.get(text);
  if (!tex) {
    const c = document.createElement("canvas");
    const ctx0 = c.getContext("2d")!;
    ctx0.font = "bold 44px system-ui, sans-serif";
    const w = Math.ceil(ctx0.measureText(text).width) + 36;
    c.width = w; c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = bg;
    const r = 18;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, 60, r);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, 34);
    tex = new THREE.CanvasTexture(c);
    tagCache.set(text, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set((tex.image.width / 64) * 0.5, 0.5, 1);
  return s;
}
