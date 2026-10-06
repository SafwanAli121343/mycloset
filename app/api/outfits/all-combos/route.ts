// GET /api/outfits/all-combos
// Returns every feasible outfit combination scored highest-first.
// Response is { total, items: {[id]: GalleryItem}, outfits: [{score, itemIds}] }
// so each garment's image is serialized exactly once regardless of how many
// outfits it appears in.
//
// Query params:
//   max   - max outfits to return (default 2000)
//   tempF - optional temperature in °F for weather-aware scoring

import { compressedJson } from "@/lib/http/compressedJson";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits } from "@/lib/wardrobeOutfitGen";
import type { GarmentForScoring } from "@/lib/scoring";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";
import { getValidAnalyses, comboKey, IDEAL_THRESHOLD } from "@/lib/outfitAnalysisStore";

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
  const rateBlock = applyApiRateLimit(req, "outfits:all-combos", 300, 60 * 1000);
  if (rateBlock) return rateBlock;

  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const tempF    = searchParams.get("tempF") ? Number(searchParams.get("tempF")) : undefined;
    const maxTotal = searchParams.get("max")   ? Number(searchParams.get("max"))   : 2000;

    // Run alongside the garments query, not before it — this endpoint's own scoring pass is
    // already the slowest thing in the app; an extra sequential DB round trip in front of it
    // only makes that worse for no reason, since the two queries don't depend on each other.
    const [{ data: garments, error }, billingUser] = await Promise.all([
      adminClient
        .from("garments")
        .select(
          "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
          "pattern, formality, aesthetic_tags, aesthetic_source, pros, cons, color_pairings, color_clashes, tags, image"
        )
        .eq("user_id", session.userId),
      getUserById(session.userId).catch(() => null),
    ]);
    const hasAI = !!billingUser && resolveEntitlement(billingUser).hasAI;

    if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    if (!garments?.length) return NextResponse.json({ total: 0, items: {}, outfits: [] });

    const ranked = generateAndRankAllOutfits(garments as unknown as GarmentForScoring[], {
      maxTotal,
      tempF,
    });

    type RawGarment = GarmentForScoring & {
      brand?: string | null; category?: string | null; aesthetic_tags?: string[] | null;
      aesthetic_source?: "manual" | "ai" | null;
    };
    const rows = garments as unknown as RawGarment[];

    // Build a deduplicated item map — each garment image appears exactly once. Free/lapsed
    // tier: every combination is still shown (organization + browsing is always free), but
    // AI-derived fields are stripped rather than deleted — resolveEntitlement lapsing a
    // subscription never touches the underlying row, so this is the only place that data is
    // actually hidden, and it comes right back the moment hasAI is true again. aesthetic_tags is
    // the one exception to stripping: a manually-picked aesthetic (aesthetic_source === "manual",
    // see lib/db/garments.ts) is the user's own data, not an AI feature, so it stays visible even
    // without hasAI — only an AI-inferred aesthetic gets hidden.
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
        aesthetic_tags: (hasAI || g.aesthetic_source === "manual") ? (g.aesthetic_tags ?? null) : null,
        pros:           hasAI ? (g.pros ?? null) : null,
        cons:           hasAI ? (g.cons ?? null) : null,
      };
    }

    // Pro: attach each outfit's stored AI analysis when one still matches it exactly
    // (lib/outfitAnalysisStore.ts) — analyzed outfits show their score and analysis right away;
    // the rest are analyzed by the client as they're shown/opened (POST /api/outfits/combo-analysis).
    const analyses = hasAI
      ? await getValidAnalyses(session.userId, ranked
          .filter(r => r.score >= IDEAL_THRESHOLD)
          .map(r => ({ key: comboKey(r.items.map(i => i.id)), items: r.items, score: r.score })))
          .catch(() => new Map())
      : new Map();

    const outfits = ranked.map(({ score, items }) => {
      const key = comboKey(items.map(i => i.id));
      const a = analyses.get(key);
      return {
        score: hasAI ? score : null,
        itemIds: items.map(i => i.id),
        ...(a ? { analysis: { pros: a.pros, cons: a.cons } } : {}),
      };
    });

    return compressedJson(req, { total: outfits.length, items: itemMap, outfits, hasAI });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[all-combos]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
