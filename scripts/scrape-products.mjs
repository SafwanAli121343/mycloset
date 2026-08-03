/**
 * Product scraper — run by Claude Code whenever new sites are added.
 *
 * Usage:
 *   node scripts/scrape-products.mjs              # scrapes all sources
 *   node scripts/scrape-products.mjs stussy huf   # specific brands only
 *   node scripts/scrape-products.mjs --skip-retailers   # skip multi-brand retailer scrapes
 *
 * Source types (defined in scripts/sources.json):
 *   "shopify"  — uses /collections/{col}/products.json API (fast, complete)
 *   "firecrawl"— uses Firecrawl extract API for non-Shopify sites
 *   "retailer" — multi-brand store; extracts brand per product; merges into source_links on existing items
 *
 * Retailer dedup flow:
 *   1. After AI analysis, group new items by brand
 *   2. Pull all existing DB rows for those brands
 *   3. Match by brand + normalized title (first 5 words)
 *   4. Match found  → append retailer URL to source_links
 *   5. No match     → insert as new product (brand sourced from extracted data)
 */

import { readFileSync }  from "fs";
import { createClient }  from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ───────────────────────────────────────────────────────────
try {
  for (const line of readFileSync(join(__dir, "../.env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("="); if (idx === -1) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* env already set */ }

const supabase  = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OPENAI    = process.env.OPENAI_API_KEY;
const FIRECRAWL = process.env.FIRECRAWL_API_KEY;

// ── Load sources ──────────────────────────────────────────────────────────────
const sources = JSON.parse(readFileSync(join(__dir, "sources.json"), "utf-8"));
const argv    = process.argv.slice(2);
const skipRetailers  = argv.includes("--skip-retailers");
const brandFilter    = argv.filter(a => !a.startsWith("--")).map(s => s.toLowerCase());
const active = sources.filter(s => {
  if (skipRetailers && s.is_retailer) return false;
  if (!brandFilter.length) return true;
  return brandFilter.some(t => s.brand.toLowerCase().includes(t));
});

if (!active.length) {
  console.error("No matching sources. Available:", sources.map(s => s.brand).join(", "));
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

function inferCategory(productType = "", tags = [], title = "") {
  const t = [productType, ...tags, title].join(" ").toLowerCase();
  if (/jacket|coat|puffer|bomber|windbreak|parka|outerwear|fleece|sherpa|vest|anorak/.test(t)) return "outerwear";
  if (/pant|jean|denim|cargo|trouser|short|sweatpant|jogger/.test(t)) return "bottom";
  if (/shoe|sneaker|boot|slide|loafer|sandal|footwear|trainer|runner/.test(t)) return "footwear";
  if (/bag|backpack|tote|hat|cap|beanie|chain|ring|sock|belt|wallet|accessory|jewelry|skate|glasses|sunglasses|frame/.test(t)) return "accessory";
  return "top";
}

function normalizeTitle(brand, title) {
  return title.toLowerCase()
    .replace(new RegExp(brand.toLowerCase().replace(/[^a-z0-9]/g, ".*?"), "gi"), "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 5)
    .join(" ");
}

// ── AI analysis ───────────────────────────────────────────────────────────────
async function analyzeItems(items) {
  if (!OPENAI || !items.length) return items;
  const lines = items.map((it, i) =>
    `${i + 1}. "${it.title}" by ${it.brand} (category hint: ${it.category})`
  ).join("\n");
  const prompt =
    `You are a fashion categorization AI for a streetwear/luxury fashion database.\n` +
    `For each item, return a JSON array with one object per item:\n` +
    `  { "sub_type": "hoodie"|"t-shirt"|"cargo pants"|"bomber jacket"|"cap"|"sneaker"|"loafer"|"bag"|etc,\n` +
    `    "color_primary": "black"|"white"|"navy"|"beige"|"grey"|"red"|"green"|"blue"|"brown"|"multicolor"|etc,\n` +
    `    "aesthetic_tags": ["streetwear"|"workwear"|"vintage"|"athletic"|"skate"|"gorpcore"|"prep"|"luxury"|"avantgarde"] }\n\n` +
    `Items:\n${lines}\n\nReturn ONLY a JSON array of ${items.length} objects. No extra text.`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: 800 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const data = await res.json();
    const content = JSON.parse(data.choices[0].message.content ?? "[]");
    const arr = Array.isArray(content) ? content : (content.items ?? Object.values(content)[0] ?? []);
    return items.map((it, i) => ({
      ...it,
      sub_type:       arr[i]?.sub_type       ?? null,
      color_primary:  arr[i]?.color_primary  ?? null,
      aesthetic_tags: arr[i]?.aesthetic_tags ?? null,
      analyzed: true,
    }));
  } catch (e) {
    console.error(`  AI analysis failed: ${e.message}`);
    return items;
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────
// Strip source_links from rows — it's updated separately by upsertRetailerBatch
// (and won't exist until add_source_links.sql migration has been run)
function stripExtraFields(row) {
  // eslint-disable-next-line no-unused-vars
  const { source_links: _sl, ...rest } = row;
  return rest;
}

async function upsertBatch(rows) {
  if (!rows.length) return 0;
  const clean = rows.map(stripExtraFields);
  const { error } = await supabase
    .from("streetwear_products")
    .upsert(clean, { onConflict: "product_url", ignoreDuplicates: true });
  if (error) { process.stdout.write(`[DB ERR: ${error.message.slice(0,50)}] `); return 0; }
  return rows.length;
}

// ── Retailer dedup upsert ─────────────────────────────────────────────────────
// For retailer items: match existing by brand+title → add to source_links instead of inserting duplicate
async function upsertRetailerBatch(items, retailerDomain) {
  if (!items.length) return { inserted: 0, linked: 0 };

  const uniqueBrands = [...new Set(items.map(it => it.brand).filter(Boolean))];

  // Try to select with source_links; gracefully degrade if column not yet migrated
  let existing = null;
  let sourceLinksReady = true;
  const { data: ex1, error: err1 } = await supabase
    .from("streetwear_products")
    .select("id, brand, title, source_links, product_url")
    .in("brand", uniqueBrands);

  if (err1) {
    if (err1.message.includes("source_links") || err1.message.includes("does not exist")) {
      sourceLinksReady = false;
      // Fetch without source_links
      const { data: ex2, error: err2 } = await supabase
        .from("streetwear_products")
        .select("id, brand, title, product_url")
        .in("brand", uniqueBrands);
      if (err2) { console.error("  dedup fetch error:", err2.message); return { inserted: 0, linked: 0 }; }
      existing = ex2;
    } else {
      console.error("  dedup fetch error:", err1.message); return { inserted: 0, linked: 0 };
    }
  } else {
    existing = ex1;
  }

  const existMap = new Map();
  for (const ex of existing ?? []) {
    const key = `${ex.brand}|${normalizeTitle(ex.brand, ex.title)}`;
    if (!existMap.has(key)) existMap.set(key, ex);
  }

  const toInsert = [];
  const toUpdate = [];

  for (const item of items) {
    if (!item.brand || !item.title) { toInsert.push(item); continue; }
    const key = `${item.brand}|${normalizeTitle(item.brand, item.title)}`;
    const ex  = existMap.get(key);
    if (ex && ex.product_url !== item.product_url) {
      if (sourceLinksReady) {
        const links = Array.isArray(ex.source_links) ? ex.source_links : [];
        if (!links.some(l => l.url === item.product_url)) {
          links.push({ url: item.product_url, price_text: item.price_text ?? null, retailer: retailerDomain });
          toUpdate.push({ id: ex.id, source_links: links });
        }
      }
      // If sourceLinksReady is false, we skip linking (item already exists, don't duplicate)
    } else {
      toInsert.push(item);
    }
  }

  // Batch insert (strip source_links — may not exist as column yet)
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100).map(stripExtraFields);
    const { error: ie } = await supabase
      .from("streetwear_products")
      .upsert(chunk, { onConflict: "product_url", ignoreDuplicates: true });
    if (!ie) inserted += chunk.length;
  }

  // Update source_links for matched items (skip gracefully if column doesn't exist yet)
  let linked = 0;
  for (const upd of toUpdate) {
    const { error: ue } = await supabase
      .from("streetwear_products")
      .update({ source_links: upd.source_links })
      .eq("id", upd.id);
    if (!ue) linked++;
    await delay(30);
  }

  return { inserted, linked };
}

// ── Shopify scraper ───────────────────────────────────────────────────────────
async function scrapeShopify(source) {
  const { brand, domain, collections, gender, tier, is_retailer } = source;
  let grandTotal = 0;

  for (const collection of collections) {
    let page = 1;
    process.stdout.write(`  ${brand} / ${collection}: `);
    let colTotal = 0;

    while (true) {
      const url = collection
        ? `https://${domain}/collections/${collection}/products.json?limit=250&page=${page}`
        : `https://${domain}/products.json?limit=250&page=${page}`;
      let data;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; MyCloset/1.0)" },
          signal: AbortSignal.timeout(20000),
          redirect: "follow",
        });
        if (!res.ok) { process.stdout.write(`HTTP${res.status} `); break; }
        data = await res.json();
      } catch (e) { process.stdout.write(`err(${e.message.slice(0,25)}) `); break; }

      const products = data.products ?? [];
      if (!products.length) break;

      const raw = products.map(p => {
        const itemBrand = is_retailer ? (p.vendor || brand) : brand;
        return {
          brand:         itemBrand,
          title:         p.title,
          price:         parseFloat(p.variants?.[0]?.price ?? "0") || null,
          price_text:    p.variants?.[0]?.price ? `$${Math.round(parseFloat(p.variants[0].price))}` : null,
          image_url:     p.images?.[0]?.src?.split("?")[0] ?? null,
          product_url:   `https://${domain}/products/${p.handle}`,
          category:      inferCategory(p.product_type, p.tags, p.title),
          sub_type:      null,
          color_primary: null,
          aesthetic_tags:null,
          gender:        gender ?? "male",
          brand_tier:    tier   ?? "mid",
          source_domain: domain,
          in_stock:      true,
          analyzed:      false,
          source_links:  [],
        };
      });

      const BATCH = 20;
      for (let i = 0; i < raw.length; i += BATCH) {
        const chunk    = raw.slice(i, i + BATCH);
        const enriched = await analyzeItems(chunk);
        let n = 0;
        if (is_retailer) {
          const { inserted, linked } = await upsertRetailerBatch(enriched, domain);
          n = inserted + linked;
          process.stdout.write(`${inserted}+${linked}>`);
        } else {
          n = await upsertBatch(enriched);
          process.stdout.write(`${n}`);
        }
        colTotal += n;
        if (i + BATCH < raw.length) process.stdout.write("+");
        await delay(200);
      }

      if (products.length < 250) break;
      page++;
      await delay(600);
    }
    process.stdout.write(` (${colTotal})\n`);
    grandTotal += colTotal;
  }
  return grandTotal;
}

// ── Firecrawl scraper ─────────────────────────────────────────────────────────
async function scrapeFirecrawl(source) {
  const { brand, url, gender, tier, is_retailer } = source;
  const isRetailer = !!is_retailer;
  process.stdout.write(`  ${brand}: `);

  if (!FIRECRAWL) { console.log("no FIRECRAWL_API_KEY"); return 0; }

  // For retailers, extract brand name per product
  const productSchema = {
    type: "object",
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ...(isRetailer ? { brand: { type: "string" } } : {}),
            title:      { type: "string" },
            price:      { type: "number" },
            imageUrl:   { type: "string" },
            productUrl: { type: "string" },
          },
          required: ["title", "productUrl"],
        },
      },
    },
  };

  const promptText = isRetailer
    ? "Extract ALL product listings visible on this page. For each product: brand (the clothing/shoe brand name, NOT the retailer name), title, price (number), imageUrl (full URL), productUrl (full URL)."
    : `Extract ALL product listings for ${brand}. For each: title, price (number, no $), imageUrl (full absolute URL), productUrl (full absolute URL).`;

  // Polite inter-call delay to avoid rate limits (max ~8 req/min)
  await delay(8000);

  try {
    // Use v1/scrape with extract format (synchronous, handles JS rendering)
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        process.stdout.write(" [rate-limited, waiting 70s] ");
        await delay(70000);
      }
      res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { "Authorization": `Bearer ${FIRECRAWL}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          formats: ["extract"],
          extract: { prompt: promptText, schema: productSchema },
          waitFor: 2000,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status !== 429) break;
    }
    if (!res || !res.ok) {
      const errText = await res?.text().catch(() => "") ?? "";
      console.log(`Firecrawl HTTP ${res?.status}: ${errText.slice(0, 80)}`);
      return 0;
    }
    const data  = await res.json();
    const items = ((data.data?.extract?.products) ?? data.data?.products ?? []).filter(p => p.productUrl);
    process.stdout.write(`${items.length} found → `);
    if (!items.length) { console.log("0 inserted"); return 0; }

    const origin = new URL(url).origin;
    const raw = items.map(p => {
      let pUrl = p.productUrl;
      if (pUrl.startsWith("/")) pUrl = origin + pUrl;
      const itemBrand = isRetailer ? (p.brand || brand) : brand;
      return {
        brand:         itemBrand,
        title:         p.title,
        price:         p.price ?? null,
        price_text:    p.price ? `$${Math.round(p.price)}` : null,
        image_url:     p.imageUrl ?? null,
        product_url:   pUrl,
        category:      inferCategory("", [], p.title),
        sub_type:      null,
        color_primary: null,
        aesthetic_tags:null,
        gender:        gender ?? "male",
        brand_tier:    tier   ?? "mid",
        source_domain: new URL(pUrl.startsWith("http") ? pUrl : origin + pUrl).hostname,
        in_stock:      true,
        analyzed:      false,
        source_links:  [],
      };
    });

    let total = 0, linked = 0;
    const BATCH = 20;
    for (let i = 0; i < raw.length; i += BATCH) {
      const chunk    = raw.slice(i, i + BATCH);
      const enriched = await analyzeItems(chunk);
      if (isRetailer) {
        const r = await upsertRetailerBatch(enriched, new URL(url).hostname);
        total  += r.inserted;
        linked += r.linked;
      } else {
        total += await upsertBatch(enriched);
      }
      process.stdout.write(".");
      await delay(300);
    }
    const summary = isRetailer ? `${total} inserted, ${linked} linked` : `${total} inserted`;
    console.log(` ${summary}`);
    return total + linked;
  } catch (e) {
    console.log(`error: ${e.message.slice(0, 70)}`);
    return 0;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n▸ Scraping ${active.length} source(s) with AI analysis...\n`);
let grandTotal = 0;

for (const source of active) {
  const tag = source.is_retailer ? "retailer" : source.type;
  console.log(`\n[${source.brand}] (${tag}, ${source.tier} tier, ${source.gender})`);
  try {
    const n = source.type === "shopify"
      ? await scrapeShopify(source)
      : await scrapeFirecrawl(source);
    grandTotal += n;
    console.log(`  → ${n} total for ${source.brand}`);
  } catch (e) {
    console.error(`  ✗ ${source.brand} failed: ${e.message}`);
  }
}

const { data: stats } = await supabase.from("streetwear_products").select("brand");
const byBrand = {};
for (const row of stats ?? []) byBrand[row.brand] = (byBrand[row.brand] ?? 0) + 1;

console.log(`\n${"─".repeat(45)}`);
console.log(`This run: +${grandTotal} products`);
console.log(`Database totals:`);
for (const [b, n] of Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${b}: ${n}`);
}
if (Object.keys(byBrand).length > 30) console.log(`  ... and ${Object.keys(byBrand).length - 30} more brands`);
