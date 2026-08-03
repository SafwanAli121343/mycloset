#!/usr/bin/env node
// Regenerates all outfits for the 3 auto-generated months (current + next 2)
// with real per-day weather from Open-Meteo when coordinates are provided.
//
// Run: npx tsx --env-file=.env.local scripts/regen-outfits.mts [lat] [lon]
// e.g. npx tsx --env-file=.env.local scripts/regen-outfits.mts 34.05 -118.24

import { createClient } from "@supabase/supabase-js";
import type { GarmentForScoring } from "../lib/scoring.js";
import { generateAndRankAllOutfits } from "../lib/wardrobeOutfitGen.js";
import { generateMonthPlan } from "../lib/monthOutfitPlan.js";
import { weatherCodeToCondition, type DayWeather } from "../lib/weatherOutfitFilter.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const GARMENTS_USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";
const OUTFITS_USER_ID  = "dd03be59-8301-4f91-9bda-533f26650212";

// Lat/lon from args, else fall back to seasonal
const argLat = process.argv[2] ? parseFloat(process.argv[2]) : null;
const argLon = process.argv[3] ? parseFloat(process.argv[3]) : null;
const hasCoords = argLat != null && argLon != null && !isNaN(argLat) && !isNaN(argLon);

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, "0"); }

function seasonalFallbackTemp(month: number): number {
  return [0, 38, 40, 48, 57, 65, 74, 80, 80, 72, 62, 52, 42][month] ?? 62;
}

function tempLabel(tempF: number): string {
  if (tempF < 32)  return "freezing";
  if (tempF < 46)  return "very cold";
  if (tempF < 55)  return "cold";
  if (tempF < 63)  return "cool";
  if (tempF < 72)  return "mild";
  if (tempF < 82)  return "warm";
  return "hot";
}

function deriveAesthetic(ids: string[], wardrobe: GarmentForScoring[]): string {
  const byId = new Map(wardrobe.map(g => [g.id, g]));
  const tags = ids.flatMap(id => (byId.get(id)?.aesthetic_tags as string[] | null) ?? []);
  if (!tags.length) return "casual";
  const freq: Record<string, number> = {};
  for (const t of tags) freq[t] = (freq[t] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Open-Meteo weather fetch ─────────────────────────────────────────────────
async function fetchWeatherForMonth(
  lat: number, lon: number, year: number, month: number, allDates: string[],
): Promise<Map<string, DayWeather>> {
  const vars = "temperature_2m_mean,weathercode,windspeed_10m_max";
  const result = new Map<string, DayWeather>();

  // Forecast API (covers up to 16 days ahead)
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=${vars}&temperature_unit=fahrenheit&forecast_days=16&timezone=auto`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (r.ok) {
      const d = await r.json() as { daily?: { time?: string[]; temperature_2m_mean?: (number|null)[]; weathercode?: (number|null)[]; windspeed_10m_max?: (number|null)[] } };
      const { time = [], temperature_2m_mean = [], weathercode = [], windspeed_10m_max = [] } = d.daily ?? {};
      for (let i = 0; i < time.length; i++) {
        if (!allDates.includes(time[i])) continue;
        const tempF = temperature_2m_mean[i] != null ? Math.round(temperature_2m_mean[i]!) : null;
        if (tempF == null) continue;
        result.set(time[i], {
          date: time[i],
          tempF,
          condition: weatherCodeToCondition(weathercode[i] ?? 0, (windspeed_10m_max[i] ?? 0) * 0.621),
        });
      }
    }
  } catch { /* fall through */ }

  // Archive API for uncovered dates (last year as proxy)
  const uncovered = allDates.filter(d => !result.has(d));
  if (uncovered.length > 0) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const ly = year - 1;
    try {
      const r = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${ly}-${pad(month)}-01&end_date=${ly}-${pad(month)}-${pad(daysInMonth)}` +
        `&daily=${vars}&temperature_unit=fahrenheit`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (r.ok) {
        const d = await r.json() as { daily?: { time?: string[]; temperature_2m_mean?: (number|null)[]; weathercode?: (number|null)[]; windspeed_10m_max?: (number|null)[] } };
        const { time = [], temperature_2m_mean = [], weathercode = [], windspeed_10m_max = [] } = d.daily ?? {};
        for (let i = 0; i < time.length; i++) {
          const thisYearDate = `${year}-${time[i].slice(5)}`;
          if (!allDates.includes(thisYearDate) || result.has(thisYearDate)) continue;
          const tempF = temperature_2m_mean[i] != null ? Math.round(temperature_2m_mean[i]!) : null;
          if (tempF == null) continue;
          result.set(thisYearDate, {
            date: thisYearDate,
            tempF,
            condition: weatherCodeToCondition(weathercode[i] ?? 0, (windspeed_10m_max[i] ?? 0) * 0.621),
          });
        }
      }
    } catch { /* fall through */ }
  }

  return result;
}

// ── Fetch wardrobe ────────────────────────────────────────────────────────────
console.log(`Garments user: ${GARMENTS_USER_ID}`);
console.log(`Outfits user:  ${OUTFITS_USER_ID}`);
console.log(hasCoords ? `Location: ${argLat}, ${argLon} (real weather)` : `Location: none (seasonal fallback)`);
console.log();

const { data: garmentRows, error: garmentErr } = await sb
  .from("garments")
  .select("id,title,brand,sub_type,material,color_primary,color_secondary,pattern,formality,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image")
  .eq("user_id", GARMENTS_USER_ID);

if (garmentErr) { console.error("DB error:", garmentErr.message); process.exit(1); }
if (!garmentRows?.length) { console.log("No garments found."); process.exit(0); }

const wardrobe = garmentRows as unknown as GarmentForScoring[];
console.log(`Wardrobe: ${wardrobe.length} items`);

// ── Pre-generate all ranked outfits (done once, shared across all months) ─────
console.log("Generating outfit combinations...");
const t0 = Date.now();
const allRanked = generateAndRankAllOutfits(wardrobe, { maxTotal: 5000 });
console.log(`Generated ${allRanked.length} ranked outfits in ${Date.now() - t0}ms\n`);

if (!allRanked.length) {
  console.error("No valid outfits — wardrobe may be missing footwear, tops, or bottoms.");
  process.exit(1);
}

// ── Target months: current + next 2 ──────────────────────────────────────────
const now = new Date();
const targetMonths = [0, 1, 2].map(offset => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
});

// ── Process each month ────────────────────────────────────────────────────────
for (const { year, month } of targetMonths) {
  const monthLabel = `${year}-${pad(month)}`;
  console.log(`── ${monthLabel} ────────────────────────────────────────`);

  const daysInMonth = new Date(year, month, 0).getDate();
  const allDates = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
  const startDate = `${year}-${pad(month)}-01`;
  const endDate   = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  // Fetch real weather if coords available, else seasonal fallback
  let weatherMap = new Map<string, DayWeather>();
  if (hasCoords) {
    process.stdout.write(`  Fetching weather from Open-Meteo...`);
    weatherMap = await fetchWeatherForMonth(argLat!, argLon!, year, month, allDates);
    console.log(` ${weatherMap.size}/${daysInMonth} days with real data`);
  }

  const weatherByDate: DayWeather[] = allDates.map(date =>
    weatherMap.get(date) ?? {
      date,
      tempF: seasonalFallbackTemp(month),
      condition: "clear" as const,
    },
  );

  // Run the planner
  const { days } = generateMonthPlan(wardrobe, weatherByDate, { precomputedRanked: allRanked });

  // Delete existing outfits for this month
  const { data: existing } = await sb.from("outfits")
    .select("id")
    .eq("user_id", OUTFITS_USER_ID)
    .gte("date", startDate)
    .lte("date", endDate);

  if (existing?.length) {
    const ids = existing.map(o => o.id);
    await sb.from("outfit_items").delete().in("outfit_id", ids);
    await sb.from("outfits").delete().in("id", ids);
    console.log(`  Deleted ${ids.length} existing outfits`);
  }

  // Insert new outfits
  let inserted = 0;
  for (const { date, outfit } of days) {
    if (!outfit.items.length) continue;
    const itemIds = outfit.items.map(i => i.id);
    const w = weatherByDate.find(w => w.date === date);
    const tempF = w?.tempF ?? seasonalFallbackTemp(month);
    const notesJson = JSON.stringify({
      aesthetic:      deriveAesthetic(itemIds, wardrobe),
      note:           `${tempLabel(tempF)}, ${tempF}°F`,
      configName:     outfit.configName,
      complexityTier: outfit.complexityTier,
      styleScore:     outfit.score,
    });

    const { data: newOutfit, error: insertErr } = await sb
      .from("outfits")
      .insert({ user_id: OUTFITS_USER_ID, date, ai_garment_ids: itemIds, notes: notesJson })
      .select("id").single();

    if (insertErr || !newOutfit?.id) {
      console.log(`  ✘ ${date}: ${insertErr?.message ?? "no id"}`);
      continue;
    }

    await sb.from("outfit_items").insert(itemIds.map(gid => ({ outfit_id: newOutfit.id, garment_id: gid })));
    inserted++;
  }

  console.log(`  ✔ Inserted ${inserted} outfits for ${monthLabel}`);
}

console.log("\n✅ Done — reload the app and clear localStorage to see updated outfits.");
console.log("   In DevTools: localStorage.removeItem('outfits_cache_v14') then refresh.");
