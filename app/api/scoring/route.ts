import { getSessionFromCookies } from "@/lib/auth/session";
import { compressedJson } from "@/lib/http/compressedJson";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { scorePiece, scoreWardrobe, generateOutfits } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SELECT_COLS = [
  "id","title","brand","category","sub_type","material","color_primary","color_secondary",
  "pattern","formality","aesthetic_tags","pros","cons","color_pairings","color_clashes","tags","image",
].join(",");

// Scores are AI-tier output: Pro sees all of them; on the free tier only an item unlocked with a
// purchased score ("Use score?") has its score, and the wardrobe-level numbers only come with a
// purchased Wardrobe report. Before, every score was sent to everyone and only hidden by the apps.
async function scoreAccess(userId: string): Promise<{ hasAI: boolean; purchasedReport: boolean; unlocked: Set<string>; manualAes: Set<string> }> {
  const [user, { data: state }, { data: flags }] = await Promise.all([
    getUserById(userId).catch(() => null),
    adminClient.from("wardrobe_analysis_state").select("purchased").eq("user_id", userId).maybeSingle(),
    adminClient.from("garments").select("id, ai_unlocked, aesthetic_source").eq("user_id", userId),
  ]);
  const rows = (flags ?? []) as { id: string; ai_unlocked?: boolean; aesthetic_source?: string | null }[];
  return {
    hasAI: !!user && resolveEntitlement(user).hasAI,
    purchasedReport: !!(state as { purchased?: boolean } | null)?.purchased,
    unlocked: new Set(rows.filter(r => r.ai_unlocked).map(r => r.id)),
    manualAes: new Set(rows.filter(r => r.aesthetic_source === "manual").map(r => r.id)),
  };
}

export async function GET(req: Request) {
  const rateBlock = applyApiRateLimit(req, "scoring", 300, 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const testIdsParam = url.searchParams.get("testIds");
  const testIds = testIdsParam ? testIdsParam.split(",").map(s => s.trim()).filter(Boolean) : null;
  // topOutfits is only ever consumed by the website's /battle page (checked: no other caller
  // reads it) — but generateOutfits() runs a combinatorial search over the whole wardrobe to
  // build it, by far the most expensive part of this route. Every native screen (Closet,
  // Wardrobe) calls this same endpoint purely for per-item `pieces` scores and was paying that
  // full cost every time for a field it immediately threw away — the real cause of scores
  // visibly taking multiple seconds to show up. skipOutfits lets a caller that doesn't need
  // topOutfits opt out of computing it; omitting the param keeps existing callers (battle page)
  // getting exactly what they got before.
  const skipOutfits = url.searchParams.get("skipOutfits") === "1";

  let query = adminClient.from("garments").select(SELECT_COLS).eq("user_id", session.userId);
  if (testIds?.length) query = query.in("id", testIds);
  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) return Response.json({ error: "Something went wrong." }, { status: 500 });

  const garments = (data ?? []) as unknown as GarmentForScoring[];
  const access = await scoreAccess(session.userId);
  const wardrobeLevel = access.hasAI || access.purchasedReport;

  const wardrobeScore = wardrobeLevel ? scoreWardrobe(garments) : null;

  const pieces = garments.map(g => ({
    id: g.id,
    title: g.title,
    image: g.image,
    score: access.hasAI || access.unlocked.has(g.id) ? scorePiece(g) : null,
    sub_type: g.sub_type,
    brand: g.brand,
  }));

  const topOutfits = skipOutfits || !access.hasAI ? [] : generateOutfits(garments, { limit: 20, minScore: 50 }).map(o => ({
    score: o.score,
    items: o.items.map(item => ({
      id: item.id,
      title: item.title,
      image: item.image,
      sub_type: item.sub_type,
    })),
  }));

  const garmentAttrs = (data as unknown as Record<string, unknown>[]).map(g => ({
    id:             g.id             as string,
    sub_type:       g.sub_type       as string | null,
    category:       g.category       as string | null,
    color_primary:  g.color_primary  as string | null,
    // AI-inferred aesthetics need Pro, a purchased report (its crossings use them) or an
    // unlocked item; a manually picked aesthetic is the user's own data and always included.
    aesthetic_tags: wardrobeLevel || access.unlocked.has(g.id as string) || access.manualAes.has(g.id as string)
      ? g.aesthetic_tags as string[] | null : null,
  }));

  return compressedJson(req, {
    wardrobeScore,
    pieceCount: garments.length,
    pieces,
    topOutfits,
    garmentAttrs,
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { garmentIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { garmentIds } = body;
  if (!Array.isArray(garmentIds) || garmentIds.length === 0) {
    return Response.json({ error: "garmentIds array required" }, { status: 400 });
  }

  if (!(await scoreAccess(session.userId)).hasAI) return Response.json({ score: null, locked: true });

  // Only score this endpoint's own garments (outfit scoring for the game)
  // This is handled by /api/scoring/outfit — but we include it here as POST fallback
  const { data, error } = await adminClient
    .from("garments")
    .select(SELECT_COLS)
    .eq("user_id", session.userId)
    .in("id", garmentIds);

  if (error) return Response.json({ error: "Something went wrong." }, { status: 500 });

  const garments = (data ?? []) as unknown as GarmentForScoring[];
  const { scoreOutfit } = await import("@/lib/scoring");
  const score = scoreOutfit(garments);

  return Response.json({ score });
}
