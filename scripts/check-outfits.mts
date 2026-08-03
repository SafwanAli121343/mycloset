import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";

const { data: garments } = await sb.from("garments").select("id,brand,title").eq("user_id", USER_ID);
const myIds = new Set((garments ?? []).map((g: {id:string}) => g.id));
console.log(`My garments (${garments?.length}):`);
for (const g of garments ?? []) console.log(`  ${(g as any).id.slice(0,8)} ${(g as any).brand} — ${(g as any).title}`);

const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
const pad = (n: number) => String(n).padStart(2,"0");
const start = `${y}-${pad(m)}-01`, end = `${y}-${pad(m)}-${new Date(y,m,0).getDate()}`;

const { data: outfits } = await sb.from("outfits")
  .select("id, date, outfit_items(garment_id)")
  .eq("user_id", USER_ID)
  .gte("date", start).lte("date", end)
  .limit(5);

console.log(`\nSample outfits this month:`);
const seenGarmentIds = new Set<string>();
for (const o of (outfits ?? []) as any[]) {
  const items: {garment_id:string}[] = o.outfit_items;
  for (const i of items) seenGarmentIds.add(i.garment_id);
  const ids = items.map((i:any) => i.garment_id.slice(0,8)).join(", ");
  const allMine = items.every((i:any) => myIds.has(i.garment_id));
  console.log(`  ${o.date}: [${ids}] ${allMine ? "✔ all mine" : "✘ FOREIGN!"}`);
}

const foreignIds = [...seenGarmentIds].filter(id => !myIds.has(id));
if (foreignIds.length) {
  console.log(`\n✘ Foreign IDs in outfits:`);
  const { data: foreign } = await sb.from("garments").select("id,user_id,brand,title").in("id", foreignIds);
  for (const f of (foreign ?? []) as any[]) console.log(`  uid=${f.user_id?.slice(0,8)} ${f.brand} ${f.title}`);
} else {
  console.log("\n✔ All outfit garments belong to my closet.");
}
