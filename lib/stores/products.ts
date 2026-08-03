/**
 * ProductStore — the only interface the app uses to talk to the product database.
 *
 * Current backend: Supabase (SupabaseProductStore below).
 * To switch to a custom backend:
 *   1. Implement ProductStore against your API/DB
 *   2. Set PRODUCTS_BACKEND=custom in .env.local
 *   3. Point CUSTOM_PRODUCTS_API_URL to your server
 *   Nothing else changes.
 */

export type SourceLink = { url: string; price_text: string | null; retailer: string };

export type ProductRecord = {
  brand:        string;
  title:        string;
  price:        number | null;
  price_text:   string | null;
  image_url:    string | null;
  product_url:  string;
  category:     string | null;   // top | bottom | footwear | outerwear | accessory
  gender:       string;           // male | female | unisex
  brand_tier:   string | null;   // budget | mid | premium | luxury
  source_domain: string | null;
  in_stock:     boolean;
  source_links?: SourceLink[];
};

export type ProductFilters = {
  gender?:   string;
  category?: string;
  tier?:     string;
  limit?:    number;
  offset?:   number;
};

export interface ProductStore {
  upsert(products: ProductRecord[]): Promise<number>; // returns inserted count
  search(query: string, filters?: ProductFilters): Promise<ProductRecord[]>;
  stats(): Promise<{ total: number; byBrand: Record<string, number> }>;
}

// ── Supabase implementation ───────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

class SupabaseProductStore implements ProductStore {
  private db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  async upsert(products: ProductRecord[]): Promise<number> {
    if (!products.length) return 0;
    const { error, count } = await this.db
      .from("streetwear_products")
      .upsert(products, { onConflict: "product_url", ignoreDuplicates: true })
      .select("id");
    if (error) { console.error("upsert error:", error.message); return 0; }
    return products.length;
  }

  async search(query: string, filters: ProductFilters = {}): Promise<ProductRecord[]> {
    const { gender, category, tier, limit = 20, offset = 0 } = filters;
    let qb = this.db
      .from("streetwear_products")
      .select("brand,title,price,price_text,image_url,product_url,category,gender,brand_tier,source_domain,in_stock,source_links")
      .textSearch("title", query, { type: "plain", config: "english" })
      .eq("in_stock", true)
      .range(offset, offset + limit - 1);

    if (gender && gender !== "unisex") qb = qb.or(`gender.eq.${gender},gender.eq.unisex`);
    if (category) qb = qb.eq("category", category);
    if (tier)     qb = qb.eq("brand_tier", tier);

    const { data, error } = await qb;
    if (error) { console.error("search error:", error.message); return []; }
    return (data ?? []) as ProductRecord[];
  }

  async stats(): Promise<{ total: number; byBrand: Record<string, number> }> {
    const { data, error } = await this.db
      .from("streetwear_products")
      .select("brand");
    if (error || !data) return { total: 0, byBrand: {} };
    const byBrand: Record<string, number> = {};
    for (const row of data) byBrand[row.brand] = (byBrand[row.brand] ?? 0) + 1;
    return { total: data.length, byBrand };
  }
}

// ── Custom backend (REST) implementation ──────────────────────────────────────
// Swap in by setting: PRODUCTS_BACKEND=custom + CUSTOM_PRODUCTS_API_URL=https://...

class CustomBackendProductStore implements ProductStore {
  constructor(private baseUrl: string) {}

  async upsert(products: ProductRecord[]): Promise<number> {
    const res = await fetch(`${this.baseUrl}/products/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products }),
    });
    if (!res.ok) return 0;
    const d = await res.json() as { inserted?: number };
    return d.inserted ?? 0;
  }

  async search(query: string, filters: ProductFilters = {}): Promise<ProductRecord[]> {
    const params = new URLSearchParams({ q: query, ...Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    )});
    const res = await fetch(`${this.baseUrl}/products/search?${params}`);
    if (!res.ok) return [];
    const d = await res.json() as { results?: ProductRecord[] };
    return d.results ?? [];
  }

  async stats(): Promise<{ total: number; byBrand: Record<string, number> }> {
    const res = await fetch(`${this.baseUrl}/products/stats`);
    if (!res.ok) return { total: 0, byBrand: {} };
    return res.json();
  }
}

// ── Factory — the only thing API routes call ──────────────────────────────────

let _store: ProductStore | null = null;

export function getProductStore(): ProductStore {
  if (_store) return _store;
  const backend = process.env.PRODUCTS_BACKEND ?? "supabase";
  if (backend === "custom") {
    const url = process.env.CUSTOM_PRODUCTS_API_URL;
    if (!url) throw new Error("CUSTOM_PRODUCTS_API_URL not set");
    _store = new CustomBackendProductStore(url);
  } else {
    _store = new SupabaseProductStore();
  }
  return _store;
}
