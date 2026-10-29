import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CITY_RADIUS, FARM_RADIUS, GRAVEYARD, JUNGLE_RADIUS, generateWorld, mulberry32, range } from "@votechor/shared";

/** Same seed as the server, so collisions line up exactly with what players see. */
export const WORLD = generateWorld();
const tmp = new THREE.Object3D();

function Disc({ r, color, y, x = 0, z = 0 }: { r: number; color: string; y: number; x?: number; z?: number }) {
  return <mesh rotation-x={-Math.PI / 2} position={[x, y, z]}><circleGeometry args={[r, 64]} /><meshLambertMaterial color={color} /></mesh>;
}
function Ring({ a, b, color, y }: { a: number; b: number; color: string; y: number }) {
  return <mesh rotation-x={-Math.PI / 2} position-y={y}><ringGeometry args={[a, b, 96]} /><meshLambertMaterial color={color} /></mesh>;
}
function Buildings() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    WORLD.buildings.forEach((b, i) => {
      tmp.position.set(b.x, b.h / 2, b.z); tmp.scale.set(b.w * 2, b.h, b.d * 2); tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix); ref.current.setColorAt(i, new THREE.Color(b.color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, []);
  return <instancedMesh ref={ref} args={[undefined, undefined, WORLD.buildings.length]}><boxGeometry /><meshLambertMaterial /></instancedMesh>;
}
function Forest() {
  const trunks = useRef<THREE.InstancedMesh>(null!), crowns = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    WORLD.trees.forEach((t, i) => {
      tmp.scale.setScalar(t.s); tmp.position.set(t.x, 1.5 * t.s, t.z); tmp.updateMatrix(); trunks.current.setMatrixAt(i, tmp.matrix);
      tmp.position.y = 5.2 * t.s; tmp.updateMatrix(); crowns.current.setMatrixAt(i, tmp.matrix);
    });
    trunks.current.instanceMatrix.needsUpdate = crowns.current.instanceMatrix.needsUpdate = true;
  }, []);
  const n = WORLD.trees.length;
  return (<>
    <instancedMesh ref={trunks} args={[undefined, undefined, n]}><cylinderGeometry args={[0.35, 0.5, 3, 6]} /><meshLambertMaterial color="#5a3a22" /></instancedMesh>
    <instancedMesh ref={crowns} args={[undefined, undefined, n]}><coneGeometry args={[2.4, 6, 7]} /><meshLambertMaterial color="#1f6b2f" /></instancedMesh>
  </>);
}
function Graves() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const r = mulberry32(99);
    for (let i = 0; i < 70; i++) {
      const a = range(r, 0, Math.PI * 2), d = range(r, 4, 38);
      tmp.position.set(GRAVEYARD.x + Math.cos(a) * d, 0.7, GRAVEYARD.z + Math.sin(a) * d); tmp.rotation.y = range(r, -0.3, 0.3); tmp.scale.setScalar(1); tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    tmp.rotation.set(0, 0, 0); ref.current.instanceMatrix.needsUpdate = true;
  }, []);
  return <instancedMesh ref={ref} args={[undefined, undefined, 70]}><boxGeometry args={[0.8, 1.4, 0.3]} /><meshLambertMaterial color="#555560" /></instancedMesh>;
}
function Mountains() {
  const items = useMemo(() => {
    const r = mulberry32(7);
    return Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2 + range(r, -0.07, 0.07), d = range(r, 345, 420), h = range(r, 70, 160);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, h, w: range(r, 45, 80), c: i % 3 ? "#6b6258" : "#7d7468", cap: range(r, 10, 16) };
    });
  }, []);
  return <>{items.map((m, i) => (<group key={i} position={[m.x, 0, m.z]}>
    <mesh position-y={m.h / 2 - 4}><coneGeometry args={[m.w, m.h, 7]} /><meshLambertMaterial color={m.c} /></mesh>
    <mesh position-y={m.h * 0.86 - 4}><coneGeometry args={[m.cap, m.h * 0.28, 7]} /><meshLambertMaterial color="#f2f4f8" /></mesh>
  </group>))}</>;
}
function Roads() {
  const lines = [-2, -1, 0, 1, 2].map((k) => k * 60);
  return <>{lines.flatMap((k) => [
    <mesh key={`x${k}`} rotation-x={-Math.PI / 2} position={[k, 0.08, 0]}><planeGeometry args={[16, 260]} /><meshLambertMaterial color="#2c2c33" /></mesh>,
    <mesh key={`z${k}`} rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position={[0, 0.08, k]}><planeGeometry args={[16, 260]} /><meshLambertMaterial color="#2c2c33" /></mesh>,
  ])}</>;
}
export function World() {
  return (<>
    <Disc r={700} color="#2f5a2c" y={-0.1} /><Disc r={CITY_RADIUS} color="#77746a" y={0} />
    <Ring a={CITY_RADIUS} b={FARM_RADIUS} color="#8aa84e" y={0.02} /><Ring a={FARM_RADIUS} b={JUNGLE_RADIUS} color="#2d6a33" y={0.03} />
    <Disc r={GRAVEYARD.r} color="#2a2a30" y={0.06} x={GRAVEYARD.x} z={GRAVEYARD.z} />
    <Roads /><Buildings /><Forest /><Graves /><Mountains />
    <mesh position={[0, 11, -116]}><boxGeometry args={[70, 22, 10]} /><meshLambertMaterial color="#d9a066" /></mesh>
    <mesh position={[0, 22, -116]}><sphereGeometry args={[10, 20, 12]} /><meshLambertMaterial color="#e8c27a" /></mesh>
  </>);
}
