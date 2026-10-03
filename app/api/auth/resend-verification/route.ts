import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/users";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createVerificationCode } from "@/lib/auth/verificationCodes";
import { sendVerificationCodeEmail } from "@/lib/email/resend";

export async function POST(req: NextRequest) {
  // Tighter than most auth routes — this sends an email on every successful call, so it's the
  // one most worth capping hard against spam/abuse of someone else's inbox (can't target another
  // user's email though, since it always resends to the session's own address).
  const rateBlock = applyApiRateLimit(req, "auth:resend-verification", 3, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.email_verified) return NextResponse.json({ ok: true, alreadyVerified: true });

  try {
    const code = await createVerificationCode(session.userId, "email_verify");
    await sendVerificationCodeEmail(user.email, code);
  } catch (e) {
    console.error("[auth/resend-verification] failed:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
