/**
 * 7Nights Multiplayer Relay
 * -------------------------
 * A lightweight socket.io relay that glues co-op sessions together:
 *   • sessions with 4-char codes (max 8 real souls), host election + migration
 *   • 🏟️ MATCH LOBBY — every session carries a phase:
 *       "lobby" = pre-match gathering (30 s countdown, PUBG-style — players
 *                quick-join INTO the lobby and everyone launches together)
 *       "live"  = the night is running (a joiner waits in a fresh 30 s lobby
 *                and the whole room restarts together when it fires)
 *   • `mp:countdown` — start/extend the shared lobby countdown (any member;
 *     the relay owns the single source-of-truth deadline and fans it out)
 *   • `mp:quick` — AUTO-MATCHMAKING: prefer a lobby that's gathering → then a
 *     live session → then any open room → else open a brand-new one as host
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

/* ---------- 🌐 MatchSessionState — the relay is the SINGLE SOURCE OF TRUTH ----------
 * Every session carries a match state created AT SEAT TIME, before any world
 * is grown. The seed is THE master match seed (see src/lib/game/constants.ts):
 * every client — solo or relayed, first boot or late rejoin — derives the
 * identical town from it (terrain comes from WORLD_SEED; this seed covers
 * bots, loot, tools, powers, licenses, vote cash, cops, crews, the plane
 * schedule and the ✈️ dropship flight path). The seed rides every lobby
 * payload so a client can never guess the wrong world.
 *   CreateSession -> GenerateWorld (deterministic client-side) ->
 *   SyncClients (shared countdown gate) -> StartDrop (shared flight path) ->
 *   LiveMatch (state/event streams + restart-together relobby)
 */
const MASTER_MATCH_SEED = 20241337;

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
  /** 🏟️ "lobby" = pre-match countdown gathering · "live" = night running */
  phase: "lobby" | "live";
  /** epoch ms when the shared lobby countdown fires (0 = no countdown armed) */
  lobbyEndsAt: number;
  /** 🌐 authoritative MatchSessionState — born with the room, echoed in every payload */
  match: { seed: number; createdAt: number; startedAt: number };
}

/* 🔥 hot-reload-proof state — `bun --hot` re-evaluates this module whenever the
 * project churns (dev-mode Next recompiles touch watched files), and a plain
 * top-level `new Map()` would WIPE every live room mid-session (sockets stayed
 * connected, rosters vanished: seats, match state, everything). Stashing the
 * maps on globalThis survives module re-evaluation — same process, same state.
 * Production (`bun index.ts`) never re-evaluates; the guard is pure insurance. */
type RelayStore = { rooms: Map<string, Room>; memberRoom: Map<string, string> };
const gState = globalThis as typeof globalThis & { __relay7n?: RelayStore };
if (!gState.__relay7n) {
  gState.__relay7n = { rooms: new Map(), memberRoom: new Map() };
}
const rooms = gState.__relay7n.rooms;
const memberRoom = gState.__relay7n.memberRoom;

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
  phase: room.phase,
  lobbyEndsAt: room.lobbyEndsAt,
  // 🌐 the authoritative match state — clients grow their world from THIS seed
  seed: room.match.seed,
  match: room.match,
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
  console.log(`[relay] leave ${m?.name ?? sid} room=${room.code} souls=${room.members.size}`);
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
  console.log(`[relay] seat ${name} slot=${slot} room=${room.code} souls=${room.members.size}`);
  return slot;
}

function createRoom(hostSid: string): Room {
  const room: Room = { code: makeCode(), hostSid, members: new Map(), createdAt: Date.now(), started: false, phase: "lobby", lobbyEndsAt: 0, match: { seed: MASTER_MATCH_SEED, createdAt: Date.now(), startedAt: 0 } };
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
  console.log(`[relay] connect ${sock.id}`);
  sock.on("disconnect", (r: string) => console.log(`[relay] disconnect ${sock.id} (${r})`));

  /* ---------------- lobby lifecycle ---------------- */
  sock.on("mp:create", (p: { name?: string; look?: unknown } = {}, ack?: (r: unknown) => void) => {
    if (roomOf(sock.id)) return ack?.({ ok: false, err: "Already in a room" });
    const room: Room = {
      code: makeCode(),
      hostSid: sock.id,
      members: new Map(),
      createdAt: Date.now(),
      started: false,
      phase: "lobby",
      lobbyEndsAt: 0,
      match: { seed: MASTER_MATCH_SEED, createdAt: Date.now(), startedAt: 0 },
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
    // 🏟️ `started` tells the joiner whether the session's night is ALREADY
    // running — they route into the match lobby (restart-together) instead of
    // idling in a room nobody will ever launch again (PUBG-style join-in-progress)
    ack?.({ ok: true, code: room.code, lobby: lobbyPayload(room), started: room.started });
  });

  /* ---------------- 🏟️ match lobby countdown ----------------
   * Any member can arm/extend the shared countdown (a joiner into a LIVE night
   * uses it to call a PUBG-style restart-together). The relay owns the ONE
   * source-of-truth deadline and broadcasts it in every roster payload, so
   * every client renders the same clock and fires the launch together. */
  sock.on("mp:countdown", (p: { durationMs?: number } = {}) => {
    const room = roomOf(sock.id);
    if (!room) return;
    const dur = Math.max(5000, Math.min(120000, Math.round(p.durationMs ?? 30000)));
    room.phase = "lobby";
    room.lobbyEndsAt = Date.now() + dur;
    console.log(`[relay] countdown room=${room.code} ends in ${dur / 1000}s souls=${room.members.size}`);
    io.to(room.code).emit("mp:lobby", { t: "roster", lobby: lobbyPayload(room) });
  });

  /* ---------------- ⚡ auto-matchmaking ----------------
   * "Join the current game" — PUBG-style: prefer a lobby that's GATHERING
   * (countdown running — you land in the pre-match lobby and launch with
   * everyone), then a LIVE session (you wait in a fresh 30 s lobby while the
   * room regathers for a restart-together), then any open lobby; only when
   * EVERY session is full does this soul open a brand-new one (as host). */
  sock.on("mp:quick", (p: { name?: string; look?: unknown } = {}, ack?: (r: unknown) => void) => {
    const name = sanitizeName(p.name);
    const existing = roomOf(sock.id);
    if (existing) return ack?.({ ok: true, code: existing.code, lobby: lobbyPayload(existing), started: existing.started });
    const open = [...rooms.values()].filter((r) => r.members.size < MAX_PLAYERS);
    // rooms still counting down to launch — the ideal landing spot
    const gathering = open.filter((r) => r.phase === "lobby" && r.lobbyEndsAt > Date.now());
    // a live night is only worth joining if its host socket is actually alive —
    // a "live" room with a dead host has no story clock and no one to sync to
    // (the sweeper migrates the crown within ~10 s, healing the room instead)
    const live = open.filter((r) => r.started && io.sockets.sockets.has(r.hostSid));
    const pool = gathering.length ? gathering : live.length ? live : open; // gathering lobbies win
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

  /* 🔍 deep debug — live socket inventory + per-room member liveness. Answers
   * "is that client's socket REALLY in the socket.io room?" (the silent-ghost
   * class of bug: relay roster says seated, broadcasts never arrive). */
  sock.on("mp:debug", (_p: unknown, ack?: (r: unknown) => void) => {
    const adapterRooms: Record<string, string[]> = {};
    for (const [room, sids] of io.sockets.adapter.rooms) adapterRooms[room] = [...sids];
    ack?.({
      ok: true,
      sockets: [...io.sockets.sockets.keys()],
      adapterRooms,
      rooms: [...rooms.values()].map((r) => ({
        code: r.code, phase: r.phase, host: r.hostSid,
        members: [...r.members.values()].map((m) => ({
          sid: m.sid, slot: m.slot, name: m.name,
          socketAlive: io.sockets.sockets.has(m.sid),
        })),
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

  // 🚗 driven-car stream (8-byte pose + headlights packet — see protocol.ts);
  // same transport-dumb fan-out as mp:state, stamped with the sender's slot
  sock.on("mp:car", (buf: Buffer | ArrayBuffer | Uint8Array) => {
    const room = roomOf(sock.id);
    const len = buf instanceof Buffer ? buf.length : (buf as Uint8Array)?.byteLength ?? 0;
    if (!room || !buf || len === 0 || len > 64) return;
    sock.data.slot = room.members.get(sock.id)?.slot ?? sock.data.slot ?? 0;
    sock.to(room.code).emit("mp:car", buf instanceof Buffer ? buf : Buffer.from(buf as Uint8Array), sock.data.slot);
  });

  // 🧟 AI replication stream (host → guests: zombies/hunters/hounds/crew poses,
  // see protocol.ts packAi). Only the host's packets matter but the relay stays
  // transport-dumb — clients that shouldn't publish simply never do. Fan out
  // verbatim like mp:car; the header carries the kind, no slot stamp needed.
  sock.on("mp:ai", (buf: Buffer | ArrayBuffer | Uint8Array) => {
    const room = roomOf(sock.id);
    const len = buf instanceof Buffer ? buf.length : (buf as Uint8Array)?.byteLength ?? 0;
    if (!room || !buf || len < 2 || len > 1200) return;
    sock.to(room.code).emit("mp:ai", buf instanceof Buffer ? buf : Buffer.from(buf as Uint8Array));
  });

  // 🤖 bot joyrider cars — the host's crew fleet (8-byte car packets keyed by
  // the deterministic car index; no slot stamp — the packet carries the ci)
  sock.on("mp:botcar", (buf: Buffer | ArrayBuffer | Uint8Array) => {
    const room = roomOf(sock.id);
    const len = buf instanceof Buffer ? buf.length : (buf as Uint8Array)?.byteLength ?? 0;
    if (!room || !buf || len === 0 || len > 64) return;
    sock.to(room.code).emit("mp:botcar", buf instanceof Buffer ? buf : Buffer.from(buf as Uint8Array));
  });

  /* reliable gameplay events (phase clock, possession roster, damage, kills…)
   * 🔎 sniff only the START event so the relay knows which sessions are live */
  sock.on("mp:event", (ev: Record<string, unknown>) => {
    const room = roomOf(sock.id);
    if (!room || !ev || typeof ev !== "object") return;
    if ((ev as { t?: string }).t === "start") {
      room.started = true;
      room.phase = "live"; // the lobby countdown is done — the night owns the room now
      room.lobbyEndsAt = 0;
      // 🌐 MatchSessionState timeline — stamp the deployment moment (audit + ops)
      if (!room.match.startedAt) room.match.startedAt = Date.now();
    }
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

/* 🧹 staleness sweeper — sockets that die WITHOUT a clean disconnect event
 * (dev hot-reload, process hiccup) never trigger leaveRoom, so their ghost
 * member lingers in the roster: the seat stays taken, quick-join keeps landing
 * in a "live" session whose host is long gone, and a frozen spectre stands at
 * spawn forever. Every 10 s we evict members whose socket no longer exists,
 * migrate the crown off a dead host, and prune abandoned rooms. */
setInterval(() => {
  for (const [code, room] of rooms) {
    let changed = false;
    for (const sid of [...room.members.keys()]) {
      if (!io.sockets.sockets.has(sid)) {
        const m = room.members.get(sid);
        room.members.delete(sid);
        memberRoom.delete(sid);
        changed = true;
        console.log(`[relay] sweep ghost ${m?.name ?? sid} room=${code} souls=${room.members.size}`);
      }
    }
    if (room.members.size === 0) {
      rooms.delete(code);
      console.log(`[relay] sweep empty room ${code}`);
      continue;
    }
    if (changed) {
      if (!io.sockets.sockets.has(room.hostSid)) {
        const next = [...room.members.values()][0];
        room.hostSid = next.sid;
        io.to(room.code).emit("mp:lobby", { t: "host", sid: next.sid, name: next.name });
        console.log(`[relay] host migrated → ${next.name} room=${code}`);
      }
      io.to(room.code).emit("mp:lobby", { t: "roster", lobby: lobbyPayload(room) });
    }
  }
}, 10000);

// stats heartbeat — tiny ops insight at / (helps confirm the relay is alive)
setInterval(() => {
  let souls = 0, live = 0;
  for (const r of rooms.values()) { souls += r.members.size; if (r.started) live++; }
  if (rooms.size) console.log(`[relay] sessions=${rooms.size} live=${live} souls=${souls}`);
}, 15000);

console.log(`🔥 7Nights relay listening on :${PORT}`);
