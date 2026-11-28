import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { chatAdminFetch } from "@/lib/chat-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/chatmod { action, name, hours?, reason? }
 * actions: mute · unmute · chatban · chatunban · broadcast
 * Mirrors PlayerModeration so the roster shows live restriction state.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const name = typeof body?.name === "string" ? body.name.trim().toLowerCase().slice(0, 24) : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  const hours = Math.max(0.25, Math.min(24 * 30, Number(body?.hours) || 24)); // 0.25h = 15 min floor, fractions allowed (0.5 = 30 min)
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 140) : "";

  if ((action === "mute" || action === "chatban" || action === "chatunban" || action === "unmute") && !name) {
    return NextResponse.json({ ok: false, error: "A player name is required." }, { status: 400 });
  }

  const mirror = async (muted: boolean, until: Date | null, flaggedDelta = 0) => {
    await db.playerModeration.upsert({
      where: { id: name },
      create: { id: name, name, muted, muteUntil: until },
      update: { muted, muteUntil: until, ...(flaggedDelta ? { flaggedCount: { increment: flaggedDelta } } : {}) },
    }).catch(() => null);
  };

  let r: Awaited<ReturnType<typeof chatAdminFetch>> = { ok: true, status: 200, data: null };
  switch (action) {
    case "mute":
      r = await chatAdminFetch("/admin/mute", { method: "POST", body: { name, hours, reason: reason || "Chat restricted by admin" } });
      await mirror(true, new Date(Date.now() + hours * 3_600_000));
      break;
    case "unmute":
      r = await chatAdminFetch("/admin/unmute", { method: "POST", body: { name } });
      await mirror(false, null);
      break;
    case "chatban":
      r = await chatAdminFetch("/admin/ban", { method: "POST", body: { name, reason: reason || "Banned from chat by admin" } });
      break;
    case "chatunban":
      r = await chatAdminFetch("/admin/unban", { method: "POST", body: { name } });
      break;
    case "broadcast":
      if (!message) return NextResponse.json({ ok: false, error: "A message is required." }, { status: 400 });
      r = await chatAdminFetch("/admin/broadcast", { method: "POST", body: { message } });
      break;
    default:
      return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
  }

  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Chat relay unreachable." }, { status: 502 });
  return NextResponse.json({ ok: true, action });
}
