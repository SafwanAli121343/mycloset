// Weather-to-config suitability mapping for the 32-config outfit generation system.
// Temperature ranges and precipitation rules derived from street-style conventions
// and general clothing science (each major layer ≈ +8-12 °F of warmth tolerance).

import { STACK_CONFIGS } from "./wardrobeOutfitGen";

// ── Complexity tier ─────────────────────────────────────────────────────────
// Computed from layer count: baseCount + mid + vest + outer + 1 (bottom/onepiece).
// Tier 1 = one piece alone (most minimal), Tier 5 = fully stacked (most complex).

export const CONFIG_COMPLEXITY: Record<string, number> = {};
for (const cfg of STACK_CONFIGS) {
  CONFIG_COMPLEXITY[cfg.name] =
    cfg.baseCount + (cfg.mid ? 1 : 0) + (cfg.vest ? 1 : 0) + (cfg.outer ? 1 : 0) + 1;
}

// ── Which configs include an outer layer ───────────────────────────────────
const CONFIGS_WITH_OUTER = new Set(STACK_CONFIGS.filter((c) => c.outer).map((c) => c.name));

// ── Temperature suitability ranges (°F) — tightened ceilings ──────────────
// Rule of thumb: each significant layer reduces comfortable max by ~8°F.
// Key calibration fixes vs prior version:
//   "Layered base" (2 shirts): was 80°F max → now 68°F  (nobody layers 2 shirts at 79°F)
//   "Triple base"  (3 shirts): was 74°F max → now 62°F  (cool-weather streetwear only)
//   "Base + mid"   (sweater) : was 70°F max → now 64°F  (sweater at 70°F is too warm)
//   "Clean minimal": min 68→65°F (tee+jeans is fine at 65°F)
//   "Base + outer": max 68→72°F (light jacket at 72°F is totally normal)
//   "One-piece + outer": max 68→74°F (light jacket over dress fine at 74°F)

export const CONFIG_TEMP_RANGE: Record<string, { minF: number; maxF: number }> = {
  // ── Tier 1 ───────────────────────────────────────────────────────────────
  "One-piece only":                     { minF: 68, maxF: 115 },

  // ── Tier 2 ───────────────────────────────────────────────────────────────
  "Clean minimal":                      { minF: 65, maxF: 105 },
  "One-piece + mid":                    { minF: 50, maxF: 70 },
  "One-piece + vest":                   { minF: 52, maxF: 72 },
  "One-piece + outer":                  { minF: 42, maxF: 74 },
  "Overalls + underlayer":              { minF: 55, maxF: 78 },
  "Base under one-piece":               { minF: 58, maxF: 78 },

  // ── Tier 3 ───────────────────────────────────────────────────────────────
  "Layered base":                       { minF: 52, maxF: 68 },   // was 80 — critical fix
  "Base + vest":                        { minF: 50, maxF: 72 },
  "Base + mid":                         { minF: 44, maxF: 64 },   // was 70 — critical fix
  "Base + outer":                       { minF: 40, maxF: 72 },   // was 68, raised to 72
  "One-piece + mid + outer":            { minF: 36, maxF: 58 },
  "One-piece + vest + outer":           { minF: 38, maxF: 62 },
  "One-piece + mid + vest":             { minF: 44, maxF: 64 },
  "Overalls + underlayer + outer":      { minF: 34, maxF: 58 },
  "Base under one-piece + outer":       { minF: 40, maxF: 66 },
  "Base under one-piece + mid":         { minF: 46, maxF: 66 },

  // ── Tier 4 ───────────────────────────────────────────────────────────────
  "Triple base":                        { minF: 44, maxF: 62 },   // was 74 — critical fix
  "Layered base + vest":                { minF: 44, maxF: 62 },   // was 68
  "Layered base + mid":                 { minF: 38, maxF: 56 },   // was 62
  "Layered base + outer":               { minF: 28, maxF: 54 },
  "Base + mid + vest":                  { minF: 40, maxF: 58 },   // was 62
  "Base + mid + outer":                 { minF: 28, maxF: 52 },
  "Base + vest + outer":                { minF: 32, maxF: 56 },
  "One-piece + mid + vest + outer":     { minF: 20, maxF: 46 },
  "Overalls + mid + outer":             { minF: 24, maxF: 48 },
  "Base under one-piece + mid + outer": { minF: 30, maxF: 52 },

  // ── Tier 5 ───────────────────────────────────────────────────────────────
  "Layered base + mid + vest":          { minF: 34, maxF: 54 },   // was 58
  "Triple base + outer":                { minF: 12, maxF: 38 },   // was 42
  "Layered base + mid + outer":         { minF: 18, maxF: 44 },   // was 48
  "Layered base + vest + outer":        { minF: 22, maxF: 48 },
  "Base + mid + vest + outer":          { minF: 24, maxF: 50 },
};

// ── Weather types ──────────────────────────────────────────────────────────

export type WeatherCondition = "clear" | "cloudy" | "windy" | "light_rain" | "heavy_rain" | "snow";

export type DayWeather = {
  date: string;           // "YYYY-MM-DD"
  tempF: number;
  condition: WeatherCondition;
};

/**
 * Converts an Open-Meteo WMO weather interpretation code to a WeatherCondition.
 * Wind speed (mph) is optional; >25 mph marks a clear/cloudy day as "windy".
 */
export function weatherCodeToCondition(
  code: number,
  windSpeedMph?: number,
): WeatherCondition {
  if (code === 0) return windSpeedMph && windSpeedMph > 25 ? "windy" : "clear";
  if (code <= 3)  return windSpeedMph && windSpeedMph > 25 ? "windy" : "cloudy";
  if (code <= 48) return "cloudy";                       // fog / rime fog
  if (code <= 57) return "light_rain";                   // drizzle
  if (code <= 65) return code < 65 ? "light_rain" : "heavy_rain";  // rain
  if (code <= 67) return "light_rain";                   // freezing rain
  if (code <= 77) return "snow";                         // snow
  if (code <= 82) return code < 82 ? "light_rain" : "heavy_rain";  // showers
  if (code <= 86) return "snow";                         // snow showers
  return "heavy_rain";                                   // thunderstorms (95-99)
}

// When it's raining or snowing you need outer protection even if it's warm.
// Add this buffer to the maxF threshold so light-jacket configs stay viable
// in warm rain (e.g. "Base + outer" at 76°F rainy day is totally reasonable).
const RAIN_TEMP_BUFFER = 14; // °F

/**
 * Returns config names that are physically viable for this weather,
 * sorted highest → lowest complexity (most complex first).
 */
export function getViableConfigs(weather: DayWeather): string[] {
  const { tempF, condition } = weather;
  const requiresOuter = condition === "light_rain" || condition === "heavy_rain" || condition === "snow";
  const prefersOuter  = condition === "windy";

  return Object.entries(CONFIG_TEMP_RANGE)
    .filter(([name, { minF, maxF }]) => {
      // For rain/snow: outer configs get a warm-weather buffer so you're never
      // left without rain protection just because it's a warm rainy day.
      const effectiveMaxF = (requiresOuter && CONFIGS_WITH_OUTER.has(name))
        ? maxF + RAIN_TEMP_BUFFER
        : maxF;
      if (tempF < minF || tempF > effectiveMaxF) return false;
      if (requiresOuter && !CONFIGS_WITH_OUTER.has(name)) return false;
      return true;
    })
    .sort(([a], [b]) => {
      const tierDiff = (CONFIG_COMPLEXITY[b] ?? 0) - (CONFIG_COMPLEXITY[a] ?? 0);
      if (tierDiff !== 0) return tierDiff;
      // Within the same tier, prefer outer configs on windy/rainy days
      if (prefersOuter || requiresOuter) {
        const aOuter = CONFIGS_WITH_OUTER.has(a) ? 1 : 0;
        const bOuter = CONFIGS_WITH_OUTER.has(b) ? 1 : 0;
        return bOuter - aOuter;
      }
      return 0;
    })
    .map(([name]) => name);
}
