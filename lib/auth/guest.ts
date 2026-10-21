// Guest accounts (App Store guideline 5.1.1(v): the app can't require registration just to try
// it). "Continue without an account" creates a real account with no personal information — a
// placeholder address on the reserved .invalid domain (it can never be a real inbox) and a random
// password kept only in the device's secure storage — so every feature works exactly as for a
// registered user. Settings → Create Account later attaches a real email + password to the SAME
// account (/api/auth/claim), keeping the closet.
import { randomBytes, randomUUID } from "crypto";

export const GUEST_EMAIL_DOMAIN = "guest.mycloset.invalid";

export function isGuestEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

export function newGuestCredentials(): { email: string; password: string } {
  return { email: `guest-${randomUUID()}@${GUEST_EMAIL_DOMAIN}`, password: randomBytes(24).toString("base64url") };
}
