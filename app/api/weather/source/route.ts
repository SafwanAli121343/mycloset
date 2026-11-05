import { NextResponse } from "next/server";
import { isWeatherKitConfigured } from "@/lib/weatherKit";

// GET /api/weather/source
// Which weather provider is live, for the attribution line under the calendar. Apple requires
// apps showing WeatherKit data to show the Apple Weather mark and link to its data-sources page;
// Open-Meteo asks for a credit too, and it still supplies the days past WeatherKit's ~10-day
// forecast. Logo and link come from here (Apple's own URLs, see
// https://weatherkit.apple.com/attribution/en) so they can change without an app update.
export function GET() {
  const weatherKit = isWeatherKitConfigured();
  return NextResponse.json(
    {
      weatherKit,
      appleLogoLight: weatherKit ? "https://weatherkit.apple.com/assets/branding/en/Apple_Weather_blk_en_3X_090122.png" : null,
      appleLogoDark: weatherKit ? "https://weatherkit.apple.com/assets/branding/en/Apple_Weather_wht_en_3X_090122.png" : null,
      appleLegalUrl: weatherKit ? "https://developer.apple.com/weatherkit/data-source-attribution/" : null,
      openMeteoUrl: "https://open-meteo.com/",
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
