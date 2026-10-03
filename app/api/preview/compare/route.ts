import { aiChat } from "@/lib/aiGateway";
import { getUserProfile, profileSystemMessage } from "@/lib/userAge";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";

export const maxDuration = 30;


type ItemDesc = {
  title: string;
  category: string | null;
  sub_type: string | null;
  color_primary: string | null;
  formality: string | null;
  aesthetic_tags: string[] | null;
  pros: string[] | null;
  cons: string[] | null;
};

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "preview:compare", 10, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const billingUser = await getUserById(session.userId).catch(() => null);
  if (!billingUser || !resolveEntitlement(billingUser).hasAI) {
    return NextResponse.json({ error: "AI comparison requires an upgrade.", locked: true }, { status: 402 });
  }
  const consumeResult = await consumeAiCredit(billingUser);
  if (!consumeResult.allowed) {
    return NextResponse.json({ error: consumeErrorMessage(consumeResult.reason), capReached: true }, { status: 429 });
  }

  let body: { a?: ItemDesc; b?: ItemDesc };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { a, b } = body;
  if (!a || !b) return NextResponse.json({ error: "a and b required" }, { status: 400 });

  const desc = (r: ItemDesc, label: string) =>
    `${label}: ${r.title} (${r.category ?? "?"}/${r.sub_type ?? "?"})
  Formality: ${r.formality ?? "?"} | Color: ${r.color_primary ?? "?"}
  Aesthetics: ${(r.aesthetic_tags ?? []).join(", ") || "none"}
  Strengths: ${(r.pros ?? []).join("; ") || "none"}
  Weaknesses: ${(r.cons ?? []).join("; ") || "none"}`;

  const nameA = a.title ?? "this item";
  const nameB = b.title ?? "the other item";

  const prompt = `You are a fashion stylist comparing two clothing items for a wardrobe app.

${desc(a, nameA)}

${desc(b, nameB)}

Compare these two items RELATIVE TO EACH OTHER. Every point must be genuinely comparative.

IMPORTANT: Always refer to items by their actual names ("${nameA}" and "${nameB}"), never as "A", "B", "Item A", or "Item B". Write as if explaining to a person who knows both items by name.

- BETTER_A: what "${nameA}" does meaningfully better than "${nameB}" (2–3 points max). Only cite an advantage if "${nameB}"'s data actually suggests it is weaker there — do not infer absence of a feature just because it wasn't listed.
- WORSE_A: what "${nameA}" does meaningfully worse than "${nameB}" (2–3 points max). Same rule.
- BETTER_B: what "${nameB}" does meaningfully better than "${nameA}" (2–3 points max)
- WORSE_B: what "${nameB}" does meaningfully worse than "${nameA}" (2–3 points max)
- SIMILARITIES: genuine shared traits — aesthetics, formality, styling context, care requirements (2–3 points)
- DIFFERENCES: distinctions that matter when choosing between them — seasonal use, silhouette, color versatility, styling range (2–3 points)

Keep each point to one concise sentence. Output ONLY valid JSON.

{
  "better_a": [],
  "worse_a": [],
  "better_b": [],
  "worse_b": [],
  "similarities": [],
  "differences": []
}`;

  try {
    // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
    const userProfile = await getUserProfile(session.userId);
    const completion = await aiChat("openai:chat:compare", {
      model: "gpt-4o",
      messages: [...profileSystemMessage(userProfile), { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    }, billingUser);

    const txt = completion.content ?? "{}";
    const result = JSON.parse(txt);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[preview/compare]", err);
    return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
  }
}
