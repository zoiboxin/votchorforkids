import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, requireAdmin, verifyPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** POST /api/admin/password { current, next } — change own password */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";

  if (!verifyPassword(current, admin.password)) {
    return NextResponse.json({ ok: false, error: "Current password is incorrect." }, { status: 400 });
  }
  if (next.length < 8) {
    return NextResponse.json({ ok: false, error: "New password must be at least 8 characters." }, { status: 400 });
  }

  await db.adminUser.update({
    where: { id: admin.id },
    data: { password: hashPassword(next) },
  });
  return NextResponse.json({ ok: true });
}
