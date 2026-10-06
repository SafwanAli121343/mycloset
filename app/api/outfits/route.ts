import { NextRequest, NextResponse, after } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";
import { analyzeCalendarOutfits, hasCalendarAnalysis } from "@/lib/calendarAnalysis";
import { scoreOutfit, type GarmentForScoring } from "@/lib/scoring";

// The catch-up analysis below runs after the response.
export const maxDuration = 120;

// Catch-up runs for a month at most this often per user, so viewing a month repeatedly doesn't
// keep re-checking it.
const lastCatchUp = new Map<string, number>();
const CATCH_UP_MS = 2 * 60 * 1000;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Every garment id a client asks to put into an outfit must belong to that same user. The
// service-role client bypasses RLS, so without this check POST/PUT would link ANY garment id
// into the caller's outfit — and GET would then hand back that other user's garment details.
// Returns the de-duplicated id list, or null if the input is malformed or any id isn't owned.
async function ownedGarmentIds(userId: string, raw: unknown): Promise<string[] | null> {
  if (!Array.isArray(raw) || raw.length > 40 || !raw.every(id => typeof id === "string" && id.length <= 64)) return null;
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return ids;
  const { data, error } = await adminClient.from("garments").select("id").eq("user_id", userId).in("id", ids);
  if (error || (data ?? []).length !== ids.length) return null;
  return ids;
}

// A day set or edited by hand (Pro): its score right away, its AI analysis right after the
// response (lib/calendarAnalysis.ts). Free: nothing — scores and analysis are Pro features.
async function analyzeEditedOutfit(userId: string, outfitId: string) {
  const user = await getUserById(userId).catch(() => null);
  if (!user || !resolveEntitlement(user).hasAI) return;
  const { data } = await adminClient.from("outfits")
    .select("notes, outfit_items(garments(id, title, brand, category, sub_type, material, color_primary, color_secondary, pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image))")
    .eq("id", outfitId).single();
  const items = ((data?.outfit_items ?? []) as unknown as { garments: GarmentForScoring | null }[])
    .map(oi => oi.garments).filter((g): g is GarmentForScoring => !!g);
  if (!items.length || hasCalendarAnalysis((data as { notes?: string | null } | null)?.notes ?? null)) return;
  await adminClient.from("outfits").update({ notes: JSON.stringify({ styleScore: scoreOutfit(items) }) }).eq("id", outfitId).is("notes", null);
  after(() => analyzeCalendarOutfits(user, { ids: [outfitId] }).then(() => {}, () => {}));
}

// GET /api/outfits?year=2024&month=6
// Returns { [YYYY-MM-DD]: { id, garments[] } } for the requested month
export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "outfits", 300, 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year  = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12)
    return NextResponse.json({ error: "year and month required" }, { status: 400 });

  const pad       = (n: number) => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(month)}-01`;
  const lastDay   = new Date(year, month, 0).getDate();
  const endDate   = `${year}-${pad(month)}-${lastDay}`;

  // billingUser fetch runs alongside the outfits query (and its rare fallback retry below)
  // rather than after — they're independent, so there's no reason to pay for two round trips
  // in sequence on a screen (Calendar) that's already been reported as slow to load.
  const billingUserPromise = getUserById(session.userId).catch(() => null);

  let { data, error } = await adminClient
    .from("outfits")
    .select(`
      id,
      date,
      notes,
      ai_garment_ids,
      outfit_items (
        garments ( id, title, brand, image, category, sub_type, color_primary, pros, cons, color_pairings, aesthetic_tags, aesthetic_source )
      )
    `)
    .eq("user_id", session.userId)
    .gte("date", startDate)
    .lte("date", endDate);

  // Fall back if optional columns haven't been migrated yet
  if (error?.message?.includes("ai_garment_ids") || error?.message?.includes("notes")) {
    const fallback = await adminClient
      .from("outfits")
      .select(`id, date, outfit_items ( garments ( id, title, brand, image, category, sub_type, color_primary, pros, cons, color_pairings, aesthetic_tags, aesthetic_source ) )`)
      .eq("user_id", session.userId)
      .gte("date", startDate)
      .lte("date", endDate);
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  const billingUser = await billingUserPromise;
  const hasAI = !!billingUser && resolveEntitlement(billingUser).hasAI;

  // Pro: any outfit in this month still missing its score/analysis (generated while on the free
  // plan, set by hand, or an earlier failure) gets it now, in the background — it's there the
  // next time the month loads.
  if (hasAI && (data ?? []).some(o => (o.outfit_items as unknown[]).length > 0 && !hasCalendarAnalysis((o as { notes?: string | null }).notes ?? null))) {
    const key = `${session.userId}|${startDate}`;
    if (Date.now() - (lastCatchUp.get(key) ?? 0) > CATCH_UP_MS) {
      lastCatchUp.set(key, Date.now());
      after(() => analyzeCalendarOutfits(billingUser!, { from: startDate, to: endDate }).then(() => {}, () => {}));
    }
  }

  const byDate: Record<string, { id: string; notes: string | null; ai_garment_ids: string[] | null; garments: object[] }> = {};
  for (const outfit of (data ?? [])) {
    // Normalize date key — DB may return full ISO timestamp (2026-06-01T00:00:00+00:00)
    const dateKey = (outfit.date as string).slice(0, 10);
    const currentIds = (outfit.outfit_items as unknown as { garments: { id: string } | null }[])
      .map(oi => oi.garments?.id)
      .filter((id): id is string => !!id);
    const aiIds: string[] | null = (outfit as { ai_garment_ids: string[] | null }).ai_garment_ids ?? null;
    let notes: string | null = (outfit as { notes?: string | null }).notes ?? null;
    // Same rule as the garment fields below: a free/lapsed user doesn't get AI outfit analysis
    // (pros/cons/tags) or the outfit score (a Pro feature). Hidden in the response, not deleted,
    // so it all comes back if they resubscribe.
    if (!hasAI && notes) {
      try {
        const parsed = JSON.parse(notes) as Record<string, unknown>;
        delete parsed.pros; delete parsed.cons; delete parsed.outfit_tags; delete parsed.styleScore;
        // The day's aesthetic is kept only when it comes from an aesthetic the user picked
        // themselves on one of this outfit's items (aesthetic_source "manual") — an AI-tagged
        // one (e.g. a lapsed Pro's items) or the generator's "casual" default is dropped.
        const manualTags = new Set(
          (outfit.outfit_items as unknown as { garments: { aesthetic_tags?: string[] | null; aesthetic_source?: string | null } | null }[])
            .flatMap(oi => oi.garments?.aesthetic_source === "manual" ? (oi.garments.aesthetic_tags ?? []) : [])
            .map(t => t.toLowerCase()),
        );
        if (typeof parsed.aesthetic !== "string" || !manualTags.has(parsed.aesthetic.toLowerCase())) delete parsed.aesthetic;
        notes = JSON.stringify(parsed);
      } catch { /* leave unparseable notes as-is */ }
    }
    byDate[dateKey] = {
      id: outfit.id,
      notes,
      ai_garment_ids: aiIds,
      // pros/cons/color_pairings hidden (not deleted — see resolveEntitlement) once a
      // subscription lapses, same rule /api/garments applies to its own response.
      garments: (outfit.outfit_items as { garments: object }[])
        .map(oi => oi.garments)
        .filter(Boolean)
        .map(g => {
          if (hasAI) return g;
          const r = g as Record<string, unknown>;
          // aesthetic_tags only survive for free tier when the user set them (same rule as
          // /api/garments' AI_GATED_FIELDS stripping).
          return { ...r, pros: null, cons: null, color_pairings: null, aesthetic_tags: r.aesthetic_source === "manual" ? r.aesthetic_tags : null };
        }),
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

  const body = await req.json().catch(() => null);
  const date = body?.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(body?.garment_ids) || body.garment_ids.length === 0)
    return NextResponse.json({ error: "date and garment_ids required" }, { status: 400 });
  const garment_ids = await ownedGarmentIds(session.userId, body.garment_ids);
  if (!garment_ids) return NextResponse.json({ error: "Invalid garment_ids" }, { status: 400 });

  const { data: outfit, error: outfitErr } = await adminClient
    .from("outfits")
    .insert({ user_id: session.userId, date })
    .select()
    .single();
  if (outfitErr) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  const { error: itemsErr } = await adminClient
    .from("outfit_items")
    .insert(garment_ids.map((gid: string) => ({ outfit_id: outfit.id, garment_id: gid })));
  if (itemsErr) return NextResponse.json({ error: "Something went wrong." }, { status: 500 });

  await analyzeEditedOutfit(session.userId, outfit.id);
  return NextResponse.json({ id: outfit.id }, { status: 201 });
}

// PUT /api/outfits — replace items for an existing outfit, then sync analysis
export async function PUT(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Validated up front, before the delete below — a rejected list must not leave the outfit
  // emptied out.
  const garment_ids = body?.garment_ids == null ? null : await ownedGarmentIds(session.userId, body.garment_ids);
  if (body?.garment_ids != null && !garment_ids) return NextResponse.json({ error: "Invalid garment_ids" }, { status: 400 });

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
  // If not → Pro: score it now and analyze it right after the response (analyzeEditedOutfit).
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
      await analyzeEditedOutfit(session.userId, id);
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
