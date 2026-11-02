"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { WORLD } from "./WorldView";
import { GameEngine } from "@/lib/game/engine";
import { useGame } from "./store";
import { sfx, startMusic, stopMusic } from "@/lib/game/audio";
import { useGameInput, requestGameLock } from "./Scene";
import { Hud } from "./Hud";
import { Creator } from "./Creator";
import { Landing } from "./Landing";
import { VictoryModal } from "./VictoryModal";

const Scene = dynamic(() => import("./Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-sky-300">
      <div className="animate-bounce rounded-2xl bg-white/80 px-6 py-3 text-lg font-black text-slate-800 shadow-xl">
        Building the city… 🏗️
      </div>
    </div>
  ),
});

export function GameRoot() {
  const screen = useGame((s) => s.screen);
  const look = useGame((s) => s.look);
  const setScreen = useGame((s) => s.setScreen);
  const pushToast = useGame((s) => s.pushToast);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [runId, setRunId] = useState(0);

  const startGame = useCallback(() => {
    useGame.getState().setScreen("connecting");
    useGame.getState().setPaused(false);
    useGame.getState().setVictoryOpen(false);
    sfx.click();
    startMusic();
    setTimeout(() => {
      let eng = engineRef.current;
      if (!eng) {
        eng = new GameEngine(WORLD, look, (msg, kind) => pushToast(msg, kind));
        engineRef.current = eng;
        setEngine(eng);
        (window as unknown as { __vc?: unknown }).__vc = { engine: eng, world: WORLD };
        (window as unknown as { __vcStore?: unknown }).__vcStore = useGame; // debug/test hook
      } else {
        eng.reset(look);
        eng.setToast((msg, kind) => pushToast(msg, kind));
      }
      eng.playerName = useGame.getState().playerName || "You"; // officer/hero name for the start toast
      useGame.getState().setScreen("play");
      eng.start();
      // weld the mouse to the camera as the world appears — the helper retries
      // via rAF until the 3D canvas mounts; blocked locks fall back to
      // free-look + hold Z / X to turn (HUD shows the hint)
      requestGameLock();
    }, 650);
  }, [look, pushToast]);

  const backToMenu = useCallback(() => {
    stopMusic();
    const eng = engineRef.current;
    if (eng) {
      eng.running = false;
      // save unfinished runs too (quit mid-chase) — wins are recorded by the victory watcher
      if (!eng.won && eng.points > 0) {
        const timeMs = Math.round(eng.elapsed * 1000);
        useGame.getState().recordRun(eng.points, eng.delivered, eng.rescues, eng.caughtCount, false, timeMs);
        fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: useGame.getState().playerName || "Guest",
            points: eng.points, votes: eng.delivered, rescues: eng.rescues,
            caught: eng.caughtCount, won: false, timeMs,
          }),
        })
          .then((r) => r.json())
          .then(() => fetch("/api/scores"))
          .then((r) => r.json())
          .then((d) => useGame.getState().setScores(d.scores ?? []))
          .catch(() => {});
      }
    }
    useGame.getState().setPaused(false);
    setScreen("landing");
  }, [setScreen]);

  useGameInput(engineRef.current);

  // watch for the win OR the police-shift loss → open the end screen once + save the record
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const id = setInterval(() => {
      // screen guard: a "Play again" click closes the modal while the OLD engine still
      // has won/lost=true for the 650 ms connecting window — never re-open in that gap
      if (useGame.getState().screen !== "play") return;
      if ((eng.won || eng.lost) && !useGame.getState().victoryOpen) {
        useGame.getState().setVictoryOpen(true);
        const h = useGame.getState().hud;
        useGame.getState().recordRun(h.points, eng.side === "police" ? eng.caughtCount : h.delivered, h.rescues, eng.caughtCount, eng.won, Math.round(h.elapsed * 1000));
      }
    }, 400);
    return () => clearInterval(id);
  }, [engine, runId]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-sky-300">
      {screen === "landing" && <Landing onPlay={startGame} />}

      {screen === "creator" && <Creator onStart={startGame} />}

      {(screen === "connecting" || screen === "play") && engine && (
        <>
          <Scene engine={engine} key={`scene-${runId}`} />
          <Hud engine={engine} onQuit={backToMenu} />
          <VictoryModal
            engine={engine}
            onReplay={() => { setRunId((r) => r + 1); startGame(); }}
            onMenu={backToMenu}
          />
        </>
      )}

      {screen === "connecting" && !engine && (
        <div className="absolute inset-0 flex items-center justify-center bg-sky-300">
          <div className="animate-bounce rounded-2xl bg-white/85 px-6 py-3 text-lg font-black text-slate-800 shadow-xl">
            Warming up the city… 🏗️
          </div>
        </div>
      )}
    </div>
  );
}

/* Next.js 16's dev-tools bubble mounts bottom-left exactly where the in-game
   food hotbar lives — players thought the inventory was broken ("only 1 slot").
   nextjs-portal only exists in `next dev`, so hiding it is a dev-only cosmetic fix. */
if (typeof document !== "undefined" && !document.getElementById("vc-hide-next-devtools")) {
  const s = document.createElement("style");
  s.id = "vc-hide-next-devtools";
  s.textContent = "nextjs-portal{display:none!important}";
  document.head.appendChild(s);
}
