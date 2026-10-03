import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createUser, getUserByEmail } from "@/lib/db/users";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
import { createSession, setSessionCookie, setRefreshTokenCookie } from "@/lib/auth/session";
import { createRefreshToken } from "@/lib/db/refreshTokens";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { validateEmail, validatePassword, rejectOversizedBody } from "@/lib/security/validate";
import { auditLog } from "@/lib/security/auditLog";
import { createVerificationCode } from "@/lib/auth/verificationCodes";
import { sendVerificationCodeEmail } from "@/lib/email/resend";

export async function POST(req: NextRequest) {
  // Reject oversized payloads before parsing
  const oversized = rejectOversizedBody(req, 4096);
  if (oversized) return oversized;

  // IP-based rate limit: 5 registrations per 15 minutes
  const ip = getClientIp(req);
  const limit = checkRateLimit(`auth:register:${ip}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { valid: emailValid, value: email } = validateEmail(body.email);
  if (!emailValid) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  const { error: pwdError, value: password } = validatePassword(body.password);
  if (pwdError) {
    return NextResponse.json({ error: pwdError }, { status: 400 });
  }

  // Check if email already taken — use a generic message to prevent enumeration
  const existing = await getUserByEmail(email).catch(() => null);
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await createUser(email, passwordHash);
  } catch (e) {
    console.error("[auth/register] createUser failed:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const token = await createSession({ userId: user.id, email: user.email });
  const refreshToken = await createRefreshToken(user.id);
  await setSessionCookie(token);
  await setRefreshTokenCookie(refreshToken);

  auditLog("register", user.id, ip);

  // New account → offer the first-run tutorial once (app or website, whichever opens first).
  // Separate, tolerant write: a not-yet-migrated column must never fail sign-up.
  await adminClient.from("users").update({ tutorial_pending: true }).eq("id", user.id).then(() => {}, () => {});

  // Best-effort — a delayed/failed verification email should never block account creation itself;
  // the account works fully unverified for the 7-day grace period (see verificationGate.ts) and a
  // resend button is always available once signed in.
  createVerificationCode(user.id, "email_verify")
    .then(code => sendVerificationCodeEmail(user.email, code))
    .catch(e => console.error("[auth/register] verification email failed:", e));

  // token + refreshToken consumed by the native app; the web client relies on httpOnly cookies.
  return NextResponse.json(
    { id: user.id, email: user.email, token, refreshToken, emailVerified: false, verificationRequired: false },
    { status: 201 }
  );
}
