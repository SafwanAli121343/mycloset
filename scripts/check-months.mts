import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";
for (const [y, m] of [[2026,7],[2026,8],[2026,9]]) {
  const pad = (n:number) => String(n).padStart(2,"0");
  const { data: outfits } = await sb.from("outfits").select("id").eq("user_id",USER_ID)
    .gte("date",`${y}-${pad(m)}-01`).lte("date",`${y}-${pad(m)}-31`);
  const ids = outfits?.map((o:any)=>o.id) ?? [];
  if (!ids.length) { console.log(`${y}-${pad(m)}: 0 outfits`); continue; }
  const { data: items } = await sb.from("outfit_items").select("garment_id").in("outfit_id", ids.slice(0,5));
  console.log(`${y}-${pad(m)}: ${ids.length} outfits, sample outfit_items: ${items?.length ?? 0} (for first 5)`);
}
