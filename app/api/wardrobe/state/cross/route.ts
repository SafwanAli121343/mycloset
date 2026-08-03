import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { computeEffectiveLevel } from "@/lib/wardrobeAnalysis";
import type { CrossedEntry, WABackendState } from "@/lib/wardrobeAnalysis";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/wardrobe/state/cross — append CrossedEntry[] when items are added.
// Called fire-and-forget from add-item page.
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entries = (await req.json()) as CrossedEntry[];
  if (!entries.length) return NextResponse.json({ success: true });

  const { data } = await sb
    .from("wardrobe_analysis_state")
    .select("crossed, analysis_history, current_level, highest_score")
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
