#!/usr/bin/env node
// Verify the directional penalty ≥2-tag fix:
//  1. Existing bad combos still score low (regression guard)
//  2. Barbour plaid shirt + Barbour jacket now scores reasonably (fix validation)
// Run: npx tsx --env-file=.env.local scripts/test-pair-scores-v2.mts

import { createClient } from "@supabase/supabase-js";
import { scoreOutfit } from "../lib/scoring.js";
import type { GarmentForScoring } from "../lib/scoring.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function fetchOne(brand: string, subTypeIlike: string): Promise<GarmentForScoring | null> {
  const { data } = await sb
    .from("streetwear_products")
    .select("id,brand,title,sub_type,color_primary,color_secondary,pattern,formality,material,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image_url")
    .eq("brand", brand)
    .ilike("sub_type", `%${subTypeIlike}%`)
    .eq("analyzed", true)
    .not("aesthetic_tags", "is", null)
    .limit(1);
  if (!data?.length) return null;
  const r = data[0];
  return {
    id: r.id, title: r.title, brand: r.brand, sub_type: r.sub_type,
    material: r.material ?? null, color_primary: r.color_primary,
    color_secondary: r.color_secondary ?? null, pattern: r.pattern ?? null,
    formality: r.formality ?? null, aesthetic_tags: r.aesthetic_tags,
    pros: r.pros ?? null, cons: r.cons ?? null, color_pairings: r.color_pairings ?? null,
    color_clashes: r.color_clashes ?? null, tags: r.tags ?? null, image: r.image_url ?? null,
  };
}

// Also allow creating synthetic items with explicit tags for the Barbour test
function synthetic(brand: string, sub_type: string, color: string, tags: string[]): GarmentForScoring {
  return {
    id: `synth-${brand}-${sub_type}`.replace(/\s/g,"-"),
    title: `${brand} ${sub_type}`, brand, sub_type,
    color_primary: color, color_secondary: null, pattern: null,
    formality: "casual", material: null, aesthetic_tags: tags,
    pros: null, cons: null, color_pairings: null, color_clashes: null,
    tags: null, image: null,
  };
}

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  PAIR SCORE REGRESSION + FIX VALIDATION");
console.log("═══════════════════════════════════════════════════════════════════\n");

// ── Fetch real DB items ────────────────────────────────────────────────────────
const [dickiesFlannel, apresseHarrington, stussyTee, barbourShirt, barbourJacket, barbourJacketAlt] = await Promise.all([
  fetchOne("Dickies", "flannel"),
  fetchOne("A.PRESSE", "harrington"),
  fetchOne("Stussy", "t-shirt"),
  fetchOne("Barbour", "shirt"),      // plaid workwear shirt
  fetchOne("Barbour", "jacket"),     // wax jacket (quiet-luxury)
  fetchOne("Barbour", "jacket"),     // same
]);

// ── Synthetic items for robust Barbour test (simulating the exact DB tag scenario) ──
const synthBarbourShirt  = synthetic("Barbour", "Shirt",   "Plaid",      ["workwear"]);           // 1 tag
const synthBarbourJacket = synthetic("Barbour", "Jacket",  "Olive",      ["quiet-luxury"]);        // 1 tag
const synthDickiesFlannel = synthetic("Dickies","Flannel Shirt","Olive",  ["workwear","americana"]); // 2 tags
const synthHarrington    = synthetic("A.PRESSE","Harrington Jacket","Khaki",["quiet-luxury","old-money"]); // 2 tags
const synthJeans         = synthetic("Levi's", "Jeans",    "Blue",        ["casual"]);
const synthBoots         = synthetic("Common Projects","Boot","Black",     ["quiet-luxury"]);
const synthSneakers      = synthetic("Nike",   "Sneakers", "White",       ["streetwear","athleisure"]);

function testPair(label: string, items: GarmentForScoring[], expectLow: boolean) {
  const score = scoreOutfit(items);
  const pass = expectLow ? score < 65 : score >= 65;
  const verdict = pass ? "✔ PASS" : "✘ FAIL";
  const emoji = score >= 80 ? "✅" : score >= 65 ? "⚠️ " : "❌";
  console.log(`${verdict}  ${emoji} Score: ${score.toString().padStart(3)}  ${label}`);
  if (!pass) {
    console.log(`       Expected: ${expectLow ? "<65 (penalized)" : "≥65 (valid)"}`);
  }
  return pass;
}

const results: boolean[] = [];

console.log("── Regression guard (bad combos must still score low) ──────────────");
// Real DB items
if (dickiesFlannel && apresseHarrington) {
  const jeans = synthJeans;
  const snkr  = synthSneakers;
  results.push(testPair(
    "Dickies flannel + A.PRESSE harrington (classic bad combo)",
    [dickiesFlannel, apresseHarrington, jeans, snkr],
    true,
  ));
}
// Synthetic items — exact 2-tag scenario that should still fire
results.push(testPair(
  "Synth: Dickies flannel [workwear,americana] + A.PRESSE harrington [quiet-luxury,old-money]",
  [synthDickiesFlannel, synthHarrington, synthJeans, synthBoots],
  true,
));

console.log("\n── Fix validation (Barbour shirt + jacket must NOT be harshly penalized) ──");
// Synthetic 1-tag Barbour items — key fix case
results.push(testPair(
  "Synth: Barbour shirt [workwear] + Barbour jacket [quiet-luxury] (1 tag each — NO penalty)",
  [synthBarbourShirt, synthBarbourJacket, synthJeans, synthBoots],
  false, // should score ≥65 (valid heritage layering)
));

// Real DB Barbour items (if available)
if (barbourShirt && barbourJacket) {
  console.log(`       Real DB: Barbour shirt tags=${JSON.stringify(barbourShirt.aesthetic_tags)}, jacket tags=${JSON.stringify(barbourJacket.aesthetic_tags)}`);
  results.push(testPair(
    `Real DB: Barbour shirt + Barbour jacket (tags shown above)`,
    [barbourShirt, barbourJacket, synthJeans, synthBoots],
    false,
  ));
}

console.log("\n── Additional valid combos still scoring well ──────────────────────");
if (stussyTee && apresseHarrington) {
  results.push(testPair(
    "Stussy tee + A.PRESSE harrington (tee is neutral — no penalty)",
    [stussyTee, apresseHarrington, synthJeans, synthSneakers],
    false,
  ));
}

const passed = results.filter(Boolean).length;
const total  = results.length;
console.log(`\n${"─".repeat(67)}`);
console.log(`  ${passed}/${total} tests passed`);
if (passed === total) {
  console.log("  ✅ All tests passing — directional penalty fix is correct\n");
} else {
  console.log("  ✘ Some tests failed — review needed\n");
}
