/**
 * One-off re-base of the season calendar: S1 live from today's local
 * midnight, every season a clean 28-day window (admin can re-schedule
 * anything later from /cpanel_app). Run: bun scripts/rebase-seasons.ts
 */
import { PrismaClient } from "@prisma/client";
import { SEASONS } from "../src/lib/game/seasons";

const db = new PrismaClient();
const SEASON_MS = 28 * 86_400_000;

async function main() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < SEASONS.length; i++) {
    const s = SEASONS[i];
    const startsAt = new Date(base.getTime() + i * SEASON_MS);
    const endsAt = new Date(startsAt.getTime() + SEASON_MS);
    await db.seasonSchedule.upsert({
      where: { id: s.id },
      create: { id: s.id, number: i + 1, title: s.title, kit: s.kit, tagline: s.tagline, startsAt, endsAt },
      update: { startsAt, endsAt },
    });
    console.log(`${s.id} S${i + 1} ${s.title} — ${startsAt.toISOString()} → ${endsAt.toISOString()}`);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
