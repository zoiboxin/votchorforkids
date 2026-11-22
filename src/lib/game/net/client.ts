/**
 * NetClient — the 7Nights co-op network client.
 *
 * Transport: socket.io → gateway → relay mini-service (:3030).
 *   streams : `mp:state` binary 9-byte survivor snapshots (see protocol.ts)
 *   events  : `mp:event` reliable JSON gameplay events
 *   lobby   : `mp:lobby` / `mp:create` / `mp:join` / `mp:ready` / `mp:start`
 *   chat    : `mp:chat`
 *
 * The world is deterministic (seed 1337), so only *people* travel the wire —
 * terrain, buildings, props and spawn layouts exist identically on every
 * client. Each client is authoritative over its own survivor (position, HP);
 * the host additionally owns the story clock & possession roster.
 */
import { io, type Socket } from "socket.io-client";
import { Interp, packState, unpackAi, unpackState, unpackCar, CARIDX_NONE, type AiEntry, type NetState, type CarState } from "./protocol";
import type { Appearance } from "../constants";

/** 🎲 derive the shared gameplay RNG seed from the room code — every client in
 *  the same session grows IDENTICAL bots / loot / plane schedules from the same
 *  mulberry32 stream (the deterministic-world promise now covers gameplay too). */
export function sessionSeed(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 1000000;
}

export interface LobbyPlayer {
  sid: string;
  slot: number;
  name: string;
  ready: boolean;
  look: Appearance | null;
}

export interface LobbySnapshot {
  code: string;
  host: string;
  players: LobbyPlayer[];
  /** 🏟️ "lobby" = pre-match countdown gathering · "live" = night running */
  phase?: "lobby" | "live";
  /** epoch ms when the shared match-lobby countdown fires (0/absent = none) */
  lobbyEndsAt?: number;
}

export type ConnState = "idle" | "connecting" | "lobby" | "room" | "error" | "closed";

/** Every wire event the gameplay layer understands (relay stamps `s` = sender slot). */
/** 🌐✈️ host-streamed ambient world snapshot riding the 2 Hz phase event:
 *  tr = ring-traffic angles (radians, one per car), pl = [x, z, alt, hdg] per bot plane. */
export interface NetAmbient { tr: number[]; pl: number[][]; }

export type MpEvent =
  | { t: "phase"; phase: string; nightNo: number; phaseLeft: number; clock?: number; amb?: NetAmbient }
  | { t: "roster"; possessed: number[]; beastSlots: number[]; nightNo: number }
  | { t: "crewDeath"; idx: number; clue: string; slain: boolean; loot?: { x: number; z: number; amt: number; label: string } }
  | { t: "dmg"; target: number; amount: number }
  | { t: "claw"; x: number; z: number }
  | { t: "loot"; x: number; z: number; amt: number; label: string }
  | { t: "pickup"; kind: "item" | "loot" | "tool" | "power" | "vote"; id: number; x?: number; z?: number }
  | { t: "build"; kind: "barricade" | "campfire"; x: number; z: number; rot: number }
  | { t: "score"; points: number; kills: number; money: number }
  | { t: "dead" }
  | { t: "gift"; kind: "license"; toSlot: number; from: string }
  | { t: "dropLicense"; x: number; z: number; from: string }
  | { t: "zhit"; kind: "zombie" | "hound"; idx: number; amt: number }
  | { t: "reset" }
  | { t: "start" }
  | { t: "hello" };

type EventKind = MpEvent["t"];

type LobbyListener = (l: LobbySnapshot) => void;
type StateListener = (s: ConnState, err?: string) => void;
type ChatListener = (name: string, msg: string) => void;
type PeerListener = (name: string) => void;

export class NetClient {
  private sock: Socket | null = null;
  private interps = new Map<number, Interp>(); // slot → interpolation buffer
  /** latest mirrored car pose per driving slot (8-byte `mp:car` packets) */
  private carStates = new Map<number, CarState>();
  /** 🤖 mirrored BOT-driven car poses (host streams its joyriders on `mp:botcar`,
   *  keyed by the deterministic car index — guests re-render the exact ride) */
  private botCarStates = new Map<number, CarState>();
  /** 🧟 latest host AI stream per kind (zombies/hunters/hounds) — guests mirror */
  private aiStates = new Map<number, { entries: AiEntry[]; t: number }>();
  private evHandlers = new Map<EventKind, Set<(ev: MpEvent, fromSlot: number) => void>>();
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private publishFn: (() => ArrayBuffer) | null = null;
  private carTimer: ReturnType<typeof setInterval> | null = null;
  private carFn: (() => ArrayBuffer | null) | null = null;

  code = "";
  isHost = false;
  slot = -1;
  mySid = "";
  state: ConnState = "idle";
  lastError = "";
  lobby: LobbySnapshot | null = null;
  /** true while our session's night is already running (host pressed START) —
   *  quick-joiners into a live session auto-launch instead of waiting around */
  sessionStarted = false;

  /** ping/pong latency estimate (ms) — HUD chip */
  ping = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /* listeners (multiple subscribers — the lobby panel AND the engine glue both listen) */
  private lobbyListeners = new Set<LobbyListener>();
  private stateListeners = new Set<StateListener>();
  private chatListeners = new Set<ChatListener>();
  private joinListeners = new Set<PeerListener>();
  private leaveListeners = new Set<PeerListener>();
  private slotListeners = new Set<(s: number) => void>();

  onLobby(h: LobbyListener): () => void { this.lobbyListeners.add(h); return () => this.lobbyListeners.delete(h); }
  onStateChange(h: StateListener): () => void { this.stateListeners.add(h); return () => this.stateListeners.delete(h); }
  onChat(h: ChatListener): () => void { this.chatListeners.add(h); return () => this.chatListeners.delete(h); }
  onPeerJoin(h: PeerListener): () => void { this.joinListeners.add(h); return () => this.joinListeners.delete(h); }
  onPeerLeave(h: PeerListener): () => void { this.leaveListeners.add(h); return () => this.leaveListeners.delete(h); }
  /** fires whenever our seat slot changes (mid-game rejoin after a hiccup) */
  onSlotChange(h: (s: number) => void): () => void { this.slotListeners.add(h); return () => this.slotListeners.delete(h); }
  private setSlot(s: number) {
    if (s === this.slot) return;
    this.slot = s;
    this.slotListeners.forEach((h) => h(s));
  }

  /* ---------------- lifecycle ---------------- */

  connect(): Promise<void> {
    if (this.sock) return Promise.resolve();
    this.setState("connecting");
    return new Promise((resolve, reject) => {
      // relative URL + gateway port transform — NEVER an absolute localhost URL
      const sock = io("/?XTransformPort=3030", {
        transports: ["websocket", "polling"],
        // 🛡️ a stuttery main thread (heavy scene, GC pause, throttled tab) can
        // miss socket heartbeats for many seconds — the old 6-attempt cap left
        // a hitched tab DISCONNECTED forever (its soul ghosted off every peer's
        // screen and sync died silently). Keep trying until the wire breathes
        // again; the relay sweeper + rejoin-by-code heal the seat on return.
        reconnectionAttempts: Infinity,
        reconnectionDelay: 900,
        reconnectionDelayMax: 4000,
        timeout: 8000,
      });
      this.sock = sock;

      sock.on("connect", () => {
        this.mySid = sock.id ?? "";
        this.startPing();
        resolve();
      });

      // the host started (or restarted) the week — remember the session is live
      // so code-joiners / quick-joiners drop straight into the running night
      const markLive = (ev: { t?: string }) => { if (ev?.t === "start") this.sessionStarted = true; };
      sock.on("connect_error", (e: Error) => {
        if (this.state === "connecting") { this.setState("error", e.message); reject(e); }
      });
      sock.on("disconnect", () => {
        if (this.state !== "closed" && this.state !== "idle") this.setState("error", "Connection lost");
      });

      sock.on("mp:lobby", (m: { t: string; lobby?: LobbySnapshot; name?: string; sid?: string; by?: string }) => {
        if (m.t === "roster" && m.lobby) {
          this.lobby = m.lobby;
          this.isHost = m.lobby.host === this.mySid;
          this.lobbyListeners.forEach((h) => h(m.lobby!));
          if (this.state === "lobby") this.setState("room");
        } else if (m.t === "join") {
          this.joinListeners.forEach((h) => h(m.name ?? "someone"));
        } else if (m.t === "left") {
          this.leaveListeners.forEach((h) => h(m.by ?? "someone"));
        } else if (m.t === "host" && m.sid === this.mySid) {
          this.isHost = true;
        }
      });

      sock.on("mp:state", (buf: Buffer, slot: number) => {
        const s = unpackState(buf, performance.now());
        if (!s) return;
        if (Number.isFinite(slot)) s.slot = slot;
        if (s.slot === this.slot) return;
        let ip = this.interps.get(s.slot);
        if (!ip) { ip = new Interp(); this.interps.set(s.slot, ip); }
        // first packet (or a teleport-sized jump) snaps instead of easing across the map
        const prev = ip.sample();
        if (!prev || Math.hypot(prev.x - s.x, prev.z - s.z) > 40) ip.snap(s);
        else ip.push(s);
      });

      // 🚗 driver car stream — pose + headlights, mirrored into every peer's world
      sock.on("mp:car", (buf: Buffer, slot: number) => {
        const c = unpackCar(buf);
        if (!c) return;
        if (Number.isFinite(slot)) c.slot = slot;
        if (c.slot === this.slot) return;
        c.t = performance.now(); // arrival stamp — mirrors expire when packets stop
        this.carStates.set(c.slot, c);
      });

      // 🤖 bot joyrider stream — the host's crew cars, keyed by car index (the
      // relay stays transport-dumb; no slot stamp — the packet carries the ci)
      sock.on("mp:botcar", (buf: Buffer) => {
        const c = unpackCar(buf);
        if (!c || c.ci === CARIDX_NONE) return;
        c.slot = -1;
        c.t = performance.now();
        this.botCarStates.set(c.ci, c);
      });

      // 🧟 host AI stream — the night's horde poses (zombies/hunters/hounds).
      // Only the session host publishes; every guest mirrors. The packet itself
      // carries its kind, so one channel serves all three streams.
      sock.on("mp:ai", (buf: Buffer) => {
        const p = unpackAi(buf);
        if (!p) return;
        this.aiStates.set(p.kind, { entries: p.entries, t: performance.now() });
      });

      sock.on("mp:event", (ev: MpEvent & { s?: number }) => {
        if (!ev || typeof ev !== "object" || !ev.t) return;
        markLive(ev);
        const from = typeof ev.s === "number" ? ev.s : -1;
        if (from === this.slot) return;
        this.evHandlers.get(ev.t)?.forEach((h) => h(ev as MpEvent, from));
      });

      sock.on("mp:chat", (m: { name: string; msg: string }) => this.chatListeners.forEach((h) => h(m.name, m.msg)));

      sock.io.on("reconnect", () => {
        this.mySid = sock.id ?? ""; // the sid changes with every new connection
        if (!this.code) return;
        // 🛡️ mid-game hiccup recovery — reclaim our seat in the same session by
        // code. The relay seats us at a (possibly new) slot; the engine glue
        // hears about it through onSlotChange and re-binds everything.
        const me = this.lobby?.players.find((p) => p.sid === this.mySid);
        sock.timeout(6000).emit("mp:join", { code: this.code, name: me?.name ?? "Survivor", look: me?.look ?? null }, (err: unknown, r: { ok: boolean; code?: string; lobby?: LobbySnapshot; err?: string }) => {
          if (err || !r?.ok) {
            this.setState("error", "Session expired — rejoin from the menu");
            return;
          }
          this.lobby = r.lobby!;
          this.isHost = r.lobby!.host === this.mySid;
          this.setSlot(r.lobby!.players.find((p) => p.sid === this.mySid)?.slot ?? this.slot);
          this.interps.clear(); // stale poses from before the drop
          this.setState("room");
        });
      });
    });
  }

  private setState(s: ConnState, err = "") {
    this.state = s;
    if (err) this.lastError = err;
    this.stateListeners.forEach((h) => h(s, err));
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const sock = this.sock;
      if (!sock || !sock.connected) return;
      const t0 = performance.now();
      sock.timeout(800).emit("mp:ping", {}, (err: unknown) => {
        if (!err) this.ping = Math.round(performance.now() - t0);
      });
    }, 3000);
  }

  disconnect() {
    this.stopPublishing();
    this.stopCarPublishing();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.code) this.sock?.emit("mp:leave");
    this.sock?.disconnect();
    this.sock = null;
    this.interps.clear();
    this.carStates.clear();
    this.botCarStates.clear();
    this.aiStates.clear();
    this.code = "";
    this.slot = -1;
    this.lobby = null;
    this.sessionStarted = false;
    this.setState("closed");
  }

  /* ---------------- lobby ---------------- */

  async create(name: string, look: Appearance): Promise<LobbySnapshot> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Relay timeout")), 8000);
      this.sock!.emit("mp:create", { name, look }, (r: { ok: boolean; code?: string; lobby?: LobbySnapshot; err?: string }) => {
        clearTimeout(t);
        if (!r.ok) return reject(new Error(r.err ?? "Could not create room"));
        this.code = r.code!;
        this.setSlot(r.lobby!.players.find((p) => p.sid === this.mySid)?.slot ?? 0);
        this.lobby = r.lobby!;
        this.isHost = true;
        this.setState("room");
        resolve(r.lobby!);
      });
    });
  }

  async join(code: string, name: string, look: Appearance): Promise<LobbySnapshot> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Relay timeout")), 8000);
      this.sock!.emit("mp:join", { code: code.toUpperCase().trim(), name, look }, (r: { ok: boolean; code?: string; lobby?: LobbySnapshot; started?: boolean; err?: string }) => {
        clearTimeout(t);
        if (!r.ok) return reject(new Error(r.err ?? "Could not join"));
        this.code = r.code!;
        this.setSlot(r.lobby!.players.find((p) => p.sid === this.mySid)?.slot ?? 0);
        this.lobby = r.lobby!;
        this.isHost = r.lobby!.host === this.mySid;
        // 🏟️ the relay tells us whether the session's night is ALREADY running —
        // a code-joiner into a live night must route to the match lobby (the
        // whole room restarts together) exactly like a quick-joiner does
        this.sessionStarted = !!r.started;
        this.setState("room");
        resolve(r.lobby!);
      });
    });
  }

  /** ⚡ auto-matchmaking — join the current live session (a bot's seat is freed
   *  for you), else the fullest open lobby; if EVERY session is full a brand
   *  new one opens and you host it. Resolves with whether the night is live. */
  async quick(name: string, look: Appearance): Promise<{ lobby: LobbySnapshot; started: boolean }> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Relay timeout")), 8000);
      this.sock!.emit("mp:quick", { name, look }, (r: { ok: boolean; code?: string; lobby?: LobbySnapshot; started?: boolean; err?: string }) => {
        clearTimeout(t);
        if (!r.ok) return reject(new Error(r.err ?? "Could not join a session"));
        this.code = r.code!;
        this.setSlot(r.lobby!.players.find((p) => p.sid === this.mySid)?.slot ?? 0);
        this.lobby = r.lobby!;
        this.isHost = r.lobby!.host === this.mySid;
        this.sessionStarted = !!r.started;
        this.setState("room");
        resolve({ lobby: r.lobby!, started: !!r.started });
      });
    });
  }

  setReady(ready: boolean) {
    this.sock?.emit("mp:ready", ready);
  }

  /** 🏟️ arm (or extend) the shared match-lobby countdown — the relay stamps
   *  ONE source-of-truth deadline and broadcasts it in the roster payload, so
   *  every client renders the same 30 s clock and launches together. */
  startCountdown(durationMs = 30000) {
    this.sock?.emit("mp:countdown", { durationMs });
  }

  chat(msg: string) {
    this.sock?.emit("mp:chat", msg.slice(0, 120));
  }

  leave() {
    this.disconnect();
  }

  /* ---------------- gameplay streams ---------------- */

  /** Start publishing our survivor snapshot every `hz` ticks (default 12 Hz). */
  startPublishing(pack: () => ArrayBuffer, hz = 12) {
    this.stopPublishing();
    this.publishFn = pack;
    this.publishTimer = setInterval(() => {
      if (!this.sock?.connected || !this.publishFn) return;
      this.sock.emit("mp:state", this.publishFn());
    }, Math.max(20, Math.round(1000 / hz)));
  }

  stopPublishing() {
    if (this.publishTimer) clearInterval(this.publishTimer);
    this.publishTimer = null;
    this.publishFn = null;
  }

  /** 🚗 publish our driven-car snapshot every `hz` ticks (default 15 Hz) — the
   *  pack fn returns null while we're on foot and nothing goes on the wire. */
  startCarPublishing(pack: () => ArrayBuffer | null, hz = 15) {
    this.stopCarPublishing();
    this.carFn = pack;
    this.carTimer = setInterval(() => {
      if (!this.sock?.connected || !this.carFn) return;
      const buf = this.carFn();
      if (buf) this.sock.emit("mp:car", buf);
    }, Math.max(20, Math.round(1000 / hz)));
  }

  stopCarPublishing() {
    if (this.carTimer) clearInterval(this.carTimer);
    this.carTimer = null;
    this.carFn = null;
  }

  /** Reliable gameplay event → every peer. */
  send(ev: MpEvent) {
    if (!this.sock?.connected) return;
    this.sock.emit("mp:event", ev);
  }

  /** 🧟 host-only — publish one AI stream packet (kind is inside the packet). */
  emitAi(buf: ArrayBuffer) {
    if (!this.sock?.connected) return;
    this.sock.emit("mp:ai", buf);
  }

  /** 🤖 host-only — publish one bot-driven car pose (8-byte car packet). */
  emitBotCar(buf: ArrayBuffer) {
    if (!this.sock?.connected) return;
    this.sock.emit("mp:botcar", buf);
  }

  /** 🧟 guests — latest AI entries for a kind (null = no fresh host stream). */
  sampleAi(kind: number): AiEntry[] | null {
    const s = this.aiStates.get(kind);
    if (!s || performance.now() - s.t > 1500) return null;
    return s.entries;
  }

  on<K extends EventKind>(kind: K, h: (ev: Extract<MpEvent, { t: K }>, fromSlot: number) => void): () => void {
    let set = this.evHandlers.get(kind);
    if (!set) { set = new Set(); this.evHandlers.set(kind, set); }
    const wrapped = h as (ev: MpEvent, fromSlot: number) => void;
    set.add(wrapped);
    return () => { set!.delete(wrapped); };
  }

  /** Latest interpolated pose for a remote slot (null = no data yet). */
  sampleRemote(slot: number): NetState | null {
    return this.interps.get(slot)?.sample() ?? null;
  }

  /** 🚗 latest mirrored car pose from a driving slot (null = no data yet). */
  sampleCar(slot: number): CarState | null {
    return this.carStates.get(slot) ?? null;
  }

  /** 🤖 latest mirrored bot-car pose for a car index (null = no fresh stream). */
  sampleBotCar(ci: number): CarState | null {
    return this.botCarStates.get(ci) ?? null;
  }

  /** 🤖 every mirrored bot car (fresh or not — callers stamp staleness). */
  allBotCars(): CarState[] {
    return [...this.botCarStates.values()];
  }

  /** 🤖 prune a bot-car mirror (driver parked / left). */
  dropBotCar(ci: number) {
    this.botCarStates.delete(ci);
  }

  /** True once we've ever heard from this slot (drives ghost timeouts). */
  knowsRemote(slot: number): boolean {
    return this.interps.has(slot);
  }

  /** Socket live? (lets timers skip their work without touching the socket) */
  get sockConnected(): boolean {
    return !!this.sock?.connected;
  }
}

/** Singleton — the whole app shares one connection. */
export const net = new NetClient();
