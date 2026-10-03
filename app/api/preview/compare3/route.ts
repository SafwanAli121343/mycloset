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
  const rateBlock = applyApiRateLimit(req, "preview:compare3", 10, 3600000);
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

  let body: { a?: ItemDesc; b?: ItemDesc; c?: ItemDesc };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { a, b, c } = body;
  if (!a || !b || !c) return NextResponse.json({ error: "a, b, and c required" }, { status: 400 });

  const desc = (r: ItemDesc, label: string) =>
    `${label}: ${r.title} (${r.category ?? "?"}/${r.sub_type ?? "?"})
  Formality: ${r.formality ?? "?"} | Color: ${r.color_primary ?? "?"}
  Aesthetics: ${(r.aesthetic_tags ?? []).join(", ") || "none"}
  Strengths: ${(r.pros ?? []).join("; ") || "none"}
  Weaknesses: ${(r.cons ?? []).join("; ") || "none"}`;

  const [nameA, nameB, nameC] = [a.title ?? "Item A", b.title ?? "Item B", c.title ?? "Item C"];

  const prompt = `You are a fashion stylist comparing three clothing items for a wardrobe app.

${desc(a, nameA)}

${desc(b, nameB)}

${desc(c, nameC)}

Compare these three items RELATIVE TO EACH OTHER. Every point must be genuinely comparative — never generic, never vague. Consider: silhouette, color versatility, formality range, seasonal range, styling adaptability, and aesthetic direction.

CRITICAL RULES:
- Always refer to items by their exact names ("${nameA}", "${nameB}", "${nameC}"), never as "A", "B", "C", or "this item".
- When citing an advantage or weakness, name the item(s) you're comparing against.
- Do not infer a weakness just because a feature wasn't listed — only flag genuine gaps.
- Each point must be one sharp, specific sentence.

For each item, determine what it does better and worse than the other two combined.

- BETTER_A: 2–3 specific advantages "${nameA}" has over "${nameB}" and "${nameC}".
- WORSE_A: 2–3 specific disadvantages "${nameA}" has compared to "${nameB}" and "${nameC}".
- BETTER_B: 2–3 specific advantages "${nameB}" has over "${nameA}" and "${nameC}".
- WORSE_B: 2–3 specific disadvantages "${nameB}" has compared to "${nameA}" and "${nameC}".
- BETTER_C: 2–3 specific advantages "${nameC}" has over "${nameA}" and "${nameB}".
- WORSE_C: 2–3 specific disadvantages "${nameC}" has compared to "${nameA}" and "${nameB}".

For SIMILARITIES and DIFFERENCES, write them per-item — each point must name which specific item the comparison is drawn against:
- SIMS_A: 2–3 specific ways "${nameA}" resembles "${nameB}" or "${nameC}" — always name which one (e.g. "shares a relaxed fit with ${nameB}", "same color direction as ${nameC}").
- DIFFS_A: 2–3 key ways "${nameA}" differs from "${nameB}" or "${nameC}" — name the contrast explicitly (e.g. "unlike ${nameB}'s tailored cut, ${nameA} has a boxy silhouette").
- SIMS_B: 2–3 ways "${nameB}" resembles "${nameA}" or "${nameC}" — name which one.
- DIFFS_B: 2–3 ways "${nameB}" differs from "${nameA}" or "${nameC}" — name the contrast.
- SIMS_C: 2–3 ways "${nameC}" resembles "${nameA}" or "${nameB}" — name which one.
- DIFFS_C: 2–3 ways "${nameC}" differs from "${nameA}" or "${nameB}" — name the contrast.

Output ONLY valid JSON:
{
  "better_a": [],
  "worse_a": [],
  "better_b": [],
  "worse_b": [],
  "better_c": [],
  "worse_c": [],
  "sims_a": [],
  "diffs_a": [],
  "sims_b": [],
  "diffs_b": [],
  "sims_c": [],
  "diffs_c": []
}`;

  try {
    // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
    const userProfile = await getUserProfile(session.userId);
    const completion = await aiChat("openai:chat:compare3", {
      model: "gpt-4o",
      messages: [...profileSystemMessage(userProfile), { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1500,
    }, billingUser);

    const txt = completion.content ?? "{}";
    const result = JSON.parse(txt);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[preview/compare3]", err);
    return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
  }
}
