import type { User } from "@/lib/db/users";
import { isEmailSendingLive } from "@/lib/email/resend";

// 7-day grace period: a brand-new account works fully unverified so a delayed/spam-filtered
// email never locks someone out of an account they just made. Past that window, the account is
// hard-gated at next login until the email is verified.
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// While EMAIL_SENDING_LIVE is off no code can ever arrive, so verification is skipped entirely:
// every account counts as verified (no banners, no gate, purchases not blocked). Once emails go
// live, set EMAIL_LIVE_SINCE (an ISO date, e.g. 2026-11-01) to that day so accounts made before
// it get their 7 days from then instead of being gated on the spot.
export function verificationStatus(user: Pick<User, "email_verified" | "created_at">): {
  emailVerified: boolean;
  verificationRequired: boolean;
} {
  if (!isEmailSendingLive()) return { emailVerified: true, verificationRequired: false };
  const emailVerified = !!user.email_verified;
  const liveSince = Date.parse(process.env.EMAIL_LIVE_SINCE ?? "");
  const graceStart = Math.max(new Date(user.created_at).getTime(), Number.isNaN(liveSince) ? 0 : liveSince);
  const pastGrace = Date.now() - graceStart > GRACE_PERIOD_MS;
  return { emailVerified, verificationRequired: !emailVerified && pastGrace };
}
