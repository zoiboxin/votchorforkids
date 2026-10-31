"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Play, Trophy, Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AGE_STATS, HAIR_COLORS, HAIR_STYLES, PANTS_COLORS, SHIRT_COLORS, SHOE_COLORS, SKIN_TONES,
  type AgeGroup, type Appearance, type HairStyle,
} from "@/lib/game/constants";
import { buildCharacter, poseCharacter } from "@/lib/game/character";
import { primeAudio, sfx, startMusic } from "@/lib/game/audio";
import { useGame, type ScoreRow } from "./store";

/* --------------------- 3D preview --------------------- */
function Preview({ look }: { look: Appearance }) {
  const mesh = useMemo(() => buildCharacter(look, { shadow: true }), [look]);
  const g = useRef<THREE.Group>(null!);
  return (
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
      <group ref={g}>
        <primitive object={mesh} />
      </group>
      <PreviewAnim mesh={mesh} g={g} />
    </Canvas>
  );
}
function PreviewAnim({ mesh, g }: { mesh: THREE.Object3D; g: React.RefObject<THREE.Group | null> }) {
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (g.current) {
      g.current.rotation.y = Math.sin(t * 0.42) * 0.6; // sway, always roughly facing you
      // a joyful little hop every few seconds to show off the animation
      const hopPhase = t % 4.2;
      const h = hopPhase > 3.4 ? Math.sin(((hopPhase - 3.4) / 0.8) * Math.PI) : 0;
      g.current.position.y = h * 0.55;
      poseCharacter(mesh, 0, t, { airborne: h > 0.05 });
    } else {
      poseCharacter(mesh, 0, t);
    }
  });
  return null;
}

/* --------------------- swatch helpers --------------------- */
function Swatches({ colors, value, onChange, label }: { colors: string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">{label}</div>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button
            key={c}
            aria-label={`${label} ${c}`}
            onClick={() => { sfx.click(); onChange(c); }}
            className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${value === c ? "border-white ring-2 ring-yellow-300 scale-110" : "border-white/30"}`}
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
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Age & size</div>
      <div className="grid grid-cols-4 gap-2">
        {ages.map((a) => (
          <button
            key={a.id}
            onClick={() => { sfx.click(); onChange(a.id); }}
            className={`rounded-xl border-2 p-2 text-center transition-all hover:scale-105 ${
              value === a.id ? "border-yellow-300 bg-yellow-300/20" : "border-white/20 bg-white/5"
            }`}
          >
            <div className="text-xl">{a.emoji}</div>
            <div className="text-[10px] font-bold capitalize text-white/85">{a.id}</div>
          </button>
        ))}
      </div>
      <div className="mt-1 text-[11px] text-emerald-300">{AGE_STATS[value].label}</div>
    </div>
  );
}

function StylePicker({ value, onChange }: { value: HairStyle; onChange: (h: HairStyle) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Hair style</div>
      <div className="flex flex-wrap gap-2">
        {HAIR_STYLES.map((h) => (
          <button
            key={h.id}
            onClick={() => { sfx.click(); onChange(h.id); }}
            className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition-all hover:scale-105 ${
              value === h.id ? "border-yellow-300 bg-yellow-300/20 text-white" : "border-white/20 bg-white/5 text-white/75"
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------- leaderboard --------------------- */
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
            {scores.map((s, i) => (
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

/* --------------------- creator --------------------- */
export function Creator({ onStart }: { onStart: () => void }) {
  const look = useGame((s) => s.look);
  const setLook = useGame((s) => s.setLook);
  const playerName = useGame((s) => s.playerName);
  const setName = useGame((s) => s.setName);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch("/api/scores").then((r) => r.json()).then((d) => useGame.getState().setScores(d.scores ?? [])).catch(() => {});
    const unlock = () => { primeAudio(); startMusic(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const update = (p: Partial<Appearance>) => setLook(p);
  const ready = playerName.trim().length > 0;

  return (
    <div className="relative min-h-screen w-full overflow-y-auto">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-votechor.png)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-900/55 to-slate-950/80" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row lg:items-stretch">
        {/* left: title + preview */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tight text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.45)] sm:text-6xl">
              Vote<span className="text-yellow-300">Chor!</span>
            </h1>
            <p className="mt-1 text-lg font-bold text-emerald-300">The Great Parliament Run 🏃‍♀️💨</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/80">
              Sneak through the city, snatch the missing <b className="text-yellow-300">16 votes</b> and deliver them to the
              Parliament ballot box — before the cartoon police catch you!
            </p>
          </div>
          <div className="relative h-[340px] w-[300px] overflow-hidden rounded-3xl border-2 border-white/20 bg-gradient-to-b from-sky-400/40 to-emerald-500/30 shadow-2xl sm:h-[400px] sm:w-[340px]">
            <Preview look={look} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute bottom-2 left-0 right-0 text-center text-xs font-bold text-white/80">
              {ready ? playerName : "Name your hero below"} · {look.girl ? "👧" : "👦"} {look.age}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs text-white/85 backdrop-blur">
            <Sparkles size={14} className="text-yellow-300" />
            Day-night city · zombies after dark · cute cows & cheeky monkeys
          </div>
        </div>

        {/* right: customization */}
        <div className="flex w-full flex-col gap-4 lg:w-[420px]">
          <div className="rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center gap-2 font-black text-white">
              <Info size={16} className="text-emerald-300" /> Create your hero
            </div>
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-white/70">Name</div>
                <Input
                  value={playerName}
                  onChange={(e) => setName(e.target.value.slice(0, 16))}
                  placeholder="e.g. Chintu"
                  className="border-white/25 bg-white/10 text-white placeholder:text-white/40"
                  maxLength={16}
                />
              </div>
              <AgeCards value={look.age} onChange={(age) => update({ age })} />
              <Swatches label="Skin" colors={SKIN_TONES} value={look.skin} onChange={(skin) => update({ skin })} />
              <Swatches label="Shirt" colors={SHIRT_COLORS} value={look.shirt} onChange={(shirt) => update({ shirt })} />
              <Swatches label="Pants" colors={PANTS_COLORS} value={look.pants} onChange={(pants) => update({ pants })} />
              <Swatches label="Shoes" colors={SHOE_COLORS} value={look.shoe} onChange={(shoe) => update({ shoe })} />
              <Swatches label="Hair" colors={HAIR_COLORS} value={look.hair} onChange={(hair) => update({ hair })} />
              <StylePicker value={look.hairStyle} onChange={(hairStyle) => update({ hairStyle })} />
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span className="text-sm font-bold text-white/85">👧 Girl character</span>
                <Switch checked={look.girl} onCheckedChange={(girl) => { sfx.click(); update({ girl, hairStyle: girl && look.hairStyle === "bald" ? "ponytail" : look.hairStyle }); }} />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span className="text-sm font-bold text-white/85">🧢 Wear a cap</span>
                <Switch checked={look.cap} onCheckedChange={(cap) => { sfx.click(); update({ cap }); }} />
              </div>
            </div>
          </div>

          <Button
            size="lg"
            disabled={!ready || starting}
            onClick={() => { setStarting(true); onStart(); }}
            className="h-14 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 text-lg font-black text-amber-950 shadow-[0_6px_0_rgba(180,120,0,0.6)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
          >
            <Play size={20} className="mr-2" fill="currentColor" />
            {starting ? "Warming up…" : ready ? "Enter the City!" : "Pick a name first"}
          </Button>

          <Leaderboard />

          <div className="rounded-2xl border border-white/15 bg-black/40 p-4 text-xs leading-relaxed text-white/75 backdrop-blur-md">
            <b className="text-white">How to play:</b> walk into 🗳 votes to carry them (max 3), then deliver them at the big
            glowing ballot box by Parliament. Police chase you when you carry votes — sprint away! Rescued friends give
            points, chai restores energy, and zombies only come out at night…
          </div>
          <div className="pb-4 text-center text-[11px] text-white/40">
            Rebuilt with Next.js 16 · React Three Fiber · TypeScript
          </div>
        </div>
      </div>
    </div>
  );
}
