"use client";

/**
 * LobbyStage — the PUBG lobby hero stage, GLB-only.
 *
 * The center of the landing dashboard: your survivor stands directly ON the
 * floor of the photoreal night backdrop — no raised podium, no floating pad.
 * A wet-asphalt ground patch fades out at its rim so the 3D floor melts into
 * the backdrop's road, a tight contact shadow sells the footing, and one
 * small glowing circle marks the stand point. The rig is the SAME rigged
 * Polyfork GLB the game plays (look.char, or the default hero), so the lobby
 * previews exactly who drops into the night.
 *
 *   • drag to spin — the turntable eases back to face the camera
 *   • Idle clip runs on the shared mixer (pure standing sway, no hops —
 *     the hero plants on the floor like the big-game lobbies)
 *   • floor: fading asphalt patch + soft shadow pool + small amber/teal ring
 *   • streams in on demand (no cartoon stand-in): a loader chip until the
 *     file lands, a retry hint if the CDN is unreachable
 */

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Loader2 } from "lucide-react";
import { AGE_STATS, DEFAULT_HERO_SLUG, type Appearance } from "@/lib/game/constants";
import {
  ensureGlbArea, glbAreaFor, loadGlbTemplate, makeGlbInstance,
  preloadGlbCharacters, TOWN_AREA_ID,
  type GlbInstance,
} from "@/lib/game/glbCharacters";

/* ---------------- ground floor (built once) ---------------- */

/** Wet-asphalt ground patch — canvas noise + faint cracks, then a radial
 *  alpha punch so the rim melts into the backdrop's real road. Tinted to the
 *  hero backdrop's asphalt (dark blue-grey) so no seam is ever visible.
 *  Module-level singleton (same pattern as character.ts) — built lazily on
 *  the client the first time the lobby floor renders. */
let groundTex: THREE.CanvasTexture | null = null;
function getGroundTex(): THREE.CanvasTexture {
  if (groundTex) return groundTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  // asphalt base
  ctx.fillStyle = "#232933";
  ctx.fillRect(0, 0, 256, 256);
  // grain speckle — coarse asphalt aggregate
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 1.4 + 0.3;
    const l = Math.random();
    ctx.fillStyle = l < 0.45 ? "rgba(8,11,17,0.5)" : l < 0.85 ? "rgba(46,55,70,0.35)" : "rgba(64,74,92,0.22)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // faint cracks — thin dark polylines
  ctx.strokeStyle = "rgba(6,9,14,0.4)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let x = 40 + Math.random() * 176;
    let y = 40 + Math.random() * 176;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (Math.random() - 0.5) * 42;
      y += (Math.random() - 0.5) * 42;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // wet sheen — two soft puddle glints
  for (const [px, py, pr] of [[96, 118, 34], [170, 150, 26]] as const) {
    const wg = ctx.createRadialGradient(px, py, 2, px, py, pr);
    wg.addColorStop(0, "rgba(120,140,170,0.16)");
    wg.addColorStop(1, "rgba(120,140,170,0)");
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  // punch the alpha rim — opaque center, fully transparent edge
  const cut = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  cut.addColorStop(0, "rgba(0,0,0,1)");
  cut.addColorStop(0.62, "rgba(0,0,0,0.85)");
  cut.addColorStop(0.88, "rgba(0,0,0,0.32)");
  cut.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = cut;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = "source-over";
  groundTex = new THREE.CanvasTexture(c);
  return groundTex;
}

/** Tight contact shadow — a small dark pool right under the boots. */
let bootShadowTex: THREE.CanvasTexture | null = null;
function getBootShadowTex(): THREE.CanvasTexture {
  if (bootShadowTex) return bootShadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
  g.addColorStop(0, "rgba(3,6,11,0.7)");
  g.addColorStop(0.35, "rgba(3,6,11,0.4)");
  g.addColorStop(0.7, "rgba(3,6,11,0.15)");
  g.addColorStop(1, "rgba(3,6,11,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  bootShadowTex = new THREE.CanvasTexture(c);
  return bootShadowTex;
}

function GroundFloor() {
  const ground = getGroundTex();
  const shadow = getBootShadowTex();
  return (
    <group>
      {/* wet-asphalt floor patch — melts into the backdrop's road */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.002}>
        <circleGeometry args={[2.2, 48]} />
        <meshBasicMaterial map={ground} transparent depthWrite={false} opacity={0.9} />
      </mesh>

      {/* soft shadow pool under the boots — sells "standing on the ground" */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
        <planeGeometry args={[2.3, 2.3]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>

      {/* small glowing center circle the hero stands in */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.004}>
        <circleGeometry args={[0.8, 48]} />
        <meshBasicMaterial color="#8a5a18" transparent opacity={0.12} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.006}>
        <ringGeometry args={[0.72, 0.84, 48]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.72} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.006}>
        <ringGeometry args={[1.04, 1.08, 48]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.32} />
      </mesh>
    </group>
  );
}

/* ---------------- the hero (mixer + turntable) ---------------- */

function HeroBody({
  inst, spin, drag,
}: {
  inst: GlbInstance;
  spin: { current: number };
  drag: { current: { on: boolean; lastX: number; idle: number } };
}) {
  const g = useRef<THREE.Group>(null!);

  useEffect(() => {
    const mixer = inst.mixer;
    return () => {
      mixer.stopAllAction();
    };
  }, [inst]);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const d = drag.current;
    // drive the Idle clip (makeGlbInstance already started it at weight 1)
    inst.mixer.update(Math.min(0.1, Math.max(0, dt)));

    if (g.current) {
      if (!d.on) {
        d.idle += dt;
        if (d.idle > 1.2) {
          // ease back to the nearest full turn (facing the camera) + breathe
          const front = Math.round(spin.current / (Math.PI * 2)) * Math.PI * 2;
          spin.current += (front - spin.current) * Math.min(1, dt * 2.0);
        }
      }
      const sway = !d.on && d.idle > 1.2 ? Math.sin(t * 0.5) * 0.22 : 0;
      g.current.rotation.y = spin.current + sway;
      // planted on the floor — the only motion is the idle clip itself
      g.current.position.y = 0;
    }
  });

  return (
    <group ref={g} scale={0.9}>
      <primitive object={inst.body} />
    </group>
  );
}

/* ---------------- the stage ---------------- */

export function LobbyStage({ look }: { look: Appearance }) {
  const slug = look.char || DEFAULT_HERO_SLUG;
  const ageScale = AGE_STATS[look.age]?.scale ?? 1;
  // the hero that finished streaming — tagged with its slug so a Locker
  // re-pick only swaps in when the NEW rig actually lands (setState happens
  // exclusively in the promise callbacks, never in the effect body)
  const [loaded, setLoaded] = useState<{ slug: string; inst: GlbInstance | null; failed: boolean } | null>(null);
  const spin = useRef(0);
  const drag = useRef({ on: false, lastX: 0, idle: 99 });

  /* stream the hero's area in (idempotent) + load this exact rig.
     loadGlbTemplate shares one inflight promise per slug, so re-picks of the
     same hero resolve instantly from cache. */
  useEffect(() => {
    preloadGlbCharacters();
    ensureGlbArea(glbAreaFor(slug) ?? TOWN_AREA_ID);
    let live = true;
    loadGlbTemplate(slug)
      .then(() => {
        if (!live) return;
        setLoaded({ slug, inst: makeGlbInstance(slug, ageScale), failed: false });
      })
      .catch(() => { if (live) setLoaded({ slug, inst: null, failed: true }); });
    return () => { live = false; };
  }, [slug, ageScale]);

  const shown = loaded && loaded.slug === slug ? loaded : null;
  const inst = shown?.inst ?? null;

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current.on = true;
    drag.current.lastX = e.clientX;
    drag.current.idle = 0;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.on) return;
    const dx = e.clientX - drag.current.lastX;
    drag.current.lastX = e.clientX;
    spin.current += dx * 0.011;
    drag.current.idle = 0;
  };
  const endDrag = () => { drag.current.on = false; };

  return (
    <div
      className="relative h-full w-full cursor-grab active:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      role="img"
      aria-label={`Your survivor standing on the lobby stage${look.char ? "" : " (default hero)"}`}
    >
      <Canvas
        className="absolute inset-0"
        camera={{ fov: 38, position: [0, 1.55, 4.9] }}
        onCreated={({ camera }) => camera.lookAt(0, 1.46, 0)}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
      >
        {/* reveal-stage lighting — warm key, cool rim, soft overhead fill */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 7, 5]} intensity={1.35} color="#ffe3b8" />
        <directionalLight position={[-6, 4, -6]} intensity={0.95} color="#7fd8e8" />
        <pointLight position={[0, 5.4, 2.6]} intensity={1.1} color="#ffd27a" distance={14} />
        <GroundFloor />
        {inst && <HeroBody inst={inst} spin={spin} drag={drag} />}
      </Canvas>

      {/* streaming chip — no cartoon stand-in, we wait for the real rig */}
      {!inst && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-slate-950/80 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-white/80 ring-1 ring-white/20 backdrop-blur">
            {shown?.failed ? (
              <>
                <span className="text-red-300">hero stream failed</span>
                <span className="text-white/45">— check connection · retry from Locker</span>
              </>
            ) : (
              <>
                <Loader2 size={13} className="animate-spin text-yellow-300" />
                summoning your survivor…
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
