import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";

// All test items inserted by both seed runs (with no real images / failed inference)
const TEST_IDS = [
  // First seed run (direct DB insert, no AI)
  "1df2cf94-ffc4-4f4e-8953-30a6bb4f190d",
  "c767e74a-1571-456c-a3b6-f34cd3597629",
  "0e0e2c71-561b-4940-bacb-08e5825b0097",
  "3e60786e-8b38-4e43-b73a-359583f8b6f1",
  "af62b317-2a20-4836-b2c3-b814fc9e6d4e",
  "7cd146f8-e6cf-47d8-ae1f-c27a0aabee09",
  // bad UUID from first run — skip (already gone)
  // Second seed run (AI inference failed, guessed image URLs)
  "de442999-50df-42da-af2c-24711e7d99af",
  "9d24c33c-f824-4877-b6db-46ca544042f5",
  "f48a8be9-25df-4f27-85db-627aa4e65938",
  "d0069f18-b4a2-464b-946b-09194ada76d3",
  "b477efb0-4959-4b6e-b212-592372d3c32e",
  "079920a6-e22f-4028-8fb0-a386c097da4a",
  "158a5f9e-62fb-4ddc-a123-bd62d9d694af",
];

const { data, error } = await sb
  .from("garments")
  .delete()
  .in("id", TEST_IDS)
  .select("id, title");

if (error) console.error("Error:", error.message);
else console.log(`Deleted ${data?.length ?? 0} test items:`, data?.map(d => d.title));

// Clean any stale crossings left over
const { data: waState } = await sb
  .from("wardrobe_analysis_state")
  .select("crossed")
  .eq("user_id", USER_ID)
  .single();

if (waState?.crossed) {
  const cleaned = (waState.crossed as Array<{ garmentId?: string }>)
    .filter(e => !TEST_IDS.includes(e.garmentId ?? ""));
  await sb.from("wardrobe_analysis_state").update({ crossed: cleaned }).eq("user_id", USER_ID);
  console.log(`Crossed array: ${waState.crossed.length} → ${cleaned.length} entries`);
}
