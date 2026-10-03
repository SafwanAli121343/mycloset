// POST /api/outfits/combo-analysis { combos: string[][] } → { results: { [comboKey]: { pros, cons,
//   outfit_tags } }, failed: string[], capReached: boolean }
// Pro only. Analyzes the given outfits on the Outfits page — the first screenful / first "Show
// more" in one batch, or a single outfit when it's opened. Reuses any stored analysis that still
// matches (lib/outfitAnalysisStore.ts); only outfits that actually exist in the user's ranking
// (and score high enough to show a score at all) are accepted, so this can't be used to analyze
// arbitrary combinations.
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";
import { rankUserOutfits, analyzeCombos, getValidAnalyses, comboKey, IDEAL_THRESHOLD, type ComboEntry } from "@/lib/outfitAnalysisStore";

export const maxDuration = 120;
const MAX_COMBOS = 40;

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "outfits:combo-analysis", 60, 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.userId).catch(() => null);
  if (!user || !resolveEntitlement(user).hasAI) {
    return NextResponse.json({ error: "Outfit scores are part of MyCloset Pro.", locked: true }, { status: 403 });
  }
  const pre = await consumeAiCredit(user);

  const body = await req.json().catch(() => null) as { combos?: unknown } | null;
  const requested = Array.isArray(body?.combos)
    ? body!.combos.filter((c): c is string[] => Array.isArray(c) && c.every(x => typeof x === "string")).slice(0, MAX_COMBOS)
    : [];
  if (!requested.length) return NextResponse.json({ results: {}, failed: [], capReached: false });

  const { ranked } = await rankUserOutfits(session.userId);
  const byKey = new Map(ranked.map(r => [comboKey(r.items.map(i => i.id)), r]));
  const entries: ComboEntry[] = [];
  const failed: string[] = [];
  for (const ids of requested) {
    const key = comboKey(ids);
    const r = byKey.get(key);
    if (r && r.score >= IDEAL_THRESHOLD) entries.push({ key, items: r.items, score: r.score });
    else failed.push(key); // outfit no longer exists (piece deleted/edited) or has no score to show
  }

  // Already over this month's budget: return whatever is stored, analyze nothing new.
  const out = pre.allowed
    ? await analyzeCombos(user, entries)
    : await getValidAnalyses(session.userId, entries).then(results => ({
        results, failed: entries.filter(e => !results.has(e.key)).map(e => e.key), capReached: true,
      }));
  return NextResponse.json({
    results: Object.fromEntries(out.results),
    failed: [...failed, ...out.failed],
    capReached: out.capReached,
    ...(out.capReached ? { message: consumeErrorMessage("cap_reached") } : {}),
  });
}
