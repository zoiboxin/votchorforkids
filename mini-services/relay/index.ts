/**
 * 7Nights Multiplayer Relay
 * -------------------------
 * A lightweight socket.io relay that glues co-op sessions together:
 *   • sessions with 4-char codes (max 8 real souls), host election + migration
 *   • `mp:quick` — AUTO-MATCHMAKING: drop into the current live session (one
 *     bot's seat is freed for you on the clients); if every session is full,
 *     a brand-new session is opened and you host it
 *   • `mp:state`  — binary player state stream (9 bytes/soul @ ~12 Hz) fan-out
 *   • `mp:event`  — reliable JSON gameplay events (phase, roster, damage, kills…)
 *   • `mp:lobby`  — create / join / leave / ready / start + roster broadcasts
 *   • `mp:chat`   — quick chat
 *
 * The relay is transport-dumb about gameplay — it only sniffs the `start`
 * event to know which sessions are LIVE (those accept mid-game joins).
 * Deterministic worlds (seed 1337) do the heavy lifting client-side.
 */
import { Server } from "socket.io";

const PORT = 3030;
const MAX_PLAYERS = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/1/O/0 — kid-proof codes

interface Member {
  sid: string;
  slot: number;
  name: string;
  ready: boolean;
  /** serialized Appearance — relayed verbatim so every client renders the same survivor */
  look: unknown;
}

interface Room {
  code: string;
  hostSid: string;
  members: Map<string, Member>; // socket.id → member
  createdAt: number;
  /** true once the host started the 7 nights — live sessions take mid-game joins */
  started: boolean;
}

const rooms = new Map<string, Room>();
const memberRoom = new Map<string, string>(); // socket.id → room code

const makeCode = (): string => {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(c) ? makeCode() : c;
};

const sanitizeName = (n: unknown): string => {
  const s = String(n ?? "").replace(/[^\w .\-]/g, "").trim().slice(0, 16);
  return s || "Survivor";
};

const lobbyPayload = (room: Room) => ({
  code: room.code,
  host: room.hostSid,
  players: [...room.members.values()].map((m) => ({
    sid: m.sid, slot: m.slot, name: m.name, ready: m.ready, look: m.look,
  })),
});

const roomOf = (sid: string): Room | null => {
  const code = memberRoom.get(sid);
  return code ? (rooms.get(code) ?? null) : null;
};

/** Drop a socket from its room; migrate host if needed; prune empty rooms. */
function leaveRoom(io: Server, sid: string) {
  const room = roomOf(sid);
  if (!room) return;
  const m = room.members.get(sid);
  room.members.delete(sid);
  memberRoom.delete(sid);
  io.to(room.code).emit("mp:lobby", { t: "left", sid, by: m?.name ?? "someone" });
  if (room.members.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostSid === sid) {
    // host migration — the first remaining member takes the crown
    const next = [...room.members.values()][0];
    room.hostSid = next.sid;
    io.to(room.code).emit("mp:lobby", { t: "host", sid: next.sid, name: next.name });
  }
  io.to(room.code).emit("mp:lobby", { t: "roster", lobby: lobbyPayload(room) });
}

/** Seat a socket into a room (shared by mp:join + mp:quick): free slot, roster fan-out. */
function seatInRoom(io: Server, sock: { join: (c: string) => void; id: string; data: { name?: string } }, room: Room, name: string, look: unknown): number {
  // reuse a freed slot, else take the next one
  const used = new Set([...room.members.values()].map((m) => m.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  sock.join(room.code);
  memberRoom.set(sock.id, room.code);
  sock.data.name = name;
  room.members.set(sock.id, { sid: sock.id, slot, name, ready: false, look: look ?? null });
  sock.to(room.code).emit("mp:lobby", { t: "join", name, by: name });
  io.to(room.code).emit("mp:lobby", { t: "roster", lobby: lobbyPayload(room) });
  return slot;
}

function createRoom(hostSid: string): Room {
  const room: Room = { code: makeCode(), hostSid, members: new Map(), createdAt: Date.now(), started: false };
  rooms.set(room.code, room);
  return room;
}

export const io = new Server(PORT, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
  pingInterval: 8000,
  pingTimeout: 12000,
});

io.on("connection", (sock) => {
  sock.data.name = "Survivor";

  /* ---------------- lobby lifecycle ---------------- */
  sock.on("mp:create", (p: { name?: string; look?: unknown } = {}, ack?: (r: unknown) => void) => {
    if (roomOf(sock.id)) return ack?.({ ok: false, err: "Already in a room" });
    const room: Room = {
      code: makeCode(),
      hostSid: sock.id,
      members: new Map(),
      createdAt: Date.now(),
      started: false,
    };
    rooms.set(room.code, room);
    sock.join(room.code);
    memberRoom.set(sock.id, room.code);
    const member: Member = { sid: sock.id, slot: 0, name: sanitizeName(p.name), ready: true, look: p.look ?? null };
    sock.data.name = member.name;
    room.members.set(sock.id, member);
    ack?.({ ok: true, code: room.code, lobby: lobbyPayload(room) });
  });

  sock.on("mp:join", (p: { code?: string; name?: string; look?: unknown } = {}, ack?: (r: unknown) => void) => {
    if (roomOf(sock.id)) return ack?.({ ok: false, err: "Already in a room" });
    const code = String(p.code ?? "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, err: "Room not found — check the code" });
    if (room.members.size >= MAX_PLAYERS) return ack?.({ ok: false, err: "Room is full (8 souls max)" });
    seatInRoom(io, sock, room, sanitizeName(p.name), p.look);
    ack?.({ ok: true, code: room.code, lobby: lobbyPayload(room) });
  });

  /* ---------------- ⚡ auto-matchmaking ----------------
   * "Join the current game": drop into the fullest LIVE session first (one
   * bot's seat is freed for you client-side), else any open lobby; only when
   * EVERY session is full does this soul open a brand-new one (as host). */
  sock.on("mp:quick", (p: { name?: string; look?: unknown } = {}, ack?: (r: unknown) => void) => {
    const name = sanitizeName(p.name);
    const existing = roomOf(sock.id);
    if (existing) return ack?.({ ok: true, code: existing.code, lobby: lobbyPayload(existing), started: existing.started });
    const open = [...rooms.values()].filter((r) => r.members.size < MAX_PLAYERS);
    const live = open.filter((r) => r.started);
    const pool = live.length ? live : open; // live nights win — that's "join the current game"
    pool.sort((a, b) => b.members.size - a.members.size); // fullest session first
    if (pool[0]) {
      const room = pool[0];
      seatInRoom(io, sock, room, name, p.look);
      ack?.({ ok: true, code: room.code, lobby: lobbyPayload(room), started: room.started });
      return;
    }
    // every session is full (or none exists) — open a fresh one, this soul hosts it
    const room = createRoom(sock.id);
    sock.join(room.code);
    memberRoom.set(sock.id, room.code);
    sock.data.name = name;
    room.members.set(sock.id, { sid: sock.id, slot: 0, name, ready: true, look: p.look ?? null });
    ack?.({ ok: true, code: room.code, lobby: lobbyPayload(room), started: false });
  });

  /* session browser — tiny ops/debug helper */
  sock.on("mp:sessions", (_p: unknown, ack?: (r: unknown) => void) => {
    ack?.({
      ok: true,
      sessions: [...rooms.values()].map((r) => ({
        code: r.code, souls: r.members.size, full: r.members.size >= MAX_PLAYERS, live: r.started,
      })),
    });
  });

  sock.on("mp:ready", (ready: boolean) => {
    const room = roomOf(sock.id);
    const m = room?.members.get(sock.id);
    if (!room || !m) return;
    m.ready = !!ready;
    io.to(room.code).emit("mp:lobby", { t: "roster", lobby: lobbyPayload(room) });
  });

  sock.on("mp:name", (name: string) => {
    const room = roomOf(sock.id);
    const m = room?.members.get(sock.id);
    if (!m) { sock.data.name = sanitizeName(name); return; }
    m.name = sanitizeName(name);
    sock.data.name = m.name;
    io.to(room.code).emit("mp:lobby", { t: "roster", lobby: lobbyPayload(room) });
  });

  sock.on("mp:leave", () => leaveRoom(io, sock.id));

  /* ---------------- gameplay streams ---------------- */
  // binary player-state fan-out (9 bytes per soul — see protocol.ts); browsers
  // deliver it as ArrayBuffer, the server-side relays it as Buffer — accept both
  sock.on("mp:state", (buf: Buffer | ArrayBuffer | Uint8Array) => {
    const room = roomOf(sock.id);
    const len = buf instanceof Buffer ? buf.length : (buf as Uint8Array)?.byteLength ?? 0;
    if (!room || !buf || len === 0 || len > 512) return;
    sock.data.slot = room.members.get(sock.id)?.slot ?? sock.data.slot ?? 0;
    if (process.env.MP_DEBUG) console.log(`[relay] state slot=${sock.data.slot} room=${room.code} len=${len}`);
    sock.to(room.code).emit("mp:state", buf instanceof Buffer ? buf : Buffer.from(buf as Uint8Array), sock.data.slot);
  });

  /* reliable gameplay events (phase clock, possession roster, damage, kills…)
   * 🔎 sniff only the START event so the relay knows which sessions are live */
  sock.on("mp:event", (ev: Record<string, unknown>) => {
    const room = roomOf(sock.id);
    if (!room || !ev || typeof ev !== "object") return;
    if ((ev as { t?: string }).t === "start") room.started = true;
    const m = room.members.get(sock.id);
    // stamp the sender's slot so clients can attribute events (host stamps `phase`/`roster`)
    sock.to(room.code).emit("mp:event", { ...ev, s: m?.slot ?? 0 });
  });

  /* ---------------- chat ---------------- */
  sock.on("mp:chat", (msg: unknown) => {
    const room = roomOf(sock.id);
    if (!room) return;
    const text = String(msg ?? "").slice(0, 120);
    if (!text.trim()) return;
    // the member map is the source of truth — sock.data is just a cache
    const name = room.members.get(sock.id)?.name ?? sock.data.name ?? "Survivor";
    io.to(room.code).emit("mp:chat", { name, msg: text, at: Date.now() });
  });

  /* latency probe — acks immediately so the client can time the round trip */
  sock.on("mp:ping", (_p: unknown, ack?: (r: unknown) => void) => ack?.({ t: Date.now() }));

  /* ---------------- teardown ---------------- */
  sock.on("disconnect", () => leaveRoom(io, sock.id));
});

// stats heartbeat — tiny ops insight at / (helps confirm the relay is alive)
setInterval(() => {
  let souls = 0, live = 0;
  for (const r of rooms.values()) { souls += r.members.size; if (r.started) live++; }
  if (rooms.size) console.log(`[relay] sessions=${rooms.size} live=${live} souls=${souls}`);
}, 15000);

console.log(`🔥 7Nights relay listening on :${PORT}`);
