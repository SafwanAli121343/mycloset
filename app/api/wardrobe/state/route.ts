import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { computeEffectiveLevel } from "@/lib/wardrobeAnalysis";
import type { WABackendState, CrossedEntry } from "@/lib/wardrobeAnalysis";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Postgres error code 42P01 = "relation does not exist"
// PGRST116 = "no rows returned by .single()" — NOT table missing, just empty
const TABLE_MISSING_CODES = new Set(["42P01"]);

async function tableExists(): Promise<boolean> {
  const { error } = await sb
    .from("wardrobe_analysis_state")
    .select("user_id")
    .limit(1);
  if (!error) return true;
  if (TABLE_MISSING_CODES.has(error.code ?? "")) return false;
  return true; // other errors: assume table exists, let the caller handle
}

async function loadState(userId: string): Promise<{ state: WABackendState | null; missing: boolean }> {
  const { data, error } = await sb
    .from("wardrobe_analysis_state")
    .select("analysis_history, crossed, current_level")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (TABLE_MISSING_CODES.has(error.code ?? "")) return { state: null, missing: true };
    // PGRST116 = no rows — table exists but user has no state yet (first visit)
    // Other errors (e.g. column not found after partial migration) also return null gracefully
    if (error.code !== "PGRST116") return { state: null, missing: false };
    return { state: null, missing: false };
  }
  if (!data) return { state: null, missing: false };
  return {
    state: {
      analysisHistory: (data.analysis_history as WABackendState["analysisHistory"]) ?? [],
      crossed:         (data.crossed as WABackendState["crossed"]) ?? [],
      currentLevel:    (data.current_level as number) ?? 1,
    },
    missing: false,
  };
}

// GET /api/wardrobe/state
// Returns 503 { error: "table_missing" } when the SQL migration hasn't been run.
// Returns 200 null when table exists but no state yet (first-time user).
// Returns 200 WABackendState when state exists.
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json(null, { status: 401 });

  const { state, missing } = await loadState(session.userId);
  if (missing) return NextResponse.json({ error: "table_missing" }, { status: 503 });
  return NextResponse.json(state);
}

// DELETE /api/wardrobe/state — wipe state row so the next WA page load runs a fresh analysis
export async function DELETE() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await sb.from("wardrobe_analysis_state").delete().eq("user_id", session.userId);
  return NextResponse.json({ success: true });
}

// PUT /api/wardrobe/state — merge in a new state (called by WA page when fresh analysis runs).
// Merges rather than blindly overwrites: the WA analysis call this follows can take 8-10+
// seconds (GPT latency), and in that window a concurrent request (an item added in another tab,
// or another request from the same tab) can write new crossings via /api/wardrobe/state/cross.
// A blind overwrite here would silently discard that concurrent write. Also guards against a
// stale/shorter analysisHistory regressing a level that another concurrent request already
// advanced further.
export async function PUT(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await tableExists())) {
    return NextResponse.json({ error: "table_missing" }, { status: 503 });
  }

  const body = (await req.json()) as WABackendState;

  const { data: existing } = await sb
    .from("wardrobe_analysis_state")
    .select("crossed, analysis_history, current_level")
    .eq("user_id", session.userId)
    .single();

  const crossKey = (e: CrossedEntry) => `${e.category}|${e.key}|${e.garmentId ?? ""}|${e.analysisLevel}`;
  const existingCrossed = (existing?.crossed as CrossedEntry[]) ?? [];
  const incomingKeys    = new Set(body.crossed.map(crossKey));
  const mergedCrossed   = [...body.crossed, ...existingCrossed.filter(e => !incomingKeys.has(crossKey(e)))];

  const existingHistory = (existing?.analysis_history as WABackendState["analysisHistory"]) ?? [];
  const analysisHistory = existingHistory.length > body.analysisHistory.length ? existingHistory : body.analysisHistory;
  const currentLevel    = Math.max(body.currentLevel, (existing?.current_level as number) ?? 1);

  const effLevel = computeEffectiveLevel(analysisHistory, mergedCrossed, currentLevel);
  const { error } = await sb.from("wardrobe_analysis_state").upsert(
    {
      user_id:          session.userId,
      analysis_history: analysisHistory,
      crossed:          mergedCrossed,
      current_level:    effLevel,
      updated_at:       new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
