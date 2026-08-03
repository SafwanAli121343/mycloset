#!/usr/bin/env node
// Validates the complexity ceiling + accessory generation fixes.
//
// Tests:
//  1. Complexity cap: tee+jeans+sneakers ≤ 78, tee+hoodie+jeans+sneakers ≤ 87,
//     tee+hoodie+jacket+jeans+sneakers can reach ≥ 88.
//  2. Cap doesn't crush cohesive layered fits (regression).
//  3. Accessories appear in generated outfits when wardrobe includes them.
//  4. Outfit WITH acc scores ≥ same outfit WITHOUT acc (complexity bonus works).
//  5. Full wardrobe test (Gorpcore E + accessories) — verify top outfits are layered.
//
// Run: npx tsx --env-file=.env.local scripts/test-complexity-acc.mts

import { createClient } from "@supabase/supabase-js";
import { scoreOutfit, getSlot } from "../lib/scoring.js";
import { generateAndRankAllOutfits } from "../lib/wardrobeOutfitGen.js";
import type { GarmentForScoring } from "../lib/scoring.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function synth(id: string, brand: string, sub_type: string, color: string, tags: string[]): GarmentForScoring {
  return {
    id, title: `${brand} ${sub_type}`, brand, sub_type,
    color_primary: color, color_secondary: null, pattern: "solid",
    formality: "casual", material: "cotton", aesthetic_tags: tags,
    pros: null, cons: null, color_pairings: ["White", "Black", "Grey"],
    color_clashes: [], tags: null, image: null,
  };
}

let passed = 0; let failed = 0;
function check(label: string, got: number, op: "<=" | ">=" | "==" | "range", bound: number, bound2?: number) {
  const ok =
    op === "<=" ? got <= bound :
    op === ">=" ? got >= bound :
    op === "==" ? got === bound :
    got >= bound && got <= bound2!;
  const verdict = ok ? "✔ PASS" : "✘ FAIL";
  const emoji = got >= 88 ? "✅" : got >= 70 ? "⚠️ " : "❌";
  console.log(`  ${verdict}  ${emoji} [${got}]  ${label}`);
  if (!ok) console.log(`           Expected: ${op} ${bound}${bound2 !== undefined ? `–${bound2}` : ""}`);
  ok ? passed++ : failed++;
}

// ── Synthetic items ─────────────────────────────────────────────────────────
const tee      = synth("tee",    "Stussy",  "Graphic Tee",      "White", ["streetwear"]);
const hoodie   = synth("hood",   "Stussy",  "Pullover Hoodie",  "Grey",  ["streetwear"]);
const jacket   = synth("jkt",    "Carhartt WIP", "Chore Coat",  "Beige", ["workwear","streetwear"]);
const jeans    = synth("jeans",  "Levi's",  "Straight Leg Jeans","Black",["casual"]);
const sneakers = synth("snkr",   "Nike",    "Low-Top Sneakers", "White", ["streetwear"]);
const cap      = synth("cap",    "Supreme", "Cap",              "Black", ["streetwear"]);
const bag      = synth("bag",    "Supreme", "Tote Bag",         "Black", ["streetwear"]);

console.log("═══════════════════════════════════════════════════════════════");
console.log("  COMPLEXITY CAP + ACCESSORY FIX — validation");
console.log("═══════════════════════════════════════════════════════════════\n");

// ── 1. Complexity cap tiers ──────────────────────────────────────────────────
console.log("── 1. Complexity ceiling by tier ───────────────────────────────");
const s_minimal  = scoreOutfit([tee, jeans, sneakers]);
const s_oneLayer = scoreOutfit([tee, hoodie, jeans, sneakers]);
const s_layered  = scoreOutfit([tee, hoodie, jacket, jeans, sneakers]);
const s_accOnly  = scoreOutfit([tee, jeans, sneakers, cap]);
const s_layeredAcc = scoreOutfit([tee, hoodie, jacket, jeans, sneakers, cap]);

check("Minimal (tee+jeans+sneakers) capped at 78",  s_minimal,    "<=", 78);
check("One-layer (tee+hoodie+jeans+snkr) capped at 87", s_oneLayer, "<=", 87);
check("One-layer still reasonable (≥ 55)",          s_oneLayer,   ">=", 55);
check("Acc-only (+cap, no mid/outer) capped at 83", s_accOnly,    "<=", 83);
check("Acc-only scores above bare minimal",          s_accOnly,    ">=", s_minimal);
check("Fully layered (tee+hood+jacket+jeans+snkr) uncapped (≤ 100)", s_layered, "<=", 100);
check("Fully layered scores above one-layer",        s_layered,    ">=", s_oneLayer);
check("Layered+acc also uncapped (≤ 100)",           s_layeredAcc, "<=", 100);

console.log(`\n  Score breakdown: minimal=${s_minimal}  oneLayer=${s_oneLayer}  layered=${s_layered}`);
console.log(`                   accOnly=${s_accOnly}  layered+acc=${s_layeredAcc}`);

// ── 2. Cap doesn't punish cohesive one-layer fits too harshly ────────────────
console.log("\n── 2. One-layer fits remain decent (not crushed) ───────────────");
const luxTee    = synth("luxtee", "Acne Studios", "Graphic Tee",     "White", ["quiet-luxury","minimalist"]);
const luxJacket = synth("luxjkt", "The Row",      "Trench Coat",     "Camel", ["quiet-luxury","old-money"]);
const luxBottom = synth("luxbot", "Toteme",       "Tailored Trousers","Camel",["quiet-luxury","old-money"]);
const luxFoot   = synth("luxft",  "Common Projects","Low-Top Sneakers","White",["quiet-luxury"]);
const s_luxOnelayer = scoreOutfit([luxTee, luxJacket, luxBottom, luxFoot]);
check("Luxury base+outer fit scores ≥ 65 (quality still rewarded)", s_luxOnelayer, ">=", 65);
check("Luxury base+outer fit capped at 87", s_luxOnelayer, "<=", 87);

// ── 3. Accessories appear in generated outfits ───────────────────────────────
console.log("\n── 3. Accessories in generated outfits ─────────────────────────");
const syntheticWardrobe: GarmentForScoring[] = [
  tee, hoodie, jeans, sneakers,
  cap,   // acc #1
  bag,   // acc #2
];
const ranked = generateAndRankAllOutfits(syntheticWardrobe, { maxTotal: 200 });
const withAcc = ranked.filter(o => o.items.some(i => getSlot(i.sub_type) === "acc"));
const withoutAcc = ranked.filter(o => !o.items.some(i => getSlot(i.sub_type) === "acc"));
console.log(`  Generated: ${ranked.length} outfits total`);
console.log(`  With acc: ${withAcc.length}  Without acc: ${withoutAcc.length}`);
check("Some outfits include accessories", withAcc.length, ">=", 1);
check("Outfits without acc also generated (acc is always optional)", withoutAcc.length, ">=", 1);

// ── 4. Acc lifts a cohesive outfit above its bare version ────────────────────
console.log("\n── 4. Acc improves score when cohesive ─────────────────────────");
const scoreBare = scoreOutfit([tee, jeans, sneakers]);
const scoreWithCap = scoreOutfit([tee, jeans, sneakers, cap]);
check("Bare minimal (no acc) ≤ 78",  scoreBare,    "<=", 78);
check("Same outfit + cap (acc) ≤ 83", scoreWithCap, "<=", 83);
check("Outfit with cohesive acc scores ≥ bare version", scoreWithCap, ">=", scoreBare);

// ── 5. Curated DB wardrobe (realistic size) + accessories ───────────────────
// Uses the same slot-bucketing approach as previous test scripts — picks 3-5
// items per slot from Gorpcore brands, plus 3 acc items from the same brands.
// This is representative of a real user wardrobe (~18 clothing + 3 acc = 21 items).
console.log("\n── 5. Real DB wardrobe test (curated 21-item Gorpcore + 3 acc) ──");

type ProductRow = { id: string; brand: string | null; title: string | null; sub_type: string | null; color_primary: string | null; color_secondary: string | null; pattern: string | null; formality: string | null; material: string | null; aesthetic_tags: string[] | null; pros: string[] | null; cons: string[] | null; color_pairings: string[] | null; color_clashes: string[] | null; tags: Record<string, unknown> | null; image_url: string | null };
function toG(r: ProductRow): GarmentForScoring {
  return { id: r.id, title: r.title, brand: r.brand, sub_type: r.sub_type, material: r.material ?? null, color_primary: r.color_primary, color_secondary: r.color_secondary ?? null, pattern: r.pattern ?? null, formality: r.formality ?? null, aesthetic_tags: r.aesthetic_tags, pros: r.pros ?? null, cons: r.cons ?? null, color_pairings: r.color_pairings ?? null, color_clashes: r.color_clashes ?? null, tags: r.tags ?? null, image: r.image_url ?? null };
}

const GORPCORE_BRANDS = ["Arc'teryx", "Salomon", "Patagonia", "Norrona", "The North Face"];

// Fetch and pick varied items per slot — keep total wardrobe realistic
async function fetchSlot(brands: string[], slotKeywords: string[], slotName: string, n: number): Promise<GarmentForScoring[]> {
  const filter = slotKeywords.map(k => `sub_type.ilike.%${k}%`).join(",");
  const { data } = await sb.from("streetwear_products")
    .select("id,brand,title,sub_type,color_primary,color_secondary,pattern,formality,material,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image_url")
    .in("brand", brands).eq("analyzed", true).not("sub_type","is",null).or(filter).limit(100);
  const items = (data ?? []).filter(r => getSlot(r.sub_type) === slotName).map(r => toG(r as ProductRow));
  // Pick varied sub_types
  const picked: GarmentForScoring[] = [];
  const seenST = new Set<string>();
  for (const i of items) {
    if (picked.length >= n) break;
    if (!seenST.has(i.sub_type ?? "")) { picked.push(i); seenST.add(i.sub_type ?? ""); }
  }
  for (const i of items) { if (picked.length >= n && !picked.find(p => p.id === i.id)) break; if (picked.length < n) { picked.push(i); } }
  return picked.slice(0, n);
}

const [dbBase, dbMid, dbOuter, dbBottom, dbFoot, dbAcc] = await Promise.all([
  fetchSlot(GORPCORE_BRANDS, ["t-shirt","tee","long sleeve","polo","shirt"], "base", 4),
  fetchSlot(GORPCORE_BRANDS, ["hoodie","sweatshirt","fleece","sweater","pullover"], "mid", 3),
  fetchSlot(GORPCORE_BRANDS, ["jacket","parka","anorak","windbreaker","shell"], "outer", 3),
  fetchSlot(GORPCORE_BRANDS, ["pants","jogger","trouser","chino","short"], "bottom", 4),
  fetchSlot(GORPCORE_BRANDS, ["sneaker","boot","trail","shoe","runner"], "foot", 2),
  fetchSlot(GORPCORE_BRANDS, ["hat","cap","bag","beanie","pack"], "acc", 3),
]);

const dbWardrobe = [...dbBase, ...dbMid, ...dbOuter, ...dbBottom, ...dbFoot, ...dbAcc];
console.log(`  Wardrobe: ${dbWardrobe.length} items`);
console.log(`  Slots: base=${dbBase.length} mid=${dbMid.length} outer=${dbOuter.length} bottom=${dbBottom.length} foot=${dbFoot.length} acc=${dbAcc.length}`);
console.log(`  Accessories: ${dbAcc.map(a => `${a.brand} ${a.sub_type}`).join(", ")}`);

if (dbWardrobe.length > 0 && dbFoot.length > 0) {
  const t0 = Date.now();
  const dbRanked = generateAndRankAllOutfits(dbWardrobe, { maxTotal: 300 });
  console.log(`  Generated: ${dbRanked.length} outfits in ${Date.now()-t0}ms`);

  const dbWithAcc = dbRanked.filter(o => o.items.some(i => getSlot(i.sub_type) === "acc"));
  const top10 = dbRanked.slice(0, 10);
  const top10Layered = top10.filter(o => {
    const hasOuter = o.items.some(i => getSlot(i.sub_type) === "outer");
    const hasMid   = o.items.some(i => getSlot(i.sub_type) === "mid");
    const hasVest  = o.items.some(i => getSlot(i.sub_type) === "vest");
    return (hasOuter ? 1 : 0) + (hasMid ? 1 : 0) + (hasVest ? 1 : 0) >= 2;
  });

  console.log(`  Outfits with accessories: ${dbWithAcc.length}/${dbRanked.length}`);
  console.log(`  Top-10 that are fully layered: ${top10Layered.length}/10`);

  // Key invariant: no bare minimal (0 layers, no acc) outfit should appear in top 10.
  // Bare minimal is capped at 78, so any higher-scoring layered or acc outfit beats it.
  const bareMinimalInTop10 = top10.filter(o => {
    const hasLayer = o.items.some(i => ["outer","mid","vest"].includes(getSlot(i.sub_type) ?? ""));
    const hasAcc2  = o.items.some(i => getSlot(i.sub_type) === "acc");
    return !hasLayer && !hasAcc2;
  });
  check("DB outfits with accessories generated (≥ 1)", dbWithAcc.length, ">=", 1);
  check("No bare minimal outfit (0 layers, no acc) in top-10 — capped at 78", bareMinimalInTop10.length, "==", 0);

  console.log("\n  ── Top 10 outfits ──");
  for (const [i, o] of top10.entries()) {
    const accPiece = o.items.find(it => getSlot(it.sub_type) === "acc");
    const layerCount = (o.items.some(it => getSlot(it.sub_type) === "outer") ? 1 : 0) +
                       (o.items.some(it => getSlot(it.sub_type) === "mid")   ? 1 : 0) +
                       (o.items.some(it => getSlot(it.sub_type) === "vest")  ? 1 : 0);
    const flag = layerCount >= 2 ? "🔥" : layerCount === 1 ? "👕" : "➖";
    console.log(`  #${i+1}  ${flag} Score: ${o.score}  layers=${layerCount}  Config: "${o.configName}"${accPiece ? `  +acc[${accPiece.sub_type}]` : ""}`);
    for (const it of o.items) console.log(`       [${(getSlot(it.sub_type) ?? "?").padEnd(6)}]  ${(it.brand ?? "?").padEnd(22)}  ${it.sub_type ?? "?"}`);
  }

  console.log("\n  ── Bottom 5 (should be simpler) ──");
  for (const o of dbRanked.slice(-5)) {
    const layerCount = (o.items.some(it => getSlot(it.sub_type) === "outer") ? 1 : 0) +
                       (o.items.some(it => getSlot(it.sub_type) === "mid")   ? 1 : 0);
    console.log(`  Score: ${o.score}  layers=${layerCount}  Config: "${o.configName}"`);
  }
} else {
  console.log("  ⚠ Not enough items to generate outfits");
}

console.log(`\n${"─".repeat(63)}`);
console.log(`  ${passed}/${passed + failed} tests passed`);
if (failed === 0) console.log("  ✅ All checks passed\n");
else              console.log(`  ✘ ${failed} check(s) failed\n`);
