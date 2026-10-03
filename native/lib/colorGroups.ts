// Direct port of lib/constants/colors.ts's grouping logic (COLOR_GROUPS/normalizeColorName/
// sameColorGroup only — NAMED_COLORS/rgb swatches aren't needed here). Kept in sync by hand,
// same convention as the rest of native/lib — see garmentSlots.ts.
export const COLOR_GROUPS: string[][] = [
  ["olive", "moss", "army green", "military green", "dark olive", "olive green", "khaki green", "camo", "camouflage", "woodland camo", "desert camo", "green"],
  ["sage", "sage green", "dusty sage", "celadon", "mint green", "mint", "seafoam"],
  ["forest green", "hunter green", "dark green", "bottle green"],
  ["lime", "kelly green", "emerald"],
  ["burgundy", "wine", "maroon", "oxblood", "merlot", "claret", "bordeaux", "crimson"],
  ["navy", "navy blue", "midnight blue", "dark navy", "deep navy"],
  ["cream", "off-white", "ivory", "bone", "eggshell", "ecru", "butter", "beige", "sand", "tan", "camel", "khaki", "wheat", "fawn", "biscuit", "oatmeal", "linen"],
  ["charcoal", "dark grey", "dark gray", "anthracite", "graphite"],
  ["grey", "gray", "slate gray", "slate grey", "heather gray", "heather grey", "medium gray"],
  ["light gray", "light grey", "ash gray", "ash grey", "silver", "platinum"],
  ["brown", "chocolate", "chestnut", "walnut", "mocha", "espresso", "mahogany", "cognac", "tobacco"],
  ["rust", "brick red", "terracotta", "burnt sienna", "burnt orange", "clay"],
  ["mustard", "gold", "golden", "amber", "ochre", "honey", "caramel"],
  ["cobalt", "royal blue", "sapphire", "deep blue", "electric blue"],
  ["steel blue", "denim blue"],
  ["sky blue", "baby blue", "powder blue"],
  ["blush", "dusty rose", "rose", "mauve", "pink beige", "petal"],
  ["pink", "hot pink", "magenta", "fuchsia"],
  ["coral", "salmon", "peach", "apricot"],
  ["teal", "dark teal", "teal blue", "petrol blue", "turquoise"],
  ["taupe", "greige", "stone", "mushroom", "warm gray", "warm grey"],
  ["purple", "violet", "plum", "eggplant", "deep purple", "grape"],
  ["lavender", "lilac", "periwinkle"],
  ["black", "jet black", "true black", "onyx"],
  ["white", "true white", "pure white", "optic white"],
];

export function normalizeColorName(s: string): string {
  return s.toLowerCase().trim().replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
}

const NORMALIZED_COLOR_GROUPS: string[][] = COLOR_GROUPS.map(g => g.map(normalizeColorName));

export function sameColorGroup(a: string, b: string): boolean {
  const na = normalizeColorName(a);
  const nb = normalizeColorName(b);
  if (na === nb) return true;
  return NORMALIZED_COLOR_GROUPS.some(g => g.includes(na) && g.includes(nb));
}
