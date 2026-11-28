import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureSeedAdmin,
  sessionCookie,
  signToken,
  verifyPassword,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** POST /api/admin/login { email, password } → session cookie */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
    }

    await ensureSeedAdmin(); // first boot → default SUPERADMIN exists

    const admin = await db.adminUser.findUnique({ where: { email } });
    if (!admin || !verifyPassword(password, admin.password)) {
      return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
    }

    const token = signToken({
      aid: admin.id,
      email: admin.email,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    await db.adminUser.update({
      where: { id: admin.id },
      data: { lastLogin: new Date() },
    });

    const res = NextResponse.json({
      ok: true,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
    res.headers.set("Set-Cookie", sessionCookie(token));
    return res;
  } catch (e) {
    console.error("POST /api/admin/login failed", e);
    return NextResponse.json({ ok: false, error: "Login failed. Try again." }, { status: 500 });
  }
}
