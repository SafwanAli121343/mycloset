import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Fetch all calendar outfits for June, July, August 2026
const months = [
  { year: 2026, month: 6, name: "June" },
  { year: 2026, month: 7, name: "July" },
  { year: 2026, month: 8, name: "August" },
];

for (const { year, month, name } of months) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad(month)}-${lastDay}`;

  const { data, error } = await sb
    .from("outfits")
    .select(`id, date, notes, outfit_items ( garments ( id, title, brand, sub_type, color_primary, aesthetic_tags ) )`)
    .gte("date", start)
    .lte("date", end)
    .order("date");

  if (error) { console.error(`Error fetching ${name}:`, error.message); continue; }
  if (!data?.length) { console.log(`\n${name}: no outfits found`); continue; }

  console.log(`\n${"═".repeat(60)}\n  ${name.toUpperCase()} (${data.length} outfits)\n${"═".repeat(60)}`);
  for (const outfit of data) {
    const date = (outfit.date as string).slice(0, 10);
    const notes = (() => { try { return JSON.parse(outfit.notes as string ?? "{}"); } catch { return {}; } })();
    const items = (outfit.outfit_items as any[]).map((oi: any) => oi.garments).filter(Boolean);
    console.log(`\n  ${date}  config: ${notes.configName ?? "?"}  score: ${notes.styleScore ?? "?"}`);
    for (const item of items) {
      const tags = (item.aesthetic_tags ?? []).join(", ");
      console.log(`    • [${(item.sub_type ?? "?").padEnd(24)}] ${(item.brand ?? "?").padEnd(22)} ${item.color_primary ?? ""}  (${tags})`);
    }
  }
}
