import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits } from "@/lib/wardrobeOutfitGen";
import type { GarmentForScoring } from "@/lib/scoring";

export const maxDuration = 60;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type DiscoverProduct = {
  id: string;
  brand: string;
  title: string;
  image_url: string;
  clean_image_url: string | null;
  category: string;
  sub_type: string | null;
  color_primary: string | null;
  aesthetic_tags: string[] | null;
  brand_tier: string | null;
  price_text: string | null;
  product_url: string | null;
};

export type OutfitCombo = {
  id: string;
  score?: number;
  items: DiscoverProduct[];
};

export type OutfitSection = {
  aesthetic: string;
  label: string;
  outfits: OutfitCombo[];
};

export const AESTHETIC_LABELS: Record<string, string> = {
  "streetwear":       "Streetwear",
  "gorpcore":         "Gorpcore",
  "old-money":        "Old Money",
  "preppy":           "Preppy",
  "quiet-luxury":     "Quiet Luxury",
  "minimalist":       "Minimalist",
  "techwear":         "Techwear",
  "workwear":         "Workwear",
  "athleisure":       "Athleisure",
  "vintage":          "Vintage",
  "grunge":           "Grunge",
  "skate":            "Skate",
  "y2k":              "Y2K",
  "90s":              "90s",
  "normcore":         "Normcore",
  "hype-streetwear":  "Hype / Streetwear",
  "skate-streetwear": "Skate / Street",
  "indie-sleaze":     "Indie Sleaze",
  "western":          "Western",
  "punk":             "Punk",
  "high-fashion":     "High Fashion",
  "athletic-prep":    "Athletic Prep",
  "goth":             "Goth",
  "maximalist":       "Maximalist",
};

const AESTHETIC_POOL = [
  "streetwear","gorpcore","old-money","preppy","quiet-luxury","minimalist",
  "techwear","workwear","athleisure","vintage","grunge","skate","y2k","90s",
  "normcore","hype-streetwear","western","punk","indie-sleaze","athletic-prep",
  "goth","maximalist","high-fashion",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

type RawGarment = GarmentForScoring & { category?: string | null };

function toProduct(g: RawGarment): DiscoverProduct {
  return {
    id:            g.id,
    brand:         g.brand ?? "",
    title:         g.title ?? "",
    image_url:     g.image ?? "",
    clean_image_url: null,
    category:      g.category ?? "",
    sub_type:      g.sub_type,
    color_primary: g.color_primary,
    aesthetic_tags: g.aesthetic_tags,
    brand_tier:    null,
    price_text:    null,
    product_url:   null,
  };
}

// Returns the aesthetic tags that appear most across an outfit's items
function dominantAesthetics(outfit: OutfitCombo): string[] {
  const counts: Record<string, number> = {};
  for (const item of outfit.items) {
    for (const t of item.aesthetic_tags ?? []) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  if (!Object.keys(counts).length) return [];
  const max = Math.max(...Object.values(counts));
  return Object.keys(counts).filter(t => counts[t] >= Math.max(1, max - 1));
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp          = req.nextUrl.searchParams;
  const q           = (sp.get("q") || "").trim();
  const aestheticRaw = sp.get("aesthetic") || "";
  const colorParam   = sp.get("color")     || "";
  const brandParam   = sp.get("brand")     || "";

  // Fetch all garments from all users (platform-wide; just one user for now)
  const { data, error } = await sb
    .from("garments")
    .select(
      "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
      "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image"
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ mode: "sections", sections: [], date: new Date().toISOString().slice(0, 10) });
  }

  const garments = data as unknown as RawGarment[];

  // Generate all ranked outfits from the garment pool
  const ranked = generateAndRankAllOutfits(garments as GarmentForScoring[], { maxTotal: 400 });

  // Build garment lookup map
  const gMap = new Map<string, DiscoverProduct>();
  for (const g of garments) gMap.set(g.id, toProduct(g));

  // Convert ranked outfits to DiscoverProduct format
  let allOutfits: OutfitCombo[] = ranked.map((r, i) => ({
    id:    `outfit-${i}`,
    score: r.score,
    items: r.items.map(item => gMap.get(item.id) ?? toProduct(item as RawGarment)),
  }));

  // ── Filtered mode ─────────────────────────────────────────────────────────

  const hasFilters = !!(q || aestheticRaw || colorParam || brandParam);

  if (hasFilters) {
    if (aestheticRaw) {
      const tags = aestheticRaw.split(",").map(s => s.trim());
      allOutfits = allOutfits.filter(o =>
        o.items.some(item => item.aesthetic_tags?.some(t => tags.includes(t)))
      );
    }
    if (colorParam) {
      const c = colorParam.toLowerCase();
      allOutfits = allOutfits.filter(o =>
        o.items.some(item => item.color_primary?.toLowerCase().includes(c))
      );
    }
    if (brandParam) {
      const b = brandParam.toLowerCase();
      allOutfits = allOutfits.filter(o =>
        o.items.some(item => item.brand?.toLowerCase().includes(b))
      );
    }
    if (q) {
      const ql = q.toLowerCase();
      allOutfits = allOutfits.filter(o =>
        o.items.some(item =>
          item.title?.toLowerCase().includes(ql) ||
          item.brand?.toLowerCase().includes(ql) ||
          item.sub_type?.toLowerCase().includes(ql)
        )
      );
    }

    const label = aestheticRaw
      ? (AESTHETIC_LABELS[aestheticRaw] ?? aestheticRaw)
      : q ? `Results for "${q}"` : "Filtered";

    return NextResponse.json({ mode: "filtered", label, outfits: allOutfits.slice(0, 120) });
  }

  // ── Section mode ──────────────────────────────────────────────────────────

  const sections: OutfitSection[] = [];

  for (const aesthetic of AESTHETIC_POOL) {
    const matching = allOutfits
      .filter(o => dominantAesthetics(o).includes(aesthetic))
      .slice(0, 20);

    if (matching.length >= 2) {
      sections.push({
        aesthetic,
        label: AESTHETIC_LABELS[aesthetic] ?? aesthetic,
        outfits: matching,
      });
    }
  }

  // "ALL" section — every outfit, shown last
  if (allOutfits.length > 0) {
    sections.push({
      aesthetic: "all",
      label:     "All",
      outfits:   allOutfits,
    });
  }

  return NextResponse.json({
    mode: "sections",
    sections,
    date: new Date().toISOString().slice(0, 10),
  });
}
