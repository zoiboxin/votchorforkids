"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, BadgeCheck, Dices, Play, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BUST_TARGET, NAME_SUGGESTIONS, POLICE_OUTFITS, normalizeAppearance, policeOutfitOf, type Appearance } from "@/lib/game/constants";
import { sfx } from "@/lib/game/audio";
import { useGame } from "./store";
import { Preview } from "./Creator";

/** Screen 2 of the hero flow (Police side) — pick your squad:
    City Police, Traffic, Commando/SWAT, Army, Riot Squad, Detective/CID.
    Every squad wears real 3D gear in-game and carries a kid-friendly perk. */
export function HeroOutfits({ onPlay }: { onPlay: () => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const look = useGame((s) => s.look);
  const applyLook = useGame((s) => s.applyLook);
  const setName = useGame((s) => s.setName);
  const savedName = useGame((s) => s.playerName);
  const [outfitId, setOutfitId] = useState<string>(() => {
    const saved = useGame.getState().look.outfit;
    return POLICE_OUTFITS.some((o) => o.id === saved) ? saved : POLICE_OUTFITS[0].id;
  });
  const [name, setNameLocal] = useState(savedName);

  const outfit = policeOutfitOf(outfitId);
  // the uniform paints over the hero's saved colours — skin/hair stay personal.
  // fac:"police" + outfit id switch on the real 3D squad gear (helmet, beret,
  // hi-viz band, plate carrier, visor, trench coat) in the preview and in-game.
  const uniformLook: Appearance = useMemo(
    () => ({ ...normalizeAppearance(look), ...outfit.look, fac: "police", outfit: outfit.id }),
    [look, outfit],
  );

  const rollName = () => {
    sfx.click();
    setNameLocal(NAME_SUGGESTIONS[Math.floor(Math.random() * NAME_SUGGESTIONS.length)]);
  };

  const start = () => {
    sfx.click();
    const finalName = name.trim() || `Officer ${NAME_SUGGESTIONS[Math.floor(Math.random() * NAME_SUGGESTIONS.length)]}`;
    applyLook(uniformLook); // paint the uniform onto the saved hero so the city sees it
    if (finalName !== savedName) setName(finalName);
    onPlay();
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-y-auto bg-slate-950">
      {/* backdrop */}
      <div aria-hidden className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,#1e3a5f_0%,#0b1220_55%,#05070d_100%)]" />
      <div aria-hidden className="pointer-events-none fixed inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0 2px,transparent 2px 22px)" }} />

      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <header className="pt-2 text-center" style={{ animation: "vc-pop .45s ease-out both" }}>
          <Button
            variant="outline" size="sm" onClick={() => { sfx.click(); setScreen("select"); }}
            className="mb-4 rounded-xl border-white/25 bg-black/40 font-black text-white backdrop-blur hover:bg-black/60"
            aria-label="Back to side selection"
          >
            <ArrowLeft size={15} className="mr-1" /> Sides
          </Button>
          <div className="mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-400/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-sky-200">
            <ShieldCheck size={12} /> Police side · hero squads
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)] sm:text-5xl">
            Pick your <span className="text-sky-300">hero squad!</span>
          </h1>
          <p className="mt-2 text-sm font-bold text-slate-200 sm:text-base">
            {POLICE_OUTFITS.length} squads, one mission — bust {BUST_TARGET} vote thieves and save the city&apos;s votes. Every squad has its own perk!
          </p>
        </header>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
          {/* 3D preview card — wears the real squad gear */}
          <div className="flex flex-col gap-3">
            <div className="h-[300px] overflow-hidden rounded-3xl border-2 border-white/15 bg-gradient-to-b from-slate-800/60 to-slate-950/80 shadow-inner sm:h-[340px]">
              <Preview look={uniformLook} />
            </div>
            <div className="rounded-2xl border border-white/15 bg-black/40 p-3 backdrop-blur">
              <label htmlFor="officer-name" className="text-[11px] font-black uppercase tracking-wider text-slate-300">
                Officer name
              </label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="officer-name"
                  value={name}
                  onChange={(e) => setNameLocal(e.target.value.slice(0, 16))}
                  placeholder="e.g. Officer Chintu"
                  className="h-10 rounded-xl border-white/20 bg-white/10 font-bold text-white placeholder:text-white/35"
                  maxLength={16}
                />
                <Button
                  variant="outline" size="icon" onClick={rollName} aria-label="Suggest a random officer name"
                  className="h-10 w-10 shrink-0 rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20"
                >
                  <Dices size={16} />
                </Button>
              </div>
            </div>
          </div>

          {/* squad cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {POLICE_OUTFITS.map((o) => {
              const active = o.id === outfitId;
              return (
                <motion.button
                  key={o.id}
                  type="button"
                  onClick={() => { sfx.click(); setOutfitId(o.id); }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                  aria-pressed={active}
                  className={`relative overflow-hidden rounded-2xl border-2 p-3 text-left backdrop-blur transition-colors ${
                    active
                      ? "border-yellow-300 bg-yellow-300/15 shadow-[0_0_0_3px_rgba(253,224,71,0.25)]"
                      : "border-white/15 bg-black/40 hover:border-white/35"
                  }`}
                >
                  {active && (
                    <BadgeCheck size={17} className="absolute right-2 top-2 text-yellow-300" aria-label="selected" />
                  )}
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl">{o.emoji}</span>
                    <div className="text-sm font-black text-white">{o.label}</div>
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold leading-snug text-slate-300">{o.tagline}</div>
                  <div className="mt-2 flex items-start gap-1 rounded-lg bg-sky-400/10 px-2 py-1.5 text-[10px] font-black leading-tight text-sky-200">
                    <Sparkles size={11} className="mt-0.5 shrink-0" /> {o.perkLabel}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* start */}
        <div className="mb-8 mt-6 flex justify-center">
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}>
            <Button
              onClick={start}
              className="h-14 min-w-72 rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-8 text-lg font-black text-slate-950 shadow-[0_8px_0_rgba(14,116,144,0.65)]"
            >
              <Play size={22} className="mr-2" fill="currentColor" />
              START PATROL AS {outfit.label.toUpperCase()}!
            </Button>
          </motion.div>
        </div>
      </div>

      <style>{`
        @keyframes vc-pop { 0% { transform: scale(.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}
