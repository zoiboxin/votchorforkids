/**
 * 🗓️ SEASON SCHEDULE — server-side source of truth for which season runs.
 *
 * One SeasonSchedule row per season (s1..s27, seeded from the SEASONS config).
 * The LIVE season = the row whose [startsAt, endsAt] window contains "now"
 * (latest start wins if two overlap). The lobby, the Season page and the game
 * default their arena to the live season — the cpanel admin edits the dates.
 */
import { db } from "@/lib/db";
import { SEASONS } from "@/lib/game/seasons";

export interface SeasonSlot {
  id: string;
  number: number;
  title: string;
  kit: string;
  tagline: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  /** live right now (now inside the window) */
  live: boolean;
  /** the window is entirely in the past */
  past: boolean;
}

/** seed one row per season — S1 opens at TODAY's local midnight (live
 *  immediately), every next season +28 days in a clean rolling calendar */
export async function ensureSeasonSchedule(): Promise<void> {
  try {
    const count = await db.seasonSchedule.count();
    if (count >= SEASONS.length) return;

    const SEASON_MS = 28 * 86_400_000;
    const base = new Date();
    base.setHours(0, 0, 0, 0); // seasons open at midnight local — S1 is live NOW

    for (let i = 0; i < SEASONS.length; i++) {
      const s = SEASONS[i];
      const startsAt = new Date(base.getTime() + i * SEASON_MS);
      const endsAt = new Date(startsAt.getTime() + SEASON_MS);
      await db.seasonSchedule.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          number: i + 1,
          title: s.title,
          kit: s.kit,
          tagline: s.tagline,
          startsAt,
          endsAt,
        },
        update: {}, // never stomp admin-edited dates on re-boot
      });
    }
    console.log("🗓️ season schedule seeded/verified (S1..S27 — S1 live from today)");
  } catch (e) {
    console.error("season schedule seed failed", e);
  }
}

/** all 27 slots, calendar-ordered, with live/past flags */
export async function getSeasonSchedule(): Promise<SeasonSlot[]> {
  await ensureSeasonSchedule();
  const rows = await db.seasonSchedule.findMany({ orderBy: { number: "asc" } });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    kit: r.kit,
    tagline: r.tagline,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    live: r.startsAt.getTime() <= now && now < r.endsAt.getTime(),
    past: r.endsAt.getTime() <= now,
  }));
}

/** the LIVE season (now inside the window) — null when nothing is scheduled */
export async function getActiveSeason(): Promise<SeasonSlot | null> {
  const slots = await getSeasonSchedule();
  const live = slots.filter((s) => s.live).sort((a, b) => b.number - a.number);
  return live[0] ?? null;
}
