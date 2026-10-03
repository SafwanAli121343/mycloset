import type { User } from "@/lib/db/users";

// 7-day grace period: a brand-new account works fully unverified so a delayed/spam-filtered
// email never locks someone out of an account they just made. Past that window, the account is
// hard-gated at next login until the email is verified.
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function verificationStatus(user: Pick<User, "email_verified" | "created_at">): {
  emailVerified: boolean;
  verificationRequired: boolean;
} {
  const emailVerified = !!user.email_verified;
  const pastGrace = Date.now() - new Date(user.created_at).getTime() > GRACE_PERIOD_MS;
  return { emailVerified, verificationRequired: !emailVerified && pastGrace };
}
