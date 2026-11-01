"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  BALLOT, CITY_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, PARLIAMENT,
} from "@/lib/game/constants";
import {
  AVENUE, GATE, generateWorld, HOSPITAL, MALL, MAIN_ROAD, PARK, ROAD_W, ROADS, RING_R, RING_W, SCHOOL, PROTEST_CAMP,
  type World,
} from "@/lib/game/worldgen";
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

/* ------------------------- roads: grid + main road + ring highway + vista ------------------------- */
function Roads() {
  const SPAN = 250;
  const dashes = useMemo(() => {
    const out: { x: number; z: number; rot: number }[] = [];
    for (const k of ROADS)
      for (let d = -SPAN; d <= SPAN; d += 9) {
        if (ROADS.some((o) => Math.abs(d - o) < 11)) continue; // keep intersections clear
        if (k !== 0) out.push({ x: k, z: d, rot: 0 }); // x=0 vertical is the wide MAIN ROAD now
        out.push({ x: d, z: k, rot: Math.PI / 2 });
      }
    for (let d = MAIN_ROAD.z0 + 9; d <= MAIN_ROAD.z1; d += 9) {
      if (ROADS.some((o) => Math.abs(d - o) < 11)) continue;
      out.push({ x: MAIN_ROAD.x, z: d, rot: 0 });
    }
    for (let d = AVENUE.z0 + 6; d >= AVENUE.z1 + 5; d -= 8) out.push({ x: AVENUE.x, z: d, rot: 0 });
    return out;
  }, []);
  const ringDashes = useMemo(() => Array.from({ length: 56 }, (_, i) => (i / 56) * Math.PI * 2), []);

  const ref = useRef<THREE.InstancedMesh>(null!);
  const ringRef = useRef<THREE.InstancedMesh>(null!);
  const lane = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    dashes.forEach((d, i) => {
      tmp.position.set(d.x, 0.12, d.z);
      tmp.rotation.set(-Math.PI / 2, 0, d.rot);
      tmp.scale.set(0.35, 2.4, 1);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ringDashes.forEach((a, i) => {
      tmp.position.set(Math.cos(a) * RING_R, 0.12, Math.sin(a) * RING_R);
      tmp.rotation.set(-Math.PI / 2, 0, -a);
      tmp.scale.set(0.35, 3.2, 1);
      tmp.updateMatrix();
      ringRef.current.setMatrixAt(i, tmp.matrix);
    });
    ringRef.current.instanceMatrix.needsUpdate = true;
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(1);
    let i = 0;
    for (const k of ROADS) {
      if (k !== 0) { // x=0 vertical lane is replaced by the wide main road below
        tmp.rotation.set(-Math.PI / 2, 0, 0);
        tmp.position.set(k, 0.07, 0); tmp.scale.set(ROAD_W, SPAN * 2, 1); tmp.updateMatrix();
        lane.current.setMatrixAt(i++, tmp.matrix);
      }
      tmp.position.set(0, 0.07, k); tmp.scale.set(SPAN * 2, ROAD_W, 1); tmp.updateMatrix();
      lane.current.setMatrixAt(i++, tmp.matrix);
    }
    // the MAIN ROAD (protest march strip) + the central vista to parliament
    tmp.rotation.set(-Math.PI / 2, 0, 0);
    tmp.position.set(MAIN_ROAD.x, 0.07, (MAIN_ROAD.z0 + MAIN_ROAD.z1) / 2);
    tmp.scale.set(MAIN_ROAD.w, MAIN_ROAD.z1 - MAIN_ROAD.z0, 1); tmp.updateMatrix();
    lane.current.setMatrixAt(i++, tmp.matrix);
    tmp.position.set(AVENUE.x, 0.07, (AVENUE.z0 + AVENUE.z1) / 2);
    tmp.scale.set(AVENUE.w, AVENUE.z0 - AVENUE.z1, 1); tmp.updateMatrix();
    lane.current.setMatrixAt(i++, tmp.matrix);
    tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1);
    lane.current.instanceMatrix.needsUpdate = true;
  }, [dashes, ringDashes]);
  return (
    <>
      <instancedMesh ref={lane} args={[undefined, undefined, 11]}>
        <planeGeometry />
        <meshLambertMaterial color="#4a4a52" />
      </instancedMesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.08}>
        <ringGeometry args={[RING_R - RING_W / 2, RING_R + RING_W / 2, 96]} />
        <meshLambertMaterial color="#45454d" />
      </mesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, ringDashes.length]}>
        <planeGeometry />
        <meshBasicMaterial color="#f8f4e8" />
      </instancedMesh>
      <instancedMesh ref={ref} args={[undefined, undefined, dashes.length]}>
        <planeGeometry />
        <meshBasicMaterial color="#f8f4e8" />
      </instancedMesh>
    </>
  );
}

/* ------------------------- buildings (towers / shops / homes / landmarks) ------------------------- */
function Buildings() {
  const walls = useRef<THREE.InstancedMesh>(null!);
  const flats = useRef<THREE.InstancedMesh>(null!);
  const pyrms = useRef<THREE.InstancedMesh>(null!);
  const trims = useRef<THREE.InstancedMesh>(null!);
  const doors = useRef<THREE.InstancedMesh>(null!);
  const counts = useMemo(() => {
    let flats = 0, pyrms = 0, trims = 0, doors = 0;
    for (const b of WORLD.buildings) {
      if (b.kind === 2 || b.kind === 6) pyrms++; else flats++;
      if (b.kind === 1) trims += 2; // awning + sign
      if (b.kind === 1 || b.kind === 2) doors++;
    }
    return { flats, pyrms, trims, doors };
  }, []);

  useLayoutEffect(() => {
    let wi = 0, fi = 0, pi = 0, ti = 0, di = 0;
    WORLD.buildings.forEach((b) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(b.x, b.h / 2, b.z);
      tmp.scale.set(b.w * 2, b.h, b.d * 2);
      tmp.updateMatrix();
      walls.current.setMatrixAt(wi, tmp.matrix);
      walls.current.setColorAt(wi, col.setHex(b.color));
      wi++;
      if (b.kind === 2 || b.kind === 6) {
        const rh = b.kind === 6 ? 3.4 : 2.3;
        tmp.position.set(b.x, b.h + rh / 2, b.z);
        tmp.rotation.set(0, Math.PI / 4, 0);
        tmp.scale.set(b.w * 2 * 0.78, rh, b.d * 2 * 0.78);
        tmp.updateMatrix();
        pyrms.current.setMatrixAt(pi, tmp.matrix);
        pyrms.current.setColorAt(pi, col.setHex(b.roof));
        pi++;
      } else {
        tmp.position.set(b.x, b.h + 0.45, b.z);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.set(b.w * 2 + 1.1, 0.9, b.d * 2 + 1.1);
        tmp.updateMatrix();
        flats.current.setMatrixAt(fi, tmp.matrix);
        flats.current.setColorAt(fi, col.setHex(b.roof));
        fi++;
      }
      if (b.kind === 1) {
        tmp.rotation.set(0, 0, 0);
        tmp.position.set(b.x, 3.5, b.z + b.fz * (b.d + 0.85));
        tmp.scale.set(b.w * 1.85, 0.45, 2.1);
        tmp.updateMatrix();
        trims.current.setMatrixAt(ti, tmp.matrix);
        trims.current.setColorAt(ti, col.setHex(b.awn));
        ti++;
        tmp.position.set(b.x, 5.9, b.z + b.fz * (b.d + 0.16));
        tmp.scale.set(b.w * 1.5, 1.15, 0.35);
        tmp.updateMatrix();
        trims.current.setMatrixAt(ti, tmp.matrix);
        trims.current.setColorAt(ti, col.setHex(b.roof));
        ti++;
      }
      if (b.kind === 1 || b.kind === 2) {
        tmp.rotation.set(0, 0, 0);
        tmp.position.set(b.kind === 2 ? b.x + b.fz * 0.9 : b.x, 1.25, b.z + b.fz * (b.d + 0.1));
        tmp.scale.set(1.4, 2.5, 1);
        tmp.updateMatrix();
        doors.current.setMatrixAt(di, tmp.matrix);
        di++;
      }
    });
    walls.current.instanceMatrix.needsUpdate = true;
    flats.current.instanceMatrix.needsUpdate = true;
    pyrms.current.instanceMatrix.needsUpdate = true;
    trims.current.instanceMatrix.needsUpdate = true;
    doors.current.instanceMatrix.needsUpdate = true;
    walls.current.count = wi; flats.current.count = fi; pyrms.current.count = pi;
    trims.current.count = ti; doors.current.count = di;
    for (const m of [walls, flats, pyrms, trims]) {
      if (m.current.instanceColor) m.current.instanceColor.needsUpdate = true;
    }
  }, [counts]);

  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, WORLD.buildings.length]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={flats} args={[undefined, undefined, Math.max(1, counts.flats)]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={pyrms} args={[undefined, undefined, Math.max(1, counts.pyrms)]}>
        <coneGeometry args={[1, 1, 4]} />
        <meshLambertMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={trims} args={[undefined, undefined, Math.max(1, counts.trims)]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={doors} args={[undefined, undefined, Math.max(1, counts.doors)]}>
        <boxGeometry />
        <meshLambertMaterial color="#4a382c" />
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
        <cylinderGeometry args={[0.34, 0.52, 3.2, 5]} />
      </instancedMesh>
      <instancedMesh ref={tiers} args={[undefined, undefined, Math.max(1, n.pine * 3)]} material={pineMat}>
        <coneGeometry args={[1, 1, 6]} />
      </instancedMesh>
      <instancedMesh ref={blobs} args={[undefined, undefined, Math.max(1, n.round * 5)]} material={blobMat}>
        <sphereGeometry args={[1, 6, 4]} />
      </instancedMesh>
    </>
  );
}

/* ------------------------- windows (day glass / night glow) ------------------------- */
interface WinInst { x: number; y: number; z: number; ry: number; w: number; h: number }

function Windows({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const glass = useRef<THREE.InstancedMesh>(null!);
  const glow = useRef<THREE.InstancedMesh>(null!);
  const { panes, lit } = useMemo(() => {
    const r = mulberry32(555);
    const panes: WinInst[] = [];
    const lit: WinInst[] = [];
    for (const b of WORLD.buildings) {
      if (b.kind === 3) continue; // mall has a glass atrium instead
      let floors: number, y0: number, dy: number, pw: number, ph: number, cols: number, sp: number;
      switch (b.kind) {
        case 0: floors = Math.min(6, Math.floor((b.h - 4) / 4.2)); y0 = 4.4; dy = 4.1; pw = 1.2; ph = 1.5; cols = Math.max(1, Math.min(3, Math.floor(b.w * 2 / 5))); sp = 3.1; break;
        case 1: floors = 1; y0 = 2.4; dy = 0; pw = 1.9; ph = 1.9; cols = 2; sp = 5.0; break;
        case 2: floors = 1; y0 = 3.6; dy = 0; pw = 0.95; ph = 1.05; cols = 2; sp = 3.0; break;
        case 4: floors = 2; y0 = 3.6; dy = 3.0; pw = 1.5; ph = 1.3; cols = 3; sp = 3.2; break;
        case 5: floors = 3; y0 = 3.8; dy = 3.6; pw = 1.3; ph = 1.4; cols = 3; sp = 3.2; break;
        default: floors = 1; y0 = 4.2; dy = 0; pw = 1.1; ph = 1.0; cols = 2; sp = 4.0; break; // barn
      }
      const spread = Math.min(sp, (b.w * 2) / (cols + 0.6));
      for (let f = 0; f < floors; f++) {
        const y = y0 + f * dy;
        if (y > b.h - 1.8) break;
        for (let c = 0; c < cols; c++) {
          const off = (c - (cols - 1) / 2) * spread;
          // front/back faces (±z)
          for (const sd of [-1, 1]) {
            const w: WinInst = { x: b.x + off, y, z: b.z + sd * (b.d + 0.07), ry: sd > 0 ? 0 : Math.PI, w: pw, h: ph };
            panes.push(w);
            if (r() < 0.68) lit.push(w);
          }
          // side faces (±x)
          for (const sd of [-1, 1]) {
            const w: WinInst = { x: b.x + sd * (b.w + 0.07), y, z: b.z + off, ry: sd > 0 ? Math.PI / 2 : -Math.PI / 2, w: pw, h: ph };
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
      tmp.scale.set(w.w, w.h, 1);
      tmp.updateMatrix();
      glass.current.setMatrixAt(i, tmp.matrix);
    });
    glass.current.instanceMatrix.needsUpdate = true;
  }, [panes]);
  useLayoutEffect(() => {
    lit.forEach((w, i) => {
      tmp.position.set(w.x, w.y, w.z);
      tmp.rotation.set(0, w.ry, 0);
      tmp.scale.set(w.w, w.h, 1);
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

/* ------------------------- cars: parked + ring traffic ------------------------- */
const CAR_COL_HEX = ["#e0483a", "#2a9d8f", "#f0c040", "#f2f2f2", "#8a5aa8", "#ff8c42", "#4aa3df", "#67b05f"];

function placeCar(
  body: THREE.InstancedMesh, cab: THREE.InstancedMesh, trim: THREE.InstancedMesh,
  wheels: THREE.InstancedMesh | null,
  i: number, x: number, y: number, z: number, rot: number, c: number,
) {
  const fx = Math.sin(rot), fz = Math.cos(rot);
  const cs = Math.cos(rot), sn = Math.sin(rot);
  tmp.rotation.set(0, rot, 0);
  tmp.position.set(x, y + 0.52, z);
  tmp.scale.set(1.9, 1.0, 4.4);
  tmp.updateMatrix();
  body.setMatrixAt(i, tmp.matrix);
  body.setColorAt(i, col.set(CAR_COL_HEX[c % CAR_COL_HEX.length]));
  tmp.position.set(x - fx * 0.4, y + 1.3, z - fz * 0.4);
  tmp.scale.set(1.66, 0.62, 2.05);
  tmp.updateMatrix();
  cab.setMatrixAt(i, tmp.matrix);
  cab.setColorAt(i, col.set("#9fd0e4"));
  tmp.position.set(x, y + 0.16, z);
  tmp.scale.set(2.02, 0.32, 4.55);
  tmp.updateMatrix();
  trim.setMatrixAt(i, tmp.matrix);
  trim.setColorAt(i, col.set("#14181d"));
  if (wheels) {
    for (let k = 0; k < 4; k++) {
      const lx = k % 2 === 0 ? -0.98 : 0.98;
      const lz = k < 2 ? -1.42 : 1.42;
      tmp.rotation.set(0, rot, Math.PI / 2);
      tmp.position.set(x + lx * cs + lz * sn, y + 0.42, z - lx * sn + lz * cs);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      wheels.setMatrixAt(i * 4 + k, tmp.matrix);
    }
  }
}

function Cars() {
  const body = useRef<THREE.InstancedMesh>(null!);
  const cab = useRef<THREE.InstancedMesh>(null!);
  const trim = useRef<THREE.InstancedMesh>(null!);
  const wheels = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    WORLD.cars.forEach((c, i) => placeCar(body.current, cab.current, trim.current, wheels.current, i, c.x, 0, c.z, c.rot, c.c));
    body.current.instanceMatrix.needsUpdate = true;
    cab.current.instanceMatrix.needsUpdate = true;
    trim.current.instanceMatrix.needsUpdate = true;
    wheels.current.instanceMatrix.needsUpdate = true;
    if (body.current.instanceColor) body.current.instanceColor.needsUpdate = true;
    if (cab.current.instanceColor) cab.current.instanceColor.needsUpdate = true;
    if (trim.current.instanceColor) trim.current.instanceColor.needsUpdate = true;
  }, []);
  const n = Math.max(1, WORLD.cars.length);
  return (
    <>
      <instancedMesh ref={body} args={[undefined, undefined, n]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={cab} args={[undefined, undefined, n]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={trim} args={[undefined, undefined, n]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={wheels} args={[undefined, undefined, n * 4]}>
        <cylinderGeometry args={[0.42, 0.42, 0.34, 6]} />
        <meshLambertMaterial color="#171a1f" />
      </instancedMesh>
    </>
  );
}

/** Little cars cruising the ring highway, GTA-style. */
function RingTraffic() {
  const N = 10;
  const data = useMemo(() => Array.from({ length: N }, (_, i) => ({
    r: i % 2 === 0 ? RING_R - 2.7 : RING_R + 2.7,
    dir: i % 2 === 0 ? 1 : -1,
    a: (i / N) * Math.PI * 2,
    sp: 0.05 + (i % 3) * 0.014,
    c: (i * 3 + 1) % CAR_COL_HEX.length,
  })), []);
  const body = useRef<THREE.InstancedMesh>(null!);
  const cab = useRef<THREE.InstancedMesh>(null!);
  const trim = useRef<THREE.InstancedMesh>(null!);
  const wheels = useRef<THREE.InstancedMesh>(null!);
  useFrame((s) => {
    data.forEach((d, i) => {
      const a = d.a + s.clock.elapsedTime * d.sp * d.dir;
      const rot = d.dir > 0 ? -a : Math.PI + a;
      placeCar(body.current, cab.current, trim.current, wheels.current, i, Math.cos(a) * d.r, 0.07, Math.sin(a) * d.r, rot, d.c);
    });
    body.current.instanceMatrix.needsUpdate = true;
    cab.current.instanceMatrix.needsUpdate = true;
    trim.current.instanceMatrix.needsUpdate = true;
    wheels.current.instanceMatrix.needsUpdate = true;
    if (body.current.instanceColor) body.current.instanceColor.needsUpdate = true;
    if (cab.current.instanceColor) cab.current.instanceColor.needsUpdate = true;
    if (trim.current.instanceColor) trim.current.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={body} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={cab} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={trim} args={[undefined, undefined, N]} frustumCulled={false}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={wheels} args={[undefined, undefined, N * 4]} frustumCulled={false}>
        <cylinderGeometry args={[0.42, 0.42, 0.34, 6]} />
        <meshLambertMaterial color="#171a1f" />
      </instancedMesh>
    </>
  );
}

/* ------------------------- street lamps (glow at night) ------------------------- */
function Lamps({ clockRef }: { clockRef: React.MutableRefObject<number> }) {
  const pole = useRef<THREE.InstancedMesh>(null!);
  const head = useRef<THREE.InstancedMesh>(null!);
  const glow = useRef<THREE.InstancedMesh>(null!);
  const n = Math.max(1, WORLD.lamps.length);
  useLayoutEffect(() => {
    WORLD.lamps.forEach((l, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(l.x, 2.8, l.z);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      pole.current.setMatrixAt(i, tmp.matrix);
      tmp.position.set(l.x, 5.62, l.z);
      tmp.updateMatrix();
      head.current.setMatrixAt(i, tmp.matrix);
      glow.current.setMatrixAt(i, tmp.matrix);
    });
    pole.current.instanceMatrix.needsUpdate = true;
    head.current.instanceMatrix.needsUpdate = true;
    glow.current.instanceMatrix.needsUpdate = true;
  }, []);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(() => {
    const nf = nightFactor(clockRef.current);
    if (glowMat.current) {
      glowMat.current.opacity = Math.max(0, nf - 0.3) * 1.4 * (0.85 + Math.sin(performance.now() / 620) * 0.08);
      glow.current.visible = glowMat.current.opacity > 0.02;
    }
  });
  return (
    <>
      <instancedMesh ref={pole} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.09, 0.14, 5.6, 6]} />
        <meshLambertMaterial color="#3a3f46" />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, n]}>
        <sphereGeometry args={[0.34, 8, 6]} />
        <meshLambertMaterial color="#2f333a" />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, n]} frustumCulled={false} visible={false}>
        <sphereGeometry args={[0.62, 8, 6]} />
        <meshBasicMaterial ref={glowMat} color="#ffd76a" transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------- central park ------------------------- */
function Park() {
  const jet = useRef<THREE.Mesh>(null!);
  useFrame((s) => {
    if (jet.current) {
      const p = 1 + Math.sin(s.clock.elapsedTime * 2.6) * 0.22;
      jet.current.scale.set(p, 1 + Math.sin(s.clock.elapsedTime * 3.1) * 0.3, p);
    }
  });
  return (
    <group position={[PARK.x, 0, PARK.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.08}>
        <circleGeometry args={[PARK.r, 48]} />
        <meshLambertMaterial color="#5fb657" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.09}>
        <planeGeometry args={[PARK.r * 2, 7]} />
        <meshLambertMaterial color="#d9cfb2" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.09}>
        <planeGeometry args={[7, PARK.r * 2]} />
        <meshLambertMaterial color="#d9cfb2" />
      </mesh>
      {/* pond (collider at PARK.x-11, PARK.z+11) */}
      <group position={[-11, 0, 11]}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.11}>
          <circleGeometry args={[7.4, 32]} />
          <meshLambertMaterial color="#4fa8d8" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.1}>
          <ringGeometry args={[7.4, 8.7, 32]} />
          <meshLambertMaterial color="#b8b0a0" />
        </mesh>
      </group>
      {/* fountain */}
      <mesh position-y={0.5}><cylinderGeometry args={[3, 3.3, 1, 16]} /><meshLambertMaterial color="#cfc4ae" /></mesh>
      <mesh position-y={0.99}><cylinderGeometry args={[2.55, 2.55, 0.14, 16]} /><meshLambertMaterial color="#5db4e0" /></mesh>
      <mesh position-y={1.75}><cylinderGeometry args={[0.45, 0.62, 1.6, 10]} /><meshLambertMaterial color="#cfc4ae" /></mesh>
      <mesh position-y={2.62}><cylinderGeometry args={[1.25, 1, 0.45, 12]} /><meshLambertMaterial color="#cfc4ae" /></mesh>
      <mesh ref={jet} position-y={3.35}><coneGeometry args={[0.3, 1.5, 8]} /><meshLambertMaterial color="#9fd8f0" transparent opacity={0.85} /></mesh>
    </group>
  );
}

function Benches() {
  const seat = useRef<THREE.InstancedMesh>(null!);
  const back = useRef<THREE.InstancedMesh>(null!);
  const n = Math.max(1, WORLD.benches.length);
  useLayoutEffect(() => {
    WORLD.benches.forEach((b, i) => {
      tmp.rotation.set(0, b.rot, 0);
      tmp.position.set(b.x, 0.55, b.z);
      tmp.scale.set(1.9, 0.16, 0.6);
      tmp.updateMatrix();
      seat.current.setMatrixAt(i, tmp.matrix);
      tmp.position.set(b.x - 0.26 * Math.sin(b.rot), 0.98, b.z - 0.26 * Math.cos(b.rot));
      tmp.scale.set(1.9, 0.55, 0.12);
      tmp.updateMatrix();
      back.current.setMatrixAt(i, tmp.matrix);
    });
    seat.current.instanceMatrix.needsUpdate = true;
    back.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <>
      <instancedMesh ref={seat} args={[undefined, undefined, n]}>
        <boxGeometry />
        <meshLambertMaterial color="#8a5a33" />
      </instancedMesh>
      <instancedMesh ref={back} args={[undefined, undefined, n]}>
        <boxGeometry />
        <meshLambertMaterial color="#7a4a28" />
      </instancedMesh>
    </>
  );
}

function Umbrellas() {
  const pole = useRef<THREE.InstancedMesh>(null!);
  const canopy = useRef<THREE.InstancedMesh>(null!);
  const cols = ["#e0483a", "#2a9d8f"];
  const n = Math.max(1, WORLD.umbrellas.length);
  useLayoutEffect(() => {
    WORLD.umbrellas.forEach((u, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(u.x, 1.35, u.z);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      pole.current.setMatrixAt(i, tmp.matrix);
      tmp.position.set(u.x, 2.85, u.z);
      tmp.updateMatrix();
      canopy.current.setMatrixAt(i, tmp.matrix);
      canopy.current.setColorAt(i, col.set(cols[u.c % cols.length]));
    });
    pole.current.instanceMatrix.needsUpdate = true;
    canopy.current.instanceMatrix.needsUpdate = true;
    if (canopy.current.instanceColor) canopy.current.instanceColor.needsUpdate = true;
  }, []);
  return (
    <>
      <instancedMesh ref={pole} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.06, 0.06, 2.7, 6]} />
        <meshLambertMaterial color="#e8e2d4" />
      </instancedMesh>
      <instancedMesh ref={canopy} args={[undefined, undefined, n]}>
        <coneGeometry args={[1.75, 0.85, 8]} />
        <meshLambertMaterial flatShading />
      </instancedMesh>
    </>
  );
}

/* ------------------------- farmland: fields, silos, windmills ------------------------- */
const CROP_COL_HEX = ["#9ec24a", "#d8c25a", "#6faf4e"];

function Farm() {
  const crops = useRef<THREE.InstancedMesh>(null!);
  const cropData = useMemo(() => {
    const out: { x: number; z: number; rot: number; crop: number }[] = [];
    for (const f of WORLD.fields) {
      for (let lx = -f.w + 1; lx <= f.w - 1; lx += 1.8)
        for (let lz = -f.d + 1.1; lz <= f.d - 1.1; lz += 2.0) {
          const c = Math.cos(f.rot), s = Math.sin(f.rot);
          out.push({ x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c, rot: f.rot, crop: f.crop });
        }
    }
    return out;
  }, []);
  useLayoutEffect(() => {
    cropData.forEach((c, i) => {
      tmp.rotation.set(0, c.rot, 0);
      tmp.position.set(c.x, 0.32, c.z);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      crops.current.setMatrixAt(i, tmp.matrix);
      crops.current.setColorAt(i, col.set(CROP_COL_HEX[c.crop]));
    });
    crops.current.instanceMatrix.needsUpdate = true;
    if (crops.current.instanceColor) crops.current.instanceColor.needsUpdate = true;
  }, [cropData]);

  const siloB = useRef<THREE.InstancedMesh>(null!);
  const siloT = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    WORLD.silos.forEach((s, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(s.x, 5.5, s.z);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      siloB.current.setMatrixAt(i, tmp.matrix);
      tmp.position.set(s.x, 11.02, s.z);
      tmp.updateMatrix();
      siloT.current.setMatrixAt(i, tmp.matrix);
    });
    siloB.current.instanceMatrix.needsUpdate = true;
    siloT.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <>
      {WORLD.fields.map((f, i) => (
        <group key={i} position={[f.x, 0, f.z]} rotation-y={f.rot}>
          <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
            <planeGeometry args={[f.w * 2, f.d * 2]} />
            <meshLambertMaterial color="#6b4f35" />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={crops} args={[undefined, undefined, Math.max(1, cropData.length)]}>
        <boxGeometry args={[0.6, 0.55, 1.35]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={siloB} args={[undefined, undefined, Math.max(1, WORLD.silos.length)]}>
        <cylinderGeometry args={[3, 3, 11, 12]} />
        <meshLambertMaterial color="#ccd2d8" />
      </instancedMesh>
      <instancedMesh ref={siloT} args={[undefined, undefined, Math.max(1, WORLD.silos.length)]}>
        <sphereGeometry args={[3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color="#b8bec6" />
      </instancedMesh>
      <Windmills />
    </>
  );
}

function Windmills() {
  const rotors = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, dt) => {
    rotors.current.forEach((r) => { if (r) r.rotation.z += dt * 0.85; });
  });
  return (
    <>
      {WORLD.windmills.map((w, i) => (
        <group key={i} position={[w.x, 0, w.z]} rotation-y={w.rot}>
          <mesh position-y={5.5}><cylinderGeometry args={[0.42, 0.68, 11, 8]} /><meshLambertMaterial color="#e8e2d4" /></mesh>
          <group ref={(g) => { rotors.current[i] = g; }} position={[0, 11, 0.55]} rotation-z={i * 0.7}>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} rotation-z={k * Math.PI / 2} position={[0, 2.1, 0]}>
                <boxGeometry args={[0.5, 4.2, 0.14]} />
                <meshLambertMaterial color="#f8f4e8" />
              </mesh>
            ))}
          </group>
          <mesh position={[0, 11, 1.05]}><boxGeometry args={[0.12, 1.7, 0.9]} /><meshLambertMaterial color="#c0442e" /></mesh>
        </group>
      ))}
    </>
  );
}

/* ------------------------- landmarks: mall front, school yard, hospital cross ------------------------- */
function Landmarks() {
  return (
    <>
      {/* MEGA MALL — glass atrium, roof sign, parking lot */}
      <group position={[MALL.x, 0, MALL.z]}>
        <mesh rotation-x={-Math.PI / 2} position={[0.25, 0.07, -26]}>
          <planeGeometry args={[46, 26]} />
          <meshLambertMaterial color="#565660" />
        </mesh>
        <mesh position={[0, 4.6, -11.06]}>
          <planeGeometry args={[26, 9]} />
          <meshLambertMaterial color="#a8d4e8" side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.9, -11.2]}>
          <boxGeometry args={[6.5, 3.8, 0.5]} />
          <meshLambertMaterial color="#3a3f46" />
        </mesh>
        <mesh position={[0, 17.4, 0]}>
          <boxGeometry args={[24, 3.2, 1]} />
          <meshLambertMaterial color="#d62828" />
        </mesh>
        {[-7.8, -2.6, 2.6, 7.8].map((x) => (
          <mesh key={x} position={[x, 17.4, -0.75]}>
            <boxGeometry args={[2.6, 2.1, 0.4]} />
            <meshLambertMaterial color="#f8f4e8" />
          </mesh>
        ))}
        {[-9, 9].map((x) => (
          <mesh key={x} position={[x, 16.3, 0]}>
            <boxGeometry args={[0.5, 2.2, 0.5]} />
            <meshLambertMaterial color="#8a8f98" />
          </mesh>
        ))}
      </group>
      {/* School — yard, running track, flag, basketball hoop */}
      <group position={[SCHOOL.x, 0, SCHOOL.z]}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, -18]}>
          <circleGeometry args={[14, 40]} />
          <meshLambertMaterial color="#7ec868" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.08, -18]} scale={[1, 0.72, 1]}>
          <ringGeometry args={[10.5, 12.3, 40]} />
          <meshLambertMaterial color="#d8734a" />
        </mesh>
        <mesh position={[-10, 3.5, -12]}><cylinderGeometry args={[0.1, 0.12, 7, 6]} /><meshLambertMaterial color="#8a8a98" /></mesh>
        <mesh position={[-8.9, 6.2, -12]} rotation-y={Math.PI / 2}><planeGeometry args={[2.2, 1.3]} /><meshBasicMaterial color="#ff9933" side={THREE.DoubleSide} /></mesh>
        <mesh position={[12, 2.5, -10]}><cylinderGeometry args={[0.12, 0.14, 5, 6]} /><meshLambertMaterial color="#3a3f46" /></mesh>
        <mesh position={[12, 4.7, -10.35]}><boxGeometry args={[2.6, 1.7, 0.16]} /><meshLambertMaterial color="#f4f6f8" /></mesh>
        <mesh position={[12, 3.95, -10.7]} rotation-x={Math.PI / 2}><torusGeometry args={[0.55, 0.08, 6, 14]} /><meshLambertMaterial color="#ff6b35" /></mesh>
      </group>
      {/* Hospital — big red cross + entrance canopy */}
      <group position={[HOSPITAL.x, 0, HOSPITAL.z]}>
        <mesh position={[0, 12.4, -6.62]}><boxGeometry args={[1.7, 5.2, 0.22]} /><meshBasicMaterial color="#d62828" /></mesh>
        <mesh position={[0, 12.4, -6.62]}><boxGeometry args={[5.2, 1.7, 0.22]} /><meshBasicMaterial color="#d62828" /></mesh>
        <mesh position={[0, 3.5, -8.2]}><boxGeometry args={[7, 0.5, 3.2]} /><meshLambertMaterial color="#c7ccd4" /></mesh>
        {[-3, 3].map((x) => (
          <mesh key={x} position={[x, 1.7, -9.4]}><cylinderGeometry args={[0.14, 0.14, 3.4, 6]} /><meshLambertMaterial color="#9aa0a8" /></mesh>
        ))}
      </group>
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
      <sphereGeometry args={[0.22, 5, 3]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

/* --------- mountains: procedural ridged silhouettes (no more plain cones) --------- */
const ROCK_COLS = ["#989083", "#867d70", "#a29586", "#939aa6", "#8d8375"];
const HILL_COLS = ["#5d8a4a", "#527e42", "#68964f", "#4e7a40"];
const BASE_GRASS = new THREE.Color("#71875c");
const SCRUB_COL = new THREE.Color("#5c6e54");
const SNOW_COL = new THREE.Color("#f4f7fb");
const SNOW_SHADE = new THREE.Color("#c9d5e2");

/** deterministic 2d hash → [0,1) */
const hash2 = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

interface Peak {
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
}

/** Radial silhouette multiplier: fluted ridges + one steep / one gentle flank. */
function ridgeMul(p: Peak, a: number): number {
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
const profile = (t: number, k: number) =>
  Math.pow(1 - t, k) * (1 + 0.14 * Math.pow(Math.sin(Math.min(1, t) * Math.PI), 2));

/** Bake every peak & foothill into one merged geometry with per-face rock/snow/grass colors. */
function buildMountainGeometry(peaks: Peak[]): THREE.BufferGeometry {
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
    const hf = ((ay + by + cy) / 3 + 4) / p.h; // height fraction (base sunk 4 units)
    const hsh = hash2(fi * 1.7 + p.seed, 3.3);
    // Snow settles above the peak's snowline on gentler faces; steep crags stay rocky.
    const snowy = hf > p.snow + (hsh - 0.5) * 0.09 && (ny > 0.6 || hf > p.snow + 0.12);
    if (snowy) {
      cB.copy(SNOW_COL).offsetHSL(0, 0, (hsh - 0.5) * 0.045);
      const shade = Math.min(1, Math.max(0, -jAvg * 4 + (1 - ny) * 0.6)) * 0.5;
      cB.lerp(SNOW_SHADE, shade);
    } else {
      cA.set((p.green ? HILL_COLS : ROCK_COLS)[p.ci]).offsetHSL(0, 0, p.tint);
      const light =
        (hsh - 0.5) * 0.06 +
        jAvg * 0.5 -                                      // crevices darker than ridges
        (1 - Math.max(0, ny)) * 0.045 +                   // steep walls darker
        (hash2(fi * 2.3, p.seed + 9.1) - 0.5) * 0.03;     // faint strata banding
      cB.copy(cA).offsetHSL(0, 0, light);
      if (!p.green && hf < 0.16) cB.lerp(BASE_GRASS, ((0.16 - hf) / 0.16) * 0.6);
      // scrub/forest band on gentler mid-slopes (cliffs stay bare rock)
      const forest = Math.max(0, 1 - Math.abs(hf - 0.26) / 0.16) * Math.max(0, (ny - 0.4) / 0.35);
      if (!p.green && forest > 0) cB.lerp(SCRUB_COL, Math.min(1, forest) * 0.45);
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
    const rings: { x: number; y: number; z: number; j: number }[][] = [];
    for (let i = 0; i < H; i++) {
      const t = (i / (H - 1)) * p.topT;
      const pr = profile(t, p.k) * (p.green ? 1.15 : 1);
      const y0 = -4 + t * p.h;
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
    const apexBaseY = -4 + (p.topT + 0.025 + hash2(p.seed, 4.2) * 0.035) * p.h;
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

function Mountains() {
  const geo = useMemo(() => {
    const r = mulberry32(7);
    // Major peaks — heights cluster by sector so some directions are huge snowy
    // ranges and others are low rocky hills, instead of a uniform spike fence.
    // Wide bases (h/w < ~1) + strong flank asymmetry keep silhouettes massif-like,
    // never isoceles-triangle.
    const majors: Peak[] = Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + range(r, -0.06, 0.06);
      const cl = 0.5 + 0.5 * Math.sin(2 * a + 1.7) * Math.sin(3 * a + 0.6); // 0..1
      const h = 58 + cl * 96 + range(r, -10, 10);
      const d = 424 + cl * 48 + range(r, -22, 22);
      const w = range(r, 96, 172) + cl * 52;
      return {
        x: Math.cos(a) * d, z: Math.sin(a) * d, h, w,
        rot: range(r, 0, Math.PI * 2),
        sx: range(r, 0.78, 1.22), sz: range(r, 0.78, 1.22),
        ci: i % ROCK_COLS.length, tint: range(r, -0.045, 0.055),
        snow: h > 120 ? range(r, 0.5, 0.62) : h > 88 ? range(r, 0.58, 0.72) : range(r, 0.74, 0.9),
        seed: 11 + i * 3.17,
        k: range(r, 1.25, 1.85),
        skew: range(r, 0.14, 0.3),
        amp: [range(r, 0.18, 0.34), range(r, 0.1, 0.19), range(r, 0.05, 0.12)],
        ph: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)],
        jit: range(r, 0.18, 0.32),
        topT: range(r, 0.6, 0.85),
        green: false,
      };
    });
    // Shoulder peaks — cluster beside majors to form connected massifs.
    const shoulders: Peak[] = [];
    majors.forEach((m, i) => {
      const nSh = r() < 0.35 ? 3 : r() < 0.7 ? 2 : 1;
      for (let k = 0; k < nSh; k++) {
        const a = Math.atan2(m.z, m.x) + (k === 0 ? 1 : -1) * range(r, 0.02, 0.065);
        const d = Math.hypot(m.x, m.z) + range(r, -46, 56);
        const h = m.h * range(r, 0.42, 0.7);
        shoulders.push({
          x: Math.cos(a) * d, z: Math.sin(a) * d, h,
          w: m.w * range(r, 0.52, 0.85),
          rot: range(r, 0, Math.PI * 2),
          sx: range(r, 0.85, 1.18), sz: range(r, 0.85, 1.18),
          ci: (i + k + 1) % ROCK_COLS.length, tint: range(r, -0.04, 0.05),
          snow: h > 78 ? range(r, 0.6, 0.74) : h > 45 ? range(r, 0.72, 0.85) : range(r, 0.85, 0.96),
          seed: 71 + i * 7.7 + k * 2.9,
          k: range(r, 1.2, 1.7),
          skew: range(r, 0.1, 0.24),
          amp: [range(r, 0.15, 0.28), range(r, 0.09, 0.17), range(r, 0.04, 0.11)],
          ph: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)],
          jit: range(r, 0.15, 0.26),
          topT: range(r, 0.62, 0.88),
          green: false,
        });
      }
    });
    // Lumpy grassy foothills, kept outside the playable ring.
    const hills: Peak[] = Array.from({ length: 44 }, (_, i) => {
      const a = range(r, 0, Math.PI * 2), d = range(r, 408, 448);
      return {
        x: Math.cos(a) * d, z: Math.sin(a) * d,
        h: range(r, 14, 30), w: range(r, 30, 62),
        rot: range(r, 0, Math.PI * 2),
        sx: range(r, 0.85, 1.2), sz: range(r, 0.85, 1.2),
        ci: i % HILL_COLS.length, tint: range(r, -0.05, 0.06),
        snow: 2, seed: 211 + i * 5.3,
        k: range(r, 0.5, 0.62),
        skew: range(r, 0.08, 0.18),
        amp: [range(r, 0.12, 0.22), range(r, 0.08, 0.16), range(r, 0.05, 0.1)],
        ph: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)],
        jit: range(r, 0.16, 0.24),
        topT: range(r, 0.82, 0.92),
        green: true,
      };
    });
    return buildMountainGeometry([...majors, ...shoulders, ...hills]);
  }, []);

  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), []);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

/* ------------------------- parliament + ballot (Delhi Sansad Bhavan style) ------------------------- */
function Parliament() {
  const flag = useRef<THREE.Group>(null!);
  const cols = useRef<THREE.InstancedMesh>(null!);
  useFrame((s) => {
    if (flag.current) flag.current.rotation.y = Math.sin(s.clock.elapsedTime * 3) * 0.2;
  });
  // circular colonnade — 18 pillars ringing the house, like the real Sansad Bhavan
  const colAngles = useMemo(() => Array.from({ length: 18 }, (_, i) => (i / 18) * Math.PI * 2), []);
  useLayoutEffect(() => {
    colAngles.forEach((a, i) => {
      tmp.position.set(Math.cos(a) * 20, 7.4, Math.sin(a) * 20);
      tmp.rotation.set(0, -a, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      cols.current.setMatrixAt(i, tmp.matrix);
    });
    cols.current.instanceMatrix.needsUpdate = true;
  }, [colAngles]);
  return (
    <group position={[PARLIAMENT.x, 0, PARLIAMENT.z]}>
      {/* plaza + circular sandstone podium */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 8]}>
        <circleGeometry args={[38, 48]} />
        <meshLambertMaterial color="#cfc4ae" />
      </mesh>
      <mesh position-y={1.4}><cylinderGeometry args={[24, 25.5, 2.8, 48]} /><meshLambertMaterial color="#d9cfb8" /></mesh>
      {/* wide front steps (south, facing the vista) */}
      <mesh position={[0, 2.35, 20]}><boxGeometry args={[20, 0.8, 8]} /><meshLambertMaterial color="#d9cfb8" /></mesh>
      <mesh position={[0, 3.1, 22]}><boxGeometry args={[15, 0.8, 5]} /><meshLambertMaterial color="#cfc4ae" /></mesh>
      {/* colonnade ring */}
      <instancedMesh ref={cols} args={[undefined, undefined, 18]}>
        <cylinderGeometry args={[0.85, 1, 9.5, 8]} />
        <meshLambertMaterial color="#f8f4e8" />
      </instancedMesh>
      <mesh position-y={12.9}><cylinderGeometry args={[22, 22, 1.8, 48]} /><meshLambertMaterial color="#e8e0d0" /></mesh>
      {/* drum + green copper dome */}
      <mesh position-y={17.7}><cylinderGeometry args={[15, 15.5, 8, 32]} /><meshLambertMaterial color="#e8e0d0" /></mesh>
      <mesh position-y={23.2} scale={[1, 0.72, 1]}><sphereGeometry args={[12, 24, 16]} /><meshLambertMaterial color="#7fc8a9" /></mesh>
      {/* tricolour flag */}
      <mesh position-y={30.4}><cylinderGeometry args={[0.14, 0.14, 6, 6]} /><meshLambertMaterial color="#8a8a98" /></mesh>
      <group ref={flag} position={[0, 33, 0]}>
        <mesh position-y={1}><planeGeometry args={[4.6, 0.95]} /><meshBasicMaterial color="#ff9933" side={THREE.DoubleSide} /></mesh>
        <mesh position-y={0}><planeGeometry args={[4.6, 0.95]} /><meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} /></mesh>
        <mesh position-y={-1}><planeGeometry args={[4.6, 0.95]} /><meshBasicMaterial color="#1a8f3c" side={THREE.DoubleSide} /></mesh>
        <mesh position-z={0.03}><circleGeometry args={[0.3, 16]} /><meshBasicMaterial color="#1a3a8f" /></mesh>
        <mesh position-z={-0.03} rotation-y={Math.PI}><circleGeometry args={[0.3, 16]} /><meshBasicMaterial color="#1a3a8f" /></mesh>
      </group>
    </group>
  );
}

/* ------------------------- protest life on the main road (old-game homage) ------------------------- */
function makeSignTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = fg; g.lineWidth = 14; g.strokeRect(12, 12, 488, 232);
  g.font = '900 58px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > 440 && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  lines.slice(0, 3).forEach((ln, i) =>
    g.fillText(ln, 256, 128 + (i - (lines.length - 1) / 2) * 66));
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

const SIGN_BG = ["#e8b13c", "#f5efdc", "#ff8c69"];
const SIGN_FG = ["#2c3947", "#b5432a", "#7a2d1e"];

function ProtestSigns() {
  const signs = WORLD.signs;
  const textures = useMemo(
    () => signs.map((s) => makeSignTexture(s.text, SIGN_BG[s.c] ?? SIGN_BG[0], SIGN_FG[s.c] ?? SIGN_FG[0])),
    [signs],
  );
  return (
    <>
      {signs.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation-y={s.rot}>
          <mesh position-y={1.1}><cylinderGeometry args={[0.07, 0.09, 2.2, 6]} /><meshLambertMaterial color="#8a6b4a" /></mesh>
          <mesh position={[0, 2.45, 0]} rotation-x={-0.06}>
            <planeGeometry args={[2.2, 1.1]} />
            <meshLambertMaterial map={textures[i]} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** India-Gate-style sandstone arch over the central vista (legs are real buildings). */
function VistaGate() {
  return (
    <group position={[GATE.x, 0, GATE.z]}>
      <mesh position-y={15.2}><boxGeometry args={[21, 2.6, 3]} /><meshLambertMaterial color="#d8c8a4" /></mesh>
      <mesh position-y={16.9}><boxGeometry args={[24, 1.4, 3.6]} /><meshLambertMaterial color="#cbb890" /></mesh>
      <mesh position-y={18.2}><boxGeometry args={[8, 1.6, 3.2]} /><meshLambertMaterial color="#d8c8a4" /></mesh>
    </group>
  );
}

/** Big protest banner strung across the MAIN ROAD. */
function ProtestBanner() {
  const tex = useMemo(() => makeSignTexture("MAIN ROAD PROTEST — JOIN THE MARCH!", "#b5432a", "#f5efdc"), []);
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((s) => {
    if (ref.current) ref.current.rotation.x = Math.sin(s.clock.elapsedTime * 1.6) * 0.035;
  });
  return (
    <mesh ref={ref} position={[PROTEST_CAMP.x, 9.3, PROTEST_CAMP.z]} rotation-x={Math.PI / 2}>
      <planeGeometry args={[26, 2.6]} />
      <meshLambertMaterial map={tex} side={THREE.DoubleSide} />
    </mesh>
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
    return Array.from({ length: 16 }, () => ({
      x: range(r, -560, 560), y: range(r, 95, 155), z: range(r, -560, 560),
      s: range(r, 15, 32), v: range(r, 1.2, 3.2), off: range(r, 0, 9),
    }));
  }, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    data.forEach((c, i) => {
      const x = ((c.x + t * c.v + 580) % 1160) - 580;
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
    <instancedMesh ref={ref} args={[undefined, undefined, 48]} frustumCulled={false}>
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
  // Reuse one fog instance (no per-frame allocation); a high day-far keeps the
  // mountain ring readable as real shapes instead of melting into the sky.
  const fog = useMemo(() => new THREE.Fog(0x8fd3ff, 120, 900), []);
  const PI2 = Math.PI * 2;
  useFrame(() => {
    const clock = clockRef.current;
    const n = nightFactor(clock);
    const h = Math.sin(PI2 * (clock - 0.25));
    const dk = Math.max(0, 1 - Math.abs(h) * 5);
    sky.copy(DAY).lerp(NIGHT, n);
    if (dk > 0) sky.lerp(DUSK, dk * 0.6);
    scene.background = sky;
    fog.color.copy(sky);
    fog.far = n > 0.5 ? 310 : 900;
    scene.fog = fog;
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
      <Disc r={780} color="#3f7a36" y={-0.12} />
      <Disc r={CITY_RADIUS} color="#9a968c" y={0} />
      <Ring a={CITY_RADIUS} b={FARM_RADIUS} color="#9cb84e" y={0.02} />
      <Ring a={FARM_RADIUS} b={JUNGLE_RADIUS} color="#2d7a3a" y={0.03} />
      <Disc r={GRAVEYARD.r} color="#3a3a46" y={0.06} x={GRAVEYARD.x} z={GRAVEYARD.z} />
      <Roads />
      <Buildings />
      <Windows clockRef={clockRef} />
      <Cars />
      <RingTraffic />
      <Lamps clockRef={clockRef} />
      <Park />
      <Benches />
      <Umbrellas />
      <Farm />
      <Landmarks />
      <Forest />
      <Graves />
      <Flowers />
      <Mountains />
      <Parliament />
      <BallotBox />
      <VistaGate />
      <ProtestSigns />
      <ProtestBanner />
      <Clouds />
      <Sky clockRef={clockRef} />
      <Fireflies clockRef={clockRef} />
    </>
  );
}
