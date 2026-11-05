"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ANIMAL_SET, ATTACK_CD, CAP_COLORS, CIVIL_NAMES, FAINT_S, FLIP_S, HAIR_COLORS, HAIR_STYLES, ITEMS, ITEM_COUNT, LAND_SQUASH_S, MAGNET_RADIUS, MORPH_ANIMALS, PANTS_COLORS, POWERS, SHIRT_COLORS, SKIN_TONES,
  TOTAL_VOTES, type AnimalKind, type Appearance,
} from "@/lib/game/constants";
import type { GameEngine } from "@/lib/game/engine";
import { nightFactor } from "@/lib/game/sim";
import { mulberry32 } from "@/lib/game/rng";
import {
  buildAnimal, buildCharacter, nameTag, helpBubble, poseAnimal, poseCharacter,
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
    mesh.visible = !engine.playerInVan && !morphing && !engine.drive && !beast;
    beastMesh.visible = beast && !engine.playerInVan && !engine.drive;
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
    const drv = engine.drive;
    const camX = drv ? drv.vx : p.x;
    const camZ = drv ? drv.vz : p.z;
    const cd = drv ? 11 : 8.6;
    const iy = engine.input.yaw, ip = engine.input.pitch;
    let tx = camX + Math.sin(iy) * cd * Math.cos(ip);
    let ty = Math.max(1.2, p.y + 2.1 + Math.sin(ip) * cd);
    let tz = camZ + Math.cos(iy) * cd * Math.cos(ip);
    // 🎥 chase camera vs the world — sample the focus→camera line; if a building,
    // tree canopy or lamp post stands in the way, slide the camera closer so the
    // hero (and their ride!) can never be hidden behind a dark blob
    if (introT.current >= 1) {
      const fx = camX, fy = p.y + 1.9, fz = camZ;
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
    } else if (engine.drive) {
      // 🚗 behind the wheel: glide to the chase pose (exponential, frame-rate safe).
      // Pull-in from camBlocked still applies — it feeds the glide TARGET.
      const sm = camSm.current;
      if (!sm.on) { sm.on = true; sm.pos.copy(camera.position); sm.tgt.set(camX, p.y + 1.7, camZ); }
      const k = 1 - Math.exp(-dt * 9);
      sm.pos.lerp(camV1.set(tx, ty, tz), k);
      sm.tgt.lerp(camV2.set(camX, p.y + 1.7, camZ), k);
      camera.position.copy(sm.pos);
    } else {
      camSm.current.on = false;
      camera.position.set(tx, ty, tz);
    }
    if (engine.drive && camSm.current.on) camera.lookAt(camSm.current.tgt);
    else camera.lookAt(camX, p.y + 1.7, camZ);

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
    const PROTEST_TAGS = ["✊ GIVE VOTES BACK", "✊ VOTE CHOR GO!", "✊ WE WANT VOTES", "✊ KIDS FOR DEMOCRACY", "✊ CHAI > CORRUPTION", "✊ HONK FOR VOTES"];
    engine.civs.forEach((c, i) => {
      const mesh = buildCharacter(civLooks[i]);
      // protest marchers carry a slogan placard tag instead of their name;
      // vote-scavengers get a teal tag, the join-bot a golden one — living-city cast
      const tag = c.protest
        ? nameTag(PROTEST_TAGS[i % PROTEST_TAGS.length], "rgba(181,67,42,0.85)")
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
          // 🧟💀 a fallen townsfolk lies still where the night took them
          v.mesh.position.set(n.x, 0.34, n.z);
          v.mesh.rotation.x = -Math.PI / 2.1;
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
        poseCharacter(v.mesh, speed, t, { phase: n.phase, detained: n.mode === "detained" });
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
export function Zombies({ engine }: { engine: GameEngine }) {
  const views = useMemo(
    () => new Map(engine.zombies.map((z) => [z.id, buildCharacter(
      { fac: "protester", outfit: "", skin: "#8fbf6f", shirt: "#7a8a5a", pants: "#4a5240", shoe: "#3a3a2a", hair: "#3a4a2a", hairStyle: "bowl", cap: false, capColor: "#3a4a2a", glasses: false, age: "young", girl: false },
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
  }), [engine]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let idx = 0; idx < engine.licenses.length; idx++) {
      const lc = engine.licenses[idx];
      const v = views[idx];
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
const camV2 = new THREE.Vector3();
/** Shadow-blob radius multiplier per animal kind — matches buildAnimal conf.s. */
const ANIMAL_SCALES: Record<string, number> = { cow: 1.7, chicken: 0.95, deer: 1.45, monkey: 1.1 };

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
      // the possessed body — swapped in at night
      const beast = buildCharacter({ ...CREW_ZOMBIE_LOOK, girl: c.look.girl }, { zombie: true });
      const btag = nameTag(`${c.name}?!`, "rgba(120,10,10,0.9)");
      btag.position.y = 2.95;
      beast.add(btag);
      beast.visible = false;
      // blood pool under a corpse
      const blood = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 18),
        new THREE.MeshBasicMaterial({ color: "#5c1212", transparent: true, opacity: 0.75, depthWrite: false }),
      );
      blood.rotation.x = -Math.PI / 2;
      blood.position.y = 0.04;
      blood.visible = false;
      return { mesh, beast, blood, tag, btag };
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
      const possessed = c.alive && c.mode === "possessed";
      const body = possessed ? v.beast : v.mesh;
      const idle = possessed ? v.mesh : v.beast;
      if (idle.visible) idle.visible = false;
      v.blood.visible = near && !c.alive;
      if (v.blood.visible) v.blood.position.set(c.deathX, 0.04, c.deathZ);
      if (!near) {
        body.visible = false;
        return;
      }
      body.visible = true;
      if (c.alive) {
        body.position.set(c.x, 0, c.z);
        let dd = c.face - body.rotation.y;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        body.rotation.y += dd * 0.15;
        body.rotation.x = 0;
        body.rotation.z = 0;
        const speed = Math.hypot(c.vx, c.vz);
        poseCharacter(body, speed, t, {
          phase: c.phase,
          zombie: possessed,
          // 🩸 the beast's claw swipe — plays through the 0.45s maul animation
          swing: possessed && c.attackAnimT > 0 ? 1 - c.attackAnimT / 0.45 : 0,
        });
        const close = d2 < DETAIL_SQ;
        const rig = body.userData.rig as { lids: THREE.Object3D[]; brows: THREE.Object3D[] } | undefined;
        if (rig) {
          for (const l of rig.lids) l.visible = close;
          for (const b of rig.brows) b.visible = close;
        }
        const tag = possessed ? v.btag : v.tag;
        const otherTag = possessed ? v.tag : v.btag;
        if (otherTag) otherTag.visible = false;
        if (tag) tag.visible = close && !namesHidden;
      } else {
        // a body on the ground — lie still, tag says their name one last time
        body.position.set(c.deathX, 0.34, c.deathZ);
        body.rotation.y = c.face;
        body.rotation.x = -Math.PI / 2.1;
        body.rotation.z = 0;
        const rig = body.userData.rig as { lids: THREE.Object3D[]; brows: THREE.Object3D[] } | undefined;
        if (rig) {
          for (const l of rig.lids) l.visible = false;
          for (const b of rig.brows) b.visible = false;
        }
        if (v.tag) v.tag.visible = d2 < DETAIL_SQ && !namesHidden;
        if (v.btag) v.btag.visible = false;
      }
    });
  });
  return (
    <>
      {views.flatMap((v, i) => [
        <primitive object={v.mesh} key={`c${i}`} />,
        <primitive object={v.beast} key={`cb${i}`} visible={false} />,
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
  useFrame(() => {
    for (let i = 0; i < meshes.length; i++) {
      const vis = !engine.brokenRocks.has(i);
      if (meshes[i].visible !== vis) meshes[i].visible = vis;
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
  useFrame(() => {
    if (ver.current === engine.fellVersion) return; // rebuild only when a tree falls
    ver.current = engine.fellVersion;
    let k = 0;
    for (const i of engine.felled) {
      if (k >= MAX_STUMPS) break;
      const t = engine.world.trees[i];
      const g = pool[k];
      g.visible = true;
      g.position.set(t.x, terrainHeight(t.x, t.z) + 0.3, t.z);
      g.scale.setScalar(t.s * 0.9);
      k++;
    }
    for (; k < MAX_STUMPS; k++) if (pool[k].visible) pool[k].visible = false;
  });
  return <>{pool.map((g, i) => <primitive object={g} key={i} />)}</>;
}
