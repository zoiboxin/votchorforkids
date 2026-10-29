import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ARENA, BALLOT, BOSS_POS, ITEMS, newBody, nightFactor, stepBody, zoneOf, type Appearance, type PlayerInput } from "@votechor/shared";
import { getRoom, interact } from "./net";
import { toast, useGame } from "./store";
import { buildAnimal, buildCharacter, poseCharacter } from "./Character";
import { WORLD } from "./World";
import { updateAudio } from "./audio";

/** Shared control state written by DOM listeners, read once per frame. */
export const ctl = { keys: {} as Record<string, boolean>, yaw: 0, pitch: 0.2, drag: false, mx: 0, my: 0 };
const PI2 = Math.PI * 2;
const DAY = new THREE.Color(0x8fd3ff), DUSK = new THREE.Color(0xff9a5a), NIGHT = new THREE.Color(0x090d24);

export function useControls() {
  useEffect(() => {
    const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => { if (typing(e)) return; ctl.keys[e.code] = true; if (e.code === "Space") e.preventDefault(); if (e.code === "KeyE" && !e.repeat) interact(); };
    const up = (e: KeyboardEvent) => { if (!typing(e)) ctl.keys[e.code] = false; };
    const md = () => { ctl.drag = true; };
    const mu = () => { ctl.drag = false; };
    const mm = (e: MouseEvent) => {
      if (useGame.getState().screen !== "play") return;
      if (document.pointerLockElement || ctl.drag) { ctl.yaw -= e.movementX * 0.0027; ctl.pitch = Math.min(1.1, Math.max(-0.3, ctl.pitch + e.movementY * 0.002)); }
    };
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("mousedown", md); addEventListener("mouseup", mu); addEventListener("mousemove", mm);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("mousedown", md); removeEventListener("mouseup", mu); removeEventListener("mousemove", mm); };
  }, []);
}

/** Day/night driven by the server clock so every player sees the same time. */
export function Env() {
  const { scene } = useThree();
  const hemi = useRef<THREE.HemisphereLight>(null!), sun = useRef<THREE.DirectionalLight>(null!);
  const local = useRef(0.33);
  useFrame((_, dt) => {
    const room = getRoom();
    local.current = (local.current + dt / 300) % 1;
    const clock: number = room?.state?.clock ?? local.current;
    const n = nightFactor(clock), h = Math.sin(PI2 * (clock - 0.25)), dk = Math.max(0, 1 - Math.abs(h) * 5);
    const sky = new THREE.Color().copy(DAY).lerp(NIGHT, n); if (dk > 0) sky.lerp(DUSK, dk * 0.6);
    scene.background = sky; scene.fog = new THREE.Fog(sky, 60, n > 0.5 ? 260 : 380);
    hemi.current.intensity = 0.22 + 0.7 * (1 - n); sun.current.intensity = 1.1 * (1 - n);
    sun.current.position.set(Math.cos(PI2 * (clock - 0.25)) * 200, Math.max(20, h * 200), 80);
  });
  return (<><hemisphereLight ref={hemi} args={[0xffffff, 0x445533, 0.8]} /><directionalLight ref={sun} args={[0xfff2d0, 1]} /></>);
}

/** Creator preview: slowly orbit a character standing in the plaza. */
export function Preview({ look }: { look: Appearance }) {
  const g = useMemo(() => buildCharacter(look), [look]);
  useFrame((s, dt) => {
    ctl.yaw += dt * 0.5; const h = g.scale.y * 1.7;
    s.camera.position.set(Math.sin(ctl.yaw) * 5, h + 0.6, 6 + Math.cos(ctl.yaw) * 5); s.camera.lookAt(0, h, 6);
    poseCharacter(g, 0, s.clock.elapsedTime);
  });
  return <primitive object={g} position={[0, 0, 6]} />;
}

function readInput(): PlayerInput {
  const k = ctl.keys;
  return { f: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), r: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), yaw: ctl.yaw, sprint: !!(k.ShiftLeft || k.ShiftRight), jump: !!k.Space };
}

/**
 * The local player: client-side prediction using the same shared movement code as the server.
 * Server state is authoritative; large errors snap, small ones are gently blended.
 */
export function Me() {
  const look = useGame((s) => s.look);
  const g = useMemo(() => buildCharacter(look), [look]);
  const body = useRef(newBody(0, 6)), init = useRef(false), acc = useRef(0), hudT = useRef(0), zone = useRef("");
  useFrame((state, dt0) => {
    const room = getRoom(); if (!room) return;
    const sp = room.state?.players?.get(room.sessionId); if (!sp) return;
    const dt = Math.min(0.05, dt0), b = body.current;
    if (!init.current) { b.x = sp.x; b.z = sp.z; init.current = true; }
    const inp = readInput();
    if (sp.mode === 1) { b.x = sp.x; b.z = sp.z; b.y = 0; b.vx = b.vz = 0; }
    else {
      stepBody(b, inp, dt, look.age, WORLD);
      const ex = sp.x - b.x, ez = sp.z - b.z, err = Math.hypot(ex, ez);
      if (err > 6) { b.x = sp.x; b.z = sp.z; } else if (err > 2.5) { b.x += ex * 0.05; b.z += ez * 0.05; }
    }
    acc.current += dt;
    if (acc.current >= 0.05) { acc.current = 0; room.send("input", inp); }
    g.position.set(b.x, b.y, b.z);
    let d = b.face - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * Math.min(1, dt * 12);
    poseCharacter(g, Math.hypot(b.vx, b.vz), state.clock.elapsedTime);
    const cd = 7.5, cam = state.camera;
    cam.position.set(b.x + Math.sin(ctl.yaw) * cd * Math.cos(ctl.pitch), Math.max(0.8, b.y + 2 + Math.sin(ctl.pitch) * cd), b.z + Math.cos(ctl.yaw) * cd * Math.cos(ctl.pitch));
    cam.lookAt(b.x, b.y + 1.6, b.z);
    const z = zoneOf(b.x, b.z), n = nightFactor(room.state.clock);
    updateAudio(z, n, sp.stars, dt);
    if (z !== zone.current) {
      zone.current = z;
      const m: Record<string, string> = { Jungle: "Jungle ahead. Chai supply: uncertain.", Graveyard: "Graveyard. The locals are not friendly.", Farmland: "Farmland. Cows have right of way.", City: "Back in the city. Traffic is imaginary.", "Mountain Wall": "The mountains say no. Democracy ends here." };
      toast(m[z]);
    }
    hudT.current += dt;
    if (hudT.current > 0.1) {
      hudT.current = 0;
      const mates: { id: string; name: string; hp: number; detained: boolean }[] = [];
      let prompt = "";
      if (sp.squad) room.state.players.forEach((p: any, id: string) => {
        if (id === room.sessionId || p.squad !== sp.squad) return;
        mates.push({ id, name: p.name, hp: p.hp, detained: p.mode === 1 });
        if (p.mode === 1 && sp.mode !== 1 && Math.hypot(p.x - sp.x, p.z - sp.z) < 3.5) prompt = `Press E to rescue ${p.name}`;
      });
      const bs = room.state.boss, bp = bs?.phase ?? 0;
      let progress = ""; bs?.stations?.forEach((st: any) => { progress += (progress ? " · " : "") + `${st.progress}/${st.need}`; });
      const inArena = Math.hypot(sp.x - ARENA.x, sp.z - ARENA.z) <= ARENA.r;
      if (inArena && sp.mode !== 1 && !prompt) {
        if (bp === 2) bs.stations.forEach((st: any) => { if (st.progress < st.need && Math.hypot(sp.x - st.x, sp.z - st.z) < 3) prompt = "Press E to sort documents"; });
        if (bp === 5 && Math.hypot(sp.x - BALLOT.x, sp.z - BALLOT.z) < 3.5) prompt = "Press E to cast your vote";
      }
      useGame.setState({ hud: { boss: { phase: bp, hp: bs?.hp ?? 100, timer: bs?.timer ?? 0, votes: bs?.votes ?? 0, need: bs?.need ?? 1, hold: bs?.hold ?? 0, round: bs?.round ?? 1, progress }, squad: sp.squad, support: sp.support, mates, prompt, hp: sp.hp, stamina: sp.stamina, stars: sp.stars, zone: z, clock: room.state.clock, real: room.state.real, bots: room.state.bots, detained: sp.mode === 1 } });
    }
  });
  return <primitive object={g} />;
}

function Actor({ id }: { id: string }) {
  const room = getRoom();
  const g = useMemo(() => {
    const p = room?.state?.players?.get(id);
    return buildCharacter(p ? { fac: p.fac, sex: p.sex, age: p.age, cap: p.cap, skin: p.skin, shirt: p.shirt, shoe: p.shoe } : useGame.getState().look);
  }, [id, room]);
  const first = useRef(true), phase = useMemo(() => Math.random() * 6, []);
  useFrame((state, dt) => {
    const p = getRoom()?.state?.players?.get(id); if (!p) return;
    if (first.current) { g.position.set(p.x, p.y, p.z); first.current = false; }
    const k = 1 - Math.exp(-dt * 12); // smooth interpolation toward the latest server snapshot
    g.position.x += (p.x - g.position.x) * k; g.position.y += (p.y - g.position.y) * k; g.position.z += (p.z - g.position.z) * k;
    let d = p.ry - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * k;
    const cam = state.camera.position, near = (g.position.x - cam.x) ** 2 + (g.position.z - cam.z) ** 2 < 150 * 150;
    g.visible = near; if (near) poseCharacter(g, p.spd, state.clock.elapsedTime, phase);
  });
  return <primitive object={g} />;
}
export function Actors() {
  const ids = useGame((s) => s.ids), me = getRoom()?.sessionId;
  return <>{ids.filter((i) => i !== me).map((i) => <Actor key={i} id={i} />)}</>;
}

/** All collectibles as one instanced mesh, driven by replicated server state. */
export function Items() {
  const ref = useRef<THREE.InstancedMesh>(null!), tmp = useMemo(() => new THREE.Object3D(), []), col = useMemo(() => new THREE.Color(), []);
  useFrame((s) => {
    const items = getRoom()?.state?.items; if (!items) return;
    let i = 0;
    items.forEach((it: any) => {
      if (i >= 64) return;
      const on = it.active ? 1 : 0;
      tmp.position.set(it.x, 1 + Math.sin(s.clock.elapsedTime * 3 + i) * 0.2, it.z); tmp.rotation.y = s.clock.elapsedTime * 2; tmp.scale.setScalar(on * (it.kind === 4 ? 1.3 : 1));
      tmp.updateMatrix(); ref.current.setMatrixAt(i, tmp.matrix); ref.current.setColorAt(i, col.set(ITEMS[it.kind]?.color ?? "#fff")); i++;
    });
    ref.current.count = i; ref.current.instanceMatrix.needsUpdate = true; if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[undefined, undefined, 64]} frustumCulled={false}><octahedronGeometry args={[0.5]} /><meshBasicMaterial /></instancedMesh>;
}

const ZOMBIE = { fac: "protester", sex: "boy", age: "young", cap: 0, skin: "#7aa66a", shirt: "#4a4a3a", shoe: "#222222" } as const;
/** Zombies and animals: server-driven creatures, built once when the state arrives, then interpolated. */
export function Creatures() {
  const root = useRef<THREE.Group>(null!), objs = useRef(new Map<string, THREE.Group>());
  useFrame((s, dt) => {
    const cr = getRoom()?.state?.creatures; if (!cr) return;
    const k = 1 - Math.exp(-dt * 10), cam = s.camera.position;
    cr.forEach((c: any, id: string) => {
      let g = objs.current.get(id);
      if (!g) { g = c.kind === 0 ? buildCharacter(ZOMBIE) : buildAnimal(c.kind); g.position.set(c.x, 0, c.z); objs.current.set(id, g); root.current.add(g); }
      g.position.x += (c.x - g.position.x) * k; g.position.z += (c.z - g.position.z) * k;
      let d = c.ry - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * k;
      g.visible = (g.position.x - cam.x) ** 2 + (g.position.z - cam.z) ** 2 < 160 * 160;
      if (c.kind === 0 && g.visible) { poseCharacter(g, c.spd * 1.5, s.clock.elapsedTime, 0); g.userData.rig.arms.forEach((a: THREE.Object3D) => (a.rotation.x = -1.4)); }
    });
  });
  return <group ref={root} />;
}

/** The Great Vote Collector: giant bureaucrat, arena ring, telegraphed hazards, stations, ballot box. Driven by server state. */
export function BossArena() {
  const boss = useRef<THREE.Group>(null!), stamp = useRef<THREE.Group>(null!), shield = useRef<THREE.Mesh>(null!);
  const hz = useRef<THREE.Group>(null!), st = useRef<THREE.Group>(null!), ballot = useRef<THREE.Mesh>(null!);
  useFrame((s) => {
    const bs = getRoom()?.state?.boss; if (!bs) return;
    const t = s.clock.elapsedTime, ph: number = bs.phase;
    boss.current.position.y = Math.sin(t * 1.5) * 0.3; boss.current.rotation.y = Math.sin(t * 0.5) * 0.15;
    let slam = 0; bs.hazards.forEach((h: any) => { if (h.kind === 1 && h.t < 0.4) slam = 1; });
    stamp.current.position.y = ph === 3 ? (slam ? 7 : 12 + Math.sin(t * 4)) : 9 + Math.sin(t * 2) * 0.5;
    shield.current.visible = ph >= 1 && ph <= 5; (shield.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.12 * Math.sin(t * 3) + (5 - Math.min(ph, 5)) * 0.02;
    ballot.current.visible = ph === 5;
    // hazards (pooled): ring = full radius, fill grows as the hit time approaches
    let i = 0;
    bs.hazards.forEach((h: any) => {
      const g = hz.current.children[i++] as THREE.Group; if (!g) return;
      const total = h.kind === 1 ? 1.8 : 1.6, f = 1 - Math.max(0, h.t) / total;
      g.visible = true; g.position.set(h.x, 0.15, h.z); g.scale.setScalar(h.r);
      (g.children[1] as THREE.Mesh).scale.setScalar(Math.max(0.05, f));
      const col = h.kind === 1 ? "#e0483a" : "#f5a524";
      ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(col); ((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(col);
    });
    for (; i < hz.current.children.length; i++) hz.current.children[i].visible = false;
    // stations: document piles in phase 2, glowing plates in phase 4
    let j = 0;
    bs.stations.forEach((q: any) => {
      const g = st.current.children[j++] as THREE.Group; if (!g) return;
      g.visible = true; g.position.set(q.x, 0, q.z);
      const pile = g.children[0] as THREE.Mesh, plate = g.children[1] as THREE.Mesh;
      pile.visible = ph === 2; plate.visible = ph === 4;
      const frac = q.need ? q.progress / q.need : 0; pile.scale.y = Math.max(0.2, 2.2 * (1 - frac)); pile.position.y = pile.scale.y / 2;
      (plate.material as THREE.MeshBasicMaterial).color.set(bs.hold > 0 ? "#3fae5a" : "#f5d03a");
    });
    for (; j < st.current.children.length; j++) st.current.children[j].visible = false;
  });
  const m = (c: string, o = 0.5) => <meshBasicMaterial color={c} transparent opacity={o} depthWrite={false} />;
  return (<group>
    <mesh rotation-x={-Math.PI / 2} position={[ARENA.x, 0.12, ARENA.z]}><ringGeometry args={[ARENA.r - 0.5, ARENA.r, 96]} />{m("#e0483a", 0.7)}</mesh>
    <group ref={boss} position={[BOSS_POS.x, 0, BOSS_POS.z]}>
      <mesh position-y={4}><coneGeometry args={[4, 8, 12]} /><meshLambertMaterial color="#e8892b" /></mesh>
      <mesh position-y={9.5}><sphereGeometry args={[1.6, 16, 12]} /><meshLambertMaterial color="#c68642" /></mesh>
      <mesh position-y={11.3}><cylinderGeometry args={[1.2, 1.8, 1.4, 12]} /><meshLambertMaterial color="#fff4dc" /></mesh>
      <group ref={stamp} position={[4.5, 9, 3]}>
        <mesh><cylinderGeometry args={[0.35, 0.35, 5, 8]} /><meshLambertMaterial color="#5a3a22" /></mesh>
        <mesh position-y={-2.8}><cylinderGeometry args={[2, 2, 0.8, 16]} /><meshLambertMaterial color="#b3261e" /></mesh>
      </group>
      <mesh ref={shield} position={[0, 6, 4]}><circleGeometry args={[6, 32]} />{m("#9fd4ff", 0.25)}</mesh>
    </group>
    <group ref={hz}>{Array.from({ length: 16 }, (_, i) => (<group key={i} visible={false}>
      <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[0.92, 1, 40]} />{m("#e0483a", 0.9)}</mesh>
      <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[1, 40]} />{m("#e0483a", 0.35)}</mesh></group>))}</group>
    <group ref={st}>{[0, 1, 2].map((i) => (<group key={i} visible={false}>
      <mesh><boxGeometry args={[1.6, 1, 1.2]} /><meshLambertMaterial color="#fff4dc" /></mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.2}><circleGeometry args={[2.4, 32]} />{m("#f5d03a", 0.6)}</mesh></group>))}</group>
    <mesh ref={ballot} visible={false} position={[BALLOT.x, 0.8, BALLOT.z]}><boxGeometry args={[1.6, 1.6, 1.2]} /><meshLambertMaterial color="#2a6fdb" /></mesh>
  </group>);
}
