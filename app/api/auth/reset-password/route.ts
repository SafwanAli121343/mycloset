import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmail, updateUserPasswordHash } from "@/lib/db/users";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { validateEmail, validatePassword, rejectOversizedBody } from "@/lib/security/validate";
import { verifyCode } from "@/lib/auth/verificationCodes";
import { wasPasswordRecentlyUsed, recordPasswordHistory } from "@/lib/auth/passwordHistory";
import { revokeAllRefreshTokens } from "@/lib/db/refreshTokens";
import { auditLog } from "@/lib/security/auditLog";

export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 1024);
  if (oversized) return oversized;

  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`auth:reset-password:${ip}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSecs) } }
    );
  }

  const body = await req.json().catch(() => null);
  const { valid: emailValid, value: email } = validateEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const { error: pwdError, value: newPassword } = validatePassword(body?.newPassword);

  if (!emailValid || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
  }
  if (pwdError) return NextResponse.json({ error: pwdError }, { status: 400 });

  const user = await getUserByEmail(email).catch(() => null);
  if (!user) return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });

  const result = await verifyCode(user.id, "password_reset", code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (await wasPasswordRecentlyUsed(user.id, newPassword, user.password_hash)) {
    return NextResponse.json(
      { error: "You can't reuse a recent password. Please choose a different one." },
      { status: 400 }
    );
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await recordPasswordHistory(user.id, user.password_hash);
  await updateUserPasswordHash(user.id, newHash);
  await revokeAllRefreshTokens(user.id).catch(() => {});
  auditLog("password_reset", user.id, ip);

  return NextResponse.json({ ok: true });
}
