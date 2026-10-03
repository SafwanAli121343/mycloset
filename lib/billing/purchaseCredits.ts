// Per-type balances for one-time purchases (supabase/add_purchase_credits.sql):
//   "Single Item Analysis"   → users.ai_credits            ("Use score?" in My Closet)
//   "Full Wardrobe Analysis" → users.wardrobe_scan_credits ("Perform analysis?" on the Wardrobe tab)
// Spent only by lib/analysisJobs.ts once a result is saved; granted by the RevenueCat webhook.
// Both go through atomic SQL functions (supabase/add_analysis_jobs.sql). Reads tolerate the
// wardrobe_scan_credits column not existing yet (migration not run).
import { createClient } from "@supabase/supabase-js";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getWardrobeScanCredits(userId: string): Promise<number> {
  const { data, error } = await adminSupabase.from("users").select("wardrobe_scan_credits").eq("id", userId).single();
  if (error) return 0;
  return (data as { wardrobe_scan_credits?: number } | null)?.wardrobe_scan_credits ?? 0;
}
