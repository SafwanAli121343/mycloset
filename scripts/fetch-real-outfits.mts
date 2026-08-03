#!/usr/bin/env node
// Fetches real outfits from Supabase for the past 90 days, with full item detail.
// Run: npx tsx --env-file=.env.local scripts/fetch-real-outfits.mts

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ninetyDaysAgo = new Date();
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
const cutoff = ninetyDaysAgo.toISOString().split("T")[0]; // YYYY-MM-DD

console.log(`\nFetching outfits from ${cutoff} to today...\n`);

// ── 1. Fetch outfits ───────────────────────────────────────────────────────────

const { data: outfits, error: outfitErr } = await supabase
  .from("outfits")
  .select("id, date, notes, created_at")
  .gte("date", cutoff)
  .order("date", { ascending: true });

if (outfitErr) {
  console.error("Error fetching outfits:", outfitErr.message);
  process.exit(1);
}

console.log(`Found ${outfits?.length ?? 0} outfits in the past 90 days.\n`);

if (!outfits?.length) {
  console.log("No outfits found. Checking table structure...");
  const { data: sample, error: sampleErr } = await supabase
    .from("outfits")
    .select("*")
    .limit(5);
  console.log("Sample outfits:", JSON.stringify(sample, null, 2));
  console.log("Error:", sampleErr?.message);
  process.exit(0);
}

// ── 2. Fetch outfit_items with garment details ─────────────────────────────────

const outfitIds = outfits.map((o) => o.id);

const { data: outfitItems, error: itemErr } = await supabase
  .from("outfit_items")
  .select("outfit_id, garment_id")
  .in("outfit_id", outfitIds);

if (itemErr) {
  console.error("Error fetching outfit_items:", itemErr.message);
  process.exit(1);
}

// ── 3. Fetch garment details ──────────────────────────────────────────────────

const garmentIds = [...new Set((outfitItems ?? []).map((i) => i.garment_id))];

const { data: garments, error: garmentErr } = await supabase
  .from("garments")
  .select("id, title, brand, sub_type, color_primary, color_secondary, pattern, aesthetic_tags, formality")
  .in("id", garmentIds);

if (garmentErr) {
  console.error("Error fetching garments:", garmentErr.message);
  process.exit(1);
}

const garmentMap = new Map((garments ?? []).map((g) => [g.id, g]));
const itemsByOutfit = new Map<string, typeof outfitItems>();

for (const item of outfitItems ?? []) {
  if (!itemsByOutfit.has(item.outfit_id)) itemsByOutfit.set(item.outfit_id, []);
  itemsByOutfit.get(item.outfit_id)!.push(item);
}

// ── 4. Print each outfit ──────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  REAL OUTFITS — PAST 90 DAYS");
console.log("═══════════════════════════════════════════════════════════════════\n");

// Track unique combos for deduplication
const seenCombos = new Map<string, { date: string; configName: string; count: number }>();

for (const outfit of outfits) {
  const items = itemsByOutfit.get(outfit.id) ?? [];
  const notes = typeof outfit.notes === "string"
    ? (() => { try { return JSON.parse(outfit.notes); } catch { return {}; } })()
    : outfit.notes ?? {};

  const configName: string = notes?.configName ?? notes?.config ?? "(unknown)";
  const itemDetails = items
    .map((i) => garmentMap.get(i.garment_id))
    .filter(Boolean)
    .sort((a, b) => {
      // Sort by sub_type for consistent display
      return (a!.sub_type ?? "").localeCompare(b!.sub_type ?? "");
    });

  // Create a combo key for deduplication
  const comboKey = itemDetails
    .map((g) => `${g!.sub_type}:${g!.title}`)
    .sort()
    .join(" | ");

  if (seenCombos.has(comboKey)) {
    seenCombos.get(comboKey)!.count++;
    continue; // Skip duplicate printout, just count
  }
  seenCombos.set(comboKey, { date: outfit.date, configName, count: 1 });

  console.log(`📅  ${outfit.date}  ·  Config: "${configName}"`);
  console.log(`    Outfit ID: ${outfit.id}`);

  for (const g of itemDetails) {
    if (!g) continue;
    const color = [g.color_primary, g.color_secondary].filter(Boolean).join("/");
    const pattern = g.pattern && g.pattern !== "solid" ? ` [${g.pattern}]` : "";
    const tags = g.aesthetic_tags?.length ? ` {${g.aesthetic_tags.join(", ")}}` : "";
    console.log(`    • [${(g.sub_type ?? "?").padEnd(18)}] ${g.title ?? "(no title)"}  –  ${g.brand ?? "(no brand)"}  |  ${color}${pattern}${tags}`);
  }
  console.log();
}

// ── 5. Summary of repeated combos ────────────────────────────────────────────

const repeatedCombos = [...seenCombos.entries()].filter(([, v]) => v.count > 1);
if (repeatedCombos.length) {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  REPEATED COMBOS (worn more than once)");
  console.log("═══════════════════════════════════════════════════════════════════\n");
  for (const [key, { date, count }] of repeatedCombos.sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ×${count}  (first seen: ${date})`);
    for (const part of key.split(" | ")) {
      console.log(`     - ${part}`);
    }
    console.log();
  }
}

// ── 6. Sub-type pairings audit ────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  SUB-TYPE COMBO FREQUENCY");
console.log("═══════════════════════════════════════════════════════════════════\n");

const comboCounts = new Map<string, number>();

for (const outfit of outfits) {
  const items = itemsByOutfit.get(outfit.id) ?? [];
  const subTypes = items
    .map((i) => garmentMap.get(i.garment_id)?.sub_type ?? "?")
    .sort()
    .join(" + ");
  comboCounts.set(subTypes, (comboCounts.get(subTypes) ?? 0) + 1);
}

[...comboCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([combo, count]) => {
    console.log(`  ${count.toString().padStart(3)}×  ${combo}`);
  });

console.log("\n✅  Done.");
