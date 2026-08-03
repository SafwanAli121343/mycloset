import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateOutfit } from "@/lib/outfitGenerator";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userId, lat, lon } = body;

  if (!userId || !lat || !lon) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const { data: garments, error } = await supabase
    .from("garments")
    .select("*")
    .eq("user_id", userId);

  if (error || !garments || garments.length === 0) {
    return NextResponse.json({ error: "No garments found" }, { status: 404 });
  }
  const weatherRes = await fetch(
    `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&apikey=${process.env.TOMORROW_API_KEY}&units=imperial`
  );
  const weatherData = await weatherRes.json();
  const today = weatherData.timelines?.daily?.[0]?.values;

  if (!today) {
    return NextResponse.json({ error: "Could not fetch weather" }, { status: 500 });
  }

  const weather = {
    tempHigh: today.temperatureMax,
    tempLow: today.temperatureMin,
    precipitation: today.precipitationProbabilityAvg,
    windSpeed: today.windSpeedAvg,
    uvIndex: today.uvIndexMax,
    condition: today.weatherCodeMax,
  };

    const outfit = await generateOutfit(garments, weather);

  if (!outfit) {
    return NextResponse.json({ error: "Could not generate outfit" }, { status: 500 });
  }

  return NextResponse.json({ outfit });
}


