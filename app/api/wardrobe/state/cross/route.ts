import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";
import { computeEffectiveLevel } from "@/lib/wardrobeAnalysis";
import type { CrossedEntry, WABackendState } from "@/lib/wardrobeAnalysis";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// DELETE /api/wardrobe/state/cross?garmentId=X — remove all crossings for a deleted garment.
// Called fire-and-forget from the closet page on item deletion.
export async function DELETE(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const garmentId = req.nextUrl.searchParams.get("garmentId");
  if (!garmentId) return NextResponse.json({ error: "garmentId required" }, { status: 400 });

  const { data } = await sb
    .from("wardrobe_analysis_state")
    .select("crossed, analysis_history, current_level")
    .eq("user_id", session.userId)
    .single();

  if (!data) return NextResponse.json({ success: true });

  const existing = (data.crossed as CrossedEntry[]) ?? [];
  const updatedCrossed = existing.filter((e: CrossedEntry) => e.garmentId !== garmentId);

  // Nothing to remove — skip the write
  if (updatedCrossed.length === existing.length) return NextResponse.json({ success: true });

  const effectiveLevel = computeEffectiveLevel(
    (data.analysis_history as WABackendState["analysisHistory"]) ?? [],
    updatedCrossed,
    (data.current_level as number) ?? 1
  );

  await sb.from("wardrobe_analysis_state").update({
    crossed:       updatedCrossed,
    current_level: effectiveLevel,
    updated_at:    new Date().toISOString(),
  }).eq("user_id", session.userId);

  return NextResponse.json({ success: true });
}

// POST /api/wardrobe/state/cross — append CrossedEntry[] when items are added.
// Called fire-and-forget from add-item page.
export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "wardrobe:cross", 300, 60000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entries = (await req.json()) as CrossedEntry[];
  if (!entries.length) return NextResponse.json({ success: true });

  const { data } = await sb
    .from("wardrobe_analysis_state")
    .select("crossed, analysis_history, current_level")
    .eq("user_id", session.userId)
    .single();

  // Table doesn't exist or no state yet — WA page will create it on first load
  if (!data) return NextResponse.json({ success: true });

  const updatedCrossed: CrossedEntry[] = [
    ...((data.crossed as CrossedEntry[]) ?? []),
    ...entries,
  ];
  const effectiveLevel = computeEffectiveLevel(
    (data.analysis_history as WABackendState["analysisHistory"]) ?? [],
    updatedCrossed,
    (data.current_level as number) ?? 1
  );

  await sb.from("wardrobe_analysis_state").update({
    crossed:       updatedCrossed,
    current_level: effectiveLevel,
    // highest_score is read-only here — only the WA page knows the computed bumped score
    updated_at:    new Date().toISOString(),
  }).eq("user_id", session.userId);

  return NextResponse.json({ success: true });
}
