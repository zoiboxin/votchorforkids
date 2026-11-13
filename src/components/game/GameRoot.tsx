"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { WORLD } from "./WorldView";
import { GameEngine } from "@/lib/game/engine";
import { terrainHeight } from "@/lib/game/worldgen";
import { useGame } from "./store";
import { sfx, startMusic, stopMusic, stopDrone } from "@/lib/game/audio";
import { useGameInput, requestGameLock } from "./Scene";
import { net } from "@/lib/game/net/client";
import { attachNet, type NetHandle } from "@/lib/game/net/engineNet";
import type { Appearance } from "@/lib/game/constants";
import { Hud } from "./Hud";
import { Creator } from "./Creator";
import { Landing } from "./Landing";
import { Profile } from "./Profile";
import { VictoryModal } from "./VictoryModal";
import { Multiplayer } from "./Multiplayer";

const Scene = dynamic(() => import("./Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
      <div className="animate-bounce rounded-2xl bg-white/10 px-6 py-3 text-lg font-black text-amber-200 shadow-xl">
        Night is falling… 🌙
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
  const netRef = useRef<NetHandle | null>(null);
  const [runId, setRunId] = useState(0);
  /** true while this run is a networked co-op session */
  const mpRef = useRef(false);
  /** 💾 the end-of-run record saves exactly once per run (death no longer pops a modal) */
  const endSavedRef = useRef(false);

  const startGame = useCallback(() => {
    useGame.getState().setScreen("connecting");
    useGame.getState().setPaused(false);
    useGame.getState().setPauseReport(false);
    useGame.getState().setVictoryOpen(false);
    useGame.getState().setShowHelp(true); // goal card re-shows every round, auto-hides after 12 s
    useGame.getState().setWheelOpen(false); // never carry a stale 🎒 tool wheel into a fresh run
    endSavedRef.current = false; // 💾 fresh run → its end gets saved again
    sfx.click();
    startMusic();
    setTimeout(() => {
      // read the look FRESH from the store — the join screen applies the final
      // look right before calling this, so a closure-captured look would lag a beat
      const freshLook = useGame.getState().look;
      let eng = engineRef.current;
      if (!eng) {
        eng = new GameEngine(WORLD, freshLook, (msg, kind) => pushToast(msg, kind));
        engineRef.current = eng;
        setEngine(eng);
        (window as unknown as { __vc?: unknown }).__vc = { engine: eng, world: WORLD, terrainH: terrainHeight, net };
        (window as unknown as { __vcStore?: unknown }).__vcStore = useGame; // debug/test hook
        // FIRST RUN init: the constructor spawns the town, but only reset() grants
        // the driving license, scatters the cash piles, homes the vans & calms the cops.
        // The reuse path (below) always reset — a fresh page never did, so E-to-
        // enter-car silently failed ("need a license") until a second run. 🐛
        eng.reset(freshLook);
      } else {
        eng.reset(freshLook);
        eng.setToast((msg, kind) => pushToast(msg, kind));
      }
      eng.playerName = useGame.getState().playerName || "You"; // survivor name for the start toast

      /* ---------- 🌐 wire the co-op relay if we're in a room ---------- */
      if (mpRef.current && net.code && net.slot >= 0) {
        netRef.current?.detach();
        const me = net.lobby?.players.find((p) => p.sid === net.mySid);
        netRef.current = attachNet({
          engine: eng,
          code: net.code,
          slot: net.slot,
          isHost: net.isHost,
          name: useGame.getState().playerName || me?.name || "Survivor",
          look: freshLook as Appearance,
          onReset: () => {
            // the host restarted the week — everyone rewinds together
            useGame.getState().pushToast("👑 The host restarted the 7 nights — back to DAY 1!", "info");
            endSavedRef.current = false; // 💾 the fresh week saves its own end
            if (engineRef.current) {
              engineRef.current.reset(useGame.getState().look);
              useGame.getState().setVictoryOpen(false);
            }
          },
        });
      } else {
        netRef.current?.detach();
        netRef.current = null;
      }

      useGame.getState().setScreen("play");
      eng.start();
      // weld the mouse to the camera as the world appears — the helper retries
      // via rAF until the 3D canvas mounts; blocked locks fall back to
      // free-look + hold Z / X to turn (HUD shows the hint)
      requestGameLock();
    }, 650);
  }, [pushToast]);

  /* ---------- 🌐 host presses START in the lobby → everyone boots a net run ---------- */
  useEffect(() => {
    useGame.getState().setMpStartRun(() => {
      mpRef.current = true;
      if (net.isHost) net.send({ t: "start" }); // guests auto-launch on this
      net.send({ t: "hello" }); // a friendly wave that also verifies the wire
      startGame();
    });
    return () => useGame.getState().setMpStartRun(null);
  }, [startGame]);

  const backToMenu = useCallback(() => {
    stopMusic();
    stopDrone();
    const eng = engineRef.current;
    if (eng) {
      eng.setPersonalPause(false);
      eng.spectating = false;
      eng.running = false;
      // save unfinished runs too (quit mid-story) — wins are recorded by the victory watcher
      if (!eng.won && eng.points > 0) {
        const timeMs = Math.round(eng.elapsed * 1000);
        useGame.getState().recordRun(eng.points, eng.money, eng.rescues, eng.caughtCount, false, timeMs);
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
    useGame.getState().setPauseReport(false);
    // leaving a net run: drop the relay wiring but STAY in the lobby room
    netRef.current?.detach();
    netRef.current = null;
    mpRef.current = false;
    if (net.code) {
      useGame.getState().setScreen("lobby");
      useGame.getState().setMpOpen(true);
    } else {
      setScreen("landing");
    }
  }, [setScreen]);

  useGameInput(engine);

  // watch for the win OR the death → save the record once; wins still pop the
  // recap — deaths hand the camera to the living (the engine auto-spectates)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const id = setInterval(() => {
      // screen guard: a "Play again" click closes the modal while the OLD engine still
      // has won/lost=true for the 650 ms connecting window — never re-open in that gap
      if (useGame.getState().screen !== "play") return;
      // ⏸ the end screen waits while the player is personally paused (the welcome-back
      // report reveals the death itself)
      if (useGame.getState().paused || useGame.getState().pauseReport) return;
      if (!(eng.won || eng.lost)) return;
      // 🎬 let the death fall play out first — the body folds, rests, and the dark
      // takes it; only THEN does the end-game flow begin
      if (eng.lost && eng.deathT < 2.1) return;
      // 💾 save the run record exactly once, whether or not any menu ever opens —
      // deaths no longer force-pop the recap, the auto free cam takes over instead
      if (!endSavedRef.current) {
        endSavedRef.current = true;
        const h = useGame.getState().hud;
        useGame.getState().recordRun(h.points, h.money, h.rescues, eng.caughtCount, eng.won, Math.round(h.elapsed * 1000));
      }
      // 🏆 wins still open the recap automatically; deaths keep the world on screen
      // (the recap is one Esc away — the spectate banner and the death toast say so)
      if (eng.won && !useGame.getState().victoryOpen) useGame.getState().setVictoryOpen(true);
    }, 400);
    return () => clearInterval(id);
  }, [engine, runId]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950">
      {screen === "landing" && <Landing />}

      {/* 👤 full-page profile hub (rank, daily tasks, hall of fame, account, features) */}
      {screen === "profile" && <Profile />}

      {/* 7Nights: no side selection — everyone joins as a survivor (screen kept for legacy saves) */}
      {screen === "select" && <Creator onStart={startGame} />}

      {screen === "outfit" && <Creator onStart={startGame} />}

      {screen === "creator" && <Creator onStart={startGame} />}

      {screen === "lobby" && <Multiplayer />}

      {(screen === "connecting" || screen === "play") && engine && (
        <>
          <Scene engine={engine} key={`scene-${runId}`} />
          <Hud engine={engine} onQuit={backToMenu} />
          <VictoryModal
            engine={engine}
            onReplay={() => {
              // 🌐 the host's "Play again" rewinds the WHOLE room to day 1
              if (mpRef.current && net.isHost) net.send({ t: "reset" });
              setRunId((r) => r + 1);
              startGame();
            }}
            onMenu={backToMenu}
          />
        </>
      )}

      {screen === "connecting" && !engine && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
          <div className="animate-bounce rounded-2xl bg-white/10 px-6 py-3 text-lg font-black text-amber-200 shadow-xl">
            The first night approaches… 🌑
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
