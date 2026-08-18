// Single source of truth for weather data: fetching (Open-Meteo, free/keyless), condition
// classification (reusing weatherCodeToCondition's WMO-code mapping — the same mapping the
// outfit-scoring/viability logic uses, so the calendar tile display and the actual outfit
// selection never disagree about what "rainy" or "snowing" means), and geocoding.
//
// Previously this logic was duplicated across app/api/weather/route.ts (calendar tile display)
// and app/api/outfits/generate/route.ts (outfit generation), with the display route using a
// completely different, inconsistent condition-code scheme (Tomorrow.io numeric codes) than the
// WMO codes used everywhere else. Consolidated here so both call sites agree.

import { weatherCodeToCondition, type DayWeather as ScoringDayWeather } from "@/lib/weatherOutfitFilter";

export type DayWeather = ScoringDayWeather;

// Display-friendly version used by the calendar tile UI (adds a human label, keeps the same
// tempF/condition data the scoring system uses).
export type DisplayDayWeather = { tempF: number; label: string; condition: string };

export function tempLabel(tempF: number): string {
  if (tempF < 32)  return "freezing";
  if (tempF < 46)  return "very cold";
  if (tempF < 55)  return "cold";
  if (tempF < 63)  return "cool";
  if (tempF < 72)  return "mild";
  if (tempF < 82)  return "warm";
  return "hot";
}

const CONDITION_LABEL: Record<string, string> = {
  clear: "clear", cloudy: "cloudy", windy: "windy",
  light_rain: "light rain", heavy_rain: "rain", snow: "snow",
};

// Generic northern-hemisphere temperate-climate baseline, used only when neither the forecast
// nor the historical-archive Open-Meteo call returns data for a date (e.g. offline, or a
// request far enough in the future/past that even the archive has no coverage).
export function seasonalFallbackTemp(month: number): number {
  const table = [0, 38, 40, 48, 57, 65, 74, 80, 80, 72, 62, 52, 42];
  return table[month] ?? 62;
}

interface OpenMeteoDaily {
  time?: string[];
  temperature_2m_mean?: (number | null)[];
  weathercode?: (number | null)[];
  windspeed_10m_max?: (number | null)[];
}

async function fetchOpenMeteoDaily(url: string): Promise<OpenMeteoDaily | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json() as { daily?: OpenMeteoDaily };
    return d?.daily ?? null;
  } catch {
    return null;
  }
}

// Fetches real per-day temperature + condition for every date in `wantedDates` (format
// "YYYY-MM-DD") at the given coordinates. Tries the 16-day forecast first, then falls back to
// the same month/day last year via the historical archive for any dates still uncovered
// (typically: a month further out than the forecast window, or requesting a past month).
// Dates with no coverage from either source are simply absent from the returned map — callers
// apply seasonalFallbackTemp() for those.
export async function fetchMonthWeather(
  lat: number,
  lon: number,
  year: number,
  month: number,
  wantedDates: string[],
): Promise<Map<string, DayWeather>> {
  const pad  = (n: number) => String(n).padStart(2, "0");
  const vars = "temperature_2m_mean,weathercode,windspeed_10m_max";
  const result = new Map<string, DayWeather>();

  const applyDaily = (daily: OpenMeteoDaily | null, dateFor: (rawDate: string) => string | null) => {
    if (!daily) return;
    const { time = [], temperature_2m_mean = [], weathercode = [], windspeed_10m_max = [] } = daily;
    for (let i = 0; i < time.length; i++) {
      const date = dateFor(time[i]);
      if (!date || !wantedDates.includes(date) || result.has(date)) continue;
      const tempF = temperature_2m_mean[i] != null ? Math.round(temperature_2m_mean[i]!) : null;
      if (tempF == null) continue;
      const code = weathercode[i] ?? 0;
      const wind = windspeed_10m_max[i] ?? 0;
      result.set(date, { date, tempF, condition: weatherCodeToCondition(code, wind * 0.621) });
    }
  };

  const forecastDaily = await fetchOpenMeteoDaily(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=${vars}&temperature_unit=fahrenheit&forecast_days=16&timezone=auto`,
  );
  applyDaily(forecastDaily, (raw) => raw);

  const uncovered = wantedDates.filter((d) => !result.has(d));
  if (uncovered.length > 0) {
    const days = new Date(year, month, 0).getDate();
    const ly   = year - 1;
    const archiveDaily = await fetchOpenMeteoDaily(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${ly}-${pad(month)}-01&end_date=${ly}-${pad(month)}-${pad(days)}` +
      `&daily=${vars}&temperature_unit=fahrenheit`,
    );
    applyDaily(archiveDaily, (raw) => `${year}-${raw.slice(5)}`);
  }

  return result;
}

export function toDisplayWeather(w: DayWeather): DisplayDayWeather {
  return {
    tempF: w.tempF,
    condition: w.condition,
    label: `${tempLabel(w.tempF)}, ${CONDITION_LABEL[w.condition] ?? w.condition}`,
  };
}

export function seasonalFallbackDisplay(month: number): DisplayDayWeather {
  const tempF = seasonalFallbackTemp(month);
  return { tempF, condition: "clear", label: `${tempLabel(tempF)}, clear` };
}

// ── Geocoding (Open-Meteo, free/keyless) ─────────────────────────────────────────

export type GeocodeResult = { lat: number; lon: number; label: string };

// Forward geocoding — turns a user-typed place name into coordinates, for the manual-entry
// fallback when browser geolocation is denied or unavailable.
export async function geocodeCity(query: string): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({ name: query, count: "5", language: "en", format: "json" });
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      results?: { latitude: number; longitude: number; name: string; admin1?: string; country?: string }[];
    };
    return (data.results ?? []).map((r) => ({
      lat: r.latitude,
      lon: r.longitude,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    }));
  } catch {
    return [];
  }
}

// Reverse geocoding — turns resolved coordinates (from navigator.geolocation) into a
// human-readable place name to show the user what location their weather is based on.
// Open-Meteo has no reverse-geocoding endpoint, so this uses BigDataCloud's free
// client-side reverse-geocode endpoint (no API key required, no rate-limit auth needed).
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), localityLanguage: "en",
    });
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { city?: string; locality?: string; principalSubdivision?: string; countryName?: string };
    const city = data.city || data.locality;
    return [city, data.principalSubdivision || data.countryName].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}
