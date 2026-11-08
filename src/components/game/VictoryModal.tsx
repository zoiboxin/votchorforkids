"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Home, Trophy, Timer, MoonStar, Swords, Scale, XCircle, Hammer, Eye } from "lucide-react";
import type { GameEngine } from "@/lib/game/engine";
import { NIGHTS_TOTAL } from "@/lib/game/constants";
import { useGame } from "./store";
import { Leaderboard } from "./Leaderboard";

export function VictoryModal({ engine, onReplay, onMenu }: { engine: GameEngine; onReplay: () => void; onMenu: () => void }) {
  const open = useGame((s) => s.victoryOpen);
  const setOpen = useGame((s) => s.setVictoryOpen);
  const hud = useGame((s) => s.hud);
  const [saved, setSaved] = useState(false);
  // ref guard: React StrictMode (dev) double-invokes effects before the saved state
  // applies — this keeps the leaderboard POST to exactly one per open modal
  const posted = useRef(false);
  const won = engine.won;
  const survivedAll = engine.nightsSurvived >= NIGHTS_TOTAL;

  useEffect(() => {
    if (!open || posted.current) return;
    posted.current = true;
    fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: useGame.getState().playerName || "Guest",
        points: hud.points,
        votes: engine.kills,
        rescues: engine.accusesRight,
        caught: engine.accusesWrong,
        won,
        timeMs: Math.round(hud.elapsed * 1000),
      }),
    })
      .then((r) => r.json())
      .then(() => fetch("/api/scores").then((r) => r.json()))
      .then((d) => { useGame.getState().setScores(d.scores ?? []); setSaved(true); })
      .catch(() => {});
  }, [open, hud.points, hud.elapsed, engine, won]);

  const secs = Math.round(hud.elapsed);
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, "0");

  /* outcome titles — the contest: 99 enter, one walks out */
  const place = won ? 1 : Math.min(hud.aliveTotal, hud.crewAlive + 1);
  const title = won
    ? survivedAll
      ? `🌅 LAST ONE STANDING — #1 OF ${hud.aliveTotal}!`
      : `🔪 SOLE SURVIVOR — #1 OF ${hud.aliveTotal}!`
    : `🌑 The Darkness Took You — #${place} of ${hud.aliveTotal}`;
  const tone = !won
    ? "text-slate-200"
    : survivedAll
      ? "text-amber-300"
      : "text-red-300";

  /* flavor line per ending */
  const blurb = won
    ? survivedAll
      ? `Seven dusks, half the lobby turning each night — and when dawn broke on night 7, your heartbeat was the only one left of ${hud.aliveTotal}.`
      : `The hunger took them one by one. Of ${hud.aliveTotal} souls who entered, yours is the last still breathing.`
    : `Night ${engine.nightNo} caught you. You placed #${place} of ${hud.aliveTotal} — ${engine.nightsSurvived > 0 ? `you held out for ${engine.nightsSurvived} night${engine.nightsSurvived === 1 ? "" : "s"} — ` : ""}the dark keeps what it takes.`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-3xl border-red-400/30 bg-slate-900/95 p-6 text-white">
        <DialogHeader>
          <DialogTitle className={`text-center text-3xl font-black ${tone}`}>
            {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-center text-sm text-white/75">{blurb}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat icon={<MoonStar size={14} />} label="Nights survived" value={`${engine.nightsSurvived}/${NIGHTS_TOTAL}`} />
          <Stat icon={<Trophy size={14} />} label="Placement" value={`#${place} of ${hud.aliveTotal}`} />
          <Stat icon={<Timer size={14} />} label="Time" value={`${mm}:${ss}`} />
          <Stat icon={<Swords size={14} />} label="Zombies slain" value={`${engine.kills}`} />
          <Stat icon={<Scale size={14} />} label="Right accusations" value={`${engine.accusesRight}`} />
          <Stat icon={<XCircle size={14} />} label="Wrong accusations" value={`${engine.accusesWrong}`} />
          <Stat icon={<Hammer size={14} />} label="Things built" value={`${engine.buildsMade}`} />
          <Stat icon={<Trophy size={14} />} label="Points" value={`${hud.points}`} />
          <Stat icon={<RotateCcw size={14} />} label="Run" value={saved ? "saved ✓" : "saving…"} />
        </div>
        <Leaderboard compact />
        {/* 👀 the contest doesn't end with you — ride the free cam behind the living */}
        {!won && (
          <Button
            onClick={() => { setOpen(false); engine.startSpectate(); }}
            variant="outline"
            className="w-full rounded-xl border-emerald-300/40 bg-emerald-500/15 font-black text-emerald-200 hover:bg-emerald-500/30"
          >
            <Eye size={16} className="mr-1" /> Free cam — watch the town finish
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            onClick={() => { setOpen(false); onReplay(); }}
            className="flex-1 rounded-xl bg-gradient-to-r from-red-500 to-amber-400 font-black text-red-950"
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
      <span className="text-red-300">{icon}</span>
      <span className="text-white/60">{label}:</span>
      <b className="ml-auto">{value}</b>
    </div>
  );
}
