import * as THREE from "three";
import { AGE_STATS, type Appearance } from "@votechor/shared";

const geo = new Map<string, THREE.BoxGeometry>();
const mats = new Map<string, THREE.MeshLambertMaterial>();
const bx = (w: number, h: number, d: number) => { const k = `${w},${h},${d}`; let g = geo.get(k); if (!g) geo.set(k, (g = new THREE.BoxGeometry(w, h, d))); return g; };
const mt = (c: string) => { let m = mats.get(c); if (!m) mats.set(c, (m = new THREE.MeshLambertMaterial({ color: c }))); return m; };
const head = new THREE.SphereGeometry(0.24, 10, 8), hairG = new THREE.SphereGeometry(0.27, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const part = (g: THREE.BufferGeometry, c: string, x: number, y: number, z: number, p: THREE.Object3D) => { const m = new THREE.Mesh(g, mt(c)); m.position.set(x, y, z); p.add(m); return m; };

interface Rig { legs: THREE.Group[]; arms: THREE.Group[] }

/** Procedural character from an Appearance (faction, body, age, cap, colours). */
export function buildCharacter(a: Appearance): THREE.Group {
  const g = new THREE.Group(), pol = a.fac === "police", pants = pol ? "#1d2a4a" : "#2b3556";
  part(bx(0.7, 0.9, 0.4), a.shirt, 0, 1.35, 0, g);
  part(head, a.skin, 0, 2.02, 0, g);
  const hair = a.age === "old" ? "#d8d8d8" : "#1a1210";
  part(hairG, hair, 0, 2.05, 0, g);
  if (a.sex === "girl") part(bx(0.34, 0.7, 0.14), hair, 0, 1.78, -0.2, g);
  if (a.cap) { part(bx(0.56, 0.14, 0.56), pol ? "#1b2a4a" : a.shirt, 0, 2.27, 0, g); if (pol) part(bx(0.4, 0.04, 0.3), "#111111", 0, 2.21, 0.38, g); }
  const rig: Rig = { legs: [], arms: [] };
  for (const s of [-1, 1]) {
    const l = new THREE.Group(); l.position.set(s * 0.18, 0.9, 0);
    part(bx(0.26, 0.9, 0.28), pants, 0, -0.45, 0, l); part(bx(0.3, 0.14, 0.4), a.shoe, 0, -0.92, 0.05, l); g.add(l); rig.legs.push(l);
    const m = new THREE.Group(); m.position.set(s * 0.46, 1.72, 0);
    part(bx(0.2, 0.75, 0.2), a.shirt, 0, -0.36, 0, m); part(bx(0.18, 0.18, 0.18), a.skin, 0, -0.8, 0, m); g.add(m); rig.arms.push(m);
  }
  g.scale.setScalar(AGE_STATS[a.age].scale);
  g.userData.rig = rig;
  return g;
}
export function poseCharacter(g: THREE.Group, speed: number, t: number, phase = 0) {
  const r = g.userData.rig as Rig, k = Math.sin(t * (4 + speed) + phase) * Math.min(1, speed / 4) * 0.9;
  r.legs[0].rotation.x = k; r.legs[1].rotation.x = -k; r.arms[0].rotation.x = -k; r.arms[1].rotation.x = k;
}

const ANIMAL_COLORS = ["", "#a57a3a", "#5a4636", "#8a5a2b"];
/** Simple quadruped for deer (1), boar (2), monkey (3). */
export function buildAnimal(kind: number): THREE.Group {
  const g = new THREE.Group(), c = ANIMAL_COLORS[kind] ?? "#8a5a2b", s = kind === 2 ? 0.8 : kind === 3 ? 0.6 : 1;
  part(bx(0.9, 0.8, 1.6), c, 0, 0.9, 0, g); part(bx(0.4, 0.5, 0.5), c, 0, 1.4, 0.9, g);
  for (const [x, z] of [[-0.3, 0.5], [0.3, 0.5], [-0.3, -0.5], [0.3, -0.5]]) part(bx(0.2, 0.7, 0.2), c, x, 0.35, z, g);
  g.scale.setScalar(s); return g;
}
