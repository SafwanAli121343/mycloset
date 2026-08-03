// GET /api/outfits/gallery
// Returns all calendar outfits, deduped by garment set, with parsed pros/cons/score.
// Used by the generate page's visual stack gallery.

import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type DbGarment = {
  id: string;
  title: string | null;
  image: string | null;
  sub_type: string | null;
  category: string | null;
  color_primary: string | null;
};

type DbOutfit = {
  id: string;
  date: string | null;
  notes: string | null;
  outfit_items: { garments: DbGarment | null }[];
};

function parseNotes(notes: string | null) {
  try {
    const p = JSON.parse(notes ?? "{}") as Record<string, unknown>;
    return {
      score:     typeof p.styleScore === "number" ? p.styleScore : null,
      pros:      Array.isArray(p.pros)            ? (p.pros as string[])        : [],
      cons:      Array.isArray(p.cons)            ? (p.cons as string[])        : [],
      aesthetic: typeof p.aesthetic === "string"  ? p.aesthetic                 : null,
    };
  } catch {
    return { score: null, pros: [], cons: [], aesthetic: null };
  }
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await adminClient
    .from("outfits")
    .select(`
      id, date, notes,
      outfit_items (
        garments ( id, title, image, sub_type, category, color_primary )
      )
    `)
    .eq("user_id", session.userId)
    .order("date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = (data as unknown as DbOutfit[])
    .map(o => {
      const items = o.outfit_items
        .map(oi => oi.garments)
        .filter((g): g is DbGarment => g != null);
      if (items.length === 0) return null;

      const parsed = parseNotes(o.notes);
      return {
        id:        o.id,
        date:      o.date ? (o.date as string).slice(0, 10) : null,
        items,
        score:     parsed.score,
        pros:      parsed.pros,
        cons:      parsed.cons,
        aesthetic: parsed.aesthetic,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  // Deduplicate by garment set — keep the entry with the richer analysis.
  const seen = new Map<string, (typeof mapped)[0]>();
  for (const outfit of mapped) {
    const key = [...outfit.items.map(i => i.id)].sort().join("|");
    const prev = seen.get(key);
    if (!prev || (outfit.score ?? 0) > (prev.score ?? 0) || outfit.pros.length > prev.pros.length) {
      seen.set(key, outfit);
    }
  }

  const outfits = [...seen.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return NextResponse.json({ outfits });
}
