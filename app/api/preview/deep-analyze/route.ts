import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { inferGarmentAttributes } from "@/lib/aiInference";
import { aiErrorMessage } from "@/lib/aiGateway";
import { getUserById } from "@/lib/db/users";
import { consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";

export const maxDuration = 30;

// POST /api/preview/deep-analyze
// Body: { title, brand, category, color_primary, material, fit, image }
// Returns: { sub_type, aesthetic_tags, pros, cons, color_pairings, color_clashes, formality }
export async function POST(req: NextRequest) {
  // Only a runaway-loop ceiling: AI spending is limited by the $5/month Pro cap (lib/aiGateway.ts),
  // not by request counts — 10/hour here made Preview fail after a few tries.
  const rateBlock = applyApiRateLimit(req, "preview:deep", 1000, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    title?: string; brand?: string; category?: string;
    color_primary?: string; material?: string; fit?: string; image?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { title, brand, category, color_primary, material, fit, image } = body;
  if (!title || !category || !image) {
    return NextResponse.json({ error: "title, category, and image required" }, { status: 400 });
  }

  // Free/lapsed tier with no leftover purchased credits: Preview stays barebones — the client
  // falls back to its own non-AI color-pairing logic (lib/colorTheory.ts) for the PAIRINGS
  // card, and every other card is empty rather than this endpoint being called at all in
  // spirit; it's still gated here too since a client can't be trusted to self-enforce this.
  // A Pro user hitting their OWN monthly cap is different — silently returning empty data here
  // would look like the item just has no pros/cons, when really they've hit a limit they don't
  // know about. Only that specific case (reason === "cap_reached") gets a real error back.
  const billingUser = await getUserById(session.userId).catch(() => null);
  const result = billingUser ? await consumeAiCredit(billingUser) : { allowed: false as const, reason: "no_credits" as const };
  if (!result.allowed) {
    if (result.reason === "cap_reached") {
      return NextResponse.json({ error: consumeErrorMessage(result.reason), capReached: true }, { status: 429 });
    }
    return NextResponse.json({
      sub_type: null, aesthetic_tags: [], pros: [], cons: [],
      color_pairings: [], color_clashes: [], formality: null, pattern: null,
    });
  }

  const FIELDS = ["sub_type", "aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "pattern"];

  try {
    const result = await inferGarmentAttributes(
      {
        title,
        category,
        subType: null,
        brand: brand ?? null,
        colorPrimary: color_primary ?? null,
        fit: fit ?? null,
        material: material ?? null,
        image,
      },
      FIELDS,
      billingUser!, // result.allowed above ⇒ billingUser is set
    );
    return NextResponse.json(result.values);
  } catch (err) {
    const msg = aiErrorMessage(err);
    if (msg) return NextResponse.json({ error: msg, capReached: true }, { status: 429 });
    console.error("[preview/deep-analyze]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
