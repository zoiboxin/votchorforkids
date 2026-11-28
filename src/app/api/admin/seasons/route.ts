import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { getSeasonSchedule } from "@/lib/season-schedule";

export const dynamic = "force-dynamic";

/** GET /api/admin/seasons — the full 27-season calendar with live flags */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  try {
    const seasons = await getSeasonSchedule();
    return NextResponse.json({ ok: true, seasons });
  } catch (e) {
    console.error("GET /api/admin/seasons failed", e);
    return NextResponse.json({ ok: false, error: "Failed to load seasons." }, { status: 500 });
  }
}

/**
 * PUT /api/admin/seasons { id, startsAt, endsAt } — schedule a season window.
 * The live season is DERIVED (now inside the window), so dating a season
 * today → its arena plays in the game instantly.
 */
export async function PUT(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; startsAt?: unknown; endsAt?: unknown }
    | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? new Date(body.startsAt) : null;
  const endsAt = typeof body?.endsAt === "string" ? new Date(body.endsAt) : null;

  if (!id || !startsAt || !endsAt || isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return NextResponse.json({ ok: false, error: "id, startsAt and endsAt (valid dates) are required." }, { status: 400 });
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json({ ok: false, error: "End date must be after the start date." }, { status: 400 });
  }

  try {
    const row = await db.seasonSchedule.update({
      where: { id },
      data: { startsAt, endsAt },
    });
    return NextResponse.json({
      ok: true,
      season: { id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() },
    });
  } catch {
    return NextResponse.json({ ok: false, error: `Unknown season "${id}".` }, { status: 404 });
  }
}
