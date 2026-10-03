// Deterministic, non-AI color-pairing logic — the free tier's stand-in for the AI-written
// `color_pairings`/`color_clashes` fields (see lib/billing/entitlements.ts on the backend,
// which strips those fields for a free/lapsed user). No LLM call, no per-request cost: just a
// small rule table over the same named-color groups colorGroups.ts already uses for
// same-color-family matching elsewhere in the app.
import { COLOR_GROUPS, normalizeColorName } from "./colorGroups";

function groupIndexOf(color: string): number {
  const n = normalizeColorName(color);
  return COLOR_GROUPS.findIndex(g => g.map(normalizeColorName).includes(n));
}

// Indices into COLOR_GROUPS (see colorGroups.ts) for colors that read as "goes with anything" —
// true neutrals plus navy/denim, which function as a neutral in most Western streetwear/casual
// styling even though they're technically a hue.
const NEUTRAL_GROUP_INDICES = new Set(
  ["black", "white", "grey", "cream", "charcoal", "light gray", "navy"].map(name => {
    const idx = COLOR_GROUPS.findIndex(g => g.map(normalizeColorName).includes(name));
    return idx;
  })
);

function isNeutral(color: string): boolean {
  return NEUTRAL_GROUP_INDICES.has(groupIndexOf(color));
}

// Curated classic-pairing group-name pairs (by first member of each group, for readability).
// Not exhaustive — a rule-based system doesn't need to be, it needs to be defensibly correct
// for the common cases and never claim a pairing it can't justify.
const CLASSIC_PAIRS: [string, string][] = [
  ["olive", "cream"], ["olive", "rust"], ["olive", "navy"],
  ["burgundy", "navy"], ["burgundy", "cream"], ["burgundy", "grey"],
  ["navy", "cream"], ["navy", "rust"], ["navy", "mustard"],
  ["brown", "cream"], ["brown", "sky blue"], ["brown", "sage"],
  ["rust", "cream"], ["rust", "denim blue" /* steel blue group */],
  ["mustard", "navy"], ["mustard", "charcoal"],
  ["forest green", "cream"], ["forest green", "rust"],
  ["teal", "rust"], ["teal", "cream"],
  ["taupe", "white"], ["taupe", "black"],
];
const CLASSIC_PAIR_INDICES: [number, number][] = CLASSIC_PAIRS.map(([a, b]) => [groupIndexOf(a), groupIndexOf(b)]);

export function colorsPairWell(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (isNeutral(a) || isNeutral(b)) return true;
  const ga = groupIndexOf(a), gb = groupIndexOf(b);
  if (ga === gb) return true; // same family — tonal, always safe
  return CLASSIC_PAIR_INDICES.some(([x, y]) => (x === ga && y === gb) || (x === gb && y === ga));
}

// Single-color version for contexts that don't have a second garment to check against yet
// (Preview's free-tier PAIRINGS card, which — with AI off — only ever has this one item's own
// color to work from). Lists which named color groups this color pairs well with, by the same
// neutral/same-family/classic-pair rules as colorsPairWell above.
export function describeColorPairing(color: string): string[] {
  if (isNeutral(color)) {
    return ["Black", "White", "Grey", "Navy", "Cream"].filter(n => normalizeColorName(n) !== normalizeColorName(color));
  }
  const ga = groupIndexOf(color);
  const out = new Set<string>(["Black", "White", "Grey"]); // universal neutrals always shown
  for (const [x, y] of CLASSIC_PAIR_INDICES) {
    if (x === ga) out.add(COLOR_GROUPS[y][0]);
    if (y === ga) out.add(COLOR_GROUPS[x][0]);
  }
  return Array.from(out).map(s => s.replace(/\b\w/g, c => c.toUpperCase()));
}

export function explainColorPairing(a: string, b: string): string {
  if (isNeutral(a) || isNeutral(b)) {
    const neutral = isNeutral(a) ? a : b;
    return `${neutral} is a neutral: it pairs with almost anything.`;
  }
  if (groupIndexOf(a) === groupIndexOf(b)) return `${a} and ${b} are the same tonal family.`;
  return `${a} and ${b} are a classic pairing.`;
}

// Structural (not color) compatibility between two garment categories — a top always pairs
// with a bottom, an outer layer pairs with anything underneath it, etc. This is slot logic, not
// aesthetics, so it needs no AI either.
const CATEGORY_PAIRS: [string, string][] = [
  ["top", "bottom"], ["top", "outerwear"], ["top", "footwear"], ["top", "accessory"],
  ["bottom", "footwear"], ["bottom", "outerwear"], ["bottom", "accessory"],
  ["outerwear", "footwear"], ["outerwear", "accessory"], ["footwear", "accessory"],
];
export function categoriesPairStructurally(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return CATEGORY_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
