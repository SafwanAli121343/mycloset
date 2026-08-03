#!/usr/bin/env node
// Batch analyze pros/cons for all saved outfits in the user's DB.
// Skips outfits that already have pros/cons stored. Runs sequentially
// to avoid OpenAI rate limits.
//
// Run: npx tsx --env-file=.env.local scripts/analyze-all-outfits.mts
// Flags:
//   --force   re-analyze even if pros/cons already exist
//   --dry     print outfits that would be analyzed, without calling GPT

import { createClient } from "@supabase/supabase-js";
import { analyzeOutfit, deriveOutfitAesthetic } from "../lib/outfitInference.js";
import type { GarmentForScoring } from "../lib/scoring.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";
const FORCE   = process.argv.includes("--force");
const DRY     = process.argv.includes("--dry");

// ── Fetch all outfits with their garment data ─────────────────────────────────

type OutfitRow = {
  id: string;
  date: string;
  notes: string | null;
  outfit_items: {
    garments: GarmentForScoring | null;
  }[];
};

const { data: outfits, error } = await sb
  .from("outfits")
  .select(`
    id, date, notes,
    outfit_items (
      garments (
        id, title, brand, sub_type, material,
        color_primary, color_secondary, pattern,
        formality, aesthetic_tags, pros, cons,
        color_pairings, color_clashes, tags, image
      )
    )
  `)
  .eq("user_id", USER_ID)
  .order("date", { ascending: true });

if (error) { console.error("DB error:", error.message); process.exit(1); }
if (!outfits?.length) { console.log("No outfits found."); process.exit(0); }

console.log(`Found ${outfits.length} outfits total.`);

// ── Filter to only those needing analysis ─────────────────────────────────────

const toAnalyze = (outfits as unknown as OutfitRow[]).filter(o => {
  if (FORCE) return true;
  try {
    const notes = JSON.parse(o.notes ?? "{}") as Record<string, unknown>;
    return !Array.isArray(notes.pros) || (notes.pros as string[]).length === 0;
  } catch { return true; }
});

console.log(`${toAnalyze.length} outfits need analysis${FORCE ? " (--force)" : ""}.`);

if (DRY) {
  for (const o of toAnalyze) {
    console.log(`  [DRY] ${o.date}  id=${o.id.slice(0, 8)}`);
  }
  process.exit(0);
}

// ── Analyze sequentially ──────────────────────────────────────────────────────

let ok = 0; let fail = 0; let skip = 0;

for (const outfit of toAnalyze) {
  const items = outfit.outfit_items
    .map(oi => oi.garments)
    .filter((g): g is GarmentForScoring => g != null);

  if (items.length === 0) {
    console.log(`  SKIP ${outfit.date} — no garments`);
    skip++;
    continue;
  }

  let existingNotes: Record<string, unknown> = {};
  try { existingNotes = JSON.parse(outfit.notes ?? "{}"); } catch {}

  const score      = typeof existingNotes.styleScore === "number" ? existingNotes.styleScore : 50;
  const configName = typeof existingNotes.configName === "string"  ? existingNotes.configName  : "outfit";
  const aesthetic  = deriveOutfitAesthetic(items);

  process.stdout.write(`  ${outfit.date}  ${items.length} pieces  score=${score} … `);

  try {
    const t0     = Date.now();
    const result = await analyzeOutfit(items, { score, configName, aesthetic });
    const ms     = Date.now() - t0;

    const updatedNotes = JSON.stringify({
      ...existingNotes,
      pros:        result.pros,
      cons:        result.cons,
      outfit_tags: result.outfit_tags,
    });

    const { error: upErr } = await sb
      .from("outfits")
      .update({ notes: updatedNotes })
      .eq("id", outfit.id);

    if (upErr) {
      console.log(`✘ DB write: ${upErr.message}`);
      fail++;
    } else {
      console.log(`✓ (${ms}ms)  tags: ${result.outfit_tags.slice(0, 3).join(", ")}`);
      ok++;
    }
  } catch (err) {
    console.log(`✘ GPT error: ${(err as Error).message}`);
    fail++;
  }
}

console.log(`\nDone.  ok=${ok}  fail=${fail}  skip=${skip}`);
