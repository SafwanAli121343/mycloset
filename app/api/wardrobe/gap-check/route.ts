import { aiChat } from "@/lib/aiGateway";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit } from "@/lib/billing/entitlements";

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


export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "wardrobe:gap", 30, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Was ungated for any logged-in user — fired automatically after saving/previewing an item
  // (native lib/wardrobeCrossing.ts, lib/wardrobeImpact.ts) with no entitlement check at all.
  // Matching an item's image against described wardrobe gaps genuinely needs vision, so there's
  // no non-AI substitute here (unlike garments/pairings' color/aesthetic fallback) — free tier
  // just gets the same empty-result shape this route already returns on any other failure, which
  // every caller already has to handle gracefully.
  const billingUser = await getUserById(session.userId).catch(() => null);
  const ent = billingUser ? resolveEntitlement(billingUser) : null;
  // A Pro user over their own monthly $ cap gets the same empty-result fallback as free tier —
  // this fires automatically after every save/preview with no button of its own, so there's
  // nothing interactive to show a red error for here specifically (unlike Wardrobe analysis).
  const aiAllowed = !!ent?.hasAI && (ent.tier !== "pro" || (await consumeAiCredit(billingUser!)).allowed);
  if (!aiAllowed) {
    return NextResponse.json({ gap_fills: [], aesthetic_fills: [], color_fills: [], weakness_fills: [], fills: [] });
  }

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

  const prompt = `${context}\n\n${sections.join("\n\n")}\n\nLook at the item in the image. For each section, return which entries this item fills/addresses.\n\nColor matching rule: use broad family/shade matching, not exact names. A beige, tan, or khaki item fills both "Camel" and "Cream" gaps. A wine or maroon item fills "Burgundy". A moss, army-green, or plain green item fills "Olive" (olive is a muted shade of green, not a distinct hue). A midnight-blue item fills "Navy". Ask yourself: is this item's color close enough in shade/tone to the gap color that a stylist would call them the same color family? If yes, it fills the gap — match on shade similarity, not literal name equality.\n\nReturn ONLY JSON with these keys (use exact text from each list, empty array if none):\n{\n  "gap_fills": [],\n  "aesthetic_fills": [],\n  "color_fills": [],\n  "weakness_fills": []\n}`;

  try {
    const completion = await aiChat("openai:chat:gap-check", {
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
    }, billingUser!);


    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(completion.content ?? "{}"); } catch { /* ignore */ }

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
