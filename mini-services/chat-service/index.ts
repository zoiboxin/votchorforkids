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
 * 🛡️ CPANEL MODERATION (used by the /cpanel_app admin panel via the Next.js
 * server proxy, guarded by the shared x-admin-key secret):
 *   • banned_words  — abusive-language filter; "block" = never broadcast
 *     (sender gets a strike — 3 strikes in 10 min auto-mute 30 min),
 *     "flag" = broadcast but stored flagged for admin review
 *   • muted_players — name muted until an epoch (can't send; told why)
 *   • chat_banned   — name banned from chat entirely
 *   • flagged messages land ONLY in the db (never replayed to players),
 *     visible on the admin Chat Monitor
 *   • /admin/* HTTP endpoints (PORT 3004 — see below) let the cpanel delete
 *     messages, broadcast a NightLine announcement and manage moderation live
 *
 * TWO PORTS: socket.io owns the ENTIRE ":3003" surface (engine.io claims
 * every path when the socket path is "/" — plain HTTP answers would die as
 * "Transport unknown"). The plain-HTTP surface (GET /history + the cpanel
 * /admin/* endpoints) therefore listens on its OWN port :3004, called only
 * by the Next.js server (never by browsers).
 *
 * Started on its own port (3003). The lobby reaches it ONLY through the Caddy
 * gateway as /?XTransformPort=3003 — the socket path must stay "/" so Caddy
 * can forward it. Run with `bun run dev` (bun --hot restarts on edits). */

interface ChatMsg {
  id: string;
  name: string;
  msg: string;
  ts: number;
  flagged?: number; // 1 = caught by the word filter (db-only, never broadcast)
}

/* ---------- persistent history (SQLite — survives refreshes & restarts) ---------- */

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // keep AT LEAST 7 days of chat
const ROW_CAP = 5000; // hard row ceiling so the db can never balloon
const HISTORY_CAP = 1000; // in-memory mirror for instant replay
const REPLAY_CAP = 300; // lines replayed to a (re)connecting soul
const MAX_NAME = 24;
const MAX_MSG = 120;

/* ---------- moderation constants ---------- */

/** shared secret with src/lib/chat-admin.ts (Next server proxies /admin/*) */
const ADMIN_KEY = process.env.CHAT_ADMIN_KEY || "7nights-cpanel-chat-key-v1";

const STRIKE_WINDOW_MS = 10 * 60 * 1000; // strikes counted in rolling 10 min
const STRIKE_LIMIT = 3; // strikes before the auto-mute
const AUTO_MUTE_MS = 30 * 60 * 1000; // the strike punish: 30 min silence
const AUTO_MUTE_REASON = "Auto-muted: repeated abusive language";

const CHAT_PORT = 3003; // socket.io surface — clients reach it via Caddy
const ADMIN_PORT = 3004; // plain-HTTP surface — Next server proxy only

const db = new Database(join(import.meta.dir, "chat.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec(
  "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, name TEXT NOT NULL, msg TEXT NOT NULL, ts INTEGER NOT NULL)"
);
db.exec("CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts)");
/* 🛡️ flagged column — added safely for dbs created before moderation existed */
try {
  db.exec("ALTER TABLE messages ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0");
} catch {
  /* column already exists */
}

db.exec(
  "CREATE TABLE IF NOT EXISTS banned_words (word TEXT PRIMARY KEY, action TEXT NOT NULL DEFAULT 'block', created_at INTEGER NOT NULL)"
);
db.exec(
  "CREATE TABLE IF NOT EXISTS muted_players (name TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT)"
);
db.exec(
  "CREATE TABLE IF NOT EXISTS chat_banned (name TEXT PRIMARY KEY, reason TEXT, at INTEGER NOT NULL)"
);

/* starter abusive-language filter — the admin extends it from /cpanel_app */
const seededWords = db.query("SELECT COUNT(*) AS n FROM banned_words").get() as { n: number };
if (seededWords.n === 0) {
  const seeds = [
    "fuck", "shit", "bitch", "asshole", "cunt", "dick", "bastard",
    "nigger", "nigga", "faggot", "whore", "slut", "retard", "rape",
  ];
  const ins = db.query("INSERT OR IGNORE INTO banned_words (word, action, created_at) VALUES (?, 'block', ?)");
  for (const w of seeds) ins.run(w, Date.now());
  console.log(`🛡️ chat: seeded ${seeds.length} starter filter words`);
}

/* drop anything past the 7-day window, then cap the table at ROW_CAP rows */
const prune = () => {
  db.run("DELETE FROM messages WHERE ts < ?", [Date.now() - RETENTION_MS]);
  db.run(
    "DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY ts DESC LIMIT ?)",
    [ROW_CAP]
  );
};

prune();

/* broadcastable mirror — flagged rows NEVER enter this list */
const history: ChatMsg[] = db
  .query("SELECT id, name, msg, ts FROM messages WHERE flagged = 0 ORDER BY ts ASC LIMIT ?")
  .all(HISTORY_CAP) as ChatMsg[];

const push = (name: string, msg: string, flagged = 0): ChatMsg => {
  const m: ChatMsg = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name,
    msg,
    ts: Date.now(),
    flagged,
  };
  if (!flagged) {
    history.push(m);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  }
  db.run("INSERT OR REPLACE INTO messages (id, name, msg, ts, flagged) VALUES (?, ?, ?, ?, ?)", [
    m.id,
    m.name,
    m.msg,
    m.ts,
    flagged,
  ]);
  return m;
};

/* NightLine seed lines — only on a FRESH db, so restarts never duplicate them */
if (history.length === 0 && (db.query("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n === 0) {
  push("NightLine", "📡 Welcome to the lobby — PLAY queues you into a 100-soul night (AI fills the rest).");
  push("NightLine", "🌐 MULTIPLAYER hosts a room — share the 4-letter code, friends Quick join.");
}

/* roll the 7-day window forward every 5 minutes */
setInterval(prune, 5 * 60 * 1000).unref?.();

/* ---------- moderation helpers ---------- */

const wordRows = () => db.query("SELECT word, action FROM banned_words").all() as { word: string; action: string }[];
const mutedRows = () =>
  (db.query("SELECT name, until, reason FROM muted_players WHERE until > ?").all(Date.now()) as {
    name: string;
    until: number;
    reason: string | null;
  }[]).sort((a, b) => b.until - a.until);
const bannedRows = () =>
  (db.query("SELECT name, reason, at FROM chat_banned ORDER BY at DESC").all() as {
    name: string;
    reason: string | null;
    at: number;
  }[]);

const isMuted = (name: string) => {
  const row = db.query("SELECT until, reason FROM muted_players WHERE name = ?").get(name.toLowerCase()) as
    | { until: number; reason: string | null }
    | null;
  if (!row) return null;
  if (row.until <= Date.now()) {
    db.run("DELETE FROM muted_players WHERE name = ?", [name.toLowerCase()]); // expired — clean up
    return null;
  }
  return row;
};

const isChatBanned = (name: string) => {
  return db.query("SELECT reason FROM chat_banned WHERE name = ?").get(name.toLowerCase()) as
    | { reason: string | null }
    | null;
};

/** abusive-language scan — returns the matching word + its action, or null */
function scanWords(msg: string): { word: string; action: string } | null {
  const lower = msg.toLowerCase().replace(/[013457$@]/g, (c) =>
    ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s", "@": "a" }[c] ?? c)
  );
  for (const { word, action } of wordRows()) {
    const w = word.toLowerCase();
    if (!w) continue;
    // word-boundary regex so "class" never trips "ass"
    const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(lower) || re.test(msg)) return { word, action };
  }
  return null;
}

/** rolling strike counter per socket — 3 abusive sends in 10 min → auto-mute */
const strikes = new Map<string, number[]>();
function addStrike(socketId: string): number {
  const now = Date.now();
  const list = (strikes.get(socketId) ?? []).filter((t) => now - t < STRIKE_WINDOW_MS);
  list.push(now);
  strikes.set(socketId, list);
  return list.length;
}

/* ---------- plain-HTTP surface (:3004 — history + cpanel admin) ---------- */

const json = (res: import("http").ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const adminServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  /* ---------- public endpoints ---------- */
  if (url.pathname === "/history") {
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || REPLAY_CAP, 1),
      HISTORY_CAP
    );
    json(res, { ok: true, messages: history.slice(-limit) });
    return;
  }

  /* ---------- 🛡️ cpanel admin endpoints (shared-secret guarded) ---------- */
  if (url.pathname.startsWith("/admin/")) {
    const hdr = req.headers as unknown as Record<string, string | string[] | undefined>;
    const key = Array.isArray(hdr["x-admin-key"]) ? hdr["x-admin-key"][0] : hdr["x-admin-key"];
    if (key !== ADMIN_KEY) {
      json(res, { ok: false, error: "forbidden" }, 403);
      return;
    }
    const readBody = (): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          try {
            resolve(JSON.parse(raw || "{}"));
          } catch {
            resolve({});
          }
        });
      });

    (async () => {
      /* live moderation state snapshot */
      if (req.method === "GET" && url.pathname === "/admin/state") {
        const dayAgo = Date.now() - 86_400_000;
        const msgs = db.query("SELECT COUNT(*) AS n FROM messages WHERE ts > ?").get(dayAgo) as { n: number };
        const flagged = db.query("SELECT COUNT(*) AS n FROM messages WHERE flagged = 1 AND ts > ?").get(dayAgo) as { n: number };
        json(res, {
          ok: true,
          online: soulsOnline(),
          words: wordRows(),
          muted: mutedRows(),
          chatBanned: bannedRows(),
          messages24h: msgs.n,
          flagged24h: flagged.n,
        });
        return;
      }

      /* admin monitor feed — newest first, flagged included */
      if (req.method === "GET" && url.pathname === "/admin/chat") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 150, 1), 500);
        const rows = db
          .query("SELECT id, name, msg, ts, flagged FROM messages ORDER BY ts DESC LIMIT ?")
          .all(limit) as ChatMsg[];
        json(res, { ok: true, messages: rows.map((r) => ({ ...r, flagged: !!r.flagged })) });
        return;
      }

      const body = await readBody();
      const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

      /* word filter */
      if (url.pathname === "/admin/words" && req.method === "POST") {
        const word = str(body.word, 40).toLowerCase();
        const action = body.action === "flag" ? "flag" : "block";
        if (!word) return json(res, { ok: false, error: "word required" }, 400);
        db.run("INSERT OR REPLACE INTO banned_words (word, action, created_at) VALUES (?, ?, ?)", [word, action, Date.now()]);
        json(res, { ok: true });
        return;
      }
      if (url.pathname === "/admin/words/remove" && req.method === "POST") {
        const word = str(body.word, 40).toLowerCase();
        db.run("DELETE FROM banned_words WHERE word = ?", [word]);
        json(res, { ok: true });
        return;
      }

      /* chat mute */
      if (url.pathname === "/admin/mute" && req.method === "POST") {
        const name = str(body.name, MAX_NAME).toLowerCase();
        const hours = Math.max(0.05, Math.min(24 * 30, Number(body.hours) || 0.5));
        const reason = str(body.reason, 200) || "Chat restricted by admin";
        if (!name) return json(res, { ok: false, error: "name required" }, 400);
        db.run("INSERT OR REPLACE INTO muted_players (name, until, reason) VALUES (?, ?, ?)", [
          name,
          Date.now() + hours * 3_600_000,
          reason,
        ]);
        json(res, { ok: true });
        return;
      }
      if (url.pathname === "/admin/unmute" && req.method === "POST") {
        const name = str(body.name, MAX_NAME).toLowerCase();
        db.run("DELETE FROM muted_players WHERE name = ?", [name]);
        json(res, { ok: true });
        return;
      }

      /* chat ban */
      if (url.pathname === "/admin/ban" && req.method === "POST") {
        const name = str(body.name, MAX_NAME).toLowerCase();
        const reason = str(body.reason, 200) || "Banned from chat by admin";
        if (!name) return json(res, { ok: false, error: "name required" }, 400);
        db.run("INSERT OR REPLACE INTO chat_banned (name, reason, at) VALUES (?, ?, ?)", [name, reason, Date.now()]);
        json(res, { ok: true });
        return;
      }
      if (url.pathname === "/admin/unban" && req.method === "POST") {
        const name = str(body.name, MAX_NAME).toLowerCase();
        db.run("DELETE FROM chat_banned WHERE name = ?", [name]);
        json(res, { ok: true });
        return;
      }

      /* delete one message everywhere (history mirror + db + every open panel) */
      if (url.pathname === "/admin/delete" && req.method === "POST") {
        const id = str(body.id, 64);
        if (!id) return json(res, { ok: false, error: "id required" }, 400);
        const idx = history.findIndex((m) => m.id === id);
        if (idx >= 0) history.splice(idx, 1);
        db.run("DELETE FROM messages WHERE id = ?", [id]);
        io.emit("chat:delete", { id });
        json(res, { ok: true });
        return;
      }

      /* NightLine system announcement to every soul */
      if (url.pathname === "/admin/broadcast" && req.method === "POST") {
        const message = str(body.message, 140);
        if (!message) return json(res, { ok: false, error: "message required" }, 400);
        const m = push("NightLine", message);
        io.emit("chat:message", m);
        json(res, { ok: true });
        return;
      }

      json(res, { ok: false, error: "not found" }, 404);
    })().catch((e) => {
      console.error("admin endpoint error:", e);
      json(res, { ok: false, error: "internal" }, 500);
    });
    return;
  }

  json(res, { ok: true, service: "7nights-chat" });
});

adminServer.listen(ADMIN_PORT, () => {
  console.log(`🛡️ chat admin surface on :${ADMIN_PORT} — history + cpanel moderation endpoints`);
});

/* ---------- relay (:3003 — engine.io owns the whole surface) ---------- */

const httpServer = createServer();
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

    /* 🛡️ chat-banned souls can't speak at all */
    const ban = isChatBanned(name);
    if (ban) {
      socket.emit("chat:banned", { reason: ban.reason ?? "You are banned from chat." });
      return;
    }

    /* 🛡️ muted souls wait out their sentence */
    const mute = isMuted(name);
    if (mute) {
      socket.emit("chat:muted", { until: mute.until, reason: mute.reason ?? "Chat restricted." });
      return;
    }

    const now = Date.now();
    const stamps = (rate.get(socket.id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (stamps.length >= RATE_MAX) return; // silently drop floods
    stamps.push(now);
    rate.set(socket.id, stamps);

    /* 🛡️ abusive-language filter — block (strike) or flag (broadcast + review) */
    const hit = scanWords(msg);
    if (hit) {
      const flaggedRow = push(name, msg, 1); // db-only — never broadcast, never replayed
      if (hit.action === "block") {
        const count = addStrike(socket.id);
        if (count >= STRIKE_LIMIT) {
          db.run("INSERT OR REPLACE INTO muted_players (name, until, reason) VALUES (?, ?, ?)", [
            name.toLowerCase(),
            now + AUTO_MUTE_MS,
            AUTO_MUTE_REASON,
          ]);
          strikes.set(socket.id, []);
          socket.emit("chat:muted", { until: now + AUTO_MUTE_MS, reason: AUTO_MUTE_REASON });
          console.log(`chat: ${name} auto-muted 30 min (${count} strikes)`);
        } else {
          socket.emit("chat:blocked", {
            word: hit.word,
            strikes: count,
            limit: STRIKE_LIMIT,
          });
        }
        console.log(`chat: BLOCKED ${name}: ${flaggedRow.msg.slice(0, 40)}… (word: ${hit.word})`);
        return;
      }
      // action === "flag" → let it through but keep the red flag for review
      io.emit("chat:message", { ...flaggedRow, flagged: undefined } as ChatMsg);
      console.log(`chat: FLAGGED ${name}: ${flaggedRow.msg.slice(0, 40)}… (word: ${hit.word})`);
      return;
    }

    const m = push(name, msg);
    io.emit("chat:message", m); // EVERY soul sees it — sender included (their echo)
    console.log(`chat: ${name}: ${msg}`);
  });

  socket.on("disconnect", () => {
    rate.delete(socket.id);
    strikes.delete(socket.id);
    io.emit("chat:presence", { online: soulsOnline() });
    console.log(`chat: ${socket.id} left — ${soulsOnline()} online`);
  });

  socket.on("error", (e) => console.error(`chat socket error (${socket.id}):`, e));
});

const PORT = CHAT_PORT;
httpServer.listen(PORT, () => {
  console.log(`💬 7Nights chat relay listening on :${PORT} — history persisted (7-day window)`);
  console.log(`🛡️ cpanel moderation live — ${wordRows().length} filter words, admin endpoints on /admin/*`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
