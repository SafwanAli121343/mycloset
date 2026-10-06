import { NextRequest, NextResponse } from "next/server";
import { fetchMonthWeather, seasonalFallbackDisplay, toDisplayWeather, type DisplayDayWeather } from "@/lib/weatherData";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getSessionFromCookies } from "@/lib/auth/session";

// GET /api/weather?year=2026&month=6&lat=34.2&lon=-118.9
// Returns per-day temp + condition for the calendar tile display, using the same Open-Meteo
// data (and the same WMO condition-code mapping) as the actual outfit-generation/scoring
// pipeline — so what the calendar shows and what outfits get picked never disagree.
export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "weather", 300, 60 * 1000);
  if (rateBlock) return rateBlock;

  // Every other route under app/api/** enforces its own session check (see proxy.ts's own
  // comment on why API routes are excluded from the middleware gate) — this one was missing it,
  // making it a free, unauthenticated pass-through to Open-Meteo for anyone on the internet. Low
  // stakes today since Open-Meteo is free, but WeatherKit (lib/weatherKit.ts) has a real call
  // quota tied to the Apple Developer account once configured, and this endpoint would let
  // anyone burn through it with zero per-account attribution.
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year  = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const latRaw = req.nextUrl.searchParams.get("lat");
  const lonRaw = req.nextUrl.searchParams.get("lon");
  const lat = latRaw != null ? parseFloat(latRaw) : null;
  const lon = lonRaw != null ? parseFloat(lonRaw) : null;
  const hasValidCoords =
    lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

  if (!year || !month) return NextResponse.json({ error: "year and month required" }, { status: 400 });

  const pad         = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  const allDates    = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);

  const result: Record<string, DisplayDayWeather> = {};
  const fallback = seasonalFallbackDisplay(month);
  for (const date of allDates) result[date] = fallback;

  if (hasValidCoords) {
    const weather = await fetchMonthWeather(lat!, lon!, year, month, allDates);
    for (const [date, w] of weather) result[date] = toDisplayWeather(w);
  }

  return NextResponse.json(result);
}
