// POST /api/outfits/generate
// Generates a month's worth of outfits using the 32-config blueprint system.
// Picks the most complex outfit tier viable for each day's weather, then selects
// the highest-scoring outfit that also maximises wardrobe novelty (new items).
//
// Body: { year, month, lat?, lon?, overwrite? }

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import type { GarmentForScoring } from "@/lib/scoring";
import { generateAndRankAllOutfits, type RankedOutfit } from "@/lib/wardrobeOutfitGen";
import { generateMonthPlan, REPEAT_WINDOW } from "@/lib/monthOutfitPlan";
import { type DayWeather } from "@/lib/weatherOutfitFilter";
import { fetchMonthWeather, seasonalFallbackTemp, tempLabel } from "@/lib/weatherData";
import { analyzeCalendarOutfits } from "@/lib/calendarAnalysis";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";

export const maxDuration = 120;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Full-month outfit generation — AI inference per outfit. 5/hour per IP.
  const rateBlock = applyApiRateLimit(req, "outfits:generate", 5, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { year, month, lat: latRaw, lon: lonRaw, overwrite } = body as {
    year: number; month: number; lat?: number; lon?: number; overwrite?: boolean;
  };
  if (!year || !month) return NextResponse.json({ error: "year and month required" }, { status: 400 });

  // `lat`/`lon` arrive as whatever the client's JSON body actually contains — the `as` cast above
  // is compile-time only, so a malformed/malicious value would otherwise flow straight into the
  // Open-Meteo request URL. Not exploitable as SSRF (the hostname is hardcoded), but validating
  // here means a bad value degrades to "no weather data" instead of a malformed outbound request.
  const lat = typeof latRaw === "number" && Number.isFinite(latRaw) && latRaw >= -90 && latRaw <= 90 ? latRaw : null;
  const lon = typeof lonRaw === "number" && Number.isFinite(lonRaw) && lonRaw >= -180 && lonRaw <= 180 ? lonRaw : null;

  const pad         = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate   = `${year}-${pad(month)}-01`;
  const endDate     = `${year}-${pad(month)}-${daysInMonth}`;
  const allDates    = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);

  // Skip dates that already have outfits (unless overwrite requested)
  const { data: existingOutfits } = await adminClient
    .from("outfits").select("id, date")
    .eq("user_id", session.userId).gte("date", startDate).lte("date", endDate);

  const existingByDate: Record<string, string> = {};
  for (const o of (existingOutfits ?? [])) existingByDate[o.date.slice(0, 10)] = o.id;

  const targetDates = overwrite ? allDates : allDates.filter((d) => !existingByDate[d]);
  if (targetDates.length === 0)
    return NextResponse.json({ message: "All dates already have outfits", generated: {} });

  // Fetch wardrobe (full scoring fields)
  const { data: garments, error: garmentErr } = await adminClient
    .from("garments")
    .select(
      // `category` is required: resolveSlot() (lib/scoring.ts) slots items by category first.
      // Without it, an item with no sub_type (every free-tier item — sub_type is AI-filled)
      // fit no slot, so a free wardrobe could never form an outfit or a calendar.
      "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
      "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image",
    )
    .eq("user_id", session.userId);

  if (garmentErr) return NextResponse.json({ error: "DB error" }, { status: 500 });
  if (!garments?.length)
    return NextResponse.json({ error: "No garments in wardrobe" }, { status: 400 });

  const wardrobe = garments as unknown as GarmentForScoring[];

  // Pre-generate all ranked outfits once (expensive) — 5000 cap for diversity
  const allRanked = generateAndRankAllOutfits(wardrobe, { maxTotal: 5000 });
  if (!allRanked.length)
    return NextResponse.json({
      error: "Could not build any valid outfits. Wardrobe may be missing footwear, tops, or bottoms.",
      code: "INSUFFICIENT_WARDROBE",
    }, { status: 422 });

  // Fetch weather for all target dates
  const weatherMap = lat != null && lon != null
    ? await fetchMonthWeather(lat, lon, year, month, targetDates)
    : new Map<string, DayWeather>();

  // Build DayWeather array for target dates, falling back to seasonal temp if no data
  const weatherByDate: DayWeather[] = targetDates.map((date) =>
    weatherMap.get(date) ?? {
      date,
      tempF: seasonalFallbackTemp(month),
      condition: "clear",
    },
  );

  // ── Cross-month seed: fetch prior outfits so anti-repetition spans month boundaries ──────
  // Treat all months as a continuous stream: items worn in the previous month count against
  // novelty, and exact combinations worn in the last REPEAT_WINDOW days carry over.
  const seedLastSeenDay = new Map<string, number>();
  const seedRecentPicks: RankedOutfit[] = [];

  const day0Ms = Date.UTC(year, month - 1, 1); // UTC midnight of planning window day 0
  const sixtyDaysAgo = new Date(day0Ms - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: histOutfits } = await adminClient
    .from("outfits")
    .select("date, outfit_items(garment_id)")
    .eq("user_id", session.userId)
    .lt("date", startDate)
    .gte("date", sixtyDaysAgo)
    .order("date", { ascending: false }); // newest first

  for (const hist of (histOutfits ?? [])) {
    const histStr = (hist.date as string).slice(0, 10);
    const [hy, hm, hd] = histStr.split("-").map(Number);
    const histMs   = Date.UTC(hy, hm - 1, hd);
    const dayOffset = Math.round((histMs - day0Ms) / (1000 * 60 * 60 * 24)); // ≤ -1

    const garmentIds = (hist.outfit_items as { garment_id: string }[]).map(oi => oi.garment_id);

    for (const gid of garmentIds) {
      if (!seedLastSeenDay.has(gid)) seedLastSeenDay.set(gid, dayOffset);
    }

    if (dayOffset >= -REPEAT_WINDOW && seedRecentPicks.length < REPEAT_WINDOW) {
      seedRecentPicks.push({
        items: garmentIds.map(id => ({ id } as GarmentForScoring)),
        score: 50,
        configName: "historical",
      });
    }
  }

  // Reverse to oldest-first so the sliding window's most-recent entry is the true last outfit
  seedRecentPicks.reverse();

  // Run the planner
  const { days } = generateMonthPlan(wardrobe, weatherByDate, {
    precomputedRanked: allRanked,
    seed: { lastSeenDay: seedLastSeenDay, recentPicks: seedRecentPicks },
  });

  // Persist outfits to DB
  const insertResults = await Promise.all(
    days.map(async ({ date, outfit }): Promise<[string, string[]] | null> => {
      if (!outfit.items.length) return null;
      const ids = outfit.items.map((i) => i.id);

      const weatherEntry = weatherMap.get(date);
      const tempF    = weatherEntry?.tempF ?? seasonalFallbackTemp(month);
      const notesJson = JSON.stringify({
        aesthetic:     deriveAesthetic(ids, wardrobe),
        note:          `${tempLabel(tempF)}, ${tempF}°F`,
        configName:    outfit.configName,
        complexityTier: outfit.complexityTier,
        styleScore:    outfit.score,
      });

      if (overwrite && existingByDate[date]) {
        const oid = existingByDate[date];
        await adminClient.from("outfits").update({ ai_garment_ids: ids, notes: notesJson }).eq("id", oid);
        await adminClient.from("outfit_items").delete().eq("outfit_id", oid);
        await adminClient.from("outfit_items").insert(ids.map((gid) => ({ outfit_id: oid, garment_id: gid })));
        return [date, ids];
      }

      const { data: d1, error: e1 } = await adminClient
        .from("outfits")
        .insert({ user_id: session.userId, date, ai_garment_ids: ids, notes: notesJson })
        .select("id").single();

      let outfitId: string | null = null;
      if (e1?.message?.includes("ai_garment_ids")) {
        const { data: d2, error: e2 } = await adminClient
          .from("outfits").insert({ user_id: session.userId, date, notes: notesJson })
          .select("id").single();
        if (e2 || !d2?.id) return null;
        outfitId = d2.id;
      } else if (e1 || !d1?.id) {
        return null;
      } else {
        outfitId = d1.id;
      }

      await adminClient.from("outfit_items").insert(
        ids.map((gid) => ({ outfit_id: outfitId, garment_id: gid })),
      );
      return [date, ids];
    }),
  );

  const results = Object.fromEntries(
    insertResults.filter((r): r is [string, string[]] => r !== null),
  );

  // Sequential analysis pass: fetch newly inserted outfits and call GPT-4o for each.
  // Runs after all inserts complete; individual failures are swallowed.
  //
  // The outfit SELECTION above (generateAndRankAllOutfits/generateMonthPlan) is deterministic,
  // scoring-based, and runs for every tier regardless — free tier keeps every generated outfit
  // exactly as picked. This pass only adds AI-written narrative notes on top, so it's the one
  // part gated behind hasAI; skipping it for free tier leaves the outfits themselves untouched,
  // just without AI notes attached. A read-only hasAI check, not consumeAiCredit — outfit
  // narrative was never part of the credit design (credits are scoped to per-item analysis, see
  // lib/billing/plans.ts), so a free user with purchased item-analysis credits still doesn't get
  // this rather than silently draining those credits on something they weren't sold. Was
  // previously ungated entirely, running once per generated day regardless of tier — a real gap
  // found in the free-tier AI audit (this route can generate up to ~30 days' worth in one call).
  const generatedDates = Object.keys(results);
  const analysisBillingUser = await getUserById(session.userId).catch(() => null);
  if (analysisBillingUser && resolveEntitlement(analysisBillingUser).hasAI && generatedDates.length > 0) {
    // Scores + analysis for the new days (lib/calendarAnalysis.ts), in parallel. Anything not
    // finished within the time limit is picked up the next time the month is viewed.
    await analyzeCalendarOutfits(analysisBillingUser, { dates: generatedDates }, Date.now() + 75_000).catch(() => 0);
  }

  return NextResponse.json({ generated: results, count: Object.keys(results).length });
}

function deriveAesthetic(ids: string[], wardrobe: GarmentForScoring[]): string {
  const byId = new Map(wardrobe.map((g) => [g.id, g]));
  const tags  = ids.flatMap((id) => (byId.get(id)?.aesthetic_tags as string[] | null) ?? []);
  if (!tags.length) return "casual";
  const freq: Record<string, number> = {};
  for (const t of tags) freq[t] = (freq[t] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}
