import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scores = await db.score.findMany({
      orderBy: [{ points: "desc" }, { createdAt: "asc" }],
      take: 10,
    });
    return NextResponse.json({ scores });
  } catch (e) {
    console.error("GET /api/scores failed", e);
    return NextResponse.json({ scores: [] });
  }
}

function sanitize(v: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawName = typeof body.name === "string" ? body.name : "";
    const name = rawName.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16) || "Guest";
    const score = await db.score.create({
      data: {
        name,
        points: sanitize(body.points, 0, 1_000_000),
        votes: sanitize(body.votes, 0, 1000),
        rescues: sanitize(body.rescues, 0, 10_000),
        caught: sanitize(body.caught, 0, 10_000),
        won: body.won === true,
        timeMs: sanitize(body.timeMs, 0, 86_400_000),
      },
    });
    return NextResponse.json({ ok: true, id: score.id });
  } catch (e) {
    console.error("POST /api/scores failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
