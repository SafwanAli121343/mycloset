import { NextRequest, NextResponse, after } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getWardrobeScanCredits } from "@/lib/billing/purchaseCredits";
import { maybeStartProBackfill, runJob } from "@/lib/analysisJobs";

// The Pro catch-up (if due) runs after the response.
export const maxDuration = 300;

// GET /api/billing/status — what the current user is entitled to right now. Called on app
// launch and after any purchase/redeem flow so the client's gating always reflects the DB,
// never a locally-cached guess.
export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "billing:status", 300, 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ent = resolveEntitlement(user);
  // Safety net for free → Pro: if the purchase webhook's catch-up was missed or cut short, the
  // next app launch finishes it (cooldown + one-running-job index prevent repeats).
  if (ent.hasAI) {
    after(async () => {
      const job = await maybeStartProBackfill(user.id).catch(() => null);
      if (job) await runJob(job);
    });
  }
  return NextResponse.json({
    tier: ent.tier,
    hasAI: ent.hasAI,
    aiCredits: Number.isFinite(ent.aiCredits) ? ent.aiCredits : null,
    // One-time purchase balances by type (Settings → PLAN shows both).
    itemScans: user.ai_credits ?? 0,
    wardrobeScans: await getWardrobeScanCredits(user.id),
    isFullAccessOverride: ent.isFullAccessOverride,
    tierExpiresAt: user.tier_expires_at ?? null,
  });
}
