import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { AESTHETIC_LABELS } from "../outfits/route";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type DiscoverItem = {
  id: string;
  brand: string;
  title: string;
  image_url: string;
  clean_image_url: string | null;
  category: string;
  sub_type: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  aesthetic_tags: string[] | null;
  brand_tier: string | null;
  price_text: string | null;
  product_url: string | null;
};

type ItemSection = {
  title: string;
  subtitle?: string;
  items: DiscoverItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type RawGarment = {
  id: string;
  brand: string | null;
  title: string | null;
  image: string | null;
  category: string | null;
  sub_type: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  aesthetic_tags: string[] | null;
  formality: string | null;
};

function toItem(g: RawGarment): DiscoverItem {
  return {
    id:              g.id,
    brand:           g.brand ?? "",
    title:           g.title ?? "",
    image_url:       g.image ?? "",
    clean_image_url: null,
    category:        g.category ?? "",
    sub_type:        g.sub_type,
    color_primary:   g.color_primary,
    color_secondary: g.color_secondary,
    aesthetic_tags:  g.aesthetic_tags,
    brand_tier:      null,
    price_text:      null,
    product_url:     null,
  };
}

const AESTHETIC_POOL = [
  "streetwear","gorpcore","old-money","preppy","quiet-luxury","minimalist",
  "techwear","workwear","athleisure","vintage","grunge","skate","y2k","90s",
  "normcore","hype-streetwear","western","punk","indie-sleaze","athletic-prep",
  "goth","maximalist","high-fashion",
];

const CATEGORY_LABELS: Record<string, string> = {
  top:       "Tops",
  bottom:    "Bottoms",
  outerwear: "Outerwear",
  footwear:  "Footwear",
  accessory: "Accessories",
};

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp         = req.nextUrl.searchParams;
  const q          = (sp.get("q") || "").trim();
  const aesthetic  = sp.get("aesthetic") || "";
  const brand      = sp.get("brand")     || "";
  const color      = sp.get("color")     || "";
  const category   = sp.get("category") || "";
  const sort       = sp.get("sort")      || "default";

  // Fetch all garments from all users (platform-wide; just one user for now)
  const { data, error } = await sb
    .from("garments")
    .select("id, brand, title, image, category, sub_type, color_primary, color_secondary, aesthetic_tags, formality");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let items = ((data ?? []) as RawGarment[]).map(toItem);

  // ── Filtering ──────────────────────────────────────────────────────────────

  if (category) items = items.filter(i => i.category === category);
  if (aesthetic) {
    const tags = aesthetic.split(",").map(s => s.trim());
    items = items.filter(i => i.aesthetic_tags?.some(t => tags.includes(t)));
  }
  if (brand) {
    const bl = brand.toLowerCase();
    items = items.filter(i => i.brand.toLowerCase().includes(bl));
  }
  if (color) {
    const cl = color.toLowerCase();
    items = items.filter(i =>
      i.color_primary?.toLowerCase().includes(cl) ||
      i.color_secondary?.toLowerCase().includes(cl)
    );
  }
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(ql) ||
      i.brand.toLowerCase().includes(ql) ||
      (i.sub_type ?? "").toLowerCase().includes(ql)
    );
  }

  // ── Sorting ────────────────────────────────────────────────────────────────

  if (sort === "name_asc")  items = [...items].sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "name_desc") items = [...items].sort((a, b) => b.title.localeCompare(a.title));
  if (sort === "brand")     items = [...items].sort((a, b) => a.brand.localeCompare(b.brand));

  // ── Filtered / search mode ─────────────────────────────────────────────────

  const hasFilters = !!(q || aesthetic || brand || color || category);

  if (hasFilters) {
    const label = aesthetic
      ? (AESTHETIC_LABELS[aesthetic] ?? aesthetic)
      : q ? `Results for "${q}"` : "Filtered";

    return NextResponse.json({ mode: "filtered", label, items, total: items.length });
  }

  // ── Section mode ───────────────────────────────────────────────────────────

  const sections: ItemSection[] = [];

  // Aesthetic sections — only show if ≥2 items have that tag
  for (const aes of AESTHETIC_POOL) {
    const subset = items.filter(i => i.aesthetic_tags?.includes(aes));
    if (subset.length >= 2) {
      sections.push({
        title: AESTHETIC_LABELS[aes] ?? aes,
        items: subset,
      });
    }
  }

  // Category sections — only show if ≥2 items in that category
  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    const subset = items.filter(i => i.category === cat);
    if (subset.length >= 2) {
      sections.push({ title: label, items: subset });
    }
  }

  // "ALL" section — every item, shown last
  if (items.length > 0) {
    sections.push({ title: "All", items });
  }

  return NextResponse.json({ mode: "sections", sections });
}
