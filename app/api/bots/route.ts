import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { generateOutfits } from "@/lib/scoring";
import { BOT_ARCHETYPES, assembleBotWardrobe, type DbProduct } from "@/lib/botGen";
import type { GarmentForScoring } from "@/lib/scoring";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Module-level cache — assembled once per cold start, refreshed every 24h
type BotWardrobe = { archetype: typeof BOT_ARCHETYPES[0]; items: GarmentForScoring[] };
let cachedWardrobes: BotWardrobe[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function getWardrobes(): Promise<BotWardrobe[]> {
  if (cachedWardrobes && Date.now() < cacheExpiry) return cachedWardrobes;

  // Fetch a broad pool of products — prefer analyzed items with known sub_type
  const { data, error } = await adminClient
    .from("streetwear_products")
    .select("id,brand,title,image_url,category,sub_type,color_primary,aesthetic_tags,brand_tier")
    .eq("in_stock", true)
    .not("sub_type", "is", null)
    .limit(2000);

  if (error || !data) {
    console.error("[bots] DB query failed:", error?.message);
    return cachedWardrobes ?? [];
  }

  const pool = data as DbProduct[];
  const wardrobes = BOT_ARCHETYPES.map(archetype => ({
    archetype,
    items: assembleBotWardrobe(archetype, pool),
  }));

  cachedWardrobes = wardrobes;
  cacheExpiry = Date.now() + CACHE_TTL;
  return wardrobes;
}

// GET /api/bots
// Returns all bots with their best outfit score for the bot-select screen.
export async function GET(req: Request) {
  const rateBlock = applyApiRateLimit(req, "bots", 60, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const wardrobes = await getWardrobes();

  const bots = wardrobes.map(({ archetype, items }) => {
    const outfits = generateOutfits(items, { limit: 1, minScore: 0 });
    const bestScore = outfits[0]?.score ?? 0;
    return {
      id: archetype.id,
      name: archetype.name,
      bio: archetype.bio,
      tier: archetype.tier,
      pieceCount: items.length,
      bestOutfitScore: bestScore,
    };
  });

  // Sort by tier then score so the select screen goes low → high
  const TIER_ORDER = { budget: 0, mid: 1, premium: 2, luxury: 3 };
  bots.sort((a, b) => {
    const td = TIER_ORDER[a.tier as keyof typeof TIER_ORDER] - TIER_ORDER[b.tier as keyof typeof TIER_ORDER];
    return td !== 0 ? td : a.bestOutfitScore - b.bestOutfitScore;
  });

  return Response.json({ bots });
}

// POST /api/bots
// Body: { botId: string }
// Returns the bot's best outfit items + score for the battle screen.
export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { botId?: string };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const wardrobes = await getWardrobes();
  const entry = wardrobes.find(w => w.archetype.id === body.botId);
  if (!entry) return Response.json({ error: "Bot not found" }, { status: 404 });

  const outfits = generateOutfits(entry.items, { limit: 3, minScore: 0 });
  const best = outfits[0];
  if (!best) return Response.json({ error: "Bot has no valid outfit" }, { status: 500 });

  return Response.json({
    bot: { id: entry.archetype.id, name: entry.archetype.name, bio: entry.archetype.bio },
    outfit: {
      score: best.score,
      items: best.items.map(i => ({
        id:            i.id,
        title:         i.title,
        sub_type:      i.sub_type,
        brand:         i.brand,
        color_primary: i.color_primary,
        image:         i.image,
      })),
    },
  });
}
