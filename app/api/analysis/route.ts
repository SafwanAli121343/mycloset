import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSessionFromCookies } from "@/lib/auth/session";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: NextRequest) {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.userId;

    const { data: garments, error } = await supabase
        .from("garments")
        .select("id, title, category, brand, price, sub_type, color_primary, color_secondary, material, aesthetic_tags")
        .eq("user_id", userId);
    
    if (error || !garments || garments.length == 0){
        return NextResponse.json({ error: "No garments found" }, { status: 404 });
    }

    const garmentList = garments
        .map((g, i) => `${i + 1}. ID: ${g.id} | Title: ${g.title} | Category: ${g.category} | Price: ${g.price}`)
        .join("\n");

    const prompt = `You are a professional fashion stylist and wardrobe consultant. Analyze this wardrobe and provide detailed, honest critique.

WARDROBE:
${garmentList}

Return a JSON object with this exact structure:
{
  "overallScore": <number 0-100>,
  "overallCritique": "<2-3 sentence honest fashion assessment>",
  "brandAnalysis": "<assessment of brand diversity or overrepresentation>",
  "colorAnalysis": "<assessment of color palette, gaps, and balance>",
  "coordinationAnalysis": "<how well pieces work together>",
  "styleConsistency": "<is there a coherent style identity or is it scattered>",
  "pieces": [
    {
      "id": "<garment id>",
      "brand": "<extracted brand or Unknown>",
      "color": "<primary color>",
      "itemType": "<specific type e.g. hoodie, straight-leg jeans, chelsea boots>",
      "strengths": ["<strength 1>", "<strength 2>"],
      "weaknesses": ["<weakness 1>", "<weakness 2>"],
      "coordinatesWith": ["<garment id that pairs well>"],
      "missingPartners": ["<piece type needed to complete this item>"]
    }
  ],
  "gaps": [
    {
      "priority": <1-5, 1 being most urgent>,
      "gap": "<what is missing>",
      "why": "<why this matters for the wardrobe>",
      "recommendation": "<specific piece type to buy with style and color guidance>"
    }
  ]
}

Be specific and brutally honest. Reference actual piece names when relevant.`;

     const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    const analysis = JSON.parse(completion.choices[0].message.content || "{}");

    return NextResponse.json({ analysis, garments });
        
}