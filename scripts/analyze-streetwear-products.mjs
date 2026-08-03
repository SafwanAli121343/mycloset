// Deep analysis + internet verification for streetwear_products table.
// Adds color_secondary, fit, pattern, material, formality, tags, pros, cons
// and upgrades existing coarse fields to our full vocabulary.
//
// Usage:
//   node scripts/analyze-streetwear-products.mjs                  # items missing tags
//   node scripts/analyze-streetwear-products.mjs --all            # force refresh everything
//   node scripts/analyze-streetwear-products.mjs --brand Supreme  # single brand
//   node scripts/analyze-streetwear-products.mjs --limit 200      # cap items processed
//   node scripts/analyze-streetwear-products.mjs --audit          # just report accuracy, no writes

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getItemColorPairings, getItemColorClashes, normalizeColor } from "./color-pairings.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dir, "../.env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("="); if (idx < 0) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch {}

const SUPABASE_URL  = "https://jhnwystsohdgzuvqnouy.supabase.co";
const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g";
const OPENAI_KEY    = process.env.OPENAI_API_KEY || "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";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const args = process.argv.slice(2);
const forceAll   = args.includes("--all");
const auditOnly  = args.includes("--audit");
const brandArg   = args.includes("--brand") ? args[args.indexOf("--brand") + 1] : null;
const limitArg   = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 200;

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
  "Cobalt","Steel Blue","Denim Blue","Navy","Multicolor",
].join(", ");

const STREETWEAR_CATEGORIES = [
  "hype-streetwear","skate-streetwear","old-money","athletic-prep","gorpcore",
  "workwear-utility","punk-goth","quiet-luxury","maximalist-luxury","normcore",
  "techwear","vintage-90s","preppy-classic","y2k","indie-grunge","high-fashion",
  "mall-core","cottagecore",
].join(", ");

async function deepAnalyze(p) {
  const ctx = [
    `Title: "${p.title}"`,
    `Brand: ${p.brand}`,
    `Category: ${p.category}`,
    p.price_text && `Price: ${p.price_text}`,
    p.brand_tier && `Brand tier: ${p.brand_tier}`,
  ].filter(Boolean).join("\n");

  const imageContent = p.image_url
    ? [{ type: "image_url", image_url: { url: p.image_url, detail: "low" } }]
    : [];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert fashion analyst for a high-end streetwear/luxury app. Audience: Gen Z and millennials who follow Supreme drops, wear Rick Owens, know Jordan colorways, read Highsnobiety. Apply 2025 standards. Use your full training knowledge of the brand and product — not just the image.

COLOR RULES:
- color_primary: The SINGLE most dominant fabric color by surface area. Never "Multicolor" unless 3+ colors share truly equal space (tie-dye, mosaic print). Otherwise pick one specific color.
- color_secondary: The second most dominant DELIBERATE color — only store if the secondary color covers ≥20% of the visible product surface as a clear, intentional design block. Counts: color-blocked panels (each ≥20% of surface), broad contrasting stripe spanning the garment, contrasting sleeve/hem/collar band that is clearly a design intent. Does NOT count: soles, laces, tonal stitching, lining, hardware (zippers, buttons, eyelets, snaps, D-rings, cord locks), piping, logos, brand marks, embossed branding, small text, monograms, any element under 20% surface area. DEFAULT TO NULL — if you have any doubt, assign null. For sneakers specifically: upper overlay panels only if they cover ≥20% of the visible upper; never outsoles, never lace colors, never tongue logo.
- tags.colors: Ordered array of ALL colors present as deliberate design elements, from most to least dominant. E.g. ["Black", "White", "Silver"] for a black jacket with white branding and silver hardware.

PATTERN RULES:
- pattern = "graphic" ONLY when a print or embroidered motif IS the primary visual design intent of the item: skull/death-head prints, photo prints, character/cartoon graphics, all-over artistic imagery, large text used as a graphic design element, bold pictorial embroidery as the centerpiece. Standard brand logos, small tonal emblems, embossed wordmarks, and minimal branding do NOT make an item "graphic" — use "solid" for clean designs with standard branding.
- pattern = "striped" when stripes are a MAJOR defining design feature spanning the item: three-stripe sportswear tape running the length of sleeve/side, broad racing stripes across a shoe upper, multi-stripe knit across the fabric. A single tonal stripe piping does NOT qualify.
- pattern = "solid" for items where a single color/fabric dominates with standard branding, hardware, or minimal decoration.
- tags.pattern_detail: 1-sentence description of EXACTLY what the pattern is. "Repeating skull-and-crossbones motif on sleeve tape in white/silver reflective jacquard." or "Tonal tuck-stitched pinstripe woven into fabric." Null only if pattern = solid.

MATERIAL RULES — be PRECISE, use your brand knowledge:
- "nappa lambskin" not "leather". "naplack crinkled patent leather" not "leather". "polyester jersey" not "tech fleece" (fleece = brushed insulating interior). "13.5oz Japanese selvedge denim" not "heavyweight denim". "100% wool with cupro lining" not "wool blend". "polyamide/elastane with sequin embellishment" not "sequin fabric".

FIT RULES:
- Approved values: slim | regular | relaxed | oversized | baggy | tapered | straight | wide | skinny | boxy | n/a
- "tailored" is NOT a valid value — use "slim" for fitted tailored pieces.
- For accessories, shoes, bags, jewelry, fragrances: n/a.

SUB_TYPE — HYPER-SPECIFIC. Never "top", "bottom", "shirt" alone. Use full descriptor:
T-Shirt, Graphic Tee, Long Sleeve Tee, Pullover Hoodie, Zip-Up Hoodie, Crewneck Sweatshirt, Polo, Flannel Shirt, Oxford Shirt, Camp Collar Shirt, Work Shirt, Knitwear, Cardigan, Fleece Jacket, Vest, Coach Jacket, Bomber Jacket, Track Jacket, Leather Jacket, Denim Jacket, Moto Jacket, Blazer, Overcoat, Trench Coat, Puffer Jacket, Asymmetric Top, One-Shoulder Top, Sequin Top, Corset Top, Wrap Top, Negligé Top, Slip Top, Jeans, Straight Leg Jeans, Slim Jeans, Wide Leg Jeans, Bootcut Jeans, Flared Jeans, Trousers, Tailored Trousers, Wide Leg Trousers, Cargo Pants, Track Pants, Sweatpants, Chinos, Shorts, Cargo Shorts, Mini Skirt, Midi Skirt, Mini Dress, Midi Dress, Low-Top Sneakers, High-Top Sneakers, Running Shoes, Trail Runners, Chelsea Boots, Combat Boots, Work Boots, Ankle Boots, Loafers, Mules, Sandals, Slides, Pouch, Mini Shoulder Bag, Shoulder Bag, Crossbody Bag, Tote Bag, Backpack, Wallet, Belt, Watch, Ring, Necklace, Bracelet, Sunglasses, Cap, Snapback, Bucket Hat, Beanie, Socks, etc.

FORMALITY RULES:
- "casual": streetwear, athleisure, loungewear, sneakers, T-shirts, hoodies, denim, overshirts, boots worn casually, cowboy boots, party/going-out pieces that are fashion-forward but not office-appropriate
- "smart-casual": elevated everyday — trousers, tailored shorts, knitwear, cardigans, Oxford shirts, blazers worn casually, leather sneakers at a dinner, silk tops, luxury casual-wear. The DEFAULT for most luxury fashion items (Jil Sander, Valentino, Max Mara, Saint Laurent, Loewe) even when tailored — luxury ≠ business.
- "business": unambiguously office/boardroom context — full suits, formal dress trousers paired with dress shirts, formal blazers in business fabrics (pinstripe, herringbone), business attire that would look out of place outside an office. Do NOT assign "business" to luxury fashion pieces just because they are tailored or expensive.
- "formal": black tie, gala, red carpet — gowns, tuxedos, formalwear only. Extremely rare.
- BIAS CHECK: If you're choosing between "business" and "smart-casual", default to "smart-casual" unless the item is unambiguously workplace-oriented.

FEATURES — this is the most important field. Must be detailed enough for a designer to sketch the item:
- Closure: exact type, hardware finish, position ("full-length silver-tone zipper with branded pull tab")
- Pockets: count, type (jet/welt/patch/cargo), placement, whether zipped ("two zipped jet pockets at hip, one interior welt pocket")
- Logo/branding: technique (embroidered/printed/debossed/woven/jacquard/appliquéd), exact placement, size descriptor, color ("tonal embroidered brand logo at left chest, approx 3cm")
- Collar: exact type ("spread collar", "mock neck", "funnel collar", "mandarin collar", "notch lapel")
- Lining: present or absent, material if known ("fully lined in cupro", "unlined", "mesh lining")
- Hardware: color, material, finish ("silver-tone gunmetal zipper pulls", "antique brass eyelets", "engraved hook clasp")
- Construction: silhouette notes ("dropped shoulders", "raglan sleeves", "set-in sleeves", "gusset at crotch")
- Hem/cuffs: finish type ("ribbed knit cuffs and hem", "raw hem", "elasticated waistband with drawcord")
- Texture/weight: ("heavyweight 13.5oz selvedge", "crinkled naplack metallic finish", "sheer cotton jersey", "brushed fleece interior")
- Unique/signature details: back D-ring, zip-off knee, adjustable drawstring, country of origin if notable, special dye process

AESTHETIC TAGS — assign ALL that genuinely apply (2-5):
streetwear, old-money, minimalist, techwear, workwear, athleisure, vintage, grunge, skate, preppy, quiet-luxury, normcore, gorpcore, punk, goth, maximalist, y2k, 90s, indie-sleaze, business-casual, high-fashion.

CRITICAL "minimalist" RULE: "minimalist" ONLY applies to items with zero decorative elements — no logos, no graphics, no embroidery, no hardware accents, no embellishment, no visible branding, clean simple lines only.
DO NOT use "minimalist" for: any item with a visible logo or graphic, sequins or embellishments, exposed decorative zippers, skull prints, rhinestones, metallic finish, branding tape, colorblocking. These are NOT minimalist — use high-fashion, quiet-luxury, or maximalist instead.
Examples: plain black Rick Owens pod tee = minimalist. Silver sequin Coperni top = maximalist + high-fashion. CDG skull tape track jacket = streetwear + punk + goth. Metallic silver bag = y2k + high-fashion.

PROS/CONS:
- Pros: MINIMUM 8, ideally 10+. SPECIFIC — styling contexts, 2025 trend alignment, cultural references, construction value, layering potential, seasonal utility, subculture unlock, resale value. Each 1-2 sentences.
- Cons: MINIMUM 6. BRUTALLY HONEST — specific care nightmares, exact better alternatives at lower price, specific styling traps, size issues, trend expiry risk, weather limits.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${ctx}

Draw on your full training knowledge of this brand and product model. Return JSON:
{
  "color_primary": "<from: ${NAMED_COLORS}>",
  "color_secondary": "<from same list, or null>",
  "sub_type": "<hyper-specific — see approved list in system prompt>",
  "material": "<precise material — nappa lambskin / polyester jersey / 13.5oz selvedge denim / etc.>",
  "fit": "<slim|regular|relaxed|oversized|baggy|tapered|straight|wide|skinny|boxy|n/a>",
  "pattern": "<solid|striped|plaid|camo|graphic|floral|checkered|houndstooth|tie-dye|other>",
  "formality": "<casual|smart-casual|business|formal>",
  "aesthetic_tags": ["<2-5 from approved list — minimalist ONLY for truly clean undecorated pieces>"],
  "pros": ["<min 8, max unlimited — SPECIFIC, each 1-2 sentences>"],
  "cons": ["<min 6 — BRUTALLY HONEST, each 1-2 sentences>"],
  "tags": {
    "colors": ["<ALL colors ordered by dominance e.g. ['Black','White','Silver']>"],
    "color": ["<descriptors: monochromatic, dark neutral, earth tone, metallic, muted, vibrant, tonal>"],
    "type": ["<full hierarchy e.g. clothing→tops→track jacket>"],
    "aesthetic": ["<all applicable aesthetics>"],
    "brand": ["<brand name, country of origin, tier, aesthetic identity, notable collabs>"],
    "price": ["<tier + approximate range>"],
    "streetwear_category": ["<1-3 from: ${STREETWEAR_CATEGORIES}>"],
    "pattern_detail": "<1-sentence specific description of the pattern — what it looks like, where it sits, what color. Null if solid.>",
    "features": ["<EXHAUSTIVE list — closure+hardware, all pockets with type and placement, logo technique+position, collar type, lining, construction method, hem/cuff finish, texture, weight, signature details, country of origin if notable>"]
  }
}`,
          },
          ...imageContent,
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2500,
  });
  return JSON.parse(res.choices[0].message.content || "{}");
}

async function main() {
  let query = sb.from("streetwear_products").select("*").not("image_url", "is", null);

  if (brandArg) {
    // Use exact match (eq) for speed — avoids full table ILIKE scan
    query = query.eq("brand", brandArg);
    // Only fetch unanalyzed items when targeting a specific brand
    if (!forceAll) query = query.eq("analyzed", false);
  } else if (forceAll) {
    query = query.eq("analyzed", true);
  } else {
    // General pass: only unanalyzed items, no ORDER BY (avoid expensive sort on full table)
    query = query.eq("analyzed", false);
  }

  query = query.limit(limitArg);
  const { data: products, error } = await query;
  if (error || !products?.length) {
    console.error("Fetch error:", error?.message || "No items found");
    process.exit(1);
  }

  // Filter out non-wearables — fragrances, skate decks, and other items that don't
  // have color/fit/pattern metadata. These need separate treatment or are out of scope.
  const FRAGRANCE_KEYWORDS = /\b(eau de parfum|eau de toilette|cologne|parfum|fragrance|perfume|body spray|edp|edt)\b/i;
  const DECK_KEYWORDS      = /\b(deck|skateboard|fingerboard|snowboard)\b/i;
  const wearableProducts   = products.filter(p =>
    !FRAGRANCE_KEYWORDS.test(p.title) &&
    !FRAGRANCE_KEYWORDS.test(p.category || "") &&
    !DECK_KEYWORDS.test(p.title) &&
    !DECK_KEYWORDS.test(p.category || "")
  );

  if (wearableProducts.length < products.length) {
    console.log(`Skipped ${products.length - wearableProducts.length} fragrance item(s) — not applicable for color/fit/pattern analysis.`);
  }

  console.log(`Processing ${wearableProducts.length} items (limit: ${limitArg})...\n`);
  let updated = 0, failed = 0, skipped = 0;
  const auditResults = [];

  for (const p of wearableProducts) {
    const label = `[${updated + failed + skipped + 1}/${wearableProducts.length}] ${p.brand} — ${p.title.slice(0, 40)}`;
    process.stdout.write(`${label}... `);

    let result;
    let retries = 0;
    while (retries < 4) {
      try {
        result = await deepAnalyze(p);
        break;
      } catch (err) {
        const msg = err.message || "";
        if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
          retries++;
          const wait = retries * 30000; // 30s, 60s, 90s, 120s
          process.stdout.write(`\n  rate limited — waiting ${wait/1000}s (attempt ${retries}/4)...\n`);
          await new Promise(r => setTimeout(r, wait));
          process.stdout.write(`${label}... `);
        } else {
          console.log(`✗ ${msg.slice(0, 80)}`);
          failed++;
          await new Promise(r => setTimeout(r, 1500));
          break;
        }
      }
    }
    if (!result) continue;

    if (auditOnly) {
      auditResults.push({ p, result });
      console.log(`color=${result.color_primary}/${result.color_secondary} sub=${result.sub_type} fit=${result.fit} aesthetic=${result.aesthetic_tags?.join(",")}`);
      await new Promise(r => setTimeout(r, 300));
      continue;
    }

    // Build update using only columns that exist in the current schema.
    // New columns (color_secondary, fit, pattern, material, formality, tags, pros, cons)
    // require the upgrade_streetwear_products.sql migration to have been run first.
    const baseUpdate = {
      color_primary: result.color_primary || p.color_primary,
      sub_type:      result.sub_type || p.sub_type,
      analyzed:      true,
    };
    if (result.aesthetic_tags?.length) baseUpdate.aesthetic_tags = result.aesthetic_tags;

    // Compute color_pairings and color_clashes deterministically from fashion color wheel
    // (replaces GPT-generated values — eliminates hallucination and repetition)
    const itemColors = result.tags?.colors?.length
      ? result.tags.colors
      : [result.color_primary, result.color_secondary].filter(Boolean);
    const computedPairings = getItemColorPairings(itemColors);
    const computedClashes  = getItemColorClashes(itemColors);

    // Build full update; gracefully fall back if any column missing
    const fullUpdate = {
      ...baseUpdate,
      color_secondary: result.color_secondary || null,
      material:        result.material,
      fit:             result.fit,
      pattern:         result.pattern,
      formality:       result.formality,
      tags:            result.tags || null,
    };
    if (result.pros?.length)         fullUpdate.pros           = result.pros;
    if (result.cons?.length)         fullUpdate.cons           = result.cons;
    if (computedPairings.length)     fullUpdate.color_pairings = computedPairings;
    if (computedClashes.length)      fullUpdate.color_clashes  = computedClashes;

    let { error: dbErr } = await sb.from("streetwear_products").update(fullUpdate).eq("id", p.id);
    if (dbErr && (dbErr.message?.includes("does not exist") || dbErr.message?.includes("Could not find"))) {
      // color_pairings / color_clashes columns may not exist yet — retry without them
      const { color_pairings: _cp, color_clashes: _cc, ...withoutColorColumns } = fullUpdate;
      const fb = await sb.from("streetwear_products").update(withoutColorColumns).eq("id", p.id);
      dbErr = fb.error;
      if (!dbErr) process.stdout.write("(no color cols) ");
    }
    if (dbErr && (dbErr.message?.includes("does not exist") || dbErr.message?.includes("Could not find"))) {
      // Still failing — fall back to base columns only
      const fb2 = await sb.from("streetwear_products").update(baseUpdate).eq("id", p.id);
      dbErr = fb2.error;
      if (!dbErr) process.stdout.write("(base only) ");
    }
    if (dbErr) {
      console.log(`✗ DB: ${dbErr.message?.slice(0, 100)}`);
      failed++;
    } else {
      console.log(`✓`);
      updated++;
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  if (auditOnly) {
    console.log("\n═══ AUDIT SUMMARY ═══");
    const sampleSize = auditResults.length;
    const colorMatch = auditResults.filter(x => x.p.color_primary?.toLowerCase() === x.result.color_primary?.toLowerCase()).length;
    const subMatch   = auditResults.filter(x => x.p.sub_type?.toLowerCase() === x.result.sub_type?.toLowerCase()).length;
    console.log(`color_primary match: ${colorMatch}/${sampleSize} (${Math.round(100*colorMatch/sampleSize)}%)`);
    console.log(`sub_type match:      ${subMatch}/${sampleSize} (${Math.round(100*subMatch/sampleSize)}%)`);
    console.log("(Note: mismatches may mean our stored data was wrong, not GPT)");
  } else {
    console.log(`\nDone. Updated: ${updated}  Failed: ${failed}  Skipped: ${skipped}`);
  }
}

main().catch(console.error);
