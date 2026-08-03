#!/usr/bin/env node
// Rigorous calendar generation test against the real wardrobe database.
// Run: npx tsx --env-file=.env.local scripts/test-calendar.mts
//
// What to look for:
//   - Complexity tiers match the weather (cold days → tier 4-5, hot days → tier 1-2)
//   - Scores are reasonable (not all 0, not all identical)
//   - Items rotate across days — cycleResets show the wardrobe getting fully used
//   - Outfit configs make stylistic sense (printed at bottom for manual review)

import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits } from "../lib/wardrobeOutfitGen.js";
import { generateMonthPlan } from "../lib/monthOutfitPlan.js";
import { getViableConfigs, CONFIG_COMPLEXITY, type DayWeather } from "../lib/weatherOutfitFilter.js";
import type { GarmentForScoring } from "../lib/scoring.js";

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Fetch wardrobe ─────────────────────────────────────────────────────────────

const { data: garments, error } = await supabase
  .from("garments")
  .select(
    "id, title, brand, sub_type, material, color_primary, color_secondary, " +
    "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image",
  )
  .order("created_at");   // stable order for reproducible test runs

if (error || !garments?.length) {
  console.error("Failed to fetch wardrobe:", error?.message ?? "empty");
  process.exit(1);
}

const wardrobe = garments as unknown as GarmentForScoring[];
console.log(`\n▶  Wardrobe: ${wardrobe.length} garments\n`);

// ── Build test weather: July 2026, varied conditions ─────────────────────────
// Covers all major code paths: hot sunny, hot rainy, mild, cool, cold

const TEST_WEATHER: DayWeather[] = [
  // Hot sunny week
  { date: "2026-07-01", tempF: 88, condition: "clear"      },
  { date: "2026-07-02", tempF: 91, condition: "clear"      },
  { date: "2026-07-03", tempF: 85, condition: "cloudy"     },
  { date: "2026-07-04", tempF: 83, condition: "clear"      },
  { date: "2026-07-05", tempF: 79, condition: "windy"      },
  { date: "2026-07-06", tempF: 76, condition: "light_rain" },
  { date: "2026-07-07", tempF: 74, condition: "heavy_rain" },
  // Mild transitional week
  { date: "2026-07-08", tempF: 72, condition: "clear"      },
  { date: "2026-07-09", tempF: 68, condition: "cloudy"     },
  { date: "2026-07-10", tempF: 66, condition: "clear"      },
  { date: "2026-07-11", tempF: 64, condition: "windy"      },
  { date: "2026-07-12", tempF: 62, condition: "light_rain" },
  { date: "2026-07-13", tempF: 60, condition: "cloudy"     },
  { date: "2026-07-14", tempF: 58, condition: "clear"      },
  // Cool week
  { date: "2026-07-15", tempF: 55, condition: "clear"      },
  { date: "2026-07-16", tempF: 52, condition: "cloudy"     },
  { date: "2026-07-17", tempF: 50, condition: "light_rain" },
  { date: "2026-07-18", tempF: 48, condition: "clear"      },
  { date: "2026-07-19", tempF: 46, condition: "windy"      },
  { date: "2026-07-20", tempF: 44, condition: "light_rain" },
  { date: "2026-07-21", tempF: 42, condition: "clear"      },
  // Cold stretch
  { date: "2026-07-22", tempF: 40, condition: "cloudy"     },
  { date: "2026-07-23", tempF: 38, condition: "snow"       },
  { date: "2026-07-24", tempF: 35, condition: "clear"      },
  { date: "2026-07-25", tempF: 32, condition: "snow"       },
  { date: "2026-07-26", tempF: 28, condition: "clear"      },
  { date: "2026-07-27", tempF: 25, condition: "heavy_rain" },
  { date: "2026-07-28", tempF: 22, condition: "snow"       },
  // Very cold
  { date: "2026-07-29", tempF: 18, condition: "clear"      },
  { date: "2026-07-30", tempF: 15, condition: "snow"       },
  { date: "2026-07-31", tempF: 14, condition: "clear"      },
];

// ── Phase 1: viable config check ──────────────────────────────────────────────

console.log("─── Phase 1: viable configs per weather ─────────────────────────────────────");
console.log(
  "Date".padEnd(12) +
  "Temp".padEnd(7) +
  "Cond".padEnd(14) +
  "MaxTier".padEnd(9) +
  "Best config",
);

for (const w of TEST_WEATHER) {
  const viable = getViableConfigs(w);
  const maxTier = viable.length ? CONFIG_COMPLEXITY[viable[0]] ?? "—" : "—";
  const best    = viable[0] ?? "(none)";
  const flag    = viable.length === 0 ? " ⚠ NO VIABLE CONFIG" : "";
  console.log(
    w.date.padEnd(12) +
    `${w.tempF}°F`.padEnd(7) +
    w.condition.padEnd(14) +
    String(maxTier).padEnd(9) +
    best + flag,
  );
}

// ── Phase 2: generate all ranked outfits ─────────────────────────────────────

console.log("\n─── Phase 2: generating all ranked outfits ──────────────────────────────────");
const t0 = Date.now();
const allRanked = generateAndRankAllOutfits(wardrobe, { maxTotal: 5000 });
const elapsed   = Date.now() - t0;
console.log(`Generated ${allRanked.length} outfits in ${elapsed}ms`);

if (!allRanked.length) {
  console.error("⚠  No outfits generated — wardrobe may be missing footwear or bottoms.");
  process.exit(1);
}

// Config distribution
const configCounts: Record<string, number> = {};
for (const o of allRanked) configCounts[o.configName] = (configCounts[o.configName] ?? 0) + 1;
console.log("\nOutfits per config (top 10):");
Object.entries(configCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([name, count]) => console.log(`  ${count.toString().padStart(4)} × ${name}`));

// Score distribution
const scores = allRanked.map((o) => o.score);
const minScore = Math.min(...scores);
const maxScore = Math.max(...scores);
const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
console.log(`\nScore range: ${minScore.toFixed(1)} – ${maxScore.toFixed(1)}  avg ${avgScore.toFixed(1)}`);

// ── Phase 3: run the monthly planner ─────────────────────────────────────────

console.log("\n─── Phase 3: monthly plan ────────────────────────────────────────────────────");
const plan = generateMonthPlan(wardrobe, TEST_WEATHER, { precomputedRanked: allRanked });

const tierCounts: Record<number, number> = {};
let   totalNewItems = 0;
let   totalItems    = 0;

console.log(
  "\nDate".padEnd(12) +
  "Temp".padEnd(7) +
  "Cond".padEnd(14) +
  "Tier".padEnd(6) +
  "Score".padEnd(7) +
  "New".padEnd(5) +
  "Cyc".padEnd(5) +
  "Config",
);

for (const day of plan.days) {
  const weather = TEST_WEATHER.find((w) => w.date === day.date)!;
  const t = day.outfit.complexityTier;
  tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  totalNewItems += day.newItemsCount;
  totalItems    += day.outfit.items.length;

  console.log(
    day.date.padEnd(12) +
    `${weather.tempF}°F`.padEnd(7) +
    weather.condition.padEnd(14) +
    `T${t}`.padEnd(6) +
    day.outfit.score.toFixed(0).padStart(5).padEnd(7) +
    day.newItemsCount.toString().padEnd(5) +
    day.cycleNumber.toString().padEnd(5) +
    day.outfit.configName,
  );
}

console.log(`\nCycle resets on: ${plan.cycleResets.join(", ") || "(none yet — wardrobe large enough to span 31 days)"}`);
console.log(`Novelty: ${totalNewItems}/${totalItems} garment-slots were new items (${((totalNewItems/totalItems)*100).toFixed(0)}%)`);
console.log("Tier distribution:", Object.entries(tierCounts).sort((a,b) => +a[0]-+b[0]).map(([t,c]) => `T${t}:${c}`).join("  "));

// ── Phase 4: spot-check 3 specific days ──────────────────────────────────────

console.log("\n─── Phase 4: item-level spot checks ─────────────────────────────────────────");
const spotDates = ["2026-07-01", "2026-07-15", "2026-07-25"];
for (const date of spotDates) {
  const day = plan.days.find((d) => d.date === date);
  if (!day) continue;
  const w = TEST_WEATHER.find((x) => x.date === date)!;
  console.log(`\n  ${date}  ${w.tempF}°F ${w.condition}  →  "${day.outfit.configName}" (Tier ${day.outfit.complexityTier}, score ${day.outfit.score.toFixed(0)})`);
  for (const item of day.outfit.items) {
    console.log(`     • ${item.title}  [${item.sub_type}]  ${item.color_primary ?? ""}  ${item.brand ?? ""}`);
  }
}

// ── Phase 5: repetition audit ─────────────────────────────────────────────────

console.log("\n─── Phase 5: repetition audit (item usage counts) ──────────────────────────");
const itemUsage: Record<string, number> = {};
for (const day of plan.days) {
  for (const item of day.outfit.items) {
    itemUsage[item.id] = (itemUsage[item.id] ?? 0) + 1;
  }
}
const usageCounts = Object.values(itemUsage).sort((a, b) => b - a);
const max  = usageCounts[0] ?? 0;
const med  = usageCounts[Math.floor(usageCounts.length / 2)] ?? 0;
const zero = wardrobe.length - Object.keys(itemUsage).length;
console.log(`Most-used item: ${max}x over 31 days`);
console.log(`Median usage: ${med}x`);
console.log(`Items never used: ${zero}/${wardrobe.length}`);

// Top 5 most-used (potential over-repeat flag)
const garmentById = new Map(wardrobe.map((g) => [g.id, g]));
console.log("Top 5 most-used items:");
Object.entries(itemUsage)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([id, count]) => {
    const g = garmentById.get(id);
    console.log(`  ${count}x  ${g?.title ?? id}  [${g?.sub_type ?? "?"}]`);
  });

console.log("\n✅  Test complete.");
