import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";

const { data: state } = await sb.from("wardrobe_analysis_state")
  .select("analysis_history, crossed, current_level").eq("user_id", USER_ID).single();

if (!state) { console.error("No state found."); process.exit(1); }

// Keep only L1 history
const l1Only = [state.analysis_history[0]];

// Crossed: drop entries with garmentIds that no longer exist in garments table.
// The two pre-existing con entries have no garmentId — keep those.
const crossed = state.crossed as Array<{ garmentId?: string }>;
const garmentIds = crossed.map(e => e.garmentId).filter(Boolean) as string[];

let validIds = new Set<string>();
if (garmentIds.length > 0) {
  const { data: existing } = await sb.from("garments").select("id").in("id", garmentIds);
  validIds = new Set((existing ?? []).map(g => g.id as string));
}

const cleanCrossed = crossed.filter(e => !e.garmentId || validIds.has(e.garmentId));

await sb.from("wardrobe_analysis_state").update({
  analysis_history: l1Only,
  crossed: cleanCrossed,
  current_level: 1,
}).eq("user_id", USER_ID);

console.log("Reset complete:");
console.log("  currentLevel: 1");
console.log("  historyLength:", l1Only.length);
console.log("  crossedCount:", cleanCrossed.length);
console.log("  crossed:", JSON.stringify(cleanCrossed, null, 2));
