import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { NextRequest } from "next/server";
import { isRevoked } from "@/lib/auth/tokenRevocation";

const COOKIE_NAME = "mycloset_session";
const REFRESH_COOKIE_NAME = "mycloset_refresh";
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const EXPIRY_SECONDS = 60 * 60; // 1 hour (refresh tokens extend sessions to 30 days)
const REFRESH_EXPIRY_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = {
  userId: string;
  email: string;
};

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(JWT_SECRET);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.userId as string, email: payload.email as string };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: EXPIRY_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function setRefreshTokenCookie(refreshToken: string) {
  const store = await cookies();
  store.set(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_EXPIRY_SECONDS,
    path: "/api/auth/refresh",
  });
}

export async function getRefreshTokenFromCookies(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE_NAME)?.value ?? null;
}

export async function clearRefreshTokenCookie() {
  const store = await cookies();
  store.delete(REFRESH_COOKIE_NAME);
}

// Web (browser) auth uses the httpOnly cookie set by setSessionCookie. The native app has no
// browser cookie jar to rely on — it stores the JWT itself (expo-secure-store) after login and
// sends it as `Authorization: Bearer <token>` instead. Checking the cookie first preserves the
// web app's exact existing behavior unchanged; the Bearer fallback is purely additive and only
// engages for clients that don't send the cookie at all.
export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) return verifySessionWithRevocation(token);

  const hdrs = await headers();
  const auth = hdrs.get("authorization");
  if (auth?.startsWith("Bearer ")) return verifySessionWithRevocation(auth.slice(7));

  return null;
}

// Adds revocation check on top of verifySession — only call from Node.js runtime (route handlers).
// The in-memory blocklist is not shared with the Edge runtime used by middleware.
async function verifySessionWithRevocation(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.jti && isRevoked(payload.jti as string)) return null;
    return { userId: payload.userId as string, email: payload.email as string };
  } catch {
    return null;
  }
}

// For use in middleware (Edge Runtime) — reads from request directly
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}
