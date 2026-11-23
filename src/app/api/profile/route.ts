import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 🛒 persistent player profiles — ONE JSON blob per player (name = account).
 *
 *  Local-first performance contract: the game NEVER waits on this route.
 *  Clients play from localStorage and sync here at most once every few seconds
 *  (debounced), plus one beacon on tab close and one pull on login/boot. The
 *  server just stores and serves a single row per player — negligible load. */

const MAX_NAME = 16;
const MAX_DATA = 256 * 1024; // 256 KB — a profile blob is ~5–30 KB even with 60 runs

function normName(raw: unknown): string {
  return typeof raw === "string"
    ? raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, MAX_NAME).toLowerCase()
    : "";
}

/** GET /api/profile?name=<player> → { profile: <parsed blob> | null } */
export async function GET(req: Request) {
  try {
    const name = normName(new URL(req.url).searchParams.get("name"));
    if (!name) return NextResponse.json({ profile: null });
    const row = await db.playerProfile.findUnique({ where: { id: name } });
    if (!row) return NextResponse.json({ profile: null });
    try {
      return NextResponse.json({ profile: JSON.parse(row.data) });
    } catch {
      return NextResponse.json({ profile: null }); // corrupt blob → treat as absent
    }
  } catch (e) {
    console.error("GET /api/profile failed", e);
    return NextResponse.json({ profile: null });
  }
}

/** POST /api/profile { name, data } — debounced upsert from the client */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
    }
    const name = normName(body.name);
    if (!name) return NextResponse.json({ ok: false, error: "bad name" }, { status: 400 });
    const data = typeof body.data === "string" ? body.data : JSON.stringify(body.data ?? {});
    if (data.length > MAX_DATA) {
      return NextResponse.json({ ok: false, error: "profile too large" }, { status: 413 });
    }
    await db.playerProfile.upsert({
      where: { id: name },
      create: { id: name, name: name, data },
      update: { name: name, data },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/profile failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
