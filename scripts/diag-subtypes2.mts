import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Check without image filter — see how many items actually exist
for (const cat of ["outerwear","footwear","bottom","top"]) {
  const { data, count } = await sb.from("garments").select("sub_type", {count:"exact"}).eq("category",cat).not("sub_type","is",null).limit(500);
  const counts: Record<string,number> = {};
  for (const r of data??[]) counts[r.sub_type as string] = (counts[r.sub_type as string]??0)+1;
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,15);
  console.log(`\n=== ${cat} (${count} total, no image filter) ===`);
  for (const [k,v] of sorted) console.log(`  ${v.toString().padStart(5)} × ${k}`);
}

// Check what the image column looks like for a sample
const { data: sample } = await sb.from("garments").select("id,sub_type,category,image,pros").eq("category","outerwear").not("sub_type","is",null).limit(5);
console.log("\n=== outerwear sample (image + pros values) ===");
for (const r of sample??[]) console.log(`  sub_type=${r.sub_type} image=${r.image ? "set("+String(r.image).slice(0,40)+"...)" : "null"} pros=${Array.isArray(r.pros) ? r.pros.length+"items" : r.pros}`);
