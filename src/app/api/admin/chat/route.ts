import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { chatAdminFetch } from "@/lib/chat-admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/chat?limit=150 — the live relay's recent + flagged messages */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 150, 10), 500);
  const [chat, state] = await Promise.all([
    chatAdminFetch(`/admin/chat?limit=${limit}`),
    chatAdminFetch("/admin/state"),
  ]);
  if (!chat.ok || !chat.data) {
    return NextResponse.json({ ok: false, error: chat.error ?? "Chat relay unreachable." }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    messages: (chat.data as { messages?: unknown[] }).messages ?? [],
    state: state.data ?? null,
  });
}

/** DELETE /api/admin/chat { id } — remove one message from history + live view */
export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "Message id required." }, { status: 400 });

  const r = await chatAdminFetch("/admin/delete", { method: "POST", body: { id } });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Delete failed." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
