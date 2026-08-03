import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Garment = {
  id: string;
  title: string;
  category: string;
  image: string;
};

type Weather = {
  tempHigh: number;
  tempLow: number;
  precipitation: number;
  windSpeed: number;
  uvIndex: number;
  condition: number;
};

function filterByWeather(garments: Garment[], weather: Weather): Garment[] {
  return garments.filter((g) => {
    const title = g.title.toLowerCase();
    
    // Too cold for shorts/tees
    if (weather.tempHigh < 55) {
      if (title.includes("short") || title.includes("tee") || title.includes("tank")) return false;
    }
    
    // Too hot for heavy layers
    if (weather.tempHigh > 80) {
      if (title.includes("coat") || title.includes("puffer") || title.includes("heavy")) return false;
    }
    
    // Rainy day — remove suede
    if (weather.precipitation > 60) {
      if (title.includes("suede")) return false;
    }
    
    return true;
  });
}

function selectPieces(garments: Garment[]) {
  const tops = garments.filter(g => g.category === "top" || g.category === "outerwear");
  const bottoms = garments.filter(g => g.category === "bottom");
  const shoes = garments.filter(g => g.category === "footwear");

  if (!tops.length || !bottoms.length || !shoes.length) return { top: null, bottom: null, shoe: null };

  const top = tops[Math.floor(Math.random() * tops.length)];
  const bottom = bottoms[Math.floor(Math.random() * bottoms.length)];
  const shoe = shoes[Math.floor(Math.random() * shoes.length)];

  return { top, bottom, shoe };
}


async function scoreOutfit(top: Garment, bottom: Garment, shoe: Garment, weather: Weather): Promise<number> {
  const prompt = `Rate the style coherence of this outfit on a scale of 0 to 1. Consider color harmony, style consistency, and formality matching. Return only a number between 0 and 1, nothing else.

Outfit:
- Top: ${top.title}
- Bottom: ${bottom.title}
- Shoes: ${shoe.title}

Weather context: ${weather.tempHigh}°F high, ${weather.precipitation}% chance of rain.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });

  const score = parseFloat(response.choices[0].message.content || "0");
  return isNaN(score) ? 0 : score;
}

export async function generateOutfit(garments: Garment[], weather: Weather) {
  const filtered = filterByWeather(garments, weather);
  
  let bestOutfit = null;
  let bestScore = 0;

  for (let i = 0; i < 3; i++) {
    const { top, bottom, shoe } = selectPieces(filtered);
    
    if (!top || !bottom || !shoe) continue;
    
    const score = await scoreOutfit(top, bottom, shoe, weather);
    
    if (score > bestScore) {
      bestScore = score;
      bestOutfit = { top, bottom, shoe, score };
    }
    
    if (score >= 0.8) break;
  }

  return bestOutfit;
}



