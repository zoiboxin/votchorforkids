import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { chatAdminFetch } from "@/lib/chat-admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/words — the relay's abusive-language filter list */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const r = await chatAdminFetch("/admin/state");
  if (!r.ok || !r.data) {
    return NextResponse.json({ ok: false, error: r.error ?? "Chat relay unreachable." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ...(r.data as object) });
}

/** POST /api/admin/words { word, action: "block" | "flag" } */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { word?: unknown; action?: unknown } | null;
  const word = typeof body?.word === "string" ? body.word.trim().toLowerCase().slice(0, 40) : "";
  const action = body?.action === "flag" ? "flag" : "block";
  if (!word) return NextResponse.json({ ok: false, error: "A word is required." }, { status: 400 });

  const r = await chatAdminFetch("/admin/words", { method: "POST", body: { word, action } });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Add failed." }, { status: 502 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/words { word } */
export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { word?: unknown } | null;
  const word = typeof body?.word === "string" ? body.word.trim().toLowerCase() : "";
  if (!word) return NextResponse.json({ ok: false, error: "A word is required." }, { status: 400 });

  const r = await chatAdminFetch("/admin/words/remove", { method: "POST", body: { word } });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Remove failed." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
