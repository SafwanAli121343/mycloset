import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STALE_ID = "60447e73-33d5-42fc-af6f-5df42270f879";
const { data: g } = await sb.from("garments").select("id,title,user_id").eq("id", STALE_ID).maybeSingle();
console.log("Garment:", g);
if (g) {
  const { error } = await sb.from("garments").delete().eq("id", STALE_ID);
  if (error) console.error("Delete failed:", error.message);
  else console.log("Deleted stale garment.");
} else {
  console.log("Garment not in DB — just a stale crossing entry.");
}

// Remove the stale crossing entry either way
const { data: state } = await sb.from("wardrobe_analysis_state")
  .select("crossed").eq("user_id", "dd03be59-8301-4f91-9bda-533f26650212").single();
const cleaned = (state?.crossed ?? []).filter((e: { garmentId?: string }) => e.garmentId !== STALE_ID);
await sb.from("wardrobe_analysis_state").update({ crossed: cleaned })
  .eq("user_id", "dd03be59-8301-4f91-9bda-533f26650212");
console.log(`Crossed: cleaned to ${cleaned.length} entries:`, JSON.stringify(cleaned));
