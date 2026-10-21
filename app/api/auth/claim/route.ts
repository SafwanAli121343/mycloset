// POST /api/auth/claim { email, password } — a guest creates a real account. The email and
// password are attached to the guest's EXISTING account, so their closet, outfits and calendar
// carry over. Only guest accounts can be claimed.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { getUserById, getUserByEmail } from "@/lib/db/users";
import { getSessionFromCookies, createSession, setSessionCookie, setRefreshTokenCookie } from "@/lib/auth/session";
import { createRefreshToken, revokeAllRefreshTokens } from "@/lib/db/refreshTokens";
import { applyApiRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { validateEmail, validatePassword, rejectOversizedBody } from "@/lib/security/validate";
import { auditLog } from "@/lib/security/auditLog";
import { isGuestEmail } from "@/lib/auth/guest";
import { verificationStatus } from "@/lib/auth/verificationGate";
import { createVerificationCode } from "@/lib/auth/verificationCodes";
import { sendVerificationCodeEmail, isEmailSendingLive } from "@/lib/email/resend";

const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 4096);
  if (oversized) return oversized;
  const rateBlock = applyApiRateLimit(req, "auth:claim", 10, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGuestEmail(user.email)) return NextResponse.json({ error: "This account already has an email." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const { valid: emailValid, value: email } = validateEmail(body?.email);
  if (!emailValid) return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  const { error: pwdError, value: password } = validatePassword(body?.password);
  if (pwdError) return NextResponse.json({ error: pwdError }, { status: 400 });
  if (await getUserByEmail(email).catch(() => null)) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const { error } = await adminClient.from("users")
    .update({ email: email.toLowerCase().trim(), password_hash: await bcrypt.hash(password, 12), email_verified: false })
    .eq("id", user.id);
  if (error) {
    console.error("[auth/claim] update failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Fresh session for the new email (the old token carries the guest address).
  await revokeAllRefreshTokens(user.id);
  const token = await createSession({ userId: user.id, email });
  const refreshToken = await createRefreshToken(user.id);
  await setSessionCookie(token);
  await setRefreshTokenCookie(refreshToken);
  auditLog("claim_guest", user.id, getClientIp(req));
  if (isEmailSendingLive()) {
    createVerificationCode(user.id, "email_verify").then(code => sendVerificationCodeEmail(email, code)).catch(() => {});
  }

  return NextResponse.json({
    id: user.id, email, token, refreshToken,
    ...verificationStatus({ email_verified: false, created_at: new Date().toISOString() }),
  });
}
