"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GameLoop, Npcs, Zombies, Animals, Pickups, Powers, Licenses, Shadows, Confetti, CrewRig, ToolDrops, BuildsView, RocksView, Stumps, type ClockRef } from "./Entities";
import { WorldView, WORLD } from "./WorldView";
import { GameEngine } from "@/lib/game/engine";
import type { Appearance } from "@/lib/game/constants";
import { useGame } from "./store";
import { sfx } from "@/lib/game/audio";

/* ------------------------------------------------------------------ */
/* Software-renderer detection: SwiftShader/llvmpipe CPUs are ~10x     */
/* slower at rasterising, so we drop resolution + MSAA there.          */
/* ------------------------------------------------------------------ */
let lowPower: boolean | null = null;
export function isLowPower(): boolean {
  if (lowPower === null) {
    try {
      const c = document.createElement("canvas");
      const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) lowPower = true;
      else {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
        lowPower = /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(r);
      }
    } catch {
      lowPower = false;
    }
  }
  return lowPower;
}

/** Slowly tunes render resolution up/down to hold a smooth framerate on weak GPUs.
 *  Wide hysteresis (down <20 fps, up >32) — a narrow band makes the resolution
 *  pump every second or two, which itself reads as stutter while driving. */
function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ t: 0, n: 0, dpr: 0.62 });
  useFrame((_, dt) => {
    const a = st.current;
    a.t += dt; a.n++;
    if (a.t < 1.2) return;
    const fps = a.n / a.t;
    a.t = 0; a.n = 0;
    if (fps < 20 && a.dpr > 0.32) { a.dpr = Math.max(0.32, a.dpr - 0.06); setDpr(a.dpr); }
    else if (fps > 32 && a.dpr < 0.72) { a.dpr = Math.min(0.72, a.dpr + 0.04); setDpr(a.dpr); }
  });
  return null;
}

export function useGameInput(engine: GameEngine | null) {
  const setTouch = useGame((s) => s.setTouch);
  useEffect(() => {
    if (!engine) return;
    const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const keys = new Set<string>();

    const applyKey = () => {
      const k = keys;
      const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
      const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
      if (!engine.touchMove.active) {
        engine.input.f = f;
        engine.input.r = r;
      }
      engine.input.sprint = k.has("ShiftLeft") || k.has("ShiftRight") || engine.touchMove.sprint;
      // 🎮 hold Z / X to swing the camera left / right — the keyboard fallback for
      // when the mouse cursor can't be hard-locked and dies at the screen edge
      engine.input.turn = (k.has("KeyZ") ? 1 : 0) - (k.has("KeyX") ? 1 : 0);
    };

    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      keys.add(e.code);
      if (e.code === "Space") {
        e.preventDefault();
        engine.input.jump = true;
        setTimeout(() => { engine.input.jump = false; }, 120);
      }
      if (e.code === "KeyE" && !e.repeat) engine.interact();
      // 🎒 G opens the tool wheel at screen center — move the mouse to a slice, click/G to ready it
      if (e.code === "KeyG" && !e.repeat) {
        const s = useGame.getState();
        if (s.wheelOpen) { /* the Hud owns G while the wheel is open (confirm select) */ }
        else if (s.screen === "play" && !s.paused && !s.victoryOpen && !s.bigMapOpen) {
          s.setWheelOpen(true);
          if (document.pointerLockElement) document.exitPointerLock();
        }
      }
      // ⚔️ F swing · 🔨 B barricade · 🔥 V campfire · ⚖️ R accuse — the 7Nights verbs
      if (e.code === "KeyF" && !e.repeat) engine.attack();
      if (e.code === "KeyB" && !e.repeat) engine.placeBuild("barricade");
      if (e.code === "KeyV" && !e.repeat) engine.placeBuild("campfire");
      if (e.code === "KeyR" && !e.repeat) engine.accuse();
      if (e.code === "KeyQ" && !e.repeat) engine.tryBlink(); // 🌀 Blink Teleport
      if (e.code === "KeyH" && !e.repeat) engine.horn();     // 🚗 car horn while driving
      applyKey();
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.code); applyKey(); };
    const blur = () => { keys.clear(); applyKey(); };

    let dragging = false;
    const md = (e: MouseEvent) => {
      dragging = e.target instanceof HTMLCanvasElement; // drag-look only starts on the world, not on HUD
      if (e.button === 0) sfx.click();
    };
    const mu = () => { dragging = false; };
    const mm = (e: MouseEvent) => {
      const s = useGame.getState();
      if (s.screen !== "play" || s.paused || s.victoryOpen || s.bigMapOpen || s.wheelOpen) return; // the wheel owns the cursor
      // mouse is bound to the game: steer when the cursor is hard-locked (FPS
      // style), whenever it glides over the open world, or while drag-looking
      if (!document.pointerLockElement && !(e.target instanceof HTMLCanvasElement) && !dragging) return;
      engine.input.yaw -= e.movementX * 0.0028;
      engine.input.pitch = Math.min(0.95, Math.max(-0.25, engine.input.pitch + e.movementY * 0.002));
      if (e.movementX || e.movementY) engine.input.mouseAt = performance.now(); // pause the drive auto-cam briefly
    };

    // click anywhere that isn't a UI control to hard-bind the cursor (pointer
    // lock) — Esc frees it again. Silent no-op where pointer lock is blocked
    // (sandboxed iframes); free-look + Z/X keyboard turn keep working there.
    const grab = (e: MouseEvent) => {
      const s = useGame.getState();
      if (s.screen !== "play" || s.paused || s.victoryOpen || s.bigMapOpen || s.wheelOpen || s.touch) return;
      const t = e.target;
      if (document.pointerLockElement || !(t instanceof Element) || t.closest("[data-ui]")) return;
      requestGameLock();
    };
    const plc = () => {
      const locked = !!document.pointerLockElement;
      useGame.getState().setMouseLocked(locked);
      if (!locked) {
        // Esc while the cursor is hard-bound is swallowed by the browser to exit
        // pointer lock — the page never sees that keydown. So treat an unexpected
        // unlock (no menu/modal/map/WHEEL already open) as "Esc pressed" → pause menu.
        const s = useGame.getState();
        if (s.screen === "play" && !s.paused && !s.victoryOpen && !s.bigMapOpen && !s.wheelOpen) {
          engine.running = false; // match togglePause: freeze the simulation too
          s.setPaused(true);
        }
      }
    };
    // a late/rejected lock attempt must never clear a LIVE lock (Chrome fires
    // pointerlockerror during its post-Escape cooldown even when a later
    // request succeeded — only clear the flag when truly unlocked)
    const ple = () => { if (!document.pointerLockElement) useGame.getState().setMouseLocked(false); };
    // free the cursor whenever a menu, modal, the big map or the victory screen takes over
    const lockWatch = setInterval(() => {
      const s = useGame.getState();
      if (document.pointerLockElement && (s.screen !== "play" || s.paused || s.victoryOpen || s.bigMapOpen)) {
        document.exitPointerLock();
      }
    }, 250);

    // touch look (right half of screen, handled globally)
    let touchId: number | null = null, lx = 0, ly = 0;
    const ts = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (touchId === null && t.clientX > window.innerWidth * 0.42 && !isUiTarget(t.target)) {
          touchId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
    };
    const tm = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === touchId) {
          engine.input.yaw -= (t.clientX - lx) * 0.006;
          engine.input.pitch = Math.min(0.95, Math.max(-0.25, engine.input.pitch + (t.clientY - ly) * 0.004));
          engine.input.mouseAt = performance.now(); // pause the drive auto-cam briefly
          lx = t.clientX; ly = t.clientY;
        }
      }
    };
    const te = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === touchId) touchId = null;
    };
    const isUiTarget = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("[data-ui]");

    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    addEventListener("mousedown", md);
    addEventListener("mouseup", mu);
    addEventListener("mousemove", mm);
    addEventListener("click", grab);
    document.addEventListener("pointerlockchange", plc);
    document.addEventListener("pointerlockerror", ple);
    addEventListener("touchstart", ts, { passive: true });
    addEventListener("touchmove", tm, { passive: true });
    addEventListener("touchend", te);
    addEventListener("touchcancel", te);
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const forceTouch = new URLSearchParams(window.location.search).has("touch");
    setTouch(isTouchDevice || forceTouch);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", blur);
      removeEventListener("mousedown", md);
      removeEventListener("mouseup", mu);
      removeEventListener("mousemove", mm);
      removeEventListener("click", grab);
      document.removeEventListener("pointerlockchange", plc);
      document.removeEventListener("pointerlockerror", ple);
      clearInterval(lockWatch);
      removeEventListener("touchstart", ts);
      removeEventListener("touchmove", tm);
      removeEventListener("touchend", te);
      removeEventListener("touchcancel", te);
    };
  }, [engine, setTouch]);
}

export function Scene({ engine }: { engine: GameEngine }) {
  const clockRef = useRef<number>(0.3) as ClockRef;
  const low = useMemo(() => isLowPower(), []);
  // hide the OS mouse icon over the world while actively playing — pointer lock
  // hides it natively; this covers browsers/iframes where the lock is blocked.
  // cursor is inherited, so it reaches the inner <canvas>; paused/menus/map
  // restore the cursor so buttons stay clickable.
  const playing = useGame((s) => s.screen === "play" && !s.paused && !s.victoryOpen && !s.bigMapOpen && !s.wheelOpen);
  const touch = useGame((s) => s.touch);
  const dpr: [number, number] = useMemo(() => {
    if (typeof window === "undefined") return [1, 1.5];
    if (low) return [0.55, 0.66]; // software GPU — start low, AdaptiveDpr tunes it
    return window.innerWidth < 800 ? [1, 1.35] : [1, 1.75];
  }, [low]);
  return (
    <Canvas
      className={`absolute inset-0 ${playing && !touch ? "cursor-none" : ""}`}
      camera={{ fov: 62, near: 0.5, far: 900, position: [0, 40, 90] }}
      dpr={dpr}
      gl={{ antialias: !low, powerPreference: "high-performance" }}
      onCreated={({ gl, scene, camera }) => {
        gl.setClearColor("#8fd3ff");
        // expose for debugging/perf tuning (also used to detect software renderers)
        (window as unknown as { __vc3?: unknown }).__vc3 = { gl, scene, camera, engine };
      }}
    >
      {low && <AdaptiveDpr />}
      <WorldView clockRef={clockRef} engine={engine} />
      <GameLoop engine={engine} clockRef={clockRef} />
      <Npcs engine={engine} />
      <CrewRig engine={engine} />
      <Zombies engine={engine} />
      <Animals engine={engine} />
      <Pickups engine={engine} />
      <Powers engine={engine} />
      <Licenses engine={engine} />
      <ToolDrops engine={engine} />
      <BuildsView engine={engine} />
      <RocksView engine={engine} />
      <Stumps engine={engine} />
      <Shadows engine={engine} />
      <Confetti engine={engine} />
    </Canvas>
  );
}

export { WORLD };

/* ------------------------------------------------------------------ */
/* Pointer-lock helper — the mouse must feel welded to the camera.     */
/* Retries for a moment via rAF so it can fire before the <canvas>      */
/* mounts (e.g. from the PLAY button click, 650 ms before the scene     */
/* appears). Always guarded: touch devices, menus and already-locked    */
/* states never touch it; failures fall back to free-look + Z/X keys.   */
/* ------------------------------------------------------------------ */
export function requestGameLock(): void {
  if (typeof document === "undefined") return;
  const ok = () => {
    const s = useGame.getState();
    return s.screen === "play" && !s.paused && !s.victoryOpen && !s.bigMapOpen && !s.wheelOpen && !s.touch && !document.pointerLockElement;
  };
  if (!ok()) return;
  let tries = 0;
  const attempt = () => {
    if (!ok() || document.pointerLockElement) return; // user opened a menu / locked already
    const cv = document.querySelector("canvas");
    if (!cv) {
      // scene still mounting — retry until it appears (gives up after ~2 s)
      if (++tries < 120) requestAnimationFrame(attempt);
      return;
    }
    try {
      // unadjustedMovement = raw OS input (no mouse acceleration) when supported
      const p = (cv as HTMLCanvasElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void })
        .requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => {
          try {
            const q = cv.requestPointerLock(); // retry without options (older browsers)
            if (q && typeof q.catch === "function") q.catch(() => { /* free-look keeps working */ });
          } catch { /* pointer lock unavailable — free-look + Z/X turn keep working */ }
        });
      }
    } catch {
      try { cv.requestPointerLock(); } catch { /* unsupported — fallbacks keep working */ }
    }
  };
  attempt();
}
