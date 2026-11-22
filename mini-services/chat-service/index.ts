import { createServer } from "http";
import { Server } from "socket.io";

/* 💬 7Nights global chat relay — the lobby's real-time messaging backbone.
 *
 * Every connected soul (any browser tab, any player) joins one room here:
 *   • the server keeps a rolling in-memory history (last 200 lines) and
 *     replays the newest 50 to late joiners (they open the panel pre-seen)
 *   • every "chat:send" is sanitized, flood-guarded and broadcast to ALL
 *     clients — including the sender's own echo — so everyone's messages
 *     appear in the same live stream
 *   • presence count rides along so the lobby can show "N souls online"
 *
 * Started on its own port (3003). The lobby reaches it ONLY through the Caddy
 * gateway as /?XTransformPort=3003 — the socket path must stay "/" so Caddy
 * can forward it. Run with `bun run dev` (bun --hot restarts on edits). */

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "7nights-chat" }));
});

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy forwards "/" on this port to here
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

interface ChatMsg {
  id: string;
  name: string;
  msg: string;
  ts: number;
}

const HISTORY_CAP = 200;
const REPLAY_CAP = 50;
const MAX_NAME = 24;
const MAX_MSG = 120;

const history: ChatMsg[] = [];

const push = (name: string, msg: string): ChatMsg => {
  const m: ChatMsg = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name,
    msg,
    ts: Date.now(),
  };
  history.push(m);
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  return m;
};

/* NightLine seed lines — the lobby greets every soul that tunes in */
push("NightLine", "📡 Welcome to the lobby — PLAY queues you into a 100-soul night (AI fills the rest).");
push("NightLine", "🌐 MULTIPLAYER hosts a room — share the 4-letter code, friends Quick join.");

/* light flood guard — 5 messages per 5 seconds per socket */
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 5;
const rate = new Map<string, number[]>();

const soulsOnline = () => Math.max(0, io.engine.clientsCount);

io.on("connection", (socket) => {
  console.log(`chat: ${socket.id} joined — ${soulsOnline()} online`);

  /* catch a late joiner up with the newest lines (their badge stays clean) */
  socket.emit("chat:history", history.slice(-REPLAY_CAP));
  io.emit("chat:presence", { online: soulsOnline() });

  socket.on("chat:send", (raw: unknown) => {
    const body = (raw ?? {}) as { name?: unknown; msg?: unknown };
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, MAX_NAME)
        : "Guest";
    const msg = typeof body.msg === "string" ? body.msg.trim().slice(0, MAX_MSG) : "";
    if (!msg) return;

    const now = Date.now();
    const stamps = (rate.get(socket.id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (stamps.length >= RATE_MAX) return; // silently drop floods
    stamps.push(now);
    rate.set(socket.id, stamps);

    const m = push(name, msg);
    io.emit("chat:message", m); // EVERY soul sees it — sender included (their echo)
    console.log(`chat: ${name}: ${msg}`);
  });

  socket.on("disconnect", () => {
    rate.delete(socket.id);
    io.emit("chat:presence", { online: soulsOnline() });
    console.log(`chat: ${socket.id} left — ${soulsOnline()} online`);
  });

  socket.on("error", (e) => console.error(`chat socket error (${socket.id}):`, e));
});

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`💬 7Nights chat relay listening on :${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
