import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** GET /api/admin/me → the signed-in admin (or 401) */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  return NextResponse.json({
    ok: true,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role, lastLogin: admin.lastLogin },
  });
}
