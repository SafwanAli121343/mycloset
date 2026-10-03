import { aiChat } from "@/lib/aiGateway";
import { getUserProfile, profileSystemMessage } from "@/lib/userAge";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import OpenAI from "openai";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "analysis:compare", 10, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  // Not currently linked from any UI, but was still POST-reachable and ungated by any logged-in
  // user — closing this defensively now rather than waiting for it to become a real gap the
  // moment this page gets linked, per the free-tier AI audit.
  const billingUser = await getUserById(userId).catch(() => null);
  if (!billingUser || !resolveEntitlement(billingUser).hasAI) {
    return NextResponse.json({ error: "This feature requires an upgrade.", locked: true }, { status: 402 });
  }
  const consumeResult = await consumeAiCredit(billingUser);
  if (!consumeResult.allowed) {
    return NextResponse.json({ error: consumeErrorMessage(consumeResult.reason), capReached: true }, { status: 429 });
  }

  const { itemAId, itemBId, itemAUrl, itemBUrl } = await req.json();

  if ((!(itemAId || itemAUrl)) || (!(itemBId || itemBUrl))) {
    return NextResponse.json({ error: "two items required" }, { status: 400 });
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

  // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
  const userProfile = await getUserProfile(session.userId);
  const completion = await aiChat("openai:chat:analysis-compare", {
    model: "gpt-4o",
    messages: [...profileSystemMessage(userProfile), { role: "user", content: contentParts }],
    response_format: { type: "json_object" },
    max_tokens: 400,
  }, billingUser);

  const result = JSON.parse(completion.content || "{}");
  return NextResponse.json(result);
}
