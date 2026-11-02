"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { motion } from "framer-motion";
import {
  Play, Trophy, Sparkles, ArrowLeft, Dices, HelpCircle, Check, Hand,
  Gauge, ChevronsUp, HeartPulse, Shirt, Palette, Baby,
} from "lucide-react";
// (icons kept minimal — Hand = drag hint)
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AGE_STATS, CAP_COLORS, HAIR_COLORS, HAIR_STYLES, NAME_SUGGESTIONS, OUTFIT_PRESETS, PANTS_COLORS, POLICE_COLORS, POLICE_OUTFITS, SHIRT_COLORS, SHOE_COLORS, SKIN_TONES,
  policeOutfitOf, randomAppearance,
  type AgeGroup, type Appearance, type HairStyle, type OutfitPreset, type PoliceOutfitDef,
} from "@/lib/game/constants";
import { buildCharacter, poseCharacter } from "@/lib/game/character";
import { sfx } from "@/lib/game/audio";
import { useGame, type ScoreRow } from "./store";
import { HowToPlay } from "./Panels";

/* ============================ 3D preview ============================ */
/* Drag to spin the hero; auto turntable resumes after you let go.     */

export function Preview({ look }: { look: Appearance }) {
  // the preview wears the REAL in-game gear — police squads show cap/helmet/beret/visor here too
  const mesh = useMemo(
    () => buildCharacter(look, { shadow: true, police: look.fac === "police" }),
    [look],
  );
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
      aria-label={`3D preview of your hero: ${look.girl ? "girl" : "boy"}, ${look.age}, ${look.hairStyle} hair`}
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
        <group ref={g}>
          <primitive object={mesh} />
        </group>
        <PreviewAnim mesh={mesh} g={g} spin={spin} drag={drag} />
      </Canvas>
    </div>
  );
}

function PreviewAnim({
  mesh, g, spin, drag,
}: {
  mesh: THREE.Object3D;
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
        // ease back to the nearest full turn (facing the camera) + friendly sway
        const front = Math.round(spin.current / (Math.PI * 2)) * Math.PI * 2;
        spin.current += (front - spin.current) * Math.min(1, dt * 2.2);
      }
    }
    if (g.current) {
      const sway = !d.on && d.idle > 1.0 ? Math.sin(t * 0.42) * 0.5 : 0;
      g.current.rotation.y = spin.current + sway;
      // a joyful little hop every few seconds to show off the animation
      const hopPhase = t % 4.2;
      const h = hopPhase > 3.4 ? Math.sin(((hopPhase - 3.4) / 0.8) * Math.PI) : 0;
      g.current.position.y = h * 0.55;
    }
    poseCharacter(mesh, 0, t, { airborne: t % 4.2 > 3.45 });
  });
  return null;
}

/* ============================ swatch helpers ============================ */

function Swatches({ colors, value, onChange, label }: { colors: string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">{label}</div>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button
            key={c}
            aria-label={`${label} ${c}`}
            aria-pressed={value === c}
            onClick={() => { sfx.click(); onChange(c); }}
            className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${value === c ? "scale-110 border-white ring-2 ring-yellow-300" : "border-white/30"}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

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
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Age & size</div>
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

function StylePicker({ value, onChange }: { value: HairStyle; onChange: (h: HairStyle) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Hair style</div>
      <div className="grid grid-cols-3 gap-2">
        {HAIR_STYLES.map((h) => (
          <button
            key={h.id}
            aria-pressed={value === h.id}
            onClick={() => { sfx.click(); onChange(h.id); }}
            className={`rounded-full border-2 px-2 py-1.5 text-xs font-bold transition-all hover:scale-105 ${
              value === h.id ? "border-yellow-300 bg-yellow-300/20 text-white shadow-[0_0_10px_rgba(253,224,71,0.3)]" : "border-white/20 bg-white/5 text-white/75"
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function matchesPreset(look: Appearance, p: OutfitPreset) {
  return (Object.entries(p.look) as [keyof Appearance, unknown][]).every(([k, v]) => look[k] === v);
}

/* ---------------- police squads — the hero outfits shown when Side = Police ---------------- */

function SquadPicker({ value, onPick }: { value: string; onPick: (o: PoliceOutfitDef) => void }) {
  const sel = policeOutfitOf(value);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-white/70">Police outfits</span>
        <span className="text-[10px] font-black uppercase tracking-wide text-sky-300">each squad has a perk</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {POLICE_OUTFITS.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => { sfx.click(); onPick(o); }}
              aria-pressed={on}
              className={`relative rounded-xl border-2 p-1.5 text-center transition-all hover:scale-105 ${
                on
                  ? "border-sky-300 bg-sky-300/15 shadow-[0_0_12px_rgba(125,211,252,0.4)]"
                  : "border-white/15 bg-white/5 hover:border-sky-300/50"
              }`}
            >
              {on && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-sky-300 text-sky-950 shadow">
                  <Check size={11} strokeWidth={3.5} />
                </span>
              )}
              <div className="text-lg">{o.emoji}</div>
              <div className="text-[10px] font-bold leading-tight text-white/85">{o.label}</div>
            </button>
          );
        })}
      </div>
      {/* selected squad — flavour + perk strip */}
      <motion.div
        key={sel.id}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
        className="mt-2 space-y-1.5 rounded-xl bg-sky-400/10 p-2.5 ring-1 ring-sky-300/25"
      >
        <div className="text-[11px] font-bold leading-snug text-white/85">
          {sel.emoji} <b className="text-white">{sel.label}</b> — {sel.tagline}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-black text-emerald-300">
            ⭐ {sel.perkLabel}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function PresetRow({ look, onPick }: { look: Appearance; onPick: (p: Partial<Appearance>) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Quick outfits</div>
      <div className="grid grid-cols-3 gap-2">
        {OUTFIT_PRESETS.map((p) => {
          const on = matchesPreset(look, p);
          return (
            <button
              key={p.id}
              onClick={() => { sfx.click(); onPick(p.look); }}
              aria-pressed={on}
              className={`relative rounded-xl border-2 p-1.5 text-center transition-all hover:scale-105 ${
                on
                  ? "border-yellow-300 bg-yellow-300/15 shadow-[0_0_12px_rgba(253,224,71,0.35)]"
                  : "border-white/15 bg-white/5 hover:border-yellow-300/50"
              }`}
            >
              {on && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-yellow-300 text-amber-950 shadow">
                  <Check size={11} strokeWidth={3.5} />
                </span>
              )}
              <div className="text-lg">{p.emoji}</div>
              <div className="text-[10px] font-bold leading-tight text-white/85">{p.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ leaderboard ============================ */
export function Leaderboard({ compact = false }: { compact?: boolean }) {
  const scores = useGame((s) => s.scores);
  return (
    <div className="rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-center gap-2 font-black text-yellow-300">
        <Trophy size={16} /> Hall of Fame
      </div>
      {scores.length === 0 ? (
        <div className="text-sm text-white/60">No runs yet — be the first legend!</div>
      ) : (
        <ScrollArea className={compact ? "h-36" : "h-48"}>
          <div className="pr-2">
            {scores.map((s: ScoreRow, i: number) => (
              <div key={s.id} className="flex items-center gap-2 border-b border-white/10 py-1.5 text-sm text-white last:border-0">
                <span className={`w-6 text-center font-black ${i === 0 ? "text-yellow-300" : i === 1 ? "text-slate-200" : i === 2 ? "text-amber-600" : "text-white/50"}`}>
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-bold">{s.name}</span>
                {s.won && <span title="Saved democracy">🏆</span>}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-black text-yellow-200">{s.points}</span>
                <span className="w-10 text-right text-xs text-white/50">{Math.round(s.timeMs / 1000)}s</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
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
  const [tab, setTab] = useState("outfit");

  useEffect(() => {
    const unlock = () => { sfx.click(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // random name chips (client only — safe, this tree is client-rendered)
  const nameChips = useMemo(
    () => [...NAME_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 6),
    [],
  );

  const update = (p: Partial<Appearance>) => setLook(p);
  const ready = playerName.trim().length > 0;

  const lookChips = [
    look.fac === "police" ? `${policeOutfitOf(look.outfit).emoji} ${policeOutfitOf(look.outfit).label}` : "🏃 Protester",
    look.girl ? "👧 Girl" : "👦 Boy",
    `${look.age.charAt(0).toUpperCase()}${look.age.slice(1)}`,
    HAIR_STYLES.find((h) => h.id === look.hairStyle)?.label ?? "",
    look.cap ? "🧢 Cap" : "",
    look.glasses ? "👓 Glasses" : "",
  ].filter(Boolean);

  return (
    <div className="relative min-h-screen w-full overflow-y-auto">
      {/* backdrop (fixed so it covers the viewport while the page scrolls) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-votechor.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/70 via-slate-900/55 to-slate-950/80" />

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
              Build your hero <span aria-hidden>{look.fac === "police" ? "🚓" : "🏃‍♀️💨"}</span>
            </h1>
            <p className="hidden text-xs font-bold text-emerald-300 sm:block">
              Pick a side, style it up — drag the stage to spin your hero!
            </p>
          </div>
        </header>

        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_460px]">
          {/* -------- left: preview + leaderboard -------- */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-[340px] w-full max-w-[430px] overflow-hidden rounded-3xl border-2 border-white/20 bg-gradient-to-b from-sky-400/55 via-emerald-400/35 to-emerald-700/45 shadow-2xl sm:h-[400px] lg:w-full">
              <Preview look={look} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 whitespace-nowrap rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold text-white/85 backdrop-blur">
                <Hand size={11} /> drag to spin
              </div>
              <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-xs font-bold text-white/85">
                {ready ? playerName : "Name your hero"} · {lookChips.join(" · ")}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-center text-xs text-white/85 backdrop-blur">
              <Sparkles size={14} className="shrink-0 text-yellow-300" />
              {runsPlayed > 0
                ? `${runsPlayed} run${runsPlayed === 1 ? "" : "s"} played — make hero #${runsPlayed + 1} even better!`
                : "Day-night city · zombies after dark · cute cows & cheeky monkeys"}
            </div>

            <div className="w-full max-w-[430px] lg:w-full">
              <Leaderboard compact />
            </div>

            <div className="w-full max-w-[430px] rounded-2xl border border-white/15 bg-black/40 p-4 text-xs leading-relaxed text-white/75 backdrop-blur-md lg:w-full">
              {look.fac === "police" ? (
                <>
                  <b className="text-white">Mission (Police):</b> vote-runners are smuggling 🗳 votes to Parliament!
                  Chase them down and <b>walk into (or drive into!) a runner to bust them</b> — police vans haul them to the
                  station cage. Bust <b>12 runners</b> before they deliver <b>10 votes</b>. Pick a squad outfit above — each
                  one grants a small perk! Eat food, grab super-power gems, collect a 🪪 license and patrol by car. 🚓
                </>
              ) : (
                <>
                  <b className="text-white">Mission:</b> walk into 🗳 votes to carry them (max 3), then deliver them at the big
                  glowing ballot box by Parliament. Police chase you when you carry votes — sprint away! Rescued friends give
                  points, chai restores energy, zombies only come out at night… and a 🪪 license card + parked car = getaway ride!
                </>
              )}
            </div>
          </div>

          {/* -------- right: customization -------- */}
          <div className="flex w-full flex-col gap-4">
            <div className="rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-black text-white">
                  <Sparkles size={16} className="text-emerald-300" /> Create your hero
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm" variant="outline" aria-label="Randomize appearance"
                    onClick={() => { sfx.click(); applyLook(randomAppearance()); }}
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

              {/* side — protester or police (the old-game "Side" row) */}
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Choose your side</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={look.fac === "protester"}
                    onClick={() => { sfx.click(); update({ fac: "protester", outfit: "", ...(look.shirt && POLICE_COLORS.includes(look.shirt) ? { shirt: SHIRT_COLORS[0], pants: PANTS_COLORS[0] } : {}) }); }}
                    className={`rounded-xl border-2 p-2.5 text-left transition-all ${
                      look.fac === "protester"
                        ? "border-yellow-300 bg-yellow-300/15 shadow-[0_0_0_1px_rgba(253,224,71,0.4)]"
                        : "border-white/15 bg-white/5 hover:border-white/35"
                    }`}
                  >
                    <div className="text-sm font-black text-white">🏃 Protester</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-white/65">Steal votes, dodge police, escape by car!</div>
                  </button>
                  <button
                    type="button"
                    aria-pressed={look.fac === "police"}
                    onClick={() => { sfx.click(); update({ fac: "police", ...POLICE_OUTFITS[0].look }); }}
                    className={`rounded-xl border-2 p-2.5 text-left transition-all ${
                      look.fac === "police"
                        ? "border-sky-300 bg-sky-300/15 shadow-[0_0_0_1px_rgba(125,211,252,0.4)]"
                        : "border-white/15 bg-white/5 hover:border-white/35"
                    }`}
                  >
                    <div className="text-sm font-black text-white">🚓 Police</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-white/65">Pick a squad outfit &amp; catch the vote runners!</div>
                  </button>
                </div>
              </div>

              {/* hero squads — the outfit suggestions appear the moment Police is picked */}
              {look.fac === "police" && (
                <div className="mb-4">
                  <SquadPicker value={look.outfit || "city"} onPick={(o) => update(o.look)} />
                </div>
              )}

              {/* name — always visible */}
              <div className="mb-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-white/70">Hero name</span>
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
                  placeholder="e.g. Chintu"
                  aria-label="Hero name"
                  className="border-white/25 bg-white/10 text-white placeholder:text-white/40"
                  maxLength={16}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {nameChips.map((n) => (
                    <button
                      key={n}
                      onClick={() => { sfx.click(); setName(n); }}
                      aria-pressed={playerName === n}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-all hover:scale-105 ${
                        playerName === n
                          ? "border-yellow-300 bg-yellow-300/20 text-yellow-100"
                          : "border-white/20 bg-white/5 text-white/70 hover:border-white/40"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* tabbed customization */}
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-white/10 p-1">
                  <TabsTrigger
                    value="outfit"
                    className="rounded-lg border-0 py-1.5 text-xs font-black text-white/70 data-[state=active]:bg-yellow-300/90 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
                  >
                    <Shirt size={13} className="mr-1" /> Outfit
                  </TabsTrigger>
                  <TabsTrigger
                    value="style"
                    className="rounded-lg border-0 py-1.5 text-xs font-black text-white/70 data-[state=active]:bg-yellow-300/90 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
                  >
                    <Palette size={13} className="mr-1" /> Style
                  </TabsTrigger>
                  <TabsTrigger
                    value="body"
                    className="rounded-lg border-0 py-1.5 text-xs font-black text-white/70 data-[state=active]:bg-yellow-300/90 data-[state=active]:text-amber-950 data-[state=active]:shadow-none"
                  >
                    <Baby size={13} className="mr-1" /> Body
                  </TabsTrigger>
                </TabsList>

                {/* OUTFIT */}
                <TabsContent value="outfit" className="mt-3 outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    {/* police officers pick a squad above — civilian quick outfits would clash with the uniform */}
                    {look.fac !== "police" && <PresetRow look={look} onPick={update} />}
                    <Swatches label="Skin" colors={SKIN_TONES} value={look.skin} onChange={(skin) => update({ skin })} />
                    <Swatches label={look.fac === "police" ? "Uniform" : "Shirt"} colors={look.fac === "police" ? POLICE_COLORS : SHIRT_COLORS} value={look.shirt} onChange={(shirt) => update({ shirt })} />
                    <Swatches label="Pants" colors={PANTS_COLORS} value={look.pants} onChange={(pants) => update({ pants })} />
                    <Swatches label="Shoes" colors={SHOE_COLORS} value={look.shoe} onChange={(shoe) => update({ shoe })} />
                    <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span className="text-sm font-bold text-white/85">👧 Girl character</span>
                      <Switch checked={look.girl} onCheckedChange={(girl) => { sfx.click(); update({ girl, hairStyle: girl && look.hairStyle === "bald" ? "ponytail" : look.hairStyle }); }} />
                    </div>
                  </motion.div>
                </TabsContent>

                {/* STYLE */}
                <TabsContent value="style" className="mt-3 outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    <Swatches label="Hair color" colors={HAIR_COLORS} value={look.hair} onChange={(hair) => update({ hair })} />
                    <StylePicker value={look.hairStyle} onChange={(hairStyle) => update({ hairStyle })} />
                    <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span className="text-sm font-bold text-white/85">🧢 Wear a cap</span>
                      <Switch checked={look.cap} onCheckedChange={(cap) => { sfx.click(); update({ cap }); }} />
                    </div>
                    {look.cap && (
                      <Swatches label="Cap color" colors={CAP_COLORS} value={look.capColor} onChange={(capColor) => update({ capColor })} />
                    )}
                    <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span className="text-sm font-bold text-white/85">👓 Glasses</span>
                      <Switch checked={look.glasses} onCheckedChange={(glasses) => { sfx.click(); update({ glasses }); }} />
                    </div>
                  </motion.div>
                </TabsContent>

                {/* BODY */}
                <TabsContent value="body" className="mt-3 outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                    className="space-y-4"
                  >
                    <AgeCards value={look.age} onChange={(age) => update({ age })} />
                    <div className="rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-white/70">
                      <b className="text-white">Every age plays differently:</b> Kids are tiny and hard to spot, Teens are
                      the fastest sprinters, Young adults are balanced, and Elders heal the quickest. Pick your style!
                    </div>
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
              {starting ? "Warming up…" : !ready ? "Pick a name to play" : look.fac === "police" ? `Start the shift, Officer ${playerName}!` : `Enter the City, ${playerName}!`}
            </Button>
          </div>
        </div>

        <div className="hidden pb-2 text-center text-[11px] text-white/40 lg:block">
          Your hero is saved on this device — no account needed.
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
          {starting ? "Warming up…" : !ready ? "Pick a name to play" : look.fac === "police" ? `Start the shift, Officer ${playerName}!` : `Enter the City, ${playerName}!`}
        </Button>
      </div>

      <HowToPlay open={help} onOpenChange={setHelp} />
    </div>
  );
}
