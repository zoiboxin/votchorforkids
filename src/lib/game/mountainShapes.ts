/**
 * 🏔️ MOUNTAIN SHAPES — procedural ridged peaks shared by every renderer.
 *
 * Extracted from the town island's WorldView so the season arenas (and any
 * future skybox) grow the SAME real-mountain silhouettes: concave fluted
 * slopes, one steep / one gentle flank, off-centre twin summits, per-face
 * rock / snow / scrub vertex colours and flat-shaded crag facets. No more
 * cone "triangles" on any horizon.
 *
 * Winter mode ({@link buildMountainGeometry}`(peaks, { snow: true })` swaps
 * the warm granite palette for cold blue-grey rock, frosty taiga scrub and a
 * lower grip on steep faces so snow-capped ranges read ALPINE, not dusty.
 */
import * as THREE from "three";

export const ROCK_COLS = ["#989083", "#867d70", "#a29586", "#939aa6", "#8d8375"];
/** cold granite for winter ranges — blue-greys that sit under snow naturally */
export const ROCK_COLS_SNOW = ["#8d95a3", "#7f8894", "#9aa2ae", "#848c98", "#79818d"];
export const HILL_COLS = ["#5d8a4a", "#527e42", "#68964f", "#4e7a40"];
export const BASE_GRASS = new THREE.Color("#71875c");
/** frosty ground band at a snow mountain's foot — sparse winter grass */
export const BASE_SNOWSCRUB = new THREE.Color("#9aa48f");
export const SCRUB_COL = new THREE.Color("#5c6e54");
/** dark taiga pines on the winter mid-slopes */
export const TAIGA_COL = new THREE.Color("#46543f");
export const SNOW_COL = new THREE.Color("#f4f7fb");
export const SNOW_SHADE = new THREE.Color("#c9d5e2");

/** deterministic 2d hash → [0,1) */
export const hash2 = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export interface Peak {
  x: number; z: number; h: number; w: number;
  rot: number; sx: number; sz: number;
  ci: number; tint: number; snow: number; seed: number;
  k: number;    // slope profile exponent — higher = more concave & fluted
  skew: number; // asymmetric flanks (one steep, one gentle)
  amp: [number, number, number];        // ridge harmonic amplitudes
  ph: [number, number, number, number, number]; // ridge phases
  jit: number;  // surface crag jitter
  topT: number; // where the top ring sits — low = broad broken summit, high = needle
  green: boolean; // grassy foothill (no snow, green palette)
  /** height where the base ring sits — sink it below the local ground so the
   * slopes emerge from the terrain instead of floating (default -4) */
  y0?: number;
}

/** Radial silhouette multiplier: fluted ridges + one steep / one gentle flank. */
export function ridgeMul(p: Peak, a: number): number {
  return (
    1 +
    p.amp[0] * Math.sin(2 * a + p.ph[0]) +
    p.amp[1] * Math.sin(3 * a + p.ph[1]) +
    p.amp[2] * Math.sin(5 * a + p.ph[2]) +
    0.05 * Math.sin(8 * a + p.ph[3]) +
    p.skew * Math.sin(a + p.ph[4])
  );
}

/** Height profile: concave alpine slope with a subtle lower-mountain bulge. t: 0 base → 1 summit */
export const mountainProfile = (t: number, k: number) =>
  Math.pow(1 - t, k) * (1 + 0.14 * Math.pow(Math.sin(Math.min(1, t) * Math.PI), 2));

/** Smallest horizontal distance to origin reached by a peak's base ring. */
export function baseMinRadius(p: Peak): number {
  const R = p.green ? 10 : 9 + (Math.floor(p.seed) % 3) * 2;
  const baseR = p.w / 2;
  let minD = Infinity;
  for (let j = 0; j < R; j++) {
    const a = (j / R) * Math.PI * 2;
    const jRad = (hash2(p.seed, j * 9.1) - 0.5) * p.jit; // ring i = 0 (base)
    const rr = baseR * mountainProfile(0, p.k) * ridgeMul(p, a) * (1 + jRad);
    const lx = Math.cos(a) * rr * p.sx, lz = Math.sin(a) * rr * p.sz;
    const cR = Math.cos(p.rot), sR = Math.sin(p.rot);
    minD = Math.min(minD, Math.hypot(p.x + lx * cR - lz * sR, p.z + lx * sR + lz * cR));
  }
  return minD;
}

/**
 * Mountain bases are wide and jittered, so several may reach INSIDE a keep-out
 * radius (the playable wall). Nudge each peak radially outward just far
 * enough that its base ring clears `clearR`. Shapes/silhouettes are preserved.
 */
export function clearPeaks(peaks: Peak[], clearR: number) {
  for (const p of peaks) {
    const m = baseMinRadius(p);
    if (m < clearR) {
      const f = clearR / m;
      p.x *= f; p.z *= f;
    }
  }
}

export interface MountainPaletteOpts {
  /** winter mode: colder rock, frosty scrub band, snow grips steeper faces */
  snow?: boolean;
}

/** Bake every peak & foothill into one merged geometry with per-face rock/snow/grass colors. */
export function buildMountainGeometry(peaks: Peak[], opts: MountainPaletteOpts = {}): THREE.BufferGeometry {
  const winter = !!opts.snow;
  const pos: number[] = [];
  const colA: number[] = [];
  const cA = new THREE.Color(), cB = new THREE.Color();
  let fi = 0;

  const face = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    jAvg: number, p: Peak,
  ) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    ny /= nl; // steepness: 1 = flat ground, 0 = vertical wall
    const baseY = p.y0 ?? -4;
    const hf = ((ay + by + cy) / 3 - baseY) / p.h; // height fraction (base sunk)
    const hsh = hash2(fi * 1.7 + p.seed, 3.3);
    // Snow settles above the peak's snowline on gentler faces; steep crags stay rocky.
    const snowy = hf > p.snow + (hsh - 0.5) * 0.09 && (ny > (winter ? 0.52 : 0.6) || hf > p.snow + 0.12);
    if (snowy) {
      cB.copy(SNOW_COL).offsetHSL(0, 0, (hsh - 0.5) * 0.045);
      const shade = Math.min(1, Math.max(0, -jAvg * 4 + (1 - ny) * 0.6)) * 0.5;
      cB.lerp(SNOW_SHADE, shade);
    } else {
      cA.set((p.green ? HILL_COLS : winter ? ROCK_COLS_SNOW : ROCK_COLS)[p.ci]).offsetHSL(0, 0, p.tint);
      const light =
        (hsh - 0.5) * 0.06 +
        jAvg * 0.5 -                                      // crevices darker than ridges
        (1 - Math.max(0, ny)) * 0.045 +                   // steep walls darker
        (hash2(fi * 2.3, p.seed + 9.1) - 0.5) * 0.03;     // faint strata banding
      cB.copy(cA).offsetHSL(0, 0, light);
      const footCol = winter ? BASE_SNOWSCRUB : BASE_GRASS;
      if (!p.green && hf < 0.16) cB.lerp(footCol, ((0.16 - hf) / 0.16) * 0.6);
      // scrub/forest band on gentler mid-slopes (cliffs stay bare rock)
      const forest = Math.max(0, 1 - Math.abs(hf - 0.26) / 0.16) * Math.max(0, (ny - 0.4) / 0.35);
      if (!p.green && forest > 0) cB.lerp(winter ? TAIGA_COL : SCRUB_COL, Math.min(1, forest) * 0.45);
    }
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    colA.push(cB.r, cB.g, cB.b, cB.r, cB.g, cB.b, cB.r, cB.g, cB.b);
    fi++;
  };

  for (const p of peaks) {
    const R = p.green ? 10 : 9 + (Math.floor(p.seed) % 3) * 2;
    const H = p.green ? 6 : 8;
    const cR = Math.cos(p.rot), sR = Math.sin(p.rot);
    const baseR = p.w / 2;
    const baseY = p.y0 ?? -4;
    const rings: { x: number; y: number; z: number; j: number }[][] = [];
    for (let i = 0; i < H; i++) {
      const t = (i / (H - 1)) * p.topT;
      const pr = mountainProfile(t, p.k) * (p.green ? 1.15 : 1);
      const y0 = baseY + t * p.h;
      const ring: { x: number; y: number; z: number; j: number }[] = [];
      for (let j = 0; j < R; j++) {
        const a = (j / R) * Math.PI * 2;
        const jRad = (hash2(i * 3.7 + p.seed, j * 9.1) - 0.5) * p.jit;
        const rr = baseR * pr * ridgeMul(p, a) * (1 + jRad);
        const yJ = (hash2(j * 5.3 + p.seed, i * 2.9) - 0.5) * p.h * 0.03 * (0.25 + t);
        const lx = Math.cos(a) * rr * p.sx;
        const lz = Math.sin(a) * rr * p.sz;
        ring.push({ x: p.x + lx * cR - lz * sR, y: y0 + yJ, z: p.z + lx * sR + lz * cR, j: jRad });
      }
      rings.push(ring);
    }
    // jagged, slightly off-centre summit — often a twin-point ridge, which reads
    // as a real knife-edge summit instead of a perfect cone tip
    const ax = (hash2(p.seed, 8.4) - 0.5) * p.w * 0.05;
    const az = (hash2(p.seed, 6.1) - 0.5) * p.w * 0.05;
    const apexBaseY = baseY + (p.topT + 0.025 + hash2(p.seed, 4.2) * 0.035) * p.h;
    const apex = {
      x: p.x + (ax * cR - az * sR) * p.sx,
      y: apexBaseY + (hash2(p.seed, 2.7) - 0.5) * p.h * 0.015,
      z: p.z + (ax * sR + az * cR) * p.sz,
      j: 0,
    };
    const twin = !p.green && hash2(p.seed, 12.9) < 0.62;
    const apexes = [apex];
    if (twin) {
      const ta = p.rot + (hash2(p.seed, 15.3) < 0.5 ? 1 : -1) * (0.05 + hash2(p.seed, 17.7) * 0.07);
      const td = p.w * (0.035 + hash2(p.seed, 19.1) * 0.045);
      apexes.push({
        x: p.x + Math.cos(ta) * td * p.sx,
        y: apexBaseY - p.h * (0.035 + hash2(p.seed, 21.3) * 0.05),
        z: p.z + Math.sin(ta) * td * p.sz,
        j: 0,
      });
    }
    const top = rings[H - 1];
    for (let i = 0; i < H - 1; i++) {
      const lo = rings[i], hi = rings[i + 1];
      for (let j = 0; j < R; j++) {
        const j2 = (j + 1) % R;
        const A = lo[j], B = lo[j2], C = hi[j2], D = hi[j];
        const jAvg = (A.j + B.j + C.j + D.j) / 4;
        face(A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z, jAvg, p);
        face(A.x, A.y, A.z, D.x, D.y, D.z, C.x, C.y, C.z, jAvg, p);
      }
    }
    if (apexes.length === 1) {
      for (let j = 0; j < R; j++) {
        const A = top[j], B = top[(j + 1) % R];
        face(A.x, A.y, A.z, apex.x, apex.y, apex.z, B.x, B.y, B.z, (A.j + B.j) / 2, p);
      }
    } else {
      const [aA, aB] = apexes;
      const half = Math.floor(R / 2);
      for (let j = 0; j < R; j++) {
        const A = top[j], B = top[(j + 1) % R];
        const ax2 = j < half ? aA : aB;
        face(A.x, A.y, A.z, ax2.x, ax2.y, ax2.z, B.x, B.y, B.z, (A.j + B.j) / 2, p);
      }
      // seam triangles closing the ridge between the two summit points
      face(top[half].x, top[half].y, top[half].z, aB.x, aB.y, aB.z, aA.x, aA.y, aA.z, top[half].j, p);
      face(top[0].x, top[0].y, top[0].z, aA.x, aA.y, aA.z, aB.x, aB.y, aB.z, top[0].j, p);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colA, 3));
  geo.computeVertexNormals();
  return geo;
}
