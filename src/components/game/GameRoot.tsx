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
import { enterMatchLobby, leaveMatchmaking } from "@/lib/game/net/matchlobby";
import type { Appearance } from "@/lib/game/constants";
import { Hud } from "./Hud";
import { Creator } from "./Creator";
import { Landing } from "./Landing";
import { Profile } from "./Profile";
import { VictoryModal } from "./VictoryModal";
import { Multiplayer } from "./Multiplayer";
import { MatchLobby } from "./MatchLobby";

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

  /** 👑 the host restarted the week — everyone rewinds to day 1 together
   *  (shared by the multiplayer path AND the auto-hosted solo session) */
  const makeOnReset = useCallback(() => () => {
    useGame.getState().pushToast("👑 The host restarted the 7 nights — back to DAY 1!", "info");
    endSavedRef.current = false; // 💾 the fresh week saves its own end
    if (engineRef.current) {
      engineRef.current.reset(useGame.getState().look);
      useGame.getState().setVictoryOpen(false);
    }
  }, []);

  /** 🏟️ PUBG-style entry: don't boot the world alone — park in the MATCH LOBBY
   *  with a shared 30 s countdown. Friends who Quick join during the window
   *  launch TOGETHER with you; AI bots (survivors, runners & police) fill the
   *  rest of the 100-soul session. */
  const startMatchLobby = useCallback(() => {
    useGame.getState().setPaused(false);
    useGame.getState().setPauseReport(false);
    useGame.getState().setVictoryOpen(false);
    sfx.click();
    startMusic();
    void enterMatchLobby();
  }, []);

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
          onReset: makeOnReset(),
        });
      } else {
        netRef.current?.detach();
        netRef.current = null;
        // 🌐 SOLO GAMES ARE JOINABLE — quietly claim a relay session in the
        // background (relay down? nothing changes, pure solo keeps working).
        //   • nobody else around → we HOST a fresh room and mark it LIVE: any
        //     player who hits Quick join lands in THIS world, and a bot frees
        //     their seat (100 souls, always).
        //   • a live night already running → we JOIN it instead: two players
        //     who both pressed Play end up in the SAME game, seeing each other.
        //   • already in a session (replay after leaving a net run)? quick()
        //     reclaims that seat instantly.
        const myName = useGame.getState().playerName || "Survivor";
        net.quick(myName, freshLook as Appearance)
          .then((r) => {
            if (engineRef.current !== eng || useGame.getState().screen !== "play") {
              net.disconnect(); // run was replaced / quit before the seat landed
              return;
            }
            mpRef.current = true;
            netRef.current = attachNet({
              engine: eng,
              code: net.code,
              slot: net.slot,
              isHost: net.isHost,
              name: myName,
              look: freshLook as Appearance,
              onReset: makeOnReset(),
            });
            if (net.isHost && !r.started) {
              net.send({ t: "start" }); // the relay marks this room LIVE for quick-joiners
              net.sessionStarted = true;
              pushToast("🌐 Your night is LIVE — anyone who Quick joins lands in YOUR world!", "good");
            } else if (r.started) {
              pushToast("🌐 You joined the live night — the other survivors are in this world too!", "good");
            }
          })
          .catch(() => { /* relay unreachable — the night goes on solo */ });
      }

      useGame.getState().setScreen("play");
      eng.start();
      // weld the mouse to the camera as the world appears — the helper retries
      // via rAF until the 3D canvas mounts; blocked locks fall back to
      // free-look + hold Z / X to turn (HUD shows the hint)
      requestGameLock();
    }, 650);
  }, [pushToast, makeOnReset]);

  /* ---------- 🌐 match launch — every lobby member boots the night together ----------
   * The MatchLobby countdown is the primary trigger; this shared fn is the ONE
   * launch path (guarded so a timer + a racing `start` event can't double-boot). */
  useEffect(() => {
    useGame.getState().setMpStartRun(() => {
      const sc = useGame.getState().screen;
      if (sc === "play" || sc === "connecting") return; // already in a run
      mpRef.current = true;
      if (net.isHost) {
        net.send({ t: "start" }); // guests auto-launch on this
        net.sessionStarted = true; // our room is LIVE now (relobby-aware)
      }
      net.send({ t: "hello" }); // a friendly wave that also verifies the wire
      startGame();
    });
    return () => useGame.getState().setMpStartRun(null);
  }, [startGame]);

  /* ---------- 🏟️ the host's `start` event = the launch backstop ----------
   * The shared countdown fires on every client's own clock; machines a beat
   * apart still converge because the host's start event sweeps the lobbies. */
  useEffect(() => {
    const unStart = net.on("start", () => {
      if (net.isHost) return; // the host launches itself via the countdown
      const sc = useGame.getState().screen;
      if (sc === "matchlobby" || sc === "lobby" || sc === "landing") {
        useGame.getState().mpStartRun?.();
      }
    });
    return unStart;
  }, []);

  /* ---------- 🔄 restart-together (relobby) ----------
   * While WE are inside a running night, a fresh shared countdown means new
   * survivors are waiting in the match lobby — arm a self-reset so the whole
   * room rewinds to night 1 TOGETHER when it fires. Nobody ever plays a
   * mismatched mid-match world (the "P1 is ahead, P2 sees something else" bug). */
  const relobbyAtRef = useRef(0);
  useEffect(() => {
    const unLobby = net.onLobby((l) => {
      if (useGame.getState().screen !== "play") return;
      if (l.phase === "lobby" && l.lobbyEndsAt && l.lobbyEndsAt > Date.now() && l.lobbyEndsAt !== relobbyAtRef.current) {
        relobbyAtRef.current = l.lobbyEndsAt;
        useGame.getState().pushToast("🏟️ New survivors are gathering in the lobby — the night RESTARTS fresh for everyone shortly!", "info");
      }
    });
    const t = setInterval(() => {
      const at = relobbyAtRef.current;
      if (!at || Date.now() < at) return;
      relobbyAtRef.current = 0;
      if (useGame.getState().screen !== "play") return;
      const eng = engineRef.current;
      if (eng) {
        endSavedRef.current = false; // 💾 the fresh week saves its own end
        eng.reset(useGame.getState().look);
        netRef.current?.resync(); // 🏟️ re-seed remote souls after the rewind
        useGame.getState().setVictoryOpen(false);
        useGame.getState().pushToast("🌙 Fresh night — the whole squad starts together!", "good");
      }
      if (net.isHost) net.send({ t: "start" }); // flip the room back to live for the next joiner
    }, 500);
    return () => { unLobby(); clearInterval(t); };
  }, []);

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
    // 🏠 quit → the MAIN LANDING PAGE, always (it used to strand players on the
    // Multiplayer Nights panel with no obvious way back). The relay seat is
    // released cleanly — quick-joiners get a fresh matchmaking room of their own.
    netRef.current?.detach();
    netRef.current = null;
    mpRef.current = false;
    leaveMatchmaking();
    useGame.getState().setMpOpen(false);
    setScreen("landing");
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
      {screen === "select" && <Creator onStart={startMatchLobby} />}

      {screen === "outfit" && <Creator onStart={startMatchLobby} />}

      {screen === "creator" && <Creator onStart={startMatchLobby} />}

      {screen === "lobby" && <Multiplayer />}

      {/* 🏟️ PUBG-style match lobby — the shared 30 s countdown before the night */}
      {screen === "matchlobby" && <MatchLobby />}

      {(screen === "connecting" || screen === "play") && engine && (
        <>
          <Scene engine={engine} key={`scene-${runId}`} />
          <Hud engine={engine} onQuit={backToMenu} />
          <VictoryModal
            engine={engine}
            onReplay={() => {
              // 🏟️ "Play again" re-queues through the match lobby — the host,
              // guests & fresh quick-joiners all regather on the shared clock
              // and launch a brand-new 100-soul night together
              setRunId((r) => r + 1);
              startMatchLobby();
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
