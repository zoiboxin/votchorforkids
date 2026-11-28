import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** POST /api/admin/logout — clears the session cookie */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
