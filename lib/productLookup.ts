import { assertSafeUrl } from "@/lib/security/ssrfGuard";
import { aiChat, aiWebSearch, type AiActor } from "./aiGateway";
import { cleanProductTitle, decodeEntities } from "./cleanProductTitle";


export type UrlLookupResult = {
  brand: string | null;
  material: string | null;
  pageText: string | null;
};


const NULL_RESPONSES = new Set(["null", "none", "n/a", "unknown", "unavailable", ""]);

// Domains where the URL itself tells us nothing about the clothing brand.
// For these, we skip all URL-based brand extraction and rely on the `source`
// field passed from the search results instead.
const SKIP_BRAND_DOMAINS = new Set([
  // Search engines — link is a redirect, not the merchant's page
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com",
  // Marketplaces — source is the platform, not the brand
  "ebay.com", "grailed.com", "depop.com", "poshmark.com",
  "amazon.com", "vinted.com", "stockx.com", "mercari.com",
  "thredup.com", "tradesy.com", "vestiairecollective.com",
  "farfetch.com", "theoutnet.com", "yoox.com",
  // Big-box retail — og:site_name is the store name, not the item brand
  "walmart.com", "target.com", "costco.com", "samsclub.com", "kmart.com",
  // Multi-brand streetwear / sneaker boutiques
  "culturekings.com", "footlocker.com", "jdsports.com", "champssports.com",
  "finishline.com", "dtlr.com", "hibbett.com",
  // Multi-brand fashion boutiques and aggregators
  "ssense.com", "mrporter.com", "revolve.com", "asos.com", "endclothing.com",
  "nordstrom.com", "bloomingdales.com", "macys.com",
]);

function parseField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return NULL_RESPONSES.has(value.toLowerCase().trim()) ? null : value.trim();
}

function getDomain(link: string): string {
  try { return new URL(link).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

// Covers subdomains: shopping.google.com matches "google.com" in the skip set.
function shouldSkipBrandExtraction(domain: string): boolean {
  if (!domain) return true;
  return [...SKIP_BRAND_DOMAINS].some(
    (skip) => domain === skip || domain.endsWith("." + skip)
  );
}

// Reads the page HTML and extracts the brand from structured signals the site
// owner explicitly declares. og:site_name is the most reliable — it's set for
// SEO purposes and always reflects the site's official name.
async function extractBrandFromHtml(link: string): Promise<string | null> {
  try {
    await assertSafeUrl(link);
    const res = await fetch(link, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(7000),
    });
    console.log(`[productLookup] HTML fetch status=${res.status} url=${link}`);
    if (!res.ok) return null;
    const html = await res.text();
    console.log(`[productLookup] HTML length=${html.length}`);

    // og:site_name is set by the store owner explicitly for SEO — most reliable
    const siteNameMatch =
      html.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
    if (siteNameMatch?.[1]?.trim()) {
      console.log(`[productLookup] og:site_name="${siteNameMatch[1].trim()}"`);
      return siteNameMatch[1].trim();
    }

    // JSON-LD Product schema brand field
    for (const m of html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )) {
      try {
        const raw = JSON.parse(m[1]);
        const product = Array.isArray(raw)
          ? raw.find((e: { "@type"?: string }) => e?.["@type"] === "Product")
          : raw?.["@type"] === "Product" ? raw : null;
        if (product?.brand?.name) {
          console.log(`[productLookup] JSON-LD brand="${product.brand.name}"`);
          return product.brand.name;
        }
        if (typeof product?.brand === "string" && product.brand) {
          console.log(`[productLookup] JSON-LD brand="${product.brand}"`);
          return product.brand;
        }
      } catch {}
    }

    console.log(`[productLookup] HTML extraction found no brand signal`);
    return null;
  } catch (err) {
    console.log(`[productLookup] HTML fetch failed: ${err}`);
    return null;
  }
}

// Searches the web for what brand/store operates a given domain.
// Only passes the domain — NOT the item title or image — so GPT cannot guess
// a brand from the product description.
async function lookupBrandViaWebSearch(domain: string, actor: AiActor): Promise<string | null> {
  try {
    const text = await aiWebSearch(
      "openai:responses:brand-search",
      `What clothing brand or store operates the website "${domain}"?\nRespond with ONLY this JSON: {"brand": "BRAND_NAME"}`,
      actor,
    );
    console.log(`[productLookup] web search raw="${text}"`);
    const jsonMatch = text.match(/\{[^{}]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return parseField(data.brand);
    }
    return null;
  } catch (err) {
    console.log(`[productLookup] web search failed: ${err}`);
    return null;
  }
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Full product scrape — returns OG image, title, brand, price, and page text.
// Uses Firecrawl (markdown + metadata) when available, falls back to Jina.ai
// for text and a direct HTML fetch for OG meta tags.
export type ScrapedProduct = {
  imageUrl: string | null;
  title: string | null;
  brand: string | null;
  price: string | null;
  pageText: string | null;
  allImages: string[];
};

// Shopify stores expose a public JSON API at /products/{handle}.json.
// When a variant ID is present in the URL, use it to fetch the exact variant
// image rather than the og:image which defaults to the first/default variant.
async function tryShopifyVariantImage(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    const variantId = parsed.searchParams.get("variant");
    const handleMatch = parsed.pathname.match(/\/products\/([^/?#]+)/);
    if (!variantId || !handleMatch) return null;

    const apiUrl = `${parsed.origin}/products/${handleMatch[1]}.json`;
    await assertSafeUrl(apiUrl);
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;

    const data = await res.json();
    const variant = (data?.product?.variants ?? []).find(
      (v: { id: number | string }) => String(v.id) === variantId
    );
    if (!variant) return null;

    // Variant has its own featured_image if the color differs from default
    const imgId: number | null = variant.featured_image?.id ?? variant.image_id ?? null;
    if (imgId) {
      const img = (data.product.images ?? []).find(
        (i: { id: number }) => i.id === imgId
      );
      if (img?.src) return img.src;
    }

    // Fall back to variant.image_id lookup failed — try featured_image.src directly
    if (variant.featured_image?.src) return variant.featured_image.src;
    return null;
  } catch {
    return null;
  }
}

export async function scrapeProductPage(url: string): Promise<ScrapedProduct> {
  let imageUrl: string | null = null;
  let title: string | null = null;
  let brand: string | null = null;
  let price: string | null = null;
  let pageText: string | null = null;

  // ── All sources in parallel — take the best result from each ──────────────
  // Previously sequential (worst case 46s); now parallel (worst case ~10s).
  type FirecrawlResult = { pageText: string | null; imageUrl: string | null; title: string | null; brand: string | null; price: string | null };
  type HtmlResult     = { imageUrl: string | null; title: string | null; brand: string | null; price: string | null; allImages: string[] };
  type JinaResult     = { pageText: string | null };

  const firecrawlPromise: Promise<FirecrawlResult> = (async () => {
    if (!process.env.FIRECRAWL_API_KEY) return { pageText: null, imageUrl: null, title: null, brand: null, price: null };
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
        body: JSON.stringify({ url, formats: ["markdown", "metadata"] }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return { pageText: null, imageUrl: null, title: null, brand: null, price: null };
      const data = await res.json();
      const md: string = data?.data?.markdown || "";
      const meta = data?.data?.metadata ?? {};
      return {
        pageText: md.trim() ? md.slice(0, 3500) : null,
        imageUrl: meta.ogImage || meta.image || null,
        title:    meta.ogTitle || meta.title || null,
        brand:    meta.ogSiteName || null,
        price:    meta.price || null,
      };
    } catch { return { pageText: null, imageUrl: null, title: null, brand: null, price: null }; }
  })();

  const htmlPromise: Promise<HtmlResult> = (async () => {
    try {
      await assertSafeUrl(url);
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
      if (!res.ok) return { imageUrl: null, title: null, brand: null, price: null, allImages: [] };
      const html = await res.text();
      const ogImg =
        html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
        html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1] || null;
      const ogTitle =
        html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
        html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] || null;
      const ogBrand =
        html.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
        html.match(/content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i)?.[1] || null;
      const ogPrice =
        html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
        html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
      // Also check JSON-LD
      let ldImg: string | null = null, ldBrand: string | null = null, ldPrice: string | null = null;
      for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const raw = JSON.parse(m[1]);
          const items = Array.isArray(raw) ? raw : [raw];
          for (const item of items) {
            if (item?.["@type"] !== "Product") continue;
            if (!ldImg && typeof item.image === "string") ldImg = item.image;
            if (!ldImg && Array.isArray(item.image)) ldImg = item.image[0] ?? null;
            if (!ldBrand && item.brand?.name) ldBrand = item.brand.name;
            if (!ldBrand && typeof item.brand === "string") ldBrand = item.brand;
            if (!ldPrice) {
              const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (offer?.price) ldPrice = String(offer.price);
            }
          }
        } catch { /* malformed JSON-LD */ }
      }
      // Collect all product images from JSON-LD for the multi-image picker
      const seen = new Set<string>();
      const allImages: string[] = [];
      const push = (u: string) => { if (u && !seen.has(u)) { seen.add(u); allImages.push(u); } };
      if (ogImg)  push(ogImg);
      if (ldImg)  push(ldImg);
      for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const raw   = JSON.parse(m[1]);
          const items = Array.isArray(raw) ? raw : [raw];
          for (const it of items) {
            if (it?.["@type"] !== "Product") continue;
            if (typeof it.image === "string") push(it.image);
            if (Array.isArray(it.image)) it.image.forEach((u: unknown) => typeof u === "string" && push(u));
          }
        } catch { /* malformed JSON-LD */ }
      }

      return {
        imageUrl: ogImg || ldImg || null,
        title:    ogTitle || null,
        brand:    ogBrand || ldBrand || null,
        price:    ogPrice || ldPrice || null,
        allImages,
      };
    } catch { return { imageUrl: null, title: null, brand: null, price: null, allImages: [] }; }
  })();

  const jinaPromise: Promise<JinaResult> = (async () => {
    try {
      // Independent closure from htmlPromise above — its assertSafeUrl call doesn't cover this
      // one, they run concurrently over the same `url`. Guards against using r.jina.ai as an
      // SSRF/abuse pivot with an internal/private target URL, same as every other outbound
      // fetch of a user-supplied URL in this file.
      await assertSafeUrl(url);
      const res = await fetch(`https://r.jina.ai/${url}`, { headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { pageText: null };
      const text = await res.text();
      return { pageText: text.trim().slice(0, 3500) || null };
    } catch { return { pageText: null }; }
  })();

  const shopifyPromise = tryShopifyVariantImage(url);

  const [fc, html, jina, shopifyImg] = await Promise.all([firecrawlPromise, htmlPromise, jinaPromise, shopifyPromise]);

  // Merge: shopify variant image wins over og:image for colorway accuracy
  imageUrl = shopifyImg || fc.imageUrl || html.imageUrl || null;
  brand    = fc.brand  || html.brand  || null;
  if (brand) brand = decodeEntities(brand).replace(/[™®©]/g, "").trim() || null;
  // Cleaned here, at the single point every caller gets a scraped title from, so free (shown
  // as-is) and Pro (scraped title wins over the AI's) both get a real item name rather than the
  // page's SEO <title> — see lib/cleanProductTitle.ts.
  title    = cleanProductTitle(fc.title || html.title || null, brand);
  price    = fc.price  || html.price  || null;
  pageText = fc.pageText || jina.pageText || null;

  // Merge all candidate images — shopify / fc primary first, then html extras
  const seenUrls = new Set<string>();
  const allImages: string[] = [];
  const pushImg = (u: string | null) => { if (u && !seenUrls.has(u)) { seenUrls.add(u); allImages.push(u); } };
  pushImg(shopifyImg ?? null);
  pushImg(fc.imageUrl);
  html.allImages.forEach(pushImg);

  return { imageUrl, title, brand, price, pageText, allImages };
}

// Fetches full readable page text for material extraction and marketplace brand lookup.
async function fetchPageText(link: string): Promise<string | null> {
  const { pageText } = await scrapeProductPage(link);
  return pageText;
}


async function askGptMaterial(
  title: string,
  image: string,
  context: string | null,
  actor: AiActor | null,
): Promise<string | null> {
  if (!actor) return null; // no AI for this request (free tier)
  if (context) {
    try {
      const completion = await aiChat("openai:chat:material-text", {
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `${context}\n\nItem: "${title}"\n\nWhat is this item primarily made of? If you see a percentage breakdown, return the highest-percentage material.\nRespond with ONLY this JSON: {"material": "leather"} — replace the value with the actual material.`,
        }],
        max_tokens: 50,
      }, actor);
      const data = JSON.parse(completion.content || "{}");
      const mat = parseField(data.material);
      if (mat) return mat;
    } catch {}
  }
  try {
    const completion = await aiChat("openai:chat:material-vision", {
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `What is this "${title}" primarily made of?\nRespond with ONLY this JSON: {"material": "leather"} — replace the value with the actual material.`,
          },
          { type: "image_url", image_url: { url: image, detail: "high" } },
        ],
      }],
      max_tokens: 50,
    }, actor);
    const data = JSON.parse(completion.content || "{}");
    return parseField(data.material);
  } catch { return null; }
}


// actor: who pays for the AI parts (lib/aiGateway.ts); null = no AI (HTML/text extraction only).
export async function lookupAttributesFromUrl(
  title: string,
  link: string,
  image: string,
  actor: AiActor | null,
): Promise<UrlLookupResult> {
  const domain = getDomain(link);
  const skipBrandExtraction = shouldSkipBrandExtraction(domain);

  console.log(`[productLookup] domain=${domain} skipBrandExtraction=${skipBrandExtraction}`);

  if (!skipBrandExtraction) {
    // Brand-owned site: extract brand from HTML metadata and use page text for material.
    const [htmlBrand, pageText] = await Promise.all([
      extractBrandFromHtml(link),
      fetchPageText(link),
    ]);
    console.log(`[productLookup] htmlBrand=${htmlBrand} pageTextLength=${pageText?.length ?? 0}`);

    const brand = htmlBrand ?? (actor ? await lookupBrandViaWebSearch(domain, actor) : null);
    console.log(`[productLookup] final brand=${brand}`);

    const material = await askGptMaterial(
      title,
      image,
      pageText ? `Page content:\n${pageText.slice(0, 2500)}` : null,
      actor,
    );
    return { brand, material, pageText };
  }

  // Google Shopping / marketplace URL: brand comes from the `source` field in route.ts.
  // Do NOT call askGptBrand here — the title alone produces garbage (e.g. "Baggy" from "Baggy Raw Denim").
  const pageText = await fetchPageText(link);
  console.log(`[productLookup] marketplace pageTextLength=${pageText?.length ?? 0}`);
  const context = pageText ? `Page content:\n${pageText.slice(0, 2500)}` : null;
  const material = await askGptMaterial(title, image, context, actor);
  return { brand: null, material, pageText };
}

