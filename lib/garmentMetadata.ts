import { BRANDS } from "./constants/brands";
import { SUB_TYPES } from "./constants/subtypes";
import { FIT_KEYWORDS, PATTERN_KEYWORDS, MATERIAL_KEYWORDS } from "./constants/attributes";
import { NAMED_COLORS } from "./constants/colors";
import { verifyBrandCandidate } from "./brandVerification";
import type { VisualMatch } from "./lensSearch";
import type { LogoTextResult } from "./visionDetection";

// Matches `phrase` against `text` as a whole word/phrase, not as a substring
// of a larger word — e.g. "Lee" matches "Vintage Lee Jeans" but not "Long
// Sleeve Tee" (naive .includes() would match "lee" inside "sleeve").
function wordBoundaryMatch(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

// Tier A: match the title against a curated list, plus any brands the
// pipeline has discovered and verified before. Returns the longest (most
// specific) match so "Polo Ralph Lauren" wins over "Ralph Lauren".
export function detectBrand(title: string, extraBrands: string[] = []): string | null {
  const candidates = extraBrands.length ? [...BRANDS, ...extraBrands] : BRANDS;
  const matches = candidates.filter((brand) => wordBoundaryMatch(title, brand));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

export function detectSubType(title: string, category: string): string | null {
  const candidates = SUB_TYPES[category] || [];
  const matches = candidates.filter((type) => wordBoundaryMatch(title, type));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

// Shared helper: matches text against a keyword -> canonical value list,
// returning the value for the longest (most specific) keyword found.
function matchKeyword(text: string, keywords: { keyword: string; value: string }[]): string | null {
  const matches = keywords.filter((k) => wordBoundaryMatch(text, k.keyword));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.keyword.length - a.keyword.length)[0].value;
}

export function detectFit(title: string): string | null {
  return matchKeyword(title, FIT_KEYWORDS);
}

export function detectPattern(title: string): string | null {
  return matchKeyword(title, PATTERN_KEYWORDS);
}

export function detectMaterial(title: string): string | null {
  return matchKeyword(title, MATERIAL_KEYWORDS);
}

// Words that commonly lead a resale listing title but aren't the brand —
// built from our existing curated vocab (colors, fits, patterns, materials,
// sub-types) plus a small fixed set of condition/era/size words. This stays
// in sync automatically as those lists grow, so it doesn't need separate
// upkeep.
const TITLE_STOPWORDS: Set<string> = (() => {
  const words = new Set([
    "vintage", "rare", "nwt", "nwot", "new", "used", "deadstock", "authentic",
    "y2k", "90s", "80s", "00s", "2000s", "retro", "classic", "the", "a", "an",
    "size", "sz", "mens", "men's", "womens", "women's", "unisex", "kids", "boys", "girls",
    "raw", "selvedge", "selvage", "washed", "unwashed", "distressed", "faded",
    "stonewash", "stonewashed", "rinsed", "acid",
  ]);
  for (const c of NAMED_COLORS) words.add(c.name.toLowerCase());
  for (const k of [...FIT_KEYWORDS, ...PATTERN_KEYWORDS, ...MATERIAL_KEYWORDS]) {
    for (const w of k.keyword.toLowerCase().split(/\s+/)) words.add(w);
  }
  for (const types of Object.values(SUB_TYPES)) {
    for (const type of types) {
      for (const w of type.toLowerCase().split(/\s+/)) words.add(w);
    }
  }
  return words;
})();

// The brand is conventionally the first word of a resale listing title.
// Skip generic leading words (colors, conditions, sub-types, etc.) to find
// the word most likely to be a brand name.
function extractTitleBrandCandidate(title: string): string | null {
  const words = title.split(/\s+/).map((w) => w.replace(/[^a-zA-Z0-9]/g, ""));
  for (const word of words.slice(0, 4)) {
    if (word.length < 2 || /^\d+$/.test(word)) continue;
    if (TITLE_STOPWORDS.has(word.toLowerCase())) continue;
    return word;
  }
  return null;
}

export type BrandResult = {
  brand: string | null;
  confidence: "high" | "medium" | "unknown";
  // Set when a brand outside our curated/discovered lists was identified
  // with high confidence (web-verified AND read off the garment via OCR) —
  // the caller should persist this so future items from the same brand hit
  // Tier A directly, growing the brand list from real evidence instead of
  // manual edits.
  discovered?: string;
};

// Tier A: curated/discovered list vs title (free, high confidence).
// Tier A2: curated/discovered list vs text printed on the garment, read via
// OCR — equally reliable, just sourced from the photo instead of the listing.
// Tier A3: the title's leading word, verified as a real clothing brand via
// web search — catches niche brands the curated list doesn't know about,
// without trusting a single AI model's "looks similar to X" guess.
// Tier A4: Google's logo-recognition model, trusted only if its own OCR
// independently read the same name off the garment — an uncorroborated guess
// here is exactly what misidentifies one brand's logo as a similarly-styled
// different brand's.
// Tier B: majority vote across titles of visually-similar listings.
export async function resolveBrand(
  title: string,
  visualMatches: VisualMatch[],
  visionResult: LogoTextResult,
  extraBrands: string[] = []
): Promise<BrandResult> {
  const directMatch = detectBrand(title, extraBrands);
  if (directMatch) {
    return { brand: directMatch, confidence: "high" };
  }

  const ocrMatch = detectBrand(visionResult.ocrText, extraBrands);
  if (ocrMatch) {
    return { brand: ocrMatch, confidence: "high" };
  }

  const candidate = extractTitleBrandCandidate(title);
  if (candidate && (await verifyBrandCandidate(candidate))) {
    const corroborated = wordBoundaryMatch(visionResult.ocrText, candidate);
    return {
      brand: candidate,
      confidence: corroborated ? "high" : "medium",
      ...(corroborated ? { discovered: candidate } : {}),
    };
  }

  const logo = visionResult.detectedLogos[0];
  if (logo && wordBoundaryMatch(visionResult.ocrText, logo)) {
    return { brand: logo, confidence: "medium" };
  }

  const counts: Record<string, number> = {};
  for (const match of visualMatches) {
    const brand = detectBrand(match.title || "", extraBrands);
    if (brand) counts[brand] = (counts[brand] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted[0]) {
    return { brand: sorted[0][0], confidence: "medium" };
  }

  return { brand: null, confidence: "unknown" };
}

export type CrossRefResult = {
  values: Record<string, string>;
  confidence: Record<string, string>;
};

const CROSS_REF_KEYWORDS: Record<string, { keyword: string; value: string }[]> = {
  fit: FIT_KEYWORDS,
  pattern: PATTERN_KEYWORDS,
  material: MATERIAL_KEYWORDS,
};

// Tier B (medium confidence): for fields the title didn't resolve, check
// titles of visually-similar products from reverse image search. If at
// least 2 independent listings agree, that's stronger evidence than a
// single AI guess from one photo.
export function crossReferenceAttributes(
  visualMatches: VisualMatch[],
  fieldsNeeded: string[]
): CrossRefResult {
  const values: Record<string, string> = {};
  const confidence: Record<string, string> = {};

  for (const field of fieldsNeeded) {
    const keywords = CROSS_REF_KEYWORDS[field];
    if (!keywords) continue;

    const counts: Record<string, number> = {};
    for (const match of visualMatches) {
      const value = matchKeyword(match.title || "", keywords);
      if (value) counts[value] = (counts[value] || 0) + 1;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0] && sorted[0][1] >= 2) {
      values[field] = sorted[0][0];
      confidence[field] = "medium";
    }
  }

  return { values, confidence };
}
