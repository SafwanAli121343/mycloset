// GET /api/outfits/readiness → { ready: boolean }
// Whether this user's wardrobe can form at least one valid outfit — the exact check
// /api/outfits/generate applies before generating (it answers INSUFFICIENT_WARDROBE otherwise),
// using the same garment query and the same generator, so the calendar's "add more items" state
// can never disagree with what generation would actually do. Deterministic, no AI.
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import type { GarmentForScoring } from "@/lib/scoring";
import { generateAndRankAllOutfits } from "@/lib/wardrobeOutfitGen";
import { applyApiRateLimit } from "@/lib/security/rateLimit";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "outfits:readiness", 120, 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same select as /api/outfits/generate's wardrobe fetch — keep the two in sync.
  const { data: garments, error } = await adminClient
    .from("garments")
    .select(
      // `category` is required: resolveSlot() (lib/scoring.ts) slots items by category first.
      // Without it, an item with no sub_type (every free-tier item — sub_type is AI-filled)
      // fit no slot, so a free wardrobe could never form an outfit or a calendar.
      "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
      "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image",
    )
    .eq("user_id", session.userId);
  if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  const wardrobe = (garments ?? []) as unknown as GarmentForScoring[];
  const ready = wardrobe.length > 0 && generateAndRankAllOutfits(wardrobe, { maxTotal: 1 }).length > 0;
  return NextResponse.json({ ready });
}
