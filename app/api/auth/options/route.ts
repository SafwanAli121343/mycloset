// GET /api/auth/options → { emailEnabled } — public. Sign-in screens (app and website) hide
// "Forgot password?" while emails aren't being sent, since a reset code could never arrive.
import { NextResponse } from "next/server";
import { isEmailSendingLive } from "@/lib/email/resend";

export async function GET() {
  return NextResponse.json({ emailEnabled: isEmailSendingLive() });
}
