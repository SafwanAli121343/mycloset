import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import sharp from "sharp";
import { scrapeProductPage } from "@/lib/productLookup";
import type { ScrapedProduct } from "@/lib/productLookup";
import { detectFit, detectMaterial } from "@/lib/garmentMetadata";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
          { error: "We couldn't scrape that URL — the site may be blocking automated access. Try adding the item manually or pasting a different link." },
          { status: 422 }
        );
      }

      const result: Record<string, string | null | string[]> = {
        image:           scraped.imageUrl ?? null,
        price:           scraped.price ?? null,
        candidateImages: scraped.allImages,
      };

      // If we got an OG image, visually analyze it with GPT-4o
      if (scraped.imageUrl) {
        try {
          const contextText = scraped.pageText
            ? `Product page text:\n${scraped.pageText.slice(0, 800)}\n\n`
            : "";

          const completion = await openai.chat.completions.create({
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
          });
          const ai = JSON.parse(completion.choices[0].message.content || "{}");
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
              const fb = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: TEXT_ANALYSIS_PROMPT(scraped.title, pageContext) }],
                response_format: { type: "json_object" },
                max_tokens: 100,
              });
              const fbData = JSON.parse(fb.choices[0].message.content || "{}");
              if (!result.category      && fbData.category)                      result.category      = fbData.category;
              if (!result.color_primary && fbData.color_primary)                 result.color_primary = fbData.color_primary;
              if (!result.material      && fbData.material && fbData.material !== "null") result.material = fbData.material;
              if (!result.fit           && fbData.fit      && fbData.fit !== "null")      result.fit      = fbData.fit;
            } catch { /* text fallback also failed — return what we have */ }
          }
        }
      } else {
        // Got text/metadata but no image — not enough to do a full analysis
        return NextResponse.json(
          { error: "We found the page but couldn't extract a product image. Try uploading a photo of the item instead, or paste a direct product image URL." },
          { status: 422 }
        );
      }

      return NextResponse.json(result);
    }

    // ── Image upload path ────────────────────────────────────────────────────
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

    const completion = await openai.chat.completions.create({
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
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
