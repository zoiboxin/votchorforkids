"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  BALLOT, CITY_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, PARLIAMENT,
} from "@/lib/game/constants";
import { generateWorld, type World } from "@/lib/game/worldgen";
import { buildBallotBox } from "@/lib/game/character";
import { mulberry32, range } from "@/lib/game/rng";
import { nightFactor } from "@/lib/game/sim";

export const WORLD: World = generateWorld();
const tmp = new THREE.Object3D();
const col = new THREE.Color();

/* ------------------------- ground & zones ------------------------- */
function Disc({ r, color, y, x = 0, z = 0 }: { r: number; color: string; y: number; x?: number; z?: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[x, y, z]}>
      <circleGeometry args={[r, 72]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}
function Ring({ a, b, color, y }: { a: number; b: number; color: string; y: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={y}>
      <ringGeometry args={[a, b, 96]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Roads() {
  const dashes = useMemo(() => {
    const out: { x: number; z: number; rot: number }[] = [];
    for (const k of [-120, -60, 0, 60, 120]) {
      for (let d = -130; d <= 130; d += 8) {
        out.push({ x: k, z: d, rot: 0 });
        out.push({ x: d, z: k, rot: Math.PI / 2 });
      }
    }
    return out;
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null!);
  const lane = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    dashes.forEach((d, i) => {
      tmp.position.set(d.x, 0.09, d.z);
      tmp.rotation.set(-Math.PI / 2, 0, d.rot);
      tmp.scale.set(0.35, 2.4, 1);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    });
    tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1);
    ref.current.instanceMatrix.needsUpdate = true;
    let i = 0;
    for (const k of [-120, -60, 0, 60, 120]) {
      tmp.rotation.set(-Math.PI / 2, 0, 0);
      tmp.position.set(k, 0.07, 0); tmp.scale.set(14, 270, 1); tmp.updateMatrix();
      lane.current.setMatrixAt(i++, tmp.matrix);
      tmp.position.set(0, 0.07, k); tmp.scale.set(270, 14, 1); tmp.updateMatrix();
      lane.current.setMatrixAt(i++, tmp.matrix);
    }
    tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1);
    lane.current.instanceMatrix.needsUpdate = true;
  }, [dashes]);
  return (
    <>
      <instancedMesh ref={lane} args={[undefined, undefined, 10]}>
        <planeGeometry />
        <meshLambertMaterial color="#4a4a52" />
      </instancedMesh>
      <instancedMesh ref={ref} args={[undefined, undefined, dashes.length]}>
        <planeGeometry />
        <meshBasicMaterial color="#f8f4e8" />
      </instancedMesh>
    </>
  );
}

/* ------------------------- buildings ------------------------- */
function Buildings() {
  const walls = useRef<THREE.InstancedMesh>(null!);
  const roofs = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    WORLD.buildings.forEach((b, i) => {
      tmp.position.set(b.x, b.h / 2, b.z);
      tmp.scale.set(b.w * 2, b.h, b.d * 2);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      walls.current.setMatrixAt(i, tmp.matrix);
      walls.current.setColorAt(i, col.setHex(b.color));
      tmp.position.y = b.h + 0.6;
      tmp.scale.set(b.w * 2 + 1.2, 1.2, b.d * 2 + 1.2);
      tmp.updateMatrix();
      roofs.current.setMatrixAt(i, tmp.matrix);
      roofs.current.setColorAt(i, col.setHex(b.roof));
    });
    walls.current.instanceMatrix.needsUpdate = true;
    roofs.current.instanceMatrix.needsUpdate = true;
    if (walls.current.instanceColor) walls.current.instanceColor.needsUpdate = true;
    if (roofs.current.instanceColor) roofs.current.instanceColor.needsUpdate = true;
  }, []);
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, WORLD.buildings.length]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[undefined, undefined, WORLD.buildings.length]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
    </>
  );
}

/* ------------------------- trees ------------------------- */
const TRUNK_COLS = ["#8a5a33", "#7a4a28", "#6e4123", "#96683c"];
const PINE_COLS = ["#2f9e55", "#37a45c", "#2a8a4e", "#46b06a", "#2d9450"];
const ROUND_COLS = ["#58b368", "#6cbf6f", "#4aa85e", "#7ac74f", "#63b568"];

/** Shared wind-clock uniform + GPU sway injected into foliage materials. */
const WIND = { value: 0 };
function windify(mat: THREE.Material, amp: number, key: string) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND;
    sh.uniforms.uAmp = { value: amp };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uAmp;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float ph = instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.27;
          float sw = (sin(uTime * 1.4 + ph) + 0.55 * sin(uTime * 2.4 + ph * 1.7)) * uAmp;
          float lift = clamp((transformed.y + 0.5) * 1.2, 0.0, 1.0);
          transformed.x += sw * lift;
          transformed.z += sw * lift * 0.6;
        }`,
      );
  };
  mat.customProgramCacheKey = () => key;
}

function Forest() {
  const trunks = useRef<THREE.InstancedMesh>(null!);
  const tiers = useRef<THREE.InstancedMesh>(null!);
  const blobs = useRef<THREE.InstancedMesh>(null!);
  const n = useMemo(() => {
    let pine = 0;
    for (const t of WORLD.trees) if (t.kind === 0) pine++;
    return { pine, round: WORLD.trees.length - pine };
  }, []);

  useLayoutEffect(() => {
    const r = mulberry32(20240);
    // Three stacked cone tiers — base y / radius / height are × tree scale.
    const TIERS = [
      { y: 4.55, rad: 2.6, h: 3.4, shade: 0.93 },
      { y: 6.5, rad: 1.98, h: 2.85, shade: 1.0 },
      { y: 8.15, rad: 1.42, h: 2.35, shade: 1.08 },
    ];
    let ti = 0, bi = 0;
    WORLD.trees.forEach((t, i) => {
      const rot = t.x * 0.7 + t.z * 1.3;
      const hm = range(r, 0.9, 1.14); // per-tree height variety
      tmp.rotation.set(0, rot, 0);
      tmp.scale.set(t.s, t.s, t.s);
      tmp.position.set(t.x, 1.6 * t.s, t.z);
      tmp.updateMatrix();
      trunks.current.setMatrixAt(i, tmp.matrix);
      trunks.current.setColorAt(i, col.set(TRUNK_COLS[i % TRUNK_COLS.length]));

      if (t.kind === 0) {
        const g = col.set(PINE_COLS[Math.floor(r() * PINE_COLS.length)]).clone();
        for (const tier of TIERS) {
          tmp.rotation.set(0, rot, 0);
          tmp.scale.set(tier.rad * t.s, tier.h * t.s * hm, tier.rad * t.s);
          tmp.position.set(t.x, tier.y * t.s * hm, t.z);
          tmp.updateMatrix();
          tiers.current.setMatrixAt(ti, tmp.matrix);
          tiers.current.setColorAt(ti, col.copy(g).multiplyScalar(tier.shade));
          ti++;
        }
      } else {
        const g = col.set(ROUND_COLS[Math.floor(r() * ROUND_COLS.length)]).clone();
        const put = (dx: number, dy: number, dz: number, rad: number, shade: number) => {
          tmp.rotation.set(0, rot, 0);
          tmp.scale.setScalar(rad * t.s);
          tmp.position.set(t.x + dx * t.s, dy * t.s, t.z + dz * t.s);
          tmp.updateMatrix();
          blobs.current.setMatrixAt(bi, tmp.matrix);
          blobs.current.setColorAt(bi, col.copy(g).multiplyScalar(shade));
          bi++;
        };
        put(0, 5.1, 0, 2.5, 1);        // main puffy crown
        put(0, 6.75, 0, 1.72, 1.09);   // topknot
        for (let k = 0; k < 3; k++) {  // side puffs
          const a = rot + (k * Math.PI * 2) / 3;
          put(Math.cos(a) * 1.6, 4.35, Math.sin(a) * 1.6, 1.58, 0.9);
        }
      }
    });
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(1);
    trunks.current.count = WORLD.trees.length;
    tiers.current.count = ti;
    blobs.current.count = bi;
    trunks.current.instanceMatrix.needsUpdate = true;
    tiers.current.instanceMatrix.needsUpdate = true;
    blobs.current.instanceMatrix.needsUpdate = true;
    if (trunks.current.instanceColor) trunks.current.instanceColor.needsUpdate = true;
    if (tiers.current.instanceColor) tiers.current.instanceColor.needsUpdate = true;
    if (blobs.current.instanceColor) blobs.current.instanceColor.needsUpdate = true;
  }, [n]);

  useFrame((s) => { WIND.value = s.clock.elapsedTime; });

  const trunkMat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const pineMat = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ flatShading: true });
    windify(m, 0.05, "wind-pine");
    return m;
  }, []);
  const blobMat = useMemo(() => {
    const m = new THREE.MeshLambertMaterial();
    windify(m, 0.045, "wind-blob");
    return m;
  }, []);

  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, WORLD.trees.length]} material={trunkMat}>
        <cylinderGeometry args={[0.34, 0.52, 3.2, 7]} />
      </instancedMesh>
      <instancedMesh ref={tiers} args={[undefined, undefined, Math.max(1, n.pine * 3)]} material={pineMat}>
        <coneGeometry args={[1, 1, 8]} />
      </instancedMesh>
      <instancedMesh ref={blobs} args={[undefined, undefined, Math.max(1, n.round * 5)]} material={blobMat}>
        <sphereGeometry args={[1, 9, 7]} />
      </instancedMesh>
    </>
  );
}

/* ------------------------- windows (day glass / night glow) ------------------------- */
interface WinInst { x: number; y: number; z: number; ry: number }

function Windows({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const glass = useRef<THREE.InstancedMesh>(null!);
  const glow = useRef<THREE.InstancedMesh>(null!);
  const { panes, lit } = useMemo(() => {
    const r = mulberry32(555);
    const panes: WinInst[] = [];
    const lit: WinInst[] = [];
    for (const b of WORLD.buildings) {
      const floors = Math.min(5, Math.max(1, Math.floor((b.h - 3) / 4)));
      const cols = Math.max(1, Math.min(3, Math.floor(b.w * 2 / 5)));
      for (let f = 0; f < floors; f++) {
        const y = 4.2 + f * 4.1;
        if (y > b.h - 2) break;
        for (let c = 0; c < cols; c++) {
          const off = (c - (cols - 1) / 2) * 3.1;
          // front/back faces (±z)
          for (const sd of [-1, 1]) {
            const w: WinInst = { x: b.x + off, y, z: b.z + sd * (b.d + 0.07), ry: sd > 0 ? 0 : Math.PI };
            panes.push(w);
            if (r() < 0.68) lit.push(w);
          }
          // side faces (±x)
          for (const sd of [-1, 1]) {
            const w: WinInst = { x: b.x + sd * (b.w + 0.07), y, z: b.z + off, ry: sd > 0 ? Math.PI / 2 : -Math.PI / 2 };
            panes.push(w);
            if (r() < 0.68) lit.push(w);
          }
        }
      }
    }
    return { panes, lit };
  }, []);

  useLayoutEffect(() => {
    panes.forEach((w, i) => {
      tmp.position.set(w.x, w.y, w.z);
      tmp.rotation.set(0, w.ry, 0);
      tmp.scale.set(1.15, 1.4, 1);
      tmp.updateMatrix();
      glass.current.setMatrixAt(i, tmp.matrix);
    });
    glass.current.instanceMatrix.needsUpdate = true;
  }, [panes]);
  useLayoutEffect(() => {
    lit.forEach((w, i) => {
      tmp.position.set(w.x, w.y, w.z);
      tmp.rotation.set(0, w.ry, 0);
      tmp.scale.set(1.15, 1.4, 1);
      tmp.updateMatrix();
      glow.current.setMatrixAt(i, tmp.matrix);
    });
    glow.current.count = lit.length;
    glow.current.instanceMatrix.needsUpdate = true;
  }, [lit]);

  const glassMat = useRef<THREE.MeshLambertMaterial>(null!);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null!);
  const dayC = useMemo(() => new THREE.Color("#5b6a7d"), []);
  const nightC = useMemo(() => new THREE.Color("#1c2230"), []);
  const skyC = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const n = nightFactor(clockRef.current);
    if (glassMat.current) glassMat.current.color.copy(skyC.copy(dayC).lerp(nightC, n));
    if (glowMat.current && glow.current) {
      glowMat.current.opacity = Math.max(0, n - 0.35) * 1.5 * (0.82 + Math.sin(performance.now() / 700) * 0.06);
      glow.current.visible = glowMat.current.opacity > 0.02;
    }
  });

  return (
    <>
      <instancedMesh ref={glass} args={[undefined, undefined, panes.length]}>
        <planeGeometry />
        <meshLambertMaterial ref={glassMat} color="#5b6a7d" />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, Math.max(1, lit.length)]} frustumCulled={false} visible={false}>
        <planeGeometry />
        <meshBasicMaterial ref={glowMat} color="#ffd76a" transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------- graveyard & flowers ------------------------- */
function Graves() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const crosses = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const r = mulberry32(99);
    for (let i = 0; i < 70; i++) {
      const a = range(r, 0, Math.PI * 2), d = range(r, 4, 38);
      tmp.position.set(GRAVEYARD.x + Math.cos(a) * d, 0.7, GRAVEYARD.z + Math.sin(a) * d);
      tmp.rotation.set(0, range(r, -0.4, 0.4), range(r, -0.08, 0.08));
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
      tmp.position.y = 1.6;
      tmp.rotation.set(0, tmp.rotation.y, 0);
      tmp.updateMatrix();
      crosses.current.setMatrixAt(i, tmp.matrix);
    }
    tmp.rotation.set(0, 0, 0);
    ref.current.instanceMatrix.needsUpdate = true;
    crosses.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, 70]}>
        <boxGeometry args={[0.9, 1.4, 0.3]} />
        <meshLambertMaterial color="#6a6a78" />
      </instancedMesh>
      <instancedMesh ref={crosses} args={[undefined, undefined, 70]}>
        <boxGeometry args={[0.12, 0.7, 0.12]} />
        <meshLambertMaterial color="#8a8a98" />
      </instancedMesh>
    </>
  );
}

function Flowers() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const cols = ["#ff6b8a", "#ffd166", "#f8f4e8", "#c77dff", "#ff9f45"];
    WORLD.flowers.forEach((f, i) => {
      tmp.position.set(f.x, 0.16, f.z);
      tmp.rotation.set(0, f.x, 0);
      tmp.scale.setScalar(f.s);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
      ref.current.setColorAt(i, col.set(cols[Math.floor(f.c * cols.length)]));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, WORLD.flowers.length]}>
      <sphereGeometry args={[0.22, 6, 5]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

/* ------------------------- mountains ------------------------- */
const ROCK_COLS = ["#8d8478", "#7d7468", "#96897a", "#8b8f9a", "#847a6d"];
const HILL_COLS = ["#5d8a4a", "#527e42", "#68964f", "#4e7a40"];

interface Peak {
  x: number; z: number; h: number; w: number;
  rot: number; sx: number; sz: number;
  ci: number; tint: number; seg: 0 | 1 | 2; snow: number;
}

function Mountains() {
  const b5 = useRef<THREE.InstancedMesh>(null!);
  const b6 = useRef<THREE.InstancedMesh>(null!);
  const b7 = useRef<THREE.InstancedMesh>(null!);
  const c5 = useRef<THREE.InstancedMesh>(null!);
  const c6 = useRef<THREE.InstancedMesh>(null!);
  const c7 = useRef<THREE.InstancedMesh>(null!);
  const hills = useRef<THREE.InstancedMesh>(null!);

  const data = useMemo(() => {
    const r = mulberry32(7);
    // Major peaks — ring around the map, each with its own silhouette.
    const majors: Peak[] = Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + range(r, -0.06, 0.06);
      const d = range(r, 348, 418);
      const h = range(r, 85, 178);
      const w = range(r, 52, 96);
      return {
        x: Math.cos(a) * d, z: Math.sin(a) * d, h, w,
        rot: range(r, 0, Math.PI * 2),
        sx: range(r, 0.8, 1.2), sz: range(r, 0.8, 1.2),
        ci: i % ROCK_COLS.length, tint: range(r, -0.045, 0.055),
        seg: (i % 3) as 0 | 1 | 2,
        snow: h > 125 ? range(r, 0.5, 0.64) : h > 98 ? range(r, 0.6, 0.75) : range(r, 0.78, 0.94),
      };
    });
    // Shoulder peaks — cluster beside majors to form ranges.
    const shoulders: Peak[] = [];
    majors.forEach((m, i) => {
      const nSh = r() < 0.45 ? 2 : r() < 0.75 ? 1 : 0;
      for (let k = 0; k < nSh; k++) {
        const a = Math.atan2(m.z, m.x) + (k === 0 ? 1 : -1) * range(r, 0.02, 0.055);
        const d = Math.hypot(m.x, m.z) + range(r, -26, 44);
        const h = m.h * range(r, 0.36, 0.6);
        shoulders.push({
          x: Math.cos(a) * d, z: Math.sin(a) * d, h,
          w: m.w * range(r, 0.42, 0.6),
          rot: range(r, 0, Math.PI * 2),
          sx: range(r, 0.85, 1.15), sz: range(r, 0.85, 1.15),
          ci: (i + k + 1) % ROCK_COLS.length, tint: range(r, -0.04, 0.05),
          seg: ((i + k + 1) % 3) as 0 | 1 | 2,
          snow: h > 75 ? range(r, 0.58, 0.72) : range(r, 0.82, 0.96),
        });
      }
    });
    // Rounded low-poly foothills, kept outside the playable jungle ring.
    const hills = Array.from({ length: 44 }, (_, i) => {
      const a = range(r, 0, Math.PI * 2), d = range(r, 342, 382);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, h: range(r, 9, 26), w: range(r, 24, 54), ci: i % HILL_COLS.length, tint: range(r, -0.05, 0.06) };
    });
    const segBody = [0, 0, 0], segCap = [0, 0, 0];
    for (const p of [...majors, ...shoulders]) { segBody[p.seg]++; if (p.snow < 0.98) segCap[p.seg]++; }
    return { majors, shoulders, hills, segBody, segCap };
  }, []);

  useLayoutEffect(() => {
    const bodyRefs = [b5, b6, b7], capRefs = [c5, c6, c7];
    const nb = [0, 0, 0], nc = [0, 0, 0];
    const putPeak = (p: Peak) => {
      const br = bodyRefs[p.seg].current, cr = capRefs[p.seg].current;
      tmp.rotation.set(0, p.rot, 0);
      tmp.scale.set(p.w * p.sx, p.h, p.w * p.sz);
      tmp.position.set(p.x, p.h / 2 - 4, p.z);
      tmp.updateMatrix();
      br.setMatrixAt(nb[p.seg], tmp.matrix);
      br.setColorAt(nb[p.seg], col.set(ROCK_COLS[p.ci]).offsetHSL(0, 0, p.tint));
      nb[p.seg]++;
      if (p.snow < 0.98) {
        const f = p.snow;
        // Cap is the cone tip region — same triangle, slight overhang so snow drapes.
        tmp.scale.set(p.w * p.sx * (1 - f) * 1.06, p.h * (1 - f) * 1.02, p.w * p.sz * (1 - f) * 1.06);
        tmp.position.set(p.x, p.h * f + (p.h * (1 - f)) / 2 - 4, p.z);
        tmp.updateMatrix();
        cr.setMatrixAt(nc[p.seg], tmp.matrix);
        nc[p.seg]++;
      }
    };
    data.majors.forEach(putPeak);
    data.shoulders.forEach(putPeak);
    data.hills.forEach((hl, i) => {
      tmp.rotation.set(0, hl.x * 0.11, 0);
      tmp.scale.set(hl.w, hl.h, hl.w);
      tmp.position.set(hl.x, hl.h * 0.55, hl.z);
      tmp.updateMatrix();
      hills.current.setMatrixAt(i, tmp.matrix);
      hills.current.setColorAt(i, col.set(HILL_COLS[hl.ci]).offsetHSL(0, 0, hl.tint));
    });
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(1);
    for (let s = 0; s < 3; s++) {
      bodyRefs[s].current.count = nb[s];
      capRefs[s].current.count = nc[s];
      bodyRefs[s].current.instanceMatrix.needsUpdate = true;
      capRefs[s].current.instanceMatrix.needsUpdate = true;
      if (bodyRefs[s].current.instanceColor) bodyRefs[s].current.instanceColor.needsUpdate = true;
    }
    hills.current.instanceMatrix.needsUpdate = true;
    if (hills.current.instanceColor) hills.current.instanceColor.needsUpdate = true;
  }, [data]);

  const rockMat = useMemo(() => new THREE.MeshLambertMaterial({ flatShading: true }), []);
  const snowMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#f4f7fb", flatShading: true }), []);
  const hillMat = useMemo(() => new THREE.MeshLambertMaterial({ flatShading: true }), []);

  return (
    <>
      <instancedMesh ref={b5} args={[undefined, undefined, Math.max(1, data.segBody[0])]} material={rockMat} frustumCulled={false}>
        <coneGeometry args={[1, 1, 5]} />
      </instancedMesh>
      <instancedMesh ref={b6} args={[undefined, undefined, Math.max(1, data.segBody[1])]} material={rockMat} frustumCulled={false}>
        <coneGeometry args={[1, 1, 6]} />
      </instancedMesh>
      <instancedMesh ref={b7} args={[undefined, undefined, Math.max(1, data.segBody[2])]} material={rockMat} frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} />
      </instancedMesh>
      <instancedMesh ref={c5} args={[undefined, undefined, Math.max(1, data.segCap[0])]} material={snowMat} frustumCulled={false}>
        <coneGeometry args={[1, 1, 5]} />
      </instancedMesh>
      <instancedMesh ref={c6} args={[undefined, undefined, Math.max(1, data.segCap[1])]} material={snowMat} frustumCulled={false}>
        <coneGeometry args={[1, 1, 6]} />
      </instancedMesh>
      <instancedMesh ref={c7} args={[undefined, undefined, Math.max(1, data.segCap[2])]} material={snowMat} frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} />
      </instancedMesh>
      <instancedMesh ref={hills} args={[undefined, undefined, data.hills.length]} material={hillMat} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
      </instancedMesh>
    </>
  );
}

/* ------------------------- parliament + ballot ------------------------- */
function Parliament() {
  const flag = useRef<THREE.Mesh>(null!);
  const cols = useRef<THREE.InstancedMesh>(null!);
  useFrame((s) => {
    if (flag.current) flag.current.rotation.y = Math.sin(s.clock.elapsedTime * 3) * 0.2;
  });
  const colXs = useMemo(() => Array.from({ length: 8 }, (_, i) => -30 + i * (60 / 7)), []);
  useLayoutEffect(() => {
    colXs.forEach((x, i) => {
      tmp.position.set(x, 9.6, 8.4);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      cols.current.setMatrixAt(i, tmp.matrix);
    });
    cols.current.instanceMatrix.needsUpdate = true;
  }, [colXs]);
  return (
    <group position={[PARLIAMENT.x, 0, PARLIAMENT.z]}>
      <mesh position-y={9}><boxGeometry args={[70, 18, 14]} /><meshLambertMaterial color="#e8e0d0" /></mesh>
      <mesh position-y={18.6}><boxGeometry args={[72, 1.4, 16]} /><meshLambertMaterial color="#cfc4ae" /></mesh>
      <mesh position-y={24}><sphereGeometry args={[9, 18, 12]} /><meshLambertMaterial color="#7fc8a9" /></mesh>
      <mesh position-y={33.5}><cylinderGeometry args={[0.14, 0.14, 5, 6]} /><meshLambertMaterial color="#8a8a98" /></mesh>
      <mesh ref={flag} position={[0, 35, 0]}><planeGeometry args={[4.4, 2.6]} /><meshBasicMaterial color="#ff9933" side={THREE.DoubleSide} /></mesh>
      <instancedMesh ref={cols} args={[undefined, undefined, 8]}>
        <cylinderGeometry args={[0.9, 1, 19, 8]} />
        <meshLambertMaterial color="#f8f4e8" />
      </instancedMesh>
      <mesh position-y={0.4} rotation-x={-Math.PI / 2}><planeGeometry args={[40, 10]} /><meshLambertMaterial color="#d9cfb8" /></mesh>
      <mesh position={[0, 0.5, 10]}><boxGeometry args={[30, 1, 6]} /><meshLambertMaterial color="#cfc4ae" /></mesh>
    </group>
  );
}

function BallotBox() {
  const ref = useRef<THREE.Group>(null!);
  const box = useMemo(() => buildBallotBox(), []);
  useFrame((s) => {
    const p = 1 + Math.sin(s.clock.elapsedTime * 2.4) * 0.06;
    box.scale.set(p, 1 / p, p);
    if (ref.current) ref.current.position.y = 0.85 + Math.sin(s.clock.elapsedTime * 1.8) * 0.08;
  });
  return (
    <group ref={ref} position={[BALLOT.x, 0.85, BALLOT.z]}>
      <primitive object={box} />
    </group>
  );
}

/* ------------------------- sky life ------------------------- */
function Clouds() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const data = useMemo(() => {
    const r = mulberry32(31);
    return Array.from({ length: 14 }, () => ({
      x: range(r, -500, 500), y: range(r, 90, 150), z: range(r, -500, 500),
      s: range(r, 14, 30), v: range(r, 1.2, 3.2), off: range(r, 0, 9),
    }));
  }, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    data.forEach((c, i) => {
      const x = ((c.x + t * c.v + 520) % 1040) - 520;
      for (let k = 0; k < 3; k++) {
        tmp.position.set(x + k * c.s * 0.55, c.y + Math.sin(t * 0.5 + c.off + k) * 1.5, c.z + (k === 1 ? c.s * 0.3 : 0));
        tmp.scale.setScalar(k === 1 ? c.s * 0.8 : c.s * 0.6);
        tmp.updateMatrix();
        ref.current.setMatrixAt(i * 3 + k, tmp.matrix);
      }
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 42]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshLambertMaterial color="#ffffff" emissive="#d8e8f8" emissiveIntensity={0.35} />
    </instancedMesh>
  );
}

function Sky({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const stars = useRef<THREE.Points>(null!);
  const sun = useRef<THREE.Mesh>(null!);
  const moon = useRef<THREE.Mesh>(null!);
  const starGeo = useMemo(() => {
    const r = mulberry32(5);
    const pos = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      const a = range(r, 0, Math.PI * 2), p = range(r, 0.12, 1.35), R = 640;
      pos[i * 3] = Math.cos(a) * Math.cos(p) * R;
      pos[i * 3 + 1] = Math.sin(p) * R * 0.7 + 40;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(p) * R;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const PI2 = Math.PI * 2;
  useFrame(() => {
    const clock = clockRef.current;
    const n = nightFactor(clock);
    if (stars.current) (stars.current.material as THREE.PointsMaterial).opacity = Math.max(0, n - 0.25) * 1.6;
    const a = PI2 * (clock - 0.25);
    if (sun.current) sun.current.position.set(Math.cos(a) * 520, Math.sin(a) * 420, -180);
    if (moon.current) moon.current.position.set(Math.cos(a + Math.PI) * 520, Math.sin(a + Math.PI) * 420, -180);
  });
  return (
    <>
      <points ref={stars} geometry={starGeo} frustumCulled={false}>
        <pointsMaterial color="#ffffff" size={2.6} transparent opacity={0} sizeAttenuation={false} />
      </points>
      <mesh ref={sun}><sphereGeometry args={[22, 12, 10]} /><meshBasicMaterial color="#ffdd66" /></mesh>
      <mesh ref={moon}><sphereGeometry args={[16, 12, 10]} /><meshBasicMaterial color="#e8ecf8" /></mesh>
    </>
  );
}

function Fireflies({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Points>(null!);
  const geo = useMemo(() => {
    const r = mulberry32(77);
    const pos = new Float32Array(70 * 3);
    for (let i = 0; i < 70; i++) {
      const a = range(r, 0, Math.PI * 2), d = range(r, FARM_RADIUS + 10, JUNGLE_RADIUS - 15);
      pos[i * 3] = Math.cos(a) * d;
      pos[i * 3 + 1] = range(r, 0.6, 2.6);
      pos[i * 3 + 2] = Math.sin(a) * d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame((s) => {
    const n = nightFactor(clockRef.current);
    const m = ref.current?.material as THREE.PointsMaterial | undefined;
    if (!m) return;
    m.opacity = Math.max(0, n - 0.4) * 2.2 * (0.7 + Math.sin(s.clock.elapsedTime * 3) * 0.3);
    ref.current.position.y = Math.sin(s.clock.elapsedTime * 1.2) * 0.4;
  });
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#ffe066" size={3.4} transparent opacity={0} sizeAttenuation={false} />
    </points>
  );
}

/* ------------------------- environment ------------------------- */
const DAY = new THREE.Color(0x8fd3ff);
const DUSK = new THREE.Color(0xff9a5a);
const NIGHT = new THREE.Color(0x0a0e2a);

function Env({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const { scene } = useThree();
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const sun = useRef<THREE.DirectionalLight>(null!);
  const sky = useMemo(() => new THREE.Color(), []);
  const PI2 = Math.PI * 2;
  useFrame(() => {
    const clock = clockRef.current;
    const n = nightFactor(clock);
    const h = Math.sin(PI2 * (clock - 0.25));
    const dk = Math.max(0, 1 - Math.abs(h) * 5);
    sky.copy(DAY).lerp(NIGHT, n);
    if (dk > 0) sky.lerp(DUSK, dk * 0.6);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 70, n > 0.5 ? 270 : 470);
    hemi.current.intensity = 0.35 + 0.55 * (1 - n);
    sun.current.intensity = 0.25 + 0.95 * (1 - n);
    sun.current.position.set(Math.cos(PI2 * (clock - 0.25)) * 200, Math.max(24, h * 200), 90);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={[0xffffff, 0x557744, 0.8]} />
      <directionalLight ref={sun} args={[0xfff2d0, 1]} />
    </>
  );
}

export function WorldView({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  return (
    <>
      <Env clockRef={clockRef} />
      <Disc r={700} color="#3f7a36" y={-0.12} />
      <Disc r={CITY_RADIUS} color="#a09c92" y={0} />
      <Ring a={CITY_RADIUS} b={FARM_RADIUS} color="#9cb84e" y={0.02} />
      <Ring a={FARM_RADIUS} b={JUNGLE_RADIUS} color="#2d7a3a" y={0.03} />
      <Disc r={GRAVEYARD.r} color="#3a3a46" y={0.06} x={GRAVEYARD.x} z={GRAVEYARD.z} />
      <Roads />
      <Buildings />
      <Windows clockRef={clockRef} />
      <Forest />
      <Graves />
      <Flowers />
      <Mountains />
      <Parliament />
      <BallotBox />
      <Clouds />
      <Sky clockRef={clockRef} />
      <Fireflies clockRef={clockRef} />
    </>
  );
}
