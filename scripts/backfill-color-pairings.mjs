// Backfills color_pairings and color_clashes for ALL analyzed products
// using the deterministic fashion color algorithm (replaces GPT-generated values).
//
// Usage:
//   node scripts/backfill-color-pairings.mjs
//   node scripts/backfill-color-pairings.mjs --dry-run   # print without writing
//   node scripts/backfill-color-pairings.mjs --limit 50  # cap rows

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getItemColorPairings, getItemColorClashes } from "./color-pairings.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dir, "../.env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("="); if (idx < 0) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch {}

const SUPABASE_URL = "https://jhnwystsohdgzuvqnouy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const args = process.argv.slice(2);
const dryRun  = args.includes("--dry-run");
const limitArg = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 5000;

const PAGE_SIZE = 1000; // Supabase max per request

async function main() {
  console.log(`Starting full backfill of color_pairings/clashes (paginated)...`);
  let updated = 0, skipped = 0, failed = 0, page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data: products, error } = await sb
      .from("streetwear_products")
      .select("id,title,brand,color_primary,color_secondary,tags")
      .eq("analyzed", true)
      .not("color_primary", "is", null)
      .order("id")
      .range(from, to);

    if (error) { console.error("Fetch error:", error.message); break; }
    if (!products?.length) break; // no more pages

    const total_so_far = updated + skipped + failed;
    if (total_so_far % 5000 === 0 || page === 0) {
      process.stdout.write(`\n[page ${page + 1}] `);
    }

    // Group by color key to avoid recomputing the same pairings repeatedly
    const byColorKey = new Map();
    for (const p of products) {
      const itemColors = p.tags?.colors?.length
        ? p.tags.colors
        : [p.color_primary, p.color_secondary].filter(Boolean);
      if (!itemColors.length) { skipped++; continue; }

      const key = itemColors.join("|");
      if (!byColorKey.has(key)) {
        byColorKey.set(key, {
          ids: [],
          pairings: getItemColorPairings(itemColors),
          clashes:  getItemColorClashes(itemColors),
        });
      }
      byColorKey.get(key).ids.push(p.id);
    }

    if (dryRun) {
      for (const [key, { ids, pairings, clashes }] of byColorKey) {
        console.log(`\n${key}: pairings=${pairings.length} clashes=${clashes.length} (${ids.length} items)`);
      }
      updated += products.length;
      page++;
      if (products.length < PAGE_SIZE) break;
      continue;
    }

    // Batch update by color group
    for (const { ids, pairings, clashes } of byColorKey.values()) {
      const { error: dbErr } = await sb
        .from("streetwear_products")
        .update({ color_pairings: pairings, color_clashes: clashes })
        .in("id", ids);

      if (dbErr) {
        console.error(`\n✗ batch error: ${dbErr.message}`);
        failed += ids.length;
      } else {
        process.stdout.write(".");
        updated += ids.length;
      }
    }

    page++;
    if (products.length < PAGE_SIZE) break; // last page
    if (limitArg < Infinity && updated >= limitArg) break;

    await new Promise(r => setTimeout(r, 100)); // brief pause between pages
  }

  console.log(`\n\nDone. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed} (${page} pages)`);
}

main().catch(e => console.error("FATAL:", e.message));
