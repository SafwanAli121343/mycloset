// Internet-verified garment re-analysis.
// For each garment:
//   1. Searches Google Shopping/web for the specific product
//   2. Feeds search results + image to GPT-4o for an authoritative assessment
//   3. Updates DB with corrected fields + regenerated pros/cons/tags
//
// Usage:
//   node scripts/reanalyze-garments.mjs                # items missing tags or with nulls
//   node scripts/reanalyze-garments.mjs --all          # every item (forces pros/cons refresh)
//   node scripts/reanalyze-garments.mjs --id <id>      # single item

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SUPABASE_URL = "https://jhnwystsohdgzuvqnouy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g";
const OPENAI_KEY = "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";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const NAMED_COLORS = [
  "Black","Charcoal","Slate Gray","Gray","Heather Gray","Light Gray","Ash Gray",
  "Off-White","Ivory","Cream","White","Stone","Espresso","Chocolate","Brown",
  "Chestnut","Camel","Tan","Khaki","Sand","Beige","Taupe","Crimson","Red",
  "Brick Red","Maroon","Burgundy","Wine","Rust","Terracotta","Coral","Salmon",
  "Blush","Pink","Hot Pink","Fuchsia","Magenta","Mauve","Purple","Violet",
  "Plum","Eggplant","Lavender","Lilac","Silver","Rose Gold","Platinum","Bronze",
  "Orange","Burnt Orange","Amber","Honey","Wheat","Caramel","Peach","Apricot",
  "Yellow","Mustard","Gold","Butter","Lime","Green","Kelly Green","Emerald",
  "Forest Green","Hunter Green","Olive","Army Green","Sage","Mint","Seafoam",
  "Teal","Turquoise","Sky Blue","Baby Blue","Periwinkle","Blue","Royal Blue",
  "Cobalt","Steel Blue","Denim Blue","Navy",
].join(", ");

const STREETWEAR_CATEGORIES = [
  "hype-streetwear","skate-streetwear","old-money","athletic-prep","gorpcore",
  "workwear-utility","punk-goth","quiet-luxury","maximalist-luxury","normcore",
  "techwear","vintage-90s","preppy-classic","y2k","indie-grunge","high-fashion",
  "mall-core","cottagecore",
];

const args = process.argv.slice(2);
const reanalyzeAll = args.includes("--all");
const singleId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;


async function analyzeItem(g, forceRefreshAll = false) {
  const needsRefresh = forceRefreshAll || !g.tags || !g.color_primary || !g.pros?.length;
  if (!needsRefresh) return null;

  const contextLines = [
    `Title: "${g.title}"`,
    `Category: ${g.category}`,
    g.brand && `Brand: ${g.brand}`,
    g.price && `Price: $${g.price}`,
    g.link && `Product URL: ${g.link}`,
  ].filter(Boolean).join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert fashion analyst for a streetwear/high-fashion wardrobe app targeting Gen Z and millennial consumers who follow Supreme drops, know their Jordan colorways, read Highsnobiety and Hypebeast, and understand the difference between Carhartt WIP and Carhartt Heritage.

CRITICAL ACCURACY RULES:
- Use the internet search results to verify exact product details (colorway name, material composition, official description)
- color_primary: the SINGLE dominant fabric/upper color by largest surface area. For heather fabrics: use Ash Gray or Heather Gray. For plaid: the dominant color in the pattern. For sneakers: the upper/body color.
- color_secondary: ONLY return non-null if there is a DELIBERATE design element in a different color (a logo, graphic, stripe, panel). For solid items: ALWAYS null even if there are shadows.
- material: use official product material if found in search results. Otherwise best estimate.
- fit: use the official fit description if found. Otherwise: regular = standard cut, slim = body-fitted, relaxed = loose but not oversized, oversized = intentionally very large, baggy = very wide throughout.
- pros/cons: must be specific to THIS item, THIS brand's cultural context, and 2025 streetwear standards. Reference actual styling contexts, trend alignment, and cultural weight. Be brutally honest — if something is basic, mid, or played out, say so clearly. Minimum 4 pros, 3 cons. Each is 1-2 sentences.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${contextLines}

Analyze this item using the search results above AND the image below. Return JSON:
{
  "color_primary": "<one from: ${NAMED_COLORS}>",
  "color_secondary": "<one from same list, or null — STRICT: null for solid items or any uncertainty>",
  "brand": "<exact brand from item itself, null if unbranded>",
  "sub_type": "<specific type — T-Shirt, Hoodie, Jeans, Sneakers, Combat Boots, Work Boots, Polo, Ring, etc.>",
  "material": "<primary material — use search results if available: cotton, denim, suede, leather, mesh, fleece, wool, nylon, etc.>",
  "fit": "<slim|regular|relaxed|oversized|baggy|tapered|straight|wide|skinny|boxy|tailored>",
  "pattern": "<solid|striped|plaid|camo|graphic|floral|checkered|houndstooth|tie-dye|other>",
  "formality": "<casual|smart-casual|business|formal>",
  "aesthetic_tags": ["<2-4 most accurate from: streetwear, old-money, minimalist, techwear, workwear, athleisure, vintage, grunge, skate, preppy, quiet-luxury, normcore, gorpcore, punk, goth, maximalist, y2k, 90s, indie-sleaze, business-casual>"],
  "pros": ["<3-8 genuine strengths. For each pro: write the full thought as a detailed sentence internally first (e.g. 'The Timberland 6-inch carries workwear heritage fully adopted by streetwear, making it readable across both worlds'), then compress to a punchy 4-9 word fragment keeping the specific insight (e.g. 'Workwear DNA adopted seamlessly by streetwear'). Return only compressed fragments. RULES: NEVER mention price, cost, or purchasing; generic fragments like 'Very versatile' or 'Looks good' are banned; be specific to THIS item's brand and cultural context.>"],
  "cons": ["<2-6 genuine drawbacks. Same two-step method: full sentence internally, then compress. Use dash for context: 'Clashes with old-money — reads too casual', 'Oversaturated — everyone has one'. NAME SPECIFIC aesthetics where it fails. RULES: Never mention price; never say 'can look dated' without saying WHY ('Reads as mid-2010s streetwear in 2025'). Return [] only if truly no meaningful drawbacks.>"],
  "color_pairings": ["<10+ specific colors/tones that pair well with this item — apply actual color theory, name specific colors>"],
  "color_clashes": ["<4-6 colors that genuinely conflict with this item>"],
  "tags": {
    "color": ["<color descriptors>"],
    "type": ["<type hierarchy>"],
    "aesthetic": ["<all applicable aesthetics>"],
    "brand": ["<brand name, category, origin>"],
    "price": ["<budget/mid-range/premium/luxury, plus range>"],
    "streetwear_category": ["<1-3 from: ${STREETWEAR_CATEGORIES.join(", ")}>"],
    "features": ["<all specific features present on this item>"]
  }
}`,
          },
          { type: "image_url", image_url: { url: g.image, detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1800,
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

async function main() {
  let query = supabase.from("garments").select("*").not("image", "is", null);
  if (singleId) query = query.eq("id", singleId);
  else if (!reanalyzeAll) {
    query = query.or("tags.is.null,color_primary.is.null,pros.is.null,cons.is.null");
  } else {
    query = query.order("created_at", { ascending: false }).limit(50);
  }
  const { data: garments, error } = await query;
  if (error || !garments?.length) { console.error("Fetch failed:", error); process.exit(1); }

  console.log(`Processing ${garments.length} items...\n`);
  let updated = 0, failed = 0;

  for (const g of garments) {
    process.stdout.write(`[${updated + failed + 1}/${garments.length}] ${g.title.slice(0, 55)}... `);

    let result;
    try {
      result = await analyzeItem(g, reanalyzeAll);
    } catch (err) {
      console.log(`✗ ${err.message?.slice(0, 80)}`);
      failed++;
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }

    if (!result) { console.log("skip"); continue; }

    const update = {};

    // Colors: always update to fix remaining issues
    if (result.color_primary) update.color_primary = result.color_primary;
    update.color_secondary = result.color_secondary || null;

    // Fields: update if missing or in --all mode
    if (result.brand && !g.brand) update.brand = result.brand;
    if (result.sub_type && (!g.sub_type || reanalyzeAll)) update.sub_type = result.sub_type;
    if (result.material && (!g.material || reanalyzeAll)) update.material = result.material;
    if (result.fit && (!g.fit || reanalyzeAll)) update.fit = result.fit;
    if (result.pattern && (!g.pattern || reanalyzeAll)) update.pattern = result.pattern;
    if (result.formality && (!g.formality || reanalyzeAll)) update.formality = result.formality;
    if (result.aesthetic_tags?.length && (!g.aesthetic_tags?.length || reanalyzeAll)) {
      update.aesthetic_tags = result.aesthetic_tags;
    }

    // Pros/cons: always regenerate in --all mode, otherwise only if missing
    if (result.pros?.length && (!g.pros?.length || reanalyzeAll)) update.pros = result.pros;
    if (result.cons?.length && (!g.cons?.length || reanalyzeAll)) update.cons = result.cons;
    if (result.color_pairings?.length && (!g.color_pairings?.length || reanalyzeAll)) {
      update.color_pairings = result.color_pairings;
    }
    if (result.color_clashes?.length && (!g.color_clashes?.length || reanalyzeAll)) {
      update.color_clashes = result.color_clashes;
    }

    // Tags: always update
    if (result.tags) update.tags = result.tags;

    if (Object.keys(update).length === 0) { console.log("no changes"); continue; }

    const { error: dbErr } = await supabase.from("garments").update(update).eq("id", g.id);
    if (dbErr) {
      console.log(`✗ DB: ${dbErr.message}`);
      failed++;
    } else {
      console.log(`✓ ${Object.keys(update).join(", ")}`);
      updated++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone. Updated: ${updated}  Failed: ${failed}`);
}

main().catch(console.error);
