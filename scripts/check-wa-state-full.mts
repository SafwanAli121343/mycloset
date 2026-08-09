import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";

const { data: state } = await sb.from("wardrobe_analysis_state")
  .select("analysis_history, crossed, current_level").eq("user_id", USER_ID).single();

console.log("currentLevel:", state?.current_level);
console.log("historyLength:", state?.analysis_history?.length);
console.log("crossedCount:", state?.crossed?.length);
console.log("\ncrossed entries:");
for (const e of (state?.crossed ?? [])) console.log(" ", JSON.stringify(e));
console.log("\nL1 score:", state?.analysis_history?.[0]?.score);
console.log("L2 score:", state?.analysis_history?.[1]?.score);
