import { NextRequest, NextResponse } from "next/server";

export type DayWeather = { tempF: number; label: string; condition: string };

function tempToDesc(tempF: number): string {
  if (tempF < 32)  return "freezing";
  if (tempF < 46)  return "very cold";
  if (tempF < 55)  return "cold";
  if (tempF < 63)  return "cool";
  if (tempF < 72)  return "mild";
  if (tempF < 82)  return "warm";
  return "hot";
}

function describeWeather(tempC: number, precipProb: number, code: number): DayWeather {
  const tempF = Math.round(tempC * 9 / 5 + 32);
  let condition = "clear";
  if      (code >= 5000 && code < 6000) condition = "snow";
  else if (code >= 4000 && code < 5000) condition = precipProb > 40 ? "rain" : "cloudy";
  else if (code >= 1100 && code < 2000) condition = "partly cloudy";
  return { tempF, label: `${tempToDesc(tempF)}, ${condition}`, condition };
}

function seasonalFallback(month: number): DayWeather {
  const table: [number, string, string][] =
    [[12, "cold, clear", "clear"], [1, "cold, clear", "clear"], [2, "cold, clear", "clear"],
     [3, "cool, clear", "clear"], [4, "mild, clear", "clear"], [5, "mild, clear", "clear"],
     [6, "warm, clear", "clear"], [7, "warm, clear", "clear"], [8, "warm, clear", "clear"],
     [9, "mild, clear", "clear"], [10, "cool, clear", "clear"], [11, "cool, clear", "clear"]];
  const tempTable: number[] = [48, 48, 50, 55, 63, 70, 80, 82, 76, 68, 60, 52];
  const idx = month - 1;
  return { tempF: tempTable[idx], label: table[idx][1], condition: table[idx][2] };
}

// Open-Meteo: free, no key needed. Returns tempF per date for the given month/year at lat/lon.
// Tries current-year forecast first (covers next 16 days), then last-year archive for the rest.
async function openMeteoTemps(
  lat: number, lon: number, year: number, month: number
): Promise<Record<string, number>> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  const allDates = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
  const result: Record<string, number> = {};

  // 1 — Open-Meteo 16-day forecast (covers current + near-future months)
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&temperature_unit=fahrenheit&forecast_days=16&timezone=auto`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (r.ok) {
      const d = await r.json() as { daily?: { time?: string[]; temperature_2m_mean?: number[] } };
      const times = d?.daily?.time ?? [];
      const temps = d?.daily?.temperature_2m_mean ?? [];
      for (let i = 0; i < times.length; i++) {
        if (allDates.includes(times[i]) && temps[i] != null) result[times[i]] = Math.round(temps[i]);
      }
    }
  } catch { /* continue */ }

  // 2 — Open-Meteo archive from same month last year for any uncovered dates
  const uncovered = allDates.filter(d => !(d in result));
  if (uncovered.length > 0) {
    const lastYear = year - 1;
    const start    = `${lastYear}-${pad(month)}-01`;
    const end      = `${lastYear}-${pad(month)}-${pad(daysInMonth)}`;
    try {
      const r = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_mean&temperature_unit=fahrenheit`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json() as { daily?: { time?: string[]; temperature_2m_mean?: number[] } };
        const times = d?.daily?.time ?? [];
        const temps = d?.daily?.temperature_2m_mean ?? [];
        for (let i = 0; i < times.length; i++) {
          const dayNum = times[i].slice(8, 10);
          const thisYear = `${year}-${pad(month)}-${dayNum}`;
          if (allDates.includes(thisYear) && !(thisYear in result) && temps[i] != null) {
            result[thisYear] = Math.round(temps[i]);
          }
        }
      }
    } catch { /* fall through to seasonal below */ }
  }

  return result;
}

// GET /api/weather?year=2026&month=6&lat=34.2&lon=-118.9
export async function GET(req: NextRequest) {
  const year  = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const lat   = req.nextUrl.searchParams.get("lat");
  const lon   = req.nextUrl.searchParams.get("lon");

  if (!year || !month) return NextResponse.json({ error: "year and month required" }, { status: 400 });

  const pad         = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  const allDates    = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);

  // Start with seasonal fallback for every date
  const result: Record<string, DayWeather> = {};
  const fallback = seasonalFallback(month);
  for (const date of allDates) result[date] = fallback;

  // Override with location-accurate data when coordinates provided
  if (lat && lon) {
    const temps = await openMeteoTemps(parseFloat(lat), parseFloat(lon), year, month);
    for (const [date, tempF] of Object.entries(temps)) {
      result[date] = { tempF, label: `${tempToDesc(tempF)}, clear`, condition: "clear" };
    }

    // Also try Tomorrow.io for condition data (precipitation, cloud cover) if key exists
    if (process.env.TOMORROW_API_KEY) {
      try {
        const wRes = await fetch(
          `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1d&apikey=${process.env.TOMORROW_API_KEY}`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (wRes.ok) {
          const wData = await wRes.json() as { timelines?: { daily?: Array<{ time: string; values: { temperatureAvg: number; precipitationProbabilityAvg: number; weatherCodeMax: number } }> } };
          for (const interval of (wData?.timelines?.daily ?? [])) {
            const dateStr = (interval.time as string).slice(0, 10);
            if (dateStr in result) {
              const v = interval.values;
              result[dateStr] = describeWeather(v.temperatureAvg, v.precipitationProbabilityAvg, v.weatherCodeMax);
            }
          }
        }
      } catch { /* Open-Meteo temps already set */ }
    }
  }

  return NextResponse.json(result);
}
