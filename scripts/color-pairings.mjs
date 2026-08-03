// Deterministic fashion color pairing algorithm.
// Sources: colorbux.com, restartyourstyle.com, maridfashion.com, color theory (complementary/analogous/triadic).
// Replaces GPT-generated color_pairings/clashes — eliminates hallucination, repetition, and drift.
//
// Usage:
//   import { getItemColorPairings, getItemColorClashes, normalizeColor } from "./color-pairings.mjs";
//   const pairings = getItemColorPairings(["Black", "Red"]);
//   const clashes  = getItemColorClashes(["Black", "Red"]);

// ---------------------------------------------------------------------------
// Canonical color normalization — maps GPT outputs to our canonical palette
// ---------------------------------------------------------------------------
const COLOR_ALIASES = {
  // Blacks / Darks
  "jet black": "Black", "pitch black": "Black", "ebony": "Black",
  // Whites
  "pure white": "White", "bright white": "White", "optical white": "White",
  // Off-whites → Cream
  "off-white": "Cream", "off white": "Cream", "ivory": "Cream",
  "ecru": "Cream", "bone": "Cream", "sail": "Cream", "natural": "Cream",
  "parchment": "Cream", "linen": "Cream",
  // Grays
  "grey": "Gray", "dove gray": "Gray", "dove grey": "Gray", "mid gray": "Gray",
  "light gray": "Light Gray", "light grey": "Light Gray",
  "heather": "Heather Gray", "heather grey": "Heather Gray",
  "ash": "Ash Gray", "slate": "Charcoal", "dark gray": "Charcoal", "dark grey": "Charcoal",
  "slate gray": "Charcoal", "slate grey": "Charcoal",
  // Browns
  "dark brown": "Chocolate", "deep brown": "Chocolate",
  "medium brown": "Brown", "warm brown": "Brown",
  "espresso": "Chocolate", "mocha": "Chocolate", "mahogany": "Chocolate",
  "chestnut": "Brown", "walnut": "Brown",
  "caramel": "Camel", "toffee": "Camel", "biscuit": "Camel", "honey": "Camel",
  "khaki": "Tan", "wheat": "Tan", "sand": "Tan", "stone": "Beige",
  "oatmeal": "Beige", "taupe": "Beige", "mushroom": "Beige",
  // Reds
  "crimson": "Red", "scarlet": "Red", "cherry": "Red", "bright red": "Red",
  "brick": "Brick Red", "brick red": "Brick Red", "cardinal": "Red",
  "burgundy": "Burgundy", "wine": "Burgundy", "oxblood": "Burgundy",
  "maroon": "Maroon", "dark red": "Maroon",
  "rust": "Rust", "burnt sienna": "Rust", "brick orange": "Rust",
  "terracotta": "Terracotta", "clay": "Terracotta", "sienna": "Terracotta",
  "coral": "Coral", "tomato": "Coral",
  "salmon": "Salmon", "peach": "Salmon",
  // Pinks
  "blush": "Blush", "dusty pink": "Blush", "rose pink": "Blush", "pale pink": "Blush",
  "baby pink": "Pink", "soft pink": "Pink", "light pink": "Pink",
  "hot pink": "Hot Pink", "neon pink": "Hot Pink",
  "fuchsia": "Fuchsia", "magenta": "Fuchsia",
  "mauve": "Mauve", "lilac pink": "Mauve",
  // Purples
  "violet": "Purple", "plum": "Purple", "eggplant": "Purple",
  "lavender": "Lavender", "lilac": "Lavender", "periwinkle lavender": "Lavender",
  // Blues
  "dark navy": "Navy", "midnight blue": "Navy", "dark blue": "Navy",
  "royal blue": "Cobalt", "electric blue": "Cobalt",
  "sky blue": "Sky Blue", "baby blue": "Sky Blue", "powder blue": "Sky Blue",
  "periwinkle": "Sky Blue", "steel blue": "Sky Blue",
  "teal": "Teal", "turquoise": "Teal", "cyan": "Teal", "aqua": "Teal",
  "seafoam": "Sage", "mint green": "Mint",
  // Greens
  "olive green": "Olive", "army green": "Olive", "military green": "Olive",
  "hunter green": "Forest Green", "dark green": "Forest Green",
  "kelly green": "Green", "bright green": "Green", "grass green": "Green",
  "emerald green": "Emerald", "bottle green": "Emerald",
  "sage green": "Sage", "dusty green": "Sage",
  "lime green": "Lime", "neon green": "Lime", "chartreuse": "Lime",
  "mint": "Mint",
  // Yellows/Oranges
  "mustard yellow": "Mustard", "golden yellow": "Mustard", "ochre": "Mustard",
  "yellow": "Yellow", "canary": "Yellow", "lemon": "Yellow",
  "butter": "Yellow", "light yellow": "Yellow",
  "gold": "Gold", "golden": "Gold", "antique gold": "Gold",
  "bronze": "Bronze", "rose gold": "Rose Gold",
  "orange": "Orange", "bright orange": "Orange",
  "burnt orange": "Rust", "amber": "Rust",
  "apricot": "Salmon", "peach": "Salmon",
  // Silvers/Metallics
  "silver": "Silver", "metallic silver": "Silver", "chrome": "Silver",
  "platinum": "Silver", "gunmetal": "Charcoal",
  "metallic": "Silver", "metallic gold": "Gold",
  // Denim
  "denim": "Denim Blue", "indigo": "Denim Blue", "washed blue": "Denim Blue",
  "light denim": "Sky Blue", "dark denim": "Navy",
  "multicolor": "Multicolor", "multi": "Multicolor", "multi-color": "Multicolor",
  "clear": "Cream", "transparent": "Cream",
};

export function normalizeColor(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return COLOR_ALIASES[lower] || raw.replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ---------------------------------------------------------------------------
// Core fashion color map
// Each entry: { pairings: string[], clashes: string[] }
// Pairings = what you can wear WITH this color
// Clashes  = what actively fights this color in an outfit
// ---------------------------------------------------------------------------
const COLOR_MAP = {

  // ── Neutrals ─────────────────────────────────────────────────────────────

  "Black": {
    pairings: [
      "White","Cream","Gray","Charcoal","Silver","Red","Burgundy","Navy",
      "Cobalt","Royal Blue","Hot Pink","Fuchsia","Purple","Emerald",
      "Forest Green","Gold","Bronze","Camel","Tan","Olive","Sage",
      "Orange","Yellow","Mustard","Lavender","Blush","Coral","Teal",
      "Mint","Rust","Terracotta",
    ],
    clashes: [
      "Chocolate", // near-black browns create muddy undefined look
    ],
  },

  "White": {
    pairings: [
      "Black","Navy","Gray","Charcoal","Cobalt","Royal Blue","Red","Burgundy",
      "Emerald","Forest Green","Olive","Camel","Tan","Brown","Gold","Orange",
      "Coral","Blush","Pink","Hot Pink","Lavender","Sage","Teal","Rust",
      "Terracotta","Mustard","Purple","Denim Blue",
    ],
    clashes: [
      "Cream","Ivory","Silver", // too similar — insufficient contrast
    ],
  },

  "Cream": {
    pairings: [
      "Black","Navy","Chocolate","Brown","Camel","Tan","Gray","Charcoal",
      "Burgundy","Maroon","Rust","Terracotta","Olive","Forest Green",
      "Sage","Blush","Mauve","Lavender","Mustard","Gold","Teal",
      "Denim Blue","Cobalt","Emerald",
    ],
    clashes: [
      "White","Ivory","Beige","Silver", // too similar — wash each other out
      "Yellow","Lime",                   // low contrast on warm base
    ],
  },

  "Ivory": {
    pairings: [
      "Black","Navy","Brown","Camel","Burgundy","Olive","Gray","Charcoal",
      "Chocolate","Rust","Terracotta","Gold","Forest Green",
    ],
    clashes: ["White","Cream","Beige","Silver"],
  },

  "Gray": {
    pairings: [
      "Black","White","Cream","Navy","Cobalt","Royal Blue","Red","Burgundy",
      "Blush","Pink","Hot Pink","Lavender","Sage","Emerald","Mustard",
      "Camel","Teal","Denim Blue",
    ],
    clashes: [
      "Brown","Tan","Khaki","Beige", // similar luminance — muddy
      "Olive",                        // undertones fight (gray cool vs olive warm)
    ],
  },

  "Charcoal": {
    pairings: [
      "White","Cream","Gray","Black","Navy","Red","Burgundy","Blush",
      "Sage","Olive","Camel","Mustard","Cobalt","Teal","Emerald","Gold",
      "Hot Pink","Orange",
    ],
    clashes: [
      "Brown","Dark Brown","Chocolate", // dark-on-dark, muddy
    ],
  },

  "Heather Gray": {
    pairings: ["White","Cream","Navy","Burgundy","Red","Blush","Lavender","Sage"],
    clashes: ["Brown","Tan","Beige","Olive"],
  },

  "Light Gray": {
    pairings: ["White","Navy","Burgundy","Red","Cobalt","Blush","Pink","Lavender"],
    clashes: ["Cream","Beige","Brown"],
  },

  "Ash Gray": {
    pairings: ["White","Black","Navy","Burgundy","Red","Blush","Lavender"],
    clashes: ["Brown","Tan","Beige"],
  },

  "Silver": {
    pairings: [
      "Black","Navy","Charcoal","Gray","Purple","Cobalt","Hot Pink",
      "Burgundy","Emerald","White",
    ],
    clashes: [
      "Cream","Gold","Bronze","Beige","Tan", // metallic clash; insufficient contrast with off-whites
    ],
  },

  "Platinum": {
    pairings: ["Black","Navy","Gray","Purple","Cobalt","White"],
    clashes: ["Cream","Gold","Bronze","Beige"],
  },

  "Bronze": {
    pairings: ["Black","Navy","Burgundy","Brown","Chocolate","Forest Green","Cream"],
    clashes: ["Silver","Gray","Cream","Tan"], // warm/cool metallic conflict
  },

  "Rose Gold": {
    pairings: ["Black","Navy","Gray","Burgundy","Blush","Cream","White"],
    clashes: ["Silver","Gold","Tan","Camel"],
  },

  // ── Browns & Earth Tones ──────────────────────────────────────────────────

  "Brown": {
    pairings: [
      "Cream","Camel","Tan","Olive","Rust","Terracotta","Navy","Burgundy",
      "Mustard","Sage","White","Beige","Forest Green","Gold",
    ],
    clashes: [
      "Gray","Black",  // similar luminance; dark-on-dark muddy
      "Purple","Maroon", // similar dark tone without enough contrast
    ],
  },

  "Chocolate": {
    pairings: [
      "Cream","Camel","Olive","Rust","Sage","Mustard","Gold","Tan",
      "White","Forest Green","Burgundy",
    ],
    clashes: [
      "Gray","Maroon","Burgundy", // brown + warm dark red = indistinct
      "Black",                     // too similar in dark spectrum
    ],
  },

  "Espresso": {
    pairings: ["Cream","Camel","Olive","Tan","Rust","Mustard","Sage","Forest Green"],
    clashes: ["Gray","Maroon","Black","Burgundy"],
  },

  "Chestnut": {
    pairings: ["Cream","Camel","Tan","Olive","Rust","Mustard","Gold"],
    clashes: ["Gray","Maroon","Burgundy"],
  },

  "Camel": {
    pairings: [
      "White","Cream","Black","Brown","Tan","Navy","Olive","Rust","Burgundy",
      "Gray","Mustard","Charcoal","Sage","Forest Green","Chocolate",
    ],
    clashes: [
      "Yellow","Beige","Tan",  // too similar in warmth
    ],
  },

  "Tan": {
    pairings: [
      "Brown","Cream","Camel","White","Olive","Rust","Burgundy","Navy",
      "Teal","Sage","Chocolate",
    ],
    clashes: [
      "Beige","Gold","Yellow", // too similar in value
      "Gray",
    ],
  },

  "Beige": {
    pairings: [
      "White","Cream","Brown","Camel","Tan","Navy","Gray","Olive","Burgundy",
      "Sage","Rust","Chocolate","Denim Blue",
    ],
    clashes: [
      "Yellow","Lime","Silver", // low contrast
    ],
  },

  "Taupe": {
    pairings: [
      "Cream","Camel","Navy","Burgundy","Olive","Sage","Blush","Brown",
    ],
    clashes: [
      "Gray","Silver","White", // insufficient contrast
    ],
  },

  "Sand": {
    pairings: ["Cream","Brown","Olive","Navy","Burgundy","Rust","Sage"],
    clashes: ["Gray","Silver","Yellow"],
  },

  "Khaki": {
    pairings: [
      "White","Cream","Navy","Brown","Olive","Rust","Camel","Sage","Burgundy",
    ],
    clashes: ["Yellow","Lime","Bright Green","Silver"],
  },

  "Stone": {
    pairings: ["Cream","Brown","Navy","Burgundy","Olive","Sage"],
    clashes: ["Gray","Silver"],
  },

  // ── Reds ─────────────────────────────────────────────────────────────────

  "Red": {
    pairings: [
      "Black","White","Navy","Denim Blue","Blue","Cream","Gray","Charcoal",
      "Camel","Gold","Mustard",
    ],
    clashes: [
      "Green","Orange",          // Christmas / vibrate at high sat
      "Pink","Magenta","Fuchsia","Hot Pink", // hue too close
      "Maroon","Burgundy","Wine", // too similar, no contrast
    ],
  },

  "Crimson": {
    pairings: ["Black","White","Navy","Cream","Gray","Charcoal","Gold"],
    clashes: ["Green","Orange","Pink","Magenta","Maroon","Burgundy"],
  },

  "Brick Red": {
    pairings: ["Cream","Tan","Navy","Olive","Camel","White","Gray"],
    clashes: ["Orange","Pink","Red","Burgundy"],
  },

  "Burgundy": {
    pairings: [
      "White","Cream","Gray","Charcoal","Blush","Pink","Dusty Pink","Mauve",
      "Navy","Sky Blue","Denim Blue","Camel","Tan","Gold","Sage","Lavender",
      "Olive","Forest Green","Mustard","Beige",
    ],
    clashes: [
      "Brown","Chocolate","Espresso",  // too similar in warm dark territory
      "Orange","Red",                   // adjacent on warm spectrum, fight each other
      "Maroon",                         // almost identical
    ],
  },

  "Wine": {
    pairings: ["White","Cream","Gray","Blush","Camel","Gold","Sage","Olive","Navy"],
    clashes: ["Brown","Maroon","Red","Purple","Orange"],
  },

  "Maroon": {
    pairings: ["White","Cream","Gray","Camel","Tan","Sage"],
    clashes: ["Brown","Burgundy","Red","Wine","Orange"],
  },

  "Rust": {
    pairings: [
      "Cream","Camel","Brown","Olive","Navy","Mustard","Sage","Burgundy",
      "Tan","Forest Green","White",
    ],
    clashes: [
      "Gray","Silver",  // cool/warm clash
      "Orange",         // too similar in hue
      "Red","Pink",     // fight in the warm-red zone
    ],
  },

  "Terracotta": {
    pairings: [
      "Cream","Camel","Tan","Brown","Olive","Sage","Navy","White","Mustard",
      "Burgundy","Forest Green",
    ],
    clashes: [
      "Red","Pink","Gray","Silver", // undertone clashes
    ],
  },

  // ── Pinks & Corals ────────────────────────────────────────────────────────

  "Coral": {
    pairings: [
      "White","Cream","Navy","Teal","Brown","Camel","Gold","Sage","Sky Blue",
    ],
    clashes: [
      "Red","Pink","Orange", // too similar in hue
      "Lime","Yellow-Green",
    ],
  },

  "Salmon": {
    pairings: ["White","Cream","Navy","Gray","Sage","Camel","Olive"],
    clashes: ["Red","Orange","Hot Pink","Lime"],
  },

  "Blush": {
    pairings: [
      "White","Cream","Burgundy","Navy","Gray","Sage","Lavender","Mauve",
      "Olive","Brown","Charcoal","Gold","Forest Green",
    ],
    clashes: [
      "Orange","Red","Hot Pink","Lime","Yellow", // vibrancy clash
    ],
  },

  "Pink": {
    pairings: [
      "White","Black","Navy","Gray","Burgundy","Cobalt","Sage","Blush",
      "Coral","Mint","Camel","Cream","Forest Green",
    ],
    clashes: [
      "Red","Orange","Hot Pink", // vibrate at similar saturation
      "Yellow-Green",
    ],
  },

  "Hot Pink": {
    pairings: [
      "Black","White","Navy","Gray","Cobalt","Charcoal","Sage",
    ],
    clashes: [
      "Red","Orange","Pink","Purple","Lime", // vibrate or fight
    ],
  },

  "Fuchsia": {
    pairings: ["Black","White","Navy","Charcoal","Gray"],
    clashes: ["Red","Orange","Pink","Purple","Hot Pink"],
  },

  "Magenta": {
    pairings: ["Black","White","Charcoal","Navy","Gray"],
    clashes: ["Red","Orange","Pink","Purple"], // adjacent on color wheel
  },

  "Mauve": {
    pairings: [
      "White","Cream","Gray","Navy","Sage","Blush","Lavender","Burgundy",
    ],
    clashes: ["Orange","Red","Hot Pink","Lime"],
  },

  "Peach": {
    pairings: ["Cream","White","Navy","Sage","Brown","Olive","Camel"],
    clashes: ["Orange","Red","Pink","Hot Pink"],
  },

  "Apricot": {
    pairings: ["Cream","White","Navy","Sage","Brown","Camel"],
    clashes: ["Orange","Red","Pink","Hot Pink"],
  },

  // ── Purples ───────────────────────────────────────────────────────────────

  "Purple": {
    pairings: [
      "White","Cream","Gray","Black","Silver","Blush","Navy","Charcoal",
    ],
    clashes: [
      "Yellow","Orange","Brown","Green","Red", // complementary danger zone; brown clash
    ],
  },

  "Violet": {
    pairings: ["White","Gray","Black","Silver","Blush","Cream","Navy"],
    clashes: ["Yellow","Orange","Brown","Green"],
  },

  "Plum": {
    pairings: ["Cream","White","Gray","Silver","Blush","Gold","Navy"],
    clashes: ["Yellow","Orange","Brown","Green"],
  },

  "Eggplant": {
    pairings: ["Cream","White","Gray","Silver","Blush","Navy"],
    clashes: ["Yellow","Orange","Brown","Green"],
  },

  "Lavender": {
    pairings: [
      "White","Cream","Gray","Blush","Navy","Sage","Dusty Pink","Burgundy",
      "Mauve","Camel",
    ],
    clashes: [
      "Yellow","Orange","Red","Lime","Bright Green", // saturation clash
    ],
  },

  "Lilac": {
    pairings: ["White","Cream","Gray","Sage","Blush","Navy"],
    clashes: ["Orange","Yellow","Red","Bright Green"],
  },

  // ── Blues ─────────────────────────────────────────────────────────────────

  "Navy": {
    pairings: [
      "White","Cream","Beige","Camel","Tan","Gray","Red","Coral","Orange",
      "Burgundy","Pink","Blush","Lavender","Olive","Sage","Mustard","Gold",
      "Sky Blue","Cobalt","Mint","Forest Green","Rust","Terracotta","Brown",
    ],
    clashes: [
      "Black",          // too dark on dark
      "Dark Chocolate", // similar dark value
      "Purple","Teal",  // color wheel conflict at dark saturation
    ],
  },

  "Blue": {
    pairings: [
      "White","Cream","Beige","Navy","Gray","Orange","Rust","Coral",
      "Pink","Blush","Burgundy","Gold","Mustard","Camel","Brown",
    ],
    clashes: [
      "Green","Purple", // triadic danger zone at similar saturation
    ],
  },

  "Cobalt": {
    pairings: [
      "White","Cream","Gold","Orange","Rust","Gray","Charcoal","Burgundy",
      "Camel","Black","Coral",
    ],
    clashes: [
      "Green","Purple","Navy", // too similar to Navy
    ],
  },

  "Royal Blue": {
    pairings: ["White","Cream","Gold","Orange","Burgundy","Gray","Silver","Black"],
    clashes: ["Green","Navy","Purple"],
  },

  "Steel Blue": {
    pairings: ["White","Cream","Navy","Gray","Pink","Blush","Coral","Burgundy","Camel"],
    clashes: ["Green","Orange","Purple"],
  },

  "Denim Blue": {
    pairings: [
      "White","Cream","Black","Gray","Brown","Red","Camel","Tan","Olive",
      "Sage","Rust","Terracotta","Burgundy","Orange","Mustard",
    ],
    clashes: [
      "Navy","Cobalt","Bright Blue", // denim-on-denim requires care; similar blue-on-blue clashes
    ],
  },

  "Sky Blue": {
    pairings: [
      "White","Cream","Navy","Gray","Pink","Blush","Coral","Burgundy","Camel",
    ],
    clashes: ["Green","Orange","Lime","Yellow-Green"],
  },

  "Baby Blue": {
    pairings: ["White","Cream","Navy","Gray","Pink","Blush","Burgundy"],
    clashes: ["Green","Orange","Lime"],
  },

  "Periwinkle": {
    pairings: ["White","Cream","Navy","Gray","Pink","Blush","Burgundy","Lavender"],
    clashes: ["Green","Orange","Yellow-Green"],
  },

  "Teal": {
    pairings: [
      "Cream","Tan","Camel","Brown","White","Coral","Pink","Burgundy","Sage",
    ],
    clashes: [
      "Green","Blue",        // too similar in hue
      "Orange","Red",        // vibrate
      "Gold","Yellow",       // turquoise + gold doesn't work in clothing (colorbux)
    ],
  },

  "Turquoise": {
    pairings: ["Cream","Tan","White","Coral","Pink","Brown","Camel"],
    clashes: ["Green","Blue","Orange","Red","Gold","Yellow"],
  },

  "Mint": {
    pairings: ["White","Cream","Pink","Blush","Navy","Camel","Gray"],
    clashes: ["Orange","Red","Yellow-Green","Lime","Bright Yellow"],
  },

  "Seafoam": {
    pairings: ["White","Cream","Pink","Navy","Gray","Camel"],
    clashes: ["Orange","Red","Lime","Yellow"],
  },

  // ── Greens ────────────────────────────────────────────────────────────────

  "Green": {
    pairings: [
      "White","Cream","Brown","Tan","Camel","Gold","Black","Navy","Burgundy",
    ],
    clashes: [
      "Red","Orange",     // Christmas effect
      "Yellow","Lime",    // adjacent on wheel, vibrate
      "Blue","Purple",    // triadic conflicts
    ],
  },

  "Kelly Green": {
    pairings: ["White","Cream","Black","Navy","Gold","Brown","Camel"],
    clashes: ["Red","Orange","Yellow","Blue","Purple"],
  },

  "Emerald": {
    pairings: [
      "Black","White","Gold","Navy","Cream","Burgundy","Gray","Charcoal",
    ],
    clashes: [
      "Red","Orange","Purple", // Christmas; clash
    ],
  },

  "Forest Green": {
    pairings: [
      "Cream","Camel","Tan","Brown","Gold","Rust","Burgundy","White","Navy",
    ],
    clashes: ["Red","Orange","Bright Yellow","Purple"],
  },

  "Hunter Green": {
    pairings: ["Cream","Camel","Tan","Brown","Gold","Rust","Burgundy","White"],
    clashes: ["Red","Orange","Bright Yellow"],
  },

  "Olive": {
    pairings: [
      "Cream","Rust","Camel","Brown","Tan","Chocolate","Navy","Mustard",
      "White","Sage","Burgundy","Forest Green","Terracotta",
    ],
    clashes: [
      "Gray","Silver",      // cool/warm undertone fight
      "Lime","Neon",        // vibrancy contrast
      "Light Blue","Sky Blue","Teal", // undertones fight warm olive
    ],
  },

  "Army Green": {
    pairings: ["Cream","Camel","Tan","Brown","Rust","Navy","Mustard","Burgundy"],
    clashes: ["Gray","Silver","Lime","Bright Blue","Purple"],
  },

  "Sage": {
    pairings: [
      "White","Cream","Blush","Burgundy","Navy","Camel","Brown","Lavender",
      "Mauve","Gold","Rust","Olive",
    ],
    clashes: [
      "Gray",                  // similar muted value
      "Red","Hot Pink",        // vibrancy contrast
      "Bright Yellow","Lime",  // oversaturated against muted sage
    ],
  },

  "Lime": {
    pairings: ["White","Black","Gray","Navy","Charcoal"],
    clashes: [
      "Yellow","Yellow-Green","Orange","Red","Pink", // adjacent hue vibration
    ],
  },

  // ── Yellows & Oranges ─────────────────────────────────────────────────────

  "Yellow": {
    pairings: [
      "Navy","Black","Gray","Cobalt","Purple","White","Brown",
    ],
    clashes: [
      "Orange","Green",    // triadic danger
      "Camel","Nude","Beige", // too similar to skin tone (colorbux: nude+yellow danger zone)
      "Gold","Mustard",    // too similar in hue
    ],
  },

  "Mustard": {
    pairings: [
      "Navy","Brown","Black","Burgundy","Olive","Rust","Cream","Camel",
      "Charcoal","Forest Green","White",
    ],
    clashes: [
      "Yellow","Orange",  // too similar; fight
      "Gray","Silver",    // undertone clash
    ],
  },

  "Gold": {
    pairings: [
      "Black","Navy","Burgundy","Brown","Chocolate","Emerald","Cobalt",
      "White","Cream","Forest Green","Royal Blue","Purple",
    ],
    clashes: [
      "Silver","Platinum",   // metallic clash
      "Yellow","Camel","Tan","Beige", // too similar in warmth/value
      "Teal","Turquoise",    // gold + turquoise doesn't work in clothing (colorbux)
    ],
  },

  "Butter": {
    pairings: ["White","Cream","Navy","Brown","Camel","Olive","Sage"],
    clashes: ["Yellow","Gold","Silver","Gray"],
  },

  "Honey": {
    pairings: ["Brown","Cream","Camel","Burgundy","Navy","Black"],
    clashes: ["Yellow","Silver","Gray"],
  },

  "Orange": {
    pairings: [
      "Navy","Blue","Black","White","Brown","Cream","Cobalt","Burgundy",
    ],
    clashes: [
      "Red","Pink",    // too close in hue
      "Green","Yellow", // triadic issues
      "Purple",         // complementary overcrowding
    ],
  },

  "Burnt Orange": {
    pairings: ["Cream","Navy","Brown","Camel","Black","White","Olive"],
    clashes: ["Red","Pink","Green","Yellow","Gray"],
  },

  "Amber": {
    pairings: ["Brown","Cream","Camel","Burgundy","Navy","Black","Forest Green"],
    clashes: ["Yellow","Silver","Gray"],
  },

  "Caramel": {
    pairings: ["Cream","Brown","Olive","Sage","Navy","Black","Burgundy"],
    clashes: ["Yellow","Silver","Gray"],
  },

  "Wheat": {
    pairings: ["Cream","Brown","Olive","Navy","Burgundy"],
    clashes: ["Yellow","Silver","Gray"],
  },

  // ── Multicolor ────────────────────────────────────────────────────────────

  "Multicolor": {
    // With multicolor items, best to pair with neutral anchors only
    pairings: ["Black","White","Gray","Navy","Cream","Charcoal"],
    clashes: [], // too context-dependent to list clashes
  },
};

// ---------------------------------------------------------------------------
// Tonal families — colors in the same family that form valid monochromatic/
// tonal looks. Prepended to pairings so "same color" outfits rank first.
// Sources: colorbux.com ("tonal dressing"), restartyourstyle.com.
// ---------------------------------------------------------------------------
const TONAL_FAMILY = {
  "Black":        ["Charcoal", "Gray", "Black"],
  "Charcoal":     ["Black", "Gray", "Silver", "Charcoal"],
  "Gray":         ["Charcoal", "Silver", "Heather Gray", "Light Gray", "Gray"],
  "Silver":       ["Gray", "Charcoal", "Silver"],
  "Heather Gray": ["Gray", "Charcoal", "Heather Gray"],
  "Light Gray":   ["Gray", "Silver", "Light Gray"],
  "White":        ["Cream", "Ivory", "White"],
  "Cream":        ["White", "Ivory", "Beige", "Cream"],
  "Beige":        ["Cream", "Tan", "Camel", "Beige"],
  "Ivory":        ["White", "Cream", "Ivory"],
  "Navy":         ["Cobalt", "Denim Blue", "Blue", "Navy"],
  "Blue":         ["Navy", "Cobalt", "Denim Blue", "Sky Blue", "Blue"],
  "Cobalt":       ["Navy", "Blue", "Royal Blue", "Cobalt"],
  "Denim Blue":   ["Navy", "Blue", "Cobalt", "Denim Blue"],
  "Sky Blue":     ["Baby Blue", "Periwinkle", "Blue", "Sky Blue"],
  "Baby Blue":    ["Sky Blue", "Periwinkle", "Baby Blue"],
  "Periwinkle":   ["Sky Blue", "Baby Blue", "Lavender", "Periwinkle"],
  "Brown":        ["Chocolate", "Camel", "Tan", "Brown"],
  "Chocolate":    ["Brown", "Espresso", "Camel", "Chocolate"],
  "Camel":        ["Tan", "Beige", "Brown", "Camel"],
  "Tan":          ["Camel", "Beige", "Brown", "Tan"],
  "Espresso":     ["Chocolate", "Brown", "Espresso"],
  "Burgundy":     ["Wine", "Maroon", "Burgundy"],
  "Wine":         ["Burgundy", "Maroon", "Wine"],
  "Maroon":       ["Burgundy", "Wine", "Maroon"],
  "Brick Red":    ["Burgundy", "Rust", "Brick Red"],
  "Red":          ["Burgundy", "Rust", "Red"],         // bold — monochromatic valid but striking
  "Orange":       ["Rust", "Terracotta", "Orange"],    // bold — tonal is safer than exact-match
  "Rust":         ["Terracotta", "Orange", "Brown", "Rust"],
  "Terracotta":   ["Rust", "Brown", "Camel", "Terracotta"],
  "Yellow":       ["Mustard", "Gold", "Yellow"],       // bold
  "Mustard":      ["Gold", "Yellow", "Olive", "Mustard"],
  "Gold":         ["Mustard", "Yellow", "Bronze", "Gold"],
  "Bronze":       ["Gold", "Brown", "Bronze"],
  "Rose Gold":    ["Gold", "Pink", "Blush", "Rose Gold"],
  "Olive":        ["Army Green", "Mustard", "Sage", "Olive"],
  "Army Green":   ["Olive", "Forest Green", "Khaki", "Army Green"],
  "Forest Green": ["Hunter Green", "Army Green", "Emerald", "Forest Green"],
  "Hunter Green": ["Forest Green", "Army Green", "Hunter Green"],
  "Emerald":      ["Forest Green", "Hunter Green", "Emerald"],
  "Green":        ["Forest Green", "Emerald", "Green"],
  "Kelly Green":  ["Green", "Emerald", "Kelly Green"],
  "Sage":         ["Olive", "Mint", "Seafoam", "Sage"],
  "Mint":         ["Seafoam", "Sage", "Teal", "Mint"],
  "Seafoam":      ["Mint", "Sage", "Teal", "Seafoam"],
  "Teal":         ["Turquoise", "Seafoam", "Mint", "Teal"],
  "Turquoise":    ["Teal", "Mint", "Turquoise"],
  "Purple":       ["Lavender", "Violet", "Purple"],
  "Lavender":     ["Purple", "Mauve", "Periwinkle", "Lavender"],
  "Mauve":        ["Lavender", "Blush", "Pink", "Mauve"],
  "Pink":         ["Blush", "Mauve", "Dusty Pink", "Pink"],
  "Blush":        ["Pink", "Mauve", "Dusty Pink", "Blush"],
  "Hot Pink":     ["Pink", "Fuchsia", "Hot Pink"],
  "Fuchsia":      ["Hot Pink", "Purple", "Fuchsia"],
  "Coral":        ["Salmon", "Terracotta", "Orange", "Coral"],
  "Salmon":       ["Coral", "Blush", "Pink", "Salmon"],
  "Lime":         ["Green", "Yellow", "Lime"],
  "Camel":        ["Tan", "Beige", "Brown", "Camel"],
};

// ---------------------------------------------------------------------------
// Default fallbacks for unmapped colors
// ---------------------------------------------------------------------------
function getDefaultPairings(color) {
  const lower = (color || "").toLowerCase();
  if (lower.includes("gray") || lower.includes("grey")) return COLOR_MAP["Gray"].pairings;
  if (lower.includes("blue")) return COLOR_MAP["Blue"].pairings;
  if (lower.includes("green")) return COLOR_MAP["Green"].pairings;
  if (lower.includes("red") || lower.includes("pink")) return COLOR_MAP["Red"].pairings;
  if (lower.includes("brown") || lower.includes("tan")) return COLOR_MAP["Brown"].pairings;
  if (lower.includes("purple") || lower.includes("violet")) return COLOR_MAP["Purple"].pairings;
  if (lower.includes("orange")) return COLOR_MAP["Orange"].pairings;
  if (lower.includes("yellow") || lower.includes("gold")) return COLOR_MAP["Yellow"].pairings;
  return COLOR_MAP["Black"].pairings; // safest fallback
}

function getDefaultClashes(color) {
  const lower = (color || "").toLowerCase();
  if (lower.includes("gray") || lower.includes("grey")) return COLOR_MAP["Gray"].clashes;
  if (lower.includes("blue")) return COLOR_MAP["Blue"].clashes;
  if (lower.includes("green")) return COLOR_MAP["Green"].clashes;
  if (lower.includes("red") || lower.includes("pink")) return COLOR_MAP["Red"].clashes;
  if (lower.includes("brown") || lower.includes("tan")) return COLOR_MAP["Brown"].clashes;
  if (lower.includes("purple") || lower.includes("violet")) return COLOR_MAP["Purple"].clashes;
  if (lower.includes("orange")) return COLOR_MAP["Orange"].clashes;
  if (lower.includes("yellow") || lower.includes("gold")) return COLOR_MAP["Yellow"].clashes;
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns an array of colors that pair well with this item.
 * @param {string[]} colors - ordered array of the item's colors (e.g. tags.colors)
 * @returns {string[]} list of colors that go well with the item
 */
export function getItemColorPairings(colors) {
  if (!colors?.length) return [];
  const primary = normalizeColor(colors[0]);
  const secondary = colors[1] ? normalizeColor(colors[1]) : null;

  // Tonal/monochromatic options first — wearing same-family shades is always valid.
  // This enables all-black, all-navy, tonal brown looks, etc.
  const tonalColors = TONAL_FAMILY[primary] || [primary];
  const tonalSet = new Set(tonalColors);

  // Standard cross-color pairings from the map
  const primaryEntry = COLOR_MAP[primary];
  let crossPairings = [...(primaryEntry?.pairings || getDefaultPairings(primary))];

  // If secondary color exists, filter cross-pairings that clash WITH the secondary.
  // Never filter tonal options — tonal dressing overrides secondary clash rules.
  if (secondary) {
    const secEntry = COLOR_MAP[secondary];
    const secClashes = new Set(secEntry?.clashes || getDefaultClashes(secondary));
    crossPairings = crossPairings.filter(c => !secClashes.has(c));
  }

  // Combine: tonal first, then cross-color pairings.
  // Do NOT remove the item's own color — monochromatic outfits are fashion-valid.
  return [...new Set([...tonalColors, ...crossPairings])];
}

/**
 * Returns an array of colors that actively clash with this item.
 * @param {string[]} colors - ordered array of the item's colors (e.g. tags.colors)
 * @returns {string[]} list of colors that clash with the item
 */
export function getItemColorClashes(colors) {
  if (!colors?.length) return [];

  // Union of clashes for ALL item colors
  const allClashes = new Set();
  for (const color of colors) {
    const norm = normalizeColor(color);
    const entry = COLOR_MAP[norm];
    for (const clash of (entry?.clashes || getDefaultClashes(norm))) {
      allClashes.add(clash);
    }
  }

  // Remove the item's own colors from clashes
  const itemColorSet = new Set(colors.map(c => normalizeColor(c)));
  return [...allClashes].filter(c => !itemColorSet.has(c));
}

/**
 * Single-color lookup — useful for testing or direct queries.
 */
export function getColorPairings(color) {
  const norm = normalizeColor(color);
  const entry = COLOR_MAP[norm];
  return entry?.pairings || getDefaultPairings(norm);
}

export function getColorClashes(color) {
  const norm = normalizeColor(color);
  const entry = COLOR_MAP[norm];
  return entry?.clashes || getDefaultClashes(norm);
}

export { COLOR_MAP };
