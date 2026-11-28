import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { chatAdminFetch } from "@/lib/chat-admin";

export const dynamic = "force-dynamic";

/* ---------------- GET — merged player roster ---------------- */

interface ProfileBlob {
  careerXp?: number;
  coins?: number;
  wallet?: { coins?: number };
  stats?: { wins?: number; runs?: number; bestScore?: number };
  history?: unknown[];
}

function readBlob(data: string): Partial<ProfileBlob> {
  try {
    const b = JSON.parse(data) as ProfileBlob;
    return {
      careerXp: typeof b.careerXp === "number" ? b.careerXp : undefined,
      coins: typeof b.coins === "number" ? b.coins : b.wallet?.coins,
      stats: b.stats,
    };
  } catch {
    return {};
  }
}

/** GET /api/admin/players?q=<search> — profiles + scores + moderation merged */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
    const [profiles, modRows, scoreGroups] = await Promise.all([
      db.playerProfile.findMany({ orderBy: { updatedAt: "desc" }, take: 500 }),
      db.playerModeration.findMany(),
      db.score.groupBy({
        by: ["name"],
        _count: { _all: true },
        _max: { points: true, createdAt: true },
      }).catch(() => [] as Array<{ name: string; _count: { _all: number }; _max: { points: number | null; createdAt: Date | null } }>),
    ]);

    type Row = {
      name: string; xp: number; coins: number; wins: number; runs: number;
      games: number; bestPoints: number; lastPlayedAt: string | null;
      profileUpdatedAt: string | null; synced: boolean;
      banned: boolean; banReason: string | null; muted: boolean;
      muteUntil: string | null; flaggedCount: number; notes: string | null;
    };

    const map = new Map<string, Row>();
    for (const p of profiles) {
      const b = readBlob(p.data);
      map.set(p.id, {
        name: p.name,
        xp: b.careerXp ?? 0,
        coins: b.coins ?? 0,
        wins: b.stats?.wins ?? 0,
        runs: b.stats?.runs ?? 0,
        games: 0, bestPoints: 0, lastPlayedAt: null,
        profileUpdatedAt: p.updatedAt.toISOString(),
        synced: true,
        banned: false, banReason: null, muted: false, muteUntil: null,
        flaggedCount: 0, notes: null,
      });
    }
    for (const g of scoreGroups) {
      const key = g.name.toLowerCase();
      const row = map.get(key);
      if (row) {
        row.games = g._count._all;
        row.bestPoints = g._max.points ?? 0;
        row.lastPlayedAt = g._max.createdAt ? g._max.createdAt.toISOString() : null;
      } else {
        map.set(key, {
          name: g.name,
          xp: 0, coins: 0, wins: 0, runs: 0,
          games: g._count._all, bestPoints: g._max.points ?? 0,
          lastPlayedAt: g._max.createdAt ? g._max.createdAt.toISOString() : null,
          profileUpdatedAt: null,
          synced: false,
          banned: false, banReason: null, muted: false, muteUntil: null,
          flaggedCount: 0, notes: null,
        });
      }
    }
    for (const m of modRows) {
      const row = map.get(m.id) ?? map.get(m.name.toLowerCase());
      if (row) {
        row.banned = m.banned;
        row.banReason = m.banReason;
        row.muted = m.muted && (m.muteUntil?.getTime() ?? 0) > Date.now();
        row.muteUntil = m.muteUntil?.toISOString() ?? null;
        row.flaggedCount = m.flaggedCount;
        row.notes = m.notes;
      } else {
        map.set(m.id, {
          name: m.name, xp: 0, coins: 0, wins: 0, runs: 0,
          games: 0, bestPoints: 0, lastPlayedAt: null, profileUpdatedAt: null, synced: false,
          banned: m.banned, banReason: m.banReason,
          muted: m.muted && (m.muteUntil?.getTime() ?? 0) > Date.now(),
          muteUntil: m.muteUntil?.toISOString() ?? null,
          flaggedCount: m.flaggedCount, notes: m.notes,
        });
      }
    }

    let rows = [...map.values()];
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    rows.sort((a, b) => (b.banned ? 1 : 0) - (a.banned ? 1 : 0) || b.xp - a.xp || a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, players: rows, total: rows.length });
  } catch (e) {
    console.error("GET /api/admin/players failed", e);
    return NextResponse.json({ ok: false, error: "Failed to load players." }, { status: 500 });
  }
}

/* ---------------- POST — moderation actions ---------------- */

function normName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16).toLowerCase() : "";
}

/**
 * POST /api/admin/players { action, name, reason?, hours?, notes? }
 * actions: ban · unban · mute · unmute · notes · clearflags
 * mute ALSO restricts the live chat relay (one switch, both channels).
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const name = normName(body?.name);
  if (!name) return NextResponse.json({ ok: false, error: "A player name is required." }, { status: 400 });

  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) : "";
  const hours = Math.max(1, Math.min(24 * 30, Math.floor(Number(body?.hours) || 24)));
  const muteUntil = new Date(Date.now() + hours * 3_600_000);

  try {
    if (action === "ban") {
      const row = await db.playerModeration.upsert({
        where: { id: name },
        create: { id: name, name, banned: true, banReason: reason || "Violation of the rules", bannedAt: new Date() },
        update: { banned: true, banReason: reason || "Violation of the rules", bannedAt: new Date() },
      });
      // a banned player loses the mic too
      await chatAdminFetch("/admin/ban", { method: "POST", body: { name, reason: reason || "Banned by admin" } }).catch(() => null);
      return NextResponse.json({ ok: true, action, player: { name, banned: row.banned, banReason: row.banReason } });
    }

    if (action === "unban") {
      const row = await db.playerModeration.upsert({
        where: { id: name },
        create: { id: name, name },
        update: { banned: false, banReason: null, bannedAt: null },
      });
      await chatAdminFetch("/admin/unban", { method: "POST", body: { name } }).catch(() => null);
      return NextResponse.json({ ok: true, action, player: { name, banned: row.banned } });
    }

    if (action === "mute") {
      const row = await db.playerModeration.upsert({
        where: { id: name },
        create: { id: name, name, muted: true, muteUntil, banReason: reason || null },
        update: { muted: true, muteUntil },
      });
      await chatAdminFetch("/admin/mute", { method: "POST", body: { name, hours, reason: reason || "Chat restricted by admin" } }).catch(() => null);
      return NextResponse.json({ ok: true, action, player: { name, muted: row.muted, muteUntil: row.muteUntil } });
    }

    if (action === "unmute") {
      const row = await db.playerModeration.upsert({
        where: { id: name },
        create: { id: name, name },
        update: { muted: false, muteUntil: null },
      });
      await chatAdminFetch("/admin/unmute", { method: "POST", body: { name } }).catch(() => null);
      return NextResponse.json({ ok: true, action, player: { name, muted: row.muted } });
    }

    if (action === "notes") {
      const row = await db.playerModeration.upsert({
        where: { id: name },
        create: { id: name, name, notes },
        update: { notes },
      });
      return NextResponse.json({ ok: true, action, player: { name, notes: row.notes } });
    }

    if (action === "clearflags") {
      const row = await db.playerModeration.upsert({
        where: { id: name },
        create: { id: name, name },
        update: { flaggedCount: 0 },
      });
      return NextResponse.json({ ok: true, action, player: { name, flaggedCount: row.flaggedCount } });
    }

    return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
  } catch (e) {
    console.error("POST /api/admin/players failed", e);
    return NextResponse.json({ ok: false, error: "Action failed." }, { status: 500 });
  }
}
