import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { clearSessionCookie, clearRefreshTokenCookie, getRefreshTokenFromCookies } from "@/lib/auth/session";
import { revokeToken } from "@/lib/auth/tokenRevocation";
import { auditLog } from "@/lib/security/auditLog";
import { revokeAllRefreshTokens } from "@/lib/db/refreshTokens";

const COOKIE_NAME = "mycloset_session";
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function POST(req: NextRequest) {
  // Add token to server-side revocation list so it can't be reused after logout,
  // even if someone retains a copy of it (e.g. a captured Bearer token in the native app).
  const token = req.cookies.get(COOKIE_NAME)?.value
    ?? req.headers.get("authorization")?.replace(/^Bearer /, "");

  let userId: string | null = null;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      userId = (payload.userId as string) ?? null;
      if (payload.jti && payload.exp) {
        revokeToken(payload.jti as string, payload.exp as number);
      }
    } catch {
      // Token already invalid — nothing to revoke
    }
  }

  if (userId) await revokeAllRefreshTokens(userId).catch(() => {});
  auditLog("logout", userId, req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null);
  await clearSessionCookie();
  await clearRefreshTokenCookie();
  return NextResponse.json({ success: true });
}
