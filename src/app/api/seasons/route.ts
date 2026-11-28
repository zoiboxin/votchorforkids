import { NextResponse } from "next/server";
import { getActiveSeason, getSeasonSchedule } from "@/lib/season-schedule";

export const dynamic = "force-dynamic";

/**
 * GET /api/seasons — PUBLIC: the calendar + the live season.
 * The lobby, Season page and game boot call this to learn which themed
 * 4×4 km arena is running right now (cpanel-admin scheduled).
 */
export async function GET() {
  try {
    const [seasons, active] = await Promise.all([getSeasonSchedule(), getActiveSeason()]);
    return NextResponse.json({ ok: true, seasons, active });
  } catch (e) {
    console.error("GET /api/seasons failed", e);
    return NextResponse.json({ ok: false, seasons: [], active: null }, { status: 500 });
  }
}
