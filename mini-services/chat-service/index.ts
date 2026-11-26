import { createServer } from "http";
import { Server } from "socket.io";
import { Database } from "bun:sqlite";
import { join } from "path";

/* 💬 7Nights global chat relay — the lobby's real-time messaging backbone.
 *
 * Every connected soul (any browser tab, any player) joins one room here:
 *   • history is PERSISTED in SQLite (chat.db beside this file) — messages
 *     survive page refreshes, reconnects AND relay restarts; everything
 *     older than 7 days is pruned, so the lobby keeps a rolling week of
 *     chatter (at least 7 days, bounded by ROW_CAP so the db stays tiny)
 *   • late joiners are caught up with the newest REPLAY_CAP stored lines
 *     (they open the panel pre-seen); GET /history?limit=N serves raw JSON
 *   • every "chat:send" is sanitized, flood-guarded and broadcast to ALL
 *     clients — including the sender's own echo — so everyone's messages
 *     appear in the same live stream
 *   • presence count rides along so the lobby can show "N souls online"
 *
 * Started on its own port (3003). The lobby reaches it ONLY through the Caddy
 * gateway as /?XTransformPort=3003 — the socket path must stay "/" so Caddy
 * can forward it. Run with `bun run dev` (bun --hot restarts on edits). */

interface ChatMsg {
  id: string;
  name: string;
  msg: string;
  ts: number;
}

/* ---------- persistent history (SQLite — survives refreshes & restarts) ---------- */

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // keep AT LEAST 7 days of chat
const ROW_CAP = 5000; // hard row ceiling so the db can never balloon
const HISTORY_CAP = 1000; // in-memory mirror for instant replay
const REPLAY_CAP = 300; // lines replayed to a (re)connecting soul
const MAX_NAME = 24;
const MAX_MSG = 120;

const db = new Database(join(import.meta.dir, "chat.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec(
  "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, name TEXT NOT NULL, msg TEXT NOT NULL, ts INTEGER NOT NULL)"
);
db.exec("CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts)");

/* drop anything past the 7-day window, then cap the table at ROW_CAP rows */
const prune = () => {
  db.run("DELETE FROM messages WHERE ts < ?", [Date.now() - RETENTION_MS]);
  db.run(
    "DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY ts DESC LIMIT ?)",
    [ROW_CAP]
  );
};

prune();

const history: ChatMsg[] = db
  .query("SELECT id, name, msg, ts FROM messages ORDER BY ts ASC LIMIT ?")
  .all(HISTORY_CAP) as ChatMsg[];

const push = (name: string, msg: string): ChatMsg => {
  const m: ChatMsg = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name,
    msg,
    ts: Date.now(),
  };
  history.push(m);
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  db.run("INSERT OR REPLACE INTO messages (id, name, msg, ts) VALUES (?, ?, ?, ?)", [
    m.id,
    m.name,
    m.msg,
    m.ts,
  ]);
  return m;
};

/* NightLine seed lines — only on a FRESH db, so restarts never duplicate them */
if (history.length === 0) {
  push("NightLine", "📡 Welcome to the lobby — PLAY queues you into a 100-soul night (AI fills the rest).");
  push("NightLine", "🌐 MULTIPLAYER hosts a room — share the 4-letter code, friends Quick join.");
}

/* roll the 7-day window forward every 5 minutes */
setInterval(prune, 5 * 60 * 1000).unref?.();

/* ---------- relay ---------- */

const json = (res: import("http").ServerResponse, body: unknown) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/history") {
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || REPLAY_CAP, 1),
      HISTORY_CAP
    );
    json(res, { ok: true, messages: history.slice(-limit) });
    return;
  }
  json(res, { ok: true, service: "7nights-chat" });
});

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy forwards "/" on this port to here
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/* light flood guard — 5 messages per 5 seconds per socket */
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 5;
const rate = new Map<string, number[]>();

const soulsOnline = () => Math.max(0, io.engine.clientsCount);

io.on("connection", (socket) => {
  console.log(`chat: ${socket.id} joined — ${soulsOnline()} online`);

  /* catch a late joiner up with the newest persisted lines (badge stays clean) */
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
  console.log(`💬 7Nights chat relay listening on :${PORT} — history persisted (7-day window)`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
