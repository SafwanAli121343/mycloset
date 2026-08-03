#!/usr/bin/env node
// Cross-aesthetic stress test — verifies scoring penalties fire correctly
// for known-bad combinations (flannel+Harrington, polo+track pants)
// and known-valid ones (tee+Harrington).
// Run: npx tsx --env-file=.env.local scripts/test-cross-aesthetic.mts

import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits, type RankedOutfit } from "../lib/wardrobeOutfitGen.js";
import { generateMonthPlan } from "../lib/monthOutfitPlan.js";
import { scoreOutfit } from "../lib/scoring.js";
import type { GarmentForScoring } from "../lib/scoring.js";
import { getSlot } from "../lib/scoring.js";
import type { DayWeather } from "../lib/weatherOutfitFilter.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ProductRow = {
  id: string; brand: string | null; title: string | null; sub_type: string | null;
  color_primary: string | null; color_secondary: string | null; pattern: string | null;
  formality: string | null; material: string | null; aesthetic_tags: string[] | null;
  pros: string[] | null; cons: string[] | null; color_pairings: string[] | null;
  color_clashes: string[] | null; tags: { colors?: string[]; [key: string]: unknown } | null;
  image_url: string | null;
};

function toGarment(row: ProductRow): GarmentForScoring {
  return {
    id: row.id, title: row.title, brand: row.brand, sub_type: row.sub_type,
    material: row.material ?? null, color_primary: row.color_primary,
    color_secondary: row.color_secondary ?? null, pattern: row.pattern ?? null,
    formality: row.formality ?? null, aesthetic_tags: row.aesthetic_tags,
    pros: row.pros ?? null, cons: row.cons ?? null,
    color_pairings: row.color_pairings ?? null, color_clashes: row.color_clashes ?? null,
    tags: row.tags ?? null, image: row.image_url ?? null,
  };
}

async function fetchOne(brand: string, subTypeKeyword: string): Promise<GarmentForScoring | null> {
  const { data } = await sb
    .from("streetwear_products")
    .select("id,brand,title,sub_type,color_primary,color_secondary,pattern,formality,material,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image_url")
    .eq("brand", brand)
    .eq("analyzed", true)
    .ilike("sub_type", `%${subTypeKeyword}%`)
    .not("sub_type", "is", null)
    .limit(3);
  if (!data?.length) {
    console.log(`  ⚠  No result for ${brand} / *${subTypeKeyword}*`);
    return null;
  }
  return toGarment(data[0] as ProductRow);
}

async function fetchAny(brands: string[], subTypeKeyword: string): Promise<GarmentForScoring | null> {
  for (const b of brands) {
    const item = await fetchOne(b, subTypeKeyword);
    if (item) return item;
  }
  return null;
}

function label(item: GarmentForScoring): string {
  const slot = getSlot(item.sub_type) ?? "?";
  return `[${slot.padEnd(6)}] ${(item.brand ?? "?").padEnd(26)} ${(item.sub_type ?? "?").padEnd(28)} ${item.color_primary ?? ""} | tags: ${(item.aesthetic_tags ?? []).join(", ")}`;
}

function scoreLabel(score: number): string {
  if (score >= 75) return "✅ GOOD";
  if (score >= 55) return "⚠️  MID";
  return "❌ LOW";
}

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  CROSS-AESTHETIC STRESS TEST — Verifying Scoring Penalties");
console.log("═══════════════════════════════════════════════════════════════════════\n");

// ── Fetch specific items from DB ───────────────────────────────────────────────

console.log("Fetching items from DB...\n");

const [
  wranglerFlannel,
  prlHarrington,
  stussyTee,
  prlPolo,
  cottonOnTrackPants,
  bapeJeans,
  birkenstockSandal,
  carharttTee,
  carharttHoodie,
  supremeHoodie,
  carharttChore,
  noahCardigan,
  aldTee,
  aldWindbreaker,
  noahPants,
  noahSneakers,
] = await Promise.all([
  fetchAny(["Wrangler"], "flannel"),
  fetchAny(["Polo Ralph Lauren"], "harrington"),
  fetchAny(["Stussy"], "t-shirt"),
  fetchAny(["Polo Ralph Lauren"], "polo"),
  fetchAny(["Cotton On", "Cotton:On"], "track pant"),
  fetchAny(["BAPE", "Stussy", "Palace"], "jeans"),
  fetchAny(["Birkenstock"], "sandal"),
  fetchAny(["Carhartt WIP", "Carhartt"], "t-shirt"),
  fetchAny(["Carhartt WIP"], "hoodie"),
  fetchAny(["Supreme", "Palace", "Stussy"], "hoodie"),
  fetchAny(["Carhartt WIP", "Dickies"], "jacket"),
  fetchAny(["Noah NYC", "Polo Ralph Lauren"], "cardigan"),
  fetchAny(["Aimé Leon Dore", "Noah NYC"], "t-shirt"),
  fetchAny(["Aimé Leon Dore", "Noah NYC"], "windbreaker"),
  fetchAny(["Noah NYC", "Aimé Leon Dore"], "pants"),
  fetchAny(["Noah NYC", "New Balance"], "sneaker"),
]);

// ── Test 1: Direct pair scoring — known-bad combinations ──────────────────────

console.log("─────────────────────────────────────────────────────────────────────");
console.log("  TEST 1: Direct Pair Scoring — KNOWN-BAD Combinations");
console.log("  Expected: these should score LOW due to structural/register penalties");
console.log("─────────────────────────────────────────────────────────────────────\n");

type PairTest = {
  name: string;
  items: (GarmentForScoring | null)[];
  expectedBad: boolean;
  expectation: string;
};

const pairTests: PairTest[] = [
  {
    name: "Wrangler Flannel + PRL Harrington + BAPE jeans + Birkenstock",
    items: [wranglerFlannel, prlHarrington, bapeJeans, birkenstockSandal],
    expectedBad: true,
    expectation: "Structured workwear flannel under prep jacket = directional penalty (×0.60)",
  },
  {
    name: "PRL Polo + Cotton On Track Pants + Birkenstock",
    items: [prlPolo, cottonOnTrackPants, birkenstockSandal],
    expectedBad: true,
    expectation: "Semi-formal top + athletic bottom = register mismatch (×0.75)",
  },
  {
    name: "Stussy Tee + PRL Harrington + BAPE jeans + Birkenstock",
    items: [stussyTee, prlHarrington, bapeJeans, birkenstockSandal],
    expectedBad: false,
    expectation: "Plain tee is neutral — cross-aesthetic contrast is intentional, NO directional penalty",
  },
  {
    name: "PRL Polo + PRL Harrington + BAPE jeans + Birkenstock",
    items: [prlPolo, prlHarrington, bapeJeans, birkenstockSandal],
    expectedBad: false,
    expectation: "Polo + same-brand prep jacket = shared aesthetic DNA, NO directional penalty",
  },
];

for (const test of pairTests) {
  const validItems = test.items.filter((i): i is GarmentForScoring => i !== null);
  if (validItems.length < test.items.length) {
    console.log(`⚠  SKIP "${test.name}" — missing item from DB`);
    continue;
  }
  console.log(`Test: "${test.name}"`);
  for (const item of validItems) console.log(`  ${label(item)}`);
  const score = scoreOutfit(validItems);
  const verdict = score < 60 ? "❌ LOW (penalized)" : score < 75 ? "⚠️  MID" : "✅ GOOD";
  const correct = test.expectedBad ? score < 65 : score >= 65;
  console.log(`  → Score: ${score} ${verdict}  ${correct ? "✔ CORRECT" : "✘ UNEXPECTED"}`);
  console.log(`  Expectation: ${test.expectation}\n`);
}

// ── Test 2: Full wardrobe — Cross-Aesthetic Mixed Wardrobe ─────────────────────

console.log("\n─────────────────────────────────────────────────────────────────────");
console.log("  TEST 2: Full Wardrobe Generation — Cross-Aesthetic Mix");
console.log("  Workwear (Wrangler/Carhartt) + Prep (PRL/Noah) + Streetwear (Stussy)");
console.log("─────────────────────────────────────────────────────────────────────\n");

const crossWardrobe: GarmentForScoring[] = [
  wranglerFlannel, stussyTee, prlPolo, carharttTee,
  carharttHoodie ?? supremeHoodie,
  carharttChore ?? prlHarrington,
  prlHarrington,
  bapeJeans ?? noahPants, cottonOnTrackPants ?? noahPants, noahPants,
  birkenstockSandal ?? noahSneakers,
].filter((i): i is GarmentForScoring => i !== null);

console.log("  Cross-Aesthetic Wardrobe Inventory:");
for (const item of crossWardrobe) console.log(`  ${label(item)}`);

console.log(`\n  Generating outfits from ${crossWardrobe.length} items...`);
const ranked = generateAndRankAllOutfits(crossWardrobe, { maxTotal: 200 });
console.log(`  Generated ${ranked.length} outfits. Score range: ${Math.min(...ranked.map(o=>o.score))}–${Math.max(...ranked.map(o=>o.score))}\n`);

const top10 = ranked.slice(0, 10);
console.log("  TOP 10 OUTFITS:");
for (let i = 0; i < top10.length; i++) {
  const o = top10[i];
  console.log(`  #${i+1}  Score: ${o.score}  Config: "${o.configName}"`);
  for (const item of o.items) {
    const slot = getSlot(item.sub_type) ?? "?";
    console.log(`       [${slot.padEnd(6)}] ${(item.brand ?? "?").padEnd(24)} ${(item.sub_type ?? "?").padEnd(26)} ${item.color_primary ?? ""}`);
  }
}

// ── Test 3: 7-Day calendar with cross-aesthetic wardrobe ─────────────────────

console.log("\n─────────────────────────────────────────────────────────────────────");
console.log("  TEST 3: 7-Day Calendar — Cross-Aesthetic Wardrobe");
console.log("─────────────────────────────────────────────────────────────────────\n");

const WEATHER: DayWeather[] = [
  { date: "2026-07-02", tempF: 70, condition: "clear" },
  { date: "2026-07-03", tempF: 72, condition: "clear" },
  { date: "2026-07-04", tempF: 65, condition: "clear" },
  { date: "2026-07-05", tempF: 62, condition: "cloudy" },
  { date: "2026-07-06", tempF: 58, condition: "cloudy" },
  { date: "2026-07-07", tempF: 74, condition: "clear" },
  { date: "2026-07-08", tempF: 68, condition: "clear" },
];

if (crossWardrobe.length >= 3) {
  const plan = generateMonthPlan(crossWardrobe, WEATHER);
  for (const day of plan.days) {
    console.log(`  ${day.date}  Score: ${day.outfit.score}  Config: "${day.outfit.configName}"`);
    for (const item of day.outfit.items) {
      const slot = getSlot(item.sub_type ?? null) ?? "?";
      console.log(`    [${slot.padEnd(6)}] ${(item.brand ?? "?").padEnd(24)} ${(item.sub_type ?? "?").padEnd(24)} ${item.color_primary ?? ""}`);
    }
    console.log();
  }
}

// ── Test 4: Gorpcore wardrobe ─────────────────────────────────────────────────

console.log("\n─────────────────────────────────────────────────────────────────────");
console.log("  TEST 4: Gorpcore Wardrobe (Arc'teryx + Salomon + Patagonia)");
console.log("─────────────────────────────────────────────────────────────────────\n");

const [
  arcteryx_jacket, salomon_sneaker, patagonia_fleece, northface_puffer,
  gorpcore_tee, gorpcore_pants, gorpcore_shorts,
] = await Promise.all([
  fetchAny(["Arc'teryx", "Arcteryx"], "jacket"),
  fetchAny(["Salomon"], "sneaker"),
  fetchAny(["Patagonia"], "fleece"),
  fetchAny(["The North Face"], "hoodie"),
  fetchAny(["Patagonia", "The North Face", "Arc'teryx"], "t-shirt"),
  fetchAny(["Carhartt WIP", "Patagonia"], "pants"),
  fetchAny(["Patagonia", "The North Face"], "shorts"),
]);

const gorpWardrobe: GarmentForScoring[] = [
  gorpcore_tee, patagonia_fleece, arcteryx_jacket,
  northface_puffer ?? patagonia_fleece,
  gorpcore_pants, gorpcore_shorts,
  salomon_sneaker,
].filter((i): i is GarmentForScoring => i !== null);

console.log("  Gorpcore Wardrobe Inventory:");
for (const item of gorpWardrobe) console.log(`  ${label(item)}`);

const gorpRanked = generateAndRankAllOutfits(gorpWardrobe, { maxTotal: 100 });
console.log(`\n  Generated ${gorpRanked.length} outfits. Score range: ${gorpRanked.length ? Math.min(...gorpRanked.map(o=>o.score)) : 0}–${gorpRanked.length ? Math.max(...gorpRanked.map(o=>o.score)) : 0}\n`);

const gorpTop5 = gorpRanked.slice(0, 5);
console.log("  TOP 5 GORPCORE OUTFITS:");
for (let i = 0; i < gorpTop5.length; i++) {
  const o = gorpTop5[i];
  console.log(`  #${i+1}  Score: ${o.score}  Config: "${o.configName}"`);
  for (const item of o.items) {
    const slot = getSlot(item.sub_type) ?? "?";
    console.log(`       [${slot.padEnd(6)}] ${(item.brand ?? "?").padEnd(24)} ${(item.sub_type ?? "?").padEnd(24)} ${item.color_primary ?? ""}`);
  }
}

console.log("\n✅  Cross-aesthetic stress test complete.\n");
