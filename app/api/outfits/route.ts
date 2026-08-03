import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/outfits?year=2024&month=6
// Returns { [YYYY-MM-DD]: { id, garments[] } } for the requested month
export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year  = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!year || !month) return NextResponse.json({ error: "year and month required" }, { status: 400 });

  const pad       = (n: number) => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(month)}-01`;
  const lastDay   = new Date(year, month, 0).getDate();
  const endDate   = `${year}-${pad(month)}-${lastDay}`;

  let { data, error } = await adminClient
    .from("outfits")
    .select(`
      id,
      date,
      notes,
      ai_garment_ids,
      outfit_items (
        garments ( id, title, brand, image, category, sub_type, color_primary, pros, cons, color_pairings )
      )
    `)
    .eq("user_id", session.userId)
    .gte("date", startDate)
    .lte("date", endDate);

  // Fall back if optional columns haven't been migrated yet
  if (error?.message?.includes("ai_garment_ids") || error?.message?.includes("notes")) {
    const fallback = await adminClient
      .from("outfits")
      .select(`id, date, outfit_items ( garments ( id, title, brand, image, category, sub_type, color_primary, pros, cons, color_pairings ) )`)
      .eq("user_id", session.userId)
      .gte("date", startDate)
      .lte("date", endDate);
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byDate: Record<string, { id: string; notes: string | null; ai_garment_ids: string[] | null; garments: object[] }> = {};
  for (const outfit of (data ?? [])) {
    // Normalize date key — DB may return full ISO timestamp (2026-06-01T00:00:00+00:00)
    const dateKey = (outfit.date as string).slice(0, 10);
    const currentIds = (outfit.outfit_items as unknown as { garments: { id: string } | null }[])
      .map(oi => oi.garments?.id)
      .filter((id): id is string => !!id);
    const aiIds: string[] | null = (outfit as { ai_garment_ids: string[] | null }).ai_garment_ids ?? null;
    const notes: string | null = (outfit as { notes?: string | null }).notes ?? null;
    byDate[dateKey] = {
      id: outfit.id,
      notes,
      ai_garment_ids: aiIds,
      garments: (outfit.outfit_items as { garments: object }[])
        .map(oi => oi.garments)
        .filter(Boolean),
      // if ai-generated and current items differ from original → customized
      ...( aiIds && JSON.stringify([...currentIds].sort()) !== JSON.stringify([...aiIds].sort())
        ? { customized: true }
        : {} ),
    };
  }
  return NextResponse.json(byDate);
}

// POST /api/outfits — create outfit for a date
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { date, garment_ids } = await req.json();
  if (!date || !Array.isArray(garment_ids) || garment_ids.length === 0)
    return NextResponse.json({ error: "date and garment_ids required" }, { status: 400 });

  const { data: outfit, error: outfitErr } = await adminClient
    .from("outfits")
    .insert({ user_id: session.userId, date })
    .select()
    .single();
  if (outfitErr) return NextResponse.json({ error: outfitErr.message }, { status: 500 });

  const { error: itemsErr } = await adminClient
    .from("outfit_items")
    .insert(garment_ids.map((gid: string) => ({ outfit_id: outfit.id, garment_id: gid })));
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  return NextResponse.json({ id: outfit.id }, { status: 201 });
}

// PUT /api/outfits — replace items for an existing outfit, then sync analysis
export async function PUT(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, garment_ids } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await adminClient
    .from("outfits")
    .select("user_id")
    .eq("id", id)
    .single();
  if (!existing || existing.user_id !== session.userId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await adminClient.from("outfit_items").delete().eq("outfit_id", id);

  if (Array.isArray(garment_ids) && garment_ids.length > 0) {
    await adminClient
      .from("outfit_items")
      .insert(garment_ids.map((gid: string) => ({ outfit_id: id, garment_id: gid })));
  }

  // ── Sync analysis from pre-computed outfit data ─────────────────────────────
  // The generate route pre-computes scores, pros, cons for all calendar outfits.
  // When the user edits and saves a new garment combination, search across all
  // stored outfits for this user for one with the exact same garment set.
  // If found → copy its notes (score + pros/cons already computed).
  // If not → compute score deterministically; pros/cons stay blank until next generate.
  if (Array.isArray(garment_ids) && garment_ids.length > 0) {
    const garmentKey = [...garment_ids].sort().join("|");

    // Fetch all other outfits for this user that have notes, with their items
    const { data: candidates } = await adminClient
      .from("outfits")
      .select("id, notes, outfit_items(garment_id)")
      .eq("user_id", session.userId)
      .neq("id", id)
      .not("notes", "is", null);

    const match = (candidates ?? []).find(o => {
      const ids = (o.outfit_items as { garment_id: string }[])
        .map(oi => oi.garment_id)
        .sort()
        .join("|");
      return ids === garmentKey;
    });

    if (match?.notes) {
      // Exact combination found in a calendar date — reuse its pre-computed analysis
      await adminClient.from("outfits").update({ notes: match.notes }).eq("id", id);
    } else {
      // No pre-computed analysis exists for this combination — clear any stale notes
      // so the UI doesn't show analysis that belongs to the old (pre-edit) outfit
      await adminClient.from("outfits").update({ notes: null }).eq("id", id);
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/outfits?id=...
export async function DELETE(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await adminClient
    .from("outfits")
    .select("user_id")
    .eq("id", id)
    .single();
  if (!existing || existing.user_id !== session.userId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await adminClient.from("outfits").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
