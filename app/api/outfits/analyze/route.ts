// POST /api/outfits/analyze
// Body: { outfitId: string }   — re-analyze a single saved outfit
//       { year: number, month: number } — batch-analyze all outfits for that month
//
// Calls GPT-4o for pros/cons/tags and merges results into the outfit's notes JSON.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { analyzeOutfit, deriveOutfitAesthetic } from "@/lib/outfitInference";
import type { GarmentForScoring } from "@/lib/scoring";
import { getUserById, type User } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit } from "@/lib/billing/entitlements";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type OutfitRow = {
  id: string;
  notes: string | null;
  outfit_items: { garments: GarmentForScoring | GarmentForScoring[] | null }[];
};

async function analyzeAndPersist(outfit: OutfitRow, billingUser: User): Promise<{ id: string; ok: boolean; error?: string }> {
  const items = outfit.outfit_items
    .flatMap(oi => {
      const g = oi.garments;
      if (!g) return [];
      return Array.isArray(g) ? g : [g];
    })
    .filter((g): g is GarmentForScoring => g != null && typeof g === "object" && "id" in g);

  if (items.length === 0) return { id: outfit.id, ok: false, error: "no garments" };

  let existingNotes: Record<string, unknown> = {};
  try { existingNotes = JSON.parse(outfit.notes ?? "{}"); } catch {}

  const score     = typeof existingNotes.styleScore === "number" ? existingNotes.styleScore : 50;
  const config    = typeof existingNotes.configName === "string"  ? existingNotes.configName  : "outfit";
  const aesthetic = deriveOutfitAesthetic(items);

  // billingUser carries the user id — lets analyzeOutfit apply their age (lib/userAge.ts).
  const result = await analyzeOutfit(items, { score, configName: config, aesthetic }, billingUser);

  const updatedNotes = JSON.stringify({
    ...existingNotes,
    pros:        result.pros,
    cons:        result.cons,
    outfit_tags: result.outfit_tags,
  });

  const { error } = await adminClient
    .from("outfits")
    .update({ notes: updatedNotes })
    .eq("id", outfit.id);

  if (error) return { id: outfit.id, ok: false, error: "Save failed." };
  return { id: outfit.id, ok: true };
}

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "outfits:analyze", 1000, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same AI entitlement gate every other OpenAI-backed route applies (see
  // /api/garments/analyze): free/lapsed users, and Pro users over their monthly cap, never
  // trigger a paid model call. This endpoint had no gate at all — only a rate limit.
  const billingUser = await getUserById(session.userId).catch(() => null);
  const ent = billingUser ? resolveEntitlement(billingUser) : null;
  const aiAllowed = !!ent?.hasAI && (ent.tier !== "pro" || (await consumeAiCredit(billingUser!)).allowed);
  if (!aiAllowed) return NextResponse.json({ error: "AI analysis requires MyCloset Pro." }, { status: 403 });

  const body = await req.json() as { outfitId?: string; year?: number; month?: number };

  // Single outfit mode
  if (body.outfitId) {
    const { data, error } = await adminClient
      .from("outfits")
      .select(`id, notes, outfit_items (
        garments ( id, title, brand, sub_type, material, color_primary, color_secondary,
                   pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image )
      )`)
      .eq("id", body.outfitId)
      .eq("user_id", session.userId)
      .single();

    if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await analyzeAndPersist(data as unknown as OutfitRow, billingUser!);
    return NextResponse.json(result);
  }

  // Month batch mode
  if (body.year && body.month) {
    const pad  = (n: number) => String(n).padStart(2, "0");
    const last = new Date(body.year, body.month, 0).getDate();
    const start = `${body.year}-${pad(body.month)}-01`;
    const end   = `${body.year}-${pad(body.month)}-${pad(last)}`;

    const { data, error } = await adminClient
      .from("outfits")
      .select(`id, notes, outfit_items (
        garments ( id, title, brand, sub_type, material, color_primary, color_secondary,
                   pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image )
      )`)
      .eq("user_id", session.userId)
      .gte("date", start)
      .lte("date", end);

    if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

    const results = [];
    for (const outfit of (data ?? []) as unknown as OutfitRow[]) {
      try {
        results.push(await analyzeAndPersist(outfit, billingUser!));
      } catch (err) {
        results.push({ id: outfit.id, ok: false, error: (err as Error).message });
      }
    }

    const ok  = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    return NextResponse.json({ ok, fail, results });
  }

  return NextResponse.json({ error: "Provide outfitId OR year+month" }, { status: 400 });
}
