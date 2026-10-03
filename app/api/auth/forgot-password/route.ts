import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail } from "@/lib/db/users";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { validateEmail, rejectOversizedBody } from "@/lib/security/validate";
import { createVerificationCode } from "@/lib/auth/verificationCodes";
import { sendPasswordResetCodeEmail } from "@/lib/email/resend";

// Always responds the same way regardless of whether the email exists — same anti-enumeration
// principle as /api/auth/login's generic "Invalid email or password."
const GENERIC_OK = { ok: true, message: "If an account exists for that email, we've sent a reset code." };

export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 1024);
  if (oversized) return oversized;

  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`auth:forgot-password:${ip}`, 5, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSecs) } }
    );
  }

  const body = await req.json().catch(() => null);
  const { valid, value: email } = validateEmail(body?.email);
  if (!valid) return NextResponse.json(GENERIC_OK);

  // Also rate-limit per-email so a single targeted account can't be spammed with reset emails
  // from many IPs.
  const emailLimit = checkRateLimit(`auth:forgot-password:email:${email}`, 3, 15 * 60 * 1000);
  if (!emailLimit.allowed) return NextResponse.json(GENERIC_OK);

  const user = await getUserByEmail(email).catch(() => null);
  if (user) {
    try {
      const code = await createVerificationCode(user.id, "password_reset");
      await sendPasswordResetCodeEmail(user.email, code);
    } catch (e) {
      console.error("[auth/forgot-password] failed:", e);
    }
  }

  return NextResponse.json(GENERIC_OK);
}
