import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";
for (const [y, m] of [[2026,7],[2026,8],[2026,9]]) {
  const pad = (n:number) => String(n).padStart(2,"0");
  const { count } = await sb.from("outfits").select("*",{count:"exact",head:true})
    .eq("user_id",USER_ID).gte("date",`${y}-${pad(m)}-01`).lte("date",`${y}-${pad(m)}-31`);
  const { count: itemCount } = await sb.from("outfit_items").select("*",{count:"exact",head:true})
    .in("outfit_id", (await sb.from("outfits").select("id").eq("user_id",USER_ID)
      .gte("date",`${y}-${pad(m)}-01`).lte("date",`${y}-${pad(m)}-31`)).data?.map((o:any)=>o.id) ?? []);
  console.log(`${y}-${pad(m)}: ${count} outfits, ${itemCount} outfit_items`);
}
