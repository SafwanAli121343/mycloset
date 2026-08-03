// Monthly calendar outfit planner.
//
// For each day it:
//   1. Determines the highest complexity config tier viable for that day's weather.
//   2. Picks the best outfit by blending style score + recency-based novelty.
//
// Novelty uses a "days since last worn" approach: the longer an item hasn't
// appeared, the higher its novelty score. This continuously rotates the wardrobe
// rather than collapsing to zero novelty once all items have been seen.
//
// A secondary cycle-reset tracker reports when every wardrobe item has appeared
// at least once — useful for the UI but not used in the ranking logic.
//
// Blend weights: 60% style, 40% novelty — proven balance between outfit quality
// and wardrobe rotation in fashion recommendation literature.

import { generateAndRankAllOutfits, type RankedOutfit } from "./wardrobeOutfitGen";
import { getViableConfigs, CONFIG_COMPLEXITY, type DayWeather } from "./weatherOutfitFilter";
import type { GarmentForScoring } from "./scoring";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DayPlan = {
  date: string;
  outfit: {
    score: number;
    configName: string;
    complexityTier: number;
    items: {
      id: string;
      title: string | null;
      brand?: string | null;
      sub_type?: string | null;
      color_primary?: string | null;
      image?: string | null;
    }[];
  };
  cycleNumber: number;
  newItemsCount: number;  // items in this outfit that hadn't been used in the current cycle
};

export type MonthPlan = {
  days: DayPlan[];
  cycleResets: string[];  // dates when every wardrobe item had appeared at least once
};

// ── Constants ─────────────────────────────────────────────────────────────────

// Unified scoring weights — style is primary, tier is a small tiebreaker, novelty rotates wardrobe.
// Tier is normalised to 0-1 (tier/5) and contributes 0.05 max so a Tier-2 outfit scoring 91
// beats a Tier-4 outfit scoring 72 — style wins over complexity when quality differs.
const STYLE_WEIGHT   = 0.60;
const TIER_WEIGHT    = 0.05;  // soft preference: same-quality higher-tier outfit nudged up
const NOVELTY_WEIGHT = 0.35;

// Max candidates drawn from all weather-viable outfits (already sorted best-first by style).
const MAX_CANDIDATES = 400;

// ── Novelty helpers ───────────────────────────────────────────────────────────

// Items worn every day regardless of outfit — rings, earrings, necklaces, watches, etc.
// Repetition rules don't apply: a ring worn yesterday is as "fresh" as one worn a month ago.
// Giving them full novelty always keeps the ranking focused on clothing variety.
function isEverydayJewelry(item: GarmentForScoring): boolean {
  const s = ((item as { sub_type?: string | null }).sub_type ?? "").toLowerCase();
  return (
    s.includes("ring")      || s.includes("stud")     || s.includes("hoop")    ||
    s.includes("earring")   ||
    s.includes("necklace")  || s.includes("chain")    || s.includes("pendant") ||
    s.includes("bracelet")  || s.includes("bangle")   ||
    s.includes("watch")     || s.includes("anklet")
  );
}

// Recency-based novelty: items not worn recently score higher.
// lastSeenDay[id] = day index (0-based) when the item was last used.
// An item never used returns 1.0.  An item used yesterday at day 10 returns
// 1/11 ≈ 0.09.  Items used 10+ days ago approach 1.0 naturally.
// Everyday jewelry always returns 1.0 — repetition is irrelevant for a daily ring.
function outfitNovelty(
  outfit: RankedOutfit,
  lastSeenDay: Map<string, number>,
  currentDayIdx: number,
): number {
  let sum = 0;
  for (const item of outfit.items) {
    if (isEverydayJewelry(item)) {
      sum += 1.0; // always full novelty — worn every day by design
      continue;
    }
    const last = lastSeenDay.get(item.id);
    if (last === undefined) {
      sum += 1.0; // never worn
    } else {
      // Clamp to 1.0 so seed items with negative day offsets (from prior months)
      // don't inflate novelty above the maximum and distort scoring.
      sum += Math.min(1.0, (currentDayIdx - last) / (currentDayIdx + 1));
    }
  }
  return sum / outfit.items.length;
}

// Jaccard similarity between two outfits' item sets (0 = nothing shared, 1 = identical).
function jaccardSimilarity(a: RankedOutfit, b: RankedOutfit): number {
  const aIds = new Set(a.items.map((i) => i.id));
  const bIds = new Set(b.items.map((i) => i.id));
  let intersection = 0;
  for (const id of aIds) if (bIds.has(id)) intersection++;
  const union = aIds.size + bIds.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Combination-level diversity penalty: how similar is this outfit to the last N picks?
// Returns 0–1 where 1 means identical to a recent outfit.
// Only kicks in when similarity > 0.5 (more than half the items are shared).
function combinationRepeatPenalty(outfit: RankedOutfit, recentPicks: RankedOutfit[]): number {
  if (recentPicks.length === 0) return 0;
  let maxSim = 0;
  for (const prev of recentPicks) {
    const sim = jaccardSimilarity(outfit, prev);
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim > 0.5 ? maxSim : 0;
}

// How many days of recent outfits to check for combination repeats.
export const REPEAT_WINDOW = 7;

// ── Main function ─────────────────────────────────────────────────────────────

export function generateMonthPlan(
  wardrobe: GarmentForScoring[],
  weatherByDate: DayWeather[],
  options: {
    precomputedRanked?: RankedOutfit[];
    maxRankedOutfits?: number;
    // Seed state from previous months so anti-repetition spans month boundaries.
    // lastSeenDay values are negative for items worn before this planning window starts.
    seed?: {
      lastSeenDay: Map<string, number>;
      recentPicks: RankedOutfit[];
    };
  } = {},
): MonthPlan {
  const allOutfits: RankedOutfit[] =
    options.precomputedRanked ??
    generateAndRankAllOutfits(wardrobe, { maxTotal: options.maxRankedOutfits ?? 5000 });

  if (!allOutfits.length || !weatherByDate.length) return { days: [], cycleResets: [] };

  // Group pre-ranked outfits by configName for fast tier-based lookup.
  const outfitsByConfig = new Map<string, RankedOutfit[]>();
  for (const o of allOutfits) {
    const arr = outfitsByConfig.get(o.configName) ?? [];
    arr.push(o);
    outfitsByConfig.set(o.configName, arr);
  }

  // Recency tracker: item id → day index last used (0-based, negative = before this window).
  const lastSeenDay = options.seed?.lastSeenDay
    ? new Map(options.seed.lastSeenDay)
    : new Map<string, number>();

  // Combination-repeat tracker: sliding window of recent outfit picks.
  const recentPicks: RankedOutfit[] = options.seed?.recentPicks
    ? [...options.seed.recentPicks]
    : [];

  // Cycle-reset tracker (separate from novelty; purely for metadata).
  const usedSet      = new Set<string>();
  let   cycleNumber  = 1;
  const cycleResets: string[] = [];
  const days: DayPlan[]       = [];

  for (let dayIdx = 0; dayIdx < weatherByDate.length; dayIdx++) {
    const weather = weatherByDate[dayIdx];
    const viableConfigs = getViableConfigs(weather);
    const viableSet = viableConfigs.length
      ? new Set(viableConfigs)
      : new Set(allOutfits.map((o) => o.configName)); // fallback: extreme weather

    // Collect candidates from ALL weather-viable outfits (already sorted best-first by style).
    // No tier gating — tier is a soft bonus in the score, not a hard gate.
    const candidates: RankedOutfit[] = [];
    for (const o of allOutfits) {
      if (!viableSet.has(o.configName)) continue;
      candidates.push(o);
      if (candidates.length >= MAX_CANDIDATES) break;
    }

    if (!candidates.length) {
      candidates.push(...allOutfits.slice(0, MAX_CANDIDATES));
    }

    // Unified score: 60% style + 5% complexity tier (soft nudge) + 35% novelty.
    // This way a high-scoring Tier-2 outfit beats a low-scoring Tier-4 outfit.
    const maxStyle  = candidates[0]?.score ?? 1;
    const maxTier   = Math.max(...candidates.map((o) => CONFIG_COMPLEXITY[o.configName] ?? 1));
    let bestOutfit  = candidates[0];
    let bestFinal   = -Infinity;

    for (const outfit of candidates) {
      const normalizedStyle = outfit.score / maxStyle;
      const tier            = CONFIG_COMPLEXITY[outfit.configName] ?? 1;
      const normalizedTier  = maxTier > 1 ? (tier - 1) / (maxTier - 1) : 0;
      const novelty         = outfitNovelty(outfit, lastSeenDay, dayIdx);
      // Penalise outfits that repeat the same combination of items seen in the last 7 days.
      // A 0.8 Jaccard similarity (4/5 items shared) subtracts 0.8 × 0.40 = 0.32 from the score.
      const repeatPenalty   = combinationRepeatPenalty(outfit, recentPicks) * 0.40;
      const finalScore      = STYLE_WEIGHT   * normalizedStyle
                            + TIER_WEIGHT    * normalizedTier
                            + NOVELTY_WEIGHT * novelty
                            - repeatPenalty;
      if (finalScore > bestFinal) {
        bestFinal  = finalScore;
        bestOutfit = outfit;
      }
    }

    // Count new-this-cycle items before updating trackers.
    const newItemsCount = bestOutfit.items.filter((i) => !usedSet.has(i.id)).length;

    for (const item of bestOutfit.items) {
      lastSeenDay.set(item.id, dayIdx);
      usedSet.add(item.id);
    }

    // Slide the combination-repeat window forward.
    recentPicks.push(bestOutfit);
    if (recentPicks.length > REPEAT_WINDOW) recentPicks.shift();

    days.push({
      date: weather.date,
      outfit: {
        score:          bestOutfit.score,
        configName:     bestOutfit.configName,
        complexityTier: CONFIG_COMPLEXITY[bestOutfit.configName] ?? 1,
        items: bestOutfit.items.map((i) => ({
          id:            i.id,
          title:         i.title,
          brand:         i.brand ?? null,
          sub_type:      i.sub_type ?? null,
          color_primary: i.color_primary ?? null,
          image:         i.image ?? null,
        })),
      },
      cycleNumber,
      newItemsCount,
    });

    // Cycle reset: every wardrobe item has appeared at least once this cycle.
    if (usedSet.size >= wardrobe.length) {
      usedSet.clear();
      cycleNumber++;
      cycleResets.push(weather.date);
    }
  }

  return { days, cycleResets };
}
