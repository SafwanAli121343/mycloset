// Pairwise-compatibility outfit catalogue engine (sim13 algorithm).
// Builds a scored, pre-sorted catalogue of every valid outfit combination for a
// wardrobe, then generates month plans by selecting best-fit, non-repeating combos.

import { getSlot } from "@/lib/outfitRules";

export type CatalogueGarment = {
  id: string;
  brand: string | null;
  title: string | null;
  category: string | null;
  sub_type: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  aesthetic_tags: string[] | null;
};

// ─── Brand-vein classification ────────────────────────────────────────────────

const BRAND_VEINS: Record<string, string> = {
  // streetwear
  stussy: "streetwear", supreme: "streetwear", palace: "streetwear",
  "off-white": "streetwear", "off white": "streetwear",
  bape: "streetwear", kith: "streetwear", cactus: "streetwear",
  "anti social social club": "streetwear", noah: "streetwear",
  rhude: "streetwear", aime: "streetwear", "aimé leon dore": "streetwear",
  "ald": "streetwear", human: "streetwear", "human made": "streetwear",
  "fear of god": "streetwear", "fog essentials": "streetwear",
  essentials: "streetwear", represent: "streetwear",
  "market": "streetwear", awake: "streetwear",
  ottolinger: "streetwear",

  // skate
  thrasher: "skate", "santa cruz": "skate", "independent": "skate",
  vans: "skate", krooked: "skate", "girl": "skate", chocolate: "skate",
  "fucking awesome": "skate", hockey: "skate", polar: "skate",
  "skateboarding": "skate", dime: "skate",

  // y2k
  "ed hardy": "y2k", "true religion": "y2k", "von dutch": "y2k",
  jnco: "y2k", "sean john": "y2k", "baby phat": "y2k",
  "fubu": "y2k", "rocawear": "y2k",

  // heritage / workwear
  carhartt: "heritage", "carhartt wip": "heritage",
  dickies: "heritage", wrangler: "heritage", levis: "heritage",
  "levi's": "heritage", "levi strauss": "heritage",
  filson: "heritage", "red wing": "heritage",
  timberland: "heritage", wolverine: "heritage",
  "iron heart": "heritage", "sugar cane": "heritage",

  // prep / old-money
  "polo ralph lauren": "prep", "ralph lauren": "prep",
  "lacoste": "prep", "vineyard vines": "prep", "brooks brothers": "prep",
  "j.crew": "prep", "jcrew": "prep", "nantucket": "prep",
  "rowing blazers": "prep", "golden bear": "prep",
  "abercrombie": "prep", "abercrombie & fitch": "prep",

  // athletic
  nike: "athletic", adidas: "athletic", jordan: "athletic",
  "new balance": "athletic", puma: "athletic", "under armour": "athletic",
  champion: "athletic", "russell athletic": "athletic",
  reebok: "athletic", asics: "athletic", "on running": "athletic",
  salomon: "athletic", "arc'teryx": "athletic",

  // outdoor / gorpcore
  patagonia: "outdoor", "north face": "outdoor", "the north face": "outdoor",
  columbia: "outdoor", fjallraven: "outdoor", "ll bean": "outdoor",
  "ll.bean": "outdoor", "orvis": "outdoor", gramicci: "outdoor",
  "story mfg": "outdoor", "bott": "outdoor",

  // japanese
  "issey miyake": "japanese", "comme des garcons": "japanese",
  "yohji yamamoto": "japanese", "needles": "japanese",
  "wtaps": "japanese", "neighborhood": "japanese",
  "visvim": "japanese", "undercover": "japanese",
  "kapital": "japanese", "wacko maria": "japanese",
  "porter": "japanese", "suicoke": "japanese",
  "sns herning": "japanese", "sns": "japanese",
  "p.a.m": "japanese", "pam": "japanese",

  // luxury
  "saint laurent": "luxury", "ysl": "luxury",
  "gucci": "luxury", "prada": "luxury", "miu miu": "luxury",
  "balenciaga": "luxury", "givenchy": "luxury", "fendi": "luxury",
  "burberry": "luxury", "valentino": "luxury", "valentino garavani": "luxury",
  "tom ford": "luxury", "jil sander": "luxury",
  "marni": "luxury", "loewe": "luxury", "celine": "luxury",
  "max mara": "luxury", "s max mara": "luxury",
  "bottega veneta": "luxury", "the row": "luxury",
  "toteme": "luxury", "lemaire": "luxury", "setchu": "luxury",
  "moncler": "luxury", "brunello cucinelli": "luxury",
  "loro piana": "luxury", "valextra": "luxury",
  "eytys": "luxury",

  // minimalist
  "cos": "minimalist", "arket": "minimalist", "uniqlo": "minimalist",
  "muji": "minimalist", "acne studios": "minimalist",
  "apc": "minimalist", "a.p.c.": "minimalist",
  "theory": "minimalist", "reiss": "minimalist",
  "everlane": "minimalist", "cotton on": "minimalist",

  // techwear
  "acronym": "techwear", "stone island": "techwear",
  "cp company": "techwear", "c.p. company": "techwear",
  "y-3": "techwear", "y3": "techwear",
  "guerrilla group": "techwear", "riot division": "techwear",
  "oakley": "techwear", "salehe bembury": "techwear",
  "aries": "techwear",

  // vintage / thrift
  "vintage": "vintage", "levi": "vintage",
  "birkenstock": "vintage", "birkenstocks": "vintage",
};

const VEIN_AFFINITY: Record<string, string[]> = {
  streetwear: ["skate", "y2k", "heritage", "athletic", "luxury", "japanese", "minimalist"],
  skate:      ["streetwear", "y2k", "heritage", "athletic"],
  y2k:        ["streetwear", "skate", "athletic"],
  heritage:   ["streetwear", "skate", "outdoor", "vintage", "prep"],
  prep:       ["heritage", "minimalist", "luxury", "athletic"],
  athletic:   ["streetwear", "skate", "y2k", "prep", "minimalist"],
  outdoor:    ["heritage", "athletic", "japanese", "minimalist"],
  japanese:   ["streetwear", "outdoor", "minimalist", "luxury"],
  luxury:     ["streetwear", "japanese", "prep", "minimalist"],
  minimalist: ["luxury", "japanese", "prep", "athletic", "outdoor"],
  techwear:   ["athletic", "streetwear", "outdoor", "japanese"],
  vintage:    ["heritage", "streetwear", "skate"],
};

function getBrandVein(brand: string | null): string | null {
  if (!brand) return null;
  return BRAND_VEINS[brand.toLowerCase()] ?? null;
}

function veinCompatibility(a: CatalogueGarment, b: CatalogueGarment): number {
  const va = getBrandVein(a.brand);
  const vb = getBrandVein(b.brand);
  if (!va || !vb) return 0.5;
  if (va === vb)  return 1.0;
  if (VEIN_AFFINITY[va]?.includes(vb)) return 0.75;
  return 0.2;
}

// ─── Color compatibility ──────────────────────────────────────────────────────

const NEUTRALS = ["black","white","grey","gray","charcoal","navy","cream","beige",
  "off-white","ivory","taupe","khaki","stone","sand","denim","washed",
  "indigo","slate","dark","light gray","light grey","ash gray","ash grey",
  "heather gray","heather grey","silver","wheat","taupe"];

const EARTH_TONES = ["brown","tan","camel","rust","terracotta","olive","sand",
  "khaki","stone","walnut","chestnut","burnt","amber","ochre","mocha","toffee","almond"];

const ANALOGOUS_PAIRS = [
  ["red","orange"],["orange","yellow"],["yellow","green"],
  ["green","teal"],["teal","blue"],["blue","purple"],
  ["purple","pink"],["pink","red"],["olive","green"],["olive","brown"],
];

const COMPLEMENTARY_PAIRS = [
  ["blue","orange"],["navy","orange"],["blue","rust"],
  ["navy","rust"],["navy","tan"],["blue","tan"],
  ["green","red"],["olive","burgundy"],["purple","yellow"],
  ["purple","mustard"],["teal","coral"],
];

function isNeutral(c: string | null | undefined): boolean {
  if (!c) return true;
  const l = c.toLowerCase();
  return NEUTRALS.some(n => l.includes(n));
}

function colorCompatibility(a: CatalogueGarment, b: CatalogueGarment): number {
  const ca = (a.color_primary ?? "").toLowerCase();
  const cb = (b.color_primary ?? "").toLowerCase();
  if (!ca || !cb) return 0.6;
  if (isNeutral(ca) || isNeutral(cb)) return 0.85;
  if (ca === cb) return 0.95;
  for (const [x, y] of COMPLEMENTARY_PAIRS) {
    if ((ca.includes(x) && cb.includes(y)) || (ca.includes(y) && cb.includes(x))) return 0.9;
  }
  for (const [x, y] of ANALOGOUS_PAIRS) {
    if ((ca.includes(x) && cb.includes(y)) || (ca.includes(y) && cb.includes(x))) return 0.8;
  }
  if (EARTH_TONES.some(e => ca.includes(e)) && EARTH_TONES.some(e => cb.includes(e))) return 0.8;
  return 0.3;
}

// ─── Aesthetic similarity ─────────────────────────────────────────────────────

function aestheticSimilarity(a: CatalogueGarment, b: CatalogueGarment): number {
  const ta = a.aesthetic_tags ?? [];
  const tb = b.aesthetic_tags ?? [];
  if (!ta.length || !tb.length) return 0.5;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0.5 : inter / union;
}

// ─── Pairwise score ───────────────────────────────────────────────────────────

const LAYERABLE_TOPS = new Set(["base-top","overshirt","mid-layer","vest"]);

function pairScore(a: CatalogueGarment, b: CatalogueGarment): number {
  const slotA = getSlot(a);
  const slotB = getSlot(b);
  if (slotA === slotB) {
    if (LAYERABLE_TOPS.has(slotA)) return pairScoreRaw(a, b) * 0.75;
    return 0;
  }
  return pairScoreRaw(a, b);
}

function pairScoreRaw(a: CatalogueGarment, b: CatalogueGarment): number {
  const color    = colorCompatibility(a, b);
  const vein     = veinCompatibility(a, b);
  const aesthetic = aestheticSimilarity(a, b);
  return color * 0.35 + vein * 0.35 + aesthetic * 0.30;
}

// ─── Pairings matrix ─────────────────────────────────────────────────────────

export function computePairings(wardrobe: CatalogueGarment[]): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();
  for (const a of wardrobe) {
    const row = new Map<string, number>();
    for (const b of wardrobe) {
      if (a.id !== b.id) row.set(b.id, pairScore(a, b));
    }
    matrix.set(a.id, row);
  }
  return matrix;
}

function avgWith(item: CatalogueGarment, ids: string[], pairings: Map<string, Map<string, number>>): number {
  if (!ids.length) return 0.5;
  let sum = 0;
  for (const id of ids) sum += pairings.get(item.id)?.get(id) ?? 0;
  return sum / ids.length;
}

export function outfitQuality(items: CatalogueGarment[], pairings: Map<string, Map<string, number>>): number {
  if (items.length < 2) return 0;
  let sum = 0, cnt = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      sum += pairings.get(items[i].id)?.get(items[j].id) ?? 0;
      cnt++;
    }
  }
  return cnt === 0 ? 0 : sum / cnt;
}

// ─── Temperature helpers ──────────────────────────────────────────────────────

const TEMP_TIERS = [88, 72, 60, 50, 42, 34] as const;

function isColdTier(tempF: number): boolean { return tempF <= 55; }

function tempAllowsItem(item: CatalogueGarment, tempF: number): boolean {
  const slot = getSlot(item);
  if (slot === "outer"     && tempF >= 75) return false;
  if (slot === "mid-layer" && tempF >= 82) return false;
  if (slot === "sandals"   && tempF < 65)  return false;
  if (slot === "shorts"    && tempF < 60)  return false;
  return true;
}

export function outfitTempRange(items: CatalogueGarment[]): { minT: number; maxT: number } {
  const slots = items.map(g => getSlot(g));
  const has = (s: string) => slots.includes(s as ReturnType<typeof getSlot>);

  let minT = 0, maxT = 120;
  if (has("outer"))     maxT = Math.min(maxT, 68);
  if (has("mid-layer") && !has("outer")) maxT = Math.min(maxT, 74);
  if (!has("outer") && !has("mid-layer") && !has("vest") && !has("overshirt")) minT = Math.max(minT, 55);
  if (!has("outer") && !has("mid-layer")) minT = Math.max(minT, 45);
  if (has("sandals")) minT = Math.max(minT, 65);
  if (has("shorts"))  minT = Math.max(minT, 60);
  return { minT, maxT };
}

// ─── sim14 style-clash helpers ────────────────────────────────────────────────

function isAthleticBottom(g: CatalogueGarment): boolean {
  const t = `${g.sub_type ?? ""} ${g.title ?? ""}`.toLowerCase();
  return t.includes("sweatpant") || t.includes("jogger") || t.includes("track pant");
}

function isPoloLike(g: CatalogueGarment): boolean {
  return `${g.sub_type ?? ""} ${g.title ?? ""}`.toLowerCase().includes("polo");
}

// Prefer plain base-tops (tees, polos) over overshirt-style pieces for the
// underlayer position — a structured button-up peeking out under a hoodie or
// zip-up reads as a styling mistake. Only fall back to overshirt when no
// base-top is available in the wardrobe.
function pickUnderlayer(
  wardrobe: CatalogueGarment[],
  ids: Set<string>,
  tempF: number,
  pairings: Map<string, Map<string, number>>,
  outfitIds: string[],
): CatalogueGarment | null {
  const baseTops = wardrobe
    .filter(g => !ids.has(g.id) && getSlot(g) === "base-top" && tempAllowsItem(g, tempF))
    .sort((a, b) => avgWith(b, outfitIds, pairings) - avgWith(a, outfitIds, pairings));
  if (baseTops.length) return baseTops[0];
  const overshirts = wardrobe
    .filter(g => !ids.has(g.id) && getSlot(g) === "overshirt" && tempAllowsItem(g, tempF))
    .sort((a, b) => avgWith(b, outfitIds, pairings) - avgWith(a, outfitIds, pairings));
  return overshirts[0] ?? null;
}

// ─── Single outfit builder ────────────────────────────────────────────────────

const COMPLEXITY_THRESH = 0.52;
const SHIRT_STACK_THRESH = 0.68; // higher bar for layering overshirt over a base-top

function buildSingleOutfit(
  seed: CatalogueGarment,
  bottom: CatalogueGarment,
  shoe: CatalogueGarment,
  wardrobe: CatalogueGarment[],
  pairings: Map<string, Map<string, number>>,
  tempF: number,
): CatalogueGarment[] {
  const items: CatalogueGarment[] = [seed, bottom, shoe];
  const ids   = new Set([seed.id, bottom.id, shoe.id]);
  const slots = new Set([getSlot(seed), getSlot(bottom), getSlot(shoe)]);

  const add = (g: CatalogueGarment) => {
    items.push(g);
    ids.add(g.id);
    slots.add(getSlot(g));
  };

  const available = wardrobe.filter(g => !ids.has(g.id) && tempAllowsItem(g, tempF));
  const pickBest = (targetSlots: string[]): CatalogueGarment | null => {
    let best: CatalogueGarment | null = null, bestScore = -Infinity;
    for (const g of available) {
      if (!targetSlots.includes(getSlot(g))) continue;
      const s = avgWith(g, [...ids], pairings);
      if (s > bestScore) { bestScore = s; best = g; }
    }
    return best;
  };

  const seedSlot = getSlot(seed);

  // If seed is a mid-layer or outer, ensure base-top underneath
  if ((seedSlot === "mid-layer" || seedSlot === "outer") && !slots.has("base-top") && !slots.has("overshirt")) {
    const bt = pickUnderlayer(wardrobe, ids, tempF, pairings, [...ids]);
    if (bt) add(bt);
  }

  // Cold weather: inject warm layers
  if (tempF < 45 && !slots.has("outer")) {
    const outer = pickBest(["outer"]);
    if (outer) add(outer);
    if (!slots.has("mid-layer")) {
      const mid = pickBest(["mid-layer"]);
      if (mid) add(mid);
    }
    // Ensure base-top under layers (prefer tee/polo over button-up)
    if (!slots.has("base-top") && !slots.has("overshirt")) {
      const bt = pickUnderlayer(wardrobe, ids, tempF, pairings, [...ids]);
      if (bt) add(bt);
    }
  } else if (tempF < 55 && !slots.has("outer") && !slots.has("mid-layer") && !slots.has("vest") && !slots.has("overshirt")) {
    const warm = pickBest(["outer", "mid-layer", "vest"]);
    if (warm) add(warm);
  }

  // Optional complexity slots ordered by how well they match
  const optOrder = tempF >= 72
    ? ["hat", "bag", "neckwear", "wristwear", "rings", "eyewear"]
    : tempF >= 55
    ? ["overshirt", "vest", "hat", "bag", "neckwear", "wristwear", "rings"]
    : ["vest", "hat", "bag", "neckwear", "wristwear", "rings"];

  const remaining = wardrobe.filter(g => !ids.has(g.id) && tempAllowsItem(g, tempF));
  for (const optSlot of optOrder) {
    if (slots.has(optSlot as ReturnType<typeof getSlot>)) continue;
    // Open work shirt over sweatpants/joggers is a style clash
    if (optSlot === "overshirt" && isAthleticBottom(bottom)) continue;
    let best: CatalogueGarment | null = null, bestScore = -Infinity;
    for (const g of remaining) {
      if (getSlot(g) !== optSlot) continue;
      const s = avgWith(g, [...ids], pairings);
      if (s > bestScore) { bestScore = s; best = g; }
    }
    // Stacking an overshirt over an already-present base-top (two shirt layers) needs
    // a stronger compatibility bar; also never layer over a polo since polos are
    // meant to be worn as a standalone statement piece.
    if (optSlot === "overshirt" && slots.has("base-top")) {
      const baseTopItem = items.find(g => getSlot(g) === "base-top");
      if (baseTopItem && isPoloLike(baseTopItem)) continue;
      if (bestScore < SHIRT_STACK_THRESH) continue;
    }
    if (best && bestScore >= COMPLEXITY_THRESH) {
      if (optSlot === "mid-layer" && !slots.has("base-top") && !slots.has("overshirt")) {
        const bt = pickUnderlayer(wardrobe, ids, tempF, pairings, [...ids]);
        if (bt) add(bt);
      }
      add(best);
    }
  }

  return items;
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

export type CatalogueEntry = {
  items:    CatalogueGarment[];
  quality:  number;
  minT:     number;
  maxT:     number;
  tempF:    number;
  comboKey: string; // top|bottom|shoe IDs — repeat-tracking unit
};

export function buildCatalogue(
  wardrobe: CatalogueGarment[],
  pairings: Map<string, Map<string, number>>,
): CatalogueEntry[] {
  const catalogue: CatalogueEntry[] = [];
  const seenKeys  = new Set<string>();

  for (const tempF of TEMP_TIERS) {
    const available = wardrobe.filter(g => tempAllowsItem(g, tempF));
    const seeds   = available.filter(g => {
      const s = getSlot(g);
      return s === "base-top" || (s === "mid-layer" && tempF < 75) || (s === "overshirt" && tempF < 80);
    });
    const bottoms = available.filter(g => ["pants","shorts"].includes(getSlot(g)));
    const shoes   = available.filter(g => ["shoes","sandals"].includes(getSlot(g)));

    for (const seed of seeds) {
      for (const bottom of bottoms) {
        for (const shoe of shoes) {
          // Open overshirt as the seed garment with sweatpants/joggers is a style clash
          if (getSlot(seed) === "overshirt" && isAthleticBottom(bottom)) continue;

          const seedBotScore  = pairings.get(seed.id)?.get(bottom.id) ?? 0;
          const seedShoeScore = pairings.get(seed.id)?.get(shoe.id)   ?? 0;
          const botShoeScore  = pairings.get(bottom.id)?.get(shoe.id) ?? 0;
          const baseQuality   = (seedBotScore + seedShoeScore + botShoeScore) / 3;
          if (baseQuality < 0.30) continue;

          const items = buildSingleOutfit(seed, bottom, shoe, wardrobe, pairings, tempF);
          const slots = new Set(items.map(g => getSlot(g)));

          const hasTop  = slots.has("base-top") || slots.has("overshirt") || slots.has("mid-layer");
          const hasBot  = slots.has("pants") || slots.has("shorts");
          const hasFoot = slots.has("shoes") || slots.has("sandals");
          if (!hasTop || !hasBot || !hasFoot) continue;
          if (isColdTier(tempF) && !slots.has("outer") && !slots.has("mid-layer") && !slots.has("vest") && !slots.has("overshirt")) continue;
          if (slots.has("mid-layer") && !slots.has("base-top") && !slots.has("overshirt")) continue;

          const fullKey = items.map(g => g.id).sort().join("|") + "|t" + tempF;
          if (seenKeys.has(fullKey)) continue;
          seenKeys.add(fullKey);

          const quality = outfitQuality(items, pairings) + items.length * 0.008;
          const { minT, maxT } = outfitTempRange(items);

          const topItem  = items.find(g => ["base-top","overshirt","mid-layer"].includes(getSlot(g)));
          const botItem  = items.find(g => ["pants","shorts"].includes(getSlot(g)));
          const shoeItem = items.find(g => ["shoes","sandals"].includes(getSlot(g)));
          const comboKey = topItem && botItem && shoeItem
            ? `${topItem.id}|${botItem.id}|${shoeItem.id}`
            : fullKey;

          catalogue.push({ items, quality, minT, maxT, tempF, comboKey });
        }
      }
    }
  }

  catalogue.sort((a, b) => b.quality - a.quality);
  return catalogue;
}

// ─── Month generation ─────────────────────────────────────────────────────────

const ITEM_COOLDOWN_DAYS = 4;

export function generateMonthFromCatalogue(
  catalogue: CatalogueEntry[],
  dateTemps: Record<string, number>,
): Record<string, CatalogueGarment[]> {
  const usedCombos = new Set<string>();
  const itemLastDay = new Map<string, number>(); // garment id -> day index last worn
  const results: Record<string, CatalogueGarment[]> = {};

  // Process dates in chronological order so the freshness tracker is meaningful
  const dates = Object.keys(dateTemps).sort();

  dates.forEach((date, dayIdx) => {
    const tempF = dateTemps[date];

    // Among valid (unused combo, temp-appropriate) entries, prefer those with
    // the fewest recently-worn pieces. Catalogue is already quality-sorted, so
    // within any stale-count tier the first entry encountered is the best one.
    const valid = catalogue.filter(e =>
      !usedCombos.has(e.comboKey) && tempF >= e.minT && tempF <= e.maxT);

    let picked: CatalogueEntry | null = null;
    if (valid.length) {
      let bestStale = Infinity;
      for (const entry of valid) {
        const stale = entry.items.filter(g => {
          const last = itemLastDay.get(g.id);
          return last !== undefined && (dayIdx - last) < ITEM_COOLDOWN_DAYS;
        }).length;
        if (stale < bestStale) {
          bestStale = stale;
          picked = entry;
          if (stale === 0) break; // already quality-sorted; first zero-stale wins
        }
      }
    }

    if (!picked) {
      // Catalogue exhausted for this temp range — allow a combo-key repeat
      for (const entry of catalogue) {
        if (tempF >= entry.minT && tempF <= entry.maxT) {
          picked = entry;
          break;
        }
      }
    }

    if (picked) {
      usedCombos.add(picked.comboKey);
      for (const g of picked.items) itemLastDay.set(g.id, dayIdx);
      results[date] = picked.items;
    }
  });

  return results;
}
