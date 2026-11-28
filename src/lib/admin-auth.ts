/**
 * 🛡️ CPANEL AUTH — self-contained admin sessions for /cpanel_app.
 *
 *  • Passwords: scrypt ("salt:hex") — never stored in plain text.
 *  • Sessions: HMAC-SHA256 signed token in an httpOnly cookie
 *    (`cpanel_session`), payload = {aid, email, exp} base64url.
 *  • requireAdmin(req) guards every /api/admin/* route.
 *  • The default SUPERADMIN (info@zoibox.com / Admin@595965) is seeded on
 *    first boot by ensureSeedAdmin() — called from the login route.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "cpanel_session";
/** 7-day admin session */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || "7nights-cpanel-session-v1";
}

/* ---------------- default admin seed ---------------- */

export const DEFAULT_ADMIN_EMAIL = "info@zoibox.com";
export const DEFAULT_ADMIN_PASSWORD = "Admin@595965";
export const DEFAULT_ADMIN_NAME = "Game Admin";

/** idempotent — creates the default SUPERADMIN when the table is empty */
export async function ensureSeedAdmin(): Promise<void> {
  try {
    const count = await db.adminUser.count();
    if (count > 0) return;
    await db.adminUser.create({
      data: {
        email: DEFAULT_ADMIN_EMAIL,
        password: hashPassword(DEFAULT_ADMIN_PASSWORD),
        name: DEFAULT_ADMIN_NAME,
        role: "SUPERADMIN",
      },
    });
    console.log(`🛡️ cpanel: default admin seeded (${DEFAULT_ADMIN_EMAIL})`);
  } catch (e) {
    console.error("cpanel: seed admin failed", e);
  }
}

/* ---------------- passwords ---------------- */

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hex = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hex}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [salt, hex] = stored.split(":");
    if (!salt || !hex) return false;
    const test = scryptSync(pw, salt, 64);
    const real = Buffer.from(hex, "hex");
    return test.length === real.length && timingSafeEqual(test, real);
  } catch {
    return false;
  }
}

/* ---------------- signed session token ---------------- */

interface TokenPayload {
  aid: string;
  email: string;
  /** epoch ms expiry */
  exp: number;
}

function b64u(s: Buffer | string): string {
  return Buffer.from(s).toString("base64url");
}

export function signToken(payload: TokenPayload): string {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (!payload?.aid || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** pull the session payload out of a Request's cookies (null = not admin) */
export function sessionFrom(req: Request): TokenPayload | null {
  const cookie = req.headers.get("cookie") ?? "";
  const hit = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!hit) return null;
  return verifyToken(hit.slice(SESSION_COOKIE.length + 1));
}

/** guard for /api/admin/* — returns the signed-in admin row, or null */
export async function requireAdmin(req: Request) {
  const sess = sessionFrom(req);
  if (!sess) return null;
  try {
    const admin = await db.adminUser.findUnique({ where: { id: sess.aid } });
    return admin;
  } catch {
    return null;
  }
}
