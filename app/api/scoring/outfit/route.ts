import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { scoreOutfit, isValidOutfitCombination, getSlot } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SELECT_COLS = [
  // `category` is required for resolveSlot() — see /api/outfits/generate's select.
  "id","title","brand","category","sub_type","material","color_primary","color_secondary",
  "pattern","formality","aesthetic_tags","pros","cons","color_pairings","color_clashes","tags","image",
].join(",");

export async function POST(req: Request) {
  const rateBlock = applyApiRateLimit(req, "scoring:outfit", 300, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [billingUser, body] = await Promise.all([
    getUserById(session.userId).catch(() => null),
    req.json().catch(() => null) as Promise<{ garmentIds?: string[]; tempF?: number } | null>,
  ]);

  if (!billingUser || !resolveEntitlement(billingUser).hasAI) {
    // Free tier sees every possible outfit (all-combos) with no score — scoring one specific
    // combination on demand (this endpoint, used by the outfit-builder game/Builder screen's
    // live readout) is itself the AI-tier feature being gated, not just its inputs.
    return Response.json({ score: null, valid: true, reason: null, locked: true });
  }

  if (!body) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { garmentIds, tempF } = body;
  if (!Array.isArray(garmentIds) || garmentIds.length === 0) {
    return Response.json({ error: "garmentIds array required" }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("garments")
    .select(SELECT_COLS)
    .eq("user_id", session.userId)
    .in("id", garmentIds);

  if (error) return Response.json({ error: "Something went wrong." }, { status: 500 });

  const garments = (data ?? []) as unknown as GarmentForScoring[];

  // Check validity separately so the game can distinguish "invalid combo" from a low score
  const wearable = garments.filter(g => getSlot(g.sub_type) !== "acc");
  const validity = isValidOutfitCombination(wearable);
  const score = validity.valid ? scoreOutfit(garments, typeof tempF === "number" ? tempF : undefined) : 0;

  return Response.json({ score, valid: validity.valid, reason: validity.reason ?? null });
}
