/**
 * reanalyze-stripped.mjs
 *
 * Re-analyzes old-prompt items (formality IS NULL) with a stripped prompt:
 * keeps all useful fields (colors, features, pattern_detail, material, fit,
 * formality, aesthetic_tags, etc.) but removes pros/cons to cut cost ~50%.
 *
 * Runs in priority order so all aesthetics get coverage even if stopped early.
 * After first 20 items, prints a verification block before continuing.
 * Tracks cumulative spend and stops when --budget is reached.
 *
 * Usage:
 *   node scripts/reanalyze-stripped.mjs                    # run all priority brands
 *   node scripts/reanalyze-stripped.mjs --budget 100       # stop after $100 spent
 *   node scripts/reanalyze-stripped.mjs --brand "Nike"     # single brand only
 *   node scripts/reanalyze-stripped.mjs --dry-run          # print plan, no API calls
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getItemColorPairings, getItemColorClashes } from "./color-pairings.mjs";

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

const SUPABASE_URL = "https://jhnwystsohdgzuvqnouy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g";
const OPENAI_KEY  = process.env.OPENAI_API_KEY || "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";

const sb     = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes("--dry-run");
const BRAND_ONLY = args.includes("--brand") ? args[args.indexOf("--brand") + 1] : null;
const BUDGET     = args.includes("--budget") ? parseFloat(args[args.indexOf("--budget") + 1]) : Infinity;
// Items processed per brand per pass. Script does multiple full rounds so
// every aesthetic gets coverage before any single brand is exhausted.
const PER_BRAND_PER_PASS = 60;

// GPT-4o token pricing
const INPUT_CPT  = 2.50  / 1_000_000;
const OUTPUT_CPT = 10.00 / 1_000_000;
let totalIn = 0, totalOut = 0, totalUpdated = 0, totalFailed = 0;
let firstApiError = null;
const spend = () => totalIn * INPUT_CPT + totalOut * OUTPUT_CPT;
const spendStr = () => `$${spend().toFixed(3)}`;

// ── Priority brand list ────────────────────────────────────────────────────────
// Interleaved so ALL aesthetics get coverage in the first pass even if we stop early.
// Ordering: pick 1-2 flagships per aesthetic first, then depth fills.
const PRIORITY_BRANDS = [
  // ─ Round 1: one flagship per aesthetic ──────────────────────────────────────
  // Streetwear
  "Supreme", "Stüssy",
  // High fashion / avant-garde
  "Rick Owens", "Balenciaga", "Maison Margiela",
  // Luxury maisons
  "Prada", "Gucci", "Saint Laurent", "Loewe",
  // Athletic / running
  "Nike", "Adidas", "New Balance",
  // Gorpcore / outdoor
  "The North Face", "Salomon",
  // Old money / prep
  "Polo Ralph Lauren", "Aimé Leon Dore",
  // Quiet luxury / minimalist
  "The Row", "Lemaire", "Jil Sander",
  // Japanese streetwear
  "KAPITAL", "Undercover", "visvim",
  // Contemporary / modern basics
  "Acne Studios", "Our Legacy", "A.P.C.",
  // Workwear / heritage
  "Carhartt WIP", "Filson", "Dickies",
  // Skate
  "Vans", "Palace",
  // Denim
  "Levi's", "Nudie Jeans", "Ksubi", "Purple Brand",
  // Modern/baggy denim (gap-fill brands)
  "DISCONTD", "BAGGY", "Berlinc",
  // Hype / luxury streetwear
  "BAPE", "Off-White", "Fear of God",
  // Vintage / art
  "Gallery Dept.", "Needles",
  // ─ Round 2: depth per aesthetic ─────────────────────────────────────────────
  // Streetwear
  "Brain Dead", "Human Made", "Neighborhood", "WTAPS", "Cav Empt",
  "Pleasures", "Corteiz", "Dime", "HUF", "Butter Goods",
  "Anti Social Social Club", "Market", "KidSuper", "By Parra",
  "Museum of Peace & Quiet", "Cherry LA", "STAMPD", "MNML",
  "Daily Paper", "Honor the Gift", "One of These Days",
  // High fashion / avant-garde
  "Craig Green", "Martine Rose", "1017 ALYX 9SM", "Julius",
  "Comme des Garçons", "Junya Watanabe", "Yohji Yamamoto",
  "Issey Miyake", "Boris Bidjan Saberi", "Dries Van Noten", "Marni",
  "JW Anderson", "Thom Browne", "Vetements", "Maison Mihara Yasuhiro",
  "A-COLD-WALL*", "Ambush", "Stefan Cooke", "Jordan Luca",
  "Bianca Saunders", "Eckhaus Latta", "Random Identities",
  "Adidem Asterisks", "Perks and Mini", "Martine Ali", "Róhe",
  // Luxury maisons
  "Valentino", "Givenchy", "Bottega Veneta", "Celine", "Fendi",
  "Dior", "Louis Vuitton", "Alexander McQueen", "Miu Miu",
  "Versace", "Burberry", "Tom Ford", "Armani", "Ferragamo",
  "Brunello Cucinelli", "Loro Piana", "Dolce & Gabbana",
  // Athletic / running
  "ASICS", "Puma", "Reebok", "Converse", "Jordan",
  "Satisfy Running", "District Vision", "Tracksmith", "Hoka",
  "Champion", "New Era",
  // Gorpcore / outdoor / techwear
  "Cotopaxi", "Snow Peak", "Gramicci", "Post Archive Faction",
  "White Mountaineering", "GR10K", "AFFXWRKS", "Vollebak",
  "Arc'teryx", "Patagonia", "Nanamica", "Goldwin", "Maharishi",
  "Ienki Ienki", "HYKE", "ROA", "Suicoke",
  // Old money / prep / British
  "Rowing Blazers", "Noah NYC", "Drake's", "Lacoste", "Barbour",
  "Margaret Howell", "Monitaly", "Sunspel", "Oliver Spencer",
  // Contemporary
  "Studio Nicholson", "Universal Works", "Folk", "Officine Générale",
  "Wax London", "Albam", "Soulland", "Eytys", "Filling Pieces",
  "John Elliott", "Reigning Champ", "Norse Projects", "REPRESENT",
  "Corridor NYC", "Evan Kinori", "Story MFG.", "AFFXWRKS",
  // Japanese
  "Wacko Maria", "sacai", "TAAKK", "Auralee", "Etudes",
  "Edwin", "Samurai Jeans", "Naked & Famous", "Evisu",
  "Human Made", "Iron Heart",
  // Workwear
  "Alpha Industries", "Stan Ray", "Engineered Garments",
  // Denim
  "Ksubi", "Purple Brand",
  // Luxury streetwear
  "Rhude", "AMIRI", "Heron Preston", "Palm Angels",
  "Nahmias", "Casablanca", "Moncler",
  // Skate
  "Ripndip", "Bianca Chandon", "The Quiet Life", "Obey",
  "Denim Tears", "Awake NY", "Carrots",
  // Vintage / art
  "Bode", "Aries", "Wacko Maria",
  // Women's / contemporary luxury
  "Jacquemus", "Toteme", "Khaite", "Nanushka", "Isabel Marant",
  "Staud", "Coperni", "Baserange", "Paloma Wool", "St. Agni",
  "Tibi", "Cecilie Bahnsen", "Roksanda", "Erdem", "HYEIN SEO",
  "Sies Marjan", "Chopova Lowena", "Sporty & Rich", "Rouje",
  "Telfar",
  // Hype
  "ICECREAM", "Billionaire Boys Club", "PATTA", "thisisneverthat",
  // Misc
  "Madhappy", "Saturdays NYC", "By Parra",
];

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

// ── Stripped system prompt (no pros/cons) ─────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert fashion analyst for a high-end streetwear/luxury app. Audience: Gen Z and millennials who follow Supreme drops, wear Rick Owens, know Jordan colorways, read Highsnobiety. Apply 2025 standards. Use your full training knowledge of the brand and product — not just the image.

COLOR RULES:
- color_primary: The SINGLE most dominant fabric color by surface area. Never "Multicolor" unless 3+ colors share truly equal space (tie-dye, mosaic print). Otherwise pick one specific color.
- color_secondary: The second most dominant DELIBERATE color — only store if the secondary color covers ≥20% of the visible product surface as a clear, intentional design block. Counts: color-blocked panels (each ≥20% of surface), broad contrasting stripe spanning the garment, contrasting sleeve/hem/collar band that is clearly a design intent. Does NOT count: soles, laces, tonal stitching, lining, hardware (zippers, buttons, eyelets, snaps, D-rings, cord locks), piping, logos, brand marks, embossed branding, small text, monograms, any element under 20% surface area. DEFAULT TO NULL — if you have any doubt, assign null. For sneakers specifically: upper overlay panels only if they cover ≥20% of the visible upper; never outsoles, never lace colors, never tongue logo.
- tags.colors: Ordered array of ALL colors present as deliberate design elements, from most to least dominant. E.g. ["Black", "White", "Silver"] for a black jacket with white branding and silver hardware.

PATTERN RULES:
- pattern = "graphic" ONLY when a print or embroidered motif IS the primary visual design intent of the item: skull/death-head prints, photo prints, character/cartoon graphics, all-over artistic imagery, large text used as a graphic design element, bold pictorial embroidery as the centerpiece. Standard brand logos, small tonal emblems, embossed wordmarks, and minimal branding do NOT make an item "graphic" — use "solid" for clean designs with standard branding.
- pattern = "striped" when stripes are a MAJOR defining design feature spanning the item: three-stripe sportswear tape running the length of sleeve/side, broad racing stripes across a shoe upper, multi-stripe knit across the fabric. A single tonal stripe piping does NOT qualify.
- pattern = "solid" for items where a single color/fabric dominates with standard branding, hardware, or minimal decoration.
- tags.pattern_detail: 1-sentence description of EXACTLY what the pattern is. Null only if pattern = solid.

MATERIAL RULES — be PRECISE, use your brand knowledge:
- "nappa lambskin" not "leather". "polyester jersey" not "tech fleece". "13.5oz Japanese selvedge denim" not "heavyweight denim". "100% wool with cupro lining" not "wool blend". Be specific about weight, weave, finish, and blend where known.

FIT RULES:
- Approved values: slim | regular | relaxed | oversized | baggy | tapered | straight | wide | skinny | boxy | n/a
- "tailored" is NOT a valid value — use "slim" for fitted tailored pieces.
- For accessories, shoes, bags, jewelry: n/a.

SUB_TYPE — HYPER-SPECIFIC. Never "top", "bottom", "shirt" alone:
T-Shirt, Graphic Tee, Long Sleeve Tee, Pullover Hoodie, Zip-Up Hoodie, Crewneck Sweatshirt, Polo, Flannel Shirt, Oxford Shirt, Camp Collar Shirt, Work Shirt, Knitwear, Cardigan, Fleece Jacket, Vest, Coach Jacket, Bomber Jacket, Track Jacket, Leather Jacket, Denim Jacket, Moto Jacket, Blazer, Overcoat, Trench Coat, Puffer Jacket, Asymmetric Top, One-Shoulder Top, Sequin Top, Corset Top, Wrap Top, Negligé Top, Slip Top, Jeans, Straight Leg Jeans, Slim Jeans, Wide Leg Jeans, Bootcut Jeans, Flared Jeans, Trousers, Tailored Trousers, Wide Leg Trousers, Cargo Pants, Track Pants, Sweatpants, Chinos, Shorts, Cargo Shorts, Mini Skirt, Midi Skirt, Mini Dress, Midi Dress, Low-Top Sneakers, High-Top Sneakers, Running Shoes, Trail Runners, Chelsea Boots, Combat Boots, Work Boots, Ankle Boots, Loafers, Mules, Sandals, Slides, Pouch, Mini Shoulder Bag, Shoulder Bag, Crossbody Bag, Tote Bag, Backpack, Wallet, Belt, Watch, Ring, Necklace, Bracelet, Sunglasses, Cap, Snapback, Bucket Hat, Beanie, Socks.

FORMALITY RULES:
- "casual": streetwear, athleisure, loungewear, sneakers, T-shirts, hoodies, denim, overshirts, boots worn casually
- "smart-casual": elevated everyday — trousers, tailored shorts, knitwear, cardigans, Oxford shirts, blazers worn casually, silk tops, luxury casualwear. DEFAULT for most luxury fashion items (Jil Sander, Valentino, Max Mara, Saint Laurent, Loewe) even when tailored — luxury ≠ business.
- "business": unambiguously office/boardroom — full suits, formal dress trousers with dress shirts, pinstripe/herringbone business fabrics. Do NOT assign "business" to luxury fashion pieces just because they are tailored.
- "formal": black tie, gala, red carpet only. Extremely rare.
- BIAS CHECK: Between "business" and "smart-casual", default to "smart-casual" unless unambiguously workplace-oriented.

FEATURES — must be detailed enough for a designer to sketch the item:
- Closure: exact type + hardware finish + position ("full-length silver-tone zipper with branded pull tab")
- Pockets: count, type (jet/welt/patch/cargo), placement, whether zipped
- Logo/branding: technique (embroidered/printed/debossed/woven/appliquéd), exact placement, size, color
- Collar: exact type ("spread collar", "mock neck", "funnel collar", "mandarin collar")
- Lining: present or absent, material if known ("fully lined in cupro", "unlined", "mesh lining")
- Hardware: color, material, finish ("silver-tone gunmetal zipper pulls", "antique brass eyelets")
- Construction: silhouette notes ("dropped shoulders", "raglan sleeves", "set-in sleeves")
- Hem/cuffs: finish type ("ribbed knit cuffs and hem", "raw hem", "elasticated waistband with drawcord")
- Texture/weight: ("heavyweight 13.5oz selvedge", "crinkle nylon shell", "brushed fleece interior")
- Unique/signature details: back D-ring, zip-off knee, adjustable drawstring, country of origin if notable

AESTHETIC TAGS — assign ALL that genuinely apply (2-5):
streetwear, old-money, minimalist, techwear, workwear, athleisure, vintage, grunge, skate, preppy, quiet-luxury, normcore, gorpcore, punk, goth, maximalist, y2k, 90s, indie-sleaze, business-casual, high-fashion.

CRITICAL "minimalist" RULE: ONLY for items with zero decorative elements — no logos, no graphics, no embroidery, no hardware accents, no visible branding, clean simple lines only.`;

// ── Stripped output template ───────────────────────────────────────────────────
const outputTemplate = (namedColors, streetwearCategories) => `Draw on your full training knowledge of this brand and product. Return JSON (no pros, no cons):
{
  "color_primary": "<from: ${namedColors}>",
  "color_secondary": "<from same list, or null>",
  "sub_type": "<hyper-specific>",
  "material": "<precise — nappa lambskin / polyester jersey / 13.5oz selvedge denim / etc.>",
  "fit": "<slim|regular|relaxed|oversized|baggy|tapered|straight|wide|skinny|boxy|n/a>",
  "pattern": "<solid|striped|plaid|camo|graphic|floral|checkered|houndstooth|tie-dye|other>",
  "formality": "<casual|smart-casual|business|formal>",
  "aesthetic_tags": ["<2-5 from approved list>"],
  "tags": {
    "colors": ["<ALL colors ordered by dominance>"],
    "color": ["<descriptors: monochromatic, dark neutral, earth tone, metallic, muted, vibrant, tonal>"],
    "type": ["<hierarchy e.g. clothing→tops→hoodie>"],
    "aesthetic": ["<all applicable aesthetics>"],
    "brand": ["<brand name, country of origin, tier, aesthetic identity>"],
    "price": ["<tier + approximate range>"],
    "streetwear_category": ["<1-3 from: ${streetwearCategories}>"],
    "pattern_detail": "<1-sentence specific description. Null if solid.>",
    "features": ["<EXHAUSTIVE list — closure+hardware, pockets, logo technique+position, collar, lining, construction, hem/cuffs, texture/weight, signature details>"]
  }
}`;

// ── Per-item analysis ─────────────────────────────────────────────────────────
async function analyze(p) {
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
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `${ctx}\n\n${outputTemplate(NAMED_COLORS, STREETWEAR_CATEGORIES)}` },
          ...imageContent,
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1500,
  });

  // Track tokens
  totalIn  += res.usage?.prompt_tokens     || 0;
  totalOut += res.usage?.completion_tokens || 0;

  return JSON.parse(res.usage ? res.choices[0].message.content || "{}" : "{}");
}

// ── Write result back to DB ───────────────────────────────────────────────────
async function writeResult(p, result) {
  const itemColors = result.tags?.colors?.length
    ? result.tags.colors
    : [result.color_primary, result.color_secondary].filter(Boolean);

  const update = {
    color_primary:   result.color_primary  || p.color_primary,
    color_secondary: result.color_secondary || null,
    sub_type:        result.sub_type        || p.sub_type,
    material:        result.material        || null,
    fit:             result.fit             || null,
    pattern:         result.pattern         || null,
    formality:       result.formality       || null,
    tags:            result.tags            || null,
    analyzed:        true,
  };
  if (result.aesthetic_tags?.length) update.aesthetic_tags = result.aesthetic_tags;
  const pairings = getItemColorPairings(itemColors);
  const clashes  = getItemColorClashes(itemColors);
  if (pairings.length) update.color_pairings = pairings;
  if (clashes.length)  update.color_clashes  = clashes;

  const { error } = await sb.from("streetwear_products").update(update).eq("id", p.id);
  return error;
}

// ── Verification block: print detailed sample after first N items ─────────────
async function runVerification(sampleIds) {
  console.log("\n" + "═".repeat(70));
  console.log("VERIFICATION SAMPLE — first 20 items processed");
  console.log("═".repeat(70));

  const { data } = await sb.from("streetwear_products")
    .select("brand,title,color_primary,color_secondary,material,fit,pattern,formality,aesthetic_tags,color_pairings,tags")
    .in("id", sampleIds.slice(0, 5));

  if (!data?.length) { console.log("(no data returned)"); return; }

  let populated = { color_primary:0, material:0, fit:0, pattern:0, formality:0, aesthetic_tags:0, tags_features:0, tags_colors:0, tags_pattern_detail:0 };
  const n = sampleIds.length;

  // Check all 20 for stats
  const { data: all20 } = await sb.from("streetwear_products")
    .select("color_primary,material,fit,pattern,formality,aesthetic_tags,tags")
    .in("id", sampleIds);
  for (const r of all20 || []) {
    if (r.color_primary)            populated.color_primary++;
    if (r.material)                 populated.material++;
    if (r.fit && r.fit !== "n/a")   populated.fit++;
    if (r.pattern)                  populated.pattern++;
    if (r.formality)                populated.formality++;
    if (r.aesthetic_tags?.length)   populated.aesthetic_tags++;
    if (r.tags?.features?.length)   populated.tags_features++;
    if (r.tags?.colors?.length)     populated.tags_colors++;
    if (r.tags?.pattern_detail)     populated.tags_pattern_detail++;
  }

  console.log(`\nField population across ${n} items:`);
  for (const [k, v] of Object.entries(populated)) {
    const pct = Math.round(v / n * 100);
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    console.log(`  ${k.padEnd(22)} ${bar} ${pct}%`);
  }

  console.log("\nDetailed samples:");
  for (const p of data.slice(0, 3)) {
    console.log(`\n  ── ${p.brand} — ${p.title?.slice(0, 50)} ──`);
    console.log(`     color:    ${p.color_primary}${p.color_secondary ? " / " + p.color_secondary : ""}`);
    console.log(`     material: ${p.material}`);
    console.log(`     fit:      ${p.fit} | pattern: ${p.pattern} | formality: ${p.formality}`);
    console.log(`     aesthetic_tags: ${JSON.stringify(p.aesthetic_tags)}`);
    console.log(`     tags.colors:    ${JSON.stringify(p.tags?.colors)}`);
    console.log(`     tags.pattern_detail: ${p.tags?.pattern_detail || "null"}`);
    console.log(`     tags.features (first 3):`);
    (p.tags?.features || []).slice(0, 3).forEach(f => console.log(`       • ${f}`));
  }
  console.log("\n" + "═".repeat(70));
  console.log("Continuing analysis...\n");
}

// ── Gap-category priority ─────────────────────────────────────────────────────
// Fetched first for every brand to fill underrepresented garment categories:
// jeans, knitwear/sweaters, bombers, sweatshirts, polos, long-sleeve tees, boots.
const GAP_SUBTYPES_OR = [
  "sub_type.ilike.%jean%",
  "sub_type.ilike.%sweater%", "sub_type.ilike.%knitwear%",
  "sub_type.ilike.%cardigan%", "sub_type.ilike.%jumper%",
  "sub_type.ilike.%bomber%",
  "sub_type.ilike.%sweatshirt%",
  "sub_type.ilike.%polo%",
  "sub_type.ilike.%long sleeve tee%", "sub_type.ilike.%long sleeve t-%",
  "sub_type.ilike.%boot%",
].join(",");

// ── Item-type priority ────────────────────────────────────────────────────────
// After gap items, remaining slots fill by category tier.
const CATEGORY_TIERS = [
  ["top", "bottom", "outerwear"],
  ["footwear"],
  ["accessory"],
];
const SKIP_SUBTYPES = new Set([
  // accessories with no outfit information
  "sunglasses", "optical glasses", "earring", "necklace", "bracelet",
  "ring", "pin", "wristband", "snood", "headband", "bandana", "lanyard",
  "hair clip", "hair accessory",
  // bags / wallets / carriers
  "bag", "shoulder bag", "handbag", "wallet", "coin purse", "tote bag",
  "backpack", "crossbody bag", "duffle bag", "belt bag", "messenger bag",
  "card holder", "cardholder", "pouch", "keychain", "passport holder",
  // footwear accessories
  "socks", "sock", "ankle sock",
  // body / grooming
  "fragrance", "candle", "skincare", "toothpaste", "mouthwash", "perfume",
  // hard goods / home / objects
  "bearbrick", "skateboard", "skateboard deck", "snowboard", "snowboard deck",
  "fingerboard", "deck", "scarf", "belt", "book", "notebook", "magazine",
  "vase", "chair", "mug", "cup", "dish", "ashtray", "dice set", "ice cube tray",
  "grinder", "tray", "planter set", "shovel", "water bottle", "bottle",
  "door mat", "rug", "blanket", "towel", "pillow", "pillow case", "cushion",
  "table", "umbrella", "lighter", "pen", "pencil pack", "flag", "slip mat",
  "apron", "gift card", "gift", "tape measure", "turntable", "phone case",
  "smartphone case", "dog leash", "leash", "pet leash", "harness",
]);

// ── Fetch unanalyzed items for a brand ───────────────────────────────────────
// Pass 1: gap-priority sub_types (jeans, knitwear, bombers, etc.) fill first.
// Pass 2: remaining slots filled with core clothing by category tier.
async function fetchBrand(brand, limit = PER_BRAND_PER_PASS) {
  const result = [];
  const seen = new Set();

  // Pass 1 — gap categories first
  const { data: gapData } = await sb.from("streetwear_products")
    .select("id,brand,title,category,price_text,brand_tier,image_url,color_primary,sub_type,aesthetic_tags")
    .eq("brand", brand)
    .eq("analyzed", true)
    .is("formality", null)
    .not("image_url", "is", null)
    .in("category", ["top", "bottom", "outerwear", "footwear"])
    .or(GAP_SUBTYPES_OR)
    .limit(limit);
  for (const p of (gapData || [])) {
    if (!SKIP_SUBTYPES.has((p.sub_type || "").toLowerCase())) {
      result.push(p); seen.add(p.id);
    }
  }

  // Pass 2 — fill remaining slots by category tier, skipping already-fetched IDs
  for (const cats of CATEGORY_TIERS) {
    if (result.length >= limit) break;
    const { data } = await sb.from("streetwear_products")
      .select("id,brand,title,category,price_text,brand_tier,image_url,color_primary,sub_type,aesthetic_tags")
      .eq("brand", brand)
      .eq("analyzed", true)
      .is("formality", null)
      .not("image_url", "is", null)
      .in("category", cats)
      .limit(limit - result.length + seen.size);
    for (const p of (data || [])) {
      if (result.length >= limit) break;
      if (!seen.has(p.id) && !SKIP_SUBTYPES.has((p.sub_type || "").toLowerCase())) {
        result.push(p); seen.add(p.id);
      }
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const FRAGRANCE_RE = /\b(eau de parfum|eau de toilette|cologne|parfum|fragrance|perfume|body spray|edp|edt)\b/i;
  const DECK_RE      = /\b(deck|skateboard|fingerboard|snowboard)\b/i;

  if (DRY_RUN) {
    console.log("DRY RUN — showing priority brand list only\n");
    const brands = BRAND_ONLY ? [BRAND_ONLY] : PRIORITY_BRANDS;
    console.log(`Priority queue (${brands.length} brands):`);
    brands.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
    console.log(`\nBudget: ${BUDGET === Infinity ? "unlimited" : "$" + BUDGET}`);
    return;
  }

  console.log(`Stripped re-analysis — budget: ${BUDGET === Infinity ? "unlimited" : "$" + BUDGET}`);
  console.log(`GPT-4o pricing: $2.50/1M input · $10/1M output\n`);

  const brands = BRAND_ONLY ? [BRAND_ONLY] : PRIORITY_BRANDS;
  const verifyIds = [];
  let verified = false;

  // Multi-round cycling: process PER_BRAND_PER_PASS items per brand per round.
  // Ensures every aesthetic gets coverage before any single brand is exhausted.
  let round = 1;
  while (spend() < BUDGET) {
    let anyLeft = false;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Round ${round} — ${spendStr()} spent so far`);
    console.log("─".repeat(60));

    for (const brand of brands) {
      if (spend() >= BUDGET) break;

      const items = (await fetchBrand(brand)).filter(p =>
        !FRAGRANCE_RE.test(p.title) && !FRAGRANCE_RE.test(p.category || "") &&
        !DECK_RE.test(p.title)      && !DECK_RE.test(p.category || "")
      );
      if (!items.length) continue;
      anyLeft = true;

      console.log(`\n  [${brand}] ${items.length} remaining this pass`);

      for (const p of items) {
        if (spend() >= BUDGET) {
          console.log(`\nBudget reached (${spendStr()}). Stopping.`);
          process.exit(0);
        }

        const label = `    ${p.brand} — ${p.title?.slice(0, 42)}`;
        process.stdout.write(`${label}... `);

        let result;
        let retries = 0;
        while (retries < 4) {
          try {
            result = await analyze(p);
            break;
          } catch (err) {
            const msg = err.message || "";
            if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
              retries++;
              const wait = retries * 30000;
              process.stdout.write(`\n  rate limited — waiting ${wait / 1000}s...\n${label}... `);
              await new Promise(r => setTimeout(r, wait));
            } else {
              if (!firstApiError) {
                firstApiError = msg;
                console.log(`\n⚠️  First API error after ${totalUpdated} items: ${msg.slice(0, 80)}`);
              }
              // Balance/billing errors — stop immediately and report
              if (/insufficient|billing|credit|balance|quota exceeded|payment/i.test(msg)) {
                console.log(`\n💳 Balance error — stopping.\n`);
                console.log(`  Items completed: ${totalUpdated}`);
                console.log(`  Total spent:     ${spendStr()}`);
                process.exit(1);
              }
              console.log(`✗ ${msg.slice(0, 80)}`);
              totalFailed++;
              await new Promise(r => setTimeout(r, 1500));
              break;
            }
          }
        }
        if (!result) continue;

        const err = await writeResult(p, result);
        if (err) {
          console.log(`✗ DB: ${err.message?.slice(0, 80)}`);
          totalFailed++;
        } else {
          totalUpdated++;
          console.log(`✓  [${spendStr()} · ${totalUpdated} done]`);
          verifyIds.push(p.id);
        }

        if (!verified && verifyIds.length >= 20) {
          verified = true;
          await runVerification(verifyIds);
        }

        await new Promise(r => setTimeout(r, 800));
      }
    }

    if (!anyLeft) {
      console.log("\nAll priority brands exhausted.");
      break;
    }
    round++;
  }

  // ── After priority brands: process remaining items ────────────────────────
  if (!BRAND_ONLY && spend() < BUDGET) {
    console.log("\n── All priority brands done. Processing remaining items ──\n");
    let page = 0;
    while (true) {
      if (spend() >= BUDGET) break;

      const { data: remaining } = await sb.from("streetwear_products")
        .select("id,brand,title,category,price_text,brand_tier,image_url,color_primary,sub_type,aesthetic_tags")
        .eq("analyzed", true)
        .is("formality", null)
        .not("image_url", "is", null)
        .range(page * BATCH, (page + 1) * BATCH - 1);

      if (!remaining?.length) break;
      page++;

      const wearable = remaining.filter(p =>
        !FRAGRANCE_RE.test(p.title) && !FRAGRANCE_RE.test(p.category || "") &&
        !DECK_RE.test(p.title)      && !DECK_RE.test(p.category || "")
      );

      for (const p of wearable) {
        if (spend() >= BUDGET) break;
        process.stdout.write(`  ${p.brand} — ${p.title?.slice(0, 40)}... `);

        let result;
        let retries = 0;
        while (retries < 4) {
          try { result = await analyze(p); break; }
          catch (err) {
            const msg = err.message || "";
            if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
              retries++;
              await new Promise(r => setTimeout(r, retries * 30000));
            } else {
              console.log(`✗ ${msg.slice(0, 60)}`);
              totalFailed++;
              await new Promise(r => setTimeout(r, 1500));
              break;
            }
          }
        }
        if (!result) continue;

        const err = await writeResult(p, result);
        if (err) { console.log(`✗ DB: ${err.message?.slice(0, 60)}`); totalFailed++; }
        else { totalUpdated++; console.log(`✓  [${spendStr()} · ${totalUpdated} done]`); }
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log(`Done. Updated: ${totalUpdated} | Failed: ${totalFailed}`);
  console.log(`Total spend: ${spendStr()} (${totalIn.toLocaleString()} in · ${totalOut.toLocaleString()} out tokens)`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
