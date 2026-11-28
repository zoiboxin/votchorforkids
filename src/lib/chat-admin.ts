/**
 * 💬→🛡️ CPANEL ↔ CHAT RELAY proxy — server-side helper.
 *
 * The chat relay (mini-services/chat-service, port 3003) is the source of
 * truth for live-chat moderation: banned words, muted players, chat bans and
 * flagged messages live in its SQLite (chat.db). These admin endpoints are
 * guarded with a shared secret header (x-admin-key) so gateway-forwarded
 * browser requests can never touch them — only the Next.js server calls them.
 *
 * NEVER import this from a client component — it speaks to localhost:3004.
 */

const CHAT_PORT = 3004; // plain-HTTP admin surface (socket.io owns :3003)

/** shared secret — must match mini-services/chat-service/index.ts */
const CHAT_ADMIN_KEY = process.env.CHAT_ADMIN_KEY || "7nights-cpanel-chat-key-v1";

export interface ChatAdminResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function chatAdminFetch<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ChatAdminResult<T>> {
  try {
    const res = await fetch(`http://localhost:${CHAT_PORT}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "x-admin-key": CHAT_ADMIN_KEY,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `relay ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "relay unreachable" };
  }
}
