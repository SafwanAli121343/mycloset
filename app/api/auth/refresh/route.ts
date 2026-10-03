import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie, getRefreshTokenFromCookies, setRefreshTokenCookie } from "@/lib/auth/session";
import { rotateRefreshToken } from "@/lib/db/refreshTokens";
import { getUserById } from "@/lib/db/users";
import { applyApiRateLimit } from "@/lib/security/rateLimit";

// POST /api/auth/refresh
// Exchanges a valid refresh token for a new short-lived JWT + rotated refresh token.
// Web clients send the refresh token via the httpOnly cookie; native app sends it in the body.
export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "auth:refresh", 20, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  // Accept refresh token from the httpOnly cookie (web) or request body (native app)
  let rawToken: string | null = await getRefreshTokenFromCookies();
  if (!rawToken) {
    const body = await req.json().catch(() => null);
    if (body && typeof body.refreshToken === "string") rawToken = body.refreshToken;
  }

  if (!rawToken) {
    return NextResponse.json({ error: "No refresh token." }, { status: 401 });
  }

  const result = await rotateRefreshToken(rawToken).catch(() => null);
  if (!result) {
    return NextResponse.json({ error: "Invalid or expired refresh token." }, { status: 401 });
  }

  const user = await getUserById(result.userId).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 401 });
  }

  const token = await createSession({ userId: user.id, email: user.email });
  await setSessionCookie(token);
  await setRefreshTokenCookie(result.newToken);

  // Native app: return both tokens in the body so it can persist them via expo-secure-store
  return NextResponse.json({ token, refreshToken: result.newToken });
}
