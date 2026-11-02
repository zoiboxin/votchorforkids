"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Home, Trophy, Timer, Star, Vote, HeartHandshake, ShieldCheck } from "lucide-react";
import type { GameEngine } from "@/lib/game/engine";
import { BUST_TARGET, RUNNER_LOSE_DELIVERIES } from "@/lib/game/constants";
import { useGame } from "./store";
import { Leaderboard } from "./Creator";

export function VictoryModal({ engine, onReplay, onMenu }: { engine: GameEngine; onReplay: () => void; onMenu: () => void }) {
  const open = useGame((s) => s.victoryOpen);
  const setOpen = useGame((s) => s.setVictoryOpen);
  const hud = useGame((s) => s.hud);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(useGame.getState().playerName || "Guest");
  // ref guard: React StrictMode (dev) double-invokes effects before the saved state
  // applies — this keeps the leaderboard POST to exactly one per open modal
  const posted = useRef(false);
  const police = engine.side === "police";
  const won = engine.won;

  useEffect(() => {
    if (!open || posted.current) return;
    posted.current = true;
    fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: useGame.getState().playerName || "Guest",
        points: hud.points,
        votes: police ? engine.caughtCount : hud.delivered,
        rescues: hud.rescues,
        caught: engine.caughtCount,
        won,
        timeMs: Math.round(hud.elapsed * 1000),
      }),
    })
      .then((r) => r.json())
      .then(() => fetch("/api/scores").then((r) => r.json()))
      .then((d) => { useGame.getState().setScores(d.scores ?? []); setSaved(true); })
      .catch(() => {});
  }, [open, hud.points, hud.delivered, hud.rescues, hud.elapsed, engine, police, won]);

  const secs = Math.round(hud.elapsed);
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, "0");
  const title = police
    ? won ? "🚓 Case Closed, Officer!" : "🗳 The Runners Got Through!"
    : "🏆 Democracy Saved!";
  const blurb = police
    ? won
      ? `All ${BUST_TARGET} vote-runners are in the station cage. Parliament is safe — the city salutes you!`
      : `The runners smuggled ${RUNNER_LOSE_DELIVERIES} votes into Parliament. Shake it off, Officer — the next shift is yours!`
    : "Every last vote reached the Parliament ballot box. The city throws confetti in your honour!";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-3xl border-yellow-300/40 bg-slate-900/95 p-6 text-white">
        <DialogHeader>
          <DialogTitle className={`text-center text-3xl font-black ${police ? (won ? "text-sky-300" : "text-rose-300") : "text-yellow-300"}`}>
            {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-center text-sm text-white/75">{blurb}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat icon={<Timer size={14} />} label="Time" value={`${mm}:${ss}`} />
          <Stat icon={<Trophy size={14} />} label="Score" value={`${hud.points}`} />
          {police ? (
            <>
              <Stat icon={<ShieldCheck size={14} />} label="Runners busted" value={`${engine.caughtCount}/${BUST_TARGET}`} />
              <Stat icon={<Vote size={14} />} label="Votes smuggled" value={`${engine.runnerDelivered}/${RUNNER_LOSE_DELIVERIES}`} />
            </>
          ) : (
            <>
              <Stat icon={<Vote size={14} />} label="Votes" value={`${hud.delivered}/${hud.total}`} />
              <Stat icon={<HeartHandshake size={14} />} label="Rescues" value={`${hud.rescues}`} />
            </>
          )}
          <Stat icon={<Star size={14} />} label={police ? "Busts" : "Times caught"} value={`${engine.caughtCount}`} />
          <Stat icon={<RotateCcw size={14} />} label="Run" value={saved ? "saved ✓" : "saving…"} />
        </div>
        <Leaderboard compact />
        <div className="flex gap-2">
          <Button
            onClick={() => { setOpen(false); onReplay(); }}
            className="flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 font-black text-amber-950"
          >
            <RotateCcw size={16} className="mr-1" /> Play again
          </Button>
          <Button
            onClick={() => { setOpen(false); onMenu(); }}
            variant="outline"
            className="flex-1 rounded-xl border-white/25 bg-white/10 font-black text-white hover:bg-white/20"
          >
            <Home size={16} className="mr-1" /> Menu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
      <span className="text-yellow-300">{icon}</span>
      <span className="text-white/60">{label}:</span>
      <b className="ml-auto">{value}</b>
    </div>
  );
}
