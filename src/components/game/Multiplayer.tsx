"use client";

/**
 * Multiplayer — the co-op lobby: create a room / join a code / see the souls /
 * ready-up / host starts the 7 nights / quick chat.
 *
 * Flow: Landing "🌐 Multiplayer" → this panel. Host presses START → everyone's
 * GameRoot flips to "connecting" → engine boots with attachNet() → one shared
 * night. The relay never sees gameplay — it just mirrors rooms.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGame } from "./store";
import { net, type LobbyPlayer } from "@/lib/game/net/client";
import type { Appearance } from "@/lib/game/constants";
import { useGame as storeHook } from "./store";

// 🔍 always-probeable store + net handles (debug/automation hooks survive
// whether or not a run ever started — startGame's first-run path used to be
// the only place these landed, which made lobby-side debugging blind)
declare global { interface Window { __vcStore?: typeof storeHook; __net?: typeof net } }
if (typeof window !== "undefined") {
  window.__vcStore = storeHook;
  window.__net = net;
}

const SLOT_COLORS = ["#f472b6", "#fbbf24", "#4ade80", "#2dd4bf", "#f87171", "#c084fc", "#fb923c", "#a3e635"];

function codeToColor(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  return SLOT_COLORS[Math.abs(h) % SLOT_COLORS.length];
}

export function Multiplayer() {
  const screen = useGame((s) => s.screen);
  const look = useGame((s) => s.look);
  const playerName = useGame((s) => s.playerName);
  const mp = useGame((s) => s.mp);
  const setMpOpen = useGame((s) => s.setMpOpen);
  const patchMp = useGame((s) => s.patchMp);
  const pushMpChat = useGame((s) => s.pushMpChat);
  const pushToast = useGame((s) => s.pushToast);
  const setScreen = useGame((s) => s.setScreen);

  const [name, setName] = useState(playerName);
  const [joinCode, setJoinCode] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const startRun = useGame.getState().mpStartRun; // wired by GameRoot below

  /* ---- net client callbacks → store ---- */
  useEffect(() => {
    const unLobby = net.onLobby((l) => {
      const me = l.players.find((p) => p.sid === net.mySid);
      patchMp({
        code: l.code,
        isHost: l.host === net.mySid,
        players: l.players.map((p) => ({
          sid: p.sid, slot: p.slot, name: p.name, ready: p.ready, self: p.sid === net.mySid,
        })),
        slot: me?.slot ?? 0,
      });
    });
    const unState = net.onStateChange((s, err) => {
      if (s === "error" && err) patchMp({ error: err, busy: false });
    });
    const unChat = net.onChat((n, m) => pushMpChat(n, m));
    const unJoin = net.onPeerJoin((n) => pushToast(`🌐 ${n} joined the room!`, "good"));
    const unLeave = net.onPeerLeave((n) => pushToast(`🌐 ${n} left the room`, "info"));
    // 🌐 the host started — every guest auto-launches into the same night
    const unStart = net.on("start", () => {
      if (!net.isHost && useGame.getState().screen !== "play") useGame.getState().mpStartRun?.();
    });
    return () => { unLobby(); unState(); unChat(); unJoin(); unLeave(); unStart(); };
  }, [patchMp, pushMpChat, pushToast]);

  // ping chip
  useEffect(() => {
    const t = setInterval(() => patchMp({ ping: net.ping }), 1500);
    return () => clearInterval(t);
  }, [patchMp]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mp.chat.length]);

  const doCreate = useCallback(async () => {
    patchMp({ busy: true, error: "" });
    useGame.getState().setName(name);
    try {
      const lobby = await net.create(name || "Survivor", look as Appearance);
      patchMp({
        busy: false, code: lobby.code, isHost: true, error: "",
        players: lobby.players.map((p) => ({ sid: p.sid, slot: p.slot, name: p.name, ready: p.ready, self: p.sid === net.mySid })),
      });
      pushToast(`🌐 Room ${lobby.code} created — share the code!`, "good");
    } catch (e) {
      patchMp({ busy: false, error: e instanceof Error ? e.message : "Could not create room" });
    }
  }, [name, look, patchMp, pushToast]);

  const doJoin = useCallback(async () => {
    const code = joinCode.toUpperCase().trim();
    if (code.length !== 4) { patchMp({ error: "Enter the 4-letter room code" }); return; }
    patchMp({ busy: true, error: "" });
    useGame.getState().setName(name);
    try {
      const lobby = await net.join(code, name || "Survivor", look as Appearance);
      patchMp({
        busy: false, code: lobby.code, isHost: lobby.host === net.mySid, error: "",
        players: lobby.players.map((p) => ({ sid: p.sid, slot: p.slot, name: p.name, ready: p.ready, self: p.sid === net.mySid })),
      });
      pushToast(net.sessionStarted ? "⚡ Joined a LIVE night — dropping you in!" : `🌐 Joined room ${lobby.code}!`, "good");
    } catch (e) {
      patchMp({ busy: false, error: e instanceof Error ? e.message : "Could not join" });
    }
  }, [joinCode, name, look, patchMp, pushToast]);

  /* ⚡ auto-matchmaking — one click: drop into the current live session (a bot
   * frees their seat for you), the fullest open lobby, or a brand-new session
   * when every other one is full. */
  const doQuick = useCallback(async () => {
    patchMp({ busy: true, error: "" });
    useGame.getState().setName(name);
    try {
      const r = await net.quick(name || "Survivor", look as Appearance);
      patchMp({
        busy: false, code: r.lobby.code, isHost: r.lobby.host === net.mySid, error: "",
        players: r.lobby.players.map((p) => ({ sid: p.sid, slot: p.slot, name: p.name, ready: p.ready, self: p.sid === net.mySid })),
      });
      if (r.started) {
        pushToast("⚡ Night already running — a bot freed their seat for you!", "good");
        // 💫 drop straight in — the auto-launch effect below is the backstop for
        // by-code joins; here we fire immediately (the screen guard inside
        // mpStartRun keeps a double-launch harmless)
        setTimeout(() => useGame.getState().mpStartRun?.(), 350);
      } else if (r.lobby.players.length > 1) {
        pushToast(`🌐 Joined an open session (${r.lobby.players.length} souls waiting)!`, "good");
      } else {
        pushToast(`🌐 New session ${r.lobby.code} opened — you host. Share the code!`, "good");
      }
    } catch (e) {
      patchMp({ busy: false, error: e instanceof Error ? e.message : "Could not join a session" });
    }
  }, [name, look, patchMp, pushToast]);

  /* a live session + not the host = drop straight into the running night
   * (covers quick-join AND joining-by-code while the week is underway) */
  const inRoom = !!mp.code;
  const joiningLive = inRoom && net.sessionStarted && !net.isHost;
  useEffect(() => {
    if (!inRoom || !net.sessionStarted || net.isHost) return;
    const t = setTimeout(() => {
      if (useGame.getState().screen === "landing" || useGame.getState().screen === "lobby") {
        useGame.getState().mpStartRun?.();
      }
    }, 900);
    return () => clearTimeout(t);
  }, [inRoom, mp.code]);

  const doLeave = useCallback(() => {
    net.leave();
    patchMp({ code: "", players: [], error: "", busy: false, chat: [], isHost: false });
    setMpOpen(false);
    setScreen("landing");
  }, [patchMp, setMpOpen, setScreen]);

  const sendChat = useCallback(() => {
    const m = chatMsg.trim();
    if (!m) return;
    net.chat(m);
    setChatMsg("");
  }, [chatMsg]);

  const players: LobbyPlayer[] = (net.lobby?.players ?? []) as LobbyPlayer[];
  const readyCount = players.filter((p) => p.ready || p.sid === net.lobby?.host).length;
  const myPlayer = players.find((p) => p.sid === net.mySid);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950/60">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-8">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-amber-100">🌐 Multiplayer Nights</h1>
            <p className="mt-1 text-sm text-slate-400">
              Survive the 7 nights <b className="text-slate-200">together</b> — up to 8 real souls in one town.
              The beast pack grows with every player…
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => (inRoom ? doLeave() : setMpOpen(false))}>
            {inRoom ? "Leave room" : "✕ Close"}
          </Button>
        </div>

        {/* connection error */}
        {mp.error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            ⚠ {mp.error}
          </div>
        )}

        {!inRoom ? (
          <div className="grid gap-4 md:grid-cols-2">
            {/* name */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Survivor name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 16))}
                placeholder="What do they call you?"
                className="mt-2 border-white/15 bg-slate-900/60 text-slate-100"
              />
              <p className="mt-2 text-xs text-slate-500">Your creator outfit is used — customize it on the home page first if you like.</p>
            </div>

            {/* ⚡ quick join — the ONE-CLICK path into the current game */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-5 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-cyan-200">⚡ Quick join — drop into the current night</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Matches you into the live session instantly — <b className="text-slate-200">one bot frees their seat for you</b> (100 souls, always).
                    Every session full? A fresh session opens with you as host.
                  </p>
                </div>
                <Button
                  onClick={doQuick}
                  disabled={mp.busy || !name.trim()}
                  className="h-12 min-w-52 bg-cyan-400 font-black text-slate-950 hover:bg-cyan-300"
                >
                  {mp.busy ? "Matching…" : "⚡ Quick join"}
                </Button>
              </div>
            </motion.div>

            {/* create */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
              <h2 className="text-lg font-black text-amber-200">🏰 Host a night</h2>
              <p className="mt-1 text-sm text-slate-400">Create a room and share the 4-letter code. You&apos;ll own the story clock.</p>
              <Button
                onClick={doCreate}
                disabled={mp.busy || !name.trim()}
                className="mt-4 w-full bg-amber-500 font-black text-slate-950 hover:bg-amber-400"
              >
                {mp.busy ? "Connecting…" : "Create room"}
              </Button>
            </motion.div>

            {/* join */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-black text-teal-200">🚪 Join a night</h2>
              <p className="mt-1 text-sm text-slate-400">Got a code from a friend? Type it and dive into their town.</p>
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
                placeholder="ABCD"
                className="mt-4 border-white/15 bg-slate-900/60 text-center text-2xl font-black uppercase tracking-[0.4em] text-teal-100"
              />
              <Button
                onClick={doJoin}
                disabled={mp.busy || joinCode.length !== 4}
                className="mt-4 w-full bg-teal-500 font-black text-slate-950 hover:bg-teal-400"
              >
                {mp.busy ? "Connecting…" : "Join room"}
              </Button>
            </motion.div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-5">
            {/* ⚡ live session banner — dropping into the running night */}
            {joiningLive && (
              <div className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-3 text-sm font-bold text-cyan-100 md:col-span-5">
                🔴 Night in progress — dropping you into the running session (a bot freed their seat)…
              </div>
            )}
            {/* room + players */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Room code</div>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(mp.code).then(() => pushToast("📋 Code copied!", "good")).catch(() => {}); }}
                    className="font-mono text-4xl font-black tracking-[0.3em] transition hover:opacity-80"
                    style={{ color: codeToColor(mp.code) }}
                    title="Click to copy"
                  >
                    {mp.code}
                  </button>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 font-bold text-emerald-300">
                    ● LIVE · {mp.ping || "–"} ms
                  </div>
                  <div className="mt-1">{players.length}/8 souls</div>
                  <div className="mt-1">{readyCount}/{players.length} ready</div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {players.map((p) => (
                  <div
                    key={p.sid}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2"
                  >
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black text-slate-950"
                      style={{ backgroundColor: SLOT_COLORS[p.slot % SLOT_COLORS.length] }}
                    >
                      P{p.slot + 1}
                    </span>
                    <span className="flex-1 truncate font-bold text-slate-100">
                      {p.name}
                      {p.sid === net.lobby?.host && <span className="ml-1.5" title="Host">👑</span>}
                      {p.sid === net.mySid && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                    </span>
                    <span className={`text-xs font-bold ${p.ready || p.sid === net.lobby?.host ? "text-emerald-400" : "text-slate-500"}`}>
                      {p.ready || p.sid === net.lobby?.host ? "✔ READY" : "…"}
                    </span>
                  </div>
                ))}
                {players.length < 2 && (
                  <div className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-xs text-slate-500">
                    Share the code — more souls = bigger beast pack 🐾
                  </div>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                {net.lobby?.host === net.mySid ? (
                  <Button
                    onClick={() => startRun?.()}
                    className="flex-1 bg-amber-500 font-black text-slate-950 hover:bg-amber-400"
                  >
                    🌙 Start the 7 nights ({players.length})
                  </Button>
                ) : (
                  <Button
                    onClick={() => net.setReady(!myPlayer?.ready)}
                    className={`flex-1 font-black ${myPlayer?.ready ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"}`}
                  >
                    {myPlayer?.ready ? "Cancel ready" : "✔ I'm ready"}
                  </Button>
                )}
                {net.lobby?.host === net.mySid && (
                  <Button variant="outline" onClick={() => net.setReady(true)} className="border-white/15 text-slate-200">
                    Force start
                  </Button>
                )}
              </div>
              {net.lobby?.host !== net.mySid && (
                <p className="mt-2 text-center text-xs text-slate-500">Waiting for the host 👑 to start the first night…</p>
              )}
            </div>

            {/* chat */}
            <div className="flex max-h-[420px] flex-col rounded-2xl border border-white/10 bg-white/5 md:col-span-2">
              <div className="border-b border-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Campfire chat
              </div>
              <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm">
                {mp.chat.length === 0 && <div className="text-xs text-slate-500">Say hi to your fellow survivors…</div>}
                {mp.chat.map((c, i) => (
                  <div key={i}>
                    <span className="font-bold text-amber-200">{c.name}:</span>{" "}
                    <span className="text-slate-300">{c.msg}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2 border-t border-white/10 p-3">
                <Input
                  value={chatMsg}
                  onChange={(e) => setChatMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder="Type…"
                  className="border-white/15 bg-slate-900/60 text-slate-100"
                />
                <Button size="sm" onClick={sendChat} className="bg-amber-500 font-black text-slate-950 hover:bg-amber-400">
                  ➤
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* how it works */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">
          <h3 className="font-black text-slate-200">How co-op works</h3>
          <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
            <li>🌙 The host owns the story clock &amp; the possession dice.</li>
            <li>🐾 <b className="text-slate-200">Any soul can turn</b> — beasts hunt everyone, and a player-beast&apos;s claws reach across the wire.</li>
            <li>💰 Loot, builds &amp; clues sync instantly — hoard together, barricade together.</li>
            <li>🔮 Accusations (R) stay <b className="text-slate-200">yours alone</b> — read the clues, bet your points.</li>
            <li>⚡ Position streams use 9-byte binary packets @12 Hz — runs on school Wi-Fi.</li>
            <li>⏱️ Died? Your run ends, the night goes on. The host can restart the week for all.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
