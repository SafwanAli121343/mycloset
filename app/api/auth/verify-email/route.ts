import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById, setEmailVerified } from "@/lib/db/users";
import { applyApiRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { rejectOversizedBody } from "@/lib/security/validate";
import { verifyCode } from "@/lib/auth/verificationCodes";
import { auditLog } from "@/lib/security/auditLog";

export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 1024);
  if (oversized) return oversized;

  const rateBlock = applyApiRateLimit(req, "auth:verify-email", 10, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.email_verified) return NextResponse.json({ ok: true, alreadyVerified: true });

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
  }

  const result = await verifyCode(session.userId, "email_verify", code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await setEmailVerified(session.userId);
  auditLog("email_verified", session.userId, getClientIp(req));

  return NextResponse.json({ ok: true });
}
