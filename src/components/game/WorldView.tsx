"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  AIRPORT, CITY_RADIUS, DEEP_JUNGLE_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, MOUNTAIN_INNER, MOUNTAIN_OUTER, MUSEUM, POLICE_STATIONS, TREE_FALL_S, TREE_WOBBLE_S, WALL_RADIUS, stationCage, stationGate,
} from "@/lib/game/constants";
import {
  AVENUE, GATE, generateWorld, HOSPITAL, MALL, MAIN_ROAD, PARK, ROAD_W, ROADS, RING_R, RING_W, SCHOOL, TOWN_SQUARE, terrainHeight,
  type World,
} from "@/lib/game/worldgen";
import { nameTag } from "@/lib/game/character";
import { mulberry32, range } from "@/lib/game/rng";
import { nightFactor } from "@/lib/game/sim";
import { isKitType, kitWheelR, makeKitCar } from "@/lib/game/cars/kit";
import type { GameEngine } from "@/lib/game/engine";

export const WORLD: World = generateWorld();
const tmp = new THREE.Object3D();
tmp.rotation.order = "YXZ"; // lets placeCar rake the windshield around the car's own side axis
const col = new THREE.Color();

/* 🌳 tree-anim scratch — the chop-shudder & TIMBER-tumble matrix stack */
const _mSrc = new THREE.Matrix4();
const _mOut = new THREE.Matrix4();
const _mPivot = new THREE.Matrix4();
const _mInv = new THREE.Matrix4();
const _mRot = new THREE.Matrix4();
const _mScl = new THREE.Matrix4();
const _vAxis = new THREE.Vector3();

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
  const SPAN = 320;
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
    // the MAIN ROAD (town march strip) + the central vista to the museum
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
      <instancedMesh ref={lane} args={[undefined, undefined, 2 * ROADS.length + 2]}>
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

function Forest({ engine }: { engine: GameEngine }) {
  const trunks = useRef<THREE.InstancedMesh>(null!);
  const tiers = useRef<THREE.InstancedMesh>(null!);
  const blobs = useRef<THREE.InstancedMesh>(null!);
  const n = useMemo(() => {
    let pine = 0;
    for (const t of WORLD.trees) if (t.kind === 0) pine++;
    return { pine, round: WORLD.trees.length - pine };
  }, []);
  // First foliage-pool instance per tree (-1 = none): pine tiers pack 3 per tree,
  // round blobs pack 5 — lets a chop zero/restore exactly that tree's share.
  const share = useMemo(() => {
    const tier0 = new Int32Array(WORLD.trees.length).fill(-1);
    const blob0 = new Int32Array(WORLD.trees.length).fill(-1);
    let ti = 0, bi = 0;
    for (let i = 0; i < WORLD.trees.length; i++) {
      if (WORLD.trees[i].kind === 0) { tier0[i] = ti; ti += 3; }
      else { blob0[i] = bi; bi += 5; }
    }
    return { tier0, blob0 };
  }, []);
  // Pristine instance matrices — a felled tree can pop back on engine reset.
  const snap = useRef<{ trunks?: Float32Array; tiers?: Float32Array; blobs?: Float32Array }>({});
  const lastFell = useRef(-1);

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
      const deep = Math.hypot(t.x, t.z) > DEEP_JUNGLE_RADIUS ? 0.66 : 1; // deep-jungle canopy reads darker
      tmp.rotation.set(0, rot, 0);
      tmp.scale.set(t.s, t.s, t.s);
      tmp.position.set(t.x, 1.6 * t.s, t.z);
      tmp.updateMatrix();
      trunks.current.setMatrixAt(i, tmp.matrix);
      trunks.current.setColorAt(i, col.set(TRUNK_COLS[i % TRUNK_COLS.length]).multiplyScalar(deep ? 0.85 : 1));

      if (t.kind === 0) {
        const g = col.set(PINE_COLS[Math.floor(r() * PINE_COLS.length)]).clone();
        for (const tier of TIERS) {
          tmp.rotation.set(0, rot, 0);
          tmp.scale.set(tier.rad * t.s, tier.h * t.s * hm, tier.rad * t.s);
          tmp.position.set(t.x, tier.y * t.s * hm, t.z);
          tmp.updateMatrix();
          tiers.current.setMatrixAt(ti, tmp.matrix);
          tiers.current.setColorAt(ti, col.copy(g).multiplyScalar(tier.shade * deep));
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
          blobs.current.setColorAt(bi, col.copy(g).multiplyScalar(shade * deep));
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
    snap.current.trunks = (trunks.current.instanceMatrix.array as Float32Array).slice();
    snap.current.tiers = (tiers.current.instanceMatrix.array as Float32Array).slice();
    snap.current.blobs = (blobs.current.instanceMatrix.array as Float32Array).slice();
    lastFell.current = -1; // force the fell pass to re-apply after a rebuild
  }, [n]);

  // 7Nights fell pass — scale felled trees' instances to 0 (or restore on reset).
  // Only reruns when engine.fellVersion bumps; no per-chop geometry rebuilds.
  const putInst = (mesh: THREE.InstancedMesh, inst: number, src: Float32Array | null) => {
    const arr = mesh.instanceMatrix.array as Float32Array;
    const off = inst * 16;
    if (!src) arr.fill(0, off, off + 16);
    else arr.set(src.subarray(off, off + 16), off);
  };
  const applyFelled = () => {
    const st = snap.current;
    if (!st.trunks || !st.tiers || !st.blobs) return;
    for (let i = 0; i < WORLD.trees.length; i++) {
      const gone = engine.felled.has(i);
      putInst(trunks.current, i, gone ? null : st.trunks);
      const t0 = share.tier0[i];
      if (t0 >= 0) for (let k = 0; k < 3; k++) putInst(tiers.current, t0 + k, gone ? null : st.tiers);
      const b0 = share.blob0[i];
      if (b0 >= 0) for (let k = 0; k < 5; k++) putInst(blobs.current, b0 + k, gone ? null : st.blobs);
    }
    trunks.current.instanceMatrix.needsUpdate = true;
    tiers.current.instanceMatrix.needsUpdate = true;
    blobs.current.instanceMatrix.needsUpdate = true;
  };

  /* 🪓🌲 juice pass — a chopped tree SHUDDERS away from the axe, a felled tree
   * tips over and TUMBLES down (accelerating, like real timber) instead of
   * popping out of existence. Both animate the tree's own instances around the
   * trunk-base pivot, straight from the pristine snapshot matrices. */
  const chopVer = useRef(-1);
  const wobbling = useRef(new Map<number, { end: number; dx: number; dz: number }>());
  const falling = useRef(new Set<number>());

  /** Re-pose one tree (trunk + its canopy share) with a lean about the trunk
   * base, an overall squash, leaning toward tip (dx,dz). src=null → zeroed. */
  const poseTree = (i: number, lean: number, scl: number, dx: number, dz: number) => {
    const st = snap.current;
    if (!st.trunks || !st.tiers || !st.blobs) return;
    const t = WORLD.trees[i];
    _mPivot.makeTranslation(t.x, 0, t.z);
    _mInv.makeTranslation(-t.x, 0, -t.z);
    _vAxis.set(dz, 0, -dx).normalize(); // +lean tips the crown toward (dx,dz)
    _mRot.makeRotationAxis(_vAxis, lean);
    _mScl.makeScale(scl, scl, scl);
    const apply = (mesh: THREE.InstancedMesh, inst: number, src: Float32Array) => {
      const off = inst * 16;
      _mSrc.fromArray(src, off);
      _mOut.multiplyMatrices(_mPivot, _mRot).multiply(_mScl).multiply(_mInv).multiply(_mSrc);
      (mesh.instanceMatrix.array as Float32Array).set(_mOut.elements, off);
    };
    apply(trunks.current, i, st.trunks);
    const t0 = share.tier0[i];
    if (t0 >= 0) for (let k = 0; k < 3; k++) apply(tiers.current, t0 + k, st.tiers);
    const b0 = share.blob0[i];
    if (b0 >= 0) for (let k = 0; k < 5; k++) apply(blobs.current, b0 + k, st.blobs);
  };

  useFrame((s) => {
    WIND.value = s.clock.elapsedTime;
    // 🪓 per-chop shudder — the last-struck tree leans away from the axe and
    // springs back with a damped wobble
    if (engine.chopVersion !== chopVer.current) {
      chopVer.current = engine.chopVersion;
      if (engine.lastChop.i >= 0 && !engine.felled.has(engine.lastChop.i)) {
        wobbling.current.set(engine.lastChop.i, {
          end: s.clock.elapsedTime + TREE_WOBBLE_S,
          dx: engine.lastChop.dx, dz: engine.lastChop.dz,
        });
      }
    }
    if (engine.fellVersion !== lastFell.current) {
      lastFell.current = engine.fellVersion;
      applyFelled();
      // newly felled trees join the tumble until they flatten (reset empties it)
      falling.current.clear();
      for (const i of engine.felled) {
        const ft = engine.fellTimes.get(i);
        if (ft !== undefined && engine.elapsed - ft < TREE_FALL_S) falling.current.add(i);
      }
    }
    // per-frame anim pass — only while something is actually moving
    let dirty = false;
    for (const [i, wob] of wobbling.current) {
      if (s.clock.elapsedTime >= wob.end) {
        wobbling.current.delete(i);
        const st = snap.current;
        if (st.trunks && !engine.felled.has(i)) {
          putInst(trunks.current, i, st.trunks);
          const t0 = share.tier0[i];
          if (t0 >= 0) for (let k = 0; k < 3; k++) putInst(tiers.current, t0 + k, st.tiers);
          const b0 = share.blob0[i];
          if (b0 >= 0) for (let k = 0; k < 5; k++) putInst(blobs.current, b0 + k, st.blobs);
        }
        dirty = true;
        continue;
      }
      const k = 1 - (wob.end - s.clock.elapsedTime) / TREE_WOBBLE_S; // 0→1
      poseTree(i, Math.sin(k * Math.PI * 3.5) * 0.055 * (1 - k), 1, wob.dx, wob.dz);
      dirty = true;
    }
    for (const i of falling.current) {
      const ft = engine.fellTimes.get(i);
      const age = ft === undefined ? TREE_FALL_S : engine.elapsed - ft;
      if (age >= TREE_FALL_S) {
        falling.current.delete(i);
        const st = snap.current;
        if (st.trunks) {
          putInst(trunks.current, i, null);
          const t0 = share.tier0[i];
          if (t0 >= 0) for (let k = 0; k < 3; k++) putInst(tiers.current, t0 + k, null);
          const b0 = share.blob0[i];
          if (b0 >= 0) for (let k = 0; k < 5; k++) putInst(blobs.current, b0 + k, null);
        }
        dirty = true;
        continue;
      }
      const k = age / TREE_FALL_S; // 0→1
      // real timber accelerates: slow lean, then whoosh — plus a tiny tremble
      const lean = 1.42 * k * k + Math.sin(k * 24) * 0.018 * (1 - k);
      const dir = engine.fellDir.get(i) ?? 0;
      // the last 15% sinks the whole tree into the stump as it settles
      const scl = k > 0.85 ? Math.max(0.001, 1 - (k - 0.85) / 0.15) : 1;
      poseTree(i, lean, scl, Math.sin(dir), Math.cos(dir));
      dirty = true;
    }
    if (dirty) {
      trunks.current.instanceMatrix.needsUpdate = true;
      tiers.current.instanceMatrix.needsUpdate = true;
      blobs.current.instanceMatrix.needsUpdate = true;
    }
  });

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

/* ------------------------- vehicles: parked + ring traffic ------------------------- */
const CAR_COL_HEX = ["#e0483a", "#2a9d8f", "#f0c040", "#f2f2f2", "#8a5aa8", "#ff8c42", "#4aa3df", "#67b05f"];

/** Every instanced part of one vehicle group (the parked set or the traffic set). */
interface CarParts {
  body: THREE.InstancedMesh; roof: THREE.InstancedMesh; cab: THREE.InstancedMesh; skirt: THREE.InstancedMesh;
  wind: THREE.InstancedMesh; rglass: THREE.InstancedMesh; grille: THREE.InstancedMesh;
  mirL: THREE.InstancedMesh; mirR: THREE.InstancedMesh; exh: THREE.InstancedMesh;
  bumpF: THREE.InstancedMesh; bumpR: THREE.InstancedMesh; lights: THREE.InstancedMesh; tails: THREE.InstancedMesh;
  wheels: THREE.InstancedMesh; hubs: THREE.InstancedMesh;
  bed: THREE.InstancedMesh;    // 🛻 pickup cargo-bed walls (3 slots per vehicle)
  sign: THREE.InstancedMesh;   // 🚌 bus destination board (1 slot)
  bar: THREE.InstancedMesh;    // 🚙 jeep roll bar (3 slots)
  spare: THREE.InstancedMesh;  // 🚙 jeep tailgate spare wheel (1 slot)
  beam: THREE.InstancedMesh;   // 🔆 night headlight cones (2 slots)
}

const BEAM_LEN = 5.6;          // how far a headlight cone reaches
const HEAD_DAY = new THREE.Color(0xe8e2c8);   // lens glass, engine off
const HEAD_NIGHT = new THREE.Color(0xfff8cf); // blazing lamps after dark
const TAIL_DAY = new THREE.Color(0xd0503c);
const TAIL_NIGHT = new THREE.Color(0xff4530);

/**
 * Body styles — every road vehicle shares one instanced part set; `kind` decides
 * which extras placeCar stamps on top of the shared body:
 * 0 car (sedan/hatch) · 1 van · 2 pickup truck · 3 bus · 4 jeep.
 */
interface CarType {
  L: number; W: number; bodyH: number; cabL: number; cabOff: number; cabH: number;
  wheelR: number; axF: number; wsTilt: number; rgTilt: number;
  kind: 0 | 1 | 2 | 3 | 4;
  dualAxle?: boolean;          // bus & truck roll on a second rear axle (6 wheels)
}
const CAR_TYPES: CarType[] = [
  { L: 4.4, W: 1.9, bodyH: 0.92, cabL: 1.9, cabOff: -0.35, cabH: 0.6, wheelR: 0.44, axF: 1.42, wsTilt: 0.44, rgTilt: 0.4, kind: 0 },                // sedan
  { L: 3.5, W: 1.8, bodyH: 0.86, cabL: 1.9, cabOff: 0.15, cabH: 0.74, wheelR: 0.42, axF: 1.1, wsTilt: 0.52, rgTilt: 0.48, kind: 0 },               // hatchback
  { L: 4.7, W: 2.05, bodyH: 1.18, cabL: 2.9, cabOff: 0.5, cabH: 0.85, wheelR: 0.48, axF: 1.55, wsTilt: 0.22, rgTilt: 0.12, kind: 1 },              // delivery van
  { L: 5.3, W: 2.05, bodyH: 0.98, cabL: 1.75, cabOff: 1.32, cabH: 0.78, wheelR: 0.54, axF: 1.78, wsTilt: 0.34, rgTilt: 0.3, kind: 2 },             // pickup truck
  { L: 7.0, W: 2.35, bodyH: 1.55, cabL: 5.5, cabOff: 0, cabH: 0.68, wheelR: 0.5, axF: 2.45, wsTilt: 0.12, rgTilt: 0.1, kind: 3, dualAxle: true },  // city bus
  { L: 3.7, W: 2.0, bodyH: 0.88, cabL: 1.3, cabOff: 0.62, cabH: 0.5, wheelR: 0.52, axF: 1.16, wsTilt: 0.5, rgTilt: 0.4, kind: 4 },                 // jeep
  // 🏁 retro-kit specials — these four SKIP the instanced part set entirely and
  // render from the polyfork car modules (see KitCars); only their wheelR feeds
  // the rolling-spin math, but the rest of the row documents the body for the minimap.
  { L: 4.74, W: 2.01, bodyH: 0.9, cabL: 1.6, cabOff: -0.1, cabH: 0.58, wheelR: 0.3315, axF: 1.45, wsTilt: 0.5, rgTilt: 0.42, kind: 0 },   // 🏁 muscle car
  { L: 5.3, W: 2.18, bodyH: 0.82, cabL: 1.5, cabOff: 0.1, cabH: 0.5, wheelR: 0.34, axF: 1.35, wsTilt: 0.52, rgTilt: 0.44, kind: 0 },      // 🚙 convertible
  { L: 5.08, W: 2.01, bodyH: 0.95, cabL: 2.6, cabOff: -0.5, cabH: 0.66, wheelR: 0.3315, axF: 1.42, wsTilt: 0.38, rgTilt: 0.2, kind: 0 },  // 🚗 station wagon
  { L: 4.47, W: 1.98, bodyH: 0.82, cabL: 1.5, cabOff: -0.1, cabH: 0.52, wheelR: 0.3315, axF: 1.28, wsTilt: 0.6, rgTilt: 0.5, kind: 0 },   // 🏎️ sports coupe
];

/**
 * Stamp one vehicle: coloured body, dark skirt & bumpers, grille, side mirrors,
 * exhaust pipe, head/tail lights, night headlight BEAMS and tires with hubcaps —
 * then the body-style extras: a raked three-box greenhouse for cars & vans, an
 * open cargo bed for the pickup, a full-length window band + destination board
 * for the bus, and a roll bar + tailgate spare wheel for the jeep. Offsets are
 * vehicle-local: s = sideways, f = along the forward axis, rotated into place.
 * `tilt` (radians around the vehicle's side axis) leans the glass — positive
 * tilts the top toward the nose, negative toward the tail. Unused part slots get
 * zero-scale "hidden" stamps so every body style can share one instanced set.
 * `spin` rolls the wheels around their own axle (radians) — moving vehicles pass
 * the distance they covered so the ride never looks like it's skating on ice.
 */
function placeCar(P: CarParts, i: number, x: number, y: number, z: number, rot: number, c: number, t: number, beams = true, spin = 0, steer = 0) {
  const T = CAR_TYPES[t % CAR_TYPES.length];
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const put = (m: THREE.InstancedMesh, idx: number, s: number, f: number, yy: number, sx: number, sy: number, sz: number, tilt = 0) => {
    tmp.rotation.set(tilt, rot, 0);
    tmp.position.set(x + s * cs + f * sn, y + yy, z - s * sn + f * cs);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    m.setMatrixAt(idx, tmp.matrix);
  };
  const hide = (m: THREE.InstancedMesh, idx: number) => {
    tmp.rotation.set(0, 0, 0);
    tmp.position.set(0, -500, 0);
    tmp.scale.setScalar(0);
    tmp.updateMatrix();
    m.setMatrixAt(idx, tmp.matrix);
  };
  const bodyC = col.set(CAR_COL_HEX[c % CAR_COL_HEX.length]);
  const bodyTop = 0.52 + T.bodyH;
  const kind = T.kind;

  // shared lower body + dark skirt
  put(P.skirt, i, 0, 0, 0.38, T.W + 0.1, 0.28, T.L + 0.08);
  put(P.body, i, 0, 0, 0.52 + T.bodyH / 2, T.W, T.bodyH, T.L);
  P.body.setColorAt(i, bodyC);

  // greenhouse — the silhouette that tells each body style apart
  if (kind === 4) {
    // 🚙 jeep: open cab — raked windshield only, roll bar & spare wheel out back
    hide(P.cab, i); hide(P.roof, i); hide(P.rglass, i);
    put(P.wind, i, 0, T.cabOff + T.cabL / 2 + 0.06, bodyTop + T.cabH / 2, T.W - 0.32, T.cabH, 0.12, -T.wsTilt);
  } else if (kind === 3) {
    // 🚌 bus: full-length window band under a slim body-coloured roof
    put(P.cab, i, 0, T.cabOff, bodyTop + T.cabH / 2, T.W - 0.26, T.cabH, T.cabL);
    put(P.roof, i, 0, 0, bodyTop + T.cabH + 0.05, T.W - 0.2, 0.1, T.L - 0.5);
    P.roof.setColorAt(i, bodyC);
    put(P.wind, i, 0, T.cabL / 2 + 0.06, bodyTop + T.cabH / 2, T.W - 0.32, T.cabH - 0.08, 0.12, -T.wsTilt);
    put(P.rglass, i, 0, -(T.cabL / 2 + 0.06), bodyTop + T.cabH / 2, T.W - 0.32, T.cabH - 0.08, 0.12, T.rgTilt);
  } else {
    // 🚗 car / van / pickup: classic three-box — inset cabin + raked glass front & rear
    put(P.cab, i, 0, T.cabOff, bodyTop + T.cabH / 2, T.W - 0.3, T.cabH, T.cabL);
    put(P.roof, i, 0, T.cabOff, bodyTop + T.cabH + 0.06, T.W - 0.36, 0.12, T.cabL - 0.18);
    P.roof.setColorAt(i, bodyC);
    put(P.wind, i, 0, T.cabOff + T.cabL / 2 + 0.03, bodyTop + T.cabH / 2, T.W - 0.22, T.cabH + 0.03, 0.14, -T.wsTilt);
    put(P.rglass, i, 0, T.cabOff - T.cabL / 2 - 0.03, bodyTop + T.cabH / 2, T.W - 0.22, T.cabH * 0.94, 0.14, T.rgTilt);
  }

  // 🛻 pickup: open cargo bed behind the cab — two side walls + a tailgate
  if (kind === 2) {
    const f0 = -(T.L / 2) + 0.3, f1 = T.cabOff - T.cabL / 2 - 0.12;
    const bc = (f0 + f1) / 2, bl = Math.max(0.7, f1 - f0), by = bodyTop + 0.25;
    put(P.bed, i * 3, -(T.W / 2 - 0.07), bc, by, 0.13, 0.5, bl);
    put(P.bed, i * 3 + 1, T.W / 2 - 0.07, bc, by, 0.13, 0.5, bl);
    put(P.bed, i * 3 + 2, 0, f0 + 0.07, by, T.W - 0.14, 0.5, 0.13);
    P.bed.setColorAt(i * 3, bodyC); P.bed.setColorAt(i * 3 + 1, bodyC); P.bed.setColorAt(i * 3 + 2, bodyC);
  } else {
    hide(P.bed, i * 3); hide(P.bed, i * 3 + 1); hide(P.bed, i * 3 + 2);
  }

  // 🚌 bus destination board — the dark route band across the top of the windshield
  if (kind === 3) put(P.sign, i, 0, T.cabL / 2 + 0.06, bodyTop + T.cabH - 0.1, T.W - 1.05, 0.26, 0.16);
  else hide(P.sign, i);

  // 🚙 jeep roll bar: two posts + a top bar over the rear bench
  if (kind === 4) {
    const rf = T.cabOff - T.cabL / 2 - 0.3;
    put(P.bar, i * 3, -(T.W / 2 - 0.24), rf, bodyTop + 0.4, 0.1, 0.8, 0.1);
    put(P.bar, i * 3 + 1, T.W / 2 - 0.24, rf, bodyTop + 0.4, 0.1, 0.8, 0.1);
    put(P.bar, i * 3 + 2, 0, rf, bodyTop + 0.82, T.W - 0.38, 0.1, 0.1);
  } else {
    hide(P.bar, i * 3); hide(P.bar, i * 3 + 1); hide(P.bar, i * 3 + 2);
  }

  // 🚙 jeep spare wheel standing on the tailgate
  if (kind === 4) {
    tmp.rotation.set(Math.PI / 2, rot, 0);   // cylinder axis +Y → lying along the forward axis
    tmp.position.set(x, y + bodyTop - 0.3, z - (T.L / 2 + 0.12));
    tmp.scale.setScalar(T.wheelR * 1.6);
    tmp.updateMatrix();
    P.spare.setMatrixAt(i, tmp.matrix);
  } else hide(P.spare, i);

  // trim details: grille between the headlights, side mirrors, exhaust, bumpers
  put(P.grille, i, 0, T.L / 2 + 0.02, 0.62, T.W - 0.92, 0.2, 0.1);
  put(P.mirL, i, -(T.W / 2 + 0.07), T.cabOff + T.cabL / 2 - 0.02, bodyTop + T.cabH - 0.02, 0.1, 0.14, 0.2);
  put(P.mirR, i, T.W / 2 + 0.07, T.cabOff + T.cabL / 2 - 0.02, bodyTop + T.cabH - 0.02, 0.1, 0.14, 0.2);
  put(P.exh, i, 0.36, -(T.L / 2 + 0.07), 0.32, 0.14, 0.14, 0.2);
  put(P.bumpF, i, 0, T.L / 2 + 0.06, 0.6, T.W + 0.14, 0.26, 0.18);
  put(P.bumpR, i, 0, -(T.L / 2 + 0.06), 0.6, T.W + 0.14, 0.26, 0.18);

  // head & tail light boxes — their MATERIALS brighten after dark (see nightLights)
  for (const k of [-1, 1]) {
    put(P.lights, i * 2 + (k > 0 ? 1 : 0), k * (T.W / 2 - 0.3), T.L / 2 + 0.03, bodyTop - 0.22, 0.3, 0.15, 0.1);
    put(P.tails, i * 2 + (k > 0 ? 1 : 0), k * (T.W / 2 - 0.3), -(T.L / 2 + 0.03), bodyTop - 0.22, 0.3, 0.15, 0.1);
  }

  // 🔆 night headlight beams — one forward light cone per lamp, apex at the lens.
  // Parked cars keep them FOLDED (engine off!) — only a driven vehicle lights up,
  // so `beams=false` stashes the cones under the ground plane.
  for (const k of [-1, 1]) {
    const bi = i * 2 + (k > 0 ? 1 : 0);
    if (!beams) { hide(P.beam, bi); continue; }
    const s = k * (T.W / 2 - 0.3), fl = T.L / 2 + BEAM_LEN / 2 - 0.05;
    tmp.rotation.set(-Math.PI / 2, rot, 0);  // cone apex (+Y) → backward, opening forward
    tmp.position.set(x + s * cs + fl * sn, y + bodyTop - 0.24, z - s * sn + fl * cs);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    P.beam.setMatrixAt(bi, tmp.matrix);
  }

  // wheels — four per vehicle, plus a second rear axle for the bus (six total)
  for (let k = 0; k < 6; k++) {
    let s: number, f: number;
    if (k < 4) {
      s = (k % 2 === 0 ? -1 : 1) * (T.W / 2 - 0.08);
      f = k < 2 ? T.axF : -T.axF;
    } else if (T.dualAxle) {
      s = (k % 2 === 0 ? -1 : 1) * (T.W / 2 - 0.08);
      f = -T.axF * 0.62;
    } else {
      hide(P.wheels, i * 6 + k); hide(P.hubs, i * 6 + k);
      continue;
    }
    for (const [m, geo] of [[P.wheels, 0], [P.hubs, 1]] as const) {
      // Euler order is YXZ (module top): Rx(spin) rotates each tire around its own
      // axle BEFORE the body yaw is applied — actual rolling, not sliding.
      // Front wheels (k<2) add the steer yaw so turns read as steering, not drifting.
      tmp.rotation.set(spin, k < 2 ? rot + steer : rot, Math.PI / 2);
      tmp.position.set(x + s * cs + f * sn, y + T.wheelR, z - s * sn + f * cs);
      tmp.scale.setScalar(geo === 1 ? T.wheelR * 2.18 : T.wheelR * 2.14);
      tmp.updateMatrix();
      m.setMatrixAt(i * 6 + k, tmp.matrix);
    }
  }
}

/** Zero-scale EVERY instanced slot of vehicle #i — the 🏁 retro-kit cars skip the
 *  boxy part set entirely (their low-poly bodies render from the polyfork modules
 *  in KitCars); hiding keeps all the per-index slot math untouched. */
function hideCar(P: CarParts, i: number) {
  const hide = (m: THREE.InstancedMesh, idx: number) => {
    tmp.rotation.set(0, 0, 0);
    tmp.position.set(0, -500, 0);
    tmp.scale.setScalar(0);
    tmp.updateMatrix();
    m.setMatrixAt(idx, tmp.matrix);
  };
  hide(P.skirt, i); hide(P.body, i); hide(P.cab, i); hide(P.roof, i);
  hide(P.wind, i); hide(P.rglass, i); hide(P.grille, i);
  hide(P.mirL, i); hide(P.mirR, i); hide(P.exh, i);
  hide(P.bumpF, i); hide(P.bumpR, i);
  hide(P.sign, i); hide(P.spare, i);
  for (let k = 0; k < 2; k++) { hide(P.lights, i * 2 + k); hide(P.tails, i * 2 + k); hide(P.beam, i * 2 + k); }
  for (let k = 0; k < 3; k++) { hide(P.bed, i * 3 + k); hide(P.bar, i * 3 + k); }
  for (let k = 0; k < 6; k++) { hide(P.wheels, i * 6 + k); hide(P.hubs, i * 6 + k); }
}

/* ---- shared vehicle part set ----
 * One hook + one JSX block render every instanced piece; the parked fleet and the
 * ring traffic each own a set. The three light materials are day/night driven:
 * headlight lenses brighten, tail lamps flare, and the beam cones fade in. */
function useVehicleRefs() {
  const body = useRef<THREE.InstancedMesh>(null!);
  const roof = useRef<THREE.InstancedMesh>(null!);
  const cab = useRef<THREE.InstancedMesh>(null!);
  const skirt = useRef<THREE.InstancedMesh>(null!);
  const wind = useRef<THREE.InstancedMesh>(null!);
  const rglass = useRef<THREE.InstancedMesh>(null!);
  const grille = useRef<THREE.InstancedMesh>(null!);
  const mirL = useRef<THREE.InstancedMesh>(null!);
  const mirR = useRef<THREE.InstancedMesh>(null!);
  const exh = useRef<THREE.InstancedMesh>(null!);
  const bumpF = useRef<THREE.InstancedMesh>(null!);
  const bumpR = useRef<THREE.InstancedMesh>(null!);
  const lights = useRef<THREE.InstancedMesh>(null!);
  const tails = useRef<THREE.InstancedMesh>(null!);
  const wheels = useRef<THREE.InstancedMesh>(null!);
  const hubs = useRef<THREE.InstancedMesh>(null!);
  const bed = useRef<THREE.InstancedMesh>(null!);
  const sign = useRef<THREE.InstancedMesh>(null!);
  const bar = useRef<THREE.InstancedMesh>(null!);
  const spare = useRef<THREE.InstancedMesh>(null!);
  const beam = useRef<THREE.InstancedMesh>(null!);
  const headMat = useRef<THREE.MeshBasicMaterial>(null!);
  const tailMat = useRef<THREE.MeshBasicMaterial>(null!);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null!);
  return { body, roof, cab, skirt, wind, rglass, grille, mirL, mirR, exh, bumpF, bumpR, lights, tails, wheels, hubs, bed, sign, bar, spare, beam, headMat, tailMat, beamMat };
}
type VehicleRefs = ReturnType<typeof useVehicleRefs>;

function partsOf(R: VehicleRefs): CarParts {
  return {
    body: R.body.current, roof: R.roof.current, cab: R.cab.current, skirt: R.skirt.current,
    wind: R.wind.current, rglass: R.rglass.current, grille: R.grille.current,
    mirL: R.mirL.current, mirR: R.mirR.current, exh: R.exh.current,
    bumpF: R.bumpF.current, bumpR: R.bumpR.current, lights: R.lights.current, tails: R.tails.current,
    wheels: R.wheels.current, hubs: R.hubs.current,
    bed: R.bed.current, sign: R.sign.current, bar: R.bar.current, spare: R.spare.current, beam: R.beam.current,
  };
}
function stampDone(P: CarParts) {
  for (const m of Object.values(P)) m.instanceMatrix.needsUpdate = true;
  if (P.body.instanceColor) P.body.instanceColor.needsUpdate = true;
  if (P.roof.instanceColor) P.roof.instanceColor.needsUpdate = true;
  if (P.bed.instanceColor) P.bed.instanceColor.needsUpdate = true;
  if (P.lights.instanceColor) P.lights.instanceColor.needsUpdate = true;
  if (P.tails.instanceColor) P.tails.instanceColor.needsUpdate = true;
}
/** Day → night: lenses brighten, tails flare, headlight beams fade in. Used by the
 *  ring-traffic set — every one of those vehicles is moving, so they all light up. */
function nightLights(R: VehicleRefs, clock: number) {
  const nf = nightFactor(clock);
  if (R.headMat.current) R.headMat.current.color.copy(HEAD_DAY).lerp(HEAD_NIGHT, nf);
  if (R.tailMat.current) R.tailMat.current.color.copy(TAIL_DAY).lerp(TAIL_NIGHT, nf);
  beamFade(R, nf);
}
/** Beam-cone fade only — the parked fleet's lamps are per-instance colours (engine
 *  off while parked), so only the shared cone material follows the clock here. */
function beamFade(R: VehicleRefs, nf: number) {
  const bm = R.beamMat.current;
  if (!bm) return;
  bm.opacity = Math.max(0, nf - 0.14) * 0.42;
  bm.visible = bm.opacity > 0.015;
}
/** Lens glow for car #i's four lamp boxes: nf 0 = engine-off day glass, 1 = blazing
 *  night lamps. Per-instance colours let ONE driven car light up while the whole
 *  parked fleet stays dark — the shared material stays pure white as the base. */
function setLampGlow(P: CarParts, i: number, nf: number) {
  col.copy(HEAD_DAY).lerp(HEAD_NIGHT, nf);
  P.lights.setColorAt(i * 2, col); P.lights.setColorAt(i * 2 + 1, col);
  col.copy(TAIL_DAY).lerp(TAIL_NIGHT, nf);
  P.tails.setColorAt(i * 2, col); P.tails.setColorAt(i * 2 + 1, col);
}

/** All instanced body parts of a vehicle set (counts are per-vehicle slots × N).
 *  `lampsInstance`: the parked fleet drives lamp brightness per-instance (only the
 *  driven car lights up), so its head/tail materials sit at pure white as the base. */
function VehicleParts({ R, N, lampsInstance }: { R: VehicleRefs; N: number; lampsInstance?: boolean }) {
  return (
    <>
      <instancedMesh frustumCulled={false} ref={R.skirt} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#1c2128" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.body} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.cab} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#a8d8ea" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.roof} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      {/* raked glass + trim details — the parts that make each body style read true */}
      <instancedMesh frustumCulled={false} ref={R.wind} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#bfe3f2" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.rglass} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#9fc4d8" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.grille} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#232830" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.mirL} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#232830" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.mirR} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#232830" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.exh} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#454c56" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.bumpF} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#2a2f38" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.bumpR} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#2a2f38" />
      </instancedMesh>
      {/* 🛻 pickup cargo-bed walls + 🚌 bus destination board + 🚙 jeep roll bar & spare */}
      <instancedMesh frustumCulled={false} ref={R.bed} args={[undefined, undefined, N * 3]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.sign} args={[undefined, undefined, N]}>
        <boxGeometry />
        <meshLambertMaterial color="#1d232c" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.bar} args={[undefined, undefined, N * 3]}>
        <boxGeometry />
        <meshLambertMaterial color="#2a2f38" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.spare} args={[undefined, undefined, N]}>
        <cylinderGeometry args={[0.5, 0.5, 0.34, 12]} />
        <meshLambertMaterial color="#171a1f" />
      </instancedMesh>
      {/* head & tail lamps — unlit boxes by day, blazing after dark */}
      <instancedMesh frustumCulled={false} ref={R.lights} args={[undefined, undefined, N * 2]}>
        <boxGeometry />
        <meshBasicMaterial ref={R.headMat} color={lampsInstance ? 0xffffff : HEAD_DAY.getHex()} />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.tails} args={[undefined, undefined, N * 2]}>
        <boxGeometry />
        <meshBasicMaterial ref={R.tailMat} color={lampsInstance ? 0xffffff : TAIL_DAY.getHex()} />
      </instancedMesh>
      {/* 🔆 headlight beams — additive cones, invisible by day, glowing at night */}
      <instancedMesh frustumCulled={false} ref={R.beam} args={[undefined, undefined, N * 2]}>
        <coneGeometry args={[0.95, BEAM_LEN, 10, 1, true]} />
        <meshBasicMaterial ref={R.beamMat} color="#ffedb0" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.wheels} args={[undefined, undefined, N * 6]}>
        <cylinderGeometry args={[0.5, 0.5, 0.34, 12]} />
        <meshLambertMaterial color="#171a1f" />
      </instancedMesh>
      <instancedMesh frustumCulled={false} ref={R.hubs} args={[undefined, undefined, N * 6]}>
        <cylinderGeometry args={[0.5, 0.5, 0.44, 8]} />
        <meshLambertMaterial color="#c9ced8" />
      </instancedMesh>
    </>
  );
}

function Cars({ engine, clockRef }: { engine: GameEngine; clockRef: React.MutableRefObject<number> }) {
  const R = useVehicleRefs();
  const lit = useRef(-1); // the parked car currently running (its lamps + beams are live)
  // ⛰️ the driven car rides the TERRAIN — sampled at the smoothed visual pose and
  // eased, so climbing the mountain band lifts the mesh (and its chase cam)
  // instead of sinking it into the rock. Re-snapped whenever the ride changes.
  const drvY = useRef(0);
  const drvCi = useRef(-1);
  useLayoutEffect(() => {
    const P = partsOf(R);
    // parked fleet: engine OFF — beams folded, lamps at day glass (per-instance, so
    // the ONE car being driven can blaze without lighting the whole street).
    // y follows the ground so a car left parked on the ⛰️ band sits ON the hill.
    // 🏁 kit-modelled types skip the part set — their slots stay zero-scaled.
    WORLD.cars.forEach((c, i) => {
      if (isKitType(c.t)) hideCar(P, i);
      else placeCar(P, i, c.x, terrainHeight(c.x, c.z), c.z, c.rot, c.c, c.t, false);
    });
    for (let i = 0; i < WORLD.cars.length; i++) setLampGlow(P, i, 0);
    stampDone(P);
  }, []);
  // 🚗 the player-driven vehicle moves — re-stamp just that one instance every frame,
  // beams out + lamps lit; the moment you hop out, its lights fold back down.
  // The pose comes from the engine's SMOOTHED visual state (d.vx/vz/vrot/spin/steerVis):
  // the same jitter-free pose the camera follows, with wheels that roll the exact
  // distance covered and front tires that steer — no skating, no stutter.
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, Math.max(0.001, dtRaw));
    beamFade(R, nightFactor(clockRef.current));
    const d = engine.drive;
    const P = partsOf(R);
    let dirty = false;
    // 🤖 bot joyriders move their fleet cars — re-stamp those instances too
    // (the parked fleet is stamped once, so a bot-driven car must follow its
    // world entry every frame or it would drive while its mesh stays parked)
    if (engine.botDriven.size > 0) {
      for (const ci of engine.botDriven) {
        const c = WORLD.cars[ci];
        if (!c) continue;
        if (isKitType(c.t)) hideCar(P, ci); // 🏁 the kit renderer in KitCars drives this one
        else placeCar(P, ci, c.x, terrainHeight(c.x, c.z), c.z, c.rot, c.c, c.t, false);
      }
      dirty = true;
    }
    if (d) {
      const c = WORLD.cars[d.ci];
      if (d.ci !== drvCi.current) { drvCi.current = d.ci; drvY.current = terrainHeight(d.vx, d.vz); } // new ride — snap
      const gy = terrainHeight(d.vx, d.vz);
      // tracked tighter (14/s, was 9): a lazy ease lagged below fast climbs over
      // the rolling valley bumps and the car visibly sank into the mud/rock
      drvY.current += (gy - drvY.current) * Math.min(1, dt * 14); // eased — bumpy ground never jitters the body
      if (isKitType(c.t)) hideCar(P, d.ci); // 🏁 kit body renders in KitCars from the same smoothed pose
      else placeCar(P, d.ci, d.vx, drvY.current, d.vz, d.vrot, c.c, c.t, true, d.spin, d.steerVis);
      setLampGlow(P, d.ci, nightFactor(clockRef.current));
      dirty = true;
    }
    if ((d ? d.ci : -1) !== lit.current) {
      if (lit.current >= 0) { // the previous ride is parked again — engine off
        const c = WORLD.cars[lit.current];
        if (isKitType(c.t)) hideCar(P, lit.current);
        else placeCar(P, lit.current, c.x, terrainHeight(c.x, c.z), c.z, c.rot, c.c, c.t, false);
        setLampGlow(P, lit.current, 0);
      }
      lit.current = d ? d.ci : -1;
      dirty = true;
    }
    if (dirty) stampDone(P);
  });
  const N = Math.max(1, WORLD.cars.length);
  return <VehicleParts R={R} N={N} lampsInstance />;
}

/** Vehicles cruising the ring highway — the engine owns their positions (and collisions). */
function RingTraffic({ engine, clockRef }: { engine: GameEngine; clockRef: React.MutableRefObject<number> }) {
  const R = useVehicleRefs();
  // 🛞 each ring car rolls its own wheels by the distance covered along the circle
  const spins = useRef<number[]>(engine.traffic.map(() => 0));
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, Math.max(0.001, dtRaw));
    const P = partsOf(R);
    engine.traffic.forEach((t, i) => {
      const T = CAR_TYPES[t.t % CAR_TYPES.length];
      spins.current[i] -= (t.sp * t.r * dt) / T.wheelR; // angular speed × ring radius = u/s
      if (isKitType(t.t)) hideCar(P, i); // 🏁 kit bodies cruise in KitCars
      else placeCar(P, i, t.x, 0.07, t.z, t.rot, t.c, t.t, true, spins.current[i]);
    });
    stampDone(P);
    nightLights(R, clockRef.current);
  });
  const N = Math.max(1, engine.traffic.length);
  return <VehicleParts R={R} N={N} />;
}

/* ---------------- 🏁 polyfork Retro Cars Kit — the retro fleet ----------------
 * Sedans, hatchbacks, vans, pickups + the four NEW specials (muscle car,
 * convertible, station wagon, sports coupe) render from the parametric kit
 * modules — real-world scale, +Z nose, named wheel/steer parts we spin every
 * frame. Parked cars sit static; bot-driven & traffic cars roll their wheels
 * by the distance covered; whatever the PLAYER drives also lights its beams
 * after dark (a shared additive material keeps the glow dirt-cheap). */
const kitBeamMat = new THREE.MeshBasicMaterial({
  color: "#ffedb0", transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide,
});
const KIT_BEAM_LEN = 5.6; // matches the procedural fleet's beam reach

interface KitRig {
  src: "park" | "traffic";
  i: number;
  t: number;
  obj: THREE.Group;
  wheels: THREE.Object3D[];
  steer: THREE.Object3D[];
  beams: THREE.Mesh[];
  spin: number;
  lastX: number;
  lastZ: number;
}

function KitCars({ engine, clockRef }: { engine: GameEngine; clockRef: React.MutableRefObject<number> }) {
  const rigs = useMemo<KitRig[]>(() => {
    const out: KitRig[] = [];
    const build = (src: "park" | "traffic", i: number, t: number, c: number, x: number, z: number) => {
      const r = makeKitCar(t, c);
      if (!r) return;
      // 🔆 two headlight cones poking from the nose — apex back at the lens,
      // opening forward; parked cars keep them folded (engine off)
      const box = new THREE.Box3().setFromObject(r.obj);
      const nose = box.max.z;
      const beams: THREE.Mesh[] = [];
      const geo = new THREE.ConeGeometry(0.95, KIT_BEAM_LEN, 10, 1, true);
      for (const s of [-1, 1]) {
        const cone = new THREE.Mesh(geo, kitBeamMat);
        cone.rotation.x = -Math.PI / 2; // apex (+Y) → -Z, opening forward
        cone.position.set(s * box.max.x * 0.6, 0.72, nose + KIT_BEAM_LEN / 2 - 0.05);
        cone.visible = false;
        r.obj.add(cone);
        beams.push(cone);
      }
      out.push({ src, i, t, obj: r.obj, wheels: r.wheels, steer: r.steer, beams, spin: 0, lastX: x, lastZ: z });
    };
    WORLD.cars.forEach((c, i) => { if (isKitType(c.t)) build("park", i, c.t, c.c, c.x, c.z); });
    engine.traffic.forEach((t, i) => { if (isKitType(t.t)) build("traffic", i, t.t, t.c, t.x, t.z); });
    return out;
  }, [engine]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, Math.max(0.001, dtRaw));
    const d = engine.drive;
    const nf = nightFactor(clockRef.current);
    kitBeamMat.opacity = Math.max(0, nf - 0.14) * 0.42; // same fade curve as beamFade
    for (const k of rigs) {
      let x: number, z: number, rot: number, steerA = 0, lit = false;
      if (k.src === "park") {
        const c = WORLD.cars[k.i];
        if (!c) continue;
        const mine = d && d.ci === k.i;
        if (mine && d) {
          x = d.vx; z = d.vz; rot = d.vrot; steerA = d.steerVis;
          k.spin = -d.spin; // engine accumulates forward-negative; kit wheels roll +x forward
          lit = nf > 0.14;
        } else if (engine.botDriven.has(k.i)) {
          x = c.x; z = c.z; rot = c.rot;
          // roll by the distance actually covered — no skating
          k.spin += Math.hypot(c.x - k.lastX, c.z - k.lastZ) / kitWheelR(k.t);
          lit = nf > 0.14;
        } else {
          x = c.x; z = c.z; rot = c.rot;
        }
      } else {
        const t = engine.traffic[k.i];
        if (!t) continue;
        x = t.x; z = t.z; rot = t.rot;
        k.spin += (t.sp * t.r * dt) / kitWheelR(k.t); // tangential speed → wheel angle
        lit = nf > 0.14;
      }
      k.lastX = x; k.lastZ = z;
      k.obj.position.set(x, terrainHeight(x, z), z);
      k.obj.rotation.y = rot;
      for (const w of k.wheels) w.rotation.x = k.spin;
      for (const s of k.steer) s.rotation.y = steerA;
      if (k.beams[0].visible !== lit) for (const b of k.beams) b.visible = lit;
    }
  });

  return (
    <group>
      {rigs.map((k, i) => <primitive object={k.obj} key={i} />)}
    </group>
  );
}

/** A warm pool of light in front of whatever the player is driving — the headlights
 *  that actually light the road at night (one shared light, only while driving). */
function DriveLight({ engine, clockRef }: { engine: GameEngine; clockRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.PointLight>(null!);
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    const d = engine.drive;
    const nf = nightFactor(clockRef.current);
    l.visible = !!d && nf > 0.12;
    if (l.visible && d) {
      // ride the terrain — on the ⛰️ band a flat 1.5 buries the glow inside the hill
      l.position.set(d.x + Math.sin(d.rot) * 5.2, terrainHeight(d.x, d.z) + 1.5, d.z + Math.cos(d.rot) * 5.2);
      l.intensity = 30 * nf;
    }
  });
  return <pointLight ref={ref} args={[0xffe2a0, 0, 24, 1.6]} visible={false} />;
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
      {/* School — yard, running track, pennant, basketball hoop */}
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
        <mesh position={[-8.9, 6.2, -12]} rotation-y={Math.PI / 2}><planeGeometry args={[2.2, 1.3]} /><meshBasicMaterial color="#e0483a" side={THREE.DoubleSide} /></mesh>
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

/** Peaks must keep their lowest ring outside this radius — the player wall is at 712. */
const MOUNTAIN_CLEAR_R = 726;

/** Smallest horizontal distance to origin reached by a peak's base ring. */
function baseMinRadius(p: Peak): number {
  const R = p.green ? 10 : 9 + (Math.floor(p.seed) % 3) * 2;
  const baseR = p.w / 2;
  let minD = Infinity;
  for (let j = 0; j < R; j++) {
    const a = (j / R) * Math.PI * 2;
    const jRad = (hash2(p.seed, j * 9.1) - 0.5) * p.jit; // ring i = 0 (base)
    const rr = baseR * profile(0, p.k) * ridgeMul(p, a) * (1 + jRad);
    const lx = Math.cos(a) * rr * p.sx, lz = Math.sin(a) * rr * p.sz;
    const cR = Math.cos(p.rot), sR = Math.sin(p.rot);
    minD = Math.min(minD, Math.hypot(p.x + lx * cR - lz * sR, p.z + lx * sR + lz * cR));
  }
  return minD;
}

/**
 * Mountain bases are wide and jittered, so several reached INSIDE the playable
 * wall (worst base vertex at r≈285 with the wall at 375) — the player could walk
 * straight into them. Nudge each peak radially outward just far enough that its
 * base ring clears MOUNTAIN_CLEAR_R. Shapes/silhouettes are preserved.
 */
function clearPeaks(peaks: Peak[]) {
  for (const p of peaks) {
    const m = baseMinRadius(p);
    if (m < MOUNTAIN_CLEAR_R) {
      const f = MOUNTAIN_CLEAR_R / m;
      p.x *= f; p.z *= f;
    }
  }
}

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
    // never isoceles-triangle. They sit BEYOND the playable wall (712) as the
    // horizon backdrop — the CLIMBABLE mountains are <MountainTerrain> inside.
    const majors: Peak[] = Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + range(r, -0.06, 0.06);
      const cl = 0.5 + 0.5 * Math.sin(2 * a + 1.7) * Math.sin(3 * a + 0.6); // 0..1
      const h = 58 + cl * 96 + range(r, -10, 10);
      const d = 748 + cl * 44 + range(r, -20, 20);
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
      const a = range(r, 0, Math.PI * 2), d = range(r, 720, 745);
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
    const peaks = [...majors, ...shoulders, ...hills];
    clearPeaks(peaks);
    return buildMountainGeometry(peaks);
  }, []);

  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), []);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

/* --------- ⛰️ CLIMBABLE mountain band — the real terrain the player walks on ---------
 * One displaced ring mesh driven by the SAME terrainHeight() the sim uses, so
 * what you see is exactly what you climb. Flat-shaded + fluted height noise =
 * a rough, scary basalt massif. */
function MountainTerrain() {
  const geo = useMemo(() => {
    const R0 = MOUNTAIN_INNER - 8, R1 = MOUNTAIN_OUTER + 18;
    // 🏔️ 560×72 (was 150×48): at r≈650 the old ring had ~27u between angular
    // vertices — coarser than the mud-valley bump field (sin(x·0.11)·sin(z·0.13),
    // ~50u wavelength) and the fluted peak flutes, so the RENDERED surface bulged
    // ABOVE the exact terrainHeight() the sim walks on and players/cars sank into
    // the mesh. Denser tessellation hugs the true field — what you see is what
    // you climb, no more clipping into the "mud". Static geometry, baked once.
    const rg = new THREE.RingGeometry(R0, R1, 560, 72);
    rg.rotateX(-Math.PI / 2); // lie flat on the x/z plane
    const pos = rg.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // scary dark palette: mossy valley floor → gray scree → near-black crags
      if (h < 1.2) c.set("#414d38");
      else if (h < 5) c.set("#565348");
      else if (h < 12) c.set("#615f59");
      else c.set("#494645");
      c.offsetHSL(0, 0, (hash2(x * 0.37 + 3.1, z * 0.41) - 0.5) * 0.055);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    rg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    rg.computeVertexNormals();
    return rg;
  }, []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), []);
  return <mesh geometry={geo} material={mat} frustumCulled={false} position-y={-0.02} />;
}

/* --------- 🔨 breakable boulders — companion stones for the smashable
 * RocksView boulders; the whole group hides once the boulder is smashed --------- */
function Rocks({ engine }: { engine: GameEngine }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    WORLD.rocks.forEach((rk, i) => {
      const g = refs.current[i];
      if (g) g.visible = rk.s > 0 && !engine.brokenRocks.has(i);
    });
  });
  return (
    <>
      {WORLD.rocks.map((rk, i) => (
        <group
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          position={[rk.x, terrainHeight(rk.x, rk.z), rk.z]}
        >
          <mesh position-y={0.42 * rk.s} rotation-y={rk.x * 0.7 + rk.z * 1.3} scale={[rk.s, rk.s * 0.82, rk.s]}>
            <dodecahedronGeometry args={[0.8, 0]} />
            <meshLambertMaterial color="#7d7a72" flatShading />
          </mesh>
          <mesh position={[0.5 * rk.s, 0.2 * rk.s, 0.42 * rk.s]} rotation-y={rk.z * 0.9} scale={0.45 * rk.s}>
            <dodecahedronGeometry args={[0.8, 0]} />
            <meshLambertMaterial color="#6e6b64" flatShading />
          </mesh>
        </group>
      ))}
    </>
  );
}

/* ------------------------- the grand MUSEUM (classical rotunda on the north vista) ------------------------- */
function Museum() {
  const cols = useRef<THREE.InstancedMesh>(null!);
  // circular colonnade — 18 pillars ringing the rotunda, museum-classical
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
  const sign = useMemo(() => makeSignTexture("CITY MUSEUM", "#6d5a3a", "#f5efdc"), []);
  return (
    <group position={[MUSEUM.x, 0, MUSEUM.z]}>
      {/* plaza + circular stone podium */}
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
      {/* rooftop finial — a quiet golden orb instead of any flag */}
      <mesh position-y={31}><sphereGeometry args={[0.9, 10, 8]} /><meshLambertMaterial color="#d8b45a" /></mesh>
      {/* museum sign above the front steps */}
      <mesh position={[0, 6.6, 24.3]} rotation-x={-0.06}>
        <planeGeometry args={[9, 4.5]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------- town life on the main road ------------------------- */
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

function TownSigns() {
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

/** Stone memorial arch over the central vista (legs are real buildings). */
function VistaGate() {
  return (
    <group position={[GATE.x, 0, GATE.z]}>
      <mesh position-y={15.2}><boxGeometry args={[21, 2.6, 3]} /><meshLambertMaterial color="#d8c8a4" /></mesh>
      <mesh position-y={16.9}><boxGeometry args={[24, 1.4, 3.6]} /><meshLambertMaterial color="#cbb890" /></mesh>
      <mesh position-y={18.2}><boxGeometry args={[8, 1.6, 3.2]} /><meshLambertMaterial color="#d8c8a4" /></mesh>
    </group>
  );
}

/** Big town banner strung across the MAIN ROAD. */
function TownBanner() {
  const tex = useMemo(() => makeSignTexture("WELCOME TO OAKHAVEN — SURVIVE ALL 7 NIGHTS!", "#2d5a2e", "#f5efdc"), []);
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((s) => {
    if (ref.current) ref.current.rotation.x = Math.sin(s.clock.elapsedTime * 1.6) * 0.035;
  });
  return (
    <mesh ref={ref} position={[TOWN_SQUARE.x, 9.3, TOWN_SQUARE.z]} rotation-x={Math.PI / 2}>
      <planeGeometry args={[26, 2.6]} />
      <meshLambertMaterial map={tex} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ------------------------- police stations: signs, beacons, jail cages ------------------------- */
function makePoliceSignTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1d2a4a";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = "#f7c948";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 88);
  ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#f2f4f0";
  ctx.fillText("POLICE", 128, 40);
  ctx.font = "26px system-ui, sans-serif";
  ctx.fillText("🚓 🚨", 128, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function PoliceStations() {
  const signTex = useMemo(() => makePoliceSignTexture(), []);
  const rails = useRef<THREE.InstancedMesh>(null!);
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff4d5e", transparent: true, opacity: 0.95 }), []);
  // one gate sign post + board per station
  const signs = useMemo(() => POLICE_STATIONS.map((st) => {
    const g = stationGate(st);
    return { x: g.x + Math.sign(st.x) * 8.5, z: g.z + Math.sign(st.z) * 8.5, rot: Math.atan2(-Math.sign(st.x), -Math.sign(st.z)) };
  }), []);
  // cage perimeter rails: 8 segments × 2 heights per station, one instanced draw call
  useLayoutEffect(() => {
    let i = 0;
    for (const st of POLICE_STATIONS) {
      const cg = stationCage(st);
      const R = 3.4;
      const corners = [[-R, -R], [R, -R], [R, R], [-R, R]] as const;
      for (let s = 0; s < 4; s++) {
        const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
        const mx = cg.x + (ax + bx) / 2, mz = cg.z + (az + bz) / 2;
        const len = Math.hypot(bx - ax, bz - az);
        const horiz = Math.abs(bz - az) < 0.01;
        for (const y of [1.35, 2.45]) {
          tmp.rotation.set(0, horiz ? 0 : Math.PI / 2, 0);
          tmp.position.set(mx, y, mz);
          tmp.scale.set(len, 0.09, 0.09);
          tmp.updateMatrix();
          rails.current.setMatrixAt(i++, tmp.matrix);
        }
      }
    }
    rails.current.instanceMatrix.needsUpdate = true;
    tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1);
  }, []);
  // beacons blink red ↔ amber like a parked patrol car's light bar
  useFrame(() => {
    const t = performance.now() / 1000;
    beaconMat.color.set(t % 0.9 < 0.45 ? "#ff4d5e" : "#ffc45e");
  });
  return (
    <>
      {POLICE_STATIONS.map((st, i) => {
        const cg = stationCage(st);
        const g = stationGate(st);
        const s = signs[i];
        return (
          <group key={i}>
            {/* gate asphalt pad where the van parks */}
            <mesh rotation-x={-Math.PI / 2} position={[g.x, 0.05, g.z]}>
              <circleGeometry args={[3.6, 20]} />
              <meshLambertMaterial color="#3f3f47" />
            </mesh>
            {/* rooftop beacon */}
            <mesh position={[st.x, 10.6, st.z]} material={beaconMat}>
              <sphereGeometry args={[0.42, 10, 8]} />
            </mesh>
            {/* jail cage floor */}
            <mesh rotation-x={-Math.PI / 2} position={[cg.x, 0.04, cg.z]}>
              <circleGeometry args={[3.8, 20]} />
              <meshLambertMaterial color="#8d8d96" />
            </mesh>
            {/* gate sign post + double-sided board */}
            <mesh position={[s.x, 2.5, s.z]}>
              <cylinderGeometry args={[0.09, 0.12, 5, 6]} />
              <meshLambertMaterial color="#3a3f46" />
            </mesh>
            <group position={[s.x, 5.4, s.z]} rotation-y={s.rot}>
              <mesh>
                <planeGeometry args={[4.6, 1.75]} />
                <meshBasicMaterial map={signTex} side={THREE.DoubleSide} />
              </mesh>
            </group>
          </group>
        );
      })}
      <instancedMesh ref={rails} args={[undefined, undefined, POLICE_STATIONS.length * 8]}>
        <boxGeometry />
        <meshLambertMaterial color="#7a86a0" />
      </instancedMesh>
    </>
  );
}

/* ------------------------- police van fleet (engine-driven) ------------------------- */
interface VanRig { group: THREE.Group; lightA: THREE.MeshBasicMaterial; lightB: THREE.MeshBasicMaterial; tag: THREE.Sprite }

function buildPoliceVan(): VanRig {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: "#f2f4f0" });
  const navy = new THREE.MeshLambertMaterial({ color: "#1d2a4a" });
  const glass = new THREE.MeshLambertMaterial({ color: "#a8d8ea" });
  const dark = new THREE.MeshLambertMaterial({ color: "#2a2f38" });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 5.2), white);
  body.position.y = 1.05;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.42, 5.24), navy);
  stripe.position.y = 0.95;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.78, 1.7), glass);
  cab.position.set(0, 2.16, 1.55);
  const bumpF = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 0.24), dark);
  bumpF.position.set(0, 0.62, 2.66);
  const bumpR = bumpF.clone(); bumpR.position.z = -2.66;
  const lightA = new THREE.MeshBasicMaterial({ color: "#ff4d5e" });
  const lightB = new THREE.MeshBasicMaterial({ color: "#ffc45e" });
  const lampA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.34), lightA);
  lampA.position.set(-0.32, 2.66, 1.4);
  const lampB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.34), lightB);
  lampB.position.set(0.32, 2.66, 1.4);
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.4), dark);
  barBase.position.set(0, 2.58, 1.4);
  group.add(body, stripe, cab, bumpF, bumpR, lampA, lampB, barBase);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 10), new THREE.MeshLambertMaterial({ color: "#171a1f" }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * 1.08, 0.5, sz * 1.7);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.44, 8), new THREE.MeshLambertMaterial({ color: "#c9ced8" }));
    hub.rotation.z = Math.PI / 2;
    hub.position.set(sx * 1.1, 0.5, sz * 1.7);
    group.add(wheel, hub);
  }
  const headA = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.1), new THREE.MeshBasicMaterial({ color: "#ffe08a" }));
  headA.position.set(-0.72, 1.3, 2.62);
  const headB = headA.clone(); headB.position.x = 0.72;
  const tailA = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.1), new THREE.MeshBasicMaterial({ color: "#ff5f4a" }));
  tailA.position.set(-0.72, 1.3, -2.62);
  const tailB = tailA.clone(); tailB.position.x = 0.72;
  group.add(headA, headB, tailA, tailB);
  const tag = nameTag("POLICE VAN", "rgba(29,42,74,0.88)");
  tag.position.y = 3.5;
  group.add(tag);
  return { group, lightA, lightB, tag };
}

function PoliceVans({ engine }: { engine: GameEngine }) {
  const rigs = useMemo(() => engine.vans.map(() => buildPoliceVan()), [engine]);
  useFrame(() => {
    const t = performance.now() / 1000;
    const active = t % 0.5 < 0.25;
    engine.vans.forEach((van, i) => {
      const rig = rigs[i];
      rig.group.position.set(van.x, 0, van.z);
      rig.group.rotation.y = van.rot;
      const busy = van.state !== "idle";
      rig.lightA.color.set(busy ? (active ? "#ff4d5e" : "#5a1f28") : "#8a2a36");
      rig.lightB.color.set(busy ? (active ? "#5a4a1f" : "#ffc45e") : "#8a7a36");
      rig.tag.visible = busy;
    });
  });
  return <>{rigs.map((r, i) => <primitive object={r.group} key={i} />)}</>;
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
      <mesh ref={moon}><sphereGeometry args={[18, 12, 10]} /><meshBasicMaterial color="#ffc9a0" /></mesh> {/* 7Nights moon — a touch larger, blood-warm */}
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

/* ------------------------- 🏕️ jungle camps: tents, lanterns & living fires ------------------------- */
const CAMP_CANVAS_HEX = ["#d9a441", "#b0553a", "#7a8c5a", "#c9b28a", "#9a6a8a"];

/** soft radial glow texture — flame halo, ground light pool, lantern halo */
function campGlowTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

/** 🔥 fire shader — a cone whose silhouette is eaten by two octaves of
 *  seamlessly-wrapping noise scrolling upward. Vertex pass sways the tip while
 *  the root stays anchored; fragment pass runs a deep-red → orange → yellow →
 *  white body ramp with a faint blue gas root and additive blending. */
const FIRE_VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying float vAng;
varying float vN;
float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float fnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1.0, 0.0)), f.x),
             mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vUv = uv;
  float ang = atan(position.x, position.z);
  vAng = ang;
  vec2 nc = vec2(cos(ang), sin(ang)) * 1.6;
  float h = uv.y;
  float t = uTime * 2.1 + uSeed * 19.0;
  float n = fnoise(nc + vec2(0.0, h * 2.6 - t)) * 0.65
          + fnoise(nc * 2.4 + vec2(7.3, h * 5.0 - t * 1.8)) * 0.35;
  vN = n;
  vec3 pos = position;
  float rad = length(position.xz);
  vec2 radial = position.xz / max(rad, 0.001);
  float amp = pow(h, 1.5) * 0.34;          // tips flicker hard, roots stay put
  pos.xz += radial * (n - 0.5) * 1.7 * amp;
  pos.x += sin(t * 0.8 + uSeed * 3.1) * 0.12 * h;   // whole-tongue sway
  pos.z += cos(t * 0.63 + uSeed * 5.7) * 0.1 * h;
  pos.y += (n - 0.5) * 0.16 * h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;
const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uCore;
varying vec2 vUv;
varying float vAng;
varying float vN;
float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float fnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1.0, 0.0)), f.x),
             mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float h = vUv.y;
  float t = uTime * 2.9 + uSeed * 29.0;
  vec2 nc = vec2(cos(vAng), sin(vAng)) * 2.0;
  float n = fnoise(nc + vec2(0.0, h * 3.0 - t)) * 0.6
          + fnoise(nc * 2.7 + vec2(3.7, h * 5.5 - t * 1.9)) * 0.4;
  float body = (1.0 - h) * 1.12 + n * 0.6 - 0.3;
  float alpha = smoothstep(0.05, 0.6, body) * (0.75 + 0.35 * vN);
  vec3 c = mix(vec3(0.45, 0.02, 0.0), vec3(1.0, 0.33, 0.02), smoothstep(0.08, 0.42, body));
  c = mix(c, vec3(1.0, 0.74, 0.16), smoothstep(0.4, 0.75, body));
  c = mix(c, vec3(1.0, 0.97, 0.8), smoothstep(0.72, 1.0, body));
  c = mix(vec3(0.22, 0.4, 0.95), c, smoothstep(0.0, 0.14, h)); // faint blue gas root
  if (uCore > 0.5) c = mix(c, vec3(1.0, 0.94, 0.72), 0.4);
  gl_FragColor = vec4(c * (0.8 + 0.45 * n), alpha);
}
`;
/** ✨ rising sparks — per-spark life cycle with sway + twinkle, all camps in one draw call */
const SPARK_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
varying float vTw;
void main() {
  float life = fract(uTime * (0.22 + aSeed * 0.3) + aSeed * 43.7);
  vec3 pos = position;
  pos.y += life * (1.5 + aSeed * 2.1);
  pos.x += sin(life * (6.0 + aSeed * 6.0) + aSeed * 40.0) * (0.12 + aSeed * 0.25) * life;
  pos.z += cos(life * (5.0 + aSeed * 7.0) + aSeed * 31.0) * (0.1 + aSeed * 0.2) * life;
  vTw = (1.0 - life) * (0.55 + 0.45 * sin(life * 34.0 + aSeed * 95.0));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float fade = clamp(1.0 - (-mv.z - 70.0) / 130.0, 0.0, 1.0);
  vTw *= fade;
  gl_PointSize = clamp(mix(0.1, 0.03, life) * (340.0 / -mv.z), 1.0, 22.0);
  gl_Position = projectionMatrix * mv;
}
`;
const SPARK_FRAG = /* glsl */ `
varying float vTw;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * max(vTw, 0.0);
  vec3 c = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.9, 0.55), clamp(vTw, 0.0, 1.0));
  gl_FragColor = vec4(c, a);
}
`;
/** 🌚 soft smoke puffs — slow rise, wind drift, gentle fade (subtle, both day & night) */
const SMOKE_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
varying float vA;
void main() {
  float life = fract(uTime * (0.1 + aSeed * 0.07) + aSeed * 17.3);
  vec3 pos = position;
  pos.y += 1.9 + life * (4.5 + aSeed * 2.5);
  pos.x += life * (0.9 + aSeed * 0.7) + sin(uTime * 0.5 + aSeed * 20.0) * 0.25;
  pos.z += life * (aSeed - 0.5) * 0.7;
  vA = (1.0 - life) * smoothstep(0.0, 0.18, life) * (0.1 + aSeed * 0.08);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float fade = clamp(1.0 - (-mv.z - 70.0) / 130.0, 0.0, 1.0);
  vA *= fade;
  gl_PointSize = clamp((0.7 + life * 2.6) * (340.0 / -mv.z), 1.0, 150.0);
  gl_Position = projectionMatrix * mv;
}
`;
const SMOKE_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.06, d) * vA;
  gl_FragColor = vec4(vec3(0.42, 0.4, 0.38), a);
}
`;

function Camps({ engine, clockRef }: { engine: GameEngine; clockRef: React.MutableRefObject<number> }) {
  const shared = useMemo(() => ({ time: { value: 0 } }), []);
  const lights = useRef<THREE.PointLight[]>([]);

  /* one imperative group per camp: furniture + the living fire */
  const campGroups = useMemo(() => {
    const r = mulberry32(4242);
    const glowTex = campGlowTexture();
    // shared geometries
    const tentGeo = (() => {
      const shp = new THREE.Shape();
      shp.moveTo(-1.3, 0); shp.lineTo(1.3, 0); shp.lineTo(0, 2.0); shp.closePath();
      const geo = new THREE.ExtrudeGeometry(shp, { depth: 2.9, bevelEnabled: false });
      geo.translate(0, 0, -1.45);
      return geo;
    })();
    const doorGeo = (() => {
      const shp = new THREE.Shape();
      shp.moveTo(-0.52, 0); shp.lineTo(0.52, 0); shp.lineTo(0, 1.25); shp.closePath();
      return new THREE.ShapeGeometry(shp);
    })();
    const logGeo = new THREE.CylinderGeometry(0.24, 0.26, 1.5, 7);
    const fireLogGeo = new THREE.CylinderGeometry(0.13, 0.15, 1.3, 6);
    const stoneGeo = new THREE.DodecahedronGeometry(0.24, 0);
    const crateGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    const crate2Geo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const barrelGeo = new THREE.CylinderGeometry(0.4, 0.42, 0.95, 10);
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 2.7, 6);
    const armGeo = new THREE.BoxGeometry(0.5, 0.06, 0.06);
    const cageGeo = new THREE.SphereGeometry(0.17, 8, 6);
    const bulbGeo = new THREE.SphereGeometry(0.13, 8, 6);
    const scorchGeo = new THREE.CircleGeometry(1.2, 20);
    const emberGeo = new THREE.CircleGeometry(0.46, 14);
    const poolGeo = new THREE.CircleGeometry(4.4, 26);
    // shared materials
    const tentMats = CAMP_CANVAS_HEX.map((h) => new THREE.MeshLambertMaterial({ color: h }));
    const doorMat = new THREE.MeshLambertMaterial({ color: "#43301f" });
    const barkMat = new THREE.MeshLambertMaterial({ color: "#6e4a2a" });
    const charMat = new THREE.MeshLambertMaterial({ color: "#3a2a1e" });
    const stoneMats = ["#8d8d95", "#7d7d86", "#97948c"].map((h) => new THREE.MeshLambertMaterial({ color: h }));
    const crateMat = new THREE.MeshLambertMaterial({ color: "#a3703f" });
    const barrelMat = new THREE.MeshLambertMaterial({ color: "#7a4a2b" });
    const poleMat = new THREE.MeshLambertMaterial({ color: "#54402c" });
    const cageMat = new THREE.MeshLambertMaterial({ color: "#2f333a" });
    const scorchMat = new THREE.MeshBasicMaterial({ color: "#241812" });
    const emberMat = new THREE.MeshBasicMaterial({ color: "#ff5a1f" });
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff8c3a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });

    return WORLD.camps.map((cp, ci) => {
      const g = new THREE.Group();
      const ty = terrainHeight(cp.x, cp.z);
      g.position.set(cp.x, ty, cp.z);

      /* A-frame tents — doorways face the fire */
      for (const t of cp.tents) {
        const tg = new THREE.Group();
        tg.position.set(t.dx, 0, t.dz);
        tg.rotation.y = t.rot;
        tg.scale.setScalar(t.s);
        const canvasMesh = new THREE.Mesh(tentGeo, tentMats[t.c % tentMats.length]);
        canvasMesh.rotation.z = (t.dx + t.dz) % 2 < 1 ? 0.035 : -0.035;
        tg.add(canvasMesh);
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, 0.02, 1.452);
        tg.add(door);
        const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), charMat);
        ridge.rotation.x = Math.PI / 2;
        ridge.position.y = 1.98;
        tg.add(ridge);
        g.add(tg);
      }

      /* split-log seats ringing the fire */
      for (const l of cp.logs) {
        const m = new THREE.Mesh(logGeo, barkMat);
        m.position.set(l.dx, 0.24, l.dz);
        m.rotation.z = Math.PI / 2;   // lie flat
        m.rotation.y = l.rot;         // tangent to the pit
        g.add(m);
      }

      /* supply crates (some stacked) & the odd barrel */
      cp.crates.forEach((cr, k) => {
        const m = new THREE.Mesh(k % 2 === 0 ? crateGeo : crate2Geo, crateMat);
        m.position.set(cr.dx, 0.43, cr.dz);
        m.rotation.y = cr.rot;
        g.add(m);
        if (k === 0) {
          const top = new THREE.Mesh(crate2Geo, crateMat);
          top.position.set(cr.dx + 0.14, 1.12, cr.dz - 0.1);
          top.rotation.y = cr.rot + 0.5;
          g.add(top);
        }
        if (k === cp.crates.length - 1 && cp.crates.length === 1) {
          const b = new THREE.Mesh(barrelGeo, barrelMat);
          b.position.set(cr.dx + 0.9, 0.48, cr.dz + 0.5);
          g.add(b);
        }
      });

      /* lantern pole — glows warm once the dusk rolls in */
      if (cp.pole) {
        const p = new THREE.Mesh(poleGeo, poleMat);
        p.position.set(cp.pole.dx, 1.35, cp.pole.dz);
        g.add(p);
        const arm = new THREE.Mesh(armGeo, poleMat);
        arm.position.set(cp.pole.dx - 0.22, 2.66, cp.pole.dz);
        g.add(arm);
        const cage = new THREE.Mesh(cageGeo, cageMat);
        cage.position.set(cp.pole.dx - 0.42, 2.5, cp.pole.dz);
        g.add(cage);
        const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0 }));
        bulb.position.copy(cage.position);
        bulb.name = "lbulb";
        g.add(bulb);
      }

      /* ----- the fire pit ----- */
      const scorch = new THREE.Mesh(scorchGeo, scorchMat);
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.y = 0.022;
      g.add(scorch);
      const ember = new THREE.Mesh(emberGeo, emberMat);
      ember.rotation.x = -Math.PI / 2;
      ember.position.y = 0.05;
      ember.name = "ember";
      g.add(ember);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + ci;
        const s = new THREE.Mesh(stoneGeo, stoneMats[k % stoneMats.length]);
        s.position.set(Math.cos(a) * 0.88, 0.14 + r() * 0.06, Math.sin(a) * 0.88);
        s.rotation.set(r() * 3, r() * 3, r() * 3);
        s.scale.setScalar(0.85 + r() * 0.5);
        g.add(s);
      }
      // crossed fire lay
      for (const a of [0.55, -0.55]) {
        const fl = new THREE.Mesh(fireLogGeo, charMat);
        fl.position.y = 0.16;
        fl.rotation.z = Math.PI / 2;
        fl.rotation.y = a;
        g.add(fl);
      }

      /* ----- 🔥 the living flame: outer body + hot core ----- */
      const mkFlame = (rad: number, h: number, core: boolean) => {
        const geo = new THREE.ConeGeometry(rad, h, 12, 16, true);
        geo.translate(0, h / 2, 0);
        const mat = new THREE.ShaderMaterial({
          uniforms: { uTime: shared.time, uSeed: { value: ci * 3.7 + (core ? 5.1 : 0) }, uCore: { value: core ? 1 : 0 } },
          vertexShader: FIRE_VERT,
          fragmentShader: FIRE_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.y = 0.14;
        m.renderOrder = 5;
        return m;
      };
      g.add(mkFlame(0.52, 1.85, false));
      g.add(mkFlame(0.3, 1.15, true));

      /* additive halo + warm pool of light on the ground */
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8c3a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.y = 0.95;
      glow.scale.setScalar(2.6);
      glow.renderOrder = 6;
      glow.name = "glow";
      g.add(glow);
      const pool = new THREE.Mesh(poolGeo, poolMat.clone());
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.055;
      pool.renderOrder = 4;
      pool.name = "pool";
      g.add(pool);
      return g;
    });
  }, [shared]);

  /* sparks + smoke — one Points cloud per effect covering every camp */
  const sparkGeo = useMemo(() => {
    const per = 22;
    const pos = new Float32Array(WORLD.camps.length * per * 3);
    const seed = new Float32Array(WORLD.camps.length * per);
    const r = mulberry32(9001);
    let i = 0;
    for (const cp of WORLD.camps) {
      for (let k = 0; k < per; k++) {
        const a = r() * Math.PI * 2, d = r() * 0.3;
        pos[i * 3] = cp.x + Math.cos(a) * d;
        pos[i * 3 + 1] = terrainHeight(cp.x, cp.z) + 0.4;
        pos[i * 3 + 2] = cp.z + Math.sin(a) * d;
        seed[i] = r();
        i++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  const smokeGeo = useMemo(() => {
    const per = 8;
    const pos = new Float32Array(WORLD.camps.length * per * 3);
    const seed = new Float32Array(WORLD.camps.length * per);
    const r = mulberry32(9002);
    let i = 0;
    for (const cp of WORLD.camps) {
      for (let k = 0; k < per; k++) {
        pos[i * 3] = cp.x + (r() - 0.5) * 0.4;
        pos[i * 3 + 1] = terrainHeight(cp.x, cp.z);
        pos[i * 3 + 2] = cp.z + (r() - 0.5) * 0.4;
        seed[i] = r();
        i++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  const sparkMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: shared.time },
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), [shared]);
  const smokeMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: shared.time },
    vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
    transparent: true, depthWrite: false,
  }), [shared]);

  /* per-frame: ember pulse, halo/pool flicker, lantern dusk-glow, and the two
   * pooled fire lights that chase the camps nearest the player */
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    shared.time.value = t;
    const nf = nightFactor(clockRef.current);
    const p = engine.player;
    const order = WORLD.camps
      .map((cp, i) => ({ i, d: (cp.x - p.x) * (cp.x - p.x) + (cp.z - p.z) * (cp.z - p.z) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < WORLD.camps.length; i++) {
      const g = campGroups[i];
      const flick = 0.82 + 0.18 * Math.sin(t * 11 + i * 2.4) * Math.sin(t * 6.3 + i);
      const glow = g.getObjectByName("glow") as THREE.Sprite | undefined;
      if (glow) {
        const m = glow.material as THREE.SpriteMaterial;
        m.opacity = (0.42 + 0.34 * nf) * flick;
        glow.scale.setScalar(2.1 + 0.6 * flick + 0.9 * nf);
      }
      const pool = g.getObjectByName("pool") as THREE.Mesh | undefined;
      if (pool) {
        const m = pool.material as THREE.MeshBasicMaterial;
        m.opacity = (0.16 + 0.5 * nf) * flick;
      }
      const ember = g.getObjectByName("ember") as THREE.Mesh | undefined;
      if (ember) (ember.material as THREE.MeshBasicMaterial).color.setHSL(0.07, 0.95, 0.4 + 0.13 * Math.sin(t * 7 + i * 1.7));
      const bulb = g.getObjectByName("lbulb") as THREE.Mesh | undefined;
      if (bulb) (bulb.material as THREE.MeshBasicMaterial).opacity = Math.max(0, nf - 0.25) * 1.3;
    }
    for (let k = 0; k < 2; k++) {
      const L = lights.current[k];
      if (!L) continue;
      const cp = WORLD.camps[order[k]?.i ?? 0];
      if (!cp) continue;
      const ty = terrainHeight(cp.x, cp.z) + 1.25;
      const f = Math.min(1, 5 * dt);
      L.position.x += (cp.x - L.position.x) * f;
      L.position.y += (ty - L.position.y) * f;
      L.position.z += (cp.z - L.position.z) * f;
      const flick = 0.78 + 0.22 * Math.sin(t * 9.7 + k * 3.1) * Math.sin(t * 5.3 + k) + 0.06 * Math.sin(t * 23);
      L.intensity = (2.4 + 15 * nf) * flick;
    }
  });

  return (
    <>
      {campGroups.map((g, i) => <primitive object={g} key={`camp${i}`} />)}
      <points geometry={sparkGeo} material={sparkMat} frustumCulled={false} />
      <points geometry={smokeGeo} material={smokeMat} frustumCulled={false} />
      {[0, 1].map((k) => (
        <pointLight
          key={`fl${k}`}
          ref={(r) => { if (r) lights.current[k] = r; }}
          color="#ff8c3a"
          intensity={0}
          distance={22}
          decay={1.7}
          position={[0, -60, 0]}
        />
      ))}
    </>
  );
}

/* ------------------------- environment ------------------------- */
const DAY = new THREE.Color(0x8fd3ff);
const DUSK = new THREE.Color(0xff9a5a);
const NIGHT = new THREE.Color(0x070a1c); // 7Nights — colder, darker nights

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
    fog.far = n > 0.5 ? 235 : 900; // night fog closes in — claustrophobic
    scene.fog = fog;
    hemi.current.intensity = 0.30 + 0.55 * (1 - n); // night floor: lamps/fireflies keep it readable
    sun.current.intensity = 0.16 + 0.95 * (1 - n);  // moonlight floor — never pitch black
    sun.current.position.set(Math.cos(PI2 * (clock - 0.25)) * 200, Math.max(24, h * 200), 90);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={[0xffffff, 0x557744, 0.8]} />
      <directionalLight ref={sun} args={[0xfff2d0, 1]} />
    </>
  );
}

/* ---------------- 7Nights International Airport ----------------
 * Runway + taxiway + apron slabs with painted markings, a glass-fronted
 * terminal, a control tower with a spinning radar and a windsock. The solid
 * terminal/tower/hangar shells are worldgen buildings — this paints the rest. */
function Airport() {
  const radar = useRef<THREE.Mesh>(null!);
  const sock = useRef<THREE.Group>(null!);
  useFrame((s, dt) => {
    if (radar.current) radar.current.rotation.y += dt * 1.4;   // the tower radar sweep
    if (sock.current) sock.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.8) * 0.22; // breeze
  });
  const rwLen = AIRPORT.rx1 - AIRPORT.rx0 + 36;
  const rwCx = (AIRPORT.rx0 + AIRPORT.rx1) / 2;
  const dashes = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 12; i++) arr.push(AIRPORT.rx0 + 12 + i * ((AIRPORT.rx1 - AIRPORT.rx0 - 24) / 11));
    return arr;
  }, []);
  const sign = useMemo(() => makeSignTexture("7NIGHTS INTL ✈", "#1d2a4a", "#ffd166"), []);
  return (
    <group>
      {/* runway slab + markings */}
      <mesh rotation-x={-Math.PI / 2} position={[rwCx, 0.045, AIRPORT.rz]} receiveShadow>
        <planeGeometry args={[rwLen, AIRPORT.rw]} />
        <meshLambertMaterial color="#3f4046" />
      </mesh>
      {dashes.map((x, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.05, AIRPORT.rz]}>
          <planeGeometry args={[7, 0.7]} />
          <meshBasicMaterial color="#f5f5f0" />
        </mesh>
      ))}
      {/* threshold stripes both ends */}
      {[-1, 1].map((e) =>
        [-5.4, -3.24, -1.08, 1.08, 3.24, 5.4].map((z) => (
          <mesh key={`${e}-${z}`} rotation-x={-Math.PI / 2} position={[AIRPORT.rx0 + (e < 0 ? 6 : AIRPORT.rx1 - AIRPORT.rx0 - 6) + (e < 0 ? 0 : 0), 0.052, AIRPORT.rz + z]}>
            <planeGeometry args={[5, 1.15]} />
            <meshBasicMaterial color="#f5f5f0" />
          </mesh>
        )),
      )}
      {/* edge lines */}
      {[-1, 1].map((e) => (
        <mesh key={e} rotation-x={-Math.PI / 2} position={[rwCx, 0.048, AIRPORT.rz + e * (AIRPORT.rw / 2 - 0.7)]}>
          <planeGeometry args={[rwLen - 10, 0.55]} />
          <meshBasicMaterial color="#e8e8e0" />
        </mesh>
      ))}
      {/* apron + taxiway */}
      <mesh rotation-x={-Math.PI / 2} position={[AIRPORT.terminal.x + 2, 0.04, (AIRPORT.rz + AIRPORT.terminal.z) / 2 + 1]} receiveShadow>
        <planeGeometry args={[92, AIRPORT.terminal.z - AIRPORT.rz - 8]} />
        <meshLambertMaterial color="#8d8d94" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[AIRPORT.rx0 - 10, 0.042, AIRPORT.rz + 8]}>
        <planeGeometry args={[22, 8]} />
        <meshLambertMaterial color="#7c7c84" />
      </mesh>
      {/* terminal glass front + doors + sign */}
      <mesh position={[AIRPORT.terminal.x, 5.2, AIRPORT.terminal.z - AIRPORT.terminal.d - 0.06]}>
        <boxGeometry args={[AIRPORT.terminal.w * 2 - 3, 6.4, 0.24]} />
        <meshLambertMaterial color="#9fc4d8" transparent opacity={0.85} />
      </mesh>
      <mesh position={[AIRPORT.terminal.x, 1.6, AIRPORT.terminal.z - AIRPORT.terminal.d - 0.1]}>
        <boxGeometry args={[4.4, 3.2, 0.3]} />
        <meshLambertMaterial color="#31445c" />
      </mesh>
      <mesh position={[AIRPORT.terminal.x, AIRPORT.terminal.h + 1.1, AIRPORT.terminal.z - AIRPORT.terminal.d - 0.3]}
        rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[16, 2.4]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      {/* control tower cab + spinning radar (shaft is a worldgen building) */}
      <mesh position={[AIRPORT.tower.x, AIRPORT.tower.h + 1.6, AIRPORT.tower.z]}>
        <boxGeometry args={[7.4, 3.4, 7.4]} />
        <meshLambertMaterial color="#9fc4d8" transparent opacity={0.88} />
      </mesh>
      <mesh position={[AIRPORT.tower.x, AIRPORT.tower.h + 3.6, AIRPORT.tower.z]}>
        <cylinderGeometry args={[4.4, 4.9, 0.7, 4]} />
        <meshLambertMaterial color="#5a6472" />
      </mesh>
      <mesh ref={radar} position={[AIRPORT.tower.x, AIRPORT.tower.h + 4.6, AIRPORT.tower.z]}>
        <boxGeometry args={[7.4, 0.24, 0.6]} />
        <meshLambertMaterial color="#f2f4f0" />
      </mesh>
      {/* hangar door */}
      <mesh position={[AIRPORT.hangar.x, 4.6, AIRPORT.hangar.z - AIRPORT.hangar.d - 0.08]}>
        <boxGeometry args={[AIRPORT.hangar.w * 2 - 4, 9.2, 0.3]} />
        <meshLambertMaterial color="#7a828e" />
      </mesh>
      {/* windsock: orange cone that sways with the breeze */}
      <group ref={sock} position={[AIRPORT.rx0 - 14, 6.4, AIRPORT.rz - 12]}>
        <mesh rotation-z={Math.PI / 2} position={[1.6, 0, 0]}>
          <coneGeometry args={[0.65, 3.2, 8, 1, true]} />
          <meshLambertMaterial color="#ff7f2a" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );}

/* ---------------- bot planes ----------------
 * Cartoon prop airliners driven by the engine's PlaneState machines — they taxi
 * out, take off, circle the whole city, land and park again. */
function PlaneRig({ color, gearRef }: {
  color: number;
  gearRef: (o: THREE.Group | null) => void;
}) {
  return (
    <group>
      {/* fuselage along +x — slim capsule with a tapered tail cone */}
      <mesh rotation-z={Math.PI / 2} castShadow>
        <capsuleGeometry args={[0.92, 6.2, 4, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[-5.15, -0.14, 0]} rotation-z={Math.PI / 2}>
        <coneGeometry args={[0.9, 2.6, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {/* nose cone (the spinner + prop sit just ahead of it) */}
      <mesh position={[4.2, 0, 0]} rotation-z={-Math.PI / 2}>
        <coneGeometry args={[0.88, 1.7, 12]} />
        <meshLambertMaterial color="#f5f2e8" />
      </mesh>
      {/* raked cockpit glass */}
      <mesh position={[3.15, 0.58, 0]} rotation-z={-0.42}>
        <boxGeometry args={[1.2, 0.58, 1.34]} />
        <meshLambertMaterial color="#22303f" />
      </mesh>
      {/* cabin window strips (both sides) */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.5, 0.4, s * 0.85]}>
          <boxGeometry args={[5.4, 0.28, 0.08]} />
          <meshLambertMaterial color="#9fb8c8" />
        </mesh>
      ))}
      {/* belly stripe */}
      <mesh position={[0, -0.76, 0]}>
        <boxGeometry args={[7.8, 0.3, 1.5]} />
        <meshLambertMaterial color="#f5f2e8" />
      </mesh>
      {/* wings: two swept halves with a touch of dihedral */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-0.15, -0.3, s * 3.1]} rotation-x={s * 0.09} rotation-y={s * -0.2} castShadow>
          <boxGeometry args={[2.5, 0.2, 6.2]} />
          <meshLambertMaterial color="#f5f2e8" />
        </mesh>
      ))}
      {/* engine pods slung under the wings */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.75, -0.64, s * 2.15]} rotation-z={Math.PI / 2}>
          <capsuleGeometry args={[0.34, 1.1, 4, 8]} />
          <meshLambertMaterial color="#d8d4c8" />
        </mesh>
      ))}
      {/* swept tail fin + dihedral stabilizers */}
      <mesh position={[-5.45, 1.5, 0]} rotation-z={0.38} castShadow>
        <boxGeometry args={[1.5, 2.6, 0.22]} />
        <meshLambertMaterial color={color} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-5.3, 0.28, s * 1.4]} rotation-x={s * 0.12}>
          <boxGeometry args={[1.3, 0.16, 2.6]} />
          <meshLambertMaterial color="#f5f2e8" />
        </mesh>
      ))}
      {/* landing gear — the Planes loop hides it the moment the wheels leave the tarmac */}
      <group ref={gearRef}>
        <mesh position={[2.9, -1.15, 0]}>
          <boxGeometry args={[0.14, 0.62, 0.14]} />
          <meshLambertMaterial color="#3a3f46" />
        </mesh>
        <mesh position={[2.9, -1.5, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.3, 0.3, 0.24, 10]} />
          <meshLambertMaterial color="#26262c" />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[-0.7, -1.08, s * 0.85]}>
              <boxGeometry args={[0.14, 0.72, 0.14]} />
              <meshLambertMaterial color="#3a3f46" />
            </mesh>
            <mesh position={[-0.7, -1.5, s * 0.85]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.36, 0.36, 0.26, 10]} />
              <meshLambertMaterial color="#26262c" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );}

function Planes({ engine }: { engine: GameEngine }) {
  const rigs = useMemo(
    () => engine.planes.map(() => ({
      group: { current: null as THREE.Group | null },
      prop: { current: null as THREE.Group | null },
      gear: { current: null as THREE.Group | null },
    })),
    [engine],
  );
  useFrame(() => {
    engine.planes.forEach((pl, i) => {
      const g = rigs[i]?.group.current;
      if (!g) return;
      g.position.set(pl.x, pl.alt + 1.85 + Math.sin(pl.propT * 0.5) * 0.06, pl.z);
      g.rotation.y = -pl.hdg;
      g.rotation.z = pl.pitch;
      const p = rigs[i]?.prop.current;
      if (p) p.rotation.x = pl.propT;
      const gear = rigs[i]?.gear.current;
      if (gear) gear.visible = pl.alt < 0.6; // wheels up the moment we leave the tarmac
    });
  });
  return (
    <>
      {engine.planes.map((pl, i) => (
        <group key={pl.id} ref={(o) => { rigs[i].group.current = o; }}>
          <PlaneRig
            color={PLANE_LIVERY[pl.c % PLANE_LIVERY.length]}
            gearRef={(o) => { rigs[i].gear.current = o; }}
          />
          {/* 3-blade propeller + spinner, spinning on the nose */}
          <group ref={(o) => { rigs[i].prop.current = o; }} position={[5.15, 0, 0]}>
            <mesh rotation-z={-Math.PI / 2} position={[0.28, 0, 0]}>
              <coneGeometry args={[0.3, 0.75, 8]} />
              <meshLambertMaterial color="#c8c4b8" />
            </mesh>
            {[0, 1, 2].map((k) => (
              <mesh key={k} rotation-x={(k * Math.PI * 2) / 3} position={[0.1, 0, 0]}>
                <boxGeometry args={[0.09, 4.6, 0.3]} />
                <meshLambertMaterial color="#2c2c33" />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </>
  );
}
const PLANE_LIVERY = [0xe0483a, 0x2a9d8f, 0xf0c040, 0x4aa3df, 0x8a5aa8];

export function WorldView({ clockRef, engine }: { clockRef: React.MutableRefObject<number>; engine: GameEngine }) {
  return (
    <>
      <Env clockRef={clockRef} />
      <Disc r={900} color="#3f7a36" y={-0.12} />
      <Disc r={CITY_RADIUS} color="#9a968c" y={0} />
      <Ring a={CITY_RADIUS} b={FARM_RADIUS} color="#9cb84e" y={0.02} />
      <Ring a={FARM_RADIUS} b={DEEP_JUNGLE_RADIUS} color="#2d7a3a" y={0.03} />
      <Ring a={DEEP_JUNGLE_RADIUS} b={JUNGLE_RADIUS} color="#1e5630" y={0.031} />
      <Ring a={JUNGLE_RADIUS} b={WALL_RADIUS + 4} color="#232b20" y={0.032} />
      <MountainTerrain />
      <Rocks engine={engine} />
      <Disc r={GRAVEYARD.r} color="#3a3a46" y={0.06} x={GRAVEYARD.x} z={GRAVEYARD.z} />
      <Roads />
      <Airport />
      <Buildings />
      <PoliceStations />
      <Windows clockRef={clockRef} />
      <Cars engine={engine} clockRef={clockRef} />
      <KitCars engine={engine} clockRef={clockRef} />
      <RingTraffic engine={engine} clockRef={clockRef} />
      <DriveLight engine={engine} clockRef={clockRef} />
      <PoliceVans engine={engine} />
      <Planes engine={engine} />
      <Lamps clockRef={clockRef} />
      <Park />
      <Benches />
      <Umbrellas />
      <Farm />
      <Landmarks />
      <Forest engine={engine} />
      <Camps engine={engine} clockRef={clockRef} />
      <Graves />
      <Flowers />
      <Mountains />
      <Museum />
      <VistaGate />
      <TownSigns />
      <TownBanner />
      <Clouds />
      <Sky clockRef={clockRef} />
      <Fireflies clockRef={clockRef} />
    </>
  );
}
