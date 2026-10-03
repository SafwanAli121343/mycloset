import { aiChat } from "@/lib/aiGateway";
import { getUserProfile, profileSystemMessage } from "@/lib/userAge";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSessionFromCookies } from "@/lib/auth/session";
import OpenAI from "openai";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";


export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "analysis:fitcheck", 10, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  // Unlinked page, but was still POST-reachable and ungated by any logged-in user — a real gap
  // found in the free-tier AI audit.
  const billingUser = await getUserById(userId).catch(() => null);
  if (!billingUser || !resolveEntitlement(billingUser).hasAI) {
    return NextResponse.json({ error: "This feature requires an upgrade.", locked: true }, { status: 402 });
  }
  const consumeResult = await consumeAiCredit(billingUser);
  if (!consumeResult.allowed) {
    return NextResponse.json({ error: consumeErrorMessage(consumeResult.reason), capReached: true }, { status: 429 });
  }

  const { imageDataUrl, productUrl } = await req.json();

  if (!imageDataUrl && !productUrl) {
    return NextResponse.json({ error: "imageDataUrl or productUrl required" }, { status: 400 });
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

  // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
  const userProfile = await getUserProfile(session.userId);
  const completion = await aiChat("openai:chat:fit-check", {
    model: "gpt-4o",
    messages: [...profileSystemMessage(userProfile), { role: "user", content: contentParts }],
    response_format: { type: "json_object" },
    max_tokens: 400,
  }, billingUser);

  const result = JSON.parse(completion.content || "{}");
  return NextResponse.json(result);
}
