"use client";

/**
 * LobbyStage — the Fortnite/PUBG lobby hero stage, GLB-only.
 *
 * The center of the landing dashboard: your survivor stands on a raised
 * circular podium with a glowing center ring, lit like a reveal stage over
 * the photoreal night-city backdrop — no cartoon bodies here. The rig is the
 * SAME rigged Polyfork GLB the game plays (look.char, or the default hero),
 * so the lobby previews exactly who drops into the night.
 *
 *   • drag to spin — the turntable eases back to face the camera
 *   • Idle clip runs on the shared mixer (pure standing sway, no hops —
 *     the hero plants on the floor like the big-game lobbies)
 *   • podium: metal disc + glowing center circle + amber/teal accent rings
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

/* ---------------- podium (built once) ---------------- */

/** Soft radial shadow pool — a canvas gradient (no hard ellipse edge) so the
 *  stage melts into the photoreal backdrop like a spotlight on wet asphalt. */
function useFloorFadeTexture(): THREE.CanvasTexture | null {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const g = ctx.createRadialGradient(128, 128, 18, 128, 128, 126);
    g.addColorStop(0, "rgba(4,7,14,0.95)");
    g.addColorStop(0.5, "rgba(4,7,14,0.72)");
    g.addColorStop(0.82, "rgba(4,7,14,0.35)");
    g.addColorStop(1, "rgba(4,7,14,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    setTex(new THREE.CanvasTexture(c));
  }, []);
  return tex;
}

function Podium() {
  const fade = useFloorFadeTexture();
  return (
    <group>
      {/* soft shadow pool — sells "standing on the ground" over the backdrop */}
      {fade && (
        <mesh rotation-x={-Math.PI / 2} position-y={-0.004}>
          <planeGeometry args={[21, 21]} />
          <meshBasicMaterial map={fade} transparent depthWrite={false} />
        </mesh>
      )}

      {/* raised metal podium — the top face sits exactly at y = 0 */}
      <mesh position-y={-0.085}>
        <cylinderGeometry args={[1.86, 2.05, 0.17, 56]} />
        <meshStandardMaterial color="#141c2b" roughness={0.55} metalness={0.65} />
      </mesh>
      {/* podium rim highlight */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
        <ringGeometry args={[1.78, 1.86, 56]} />
        <meshBasicMaterial color="#3d4c66" transparent opacity={0.9} />
      </mesh>

      {/* glowing center circle the hero stands on */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.004}>
        <circleGeometry args={[1.5, 56]} />
        <meshBasicMaterial color="#7c4a08" transparent opacity={0.5} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.006}>
        <ringGeometry args={[1.32, 1.52, 56]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.85} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.006}>
        <ringGeometry args={[1.66, 1.71, 56]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.4} />
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
    <group ref={g}>
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
        onCreated={({ camera }) => camera.lookAt(0, 1.0, 0)}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
      >
        {/* reveal-stage lighting — warm key, cool rim, soft overhead fill */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 7, 5]} intensity={1.35} color="#ffe3b8" />
        <directionalLight position={[-6, 4, -6]} intensity={0.95} color="#7fd8e8" />
        <pointLight position={[0, 5.4, 2.6]} intensity={1.1} color="#ffd27a" distance={14} />
        <Podium />
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
