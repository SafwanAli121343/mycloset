// Direct port of lib/wardrobeAnalysis.ts's crossing/leveling pieces (the wardrobe-metrics/
// GPT-prompt helpers aren't needed on native — only what WardrobeScreen and AddItemScreen need
// to mirror the website's crossing-off/leveling system exactly). Kept in sync by hand, same
// convention as the rest of native/lib — see garmentSlots.ts.

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
  pieceCount: number;
  pros: string[];
  cons: string[];
  colors: { have: string[]; missing: string[] };
  aesthetics: { covered: Array<{ name: string; count: number }>; missing: string[] };
  subTypeFrequency: Record<string, number>;
  gaps: WardrobeGap[];
  overdone: WardrobeOverdone[];
  insights: string[];
  generatedAt: string;
  conGapLinks: Record<string, string>;
  pointWeights?: { gap: number; color: number; aesthetic: number; con: number };
};

export type CrossedEntry = {
  category: "gap" | "color" | "aesthetic" | "con";
  key: string;
  garmentId: string;
  analysisLevel: number;
  progress?: number;
};

export type WABackendState = {
  analysisHistory: WardrobeAnalysis[];
  crossed: CrossedEntry[];
  currentLevel: number;
};

// ── Functional slot system (word-overlap matcher used by computeGapProgress) ───────────────
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

// Sum progress for a specific gap key at a given level.
export function gapTotalProgress(crossed: CrossedEntry[], key: string, level: number): number {
  return Math.min(
    100,
    crossed
      .filter(e => e.category === "gap" && e.key === key && e.analysisLevel === level)
      .reduce((sum, e) => sum + (e.progress ?? 100), 0)
  );
}

// Returns 0–100: how much a newly-added item addresses a given gap. General slot/sub-type/
// category word-matching — no hardcoded item names.
export function computeGapProgress(
  gapDescription: string,
  sub_type: string | null | undefined,
  category: string | null | undefined,
  functional_slot: string | null | undefined,
): number {
  const d = gapDescription.toLowerCase();
  const dWords = new Set(d.split(/[\s,;:.()\-/]+/).filter(w => w.length >= 3));

  const sub = (sub_type ?? "").toLowerCase();
  const cat = (category ?? "").toLowerCase();
  const slot = (functional_slot ?? "").toLowerCase();

  const subWords = sub.split(/\s+/).filter(w => w.length >= 2);
  const longSub = subWords.filter(w => w.length >= 3);
  const slotWords = slot.split(/[\s/\-]+/).filter(w => w.length >= 2);

  const isDiversity = /\b(more|variety|diverse|multiple|several|additional|another|lack of variety)\b/.test(d);
  const isAbsence = /\b(no |none|missing|lack|without|need a|add a|have no)\b/.test(d);

  if (slot && slotWords.length >= 1 && slotWords.every(w => w.length < 3 || dWords.has(w))) {
    const extraWords = [...dWords].filter(w => !slotWords.includes(w)).length;
    if (extraWords <= 1) return 100;
    if (isDiversity) return 50;
    if (isAbsence) return 100;
    return 75;
  }

  if (sub && sub.length >= 3 && d.includes(sub)) return 100;

  if (dWords.size > 0 && longSub.length > 0 && [...dWords].every(w => longSub.includes(w))) return 100;

  const slotMatchesGap = !!(slot && slotWords.length >= 1 && slotWords.every(w => w.length < 3 || dWords.has(w)));
  if (!slot || slotMatchesGap) {
    if (longSub.length > 0) {
      const hits = longSub.filter(w => dWords.has(w)).length;
      const ratio = hits / longSub.length;
      if (hits > 0) {
        if (ratio >= 0.6) return isDiversity ? 50 : 75;
        if (ratio >= 0.3) return 50;
        return 25;
      }
    }
  }

  if (slot) {
    const longSlot = slotWords.filter(w => w.length >= 6);
    const slotHits = longSlot.filter(w => dWords.has(w)).length;
    if (slotHits > 0) {
      const anotherSlotMatchesGap = Object.keys(FUNCTIONAL_SLOT_MAP).some(s => {
        if (s === slot) return false;
        const sw = s.split(/[\s/\-]+/).filter(w => w.length >= 2);
        return sw.length >= 1 && sw.every(w => w.length < 3 || dWords.has(w));
      });
      if (!anotherSlotMatchesGap) {
        if (isAbsence) return 100;
        return isDiversity ? 25 : 50;
      }
    }
  }

  if ((!slot || slotMatchesGap || isDiversity || isAbsence) && cat && cat.length >= 3 && d.includes(cat)) return 25;

  return 0;
}

// Level is a permanent achievement — never regresses when items are removed. Capped only at
// analysisHistory length so we can't display a level not yet analyzed.
export function computeEffectiveLevel(
  analysisHistory: WardrobeAnalysis[],
  currentLevel: number,
): number {
  return Math.max(1, Math.min(currentLevel, analysisHistory.length));
}

// A con is "resolved" at a given level iff a crossing entry exists for it AND either it's tied
// to a real item (garmentId set — its lifecycle already tracked by the delete cascade) or it's
// one of the garmentId-less entries created by initial auto-crossing (which must be live-checked
// against the linked gap instead). Single source of truth for a con's resolution status.
export function isConResolved(
  crossed: CrossedEntry[],
  conGapLinks: Record<string, string> | undefined,
  index: number,
  level: number,
): boolean {
  const entry = crossed.find(e => e.category === "con" && e.key === String(index) && e.analysisLevel === level);
  if (!entry) return false;
  if (entry.garmentId) return true;
  const linkedGap = (conGapLinks ?? {})[String(index)];
  return linkedGap ? gapTotalProgress(crossed, linkedGap, level) >= 100 : true;
}

export function normAesthetic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Same con-matching heuristic used by add-item/page.tsx and the WA recovery path: a con is
// algorithmically crossable if its text mentions the added item's sub-type/category, or ties to
// a gap key that's already fully resolved.
export function conMatches(
  conText: string,
  sub: string,
  cat: string,
  resolvedGapKeysLower: Set<string>,
  linkedGap?: string,
): boolean {
  const con = conText.toLowerCase();
  return (
    (!!sub && con.includes(sub)) ||
    (!!cat && con.includes(cat)) ||
    (!!linkedGap && resolvedGapKeysLower.has(linkedGap.toLowerCase())) ||
    [...resolvedGapKeysLower].some(d => con.includes(d))
  );
}

export const GAP_AES: [string, string[]][] = [
  ["formal", ["formal", "business casual"]],
  ["business casual", ["business casual", "smart casual"]],
  ["dress shoe", ["formal", "business casual"]],
  ["blazer", ["formal", "business casual", "smart casual", "preppy"]],
  ["sport coat", ["formal", "smart casual", "preppy"]],
  ["chino", ["business casual", "preppy", "smart casual"]],
  ["military", ["military", "gorpcore"]],
  ["cargo", ["gorpcore", "military"]],
  ["western", ["western", "americana"]],
  ["athletic", ["athleisure", "gorpcore"]],
];
