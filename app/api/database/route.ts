import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams;
  const brand    = sp.get("brand")    ?? null;
  const category = sp.get("category") ?? null;
  const page     = Math.max(0, parseInt(sp.get("page") ?? "0"));
  const limit    = 60;

  let qb = db
    .from("streetwear_products")
    .select("id,brand,title,price_text,image_url,product_url,category,sub_type,color_primary,aesthetic_tags,gender,brand_tier,analyzed,source_links")
    .order("scraped_at", { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (brand)    qb = qb.eq("brand", brand);
  if (category) qb = qb.eq("category", category);

  const { data, error } = await qb;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also fetch summary stats
  const { data: stats } = await db
    .from("streetwear_products")
    .select("brand,category");

  const byBrand:    Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const row of stats ?? []) {
    byBrand[row.brand]       = (byBrand[row.brand]       ?? 0) + 1;
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  }

  return NextResponse.json({
    items: data ?? [],
    total: stats?.length ?? 0,
    byBrand,
    byCategory,
    page,
    limit,
  });
}
