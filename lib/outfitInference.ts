// Outfit-level pros/cons analysis via GPT-4o.
// Takes the assembled outfit items + context, returns pros, cons, and outfit tags.
// Unlike piece analysis there is no color-pairing (outfit is already assembled)
// and no style_pairings (no cross-piece suggestions for a complete look).

import OpenAI from "openai";
import type { GarmentForScoring } from "./scoring";
import { getSlot } from "./scoring";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Tag vocabulary ────────────────────────────────────────────────────────────

export const OUTFIT_TAG_VOCAB = {
  occasion: [
    "casual", "smart-casual", "business-casual", "date-night",
    "weekend-errand", "streetwear-daily", "evening-out", "campus",
    "travel", "active-adjacent",
  ],
  season: ["all-season", "warm-weather", "cold-weather", "layering-season"],
  color_story: [
    "monochrome", "tonal", "earth-tone-palette", "neutral-palette",
    "colorful", "contrast", "dark-palette", "light-palette",
  ],
  complexity: ["minimal-layers", "layered"],
  aesthetic: [
    "streetwear", "old-money", "minimalist", "gorpcore", "preppy",
    "techwear", "y2k", "workwear", "coastal", "resort", "avant-garde",
    "quiet-luxury", "hype",
  ],
};

export const ALL_OUTFIT_TAGS = Object.values(OUTFIT_TAG_VOCAB).flat();

// ── Types ─────────────────────────────────────────────────────────────────────

export type OutfitAnalysisResult = {
  pros: string[];
  cons: string[];
  outfit_tags: string[];
};

// ── Prompt helpers ────────────────────────────────────────────────────────────

// Majority-vote aesthetic from the outfit's piece tags.
export function deriveOutfitAesthetic(items: GarmentForScoring[]): string {
  const freq: Record<string, number> = {};
  for (const g of items) {
    for (const t of g.aesthetic_tags ?? []) {
      freq[t] = (freq[t] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "casual";
}

// ── Core analysis call ────────────────────────────────────────────────────────

export async function analyzeOutfit(
  items: GarmentForScoring[],
  opts: {
    score: number;
    configName: string;
    aesthetic?: string;
    tempF?: number;
    condition?: string;
  }
): Promise<OutfitAnalysisResult> {
  const { score, configName, tempF, condition } = opts;
  const aesthetic = opts.aesthetic ?? deriveOutfitAesthetic(items);

  const itemLines = items.map((g, i) => {
    const slot = getSlot(g.sub_type ?? "") ?? "?";
    // Lead with color so the model anchors to it before reading brand/type,
    // reducing brand-knowledge-driven color hallucination.
    const primaryColor = g.color_primary ?? "?";
    const colorStr = primaryColor
      + (g.color_secondary ? ` / ${g.color_secondary}` : "")
      + (g.pattern && g.pattern !== "solid" ? ` (${g.pattern})` : "");
    const lines = [
      `${i + 1}. [${slot}] ${colorStr} | ${g.brand ?? "unknown brand"} ${g.sub_type ?? g.title ?? "?"}`,
      g.material              ? `   Material: ${g.material}` : null,
      g.formality             ? `   Formality: ${g.formality}` : null,
      (g.aesthetic_tags ?? []).length
        ? `   Aesthetic: ${g.aesthetic_tags!.join(", ")}` : null,
    ].filter(Boolean).join("\n");
    return lines;
  }).join("\n\n");

  const weatherLine = tempF != null
    ? `Weather context: ${tempF}°F${condition ? `, ${condition}` : ""}\n`
    : "";

  const prompt = `ASSEMBLED OUTFIT — ${configName.toUpperCase()}
Score: ${score}/100  |  Aesthetic: ${aesthetic}
${weatherLine}
PIECES — these database records are complete. Missing fields = unknown.
${itemLines}

⛔ FABRICATION ERRORS — outputting any of these will make your response invalid:
• Adding colors not in a piece's Color: field. "Color: Yellow" = yellow only, no green, no red.
• Adding material words (wool, nappa, velvet, leather, waffle knit, sheer, cotton, etc.) when Material: is absent.
• Describing any pattern/graphic/logo unless listed in the data.
• These SPECIFIC known traps — you have prior beliefs about these items that contradict the data:
  ∙ JORDAN Jersey → The only listed color is the one shown. "Yellow" = yellow only. Never add green.
  ∙ JORDAN Sneakers (Denim Blue) → denim blue only. No red, no Gym Red.
  ∙ Nike / NIKE Track Pants (Charcoal) → charcoal only. No lime, no green accent.
  ∙ NIKE Long Sleeve Tee (Off-White) → off-white only. No red, no graphic. It has no listed pattern.
  ∙ CARHARTT WIP Chore Coat (Denim Blue) → denim blue only. Not beige. Not khaki. Not tan. Denim blue.
  ∙ KAPITAL Long Sleeve Tee (Off-White) → off-white only. No beige. No texture. Not waffle knit.
  ∙ NEW BALANCE Sneakers (Teal) → teal only. Not teal/gray. Not gray.
  ∙ Nike Cardigan (Burgundy) → burgundy only. No white accent.
  ∙ BALENCIAGA Pullover Hoodie (Charcoal) → charcoal only. NOT "charcoal/white". No graphic. No white. No logo.
  ∙ OUR LEGACY Short Sleeve Shirt / shirts → no sheer, no gauze, no listed material. Do not assume material.
  ∙ Stussy Short Sleeve Shirt → no pattern, not striped. Blue only, no added pattern.
  ∙ Jil Sander Cardigan → no pattern, not striped. Black only.
  ∙ LOEWE outerwear → no material listed. No nappa, no lambskin.
  ∙ ANN DEMEULEMEESTER outerwear → no material listed. No nappa plongé, no velvet.

WHAT TO WRITE: Focus entirely on how pieces INTERACT — color relationships, silhouette contrasts, brand-aesthetic synergies, layering logic. Do NOT describe any single piece in isolation.

Write punchy "label: reason" fragments, 4-8 words each side.

Return JSON:
{
  "pros": [
    "<2-5 strengths. Every pro must reference ≥2 specific pieces by name/color. Describe their INTERACTION, not the piece alone. Good: 'Stussy blue shirt + denim blue coat: monochromatic tension, intentional'. Bad: 'Stussy shirt: colorful pop'. FORBIDDEN words: 'relaxed silhouette', 'timeless', 'versatile'>"
  ],
  "cons": [
    "<1-4 drawbacks, same interaction format. When formulaic, name the specific 2+ piece combination. IMPORTANT: Do NOT call good standard pairings a 'clash' — black + denim blue, yellow + black, off-white + dark tones, charcoal + navy are all standard harmonious pairings, NOT clashes. Reserve 'clash' for genuinely competing colors. Return [] only if truly none. NEVER mention price>"
  ],
  "outfit_tags": ["<3-6 from exactly: ${ALL_OUTFIT_TAGS.join(", ")}>"]
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an expert fashion stylist evaluating assembled outfits for a personal wardrobe app. " +
          "You receive structured item metadata. Treat that data as the COMPLETE and AUTHORITATIVE description of each piece.\n\n" +
          "CRITICAL ACCURACY RULES (violating any = factual error):\n" +
          "1. COLOR: The Color: field is COMPLETE. One word = one color, nothing more. " +
          "'Yellow' is yellow only — never add 'green'. 'Denim Blue' is denim blue only — never add 'red' or 'Gym Red'. " +
          "'Off-White' is off-white only — never say 'beige'. Colors not in the field DO NOT EXIST for that item.\n" +
          "2. MATERIAL: If Material: is missing, you have NO information about the material. " +
          "Do NOT name any material — not wool, nappa, velvet, leather, waffle knit, gabardine, sheer, cotton, acrylic, or any other. Absence = unknown.\n" +
          "3. PATTERN/DETAIL: Only cite pattern/detail from the pattern field. Do NOT add 'striped', 'graphic', 'sheer', 'print', 'embossed', or any other detail not listed.\n" +
          "4. PRODUCT IDENTITY: Never identify the specific collab, season, or colorway. " +
          "Jordan Sneakers (Denim Blue) = denim-blue Jordan sneakers. Not 'Jordan x Levi's AJ4'. " +
          "Nike Cardigan (Burgundy) = burgundy Nike cardigan. Not 'Yoon x Nike'.\n\n" +
          "KNOWN FABRICATION TRAPS — these are things you likely believe are true from training, but they are NOT in the data and must NOT be mentioned:\n" +
          "• Kapital Long Sleeve Tee / any Kapital tee: do NOT say 'waffle knit', 'sashiko', 'boro', or any specific construction\n" +
          "• JORDAN Jersey (Yellow): do NOT say 'green', 'yellow/green', 'Brazil-inspired'\n" +
          "• LOEWE outerwear: do NOT say 'nappa', 'lambskin', 'grained leather', 'anagram' unless Material: says so\n" +
          "• ANN DEMEULEMEESTER: do NOT say 'nappa plongé', 'velvet', 'silk' unless Material: says so\n" +
          "• OUR LEGACY shirts: do NOT say 'sheer', 'gauze', 'rayon', 'poplin' unless Material: says so\n" +
          "• BALENCIAGA hoodies/shirts: do NOT say 'graphic', 'logo print', 'oversized logo' unless pattern/detail says so\n\n" +
          "Brand DNA you MAY apply to OUTFIT-LEVEL aesthetic readings (not item-level details):\n" +
          "Stussy = surf-skate heritage; Palace = UK skate; Carhartt WIP = workwear-street; " +
          "Jil Sander = precision minimalism; Loewe = artisanal luxury-casual; " +
          "ANN DEMEULEMEESTER = dark romantic; BALENCIAGA = luxury-streetwear; " +
          "Comme des Garçons = conceptual deconstruction; Kapital = Japanese craft-workwear; " +
          "Jordan = basketball court heritage; Nike = athletic performance crossover.\n\n" +
          "Be honest and specific. Safe combos get called out. Never mention price.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;
  return {
    pros:        Array.isArray(parsed.pros)        ? (parsed.pros as string[])        : [],
    cons:        Array.isArray(parsed.cons)        ? (parsed.cons as string[])        : [],
    outfit_tags: Array.isArray(parsed.outfit_tags) ? (parsed.outfit_tags as string[]) : [],
  };
}
