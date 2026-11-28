import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { chatAdminFetch } from "@/lib/chat-admin";
import { getActiveSeason } from "@/lib/season-schedule";

export const dynamic = "force-dynamic";

/** GET /api/admin/stats — dashboard cards: players, moderation, chat pulse, live season */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [profiles, banned, muted, scores, scoresToday, season, chatState] = await Promise.all([
      db.playerProfile.count(),
      db.playerModeration.count({ where: { banned: true } }),
      db.playerModeration.count({ where: { muted: true, muteUntil: { gt: new Date() } } }),
      db.score.count(),
      db.score.count({ where: { createdAt: { gte: dayAgo } } }),
      getActiveSeason().catch(() => null),
      chatAdminFetch("/admin/state").catch(() => ({ ok: false, status: 0, data: null, error: "unreachable" })),
    ]);

    const state = (chatState.data ?? null) as
      | { words?: unknown[]; muted?: unknown[]; chatBanned?: unknown[]; flagged24h?: number; messages24h?: number; online?: number }
      | null;

    return NextResponse.json({
      ok: true,
      stats: {
        players: profiles,
        banned,
        muted,
        scores,
        scoresToday,
        season: season ? { id: season.id, number: season.number, title: season.title, tagline: season.tagline, endsAt: season.endsAt, startsAt: season.startsAt } : null,
        chat: {
          online: state?.online ?? null,
          words: Array.isArray(state?.words) ? state?.words.length ?? null : null,
          mutedCount: Array.isArray(state?.muted) ? state?.muted.length : null,
          chatBannedCount: Array.isArray(state?.chatBanned) ? state?.chatBanned.length : null,
          messages24h: state?.messages24h ?? null,
          flagged24h: state?.flagged24h ?? null,
          relay: chatState.ok,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error("GET /api/admin/stats failed", e);
    return NextResponse.json({ ok: false, error: "Failed to load stats." }, { status: 500 });
  }
}
