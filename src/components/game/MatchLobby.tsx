"use client";

/**
 * MatchLobby — the 🏟️ PUBG-style match lobby.
 *
 * Every Play press parks the player here with a SHARED 30-second countdown
 * (the relay owns the one true deadline). Friends who Quick join during the
 * window land in THIS lobby; when the clock fires, everyone boots the night
 * together and AI bots (survivors, vote-runners & police) fill every remaining
 * seat — 100 souls in one session, exactly like a battle-royale match start.
 *
 * Modes:
 *   gather  — fresh pre-match gathering (the classic countdown)
 *   relobby — a night is ALREADY running; it restarts fresh when the clock
 *             fires so the joiner and the current squad play TOGETHER
 *   solo    — relay unreachable; offline countdown, solo night on launch
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useGame } from "./store";
import { net } from "@/lib/game/net/client";
import { LOBBY_MS } from "@/lib/game/net/matchlobby";

const SLOT_COLORS = ["#f472b6", "#fbbf24", "#4ade80", "#2dd4bf", "#f87171", "#c084fc", "#fb923c", "#a3e635"];

function codeToColor(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  return SLOT_COLORS[Math.abs(h) % SLOT_COLORS.length];
}

export function MatchLobby() {
  const mp = useGame((s) => s.mp);
  const pushToast = useGame((s) => s.pushToast);
  const setScreen = useGame((s) => s.setScreen);
  const [left, setLeft] = useState<number | null>(null); // seconds (null = matching…)
  const launchedRef = useRef(false);

  /* ---- roster + shared countdown sync (the relay is the one true clock) ---- */
  useEffect(() => {
    const unLobby = net.onLobby((l) => {
      const me = l.players.find((p) => p.sid === net.mySid);
      useGame.getState().patchMp({
        code: l.code,
        isHost: l.host === net.mySid,
        players: l.players.map((p) => ({
          sid: p.sid, slot: p.slot, name: p.name, ready: p.ready, self: p.sid === net.mySid,
        })),
        slot: me?.slot ?? 0,
      });
      // a later joiner EXTENDS the deadline (or arms it) — adopt the relay's stamp
      if (l.phase === "lobby" && l.lobbyEndsAt && l.lobbyEndsAt > Date.now()) {
        useGame.getState().patchMp({ matchEndsAt: l.lobbyEndsAt });
      }
    });
    return unLobby;
  }, []);

  /* ---- the shared clock: render + launch exactly once when it fires ---- */
  useEffect(() => {
    const t = setInterval(() => {
      const endsAt = useGame.getState().mp.matchEndsAt;
      if (!endsAt) return; // still matching…
      const msLeft = endsAt - Date.now();
      setLeft(Math.max(0, Math.ceil(msLeft / 1000)));
      if (msLeft <= 0 && !launchedRef.current) launch();
    }, 250);
    return () => clearInterval(t);
  }, []);

  /** 🚀 the night launches — GameRoot's mpStartRun boots everyone together */
  const launch = () => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    useGame.getState().patchMp({ matchEndsAt: 0, matchMode: "" });
    useGame.getState().mpStartRun?.();
  };

  const leaveLobby = () => {
    launchedRef.current = true; // no auto-launch after we leave
    import("@/lib/game/net/matchlobby").then(({ leaveMatchmaking }) => leaveMatchmaking());
    setScreen("landing");
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(mp.code).then(() => pushToast("📋 Code copied — send it to a friend!", "good")).catch(() => {});
  };

  /* ---------- derived ---------- */
  const realCount = Math.max(1, mp.players.length || 1);
  const mode = mp.matchMode;
  const matching = left === null;
  const pct = matching ? 0 : Math.max(0, Math.min(1, (left ?? 0) / (LOBBY_MS / 1000)));
  const R = 66;
  const CIRC = 2 * Math.PI * R;

  const banner =
    mode === "relobby" ? (
      <div className="rounded-2xl border border-rose-400/40 bg-rose-950/60 px-4 py-2.5 text-center text-sm font-bold text-rose-200 shadow-lg backdrop-blur-md">
        🔴 A night is already running — it <b>restarts fresh</b> when the timer fires, so everyone plays together.
      </div>
    ) : mode === "solo" ? (
      <div className="rounded-2xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-center text-sm font-bold text-slate-300 shadow-lg backdrop-blur-md">
        📴 Matchmaking offline — a <b>solo night</b> starts when the timer fires (your world still joins the relay if it comes back).
      </div>
    ) : (
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-950/60 px-4 py-2.5 text-center text-sm font-bold text-emerald-200 shadow-lg backdrop-blur-md">
        ⚡ Waiting for survivors — share the code! Friends who <b>⚡ Quick join</b> land in THIS lobby.
      </div>
    );

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto">
      {/* 🌙 cinematic night-town backdrop — the drop zone you are about to enter */}
      <div
        aria-hidden
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/hero-lobby-night.png)" }}
      />
      <div aria-hidden className="fixed inset-0 bg-slate-950/72" />
      <div aria-hidden className="fixed inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/35 to-slate-950/90" />

      <div className="relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-4 px-4 py-8 text-center">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <h1
            className="text-3xl font-black tracking-tight text-amber-100"
            style={{ textShadow: "0 0 24px rgba(251,191,36,0.35), 0 2px 12px rgba(0,0,0,0.8)" }}
          >
            🏟️ Match Lobby
          </h1>
          <p className="mt-1 text-sm font-semibold text-slate-300/90" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.8)" }}>
            {mode === "relobby"
              ? "Regathering the squad for a fresh night"
              : "The 7 nights launch together — PUBG style"}
          </p>
        </motion.div>

        {/* the shared countdown ring */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          className="relative grid place-items-center"
          role="timer"
          aria-label={matching ? "Matching — connecting to matchmaking" : `${left} seconds until the match starts`}
        >
          <div
            aria-hidden
            className="absolute inset-2 rounded-full"
            style={{
              background: mode === "relobby"
                ? "radial-gradient(circle, rgba(251,113,133,0.28) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(251,191,36,0.28) 0%, transparent 70%)",
            }}
          />
          <svg width="170" height="170" viewBox="0 0 170 170" className="-rotate-90">
            <circle cx="85" cy="85" r={R} fill="rgba(2,6,23,0.55)" stroke="rgba(255,255,255,0.14)" strokeWidth="10" />
            <circle
              cx="85" cy="85" r={R} fill="none"
              stroke={mode === "relobby" ? "#fb7185" : "#fbbf24"}
              strokeWidth="10" strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - pct)}
              style={{ transition: "stroke-dashoffset 0.3s linear", filter: "drop-shadow(0 0 6px rgba(251,191,36,0.55))" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            {matching ? (
              <div className="animate-pulse text-sm font-black uppercase tracking-widest text-amber-200">Matching…</div>
            ) : (
              <div>
                <div className="text-6xl font-black tabular-nums text-white" style={{ textShadow: "0 2px 14px rgba(0,0,0,0.85)" }}>{left}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-300">seconds</div>
              </div>
            )}
          </div>
        </motion.div>

        {banner}

        {/* room code */}
        {mp.code ? (
          <button
            onClick={copyCode}
            className="rounded-2xl border border-white/15 bg-slate-950/55 px-6 py-3 shadow-lg backdrop-blur-md transition hover:border-amber-300/40 hover:bg-slate-900/70"
            title="Click to copy the room code"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">Room code — click to copy</div>
            <div className="font-mono text-4xl font-black tracking-[0.35em]" style={{ color: codeToColor(mp.code) }}>
              {mp.code}
            </div>
          </button>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/20 bg-slate-950/50 px-6 py-3 text-xs font-semibold text-slate-400 backdrop-blur-md">
            No room — starting a solo session
          </div>
        )}

        {/* squad roster */}
        <div className="w-full rounded-2xl border border-white/12 bg-slate-950/55 p-4 shadow-lg backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
            <span>Real survivors</span>
            <span>{realCount}/8 souls</span>
          </div>
          <div className="space-y-1.5">
            {(mp.players.length ? mp.players : [{ sid: "me", slot: mp.slot, name: useGame.getState().playerName || "You", ready: true, self: true }]).map((p) => (
              <div key={p.sid} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-left">
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black text-slate-950"
                  style={{ backgroundColor: SLOT_COLORS[p.slot % SLOT_COLORS.length] }}
                >
                  P{p.slot + 1}
                </span>
                <span className="flex-1 truncate text-sm font-bold text-slate-100">
                  {p.name}
                  {p.self && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                </span>
                {p.sid === net.lobby?.host && <span title="Host" className="text-sm">👑</span>}
                <span className="text-[10px] font-black uppercase text-emerald-400">ready</span>
              </div>
            ))}
          </div>
        </div>

        {/* actions */}
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          {mp.isHost && mode !== "solo" && (
            <Button
              onClick={launch}
              className="h-12 flex-1 bg-amber-500 text-lg font-black text-slate-950 shadow-lg shadow-amber-500/25 hover:bg-amber-400"
            >
              🚀 Launch now
            </Button>
          )}
          <Button
            onClick={leaveLobby}
            variant="outline"
            className="h-12 flex-1 rounded-2xl border-rose-300/40 bg-rose-500/10 font-bold text-rose-200 hover:bg-rose-500/25"
          >
            🏠 Main menu
          </Button>
        </div>

        <p className="pb-2 text-[11px] font-semibold text-slate-400" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.8)" }}>
          When the timer fires, every lobby member drops into the same town at the same moment — the night syncs in real time from there.
        </p>
      </div>
    </div>
  );
}
