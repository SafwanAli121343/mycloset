export const FIT_KEYWORDS: { keyword: string; value: string }[] = [
  { keyword: "oversized", value: "oversized" },
  { keyword: "relaxed fit", value: "relaxed" },
  { keyword: "relaxed", value: "relaxed" },
  { keyword: "slim fit", value: "slim" },
  { keyword: "slim", value: "slim" },
  { keyword: "skinny", value: "skinny" },
  { keyword: "baggy", value: "baggy" },
  { keyword: "loose fit", value: "baggy" },
  { keyword: "loose", value: "baggy" },
  { keyword: "tapered", value: "tapered" },
  { keyword: "straight leg", value: "straight" },
  { keyword: "wide leg", value: "wide" },
  { keyword: "wide-leg", value: "wide" },
  { keyword: "boxy", value: "boxy" },
  { keyword: "regular fit", value: "regular" },
  { keyword: "tailored fit", value: "tailored" },
  { keyword: "tailored", value: "tailored" },
  { keyword: "athletic fit", value: "slim" },
  { keyword: "super baggy", value: "baggy" },
  { keyword: "ultra baggy", value: "baggy" },
];

export const PATTERN_KEYWORDS: { keyword: string; value: string }[] = [
  { keyword: "striped", value: "striped" },
  { keyword: "stripe", value: "striped" },
  { keyword: "plaid", value: "plaid" },
  { keyword: "camouflage", value: "camo" },
  { keyword: "camo", value: "camo" },
  { keyword: "floral", value: "floral" },
  { keyword: "checkered", value: "checkered" },
  { keyword: "houndstooth", value: "houndstooth" },
  { keyword: "tie dye", value: "tie-dye" },
  { keyword: "solid", value: "solid" },
];

export const MATERIAL_KEYWORDS: { keyword: string; value: string }[] = [
  // clothing fabrics
  { keyword: "cotton", value: "cotton" },
  { keyword: "denim", value: "denim" },
  { keyword: "fleece", value: "fleece" },
  { keyword: "wool", value: "wool" },
  { keyword: "leather", value: "leather" },
  { keyword: "corduroy", value: "corduroy" },
  { keyword: "nylon", value: "nylon" },
  { keyword: "polyester", value: "polyester" },
  { keyword: "linen", value: "linen" },
  { keyword: "cashmere", value: "cashmere" },
  { keyword: "suede", value: "suede" },
  { keyword: "canvas", value: "canvas" },
  // accessory materials — longer/more specific variants first so they match before their substrings
  { keyword: "sterling silver", value: "sterling silver" },
  { keyword: "stainless steel", value: "stainless steel" },
  { keyword: "14k gold", value: "gold" },
  { keyword: "18k gold", value: "gold" },
  { keyword: "gold filled", value: "gold" },
  { keyword: "gold plated", value: "gold" },
  { keyword: "gold", value: "gold" },
  { keyword: "silver", value: "silver" },
  { keyword: "titanium", value: "titanium" },
  { keyword: "brass", value: "brass" },
  { keyword: "copper", value: "copper" },
  { keyword: "acetate", value: "acetate" },
  { keyword: "silicone", value: "silicone" },
  { keyword: "rubber", value: "rubber" },
  { keyword: "resin", value: "resin" },
  { keyword: "ceramic", value: "ceramic" },
  { keyword: "crystal", value: "crystal" },
  { keyword: "diamond", value: "diamond" },
  { keyword: "pearl", value: "pearl" },
];

// Single source of truth for all aesthetics.
// Both per-item tagging and wardrobe gap analysis read from this list —
// a gap can never reference an aesthetic that items cannot be tagged with.
// Must also stay in sync with BRAND_AESTHETICS values.
export const KNOWN_AESTHETICS = [
  // Foundation
  "streetwear", "minimalist", "old money", "preppy", "techwear",
  "workwear", "athleisure", "formal", "business casual", "vintage",
  // Edge / subculture
  "grunge", "punk", "goth", "skate", "normcore",
  "gorpcore", "indie sleaze", "western", "bohemian", "y2k",
  "90s retro", "hip-hop", "mob wife", "surf",
  // Elevated / niche
  "quiet luxury", "avant-garde", "maximalist", "dark academia",
  "cottagecore", "coastal", "military", "ivy league", "retro",
];

// Alias kept so existing imports of AESTHETIC_TAGS continue to work.
export const AESTHETIC_TAGS = KNOWN_AESTHETICS;

// Streetwear subcultural boxes — used for the tags.streetwear_category field.
// These are more granular than AESTHETIC_TAGS and describe the specific tribe
// an item belongs to (useful for shopping recommendation matching).
export const STREETWEAR_CATEGORIES = [
  "hype-streetwear",        // Supreme, Palace, BAPE, drop-culture brands
  "skate-streetwear",       // Thrasher, Vans, Dickies, skate-influenced
  "old-money",              // Ralph Lauren, Lacoste, Brooks Brothers, heritage prep
  "athletic-prep",          // Nike, Jordan, Adidas worn in prep/collegiate context
  "gorpcore",               // North Face, Arc'teryx, outdoor-technical in fashion context
  "workwear-utility",       // Carhartt WIP, Dickies, Timberland, functional workwear
  "punk-goth",              // Dr. Martens, Chrome Hearts, Rick Owens, Saint Laurent
  "quiet-luxury",           // Loro Piana, Bottega Veneta, Loewe, subtle premium
  "maximalist-luxury",      // Gucci, Versace, Balenciaga logo-heavy
  "normcore",               // New Balance, plain basics, Gap, anti-fashion
  "techwear",               // Arc'teryx, Acronym, utility pockets and tech fabrics
  "vintage-90s",            // JNCO, Reebok, retro, era-accurate vintage pieces
  "preppy-classic",         // Polo, Lacoste, varsity, country-club aesthetic
  "y2k",                    // Von Dutch, Juicy, low-rise, bedazzled, 2000s revival
  "indie-grunge",           // Brain Dead, Gallery Dept, DIY, distressed
  "high-fashion",           // Maison Margiela, Comme des Garçons, runway pieces
  "mall-core",              // H&M, Zara, Abercrombie, mainstream accessible fashion
  "cottagecore",            // Linen, floral, pastoral, slow-fashion
];
