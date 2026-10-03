// Apple WeatherKit REST integration — dormant until the four env vars below are set, at which
// point lib/weatherData.ts's fetchMonthWeather automatically prefers this over Open-Meteo with no
// further code changes needed. This exists specifically to match what Apple's own Weather app
// shows (the user's explicit ask), since Open-Meteo is a different model/blend that will never be
// bit-for-bit identical to Apple's numbers no matter how its parameters are tuned.
//
// This is a SERVER-SIDE REST API call, not an iOS framework — nothing about it requires the
// caller to be an Apple device. Since this file is called from app/api/weather/route.ts (one
// backend, shared by the website, the iOS app, and eventually Android), wiring it up here makes
// Apple-quality weather data available to all three platforms at once, not just iOS. The
// WeatherKit *service* itself, though, can only be enabled/keyed by an Apple Developer Program
// membership — that's an account-level requirement, not a platform restriction on who consumes
// the data afterward.
//
// STATUS: not yet connected to the real API — the exact response field names below are written
// from documentation knowledge, not verified against a live call (no credentials exist yet to
// test with). Treat this as a strong first draft: once real credentials exist, make one real
// call, log the raw response, and fix any field-name mismatches before trusting it in production.
//
// Setup, once enrolled in the Apple Developer Program ($99/yr, already needed for the App Store):
//   1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → register a new
//      "Services ID" (a reverse-DNS string you choose, e.g. "com.mycloset.weatherkit") and enable
//      the WeatherKit capability on it.
//   2. Keys → create a new key, enable WeatherKit, download the resulting AuthKey_XXXXXXXXXX.p8
//      file ONCE (Apple will not let you download it again — save it somewhere safe immediately).
//      The 10-character XXXXXXXXXX in the filename is the Key ID.
//   3. Note your Team ID (top-right of the Apple Developer account page, also 10 characters).
//   4. Set these four environment variables (server-side only, never exposed to any client):
//      - WEATHERKIT_TEAM_ID       — your 10-character Apple Developer Team ID
//      - WEATHERKIT_SERVICE_ID    — the Services ID string you created in step 1
//      - WEATHERKIT_KEY_ID        — the 10-character Key ID from the .p8 filename
//      - WEATHERKIT_PRIVATE_KEY   — the full contents of the .p8 file, including the
//                                   "-----BEGIN PRIVATE KEY-----"/"-----END PRIVATE KEY-----"
//                                   lines (paste literal newlines, or \n-escaped — see
//                                   isWeatherKitConfigured's own parsing below either way)
import { SignJWT, importPKCS8 } from "jose";
import { weatherCodeToCondition } from "@/lib/weatherOutfitFilter";
import type { DayWeather } from "@/lib/weatherData";

const TEAM_ID    = process.env.WEATHERKIT_TEAM_ID;
const SERVICE_ID = process.env.WEATHERKIT_SERVICE_ID;
const KEY_ID     = process.env.WEATHERKIT_KEY_ID;
const PRIVATE_KEY_RAW = process.env.WEATHERKIT_PRIVATE_KEY;

export function isWeatherKitConfigured(): boolean {
  return !!(TEAM_ID && SERVICE_ID && KEY_ID && PRIVATE_KEY_RAW);
}

// A JWT is valid for up to 1 hour per Apple's own guidance for this API — regenerating one per
// request is simplest and avoids any shared-mutable-cache complexity; ES256 signing is cheap.
async function buildToken(): Promise<string> {
  const pem = PRIVATE_KEY_RAW!.includes("\\n") ? PRIVATE_KEY_RAW!.replace(/\\n/g, "\n") : PRIVATE_KEY_RAW!;
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({ sub: SERVICE_ID })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, id: `${TEAM_ID}.${SERVICE_ID}` })
    .setIssuer(TEAM_ID!)
    .setIssuedAt()
    .setExpirationTime("55m")
    .sign(key);
}

// WeatherKit's own WMO-adjacent condition strings (e.g. "MostlyClear", "Rain", "Snow",
// "Thunderstorms") are a different vocabulary from the WMO numeric codes weatherCodeToCondition
// expects (see lib/weatherOutfitFilter.ts) — mapped here to the same small internal condition set
// ("clear"|"cloudy"|"windy"|"light_rain"|"heavy_rain"|"snow") everything downstream already uses,
// so nothing else in the app needs to know which weather provider is actually active.
function weatherKitConditionToInternal(code: string): ReturnType<typeof weatherCodeToCondition> {
  const c = code.toLowerCase();
  if (c.includes("snow") || c.includes("sleet") || c.includes("ice") || c.includes("hail")) return "snow";
  if (c.includes("thunder") || c.includes("heavy")) return "heavy_rain";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("showers")) return "light_rain";
  if (c.includes("windy") || c.includes("breezy")) return "windy";
  if (c.includes("cloud") || c.includes("overcast") || c.includes("haze") || c.includes("fog")) return "cloudy";
  return "clear";
}

type WeatherKitDailyForecast = {
  forecastDaily?: {
    days?: {
      forecastStart: string; // ISO 8601, local to the requested timezone
      temperatureMax: number; // Celsius
      temperatureMin: number; // Celsius
      conditionCode: string;
      windSpeedMax?: number; // km/h
    }[];
  };
};

// Fetches per-day temperature + condition for every date in `wantedDates` at the given
// coordinates, mirroring fetchMonthWeather's own signature/contract exactly so
// lib/weatherData.ts can call either one interchangeably. tempF is (max+min)/2 — WeatherKit's
// daily forecast gives a high/low pair, not a single blended mean the way Open-Meteo's
// temperature_2m_mean does; averaging the two is the closest equivalent to what this app already
// expects everywhere (a single representative tempF per day), and empirically (see the real
// Open-Meteo comparison done while debugging this) a true 24h mean usually lands within a degree
// or two of this same midpoint anyway.
export async function fetchMonthWeatherViaWeatherKit(
  lat: number,
  lon: number,
  wantedDates: string[],
): Promise<Map<string, DayWeather>> {
  const result = new Map<string, DayWeather>();
  if (!isWeatherKitConfigured()) return result;

  try {
    const token = await buildToken();
    const url = `https://weatherkit.apple.com/api/v1/weather/en/${lat}/${lon}?dataSets=forecastDaily&timezone=UTC`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[weatherKit] API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return result;
    }
    const data = await res.json() as WeatherKitDailyForecast;
    for (const day of data.forecastDaily?.days ?? []) {
      const date = day.forecastStart.slice(0, 10); // "YYYY-MM-DDTHH:mm:ssZ" -> "YYYY-MM-DD"
      if (!wantedDates.includes(date) || result.has(date)) continue;
      const maxF = day.temperatureMax * 9 / 5 + 32;
      const minF = day.temperatureMin * 9 / 5 + 32;
      const wind = day.windSpeedMax ?? 0; // already km/h, matching weatherCodeToCondition's own unit expectation elsewhere
      result.set(date, {
        date,
        tempF: Math.round((maxF + minF) / 2),
        condition: weatherKitConditionToInternal(day.conditionCode) as DayWeather["condition"],
      });
    }
  } catch (err) {
    console.error("[weatherKit] fetch failed:", err instanceof Error ? err.message : err);
  }
  return result;
}
