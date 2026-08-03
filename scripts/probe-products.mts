import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { count } = await sb.from("streetwear_products").select("*", { count: "exact", head: true });
console.log("streetwear_products total:", count);
const { data: sample } = await sb.from("streetwear_products").select("*").limit(2);
console.log("columns:", Object.keys(sample?.[0] ?? {}));
console.log(JSON.stringify(sample?.[0], null, 2));
const { data: types } = await sb.from("streetwear_products").select("sub_type,category,brand").limit(2000);
const dist: Record<string,number> = {};
const brands = new Set<string>();
for (const r of types ?? []) {
  dist[`${r.category}/${r.sub_type}`] = (dist[`${r.category}/${r.sub_type}`] ?? 0) + 1;
  brands.add(r.brand);
}
console.log("\nSub-type distribution (sample of 2000):");
Object.entries(dist).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([k,v])=>console.log(`  ${v}x ${k}`));
console.log(`\nBrands (${brands.size}):`, [...brands].slice(0,20).join(", "));
