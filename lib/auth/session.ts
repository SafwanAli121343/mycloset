import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { NextRequest } from "next/server";

const COOKIE_NAME = "mycloset_session";
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  email: string;
};

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
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

// Web (browser) auth uses the httpOnly cookie set by setSessionCookie. The native app has no
// browser cookie jar to rely on — it stores the JWT itself (expo-secure-store) after login and
// sends it as `Authorization: Bearer <token>` instead. Checking the cookie first preserves the
// web app's exact existing behavior unchanged; the Bearer fallback is purely additive and only
// engages for clients that don't send the cookie at all.
export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) return verifySession(token);

  const hdrs = await headers();
  const auth = hdrs.get("authorization");
  if (auth?.startsWith("Bearer ")) return verifySession(auth.slice(7));

  return null;
}

// For use in middleware (Edge Runtime) — reads from request directly
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}
