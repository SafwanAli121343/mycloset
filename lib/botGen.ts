import type { GarmentForScoring } from "./scoring";
import { getSlot } from "./scoring";

// ── Types ────────────────────────────────────────────────────────────────────

export type BotArchetype = {
  id: string;
  name: string;
  bio: string;
  preferredBrands: string[];
  tier: "budget" | "mid" | "premium" | "luxury";
  aesthetics: string[];
};

export type DbProduct = {
  id: string;
  brand: string;
  title: string;
  image_url: string | null;
  category: string | null;
  sub_type: string | null;
  color_primary: string | null;
  aesthetic_tags: string[] | null;
  brand_tier: string | null;
};

// ── Scoring derivation tables ────────────────────────────────────────────────

const TIER_MATERIAL: Record<string, string> = {
  luxury:  "wool",
  premium: "cotton",
  mid:     "cotton",
  budget:  "polyester",
};

const TIER_PROS: Record<string, string[]> = {
  luxury: [
    "Instantly elevates any look",
    "Unmistakable craftsmanship",
    "Strong cultural cachet",
    "Versatile across smart-casual contexts",
    "Ages gracefully",
    "Layering staple in upscale fits",
    "Finish quality is immediately apparent",
    "Significant weight in fashion-literate spaces",
  ],
  premium: [
    "Strong aesthetic identity",
    "Quality construction",
    "Versatile across multiple fits",
    "Carries weight in streetwear circles",
    "Holds up over multiple seasons",
    "Recognizable to those in the know",
  ],
  mid: [
    "Clear aesthetic statement",
    "Pairs well across street fits",
    "Recognizable to core community",
  ],
  budget: ["Easy layering piece"],
};

const TIER_CONS: Record<string, string[]> = {
  luxury: [
    "Risk of looking try-hard in casual contexts",
    "Statement pieces draw attention — not for understated looks",
  ],
  premium: [
    "Polarizing outside streetwear and fashion circles",
    "Heavy branding can limit outfit flexibility",
  ],
  mid: [
    "Oversaturated — common on the street",
    "Fits a narrow aesthetic range",
    "Limited recognition outside core communities",
  ],
  budget: [
    "Oversaturated and broadly recognized as budget",
    "Material feel noticeably lower quality",
    "Fits a narrow aesthetic range",
    "Minimal cultural cachet outside core streetwear",
    "Construction doesn't hold up season to season",
  ],
};

const TIER_FORMALITY: Record<string, string> = {
  luxury:  "smart-casual",
  premium: "casual",
  mid:     "casual",
  budget:  "casual",
};

// Basic color theory pairings/clashes for the most common streetwear colorways
const COLOR_PAIRINGS: Record<string, string[]> = {
  black:     ["white", "grey", "olive", "camel", "navy", "burgundy", "off-white", "cream", "sand", "khaki", "red", "orange", "yellow"],
  white:     ["black", "navy", "olive", "denim", "camel", "grey", "tan", "brown", "burgundy"],
  grey:      ["black", "white", "navy", "burgundy", "olive", "camel", "charcoal", "red"],
  navy:      ["white", "grey", "camel", "burgundy", "olive", "cream", "tan", "orange", "red"],
  cream:     ["navy", "camel", "brown", "tan", "black", "olive", "rust", "burgundy"],
  "off-white": ["navy", "camel", "brown", "black", "olive", "rust", "charcoal", "grey"],
  beige:     ["navy", "camel", "tan", "brown", "black", "olive", "rust", "white"],
  tan:       ["navy", "brown", "camel", "white", "burgundy", "olive", "black"],
  camel:     ["navy", "black", "white", "brown", "cream", "grey", "burgundy", "olive"],
  brown:     ["camel", "tan", "cream", "navy", "olive", "burgundy", "orange", "white"],
  olive:     ["black", "white", "camel", "orange", "brown", "tan", "navy", "red"],
  khaki:     ["navy", "white", "olive", "brown", "black", "tan", "burgundy"],
  sand:      ["navy", "brown", "olive", "rust", "camel", "black", "white"],
  burgundy:  ["navy", "camel", "grey", "black", "white", "cream", "tan"],
  rust:      ["navy", "camel", "brown", "olive", "cream", "black", "white"],
  orange:    ["navy", "black", "brown", "olive", "white", "grey"],
  red:       ["black", "white", "navy", "grey", "denim", "olive"],
  pink:      ["black", "white", "navy", "grey", "denim", "brown", "olive"],
  purple:    ["black", "white", "grey", "navy", "camel"],
  blue:      ["white", "grey", "camel", "olive", "navy", "brown"],
  denim:     ["white", "black", "grey", "olive", "camel", "orange", "red"],
  green:     ["black", "white", "camel", "brown", "orange", "navy", "cream"],
  yellow:    ["black", "navy", "white", "grey", "brown"],
  charcoal:  ["white", "grey", "camel", "burgundy", "black", "navy", "olive"],
};

const COLOR_CLASHES: Record<string, string[]> = {
  black:     ["dark-navy"],
  white:     ["cream", "off-white"],
  grey:      ["brown", "tan"],
  navy:      ["black", "dark-purple"],
  cream:     ["white", "beige", "off-white"],
  "off-white": ["white", "cream"],
  beige:     ["tan", "cream"],
  camel:     ["yellow", "gold", "orange"],
  olive:     ["khaki", "yellow-green"],
  burgundy:  ["red", "orange", "rust", "pink"],
  rust:      ["orange", "red", "pink"],
  orange:    ["red", "pink", "rust", "yellow-green"],
  red:       ["orange", "pink", "burgundy", "magenta"],
  pink:      ["red", "orange", "purple", "magenta"],
  purple:    ["red", "orange", "pink"],
  blue:      ["purple", "green", "lime"],
  denim:     ["grey", "tan"],
  green:     ["red", "purple", "pink"],
  yellow:    ["orange", "lime", "beige"],
  charcoal:  ["dark-navy", "dark-brown"],
};

function deriveAestheticTags(product: DbProduct): string[] {
  if (product.aesthetic_tags?.length) return product.aesthetic_tags;
  const tier = product.brand_tier ?? "mid";
  if (tier === "luxury") return ["high-fashion", "quiet-luxury"];
  if (tier === "premium") return ["streetwear"];
  return ["streetwear"];
}

function deriveColorPairings(color: string | null): string[] {
  if (!color) return ["black", "white", "grey", "navy"];
  const key = color.toLowerCase().replace(/\s+/g, "-");
  return COLOR_PAIRINGS[key] ?? ["black", "white", "grey", "navy"];
}

function deriveColorClashes(color: string | null): string[] {
  if (!color) return [];
  const key = color.toLowerCase().replace(/\s+/g, "-");
  return COLOR_CLASHES[key] ?? [];
}

export function deriveGarmentForScoring(product: DbProduct): GarmentForScoring {
  const tier = (product.brand_tier ?? "mid") as "budget" | "mid" | "premium" | "luxury";
  return {
    id:             product.id,
    title:          product.title,
    brand:          product.brand,
    sub_type:       product.sub_type,
    material:       TIER_MATERIAL[tier] ?? "cotton",
    color_primary:  product.color_primary,
    color_secondary: null,
    pattern:        "solid",
    formality:      TIER_FORMALITY[tier] ?? "casual",
    aesthetic_tags: deriveAestheticTags(product),
    pros:           TIER_PROS[tier] ?? [],
    cons:           TIER_CONS[tier] ?? [],
    color_pairings: deriveColorPairings(product.color_primary),
    color_clashes:  deriveColorClashes(product.color_primary),
    tags:           null,
    image:          product.image_url,
  };
}

// ── Wardrobe assembly ────────────────────────────────────────────────────────

// Required slots for a valid outfit — we try to fill base, bottom, foot at minimum
const REQUIRED_SLOTS = ["base", "bottom", "foot"] as const;
const OPTIONAL_SLOTS = ["mid", "outer", "acc"] as const;

function pickFromPool(pool: DbProduct[], slot: string, exclude: Set<string>): DbProduct | null {
  return pool.find(p => !exclude.has(p.id) && getSlot(p.sub_type) === slot) ?? null;
}

export function assembleBotWardrobe(
  archetype: BotArchetype,
  pool: DbProduct[]
): GarmentForScoring[] {
  const preferred = pool.filter(p => archetype.preferredBrands.includes(p.brand));
  const aesthetic = pool.filter(p =>
    p.aesthetic_tags?.some(t => archetype.aesthetics.includes(t))
  );
  const tiered = pool.filter(p => p.brand_tier === archetype.tier);

  // Pick best candidate for a slot, prioritizing preferred → aesthetic → tiered → any
  const used = new Set<string>();
  const results: GarmentForScoring[] = [];

  function pick(slot: string): boolean {
    const candidate =
      pickFromPool(preferred, slot, used) ??
      pickFromPool(aesthetic, slot, used) ??
      pickFromPool(tiered, slot, used) ??
      pickFromPool(pool, slot, used);
    if (!candidate) return false;
    used.add(candidate.id);
    results.push(deriveGarmentForScoring(candidate));
    return true;
  }

  for (const slot of REQUIRED_SLOTS) pick(slot);
  for (const slot of OPTIONAL_SLOTS) pick(slot);

  return results;
}

// ── 35 Archetypes — low → high score tier ───────────────────────────────────

export const BOT_ARCHETYPES: BotArchetype[] = [
  // ── TIER 1 — Budget (avg ~38-47pts) ───────────────────────────────────────
  {
    id: "jake",
    name: "JAKE",
    bio: "High school kid who buys whatever's on the rack. Gets dressed in 30 seconds.",
    preferredBrands: ["Ripndip", "Obey", "Golf Wang"],
    tier: "budget",
    aesthetics: ["streetwear", "skate"],
  },
  {
    id: "tyler",
    name: "TYLER",
    bio: "Lives in the mall. Thinks hoodies with big logos are peak fashion.",
    preferredBrands: ["Obey", "Ripndip", "Market"],
    tier: "budget",
    aesthetics: ["streetwear"],
  },
  {
    id: "logan",
    name: "LOGAN",
    bio: "Started getting into streetwear last month. Still figuring it out.",
    preferredBrands: ["Golf Wang", "Ripndip", "Pleasures"],
    tier: "budget",
    aesthetics: ["streetwear", "skate"],
  },

  // ── TIER 2 — Mid (avg ~44-56pts) ──────────────────────────────────────────
  {
    id: "carlos",
    name: "CARLOS",
    bio: "Skates every weekend. Buys gear from brands that actually skate.",
    preferredBrands: ["Dime", "HUF", "Ripndip"],
    tier: "mid",
    aesthetics: ["skate", "streetwear"],
  },
  {
    id: "marcus",
    name: "MARCUS",
    bio: "Brooklyn native. Stays on Corteiz drops when they hit the US.",
    preferredBrands: ["Corteiz", "Awake NY", "Stussy"],
    tier: "mid",
    aesthetics: ["streetwear"],
  },
  {
    id: "deshawn",
    name: "DESHAWN",
    bio: "Deep graphic tee rotation. Buys based on artwork, not hype.",
    preferredBrands: ["Pleasures", "Golf Wang", "Awake NY"],
    tier: "mid",
    aesthetics: ["streetwear", "vintage"],
  },
  {
    id: "tommy",
    name: "TOMMY",
    bio: "Thrift-to-street. Supplements finds with pieces from brands he actually believes in.",
    preferredBrands: ["Dime", "Carrots", "Market"],
    tier: "mid",
    aesthetics: ["streetwear", "skate"],
  },
  {
    id: "kenji",
    name: "KENJI",
    bio: "Grew up skating. Knows every HUF colorway that ever dropped.",
    preferredBrands: ["HUF", "Dime", "Stussy"],
    tier: "mid",
    aesthetics: ["skate", "streetwear"],
  },
  {
    id: "riley",
    name: "RILEY",
    bio: "Art school dropout. Mixes indie labels with whatever he finds at thrift.",
    preferredBrands: ["Awake NY", "Carrots", "Market"],
    tier: "mid",
    aesthetics: ["streetwear", "vintage"],
  },
  {
    id: "sam",
    name: "SAM",
    bio: "Goes to every pop-up. Follows a dozen fashion accounts but stays low-key.",
    preferredBrands: ["Corteiz", "thisisneverthat", "Cav Empt"],
    tier: "mid",
    aesthetics: ["streetwear"],
  },

  // ── TIER 3 — Premium (avg ~56-68pts) ──────────────────────────────────────
  {
    id: "alex",
    name: "ALEX",
    bio: "Waited in line for Supreme drops before it was sold at LVMH. Real one.",
    preferredBrands: ["Supreme", "BAPE", "Palace"],
    tier: "premium",
    aesthetics: ["streetwear", "hype"],
  },
  {
    id: "noah",
    name: "NOAH",
    bio: "Gorpcore before it had a name. Functional gear that just happens to look good.",
    preferredBrands: ["Maharishi", "WTAPS", "Neighborhood"],
    tier: "premium",
    aesthetics: ["gorpcore", "workwear", "streetwear"],
  },
  {
    id: "jordan",
    name: "JORDAN",
    bio: "Japanese streetwear head. Has things you can only get in Harajuku.",
    preferredBrands: ["WTAPS", "Human Made", "Cav Empt"],
    tier: "premium",
    aesthetics: ["streetwear", "vintage"],
  },
  {
    id: "kai",
    name: "KAI",
    bio: "London guy. Follows the Palace drop calendar like a religion.",
    preferredBrands: ["Palace", "Martine Rose", "Our Legacy"],
    tier: "premium",
    aesthetics: ["streetwear", "prep"],
  },
  {
    id: "leo",
    name: "LEO",
    bio: "Vintage Japanese obsessive. Kapital farmer's market guy.",
    preferredBrands: ["Kapital", "Needles", "Wacko Maria"],
    tier: "premium",
    aesthetics: ["vintage", "workwear", "streetwear"],
  },
  {
    id: "evan",
    name: "EVAN",
    bio: "Goes to ALD on Saturdays and pretends it's casual. It's not casual.",
    preferredBrands: ["Aimé Leon Dore", "Kith", "Our Legacy"],
    tier: "premium",
    aesthetics: ["prep", "streetwear", "old-money"],
  },
  {
    id: "river",
    name: "RIVER",
    bio: "Gallery kid. Gallery Dept. was made for people like him.",
    preferredBrands: ["Gallery Dept.", "Denim Tears", "KidSuper"],
    tier: "premium",
    aesthetics: ["streetwear", "vintage", "art"],
  },
  {
    id: "mason",
    name: "MASON",
    bio: "Skates but with premium taste. HUF and Palace on repeat.",
    preferredBrands: ["HUF", "Palace", "Stussy"],
    tier: "premium",
    aesthetics: ["skate", "streetwear"],
  },
  {
    id: "victor",
    name: "VICTOR",
    bio: "Clean prep guy. Reads GQ but shops at A.P.C.",
    preferredBrands: ["A.P.C.", "Kith", "Our Legacy"],
    tier: "premium",
    aesthetics: ["prep", "old-money", "streetwear"],
  },
  {
    id: "blake",
    name: "BLAKE",
    bio: "Denim nerd. Knows every selvedge weight. Has opinions about washes.",
    preferredBrands: ["Iron Heart", "Evisu", "Naked & Famous", "Ksubi"],
    tier: "premium",
    aesthetics: ["workwear", "vintage", "streetwear"],
  },
  {
    id: "dante",
    name: "DANTE",
    bio: "Visvim and Kapital at the farmers market. Technically countryside, spiritually Tokyo.",
    preferredBrands: ["Visvim", "Kapital", "Maharishi"],
    tier: "premium",
    aesthetics: ["workwear", "vintage", "gorpcore"],
  },

  // ── TIER 4 — Luxury (avg ~65-80pts) ──────────────────────────────────────
  {
    id: "oliver",
    name: "OLIVER",
    bio: "Quiet luxury. Nothing loud, nothing obvious — you just know.",
    preferredBrands: ["The Row", "Lemaire", "Ami Paris"],
    tier: "luxury",
    aesthetics: ["quiet-luxury", "old-money", "minimalist"],
  },
  {
    id: "finn",
    name: "FINN",
    bio: "Avant-garde to the bone. Rick Owens or nothing.",
    preferredBrands: ["Rick Owens", "Julius", "Boris Bidjan Saberi"],
    tier: "luxury",
    aesthetics: ["avant-garde", "dark", "high-fashion"],
  },
  {
    id: "hugo",
    name: "HUGO",
    bio: "Luxury streetwear. Fear of God devotee. Has all the Fog Essentials too.",
    preferredBrands: ["Fear of God", "Rhude", "Off-White"],
    tier: "luxury",
    aesthetics: ["streetwear", "luxury-streetwear", "high-fashion"],
  },
  {
    id: "adrian",
    name: "ADRIAN",
    bio: "Contemporary fashion guy. Acne Studios new-season only.",
    preferredBrands: ["Acne Studios", "Marni", "Our Legacy"],
    tier: "luxury",
    aesthetics: ["high-fashion", "minimalist", "streetwear"],
  },
  {
    id: "ren",
    name: "REN",
    bio: "Tokyo conceptual. Comme des Garçons everything. Shops at DSM.",
    preferredBrands: ["Comme des Garçons", "Undercover", "Junya Watanabe"],
    tier: "luxury",
    aesthetics: ["avant-garde", "high-fashion", "streetwear"],
  },
  {
    id: "luca",
    name: "LUCA",
    bio: "European luxury guy. Lemaire fits, Ami Paris suiting.",
    preferredBrands: ["Ami Paris", "Jacquemus", "Lemaire"],
    tier: "luxury",
    aesthetics: ["high-fashion", "old-money", "quiet-luxury"],
  },
  {
    id: "felix",
    name: "FELIX",
    bio: "All black. Always black. Rick Owens or Yohji or nothing.",
    preferredBrands: ["Rick Owens", "Julius", "Yohji Yamamoto"],
    tier: "luxury",
    aesthetics: ["avant-garde", "dark", "high-fashion"],
  },
  {
    id: "theo",
    name: "THEO",
    bio: "Fashion week front row. Follows Dries, Marni, and Issey like sport.",
    preferredBrands: ["Dries Van Noten", "Marni", "Issey Miyake"],
    tier: "luxury",
    aesthetics: ["high-fashion", "avant-garde"],
  },
  {
    id: "ace",
    name: "ACE",
    bio: "Moncler in winter, Fear of God in spring. Always correct, never loud.",
    preferredBrands: ["Moncler", "Fear of God", "Off-White"],
    tier: "luxury",
    aesthetics: ["luxury-streetwear", "high-fashion", "streetwear"],
  },
  {
    id: "cole",
    name: "COLE",
    bio: "Lemaire, Studio Nicholson, The Row. Dresses like a concept.",
    preferredBrands: ["Lemaire", "Studio Nicholson", "The Row"],
    tier: "luxury",
    aesthetics: ["minimalist", "quiet-luxury", "high-fashion"],
  },
  {
    id: "zen",
    name: "ZEN",
    bio: "Future minimal. Pleats Please, Auralee, and nothing mass-market.",
    preferredBrands: ["Issey Miyake", "Auralee", "3.1 Phillip Lim"],
    tier: "luxury",
    aesthetics: ["minimalist", "high-fashion", "avant-garde"],
  },
  {
    id: "max",
    name: "MAX",
    bio: "Fear of God meets Rick Owens. The scoring algorithm was built for him.",
    preferredBrands: ["Fear of God", "Rick Owens", "Off-White"],
    tier: "luxury",
    aesthetics: ["luxury-streetwear", "avant-garde", "high-fashion"],
  },
  {
    id: "luna",
    name: "LUNA",
    bio: "Wears Dries Van Noten to dinner and Issey Miyake to the airport. Effortless.",
    preferredBrands: ["Dries Van Noten", "Issey Miyake", "Marni"],
    tier: "luxury",
    aesthetics: ["high-fashion", "avant-garde", "old-money"],
  },
];
