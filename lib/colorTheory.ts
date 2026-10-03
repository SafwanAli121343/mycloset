// Deterministic, non-AI color-pairing logic — the free tier's stand-in for AI-written pairing
// suggestions (see lib/billing/entitlements.ts's hasAI). No LLM call, no per-request cost: just a
// small rule table over the same named-color groups lib/constants/colors.ts already uses for
// same-color-family matching elsewhere in the app.
//
// This is the web-side counterpart to native/lib/colorTheory.ts (native can't import across the
// repo boundary into a separate Metro bundle) — kept in sync by hand, same convention as
// native/lib/colorGroups.ts being a port of lib/constants/colors.ts's grouping logic.
import { COLOR_GROUPS, normalizeColorName } from "./constants/colors";

function groupIndexOf(color: string): number {
  const n = normalizeColorName(color);
  return COLOR_GROUPS.findIndex(g => g.map(normalizeColorName).includes(n));
}

// Indices into COLOR_GROUPS for colors that read as "goes with anything" — true neutrals plus
// navy/denim, which function as a neutral in most Western streetwear/casual styling even though
// they're technically a hue.
const NEUTRAL_GROUP_INDICES = new Set(
  ["black", "white", "grey", "cream", "charcoal", "light gray", "navy"].map(name => {
    const idx = COLOR_GROUPS.findIndex(g => g.map(normalizeColorName).includes(name));
    return idx;
  })
);

function isNeutral(color: string): boolean {
  return NEUTRAL_GROUP_INDICES.has(groupIndexOf(color));
}

// Curated classic-pairing group-name pairs (by first member of each group, for readability). Not
// exhaustive — a rule-based system doesn't need to be, it needs to be defensibly correct for the
// common cases and never claim a pairing it can't justify.
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

// Single-color version for showing an item's "goes with" colors with no second garment to check
// against (the free tier's COLORS section, where the AI-written color_pairings field is hidden).
// Same neutral/same-family/classic-pair rules as colorsPairWell above. Identical to
// native/lib/colorTheory.ts's describeColorPairing — keep the two in sync.
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
