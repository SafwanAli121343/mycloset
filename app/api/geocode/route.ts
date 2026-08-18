import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { geocodeCity, reverseGeocode } from "@/lib/weatherData";

// GET /api/geocode?q=<city name>              -> { results: GeocodeResult[] }
// GET /api/geocode?lat=<n>&lon=<n>             -> { label: string | null }
//
// Backs two calendar-page features: manual location entry (forward geocode, when browser
// geolocation is denied/unavailable) and the "weather based on: X" display label (reverse
// geocode of whatever coordinates were actually resolved).
export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q   = req.nextUrl.searchParams.get("q");
  const lat = req.nextUrl.searchParams.get("lat");
  const lon = req.nextUrl.searchParams.get("lon");

  if (lat && lon) {
    const label = await reverseGeocode(parseFloat(lat), parseFloat(lon));
    return NextResponse.json({ label });
  }

  if (q && q.trim().length > 0) {
    const results = await geocodeCity(q.trim());
    return NextResponse.json({ results });
  }

  return NextResponse.json({ error: "q, or lat and lon, required" }, { status: 400 });
}
