// GET /api/outfits/all-combos
// Returns every feasible outfit combination scored highest-first.
// Response is { total, items: {[id]: GalleryItem}, outfits: [{score, itemIds}] }
// so each garment's image is serialized exactly once regardless of how many
// outfits it appears in.
//
// Query params:
//   max   - max outfits to return (default 2000)
//   tempF - optional temperature in °F for weather-aware scoring

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits } from "@/lib/wardrobeOutfitGen";
import type { GarmentForScoring } from "@/lib/scoring";

export const maxDuration = 60;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type GalleryItem = {
  id: string; title: string | null; image: string | null;
  brand: string | null;
  sub_type: string | null; category: string | null; color_primary: string | null;
  aesthetic_tags: string[] | null;
  pros: string[] | null; cons: string[] | null;
};

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const tempF    = searchParams.get("tempF") ? Number(searchParams.get("tempF")) : undefined;
    const maxTotal = searchParams.get("max")   ? Number(searchParams.get("max"))   : 2000;

    const { data: garments, error } = await adminClient
      .from("garments")
      .select(
        "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
        "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image"
      )
      .eq("user_id", session.userId);

    if (error) return NextResponse.json({ error: "DB error: " + error.message }, { status: 500 });
    if (!garments?.length) return NextResponse.json({ total: 0, items: {}, outfits: [] });

    const ranked = generateAndRankAllOutfits(garments as unknown as GarmentForScoring[], {
      maxTotal,
      tempF,
    });

    type RawGarment = GarmentForScoring & {
      brand?: string | null; category?: string | null; aesthetic_tags?: string[] | null;
    };
    const rows = garments as unknown as RawGarment[];

    // Build a deduplicated item map — each garment image appears exactly once.
    const itemMap: Record<string, GalleryItem> = {};
    for (const g of rows) {
      itemMap[g.id] = {
        id:             g.id,
        title:          g.title,
        image:          g.image,
        brand:          g.brand ?? null,
        sub_type:       g.sub_type,
        category:       g.category ?? null,
        color_primary:  g.color_primary,
        aesthetic_tags: g.aesthetic_tags ?? null,
        pros:           g.pros ?? null,
        cons:           g.cons ?? null,
      };
    }

    const outfits = ranked.map(({ score, items }) => ({
      score,
      itemIds: items.map(i => i.id),
    }));

    return NextResponse.json({ total: outfits.length, items: itemMap, outfits });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[all-combos]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
