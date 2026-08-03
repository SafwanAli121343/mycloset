import OpenAI from "openai";
import { BRAND_AESTHETICS } from "./constants/brandAesthetics";
import { AESTHETIC_TAGS, STREETWEAR_CATEGORIES } from "./constants/attributes";
import { SUB_TYPES } from "./constants/subtypes";
import { NAMED_COLORS } from "./constants/colors";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const COLOR_LIST = NAMED_COLORS.map((c) => c.name).join(", ");

// Each prompt gives the model the FULL set of valid choices plus a concrete
// visual cue to check, so it's selecting from our vocabulary rather than
// free-associating.
const FIELD_PROMPTS: Record<string, string> = {
  color_primary: `"color_primary": "<the item's dominant fabric/material color — look at the LARGEST SURFACE AREA of the actual garment, footwear, or accessory itself. Ignore background, model hair, skin, other clothing the model is wearing. For a plaid/striped/graphic item: the MOST PROMINENT color family, not the blended average. For accessories: use the frame/body/metal color. Choose exactly one name from: ${COLOR_LIST}>"`,
  color_secondary: `"color_secondary": "<STRICT RULES — return null in these cases: (1) solid-colored item even if you see shadows, folds, or shading differences; (2) the only variation is fabric texture or lighting; (3) you are unsure. ONLY return a secondary if there is a DELIBERATE design element in a clearly different color: a distinct stripe color, a graphic/logo in a different color, a contrast panel, contrasting stitching, or a clearly different color-blocked section. The secondary must be INTENTIONALLY placed by the designer, not a lighting artifact. Same color list as primary. For accessories: a watch face distinctly different from strap, a gemstone clearly different from setting. Return null when in doubt>"`,
  brand: `"brand": "<the exact, full brand name as it would appear on the garment's label or official website — correct capitalization and punctuation (e.g. \"Jos. A. Bank\" not \"Jos\", \"Ralph Lauren\" not \"RL\") — or null if the item is unbranded or the brand genuinely cannot be identified from the title or image>"`,
  fit: `"fit": "<one of: slim, regular, relaxed, oversized, baggy, tapered, straight, wide, skinny, boxy, tailored — judge from shoulder/body width, sleeve or leg width, and how the hem falls relative to the body. DEFAULT TO 'regular' when uncertain — do not default to slim. Use 'slim' only when the item is clearly fitted/tapered through the body. Use 'tailored' for structured blazers/suits described as tailored fit>"`,
  pattern: `"pattern": "<one of: solid, striped, plaid, camo, graphic, floral, checkered, houndstooth, tie-dye, photo-print, novelty-print, all-over-graphic, other. CRITICAL DISTINCTIONS — use 'photo-print' when the garment displays actual photographic or photorealistic imagery (food photos, landscape photos, portrait photos printed on fabric); use 'novelty-print' for cartoon, meme, character, mascot, or pop-culture imagery covering the garment; use 'all-over-graphic' when a dense artist illustration or complex graphic covers the ENTIRE garment surface with no solid base visible — IMPORTANT: monogram/repeating-logo prints (LV, Gucci GG, Burberry check, Supreme all-over box logo) are NOT all-over-graphic, classify those as 'other'; use 'graphic' ONLY for a contained design element (chest logo, single print on one panel). Scan the ENTIRE visible surface before deciding>"`,
  item_tier: `"item_tier": "<assess the garment's genuine fashion intent. 'standard' is the default — the vast majority of items are 'standard'. 'statement' = bold but genuine intentional fashion even if divisive (Supreme, Rick Owens, BAPE, avant-garde, loud streetwear, maximalist designer pieces). PROTECTED — these are NEVER novelty, always 'standard': traditional/cultural garments (kurta, Punjabi suit, shalwar kameez, thobe, hanbok, kimono, dashiki, kente, abaya, kaftan, etc.), religious dress, folk costume, formal ethnic wear — these are real fashion traditions even if unfamiliar to Western fashion. 'novelty' = items that no serious fashion person would wear unironically: (a) photorealistic images printed across the garment (food, landscapes, human/animal faces as photo-prints, ramen soup); (b) cartoon/meme/pop-culture characters covering the garment; (c) Halloween dress-up costumes; (d) gag/joke items; (e) all-over fantasy illustration prints — wolves howling at galaxies, fire dragons, nebula wildlife art, glowing animals on a cosmic background — that read as airbrushed boardwalk art or county-fair souvenir art, not fashion. Streetwear brands with all-over graphics (BAPE camo, Supreme box logo, Gucci GG) are NOT novelty — they are statement. Use 'standard' when in doubt>"`,
  novelty_quality: `"novelty_quality": <ONLY fill this if item_tier is 'novelty' — otherwise return null. Rate the novelty item 1–10 on craft and intentionality within its concept: 1 = completely absurd with zero thought (random food photograph slapped on a cheap hoodie), 3–4 = low effort gag item, 5–6 = at least someone put some design intent into the joke, 7–8 = clever or well-executed novelty concept, 10 = the absolute peak of its novelty concept with genuine artistry. Return null for 'standard' and 'statement' items>`,
  material: `"material": "<primary material of this item in one or two words — for clothing use fabric names (cotton, wool, leather, etc.), for accessories use the actual material (gold, silver, stainless steel, acetate, brass, titanium, leather, canvas, silicone, etc.)>"`,
  logo_prominence: `"logo_prominence": <1-5 — size/visual weight of any branding relative to garment area. 1 = no visible branding, 5 = large or all-over logo>`,
  aesthetic_tags: `"aesthetic_tags": ["<1-4 tags that describe the item's aesthetic identity. Choose from: ${AESTHETIC_TAGS.join(", ")}. Pick the most specific and accurate ones — a Ralph Lauren polo is 'old money, preppy'; a Supreme box logo tee is 'streetwear'; a Timberland boot is 'workwear, streetwear'. Never pick both 'formal' and 'streetwear' for the same item>"]`,
  tags: `"tags": {
  "color": ["<all relevant color descriptors: the exact color name, plus descriptors like 'dark', 'light', 'monochrome', 'earth-tone', 'pastel', 'multicolor', 'tonal', 'neutral', 'neon' as applicable>"],
  "type": ["<product type hierarchy: specific sub-type first, then broader types, e.g. ['hoodie', 'sweatshirt', 'pullover', 'top'] or ['chelsea boots', 'boots', 'footwear']>"],
  "aesthetic": ["<full aesthetic vocabulary — all that apply from: ${AESTHETIC_TAGS.join(", ")}, plus any of: hype, drop-culture, logo-heavy, luxury-streetwear, resort, country-club, sportswear>"],
  "brand": ["<brand name, brand category (e.g. 'hype-brand', 'heritage-brand', 'luxury-brand', 'budget-brand', 'sportswear-brand', 'workwear-brand', 'designer-brand'), brand origin country/city if relevant>"],
  "price": ["<one of: budget ($0-75), mid-range ($75-200), premium ($200-500), luxury ($500+)>, plus approximate price range like '$50-100'>"],
  "streetwear_category": ["<1-3 that apply from: ${STREETWEAR_CATEGORIES.join(", ")}>"],
  "features": ["<specific design and construction details that make this item distinctive — be thorough. Examples: graphic-print, logo-heavy, text-on-garment, tonal-design, all-over-print, colorblock, washed-look, distressed, embroidered, limited-edition, drop-culture, collaboration, double-knee, cargo-pockets, half-zip, quarter-zip, wide-leg, raw-denim, ribbed, chunky-sole, high-top, platform, suede-upper, patent-leather, shearling-lined, quilted, technical-fabric, water-resistant, reflective, zip-off, side-stripe, contrast-stitching, patchwork, tie-dye, varsity-stripes, pin-striped, window-pane, houndstooth. Return only features ACTUALLY PRESENT on this item>"]
}`,
  formality: `"formality": "<one of: casual, smart-casual, business, formal>"`,
  pros: `"pros": ["<3-8 genuine fashion strengths. For each pro: first write out the full thought as a detailed sentence internally, THEN compress to a punchy 4-9 word fragment. Return only the compressed fragments. STRICT RULES: (1) NEVER mention price, cost, or purchasing; (2) Be specific to THIS item's brand, sub-type, and cultural context — generic fragments banned; (3) Cover: styling contexts, aesthetic weight, layering, cultural recognition, silhouette, seasonal range. CRITICAL EXCEPTION: if this item is clearly a novelty, meme, Halloween dress-up costume, or gag item not intended as real fashion, return [] — 'unique', 'conversation starter', 'eye-catching', and 'statement piece' are NOT genuine fashion strengths for joke items. Traditional/cultural garments (kurta, thobe, hanbok, etc.) are NOT costumes — give them genuine pros>"]`,
  cons: `"cons": ["<2-6 genuine fashion drawbacks. Same two-step method: write the full thought as a sentence internally, then compress to a punchy fragment. Use a colon for quick context: 'Clashes with old-money: reads too casual', 'Oversaturated: everyone has one'. Name SPECIFIC aesthetics where it fails. STRICT RULES: (1) Never mention price or purchasing; (2) Never say 'can look dated' without specifying WHY; (3) Return [] only if truly no meaningful drawbacks; (4) NEVER write 'Novelty item', 'not real fashion', or any variant for ANY item — true novelty items get item_tier='novelty' and their score communicates it; borderline graphic/subculture items are real fashion and deserve real fashion critique. Traditional/cultural garments are NOT joke items — give them genuine cons>"]`,
  color_pairings: `"color_pairings": ["<list every color or tone this piece pairs well with, grounded in actual color theory. Be thorough and precise — name specific colors (e.g. 'navy', 'olive', 'off-white', 'camel', 'burgundy', 'washed grey', 'rust', 'dusty rose') not vague families. Consider the item's own color, saturation level, warmth/coolness, and whether it's a neutral, earth tone, saturated, or pastel. Apply real color theory: complementary colors, analogous harmonies, tone-on-tone, contrast pairings. Include both safe neutrals AND bold creative pairings that genuinely work. For accessories (gold, silver, etc.) consider which outfit base colors they suit. Do not list colors that only 'technically' work — list ones that actually look good together>"]`,
  color_clashes: `"color_clashes": ["<list every color or color family that genuinely conflicts with this item, based on real color theory — poor contrast, clashing undertones, competing saturation, etc. Be specific: don't just say 'bright colors' — say 'neon yellow', 'hot pink', 'electric blue' if those are the actual clashes. For neutral items that work with most things, still list the few that don't. Return [] only if the item is truly near-universal (e.g. a plain white tee, a black accessory)>"]`,
  style_pairings: `"style_pairings": ["<2-4 pairing suggestions based on the user's wardrobe (if provided) — format each as '[exact item description from wardrobe list] → [aesthetic]' where aesthetic is one of: ${AESTHETIC_TAGS.join(", ")}. CRITICAL: only suggest items worn simultaneously from a DIFFERENT category. Never pair: top+top, bottom+bottom, shoe+shoe, or accessory+accessory. Only reference items explicitly listed in the wardrobe. Return [] if no wardrobe context is given, no valid cross-category pairings exist, OR this item is a novelty/meme/joke item that cannot realistically be worn in a genuine outfit>"]`,
};

// Fields that require image inspection — always requested regardless of what
// the title/metadata already provides.
const VISUAL_FIELDS = ["design_complexity", "logo_prominence", "tags", "item_tier", "novelty_quality"];

export type InferenceInput = {
  title: string;
  category: string;
  subType: string | null;
  brand: string | null;
  colorPrimary: string | null;
  colorPrimaryHex?: string | null;
  colorSecondary?: string | null;
  colorSecondaryHex?: string | null;
  fit?: string | null;
  material?: string | null;
  image: string;
  listingText?: string | null;
  link?: string | null;
  wardrobeContext?: string | null;
  wardrobeImages?: Array<{ label: string; url: string }> | null;
};

export type TextInferenceInput = {
  title: string;
  category: string;
  subType: string | null;
  brand: string | null;
  colorPrimary: string | null;
  material: string | null;
  formality?: string | null;
};

export type InferenceResult = {
  values: Record<string, unknown>;
  confidence: Record<string, string>;
};

// One consolidated GPT-4o vision call (full model + "high" detail — this runs
// once per garment and the result is reused for every future analysis, so
// accuracy matters far more than the marginal token cost). Covers only the
// fields the title/Lens cascade couldn't resolve, plus the always-visual fields.
export async function inferGarmentAttributes(
  item: InferenceInput,
  fieldsNeeded: string[]
): Promise<InferenceResult> {
  let allFields = Array.from(new Set([...fieldsNeeded, ...VISUAL_FIELDS]));

  const values: Record<string, unknown> = {};
  const confidence: Record<string, string> = {};

  // Brand is a free, ground-truth signal (Tier A). If we recognize the brand
  // and it has a known aesthetic identity, use that instead of guessing from
  // a single product photo — more reliable AND skips an AI field.
  if (item.brand && BRAND_AESTHETICS[item.brand] && allFields.includes("aesthetic_tags")) {
    values.aesthetic_tags = BRAND_AESTHETICS[item.brand];
    confidence.aesthetic_tags = "medium";
    allFields = allFields.filter((f) => f !== "aesthetic_tags");
  }

  if (allFields.length > 0) {
    // Always prepend a literal visual description so the model commits to what it
    // actually sees on the garment before making any classification decisions.
    // This chain-of-thought field is never stored — it only primes item_tier,
    // pattern, pros/cons, etc. to be grounded in what's literally on the fabric.
    const visualDescField = `  "visual_description": "<Examine the garment image closely. In 2-3 sentences describe LITERALLY what is printed, embroidered, or displayed on the surface — the actual imagery, graphics, text, and patterns. Be specific and objective: e.g. 'A photorealistic bowl of ramen soup printed across the chest and sleeves' or 'Neon-lit wolves and galaxy imagery rendered in purple/blue covering the entire hoodie surface'. If it is a solid, striped, or plain garment say so. Do NOT classify or evaluate yet — just describe what is literally visible>"`;

    const schema = [
      visualDescField,
      ...allFields.map((f) => {
        // sub_type's valid choices depend on the item's category, so it can't
        // be precomputed like the static FIELD_PROMPTS entries.
        if (f === "sub_type") {
          const options = SUB_TYPES[item.category] || [];
          return `  "sub_type": "<one of: ${options.join(", ")}>"`;
        }
        return `  ${FIELD_PROMPTS[f] ?? ""}`;
      }),
    ].join(",\n");

    const primaryColorStr = item.colorPrimary
      ? `${item.colorPrimary}${item.colorPrimaryHex ? ` (${item.colorPrimaryHex})` : ""}`
      : null;
    const secondaryColorStr = item.colorSecondary
      ? `${item.colorSecondary}${item.colorSecondaryHex ? ` (${item.colorSecondaryHex})` : ""}`
      : null;

    const context = [
      `Title: ${item.title}`,
      `Category: ${item.category}`,
      item.subType && `Type: ${item.subType}`,
      item.brand && `Brand: ${item.brand}`,
      primaryColorStr && `Color: ${primaryColorStr}`,
      secondaryColorStr && `Secondary color: ${secondaryColorStr}`,
      item.fit && `Fit: ${item.fit}`,
      item.material && `Material: ${item.material}`,
      item.link && `Listing URL: ${item.link}`,
    ]
      .filter(Boolean)
      .join(" | ");

    const listingSection = item.listingText
      ? `\n\nListing page text (use this to identify brand, material, and other details):\n${item.listingText}`
      : "";

    const wardrobeSection = item.wardrobeContext
      ? `\n\n${item.wardrobeContext}\nOnly reference specific items from this list. Never invent, infer, or count items not explicitly listed above.`
      : "";

    const prompt = `${context}${listingSection}${wardrobeSection}

You are analyzing a clothing, footwear, or accessory item for a wardrobe app. Use ALL available signals to answer accurately — brand reputation, item category/type conventions, title keywords, AND visual inspection of the product image. For material: brand and category knowledge often beats image inspection — a menswear blazer is likely wool or blend; a ring described as "14k" is gold; an eyeglass frame described as "acetate" is acetate. Only infer from the image when no other signal exists.
Return JSON with exactly these fields, choosing only from the listed options:
{
${schema}
}`;

    const wardrobeImageBlocks: OpenAI.Chat.ChatCompletionContentPart[] =
      (item.wardrobeImages ?? []).flatMap(({ label, url }) => [
        { type: "text" as const, text: `Wardrobe item — ${label}:` },
        { type: "image_url" as const, image_url: { url, detail: "low" as const } },
      ]);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are an expert clothing, footwear, and accessories analyst for a personal wardrobe app. You have deep knowledge of current (2024–2025) fashion standards, streetwear and hype culture, color theory, and brand DNA. Key instructions:\n\n" +
            "OWNERSHIP CONTEXT: The user ALREADY OWNS every item you analyze. They added it to their wardrobe. This means: NEVER comment on price, cost, value for money, or whether it was worth buying. NEVER suggest they buy or avoid buying it. NEVER frame resale value as an investment decision. Pros and cons are purely about how the item functions in outfits and fits into their existing wardrobe.\n\n" +
            "CULTURAL AWARENESS: Understand the specific cultural weight of pieces — a Supreme Box Logo hoodie is a hype grail worn in very specific ways; Jordan 1s, Dunks, Yeezys, Palace, BAPE pieces each carry distinct subcultural meaning. Apply this knowledge when assessing pros/cons and styling.\n\n" +
            "HONESTY OVER DIPLOMACY: If something is corny, played out, oversaturated, or dated by current standards, say so clearly and explain why. Do not default to safe, neutral praise. Be the honest friend with good taste, not a brand PR rep.\n\n" +
            "CURRENT STANDARDS: Apply what is actually being worn and considered stylish in 2024–2025 across streetwear, old-money, minimalist, and other relevant aesthetics — not textbook conventions from 5 years ago.\n\n" +
            "TECHNICAL: For brand — extract from title or listing text, do not guess from visual style. For material — title keywords and brand/category conventions beat image inspection. For colors — the hex values provided are the exact extracted colors; use them for precise pairing advice.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "text", text: "Item being analyzed:" },
            { type: "image_url", image_url: { url: item.image, detail: "high" } },
            ...wardrobeImageBlocks,
          ],
        },
      ],
      response_format: { type: "json_object" },
    });


    const aiValues = JSON.parse(completion.choices[0].message.content || "{}");
    for (const field of allFields) {
      values[field] = aiValues[field];
      confidence[field] = VISUAL_FIELDS.includes(field) ? "medium" : "low";
    }
  }

  return { values, confidence };
}

// Text-only inference for manually-added items with no image.
// Infers scoring-critical fields (aesthetic_tags, pros, cons, color_pairings,
// color_clashes, sub_type, formality, material) from title + brand + category alone.
export async function inferGarmentAttributesTextOnly(
  item: TextInferenceInput
): Promise<InferenceResult> {
  const values: Record<string, unknown> = {};
  const confidence: Record<string, string> = {};

  // Short-circuit known fields
  if (item.subType) { values.sub_type = item.subType; confidence.sub_type = "high"; }
  if (item.material) { values.material = item.material; confidence.material = "high"; }
  if (item.formality) { values.formality = item.formality; confidence.formality = "high"; }

  let fieldsToInfer = ["sub_type", "aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "material", "pattern", "item_tier", "novelty_quality"].filter(
    (f) => !(f in values)
  );

  // Brand aesthetics override
  if (item.brand && BRAND_AESTHETICS[item.brand] && fieldsToInfer.includes("aesthetic_tags")) {
    values.aesthetic_tags = BRAND_AESTHETICS[item.brand];
    confidence.aesthetic_tags = "medium";
    fieldsToInfer = fieldsToInfer.filter((f) => f !== "aesthetic_tags");
  }

  if (fieldsToInfer.length === 0) return { values, confidence };

  const schema = fieldsToInfer
    .map((f) => {
      if (f === "sub_type") {
        const options = SUB_TYPES[item.category] || [];
        return `  "sub_type": "<one of: ${options.join(", ")}>"`;
      }
      return `  ${FIELD_PROMPTS[f]}`;
    })
    .join(",\n");

  const context = [
    `Title: ${item.title}`,
    `Category: ${item.category}`,
    item.subType && `Type: ${item.subType}`,
    item.brand && `Brand: ${item.brand}`,
    item.colorPrimary && `Color: ${item.colorPrimary}`,
    item.material && `Material: ${item.material}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an expert clothing analyst for a personal wardrobe app. The user ALREADY OWNS this item — NEVER mention price, cost, or purchasing decisions in pros/cons. Apply current 2024–2025 fashion standards. Be honest and specific.",
      },
      {
        role: "user",
        content: `${context}\n\nThe user added this item manually without a photo. Use your knowledge of the brand, title, and category to infer accurate attributes.\nReturn JSON with exactly these fields:\n{\n${schema}\n}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const aiValues = JSON.parse(completion.choices[0].message.content || "{}");
  for (const field of fieldsToInfer) {
    values[field] = aiValues[field];
    confidence[field] = "medium";
  }

  return { values, confidence };
}
