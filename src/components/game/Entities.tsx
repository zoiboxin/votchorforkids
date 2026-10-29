"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ANIMAL_SET, CIVIL_NAMES, HAIR_COLORS, ITEMS, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES,
  TOTAL_VOTES, type Appearance,
} from "@/lib/game/constants";
import type { GameEngine } from "@/lib/game/engine";
import { nightFactor } from "@/lib/game/sim";
import { mulberry32, range } from "@/lib/game/rng";
import {
  buildAnimal, buildCharacter, buildFood, buildVoteToken, nameTag, helpBubble, poseAnimal, poseCharacter,
} from "@/lib/game/character";
import { useGame } from "./store";

export type ClockRef = { current: number };

/* ------------------------------------------------------------------ */
/* Player + camera + engine tick                                       */
/* ------------------------------------------------------------------ */
export function GameLoop({ engine, clockRef }: { engine: GameEngine; clockRef: ClockRef }) {
  const look = useGame((s) => s.look);
  const setHud = useGame((s) => s.setHud);
  const mesh = useMemo(() => buildCharacter(look), [look]);
  const lantern = useRef<THREE.PointLight>(null!);
  const introT = useRef(0);
  const hudT = useRef(0);
  const { camera } = useThree();

  useFrame((_, dt0) => {
    const dt = Math.min(0.05, dt0);
    engine.update(dt);
    clockRef.current = engine.clock;
    if (lantern.current) lantern.current.intensity = nightFactor(engine.clock) * 26;

    // player mesh
    const p = engine.player;
    mesh.position.set(p.x, p.y, p.z);
    let d = p.face - mesh.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    mesh.rotation.y += d * Math.min(1, dt * 14);
    poseCharacter(mesh, Math.hypot(p.vx, p.vz), performance.now() / 1000, {
      airborne: p.y > 0.12,
      detained: engine.detainedT > 0,
    });

    // carried votes orbit the player's head (rendered by <Pickups>)

    // camera — intro swoop then smooth follow
    const cd = 8.6;
    const iy = engine.input.yaw, ip = engine.input.pitch;
    const tx = p.x + Math.sin(iy) * cd * Math.cos(ip);
    const ty = Math.max(1.2, p.y + 2.1 + Math.sin(ip) * cd);
    const tz = p.z + Math.cos(iy) * cd * Math.cos(ip);
    if (introT.current < 1) {
      introT.current = Math.min(1, introT.current + dt / 2.4);
      const e = 1 - Math.pow(1 - introT.current, 3);
      camera.position.set(
        THREE.MathUtils.lerp(p.x, tx, e) + (1 - e) * 40,
        THREE.MathUtils.lerp(60, ty, e),
        THREE.MathUtils.lerp(p.z + 90, tz, e),
      );
    } else {
      camera.position.set(tx, ty, tz);
    }
    camera.lookAt(p.x, p.y + 1.7, p.z);

    // HUD @ ~8 Hz
    hudT.current += dt;
    if (hudT.current > 0.12) {
      hudT.current = 0;
      setHud(engine.getHud());
    }
  });

  return (
    <>
      <primitive object={mesh} />
      <pointLight ref={lantern} distance={30} decay={1.5} color="#ffca7a" position={[0, 2.6, 0]} intensity={0} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* NPCs — police & civilians                                           */
/* ------------------------------------------------------------------ */
interface NpcView { mesh: THREE.Object3D; tag?: THREE.Sprite; bubble?: THREE.Sprite }

export function Npcs({ engine }: { engine: GameEngine }) {
  const views = useMemo(() => {
    const r = mulberry32(4242);
    const civLooks: Appearance[] = engine.civs.map((c) => ({
      skin: SKIN_TONES[Math.floor(r() * SKIN_TONES.length)],
      shirt: SHIRT_COLORS[Math.floor(r() * SHIRT_COLORS.length)],
      pants: PANTS_COLORS[Math.floor(r() * PANTS_COLORS.length)],
      shoe: ["#3b2314", "#111111", "#f5f5f5"][Math.floor(r() * 3)],
      hair: HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)],
      hairStyle: (["spiky", "bowl", "ponytail", "bald"] as const)[Math.floor(r() * 4)],
      cap: r() < 0.25,
      age: (["kid", "teen", "young", "old"] as const)[Math.floor(r() * 4)],
      girl: r() < 0.5,
    }));
    const map = new Map<number, NpcView>();
    engine.cops.forEach((c) => {
      const mesh = buildCharacter(
        { skin: SKIN_TONES[1], shirt: "#2b4a8f", pants: "#1d2a4a", shoe: "#111111", hair: "#1a1210", hairStyle: "bowl", cap: true, age: "young", girl: false },
        { police: true },
      );
      const tag = nameTag("POLICE", "rgba(30,50,120,0.85)");
      tag.position.y = 2.85;
      mesh.add(tag);
      map.set(c.id, { mesh, tag });
    });
    engine.civs.forEach((c, i) => {
      const mesh = buildCharacter(civLooks[i]);
      const tag = nameTag(c.name);
      tag.position.y = 2.85;
      mesh.add(tag);
      const bubble = helpBubble();
      bubble.position.y = 3.6;
      bubble.visible = false;
      mesh.add(bubble);
      map.set(c.id, { mesh, tag, bubble });
    });
    return map;
  }, [engine]);

  const group = useRef<THREE.Group>(null!);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (const list of [engine.cops, engine.civs]) {
      for (const n of list) {
        const v = views.get(n.id);
        if (!v) continue;
        v.mesh.position.set(n.x, 0, n.z);
        let dd = n.face - v.mesh.rotation.y;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        v.mesh.rotation.y += dd * 0.15;
        const speed = Math.hypot(n.vx, n.vz);
        poseCharacter(v.mesh, speed, t, { phase: n.phase, detained: n.mode === "detained" });
        if (v.bubble) v.bubble.visible = n.mode === "detained";
        if (v.tag) v.tag.visible = n.mode !== "detained";
      }
    }
  });
  return (
    <group ref={group}>
      {[...views.values()].map((v, i) => <primitive object={v.mesh} key={i} />)}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Zombies                                                             */
/* ------------------------------------------------------------------ */
export function Zombies({ engine }: { engine: GameEngine }) {
  const views = useMemo(
    () => new Map(engine.zombies.map((z) => [z.id, buildCharacter(
      { skin: "#8fbf6f", shirt: "#7a8a5a", pants: "#4a5240", shoe: "#3a3a2a", hair: "#3a4a2a", hairStyle: "bowl", cap: false, age: "young", girl: false },
      { zombie: true },
    )])),
    [engine],
  );
  useFrame((s) => {
    const night = nightFactor(engine.clock);
    const t = s.clock.elapsedTime;
    for (const z of engine.zombies) {
      const m = views.get(z.id)!;
      const vis = night > 0.4;
      m.visible = vis;
      if (!vis) continue;
      const sink = THREE.MathUtils.clamp((0.4 - night) * 8, -1.8, 0);
      m.position.set(z.x, sink, z.z);
      let dd = z.face - m.rotation.y;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      m.rotation.y += dd * 0.12;
      poseCharacter(m, Math.hypot(z.vx, z.vz), t, { phase: z.phase, zombie: true });
    }
  });
  return <>{[...views.values()].map((m, i) => <primitive object={m} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Animals                                                             */
/* ------------------------------------------------------------------ */
export function Animals({ engine }: { engine: GameEngine }) {
  const views = useMemo(() => {
    const map = new Map<number, THREE.Object3D>();
    const kinds = ANIMAL_SET.flatMap((s) => Array.from({ length: s.count }, () => s.kind));
    engine.animals.forEach((a, i) => map.set(a.id, buildAnimal(kinds[i])));
    return map;
  }, [engine]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (const a of engine.animals) {
      const m = views.get(a.id)!;
      m.position.set(a.x, 0, a.z);
      let dd = a.face - m.rotation.y;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      m.rotation.y += dd * 0.12;
      poseAnimal(m, Math.hypot(a.vx, a.vz), t, a.phase);
    }
  });
  return <>{[...views.values()].map((m, i) => <primitive object={m} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Items + votes                                                       */
/* ------------------------------------------------------------------ */
export function Pickups({ engine }: { engine: GameEngine }) {
  const itemViews = useMemo(
    () => new Map(engine.items.map((it) => [it.id, buildFood(ITEMS[it.def].kind, ITEMS[it.def].color)])),
    [engine],
  );
  const voteViews = useMemo(
    () => new Map(engine.votes.map((v) => [v.id, buildVoteToken()])),
    [engine],
  );
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (const it of engine.items) {
      const m = itemViews.get(it.id)!;
      m.visible = it.active;
      if (it.active) {
        m.position.set(it.x, 0.55 + Math.sin(t * 2.2 + it.id) * 0.12, it.z);
        m.rotation.y = t * 1.4 + it.id;
      }
    }
    const p = engine.player;
    let slot = 0;
    for (const v of engine.votes) {
      const m = voteViews.get(v.id)!;
      if (v.state === "world") {
        m.visible = true;
        m.position.set(v.x, 0.75 + Math.sin(t * 2.6 + v.id) * 0.16, v.z);
        m.rotation.y = t * 2 + v.id;
      } else if (v.state === "carried") {
        m.visible = true;
        const a = (slot / Math.max(1, engine.carriedVotes.length)) * Math.PI * 2;
        slot++;
        m.position.set(p.x + Math.cos(a) * 0.5, p.y + 2.75 + Math.sin(t * 3) * 0.06, p.z + Math.sin(a) * 0.5);
        m.rotation.y = t * 3;
        m.scale.setScalar(0.85);
      } else {
        m.visible = false;
      }
    }
  });
  return (
    <>
      {[...itemViews.values()].map((m, i) => <primitive object={m} key={`i${i}`} />)}
      {[...voteViews.values()].map((m, i) => <primitive object={m} key={`v${i}`} />)}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */
const N_CONF = 260;
export function Confetti({ engine }: { engine: GameEngine }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const parts = useMemo(() => Array.from({ length: N_CONF }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, rx: Math.random() * 3, rz: Math.random() * 3,
  })), []);
  const colors = useMemo(() => {
    const palette = [new THREE.Color("#ff6b8a"), new THREE.Color("#ffd166"), new THREE.Color("#6bd68a"), new THREE.Color("#7bc4ff"), new THREE.Color("#c77dff")];
    return Array.from({ length: N_CONF }, (_, i) => palette[i % palette.length]);
  }, []);

  useLayoutEffectInit(mesh, colors);

  useFrame((_, dt0) => {
    const dt = Math.min(0.05, dt0);
    // drain fx queue
    for (const fx of engine.fxQueue.splice(0)) {
      let spawned = 0;
      for (const pt of parts) {
        if (pt.life > 0) continue;
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
        pt.x = fx.x; pt.y = fx.y; pt.z = fx.z;
        pt.vx = Math.cos(a) * sp; pt.vz = Math.sin(a) * sp; pt.vy = 4 + Math.random() * 5;
        pt.life = 1.4 + Math.random() * 0.8;
        if (++spawned >= 70) break;
      }
    }
    let any = false;
    for (let i = 0; i < N_CONF; i++) {
      const pt = parts[i];
      if (pt.life <= 0) continue;
      any = true;
      pt.life -= dt;
      pt.vy -= 12 * dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.vx *= 0.99; pt.vz *= 0.99;
      const s = pt.life > 0 ? 0.16 : 0;
      tmpM.position.set(pt.x, Math.max(0.05, pt.y), pt.z);
      tmpM.rotation.set(pt.rx + pt.life * 8, 0, pt.rz + pt.life * 6);
      tmpM.scale.set(s, s * 1.8, s * 0.4);
      tmpM.updateMatrix();
      mesh.current.setMatrixAt(i, tmpM.matrix);
    }
    if (any) mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N_CONF]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

const tmpM = new THREE.Object3D();
function useLayoutEffectInit(mesh: React.RefObject<THREE.InstancedMesh | null>, colors: THREE.Color[]) {
  useEffect(() => {
    if (!mesh.current) return;
    mesh.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    colors.forEach((c, i) => mesh.current!.setColorAt(i, c));
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N_CONF; i++) mesh.current.setMatrixAt(i, zero);
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [mesh, colors]);
}
