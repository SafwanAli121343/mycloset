import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import OpenAI from "openai";

// POST /api/wardrobe/gap-check
// Body: {
//   sub_type?, category?, image,
//   gap_descriptions?:   string[]  — structural piece-type gaps
//   aesthetic_gaps?:     string[]  — missing aesthetic styles
//   color_gaps?:         string[]  — missing colors
//   weakness_gaps?:      string[]  — wardrobe weakness/con strings
// }
// Returns: { gap_fills, aesthetic_fills, color_fills, weakness_fills }

export const maxDuration = 20;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    sub_type?: string | null;
    category?: string | null;
    image?: string | null;
    gap_descriptions?: string[];
    aesthetic_gaps?: string[];
    color_gaps?: string[];
    weakness_gaps?: string[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { sub_type, category, image } = body;
  const gap_descriptions = body.gap_descriptions ?? [];
  const aesthetic_gaps   = body.aesthetic_gaps   ?? [];
  const color_gaps       = body.color_gaps       ?? [];
  const weakness_gaps    = body.weakness_gaps    ?? [];

  if (!image) return NextResponse.json({ gap_fills: [], aesthetic_fills: [], color_fills: [], weakness_fills: [] });

  const hasAnything = gap_descriptions.length || aesthetic_gaps.length || color_gaps.length || weakness_gaps.length;
  if (!hasAnything) return NextResponse.json({ gap_fills: [], aesthetic_fills: [], color_fills: [], weakness_fills: [] });

  const context = [
    sub_type && `Type: ${sub_type}`,
    category && `Category: ${category}`,
  ].filter(Boolean).join(" | ");

  const sections: string[] = [];
  if (gap_descriptions.length) {
    sections.push(`STRUCTURAL GAPS (piece types missing from wardrobe):\n${gap_descriptions.map((g,i)=>`${i+1}. ${g}`).join("\n")}`);
  }
  if (aesthetic_gaps.length) {
    sections.push(`MISSING AESTHETIC STYLES (fashion aesthetics not represented):\n${aesthetic_gaps.map((g,i)=>`${i+1}. ${g}`).join("\n")}`);
  }
  if (color_gaps.length) {
    sections.push(`MISSING COLORS (colors not in wardrobe):\n${color_gaps.map((g,i)=>`${i+1}. ${g}`).join("\n")}`);
  }
  if (weakness_gaps.length) {
    sections.push(`WARDROBE WEAKNESSES (qualitative issues to address):\n${weakness_gaps.map((g,i)=>`${i+1}. ${g}`).join("\n")}`);
  }

  const prompt = `${context}\n\n${sections.join("\n\n")}\n\nLook at the item in the image. For each section, return which entries this item fills/addresses.\nReturn ONLY JSON with these keys (use exact text from each list, empty array if none):\n{\n  "gap_fills": [],\n  "aesthetic_fills": [],\n  "color_fills": [],\n  "weakness_fills": []\n}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image, detail: "low" } },
            { type: "text", text: prompt },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0,
    });

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(completion.choices[0].message.content ?? "{}"); } catch { /* ignore */ }

    function extractArr(key: string, valid: Set<string>): string[] {
      const raw = parsed[key];
      if (!Array.isArray(raw)) return [];
      return (raw as string[]).filter(f => typeof f === "string" && valid.has(f));
    }

    return NextResponse.json({
      gap_fills:      extractArr("gap_fills",      new Set(gap_descriptions)),
      aesthetic_fills:extractArr("aesthetic_fills", new Set(aesthetic_gaps)),
      color_fills:    extractArr("color_fills",     new Set(color_gaps)),
      weakness_fills: extractArr("weakness_fills",  new Set(weakness_gaps)),
      // Legacy compat: merge all into `fills` for any old callers
      fills: [
        ...extractArr("gap_fills",       new Set(gap_descriptions)),
        ...extractArr("aesthetic_fills",  new Set(aesthetic_gaps)),
        ...extractArr("color_fills",      new Set(color_gaps)),
        ...extractArr("weakness_fills",   new Set(weakness_gaps)),
      ],
    });
  } catch (err) {
    console.error("[wardrobe/gap-check]", err);
    return NextResponse.json({ gap_fills: [], aesthetic_fills: [], color_fills: [], weakness_fills: [], fills: [] });
  }
}
