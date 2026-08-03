import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const queries = [
  { label: "flannel shirts", filter: "sub_type.ilike.%flannel%" },
  { label: "harrington jackets", filter: "sub_type.ilike.%harrington%" },
  { label: "track pants", filter: "sub_type.ilike.%track%" },
  { label: "polo shirts", filter: "sub_type.ilike.%polo%" },
  { label: "overshirts/chore coats", filter: "sub_type.ilike.%chore%,sub_type.ilike.%overshirt%" },
  { label: "sweatpants/jogggers", filter: "sub_type.ilike.%sweatpant%,sub_type.ilike.%jogger%" },
];

for (const q of queries) {
  const { data } = await sb.from("streetwear_products")
    .select("brand,title,sub_type,aesthetic_tags,color_primary")
    .eq("analyzed", true)
    .or(q.filter)
    .limit(6);
  console.log(`\n=== ${q.label} ===`);
  for (const r of (data ?? [])) {
    console.log(`  ${(r.brand ?? "?").padEnd(28)} ${(r.sub_type ?? "?").padEnd(34)} ${r.color_primary ?? ""} | ${(r.aesthetic_tags ?? []).join(", ")}`);
  }
}
