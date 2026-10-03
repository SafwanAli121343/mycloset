// Shared helper for both 6-digit-code flows: signup email verification and password-reset.
// See supabase/add_email_verification.sql for the verification_codes table shape.

import { createHash, randomInt } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { isEmailSendingLive } from "@/lib/email/resend";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type CodePurpose = "email_verify" | "password_reset";

const MAX_ATTEMPTS = 5;
const EXPIRY_MINUTES: Record<CodePurpose, number> = { email_verify: 15, password_reset: 15 };

function hashCode(code: string): string {
  // Peppered with JWT_SECRET so a raw DB leak alone isn't enough to recover valid codes —
  // matches this app's existing "server secret, not a dedicated one per concern" convention.
  return createHash("sha256").update(`${code}:${process.env.JWT_SECRET}`).digest("hex");
}

// While EMAIL_SENDING_LIVE is off, no email actually goes out (see lib/email/resend.ts) — so a
// random code would be unreadable/untestable without digging through server logs. A fixed code
// keeps every other part of the process real (a row is still created, hashed, expired, attempt-
// limited, and consumed exactly as it would be in production) while staying testable end-to-end
// from the UI alone. Flip EMAIL_SENDING_LIVE to "true" once the sending domain is verified and
// codes become genuinely random again automatically — no code change needed at that point.
//
// Fail-closed in production: the fixed code applies only in local development, or where
// ALLOW_FIXED_TEST_CODES="true" is set deliberately (e.g. a private staging deploy). Otherwise a
// production deploy that simply forgot EMAIL_SENDING_LIVE would make every account's password-
// reset code "123456" — full account takeover for anyone who knows an email address.
function fixedTestCodesAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_FIXED_TEST_CODES === "true";
}
function generateCode(): string {
  if (!isEmailSendingLive() && fixedTestCodesAllowed()) return "123456";
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Creates a new code for (userId, purpose), invalidating any previously issued unused codes of
// the same purpose so an old email's code can't be replayed after a fresh one was requested.
// Returns the plaintext code to send via email — never stored in plaintext.
export async function createVerificationCode(userId: string, purpose: CodePurpose): Promise<string> {
  await adminSupabase
    .from("verification_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("used_at", null);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES[purpose] * 60 * 1000).toISOString();

  const { error } = await adminSupabase.from("verification_codes").insert({
    user_id: userId,
    purpose,
    code_hash: hashCode(code),
    expires_at: expiresAt,
  });
  if (error) throw error;

  return code;
}

export type VerifyCodeResult = { ok: true } | { ok: false; error: string };

// `peek`: when true, a correct code is validated but NOT marked used — for a "check before you
// commit" step (e.g. confirming a reset code is valid before showing the new-password screen)
// that a later real reset-password call will re-validate and actually consume.
export async function verifyCode(
  userId: string,
  purpose: CodePurpose,
  code: string,
  opts: { peek?: boolean } = {}
): Promise<VerifyCodeResult> {
  const { data: row, error } = await adminSupabase
    .from("verification_codes")
    .select("id, code_hash, expires_at, used_at, attempts")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row) return { ok: false, error: "Invalid or expired code." };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: "Invalid or expired code." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many incorrect attempts. Request a new code." };

  const matches = hashCode(code) === row.code_hash;
  if (!matches) {
    await adminSupabase.from("verification_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return { ok: false, error: "Incorrect code." };
  }

  if (!opts.peek) {
    await adminSupabase.from("verification_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
  }
  return { ok: true };
}
