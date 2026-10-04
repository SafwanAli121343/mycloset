import { NextRequest, NextResponse } from "next/server";
import { compressedJson } from "@/lib/http/compressedJson";
import { after } from "next/server";
import sharp from "sharp";
import { insertGarment, deleteGarment } from "@/lib/db/garments";
import { getFunctionalSlot } from "@/lib/wardrobeAnalysis";
import type { CrossedEntry } from "@/lib/wardrobeAnalysis";
import { revalidateGarmentCrossings } from "@/lib/db/wardrobeState";
import { getDiscoveredBrands, addDiscoveredBrand } from "@/lib/db/discoveredBrands";
import {
  detectSubType,
  inferSubTypeFromKeywords,
  detectBrand,
  resolveBrand,
  detectFit,
  detectPattern,
  detectMaterial,
  crossReferenceAttributes,
} from "@/lib/garmentMetadata";
import { extractColors } from "@/lib/colorExtraction";
import { inferGarmentAttributes, inferGarmentAttributesTextOnly } from "@/lib/aiInference";
import { searchVisualMatches, type VisualMatch } from "@/lib/lensSearch";
import { detectLogoAndText, type LogoTextResult } from "@/lib/visionDetection";
import { aiPaidCall } from "@/lib/aiGateway";
import { verifyBrandCandidate } from "@/lib/brandVerification";
import { lookupAttributesFromUrl } from "@/lib/productLookup";
import { assertSafeUrl } from "@/lib/security/ssrfGuard";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { removeBackgroundQueued } from "@/lib/bgRemoval";
import { getUserById } from "@/lib/db/users";
import { consumeAiCredit, resolveEntitlement } from "@/lib/billing/entitlements";
import type { InferenceResult } from "@/lib/aiInference";

// Free-tier items still get real organization + non-AI analysis (title, category, color via
// sharp-based extractColors, fit/pattern/material via title-text heuristics) — only the actual
// OpenAI/Vision calls (inferGarmentAttributes, searchVisualMatches, detectLogoAndText) are
// gated. One credit (from a one-time-purchase balance) buys one item's worth of AI enrichment
// regardless of how many underlying API calls that fans out into; Pro checks against its own
// monthly dollar cap instead (see lib/billing/entitlements.ts's consumeAiCredit).
// Returns the fetched user alongside the decision so callers can pass it straight into
// inferGarmentAttributes/inferGarmentAttributesTextOnly for real per-call cost tracking, without
// a second DB read.
async function resolveAiAllowed(userId: string): Promise<{ allowed: boolean; user: Awaited<ReturnType<typeof getUserById>> }> {
  const user = await getUserById(userId).catch(() => null);
  if (!user) return { allowed: false, user: null };
  // Silent degrade, not an error — matches the existing free-tier-no-credits behavior here: the
  // item still saves, just without AI enrichment, same as it always has. This is a background
  // pass on save, not an interactive action the user is actively waiting on, so there's nothing
  // to show red error text for here specifically (unlike the direct, interactive AI actions —
  // Add Item's own auto-fill, Preview, Wardrobe analysis — which DO surface consumeErrorMessage).
  // Pro only (within its monthly cap). A free user's purchased scores are never spent on adding
  // an item — only through "Use score?" in My Closet (/api/jobs).
  const result = await consumeAiCredit(user);
  return { allowed: result.allowed, user };
}

const EMPTY_INFERENCE: InferenceResult = { values: {}, confidence: {} };

// Per-call prices for the non-OpenAI paid lookups, charged to the AI budget (lib/aiGateway.ts):
// SerpAPI Google Lens ≈ 1.5¢/search, Cloud Vision logo + text detection ≈ 0.3¢.
const LENS_CENTS = 1.5;
const VISION_CENTS = 0.3;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// AI-derived fields hidden (not deleted — see resolveEntitlement) from a free/lapsed-tier
// response. color_pairings/color_clashes are excluded too even though a rule-based non-AI
// substitute exists client-side (lib/colorTheory.ts computes those live from color_primary,
// which IS always present) — the DB versions are the richer AI-written ones and shouldn't leak
// back in once a subscription lapses.
const AI_GATED_FIELDS = [
  "pros", "cons", "aesthetic_tags", "color_pairings", "color_clashes", "style_pairings",
  "formality", "design_complexity", "logo_prominence",
] as const;

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Run alongside the garments query, not after it — sequential here would add a full extra
  // round trip to the app's single most frequently called endpoint for no reason, since neither
  // query depends on the other's result.
  const [{ data, error }, billingUser] = await Promise.all([
    adminClient
      .from("garments")
      .select("*")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false }),
    getUserById(session.userId).catch(() => null),
  ]);

  if (error) return Response.json({ error: "Something went wrong." }, { status: 500 });

  const hasAI = !!billingUser && resolveEntitlement(billingUser).hasAI;
  const out = hasAI
    ? data
    : (data ?? []).map(g => {
        const copy = { ...g } as Record<string, unknown>;
        // Paid for with a one-time purchase — this item's AI details stay visible on free tier.
        if (copy.ai_unlocked === true) return copy;
        for (const f of AI_GATED_FIELDS) {
          // aesthetic_tags is the one AI_GATED_FIELDS entry that can also be a user's own
          // AestheticPicker choice, not just an AI guess (see aesthetic_source's own comment in
          // lib/db/garments.ts) — stripping it here for a free/lapsed user must not also erase
          // something they typed in themselves.
          if (f === "aesthetic_tags" && copy.aesthetic_source === "manual") continue;
          copy[f] = null;
        }
        return copy;
      });

  // no-store, not max-age: this is the user's own, frequently-mutated list. A max-age let the
  // browser (and iOS's URL cache on native) answer from its HTTP cache for up to a minute, so
  // the closet's 3.5s "analysis pending" poll kept getting the same stale pros:null snapshot,
  // and a just-added/deleted item could be missing/still present after navigating back.
  // Native keeps its own in-memory TTL cache (native/lib/dataCache.ts), so nothing is lost.
  return compressedJson(req, out, {
    headers: { "Cache-Control": "private, no-store" },
  });
}


function extractUrlSlugText(url: string | undefined): string {
  if (!url) return "";
  try {
    const { pathname } = new URL(url);
    const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
    return lastSegment.replace(/^\d+-/, "").replace(/[-_]/g, " ");
  } catch {
    return "";
  }
}



async function searchProductComposition(title: string, brand: string | null): Promise<string | null> {
  try {
    const query = brand
      ? `${brand} ${title} material composition fabric content`
      : `${title} material composition fabric content`;
    const params = new URLSearchParams({
      api_key: process.env.SERPAPI_KEY!,
      engine: "google",
      q: query,
      num: "3",
    });
    const res = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const data = await res.json();
    const snippets = ((data.organic_results || []) as { title?: string; snippet?: string }[])
      .slice(0, 3)
      .filter((r) => r.snippet)
      .map((r) => `${r.title || ""}: ${r.snippet}`)
      .join("\n");
    return snippets || null;
  } catch {
    return null;
  }
}

export const maxDuration = 60;

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as Record<string, unknown>;
  const { id, ...raw } = body;
  if (!id || typeof id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });

  const ALLOWED = ["title", "brand", "category", "sub_type", "color_primary", "color_secondary", "material", "fit", "formality"];
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in raw) updates[key] = raw[key] ?? null;
  }
  // Editing the aesthetic after the fact — same shape and "manual" source as Add Item's picker
  // (see the manual-add path below), so a user's own pick is never stripped for free tier and
  // never overwritten by AI. An empty value clears it.
  if ("aesthetic" in raw) {
    const a = typeof raw.aesthetic === "string" ? raw.aesthetic.trim().slice(0, 40) : "";
    updates.aesthetic_tags = a ? [a] : null;
    updates.aesthetic_source = a ? "manual" : null;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { data: updatedGarment, error } = await adminClient
    .from("garments")
    .update(updates)
    .eq("id", id)
    .eq("user_id", session.userId)
    .select("sub_type, category, color_primary, aesthetic_tags")
    .single();

  if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  // If a crossing-relevant attribute changed, re-validate this item's existing wardrobe-analysis
  // crossings against its new attributes — a color crossing earned under the old color, for
  // example, must not keep showing as resolved after the edit.
  const CROSSING_RELEVANT = ["category", "sub_type", "color_primary", "aesthetic_tags"];
  if (CROSSING_RELEVANT.some(k => k in updates) && updatedGarment) {
    try { await revalidateGarmentCrossings(adminClient, session.userId, id, updatedGarment); }
    catch { /* non-critical */ }
  }

  return NextResponse.json({ success: true });
}

// Upload a base64 data URI to Supabase Storage and return the public URL.
// Used to avoid storing raw image bytes in the garments DB column.
async function uploadBase64ToStorage(dataUri: string, userId: string): Promise<string> {
  const semi = dataUri.indexOf(";base64,");
  if (!dataUri.startsWith("data:") || semi === -1) return dataUri;
  const mime = dataUri.slice(5, semi);
  const b64  = dataUri.slice(semi + 8);
  const buffer = Buffer.from(b64, "base64");
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const storagePath = `${userId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  await adminClient.storage.createBucket("garment-images", { public: true }).catch(() => {});
  const { error } = await adminClient.storage
    .from("garment-images")
    .upload(storagePath, buffer, { contentType: mime, upsert: true });
  if (error) return dataUri;
  return adminClient.storage.from("garment-images").getPublicUrl(storagePath).data.publicUrl;
}

export async function POST(request: NextRequest) {
  // AI inference + image processing make this expensive — limit to 30/hour per IP
  const rateBlock = applyApiRateLimit(request, "garments:post", 30, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user_id = session.userId;

  const body = await request.json();
  const { title, price, source, link, image, category, manual, brand: manualBrand, color_primary: manualColor, aesthetic: manualAesthetic } = body;

  // Manual add — save immediately, then infer scoring fields in the background
  if (manual) {
    if (!title || !category) {
      return NextResponse.json({ error: "title and category required for manual add" }, { status: 400 });
    }
    const resolvedImageManual = image?.startsWith("data:")
      ? await uploadBase64ToStorage(image, user_id).catch(() => image)
      : (image ?? null);
    // A manually-picked aesthetic (native's AestheticPicker, both free and paid) is available
    // regardless of AI access — the one AI_GATED_FIELDS field a free-tier user can still set
    // themselves. Stored immediately at insert time, not left for the AI enrichment pass below.
    const manualAestheticTags: string[] | null =
      typeof manualAesthetic === "string" && manualAesthetic.trim() ? [manualAesthetic.trim()] : null;
    const garment = await insertGarment({
      title,
      price: price ?? null,
      source: "manual",
      link: link ?? null,
      image: resolvedImageManual,
      user_id,
      category,
      brand: manualBrand ?? null,
      color_primary: manualColor ?? null,
      aesthetic_tags: manualAestheticTags,
      aesthetic_source: manualAestheticTags ? "manual" : null,
      // Deterministic sub_type from the title, at insert — the free tier's only source of one
      // (no AI), and what lets outfit generation tell a hoodie (a layer) from a tee (a base).
      // A Pro item's AI enrichment below overwrites it with the AI's own answer.
      sub_type: detectSubType(title, category) ?? inferSubTypeFromKeywords(title, category),
    });

    // Run AI inference — visual when an image is available (same pipeline as Preview),
    // text-only fallback otherwise. Free tier (no AI credit available) skips this entirely and
    // keeps the item exactly as saved above — organization-only, no scoring/pros/cons/pairings.
    let enriched: Record<string, unknown> = { ...garment };
    const { allowed: aiAllowedManual, user: billingUserManual } = await resolveAiAllowed(user_id);
    try {
      const DEEP_FIELDS = ["sub_type", "aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "pattern", "item_tier", "novelty_quality"];
      const result = !aiAllowedManual
        ? EMPTY_INFERENCE
        : image
        ? await inferGarmentAttributes(
            {
              title,
              category,
              subType: null,
              brand: manualBrand ?? null,
              colorPrimary: manualColor ?? null,
              fit: body.fit ?? null,
              material: body.material ?? null,
              image,
            },
            DEEP_FIELDS,
            billingUserManual!,
          )
        : await inferGarmentAttributesTextOnly({
            title,
            category,
            subType: null,
            brand: manualBrand ?? null,
            colorPrimary: manualColor ?? null,
            material: body.material ?? null,
          }, billingUserManual!);
      const v = result.values;
      const manualIsNovelty = (v.item_tier as string | undefined) === 'novelty';
      const updates: Record<string, unknown> = {};
      if (v.sub_type) updates.sub_type = v.sub_type;
      // Never overwrite a user's explicit aesthetic pick with AI's own guess — same "manual wins
      // over inferred" rule already applied to brand/title in /api/garments/analyze.
      if (v.aesthetic_tags && !manualAestheticTags) {
        updates.aesthetic_tags = v.aesthetic_tags;
        updates.aesthetic_source = "ai";
      }
      if (v.pattern) updates.pattern = v.pattern;
      if (v.formality) updates.formality = v.formality;
      if (v.material) updates.material = v.material;
      if (v.color_pairings) updates.color_pairings = v.color_pairings;
      if (v.color_clashes) updates.color_clashes = v.color_clashes;
      if (v.item_tier) {
        const existingTags = (garment.tags as Record<string, unknown>) ?? {};
        const noveltyQ = v.novelty_quality as number | null | undefined;
        updates.tags = {
          ...existingTags,
          tier: [v.item_tier],
          ...(noveltyQ != null ? { novelty_score: [String(noveltyQ)] } : {}),
        };
      }
      if (manualIsNovelty) {
        updates.pros = [];
        updates.cons = [];
      } else if (aiAllowedManual) {
        // [] rather than leaving null when AI ran but returned none — see the URL path's
        // analysisUpdate comment below for why null reads as "still analyzing" forever.
        updates.pros = v.pros ?? [];
        updates.cons = v.cons ?? [];
      }
      if (Object.keys(updates).length > 0) {
        await adminClient.from("garments").update(updates).eq("id", garment.id);
        enriched = { ...enriched, ...updates };
      }
    } catch (err) {
      console.error("[manual inference] inference failed:", err);
    }

    const enrichedSubType = enriched.sub_type as string | null | undefined;
    return NextResponse.json(
      { ...enriched, functional_slot: getFunctionalSlot(enrichedSubType ?? null) },
      { status: 201 }
    );
  }

  console.log(`[route] POST received title="${title}" link="${link}"`);

  const urlSlugText = extractUrlSlugText(link);
  const brandSearchText = urlSlugText ? `${urlSlugText} ${title}` : title;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const discoveredBrands = await getDiscoveredBrands().catch(() => [] as string[]);

  // Only an exact-phrase match counts as "high" confidence — a keyword guess still lets a Pro
  // user's AI pass refine it, but is a usable answer on its own for the free tier.
  const exactSubType = detectSubType(title, category);
  let subType = exactSubType ?? inferSubTypeFromKeywords(title, category);
  const subTypeConfidence = exactSubType ? "high" : "unknown";

  const isAccessory = category === "accessory";
  let fit = isAccessory ? null : detectFit(title);
  let pattern = detectPattern(title);
  let material = detectMaterial(title);
  let materialConfidence: string | undefined = material ? "high" : undefined;

  const { allowed: aiAllowed, user: billingUserMain } = await resolveAiAllowed(user_id);
  const needsLens = aiAllowed && (!detectBrand(title, discoveredBrands) || (!isAccessory && !fit) || !pattern || !material);
  const needsVision = aiAllowed && (!detectBrand(title, discoveredBrands) || !material);

  // Step 1: image analysis in parallel. extractColors is plain sharp/Lab pixel math (no AI) and
  // always runs — it's the free tier's real, non-AI color data.
  const [visualMatches, colorResult, visionResult, urlLookup] = await Promise.all([
    // Lens/Vision are paid APIs: billed to the user's AI budget and cached by image content
    // like every AI call (lib/aiGateway.ts). aiAllowed ⇒ billingUserMain is set.
    needsLens
      ? aiPaidCall("serpapi:lens", { type: "image_url", image_url: { url: image } }, LENS_CENTS, billingUserMain!, () => searchVisualMatches(image)).catch(() => [] as VisualMatch[])
      : Promise.resolve([] as VisualMatch[]),
    extractColors(image),
    needsVision
      ? aiPaidCall("gcv:logo-text", { type: "image_url", image_url: { url: image } }, VISION_CENTS, billingUserMain!, () => detectLogoAndText(image))
          .catch(() => ({ detectedLogos: [], ocrText: "" } as LogoTextResult))
      : Promise.resolve({ detectedLogos: [], ocrText: "" } as LogoTextResult),
    link ? lookupAttributesFromUrl(title, link, image, aiAllowed ? billingUserMain : null) : Promise.resolve({ brand: null, material: null, pageText: null }),
  ]);


  const brandResult = await resolveBrand(
    brandSearchText, visualMatches, visionResult, discoveredBrands,
    aiAllowed
      ? (c: string) => aiPaidCall("serpapi:brand-verify", { q: c.toLowerCase() }, LENS_CENTS, billingUserMain!, () => verifyBrandCandidate(c)).catch(() => false)
      : null,
  );

  if (brandResult.discovered) {
    await addDiscoveredBrand(brandResult.discovered).catch(() => {});
  }

  // Tier A2: OCR from care label
  if (!material) {
    const ocrMaterial = detectMaterial(visionResult.ocrText);
    if (ocrMaterial) {
      material = ocrMaterial;
      materialConfidence = "high";
    }
  }

  // Tier B: cross-ref for fit and pattern only
  const crossRefFields = [
    ...(fit ? [] : ["fit"]),
    ...(pattern ? [] : ["pattern"]),
  ];
  const crossRef = crossReferenceAttributes(visualMatches, crossRefFields);

  const fitConfidence = fit ? "high" : crossRef.confidence.fit;
  const patternConfidence = pattern ? "high" : crossRef.confidence.pattern;

  fit = fit || crossRef.values.fit || null;
  pattern = pattern || crossRef.values.pattern || null;
  let urlListingText = urlLookup.pageText;

  // Apply URL material if we don't have a high-confidence source (title/OCR)
  if (!materialConfidence && urlLookup.material) {
    material = urlLookup.material;
    materialConfidence = "medium";
  }

  // Composition search only when material still unknown
  if (!materialConfidence) {
    const effectiveBrand = urlLookup.brand ?? brandResult.brand;
    const compositionHints = await searchProductComposition(title, effectiveBrand);
    if (compositionHints) {
      urlListingText = urlListingText
        ? `${urlListingText}\n\nProduct composition search:\n${compositionHints}`
        : `Product composition search:\n${compositionHints}`;
    }
  }

  // `source` is the merchant name from SerpAPI (e.g. "Hours Collection", "Jos. A. Bank").
  // For single-brand stores this IS the brand. Exclude multi-brand retailers and marketplaces.
  const MULTI_BRAND_SOURCES = new Set([
    // resale / marketplace
    "eBay", "Grailed", "Depop", "Poshmark", "StockX", "Goat", "Flight Club",
    "The RealReal", "Vestiaire Collective", "ThredUp", "Vinted",
    // department stores / multi-brand retail
    "Amazon", "Nordstrom", "Bloomingdale's", "Saks Fifth Avenue", "Neiman Marcus",
    "Macy's", "Nordstrom Rack", "TJ Maxx", "Marshalls", "Selfridges", "Harvey Nichols",
    "Harrods", "Flannels", "John Lewis",
    // luxury multi-brand
    "SSENSE", "Mr Porter", "Farfetch", "Net-A-Porter", "The Outnet", "Shopbop",
    "Revolve", "ASOS", "24S", "Browns", "Matches Fashion", "LN-CC", "Mytheresa",
    "Dover Street Market", "ESSX", "END Clothing", "Goodhood", "SNS",
    "Antonioli", "Machine-A", "HBX", "Highsnobiety Shop",
    // fashion editorial / aggregator sites
    "Editorialist", "Lyst", "ShopStyle", "Stylight", "Wheretoget", "Google Shopping",
    // big-box mass retail
    "Walmart", "Target", "Costco", "Sam's Club", "Kmart", "Dollar General",
    // general multi-brand fashion retail (common sources that bleed through)
    "Urban Outfitters", "ASOS", "PacSun", "Zumiez", "Tillys", "Hot Topic",
    "H&M", "Zara", "Uniqlo", "Gap", "Old Navy", "American Eagle", "Express",
    "Free People", "Anthropologie", "Forever 21",
    // social commerce / generic marketplaces
    "TikTok Shop", "TikTok", "Temu", "Shein", "Wish", "AliExpress", "DHgate",
    // multi-brand streetwear / sneaker boutiques
    "Culture Kings", "Foot Locker", "Champs Sports", "JD Sports", "Finish Line",
    "DTLR", "Hibbett", "Shoe Palace", "Sneakers N Stuff", "Packer",
    // European multi-brand stores that sometimes appear as source
    "Jentestore", "jentestore global", "Très Bien", "Slam Jam",
    "Capsule Oslo", "Coggles", "Oi Polloi", "Present London",
  ]);
  // Reject source values that look like domain names (e.g. "shop.ap", "store.foo.com")
  const looksLikeDomain = (s: string) => /^[a-z0-9-]+(\.[a-z]{2,}){1,}$/i.test(s);

  // Handle "Platform - Seller" formats like "eBay - Solecart" or "Amazon - Third Party"
  const isMultiBrandSource = (s: string): boolean => {
    if (MULTI_BRAND_SOURCES.has(s)) return true;
    for (const platform of MULTI_BRAND_SOURCES) {
      if (s.toLowerCase().startsWith(platform.toLowerCase())) return true;
    }
    return false;
  };

const sourceBrand = source && !isMultiBrandSource(source) && !looksLikeDomain(source) ? source : null;
console.log(`[route] source="${source}" sourceBrand="${sourceBrand}"`);


  // Apply the same multi-brand filter to the URL-extracted brand (og:site_name from a
  // retailer's product page — e.g. walmart.com returns "Walmart", culturekings.com returns
  // "Culture Kings" — both of which would otherwise silently beat the item's real brand).
  const urlBrand = urlLookup.brand && !isMultiBrandSource(urlLookup.brand) ? urlLookup.brand : null;

  // Priority: high-confidence title/OCR match first (the brand is literally written on or
  // in the item name), then URL extraction from a genuine brand-owned site, then source name.
  // urlBrand only wins when the title didn't identify the brand — e.g. a niche brand not in
  // our curated list, sold on its own single-brand website.
  const confirmedBrand =
    (brandResult.confidence === "high" ? brandResult.brand : null)
    ?? urlBrand
    ?? sourceBrand
    ?? null;

  const fieldsNeeded = [
    ...(exactSubType ? [] : ["sub_type"]),
    ...(!isAccessory && !fit ? ["fit"] : []),
    ...(pattern ? [] : ["pattern"]),
    ...(materialConfidence ? [] : ["material"]),
    ...(confirmedBrand ? [] : ["brand"]),
    "color_primary",
    "color_secondary",
    "aesthetic_tags",
    "formality",
    "pros",
    "cons",
    "color_pairings",
    "color_clashes",
    "tags",
  ];

  const toHex = (rgb: [number, number, number] | null) =>
    rgb ? `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}` : null;

  const inferred = !aiAllowed
    ? EMPTY_INFERENCE
    : await inferGarmentAttributes(
        {
          title,
          category,
          subType,
          brand: confirmedBrand,
          colorPrimary: colorResult.primary,
          colorPrimaryHex: toHex(colorResult.primaryRgb),
          colorSecondary: colorResult.secondary,
          colorSecondaryHex: toHex(colorResult.secondaryRgb),
          fit,
          material: materialConfidence ? material : undefined,
          image,
          listingText: urlListingText,
          link,
          // No wardrobe context: the analysis depends only on the item itself, so the same item
          // added by anyone sends the same request and reuses its stored answer (aiGateway.ts).
          // Pairings with the user's own pieces come from /api/garments/pairings instead.
        },
        fieldsNeeded,
        billingUserMain!,
      );

  // AI beats a keyword guess; only an exact-phrase match beats the AI.
  subType = exactSubType || (inferred.values.sub_type as string | undefined) || subType || null;

  const finalColorPrimary = (inferred.values.color_primary as string | null | undefined) ?? colorResult.primary;
  const finalColorSecondary = (inferred.values.color_secondary as string | null | undefined) ?? colorResult.secondary;

  const finalBrand = confirmedBrand
    ?? (inferred.values.brand as string | null | undefined)
    ?? brandResult.brand;
  const finalBrandConfidence = urlLookup.brand
    ? "high"
    : ((inferred.values.brand as string | null | undefined) ? "medium" : brandResult.confidence);

  const finalMaterial = materialConfidence
    ? material
    : ((inferred.values.material as string | undefined) || null);

  const confidence: Record<string, string> = {
    brand: finalBrandConfidence,
    sub_type: subTypeConfidence,
    color_primary: finalColorPrimary ? "medium" : "unknown",
    color_secondary: finalColorSecondary ? "medium" : "unknown",
    ...(fitConfidence ? { fit: fitConfidence } : {}),
    ...(patternConfidence ? { pattern: patternConfidence } : {}),
    ...(materialConfidence ? { material: materialConfidence } : {}),
    ...inferred.confidence,
  };

  const resolvedImage = image?.startsWith("data:") && user_id
    ? await uploadBase64ToStorage(image, user_id).catch(() => image)
    : image;

  const garment = await insertGarment({
    title,
    price,
    source,
    link,
    image: resolvedImage,
    user_id,
    category,
    brand: finalBrand,
    sub_type: subType,
    color_primary: finalColorPrimary,
    color_secondary: finalColorSecondary,
    fit: fit || (inferred.values.fit as string | undefined) || null,
    pattern: pattern || (inferred.values.pattern as string | undefined) || null,
    material: finalMaterial,
    design_complexity: inferred.values.design_complexity as number,
    logo_prominence: inferred.values.logo_prominence as number,
    aesthetic_tags: inferred.values.aesthetic_tags as string[],
    // This insertion path (URL-scrape/auto-import) never takes a manual aesthetic from the
    // client — whatever's here always came from inferred.values, i.e. AI.
    aesthetic_source: (inferred.values.aesthetic_tags as string[] | null | undefined)?.length ? "ai" : null,
    formality: inferred.values.formality as string,
    tags: (() => {
      const base = (inferred.values.tags as Record<string, string[]> | null) ?? {};
      const withColors = colorResult.colors.length > 0 ? { ...base, colors: colorResult.colors } : base;
      const tier = inferred.values.item_tier as string | undefined;
      const noveltyQ = inferred.values.novelty_quality as number | null | undefined;
      const withTier = tier ? { ...withColors, tier: [tier] } : withColors;
      return (noveltyQ != null) ? { ...withTier, novelty_score: [String(noveltyQ)] } : withTier;
    })(),
    confidence,
  });

  // Store pros/cons via a separate update — silently skips if columns don't exist yet.
  // Run the ALTER TABLE in Supabase to enable: ADD COLUMN pros text[], ADD COLUMN cons text[]
  const prosVal          = inferred.values.pros           as string[] | undefined;
  const consVal          = inferred.values.cons           as string[] | undefined;
  const colorPairings    = inferred.values.color_pairings as string[] | undefined;
  const colorClashes     = inferred.values.color_clashes  as string[] | undefined;
  const stylePairings    = inferred.values.style_pairings as string[] | undefined;
  const isNovelty = (inferred.values.item_tier as string | undefined) === 'novelty';
  const itemPattern = (inferred.values.pattern as string | undefined) ?? '';
  // All-over/photo prints confuse the bg removal model — it can't separate print from background.
  // Skip AI removal for these items and upload the source image as-is (PNG-converted).
  const skipBgRemoval = isNovelty || ['photo-print', 'novelty-print', 'all-over-graphic'].includes(itemPattern);
  const analysisUpdate: Record<string, unknown> = {};
  // Novelty items get novelty-specific pros/cons instead of empty arrays.
  // The score (1–10 craft scale) communicates quality; pros/cons explain the styling implications.
  if (isNovelty) {
    analysisUpdate.pros = [
      "Bold statement piece with a distinctive graphic design",
      "Eye-catching — immediately sets the tone of an outfit",
    ];
    analysisUpdate.cons = [
      "Extremely difficult to style — pairs only with solid, neutral pieces",
      "All-over graphic print clashes with most patterns and busy designs",
      "Very limited outfit versatility due to the novelty design",
    ];
  } else if (aiAllowed) {
    // Always written as arrays once AI has actually run, even when it returned none — null is
    // what every client reads as "analysis still pending", so leaving it null made an item
    // whose analysis found no pros/cons show "analyzing…" forever. Free tier never runs AI and
    // keeps null (which GET strips/the clients hide anyway).
    analysisUpdate.pros = prosVal ?? [];
    analysisUpdate.cons = consVal ?? [];
  }
  if (colorPairings?.length) analysisUpdate.color_pairings = colorPairings;
  if (colorClashes?.length)  analysisUpdate.color_clashes  = colorClashes;
  if (stylePairings?.length) analysisUpdate.style_pairings = stylePairings;
  if (Object.keys(analysisUpdate).length > 0) {
    try {
      await adminClient.from("garments").update(analysisUpdate).eq("id", garment.id);
    } catch { /* columns not yet migrated */ }
  }

  // Background removal runs after the response is sent so the add feels instant.
  // Once done, the garment row's image is updated to the clean Supabase Storage URL.
  after(async () => {
    try {
      // data: URIs are self-contained (no network fetch happens), so only guard real URLs.
      if (!image.startsWith("data:")) await assertSafeUrl(image);
      const srcRes = await fetch(image, { headers: { "User-Agent": "Mozilla/5.0" } });
      const srcBuf = Buffer.from(await srcRes.arrayBuffer());

      let buffer: Buffer;
      if (skipBgRemoval) {
        // Novelty/all-over-print items — skip AI removal (model can't separate print from background).
        buffer = await sharp(srcBuf).png().toBuffer();
      } else {
        // Use the already-fetched buffer (as a Blob) instead of the URL so the bg-removal
        // library doesn't make its own fetch — brand CDNs may block that second request.
        const inputBlob = new Blob([new Uint8Array(srcBuf)], { type: "image/jpeg" });
        const cleanBlob = await removeBackgroundQueued(inputBlob);
        const rawBuffer = Buffer.from(await cleanBlob.arrayBuffer());
        const { data: px, info } = await sharp(rawBuffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        // Snap alpha: >= 35 → fully opaque, < 25 → fully transparent
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] < 25)  px[i] = 0;
          else if (px[i] >= 35) px[i] = 255;
        }

        // Quality check: total opaque pixel ratio across the full image.
        // Must be 5–90%: below 5% the model erased the garment; above 90% it removed nothing.
        // We intentionally avoid a center-crop check here — items like glasses have transparent
        // lenses that make the centre mostly transparent even when bg-removal worked correctly.
        const w = info.width, h = info.height;
        let opaque = 0;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] > 128) opaque++;
        }
        const totalOpacityRatio = opaque / (px.length / 4);

        if (totalOpacityRatio >= 0.05 && totalOpacityRatio <= 0.90) {
          buffer = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
        } else {
          buffer = await sharp(srcBuf).png().toBuffer();
        }
      }

      await adminClient.storage.createBucket("garment-images", { public: true }).catch(() => {});
      const storagePath = `${user_id ?? "anon"}/${garment.id}.png`;
      const { data: uploaded, error: uploadErr } = await adminClient.storage
        .from("garment-images")
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });
      if (!uploadErr && uploaded) {
        const cleanUrl = adminClient.storage.from("garment-images").getPublicUrl(uploaded.path).data.publicUrl;

        // Re-run color extraction on the clean image (transparent background = no background
        // pixels, no model clothing bleed-through). This overwrites the initial color values
        // which were extracted from the original image before background removal.
        const cleanColors = await extractColors(cleanUrl).catch(() => null);
        const colorUpdate: Record<string, string | null> = { image: cleanUrl };
        if (cleanColors) {
          if (cleanColors.primary)   colorUpdate.color_primary   = cleanColors.primary;
          if (cleanColors.secondary !== undefined) colorUpdate.color_secondary = cleanColors.secondary;
        }
        await adminClient.from("garments").update(colorUpdate).eq("id", garment.id);
      }
    } catch {
      // keep original URL on failure
    }
  });

  // Includes analysisUpdate — `garment` is the row as first inserted, BEFORE the pros/cons/
  // pairings update above, so returning it alone handed the client pros:null for an item that
  // was already fully analyzed (the closet then showed "analyzing…" until its next refetch).
  return NextResponse.json(
    { ...garment, ...analysisUpdate, functional_slot: getFunctionalSlot(garment.sub_type ?? null) },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "No ID provided" }, { status: 400 });

  // Capture owner before deletion (cascade may drop rows before we can query) and verify
  // the requester actually owns this garment — without this check any authenticated user
  // could delete any other user's garment by guessing/observing its id.
  const { data: garmentMeta } = await adminClient
    .from("garments")
    .select("user_id")
    .eq("id", id)
    .single();
  const ownerId = garmentMeta?.user_id as string | undefined;
  if (!ownerId || ownerId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Find calendar outfits containing this garment before deletion
  // (cascade might drop outfit_items rows first, so we query now)
  const { data: affectedItems } = await adminClient
    .from("outfit_items")
    .select("outfit_id")
    .eq("garment_id", id);

  const affectedOutfitIds = (affectedItems ?? []).map((r: { outfit_id: string }) => r.outfit_id);
  let affectedMonths: string[] = [];

  if (affectedOutfitIds.length > 0) {
    const { data: affectedOutfits } = await adminClient
      .from("outfits")
      .select("date")
      .in("id", affectedOutfitIds);

    const monthSet = new Set<string>();
    for (const o of affectedOutfits ?? []) {
      monthSet.add((o.date as string).slice(0, 7)); // "YYYY-MM"
    }
    affectedMonths = [...monthSet];

    // Delete the outfits that used this garment so those dates become blank
    await adminClient.from("outfits").delete().in("id", affectedOutfitIds);
  }

  await deleteGarment(id);

  // Remove this garment's crossed entries from wardrobe analysis state. Levels are a permanent
  // achievement and never regress by design (computeEffectiveLevel never goes below currentLevel)
  // — this only uncrosses whatever this item resolved so the score recomputes without its
  // contribution, and the freed-up gap/color/aesthetic/con becomes eligible to be crossed again
  // by a future item, or resurfaced by a future level's analysis.
  if (ownerId) {
    try {
      const { data: stateRow } = await adminClient
        .from("wardrobe_analysis_state")
        .select("crossed, current_level")
        .eq("user_id", ownerId)
        .single();
      if (stateRow) {
        const prevCrossed    = (stateRow.crossed as CrossedEntry[]) ?? [];
        const updatedCrossed = prevCrossed.filter(e => e.garmentId !== id);

        if (updatedCrossed.length !== prevCrossed.length) {
          await adminClient.from("wardrobe_analysis_state").update({
            crossed:    updatedCrossed,
            updated_at: new Date().toISOString(),
          }).eq("user_id", ownerId);
        }
      }
    } catch { /* non-critical */ }
  }

  // Return affected months so the client can trigger regeneration for just those months
  return NextResponse.json({ success: true, affectedMonths });
}
