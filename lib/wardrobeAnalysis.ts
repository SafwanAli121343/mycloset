// Shared types and helpers for wardrobe analysis.

import { scoreWardrobe, scorePiece, getSlot } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";
import { KNOWN_AESTHETICS } from "@/lib/constants/attributes";
import { COLOR_GROUPS, sameColorGroup, normalizeColorName } from "@/lib/constants/colors";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WardrobeGap = {
  description: string;
  type: "piece_type" | "specific_piece" | "category";
  impact: "high" | "medium" | "low";
  reason: string;
  costPoints: number;
};

export type WardrobeOverdone = {
  description: string;
  count: number;
  suggestion: string;
};

export type WardrobeAnalysis = {
  score: number;
  scoreBreakdown: {
    pieceQuality: number;     // /25
    categoryCoverage: number; // /20
    colorCohesion: number;    // /20
    outfitPotential: number;  // /15
    qualityDistribution: number; // /10
    aestheticDepth: number;   // /10
  };
  pieceCount: number;
  pros: string[];
  cons: string[];
  colors: {
    have: string[];
    missing: string[];
  };
  aesthetics: {
    covered: Array<{ name: string; count: number }>;
    missing: string[];
  };
  subTypeFrequency: Record<string, number>;
  gaps: WardrobeGap[];
  overdone: WardrobeOverdone[];
  insights: string[];
  generatedAt: string;
  conGapLinks: Record<string, string>;
};

export type ItemImpact = {
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  fillsGaps: string[];
  addsAesthetics: string[];
  addsColors: string[];
  redundantWith: string[];
  verdict: string;
};

// ── Essential color list ───────────────────────────────────────────────────────

export const ESSENTIAL_COLORS = [
  "Black","White","Navy","Gray","Cream","Beige","Tan","Camel",
  "Brown","Olive","Burgundy","Forest Green","Charcoal","Khaki","Stone",
];

export function colorIsCovered(essential: string, wardrobeColors: string[]): boolean {
  return wardrobeColors.some(wc => sameColorGroup(essential, wc));
}

// ── Aesthetic normalization ────────────────────────────────────────────────────

// Maps tag variants GPT may return → canonical KNOWN_AESTHETICS names.
const AESTHETIC_ALIASES: Record<string, string> = {
  // Old hyphenated forms
  "old-money": "old money",
  "quiet-luxury": "quiet luxury",
  "business-casual": "business casual",
  "indie-sleaze": "indie sleaze",
  "mob-wife": "mob wife",
  "dark-academia": "dark academia",
  "ivy-league": "ivy league",
  // Old short/alternate forms
  "boho": "bohemian",
  "90s": "90s retro",
  "Y2K": "y2k",
  "avant garde": "avant-garde",
  "hip hop": "hip-hop",
};

export function normalizeAesthetic(tag: string): string {
  return AESTHETIC_ALIASES[tag] ?? tag;
}

// Re-exported from attributes.ts — single source of truth.
export { KNOWN_AESTHETICS };

// ── Functional slot system ────────────────────────────────────────────────────

const FUNCTIONAL_SLOT_MAP: Record<string, string[]> = {
  "base layer": [
    "T-Shirt","Graphic Tee","Long Sleeve Tee","Pocket Tee","Baseball Tee","Oversized Tee","Baby Tee","Thermal Tee",
    "Tank Top","Tank","Camisole","Sleeveless Top","Bra Top","Tube Top","Halter Top","Bralette",
    "Crop Top","Bodysuit","Knit Top","Sequin Top","Off-Shoulder Top","Peplum Top","Smock Top","Sheer Top","Mesh Top","Lace Top",
    "Polo","Polo Shirt","Rugby Shirt","Henley","Henley Shirt",
    "Blouse","Wrap Top","One-Shoulder Top","Asymmetric Top","Tunic","Peasant Top",
    "Printed Shirt","Silk Shirt",
  ],
  "casual shirt / button-up": [
    "Dress Shirt","Oxford Shirt","Flannel Shirt","Chambray Shirt","Denim Shirt",
    "Linen Shirt","Camp Collar Shirt","Work Shirt","Western Shirt","Bowling Shirt",
  ],
  "pullover mid layer": [
    "Hoodie","Pullover Hoodie","Sweatshirt","Crewneck Sweatshirt",
    "Sweater","Crewneck Sweater","V-Neck Sweater","Turtleneck","Turtleneck Sweater",
    "Mock Neck Sweater","Mock Neck","Cable Knit Sweater","Ribbed Sweater","Chunky Knit Sweater",
    "Fair Isle Sweater","Fisherman Sweater","Shetland Sweater","Polo Sweater",
    "Crewneck","Fleece Pullover","Knitwear",
  ],
  "zip-up / open mid layer": [
    "Zip-Up Hoodie","Zip-Up Sweatshirt","Cardigan","Quarter Zip","Quarter-Zip","Half Zip","Half-Zip",
    "Shrug","Bolero",
  ],
  "lightweight jacket": [
    "Harrington Jacket","Bomber Jacket","MA-1","Denim Jacket","Varsity Jacket","Track Jacket","Windbreaker",
    "Coach Jacket","Cagoule","Blouson","Overshirt","Shacket",
    "Chore Coat","Barn Coat","Workwear Jacket","Waxed Jacket",
  ],
  "structured outerwear": ["Blazer","Sport Coat","Suit Jacket","Double-Breasted Blazer"],
  "heavy outerwear": [
    "Leather Jacket","Moto Jacket","Biker Jacket","Puffer Jacket","Down Jacket","Puffer Coat",
    "Overcoat","Trench Coat","Peacoat","Wool Coat","Wrap Coat","Car Coat","Chesterfield Coat","Duster",
    "Sherpa Jacket","Sherpa Coat","Fleece Coat","Cape","Poncho","Kimono Jacket",
    "Field Jacket","Mountain Jacket","Shell Jacket","Quilted Jacket",
    "Rain Jacket","Rain Coat","Raincoat","Mac","Tech Jacket",
    "Soft Shell Jacket","Hard Shell Jacket","Ski Jacket","Anorak","Parka","Wrap Jacket",
    "Longline Cardigan",
  ],
  "denim bottom": [
    "Jeans","Straight Leg Jeans","Slim Jeans","Skinny Jeans","Wide Leg Jeans",
    "Bootcut Jeans","Flared Jeans","Tapered Jeans","Relaxed Jeans","Baggy Jeans",
    "Cropped Jeans","Bell Bottoms","Selvedge Jeans",
  ],
  "casual pant": [
    "Chinos","Cargo Pants","Joggers","Sweatpants","Corduroy Pants","Track Pants",
    "Linen Pants","Harem Pants","Parachute Pants","Leather Pants","Culottes","Palazzos",
    "Lounge Shorts","Leggings",
    "Wide Leg Pants","Straight Pants","Straight Leg Pants","Tapered Pants","Relaxed Pants",
    "Slim Pants","Slim Fit Pants","Flared Pants","Cropped Pants","Balloon Pants",
    "Utility Pants","Drawstring Pants","Jogger Pants","Baggy Pants",
  ],
  "formal pant": [
    "Dress Pants","Trousers","Tailored Trousers","Wide Leg Trousers","Pleated Trousers","Cropped Trousers","Slacks","Velvet Trousers",
    "Pleated Pants","Wide Pleated Pants","Tailored Pants","Wide Leg Pleated Pants",
  ],
  "shorts": [
    "Shorts","Denim Shorts","Jorts","Basketball Shorts","Swim Shorts","Board Shorts","Cargo Shorts","Chino Shorts",
    "Y2K Shorts","Pleated Shorts","Running Shorts","Track Shorts","Compression Shorts","Biker Shorts",
  ],
  "casual sneaker": [
    "Sneakers","Basketball Sneakers","Running Shoes","Low-Top Sneakers","High-Top Sneakers","Mid-Top Sneakers",
    "Trail Runners","Slip-On Sneakers","Dad Sneakers","Chunky Sneakers","Platform Sneakers",
    "Tennis Shoes","Retro Sneakers","Skate Shoes",
  ],
  "casual sandal / slide": [
    "Sandals","Slides","Birkenstocks","Birkenstock","Mules","Flip Flops",
    "Strappy Sandals","Gladiator Sandals","Platform Sandals",
  ],
  "boot": [
    "Work Boots","Chelsea Boots","Combat Boots","Chukka Boots","Hiking Boots","Ankle Boots",
    "Platform Boots","Knee-High Boots","Cowboy Boots","Snow Boots","Rain Boots",
    "Riding Boots","Desert Boots","Over-The-Knee Boots","Thigh-High Boots",
  ],
  "dress shoe": [
    "Oxford Shoes","Derby Shoes","Loafers","Monk Straps","Ballet Flats","Slingbacks",
    "Mary Janes","Brogues","Moccasins","Espadrilles","Clogs","Heels","Pumps","Wedges",
    "Stilettos","Block Heels","Kitten Heels","Platform Heels","Approach Shoes","Boat Shoes",
    "Dress Shoes",
  ],
  "vest / outerwear vest": ["Vest","Gilet","Puffer Vest","Sweater Vest","Knit Vest","Down Vest","Padded Vest","Fleece Vest"],
};

export function getFunctionalSlot(sub_type: string | null | undefined): string | null {
  if (!sub_type) return null;
  const sWords = new Set(sub_type.toLowerCase().split(/\s+/));
  let bestSlot: string | null = null;
  let bestScore = -1;

  for (const [slot, types] of Object.entries(FUNCTIONAL_SLOT_MAP)) {
    for (const t of types) {
      const tWords = new Set(t.toLowerCase().split(/\s+/));
      const sInT = [...sWords].every(w => tWords.has(w));
      const tInS = [...tWords].every(w => sWords.has(w));
      if (!sInT && !tInS) continue;
      const overlap = [...sWords].filter(w => tWords.has(w)).length;
      const score = overlap + (sInT && tInS ? 100 : 0) + (sInT ? 10 : 0) + (tInS ? 10 : 0);
      if (score > bestScore) { bestScore = score; bestSlot = slot; }
    }
  }
  return bestSlot;
}

// Returns the best canonical sub_type string from FUNCTIONAL_SLOT_MAP that matches a title,
// using the same word-overlap logic as getFunctionalSlot. Used to fill in sub_type for
// items that were added without deep analysis.
export function resolveSubTypeFromTitle(title: string): string | null {
  if (!title) return null;
  const sWords = new Set(title.toLowerCase().split(/\s+/));
  let bestType: string | null = null;
  let bestScore = -1;

  for (const types of Object.values(FUNCTIONAL_SLOT_MAP)) {
    for (const t of types) {
      const tWords = new Set(t.toLowerCase().split(/\s+/));
      const sInT = [...sWords].every(w => tWords.has(w));
      const tInS = [...tWords].every(w => sWords.has(w));
      if (!sInT && !tInS) continue;
      const overlap = [...sWords].filter(w => tWords.has(w)).length;
      const score = overlap + (sInT && tInS ? 100 : 0) + (sInT ? 10 : 0) + (tInS ? 10 : 0);
      if (score > bestScore) { bestScore = score; bestType = t; }
    }
  }
  return bestType;
}

// ── Wardrobe metrics (programmatic) ───────────────────────────────────────────

export type WardrobeMetrics = {
  score: number;
  pieceCount: number;
  allColors: string[];
  missingEssentials: string[];
  aestheticCounts: Record<string, number>;
  absentAesthetics: string[];
  subTypeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  slotCoverage: Set<string>;
  functionalSlotsCovered: string[];
  functionalSlotsMissing: string[];
  avgPieceScore: number;
  heroCount: number;
  workhouseCount: number;
  weakCount: number;
  comboCountEstimate: number;
  slotCostMap: Record<string, number>;
};

export function computeMetrics(garments: GarmentForScoring[]): WardrobeMetrics {
  const score = scoreWardrobe(garments);
  const pieceScores = garments.map(scorePiece);
  const avgPieceScore = pieceScores.length
    ? pieceScores.reduce((a, b) => a + b, 0) / pieceScores.length
    : 0;

  const allColors = [...new Set([
    ...garments.map(g => g.color_primary),
    ...garments.map(g => g.color_secondary),
  ].filter(Boolean) as string[])];

  const missingEssentials = ESSENTIAL_COLORS.filter(ec => !colorIsCovered(ec, allColors));

  // Normalize aesthetic tags
  const aestheticCounts: Record<string, number> = {};
  for (const g of garments)
    for (const t of g.aesthetic_tags ?? []) {
      const norm = normalizeAesthetic(t);
      aestheticCounts[norm] = (aestheticCounts[norm] ?? 0) + 1;
    }

  const presentAestheticNames = new Set(Object.keys(aestheticCounts));
  const absentAesthetics = KNOWN_AESTHETICS.filter(a => !presentAestheticNames.has(a));

  const subTypeCounts: Record<string, number> = {};
  for (const g of garments)
    if (g.sub_type) subTypeCounts[g.sub_type] = (subTypeCounts[g.sub_type] ?? 0) + 1;

  const categoryCounts: Record<string, number> = {};
  for (const g of garments) {
    const cat = (g as { category?: string | null }).category;
    if (cat) categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }

  // Legacy slot coverage (for outfit scoring compat)
  const slotCoverage = new Set(garments.map(g => getSlot(g.sub_type)).filter(Boolean) as string[]);

  // Functional slots for wardrobe analysis
  // Fall back to title when sub_type is null (items added without deep analysis)
  const coveredSlots = new Set(
    garments.map(g => {
      const bySubType = getFunctionalSlot(g.sub_type);
      if (bySubType) return bySubType;
      const title = (g as { title?: string | null }).title;
      return title ? getFunctionalSlot(title) : null;
    }).filter(Boolean) as string[]
  );
  const functionalSlotsCovered = [...coveredSlots];
  const functionalSlotsMissing = Object.keys(FUNCTIONAL_SLOT_MAP).filter(s => !coveredSlots.has(s));

  const heroCount      = pieceScores.filter(s => s >= 85).length;
  const workhouseCount = pieceScores.filter(s => s >= 65 && s < 85).length;
  const weakCount      = pieceScores.filter(s => s < 55).length;

  const baseCnt  = garments.filter(g => getSlot(g.sub_type) === "base").length;
  const botCnt   = garments.filter(g => getSlot(g.sub_type) === "bottom").length;
  const footCnt  = garments.filter(g => getSlot(g.sub_type) === "foot").length;
  const comboCountEstimate = Math.min(baseCnt * botCnt * footCnt, 500);

  // Compute how many wardrobe points each missing slot is costing
  const slotCostMap: Record<string, number> = {};
  const baseScore = score;
  for (const slot of functionalSlotsMissing) {
    const types = FUNCTIONAL_SLOT_MAP[slot];
    if (!types?.length) continue;
    const filler: GarmentForScoring = {
      id: "__gap_filler__", title: types[0], brand: null, sub_type: types[0],
      material: null, color_primary: "Black", color_secondary: null,
      pattern: null, formality: "casual",
      aesthetic_tags: ["casual", "streetwear"],
      pros: ["versatile", "well-constructed"], cons: null,
      color_pairings: ["White","Grey","Navy"], color_clashes: null,
      tags: null, image: null,
    };
    const filled = scoreWardrobe([...garments, filler]);
    slotCostMap[slot] = Math.max(0, Math.round(filled - baseScore));
  }

  return {
    score, pieceCount: garments.length, allColors, missingEssentials,
    aestheticCounts, absentAesthetics, subTypeCounts, categoryCounts,
    slotCoverage, functionalSlotsCovered, functionalSlotsMissing,
    avgPieceScore, heroCount, workhouseCount, weakCount, comboCountEstimate,
    slotCostMap,
  };
}

// ── Compact wardrobe string for GPT ───────────────────────────────────────────

const CAT_ORDER = ["top","bottom","outerwear","footwear","accessory"];
const CAT_LABEL: Record<string, string> = {
  top:"TOPS", bottom:"BOTTOMS", outerwear:"OUTERWEAR", footwear:"FOOTWEAR", accessory:"ACCESSORIES",
};

export function buildWardrobePromptSection(
  garments: Array<GarmentForScoring & { category?: string | null; title?: string | null; brand?: string | null }>,
  metrics: WardrobeMetrics,
): string {
  let s = `=== WARDROBE (${garments.length} pieces) ===\n\n`;
  let itemNum = 1;

  for (const cat of CAT_ORDER) {
    const items = garments.filter(g => g.category === cat);
    if (!items.length) continue;
    s += `${CAT_LABEL[cat]} (${items.length}):\n`;
    for (const g of items) {
      const slot = getFunctionalSlot(g.sub_type);
      const normalizedAesthetics = (g.aesthetic_tags ?? []).map(normalizeAesthetic);
      const parts = [
        `[#${itemNum++}] ${g.sub_type ?? "?"} (${g.brand ?? "?"})`,
        slot ? `→ slot:"${slot}"` : null,
        g.color_primary ? `color:${g.color_primary}${g.color_secondary ? `/${g.color_secondary}` : ""}` : null,
        normalizedAesthetics.length ? `aesthetics:[${normalizedAesthetics.join(", ")}]` : null,
      ].filter(Boolean).join(" · ");
      s += `  ${parts}\n`;
    }
    s += "\n";
  }

  const aestheticStr = Object.entries(metrics.aestheticCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}(${v})`).join(", ");

  const overdoneStr = Object.entries(metrics.subTypeCounts)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`).join(", ");

  // Build color presence section: actual colors + explicit synonym families so GPT
  // never suggests a color whose family is already represented in the wardrobe.
  const presentNorms = new Set(metrics.allColors.map(normalizeColorName));
  const coveredFamilies: string[] = [];
  const expandedColorSet = new Set(metrics.allColors);
  for (const group of COLOR_GROUPS) {
    const normGroup = group.map(normalizeColorName);
    const hits = normGroup.filter(c => presentNorms.has(c));
    if (hits.length > 0) {
      const synonymsNotPresent = group.filter((c, i) => !hits.includes(normGroup[i]));
      if (synonymsNotPresent.length > 0) {
        coveredFamilies.push(`${hits.map(h => h.charAt(0).toUpperCase() + h.slice(1)).join("/")} → also covers: ${synonymsNotPresent.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(", ")}`);
      }
      for (const c of group) expandedColorSet.add(c.charAt(0).toUpperCase() + c.slice(1));
    }
  }

  s += `=== METRICS ===\n`;
  s += `Colors present: ${metrics.allColors.join(", ")}\n`;
  if (coveredFamilies.length > 0) {
    s += `Color families covered (TREAT THESE AS PRESENT — do NOT suggest any of the synonyms as missing):\n`;
    coveredFamilies.forEach(f => { s += `  • ${f}\n`; });
  }
  s += `All colors treated as present (actual + synonyms): ${[...expandedColorSet].join(", ")}\n`;
  s += `Aesthetics present: ${aestheticStr || "none tagged"}\n`;
  s += `Aesthetics completely absent: ${metrics.absentAesthetics.join(", ")}\n`;
  s += `Category counts: ${Object.entries(metrics.categoryCounts).map(([k, v]) => `${k}:${v}`).join(", ")}\n`;
  s += `Functional slots COVERED: ${metrics.functionalSlotsCovered.join(", ")}\n`;
  s += `Functional slots MISSING: ${metrics.functionalSlotsMissing.join(", ")}\n`;
  if (overdoneStr) s += `High-frequency sub-types (3+): ${overdoneStr}\n`;
  else s += `High-frequency sub-types (3+): none\n`;

  return s;
}

// ── Item impact (pure scoring, no LLM) ────────────────────────────────────────

export function computeItemImpact(
  wardrobe: GarmentForScoring[],
  candidate: GarmentForScoring,
  currentAnalysis: Pick<WardrobeAnalysis, "gaps" | "aesthetics" | "colors">,
): ItemImpact {
  const scoreBefore = scoreWardrobe(wardrobe);
  const scoreAfter  = scoreWardrobe([...wardrobe, candidate]);
  const delta       = scoreAfter - scoreBefore;

  const addsAesthetics = (candidate.aesthetic_tags ?? [])
    .map(normalizeAesthetic)
    .filter(t => currentAnalysis.aesthetics.missing.includes(t));

  const candidateColors = [candidate.color_primary, candidate.color_secondary].filter(Boolean) as string[];
  const addsColors = currentAnalysis.colors.missing.filter(ec =>
    colorIsCovered(ec, candidateColors)
  );

  const candidateSlot = getSlot(candidate.sub_type);
  const redundantWith = wardrobe
    .filter(g => {
      if (getSlot(g.sub_type) !== candidateSlot) return false;
      const overlap = (g.aesthetic_tags ?? []).filter(t =>
        (candidate.aesthetic_tags ?? []).includes(t)
      );
      return overlap.length >= 1;
    })
    .map(g => g.title ?? g.sub_type ?? g.id)
    .slice(0, 3);

  const candidateFuncSlot = getFunctionalSlot(candidate.sub_type);
  const candidateCategory = (candidate as { category?: string | null }).category ?? null;
  const fillsGaps = currentAnalysis.gaps
    .filter(gap =>
      computeGapProgress(gap.description, candidate.sub_type, candidateCategory, candidateFuncSlot) >= 100
    )
    .map(g => g.description)
    .slice(0, 3);

  let verdict: string;
  if (delta >= 5) verdict = `Strong addition — lifts wardrobe score by ${delta} points.`;
  else if (delta >= 2) verdict = `Solid pick — adds ${delta} points and expands wardrobe versatility.`;
  else if (delta >= 0) verdict = `Neutral addition — minimal score impact but adds variety.`;
  else verdict = `Diminishing returns — this slot is already well-covered; score dips ${Math.abs(delta)} pts.`;

  if (addsAesthetics.length) verdict += ` Brings ${addsAesthetics.join(", ")} aesthetic previously missing.`;
  if (redundantWith.length >= 2 && delta < 2) verdict += ` Overlaps significantly with: ${redundantWith.slice(0, 2).join(", ")}.`;

  return { scoreBefore, scoreAfter, delta, fillsGaps, addsAesthetics, addsColors, redundantWith, verdict };
}

// ── Backend wardrobe analysis state ──────────────────────────────────────────

export type CrossedEntry = {
  category: "gap" | "color" | "aesthetic" | "con";
  key: string;          // gap.description | color name | aesthetic name | String(conIndex)
  garmentId: string;
  analysisLevel: number;
  // For gaps: how much this single item moves toward resolving the gap (0–100).
  // Multiple items accumulate; total ≥ 100 means fully resolved.
  // Colors, aesthetics, cons are binary and omit this field (treated as 100).
  progress?: number;
};

export type WABackendState = {
  analysisHistory: WardrobeAnalysis[];
  crossed: CrossedEntry[];
  currentLevel: number;
};

// Sum progress for a specific gap key at a given level.
export function gapTotalProgress(crossed: CrossedEntry[], key: string, level: number): number {
  return Math.min(
    100,
    crossed
      .filter(e => e.category === "gap" && e.key === key && e.analysisLevel === level)
      .reduce((sum, e) => sum + (e.progress ?? 100), 0)
  );
}

// Returns 0–100: how much a newly-added item addresses a given gap.
// Uses general slot/sub-type/category word-matching — no hardcoded item names.
// Multiple items accumulate; once total reaches 100 the gap is resolved.
export function computeGapProgress(
  gapDescription: string,
  sub_type: string | null | undefined,
  category: string | null | undefined,
  functional_slot: string | null | undefined,
): number {
  const d = gapDescription.toLowerCase();
  const dWords = new Set(d.split(/[\s,;:.()\-\/]+/).filter(w => w.length >= 3));

  const sub  = (sub_type ?? "").toLowerCase();
  const cat  = (category ?? "").toLowerCase();
  const slot = (functional_slot ?? "").toLowerCase();

  const subWords  = sub.split(/\s+/).filter(w => w.length >= 2);
  const longSub   = subWords.filter(w => w.length >= 3);
  const slotWords = slot.split(/[\s\/\-]+/).filter(w => w.length >= 2);

  const isDiversity = /\b(more|variety|diverse|multiple|several|additional|another|lack of variety)\b/.test(d);
  const isAbsence   = /\b(no |none|missing|lack|without|need a|add a|have no)\b/.test(d);

  // 1. Slot exact match — all slot words appear in the gap description
  if (slot && slotWords.length >= 1 && slotWords.every(w => dWords.has(w))) {
    const extraWords = [...dWords].filter(w => !slotWords.includes(w)).length;
    if (extraWords <= 1) return 100; // description ≈ slot name itself
    if (isDiversity) return 50;
    if (isAbsence)   return 100;
    return 75;
  }

  // 2. Sub-type verbatim substring match
  if (sub && sub.length >= 3 && d.includes(sub)) return 100;

  // 2b. All gap-description words appear in sub-type words — strong semantic signal.
  // Handles "Denim Shorts" → "shorts" gap: "shorts" ∈ longSub → 100%.
  // dWords.size guard: without it, a gap description with zero words ≥3 chars would make
  // the `.every()` vacuously true and award 100% to any item with a sub_type.
  if (dWords.size > 0 && longSub.length > 0 && [...dWords].every(w => longSub.includes(w))) return 100;

  // 3. Sub-type word overlap with gap description.
  // Guard: if the item has a functional_slot that didn't match the gap (step 1 didn't fire),
  // skip sub_type word overlap — slot is a more reliable signal and prevents false positives
  // like "Denim Shorts" (slot="shorts") contributing to "denim bottom" gap via the word "denim".
  const slotMatchesGap = slot && slotWords.length >= 1 && slotWords.every(w => dWords.has(w));
  if (!slot || slotMatchesGap) {
    if (longSub.length > 0) {
      const hits  = longSub.filter(w => dWords.has(w)).length;
      const ratio = hits / longSub.length;
      if (hits > 0) {
        if (ratio >= 0.6) return isDiversity ? 50 : 75;
        if (ratio >= 0.3) return 50;
        return 25;
      }
    }
  }

  // 4. Slot partial match — requires distinctive words (6+ chars) to avoid
  // generic suffixes like "layer", "mid", "base" triggering false positives.
  // Guard: if another known slot matches this gap exactly, this item is in a competing slot
  // and step 4 would produce a false positive (e.g. "structured outerwear" → "heavy outerwear" gap).
  if (slot) {
    const longSlot = slotWords.filter(w => w.length >= 6);
    const slotHits = longSlot.filter(w => dWords.has(w)).length;
    if (slotHits > 0) {
      const anotherSlotMatchesGap = Object.keys(FUNCTIONAL_SLOT_MAP).some(s => {
        if (s === slot) return false;
        const sw = s.split(/[\s\/\-]+/).filter(w => w.length >= 2);
        return sw.length >= 1 && sw.every(w => dWords.has(w));
      });
      if (!anotherSlotMatchesGap) {
        if (isAbsence) return 100;
        return isDiversity ? 25 : 50;
      }
    }
  }

  // 5. Category match only — broad signal.
  // Guard: if the item has a slot that doesn't match the gap, category alone is too broad
  // (e.g. "Denim Shorts" category="bottom" should NOT give 25% toward "denim bottom" gap).
  // Allow for diversity/absence gaps where any category item is relevant.
  if ((!slot || slotMatchesGap || isDiversity || isAbsence) && cat && cat.length >= 3 && d.includes(cat)) return 25;

  return 0;
}

// Returns the lowest level L where not all items are resolved (the active working level).
// Gap resolution is progress-based (sum ≥ 100). Colors/aesthetics remain binary.
// If all levels are complete, returns currentLevel (signals needsFresh).
export function computeEffectiveLevel(
  analysisHistory: WardrobeAnalysis[],
  _crossed: CrossedEntry[],
  currentLevel: number
): number {
  // Level is a permanent achievement — never regresses when items are removed.
  // Cap only at analysisHistory length so we can't display a level not yet analyzed.
  return Math.max(1, Math.min(currentLevel, analysisHistory.length));
}
