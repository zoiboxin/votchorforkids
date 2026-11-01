"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ANIMAL_SET, CIVIL_NAMES, FLIP_S, HAIR_COLORS, HAIR_STYLES, ITEMS, ITEM_COUNT, LAND_SQUASH_S, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES,
  TOTAL_VOTES, type Appearance,
} from "@/lib/game/constants";
import type { GameEngine } from "@/lib/game/engine";
import { nightFactor } from "@/lib/game/sim";
import { mulberry32 } from "@/lib/game/rng";
import {
  buildAnimal, buildCharacter, nameTag, helpBubble, poseAnimal, poseCharacter,
  voteTokenGeometry, foodGeometry, shadowMaterial, basicVertexMaterial,
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
      vy: p.vy,
      flip: engine.flipT > 0 ? engine.flipT / FLIP_S : 0,
      squash: engine.squashT > 0 ? engine.squashT / LAND_SQUASH_S : 0,
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

/** Entities beyond this range from the camera are hidden & not animated (fog hides them anyway). */
const CULL_DIST = 118;
const CULL_SQ = CULL_DIST * CULL_DIST;
/** Facial details (lids, brows, name tags) are only rendered up close — free LOD. */
const DETAIL_DIST = 48;
const DETAIL_SQ = DETAIL_DIST * DETAIL_DIST;

export function Npcs({ engine }: { engine: GameEngine }) {
  const views = useMemo(() => {
    const r = mulberry32(4242);
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
    const civLooks: Appearance[] = engine.civs.map(() => ({
      skin: pick(SKIN_TONES),
      shirt: pick(SHIRT_COLORS),
      pants: pick(PANTS_COLORS),
      shoe: ["#3b2314", "#111111", "#f5f5f5"][Math.floor(r() * 3)],
      hair: pick(HAIR_COLORS),
      hairStyle: pick(HAIR_STYLES).id,
      cap: r() < 0.25,
      glasses: r() < 0.2,
      age: pick(["kid", "teen", "young", "old"] as const),
      girl: r() < 0.5,
    }));
    const map = new Map<number, NpcView>();
    engine.cops.forEach((c, i) => {
      const mesh = buildCharacter(
        { skin: pick(SKIN_TONES), shirt: "#2b4a8f", pants: "#1d2a4a", shoe: "#111111", hair: pick(["#1a1210", "#5a3a1a", "#4a4a58"] as const), hairStyle: pick(["bowl", "spiky", "bald"] as const), cap: true, glasses: false, age: pick(["young", "young", "old"] as const), girl: false },
        { police: true, mustache: i % 3 === 0 },
      );
      const tag = nameTag("POLICE", "rgba(30,50,120,0.85)");
      tag.position.y = 2.95;
      mesh.add(tag);
      map.set(c.id, { mesh, tag });
    });
    const PROTEST_TAGS = ["✊ GIVE VOTES BACK", "✊ VOTE CHOR GO!", "✊ WE WANT VOTES", "✊ KIDS FOR DEMOCRACY", "✊ CHAI > CORRUPTION", "✊ HONK FOR VOTES"];
    engine.civs.forEach((c, i) => {
      const mesh = buildCharacter(civLooks[i]);
      // protest marchers carry a slogan placard tag instead of their name
      const tag = nameTag(c.protest ? PROTEST_TAGS[i % PROTEST_TAGS.length] : c.name, c.protest ? "rgba(181,67,42,0.85)" : undefined);
      tag.position.y = 2.95;
      mesh.add(tag);
      const bubble = helpBubble();
      bubble.position.y = 3.7;
      bubble.visible = false;
      mesh.add(bubble);
      map.set(c.id, { mesh, tag, bubble });
    });
    return map;
  }, [engine]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    for (const list of [engine.cops, engine.civs]) {
      for (const n of list) {
        const v = views.get(n.id);
        if (!v) continue;
        const dx = n.x - cam.x, dz = n.z - cam.z;
        const d2 = dx * dx + dz * dz;
        const near = d2 < CULL_SQ;
        if (!near) { v.mesh.visible = false; continue; }
        v.mesh.visible = true;
        const close = d2 < DETAIL_SQ;
        const rig = v.mesh.userData.rig as { lids: THREE.Object3D[]; brows: THREE.Object3D[] } | undefined;
        if (rig) {
          for (const l of rig.lids) l.visible = close;
          for (const b of rig.brows) b.visible = close;
        }
        v.mesh.position.set(n.x, 0, n.z);
        let dd = n.face - v.mesh.rotation.y;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        v.mesh.rotation.y += dd * 0.15;
        const speed = Math.hypot(n.vx, n.vz);
        poseCharacter(v.mesh, speed, t, { phase: n.phase, detained: n.mode === "detained" });
        if (v.bubble) v.bubble.visible = close && n.mode === "detained";
        if (v.tag) v.tag.visible = close && n.mode !== "detained";
      }
    }
  });
  return <>{[...views.values()].map((v, i) => <primitive object={v.mesh} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Zombies                                                             */
/* ------------------------------------------------------------------ */
export function Zombies({ engine }: { engine: GameEngine }) {
  const views = useMemo(
    () => new Map(engine.zombies.map((z) => [z.id, buildCharacter(
      { skin: "#8fbf6f", shirt: "#7a8a5a", pants: "#4a5240", shoe: "#3a3a2a", hair: "#3a4a2a", hairStyle: "bowl", cap: false, glasses: false, age: "young", girl: false },
      { zombie: true },
    )])),
    [engine],
  );
  useFrame((s) => {
    const night = nightFactor(engine.clock);
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    for (const z of engine.zombies) {
      const m = views.get(z.id)!;
      const vis = night > 0.4;
      const dx = z.x - cam.x, dz = z.z - cam.z;
      m.visible = vis && dx * dx + dz * dz < CULL_SQ;
      if (!m.visible) continue;
      // rise from the grave as night falls (fully out at night >= 0.55)
      const rise = THREE.MathUtils.clamp((night - 0.4) / 0.15, 0, 1);
      const sink = -1.8 * (1 - rise);
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
    const cam = s.camera.position;
    for (const a of engine.animals) {
      const m = views.get(a.id)!;
      const dx = a.x - cam.x, dz = a.z - cam.z;
      if (dx * dx + dz * dz > CULL_SQ) { m.visible = false; continue; }
      m.visible = true;
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
/* Items + votes + shadows — all instanced (a handful of draw calls)   */
/* ------------------------------------------------------------------ */
const dummy = new THREE.Object3D();
/** Shadow-blob radius multiplier per animal kind — matches buildAnimal conf.s. */
const ANIMAL_SCALES: Record<string, number> = { cow: 1.7, chicken: 0.95, deer: 1.45, monkey: 1.1 };

export function Pickups({ engine }: { engine: GameEngine }) {
  const { voteMesh, foodMeshes, kinds } = useMemo(() => {
    const mat = basicVertexMaterial();
    const voteMesh = new THREE.InstancedMesh(voteTokenGeometry(), mat, TOTAL_VOTES);
    voteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    voteMesh.frustumCulled = false;
    const foodMeshes = new Map<string, THREE.InstancedMesh>();
    for (const d of ITEMS) {
      if (foodMeshes.has(d.kind)) continue;
      const m = new THREE.InstancedMesh(foodGeometry(d.kind, d.color), mat, ITEM_COUNT);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      foodMeshes.set(d.kind, m);
    }
    return { voteMesh, foodMeshes, kinds: [...foodMeshes.keys()] };
  }, []);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const p = engine.player;
    /* votes */
    let vi = 0;
    let slot = 0;
    for (const v of engine.votes) {
      if (v.state === "delivered") continue;
      if (v.state === "world") {
        dummy.position.set(v.x, 0.75 + Math.sin(t * 2.6 + v.id) * 0.16, v.z);
        dummy.rotation.set(0, t * 2 + v.id, 0);
        dummy.scale.setScalar(1);
      } else {
        const a = (slot / Math.max(1, engine.carriedVotes.length)) * Math.PI * 2;
        slot++;
        dummy.position.set(p.x + Math.cos(a) * 0.5, p.y + 2.75 + Math.sin(t * 3) * 0.06, p.z + Math.sin(a) * 0.5);
        dummy.rotation.set(0, t * 3, 0);
        dummy.scale.setScalar(0.85);
      }
      dummy.updateMatrix();
      voteMesh.setMatrixAt(vi++, dummy.matrix);
    }
    voteMesh.count = vi;
    voteMesh.instanceMatrix.needsUpdate = true;
    /* items per kind */
    for (const [kind, mesh] of foodMeshes) {
      let fi = 0;
      for (const it of engine.items) {
        if (!it.active || ITEMS[it.def].kind !== kind || fi >= ITEM_COUNT) continue;
        dummy.position.set(it.x, 0.55 + Math.sin(t * 2.2 + it.id) * 0.12, it.z);
        dummy.rotation.set(0, t * 1.4 + it.id, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(fi++, dummy.matrix);
      }
      mesh.count = fi;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={voteMesh} />
      {kinds.map((k) => <primitive object={foodMeshes.get(k)!} key={k} />)}
    </>
  );
}

/** One instanced blob shadow for every moving entity (1 draw call). */
export function Shadows({ engine }: { engine: GameEngine }) {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(geo, shadowMaterial(), 64);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.renderOrder = 1;
    return m;
  }, []);
  const kinds = useMemo(() => ANIMAL_SET.flatMap((s2) => Array.from({ length: s2.count }, () => s2.kind)), []);
  useFrame(() => {
    let i = 0;
    const put = (x: number, z: number, r: number, lift = 0) => {
      if (i >= 64) return;
      dummy.position.set(x, 0.1, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(r * 2 * Math.max(0.55, 1 - lift * 0.1));
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    };
    const p = engine.player;
    put(p.x, p.z, 0.64, p.y);
    for (const c of engine.cops) put(c.x, c.z, 0.6);
    for (const c of engine.civs) put(c.x, c.z, 0.6);
    if (nightFactor(engine.clock) > 0.4) for (const z of engine.zombies) put(z.x, z.z, 0.6);
    for (let k = 0; k < engine.animals.length; k++) {
      const a = engine.animals[k];
      put(a.x, a.z, 0.7 * (ANIMAL_SCALES[kinds[k]] ?? 1));
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
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
