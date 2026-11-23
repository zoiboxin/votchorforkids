"use client";

/**
 * Creator — the LOCKER: a rigged-GLB survivor workshop.
 *
 * Every setting here is driven by the Polyfork GLB character files — the same
 * rigged, clip-animated humans the lobby stage and the town render:
 *
 *   • HERO — browse the whole catalog by kit area and WEAR any citizen. The
 *     portraits, streaming state and the worn-hero info strip (name, kit
 *     area, the animation clips embedded in the file) all read straight from
 *     the GLB files. The old paint-a-cartoon "Classic" option is gone.
 *   • BODY — the age/size pick rescales the worn GLB (makeGlbInstance's
 *     ageScale) and retunes run speed / jump / recovery.
 *
 * The old outfit & style tabs (skin / shirt / pants / shoe swatches, outfit
 * presets, hair, caps, glasses, girl/boy) are REMOVED — they only painted the
 * cartoon stand-in body, which the rigged GLB covers up the moment it lands
 * (lobby stage is GLB-only, and in town the rig swaps over the cartoon). The
 * preview streams the actual worn GLB — a loader chip until the file lands,
 * then the rigged body plays every showcase move through the same
 * poseCharacter router the game uses.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { motion } from "framer-motion";
import {
  Play, Sparkles, ArrowLeft, Dices, HelpCircle, Hand, Moon,
  Gauge, ChevronsUp, HeartPulse, Baby, UserRound, Loader2, ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AGE_STATS, DEFAULT_HERO_SLUG, NAME_SUGGESTIONS, randomAppearance,
  type AgeGroup, type Appearance,
} from "@/lib/game/constants";
import { poseCharacter } from "@/lib/game/character";
import {
  ALL_GLB_CHARS, GLB_AREAS, GLB_CHAR_COUNT, TOWN_AREA_ID, ensureGlbArea,
  glbAreaStatus, glbCharDef, glbCharFailed, glbTemplate, glbThumb,
  loadGlbTemplate, makeGlbInstance, preloadGlbCharacters,
  useGlbAreaState, useGlbThumbs,
  type GlbInstance,
} from "@/lib/game/glbCharacters";
import { sfx } from "@/lib/game/audio";
import { shopItem, SHOP_ITEMS, SHOP_KINDS, type ShopItem } from "@/lib/game/shop";
import { useGame } from "./store";
import { Leaderboard } from "./Leaderboard";
import { HowToPlay } from "./Panels";

/* ============================ 3D preview ============================ */
/* Drag to spin the hero; auto turntable resumes after you let go.     */

/* 🎬 animation showcase — one click plays any move on the preview stage */
export type PoseAnimName =
  | "idle" | "walk" | "run" | "jump" | "fight" | "dance"
  | "wave" | "cheer" | "drive" | "death" | "getup";

const ANIM_BUTTONS: { id: PoseAnimName; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "walk", label: "Walk" },
  { id: "run", label: "Run" },
  { id: "jump", label: "Jump" },
  { id: "fight", label: "Fight" },
  { id: "dance", label: "Dance" },
  { id: "wave", label: "Wave" },
  { id: "cheer", label: "Cheer" },
  { id: "drive", label: "Drive" },
  { id: "death", label: "Death" },
  { id: "getup", label: "Get up" },
];

/** Soft shadow pool under the preview boots — module-level canvas singleton
 *  (same pattern as LobbyStage's ground/shadow textures). */
let podiumShadowTex: THREE.CanvasTexture | null = null;
function getPodiumShadow(): THREE.CanvasTexture {
  if (podiumShadowTex) return podiumShadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, "rgba(2,8,6,0.55)");
  g.addColorStop(0.5, "rgba(2,8,6,0.22)");
  g.addColorStop(1, "rgba(2,8,6,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  podiumShadowTex = new THREE.CanvasTexture(c);
  return podiumShadowTex;
}

export function Preview({ look, anim = "idle" }: { look: Appearance; anim?: PoseAnimName }) {
  const slug = look.char || DEFAULT_HERO_SLUG;
  const ageScale = AGE_STATS[look.age]?.scale ?? 1;

  // persistent THREE root — the worn GlbInstance rides userData.glb so
  // poseCharacter routes every showcase move to the rigged body's clip mixer
  const root = useMemo(() => new THREE.Group(), []);
  const [loaded, setLoaded] = useState<{ slug: string; ok: boolean } | null>(null);

  // stream the worn hero's GLB file (cache-shared with the lobby stage),
  // then swap the rigged instance into the root — no cartoon stand-in here,
  // the locker previews exactly the file the game will wear. State is only
  // touched in the promise callbacks; until they land, the stale `loaded`
  // tag simply doesn't match the new slug and the chip shows "streaming".
  useEffect(() => {
    let live = true;
    loadGlbTemplate(slug)
      .then(() => {
        if (!live) return;
        const prev = root.userData.glb as GlbInstance | undefined;
        if (prev) { prev.mixer.stopAllAction(); root.remove(prev.body); }
        const inst = makeGlbInstance(slug, ageScale);
        if (inst) {
          root.userData.glb = inst;
          root.add(inst.body);
        }
        setLoaded({ slug, ok: !!inst });
      })
      .catch(() => { if (live) setLoaded({ slug, ok: false }); });
    return () => { live = false; };
  }, [slug, ageScale, root]);

  // unmount — silence the mixer (template geometry is shared, never disposed)
  useEffect(() => () => {
    (root.userData.glb as GlbInstance | undefined)?.mixer.stopAllAction();
  }, [root]);

  const g = useRef<THREE.Group>(null!);
  const spin = useRef(0);
  const drag = useRef({ on: false, lastX: 0, idle: 99 });

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

  const stage = loaded && loaded.slug === slug ? loaded : null;

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
      aria-label={`3D preview of your survivor: ${glbCharDef(slug)?.name ?? "rigged hero"} (${look.age})`}
    >
      <Canvas
        className="absolute inset-0"
        camera={{ fov: 40, position: [0, 1.9, 4.6] }}
        onCreated={({ camera }) => camera.lookAt(0, 1.2, 0)}
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 6]} intensity={1.1} color="#fff2d0" />
        <directionalLight position={[-5, 3, -4]} intensity={0.4} color="#a8d8ff" />
        {/* podium */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <circleGeometry args={[1.7, 48]} />
          <meshBasicMaterial color="#0c3a2a" transparent opacity={0.22} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.035}>
          <ringGeometry args={[1.55, 1.7, 48]} />
          <meshBasicMaterial color="#fde047" transparent opacity={0.6} />
        </mesh>
        {/* contact shadow pool right under the boots */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.045}>
          <planeGeometry args={[1.5, 1.5]} />
          <meshBasicMaterial map={getPodiumShadow()} transparent depthWrite={false} />
        </mesh>
        <group ref={g}>
          <primitive object={root} />
        </group>
        <PreviewAnim root={root} g={g} spin={spin} drag={drag} anim={anim} />
      </Canvas>

      {/* streaming chip — the locker wears real GLB files or nothing */}
      {(!stage || !stage.ok) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-slate-950/80 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/80 ring-1 ring-white/20 backdrop-blur">
            {stage && !stage.ok ? (
              <>
                <span className="text-red-300">hero stream failed</span>
                <span className="text-white/45">— pick another hero</span>
              </>
            ) : (
              <>
                <Loader2 size={13} className="animate-spin text-yellow-300" />
                streaming your hero…
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewAnim({
  root, g, spin, drag, anim,
}: {
  root: THREE.Object3D;
  g: React.RefObject<THREE.Group | null>;
  spin: { current: number };
  drag: { current: { on: boolean; lastX: number; idle: number } };
  anim: PoseAnimName;
}) {
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const d = drag.current;
    if (!d.on) {
      d.idle += dt;
      if (d.idle > 1.0) {
        // ease back to the nearest full turn (facing the camera) + friendly sway
        const front = Math.round(spin.current / (Math.PI * 2)) * Math.PI * 2;
        spin.current += (front - spin.current) * Math.min(1, dt * 2.2);
      }
    }
    if (g.current) {
      const sway = !d.on && d.idle > 1.0 ? Math.sin(t * 0.42) * 0.5 : 0;
      g.current.rotation.y = spin.current + sway;
      // planted like the lobby stage — the Idle clip carries the motion;
      // the only scripted root arc is the jump showcase's leap
      g.current.position.y = anim === "jump" ? Math.sin(((t % 1.4) / 1.4) * Math.PI) * 1.05 : 0;
    }
    // the death tip owns the root — every other move stands upright
    if (anim !== "death") root.rotation.x = 0;
    // 🎬 the chosen move — routed through the same poseCharacter the town
    // uses; with a rigged body attached it plays the GLB clip mixer + the
    // Mixamo bone overlays, so the stage previews EXACTLY what the game plays
    if (anim === "walk") poseCharacter(root, 4.6, t, {});
    else if (anim === "run") poseCharacter(root, 9.6, t, {});
    else if (anim === "jump") {
      const p = (t % 1.4) / 1.4;
      poseCharacter(root, 0, t, { airborne: p < 0.85, vy: Math.cos(p * Math.PI) * 4.6 });
    } else if (anim === "fight") poseCharacter(root, 0, t, { swing: (t % 0.9) / 0.9 });
    else if (anim === "dance") poseCharacter(root, 0, t, { dance: true });
    else if (anim === "wave") poseCharacter(root, 0, t, { wave: true });
    else if (anim === "cheer") poseCharacter(root, 0, t, { cheer: true });
    else if (anim === "drive") poseCharacter(root, 0, t, { drive: true });
    else if (anim === "death") {
      // fall → rest a beat → restart (the root tips over like the real corpse fall)
      const p = (t % 4.6) / 4.6;
      const ez = Math.min(1, p / 0.28);
      root.rotation.x = -(ez * ez * (3 - 2 * ez)) * Math.PI / 2.1;
      poseCharacter(root, 0, t, { death: ez });
    } else if (anim === "getup") {
      // down → push-off → stand → a beat of idle → loop
      const p = t % 3.6;
      const g8 = Math.max(0, 1 - p / 1.35);
      poseCharacter(root, 0, t, { getup: g8 });
    } else {
      poseCharacter(root, 0, t, {});
    }
  });
  return null;
}

/* ============================ hero picker (GLB only) ============================ */

function AgeCards({ value, onChange }: { value: AgeGroup; onChange: (a: AgeGroup) => void }) {
  const ages: { id: AgeGroup; emoji: string }[] = [
    { id: "kid", emoji: "🧒" }, { id: "teen", emoji: "🧑" }, { id: "young", emoji: "🧑‍🦱" }, { id: "old", emoji: "🧓" },
  ];
  const s = AGE_STATS[value];
  const stat = (v: number, lo: number, hi: number) => Math.max(10, Math.min(100, Math.round(((v - lo) / (hi - lo)) * 100)));
  const rows = [
    { icon: <Gauge size={12} />, label: "Speed", v: stat(s.speed, 4.8, 7.2), cls: "from-emerald-400 to-teal-300" },
    { icon: <ChevronsUp size={12} />, label: "Jump", v: stat(s.jump, 6.4, 8.8), cls: "from-amber-400 to-yellow-300" },
    { icon: <HeartPulse size={12} />, label: "Recovery", v: stat(s.regen, 0.8, 1.9), cls: "from-rose-400 to-pink-300" },
  ];
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Age &amp; size</div>
      <div className="grid grid-cols-4 gap-2">
        {ages.map((a) => (
          <button
            key={a.id}
            aria-pressed={value === a.id}
            onClick={() => { sfx.click(); onChange(a.id); }}
            className={`rounded-xl border-2 p-2 text-center transition-all hover:scale-105 ${
              value === a.id ? "border-yellow-300 bg-yellow-300/20 shadow-[0_0_12px_rgba(253,224,71,0.3)]" : "border-white/20 bg-white/5"
            }`}
          >
            <div className="text-xl">{a.emoji}</div>
            <div className="text-[10px] font-bold capitalize text-white/85">{a.id}</div>
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-1.5 rounded-xl bg-white/5 p-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="flex w-20 items-center gap-1 text-[10px] font-black uppercase tracking-wide text-white/70">{r.icon}{r.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
              <motion.div
                key={`${value}-${r.label}`}
                className={`h-full rounded-full bg-gradient-to-r ${r.cls}`}
                initial={{ width: 0 }}
                animate={{ width: `${r.v}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
        <div className="text-[11px] font-bold text-emerald-300">{s.label}</div>
      </div>
    </div>
  );
}

/* 🧍 Hero picker — browse the whole Polyfork catalog by AREA, GLB-only. A
 * dropdown lists every kit area from the catalog (Airport, Hospital, Graveyard,
 * Prehistoric Valley …) plus the preloaded Town Cast; picking an area streams
 * that area's rigged citizens in — real rendered portraits captured once each
 * GLB lands. The worn-hero strip reads the FILE itself: name, kit area and
 * the animation clips embedded inside the GLB. */
function HeroPicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  useGlbThumbs();    // re-renders as portraits finish
  useGlbAreaState(); // re-renders when the chosen area starts/finishes streaming
  // Browsed area as DERIVED state: a manual pick is remembered "for" the
  // hero currently worn; when the worn hero changes from elsewhere (Random,
  // restore), the dropdown snaps back to that hero's own area — no effects.
  const areaOfValue = (v: string) => glbCharDef(v)?.area ?? TOWN_AREA_ID;
  const [pick, setPick] = useState<{ for: string; area: string }>(() => ({
    for: value, area: areaOfValue(value),
  }));
  const areaId = value === pick.for ? pick.area : areaOfValue(value);
  const setAreaId = (v: string) => setPick({ for: value, area: v });
  // stream the chosen area's GLBs + portraits (idempotent)
  useEffect(() => { ensureGlbArea(areaId); }, [areaId]);

  const area = GLB_AREAS.find((a) => a.id === areaId) ?? GLB_AREAS[0];
  const streaming = glbAreaStatus(areaId) === "loading";
  const worn = glbCharDef(value);
  const wornArea = worn ? GLB_AREAS.find((a) => a.id === worn.area) : undefined;
  const wornTpl = glbTemplate(value);
  const clipNames = wornTpl?.clips.map((c) => c.name) ?? [];

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-white/70">Character</div>
        <div className="text-[10px] font-bold text-white/40">{GLB_CHAR_COUNT} rigged heroes · {GLB_AREAS.length} areas</div>
      </div>
      {/* 🗺️ area dropdown — every catalog kit, one tap away */}
      <Select value={areaId} onValueChange={(v) => { sfx.click(); setAreaId(v); }}>
        <SelectTrigger
          aria-label="Character area"
          className="h-9 rounded-xl border-white/25 bg-white/10 text-xs font-black text-white shadow-none hover:bg-white/15 focus:ring-0 data-[placeholder]:text-white"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72 rounded-xl border-white/20 bg-slate-900/95 text-white backdrop-blur">
          {GLB_AREAS.map((a) => (
            <SelectItem
              key={a.id}
              value={a.id}
              className="text-xs font-bold focus:bg-white/15 focus:text-white data-[state=checked]:text-yellow-300"
            >
              <span className="mr-1" aria-hidden>{a.emoji}</span>
              {a.name}
              <span className="ml-1.5 font-normal text-white/40">{a.chars.length}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* the area's cast — scrollable so big kits (Hotel & Casino = 20) fit */}
      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-black/20 p-1.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/25 [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
          {area.chars.map((h) => {
            const on = value === h.slug;
            const thumb = glbThumb(h.slug);
            const dead = glbCharFailed(h.slug);
            return (
              <button
                key={h.slug}
                aria-pressed={on}
                title={dead ? `${h.name} — unavailable` : h.name}
                disabled={dead}
                onClick={() => { sfx.click(); onChange(h.slug); }}
                className={`relative rounded-xl border-2 p-1.5 text-center transition-all ${
                  dead
                    ? "cursor-not-allowed border-white/10 bg-white/5 opacity-45"
                    : on
                      ? "border-yellow-300 bg-yellow-300/20 shadow-[0_0_12px_rgba(253,224,71,0.3)] hover:scale-105"
                      : "border-white/20 bg-white/5 hover:scale-105"
                }`}
              >
                {dead && (
                  <span aria-hidden className="absolute right-1 top-1 text-[10px] font-black text-red-300">✕</span>
                )}
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    draggable={false}
                    className="mx-auto h-12 w-full object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
                  />
                ) : (
                  <div className={`flex h-12 items-center justify-center text-xl leading-none ${!dead ? "animate-pulse" : ""}`}>
                    {h.emoji}
                  </div>
                )}
                <div className="mt-0.5 truncate text-[10px] font-bold leading-tight text-white/85">{h.name}</div>
              </button>
            );
          })}
        </div>
      </div>
      {streaming && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-white/60" role="status">
          <Loader2 size={11} className="animate-spin" /> streaming {area.name} portraits…
        </div>
      )}
      {/* 👑 worn-hero strip — read straight from the GLB file itself */}
      {worn && (
        <div
          role="status"
          aria-label={`Wearing ${worn.name} from ${wornArea?.name ?? "the catalog"}`}
          className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl bg-white/5 px-2.5 py-2 text-[11px] font-bold text-white/70"
        >
          <span aria-hidden className="text-sm leading-none">{worn.emoji}</span>
          <span>wearing <b className="text-white">{worn.name}</b></span>
          <span className="text-white/25">·</span>
          <span>{wornArea?.emoji} {wornArea?.name ?? "catalog"}</span>
          {clipNames.length > 0 && (
            <>
              <span className="text-white/25">·</span>
              <span className="text-emerald-300">
                clips: {clipNames.slice(0, 4).join(" · ")}{clipNames.length > 4 ? ` +${clipNames.length - 4}` : ""}
              </span>
            </>
          )}
        </div>
      )}
      <div className="mt-2 rounded-xl bg-white/5 p-2.5 text-xs leading-relaxed text-white/70">
        <b className="text-white">Pick an area, pick a hero:</b> {GLB_CHAR_COUNT} rigged citizens across{" "}
        {GLB_AREAS.length} areas — every GLB file ships animated (Idle · Walk · Run embedded) and plays every
        showcase move in-game. Your hero is saved on this device.
      </div>
    </div>
  );
}

/* ============================ locker items ============================ */

/** 🛍️ the Items tab — the player's collection: wallet balance, every PURCHASED
 *  shop item and where the money comes from (cash scooped while roaming). */
function LockerItems() {
  const coins = useGame((s) => s.coins);
  const owned = useGame((s) => s.owned);
  const lifeMoney = useGame((s) => s.lifeMoney);
  const setScreen = useGame((s) => s.setScreen);
  const setLandingTab = useGame((s) => s.setLandingTab);

  const items = owned.map((id) => shopItem(id)).filter((it): it is ShopItem => !!it);

  return (
    <div className="space-y-3">
      {/* 💰 wallet — spendable balance + lifetime bank */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-yellow-300/30 bg-yellow-400/10 px-3 py-2.5">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-yellow-200">💰 Wallet</div>
          <div className="text-xl font-black leading-tight text-yellow-300">${coins.toLocaleString()}</div>
        </div>
        <div className="text-right text-[10px] font-bold leading-snug text-white/60">
          <div>${lifeMoney.toLocaleString()} banked lifetime</div>
          <div className="text-white/40">cash piles · purses · zombie hoards</div>
        </div>
      </div>

      {/* 🛍️ purchased collection — grouped by shop section */}
      <div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">
          Purchased ({items.length})
        </div>
        {items.length === 0 ? (
          <div className="rounded-xl bg-white/5 p-3.5 text-center text-[11px] font-bold leading-snug text-white/55">
            Nothing collected yet — roam the town, bank some 💰 and spend it in the{" "}
            <b className="text-yellow-300">Item Shop</b>!
          </div>
        ) : (
          <div className="space-y-2">
            {SHOP_KINDS.map((sec) => {
              const rows = items.filter((it) => it.kind === sec.id);
              if (rows.length === 0) return null;
              return (
                <div key={sec.id}>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-white/55">
                    <span aria-hidden>{sec.emoji}</span> {sec.label}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {rows.map((it) => (
                      <div
                        key={it.id}
                        title={it.tip}
                        className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-1.5 text-center"
                      >
                        <div className="text-lg leading-none">{it.emoji}</div>
                        <div className="mt-0.5 truncate text-[9px] font-bold text-white/85">{it.name}</div>
                        <div className="text-[8px] font-black uppercase text-emerald-300">
                          {it.kind === "style" ? "outfit" : "every run"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Button
        onClick={() => { sfx.click(); setLandingTab("store"); setScreen("landing"); }}
        className="h-9 w-full rounded-xl bg-orange-600 text-xs font-black text-white hover:bg-orange-500"
      >
        <ShoppingBag size={13} className="mr-1.5" /> Open the Item Shop
      </Button>

      <div className="rounded-xl bg-white/5 p-2.5 text-[11px] leading-relaxed text-white/70">
        <b className="text-white">How it works:</b> every dollar you scoop while roaming gets banked when the run
        ends. Spend it in the Item Shop — purchased gear, gems &amp; snacks spawn with you EVERY run; tools &amp;
        gems ride the 🎒 wheel (<b>G</b> / right-click), snacks fill the 1–8 hotbar.
      </div>
    </div>
  );
}

/* ============================ creator ============================ */
export function Creator({ onStart }: { onStart: () => void }) {
  const look = useGame((s) => s.look);
  const setLook = useGame((s) => s.setLook);
  const applyLook = useGame((s) => s.applyLook);
  const playerName = useGame((s) => s.playerName);
  const setName = useGame((s) => s.setName);
  const setScreen = useGame((s) => s.setScreen);
  const runsPlayed = useGame((s) => s.runsPlayed);
  const [starting, setStarting] = useState(false);
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState("hero");
  const [anim, setAnim] = useState<PoseAnimName>("idle");

  useEffect(() => {
    const unlock = () => { sfx.click(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // 🧍 start streaming the Polyfork cast right away — by the time the player
  // joins, the characters are parsed and the town spawns already rigged
  useEffect(() => { preloadGlbCharacters(); }, []);

  // normalize stale saves: legacy police-side looks are gone, and the locker
  // is GLB-only — a missing / dropped hero slug falls back to the default
  // rigged traveller so EVERY profile wears a real GLB file
  useEffect(() => {
    const s = useGame.getState();
    if (s.look.fac === "police" || s.look.outfit) s.setLook({ fac: "protester", outfit: "" });
    const cur = s.look.char;
    if ((!cur || !glbCharDef(cur)) && cur !== DEFAULT_HERO_SLUG) s.setLook({ char: DEFAULT_HERO_SLUG });
  }, []);

  const update = (p: Partial<Appearance>) => setLook(p);
  const ready = playerName.trim().length > 0;

  const wornDef = glbCharDef(look.char || DEFAULT_HERO_SLUG);
  const lookChips = [
    wornDef ? `${wornDef.emoji} ${wornDef.name}` : "rigged survivor",
    `${look.age.charAt(0).toUpperCase()}${look.age.slice(1)}`,
  ];

  return (
    <div className="relative h-screen w-full overflow-y-auto overflow-x-hidden">
      {/* backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-lobby-night.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/65 to-slate-950/90" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 pb-28 lg:pb-8">
        {/* header */}
        <header className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm" onClick={() => { sfx.click(); setScreen("landing"); }}
            className="rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur hover:bg-black/50"
          >
            <ArrowLeft size={15} className="mr-1" /> Back
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black tracking-tight text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)] sm:text-3xl">
              Join the 7 Nights <span aria-hidden>🌙</span>
            </h1>
            <p className="hidden text-xs font-bold text-orange-300 sm:block">
              Pick a name, wear a rigged hero — drag the stage to spin!
            </p>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_460px]">
          {/* -------- left: preview + leaderboard -------- */}
          <div className="flex w-full min-w-0 flex-col items-center gap-4">
            <div className="relative h-[340px] w-full max-w-[430px] overflow-hidden rounded-3xl border-2 border-white/20 bg-gradient-to-b from-sky-400/55 via-emerald-400/35 to-emerald-700/45 shadow-2xl sm:h-[400px] lg:w-full">
              <Preview look={look} anim={anim} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 whitespace-nowrap rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold text-white/85 backdrop-blur">
                <Hand size={11} /> drag to spin
              </div>
              <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs font-bold text-white/85">
                {ready ? playerName : "Name your survivor"} · {lookChips.join(" · ")}
              </div>
            </div>

            {/* 🎬 animation showcase — try every move the survivor will play in-game */}
            <div
              className="flex w-full max-w-[430px] flex-wrap items-center justify-center gap-1.5 lg:w-full"
              role="toolbar"
              aria-label="Preview animations"
            >
              {ANIM_BUTTONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={anim === b.id}
                  onClick={() => { sfx.click(); setAnim(b.id); }}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black transition-all ${
                    anim === b.id
                      ? "bg-yellow-400 text-slate-950 shadow-lg shadow-yellow-400/30"
                      : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-center text-xs text-white/85 backdrop-blur">
              <Sparkles size={14} className="shrink-0 text-yellow-300" />
              {runsPlayed > 0
                ? `${runsPlayed} run${runsPlayed === 1 ? "" : "s"} played — night ${runsPlayed + 1} awaits, survivor!`
                : "100 souls · 7 nights · 1 winner takes the dawn"}
            </div>

            <div className="w-full max-w-[430px] lg:w-full">
              <Leaderboard compact />
            </div>

            <div className="w-full max-w-[430px] rounded-2xl border border-red-400/20 bg-black/45 p-4 text-xs leading-relaxed text-white/80 backdrop-blur-md lg:w-full">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-red-300">
                <Moon size={15} /> How the 7 Nights work
              </div>
              <ul className="space-y-1.5">
                <li>☀️ <b className="text-white">Day:</b> gather wood &amp; stone, build defenses</li>
                <li>⚠️ <b className="text-white">Dusk:</b> sirens — someone is chosen</li>
                <li>🌑 <b className="text-white">Night:</b> the beast hunts — hide, run or fight</li>
                <li>⚖️ <b className="text-white">Dawn:</b> inspect bodies, accuse your suspect</li>
              </ul>
              <p className="mt-2 text-white/60">Outlast all 7 nights — or be the last one standing. That&apos;s the only way home.</p>
            </div>
          </div>

          {/* -------- right: customization -------- */}
          <div className="flex w-full min-w-0 flex-col gap-4">
            <div className="rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-black text-white">
                  <Sparkles size={16} className="text-red-300" /> Wear a rigged hero
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm" variant="outline" aria-label="Randomize hero"
                    onClick={() => {
                      sfx.click();
                      // any of the catalog's rigged citizens (minus known-broken
                      // downloads) + a random size — the whole look is GLB-driven
                      const ok = ALL_GLB_CHARS.filter((c) => !glbCharFailed(c.slug));
                      const hero = ok[Math.floor(Math.random() * ok.length)].slug;
                      const ages = Object.keys(AGE_STATS) as AgeGroup[];
                      const age = ages[Math.floor(Math.random() * ages.length)];
                      applyLook({ ...randomAppearance(), age, char: hero });
                    }}
                    className="h-8 rounded-full border-white/25 bg-white/10 px-3 text-xs font-black text-white hover:bg-white/20"
                  >
                    <Dices size={14} className="mr-1" /> Random
                  </Button>
                  <Button
                    size="sm" variant="outline" aria-label="How to play"
                    onClick={() => { sfx.click(); setHelp(true); }}
                    className="h-8 w-8 rounded-full border-white/25 bg-white/10 p-0 text-white hover:bg-white/20"
                  >
                    <HelpCircle size={14} />
                  </Button>
                </div>
              </div>

              {/* name — compact single row */}
              <div className="mb-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wide text-white/70">Survivor name</span>
                  <button
                    aria-label="Suggest a random name"
                    onClick={() => {
                      sfx.click();
                      let n = playerName;
                      while (n === playerName) n = NAME_SUGGESTIONS[Math.floor(Math.random() * NAME_SUGGESTIONS.length)];
                      setName(n.slice(0, 16));
                    }}
                    className="flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-black text-white/85 hover:bg-white/20"
                  >
                    <Dices size={11} /> surprise me
                  </button>
                </div>
                <Input
                  value={playerName}
                  onChange={(e) => setName(e.target.value.slice(0, 16))}
                  placeholder="Type your name"
                  aria-label="Survivor name"
                  className="h-9 border-white/25 bg-white/10 text-white placeholder:text-white/40"
                  maxLength={16}
                />
              </div>

              {/* tabbed customization — GLB hero + body size + the item collection */}
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-white/10 p-1">
                  <TabsTrigger
                    value="hero"
                    className="rounded-lg border-0 py-1.5 text-xs font-black text-white/70 data-[state=active]:bg-yellow-300/90 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
                  >
                    <UserRound size={13} className="mr-1" /> Hero
                  </TabsTrigger>
                  <TabsTrigger
                    value="body"
                    className="rounded-lg border-0 py-1.5 text-xs font-black text-white/70 data-[state=active]:bg-yellow-300/90 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
                  >
                    <Baby size={13} className="mr-1" /> Body
                  </TabsTrigger>
                  <TabsTrigger
                    value="items"
                    className="rounded-lg border-0 py-1.5 text-xs font-black text-white/70 data-[state=active]:bg-yellow-300/90 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
                  >
                    <ShoppingBag size={13} className="mr-1" /> Items
                  </TabsTrigger>
                </TabsList>

                {/* HERO — the rigged GLB cast, worn as-is */}
                <TabsContent value="hero" className="mt-3 outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                    className="space-y-3"
                  >
                    <HeroPicker value={look.char || DEFAULT_HERO_SLUG} onChange={(char) => update({ char })} />
                  </motion.div>
                </TabsContent>

                {/* BODY — rescales the worn GLB + gameplay stats */}
                <TabsContent value="body" className="mt-3 outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                    className="space-y-3.5"
                  >
                    <AgeCards value={look.age} onChange={(age) => update({ age })} />
                    <div className="rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-white/70">
                      <b className="text-white">Size is gameplay:</b> the pick rescales your rigged hero on this
                      stage and in the town — Kids are tiny and hard to spot, Teens are the fastest sprinters,
                      Young adults are balanced, and Elders heal the quickest.
                    </div>
                  </motion.div>
                </TabsContent>

                {/* ITEMS — the collection: wallet + everything purchased from the shop */}
                <TabsContent value="items" className="mt-3 outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                    className="space-y-3"
                  >
                    <LockerItems />
                  </motion.div>
                </TabsContent>
              </Tabs>
            </div>

            {/* CTA — in-flow on desktop */}
            <Button
              size="lg"
              disabled={!ready || starting}
              onClick={() => { setStarting(true); onStart(); }}
              className="hidden h-14 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 text-lg font-black text-amber-950 shadow-[0_6px_0_rgba(180,120,0,0.6)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 lg:flex"
            >
              <Play size={20} className="mr-2" fill="currentColor" />
              {starting ? "Lighting the campfire…" : !ready ? "Pick a name to join" : `Join the 7 Nights, ${playerName}!`}
            </Button>
          </div>
        </div>

        <div className="hidden pb-2 text-center text-[11px] text-white/40 lg:block">
          Your survivor is saved on this device — no account needed.
        </div>
      </div>

      {/* CTA — sticky bottom bar on mobile so it's always reachable */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/15 bg-slate-950/85 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <Button
          size="lg"
          disabled={!ready || starting}
          onClick={() => { setStarting(true); onStart(); }}
          className="h-13 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 text-base font-black text-amber-950 shadow-[0_5px_0_rgba(180,120,0,0.6)] active:scale-95 disabled:opacity-50"
        >
          <Play size={18} className="mr-2" fill="currentColor" />
          {starting ? "Lighting the campfire…" : !ready ? "Pick a name to join" : `Join the 7 Nights, ${playerName}!`}
        </Button>
      </div>

      <HowToPlay open={help} onOpenChange={setHelp} />
    </div>
  );
}
