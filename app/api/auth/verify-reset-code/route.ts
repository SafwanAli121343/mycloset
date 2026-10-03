import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail } from "@/lib/db/users";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { validateEmail, rejectOversizedBody } from "@/lib/security/validate";
import { verifyCode } from "@/lib/auth/verificationCodes";

// "Peek" check used by the forgot-password stepper to confirm a code is valid BEFORE advancing
// to the new-password screen, without consuming it — /api/auth/reset-password re-validates and
// actually consumes the same code when the new password is submitted.
export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 1024);
  if (oversized) return oversized;

  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`auth:verify-reset-code:${ip}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSecs) } }
    );
  }

  const body = await req.json().catch(() => null);
  const { valid: emailValid, value: email } = validateEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!emailValid || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
  }

  const user = await getUserByEmail(email).catch(() => null);
  if (!user) return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });

  const result = await verifyCode(user.id, "password_reset", code, { peek: true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
