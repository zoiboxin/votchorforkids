"use client";

/**
 * 🛒 SHOP PAGE — the ITEM SHOP, PUBG-store style.
 *
 *   ┌───────────────┬──────────────────────────────┐
 *   │  ✨ PROMO ✨   banner (rotating fancy deals)  │
 *   ├───────────────┬──────────────────────────────┤
 *   │  BIG GLB      │ [category dropdown ▾]  owned │
 *   │  PREVIEW      ├──────────────────────────────┤
 *   │  (drag-spin,  │ [thumb][thumb][thumb][thumb] │
 *   │  idle anim)   │ [thumb][thumb][thumb][thumb] │
 *   │  name·price·  │ [thumb][thumb][thumb][thumb] │
 *   │  buy / wear   │      (scrollable grid)       │
 *   └───────────────┴──────────────────────────────┘
 *
 * Every tile previews the REAL GLB file: rigged shop-cast heroes use the same
 * offscreen portrait snap the creator's hero picker uses; shop-forged weapons
 * get their own snapped portrait (shopThumbs.ts); everything else wears a
 * per-kind gradient emoji tile. The left stage streams the actual model —
 * rigged heroes play their Idle clip and drag-spin on the podium; weapons
 * turntable on their own stage.
 *
 * Wiring: buys run through useGame.buyItem (wallet save slot), wears through
 * setLook — identical tone/toasts as before.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  outfitPreset, RPG_VAULT_ITEM_ID, SHOP_ITEMS, shopItem, type ShopItem, type ShopKind,
} from "@/lib/game/shop";
import {
  ensureGlbArea, glbCharDef, glbThumb, loadGlbTemplate, makeGlbInstance,
  MYTHIC_AREA_ID, MYTHIC_HEROES, SHOP_CAST_AREA_ID, useGlbThumbs,
  type GlbCharacterDef, type GlbInstance,
} from "@/lib/game/glbCharacters";
import { isWeaponKind, loadWeaponTemplate, makeWeaponInstance, type WeaponKind } from "@/lib/game/weapons";
import { ensureVehicleThumb, ensureWeaponThumb, useShopThumbs, vehicleThumb, weaponThumb } from "@/lib/game/shopThumbs";
import { loadVehicle, spawnVehicle, type VehicleKind } from "@/lib/game/glbVehicles";
import { poseCharacter } from "@/lib/game/character";
import { VEHICLE_GLB, randomAppearance, type Appearance } from "@/lib/game/constants";
import { sfx } from "@/lib/game/audio";
import { useGame } from "./store";

/* ============================ category dropdown ============================ */

type CatId = "style" | "vault" | "garage" | "gear" | "power" | "support" | "all";

const CATS: readonly { id: CatId; label: string; emoji: string }[] = [
  { id: "garage", label: "Vehicles", emoji: "🏍️" },
  { id: "style", label: "Style & Shop Cast", emoji: "👕" },
  { id: "vault", label: "Mythic Vault", emoji: "🐉" },
  { id: "gear", label: "Gear & Weapons", emoji: "⚔️" },
  { id: "power", label: "Powers", emoji: "✨" },
  { id: "support", label: "Support", emoji: "🎒" },
  { id: "all", label: "All Items", emoji: "🛒" },
];

/** what the left stage + grid tiles render for */
type Sel =
  | { t: "item"; item: ShopItem }
  | { t: "hero"; hero: GlbCharacterDef };

const selKey = (s: Sel): string => (s.t === "item" ? s.item.id : `hero:${s.hero.slug}`);

function buildEntries(cat: CatId, vaultOwned: boolean): Sel[] {
  /* vault owned → the whole hero roster is wearable right here */
  if (cat === "vault" && vaultOwned) {
    return MYTHIC_HEROES.map((hero): Sel => ({ t: "hero", hero }));
  }
  const items =
    cat === "all"
      ? SHOP_ITEMS
      : cat === "vault"
        ? SHOP_ITEMS.filter((it) => it.id === RPG_VAULT_ITEM_ID)
        : SHOP_ITEMS.filter((it) => it.kind === cat);
  return items.map((item): Sel => ({ t: "item", item }));
}

/* ============================ 3D stages ============================ */

/* soft shadow pool under the boots — module-level canvas singleton */
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

/** 🧍 rigged-hero stage — ONE canvas for the whole browsing session; the worn
 *  GLB swaps inside on selection, plays its embedded Idle clip and drag-spins
 *  on the podium (same poseCharacter router the game plays). */
function HeroStage({ slug }: { slug: string }) {
  const root = useMemo(() => new THREE.Group(), []);
  /* state is tagged with the slug it belongs to — a stale callback for an old
   * selection never paints over the new one, and switching selections derives
   * "loading" during render (no setState-in-effect cascades) */
  const [state, setState] = useState<{ slug: string; st: "loading" | "ok" | "failed" }>({ slug, st: "loading" });
  const shown = state.slug === slug ? state.st : "loading";

  useEffect(() => {
    let live = true;
    loadGlbTemplate(slug)
      .then(() => {
        if (!live) return;
        const prev = root.userData.glb as GlbInstance | undefined;
        if (prev) { prev.mixer.stopAllAction(); root.remove(prev.body); }
        const inst = makeGlbInstance(slug, 1);
        if (inst) { root.userData.glb = inst; root.add(inst.body); }
        setState({ slug, st: inst ? "ok" : "failed" });
      })
      .catch(() => { if (live) setState({ slug, st: "failed" }); });
    return () => { live = false; };
  }, [slug, root]);

  useEffect(() => () => {
    (root.userData.glb as GlbInstance | undefined)?.mixer.stopAllAction();
  }, [root]);

  const g = useRef<THREE.Group>(null!);
  const spin = useRef(0);
  const drag = useRef({ on: false, lastX: 0, idle: 99 });
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current.on = true; drag.current.lastX = e.clientX; drag.current.idle = 0;
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
      aria-label={`3D preview of ${glbCharDef(slug)?.name ?? "rigged hero"}`}
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
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <circleGeometry args={[1.7, 48]} />
          <meshBasicMaterial color="#0c3a2a" transparent opacity={0.22} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.035}>
          <ringGeometry args={[1.55, 1.7, 48]} />
          <meshBasicMaterial color="#fde047" transparent opacity={0.6} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.045}>
          <planeGeometry args={[1.5, 1.5]} />
          <meshBasicMaterial map={getPodiumShadow()} transparent depthWrite={false} />
        </mesh>
        <group ref={g}>
          <primitive object={root} />
        </group>
        <HeroTurntable root={root} g={g} spin={spin} drag={drag} />
      </Canvas>

      {shown !== "ok" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-slate-950/80 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/80 ring-1 ring-white/20 backdrop-blur">
            {shown === "failed" ? (
              <span className="text-red-300">hero stream failed</span>
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

function HeroTurntable({
  root, g, spin, drag,
}: {
  root: THREE.Object3D;
  g: React.RefObject<THREE.Group | null>;
  spin: { current: number };
  drag: { current: { on: boolean; lastX: number; idle: number } };
}) {
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const d = drag.current;
    if (!d.on) {
      d.idle += dt;
      if (d.idle > 1.0) {
        const front = Math.round(spin.current / (Math.PI * 2)) * Math.PI * 2;
        spin.current += (front - spin.current) * Math.min(1, dt * 2.2);
      }
    }
    if (g.current) {
      const sway = !d.on && d.idle > 1.0 ? Math.sin(t * 0.42) * 0.5 : 0;
      g.current.rotation.y = spin.current + sway;
    }
    poseCharacter(root, 0, t, {}); // the Idle clip — exactly what the game plays
  });
  return null;
}

/** ⚔️ weapon stage — the shop-forged GLB steel turntables under shop lights. */
function WeaponStage({ kind }: { kind: WeaponKind }) {
  const [inst, setInst] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let live = true;
    loadWeaponTemplate(kind)
      .then(() => { if (live) setInst(makeWeaponInstance(kind)); })
      .catch(() => { /* the emoji chip stays; never crash the shop */ });
    return () => { live = false; };
  }, [kind]);

  const fit = useMemo(() => {
    if (!inst) return null;
    const box = new THREE.Box3().setFromObject(inst);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    return { center, dist: Math.max(0.05, size.x, size.y, size.z) };
  }, [inst]);

  return (
    <div className="relative h-full w-full" role="img" aria-label="3D weapon preview">
      <Canvas camera={{ fov: 35, position: [0.9, 1.0, 2.6] }} dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 6]} intensity={1.1} color="#fff2d0" />
        <directionalLight position={[-5, 3, -4]} intensity={0.45} color="#ffd9a8" />
        <FitCamera fit={fit} />
        {/* the turntable rides INSIDE the canvas — useFrame is canvas-scoped */}
        {inst && <WeaponSpinner inst={inst} />}
      </Canvas>
      {!inst && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-slate-950/80 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/80 ring-1 ring-white/20 backdrop-blur">
            <Loader2 size={13} className="animate-spin text-yellow-300" /> polishing the steel…
          </div>
        </div>
      )}
    </div>
  );
}

function WeaponSpinner({ inst }: { inst: THREE.Group }) {
  const spin = useRef<THREE.Group>(null!);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.85; });
  return (
    <group ref={spin}>
      <primitive object={inst} />
    </group>
  );
}

/** 🏪 vehicle stage — the shop garage rides turntable on a wet-look asphalt
 *  podium. The real GLB streams in (loadVehicle → spawnVehicle), the camera
 *  frames the whole ride, and a slow spin shows every angle. */
function VehicleStage({ kind, name }: { kind: string; name: string }) {
  const [inst, setInst] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let live = true;
    loadVehicle(kind as VehicleKind)
      .then(() => { if (live) setInst(spawnVehicle(kind as VehicleKind)?.root ?? null); })
      .catch(() => { /* the emoji chip stays; never crash the shop */ });
    return () => { live = false; };
  }, [kind]);

  const fit = useMemo(() => {
    if (!inst) return null;
    const box = new THREE.Box3().setFromObject(inst);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    return { center, dist: Math.max(0.05, size.x, size.y, size.z) };
  }, [inst]);

  return (
    <div
      className="relative h-full w-full cursor-grab active:cursor-grabbing"
      role="img"
      aria-label={`3D preview of ${name}`}
    >
      <Canvas camera={{ fov: 35, position: [0.9, 1.0, 2.6] }} dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 6]} intensity={1.1} color="#fff2d0" />
        <directionalLight position={[-5, 3, -4]} intensity={0.45} color="#ffd9a8" />
        <directionalLight position={[0, -2, -6]} intensity={0.25} color="#7dd3fc" />
        <FitCamera fit={fit} />
        {/* asphalt pool + shop spotlight pool under the ride */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <circleGeometry args={[1, 64]} />
          <meshBasicMaterial color="#0c3a2a" transparent opacity={0.22} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.035}>
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} />
        </mesh>
        {inst && <WeaponSpinner inst={inst} />}
      </Canvas>
      {!inst && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-slate-950/80 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/80 ring-1 ring-white/20 backdrop-blur">
            <Loader2 size={13} className="animate-spin text-yellow-300" /> streaming your ride…
          </div>
        </div>
      )}
    </div>
  );
}

function FitCamera({ fit }: { fit: { center: THREE.Vector3; dist: number } | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!fit) return;
    const d = fit.dist * 1.75;
    camera.position.set(fit.center.x + d * 0.5, fit.center.y + d * 0.4, fit.center.z + d);
    camera.lookAt(fit.center.x, fit.center.y, fit.center.z);
  }, [camera, fit]);
  return null;
}

/** emoji stage — snacks, gems & the license get a floating showroom badge */
function EmojiStage({ item }: { item: ShopItem }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <motion.div
        animate={{ y: [0, -10, 0], rotate: [0, 1.6, -1.6, 0] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex h-44 w-44 items-center justify-center rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 58%, transparent 72%)",
        }}
      >
        <div aria-hidden className="absolute inset-0 rounded-full border-2 border-dashed border-white/25" />
        <div aria-hidden className="absolute inset-4 rounded-full border border-white/10" />
        <span className="text-[5.5rem] leading-none drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)]">{item.emoji}</span>
      </motion.div>
      <div aria-hidden className="absolute bottom-8 left-1/2 h-4 w-44 -translate-x-1/2 rounded-[100%] bg-black/50 blur-md" />
    </div>
  );
}

/* ============================ grid tiles ============================ */

const KIND_TILE: Record<ShopKind, string> = {
  gear: "from-orange-500/30 to-amber-300/10",
  power: "from-amber-400/30 to-yellow-200/10",
  support: "from-emerald-500/30 to-teal-300/10",
  style: "from-fuchsia-500/30 to-rose-300/10",
  garage: "from-cyan-500/30 to-sky-300/10",
};

/** portrait tile for a rigged cast hero (emoji stands in until it lands) */
function HeroTileArt({ slug, emoji }: { slug: string; emoji: string }) {
  useGlbThumbs();
  const t = glbThumb(slug);
  if (t) {
    return <img src={t} alt="" width={160} height={160} className="h-full w-full object-contain p-1" loading="lazy" />;
  }
  return <span aria-hidden className="text-4xl leading-none drop-shadow">{emoji}</span>;
}

function CharTileArt({ slug, emoji }: { slug: string; emoji: string }) {
  useGlbThumbs();
  // stream the file on demand — registerTemplate snaps the portrait for us
  useEffect(() => { void loadGlbTemplate(slug).catch(() => {}); }, [slug]);
  const t = glbThumb(slug);
  if (t) {
    return <img src={t} alt="" width={160} height={160} className="h-full w-full object-contain p-1" loading="lazy" />;
  }
  return <span aria-hidden className="text-4xl leading-none drop-shadow">{emoji}</span>;
}

/** portrait tile for shop-forged weapon steel */
function WeaponTileArt({ kind }: { kind: WeaponKind }) {
  useShopThumbs();
  useEffect(() => { ensureWeaponThumb(kind); }, [kind]);
  const t = weaponThumb(kind);
  if (t) {
    return <img src={t} alt="" width={160} height={160} className="h-full w-full object-contain p-1" loading="lazy" />;
  }
  return <Loader2 size={20} className="animate-spin text-white/40" />;
}

/** 🏪 portrait tile for a garage ride — the REAL vehicle GLB snapped in the
 *  offscreen thumb studio (same pipeline as the weapon steel). */
function VehicleTileArt({ kind, emoji }: { kind: string; emoji: string }) {
  useShopThumbs();
  useEffect(() => { ensureVehicleThumb(kind); }, [kind]);
  const t = vehicleThumb(kind);
  if (t) {
    return <img src={t} alt="" width={160} height={160} className="h-full w-full object-contain p-1" loading="lazy" />;
  }
  return <span aria-hidden className="text-4xl leading-none drop-shadow">{emoji}</span>;
}

function TileArt({ sel }: { sel: Sel }) {
  if (sel.t === "hero") return <HeroTileArt slug={sel.hero.slug} emoji={sel.hero.emoji} />;
  const it = sel.item;
  if (it.char) return <CharTileArt slug={it.char} emoji={it.emoji} />;
  if (isWeaponKind(it.tool ?? "")) return <WeaponTileArt kind={it.tool as WeaponKind} />;
  if (it.veh != null) return <VehicleTileArt kind={VEHICLE_GLB[it.veh] ?? ""} emoji={it.emoji} />;
  /* vault tile gets the legendary treatment, everything else a kind gradient */
  if (it.heroBundle) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-gradient-to-br from-violet-500/40 to-fuchsia-500/20">
        <span aria-hidden className="text-4xl leading-none drop-shadow-[0_0_14px_rgba(167,139,250,0.7)]">🐉</span>
        <span className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-200">legendary</span>
      </div>
    );
  }
  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${KIND_TILE[it.kind]}`}>
      <span aria-hidden className="text-4xl leading-none drop-shadow">{it.emoji}</span>
    </div>
  );
}

/* ============================ promo banner ============================ */

interface Promo {
  id: string;
  badge: string;
  title: string;
  sub: string;
  emoji: string;
  grad: string;       // tailwind gradient classes for the banner wash
  glow: string;       // css color for the floating emoji halo
  /** where the CTA takes you */
  goCat?: CatId;
  goItem?: string;
  fresh?: boolean;    // NEW! ping dot
}

const PROMOS: readonly Promo[] = [
  {
    id: "garage",
    badge: "FRESH DROP · 10 NEW VEHICLES",
    title: "THE GARAGE — 1 COIN PER TRIANGLE",
    sub: "Limo, GT3 racer, touring bike, tractors & pickups — every ride spawns parked beside you every run. Price = exact triangle count.",
    emoji: "🏍️",
    grad: "from-cyan-600/95 via-sky-600/85 to-indigo-600/80",
    glow: "rgba(56,189,248,0.5)",
    goCat: "garage",
    goItem: "veh-touring-motorcycle-3b1ad3",
    fresh: true,
  },
  {
    id: "cast",
    badge: "SHOP CAST · 18 CHARACTERS",
    title: "SHOP CAST — 1 COIN PER TRIANGLE",
    sub: "Santa, Zeus, Kid Witch & 15 more rigged heroes — every price is that hero's exact triangle count.",
    emoji: "🎭",
    grad: "from-orange-600/95 via-rose-600/85 to-fuchsia-600/80",
    glow: "rgba(251,113,133,0.5)",
    goCat: "style",
    goItem: "char-santa-base",
  },
  {
    id: "vault",
    badge: "LEGENDARY BUNDLE",
    title: "MYTHIC HERO VAULT",
    sub: "28 rigged RPG heroes — Dragonborn, Elves, Dwarves, Orcs & more. One key unlocks the whole vault.",
    emoji: "🐉",
    grad: "from-violet-600/95 via-purple-600/85 to-fuchsia-600/75",
    glow: "rgba(167,139,250,0.55)",
    goCat: "vault",
  },
  {
    id: "license",
    badge: "QUALITY OF LIFE",
    title: "VIP DRIVING LICENSE",
    sub: "Skip the 🪪 card hunt — start EVERY run already licensed to drive any parked car in town.",
    emoji: "🪪",
    grad: "from-emerald-600/95 via-teal-600/85 to-lime-500/75",
    glow: "rgba(52,211,153,0.5)",
    goItem: "perk-license",
  },
];

function PromoBanner({ onGo }: { onGo: (p: Promo) => void }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % PROMOS.length), 6000);
    return () => clearInterval(t);
  }, []);
  const p = PROMOS[idx];

  return (
    <section aria-label="Featured deals" className="relative overflow-hidden rounded-2xl border border-white/20 shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={p.id}
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -60 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={`relative bg-gradient-to-r ${p.grad} px-4 py-4 sm:px-6`}
        >
          {/* shimmer sweep */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            animate={{ x: ["-140%", "420%"] }}
            transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
          />
          {/* floating sparkles */}
          {["8%", "26%", "55%", "78%", "92%"].map((left, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="pointer-events-none absolute top-2 text-sm opacity-70"
              style={{ left, color: p.glow }}
              animate={{ y: [0, -9, 0], rotate: [0, 14, -8, 0], opacity: [0.4, 0.9, 0.4] }}
              transition={{ duration: 2.4 + i * 0.5, repeat: Infinity, ease: "easeInOut" }}
            >
              ✦
            </motion.span>
          ))}

          <div className="relative flex items-center gap-4">
            <motion.div
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-black/25 text-4xl ring-2 ring-white/30 sm:h-20 sm:w-20 sm:text-5xl"
              animate={{ y: [0, -6, 0], rotate: [0, 3, -3, 0] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
              style={{ boxShadow: `0 0 28px ${p.glow}` }}
            >
              {p.emoji}
            </motion.div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/90 ring-1 ring-white/25">
                  {p.badge}
                </span>
                {p.fresh && (
                  <span className="flex items-center gap-1.5 rounded-full bg-yellow-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-slate-950">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-600 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-600" />
                    </span>
                    new
                  </span>
                )}
              </div>
              <h2 className="mt-1 truncate text-lg font-black uppercase tracking-wide text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.35)] sm:text-xl">
                {p.title}
              </h2>
              <p className="mt-0.5 line-clamp-2 text-[11px] font-bold leading-snug text-white/85 sm:text-xs">{p.sub}</p>
            </div>
            <Button
              onClick={() => onGo(p)}
              className="shrink-0 rounded-lg bg-black/45 px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wider text-white ring-1 ring-white/35 backdrop-blur hover:bg-black/65"
              aria-label={`${p.title} — view in shop`}
            >
              <Sparkles size={13} className="mr-1.5" /> view
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* slide dots */}
      <div className="absolute bottom-1.5 right-3 flex gap-1.5">
        {PROMOS.map((pp, i) => (
          <button
            key={pp.id}
            aria-label={`Show promo ${i + 1}: ${pp.title}`}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/45 hover:bg-white/70"}`}
          />
        ))}
      </div>
    </section>
  );
}

/* ============================ the page ============================ */

export function ShopPage() {
  const setScreen = useGame((s) => s.setScreen);
  const coins = useGame((s) => s.coins);
  const owned = useGame((s) => s.owned);
  const buyItem = useGame((s) => s.buyItem);
  const look = useGame((s) => s.look);
  const setLook = useGame((s) => s.setLook);
  const pushToast = useGame((s) => s.pushToast);

  const vault = shopItem(RPG_VAULT_ITEM_ID);
  const vaultOwned = !!vault && owned.includes(vault.id);

  const [cat, setCat] = useState<CatId>("garage");
  const [selKeyState, setSelKey] = useState<string>("veh-touring-motorcycle-3b1ad3");

  const entries = useMemo(() => buildEntries(cat, vaultOwned), [cat, vaultOwned]);
  /* the selected key may fall out of a category when the dropdown changes —
   * derived fallback to the first tile instead of a setState-in-effect */
  const sel = entries.find((e) => selKey(e) === selKeyState) ?? entries[0] ?? null;
  const activeKey = sel ? selKey(sel) : "";

  /* 🎭 stream the 18-hero shop cast as soon as the shop opens — portraits
   * snap themselves as each GLB lands (same pipeline as the creator picker) */
  useEffect(() => { ensureGlbArea(SHOP_CAST_AREA_ID); }, []);
  /* 🐉 vault owners get the full hero roster streamed for the vault tab */
  useEffect(() => {
    if (cat === "vault" && vaultOwned) ensureGlbArea(MYTHIC_AREA_ID);
  }, [cat, vaultOwned]);

  /* 🛒 buy with the wallet's banked cash — same tone/toasts as the lobby shop */
  const buy = (it: ShopItem) => {
    sfx.click();
    if (owned.includes(it.id)) return;
    if (buyItem(it.id)) {
      sfx.pickup();
      pushToast(
        it.kind === "garage"
          ? `${it.emoji} ${it.name} purchased — it spawns parked beside you every run (🪪 license + E to drive)!`
          : it.kind === "style"
            ? `${it.emoji} ${it.name} purchased — wear it from the shop or the locker!`
            : `${it.emoji} ${it.name} purchased — it spawns with you every run (🎒 wheel: G / right-click)!`,
        "good",
      );
    } else {
      pushToast(`Not enough cash — ${it.name} costs $${it.price}. Roam the town & bank more 💰!`, "bad");
    }
  };

  /** 👕 wear a purchased style (preset paint or rigged cast hero) */
  const wear = (it: ShopItem) => {
    const p = outfitPreset(it.presetId);
    if (p) {
      sfx.pickup();
      setLook(p.look);
      return;
    }
    if (it.char) {
      const hero = glbCharDef(it.char);
      sfx.pickup();
      setLook({ char: it.char });
      pushToast(`${hero?.emoji ?? it.emoji} Wearing ${hero?.name ?? it.name} — looking sharp!`, "good");
    }
  };

  const wearHero = (hero: GlbCharacterDef) => {
    sfx.pickup();
    setLook({ char: hero.slug });
    pushToast(`${hero.emoji} Wearing ${hero.name} — looking legendary!`, "good");
  };

  /** worn state for style items — preset match or the char slug does */
  const isWornItem = (it: ShopItem): boolean => {
    if (it.kind !== "style") return false;
    if (it.char) return look.char === it.char;
    const p = outfitPreset(it.presetId);
    return !!p && (Object.entries(p.look) as [keyof Appearance, unknown][]).every(([k, v]) => look[k] === v);
  };

  /* owned counter across the current category (heroes count as owned rows) */
  const ownCount = entries.reduce(
    (n, e) => n + (e.t === "hero" ? 1 : owned.includes(e.item.id) ? 1 : 0),
    0,
  );

  /* ---- left stage: the selected entry's real model ---- */
  const baseLook = useMemo(() => randomAppearance(), []);
  let stage: React.ReactNode = null;
  if (sel) {
    if (sel.t === "hero") {
      stage = <HeroStage slug={sel.hero.slug} />;
    } else if (sel.item.char) {
      stage = <HeroStage slug={sel.item.char} />;
    } else if (isWeaponKind(sel.item.tool ?? "")) {
      stage = <WeaponStage kind={sel.item.tool as WeaponKind} />;
    } else if (sel.item.veh != null) {
      stage = <VehicleStage kind={VEHICLE_GLB[sel.item.veh] ?? ""} name={sel.item.name} />;
    } else {
      stage = <EmojiStage item={sel.item} />;
    }
  }

  /* selected-entry meta for the info panel */
  const selItem = sel?.t === "item" ? sel.item : null;
  const selHero = sel?.t === "hero" ? sel.hero : null;
  const selOwned = selItem ? owned.includes(selItem.id) : true;
  const selAfford = selItem ? coins >= selItem.price : true;
  const selWorn = selItem ? isWornItem(selItem) : selHero ? look.char === selHero.slug : false;
  const selName = selItem ? selItem.name : selHero?.name ?? "";
  const selEmoji = selItem ? selItem.emoji : selHero?.emoji ?? "";
  const selTip = selItem
    ? selItem.tip
    : "Rigged RPG hero — included with the Mythic Hero Vault. Wear it from here or the Locker.";

  return (
    <div className="relative h-screen w-full overflow-y-auto overflow-x-hidden">
      {/* backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-lobby-night.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/65 to-slate-950/90" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 pb-28 lg:pb-8">
        {/* ---------- header: back · title · wallet ---------- */}
        <header className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm" onClick={() => { sfx.click(); setScreen("landing"); }}
            className="rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur hover:bg-black/50"
          >
            <ArrowLeft size={15} className="mr-1" /> Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)] sm:text-3xl">
              ITEM SHOP <span aria-hidden>🛒</span>
            </h1>
            <p className="hidden text-xs font-bold text-orange-300 sm:block">
              Spend the cash you banked in town — every purchase spawns with you, every run.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              title="Collected cash — banked from roaming the town. Spend it here!"
              className="flex items-center gap-1.5 rounded-[3px] border border-yellow-300/40 bg-yellow-400/15 px-2.5 py-1.5 backdrop-blur"
            >
              <span aria-hidden className="text-[13px] leading-none">💰</span>
              <span className="text-xs font-black tabular-nums text-yellow-300">${coins.toLocaleString()}</span>
              <span className="hidden text-[9px] font-bold uppercase text-yellow-200/70 sm:inline">CASH</span>
            </div>
            <div
              title="Purchases owned — they spawn with you every run"
              className="hidden items-center gap-1.5 rounded-[3px] border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1.5 backdrop-blur sm:flex"
            >
              <Check size={13} strokeWidth={3.5} className="text-emerald-300" />
              <span className="text-xs font-black tabular-nums text-emerald-200">{owned.length}</span>
              <span className="hidden text-[9px] font-bold uppercase text-emerald-200/70 md:inline">OWNED</span>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-4">
          {/* ---------- ✨ rotating promo banner ---------- */}
          <PromoBanner
            onGo={(p) => {
              sfx.click();
              if (p.goCat) setCat(p.goCat);
              if (p.goItem) {
                const it = shopItem(p.goItem);
                if (it) {
                  setCat(it.kind === "style" && it.id !== RPG_VAULT_ITEM_ID ? "style"
                    : it.kind === "garage" ? "garage"
                    : cat === "all" ? cat : (it.kind as CatId));
                  setSelKey(it.id);
                }
              }
            }}
          />

          {/* ---------- slim intro banner ---------- */}
          <div className="rounded-xl border border-yellow-300/25 bg-yellow-400/10 px-3.5 py-2 text-[11px] font-bold leading-snug text-yellow-100 backdrop-blur">
            💰 Roam the town &amp; bank cash piles, purses and zombie hoards — every dollar funds this shop.
            Purchased gear spawns with you <b className="text-white">EVERY run</b>: press{" "}
            <b className="text-white">G</b> (or right-click) to open the 🎒 wheel and use it.
          </div>

          {/* ---------- store body: big preview left · dropdown + thumbs right ---------- */}
          <div className="flex flex-col gap-4 lg:flex-row">
            {/* ===== left: the big GLB preview stage ===== */}
            <section
              aria-label="Selected item preview"
              className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55 backdrop-blur lg:w-[400px]"
            >
              <div className="relative h-[340px] w-full sm:h-[400px] lg:h-[440px]">
                {/* stage floor glow */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
                  style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(253,224,71,0.10), transparent 62%)" }}
                />
                {stage}
              </div>

              {/* info + actions */}
              <div className="border-t border-white/10 bg-black/35 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-1.5 truncate text-base font-black leading-tight text-white">
                      <span aria-hidden>{selEmoji}</span> {selName || "Pick an item"}
                    </h2>
                    {selHero && (
                      <span className="mt-0.5 inline-block rounded-full bg-violet-400/25 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-200">
                        vault hero
                      </span>
                    )}
                  </div>
                  {selItem && selOwned ? (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-200">
                      <Check size={11} strokeWidth={3.5} /> owned
                    </span>
                  ) : selItem ? (
                    <span className={`shrink-0 text-base font-black tabular-nums ${selAfford ? "text-yellow-300" : "text-rose-300/80"}`}>
                      ${selItem.price.toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 line-clamp-3 min-h-[2.6rem] text-[11px] font-semibold leading-snug text-white/60">{selTip}</p>

                <div className="mt-3 flex items-center justify-end gap-2">
                  {selHero ? (
                    <button
                      onClick={() => wearHero(selHero)}
                      aria-pressed={selWorn}
                      aria-label={selWorn ? `${selHero.name} — currently wearing it` : `Wear ${selHero.name}`}
                      className={`rounded-md px-4 py-2 text-[10px] font-black uppercase transition-colors ${
                        selWorn ? "bg-yellow-300/25 text-yellow-200" : "bg-yellow-400 text-slate-950 hover:bg-yellow-300"
                      }`}
                    >
                      {selWorn ? "✓ wearing" : "wear"}
                    </button>
                  ) : selItem && selItem.kind === "style" && selOwned && (selItem.char || selItem.presetId) ? (
                    <button
                      onClick={() => wear(selItem)}
                      aria-pressed={selWorn}
                      aria-label={selWorn ? `${selItem.name} — currently wearing it` : `Wear ${selItem.name}`}
                      className={`rounded-md px-4 py-2 text-[10px] font-black uppercase transition-colors ${
                        selWorn ? "bg-yellow-300/25 text-yellow-200" : "bg-yellow-400 text-slate-950 hover:bg-yellow-300"
                      }`}
                    >
                      {selWorn ? "✓ wearing" : "wear"}
                    </button>
                  ) : selItem && selOwned ? (
                    <div className="rounded-md border border-emerald-300/30 px-2.5 py-2 text-center text-[9px] font-black uppercase leading-tight text-emerald-200/80">
                      in every run
                    </div>
                  ) : selItem ? (
                    <button
                      onClick={() => buy(selItem)}
                      disabled={!selAfford}
                      aria-label={selAfford ? `Buy ${selItem.name} for $${selItem.price}` : `Not enough cash — ${selItem.name} costs $${selItem.price}`}
                      title={selAfford ? `Buy ${selItem.name} for $${selItem.price}` : `Not enough cash — ${selItem.name} costs $${selItem.price}`}
                      className={`rounded-md px-4 py-2 text-[10px] font-black uppercase transition-colors ${
                        selAfford
                          ? "bg-orange-600 text-white shadow-[0_0_16px_rgba(234,88,12,0.45)] hover:bg-orange-500"
                          : "cursor-not-allowed bg-white/10 text-white/45"
                      }`}
                    >
                      {selAfford ? "buy" : "no cash"}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {/* ===== right: category dropdown + thumb grid ===== */}
            <section aria-label="Item catalog" className="flex min-w-0 flex-1 flex-col">
              <div className="mb-3 flex items-center gap-3">
                <Select value={cat} onValueChange={(v) => { sfx.click(); setCat(v as CatId); }}>
                  <SelectTrigger
                    aria-label="Shop category"
                    className="w-[240px] rounded-lg border-white/20 bg-black/50 text-sm font-black text-white backdrop-blur hover:bg-black/70"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg border-white/20 bg-slate-950/95 text-white">
                    {CATS.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="font-bold focus:bg-white/10 focus:text-white">
                        <span aria-hidden className="mr-1.5">{c.emoji}</span> {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[10px] font-black uppercase tracking-wider text-white/45">
                  {ownCount}/{entries.length} owned
                </span>
                <span className="ml-auto hidden text-[10px] font-bold italic text-white/35 sm:block">
                  tap a tile to preview the real GLB
                </span>
              </div>

              <div className="grid max-h-[430px] grid-cols-3 gap-2.5 overflow-y-auto pr-1 [scrollbar-width:thin] sm:grid-cols-4 xl:grid-cols-5 lg:max-h-[560px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
                {entries.length === 0 && (
                  <p className="col-span-full py-10 text-center text-xs font-bold text-white/50">
                    Nothing here yet — buy the Mythic Vault to fill this tab! 🐉
                  </p>
                )}
                {entries.map((e) => {
                  const key = selKey(e);
                  const selected = key === activeKey;
                  if (e.t === "hero") {
                    const worn = look.char === e.hero.slug;
                    return (
                      <motion.button
                        key={key}
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.16 }}
                        onClick={() => { sfx.click(); setSelKey(key); }}
                        aria-pressed={selected}
                        aria-label={`Preview ${e.hero.name} (included with the Mythic Vault)`}
                        className={`group flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all ${
                          selected
                            ? "border-yellow-300 bg-yellow-400/10 shadow-[0_0_16px_rgba(253,224,71,0.35)]"
                            : "border-white/12 bg-slate-900/60 hover:border-white/35 hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-violet-500/25 to-fuchsia-500/10">
                          <TileArt sel={e} />
                          {worn && (
                            <span className="absolute bottom-1 left-1 rounded bg-yellow-400 px-1.5 py-0.5 text-[8px] font-black uppercase text-slate-950">
                              wearing
                            </span>
                          )}
                        </div>
                        <div className="truncate px-1.5 py-1 text-[10px] font-black text-white/85">{e.hero.name}</div>
                      </motion.button>
                    );
                  }
                  const it = e.item;
                  const has = owned.includes(it.id);
                  const afford = coins >= it.price;
                  const worn = isWornItem(it);
                  return (
                    <motion.button
                      key={key}
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.16 }}
                      onClick={() => { sfx.click(); setSelKey(key); }}
                      aria-pressed={selected}
                      aria-label={`Preview ${it.name}${has ? " (owned)" : ` — $${it.price}`}`}
                      className={`group flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all ${
                        selected
                          ? "border-yellow-300 bg-yellow-400/10 shadow-[0_0_16px_rgba(253,224,71,0.35)]"
                          : "border-white/12 bg-slate-900/60 hover:border-white/35 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className={`relative aspect-square w-full overflow-hidden ${has ? "bg-emerald-950/45" : ""}`}>
                        <TileArt sel={e} />
                        {has ? (
                          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]">
                            <Check size={12} strokeWidth={4} className="text-white" />
                          </span>
                        ) : (
                          <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-black tabular-nums text-yellow-300 ring-1 ring-yellow-300/40">
                            ${it.price.toLocaleString()}
                          </span>
                        )}
                        {worn && (
                          <span className="absolute bottom-1 left-1 rounded bg-yellow-400 px-1.5 py-0.5 text-[8px] font-black uppercase text-slate-950">
                            wearing
                          </span>
                        )}
                      </div>
                      <div className="truncate px-1.5 py-1 text-[10px] font-black text-white/85">{it.name}</div>
                    </motion.button>
                  );
                })}
              </div>

              <p className="mt-2 px-1 text-[10px] font-bold text-white/40">
                Prices for Shop Cast heroes are 1 coin per triangle — the exact triangle count on each
                polyfork.dev catalog page.
              </p>
            </section>
          </div>

          {/* ---------- footer pointer ---------- */}
          <p className="px-1 text-[11px] font-bold text-white/45">
            Your full collection lives in the LOCKER — Items tab shows every purchase.
          </p>
        </main>
      </div>
    </div>
  );
}
