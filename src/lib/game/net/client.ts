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
import { Interp, packState, unpackState, type NetState } from "./protocol";
import type { Appearance } from "../constants";

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
}

export type ConnState = "idle" | "connecting" | "lobby" | "room" | "error" | "closed";

/** Every wire event the gameplay layer understands (relay stamps `s` = sender slot). */
export type MpEvent =
  | { t: "phase"; phase: string; nightNo: number; phaseLeft: number }
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
  private evHandlers = new Map<EventKind, Set<(ev: MpEvent, fromSlot: number) => void>>();
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private publishFn: (() => ArrayBuffer) | null = null;

  code = "";
  isHost = false;
  slot = -1;
  mySid = "";
  state: ConnState = "idle";
  lastError = "";
  lobby: LobbySnapshot | null = null;

  /** ping/pong latency estimate (ms) — HUD chip */
  ping = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /* listeners (multiple subscribers — the lobby panel AND the engine glue both listen) */
  private lobbyListeners = new Set<LobbyListener>();
  private stateListeners = new Set<StateListener>();
  private chatListeners = new Set<ChatListener>();
  private joinListeners = new Set<PeerListener>();
  private leaveListeners = new Set<PeerListener>();

  onLobby(h: LobbyListener): () => void { this.lobbyListeners.add(h); return () => this.lobbyListeners.delete(h); }
  onStateChange(h: StateListener): () => void { this.stateListeners.add(h); return () => this.stateListeners.delete(h); }
  onChat(h: ChatListener): () => void { this.chatListeners.add(h); return () => this.chatListeners.delete(h); }
  onPeerJoin(h: PeerListener): () => void { this.joinListeners.add(h); return () => this.joinListeners.delete(h); }
  onPeerLeave(h: PeerListener): () => void { this.leaveListeners.add(h); return () => this.leaveListeners.delete(h); }

  /* ---------------- lifecycle ---------------- */

  connect(): Promise<void> {
    if (this.sock) return Promise.resolve();
    this.setState("connecting");
    return new Promise((resolve, reject) => {
      // relative URL + gateway port transform — NEVER an absolute localhost URL
      const sock = io("/?XTransformPort=3030", {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 6,
        reconnectionDelay: 900,
        timeout: 8000,
      });
      this.sock = sock;

      sock.on("connect", () => {
        this.mySid = sock.id ?? "";
        this.startPing();
        resolve();
      });
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

      sock.on("mp:event", (ev: MpEvent & { s?: number }) => {
        if (!ev || typeof ev !== "object" || !ev.t) return;
        const from = typeof ev.s === "number" ? ev.s : -1;
        if (from === this.slot) return;
        this.evHandlers.get(ev.t)?.forEach((h) => h(ev as MpEvent, from));
      });

      sock.on("mp:chat", (m: { name: string; msg: string }) => this.chatListeners.forEach((h) => h(m.name, m.msg)));

      sock.io.on("reconnect", () => {
        // rooms die with the old socket — surface it instead of silently spectating
        if (this.code) this.setState("error", "Reconnected — room expired, rejoin from the menu");
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
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.code) this.sock?.emit("mp:leave");
    this.sock?.disconnect();
    this.sock = null;
    this.interps.clear();
    this.code = "";
    this.slot = -1;
    this.lobby = null;
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
        this.slot = r.lobby!.players.find((p) => p.sid === this.mySid)?.slot ?? 0;
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
      this.sock!.emit("mp:join", { code: code.toUpperCase().trim(), name, look }, (r: { ok: boolean; code?: string; lobby?: LobbySnapshot; err?: string }) => {
        clearTimeout(t);
        if (!r.ok) return reject(new Error(r.err ?? "Could not join"));
        this.code = r.code!;
        this.slot = r.lobby!.players.find((p) => p.sid === this.mySid)?.slot ?? 0;
        this.lobby = r.lobby!;
        this.isHost = r.lobby!.host === this.mySid;
        this.setState("room");
        resolve(r.lobby!);
      });
    });
  }

  setReady(ready: boolean) {
    this.sock?.emit("mp:ready", ready);
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

  /** Reliable gameplay event → every peer. */
  send(ev: MpEvent) {
    if (!this.sock?.connected) return;
    this.sock.emit("mp:event", ev);
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

  /** True once we've ever heard from this slot (drives ghost timeouts). */
  knowsRemote(slot: number): boolean {
    return this.interps.has(slot);
  }
}

/** Singleton — the whole app shares one connection. */
export const net = new NetClient();
