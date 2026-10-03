import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserById, getUserByEmail, updateUserPasswordHash } from "@/lib/db/users";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { validatePassword, rejectOversizedBody } from "@/lib/security/validate";
import { auditLog } from "@/lib/security/auditLog";
import { revokeAllRefreshTokens } from "@/lib/db/refreshTokens";
import { wasPasswordRecentlyUsed, recordPasswordHistory } from "@/lib/auth/passwordHistory";

// POST /api/auth/change-password
// Requires the current password (re-auth, not just an active session) before accepting a new
// one — the same standard every major app follows for this specific action, since a hijacked
// but not-yet-expired session token shouldn't be enough on its own to lock the real owner out.
export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 4096);
  if (oversized) return oversized;

  const rateBlock = applyApiRateLimit(req, "auth:change-password", 5, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword.slice(0, 256) : "";
  const { error: pwdError, value: newPassword } = validatePassword(body.newPassword);
  if (!currentPassword) return NextResponse.json({ error: "Current password is required." }, { status: 400 });
  if (pwdError) return NextResponse.json({ error: pwdError }, { status: 400 });

  // Re-fetch full row (getUserById intentionally omits password_hash) to verify current password.
  const full = await getUserByEmail(session.email).catch(() => null);
  const user = full ?? (await getUserById(session.userId).catch(() => null));
  if (!user || !("password_hash" in user) || !user.password_hash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    const ip = getClientIp(req);
    auditLog("login_failed", session.userId, ip, { reason: "change-password re-auth" });
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  if (await wasPasswordRecentlyUsed(session.userId, newPassword, user.password_hash)) {
    return NextResponse.json(
      { error: "You can't reuse a recent password. Please choose a different one." },
      { status: 400 }
    );
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await recordPasswordHistory(session.userId, user.password_hash);
  await updateUserPasswordHash(session.userId, newHash);

  // Force every other device/session to re-authenticate with the new password.
  await revokeAllRefreshTokens(session.userId).catch(() => {});
  auditLog("password_changed", session.userId, getClientIp(req));

  return NextResponse.json({ ok: true });
}
