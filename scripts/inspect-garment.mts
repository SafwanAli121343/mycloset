import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const search = process.argv[2];

const query = supabase
  .from("garments")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(1);

const { data, error } = await (search ? query.ilike("title", `%${search}%`) : query);
if (error) throw new Error(error.message);

if (!data || data.length === 0) {
  console.log(search ? `No garment found matching "${search}"` : "No garments found.");
  process.exit(0);
}

const garment = data[0];

console.log(`\n${garment.title}`);
console.log("=".repeat(garment.title.length));

const fields = [
  "brand",
  "sub_type",
  "color_primary",
  "color_secondary",
  "fit",
  "pattern",
  "material",
  "design_complexity",
  "logo_prominence",
  "aesthetic_tags",
  "formality",
] as const;

for (const field of fields) {
  const value = garment[field];
  const confidence = garment.confidence?.[field];
  const suffix = confidence ? ` (${confidence})` : "";
  console.log(`${field.padEnd(18)} ${JSON.stringify(value)}${suffix}`);
}

console.log(`\nid:         ${garment.id}`);
console.log(`category:   ${garment.category}`);
console.log(`image:      ${garment.image}`);
console.log(`created_at: ${garment.created_at}`);
