import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import OpenAI from "openai";

export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// POST /api/wardrobe/apply-item-impact
// Called immediately after an item is added to update the WA cache.
// GPT-4o looks at the item image + current analysis and returns what changed.
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    item: {
      title: string;
      sub_type?: string | null;
      category?: string | null;
      color_primary?: string | null;
      aesthetic_tags?: string[] | null;
      image?: string | null;
    };
    analysis: {
      score: number;
      gaps: Array<{ description: string; impact: string; reason: string }>;
      cons: string[];
      colors: { missing: string[] };
      aesthetics: { missing: string[] };
    };
  };

  const { item, analysis } = body;
  if (!item || !analysis) return NextResponse.json({ error: "Missing item or analysis" }, { status: 400 });

  const gapList = analysis.gaps
    .map((g, i) => `[${i}] "${g.description}" (${g.impact}): ${g.reason}`)
    .join("\n");
  const conList = analysis.cons
    .map((c, i) => `[${i}] ${c}`)
    .join("\n");

  const prompt = `A new item was just added to this wardrobe. Determine exactly what it fixes.

Item: ${item.title}${item.sub_type ? ` (${item.sub_type})` : ""}${item.category ? ` — category: ${item.category}` : ""}${item.color_primary ? `, color: ${item.color_primary}` : ""}${item.aesthetic_tags?.length ? `, aesthetics: ${item.aesthetic_tags.join(", ")}` : ""}

CURRENT GAPS (things the wardrobe is missing):
${gapList || "none"}

CURRENT WEAKNESSES:
${conList || "none"}

MISSING COLORS: ${analysis.colors.missing.join(", ") || "none"}
MISSING AESTHETICS: ${analysis.aesthetics.missing.join(", ") || "none"}
CURRENT SCORE: ${analysis.score}/100

Return ONLY valid JSON:
{
  "fills_gaps": ["exact gap description strings from the list above that this item fills"],
  "addresses_cons": [indices of weaknesses this item directly resolves or makes outdated],
  "adds_colors": ["colors from the missing list that this item provides"],
  "adds_aesthetics": ["aesthetics from the missing list that this item adds"],
  "score_delta": <integer 0-15, estimated score points this item adds>
}

Be strict: only mark a gap filled if the item genuinely covers that need. A duster coat fills "heavy outerwear". It does NOT fill "structured outerwear" (which requires a blazer/sport coat).`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: item.image
        ? [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: item.image, detail: "low" } },
          ]
        : prompt,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    response_format: { type: "json_object" },
    max_tokens: 300,
    temperature: 0.1,
  });

  let result: {
    fills_gaps?: string[];
    addresses_cons?: number[];
    adds_colors?: string[];
    adds_aesthetics?: string[];
    score_delta?: number;
  } = {};
  try {
    result = JSON.parse(completion.choices[0].message.content ?? "{}");
  } catch { /* return empty result */ }

  return NextResponse.json({
    fillsGaps:       result.fills_gaps       ?? [],
    addressesCons:   result.addresses_cons   ?? [],
    addsColors:      result.adds_colors      ?? [],
    addsAesthetics:  result.adds_aesthetics  ?? [],
    scoreDelta:      result.score_delta      ?? 0,
  });
}
