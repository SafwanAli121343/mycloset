import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { rejectOversizedBody, sanitizeString } from "@/lib/security/validate";
import { auditLog } from "@/lib/security/auditLog";
import { setUserTier, getUserById } from "@/lib/db/users";
import { maybeStartProBackfill, runJob } from "@/lib/analysisJobs";
import { resolveEntitlement } from "@/lib/billing/entitlements";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 300; // the Pro catch-up runs after the response

// POST /api/billing/redeem — body { code: string }
// Settings screen "Redeem Key" feature. Codes are single-use, inserted by hand into the
// redeem_keys table (see supabase/add_billing_entitlements.sql) — there's no self-serve
// generation UI, this is meant for support/promo grants.
export async function POST(req: NextRequest) {
  const oversized = rejectOversizedBody(req, 1024);
  if (oversized) return oversized;

  const rateBlock = applyApiRateLimit(req, "billing:redeem", 10, 15 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const code = sanitizeString(body?.code, 64).toUpperCase();
  if (!code) return NextResponse.json({ error: "Enter a key." }, { status: 400 });

  // Atomic claim: this UPDATE only affects the row if it's still unredeemed, so two concurrent
  // requests racing on the same code can't both succeed.
  const { data: claimed, error } = await adminClient
    .from("redeem_keys")
    .update({ redeemed_by: session.userId, redeemed_at: new Date().toISOString() })
    .eq("code", code)
    .is("redeemed_by", null)
    .select()
    .maybeSingle();

  if (error || !claimed) {
    auditLog("key_redeem_failed", session.userId, getClientIp(req), { code });
    return NextResponse.json({ error: "That key is invalid or has already been used." }, { status: 400 });
  }

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (claimed.grants_tier && claimed.grants_days) {
    // Extend from the later of "now" or the user's current expiry, so redeeming a key while
    // already subscribed adds time rather than shortening an existing period.
    const currentExpiry = user.tier_expires_at ? new Date(user.tier_expires_at).getTime() : 0;
    const base = Math.max(Date.now(), currentExpiry);
    const newExpiry = new Date(base + claimed.grants_days * 24 * 60 * 60 * 1000).toISOString();
    await setUserTier(session.userId, claimed.grants_tier, newExpiry, "key");
    // Same catch-up as a store purchase (see the RevenueCat webhook).
    after(async () => {
      const job = await maybeStartProBackfill(session.userId).catch(() => null);
      if (job) await runJob(job);
    });
  }
  if (claimed.grants_credits) {
    await adminClient.rpc("add_purchase_credit", { p_user: session.userId, p_kind: "item", p_n: claimed.grants_credits });
  }

  auditLog("key_redeemed", session.userId, getClientIp(req), { code });

  const updated = await getUserById(session.userId).catch(() => user);
  const ent = resolveEntitlement(updated ?? user);
  return NextResponse.json({
    ok: true,
    tier: ent.tier,
    hasAI: ent.hasAI,
    aiCredits: Number.isFinite(ent.aiCredits) ? ent.aiCredits : null,
  });
}
