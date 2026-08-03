#!/usr/bin/env node
// Extended wardrobe validation — 3 new aesthetic profiles + cross-aesthetic stress test.
// Shows top 20 per wardrobe (not just top 5) to surface iffy low-mid combos.
// Run: npx tsx --env-file=.env.local scripts/test-wardrobes-v2.mts

import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits, type RankedOutfit } from "../lib/wardrobeOutfitGen.js";
import { generateMonthPlan } from "../lib/monthOutfitPlan.js";
import type { GarmentForScoring } from "../lib/scoring.js";
import { getSlot } from "../lib/scoring.js";
import type { DayWeather } from "../lib/weatherOutfitFilter.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ProductRow = {
  id: string; brand: string | null; title: string | null;
  sub_type: string | null; color_primary: string | null;
  color_secondary: string | null; pattern: string | null;
  formality: string | null; material: string | null;
  aesthetic_tags: string[] | null; pros: string[] | null;
  cons: string[] | null; color_pairings: string[] | null;
  color_clashes: string[] | null;
  tags: { colors?: string[]; [key: string]: unknown } | null;
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

const SLOT_PATTERNS: Record<string, string[]> = {
  foot:   ["sneaker", "sneakers", "boot", "loafer", "slide", "sandal", "shoe", "slipper"],
  outer:  ["jacket", "windbreaker", "parka", "anorak", "peacoat", "blazer", "trench", "chore coat", "overshirt", "shacket", "harrington", "coach jacket"],
  mid:    ["hoodie", "sweatshirt", "sweater", "cardigan", "pullover", "crewneck", "fleece", "turtleneck", "quarter zip", "half zip", "knit"],
  base:   ["t-shirt", "shirt", "polo", "henley", "tank", "blouse", "long sleeve", "jersey", "graphic tee"],
  bottom: ["jeans", "pants", "trouser", "chino", "shorts", "jogger", "sweatpants", "cargo pants", "track pants", "skirt"],
};

function slotFilter(slot: string): string {
  return SLOT_PATTERNS[slot].map(k => `sub_type.ilike.%${k}%`).join(",");
}

function classifySlot(subType: string | null): string | null {
  if (!subType) return null;
  const l = subType.toLowerCase();
  if (l.includes("sneaker") || l.includes("boot") || l.includes("loafer") || l.includes("slide") || l.includes("sandal") || l.includes("shoe") || l.includes("slipper") || l.includes("mule")) return "foot";
  if (l.includes("jacket") || l.includes("windbreaker") || l.includes("parka") || l.includes("anorak") || l.includes("peacoat") || l.includes("blazer") || l.includes("trench") || l.includes("overshirt") || l.includes("shacket")) return "outer";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("sweater") || l.includes("cardigan") || l.includes("pullover") || l.includes("crewneck") || l.includes("fleece") || l.includes("turtleneck") || l.includes("quarter zip") || l.includes("half zip") || l.includes("knit")) return "mid";
  if (l.includes("t-shirt") || l.includes("polo") || l.includes("henley") || l.includes("tank") || l.includes("blouse") || l.includes("long sleeve") || l.includes("jersey") || l.includes("tee") || (l.includes("shirt") && !l.includes("sweatshirt"))) return "base";
  if (l.includes("jean") || l.includes("pant") || l.includes("trouser") || l.includes("chino") || l.includes("short") || l.includes("jogger") || l.includes("skirt")) return "bottom";
  return getSlot(subType);
}

async function fetchSlotItems(brands: string[], slot: string, limit: number): Promise<GarmentForScoring[]> {
  const filter = slotFilter(slot);
  const { data, error } = await sb
    .from("streetwear_products")
    .select("id, brand, title, sub_type, color_primary, color_secondary, pattern, formality, material, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image_url")
    .in("brand", brands)
    .eq("analyzed", true)
    .not("sub_type", "is", null)
    .or(filter)
    .limit(limit);
  if (error) { console.error(`  DB error fetching ${slot}:`, error.message); return []; }
  return (data ?? []).filter(row => classifySlot(row.sub_type) === slot).map(row => toGarment(row as ProductRow));
}

function pickVaried(items: GarmentForScoring[], n: number): GarmentForScoring[] {
  const picked: GarmentForScoring[] = [];
  const seenSubTypes = new Set<string>();
  const seenIds = new Set<string>();
  for (const item of items) {
    if (picked.length >= n) break;
    const st = (item.sub_type ?? "").toLowerCase();
    if (!seenIds.has(item.id) && !seenSubTypes.has(st)) { picked.push(item); seenIds.add(item.id); seenSubTypes.add(st); }
  }
  for (const item of items) {
    if (picked.length >= n) break;
    if (!seenIds.has(item.id)) { picked.push(item); seenIds.add(item.id); }
  }
  return picked;
}

type WardrobeSpec = {
  name: string; brands: string[]; footwearBrands?: string[];
};

const SLOT_TARGETS = { base: 4, mid: 2, outer: 2, bottom: 3, foot: 1 };

async function buildWardrobe(spec: WardrobeSpec): Promise<GarmentForScoring[]> {
  const wardrobe: GarmentForScoring[] = [];
  for (const slot of Object.keys(SLOT_TARGETS) as Array<keyof typeof SLOT_TARGETS>) {
    const brands = (slot === "foot" && spec.footwearBrands) ? spec.footwearBrands : spec.brands;
    const target = SLOT_TARGETS[slot];
    const items = await fetchSlotItems(brands, slot, 200);
    if (!items.length && slot === "foot") {
      console.warn(`  ⚠  No footwear found for ${spec.name} — trying broad fallback`);
      const { data: fallback } = await sb.from("streetwear_products").select("id, brand, title, sub_type, color_primary, color_secondary, pattern, formality, material, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image_url").eq("analyzed", true).or(slotFilter("foot")).not("sub_type", "is", null).limit(50);
      const broad = (fallback ?? []).filter(r => classifySlot(r.sub_type) === "foot").map(r => toGarment(r as ProductRow));
      wardrobe.push(...pickVaried(broad, 1));
      continue;
    }
    wardrobe.push(...pickVaried(items, target));
  }
  return wardrobe;
}

function label(score: number): string {
  if (score >= 80) return "✅ GREAT";
  if (score >= 65) return "⚠️  OK";
  if (score >= 50) return "⚠️  MID";
  return "❌ LOW";
}

function printOutfit(rank: number, outfit: RankedOutfit, maxRank: number) {
  const padded = String(rank).padStart(String(maxRank).length, " ");
  console.log(`  #${padded}  Score: ${outfit.score}  ${label(outfit.score)}  Config: "${outfit.configName}"`);
  for (const item of outfit.items) {
    const slot = classifySlot(item.sub_type) ?? "?";
    console.log(`        [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(24)}  ${(item.sub_type ?? "?").padEnd(28)}  ${item.color_primary ?? ""}`);
  }
}

// ── Wardrobes ─────────────────────────────────────────────────────────────────

const WARDROBE_SPECS: WardrobeSpec[] = [
  {
    name: "E — Gorpcore (Arc'teryx / Salomon / Patagonia / Norrona)",
    brands: ["Arc'teryx", "Salomon", "Patagonia", "Norrona", "The North Face"],
    footwearBrands: ["Salomon", "Arc'teryx", "Hoka", "Merrell", "Danner"],
  },
  {
    name: "F — Luxury Prep (Polo Ralph Lauren / Barbour / Drake's / Sid Mashburn)",
    brands: ["Polo Ralph Lauren", "Barbour", "Drake's", "Sid Mashburn", "Pendleton"],
    footwearBrands: ["Polo Ralph Lauren", "Allen Edmonds", "Alden", "Quoddy", "Barbour", "Common Projects"],
  },
  {
    name: "G — Cross-Aesthetic Stress Test (Supreme + Thom Browne + Carhartt WIP + Fear of God)",
    brands: ["Supreme", "Thom Browne", "Carhartt WIP", "Fear of God", "Stussy"],
    footwearBrands: ["Nike", "New Balance", "Common Projects", "Fear of God"],
  },
];

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  WARDROBE VALIDATION v2 — 3 New Aesthetic Profiles");
console.log("  Shows top 20 outfits per wardrobe to surface mid/low combos");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const allWardrobes: { spec: WardrobeSpec; wardrobe: GarmentForScoring[]; ranked: RankedOutfit[] }[] = [];

for (const spec of WARDROBE_SPECS) {
  console.log(`\n${"─".repeat(71)}`);
  console.log(`  WARDROBE ${spec.name}`);
  console.log(`${"─".repeat(71)}`);

  const wardrobe = await buildWardrobe(spec);
  console.log(`\n  Wardrobe: ${wardrobe.length} items`);
  console.log("  Inventory:");
  for (const item of wardrobe) {
    const slot = classifySlot(item.sub_type) ?? "?";
    const tags = (item.aesthetic_tags ?? []).slice(0, 3).join(", ");
    console.log(`    [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(24)}  ${(item.sub_type ?? "?").padEnd(30)}  ${item.color_primary ?? ""}  [${tags}]`);
  }

  console.log("\n  Generating outfits...");
  const t0 = Date.now();
  const ranked = generateAndRankAllOutfits(wardrobe, { maxTotal: 200 });
  console.log(`  Generated ${ranked.length} outfits in ${Date.now() - t0}ms`);

  if (!ranked.length) {
    console.log("  ⚠  No outfits — check footwear/bottom coverage");
    allWardrobes.push({ spec, wardrobe, ranked: [] });
    continue;
  }

  const scores = ranked.map(o => o.score);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const avgS = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  Score range: ${minS}–${maxS}  avg ${avgS.toFixed(1)}`);

  // Score buckets
  const great = scores.filter(s => s >= 80).length;
  const ok    = scores.filter(s => s >= 65 && s < 80).length;
  const mid   = scores.filter(s => s >= 50 && s < 65).length;
  const low   = scores.filter(s => s < 50).length;
  console.log(`  Buckets: ✅ GREAT(≥80): ${great}  ⚠️ OK(65-79): ${ok}  ⚠️ MID(50-64): ${mid}  ❌ LOW(<50): ${low}`);

  const TOP_N = 20;
  console.log(`\n  ── TOP ${TOP_N} OUTFITS ─────────────────────────────────────────────────`);
  ranked.slice(0, TOP_N).forEach((outfit, i) => printOutfit(i + 1, outfit, TOP_N));

  // Show bottom 5 (worst combos — useful to verify they're correctly penalized)
  console.log(`\n  ── BOTTOM 5 OUTFITS (verify correct penalization) ──────────────────`);
  const bottom5 = ranked.slice(-5);
  bottom5.forEach((outfit, i) => printOutfit(ranked.length - 4 + i, outfit, ranked.length));

  allWardrobes.push({ spec, wardrobe, ranked });
}

// ── Calendar test: Wardrobe E (Gorpcore) at 52°F rainy — tests outer/mid gating ──
console.log("\n\n═══════════════════════════════════════════════════════════════════════");
console.log("  CALENDAR TEST — Wardrobe E (Gorpcore) at 52°F light rain");
console.log("  (validates outer/mid required gating, cold-weather config selection)");
console.log("═══════════════════════════════════════════════════════════════════════");

const wardrobeE = allWardrobes.find(w => w.spec.name.startsWith("E"));

const WEATHER_7DAY: DayWeather[] = [
  { date: "2026-10-01", tempF: 52, condition: "light_rain" },
  { date: "2026-10-02", tempF: 48, condition: "cloudy" },
  { date: "2026-10-03", tempF: 55, condition: "clear" },
  { date: "2026-10-04", tempF: 44, condition: "cloudy" },
  { date: "2026-10-05", tempF: 50, condition: "light_rain" },
  { date: "2026-10-06", tempF: 58, condition: "clear" },
  { date: "2026-10-07", tempF: 46, condition: "windy" },
];

if (wardrobeE?.wardrobe.length) {
  const plan = generateMonthPlan(wardrobeE.wardrobe, WEATHER_7DAY);
  if (!plan.days.length) {
    console.log("  ⚠  No days planned");
    const slots = wardrobeE.wardrobe.map(i => classifySlot(i.sub_type) ?? "?");
    const slotCount: Record<string, number> = {};
    for (const s of slots) slotCount[s] = (slotCount[s] ?? 0) + 1;
    console.log("  Slot inventory:", JSON.stringify(slotCount));
  } else {
    for (const day of plan.days) {
      console.log(`\n  ${day.date}  Score: ${day.outfit.score}  Config: "${day.outfit.configName}"`);
      for (const item of day.outfit.items) {
        const slot = classifySlot(item.sub_type) ?? "?";
        console.log(`    [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(24)}  ${(item.sub_type ?? "?").padEnd(24)}  ${item.color_primary ?? ""}`);
      }
    }
  }
}

// ── Summary for intuition/internet review ─────────────────────────────────────
console.log("\n\n═══════════════════════════════════════════════════════════════════════");
console.log("  SUMMARY — Iffy combos from each wardrobe (score < 70)");
console.log("═══════════════════════════════════════════════════════════════════════\n");

for (const { spec, ranked } of allWardrobes) {
  const iffy = ranked.filter(o => o.score < 70).slice(0, 5);
  console.log(`\n  Wardrobe ${spec.name.split(" — ")[0]}:`);
  if (!iffy.length) { console.log("    No combos below 70 in top 200."); continue; }
  for (const outfit of iffy) {
    const summary = outfit.items.map(i => `${i.brand} ${i.sub_type ?? "?"}`).join(" + ");
    console.log(`    [${outfit.score}] ${summary}`);
  }
}

console.log("\n\n✅  Script complete.\n");
