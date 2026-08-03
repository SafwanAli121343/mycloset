import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
// Get distinct sub_types
const { data: counts } = await sb.from("garments").select("sub_type").not("sub_type","is",null).limit(2000);
const freq: Record<string,number> = {};
for (const g of (counts ?? [])) { freq[(g as any).sub_type] = (freq[(g as any).sub_type] || 0) + 1; }
const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]);
console.log(`\nTop 50 sub_types (out of ${sorted.length} distinct):`);
sorted.slice(0,50).forEach(([t,c]) => console.log(`  ${c.toString().padStart(4)}  ${t}`));
