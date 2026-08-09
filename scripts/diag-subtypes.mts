import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

for (const cat of ["outerwear","footwear","bottom","top"]) {
  const { data } = await sb.from("garments").select("sub_type").eq("category",cat).not("sub_type","is",null).not("image","is",null).limit(500);
  const counts: Record<string,number> = {};
  for (const r of data??[]) counts[r.sub_type as string] = (counts[r.sub_type as string]??0)+1;
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,25);
  console.log(`\n=== ${cat} top sub_types (image not null) ===`);
  for (const [k,v] of sorted) console.log(`  ${v.toString().padStart(4)} × ${k}`);
}

// Also check tops with pros set for overdone trigger planning
const { data: topsWithPros } = await sb.from("garments").select("sub_type").eq("category","top").not("pros","is",null).not("image","is",null).limit(200);
const pCounts: Record<string,number> = {};
for (const r of topsWithPros??[]) pCounts[r.sub_type as string] = (pCounts[r.sub_type as string]??0)+1;
console.log("\n=== tops WITH pros set (top 15) ===");
for (const [k,v] of Object.entries(pCounts).sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`  ${v.toString().padStart(4)} × ${k}`);
