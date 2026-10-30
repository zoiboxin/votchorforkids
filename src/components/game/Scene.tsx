"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GameLoop, Npcs, Zombies, Animals, Pickups, Shadows, Confetti, type ClockRef } from "./Entities";
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

/** Slowly tunes render resolution up/down to hold a smooth framerate on weak GPUs. */
function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ t: 0, n: 0, dpr: 0.62 });
  useFrame((_, dt) => {
    const a = st.current;
    a.t += dt; a.n++;
    if (a.t < 1.2) return;
    const fps = a.n / a.t;
    a.t = 0; a.n = 0;
    if (fps < 21 && a.dpr > 0.32) { a.dpr = Math.max(0.32, a.dpr - 0.07); setDpr(a.dpr); }
    else if (fps > 34 && a.dpr < 0.72) { a.dpr = Math.min(0.72, a.dpr + 0.05); setDpr(a.dpr); }
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
      applyKey();
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.code); applyKey(); };
    const blur = () => { keys.clear(); applyKey(); };

    let dragging = false;
    const md = (e: MouseEvent) => { dragging = true; if (e.button === 0) sfx.click(); };
    const mu = () => { dragging = false; };
    const mm = (e: MouseEvent) => {
      if (useGame.getState().screen !== "play") return;
      if (document.pointerLockElement || dragging) {
        engine.input.yaw -= e.movementX * 0.0028;
        engine.input.pitch = Math.min(0.95, Math.max(-0.25, engine.input.pitch + e.movementY * 0.002));
      }
    };

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
  const dpr: [number, number] = useMemo(() => {
    if (typeof window === "undefined") return [1, 1.5];
    if (low) return [0.55, 0.66]; // software GPU — start low, AdaptiveDpr tunes it
    return window.innerWidth < 800 ? [1, 1.35] : [1, 1.75];
  }, [low]);
  return (
    <Canvas
      className="absolute inset-0"
      camera={{ fov: 62, near: 0.5, far: 900, position: [0, 40, 90] }}
      dpr={dpr}
      gl={{ antialias: !low, powerPreference: "high-performance" }}
      onCreated={({ gl, scene, camera }) => {
        gl.setClearColor("#8fd3ff");
        // expose for debugging/perf tuning (also used to detect software renderers)
        (window as unknown as { __vc3?: unknown }).__vc3 = { gl, scene, camera };
      }}
    >
      {low && <AdaptiveDpr />}
      <WorldView clockRef={clockRef} />
      <GameLoop engine={engine} clockRef={clockRef} />
      <Npcs engine={engine} />
      <Zombies engine={engine} />
      <Animals engine={engine} />
      <Pickups engine={engine} />
      <Shadows engine={engine} />
      <Confetti engine={engine} />
    </Canvas>
  );
}

export { WORLD };
