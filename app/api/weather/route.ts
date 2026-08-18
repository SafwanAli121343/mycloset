import { NextRequest, NextResponse } from "next/server";
import { fetchMonthWeather, seasonalFallbackDisplay, toDisplayWeather, type DisplayDayWeather } from "@/lib/weatherData";

// GET /api/weather?year=2026&month=6&lat=34.2&lon=-118.9
// Returns per-day temp + condition for the calendar tile display, using the same Open-Meteo
// data (and the same WMO condition-code mapping) as the actual outfit-generation/scoring
// pipeline — so what the calendar shows and what outfits get picked never disagree.
export async function GET(req: NextRequest) {
  const year  = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const lat   = req.nextUrl.searchParams.get("lat");
  const lon   = req.nextUrl.searchParams.get("lon");

  if (!year || !month) return NextResponse.json({ error: "year and month required" }, { status: 400 });

  const pad         = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  const allDates    = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);

  const result: Record<string, DisplayDayWeather> = {};
  const fallback = seasonalFallbackDisplay(month);
  for (const date of allDates) result[date] = fallback;

  if (lat && lon) {
    const weather = await fetchMonthWeather(parseFloat(lat), parseFloat(lon), year, month, allDates);
    for (const [date, w] of weather) result[date] = toDisplayWeather(w);
  }

  return NextResponse.json(result);
}
