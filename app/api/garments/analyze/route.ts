import { secureImageUrl } from "@/lib/secureImageUrl";
import { aiChat } from "@/lib/aiGateway";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { scrapeProductPage } from "@/lib/productLookup";
import type { ScrapedProduct } from "@/lib/productLookup";
import { detectFit, detectMaterial } from "@/lib/garmentMetadata";
import { extractColors } from "@/lib/colorExtraction";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit } from "@/lib/billing/entitlements";
import { applyApiRateLimit } from "@/lib/security/rateLimit";


export const maxDuration = 60;

const ANALYSIS_PROMPT = `Analyze this clothing, footwear, or accessory item and return JSON with these fields:
{
  "title": "<concise product name, brand excluded, e.g. 'Sport Script Tee' not 'Stussy Sport Script Tee'>",
  "brand": "<exact brand name as on label, or null>",
  "category": "<one of: top, bottom, footwear, outerwear, accessory>",
  "color_primary": "<dominant color of the garment/item itself — ignore background, model's other clothing, skin. Single color name like Black, Navy, Cream, Olive, Rust, Slate Blue, etc.>",
  "material": "<primary material in 1-2 words, e.g. cotton, leather, denim, wool, canvas>",
  "fit": "<one of: slim, regular, relaxed, oversized, baggy, tapered, straight, wide, skinny, boxy — or null for accessories>"
}

Focus on the garment itself. If a model is wearing other clothing, ignore those other pieces entirely.`;

const TEXT_ANALYSIS_PROMPT = (title: string, pageContext: string) =>
  `Classify this clothing/footwear/accessory item from its name and description.

Item: "${title}"${pageContext}

Return JSON:
{
  "category": "<one of: top, bottom, footwear, outerwear, accessory>",
  "color_primary": "<dominant color name, e.g. Black, Navy, White, Olive, Cream>",
  "material": "<primary material in 1-2 words, e.g. cotton, leather, denim, wool — or null if unknown>",
  "fit": "<one of: slim, regular, relaxed, oversized, baggy, tapered, straight, wide, skinny, boxy — or null for accessories/footwear>"
}`;

function inferCategoryFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|slide|slides|oxford|oxfords|derby|derbies|mule|mules|slipper|slippers|trainer|trainers|pump|pumps|heel|heels|wedge|wedges|clog|clogs|jordan|dunk|air force|air max|yeezy|sk8|vans|converse|new balance|adidas|reebok|asics|hoka|on cloud|salomon)\b/.test(t)) return "footwear";
  if (/\b(jacket|coat|bomber|blazer|parka|windbreaker|puffer|down coat|overcoat|peacoat|trench|gilet|vest|anorak|raincoat|softshell|fleece jacket|zip.?up)\b/.test(t)) return "outerwear";
  if (/\b(pant|pants|jean|jeans|trouser|trousers|chino|chinos|short|shorts|skirt|skirts|legging|leggings|jogger|joggers|cargo pants|sweatpant|sweatpants|track pant|trackpant)\b/.test(t)) return "bottom";
  if (/\b(hat|cap|beanie|snapback|fitted cap|bucket hat|beret|bag|wallet|watch|ring|necklace|bracelet|chain|sunglasses|glasses|belt|scarf|glove|sock|backpack|tote|pouch|keychain|earring)\b/.test(t)) return "accessory";
  if (/\b(shirt|tee|t-shirt|hoodie|hoody|sweatshirt|sweater|pullover|longsleeve|long.?sleeve|polo|button.?up|button.?down|flannel|knitwear|knit|jersey|tank|crewneck|turtleneck|mock.?neck|henley|rugby|cardigan)\b/.test(t)) return "top";
  return null;
}

export async function POST(req: NextRequest) {
  // OpenAI vision call — require auth and rate-limit to 20/hour per IP
  const rateBlock = applyApiRateLimit(req, "garments:analyze", 20, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Free tier (no Pro subscription, no leftover one-time-purchase credits) never triggers a real
  // OpenAI call here — only whatever can be grabbed without AI: scraped page data, sharp-based
  // pixel color extraction (extractColors — pure pixel analysis, not a model call), and
  // keyword/text heuristics. This mirrors the "non-AI analysis" free tier already gets when the
  // item is actually saved (see garments/route.ts's own comment) — the only OpenAI calls this
  // route ever makes are gated behind actually having AI access, same check /api/preview/compare
  // uses. Doesn't consume a credit here; that happens at actual save time in /api/garments.
  const billingUser = await getUserById(session.userId).catch(() => null);
  const ent = billingUser ? resolveEntitlement(billingUser) : null;
  // A Pro user over their own monthly $ cap falls into the exact same non-AI fallback path free
  // tier already uses below — this is a preview step (saving is the real credit-consuming action,
  // see this file's own comment above), so silently degrading rather than erroring keeps Add Item
  // usable rather than dead-ending someone mid-flow. Real per-call cost for Pro's allowed calls is
  // still capped per call by lib/aiGateway.ts, same as everywhere else.
  // AI auto-fill is a Pro feature (within its monthly cap). A free user's purchased scores are
  // spent only through "Use score?" in My Closet (/api/jobs), never on adding an item.
  const aiAllowed = !!ent?.hasAI && (await consumeAiCredit(billingUser!)).allowed;

  const { imageDataUrl, productUrl } = await req.json();

  if (!imageDataUrl && !productUrl) {
    return NextResponse.json({ error: "imageDataUrl or productUrl required" }, { status: 400 });
  }

  try {
    // ── URL path: scrape with Firecrawl / Jina.ai / direct HTML fetch ───────
    if (productUrl && !imageDataUrl) {
      let scraped: ScrapedProduct = { imageUrl: null, title: null, brand: null, price: null, pageText: null, allImages: [] };
      try {
        scraped = await scrapeProductPage(productUrl);
      } catch { /* proceed with what we have */ }

      // Nothing extracted at all — site blocked scraping entirely
      const gotAnything = scraped.imageUrl || scraped.title || scraped.brand || scraped.pageText;
      if (!gotAnything) {
        return NextResponse.json(
          { error: "We couldn't scrape that URL. The site may be blocking automated access; try adding the item manually or pasting a different link." },
          { status: 422 }
        );
      }

      const result: Record<string, string | null | string[]> = {
        image:           secureImageUrl(scraped.imageUrl ?? null),
        price:           scraped.price ?? null,
        candidateImages: scraped.allImages.map(secureImageUrl),
      };

      // Got text/metadata but no image — not enough to do a full analysis, AI or not
      if (!scraped.imageUrl) {
        return NextResponse.json(
          { error: "We found the page but couldn't extract a product image. Try uploading a photo of the item instead, or paste a direct product image URL." },
          { status: 422 }
        );
      }

      if (!aiAllowed) {
        // Free tier: scraped title/brand are real data (not a guess, nothing to gate), plus
        // whatever the same keyword/text heuristics used as vision's own failure-fallback below
        // can pull from the scraped title/description, plus a real (non-AI) pixel-based color
        // read on the scraped image. No OpenAI call at all.
        result.title = scraped.title ?? null;
        result.brand = scraped.brand ?? null;

        const inferText = `${scraped.title ?? ""} ${scraped.pageText?.slice(0, 200) ?? ""}`;
        const hintCategory = inferCategoryFromText(inferText);
        const hintMaterial = detectMaterial(inferText);
        const hintFit      = detectFit(inferText);
        if (hintCategory) result.category = hintCategory;
        if (hintMaterial) result.material  = hintMaterial;
        if (hintFit)      result.fit        = hintFit;

        const colors = await extractColors(scraped.imageUrl).catch(() => null);
        if (colors?.primary) result.color_primary = colors.primary;

        return NextResponse.json(result);
      }

      // If we got an OG image, visually analyze it with GPT-4o
      try {
        const contextText = scraped.pageText
          ? `Product page text:\n${scraped.pageText.slice(0, 800)}\n\n`
          : "";

        const completion = await aiChat("openai:chat:autofill-link", {
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: scraped.imageUrl, detail: "high" } },
              { type: "text", text: contextText + ANALYSIS_PROMPT },
            ],
          }],
          response_format: { type: "json_object" },
          max_tokens: 300,
        }, billingUser!);
        const ai = JSON.parse(completion.content || "{}");
        // Scraped brand/title take priority over AI guesses
        result.title    = scraped.title ?? ai.title ?? null;
        result.brand    = scraped.brand ?? ai.brand ?? null;
        result.category = ai.category ?? null;
        result.color_primary = ai.color_primary ?? null;
        result.material = ai.material ?? null;
        result.fit      = ai.fit ?? null;
      } catch {
        // Vision failed — fill in as much as we can from scraped text + keyword heuristics,
        // then attempt a cheaper text-only GPT call for remaining fields.
        result.title = scraped.title ?? null;
        result.brand = scraped.brand ?? null;

        const inferText = `${scraped.title ?? ""} ${scraped.pageText?.slice(0, 200) ?? ""}`;
        const hintCategory = inferCategoryFromText(inferText);
        const hintMaterial = detectMaterial(inferText);
        const hintFit      = detectFit(inferText);
        if (hintCategory) result.category = hintCategory;
        if (hintMaterial) result.material  = hintMaterial;
        if (hintFit)      result.fit        = hintFit;

        // Text-only GPT-4o-mini fallback — much cheaper, different rate-limit bucket
        if (scraped.title && (!result.category || !result.color_primary)) {
          try {
            const pageContext = scraped.pageText
              ? `\nDescription: ${scraped.pageText.slice(0, 400)}`
              : "";
            const fb = await aiChat("openai:chat:autofill-text", {
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: TEXT_ANALYSIS_PROMPT(scraped.title, pageContext) }],
              response_format: { type: "json_object" },
              max_tokens: 100,
            }, billingUser!);
            const fbData = JSON.parse(fb.content || "{}");
            if (!result.category      && fbData.category)                      result.category      = fbData.category;
            if (!result.color_primary && fbData.color_primary)                 result.color_primary = fbData.color_primary;
            if (!result.material      && fbData.material && fbData.material !== "null") result.material = fbData.material;
            if (!result.fit           && fbData.fit      && fbData.fit !== "null")      result.fit      = fbData.fit;
          } catch { /* text fallback also failed — return what we have */ }
        }
      }

      return NextResponse.json(result);
    }

    // ── Image upload path ────────────────────────────────────────────────────
    if (!aiAllowed) {
      // Free tier: no vision call — a bare photo with no text/metadata to work from means the
      // only thing derivable without AI is a dominant color via sharp-based pixel analysis.
      // Title/brand/category/material/fit are left for the user to type in — AddItemScreen's
      // manual fields already handle a partially (or fully) empty analysis result.
      const colors = await extractColors(imageDataUrl).catch(() => null);
      return NextResponse.json(colors?.primary ? { color_primary: colors.primary } : {});
    }

    // GPT-4o supports jpeg, png, gif, webp — convert anything else (e.g. AVIF, HEIC) to JPEG
    let gptImageUrl = imageDataUrl as string;
    if (imageDataUrl.startsWith("data:")) {
      const mime = imageDataUrl.match(/^data:([^;]+);/)?.[1] ?? "image/jpeg";
      if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) {
        const buf     = Buffer.from(imageDataUrl.split(",")[1], "base64");
        const jpeg    = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
        gptImageUrl   = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      }
    }

    const completion = await aiChat("openai:chat:autofill-photo", {
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: gptImageUrl, detail: "high" } },
          { type: "text", text: ANALYSIS_PROMPT },
        ],
      }],
      response_format: { type: "json_object" },
      max_tokens: 300,
    }, billingUser!);

    const result = JSON.parse(completion.content || "{}");
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
