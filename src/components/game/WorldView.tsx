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
function Forest() {
  const trunks = useRef<THREE.InstancedMesh>(null!);
  const cones = useRef<THREE.InstancedMesh>(null!);
  const blobs = useRef<THREE.InstancedMesh>(null!);
  const nCone = useMemo(() => WORLD.trees.filter((t) => t.kind === 0).length, []);
  useLayoutEffect(() => {
    let ci = 0, bi = 0;
    WORLD.trees.forEach((t, i) => {
      tmp.rotation.set(0, t.x * 1.7, 0);
      tmp.scale.setScalar(t.s);
      tmp.position.set(t.x, 1.5 * t.s, t.z);
      tmp.updateMatrix();
      trunks.current.setMatrixAt(i, tmp.matrix);
      if (t.kind === 0) {
        tmp.position.y = 5.4 * t.s;
        tmp.updateMatrix();
        cones.current.setMatrixAt(ci++, tmp.matrix);
      } else {
        tmp.position.y = 4.6 * t.s;
        tmp.updateMatrix();
        blobs.current.setMatrixAt(bi++, tmp.matrix);
      }
    });
    tmp.rotation.set(0, 0, 0);
    trunks.current.instanceMatrix.needsUpdate = true;
    cones.current.instanceMatrix.needsUpdate = true;
    blobs.current.instanceMatrix.needsUpdate = true;
  }, [nCone]);
  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, WORLD.trees.length]}>
        <cylinderGeometry args={[0.32, 0.48, 3, 6]} />
        <meshLambertMaterial color="#7a4a28" />
      </instancedMesh>
      <instancedMesh ref={cones} args={[undefined, undefined, Math.max(1, nCone)]}>
        <coneGeometry args={[2.3, 6.4, 7]} />
        <meshLambertMaterial color="#2f8f46" />
      </instancedMesh>
      <instancedMesh ref={blobs} args={[undefined, undefined, Math.max(1, WORLD.trees.length - nCone)]}>
        <sphereGeometry args={[2.7, 8, 6]} />
        <meshLambertMaterial color="#43a047" />
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
function Mountains() {
  const bodies = useRef<THREE.InstancedMesh>(null!);
  const caps = useRef<THREE.InstancedMesh>(null!);
  const items = useMemo(() => {
    const r = mulberry32(7);
    return Array.from({ length: 44 }, (_, i) => {
      const a = (i / 44) * Math.PI * 2 + range(r, -0.07, 0.07), d = range(r, 348, 425), h = range(r, 75, 165);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, h, w: range(r, 45, 82), c: i % 3 ? "#7d7468" : "#8d8478" };
    });
  }, []);
  useLayoutEffect(() => {
    items.forEach((m, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(m.x, m.h / 2 - 4, m.z);
      tmp.scale.set(m.w, m.h, m.w);
      tmp.updateMatrix();
      bodies.current.setMatrixAt(i, tmp.matrix);
      bodies.current.setColorAt(i, col.set(m.c));
      tmp.position.y = m.h * 0.86 - 4;
      tmp.scale.set(m.w * 0.24, m.h * 0.28, m.w * 0.24);
      tmp.updateMatrix();
      caps.current.setMatrixAt(i, tmp.matrix);
    });
    tmp.scale.setScalar(1);
    bodies.current.instanceMatrix.needsUpdate = true;
    caps.current.instanceMatrix.needsUpdate = true;
    if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, items.length]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} />
        <meshLambertMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, items.length]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} />
        <meshLambertMaterial color="#f2f4f8" flatShading />
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
    scene.fog = new THREE.Fog(sky, 70, n > 0.5 ? 250 : 400);
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
