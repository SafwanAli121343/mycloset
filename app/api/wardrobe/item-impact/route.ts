// GET /api/wardrobe/item-impact?id=<garmentId>
// Returns how much adding a specific garment improves (or doesn't) the user's wardrobe.
// Pure scoring — no LLM call, fast response.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { computeItemImpact } from "@/lib/wardrobeAnalysis";
import type { GarmentForScoring } from "@/lib/scoring";
import type { WardrobeAnalysis } from "@/lib/wardrobeAnalysis";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FIELDS =
  "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
  "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image";

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "wardrobe:impact", 300, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    candidate: GarmentForScoring;
    currentAnalysis: Pick<WardrobeAnalysis, "gaps" | "aesthetics" | "colors">;
  };

  if (!body.candidate || !body.currentAnalysis) {
    return NextResponse.json({ error: "Missing candidate or currentAnalysis" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("garments")
    .select(FIELDS)
    .eq("user_id", session.userId);

  if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  const wardrobe = (data ?? []) as unknown as GarmentForScoring[];
  const impact = computeItemImpact(wardrobe, body.candidate, body.currentAnalysis);

  return NextResponse.json(impact);
}
