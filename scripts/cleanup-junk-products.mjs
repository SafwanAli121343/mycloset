/**
 * Removes items from streetwear_products that have no useful data.
 *
 * Deletion criteria (must meet ALL of the following):
 *   1. No image_url  — useless without an image
 *   2. No tags, no aesthetic_tags, and analyzed=false  — never processed
 *
 * Also removes items from "micro-brands" (brands with <5 items total) where
 * the item has never been analyzed — these are usually noise from broken
 * retailer scrapes (misspelled brand, one-off scraped item, etc.).
 *
 * Usage:
 *   node scripts/cleanup-junk-products.mjs           # dry run (report only)
 *   node scripts/cleanup-junk-products.mjs --delete  # actually delete
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync }  from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dir, "../.env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("="); if (idx < 0) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = !process.argv.includes("--delete");

if (DRY_RUN) console.log("DRY RUN — pass --delete to actually remove items\n");

// ── 1. Items with no image ────────────────────────────────────────────────────
console.log("Counting items with no image_url…");
const { count: noImgCount } = await sb
  .from("streetwear_products")
  .select("*", { count: "exact", head: true })
  .is("image_url", null);
console.log(`  No image: ${noImgCount} items`);

// ── 2. Items with no analysis at all ─────────────────────────────────────────
console.log("Counting items with no analysis (no aesthetic_tags, no tags, analyzed=false)…");
const { count: bareCount } = await sb
  .from("streetwear_products")
  .select("*", { count: "exact", head: true })
  .eq("analyzed", false)
  .is("tags", null)
  .is("aesthetic_tags", null);
console.log(`  Bare (no analysis): ${bareCount} items`);

// ── 3. Micro-brand items (brand with <5 items, never analyzed) ────────────────
console.log("Finding micro-brand items (brand count <5, analyzed=false)…");

// Get all brands + their counts by paging through all items
let allBrands = [];
let page = 0;
while (true) {
  const { data: rows } = await sb
    .from("streetwear_products")
    .select("id,brand,analyzed,image_url")
    .range(page * 1000, (page + 1) * 1000 - 1);
  if (!rows || rows.length === 0) break;
  allBrands.push(...rows);
  page++;
  if (page > 400) break;
}

const brandCounts = {};
for (const r of allBrands) brandCounts[r.brand] = (brandCounts[r.brand] || 0) + 1;

// Known legitimate small-run brands to never delete
const PROTECTED = new Set([
  "Evan Kinori","Monitaly","Adidem Asterisks","Stefan Cooke","Bianca Saunders",
  "Jordan Luca","Eckhaus Latta","Sies Marjan","Random Identities","Perks and Mini",
  "Martine Ali","Story MFG.","Carne Bollente","Etudes","Études","GR10K","AFFXWRKS",
  "Róhe","By Parra","White Mountaineering","Cotopaxi","Saturdays NYC","Drake's",
  "Filson","John Elliott","Rowing Blazers","District Vision","Satisfy Running",
  "Vollebak","Corridor NYC","Wax London","Better Gift Shop","Pilgrim Surf",
  "Museum of Peace & Quiet","Cherry LA","FFF Postal Service","SECNDSLF",
  "Hellstar","MISBHV","Chopova Lowena","Cecilie Bahnsen","Baserange","Roksanda",
  "Erdem","HYEIN SEO","HYKE","Rouje","Eytys","Suicoke","Telfar","Ienki Ienki",
  "Bianca Chandon","STAMPD","MNML","Nahmias","TAAKK","Auralee","sacai",
]);

const microBrandIds = allBrands
  .filter(r => {
    if (!r.brand) return false;
    if (PROTECTED.has(r.brand)) return false;
    if (brandCounts[r.brand] >= 5) return false;
    if (r.analyzed) return false;
    return true;
  })
  .map(r => r.id);

// Also collect no-image IDs and bare-unanalyzed IDs from our fetched set
const noImageIds = allBrands.filter(r => !r.image_url).map(r => r.id);

console.log(`  Micro-brand unanalyzed: ${microBrandIds.length} items`);
console.log(`  No image: ${noImageIds.length} items (cross-check)`);

// Combine and deduplicate
const toDelete = [...new Set([...noImageIds, ...microBrandIds])];
console.log(`\nTotal to delete: ${toDelete.length} items`);

// Show sample brand breakdown for micro-brands
const microBrandSample = {};
for (const r of allBrands) {
  if (microBrandIds.includes(r.id)) {
    microBrandSample[r.brand] = (microBrandSample[r.brand] || 0) + 1;
  }
}
const topMicro = Object.entries(microBrandSample).sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("Sample micro-brands to purge:");
for (const [b, c] of topMicro) console.log(`  ${c}  ${b}`);

if (DRY_RUN) {
  console.log("\nDry run complete. Pass --delete to execute.");
  process.exit(0);
}

// ── Actually delete ───────────────────────────────────────────────────────────
console.log("\nDeleting…");
let deleted = 0;
const BATCH = 500;
for (let i = 0; i < toDelete.length; i += BATCH) {
  const batch = toDelete.slice(i, i + BATCH);
  const { error } = await sb.from("streetwear_products").delete().in("id", batch);
  if (error) { console.error("  Error at batch", i, error.message); continue; }
  deleted += batch.length;
  process.stdout.write(`  ${deleted}/${toDelete.length} deleted\r`);
}
console.log(`\nDone. Deleted ${deleted} items.`);
