import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import { inferGarmentAttributes, inferGarmentAttributesTextOnly } from "@/lib/aiInference";
import { revalidateGarmentCrossings } from "@/lib/db/wardrobeState";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 30;

// POST /api/garments/reanalyze
// Body: { garmentId: string }
// Re-runs AI inference on an existing garment to refresh pros, cons, aesthetic_tags,
// color_pairings, and color_clashes using the current prompt (fragment/note style).
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { garmentId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { garmentId } = body;
  if (!garmentId) return NextResponse.json({ error: "garmentId required" }, { status: 400 });

  const { data: garment, error: fetchErr } = await adminClient
    .from("garments")
    .select("id,title,brand,category,sub_type,material,color_primary,color_secondary,fit,formality,image")
    .eq("id", garmentId)
    .eq("user_id", session.userId)
    .single();

  if (fetchErr || !garment) {
    return NextResponse.json({ error: "Garment not found" }, { status: 404 });
  }

  const FIELDS = ["aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality"];

  let values: Record<string, unknown>;
  try {
    if (garment.image) {
      // Full vision inference — more accurate
      const result = await inferGarmentAttributes(
        {
          title:          garment.title,
          category:       garment.category ?? "top",
          subType:        garment.sub_type ?? null,
          brand:          garment.brand ?? null,
          colorPrimary:   garment.color_primary ?? null,
          colorSecondary: garment.color_secondary ?? null,
          fit:            garment.fit ?? null,
          material:       garment.material ?? null,
          image:          garment.image,
        },
        FIELDS
      );
      values = result.values;
    } else {
      // Text-only inference
      const result = await inferGarmentAttributesTextOnly({
        title:       garment.title,
        category:    garment.category ?? "top",
        subType:     garment.sub_type ?? null,
        brand:       garment.brand ?? null,
        colorPrimary: garment.color_primary ?? null,
        material:    garment.material ?? null,
        formality:   garment.formality ?? null,
      });
      values = result.values;
    }
  } catch (err) {
    console.error("[reanalyze] inference failed:", err);
    return NextResponse.json({ error: "Analysis failed — try again" }, { status: 500 });
  }

  const updates: Record<string, unknown> = {};
  if (values.aesthetic_tags)  updates.aesthetic_tags  = values.aesthetic_tags;
  if (values.pros)            updates.pros            = values.pros;
  if (values.cons)            updates.cons            = values.cons;
  if (values.color_pairings)  updates.color_pairings  = values.color_pairings;
  if (values.color_clashes)   updates.color_clashes   = values.color_clashes;
  if (values.formality)       updates.formality        = values.formality;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields could be inferred" }, { status: 422 });
  }

  const { error: updateErr } = await adminClient
    .from("garments")
    .update(updates)
    .eq("id", garmentId)
    .eq("user_id", session.userId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // aesthetic_tags is the only field here that wardrobe-analysis crossings depend on — if it
  // changed, re-validate this item's existing aesthetic crossings against the new tags so a
  // crossing earned under the old tags doesn't keep showing as resolved.
  if ("aesthetic_tags" in updates) {
    try {
      await revalidateGarmentCrossings(adminClient, session.userId, garmentId, {
        sub_type:      garment.sub_type,
        category:      garment.category,
        color_primary: garment.color_primary,
        aesthetic_tags: updates.aesthetic_tags as string[],
      });
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ success: true, updated: updates });
}
