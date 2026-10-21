// POST /api/auth/guest — start using the app without an account (see lib/auth/guest.ts).
// Returns the same session shape as /api/auth/register, plus the guest's generated credentials,
// which the app keeps in secure storage to sign back in if its session ever lapses.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { createUser } from "@/lib/db/users";
import { createSession, setSessionCookie, setRefreshTokenCookie } from "@/lib/auth/session";
import { createRefreshToken } from "@/lib/db/refreshTokens";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { auditLog } from "@/lib/security/auditLog";
import { newGuestCredentials } from "@/lib/auth/guest";

const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`auth:guest:${ip}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } },
    );
  }

  const creds = newGuestCredentials();
  let user;
  try {
    user = await createUser(creds.email, await bcrypt.hash(creds.password, 12));
  } catch (e) {
    console.error("[auth/guest] createUser failed:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  // No email to verify; offer the first-run tutorial like any new account. Tolerant writes.
  await adminClient.from("users").update({ email_verified: true, tutorial_pending: true }).eq("id", user.id).then(() => {}, () => {});

  const token = await createSession({ userId: user.id, email: user.email });
  const refreshToken = await createRefreshToken(user.id);
  await setSessionCookie(token);
  await setRefreshTokenCookie(refreshToken);
  auditLog("register_guest", user.id, ip);

  return NextResponse.json(
    { id: user.id, email: user.email, token, refreshToken, emailVerified: true, verificationRequired: false, guestPassword: creds.password },
    { status: 201 },
  );
}
