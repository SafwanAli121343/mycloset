#!/usr/bin/env node
// Synthetic wardrobe validation — tests the outfit generation algorithm against
// wardrobes built from the 321k streetwear_products DB.
// Run: npx tsx --env-file=.env.local scripts/test-synthetic-wardrobes.mts

import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits, type RankedOutfit } from "../lib/wardrobeOutfitGen.js";
import { generateMonthPlan } from "../lib/monthOutfitPlan.js";
import type { GarmentForScoring } from "../lib/scoring.js";
import { getSlot } from "../lib/scoring.js";
import type { DayWeather } from "../lib/weatherOutfitFilter.js";

// ── Supabase ──────────────────────────────────────────────────────────────────

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── DB row shape ───────────────────────────────────────────────────────────────

type ProductRow = {
  id: string;
  brand: string | null;
  title: string | null;
  sub_type: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  pattern: string | null;
  formality: string | null;
  material: string | null;
  aesthetic_tags: string[] | null;
  pros: string[] | null;
  cons: string[] | null;
  color_pairings: string[] | null;
  color_clashes: string[] | null;
  tags: { colors?: string[]; [key: string]: unknown } | null;
  image_url: string | null;
};

function toGarment(row: ProductRow): GarmentForScoring {
  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    sub_type: row.sub_type,
    material: row.material ?? null,
    color_primary: row.color_primary,
    color_secondary: row.color_secondary ?? null,
    pattern: row.pattern ?? null,
    formality: row.formality ?? null,
    aesthetic_tags: row.aesthetic_tags,
    pros: row.pros ?? null,
    cons: row.cons ?? null,
    color_pairings: row.color_pairings ?? null,
    color_clashes: row.color_clashes ?? null,
    tags: row.tags ?? null,
    image: row.image_url ?? null,
  };
}

// ── Slot keyword lists for DB queries ──────────────────────────────────────────

// Each entry is a pattern for Supabase .or() with ilike
const SLOT_PATTERNS: Record<string, string[]> = {
  foot: [
    "sneaker", "sneakers", "Sneakers", "boot", "Boot", "loafer", "Loafer",
    "slide", "Slide", "sandal", "shoe", "Shoe", "slipper",
  ],
  outer: [
    "jacket", "windbreaker", "parka", "anorak", "peacoat", "blazer",
    "trench", "chore coat", "overshirt", "shacket", "harrington",
    "workwear jacket", "coach jacket",
  ],
  mid: [
    "hoodie", "sweatshirt", "sweater", "cardigan", "pullover", "crewneck",
    "fleece", "turtleneck", "quarter zip", "half zip", "knit",
  ],
  base: [
    "t-shirt", "shirt", "polo", "henley", "tank", "blouse",
    "long sleeve", "jersey", "Graphic Tee", "graphic tee",
  ],
  bottom: [
    "jeans", "pants", "trouser", "chino", "shorts", "jogger",
    "sweatpants", "cargo pants", "track pants", "skirt",
  ],
};

// Build Supabase OR filter string for a slot
function slotFilter(slot: string): string {
  return SLOT_PATTERNS[slot]
    .map(k => `sub_type.ilike.%${k}%`)
    .join(",");
}

// Local slot classification (matches scoring.ts getSlot fallback logic)
function classifySlot(subType: string | null): string | null {
  if (!subType) return null;
  const l = subType.toLowerCase();
  if (l.includes("sneaker") || l.includes("boot") || l.includes("loafer") ||
      l.includes("slide") || l.includes("sandal") || l.includes("shoe") ||
      l.includes("slipper") || l.includes("mule") || l.includes("moccasin")) return "foot";
  if (l.includes("jacket") || l.includes("windbreaker") || l.includes("parka") ||
      l.includes("anorak") || l.includes("peacoat") || l.includes("blazer") ||
      l.includes("trench") || l.includes("overshirt") || l.includes("shacket")) return "outer";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("sweater") ||
      l.includes("cardigan") || l.includes("pullover") || l.includes("crewneck") ||
      l.includes("fleece") || l.includes("turtleneck") || l.includes("quarter zip") ||
      l.includes("half zip") || l.includes("knit")) return "mid";
  if (l.includes("t-shirt") || l.includes("polo") || l.includes("henley") ||
      l.includes("tank") || l.includes("blouse") || l.includes("long sleeve") ||
      l.includes("jersey") || l.includes("tee") || (l.includes("shirt") && !l.includes("sweatshirt"))) return "base";
  if (l.includes("jean") || l.includes("pant") || l.includes("trouser") ||
      l.includes("chino") || l.includes("short") || l.includes("jogger") ||
      l.includes("skirt")) return "bottom";
  // Fall through to scoring.ts
  return getSlot(subType);
}

// ── Fetch items for a single slot from a list of brands ───────────────────────

async function fetchSlotItems(
  brands: string[],
  slot: string,
  limit: number,
): Promise<GarmentForScoring[]> {
  const filter = slotFilter(slot);
  const { data, error } = await sb
    .from("streetwear_products")
    .select(
      "id, brand, title, sub_type, color_primary, color_secondary, pattern, " +
      "formality, material, aesthetic_tags, pros, cons, color_pairings, " +
      "color_clashes, tags, image_url",
    )
    .in("brand", brands)
    .eq("analyzed", true)
    .not("sub_type", "is", null)
    .or(filter)
    .limit(limit);

  if (error) {
    console.error(`  DB error fetching ${slot}:`, error.message);
    return [];
  }

  return (data ?? [])
    .filter(row => {
      const s = classifySlot(row.sub_type);
      return s === slot;
    })
    .map(row => toGarment(row as ProductRow));
}

// ── Pick N items with sub_type variety ───────────────────────────────────────

function pickVaried(items: GarmentForScoring[], n: number): GarmentForScoring[] {
  const picked: GarmentForScoring[] = [];
  const seenSubTypes = new Set<string>();
  const seenIds = new Set<string>();

  // First pass: unique sub_types
  for (const item of items) {
    if (picked.length >= n) break;
    const st = (item.sub_type ?? "").toLowerCase();
    if (!seenIds.has(item.id) && !seenSubTypes.has(st)) {
      picked.push(item);
      seenIds.add(item.id);
      seenSubTypes.add(st);
    }
  }
  // Second pass: fill remaining
  for (const item of items) {
    if (picked.length >= n) break;
    if (!seenIds.has(item.id)) {
      picked.push(item);
      seenIds.add(item.id);
    }
  }
  return picked;
}

// ── Wardrobe builder ───────────────────────────────────────────────────────────

type WardrobeSpec = {
  name: string;
  brands: string[];
  footwearBrands?: string[];  // override footwear source if primary brands lack shoes
};

const SLOT_TARGETS = { base: 4, mid: 2, outer: 2, bottom: 3, foot: 1 };

async function buildWardrobe(spec: WardrobeSpec): Promise<GarmentForScoring[]> {
  const wardrobe: GarmentForScoring[] = [];

  for (const slot of Object.keys(SLOT_TARGETS) as Array<keyof typeof SLOT_TARGETS>) {
    const brands = (slot === "foot" && spec.footwearBrands)
      ? spec.footwearBrands
      : spec.brands;
    const target = SLOT_TARGETS[slot];

    const items = await fetchSlotItems(brands, slot, 200);
    if (!items.length && slot === "foot") {
      console.warn(`  ⚠  No footwear found for ${spec.name} primary brands; trying broader search`);
      // Expand to any brand with matching aesthetic tags
      const { data: fallback } = await sb
        .from("streetwear_products")
        .select(
          "id, brand, title, sub_type, color_primary, color_secondary, pattern, " +
          "formality, material, aesthetic_tags, pros, cons, color_pairings, " +
          "color_clashes, tags, image_url",
        )
        .eq("analyzed", true)
        .or(slotFilter("foot"))
        .not("sub_type", "is", null)
        .limit(50);
      const broad = (fallback ?? [])
        .filter(r => classifySlot(r.sub_type) === "foot")
        .map(r => toGarment(r as ProductRow));
      wardrobe.push(...pickVaried(broad, 1));
      continue;
    }

    wardrobe.push(...pickVaried(items, target));
  }

  return wardrobe;
}

// ── Print outfit helper ────────────────────────────────────────────────────────

function printOutfit(rank: number, outfit: RankedOutfit) {
  console.log(`  #${rank}  Score: ${outfit.score}  Config: "${outfit.configName}"`);
  for (const item of outfit.items) {
    const slot = classifySlot(item.sub_type) ?? "?";
    console.log(
      `       [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(22)}  ${(item.sub_type ?? "?").padEnd(26)}  ${item.color_primary ?? ""}`
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

const WARDROBE_SPECS: WardrobeSpec[] = [
  {
    name: "A — Pure Streetwear (Stussy / Palace / BAPE / Kith)",
    brands: ["Stussy", "Palace", "BAPE", "Kith", "Ripndip"],
  },
  {
    name: "B — Prep / Ivy / ALD (ALD / Noah NYC / Polo Ralph Lauren)",
    brands: ["Aimé Leon Dore", "Noah NYC", "Polo Ralph Lauren"],
  },
  {
    name: "C — Workwear / Heritage (Carhartt WIP / Dickies / Wrangler)",
    brands: ["Carhartt WIP", "Dickies", "Wrangler"],
    footwearBrands: ["Carhartt WIP", "Dickies", "Timberland", "Clarks"],
  },
  {
    name: "D — Luxury / Designer (Rick Owens / Fear of God / Rhude / Gallery Dept.)",
    brands: ["Rick Owens", "Fear of God", "Rhude", "Gallery Dept.", "A-COLD-WALL*"],
  },
];

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  SYNTHETIC WARDROBE VALIDATION — Outfit Generation Algorithm");
console.log("═══════════════════════════════════════════════════════════════════\n");

const allWardrobes: { spec: WardrobeSpec; wardrobe: GarmentForScoring[]; top5: RankedOutfit[] }[] = [];

for (const spec of WARDROBE_SPECS) {
  console.log(`\n${"─".repeat(67)}`);
  console.log(`  WARDROBE ${spec.name}`);
  console.log(`${"─".repeat(67)}`);

  const wardrobe = await buildWardrobe(spec);

  // Print wardrobe inventory
  console.log(`\n  Wardrobe: ${wardrobe.length} items`);
  console.log("  Inventory:");
  for (const item of wardrobe) {
    const slot = classifySlot(item.sub_type) ?? "?";
    console.log(
      `    [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(22)}  ${(item.sub_type ?? "?").padEnd(30)}  ${item.color_primary ?? ""}`
    );
  }

  // Generate outfits
  console.log("\n  Generating outfits...");
  const t0 = Date.now();
  const ranked = generateAndRankAllOutfits(wardrobe, { maxTotal: 200 });
  const elapsed = Date.now() - t0;
  console.log(`  Generated ${ranked.length} outfits in ${elapsed}ms`);

  if (!ranked.length) {
    console.log("  ⚠  No outfits generated — check footwear/bottom coverage");
    allWardrobes.push({ spec, wardrobe, top5: [] });
    continue;
  }

  // Score distribution
  const scores = ranked.map(o => o.score);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const avgS = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  Score range: ${minS}–${maxS}  avg ${avgS.toFixed(1)}`);

  const top5 = ranked.slice(0, 5);
  console.log("\n  ── TOP 5 OUTFITS ──────────────────────────────────────────────");
  top5.forEach((outfit, i) => printOutfit(i + 1, outfit));
  allWardrobes.push({ spec, wardrobe, top5 });
}

// ── Step 3: Calendar test with Wardrobe A ─────────────────────────────────────

console.log("\n\n═══════════════════════════════════════════════════════════════════");
console.log("  STEP 3 — Calendar Test: 7-Day Plan (Wardrobe A, 72°F clear)");
console.log("═══════════════════════════════════════════════════════════════════");

const wardrobeA = allWardrobes.find(w => w.spec.name.startsWith("A"))!;

const WEATHER_7DAY: DayWeather[] = [
  { date: "2026-07-02", tempF: 72, condition: "clear" },
  { date: "2026-07-03", tempF: 72, condition: "clear" },
  { date: "2026-07-04", tempF: 72, condition: "clear" },
  { date: "2026-07-05", tempF: 72, condition: "clear" },
  { date: "2026-07-06", tempF: 72, condition: "clear" },
  { date: "2026-07-07", tempF: 72, condition: "clear" },
  { date: "2026-07-08", tempF: 72, condition: "clear" },
];

if (wardrobeA?.wardrobe.length) {
  const plan = generateMonthPlan(wardrobeA.wardrobe, WEATHER_7DAY);

  if (!plan.days.length) {
    console.log("  ⚠  No days planned — wardrobe lacks required slots (footwear or bottoms)");
    // Debug: show what slots we have
    const slots = wardrobeA.wardrobe.map(i => classifySlot(i.sub_type) ?? "?");
    const slotCount: Record<string, number> = {};
    for (const s of slots) slotCount[s] = (slotCount[s] ?? 0) + 1;
    console.log("  Slot inventory:", JSON.stringify(slotCount));
  } else {
    for (const day of plan.days) {
      console.log(`\n  ${day.date}  Score: ${day.outfit.score}  Config: "${day.outfit.configName}"`);
      for (const item of day.outfit.items) {
        const slot = classifySlot(item.sub_type) ?? "?";
        console.log(
          `    [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(22)}  ${(item.sub_type ?? "?").padEnd(22)}  ${item.color_primary ?? ""}`
        );
      }
    }
    if (plan.cycleResets.length) {
      console.log(`\n  Cycle resets: ${plan.cycleResets.join(", ")}`);
    }
  }
} else {
  console.log("  Skipping calendar test — Wardrobe A has no items");
}

// ── Summary table ─────────────────────────────────────────────────────────────

console.log("\n\n═══════════════════════════════════════════════════════════════════");
console.log("  SUMMARY — All Top Outfits (for internet validation in Step 2)");
console.log("═══════════════════════════════════════════════════════════════════\n");

let outfitIndex = 1;
for (const { spec, top5 } of allWardrobes) {
  console.log(`\n  Wardrobe ${spec.name}`);
  if (!top5.length) {
    console.log("    (no outfits generated)");
    continue;
  }
  for (const outfit of top5) {
    const itemSummary = outfit.items
      .map(i => `${i.brand} ${i.sub_type ?? "?"}`)
      .join(" | ");
    console.log(`    ${outfitIndex}. [Score ${outfit.score}] ${itemSummary}`);
    outfitIndex++;
  }
}

console.log("\n\n✅  Script complete.\n");
