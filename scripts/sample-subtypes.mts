import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data } = await sb.from("garments").select("sub_type").limit(500);
const types = [...new Set((data ?? []).map((g: any) => g.sub_type))].filter(Boolean).sort() as string[];
console.log("shirt/pant/dress/formal types:");
types.filter((t: string) => /shirt|pant|chino|trouser|polo|oxford|loafer|chelsea|derby|blazer|dress|formal|trench/i.test(t)).forEach(t => console.log(" ", t));
console.log("\nAll types (first 80):", types.slice(0, 80));
