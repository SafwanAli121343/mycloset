import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import sharp from "sharp";
import { insertGarment, deleteGarment } from "@/lib/db/garments";
import { getFunctionalSlot } from "@/lib/wardrobeAnalysis";
import type { CrossedEntry } from "@/lib/wardrobeAnalysis";
import { revalidateGarmentCrossings } from "@/lib/db/wardrobeState";
import { getDiscoveredBrands, addDiscoveredBrand } from "@/lib/db/discoveredBrands";
import {
  detectSubType,
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
import { lookupAttributesFromUrl } from "@/lib/productLookup";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { removeBackground } from "@imgly/background-removal-node";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(_req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await adminClient
    .from("garments")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
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
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { data: updatedGarment, error } = await adminClient
    .from("garments")
    .update(updates)
    .eq("id", id)
    .eq("user_id", session.userId)
    .select("sub_type, category, color_primary, aesthetic_tags")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If a crossing-relevant attribute changed, re-validate this item's existing wardrobe-analysis
  // crossings against its new attributes — a color crossing earned under the old color, for
  // example, must not keep showing as resolved after the edit.
  const CROSSING_RELEVANT = ["category", "sub_type", "color_primary"];
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
  const body = await request.json();
  const { title, price, source, link, image, user_id, category, manual, brand: manualBrand, color_primary: manualColor } = body;

  // Manual add — save immediately, then infer scoring fields in the background
  if (manual) {
    if (!title || !category || !user_id) {
      return NextResponse.json({ error: "title, category and user_id required for manual add" }, { status: 400 });
    }
    const resolvedImageManual = image?.startsWith("data:")
      ? await uploadBase64ToStorage(image, user_id).catch(() => image)
      : (image ?? null);
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
    });

    // Run AI inference — visual when an image is available (same pipeline as Preview),
    // text-only fallback otherwise
    let enriched: Record<string, unknown> = { ...garment };
    try {
      const DEEP_FIELDS = ["sub_type", "aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "pattern", "item_tier", "novelty_quality"];
      const result = image
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
            DEEP_FIELDS
          )
        : await inferGarmentAttributesTextOnly({
            title,
            category,
            subType: null,
            brand: manualBrand ?? null,
            colorPrimary: manualColor ?? null,
            material: body.material ?? null,
          });
      const v = result.values;
      const manualIsNovelty = (v.item_tier as string | undefined) === 'novelty';
      const updates: Record<string, unknown> = {};
      if (v.sub_type) updates.sub_type = v.sub_type;
      if (v.aesthetic_tags) updates.aesthetic_tags = v.aesthetic_tags;
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
      } else {
        if (v.pros) updates.pros = v.pros;
        if (v.cons) updates.cons = v.cons;
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

  let subType = detectSubType(title, category);
  const subTypeConfidence = subType ? "high" : "unknown";

  const isAccessory = category === "accessory";
  let fit = isAccessory ? null : detectFit(title);
  let pattern = detectPattern(title);
  let material = detectMaterial(title);
  let materialConfidence: string | undefined = material ? "high" : undefined;

  const needsLens = !detectBrand(title, discoveredBrands) || (!isAccessory && !fit) || !pattern || !material;
  const needsVision = !detectBrand(title, discoveredBrands) || !material;

  // Step 1: image analysis + wardrobe fetch run in parallel
  const [[visualMatches, colorResult, visionResult, urlLookup], existingItems] = await Promise.all([
    Promise.all([
      needsLens ? searchVisualMatches(image).catch(() => [] as VisualMatch[]) : Promise.resolve([] as VisualMatch[]),
      extractColors(image),
      needsVision
        ? detectLogoAndText(image).catch(() => ({ detectedLogos: [], ocrText: "" } as LogoTextResult))
        : Promise.resolve({ detectedLogos: [], ocrText: "" } as LogoTextResult),
      link ? lookupAttributesFromUrl(title, link, image) : Promise.resolve({ brand: null, material: null, pageText: null }),
    ]),
    user_id
      ? adminClient.from("garments")
          .select("category, color_primary, color_secondary, sub_type, brand, fit, pattern, material, aesthetic_tags, formality, image")
          .eq("user_id", user_id)
          .limit(20)
          .then(r => r.data ?? [])
      : Promise.resolve([]),
  ]);

  type WardrobeItem = {
    category: string;
    color_primary: string | null;
    color_secondary: string | null;
    sub_type: string | null;
    brand: string | null;
    fit: string | null;
    pattern: string | null;
    material: string | null;
    aesthetic_tags: string[] | null;
    formality: string | null;
    image: string | null;
  };

  const wardrobeLines = (existingItems as WardrobeItem[]).map((g, i) => {
    const colorStr = [g.color_primary, g.color_secondary].filter(Boolean).join("/");
    const attrs = [
      g.brand,
      g.sub_type || g.category,
      colorStr && `color: ${colorStr}`,
      g.fit && `fit: ${g.fit}`,
      g.pattern && g.pattern !== "solid" && `pattern: ${g.pattern}`,
      g.material && `material: ${g.material}`,
      g.aesthetic_tags?.length && `aesthetic: ${g.aesthetic_tags.join("/")}`,
      g.formality && `formality: ${g.formality}`,
    ].filter(Boolean).join(" | ");
    return `${i + 1}. ${attrs}`;
  });

  const wardrobeImages = (existingItems as WardrobeItem[])
    .map((g, i) => g.image ? { label: `${i + 1}. ${[g.brand, g.sub_type || g.category].filter(Boolean).join(" ")}`, url: g.image } : null)
    .filter((x): x is { label: string; url: string } => x !== null);

  const wardrobeContext = wardrobeLines.length > 0
    ? `This is the user's COMPLETE wardrobe (${wardrobeLines.length} item${wardrobeLines.length !== 1 ? "s" : ""} total — do not assume any unlisted items exist):\n${wardrobeLines.join("\n")}`
    : null;



  const brandResult = await resolveBrand(brandSearchText, visualMatches, visionResult, discoveredBrands);

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
    ...(subType ? [] : ["sub_type"]),
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
    "style_pairings",
    "tags",
  ];

  const toHex = (rgb: [number, number, number] | null) =>
    rgb ? `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}` : null;

  const inferred = await inferGarmentAttributes(
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
      wardrobeContext,
      wardrobeImages,
    },
    fieldsNeeded
  );

  subType = subType || (inferred.values.sub_type as string | undefined) || null;

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
  } else {
    if (prosVal?.length) analysisUpdate.pros = prosVal;
    if (consVal?.length) analysisUpdate.cons = consVal;
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
        const cleanBlob = await removeBackground(inputBlob, { model: "medium", output: { format: "image/png" } });
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

  return NextResponse.json(
    { ...garment, functional_slot: getFunctionalSlot(garment.sub_type ?? null) },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "No ID provided" }, { status: 400 });

  // Capture owner before deletion (cascade may drop rows before we can query)
  const { data: garmentMeta } = await adminClient
    .from("garments")
    .select("user_id")
    .eq("id", id)
    .single();
  const ownerId = garmentMeta?.user_id as string | undefined;

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
