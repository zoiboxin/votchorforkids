import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AGE_STATS, ITEMS, POLICE_UNIFORM, policeOutfitOf, type Appearance } from "./constants";

/* ------------------------------------------------------------------ */
/* Shared caches + merged-geometry "buckets"                           */
/*                                                                     */
/* Every character is assembled from primitives, but all static parts  */
/* of an animated group are BAKED into a single merged geometry with   */
/* vertex colours — one draw call per group instead of 15+.            */
/* ------------------------------------------------------------------ */
const geoCache = new Map<string, THREE.BufferGeometry>();

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

let TOON_VC: THREE.MeshToonMaterial | null = null;
let BASIC_VC: THREE.MeshBasicMaterial | null = null;
function toonVC(): THREE.MeshToonMaterial {
  if (!TOON_VC) TOON_VC = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradient() });
  return TOON_VC;
}
function basicVC(): THREE.MeshBasicMaterial {
  if (!BASIC_VC) BASIC_VC = new THREE.MeshBasicMaterial({ vertexColors: true });
  return BASIC_VC;
}

const sphere = (r: number, w = 12, h = 10, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) =>
  G(`s${r},${w},${h},${ps},${pl},${ts},${tl}`, () => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl));
const capsule = (r: number, len: number) => G(`c${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const box = (w: number, h: number, d: number) => G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 10) => G(`y${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const cone = (r: number, h: number, seg = 8) => G(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const torus = (r: number, t: number, arc = Math.PI) => G(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 6, 14, arc));

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Collects primitives and merges them into one vertex-coloured mesh. */
class Bucket {
  parts: THREE.BufferGeometry[] = [];
  add(
    geo: THREE.BufferGeometry, color: string, unlit: boolean,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1,
  ) {
    const g = geo.clone();
    _m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m4);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") g.deleteAttribute(k);
    this.parts.push(g);
  }
  mesh(kind: "toon" | "basic"): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!merged) return null;
    merged.clearGroups();
    const mesh = new THREE.Mesh(merged, kind === "toon" ? toonVC() : basicVC());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}

/* face palette (shared across characters — used with vertex colours) */
const EYE_B = "#1c1410";
const IRIS = "#4a2c14";
const GLINT = "#ffffff";
const SMILE = "#5a2418";
const TONGUE = "#ff7d92";
const GOLD = "#ffd447";

/** Darkened hex variant for cuffs/collars so outfits read layered. */
const shade = (hex: string, f: number) => `#${new THREE.Color(hex).multiplyScalar(f).getHexString()}`;

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
/* Face — huge glossy eyes, blinking lids, brows, ears, smile.         */
/* Static pieces go into the buckets; only lids/brows stay separate.   */
/* ------------------------------------------------------------------ */
const LID_OPEN = -1.35;
const LID_CLOSED = 0.5;
const lidGeo = () => sphere(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);

function addFace(
  head: THREE.Group, skin: string, toon: Bucket, unlit: Bucket,
  lids: THREE.Group[], brows: THREE.Group[], opts: { droopy?: boolean; scale?: number; freckles?: boolean },
) {
  const s = opts.scale ?? 1;

  for (const side of [-1, 1]) {
    const ex = side * 0.155 * s;
    // white of the eye + iris + pupil + glints (unlit so they always pop)
    unlit.add(sphere(0.105 * s, 10, 8), "#ffffff", true, ex, 0.03 * s, 0.315 * s, 0, 0, 0, 1, 1.32, 0.5);
    unlit.add(sphere(0.062 * s, 8, 6), IRIS, true, ex, 0.028 * s, 0.36 * s, 0, 0, 0, 1, 1.25, 0.45);
    unlit.add(sphere(0.031 * s, 6, 5), EYE_B, true, ex, 0.022 * s, 0.393 * s);
    unlit.add(sphere(0.018 * s, 6, 5), GLINT, true, ex + 0.022 * s, 0.062 * s, 0.402 * s);
    unlit.add(sphere(0.009 * s, 5, 4), GLINT, true, ex - 0.024 * s, -0.005 * s, 0.402 * s);

    // eyelid — animated dome that blinks
    const lid = new THREE.Group();
    lid.position.set(ex, 0.03 * s, 0.315 * s);
    const dome = new THREE.Mesh(lidGeo(), new THREE.MeshToonMaterial({ color: skin, gradientMap: getGradient() }));
    dome.scale.set(1.02, 1.34, 0.62);
    lid.add(dome);
    lid.rotation.x = opts.droopy ? -0.35 : LID_OPEN;
    head.add(lid);
    lids.push(lid);

    // brow — chunky capsule, sits proud of the hairline
    const brow = new THREE.Group();
    brow.position.set(ex, 0.19 * s, 0.385 * s);
    const bGeo = capsule(0.024 * s, 0.09 * s).clone();
    bGeo.rotateZ(Math.PI / 2);
    const bm = new THREE.Mesh(bGeo, new THREE.MeshToonMaterial({ color: opts.droopy ? "#2a3218" : "#241a12", gradientMap: getGradient() }));
    brow.add(bm);
    brow.rotation.z = side * -0.08;
    head.add(brow);
    brows.push(brow);

    // solid blush dot — soft rosy cheeks
    toon.add(sphere(0.055 * s, 8, 6), "#ff9fb2", false, side * 0.25 * s, -0.12 * s, 0.285 * s, 0, 0, 0, 1.5, 0.95, 0.5);
  }

  // button nose
  toon.add(sphere(0.045 * s, 8, 6), skin, false, 0, -0.045 * s, 0.395 * s, 0, 0, 0, 1.1, 0.9, 0.9);

  // kid freckles — three tiny dots per cheek
  if (opts.freckles)
    for (const side of [-1, 1])
      for (let i = 0; i < 3; i++)
        unlit.add(sphere(0.011 * s, 5, 4), "#c08552", true, side * (0.2 + (i % 2) * 0.07) * s, (-0.075 - Math.floor(i / 2) * 0.035) * s, 0.315 * s);

  // big open smile — arc + tiny tongue (unlit, always readable)
  const smileGeo = torus(0.095 * s, 0.023 * s, Math.PI).clone();
  smileGeo.rotateX(0.12);
  smileGeo.rotateZ(Math.PI);
  unlit.add(smileGeo, SMILE, true, 0, -0.145 * s, 0.36 * s);
  unlit.add(sphere(0.038 * s, 8, 6), TONGUE, true, 0, -0.175 * s, 0.375 * s, 0, 0, 0, 1.1, 0.55, 0.6);

  // ears
  for (const side of [-1, 1])
    toon.add(sphere(0.085 * s, 8, 6), skin, false, side * 0.385 * s, 0.01 * s, -0.02 * s, 0, 0, 0, 0.42, 0.85, 0.72);
}

/* ------------------------------------------------------------------ */
/* Character builder — chibi toon style, ~13 draw calls each           */
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

export function buildCharacter(a: Appearance, opts: { police?: boolean; zombie?: boolean; /** contest zombies keep their identity shirt — you recognize WHO turned */ keepShirt?: boolean; mustache?: boolean; shadow?: boolean } = {}): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const police = !!opts.police, zombie = !!opts.zombie;
  /* ---------- police squad outfit (hero page) ----------
     city = classic peaked cap · traffic = white + hi-viz band · commando = helmet + plate
     army = beret + bandolier · riot = helmet + visor + big pads · detective = hair + glasses */
  const outfit = police ? policeOutfitOf(a.outfit).id : "";
  const isTraffic = outfit === "traffic", isCommando = outfit === "commando";
  const isArmy = outfit === "army", isRiot = outfit === "riot", isDetective = outfit === "detective";
  const shirt = police ? (a.shirt || POLICE_UNIFORM.shirt) : zombie ? (opts.keepShirt ? a.shirt : "#77874f") : a.shirt;
  const pants = police ? (a.pants || POLICE_UNIFORM.pants) : zombie ? "#49513c" : a.pants;
  const skin = zombie ? "#93c06f" : a.skin;
  const hairCol = zombie ? "#3d4d2a" : a.age === "old" ? "#dcdcdc" : a.hair;
  const style = a.hairStyle;

  const bodyToon = new Bucket(), bodyUnlit = new Bucket();
  const headToon = new Bucket(), headUnlit = new Bucket();
  const armB: Bucket[] = [new Bucket(), new Bucket()];
  const legB: Bucket[] = [new Bucket(), new Bucket()];
  const civvie = !police && !zombie;

  /* torso */
  bodyToon.add(capsule(0.28, 0.42), shirt, false, 0, 1.2, 0);
  bodyToon.add(cyl(0.3, 0.31, 0.2, 12), pants, false, 0, 0.84, 0);
  if (police) {
    // duty belt — every squad wears one
    bodyToon.add(cyl(0.315, 0.315, 0.09, 12), shade(pants, 0.72), false, 0, 1.02, 0);
    if (isCommando || isRiot) {
      // tactical vest / plate carrier with chunky shoulder pads
      bodyToon.add(box(0.52, 0.42, 0.5), isRiot ? "#2a313a" : "#14161c", false, 0, 1.22, 0);
      bodyUnlit.add(box(0.16, 0.12, 0.03), isRiot ? "#8fb6c9" : "#3a4150", true, 0, 1.32, 0.27);
      for (const sd of [-1, 1]) bodyToon.add(box(0.24, 0.1, 0.3), isRiot ? "#22272e" : "#101216", false, sd * 0.3, 1.5, 0);
    } else {
      // shiny gold badge + shoulder straps
      bodyUnlit.add(cyl(0.055, 0.055, 0.02), GOLD, true, 0.16, 1.34, 0.26, Math.PI / 2);
      for (const sd of [-1, 1]) bodyToon.add(box(0.16, 0.05, 0.24), shade(pants, 0.9), false, sd * 0.26, 1.5, 0);
      if (isTraffic) {
        // glowing hi-viz band over the white uniform shirt
        bodyToon.add(cyl(0.325, 0.325, 0.08, 12), "#ffd23f", false, 0, 1.14, 0);
        bodyToon.add(cyl(0.329, 0.329, 0.032, 12), "#e8e8e8", false, 0, 1.22, 0);
      } else if (isArmy) {
        // diagonal bandolier across the chest
        bodyToon.add(box(0.09, 0.6, 0.05), "#3a4429", false, 0.05, 1.28, 0.25, 0, 0, -0.45);
      } else if (isDetective) {
        // plainclothes trench coat — lapel collar, coat skirt, buttons
        bodyToon.add(cyl(0.292, 0.3, 0.09, 12), shade(shirt, 0.85), false, 0, 1.44, 0);
        bodyToon.add(cyl(0.305, 0.315, 0.24, 12), shade(shirt, 0.92), false, 0, 0.72, 0);
        for (const yy of [1.32, 1.18, 1.04]) bodyUnlit.add(cyl(0.026, 0.026, 0.02), "#3a3128", true, 0, yy, 0.29, Math.PI / 2);
      }
    }
  } else if (civvie) {
    bodyToon.add(cyl(0.292, 0.3, 0.07, 12), "#ffffff", false, 0, 1.28, 0);
    // raised crew-neck collar
    bodyToon.add(cyl(0.265, 0.3, 0.085, 12), "#ffffff", false, 0, 1.505, 0);
    // shirt buttons
    bodyUnlit.add(cyl(0.028, 0.028, 0.022), "#4a3520", true, 0, 1.36, 0.283, Math.PI / 2);
    bodyUnlit.add(cyl(0.028, 0.028, 0.022), "#4a3520", true, 0, 1.15, 0.286, Math.PI / 2);
    // belt + gold buckle
    bodyToon.add(cyl(0.305, 0.315, 0.09, 12), "#3a2c1e", false, 0, 0.95, 0);
    bodyUnlit.add(box(0.1, 0.075, 0.035), GOLD, true, 0, 0.95, 0.302);
  }
  if (zombie) {
    bodyToon.add(box(0.16, 0.14, 0.02), "#5a6840", false, 0.15, 1.22, 0.27);
    bodyToon.add(box(0.13, 0.1, 0.02), "#5a6840", false, -0.18, 1.05, 0.27);
  }

  /* head */
  const head = new THREE.Group();
  head.position.set(0, 1.84, 0);
  body.add(head);
  headToon.add(sphere(0.4, 16, 13), skin, false, 0, 0, 0, 0, 0, 0, 1, 0.95, 0.94);
  const lids: THREE.Group[] = [], brows: THREE.Group[] = [];
  addFace(head, skin, headToon, headUnlit, lids, brows, { droopy: zombie, scale: 1.05, freckles: civvie && a.age === "kid" });

  if (zombie) {
    headUnlit.add(sphere(0.05, 8, 6), TONGUE, true, 0.03, -0.24, 0.37, 0, 0, 0, 0.8, 0.5, 1.3);
    headUnlit.add(box(0.06, 0.05, 0.03), "#f8f4e8", true, -0.07, -0.2, 0.38);
  }
  if (opts.mustache && !zombie) {
    headToon.add(capsule(0.024, 0.1), a.age === "old" ? "#dcdcdc" : "#241a12", false, 0, -0.1, 0.38, 0, 0, Math.PI / 2);
  }

  /* hair — hidden under the uniform cap, but the detective's hair shows off-duty */
  if (style !== "bald" && (!police || isDetective)) {
    if (style === "mohawk") {
      for (let i = 0; i < 5; i++) {
        const z = 0.26 - i * 0.13;
        headToon.add(cone(0.075, 0.26 - Math.abs(i - 2) * 0.05, 6), hairCol, false, 0, 0.4 - Math.abs(i - 2) * 0.012, z, (2 - i) * 0.14);
      }
      headToon.add(sphere(0.41, 12, 9, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.36), hairCol, false, 0, 0.01, 0);
    } else if (style === "curly") {
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2;
        headToon.add(sphere(i % 2 ? 0.16 : 0.13, 8, 6), hairCol, false, Math.cos(ang) * 0.24, 0.3 + (i % 3) * 0.05, Math.sin(ang) * 0.24 - 0.04);
      }
      headToon.add(sphere(0.17, 8, 6), hairCol, false, 0, 0.42, -0.05);
    } else if (style === "afro") {
      // big rounded cloud with puffy lobes — reads great from any angle
      headToon.add(sphere(0.46, 12, 9), hairCol, false, 0, 0.17, -0.03, 0, 0, 0, 1.12, 0.94, 1.08);
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        headToon.add(sphere(i % 2 ? 0.16 : 0.13, 8, 6), hairCol, false,
          Math.cos(ang) * 0.3, 0.24 + (i % 3) * 0.07, Math.sin(ang) * 0.28 - 0.05);
      }
      headToon.add(sphere(0.2, 9, 7), hairCol, false, 0, 0.5, -0.06);
    } else {
      const domeTheta = style === "bowl" ? Math.PI * 0.62 : Math.PI * 0.5;
      headToon.add(sphere(0.425, 14, 10, 0, Math.PI * 2, 0, domeTheta), hairCol, false, 0, 0.015, style === "bowl" ? 0.03 : 0, 0, 0, 0, 1.04, style === "bowl" ? 1.02 : 1.08, 1.04);
      if (style === "spiky") {
        for (let i = 0; i < 6; i++) {
          const ang = i * 1.35;
          headToon.add(cone(0.085, 0.24, 6), hairCol, false, Math.cos(ang) * 0.19, 0.4, Math.sin(ang) * 0.19 - 0.04, Math.sin(i * 1.3) * 0.35, 0, Math.cos(i * 1.7) * 0.35);
        }
      }
      if (style === "bowl") {
        for (let i = -2; i <= 2; i++)
          headToon.add(sphere(0.062, 7, 5), hairCol, false, i * 0.105, 0.21, 0.37);
      }
      if (style === "ponytail") {
        headToon.add(sphere(0.11, 8, 6), hairCol, false, 0, 0.05, -0.42);
        headToon.add(sphere(0.085, 8, 6), hairCol, false, 0, -0.16, -0.46);
        headToon.add(sphere(0.06, 8, 6), hairCol, false, 0, -0.32, -0.42);
        if (a.girl) headUnlit.add(sphere(0.055, 7, 5), "#ff5a7a", true, 0.1, 0.12, -0.4);
      }
      if (style === "twintails") {
        for (const sd of [-1, 1]) {
          headToon.add(sphere(0.1, 8, 6), hairCol, false, sd * 0.47, 0.13, -0.14);
          headToon.add(sphere(0.08, 8, 6), hairCol, false, sd * 0.53, -0.01, -0.16);
          headToon.add(sphere(0.06, 8, 6), hairCol, false, sd * 0.57, -0.13, -0.13);
          headUnlit.add(sphere(0.05, 7, 5), "#ff5a7a", true, sd * 0.38, 0.28, -0.1);
        }
      }
      if (style === "bun") {
        // tidy top-knot with a little bow tie
        headToon.add(sphere(0.155, 9, 7), hairCol, false, 0, 0.5, -0.1);
        headToon.add(sphere(0.09, 8, 6), hairCol, false, 0, 0.4, -0.07);
        headUnlit.add(sphere(0.045, 7, 5), "#ff5a7a", true, 0, 0.4, -0.02);
      }
      // long back-hair for girls — a soft lobe behind the head
      if (a.girl)
        headToon.add(sphere(0.42, 12, 9), hairCol, false, 0, -0.02, -0.07, 0, 0, 0, 1.0, 1.04, 0.98);
    }
  }

  /* headgear — the squad identity lives here */
  if (police && isDetective) {
    // detective works plainclothes: no hat, hair + glasses speak instead
  } else if (police && (isCommando || isRiot)) {
    // combat helmet — deep dome with a rim band, no brim
    headToon.add(sphere(0.44, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.75), a.capColor || "#101216", false, 0, 0.1, 0);
    headToon.add(cyl(0.446, 0.453, 0.07, 14), "#0b0d11", false, 0, 0.08, 0);
    if (isCommando) {
      // night-vision mount stub on the front
      headToon.add(box(0.12, 0.09, 0.06), "#0b0d11", false, 0, 0.32, 0.4);
    } else {
      // riot visor — a curved shield over the eyes
      headUnlit.add(box(0.52, 0.16, 0.05), "#9fc3d8", true, 0, 0.06, 0.4);
    }
  } else if (police && isArmy) {
    // beret — squashed dome tilted over one eye, little stalk on top
    headToon.add(sphere(0.43, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), a.capColor || "#3e4f30", false, 0.05, 0.17, -0.02, 0, 0, 0.32, 1.06, 0.6, 1.06);
    headUnlit.add(cyl(0.035, 0.035, 0.05), "#2c3a22", true, 0.1, 0.42, -0.02);
  } else if (police) {
    // classic peaked cap (City Police + Traffic Police) — colour follows the outfit
    const capCol = a.capColor || "#1c2a4e";
    headToon.add(sphere(0.415, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2.35), capCol, false, 0, 0.13, 0);
    headToon.add(cyl(0.2, 0.28, 0.045, 12), isTraffic ? "#333a46" : "#10182e", false, 0, 0.24, 0.32, -0.32);
    headUnlit.add(cyl(0.05, 0.05, 0.025), GOLD, true, 0, 0.4, 0.26, Math.PI / 2);
    headToon.add(cyl(0.418, 0.424, 0.08, 14), shade(capCol, 0.45), false, 0, 0.15, 0);
  } else if (a.cap && !zombie) {
    const capCol = a.capColor || a.shirt;
    headToon.add(sphere(0.415, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2.35), capCol, false, 0, 0.13, 0);
    headToon.add(cyl(0.2, 0.28, 0.045, 12), capCol, false, 0, 0.24, 0.32, -0.32);
    // little white front-panel highlight so custom cap colors pop
    headUnlit.add(sphere(0.05, 7, 5), "#ffffff", true, 0, 0.42, 0.3);
  }

  /* glasses — the detective always wears them; elders get them automatically (unless bald) */
  const wantGlasses = police ? isDetective : !zombie && (a.glasses || (a.age === "old" && style !== "bald"));
  if (wantGlasses) {
    for (const sd of [-1, 1]) {
      headUnlit.add(torus(0.082, 0.014, Math.PI * 2), "#333333", true, sd * 0.155, 0.03, 0.385);
      // faint glass lens so it reads clearly up close
      headToon.add(cyl(0.07, 0.07, 0.012, 10), "#bfe3ff", true, sd * 0.155, 0.03, 0.388, Math.PI / 2);
    }
    headUnlit.add(box(0.1, 0.014, 0.014), "#333333", true, 0, 0.03, 0.385);
  }

  /* arms — sleeve + cuff + mitten hand merged per arm */
  for (const i of [0, 1]) {
    const sd = i === 0 ? -1 : 1;
    armB[i].add(capsule(0.098, 0.3), shirt, false, 0, -0.18, 0);
    armB[i].add(cyl(0.107, 0.107, 0.05, 10), shade(shirt, 0.78), false, 0, -0.36, 0);
    armB[i].add(sphere(0.115, 9, 7), skin, false, 0, -0.45, 0, 0, 0, 0, 1, 0.96, 1);
  }
  const arms: THREE.Group[] = [];
  for (const i of [0, 1]) {
    const sd = i === 0 ? -1 : 1;
    const arm = new THREE.Group();
    arm.position.set(sd * 0.37, 1.44, 0);
    const m = armB[i].mesh("toon");
    if (m) arm.add(m);
    body.add(arm);
    arms.push(arm);
  }

  /* legs — pants + chunky sneaker (colored upper, toe cap, white sole) */
  for (const i of [0, 1]) {
    const sd = i === 0 ? -1 : 1;
    legB[i].add(capsule(0.115, 0.42), pants, false, 0, -0.28, 0);
    legB[i].add(sphere(0.15, 9, 7), zombie ? "#3a3a2a" : a.shoe, false, 0, -0.66, 0.06, 0, 0, 0, 1, 0.72, 1.45);
    legB[i].add(sphere(0.1, 8, 6), "#f8f4e8", false, 0, -0.68, 0.19, 0, 0, 0, 0.9, 0.5, 0.7);
    legB[i].add(sphere(0.15, 8, 6), "#efe9dc", false, 0, -0.735, 0.05, 0, 0, 0, 1.04, 0.34, 1.5);
  }
  const legs: THREE.Group[] = [];
  for (const i of [0, 1]) {
    const sd = i === 0 ? -1 : 1;
    const leg = new THREE.Group();
    leg.position.set(sd * 0.15, 0.86, 0);
    const m = legB[i].mesh("toon");
    if (m) leg.add(m);
    body.add(leg);
    legs.push(leg);
  }

  /* bake the merged meshes */
  const bm = bodyToon.mesh("toon"); if (bm) body.add(bm);
  const bu = bodyUnlit.mesh("basic"); if (bu) body.add(bu);
  const hm = headToon.mesh("toon"); if (hm) head.add(hm);
  const hu = headUnlit.mesh("basic"); if (hu) head.add(hu);

  root.scale.setScalar(AGE_STATS[a.age].scale);
  if (opts.shadow) root.add(blobShadow(0.64));
  const rig: CharRig = { root, body, head, legs, arms, carried: new THREE.Group(), brows, lids };
  root.userData.rig = rig;
  root.userData.look = { ...a };
  root.userData.blink = { next: 1.5 + Math.random() * 3, t: -1, amt: 0 };
  if (zombie) head.rotation.z = 0.16;
  return root;
}

export const rigOf = (g: THREE.Object3D): CharRig => g.userData.rig as CharRig;

/* ------------------------------------------------------------------ */
/* 🪓 Arms in hand — low-poly tool meshes gripped by the right arm      */
/* Built from the same merged vertex-colour buckets as the characters   */
/* so they share the cel-shaded look (and draw in one call).            */
/* ------------------------------------------------------------------ */
export type HeldToolKind = "axe" | "sword" | "hammer" | "builder";

/** A tool mesh in "grip space": the origin is where the fist closes,
 *  the handle runs UP (+Y) so the head sits above the hand at rest. */
export function buildToolMesh(kind: HeldToolKind): THREE.Group {
  const b = new Bucket();
  const wood = "#8a5a33", woodDk = "#6e4526", steel = "#b8c4d0", steelHi = "#e4ebf3";
  if (kind === "axe") {
    b.add(cyl(0.032, 0.042, 0.6, 8), wood, false, 0, 0.24, 0);
    b.add(cyl(0.045, 0.045, 0.05, 8), woodDk, false, 0, 0.03, 0); // grip wrap
    b.add(box(0.055, 0.2, 0.1), steel, false, 0, 0.58, 0.05);     // head block
    b.add(box(0.048, 0.24, 0.06), steelHi, false, 0, 0.58, 0.115); // blade edge
    b.add(box(0.05, 0.12, 0.06), steel, false, 0, 0.47, -0.01);    // neck
  } else if (kind === "sword") {
    b.add(cyl(0.03, 0.036, 0.16, 8), "#4a2f1d", false, 0, 0.02, 0);
    b.add(cyl(0.052, 0.052, 0.03, 8), GOLD, true, 0, 0.05, 0);     // pommel
    b.add(box(0.2, 0.035, 0.055), GOLD, true, 0, 0.13, 0);         // cross-guard
    b.add(box(0.06, 0.6, 0.022), steel, false, 0, 0.45, 0);        // blade
    b.add(box(0.028, 0.5, 0.03), steelHi, true, 0, 0.45, 0.008);   // fuller shine
    b.add(box(0.032, 0.09, 0.016), steelHi, false, 0, 0.79, 0, 0, 0, 0, 1, 1, 1); // tip
  } else if (kind === "hammer") {
    b.add(cyl(0.034, 0.042, 0.5, 8), wood, false, 0, 0.19, 0);
    b.add(box(0.34, 0.15, 0.15), "#6b7280", false, 0, 0.46, 0);    // mallet head
    b.add(box(0.36, 0.05, 0.16), "#9aa5b1", false, 0, 0.46, 0);    // face bands
  } else { // builder — a chunky wrench
    b.add(box(0.07, 0.44, 0.035), "#c0c8d4", false, 0, 0.16, 0);   // shaft
    b.add(cyl(0.085, 0.085, 0.04, 10), "#d5dce6", false, 0, 0.4, 0, 0, 0, Math.PI / 2); // head ring
    b.add(box(0.05, 0.09, 0.04), "#c0c8d4", false, 0, 0.465, 0.045); // open jaw
    b.add(box(0.05, 0.09, 0.04), "#c0c8d4", false, 0, 0.465, -0.045);
  }
  const g = new THREE.Group();
  const m = b.mesh("toon");
  if (m) g.add(m);
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

/** Attach a tool mesh to a character's right hand (removes the previous one).
 *  Returns the attached group or null when kind is null. */
export function setHeldTool(character: THREE.Object3D, kind: HeldToolKind | null): THREE.Group | null {
  const rig = rigOf(character);
  if (!rig) return null;
  const prev = character.userData.heldTool as THREE.Group | undefined;
  if (prev) {
    prev.removeFromParent();
    character.userData.heldTool = undefined;
  }
  if (!kind) return null;
  const tool = buildToolMesh(kind);
  tool.position.set(0, -0.5, 0.03); // in the fist
  tool.rotation.set(-0.5, 0, 0);    // head tilted forward, ready stance
  rig.arms[1].add(tool);
  character.userData.heldTool = tool;
  return tool;
}


/* ------------------------------------------------------------------ */
/* Posing — walk / run / jump / idle / sit + auto-blink & expressions  */
/* ------------------------------------------------------------------ */
export interface PoseOpts { phase?: number; airborne?: boolean; detained?: boolean; zombie?: boolean; /** 😱 fleeing a horror — arms thrown up, flailing, glancing over the shoulder */ panic?: boolean; vy?: number; flip?: number; squash?: number; faint?: number; /** 0..1 progress of an arm swing (axe chop / sword slash / beast claw) — 0 = none */ swing?: number }

/** All channels poseCharacter drives — computed as targets, blended, then applied. */
interface PoseCh {
  by: number; brx: number; bry: number; brz: number; bsx: number; bsy: number;
  hy: number; hrx: number; hry: number; hrz: number;
  l0: number; l1: number; a0x: number; a1x: number; a0z: number; a1z: number;
}
const POSE_KEYS: (keyof PoseCh)[] = ["by", "brx", "bry", "brz", "bsx", "bsy", "hy", "hrx", "hry", "hrz", "l0", "l1", "a0x", "a1x", "a0z", "a1z"];
const mixCh = (a: PoseCh, b: PoseCh, t: number, out: PoseCh): PoseCh => {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
};
const sstep = (a: number, b: number, x: number) => {
  const p = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return p * p * (3 - 2 * p);
};
const _ground: PoseCh = { by: 0, brx: 0, bry: 0, brz: 0, bsx: 1, bsy: 1, hy: 0, hrx: 0, hry: 0, hrz: 0, l0: 0, l1: 0, a0x: 0, a1x: 0, a0z: 0, a1z: 0 };
const _stride: PoseCh = { ..._ground };
const _air: PoseCh = { ..._ground };

function updateBlink(g: THREE.Object3D, rig: CharRig, t: number) {
  const st = g.userData.blink as { next: number; t: number; amt: number } | undefined;
  if (!st || rig.lids.length < 2) return;
  if (st.t < 0) st.t = t;
  if (t >= st.next) { st.t = t; st.next = t + 1.6 + Math.random() * 3.4; }
  const p = (t - st.t) / 0.16;
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
  const HEAD_Y = 1.84;
  const FLIP_PIVOT = 0.98; // hip height — pivot for the double-jump flip

  updateBlink(g, rig, t);

  if (rig.brows.length === 2) {
    const sad = o.detained ? 0.3 : 0;
    rig.brows[0].rotation.z = -0.08 + sad;
    rig.brows[1].rotation.z = 0.08 - sad;
    const lift = o.detained ? -0.015 : Math.min(0.03, speed * 0.004);
    rig.brows[0].position.y = 0.19 + lift;
    rig.brows[1].position.y = 0.19 + lift;
  }

  /* ---- per-character gait state -------------------------------------
   * The stride phase is INTEGRATED over time (ph += dt·freq). The old
   * code computed the phase as t·freq with t = absolute clock seconds,
   * so every speed change (start walking, walk→run, takeoff, landing)
   * teleported the phase by hundreds of radians — limbs scrambled for a
   * moment and only looked right once speed settled. Integrating keeps
   * the stride continuous no matter how speed changes.                 */
  const st = (g.userData.gait ??= { lastT: t, ph: phase, air: 0 });
  const dt = Math.min(0.1, Math.max(0, t - st.lastT));
  st.lastT = t;
  st.ph += dt * (5.4 + speed * 1.45);
  // ground ⇄ air crossfade (~0.1 s) — no snapping on takeoff / landing
  st.air += ((o.airborne ? 1 : 0) - st.air) * Math.min(1, dt * 22);
  const airB = st.air;

  if (o.detained) {
    body.position.y = -0.34 + Math.sin(t * 2.2 + phase) * 0.015;
    body.position.z = 0;
    body.rotation.x = 0.12;
    body.rotation.y = 0;
    body.rotation.z = 0;
    head.position.y = HEAD_Y;
    legs[0].rotation.x = legs[1].rotation.x = -1.4;
    arms[0].rotation.x = arms[1].rotation.x = 0.3;
    arms[0].rotation.z = 0.15; arms[1].rotation.z = -0.15;
    head.rotation.x = 0.32;
    body.scale.y = 1;
    return;
  }

  // car bonk: tipsy wobble while the dizzy stars orbit (o.faint runs 1 → 0)
  if (o.faint != null && o.faint > 0) {
    const w = o.faint;
    const wob = Math.sin(t * 9) * 0.18 * w;
    body.rotation.set(-0.55 * w - 0.08, wob * 0.5, wob);
    body.position.y = -0.2 * w;
    body.position.z = -0.12 * w;
    body.scale.set(1 + 0.06 * w, 1 - 0.07 * w, 1 + 0.06 * w);
    head.position.y = HEAD_Y;
    head.rotation.set(0.38 * w, wob * 2.4, wob * 1.6); // lolling head
    legs[0].rotation.x = -0.55 * w; legs[1].rotation.x = -0.38 * w;
    arms[0].rotation.x = 0.55 * w; arms[1].rotation.x = 0.45 * w;
    arms[0].rotation.z = 0.75 * w; arms[1].rotation.z = -0.75 * w; // arms splayed — "whoa!"
    return;
  }

  // mid-air front flip after a double jump — one hard-cut cartoon move
  if (o.airborne && o.flip && o.flip > 0) {
    const p = 1 - Math.min(1, o.flip);        // 0 → 1 through the flip
    const th = Math.PI * 2 * p;               // head leads forward → a true FRONT flip
    body.rotation.x = th;
    body.rotation.y = 0;
    body.rotation.z = 0;
    // spin around the waist, not the feet: shift the body so the pivot stays
    // fixed at hip height (the offset vanishes exactly at 0 and 2π — seamless)
    body.position.y = FLIP_PIVOT * (1 - Math.cos(th));
    body.position.z = -FLIP_PIVOT * Math.sin(th);
    legs[0].rotation.x = -1.5; legs[1].rotation.x = -1.25; // tight tuck
    arms[0].rotation.x = -1.15; arms[1].rotation.x = -1.15;
    arms[0].rotation.z = 0.32; arms[1].rotation.z = -0.32;
    head.position.y = HEAD_Y;
    head.rotation.set(0, 0, 0);
    body.scale.set(0.96, 1.05, 0.96);
    return;
  }

  /* ---- ground pose: idle ⇄ walk ⇄ run, blended continuously -------- */
  const sp = Math.min(1.6, speed / 4.5);
  const b = Math.sin(t * 2 + phase);          // slow breathing (fixed freq — safe)
  // idle targets
  _ground.by = b * 0.02;
  _ground.brx = 0; _ground.bry = 0;
  _ground.brz = Math.sin(t * 0.7 + phase) * 0.022; // gentle weight shift
  _ground.bsx = 1; _ground.bsy = 1 + b * 0.014;
  _ground.hy = HEAD_Y + b * 0.012;
  _ground.hrx = 0;
  _ground.hry = Math.sin(t * 0.6 + phase) * 0.16;
  _ground.hrz = Math.sin(t * 0.9 + phase) * 0.03;
  _ground.l0 = 0; _ground.l1 = 0;
  _ground.a0x = b * 0.07; _ground.a1x = -b * 0.07;
  _ground.a0z = 0.09 + b * 0.02; _ground.a1z = -0.09 - b * 0.02;
  // stride targets (integrated phase — smooth through any speed change)
  const freq = st.ph;
  const k = Math.sin(freq) * sp * 0.98;
  const runB = sstep(6.8, 9.2, speed);        // smooth walk → run lean/pump
  const pump = 0.9 + runB * 0.28;
  const bounce = Math.abs(Math.cos(freq));
  _stride.by = bounce * 0.06 * sp;
  _stride.brx = Math.min(0.3, sp * 0.13) + runB * 0.14;
  _stride.bry = 0;
  _stride.brz = Math.sin(freq) * 0.035 * sp;  // hip roll adds life
  _stride.bsx = 1 + bounce * 0.02 * sp;
  _stride.bsy = 1 - bounce * 0.035 * sp;
  _stride.hy = HEAD_Y + bounce * 0.045 * sp;  // head bobs on stride
  _stride.hrx = -0.05 * sp - runB * 0.08;
  _stride.hry = 0;
  _stride.hrz = Math.sin(freq) * 0.035 * sp;
  _stride.l0 = k; _stride.l1 = -k;
  _stride.a0x = -k * pump; _stride.a1x = k * pump;
  _stride.a0z = 0.12; _stride.a1z = -0.12;
  mixCh(_ground, _stride, sstep(0.05, 0.55, sp), _ground); // idle → stride

  /* ---- air pose: launch ⇄ fall, blended by vertical speed ----------- */
  const upB = sstep(-1.6, 1.6, o.vy ?? 0);    // 1 = rising · 0 = falling
  // rise pose: arms thrown up, legs trailing, body stretched
  _stride.by = 0; _stride.brx = -0.12; _stride.bry = 0.1; _stride.brz = 0;
  _stride.bsx = 0.96; _stride.bsy = 1.07;
  _stride.hy = HEAD_Y; _stride.hrx = 0; _stride.hry = 0; _stride.hrz = 0;
  _stride.l0 = -0.75; _stride.l1 = 0.45;
  _stride.a0x = -2.6; _stride.a1x = -2.4; _stride.a0z = 0.3; _stride.a1z = -0.3;
  // fall pose: superhero arms out, legs reaching for the ground
  _air.by = 0; _air.brx = 0.06; _air.bry = 0.1; _air.brz = 0;
  _air.bsx = 1.02; _air.bsy = 0.97;
  _air.hy = HEAD_Y; _air.hrx = 0; _air.hry = 0; _air.hrz = 0;
  _air.l0 = -0.5; _air.l1 = 0.3;
  _air.a0x = -0.85; _air.a1x = -0.85; _air.a0z = 1.15; _air.a1z = -1.15;
  mixCh(_air, _stride, upB, _air);            // no snap at the apex
  mixCh(_ground, _air, airB, _ground);        // ground ⇄ air crossfade

  if (o.zombie) {
    /* 🧟 shambling gait — game-feel character pass: hunched questing arms, one
     * stiffer than the other; head lolls side to side; the bad leg drags at
     * half swing so the lurch reads at any distance (rides the stride phase
     * so the drag stays synced with the feet). */
    _ground.a0x = -1.45 + Math.sin(t * 3 + phase) * 0.16;
    _ground.a1x = -1.35 + Math.sin(t * 3 + phase + 1.1) * 0.16;
    _ground.a0z = 0.14; _ground.a1z = -0.22;
    _ground.brz = Math.sin(t * 2.4 + phase) * 0.09;
    _ground.brx = Math.max(_ground.brx, 0.1) + 0.08; // hunched forward
    _ground.hrx = 0.14;
    _ground.hrz = Math.sin(t * 1.7 + phase) * 0.15;
    _ground.l0 = _ground.l0 * 0.95;
    _ground.l1 = _ground.l1 * 0.4 - 0.14; // the drag leg trails below the hip
  }

  // 😱 blind panic: arms thrown overhead flailing fast, head snapping back and
  // forth, hunched sprint — reads instantly even in the player's periphery
  if (o.panic && !o.detained) {
    const fl = Math.sin(t * 12 + phase);
    _ground.a0x = -2.5 + fl * 0.35;
    _ground.a1x = -2.5 - fl * 0.35;
    _ground.a0z = 0.55 + fl * 0.1; _ground.a1z = -0.55 - fl * 0.1;
    _ground.hry = Math.sin(t * 5 + phase) * 0.5; // glances back over the shoulder
    _ground.hrz = Math.sin(t * 10 + phase) * 0.06;
    _ground.brx = Math.max(_ground.brx, 0.22);   // hunched sprint
  }

  // landing squash-and-stretch: peaks mid-way, eases back to 1
  const sq = o.squash ? Math.sin(Math.min(1, o.squash) * Math.PI) * 0.16 : 0;
  body.position.y = _ground.by - sq * 0.35;
  body.position.z = 0; // clear any residue if a flip was interrupted by landing
  body.rotation.set(_ground.brx, _ground.bry, _ground.brz);
  body.scale.set(_ground.bsx * (1 + sq * 0.7), _ground.bsy * (1 - sq), _ground.bsx * (1 + sq * 0.7));
  head.position.y = _ground.hy;
  head.rotation.set(_ground.hrx, _ground.hry, _ground.hrz);
  legs[0].rotation.x = _ground.l0; legs[1].rotation.x = _ground.l1;
  arms[0].rotation.x = _ground.a0x; arms[1].rotation.x = _ground.a1x;
  arms[0].rotation.z = _ground.a0z; arms[1].rotation.z = _ground.a1z;

  /* ---- ⚔️ arm swing — wind up → SLAM → recover, overriding the right arm ----
   * Drives axe chops, sword slashes, hammer smashes and beast claws alike.
   * The tool mesh rides the arm (setHeldTool), so it whistles through the arc. */
  if (o.swing != null && o.swing > 0) {
    const sw = Math.min(1, o.swing);
    let ax: number, az: number;
    if (sw < 0.12) {
      // snap up-behind the head — fast anticipation
      const k = sw / 0.12;
      ax = _ground.a1x + (-2.55 - _ground.a1x) * k;
      az = _ground.a1z + (-0.55 - _ground.a1z) * k;
    } else if (sw < 0.35) {
      // the strike — fast, accelerating chop down/forward (damage lands here)
      const k = (sw - 0.12) / 0.23;
      ax = -2.55 + (1.1 + 2.55) * k * k;
      az = -0.55 + 0.72 * k;
    } else {
      // settle back into the stride pose
      const k = sstep(0, 1, (sw - 0.35) / 0.65);
      ax = 1.1 + (_ground.a1x - 1.1) * k;
      az = 0.17 + (_ground.a1z - 0.17) * k;
    }
    arms[1].rotation.x = ax;
    arms[1].rotation.z = az;
    // torso twists into the blow, left arm swings for balance
    body.rotation.y += Math.sin(sw * Math.PI) * -0.3;
    arms[0].rotation.x = _ground.a0x + Math.sin(sw * Math.PI) * 0.55;
  }
}

/* ------------------------------------------------------------------ */
/* Animals — cute cartoon quadrupeds, merged to ~6 draw calls          */
/* ------------------------------------------------------------------ */
export type AnimalKind3 = "cow" | "chicken" | "deer" | "monkey";

export function buildAnimal(kind: AnimalKind3): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rig: { legs: THREE.Group[]; head: THREE.Group; body: THREE.Group; tail?: THREE.Group; wings?: THREE.Group[] } = {
    legs: [], head: new THREE.Group(), body,
  };

  const conf = {
    cow: { c: "#f7f2e8", s: 1.7, headY: 0.95, headZ: 0.85 },
    chicken: { c: "#fff3d6", s: 0.95, headY: 0.5, headZ: 0.4 },
    deer: { c: "#c98a4b", s: 1.45, headY: 1.0, headZ: 0.8 },
    monkey: { c: "#8a5a3a", s: 1.1, headY: 0.75, headZ: 0.55 },
  }[kind];
  const dark = kind === "cow" ? "#3a3a3a" : kind === "deer" ? "#8a5a2b" : "#6a4426";
  const belly = kind === "cow" ? "#f7f2e8" : "#e8d5b0";

  const bToon = new Bucket(), bUnlit = new Bucket();
  const legB: Bucket[] = [new Bucket(), new Bucket(), new Bucket(), new Bucket()];

  bToon.add(sphere(0.5, 10, 8), conf.c, false, 0, 0.62, 0, 0, 0, 0, 0.85, 0.75, 1.15);
  bToon.add(sphere(0.36, 10, 8), belly, false, 0, 0.48, 0.12, 0, 0, 0, 0.7, 0.55, 0.9);

  const head = new THREE.Group();
  head.position.set(0, conf.headY, conf.headZ);
  body.add(head);
  const hToon = new Bucket(), hUnlit = new Bucket();
  hToon.add(sphere(0.3, 12, 9), conf.c, false, 0, 0, 0, 0, 0, 0, 0.95, 0.9, 1);
  hToon.add(sphere(0.16, 8, 6), kind === "cow" ? "#ffc0cb" : belly, false, 0, -0.08, 0.24, 0, 0, 0, 1, 0.75, 0.8);
  // nostrils + a tiny smile for the furry kinds
  if (kind !== "chicken") {
    hToon.add(sphere(0.024, 5, 4), dark, false, -0.055, -0.12, 0.33);
    hToon.add(sphere(0.024, 5, 4), dark, false, 0.055, -0.12, 0.33);
    hUnlit.add(torus(0.045, 0.011, Math.PI), SMILE, true, 0, -0.155, 0.3, 0, 0, Math.PI);
  }
  // big cartoon eyes with glints
  for (const s of [-1, 1]) {
    hUnlit.add(sphere(0.082, 8, 6), "#ffffff", true, s * 0.14, 0.1, 0.22, 0, 0, 0, 1, 1.25, 0.55);
    hUnlit.add(sphere(0.04, 6, 5), EYE_B, true, s * 0.145, 0.105, 0.272);
    hUnlit.add(sphere(0.014, 5, 4), GLINT, true, s * 0.16, 0.135, 0.288);
  }

  if (kind === "cow") {
    // curved horns + soft ears
    for (const s of [-1, 1]) {
      hToon.add(cone(0.055, 0.17, 6), "#e8e0d0", false, s * 0.22, 0.27, 0, 0, 0, s * 0.85);
      hToon.add(sphere(0.09, 6, 5), "#3a3a3a", false, s * 0.3, 0.06, -0.02, 0, 0, 0, 0.4, 0.85, 0.6);
    }
    // irregular hide spots
    const spots: [number, number, number, number][] = [
      [0.28, 0.84, 0.18, 0.15], [-0.3, 0.76, -0.1, 0.17], [0.05, 0.88, -0.34, 0.13],
      [-0.18, 0.86, 0.3, 0.11], [0.22, 0.66, -0.28, 0.1], [-0.04, 0.62, 0.42, 0.09],
    ];
    for (const [sx, sy, sz, r] of spots) bToon.add(sphere(r, 7, 5), "#3a3a3a", false, sx, sy, sz, 0, 0, 0, 1, 0.55, 1.1);
    // party collar + bell
    bToon.add(torus(0.24, 0.045, Math.PI * 2), "#e0483a", false, 0, 0.72, 0.5, -Math.PI / 2, 0, 0);
    bToon.add(sphere(0.085, 8, 6), GOLD, false, 0, 0.5, 0.64);
  }
  if (kind === "deer") {
    // branched antlers + long oval ears
    for (const s of [-1, 1]) {
      hToon.add(cone(0.035, 0.34, 5), "#8a5a2b", false, s * 0.13, 0.44, -0.02, 0, 0, s * 0.4);
      hToon.add(cone(0.024, 0.2, 5), "#8a5a2b", false, s * 0.21, 0.5, -0.04, -0.35, 0, s * 0.95);
      hToon.add(sphere(0.09, 6, 5), "#8a5a2b", false, s * 0.27, 0.14, -0.04, 0, 0, 0, 0.4, 1.05, 0.55);
    }
    // fawn spots along the spine
    const dsp: [number, number, number][] = [[0.09, 0.9, 0.08], [-0.1, 0.92, -0.06], [0.12, 0.88, -0.22], [-0.14, 0.85, 0.14], [0.05, 0.93, -0.32]];
    for (const [sx, sy, sz] of dsp) bToon.add(sphere(0.055, 6, 5), "#fff6e8", false, sx, sy, sz, 0, 0, 0, 1, 0.55, 1.25);
  }
  if (kind === "monkey") {
    hToon.add(sphere(0.18, 8, 6), "#d8b088", false, 0, 0, 0.18, 0, 0, 0, 0.8, 0.8, 0.6);
    // round saucer ears
    for (const s of [-1, 1]) {
      hToon.add(sphere(0.1, 6, 5), "#6a4426", false, s * 0.3, 0.04, -0.02, 0, 0, 0, 0.35, 0.95, 0.65);
      hToon.add(sphere(0.05, 6, 5), "#d8b088", false, s * 0.33, 0.04, 0.03, 0, 0, 0, 0.35, 0.6, 0.5);
    }
    // warm belly patch
    bToon.add(sphere(0.22, 8, 6), "#d8b088", false, 0, 0.56, 0.3, 0, 0, 0, 0.8, 0.95, 0.6);
  }
  if (kind === "chicken") {
    // comb now sits ON the head (three bumps), beak + wattle
    hToon.add(sphere(0.075, 6, 5), "#e8443a", false, 0, 0.27, 0.08);
    hToon.add(sphere(0.062, 6, 5), "#e8443a", false, 0, 0.28, -0.02);
    hToon.add(sphere(0.05, 6, 5), "#e8443a", false, 0, 0.25, -0.11);
    hToon.add(cone(0.05, 0.18, 5), "#ffb347", false, 0, -0.04, 0.4, Math.PI / 2);
    hToon.add(sphere(0.05, 6, 5), "#e0483a", false, 0, -0.18, 0.33);
    // fan of tail feathers
    bToon.add(cone(0.075, 0.32, 5), "#f0e6c8", false, 0, 0.84, -0.42, -0.55, 0, 0);
    bToon.add(cone(0.06, 0.26, 5), "#e0d5b8", false, -0.12, 0.8, -0.4, -0.6, 0, 0.5);
    bToon.add(cone(0.06, 0.26, 5), "#e0d5b8", false, 0.12, 0.8, -0.4, -0.6, 0, -0.5);
  }
  const legOffsets: [number, number][] = [[-0.24, 0.34], [0.24, 0.34], [-0.24, -0.34], [0.24, -0.34]];
  legOffsets.forEach(([x, z], i) => {
    if (kind === "chicken") legB[i].add(capsule(0.05, 0.3), "#ffb347", false, 0, -0.2, 0);
    else legB[i].add(capsule(0.075, 0.3), dark, false, 0, -0.2, 0);
  });

  const legPos: [number, number][] = [[-0.24, 0.34], [0.24, 0.34], [-0.24, -0.34], [0.24, -0.34]];
  legPos.forEach(([x, z], i) => {
    const leg = new THREE.Group();
    leg.position.set(x, 0.5, z);
    const m = legB[i].mesh("toon");
    if (m) leg.add(m);
    body.add(leg);
    rig.legs.push(leg);
  });

  // animatable tails (cow swish, deer flick, monkey curl)
  if (kind === "cow" || kind === "deer" || kind === "monkey") {
    const tail = new THREE.Group();
    const tB = new Bucket();
    if (kind === "cow") {
      tB.add(capsule(0.035, 0.28), dark, false, 0, -0.17, -0.05, 0.5, 0, 0);
      tB.add(sphere(0.07, 6, 5), "#6a4426", false, 0, -0.34, -0.14);
      tail.position.set(0, 0.8, -0.42);
    } else if (kind === "deer") {
      tB.add(sphere(0.09, 6, 5), "#fff6e8", false, 0, -0.06, -0.05, 0, 0, 0, 0.75, 1.15, 0.6);
      tail.position.set(0, 0.84, -0.44);
    } else {
      const pts: [number, number, number, number][] = [[0, 0.07, -0.06, 0.055], [0, 0.23, -0.1, 0.05], [0, 0.37, -0.06, 0.045], [0, 0.45, 0.06, 0.04], [0, 0.43, 0.18, 0.034]];
      for (const [px, py, pz, r] of pts) tB.add(sphere(r, 6, 5), "#6a4426", false, px, py, pz);
      tail.position.set(0, 0.76, -0.4);
    }
    const tm = tB.mesh("toon");
    if (tm) tail.add(tm);
    body.add(tail);
    rig.tail = tail;
  }

  // chicken wings — separate pivots so they can flap
  if (kind === "chicken") {
    const wings: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(s * 0.3, 0.72, 0.02);
      const wB = new Bucket();
      wB.add(sphere(0.17, 8, 6), "#f7eecb", false, 0, -0.09, 0, 0, 0, 0, 0.4, 1, 1.25);
      const wm = wB.mesh("toon");
      if (wm) wing.add(wm);
      body.add(wing);
      wings.push(wing);
    }
    rig.wings = wings;
  }

  const bm = bToon.mesh("toon"); if (bm) body.add(bm);
  const hm = hToon.mesh("toon"); if (hm) head.add(hm);
  const hu = hUnlit.mesh("basic"); if (hu) head.add(hu);

  root.scale.setScalar(conf.s);
  root.userData.rig = rig;
  root.userData.kind = kind;
  return root;
}

export function poseAnimal(g: THREE.Object3D, speed: number, t: number, phase = 0) {
  const rig = g.userData.rig as {
    legs: THREE.Group[]; head: THREE.Group; body: THREE.Group; tail?: THREE.Group; wings?: THREE.Group[];
  } | undefined;
  if (!rig) return;
  const kind = g.userData.kind as AnimalKind3 | undefined;

  // integrated stride phase (same fix as poseCharacter — no phase jumps
  // when the animal speeds up / slows down)
  const st = (g.userData.gait ??= { lastT: t, ph: phase, idle: 0 });
  const dt = Math.min(0.1, Math.max(0, t - st.lastT));
  st.lastT = t;
  st.ph += dt * (6 + speed * 2);
  const sp = Math.min(1.4, speed / 3.5);
  // how long the animal has stood still — long enough → start grazing
  st.idle = speed < 0.5 ? Math.min(120, st.idle + dt) : 0;
  const graze = sstep(1.6, 2.6, st.idle);
  const gp = st.idle;

  // diagonal trot + gallop bounce + running lean
  const k = Math.sin(st.ph) * sp * 0.7;
  rig.legs.forEach((l, i) => { l.rotation.x = (i % 2 === 0 ? k : -k) * (i < 2 ? 1 : -1); });
  const hop = Math.abs(Math.cos(st.ph));
  const breath = (1 - graze) * Math.sin(t * 2.1 + phase);
  rig.body.position.y = hop * 0.05 * sp + breath * 0.012;
  rig.body.rotation.x = sp * 0.09 * (1 - graze) + (kind === "chicken" ? graze * 0.2 : 0);
  rig.body.scale.set(1 - breath * 0.008, 1 + breath * 0.014, 1 - breath * 0.008);

  // head — stride bob + curious look-around, or dips down to graze / peck
  let dip = 0;
  if (graze > 0) {
    const cyc = kind === "chicken"
      ? Math.max(0, Math.sin(gp * 5.2))                              // quick pecks
      : Math.pow(Math.max(0, Math.sin(gp * 1.7 - 0.4)), 1.5);        // slow graze
    dip = cyc * (kind === "chicken" ? 0.75 : 0.95) * graze;
  }
  rig.head.rotation.x = -hop * 0.045 * sp * (1 - graze) + dip;
  rig.head.rotation.y = (Math.sin(t * 0.55 + phase) * 0.3 + Math.sin(t * 0.23 + phase * 2) * 0.12) * (1 - graze) * (1 - sp * 0.55);
  rig.head.rotation.z = Math.sin(t * 0.9 + phase) * 0.05 * (1 - graze);

  // tail — lazy sway while grazing, happy wag on the move
  if (rig.tail) {
    rig.tail.rotation.y = Math.sin(t * (graze > 0.5 ? 1.3 : 2.6 + sp * 2.4) + phase) * (graze > 0.5 ? 0.22 : 0.28 + sp * 0.2);
    rig.tail.rotation.x = hop * 0.1 * sp;
  }

  // chicken wings — folded flutter at rest, rapid flap while running
  if (rig.wings) {
    const flap = sp > 0.25
      ? 0.3 + Math.abs(Math.sin(t * 21 + phase)) * 0.75
      : Math.max(0, Math.sin(t * 1.6 + phase)) * 0.18;
    rig.wings[0].rotation.z = -flap;
    rig.wings[1].rotation.z = flap;
  }
}

/* ------------------------------------------------------------------ */
/* Props: vote token, food pickup, ballot box, help bubble, name tag   */
/* ------------------------------------------------------------------ */
const _bucket = new Bucket();

/** Merged vertex-coloured 💰 cash-pile geometry (for instanced rendering) —
 *  a banded banknote bundle with loose notes and two gold coins. Replaces the
 *  old vote token: in 7Nights the town runs on MONEY. */
export function voteTokenGeometry(): THREE.BufferGeometry {
  _bucket.add(box(0.52, 0.16, 0.3), "#2f9e57", true, 0, 0.09, 0);                            // note stack
  _bucket.add(box(0.2, 0.18, 0.32), "#e6f7ec", true, 0, 0.09, 0);                            // paper band
  _bucket.add(box(0.54, 0.05, 0.32), "#41b76f", true, 0.03, 0.2, 0.02, 0.14, 0.1, 0.06);     // loose note on top
  _bucket.add(sphere(0.13, 12, 8), GOLD, true, 0.28, 0.06, 0.17, 0, 0, 0, 1, 0.45, 1);       // gold coin
  _bucket.add(sphere(0.1, 10, 8), "#e8b028", true, -0.25, 0.05, -0.15, 0, 0, 0, 1, 0.5, 1);  // second coin
  return _bucket.mesh("basic")!.geometry;
}

/**
 * Merged vertex-coloured food geometry — a distinct hand-modelled mini-food per
 * ITEMS def (mango, samosa, jalebi, laddu, first-aid kit, chai, coconut water).
 * Models stand ~0.5u tall and are rendered via InstancedMesh.
 */
export function foodGeometry(def: number): THREE.BufferGeometry {
  const kind = ITEMS[def]?.name ?? "";
  if (kind === "Mango") {
    // ripe Alphonso — golden ellipsoid with a red blush, stem and a little leaf
    _bucket.add(sphere(0.27, 12, 10), "#ffb23e", false, 0, 0, 0, 0, 0, 0, 1, 0.92, 0.88);
    _bucket.add(sphere(0.13, 8, 6), "#ff7f2a", false, 0.11, 0.04, 0.13);
    _bucket.add(cyl(0.026, 0.036, 0.15, 6), "#6b4a24", false, 0, 0.3, 0);
    _bucket.add(sphere(0.09, 6, 4), "#4f9e3c", false, 0.13, 0.36, 0, 0, 0, -0.55, 1.7, 0.16, 0.6);
    _bucket.add(sphere(0.028, 5, 4), "#ffffff", true, -0.1, 0.14, 0.17); // glint
  } else if (kind === "Samosa") {
    // crispy triangular pyramid with a toasted stripe and a green chutney dot
    _bucket.add(cone(0.3, 0.44, 3), "#d9973f", false, 0, 0.05, 0, 0, 0.5, 0, 1, 1, 0.85);
    _bucket.add(cone(0.24, 0.2, 3), "#b8762e", false, 0, 0.3, 0, 0, 0.5, 0, 1, 1, 0.85); // toasted tip
    _bucket.add(sphere(0.05, 5, 4), "#5da345", true, 0.14, 0.12, 0.16); // chutney
    _bucket.add(box(0.34, 0.035, 0.05), "#f4d7a0", true, 0, -0.12, 0.14); // pale seam
  } else if (kind === "Jalebi") {
    // glossy orange spiral — two stacked rings + sugar glint
    _bucket.add(torus(0.24, 0.07, Math.PI * 2), "#ff8c1a", false, 0, 0.06, 0, Math.PI / 2);
    _bucket.add(torus(0.13, 0.062, Math.PI * 2), "#ffa23e", false, 0.03, 0.1, -0.02, Math.PI / 2);
    _bucket.add(sphere(0.035, 5, 4), "#ffe0a8", true, 0.2, 0.12, 0.08);
  } else if (kind === "Laddu") {
    // motichoor laddu — bumpy boondi sphere with pistachio flecks and silver vark
    _bucket.add(sphere(0.26, 12, 10), "#f0a72e", false);
    _bucket.add(sphere(0.062, 6, 5), "#ffc35e", false, 0.14, 0.16, 0.12);
    _bucket.add(sphere(0.062, 6, 5), "#ffc35e", false, -0.16, 0.1, 0.08);
    _bucket.add(sphere(0.062, 6, 5), "#ffc35e", false, 0.02, 0.24, -0.1);
    _bucket.add(sphere(0.062, 6, 5), "#ffc35e", false, -0.06, 0.02, 0.2);
    _bucket.add(sphere(0.05, 5, 4), "#79b448", false, 0.1, 0.22, 0.1);   // pistachio
    _bucket.add(box(0.12, 0.01, 0.05), "#e8e8f2", true, -0.1, 0.18, 0.14); // silver vark
  } else if (kind === "First-aid kit") {
    // white case, red cross, carry handle and a latch
    _bucket.add(box(0.42, 0.3, 0.2), "#ffffff", true);
    _bucket.add(box(0.13, 0.045, 0.21), "#e0483a", true);
    _bucket.add(box(0.045, 0.15, 0.21), "#e0483a", true);
    _bucket.add(torus(0.07, 0.02, Math.PI), "#b8bcc4", true, 0, 0.19, 0, 0, 0, 0); // handle
    _bucket.add(box(0.06, 0.05, 0.02), "#f5c518", true, 0.17, 0.04, 0.1); // latch
  } else if (kind === "Chai") {
    // clay kulhad-style cup on a saucer with a handle and milky tea
    _bucket.add(cyl(0.16, 0.11, 0.18, 12), "#e8e0d0", false, 0, 0.09, 0);
    _bucket.add(cyl(0.135, 0.135, 0.025, 12), "#b5722f", false, 0, 0.185, 0); // tea
    _bucket.add(cyl(0.22, 0.24, 0.035, 12), "#f4efe4", false, 0, 0.018, 0); // saucer
    _bucket.add(torus(0.07, 0.02, Math.PI), "#e8e0d0", false, 0.19, 0.12, 0, 0, 0, Math.PI / 2); // handle
  } else {
    // tender coconut — green husk, chopped white top and a pink straw
    _bucket.add(sphere(0.24, 12, 10), "#6fa83c", false, 0, 0, 0, 0, 0, 0, 1, 1.12, 1);
    _bucket.add(cyl(0.09, 0.12, 0.06, 10), "#efe9c8", false, 0, 0.26, 0); // chopped top
    _bucket.add(cyl(0.024, 0.024, 0.3, 6), "#ff5a8a", false, 0.05, 0.4, 0.02, 0, 0, 0.25); // straw
    _bucket.add(sphere(0.03, 5, 4), "#ffffff", true, -0.1, 0.16, 0.16); // glint
  }
  return _bucket.mesh("basic")!.geometry;
}

/** Shared transparent blob-shadow material (for the instanced shadow pass). */
export function shadowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false });
}

/** Shared vertex-coloured unlit material (instanced props). */
export function basicVertexMaterial(): THREE.MeshBasicMaterial {
  return basicVC();
}

export function buildVoteToken(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshToonMaterial({ color: GOLD, gradientMap: getGradient() });
  const gold2 = new THREE.MeshToonMaterial({ color: "#e8b028", gradientMap: getGradient() });
  const white = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const red = new THREE.MeshBasicMaterial({ color: "#e0483a" });
  g.add(new THREE.Mesh(box(0.5, 0.34, 0.06), gold));
  const flap = new THREE.Mesh(cone(0.25, 0.2, 4), gold2);
  flap.position.y = 0.06; flap.rotation.x = Math.PI; flap.scale.set(1, 1, 0.18);
  g.add(flap);
  const w = new THREE.Mesh(box(0.2, 0.2, 0.07), white); w.position.set(0, -0.03, 0.01); g.add(w);
  const star = new THREE.Mesh(cone(0.08, 0.16, 5), red); star.position.set(0, 0.12, 0.05); star.rotation.x = Math.PI / 2;
  g.add(star);
  return g;
}

/** Group-based food model (matches foodGeometry — used for non-instanced spots). */
export function buildFood(def: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(foodGeometry(def), basicVC());
  g.add(m);
  return g;
}

export function buildBallotBox(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(box(1.5, 1.1, 1.0), new THREE.MeshLambertMaterial({ color: "#f8f4e8", transparent: true, opacity: 0.92 })));
  const slit = new THREE.Mesh(box(0.7, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: "#333333" }));
  slit.position.set(0, 0.35, 0.5); g.add(slit);
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
