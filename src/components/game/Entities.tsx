"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ANIMAL_SET, ATTACK_CD, CAP_COLORS, CIVIL_NAMES, FAINT_S, FLIP_S, HAIR_COLORS, HAIR_STYLES, ITEMS, ITEM_COUNT, LAND_SQUASH_S, MAGNET_RADIUS, MORPH_ANIMALS, PANTS_COLORS, POWERS, ROCK_BREAK_S, SHIRT_COLORS, SKIN_TONES,
  TOTAL_VOTES, TREE_FALL_S, ZONE_WALL_H, FARM_RADIUS, JUNGLE_RADIUS, WILDLIFE, type AnimalKind, type Appearance,
} from "@/lib/game/constants";
import { preloadModels, onModelsReady, spawnModel } from "@/lib/game/models";
import type { GameEngine } from "@/lib/game/engine";
import { FALL_S, FINISHER_S, CORPSE_LIE_S, CORPSE_SINK_S } from "@/lib/game/engine";
import { nightFactor } from "@/lib/game/sim";
import { mulberry32 } from "@/lib/game/rng";
import {
  buildAnimal, buildZombieDog, buildCharacter, nameTag, helpBubble, poseAnimal, poseCharacter,
  setHeldTool, voteTokenGeometry, foodGeometry, shadowMaterial, basicVertexMaterial,
  type HeldToolKind,
} from "@/lib/game/character";
import { camBlocked, terrainHeight } from "@/lib/game/worldgen";
import { WORLD } from "./WorldView";
import { useGame } from "./store";

export type ClockRef = { current: number };

/* ------------------------------------------------------------------ */
/* Player + camera + engine tick                                       */
/* ------------------------------------------------------------------ */
export function GameLoop({ engine, clockRef }: { engine: GameEngine; clockRef: ClockRef }) {
  const look = useGame((s) => s.look);
  const setHud = useGame((s) => s.setHud);
  // police side renders the hero in full uniform (cap, badge, dark pants)
  const mesh = useMemo(() => buildCharacter(look, { police: look.fac === "police" }), [look]);
  // 🐒 Animal Morph — one animal body per kind, swapped in while the power lasts
  const morphMeshes = useMemo(() => {
    const map = new Map<AnimalKind, THREE.Object3D>();
    for (const k of MORPH_ANIMALS) map.set(k, buildAnimal(k));
    return map;
  }, []);
  // 🩸 7Nights — the possessed YOU: same face, rotten green skin, dead black eyes
  const beastMesh = useMemo(
    () => buildCharacter({ ...look, shirt: "#7a8a5a" }, { zombie: true }),
    [look],
  );
  const lantern = useRef<THREE.PointLight>(null!);
  const introT = useRef(0);
  const hudT = useRef(0);
  const heldRef = useRef<HeldToolKind | null>(null); // tool currently in the hero's hand
  const camKeep = useRef(1); // smoothed chase-camera pull-in factor (1 = full distance)
  // 🚗 driving glide state — the chase camera eases toward its pose instead of
  // snapping every frame, so frame-time hiccups at car speed read as smooth sweeps
  const camSm = useRef({ on: false, pos: new THREE.Vector3(), tgt: new THREE.Vector3() });
  const { camera } = useThree();

  // three dizzy stars that orbit the player's head after a car bonk
  const stars = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.font = "48px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("⭐", 32, 34);
    const tex = new THREE.CanvasTexture(c);
    const grp = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.scale.setScalar(0.55);
      grp.add(sp);
    }
    grp.visible = false;
    return grp;
  }, []);

  // ⚡ Sonic trail — soft cyan afterimages that fade behind a super-speed runner
  const trail = useMemo(() => {
    const grp = new THREE.Group();
    const tex = glowTexture();
    const sprites: THREE.Sprite[] = [];
    const pts: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: "#22d3ee", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(0.55);
      sp.visible = false;
      grp.add(sp);
      sprites.push(sp);
      pts.push({ x: 0, y: 0, z: 0 });
    }
    grp.visible = false;
    return { grp, sprites, pts };
  }, []);

  // 🧲 Food Magnet — pulsing ground aura showing the pull radius
  const magnetRing = useMemo(() => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(MAGNET_RADIUS, 0.09, 6, 44),
      new THREE.MeshBasicMaterial({ color: "#fb7185", transparent: true, opacity: 0.38, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    ring.visible = false;
    return ring;
  }, []);

  useFrame((_, dt0) => {
    const dt = Math.min(0.05, dt0);
    engine.update(dt);
    clockRef.current = engine.clock;
    if (lantern.current) lantern.current.intensity = nightFactor(engine.clock) * 26;

    // player mesh (hidden while riding in the police van, wearing an animal disguise, or driving a car)
    const p = engine.player;
    const morphing = engine.morphKind != null;
    const beast = engine.youPossessed && engine.phase === "night";
    // ⚔️ swing progress (0→1 through the attack cooldown) drives the arm/tool animation
    const swing = engine.attackCd > 0 ? 1 - engine.attackCd / ATTACK_CD : 0;
    // 🪓 the held arm rides the right hand — swap the tool mesh when the belt changes
    const heldKind = !beast && !morphing && !engine.drive && engine.held >= 0 && engine.tools[engine.held]
      ? engine.tools[engine.held].kind as HeldToolKind : null;
    if (heldRef.current !== heldKind) { setHeldTool(mesh, heldKind); heldRef.current = heldKind; }
    mesh.visible = (!engine.lost || engine.deathT < 3.4) && !engine.playerInVan && !morphing && !engine.drive && !beast; // 🩸 the dark takes the body too — after one final fall
    beastMesh.visible = beast && !engine.lost && !engine.playerInVan && !engine.drive;
    if (beastMesh.visible) {
      beastMesh.position.set(p.x, p.y, p.z);
      let bd = p.face - beastMesh.rotation.y;
      bd = Math.atan2(Math.sin(bd), Math.cos(bd));
      beastMesh.rotation.y += bd * Math.min(1, dt * 14);
      poseCharacter(beastMesh, Math.hypot(p.vx, p.vz), performance.now() / 1000, {
        airborne: p.y > 0.12,
        vy: p.vy,
        zombie: true,
        swing,
        squash: engine.squashT > 0 ? engine.squashT / LAND_SQUASH_S : 0,
      });
    }
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
      faint: engine.faintT > 0 ? engine.faintT / FAINT_S : 0,
      swing,
    });
    // 🩸 DEATH — the body folds to the dirt where it stands, rests a beat, then
    // the dark reclaims it (the recap menu waits for this to play out first)
    if (engine.lost) {
      const dT = engine.deathT;
      const fall = Math.min(1, dT / 0.85);
      const ez = fall * fall * (3 - 2 * fall);
      const sinkD = Math.max(0, dT - 2.2) / 1.2;
      mesh.position.set(p.x, p.y * (1 - ez) + 0.34 * ez - 2.0 * sinkD, p.z);
      mesh.rotation.x = -ez * Math.PI / 2.05;
    } else if (engine.finisherT > 0) {
      // ⚔️ KILL FINISHER — a full 360° spin flourish with a small power punch,
      // played the instant a zombie / hound / possessed beast is cut down
      const fin = 1 - engine.finisherT / FINISHER_S;
      mesh.rotation.y += fin * Math.PI * 2;
      mesh.scale.setScalar(1 + 0.13 * Math.sin(fin * Math.PI));
    } else if (mesh.scale.x !== 1) {
      mesh.scale.setScalar(1); // back to normal once the flourish is spent
    }

    // 🐒 animal disguise body mirrors the player's motion (walk, jump and all)
    const mk = engine.morphKind;
    if (mk) {
      for (const [kind, am] of morphMeshes) {
        const show = kind === mk && !engine.playerInVan;
        am.visible = show;
        if (!show) continue;
        am.position.set(p.x, p.y, p.z);
        am.rotation.y = mesh.rotation.y;
        poseAnimal(am, Math.hypot(p.vx, p.vz), performance.now() / 1000, 0);
      }
    } else for (const am of morphMeshes.values()) if (am.visible) am.visible = false;

    // ⚡ sonic afterimages — sample the runner's recent path
    const speed = Math.hypot(p.vx, p.vz);
    if (engine.activePower === "sonic" && speed > 4) {
      trail.grp.visible = true;
      trail.pts.pop();
      trail.pts.unshift({ x: p.x, y: p.y + 0.9, z: p.z });
      trail.sprites.forEach((sp, i) => {
        const pt = trail.pts[i];
        sp.visible = i > 0;
        sp.position.set(pt.x, pt.y, pt.z);
        sp.material.opacity = 0.4 * (1 - i / trail.sprites.length);
        sp.scale.setScalar(0.55 + i * 0.05);
      });
    } else if (trail.grp.visible) {
      trail.grp.visible = false;
      for (const sp of trail.sprites) sp.visible = false;
    }

    // 🧲 magnet aura ring follows the player
    if (engine.activePower === "magnet" && !engine.playerInVan) {
      magnetRing.visible = true;
      magnetRing.position.set(p.x, 0.14, p.z);
      const pulse = 1 + Math.sin(performance.now() / 240) * 0.02;
      magnetRing.scale.setScalar(pulse);
      (magnetRing.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(performance.now() / 240) * 0.1;
    } else if (magnetRing.visible) magnetRing.visible = false;

    // dizzy stars orbit the head while the bonk faint lasts
    if (engine.faintT > 0) {
      const t = performance.now() / 1000;
      stars.visible = true;
      stars.children.forEach((s, i) => {
        const a = t * 6.5 + (i / 3) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.55, 2.3 + Math.sin(t * 4 + i * 2.1) * 0.09, Math.sin(a) * 0.55);
      });
    } else if (stars.visible) stars.visible = false;

    // camera — intro swoop then smooth follow (plus a dizzy wobble after a car bonk);
    // while driving, pull back a little for that GTA chase-camera feel.
    // The camera rides the SMOOTHED visual pose while driving (the same pose the
    // car mesh renders at) — following the raw sim pose instead made the world
    // shake against the gliding body after every collision push-out.
    // 👀 free cam: a dead soul's camera rides behind another LIVING survivor
    // (random hop, click/N to channel-surf) instead of staring at their corpse.
    const drv = engine.drive;
    const spec = engine.spectating ? engine.specFocus() : null;
    const camX = spec ? spec.x : drv ? drv.vx : p.x;
    const camZ = spec ? spec.z : drv ? drv.vz : p.z;
    const focusY = spec ? 0 : p.y;
    const cd = drv ? 11 : 8.6;
    const iy = engine.input.yaw, ip = engine.input.pitch;
    let tx = camX + Math.sin(iy) * cd * Math.cos(ip);
    let ty = Math.max(1.2, focusY + 2.1 + Math.sin(ip) * cd);
    let tz = camZ + Math.cos(iy) * cd * Math.cos(ip);
    // 🎥 chase camera vs the world — sample the focus→camera line; if a building,
    // tree canopy or lamp post stands in the way, slide the camera closer so the
    // hero (and their ride!) can never be hidden behind a dark blob
    if (introT.current >= 1) {
      const fx = camX, fy = focusY + 1.9, fz = camZ;
      let keep = 1;
      for (let s = 1; s <= 7; s++) {
        const f = s / 7;
        if (camBlocked(fx + (tx - fx) * f, fy + (ty - fy) * f, fz + (tz - fz) * f, WORLD)) {
          keep = Math.max(0.34, (s - 1) / 7);
          break;
        }
      }
      camKeep.current += (keep - camKeep.current) * Math.min(1, dt * 10); // smooth in & out
      if (camKeep.current < 0.999) {
        tx = fx + (tx - fx) * camKeep.current;
        tz = fz + (tz - fz) * camKeep.current;
        ty = Math.max(1.2, fy + (ty - fy) * camKeep.current); // pulled-in cam stays off the road
      }
    }
    if (introT.current < 1) {
      introT.current = Math.min(1, introT.current + dt / 2.4);
      const e = 1 - Math.pow(1 - introT.current, 3);
      camera.position.set(
        THREE.MathUtils.lerp(p.x, tx, e) + (1 - e) * 40,
        THREE.MathUtils.lerp(60, ty, e),
        THREE.MathUtils.lerp(p.z + 90, tz, e),
      );
    } else if (engine.faintT > 0) {
      const wob = engine.faintT / FAINT_S;
      const t = performance.now() / 1000;
      camera.position.set(tx + Math.sin(t * 21) * 0.09 * wob, ty + Math.sin(t * 17) * 0.06 * wob, tz);
    } else if (engine.drive && !spec) {
      // 🚗 behind the wheel: the chase POSITION glides softly (k=9) for that GTA
      // rubber-band, but the LOOK-AT is GLUED to the car's already-smoothed pose.
      // The old extra 9/s lerp on the target stacked a SECOND ~110 ms of lag on
      // top of the pose easing — at 26 u/s the look point trailed the body by
      // ~2.5 u, so the car visibly slid around the middle of the screen (and
      // slid more through every corner & brake): the "driving looks jerky" feel.
      // Double-smoothing added zero stability — the pose is pre-smoothed in
      // stepDrive, so the camera now aims exactly where the car mesh renders.
      const sm = camSm.current;
      if (!sm.on) { sm.on = true; sm.pos.copy(camera.position); sm.tgt.set(camX, p.y + 1.7, camZ); }
      const k = 1 - Math.exp(-dt * 9);
      sm.pos.lerp(camV1.set(tx, ty, tz), k);
      sm.tgt.set(camX, p.y + 1.7, camZ); // glued — no second lag stage
      camera.position.copy(sm.pos);
    } else {
      camSm.current.on = false;
      camera.position.set(tx, ty, tz);
    }
    // 💥 trauma screen shake — rides ON TOP of the settled follow pose (game-feel
    // skill: shake the CAMERA, never the simulated body; smooth sinusoidal noise ×
    // trauma² so small hits barely move, big hits punch; engine decays the trauma).
    // Applied AFTER the pose branches so shake never feeds back into the smoothing
    // state (next frame's lerp starts from the un-shaken position).
    if (engine.shakeT > 0.002 && introT.current >= 1) {
      const sh = engine.shakeT * engine.shakeT; // quadratic curve — gentle low, sharp high
      const st = performance.now() / 1000;
      camera.position.x += Math.sin(st * 23.7) * 0.62 * sh;
      camera.position.y += Math.sin(st * 31.3 + 1.7) * 0.34 * sh;
      camera.position.z += Math.cos(st * 19.1 + 0.9) * 0.62 * sh;
    }
    if (engine.drive && camSm.current.on) camera.lookAt(camSm.current.tgt);
    else camera.lookAt(camX, focusY + 1.7, camZ);

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
      <primitive object={beastMesh} visible={false} />
      {[...morphMeshes.entries()].map(([kind, am]) => <primitive object={am} key={`morph-${kind}`} visible={false} />)}
      <primitive object={trail.grp} />
      <primitive object={magnetRing} />
      <primitive object={stars} />
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
      fac: "protester",
      outfit: "",
      skin: pick(SKIN_TONES),
      shirt: pick(SHIRT_COLORS),
      pants: pick(PANTS_COLORS),
      shoe: ["#3b2314", "#111111", "#f5f5f5"][Math.floor(r() * 3)],
      hair: pick(HAIR_COLORS),
      hairStyle: pick(HAIR_STYLES).id,
      cap: r() < 0.25,
      capColor: pick(CAP_COLORS),
      glasses: r() < 0.2,
      age: pick(["kid", "teen", "young", "old"] as const),
      girl: r() < 0.5,
    }));
    const map = new Map<number, NpcView>();
    engine.cops.forEach((c, i) => {
      const mesh = buildCharacter(
        { fac: "police", outfit: "city", skin: pick(SKIN_TONES), shirt: "#2e4f9e", pants: "#1c2a4e", shoe: "#111111", hair: pick(["#1a1210", "#5a3a1a", "#4a4a58"] as const), hairStyle: pick(["bowl", "spiky", "bald"] as const), cap: true, capColor: "#1c2a4e", glasses: false, age: pick(["young", "young", "old"] as const), girl: false },
        { police: true, mustache: i % 3 === 0 },
      );
      const tag = nameTag("POLICE", "rgba(30,50,120,0.85)");
      tag.position.y = 2.95;
      mesh.add(tag);
      map.set(c.id, { mesh, tag });
    });
    const TOWN_TAGS = ["🌙 7 NIGHTS STRONG", "🔥 FIRES KEEP US SAFE", "🧟 NOT TODAY, ZOMBIES", "🍰 BAKE SALE AT DAWN", "🧃 JUICE & SURVIVE", "❤ STAND TOGETHER"];
    engine.civs.forEach((c, i) => {
      const mesh = buildCharacter(civLooks[i]);
      // main-road walkers carry a fun slogan tag instead of their name;
      // scavengers get a teal tag, the join-bot a golden one — living-city cast
      const tag = c.protest
        ? nameTag(TOWN_TAGS[i % TOWN_TAGS.length], "rgba(46,90,46,0.88)")
        : c.companion
          ? nameTag(`🤖 ${c.name}`, "rgba(176,124,16,0.92)")
          : nameTag(c.name, c.scav ? "rgba(18,118,90,0.88)" : undefined);
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
    // 🌙 names hide at dusk & night — the dark takes identities away; they return at dawn
    const namesHidden = engine.phase === "dusk" || engine.phase === "night";
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
          for (const l of rig.lids) l.visible = close && !n.dead;
          for (const b of rig.brows) b.visible = close && !n.dead;
        }
        if (n.dead) {
          // 🧟💀 a fallen townsfolk — folds to the dirt, lies a while, then the
          // ground quietly reclaims them (the city refills at dawn)
          const dT = n.deadT ?? CORPSE_LIE_S + CORPSE_SINK_S; // no timer yet = already settled
          const gone = dT > CORPSE_LIE_S + CORPSE_SINK_S;
          v.mesh.visible = !gone;
          if (gone) { if (v.tag) v.tag.visible = false; continue; }
          const fall = Math.min(1, dT / 0.55);
          const ez = fall * fall * (3 - 2 * fall);
          const sinkD = Math.max(0, dT - CORPSE_LIE_S) / CORPSE_SINK_S;
          v.mesh.position.set(n.x, 0.34 * ez - 2.0 * sinkD, n.z);
          v.mesh.rotation.x = -ez * Math.PI / 2.1;
          poseCharacter(v.mesh, 0, t, { phase: n.phase, detained: true });
          if (v.bubble) v.bubble.visible = false;
          if (v.tag) v.tag.visible = false;
          continue;
        }
        v.mesh.position.set(n.x, 0, n.z);
        v.mesh.rotation.x = 0;
        let dd = n.face - v.mesh.rotation.y;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        v.mesh.rotation.y += dd * 0.15;
        const speed = Math.hypot(n.vx, n.vz);
        poseCharacter(v.mesh, speed, t, { phase: n.phase, detained: n.mode === "detained", panic: (n.panicT ?? 0) > 0 });
        if (v.bubble) v.bubble.visible = close && n.mode === "detained";
        if (v.tag) v.tag.visible = close && n.mode !== "detained" && !namesHidden;
      }
    }
  });
  return <>{[...views.values()].map((v, i) => <primitive object={v.mesh} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Zombies                                                             */
/* ------------------------------------------------------------------ */
/* 🎨 create-game-assets: variety within the family — three sickly tints, three
 * hair styles, ages and deterministic height jitter so the graveyard pack reads
 * as individuals instead of nine identical clones. */
const ZOMBIE_VARIANTS = [
  { skin: "#8fbf6f", shirt: "#7a8a5a", pants: "#4a5240", hair: "#3a4a2a", hairStyle: "bowl" as const, age: "young" as const },
  { skin: "#a8c98a", shirt: "#6b7a4e", pants: "#3f4a38", hair: "#2a3a22", hairStyle: "spiky" as const, age: "old" as const },
  { skin: "#7da860", shirt: "#8a8a6a", pants: "#54503a", hair: "#4a3a2a", hairStyle: "bald" as const, age: "old" as const },
];

/** Release a built character's GPU buffers (used when the run's zombie cache dies). */
function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

export function Zombies({ engine }: { engine: GameEngine }) {
  // 🧟 contest zombies WEAR THEIR FORMER SELVES — each body is built from the
  // look of the contestant who turned (identity shirt kept), cached once per
  // contestant for the whole run so nightly risings never rebuild old bodies
  const cacheRef = useRef(new Map<number, THREE.Group>());
  const [rev, setRev] = useState(engine.zRev);
  const revRef = useRef(engine.zRev);
  const views = useMemo(() => {
    const map = new Map<number, THREE.Group>();
    for (const z of engine.zombies) {
      if (z.owner == null) continue;
      let g = cacheRef.current.get(z.owner);
      if (!g) {
        const owner = engine.crew.find((c) => c.id === z.owner);
        const v = ZOMBIE_VARIANTS[Math.abs(z.owner) % ZOMBIE_VARIANTS.length];
        g = buildCharacter(
          owner?.look ?? { fac: "protester", outfit: "", skin: v.skin, shirt: v.shirt, pants: v.pants, shoe: "#3a3a2a", hair: v.hair, hairStyle: v.hairStyle, cap: false, capColor: "#3a4a2a", glasses: false, age: v.age, girl: false },
          { zombie: true, keepShirt: true },
        );
        g.scale.setScalar(0.92 + (Math.abs(z.owner) % 5) * 0.035); // deterministic per-contestant jitter
        cacheRef.current.set(z.owner, g);
      }
      map.set(z.id, g);
    }
    return map;
  }, [engine, rev]);
  // run over → release every cached zombie body
  useEffect(() => () => {
    for (const g of cacheRef.current.values()) disposeTree(g);
    cacheRef.current.clear();
  }, []);
  useFrame((s) => {
    if (engine.zRev !== revRef.current) { revRef.current = engine.zRev; setRev(engine.zRev); }
    const night = nightFactor(engine.clock);
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    for (const z of engine.zombies) {
      const m = views.get(z.id);
      if (!m) continue;
      const vis = night > 0.4;
      const dx = z.x - cam.x, dz = z.z - cam.z;
      if (z.dead) {
        // 🗡️🔪 KILL FINISHER — the slain shambler topples face-first, rests a
        // beat, then the hungry dirt pulls it under (gone until next dusk)
        const dT = z.deadT ?? 0;
        if (dT > 1.5 + CORPSE_SINK_S || !vis || dx * dx + dz * dz > CULL_SQ) { m.visible = false; continue; }
        m.visible = true;
        const fall = Math.min(1, dT / 0.5);
        const ez = fall * fall * (3 - 2 * fall);
        const sinkD = Math.max(0, dT - 1.5) / CORPSE_SINK_S;
        m.position.set(z.x, -1.85 * sinkD, z.z);
        let dd = z.face - m.rotation.y;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        m.rotation.y += dd * 0.2;
        m.rotation.x = -ez * Math.PI / 2.05;
        m.rotation.z = 0;
        continue;
      }
      m.visible = vis && dx * dx + dz * dz < CULL_SQ;
      if (!m.visible) continue;
      // rise from the grave as night falls (fully out at night >= 0.55)
      const rise = THREE.MathUtils.clamp((night - 0.4) / 0.15, 0, 1);
      const sink = -1.8 * (1 - rise);
      m.position.set(z.x, sink, z.z);
      let dd = z.face - m.rotation.y;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      m.rotation.y += dd * 0.12;
      m.rotation.x = 0; m.rotation.z = 0; // a risen shambler stands tall again
      poseCharacter(m, Math.hypot(z.vx, z.vz), t, { phase: z.phase, zombie: true });
    }
  });
  return <>{[...views.values()].map((m, i) => <primitive object={m} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Animals                                                             */
/* ------------------------------------------------------------------ */
/* 🐾 Two body pipelines:                                          */
/*  • procedural kinds (cow/chicken/deer/monkey + the dog pair) come
 *    from character.ts buckets, posed by poseAnimal every frame.   */
/*  • polyfork GLB kinds (wolf/bear/fox/owl/crow/rabbit/stag — see
 *    public/models/CREDITS.md) are skinned meshes with baked clips:
 *    a real AnimationMixer cross-fades Idle → Walk → Run, and the
 *    birds take wing (Fly) when they bolt.                          */
const GLB_KINDS = new Set(["wolf", "bear", "fox", "owl", "crow", "rabbit", "stag"]);

/** soft radial glow sprite — the hound's hell-light, the stag's spirit-mist */
function makeGlowSprite(color: string, scale: number): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({
    map: tex, color: 0xffffff, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(scale);
  sp.frustumCulled = false;
  sp.renderOrder = 5;
  return sp;
}

interface AnimalRig {
  obj: THREE.Group;
  kind: string;
  /** GLB pipeline: mixer + clip lookup for the baked animations */
  mixer?: THREE.AnimationMixer;
  clips?: Record<string, THREE.AnimationClip>;
  current?: THREE.AnimationAction;
  /** halo sprite (hound hell-light / stag spirit-mist) */
  halo?: THREE.Sprite;
}

export function Animals({ engine }: { engine: GameEngine }) {
  const holder = useRef<THREE.Group>(null!);
  const rigs = useRef<Map<number, AnimalRig>>(new Map());
  const [, bump] = useState(0);
  const [, tick] = useState(0);

  // 🌲 GLBs stream in during play — rebuild any missing species when ready
  useEffect(() => {
    preloadModels(); // idempotent safety net (the engine already kicked it off)
    const off = onModelsReady(() => bump((v) => v + 1));
    const iv = setInterval(() => tick((v) => v + 1), 700); // poll until all species land
    const stop = setTimeout(() => clearInterval(iv), 30000);
    return () => { off(); clearInterval(iv); clearTimeout(stop); };
  }, []);

  // build a rig per animal (idempotent — existing rigs are kept)
  for (const a of engine.animals) {
    if (rigs.current.has(a.id)) continue;
    if (a.kind === "dog") {
      // 🐕 strays carry BOTH bodies — the friendly stray by day, the rotting
      // red-eyed hound at night; useFrame swaps visibility + lights the halo
      const coat = a.variant ?? a.id % 5;
      const wrap = new THREE.Group();
      const norm = buildAnimal("dog", coat);
      const zom = buildZombieDog(coat);
      zom.visible = false;
      wrap.add(norm, zom);
      wrap.userData.dogParts = { norm, zom };
      const halo = makeGlowSprite("rgba(255,45,20,0.75)", 2.1);
      halo.position.y = 0.85;
      halo.visible = false;
      wrap.add(halo);
      rigs.current.set(a.id, { obj: wrap, kind: "dog", halo });
    } else if (GLB_KINDS.has(a.kind)) {
      const spawned = spawnModel(a.kind);
      if (!spawned) continue; // still loading — the poll retries
      const rig: AnimalRig = { obj: spawned.root, kind: a.kind, mixer: spawned.mixer, clips: spawned.clips };
      if (a.kind === "stag") {
        // 👻 the spirit stag breathes cold cyan mist
        const halo = makeGlowSprite("rgba(120,240,255,0.55)", 4.2);
        halo.position.y = 1.6;
        rig.halo = halo;
        spawned.root.add(halo);
      }
      if (a.kind === "wolf") {
        // 🐺 night eyes — a faint gold glow so the pack watches you from the dark
        const halo = makeGlowSprite("rgba(255,216,96,0.6)", 0.8);
        halo.position.y = 0.78;
        rig.halo = halo;
        spawned.root.add(halo);
      }
      rigs.current.set(a.id, rig);
    } else {
      const vi = engine.animals.filter((o) => o.kind === a.kind).findIndex((o) => o.id === a.id);
      rigs.current.set(a.id, { obj: buildAnimal(a.kind as "cow", a.variant ?? Math.max(0, vi)), kind: a.kind });
    }
  }

  useFrame((s, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    const nf = nightFactor(engine.clock);
    for (const a of engine.animals) {
      const rig = rigs.current.get(a.id);
      if (!rig) continue;
      const m = rig.obj;
      const dx = a.x - cam.x, dz = a.z - cam.z;
      const inCull = dx * dx + dz * dz < CULL_SQ;
      if (a.dead) {
        // 🪦 the fallen — tips over onto its side and sinks into the earth;
        // a fresh stray always wanders back in at dawn
        if (rig.halo) rig.halo.visible = false;
        const dT = a.deadT ?? CORPSE_SINK_S + 1;
        if (dT > 1.3 + CORPSE_SINK_S || !inCull) { m.visible = false; continue; }
        m.visible = true;
        const fall = Math.min(1, dT / 0.45);
        const ez = fall * fall * (3 - 2 * fall);
        const sinkD = Math.max(0, dT - 1.3) / CORPSE_SINK_S;
        m.position.set(a.x, -1.1 * sinkD, a.z);
        m.rotation.z = ez * Math.PI / 2.15; // tip over sideways
        continue;
      }
      // 👻 the spectral stag exists only after dark
      const stagVis = a.kind !== "stag" || nf > 0.35;
      m.visible = inCull && stagVis;
      if (rig.halo) {
        rig.halo.visible = m.visible && (a.kind === "stag" ? true : a.kind === "wolf" ? nf > 0.5 : !!a.zombie);
        if (rig.halo.visible) {
          const mat = rig.halo.material as THREE.SpriteMaterial;
          const pulse = a.kind === "stag"
            ? 0.35 + 0.2 * Math.sin(t * 1.7 + a.phase)
            : 0.5 + 0.22 * Math.sin(t * 6.2 + a.phase);
          mat.opacity = (a.kind === "stag"
            ? Math.min(0.9, Math.max(0, (nf - 0.3) * 2.4)) * pulse
            : a.kind === "wolf" ? pulse * 0.95 * nf : pulse * 0.85);
        }
      }
      if (!m.visible) continue;
      m.position.set(a.x, 0, a.z);
      m.rotation.z = 0; // back on all fours
      // 🍼 babies are little — one scale bump, every frame is idempotent
      const bs = a.baby ? 0.55 : 1;
      if (m.scale.x !== bs) m.scale.setScalar(bs);
      let dd = a.face - m.rotation.y;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      m.rotation.y += dd * 0.12;
      if (a.kind === "dog") {
        const parts = m.userData.dogParts as { norm: THREE.Object3D; zom: THREE.Object3D };
        const active = a.zombie ? parts.zom : parts.norm;
        parts.norm.visible = !a.zombie;
        parts.zom.visible = !!a.zombie;
        poseAnimal(active, Math.hypot(a.vx, a.vz), t, a.phase);
        continue;
      }
      if (rig.mixer && rig.clips) {
        // 🎬 baked-clip state machine: Idle when resting, Run (birds Fly) when
        // panicking, Walk while ambling — soft 0.22 s cross-fades
        const speed = Math.hypot(a.vx, a.vz);
        const walk = WILDLIFE[a.kind]?.walk ?? 1.8;
        const want = speed < 0.25 || a.resting ? "idle"
          : speed > walk + 1.5 ? (a.kind === "owl" || a.kind === "crow" ? "fly" : "run")
          : "walk";
        const next = rig.clips[want];
        if (next && rig.current?.getClip() !== next) {
          const prev = rig.current;
          rig.current = rig.mixer.clipAction(next);
          rig.current.reset().fadeIn(0.22).play();
          if (prev) prev.fadeOut(0.22);
        }
        rig.mixer.update(dt);
      }
      // procedural fallback pose (unused while a mixer owns the body)
      if (!rig.mixer) poseAnimal(m, Math.hypot(a.vx, a.vz), t, a.phase);
    }
  });

  return (
    <group ref={holder}>
      {[...rigs.current.values()].map((r, i) => <primitive object={r.obj} key={i} />)}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 🦗 Jungle insects — a drifting swarm of flies by day, fireflies by   */
/* night. One THREE.Points cloud wandering the jungle band; paired with */
/* the cricket/cicada ambience in audio.ts it makes the trees feel ALIVE.*/
/* ------------------------------------------------------------------ */
const INSECT_N = 64;
export function JungleInsects({ engine }: { engine: GameEngine }) {
  const { pts, anchors, pos } = useMemo(() => {
    const anchors: { x: number; z: number; r: number; ph: number; sp: number; bob: number }[] = [];
    for (let i = 0; i < INSECT_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = FARM_RADIUS + 12 + Math.random() * (JUNGLE_RADIUS - FARM_RADIUS - 22);
      anchors.push({
        x: Math.cos(a) * rr, z: Math.sin(a) * rr,
        r: 2.5 + Math.random() * 6.5,
        ph: Math.random() * Math.PI * 2,
        sp: 0.5 + Math.random() * 1.3,
        bob: 0.6 + Math.random() * 2.4,   // hover height — low undergrowth to canopy
      });
    }
    const pos = new Float32Array(INSECT_N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.42, map: glowTexture(), transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      color: new THREE.Color("#d8d2b8"),
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    return { pts, anchors, pos };
  }, []);
  const fade = useRef(0);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const night = nightFactor(engine.clock);
    const inJungle = engine.zone === "Jungle" || engine.zone === "Deep Jungle";
    fade.current += ((inJungle ? 1 : 0) - fade.current) * Math.min(1, 0.06);
    const f = fade.current;
    pts.visible = f > 0.02;
    if (!pts.visible) return;
    for (let i = 0; i < INSECT_N; i++) {
      const an = anchors[i];
      const w = t * an.sp + an.ph;
      pos[i * 3] = an.x + Math.cos(w * 0.7) * an.r + Math.sin(w * 2.3) * 0.9;
      pos[i * 3 + 1] = an.bob + Math.sin(w * 1.7) * 0.55;
      pos[i * 3 + 2] = an.z + Math.sin(w * 0.9) * an.r + Math.cos(w * 1.9) * 0.9;
    }
    (pts.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    // daytime: faint pale flies; night: warm glowing fireflies that blink
    const mat = pts.material as THREE.PointsMaterial;
    mat.color.setStyle(night > 0.5 ? "#ffd97a" : night > 0.25 ? "#e8d8a0" : "#c9c2a8");
    const blink = night > 0.5 ? 0.72 + 0.28 * Math.abs(Math.sin(t * 2.1)) : 1;
    mat.opacity = (night > 0.4 ? 0.62 : 0.2 + night * 0.5) * blink * f;
  });
  return <primitive object={pts} />;
}

/* ------------------------------------------------------------------ */
/* Rare super-power gems — glowing gem + emoji + pulsing ground ring   */
/* ------------------------------------------------------------------ */
let _glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (_glowTex) return _glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function emojiSprite(emoji: string, scale = 0.55): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.font = "64px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(emoji, 48, 52);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.setScalar(scale);
  return sp;
}

/** One little group per gem — only POWER_COUNT exist, so per-entity groups are cheap. */
export function Powers({ engine }: { engine: GameEngine }) {
  const views = useMemo(() => engine.powers.map((pw, i) => {
    const d = POWERS[pw.def];
    const g = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshBasicMaterial({ color: d.color }));
    gem.position.y = 0.95;
    g.add(gem);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: d.color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.7);
    glow.position.y = 0.95;
    g.add(glow);
    const em = emojiSprite(d.emoji, 0.5);
    em.position.y = 1.55;
    g.add(em);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.045, 6, 26),
      new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    g.add(ring);
    g.visible = pw.active;
    return { group: g, gem, glow, em, ring, i };
  }), [engine]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let idx = 0; idx < engine.powers.length; idx++) {
      const pw = engine.powers[idx];
      const v = views[idx];
      v.group.visible = pw.active;
      if (!pw.active) continue;
      v.group.position.set(pw.x, 0, pw.z);
      v.gem.rotation.y = t * 1.7 + idx;
      v.gem.position.y = 0.95 + Math.sin(t * 2.2 + idx * 1.7) * 0.12;
      v.glow.position.y = v.gem.position.y;
      v.glow.material.opacity = 0.4 + Math.sin(t * 3 + idx) * 0.15;
      v.em.position.y = 1.55 + Math.sin(t * 2.6 + idx) * 0.08;
      v.ring.scale.setScalar(1 + Math.sin(t * 2 + idx) * 0.1);
    }
  });

  return <>{views.map((v) => <primitive object={v.group} key={v.i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Driving-license cards — glowing 🪪 pickups that unlock every car     */
/* ------------------------------------------------------------------ */
export function Licenses({ engine }: { engine: GameEngine }) {
  // 📦 dropped cards can APPEND a brand-new license entity at runtime (gifted
  // license + no spent card to reuse) — licRev ticks, we rebuild the views.
  const [rev, setRev] = useState(engine.licRev);
  const revRef = useRef(engine.licRev);
  const views = useMemo(() => engine.licenses.map((lc, i) => {
    const g = new THREE.Group();
    // the card itself: a little white ID card with a photo stripe
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.06), new THREE.MeshLambertMaterial({ color: "#f4f8ff" }));
    card.position.y = 0.95;
    g.add(card);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.065), new THREE.MeshBasicMaterial({ color: "#38bdf8" }));
    stripe.position.set(0, 1.12, 0.005);
    g.add(stripe);
    const photo = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.07), new THREE.MeshBasicMaterial({ color: "#fbbf24" }));
    photo.position.set(-0.2, 0.92, 0.005);
    g.add(photo);
    const em = emojiSprite("🪪", 0.52);
    em.position.y = 1.62;
    g.add(em);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: "#38bdf8", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.8);
    glow.position.y = 1;
    g.add(glow);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.05, 6, 26),
      new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    g.add(ring);
    g.visible = lc.active;
    return { group: g, card, em, glow, ring, i };
  }), [engine, rev]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (engine.licRev !== revRef.current) { // a dropped card spawned a new entity
      revRef.current = engine.licRev;
      setRev(engine.licRev);
    }
    for (let idx = 0; idx < engine.licenses.length; idx++) {
      const lc = engine.licenses[idx];
      const v = views[idx];
      if (!v) continue;
      v.group.visible = lc.active;
      if (!lc.active) continue;
      v.group.position.set(lc.x, 0, lc.z);
      v.group.rotation.y = t * 1.4 + idx;
      v.card.position.y = 0.95 + Math.sin(t * 2.4 + idx * 1.3) * 0.12;
      v.em.position.y = 1.62 + Math.sin(t * 2.6 + idx) * 0.08;
      v.glow.position.y = v.card.position.y;
      (v.glow.material as THREE.SpriteMaterial).opacity = 0.4 + Math.sin(t * 3 + idx) * 0.15;
      v.ring.scale.setScalar(1 + Math.sin(t * 2.2 + idx) * 0.12);
    }
  });

  return <>{views.map((v) => <primitive object={v.group} key={v.i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* Items + votes + shadows — all instanced (a handful of draw calls)   */
/* ------------------------------------------------------------------ */
const dummy = new THREE.Object3D();
const camV1 = new THREE.Vector3(); // scratch for the driving chase-cam glide
/** Shadow-blob radius multiplier per animal kind — procedural conf.s and the
 *  polyfork GLB wildlife heights (see public/models/CREDITS.md). */
const ANIMAL_SCALES: Record<string, number> = {
  cow: 1.7, chicken: 0.95, deer: 1.45, monkey: 1.1, dog: 1.05,
  wolf: 1.3, bear: 1.65, fox: 1.0, owl: 0.75, crow: 0.6, rabbit: 0.55, stag: 1.9,
};

export function Pickups({ engine }: { engine: GameEngine }) {
  const { voteMesh, foodMeshes, defs } = useMemo(() => {
    const mat = basicVertexMaterial();
    const voteMesh = new THREE.InstancedMesh(voteTokenGeometry(), mat, TOTAL_VOTES);
    voteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    voteMesh.frustumCulled = false;
    // one instanced mesh per food def — every snack gets its own little 3D model
    const foodMeshes = new Map<number, THREE.InstancedMesh>();
    ITEMS.forEach((_, def) => {
      const m = new THREE.InstancedMesh(foodGeometry(def), mat, ITEM_COUNT);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      foodMeshes.set(def, m);
    });
    return { voteMesh, foodMeshes, defs: [...foodMeshes.keys()] };
  }, []);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const p = engine.player;
    // id → civ lookup so a bot-carried vote (runner OR scavenger) hovers over ITS carrier
    const civById = new Map(engine.civs.map((c) => [c.id, c]));
    /* votes */
    let vi = 0;
    let slot = 0;
    for (const v of engine.votes) {
      if (v.state === "delivered") continue;
      if (v.state === "world") {
        dummy.position.set(v.x, 0.75 + Math.sin(t * 2.6 + v.id) * 0.16, v.z);
        dummy.rotation.set(0, t * 2 + v.id, 0);
        dummy.scale.setScalar(1);
      } else if (v.carrierId != null) {
        // a bot's smuggled/hauled vote hovers over THE BOT (a visible target!)
        const carrier = civById.get(v.carrierId);
        dummy.position.set(
          (carrier?.x ?? p.x),
          2.65 + Math.sin(t * 3) * 0.07,
          (carrier?.z ?? p.z),
        );
        dummy.rotation.set(0, t * 3, 0);
        dummy.scale.setScalar(0.85);
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
    /* items per def — each food model is its own instanced mesh */
    for (const [def, mesh] of foodMeshes) {
      let fi = 0;
      for (const it of engine.items) {
        if (!it.active || it.def !== def || fi >= ITEM_COUNT) continue;
        dummy.position.set(it.x, 0.5 + Math.sin(t * 2.2 + it.id) * 0.12, it.z);
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
      {defs.map((def) => <primitive object={foodMeshes.get(def)!} key={def} />)}
    </>
  );
}

/** One instanced blob shadow for every moving entity (1 draw call). */
export function Shadows({ engine }: { engine: GameEngine }) {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(geo, shadowMaterial(), 128);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.renderOrder = 1;
    return m;
  }, []);
  const kinds = useMemo(() => ANIMAL_SET.flatMap((s2) => Array.from({ length: s2.count }, () => s2.kind)), []);
  useFrame(() => {
    let i = 0;
    const put = (x: number, z: number, r: number, lift = 0) => {
      if (i >= 128) return;
      dummy.position.set(x, 0.1, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(r * 2 * Math.max(0.55, 1 - lift * 0.1));
      dummy.updateMatrix();
      mesh.setMatrixAt(i++, dummy.matrix);
    };
    const p = engine.player;
    put(p.x, p.z, 0.64, p.y);
    for (const c of engine.cops) put(c.x, c.z, 0.6);
    for (const c of engine.civs) if (!c.dead) put(c.x, c.z, 0.6); // the fallen sink away — no ghost shadows
    if (nightFactor(engine.clock) > 0.4) for (const z of engine.zombies) if (!z.dead) put(z.x, z.z, 0.6);
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
/* 🪵🪨 harvest chips — fx.hue picks the debris palette: tree chops & barricade
 * splinters burst WOOD, smashed boulders burst STONE, everything else festive */
const WOOD_CHIPS = ["#a97b4f", "#8a5a33", "#6b4a2a", "#5aa348", "#2f9e55"];
const STONE_CHIPS = ["#9b9ba3", "#7d7d86", "#b9b9c0", "#6e6e76", "#8d8d95"];
const FESTIVE = ["#ff6b8a", "#ffd166", "#6bd68a", "#7bc4ff", "#c77dff"];
/* 🌫️ kill-finisher soul wisps — a rotten, luminous burst that RISES instead of
 * falling when a beast of the night is cut down (fx.type === "soul") */
const SOUL_WISP = ["#8dffb0", "#b78cff", "#63e8d8", "#d8ff8f", "#e6fff2"];
const fxColor = new THREE.Color();
export function Confetti({ engine }: { engine: GameEngine }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const parts = useMemo(() => Array.from({ length: N_CONF }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, rx: Math.random() * 3, rz: Math.random() * 3,
    g: 12, // gravity: confetti falls (12), soul wisps RISE (negative)
  })), []);
  const colors = useMemo(() => {
    const palette = FESTIVE.map((c) => new THREE.Color(c));
    return Array.from({ length: N_CONF }, (_, i) => palette[i % palette.length]);
  }, []);

  useLayoutEffectInit(mesh, colors);

  useFrame((_, dt0) => {
    const dt = Math.min(0.05, dt0);
    // drain fx queue — recolor freshly spawned chips to match what was hit
    let recolored = false;
    for (const fx of engine.fxQueue.splice(0)) {
      const soul = fx.type === "soul"; // 🌫️ a beast of the night fell — its soul lifts
      const pal = soul
        ? SOUL_WISP
        : fx.hue <= 0.15 ? WOOD_CHIPS : fx.hue >= 0.59 && fx.hue <= 0.68 ? STONE_CHIPS : null;
      const want = soul ? 34 : 70;
      let spawned = 0;
      for (let idx = 0; idx < parts.length && spawned < want; idx++) {
        const pt = parts[idx];
        if (pt.life > 0) continue;
        const a = Math.random() * Math.PI * 2, sp = soul ? 0.7 + Math.random() * 1.6 : 2 + Math.random() * 4;
        pt.x = fx.x; pt.y = fx.y; pt.z = fx.z;
        pt.vx = Math.cos(a) * sp; pt.vz = Math.sin(a) * sp;
        pt.vy = soul ? 1.5 + Math.random() * 2.1 : 4 + Math.random() * 5; // souls drift UP
        pt.g = soul ? -1.3 : 12;
        pt.life = soul ? 1.7 + Math.random() * 1.0 : 1.4 + Math.random() * 0.8;
        if (pal && mesh.current) {
          mesh.current.setColorAt(idx, fxColor.set(pal[(Math.random() * pal.length) | 0]));
          recolored = true;
        }
        spawned++;
      }
    }
    if (recolored && mesh.current?.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    let any = false;
    for (let i = 0; i < N_CONF; i++) {
      const pt = parts[i];
      if (pt.life <= 0) continue;
      any = true;
      pt.life -= dt;
      pt.vy -= pt.g * dt; // confetti tumbles down · soul wisps float up
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.vx *= 0.99; pt.vz *= 0.99;
      const s = pt.life > 0 ? (pt.g < 0 ? 0.12 : 0.16) : 0;
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

/* ------------------------------------------------------------------ */
/* 👥 7Nights — the crew: 7 fellow survivors (+ corpses + the beast)   */
/* ------------------------------------------------------------------ */
const CREW_ZOMBIE_LOOK: Appearance = {
  fac: "protester", outfit: "", skin: "#8fbf6f", shirt: "#7a8a5a", pants: "#4a5240",
  shoe: "#3a3a2a", hair: "#3a4a2a", hairStyle: "bowl", cap: false, capColor: "#3a4a2a",
  glasses: false, age: "young", girl: false,
};

export function CrewRig({ engine }: { engine: GameEngine }) {
  const views = useMemo(() => {
    return engine.crew.map((c) => {
      const mesh = buildCharacter(c.look);
      const tag = nameTag(c.name, hexToTagBg(c.color));
      tag.position.y = 2.95;
      mesh.add(tag);
      // blood pool under a corpse
      const blood = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 18),
        new THREE.MeshBasicMaterial({ color: "#5c1212", transparent: true, opacity: 0.75, depthWrite: false }),
      );
      blood.rotation.x = -Math.PI / 2;
      blood.position.y = 0.04;
      blood.visible = false;
      return { mesh, blood, tag };
    });
  }, [engine]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    // 🌙 names hide at dusk & night — identify by CLOTH COLOR, not tags
    const namesHidden = engine.phase === "dusk" || engine.phase === "night";
    engine.crew.forEach((c, i) => {
      const v = views[i];
      if (!v) return;
      const dx = (c.alive ? c.x : c.deathX) - cam.x;
      const dz = (c.alive ? c.z : c.deathZ) - cam.z;
      const d2 = dx * dx + dz * dz;
      const near = d2 < CULL_SQ;
      // 🧟 a TURNED contestant at night is walking the dirt as their zombie —
      // the human body sinks away; dawn (or death) brings it back
      const turned = c.alive && c.zombieTonight && engine.phase === "night";
      // 🩸 the blood pool blooms as the body lands, then fades as the ground reclaims it
      const dTb = c.alive ? 0 : (c.deathT ?? CORPSE_LIE_S + CORPSE_SINK_S);
      const bodyGone = dTb > CORPSE_LIE_S + CORPSE_SINK_S;
      v.blood.visible = near && !c.alive && !bodyGone && dTb > 0.35;
      if (v.blood.visible) {
        v.blood.position.set(c.deathX, 0.04, c.deathZ);
        (v.blood.material as THREE.MeshBasicMaterial).opacity =
          0.75 * Math.min(1, (dTb - 0.35) / 0.6) * (1 - Math.max(0, (dTb - CORPSE_LIE_S) / CORPSE_SINK_S));
      }
      // 🚗 behind the wheel — the car body IS their body now
      if (!near || turned || (c.alive && c.drive)) {
        v.mesh.visible = false;
        return;
      }
      v.mesh.visible = true;
      if (c.alive) {
        v.mesh.position.set(c.x, 0, c.z);
        let dd = c.face - v.mesh.rotation.y;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        v.mesh.rotation.y += dd * 0.15;
        v.mesh.rotation.x = 0;
        v.mesh.rotation.z = 0;
        const speed = Math.hypot(c.vx, c.vz);
        poseCharacter(v.mesh, speed, t, { phase: c.phase });
        const close = d2 < DETAIL_SQ;
        const rig = v.mesh.userData.rig as { lids: THREE.Object3D[]; brows: THREE.Object3D[] } | undefined;
        if (rig) {
          for (const l of rig.lids) l.visible = close;
          for (const b of rig.brows) b.visible = close;
        }
        if (v.tag) v.tag.visible = close && !namesHidden;
      } else {
        // 🎬 the corpse choreography — the body FOLDS to the dirt (smoothstep
        // fall), rests so the clue can be inspected, then sinks away and the
        // world forgets it. No more eternal body piles.
        const gone = dTb > CORPSE_LIE_S + CORPSE_SINK_S;
        v.mesh.visible = !gone;
        if (!gone) {
          const fall = Math.min(1, dTb / FALL_S);
          const ez = fall * fall * (3 - 2 * fall);
          const sinkD = Math.max(0, dTb - CORPSE_LIE_S) / CORPSE_SINK_S;
          v.mesh.position.set(c.deathX, 0.34 * ez - 2.0 * sinkD, c.deathZ);
          v.mesh.rotation.y = c.face;
          v.mesh.rotation.x = -ez * Math.PI / 2.1;
          v.mesh.rotation.z = 0;
          const rig = v.mesh.userData.rig as { lids: THREE.Object3D[]; brows: THREE.Object3D[] } | undefined;
          if (rig) {
            for (const l of rig.lids) l.visible = false;
            for (const b of rig.brows) b.visible = false;
          }
          if (v.tag) v.tag.visible = d2 < DETAIL_SQ && !namesHidden && sinkD <= 0;
        }
      }
    });
  });
  return (
    <>
      {views.flatMap((v, i) => [
        <primitive object={v.mesh} key={`c${i}`} />,
        <primitive object={v.blood} key={`cl${i}`} visible={false} />,
      ])}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 💰 7Nights — dropped loot: purses of the fallen & zombie hoards      */
/* ------------------------------------------------------------------ */
const MAX_LOOT_POOLS = 24; // plenty — drops are rare and collected fast

export function LootView({ engine }: { engine: GameEngine }) {
  // a fixed pool of pile groups, recycled as loot drops & gets collected
  const piles = useMemo(() => Array.from({ length: MAX_LOOT_POOLS }, () => {
    const g = new THREE.Group();
    const em = emojiSprite("💰", 0.62);
    em.position.y = 0.85;
    g.add(em);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: "#ffd447", transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.5);
    glow.position.y = 0.6;
    g.add(glow);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 6, 24),
      new THREE.MeshBasicMaterial({ color: "#ffd447", transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    g.add(ring);
    g.visible = false;
    return g;
  }), []);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    for (let i = 0; i < MAX_LOOT_POOLS; i++) {
      const g = piles[i];
      const live = i < engine.loot.length ? engine.loot[i] : null;
      if (!live) { g.visible = false; continue; }
      const dx = live.x - cam.x, dz = live.z - cam.z;
      g.visible = dx * dx + dz * dz < CULL_SQ;
      if (!g.visible) continue;
      g.position.set(live.x, 0, live.z);
      const em = g.children[0];
      em.position.y = 0.85 + Math.sin(t * 2.6 + live.bob) * 0.12;
      em.rotation.y = t * 1.4 + live.bob;
      (g.children[1] as THREE.Sprite).position.y = em.position.y - 0.15;
    }
  });
  return <>{piles.map((g, i) => <primitive object={g} key={i} />)}</>;
}

function hexToTagBg(hex: string): string {
  // opaque dark background tinted with the crew color so tags read at a glance
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)},0.92)`;
}
/* ------------------------------------------------------------------ */
/* 🪓 7Nights — tool pickups lying around the world                    */
/* ------------------------------------------------------------------ */
const TOOL_EMOJI: Record<string, string> = { axe: "🪓", sword: "🗡️", hammer: "🔨", builder: "🔧" };

export function ToolDrops({ engine }: { engine: GameEngine }) {
  const views = useMemo(() => {
    return engine.toolEnts.map((te) => {
      const g = new THREE.Group();
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: "#ffd166", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(2.6);
      g.add(glow);
      g.add(emojiSprite(TOOL_EMOJI[te.kind] ?? "🔧", 0.9));
      g.visible = false;
      return g;
    });
  }, [engine]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    engine.toolEnts.forEach((te, i) => {
      const g = views[i];
      if (!g) return;
      g.visible = te.active;
      if (!te.active) return;
      g.position.set(te.x, terrainHeight(te.x, te.z) + 0.9 + Math.sin(t * 2.4 + i) * 0.16, te.z);
      g.rotation.y = 0; // sprites always face the camera
    });
  });
  return <>{views.map((g, i) => <primitive object={g} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* 🛡️🔥 7Nights — player-built barricades & campfires                  */
/* ------------------------------------------------------------------ */
const MAX_BUILDS = 24;

export function BuildsView({ engine }: { engine: GameEngine }) {
  const slots = useMemo(() => {
    const out: THREE.Group[] = [];
    for (let i = 0; i < MAX_BUILDS; i++) {
      const g = new THREE.Group();
      // barricade — three sharpened logs
      const wood = new THREE.MeshBasicMaterial({ color: "#8a5a2b" });
      const woodDark = new THREE.MeshBasicMaterial({ color: "#5e3c1a" });
      for (let k = 0; k < 3; k++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.7 + (k === 1 ? 0.35 : 0), 6), k === 1 ? woodDark : wood);
        log.position.set((k - 1) * 0.55, 0.85, (k % 2) * 0.14);
        log.rotation.z = (k - 1) * 0.1;
        g.add(log);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 0.3), woodDark);
      bar.position.y = 0.55;
      g.add(bar);
      // campfire — stone ring, logs, flame sprite + light
      const stone = new THREE.MeshBasicMaterial({ color: "#8d8d95" });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), stone);
        s.position.set(Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55);
        g.add(s);
      }
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: "#ff8a2a", transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      flame.position.y = 0.7;
      flame.scale.setScalar(1.5);
      flame.name = "flame";
      g.add(flame);
      const light = new THREE.PointLight(0xff9040, 0, 14, 1.6);
      light.position.y = 1.1;
      light.name = "flameLight";
      g.add(light);
      g.visible = false;
      out.push(g);
    }
    return out;
  }, []);
  useFrame((s, dt) => {
    const night = nightFactor(engine.clock);
    for (let i = 0; i < MAX_BUILDS; i++) {
      const g = slots[i];
      const b = engine.builds[i];
      if (!g) continue;
      if (!b) { if (g.visible) g.visible = false; continue; }
      g.visible = true;
      g.position.set(b.x, terrainHeight(b.x, b.z), b.z);
      if (b.kind === "barricade") {
        g.rotation.y = b.rot;
        g.children.forEach((ch) => { if (ch.name === "flame" || ch.name === "flameLight") (ch as THREE.Object3D).visible = false; });
        // chewed-down barricades sink
        const hurt = Math.max(0, Math.min(1, b.hp / 100));
        g.scale.y = 0.35 + 0.65 * hurt;
      } else {
        g.rotation.y = 0;
        g.scale.y = 1;
        const flame = g.getObjectByName("flame") as THREE.Sprite | undefined;
        const light = g.getObjectByName("flameLight") as THREE.PointLight | undefined;
        const t = s.clock.elapsedTime;
        if (flame) {
          flame.visible = true;
          flame.scale.setScalar(1.3 + Math.sin(t * 9 + i) * 0.22);
        }
        if (light) {
          light.visible = true;
          light.intensity = 14 + Math.sin(t * 11 + i * 2) * 3;
        }
      }
    }
    void dt;
  });
  return <>{slots.map((g, i) => <primitive object={g} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* 🪨 7Nights — boulders (smashable) & 🌳 stumps (felled trees)        */
/* ------------------------------------------------------------------ */
export function RocksView({ engine }: { engine: GameEngine }) {
  const meshes = useMemo(() => {
    return engine.world.rocks.map((rk, i) => {
      const m = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.05 * rk.s, 0),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? "#8d8d95" : i % 3 === 1 ? "#7d7d86" : "#97948c" }),
      );
      m.position.set(rk.x, terrainHeight(rk.x, rk.z) + 0.5 * rk.s, rk.z);
      m.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      m.scale.y = 0.72;
      return m;
    });
  }, [engine]);
  // pristine transforms — the jiggle & crumble passes restore from these
  const base = useMemo(
    () => meshes.map((m) => ({ px: m.position.x, py: m.position.y, pz: m.position.z, rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z })),
    [meshes],
  );
  const jigVer = useRef(-1);
  const jiggles = useRef(new Map<number, number>());  // rock idx → jiggle end (clock s)
  const crumbles = useRef(new Map<number, number>()); // rock idx → crumble start (clock s)
  const brkVer = useRef(-1);
  useFrame((s) => {
    const now = s.clock.elapsedTime;
    // 🔨 hammer blow — the struck boulder RINGS: a quick rocking jiggle
    if (engine.rockVersion !== jigVer.current) {
      jigVer.current = engine.rockVersion;
      if (engine.lastRock >= 0 && !engine.brokenRocks.has(engine.lastRock)) {
        jiggles.current.set(engine.lastRock, now + 0.34);
      }
    }
    // version bump → sync broken/intact state (new crumbles + reset restores)
    if (engine.fellVersion !== brkVer.current) {
      brkVer.current = engine.fellVersion;
      for (let i = 0; i < meshes.length; i++) {
        if (engine.brokenRocks.has(i)) {
          if (meshes[i].visible && !crumbles.current.has(i)) crumbles.current.set(i, now);
        } else {
          crumbles.current.delete(i);
          jiggles.current.delete(i);
          const b = base[i];
          meshes[i].visible = true;
          meshes[i].position.set(b.px, b.py, b.pz);
          meshes[i].rotation.set(b.rx, b.ry, b.rz);
          meshes[i].scale.set(1, 0.72, 1);
        }
      }
    }
    for (const [i, end] of jiggles.current) {
      if (engine.brokenRocks.has(i)) { jiggles.current.delete(i); continue; }
      if (now >= end) {
        jiggles.current.delete(i);
        const b = base[i];
        meshes[i].rotation.set(b.rx, b.ry, b.rz);
        meshes[i].scale.set(1, 0.72, 1);
        continue;
      }
      const k = (end - now) / 0.34;                        // 1 → 0, damped
      const sh = Math.sin(now * 57) * 0.06 * k;
      const b = base[i];
      meshes[i].rotation.set(b.rx + sh, b.ry + sh * 0.55, b.rz - sh * 0.8);
      const sq = 1 + Math.sin(now * 44) * 0.05 * k;        // squash-and-stretch ring
      meshes[i].scale.set(1 / sq, 0.72 * sq, 1 / sq);
    }
    for (const [i, t0] of crumbles.current) {
      const k = (now - t0) / ROCK_BREAK_S;
      if (k >= 1) {
        crumbles.current.delete(i);
        meshes[i].visible = false;
        continue;
      }
      const e = k * k;                                     // accelerating collapse
      const sc = Math.max(0.001, 1 - e);
      const b = base[i];
      meshes[i].visible = true;
      meshes[i].scale.set(sc, 0.72 * sc * sc, sc);
      meshes[i].position.y = b.py - e * 0.45;              // sinks into rubble
      meshes[i].rotation.y = b.ry + e * 1.3;               // rolls as it goes
    }
  });
  return <>{meshes.map((m, i) => <primitive object={m} key={i} />)}</>;
}

const MAX_STUMPS = 120;

export function Stumps({ engine }: { engine: GameEngine }) {
  const pool = useMemo(() => {
    const out: THREE.Mesh[] = [];
    const mat = new THREE.MeshBasicMaterial({ color: "#a97b4f" });
    const top = new THREE.MeshBasicMaterial({ color: "#c79a6b" });
    for (let i = 0; i < MAX_STUMPS; i++) {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.6, 8), mat);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 8), top);
      cap.position.y = 0.32;
      g.add(cap);
      g.visible = false;
      out.push(g);
    }
    return out;
  }, []);
  const ver = useRef(-1);
  const slotTree = useRef<number[]>([]); // pool slot → tree idx (for the fall check)
  useFrame(() => {
    if (ver.current !== engine.fellVersion) {
      ver.current = engine.fellVersion;
      slotTree.current = [];
      let k = 0;
      for (const i of engine.felled) {
        if (k >= MAX_STUMPS) break;
        const t = engine.world.trees[i];
        const g = pool[k];
        g.visible = true;
        g.position.set(t.x, terrainHeight(t.x, t.z) + 0.3, t.z);
        g.scale.setScalar(t.s * 0.9);
        slotTree.current[k] = i;
        k++;
      }
      for (; k < MAX_STUMPS; k++) if (pool[k].visible) pool[k].visible = false;
    }
    // 🌳 TIMBER — a stump stays hidden while its tree is still mid-tumble;
    // it pops in only once the falling trunk has settled (or sunk away)
    for (let k = 0; k < slotTree.current.length; k++) {
      const g = pool[k];
      const ft = engine.fellTimes.get(slotTree.current[k]);
      if (ft === undefined) continue;
      if (engine.elapsed - ft < TREE_FALL_S + 0.06) {
        if (g.visible) g.visible = false; // mid-fall — keep the ground clear
      } else if (!g.visible) {
        g.visible = true; // settled — stump pops in
      }
    }
  });
  return <>{pool.map((g, i) => <primitive object={g} key={i} />)}</>;
}

/* ------------------------------------------------------------------ */
/* 🌐 multiplayer — the OTHER real souls, streamed over the wire        */
/* ------------------------------------------------------------------ */
export function RemotesView({ engine }: { engine: GameEngine }) {
  // rigs are rebuilt whenever the roster's slot signature changes (someone joined/left)
  const [slotKey, setSlotKey] = useState("");
  const slots = engine.remotes.map((r) => r.slot).join(",");
  if (slots !== slotKey) setSlotKey(slots); // React-sanctioned render-phase derived state
  const rigs = useMemo(
    () => engine.remotes.map((r, i) => ({ slot: r.slot, ...buildRemoteRig(r.look, r.name, i) })),
    // engine.remotes is mutated in place; slotKey is the real identity of the roster
    [slotKey, engine.remotes],
  );

  // 🎬 renderer-side fall clocks for remote corpses (slot → seconds since death)
  const deadT = useRef(new Map<number, number>());

  useFrame((s, dt0) => {
    const t = s.clock.elapsedTime;
    const cam = s.camera.position;
    const dt = Math.min(0.05, dt0);
    engine.remotes.forEach((r) => {
      const v = rigs.find((x) => x.slot === r.slot);
      if (!v) return;
      const beast = r.beast && r.alive;
      const body = beast ? v.beast : v.mesh;
      const idle = beast ? v.mesh : v.beast;
      if (idle.visible) idle.visible = false;
      const dx = r.x - cam.x, dz = r.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (!r.alive) {
        // 🎬 their light went out — the body folds to the dirt, then the ground
        // takes it (same choreography as the bots; timer runs renderer-side)
        const dT = (deadT.current.get(r.slot) ?? 0) + dt;
        deadT.current.set(r.slot, dT);
        const gone = dT > 2 + CORPSE_SINK_S;
        body.visible = !gone && d2 < CULL_SQ;
        if (body.visible) {
          const fall = Math.min(1, dT / 0.6);
          const ez = fall * fall * (3 - 2 * fall);
          const sinkD = Math.max(0, dT - 2) / CORPSE_SINK_S;
          body.position.set(r.x, 0.34 * ez - 2.0 * sinkD, r.z);
          body.rotation.set(-ez * Math.PI / 2.1, r.face, 0);
        }
        if (v.tag) v.tag.visible = false;
        if (v.btag) v.btag.visible = false;
        return;
      }
      deadT.current.delete(r.slot); // back among the living — reset their fall clock
      if (d2 > CULL_SQ) {
        body.visible = false;
        return;
      }
      body.visible = true;
      // y follows their stream (jump arcs) + terrain in the hills
      const gy = terrainHeight(r.x, r.z);
      body.position.set(r.x, gy + r.y, r.z);
      let dd = r.face - body.rotation.y;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      body.rotation.y += dd * 0.22;
      body.rotation.x = 0;
      body.rotation.z = 0;
      const speed = Math.hypot(r.vx, r.vz);
      poseCharacter(body, speed, t, {
        phase: r.slot * 1.7,
        airborne: r.air,
        zombie: beast,
        swing: r.attackT > 0 ? 1 - r.attackT / 0.35 : 0,
      });
      if (r.attackT > 0) r.attackT = Math.max(0, r.attackT - 1 / 60);
      const close = d2 < DETAIL_SQ;
      const rig = body.userData.rig as { lids: THREE.Object3D[]; brows: THREE.Object3D[] } | undefined;
      if (rig) {
        for (const l of rig.lids) l.visible = close;
        for (const b of rig.brows) b.visible = close;
      }
      const tag = beast ? v.btag : v.tag;
      const otherTag = beast ? v.tag : v.btag;
      if (otherTag) otherTag.visible = false;
      // 🌐 real players KEEP their names at night — the mystery is about the crew bots
      if (tag) tag.visible = close;
    });
  });

  return (
    <>
      {rigs.flatMap((v, i) => [
        <primitive object={v.mesh} key={`rm${i}`} />,
        <primitive object={v.beast} key={`rmb${i}`} visible={false} />,
      ])}
    </>
  );
}

/** One remote soul's rig: their look + name tag + possessed variant + a live ring. */
function buildRemoteRig(look: Appearance, name: string, colorIdx: number) {
  const mesh = buildCharacter(look);
  const tag = nameTag(name, hexToTagBg(SLOT_TAG_COLORS[colorIdx % SLOT_TAG_COLORS.length]));
  tag.position.y = 2.95;
  mesh.add(tag);
  // possessed body — swapped in while their beast flag is up
  const beast = buildCharacter({ ...CREW_ZOMBIE_LOOK, girl: look.girl }, { zombie: true });
  const btag = nameTag(`${name}?!`, "rgba(120,10,10,0.9)");
  btag.position.y = 2.95;
  beast.add(btag);
  beast.visible = false;
  // a live voice ring so you can tell REAL players from bots at a glance
  const ringMat = new THREE.MeshBasicMaterial({ color: "#67e8f9", transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 26), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  mesh.add(ring);
  beast.add(ring.clone());
  return { mesh, beast, tag, btag };
}

const SLOT_TAG_COLORS = ["#f472b6", "#fbbf24", "#4ade80", "#2dd4bf", "#f87171", "#c084fc", "#fb923c", "#a3e635"];

/* ------------------------------------------------------------------ */
/* 🧱 THE WALL — the PUBG-style shrinking safe zone. A shimmering       */
/* transparent cylinder that slams down one ring tighter after every    */
/* night; stand beyond it and your life drains away. Teal when you're   */
/* safe, hot red when YOU are caught outside.                           */
/* ------------------------------------------------------------------ */
const ZONE_SAFE = "#38e0c8";
const ZONE_BURN = "#ff5a4d";

export function ZoneWall({ engine }: { engine: GameEngine }) {
  const group = useRef<THREE.Group>(null);
  const wall = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const top = useRef<THREE.Mesh>(null);
  const wallMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const topMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((s) => {
    const g = group.current;
    if (!g) return;
    const on = engine.zoneLevel > 0 && !engine.won;
    g.visible = on;
    if (!on) return;
    const R = engine.zoneRadius();
    wall.current?.scale.set(R, 1, R);
    ring.current?.scale.set(R, R, 1);
    top.current?.scale.set(R, R, 1);
    // the player's own stance decides the mood: safe teal vs. burning red
    const outside = Math.hypot(engine.player.x, engine.player.z) > R;
    const t = s.clock.elapsedTime;
    const pulse = 0.72 + Math.sin(t * 2.1) * 0.28;
    const col = outside ? ZONE_BURN : ZONE_SAFE;
    if (wallMat.current) {
      wallMat.current.color.set(col);
      wallMat.current.opacity = (outside ? 0.34 : 0.24) * pulse + (outside ? 0.1 : 0);
    }
    if (ringMat.current) {
      ringMat.current.color.set(col);
      ringMat.current.opacity = (outside ? 0.95 : 0.7) * (0.8 + Math.sin(t * 2.7) * 0.2);
    }
    if (topMat.current) {
      topMat.current.color.set(col);
      topMat.current.opacity = (outside ? 0.9 : 0.6) * (0.75 + Math.sin(t * 2.4) * 0.25);
    }
  });
  return (
    <group ref={group} visible={false}>
      {/* the shimmering wall itself — open-ended cylinder, no caps */}
      <mesh ref={wall} position={[0, ZONE_WALL_H / 2, 0]}>
        <cylinderGeometry args={[1, 1, ZONE_WALL_H, 96, 1, true]} />
        <meshBasicMaterial
          ref={wallMat} color={ZONE_SAFE} transparent opacity={0.24}
          side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
      {/* ground ring — reads the exact boundary at your feet */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 0]}>
        <ringGeometry args={[0.985, 1, 96]} />
        <meshBasicMaterial
          ref={ringMat} color={ZONE_SAFE} transparent opacity={0.7}
          side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
      {/* top edge — the wall reads from across the whole safe zone */}
      <mesh ref={top} rotation={[-Math.PI / 2, 0, 0]} position={[0, ZONE_WALL_H, 0]}>
        <ringGeometry args={[0.988, 1, 96]} />
        <meshBasicMaterial
          ref={topMat} color={ZONE_SAFE} transparent opacity={0.6}
          side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
    </group>
  );
}
