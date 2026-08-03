import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { scorePiece, scoreWardrobe, generateOutfits } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SELECT_COLS = [
  "id","title","brand","sub_type","material","color_primary","color_secondary",
  "pattern","formality","aesthetic_tags","pros","cons","color_pairings","color_clashes","tags","image",
].join(",");

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await adminClient
    .from("garments")
    .select(SELECT_COLS)
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const garments = (data ?? []) as unknown as GarmentForScoring[];

  const wardrobeScore = scoreWardrobe(garments);

  const pieces = garments.map(g => ({
    id: g.id,
    title: g.title,
    image: g.image,
    score: scorePiece(g),
    sub_type: g.sub_type,
    brand: g.brand,
  }));

  const rawOutfits = generateOutfits(garments, { limit: 20, minScore: 50 });

  const topOutfits = rawOutfits.map(o => ({
    score: o.score,
    items: o.items.map(item => ({
      id: item.id,
      title: item.title,
      image: item.image,
      sub_type: item.sub_type,
    })),
  }));

  return Response.json({
    wardrobeScore,
    pieceCount: garments.length,
    pieces,
    topOutfits,
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

  // Only score this endpoint's own garments (outfit scoring for the game)
  // This is handled by /api/scoring/outfit — but we include it here as POST fallback
  const { data, error } = await adminClient
    .from("garments")
    .select(SELECT_COLS)
    .eq("user_id", session.userId)
    .in("id", garmentIds);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const garments = (data ?? []) as unknown as GarmentForScoring[];
  const { scoreOutfit } = await import("@/lib/scoring");
  const score = scoreOutfit(garments);

  return Response.json({ score });
}
