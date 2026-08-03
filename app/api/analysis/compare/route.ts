import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { userId, itemAId, itemBId, itemAUrl, itemBUrl } = await req.json();

  if (!userId || (!(itemAId || itemAUrl)) || (!(itemBId || itemBUrl))) {
    return NextResponse.json({ error: "userId and two items required" }, { status: 400 });
  }

  const { data: garments } = await adminClient
    .from("garments")
    .select("id, title, category, color_primary, color_secondary, brand, material, fit, image")
    .eq("user_id", userId);

  const wardrobeSummary = (garments ?? [])
    .map(g => [g.title, g.category, g.color_primary, g.brand].filter(Boolean).join(" / "))
    .join("\n");

  const itemA = itemAId ? (garments ?? []).find(g => g.id === itemAId) : null;
  const itemB = itemBId ? (garments ?? []).find(g => g.id === itemBId) : null;

  const descA = itemA
    ? `Item A: ${itemA.title} (${itemA.category}, ${itemA.color_primary}, ${itemA.brand ?? "unknown brand"})`
    : `Item A: [provided via URL: ${itemAUrl}]`;

  const descB = itemB
    ? `Item B: ${itemB.title} (${itemB.category}, ${itemB.color_primary}, ${itemB.brand ?? "unknown brand"})`
    : `Item B: [provided via URL: ${itemBUrl}]`;

  const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  if (itemA?.image) {
    contentParts.push({ type: "image_url", image_url: { url: itemA.image, detail: "low" } });
  }
  if (itemAUrl) {
    contentParts.push({ type: "image_url", image_url: { url: itemAUrl, detail: "low" } });
  }
  if (itemB?.image) {
    contentParts.push({ type: "image_url", image_url: { url: itemB.image, detail: "low" } });
  }
  if (itemBUrl) {
    contentParts.push({ type: "image_url", image_url: { url: itemBUrl, detail: "low" } });
  }

  contentParts.push({
    type: "text",
    text: `Compare these two items for someone with this wardrobe and tell them which to buy.

${descA}
${descB}

WARDROBE (${(garments ?? []).length} items):
${wardrobeSummary || "(empty wardrobe)"}

Return JSON:
{
  "winner": "<exact name of Item A or Item B>",
  "reasoning": "<2-3 sentences explaining why the winner fits this wardrobe better>",
  "winnerPros": ["<specific advantage 1>", "<specific advantage 2>"],
  "loserCons": ["<reason against the other item>"],
  "caveat": "<optional — when the losing item might still make sense, or null>"
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
