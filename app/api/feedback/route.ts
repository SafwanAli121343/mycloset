// POST /api/feedback  { message: string, platform?: "ios" | "android" | "web" } → { ok: true }
// Stores a user's Feedback-page message in the `feedback` table (supabase/add_feedback.sql) —
// viewable in Supabase → Table Editor → feedback — and, when email is live and FEEDBACK_EMAIL is
// set, also forwards it to that inbox. The stored row is the source of truth; an email failure
// never fails the request.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { isEmailSendingLive, isEmailConfigured, sendFeedbackEmail } from "@/lib/email/resend";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_LEN = 5000;

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "feedback", 10, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { message?: unknown; platform?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (message.length > MAX_LEN) return NextResponse.json({ error: `Please keep it under ${MAX_LEN} characters.` }, { status: 400 });
  const platform = body?.platform === "ios" || body?.platform === "android" ? body.platform : "web";

  const user = await getUserById(session.userId).catch(() => null);
  const { error } = await adminClient.from("feedback").insert({
    user_id: session.userId, email: user?.email ?? null, platform, message,
  });
  if (error) {
    console.error("[feedback] insert failed:", error.message);
    return NextResponse.json({ error: error.message.includes("feedback") ? "Feedback isn't set up on the server yet." : "Couldn't send. Try again." }, { status: 500 });
  }

  const to = process.env.FEEDBACK_EMAIL;
  if (to && isEmailSendingLive() && isEmailConfigured()) {
    sendFeedbackEmail(to, user?.email ?? "unknown user", platform, message)
      .catch(e => console.error("[feedback] email failed:", e));
  }
  return NextResponse.json({ ok: true });
}
