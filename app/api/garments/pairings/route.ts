import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit } from "@/lib/billing/entitlements";
import { computePairings } from "@/lib/pairings";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/garments/pairings?id=GARMENT_ID
// Computes fresh style_pairings for one garment against the current wardrobe,
// saves the result back to DB, and returns it.
export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "garments:pairings", 60, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Was previously reachable and ungated for ANY logged-in user, free tier included — it fires
  // silently (no button, no "AI FEATURE" gate) every time an item comes into view in the Closet,
  // which made it the highest-volume real cost leak found in the free-tier AI audit. Gated the
  // same way /api/preview/compare already is.
  const billingUser = await getUserById(session.userId).catch(() => null);
  const ent = billingUser ? resolveEntitlement(billingUser) : null;
  // A Pro user who's already hit their own monthly $ cap falls back to the exact same non-AI
  // result free tier gets below — this is a background call with no button of its own, not an
  // interactive action worth interrupting with an error; ai_credits (free tier's balance) is
  // untouched here since consumeAiCredit's Pro branch never reads/writes it.
  const aiAllowed = !!ent?.hasAI && (ent.tier !== "pro" || (await consumeAiCredit(billingUser!)).allowed);

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: own } = await adminClient.from("garments")
    .select("ai_unlocked, style_pairings").eq("id", id).eq("user_id", session.userId).maybeSingle();
  const unlocked = own as { ai_unlocked?: boolean; style_pairings?: string[] | null } | null;
  // A free user's item unlocked with "Use score?" keeps the AI pairings computed when it was
  // scored — never overwritten by the free version below.
  if (!aiAllowed && unlocked?.ai_unlocked && unlocked.style_pairings?.length) {
    return NextResponse.json({ pairings: unlocked.style_pairings });
  }

  try {
    const r = await computePairings(session.userId, id, aiAllowed ? billingUser! : null, { persist: !unlocked?.ai_unlocked || aiAllowed });
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ pairings: r.pairings });
  } catch (e) {
    console.error("Pairings AI call failed:", e);
    return NextResponse.json({ pairings: [] });
  }
}
