"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { WORLD } from "./WorldView";
import { GameEngine } from "@/lib/game/engine";
import { useGame } from "./store";
import { sfx, startMusic, stopMusic } from "@/lib/game/audio";
import { useGameInput } from "./Scene";
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
      } else {
        eng.reset(look);
        eng.setToast((msg, kind) => pushToast(msg, kind));
      }
      useGame.getState().setScreen("play");
      eng.start();
    }, 650);
  }, [look, pushToast]);

  const backToMenu = useCallback(() => {
    stopMusic();
    if (engineRef.current) engineRef.current.running = false;
    useGame.getState().setPaused(false);
    setScreen("landing");
  }, [setScreen]);

  useGameInput(engineRef.current);

  // watch for the win → open the victory modal once
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const id = setInterval(() => {
      if (eng.won && !useGame.getState().victoryOpen) {
        useGame.getState().setVictoryOpen(true);
        useGame.getState().recordRun(useGame.getState().hud.points);
      }
    }, 400);
    return () => clearInterval(id);
  }, [engine, runId]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-sky-300">
      {screen === "landing" && <Landing />}

      {screen === "creator" && <Creator onStart={startGame} />}

      {(screen === "connecting" || screen === "play") && engine && (
        <>
          <Scene engine={engine} key={`scene-${runId}`} />
          <Hud engine={engine} />
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
