import { supabase } from "@/lib/supabase";

// Brands the pipeline has identified via web-verification + OCR
// corroboration (see resolveBrand's Tier A3) but that aren't in the curated
// BRANDS list. Checking these alongside BRANDS lets the system "learn" niche
// brands from real evidence instead of requiring manual list edits.
export async function getDiscoveredBrands(): Promise<string[]> {
  const { data, error } = await supabase.from("discovered_brands").select("name");
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.name);
}

export async function addDiscoveredBrand(name: string): Promise<void> {
  const { error } = await supabase.from("discovered_brands").upsert({ name }, { onConflict: "name" });
  if (error) throw new Error(error.message);
}
