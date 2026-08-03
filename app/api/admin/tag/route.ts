import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function auth(req: NextRequest) {
  return req.headers.get("x-admin-pin") === process.env.ADMIN_PIN;
}

// GET /api/admin/tag?brand=Nike&offset=0
export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const brand  = searchParams.get("brand") || "";
  const offset = parseInt(searchParams.get("offset") || "0");

  let q = sb.from("streetwear_products")
    .select("id,brand,title,price_text,image_url,color_primary,sub_type,aesthetic_tags,tags,category")
    .eq("analyzed", true)
    .is("formality", null)
    .not("image_url", "is", null)
    .in("category", ["top", "bottom", "outerwear", "footwear"]);

  if (brand) q = q.eq("brand", brand);

  // Count remaining
  let cq = sb.from("streetwear_products")
    .select("id", { count: "exact", head: true })
    .eq("analyzed", true)
    .is("formality", null)
    .not("image_url", "is", null)
    .in("category", ["top", "bottom", "outerwear", "footwear"]);
  if (brand) cq = cq.eq("brand", brand);
  const { count } = await cq;

  // Fetch brands list for filter
  const { data: brandRows } = await sb.from("streetwear_products")
    .select("brand")
    .eq("analyzed", true)
    .is("formality", null)
    .not("image_url", "is", null)
    .in("category", ["top", "bottom", "outerwear", "footwear"])
    .limit(5000);
  const brandCounts: Record<string, number> = {};
  for (const r of brandRows || []) brandCounts[r.brand] = (brandCounts[r.brand] || 0) + 1;
  const brands = Object.entries(brandCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([b, n]) => ({ brand: b, count: n }));

  const { data, error } = await q.range(offset, offset + 29);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data || [], total: count || 0, brands });
}

// PATCH /api/admin/tag  — save tags for one item
export async function PATCH(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, features, colors, pattern_detail, ...fields } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Merge tags JSONB
  const { data: existing } = await sb.from("streetwear_products")
    .select("tags").eq("id", id).single();
  const existingTags = (existing?.tags as Record<string, unknown>) || {};

  const update = {
    ...fields,
    tags: { ...existingTags, features, colors, pattern_detail: pattern_detail || null },
  };

  const { error } = await sb.from("streetwear_products").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
