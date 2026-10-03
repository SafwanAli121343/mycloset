// Blueprint-based wardrobe outfit generator (8-slot system).
// Generates every feasible outfit from a wardrobe using the 32 canonical stack
// configurations, scores each with scoring.ts, and returns all outfits sorted
// highest-score first.

import { type GarmentForScoring, getSlot, resolveSlot, scoreOutfit } from "@/lib/scoring";

// ── Exclusions ────────────────────────────────────────────────────────────────
// Valid for the slot system but excluded from outfit generation.

const EXCLUDED_FROM_GENERATOR = new Set([
  "Swim Shorts", "Bikini Top", "Bikini Bottom", "Tankini Top",
  "One-Piece Swimsuit", "Evening Gown", "Cocktail Dress", "Wedding Dress",
  "Wetsuit", "Ski Boots", "Ice Skates", "Athletic Cleats",
]);

// ── Base-layer tier classification ───────────────────────────────────────────
// "Outer-capable" base items (collared, structured, button-front) are terminating
// layers — fine worn alone, but must never be placed under another outer-capable item.
// Rule: in a multi-base combo, at most ONE outer-capable item is allowed, and it
// must be the outermost. At least one item must be a "true inner base".
// Internet consensus: polo-under-oxford, polo-under-polo = hard no (Art of Manliness,
// FashionBeans). Tee/henley under oxford/flannel = classic intentional look.

const OUTER_CAPABLE_BASE_SUBTYPES = new Set([
  // Collared shirts with visible placket — terminating layer
  "Polo", "Polo Shirt", "Rugby Shirt",
  // Button-front tops — always outermost when stacked
  "Oxford Shirt", "Flannel Shirt", "Camp Collar Shirt", "Work Shirt",
  "Linen Shirt", "Dress Shirt", "Chambray Shirt", "Denim Shirt",
  "Printed Shirt", "Silk Shirt", "Western Shirt", "Bowling Shirt",
  "Button-Down Shirt", "Button-Up Shirt",
]);

// Returns true if this item should only be the outermost base layer when stacked.
function isOuterCapableBase(item: GarmentForScoring): boolean {
  if (OUTER_CAPABLE_BASE_SUBTYPES.has(item.sub_type ?? "")) return true;
  // Keyword fallback for sub_types not in the explicit set (DB items often have
  // composite names like "Short Sleeve Button-Up Shirt" or "Striped Oxford Shirt")
  const l = (item.sub_type ?? "").toLowerCase();
  if (
    l.includes("flannel") || l.includes("oxford") || l.includes("camp collar") ||
    l.includes("bowling") || l.includes("western") || l.includes("chambray") ||
    l.includes("button-up") || l.includes("button up") ||
    l.includes("button-down") || l.includes("button down") ||
    l.includes("dress shirt") || l.includes("work shirt") ||
    l.includes("linen shirt") || l.includes("denim shirt") ||
    l.includes("printed shirt") || l.includes("silk shirt") ||
    l.includes("rugby") ||
    (l.includes("polo") && !l.includes("polo neck"))
  ) return true;
  // Generic fallback: a garment simply tagged "shirt" (sub_type or free-form title) is a
  // woven, collared, button-front garment by default — outer-capable — UNLESS it specifically
  // matches one of the KNOWN knit/base-layer patterns below. Without this, a plain "Long Sleeve
  // Shirt" or "Longsleeve Button-Up" (an AI-tagged name that doesn't happen to hit any of the
  // specific keywords above) fell through to isProperUnderlayer purely because it also matched
  // "long sleeve" — letting a t-shirt get validated as hidden underneath an actual button-up
  // shirt, which is never a real look (see isValidBaseCombo's own doc comment).
  const title = (item.title ?? "").toLowerCase();
  const looksLikeKnitBase =
    l.includes("henley") || title.includes("henley") ||
    l.includes("thermal") || title.includes("thermal") ||
    l.includes("turtleneck") || title.includes("turtleneck") ||
    l.includes("mock neck") || l.includes("mock-neck") ||
    l.includes("tank") || l.includes("undershirt") ||
    l.includes("t-shirt") || l.includes("tee") || title.includes("t-shirt");
  return (l.includes("shirt") || title.includes("shirt")) && !looksLikeKnitBase;
}

// Returns true if this item is a true inner/under layer (long-sleeve base, thermal, henley, etc.)
// that makes sense worn UNDER another top.
function isProperUnderlayer(item: GarmentForScoring): boolean {
  const sub = (item.sub_type ?? "").toLowerCase();
  const title = (item.title ?? "").toLowerCase();
  return (
    sub.includes("long sleeve") || sub.includes("longsleeve") ||
    sub.includes("long-sleeve") || sub.includes("thermal") ||
    sub.includes("henley") || sub.includes("turtleneck") ||
    sub.includes("mock neck") || sub.includes("mock-neck") ||
    sub.includes("tank") || sub.includes("undershirt") ||
    title.includes("longsleeve") || title.includes("long sleeve") ||
    title.includes("long-sleeve") || title.includes("thermal")
  );
}

// Returns true if item is a short-sleeve t-shirt (not a long-sleeve, thermal, etc.)
function isBasicTee(item: GarmentForScoring): boolean {
  const sub = (item.sub_type ?? "").toLowerCase();
  const title = (item.title ?? "").toLowerCase();
  const isLs = sub.includes("long sleeve") || sub.includes("long-sleeve") ||
               sub.includes("longsleeve") || sub.includes("thermal") ||
               title.includes("long sleeve") || title.includes("long-sleeve") ||
               title.includes("longsleeve") || title.includes("thermal");
  return !isLs && (
    sub.includes("t-shirt") || sub.includes("tee") ||
    sub.includes("graphic tee") || sub.includes("muscle tee") ||
    sub === "top" || sub.includes("v-neck")
  );
}



// Light/neutral tee colors that work under any casual overshirt regardless of shirt color.
const LIGHT_NEUTRAL_TEE = new Set([
  "white", "off-white", "off white", "cream", "ivory", "ecru", "oatmeal", "natural",
  "light grey", "light gray", "heather", "heather grey", "heather gray",
  "grey", "gray",  // medium grey is generally fine
  "beige",
]);
// Dark colors — only acceptable as underlayer when the overshirt is also dark.
const DARK_COLORS = new Set([
  "black", "charcoal", "dark grey", "dark gray", "navy", "dark navy", "dark blue",
  "dark brown", "dark green", "dark red", "dark burgundy", "dark olive",
]);

function teeLooksGoodUnderOvershirt(tee: GarmentForScoring, shirt: GarmentForScoring): boolean {
  const teeColor  = (tee.color_primary  ?? "").toLowerCase().trim();
  const shirtColor = (shirt.color_primary ?? "").toLowerCase().trim();
  // Graphic tees at the collar look cluttered regardless of color
  if ((tee.sub_type ?? "").toLowerCase().includes("graphic")) return false;
  if (!teeColor || !shirtColor) return true; // unknown colors — allow, can't determine
  if (LIGHT_NEUTRAL_TEE.has(teeColor)) return true; // light/neutral always works
  if (DARK_COLORS.has(teeColor)) return DARK_COLORS.has(shirtColor); // dark tee needs dark shirt
  return true; // medium/other tee colors — allow by default
}

// Guard: is this combination of base items valid for layering?
//   1. At most one outer-capable item (no polo+oxford, no polo+polo, etc.)
//   2-3. Tee under any outer-capable shirt (flannel, oxford, button-up…) = allowed, with or
//      without a jacket over it, as long as the tee's color passes the contrast check
//      (light/neutral always OK; dark tee needs dark shirt; graphic tees blocked at the collar)
//   4. Two basic tees stacked = blocked
//   5. For non-outer combos, require a genuine underlayer (long-sleeve, thermal, etc.)
// `hasOuterLayer`: true when this specific outfit ALSO includes a real outer-slot garment (a
// jacket/coat, not a base-layer shirt) — the outer-capable base item is then acting as a MIDDLE
// layer, not the terminating one, which is exactly the case rule 3's "casual overshirt" carve-out
// was already making room for; this just extends the same reasoning to ANY outer-capable shirt
// once something genuinely covers the whole stack, rather than only the pre-listed casual ones.
function isValidBaseCombo(items: GarmentForScoring[], hasOuterLayer: boolean = false): boolean {
  if (items.length <= 1) return true;
  const outerCapableCount = items.filter(isOuterCapableBase).length;
  if (outerCapableCount > 1) return false;
  if (items.filter(isBasicTee).length > 1) return false; // no tee-on-tee
  if (outerCapableCount > 0 && items.some(isBasicTee)) {
    // A tee under ANY overshirt/button-up is a valid look (per the user's explicit call — e.g.
    // a tee under an open flannel or an unbuttoned oxford), with or without a jacket over the
    // stack. Only the visual-contrast check remains: graphic tees clutter the collar, and a dark
    // tee needs a dark shirt over it.
    const tee   = items.find(isBasicTee)!;
    const shirt = items.find(isOuterCapableBase)!;
    return teeLooksGoodUnderOvershirt(tee, shirt);
  }
  if (outerCapableCount === 0 && !items.some(isProperUnderlayer)) return false;
  return true;
}


// Onepiece-slot items that require a base underlayer (open bib at chest).
const OVERALLS_SUBTYPES = new Set([
  "Overalls", "Dungarees", "Denim Overalls", "Shortalls", "Pinafore Dress",
]);

// ── Stack configurations ──────────────────────────────────────────────────────

type BottomKind =
  | "bottom"            // regular bottom slot
  | "onepiece"          // onepiece replaces top + bottom (no base)
  | "overalls"          // onepiece that needs a base showing underneath
  | "onepiece_over_base"; // dress layered over a base (new configs)

type StackConfig = {
  name: string;
  baseCount: 0 | 1 | 2 | 3;
  mid: boolean;
  vest: boolean;
  outer: boolean;
  bottomKind: BottomKind;
};

export const STACK_CONFIGS: StackConfig[] = [
  // ── base + bottom (17) ────────────────────────────────────────────────────
  { name: "Clean minimal",               baseCount: 1, mid: false, vest: false, outer: false, bottomKind: "bottom" },
  { name: "Layered base",                baseCount: 2, mid: false, vest: false, outer: false, bottomKind: "bottom" },
  { name: "Triple base",                 baseCount: 3, mid: false, vest: false, outer: false, bottomKind: "bottom" },
  { name: "Base + vest",                 baseCount: 1, mid: false, vest: true,  outer: false, bottomKind: "bottom" },
  { name: "Layered base + vest",         baseCount: 2, mid: false, vest: true,  outer: false, bottomKind: "bottom" },
  { name: "Base + mid",                  baseCount: 1, mid: true,  vest: false, outer: false, bottomKind: "bottom" },
  { name: "Layered base + mid",          baseCount: 2, mid: true,  vest: false, outer: false, bottomKind: "bottom" },
  { name: "Base + mid + vest",           baseCount: 1, mid: true,  vest: true,  outer: false, bottomKind: "bottom" },
  { name: "Layered base + mid + vest",   baseCount: 2, mid: true,  vest: true,  outer: false, bottomKind: "bottom" },
  { name: "Base + outer",                baseCount: 1, mid: false, vest: false, outer: true,  bottomKind: "bottom" },
  { name: "Layered base + outer",        baseCount: 2, mid: false, vest: false, outer: true,  bottomKind: "bottom" },
  { name: "Triple base + outer",         baseCount: 3, mid: false, vest: false, outer: true,  bottomKind: "bottom" },
  { name: "Base + mid + outer",          baseCount: 1, mid: true,  vest: false, outer: true,  bottomKind: "bottom" },
  { name: "Layered base + mid + outer",  baseCount: 2, mid: true,  vest: false, outer: true,  bottomKind: "bottom" },
  { name: "Base + vest + outer",         baseCount: 1, mid: false, vest: true,  outer: true,  bottomKind: "bottom" },
  { name: "Layered base + vest + outer", baseCount: 2, mid: false, vest: true,  outer: true,  bottomKind: "bottom" },
  { name: "Base + mid + vest + outer",   baseCount: 1, mid: true,  vest: true,  outer: true,  bottomKind: "bottom" },
  // ── onepiece (8) ─────────────────────────────────────────────────────────
  { name: "One-piece only",                 baseCount: 0, mid: false, vest: false, outer: false, bottomKind: "onepiece" },
  { name: "One-piece + mid",                baseCount: 0, mid: true,  vest: false, outer: false, bottomKind: "onepiece" },
  { name: "One-piece + vest",               baseCount: 0, mid: false, vest: true,  outer: false, bottomKind: "onepiece" },
  { name: "One-piece + outer",              baseCount: 0, mid: false, vest: false, outer: true,  bottomKind: "onepiece" },
  { name: "One-piece + mid + outer",        baseCount: 0, mid: true,  vest: false, outer: true,  bottomKind: "onepiece" },
  { name: "One-piece + vest + outer",       baseCount: 0, mid: false, vest: true,  outer: true,  bottomKind: "onepiece" },
  { name: "One-piece + mid + vest",         baseCount: 0, mid: true,  vest: true,  outer: false, bottomKind: "onepiece" },
  { name: "One-piece + mid + vest + outer", baseCount: 0, mid: true,  vest: true,  outer: true,  bottomKind: "onepiece" },
  // ── overalls (3) ─────────────────────────────────────────────────────────
  { name: "Overalls + underlayer",          baseCount: 1, mid: false, vest: false, outer: false, bottomKind: "overalls" },
  { name: "Overalls + underlayer + outer",  baseCount: 1, mid: false, vest: false, outer: true,  bottomKind: "overalls" },
  { name: "Overalls + mid + outer",         baseCount: 1, mid: true,  vest: false, outer: true,  bottomKind: "overalls" },
  // ── base under onepiece (3) ───────────────────────────────────────────────
  { name: "Base under one-piece",               baseCount: 1, mid: false, vest: false, outer: false, bottomKind: "onepiece_over_base" },
  { name: "Base under one-piece + outer",       baseCount: 1, mid: false, vest: false, outer: true,  bottomKind: "onepiece_over_base" },
  { name: "Base under one-piece + mid",         baseCount: 1, mid: true,  vest: false, outer: false, bottomKind: "onepiece_over_base" },
  { name: "Base under one-piece + mid + outer", baseCount: 1, mid: true,  vest: false, outer: true,  bottomKind: "onepiece_over_base" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Category-first slot resolution. When a garment has an explicit category,
// Thin wrapper — resolveSlot in scoring.ts is the single source of truth
// for category-aware slot assignment.
function categoryAwareSlot(item: GarmentForScoring): string | null {
  return resolveSlot(item);
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [first, ...c]),
    ...combinations(rest, k),
  ];
}

// ── Public types ──────────────────────────────────────────────────────────────

export type RankedOutfit = {
  items: GarmentForScoring[];
  score: number;
  configName: string;
};

// ── Main generator ────────────────────────────────────────────────────────────

export function generateAndRankAllOutfits(
  wardrobe: GarmentForScoring[],
  // accessories:false → clothing combinations only (no accessory variations). For COUNTING
  // distinct outfits (Preview): with accessories, each clothing combination was counted once per
  // accessory variation — ~5x inflated, and every preview hit the 10,000 cap.
  options: { maxTotal?: number; tempF?: number; requireFoot?: boolean; noFloor?: boolean; accessories?: boolean } = {},
): RankedOutfit[] {
  const { maxTotal = 3000, tempF, requireFoot = true, noFloor = false, accessories = true } = options;

  // Bucket wardrobe by slot
  const base:     GarmentForScoring[] = [];
  const mid:      GarmentForScoring[] = [];
  const vest:     GarmentForScoring[] = [];
  const outer:    GarmentForScoring[] = [];
  const bottom:   GarmentForScoring[] = [];
  const foot:     GarmentForScoring[] = [];
  const onepiece: GarmentForScoring[] = [];   // non-overalls dresses/jumpsuits
  const overalls: GarmentForScoring[] = [];   // overalls/dungarees/shortalls
  const accRaw:   GarmentForScoring[] = [];   // accessories

  for (const item of wardrobe) {
    if (EXCLUDED_FROM_GENERATOR.has(item.sub_type ?? "")) continue;
    const slot = categoryAwareSlot(item);
    if (!slot) continue;
    switch (slot) {
      case "base":   base.push(item);    break;
      case "mid":    mid.push(item);     break;
      case "vest":   vest.push(item);    break;
      case "outer":  outer.push(item);   break;
      case "bottom": bottom.push(item);  break;
      case "foot":   foot.push(item);    break;
      case "acc":    accRaw.push(item);  break;
      case "onepiece":
        if (OVERALLS_SUBTYPES.has(item.sub_type ?? "")) overalls.push(item);
        else onepiece.push(item);
        break;
    }
  }

  // Split accessories into two tiers based on real-world wearing habits:
  //
  // Everyday jewelry — items worn regardless of outfit (rings, earrings, necklaces,
  // bracelets, watches). These are always included in every generated outfit.
  // There's no meaningful "repetition" for a ring you wear daily.
  //
  // Situational accessories — items chosen per outfit (hats, bags, scarves, belts,
  // sunglasses). These are tried with and without; repetition does matter for hats.
  function isEverydayJewelry(item: GarmentForScoring): boolean {
    const s = (item.sub_type ?? item.title ?? "").toLowerCase();
    return (
      s.includes("ring")      || s.includes("stud")     || s.includes("hoop")    ||
      s.includes("earring")   ||
      s.includes("necklace")  || s.includes("chain")    || s.includes("pendant") ||
      s.includes("bracelet")  || s.includes("bangle")   ||
      s.includes("watch")     || s.includes("anklet")
    );
  }
  const everydayJewelry: GarmentForScoring[] = accRaw.filter(isEverydayJewelry);
  const situationalAcc:  GarmentForScoring[] = accRaw.filter(a => !isEverydayJewelry(a));
  // Situational accessories: try without or with one item. Cap at 5 to limit explosion.
  const sitAccOpts: Array<GarmentForScoring | null> = [null, ...situationalAcc.slice(0, 5)];

  // Jewelry subsets: every combination from none to all pieces.
  // With 2 rings: [], [r1], [r2], [r1,r2] — 4 options.
  // Cap at 16 subsets to prevent explosion when the user has many jewelry pieces.
  const jewelrySubsets: GarmentForScoring[][] = [[]];
  for (let k = 1; k <= everydayJewelry.length; k++) {
    for (const sub of combinations(everydayJewelry, k)) {
      jewelrySubsets.push(sub);
      if (jewelrySubsets.length >= 16) break;
    }
    if (jewelrySubsets.length >= 16) break;
  }

  const footOptions: Array<GarmentForScoring | null> =
    foot.length ? foot : requireFoot ? [] : [null];
  if (!footOptions.length) return [];

  // ── Two-stage search, per-config buckets ─────────────────────────────────────────────────
  // Stage 1 scores CORE outfits (clothes only); stage 2 tries accessory variations only on the
  // cores that survive. Scoring every core × every accessory variation (up to 96 of them) was
  // millions of scoreOutfit calls — ~60s for a 50-item wardrobe on the server.
  //
  // Each STACK_CONFIG keeps its OWN best results (bucket + floor) instead of competing in one
  // global top-N: layered looks reliably outscore plain ones, so a single global floor pruned
  // EVERY "Clean minimal" (tee + bottom + shoes) outfit out of the pool — and the month planner
  // then had nothing weather-appropriate for hot days and fell back to sweatshirts at 97°F. The
  // final pool guarantees every config a fair share, then fills the rest by score.
  type Bucket = { items: RankedOutfit[]; floor: number };
  const buckets = new Map<string, Bucket>();
  const seen = new Set<string>();
  const coreCap = Math.max(50, Math.ceil(maxTotal / 3)); // cores kept per config for stage 2
  const bucketCap = maxTotal;                           // finished outfits kept per config

  function pushBounded(b: Bucket, entry: RankedOutfit, cap: number) {
    b.items.push(entry);
    if (!noFloor && b.items.length >= cap * 2) {
      b.items.sort((a, c) => c.score - a.score);
      b.items.splice(cap);
      b.floor = b.items[b.items.length - 1].score;
    }
  }
  function trimmed(b: Bucket, cap: number): RankedOutfit[] {
    b.items.sort((a, c) => c.score - a.score);
    if (!noFloor && b.items.length > cap) b.items.splice(cap);
    return b.items;
  }

  for (const cfg of STACK_CONFIGS) {
    const bottomPool =
      cfg.bottomKind === "bottom"              ? bottom
      : cfg.bottomKind === "onepiece"          ? onepiece
      : cfg.bottomKind === "overalls"          ? overalls
      :                                          onepiece; // onepiece_over_base

    if (!bottomPool.length) continue;
    if (cfg.baseCount > 0 && base.length < cfg.baseCount) continue;
    if (cfg.mid   && !mid.length)   continue;
    if (cfg.vest  && !vest.length)  continue;
    if (cfg.outer && !outer.length) continue;

    // Base-layer validity depends only on the base items themselves, so invalid stacks
    // (two collared shirts, tee-on-tee, a dark tee under a light shirt…) are dropped once here
    // instead of being rebuilt and rejected inside every inner loop.
    const baseGroups =
      (cfg.baseCount > 0 ? combinations(base, cfg.baseCount) : [[] as GarmentForScoring[]])
        .filter(group => isValidBaseCombo(group));

    const midOpts   = cfg.mid   ? mid   : [null as GarmentForScoring | null];
    const vestOpts  = cfg.vest  ? vest  : [null as GarmentForScoring | null];
    const outerOpts = cfg.outer ? outer : [null as GarmentForScoring | null];

    // Stage 1: core outfits.
    const cores: Bucket = { items: [], floor: 0 };
    for (const basePick of baseGroups) {
      for (const botItem of bottomPool) {
        for (const footItem of footOptions) {
          for (const midItem of midOpts) {
            for (const vestItem of vestOpts) {
              for (const outerItem of outerOpts) {
                const items = [
                  ...basePick,
                  ...(midItem   ? [midItem]   : []),
                  ...(vestItem  ? [vestItem]  : []),
                  ...(outerItem ? [outerItem] : []),
                  botItem,
                  ...(footItem  ? [footItem]  : []),
                ];
                const score = scoreOutfit(items, tempF, { requireFoot });
                if (score <= 0) continue;                         // truly invalid
                if (!noFloor && score <= cores.floor) continue;
                pushBounded(cores, { items, score, configName: cfg.name }, coreCap);
              }
            }
          }
        }
      }
    }

    // Stage 2: accessory variations of the surviving cores (the no-accessory variant included).
    const bucket: Bucket = { items: [], floor: 0 };
    for (const core of trimmed(cores, coreCap)) {
      for (const sitItem of accessories ? sitAccOpts : [null]) {
        for (const jewSubset of accessories ? jewelrySubsets : [[] as GarmentForScoring[]]) {
          const items = [...core.items, ...jewSubset, ...(sitItem ? [sitItem] : [])];
          const key = items.map((i) => i.id).sort().join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          const score = items.length === core.items.length ? core.score : scoreOutfit(items, tempF, { requireFoot });
          if (score <= 0) continue;
          if (!noFloor && score <= bucket.floor) continue;
          pushBounded(bucket, { items, score, configName: cfg.name }, bucketCap);
        }
      }
    }
    buckets.set(cfg.name, bucket);
  }

  // Final pool: every config with results first gets its top `quota`, then the remaining room
  // is filled by global score. Sorted best-first, as every consumer expects.
  const perConfig = [...buckets.values()].map(b => trimmed(b, bucketCap)).filter(l => l.length);
  if (noFloor) {
    const all = perConfig.flat().sort((a, b) => b.score - a.score);
    if (all.length > maxTotal) all.splice(maxTotal);
    return all;
  }
  const quota = perConfig.length ? Math.max(1, Math.floor(maxTotal / perConfig.length / 2)) : 0;
  const picked: RankedOutfit[] = [];
  const rest: RankedOutfit[] = [];
  for (const list of perConfig) { picked.push(...list.slice(0, quota)); rest.push(...list.slice(quota)); }
  rest.sort((a, b) => b.score - a.score);
  for (const o of rest) { if (picked.length >= maxTotal) break; picked.push(o); }
  picked.sort((a, b) => b.score - a.score);
  return picked;
}
