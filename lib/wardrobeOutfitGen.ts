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
  return (
    l.includes("flannel") || l.includes("oxford") || l.includes("camp collar") ||
    l.includes("bowling") || l.includes("western") || l.includes("chambray") ||
    l.includes("button-up") || l.includes("button up") ||
    l.includes("button-down") || l.includes("button down") ||
    l.includes("dress shirt") || l.includes("work shirt") ||
    l.includes("linen shirt") || l.includes("denim shirt") ||
    l.includes("printed shirt") || l.includes("silk shirt") ||
    l.includes("rugby") ||
    (l.includes("polo") && !l.includes("polo neck"))
  );
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

// Casual overshirts where a tee underneath is a valid intentional look (flannel open over
// white tee is a classic). Distinct from structured button-ups (Oxford, dress shirt) where
// a tee reads as an undershirt rather than intentional layering.
function isCasualOvershirt(item: GarmentForScoring): boolean {
  const l = (item.sub_type ?? "").toLowerCase();
  return (
    l.includes("flannel") || l.includes("camp collar") || l.includes("chambray") ||
    l.includes("work shirt") || l.includes("western") || l.includes("bowling") ||
    l.includes("linen shirt") || l.includes("denim shirt") || l.includes("shacket") ||
    l.includes("overshirt")
  );
}

// Structured button-ups where a visible tee underneath reads as an undershirt, not style.
function isStructuredButtonUp(item: GarmentForScoring): boolean {
  const l = (item.sub_type ?? "").toLowerCase();
  return (
    l.includes("oxford") || l.includes("dress shirt") ||
    l.includes("printed shirt") || l.includes("silk shirt") ||
    ((l.includes("button-up") || l.includes("button-down")) && !isCasualOvershirt(item))
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
//   2. Tee under a structured button-up (Oxford, dress shirt) = blocked entirely
//   3. Tee under a casual overshirt (flannel, chambray, etc.) = allowed only if tee color
//      passes the contrast check (light/neutral always OK; dark tee needs dark shirt)
//   4. Two basic tees stacked = blocked
//   5. For non-outer combos, require a genuine underlayer (long-sleeve, thermal, etc.)
function isValidBaseCombo(items: GarmentForScoring[]): boolean {
  if (items.length <= 1) return true;
  const outerCapableCount = items.filter(isOuterCapableBase).length;
  if (outerCapableCount > 1) return false;
  if (items.filter(isBasicTee).length > 1) return false; // no tee-on-tee
  if (outerCapableCount > 0 && items.some(isBasicTee)) {
    const tee   = items.find(isBasicTee)!;
    const shirt = items.find(isOuterCapableBase)!;
    if (isStructuredButtonUp(shirt)) return false; // tee under Oxford/dress shirt = never
    if (isCasualOvershirt(shirt)) return teeLooksGoodUnderOvershirt(tee, shirt);
    return false; // unknown outer-capable type — block to be safe
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
  options: { maxTotal?: number; tempF?: number; requireFoot?: boolean; noFloor?: boolean } = {},
): RankedOutfit[] {
  const { maxTotal = 3000, tempF, requireFoot = true, noFloor = false } = options;

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

  const results: RankedOutfit[] = [];
  const seen = new Set<string>();
  let dynamicFloor = 0; // rises as results fill up, pruning low-quality combos

  function tryAdd(configName: string, items: GarmentForScoring[]) {
    // Hard guard: no two outer-capable base items in the same outfit.
    // (polo+polo, polo+oxford, oxford+flannel → all rejected before scoring)
    // This is a physical/structural rule — you cannot layer two collared or
    // button-front tops without a collar/placket war that looks like an accident.
    const baseItems = items.filter(i => getSlot(i.sub_type) === "base");
    if (!isValidBaseCombo(baseItems)) return;

    const key = items.map((i) => i.id).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    const score = scoreOutfit(items, tempF, { requireFoot });
    if (!noFloor && score <= dynamicFloor) return;
    if (score <= 0) return; // always drop truly invalid combos
    results.push({ items, score, configName });
    // Every time we accumulate 2× the target, sort and trim so memory stays bounded
    if (!noFloor && results.length >= maxTotal * 2) {
      results.sort((a, b) => b.score - a.score);
      results.splice(maxTotal);
      dynamicFloor = results[results.length - 1].score;
    }
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

    const baseGroups =
      cfg.baseCount > 0
        ? combinations(base, cfg.baseCount)
        : [[] as GarmentForScoring[]];

    const midOpts   = cfg.mid   ? mid   : [null as GarmentForScoring | null];
    const vestOpts  = cfg.vest  ? vest  : [null as GarmentForScoring | null];
    const outerOpts = cfg.outer ? outer : [null as GarmentForScoring | null];

    for (const basePick of baseGroups) {
      for (const botItem of bottomPool) {
        for (const footItem of footOptions) {
          for (const midItem of midOpts) {
            for (const vestItem of vestOpts) {
              for (const outerItem of outerOpts) {
                for (const sitItem of sitAccOpts) {
                  for (const jewSubset of jewelrySubsets) {
                    tryAdd(cfg.name, [
                      ...basePick,
                      ...(midItem   ? [midItem]   : []),
                      ...(vestItem  ? [vestItem]  : []),
                      ...(outerItem ? [outerItem] : []),
                      botItem,
                      ...(footItem  ? [footItem]  : []),
                      ...jewSubset,
                      ...(sitItem ? [sitItem] : []),
                    ]);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  if (results.length > maxTotal) results.splice(maxTotal);
  return results;
}
