import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "@/lib/db/users";
import { createSession, setSessionCookie, setRefreshTokenCookie } from "@/lib/auth/session";
import { createRefreshToken } from "@/lib/db/refreshTokens";
import {
  checkRateLimit, checkAccountLockout, recordFailedLogin, clearFailedLogins, getClientIp,
} from "@/lib/security/rateLimit";
import { validateEmail, rejectOversizedBody } from "@/lib/security/validate";
import { auditLog } from "@/lib/security/auditLog";
import { verificationStatus } from "@/lib/auth/verificationGate";

// Generic error — never reveal whether the email or password was wrong
const INVALID = "Invalid email or password.";

export async function POST(req: NextRequest) {
  // Reject oversized payloads before parsing
  const oversized = rejectOversizedBody(req, 4096);
  if (oversized) return oversized;

  // IP-based rate limit: 5 attempts per 15 minutes
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`auth:login:${ip}`, 5, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSecs) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const { valid: emailValid, value: email } = validateEmail(body.email);
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";

  if (!emailValid || !password) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  // Account lockout check — keyed by email, 5 failures → 15 min lockout
  const lockout = checkAccountLockout(email);
  if (lockout.locked) {
    return NextResponse.json(
      { error: "Account temporarily locked due to too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(lockout.retryAfterSecs) } }
    );
  }

  const user = await getUserByEmail(email).catch(() => null);

  // Run bcrypt even on a miss so timing stays constant (prevents timing attacks)
  const hashToCompare = user?.password_hash ?? "$2b$12$invalidhashpadding000000000000000000000000000000000000000";
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    recordFailedLogin(email);
    auditLog("login_failed", null, ip, { email });
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  clearFailedLogins(email);
  auditLog("login", user.id, ip);

  const token = await createSession({ userId: user.id, email: user.email });
  const refreshToken = await createRefreshToken(user.id);
  await setSessionCookie(token);
  await setRefreshTokenCookie(refreshToken);

  // token + refreshToken consumed by the native app; the web client relies on httpOnly cookies.
  return NextResponse.json({
    id: user.id, email: user.email, token, refreshToken,
    ...verificationStatus(user),
  });
}
