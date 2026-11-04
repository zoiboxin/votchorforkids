"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Footprints, ShieldAlert, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sfx } from "@/lib/game/audio";
import { useGame } from "./store";

const RUNNER_POINTS = [
  "🏃 Snatch the 16 missing votes & deliver them to Parliament",
  "🚓 18 cartoon cops hunt you the moment you pocket votes — sprint, juke, hide!",
  "🧲 Bump vote-carrying protestors to pickpocket them — but cops are watching!",
  "🚗 Find a driving license and escape by car, GTA-style!",
  "🍌 Collect food, find rare super powers, rescue jailed friends",
];

const POLICE_POINTS = [
  "🚔 Bust 12 vote-thieving protestors — walk into them to arrest",
  "🚓 Pick one of 6 hero squads — City, Traffic, Commando, Army, Riot, Detective",
  "😗 Protestors scatter in panic when they see your uniform",
  "🚗 Collect a license card too — patrol the city by police car!",
  "🍌 Collect food & rare super powers — cops look after their own",
];

/** Screen 1 of the hero flow — pick a side: Protester Runner or Police.
    The side lives on the hero's look (fac) so the engine, the 3D city and the
    creator screen all agree without extra state. */
export function SelectSide({ onPlay }: { onPlay: () => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const setLook = useGame((s) => s.setLook);
  const fac = useGame((s) => s.look.fac);
  const hasProfile = useGame((s) => s.playerName.trim().length > 0);

  const pick = (r: "protester" | "police") => {
    sfx.click();
    if (r === "police") {
      setLook({ fac: "police" });
      setScreen("outfit"); // hero squad page comes first for cops
    } else {
      setLook({ fac: "protester", outfit: "" });
      if (!hasProfile) setScreen("creator");
      else onPlay();
    }
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-y-auto bg-slate-950">
      {/* sky backdrop (same family as the landing page) */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-votechor.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-sky-900/70 via-slate-900/75 to-slate-950/90" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <header className="pt-2 text-center" style={{ animation: "vc-pop .45s ease-out both" }}>
          <Button
            variant="outline" size="sm" onClick={() => { sfx.click(); setScreen("landing"); }}
            className="mb-4 rounded-xl border-white/25 bg-black/40 font-black text-white backdrop-blur hover:bg-black/60"
            aria-label="Back to menu"
          >
            <ArrowLeft size={15} className="mr-1" /> Menu
          </Button>
          <h1 className="text-3xl font-black tracking-tight text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.35)] sm:text-5xl">
            Choose your <span className="text-yellow-300">side!</span>
          </h1>
          <p className="mt-2 text-sm font-bold text-emerald-100 sm:text-base">
            Protester runner or police hero — the city needs both. Who are you today?
          </p>
        </header>

        <div className="mt-6 grid grid-cols-1 gap-4 pb-6 md:grid-cols-2">
          {/* ------- Protester Runner ------- */}
          <motion.button
            type="button"
            onClick={() => pick("protester")}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.97 }}
            className="group relative overflow-hidden rounded-3xl border-2 border-emerald-300/40 bg-gradient-to-b from-emerald-800/85 to-emerald-950/90 p-5 text-left shadow-[0_10px_0_rgba(0,60,30,0.55)] backdrop-blur transition-colors hover:border-emerald-300/80 sm:p-6"
            aria-label="Play as a protester runner"
          >
            {fac === "protester" && (
              <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-emerald-400/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-200">
                <CheckCircle2 size={12} /> your side
              </span>
            )}
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-400/20 text-3xl transition-transform group-hover:scale-110">🏃</span>
              <div>
                <div className="text-xl font-black text-white sm:text-2xl">Protester Runner</div>
                <div className="text-xs font-bold text-emerald-200">Steal votes back for democracy!</div>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5">
              {RUNNER_POINTS.map((t) => (
                <li key={t} className="flex items-start gap-1.5 text-xs font-bold text-emerald-50/90 sm:text-sm">
                  <Footprints size={13} className="mt-0.5 shrink-0 text-emerald-300" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-2xl bg-emerald-400/90 py-2.5 text-center text-base font-black text-emerald-950 shadow-[0_5px_0_rgba(6,78,59,0.7)] transition-transform group-hover:scale-[1.02] group-active:scale-95">
              PLAY AS RUNNER ▶
            </div>
          </motion.button>

          {/* ------- Police ------- */}
          <motion.button
            type="button"
            onClick={() => pick("police")}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.97 }}
            className="group relative overflow-hidden rounded-3xl border-2 border-sky-300/40 bg-gradient-to-b from-slate-800/90 to-slate-950/95 p-5 text-left shadow-[0_10px_0_rgba(10,20,45,0.7)] backdrop-blur transition-colors hover:border-sky-300/80 sm:p-6"
            aria-label="Play as police"
          >
            {fac === "police" && (
              <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-sky-400/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-sky-200">
                <CheckCircle2 size={12} /> your side
              </span>
            )}
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sky-400/20 text-3xl transition-transform group-hover:scale-110">🚓</span>
              <div>
                <div className="text-xl font-black text-white sm:text-2xl">Police Hero</div>
                <div className="text-xs font-bold text-sky-200">Catch the vote thieves — 6 squads to pick!</div>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5">
              {POLICE_POINTS.map((t) => (
                <li key={t} className="flex items-start gap-1.5 text-xs font-bold text-slate-50/90 sm:text-sm">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0 text-sky-300" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-2xl bg-sky-400/90 py-2.5 text-center text-base font-black text-slate-950 shadow-[0_5px_0_rgba(12,74,110,0.7)] transition-transform group-hover:scale-[1.02] group-active:scale-95">
              CHOOSE POLICE 🚓
            </div>
          </motion.button>
        </div>

        <div className="mx-auto mb-6 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => { sfx.click(); setScreen("creator"); }}
            className="rounded-xl border-white/25 bg-black/40 text-xs font-black text-white backdrop-blur hover:bg-black/60"
          >
            <UserCog size={14} className="mr-1.5" /> Customize my face & body first
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes vc-pop { 0% { transform: scale(.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}
