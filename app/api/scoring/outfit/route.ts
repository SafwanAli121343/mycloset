import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { scoreOutfit, isValidOutfitCombination, getSlot } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SELECT_COLS = [
  "id","title","brand","sub_type","material","color_primary","color_secondary",
  "pattern","formality","aesthetic_tags","pros","cons","color_pairings","color_clashes","tags","image",
].join(",");

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { garmentIds?: string[]; tempF?: number };
  try {
    body = await request.json();
  } catch {
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

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const garments = (data ?? []) as unknown as GarmentForScoring[];

  // Check validity separately so the game can distinguish "invalid combo" from a low score
  const wearable = garments.filter(g => getSlot(g.sub_type) !== "acc");
  const validity = isValidOutfitCombination(wearable);
  const score = validity.valid ? scoreOutfit(garments, typeof tempF === "number" ? tempF : undefined) : 0;

  return Response.json({ score, valid: validity.valid, reason: validity.reason ?? null });
}
