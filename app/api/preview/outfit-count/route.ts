import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits } from "@/lib/wardrobeOutfitGen";
import { resolveSlot, scorePiece } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";

export const maxDuration = 60;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PREVIEW_ID = "__preview__";

type HypoGarment = Partial<GarmentForScoring> & {
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  sub_type?: string | null;
  material?: string | null;
  color_primary?: string | null;
  pattern?: string | null;
  formality?: string | null;
  aesthetic_tags?: string[] | null;
  pros?: string[] | null;
  cons?: string[] | null;
  color_pairings?: string[] | null;
  color_clashes?: string[] | null;
  image?: string | null;
  // item_tier/novelty_quality come back from deep-analyze undocumented but present at runtime
  // (see lib/aiInference.ts's VISUAL_FIELDS) — scorePiece reads them via tags.tier[0]/
  // tags.novelty_score[0] (see lib/scoring.ts), so a caller needs to pass these through as
  // single-element ARRAYS, matching exactly what app/api/garments/route.ts writes to the DB on
  // save and what app/preview/PreviewClient.tsx's own pieceScore() builds client-side — a plain
  // scalar here (a real bug the native app had) silently fails the `tags.tier?.[0] === 'novelty'`
  // check, so novelty/statement items score as if they were standard.
  tags?: { tier?: string[] | null; novelty_score?: string[] | null } | null;
};

// POST /api/preview/outfit-count
// Body: { garment: HypoGarment }
// Returns: { outfitCount, avgScore, aestheticFit, pieceScore, outfits, items }
export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "preview:count", 300, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { garment?: HypoGarment };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.garment) return NextResponse.json({ error: "garment required" }, { status: 400 });

  const { data: garments, error } = await adminClient
    .from("garments")
    .select(
      "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
      "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image"
    )
    .eq("user_id", session.userId);

  if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  const hypo = body.garment;
  const hypothetical: GarmentForScoring = {
    id:             PREVIEW_ID,
    title:          hypo.title ?? null,
    brand:          hypo.brand ?? null,
    category:       hypo.category ?? null,
    sub_type:       hypo.sub_type ?? null,
    material:       hypo.material ?? null,
    color_primary:  hypo.color_primary ?? null,
    color_secondary: null,
    pattern:        hypo.pattern ?? null,
    formality:      hypo.formality ?? null,
    aesthetic_tags: hypo.aesthetic_tags ?? null,
    pros:           hypo.pros ?? null,
    cons:           hypo.cons ?? null,
    color_pairings: hypo.color_pairings ?? null,
    color_clashes:  hypo.color_clashes ?? null,
    tags:           hypo.tags ?? null,
    image:          hypo.image ?? null,
  };
  // The item's own standalone quality score — independent of the rest of the wardrobe, so it's
  // computed before (and returned even in) the empty-wardrobe early return below.
  const pieceScore = scorePiece(hypothetical);

  if (!garments?.length) {
    return NextResponse.json({ outfitCount: 0, avgScore: 0, aestheticFit: 0, pieceScore, outfits: [], items: {} });
  }

  // Aesthetic fit: % of wardrobe items sharing at least one aesthetic_tag with the hypothetical item
  const hypoTags: string[] = body.garment.aesthetic_tags ?? [];
  const garmentRows = garments as unknown as Array<{ aesthetic_tags?: string[] | null }>;
  const aestheticFit = garments.length
    ? Math.round(
        garmentRows.filter(g =>
          (g.aesthetic_tags ?? []).some((t: string) => hypoTags.includes(t))
        ).length / garments.length * 100
      )
    : 0;

  // To count all feasible outfits with the preview item, remove existing wardrobe items
  // that occupy the same slot. If we run the full wardrobe, the dynamic floor (which rises
  // as high-scoring existing outfits fill the buffer) prunes the preview item's outfits
  // before they ever land in the ranked list — producing a badly undercounted result.
  // With competing same-slot items removed, every outfit the generator builds must include
  // the preview item, so the count is exact.
  const hypoSlot = resolveSlot(hypothetical);
  const wardrobeForPreview: GarmentForScoring[] = [
    ...(garments as unknown as GarmentForScoring[]).filter(g => resolveSlot(g) !== hypoSlot),
    hypothetical,
  ];
  // accessories:false — count distinct CLOTHING combinations. Counting every accessory variation
  // as its own outfit inflated this ~5x (every preview hit the 10,000 cap) and was most of the
  // route's runtime.
  const ranked = generateAndRankAllOutfits(wardrobeForPreview, { maxTotal: 50000, noFloor: true, accessories: false });
  const hypoOutfits = ranked; // all outfits must include the preview item
  const outfitCount = hypoOutfits.length;
  const avgScore = outfitCount
    ? Math.round(hypoOutfits.reduce((s, o) => s + o.score, 0) / outfitCount)
    : 0;

  // Good/mid/bad distribution across all outfits (before display cap)
  const goodCount = hypoOutfits.filter(o => o.score >= 75).length;
  const midCount  = hypoOutfits.filter(o => o.score >= 50 && o.score < 75).length;
  const badCount  = hypoOutfits.filter(o => o.score < 50).length;

  // Build item map for items appearing in the top 50 hypo outfits
  const visibleOutfits = hypoOutfits.slice(0, 50);
  const usedIds = new Set<string>();
  for (const o of visibleOutfits) {
    for (const i of o.items) {
      if (i.id !== PREVIEW_ID) usedIds.add(i.id);
    }
  }

  type ItemRow = { id: string; title: string | null; image: string | null; sub_type: string | null; category: string | null; aesthetic_tags: string[] | null };
  const itemMap: Record<string, ItemRow> = {};
  for (const g of garments as unknown as ItemRow[]) {
    if (usedIds.has(g.id)) {
      itemMap[g.id] = { id: g.id, title: g.title, image: g.image, sub_type: g.sub_type, category: g.category, aesthetic_tags: g.aesthetic_tags };
    }
  }

  const outfits = visibleOutfits.map(o => ({
    score: o.score,
    itemIds: o.items.filter(i => i.id !== PREVIEW_ID).map(i => i.id),
  }));

  return NextResponse.json({ outfitCount, avgScore, aestheticFit, pieceScore, goodCount, midCount, badCount, outfits, items: itemMap });
}
