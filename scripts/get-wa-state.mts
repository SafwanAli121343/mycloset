import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Get user by email
const { data: user } = await sb
  .from("users")
  .select("id, email")
  .eq("email", "safwan200817@gmail.com")
  .single();

if (!user) { console.error("User not found"); process.exit(1); }
console.log("userId:", user.id);

// Get WA state
const { data: state } = await sb
  .from("wardrobe_analysis_state")
  .select("analysis_history, crossed, current_level")
  .eq("user_id", user.id)
  .single();

if (!state || !state.analysis_history?.length) {
  console.log("No WA state found.");
  process.exit(0);
}

const history = state.analysis_history as Array<{
  gaps?: Array<{ description: string; impact: string; reason: string }>;
  colors?: { missing?: string[] };
  aesthetics?: { missing?: string[] };
  cons?: string[];
  score?: number;
}>;
const crossed = (state.crossed ?? []) as Array<{ category: string; key: string; garmentId?: string; analysisLevel: number; progress?: number }>;
const currentLevel = (state.current_level as number) ?? 1;

console.log("\ncurrentLevel:", currentLevel);
console.log("historyLength:", history.length);

const L1 = history[0];
if (!L1) { console.log("No L1 analysis."); process.exit(0); }

// Compute what's crossed at L1
const atL1 = crossed.filter(e => e.analysisLevel === 1);
const crossedColorKeys = new Set(atL1.filter(e => e.category === "color").map(e => e.key));
const crossedAesKeys   = new Set(atL1.filter(e => e.category === "aesthetic").map(e => e.key));

function gapProgress(key: string): number {
  return Math.min(100, atL1.filter(e => e.category === "gap" && e.key === key).reduce((s, e) => s + (e.progress ?? 100), 0));
}

console.log("\n=== LEVEL 1 ANALYSIS ===");
console.log("Score:", L1.score);

console.log("\nGAPS:");
for (const g of L1.gaps ?? []) {
  const prog = gapProgress(g.description);
  console.log(`  [${prog >= 100 ? "CROSSED" : `${prog}%`}] ${g.description} (${g.impact}) — ${g.reason}`);
}

console.log("\nMISSING COLORS:");
for (const c of L1.colors?.missing ?? []) {
  console.log(`  [${crossedColorKeys.has(c) ? "CROSSED" : "OPEN"}] ${c}`);
}

console.log("\nMISSING AESTHETICS:");
for (const a of L1.aesthetics?.missing ?? []) {
  console.log(`  [${crossedAesKeys.has(a) ? "CROSSED" : "OPEN"}] ${a}`);
}

console.log("\nCONS:");
(L1.cons ?? []).forEach((c, i) => {
  const resolved = atL1.some(e => e.category === "con" && e.key === String(i));
  console.log(`  [${resolved ? "RESOLVED" : "OPEN"}] ${c}`);
});
