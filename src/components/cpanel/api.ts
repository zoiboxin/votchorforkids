"use client";

import type {
  ChatData,
  ChatModPayload,
  LoginData,
  MeData,
  OkData,
  PlayerActionPayload,
  PlayersData,
  SeasonsData,
  StatsData,
  WordAction,
  WordsData,
} from "./types";

// ---------------------------------------------------------------------------
// Core fetch helper — throws ApiError on any failure, handles 401 centrally.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Register the callback fired whenever any admin API responds with 401. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

function readErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === "string" && err.length > 0) return err;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Network error — could not reach the server.");
  }

  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new ApiError(401, "Session expired. Please sign in again.");
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body — fall through with null.
  }

  if (!res.ok) {
    throw new ApiError(res.status, readErrorMessage(data, `Request failed (${res.status}).`));
  }

  // Some endpoints may answer 200 with ok:false.
  if (
    typeof data === "object" &&
    data !== null &&
    "ok" in data &&
    (data as { ok?: unknown }).ok === false
  ) {
    throw new ApiError(res.status, readErrorMessage(data, "Request failed."));
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Typed API surface
// ---------------------------------------------------------------------------

export const api = {
  login: (email: string, password: string): Promise<LoginData> =>
    request<LoginData>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: (): Promise<OkData> =>
    request<OkData>("/api/admin/logout", { method: "POST" }),

  me: (): Promise<MeData> => request<MeData>("/api/admin/me"),

  changePassword: (current: string, next: string): Promise<OkData> =>
    request<OkData>("/api/admin/password", {
      method: "POST",
      body: JSON.stringify({ current, next }),
    }),

  getStats: (): Promise<StatsData> => request<StatsData>("/api/admin/stats"),

  getSeasons: (): Promise<SeasonsData> =>
    request<SeasonsData>("/api/admin/seasons"),

  saveSeason: (id: string, startsAt: string, endsAt: string): Promise<OkData> =>
    request<OkData>("/api/admin/seasons", {
      method: "PUT",
      body: JSON.stringify({ id, startsAt, endsAt }),
    }),

  getPlayers: (q?: string): Promise<PlayersData> =>
    request<PlayersData>(
      `/api/admin/players${q ? `?q=${encodeURIComponent(q)}` : ""}`
    ),

  playerAction: (payload: PlayerActionPayload): Promise<OkData> =>
    request<OkData>("/api/admin/players", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getChat: (limit = 150): Promise<ChatData> =>
    request<ChatData>(`/api/admin/chat?limit=${limit}`),

  deleteChatMessage: (id: string): Promise<OkData> =>
    request<OkData>("/api/admin/chat", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    }),

  getWords: (): Promise<WordsData> => request<WordsData>("/api/admin/words"),

  addWord: (word: string, action: WordAction): Promise<OkData> =>
    request<OkData>("/api/admin/words", {
      method: "POST",
      body: JSON.stringify({ word, action }),
    }),

  deleteWord: (word: string): Promise<OkData> =>
    request<OkData>("/api/admin/words", {
      method: "DELETE",
      body: JSON.stringify({ word }),
    }),

  chatMod: (payload: ChatModPayload): Promise<OkData> =>
    request<OkData>("/api/admin/chatmod", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// ---------------------------------------------------------------------------
// Formatting / time helpers
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Locale-formatted integer, e.g. 1,234 — use with tabular-nums. */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function splitDuration(totalSeconds: number): {
  d: number;
  h: number;
  m: number;
  s: number;
} {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return { d, h, m, s };
}

/** Relative time: "2m ago", "in 3h", "never". Accepts epoch ms or ISO string. */
export function relTime(
  ts: number | string | null | undefined,
  now?: number
): string {
  if (ts === null || ts === undefined || ts === "") return "never";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "unknown";
  const ref = now ?? Date.now();
  const diff = ref - t; // > 0 → past
  const future = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  let out: string;
  if (s < 45) out = `${Math.max(s, 1)}s`;
  else if (s < 2700) out = `${Math.floor(s / 60)}m`;
  else if (s < 64800) out = `${Math.floor(s / 3600)}h`;
  else out = `${Math.floor(s / 86400)}d`;
  return future ? `in ${out}` : `${out} ago`;
}

/** Ticking countdown, e.g. "2d 04:11:32" or "04:11:32". */
export function fmtCountdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return "ended";
  const { d, h, m, s } = splitDuration(Math.floor(msRemaining / 1000));
  if (d > 0) return `${d}d ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** "Jan 12, 2025 · 14:30" */
export function fmtDateTime(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === "") return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** ISO string → value usable by <input type="datetime-local"> (local time). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** datetime-local value → ISO string (or null when invalid). */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** "now" preset for datetime-local inputs. */
export function nowLocalInput(): string {
  return isoToLocalInput(new Date().toISOString());
}

/** Shift a datetime-local value by N days. */
export function addDaysToLocalInput(value: string, days: number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setDate(d.getDate() + days);
  return isoToLocalInput(d.toISOString());
}

/** 00:00 / 14:32 short clock for chat timestamps. */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
