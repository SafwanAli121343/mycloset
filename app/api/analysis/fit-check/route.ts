import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { userId, imageDataUrl, productUrl } = await req.json();

  if (!userId || (!imageDataUrl && !productUrl)) {
    return NextResponse.json({ error: "userId and (imageDataUrl or productUrl) required" }, { status: 400 });
  }

  const { data: garments, error } = await supabase
    .from("garments")
    .select("title, category, color_primary, color_secondary, brand, material, fit")
    .eq("user_id", userId);

  if (error || !garments || garments.length === 0) {
    return NextResponse.json({ error: "No garments found" }, { status: 404 });
  }

  const wardrobeSummary = garments
    .map(g => [g.title, g.category, g.color_primary, g.brand].filter(Boolean).join(" / "))
    .join("\n");

  const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  if (imageDataUrl) {
    contentParts.push({ type: "image_url", image_url: { url: imageDataUrl, detail: "high" } });
  }

  const urlLine = productUrl ? `Product URL: ${productUrl}\n` : "";

  contentParts.push({
    type: "text",
    text: `${urlLine}WARDROBE (${garments.length} items):
${wardrobeSummary}

Based on this wardrobe, assess whether the item shown/linked fits. Return JSON:
{
  "verdict": "YES" | "MAYBE" | "NO",
  "summary": "<one short phrase, e.g. 'Fills a gap in your wardrobe' or 'Too similar to what you have'>",
  "reasoning": "<2-3 sentences with specific references to wardrobe pieces>",
  "pairsWith": ["<existing piece title>", ...],
  "conflicts": ["<existing piece title or style issue>", ...],
  "stylingTip": "<one concrete suggestion for how to wear it with what they own>"
}`,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: contentParts }],
    response_format: { type: "json_object" },
    max_tokens: 400,
  });

  const result = JSON.parse(completion.choices[0].message.content || "{}");
  return NextResponse.json(result);
}
