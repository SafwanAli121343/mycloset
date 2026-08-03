#!/usr/bin/env node
// Recheck Wardrobe F (Luxury Prep) scores after the ≥2-tag directional penalty fix.
// Looking specifically at the Barbour plaid shirt combos that were scoring 38.
// Run: npx tsx --env-file=.env.local scripts/test-wardrobe-f-recheck.mts

import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits, type RankedOutfit } from "../lib/wardrobeOutfitGen.js";
import type { GarmentForScoring } from "../lib/scoring.js";
import { getSlot } from "../lib/scoring.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ProductRow = {
  id: string; brand: string | null; title: string | null;
  sub_type: string | null; color_primary: string | null;
  color_secondary: string | null; pattern: string | null;
  formality: string | null; material: string | null;
  aesthetic_tags: string[] | null; pros: string[] | null;
  cons: string[] | null; color_pairings: string[] | null;
  color_clashes: string[] | null;
  tags: { colors?: string[]; [key: string]: unknown } | null;
  image_url: string | null;
};

function toGarment(r: ProductRow): GarmentForScoring {
  return {
    id: r.id, title: r.title, brand: r.brand, sub_type: r.sub_type,
    material: r.material ?? null, color_primary: r.color_primary,
    color_secondary: r.color_secondary ?? null, pattern: r.pattern ?? null,
    formality: r.formality ?? null, aesthetic_tags: r.aesthetic_tags,
    pros: r.pros ?? null, cons: r.cons ?? null,
    color_pairings: r.color_pairings ?? null, color_clashes: r.color_clashes ?? null,
    tags: r.tags ?? null, image: r.image_url ?? null,
  };
}

function classifySlot(subType: string | null): string | null {
  if (!subType) return null;
  const l = subType.toLowerCase();
  if (l.includes("sneaker") || l.includes("boot") || l.includes("loafer") || l.includes("slide") || l.includes("sandal") || l.includes("shoe") || l.includes("slipper")) return "foot";
  if (l.includes("jacket") || l.includes("windbreaker") || l.includes("blazer") || l.includes("trench") || l.includes("overshirt") || l.includes("shacket")) return "outer";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("sweater") || l.includes("cardigan") || l.includes("pullover") || l.includes("crewneck") || l.includes("fleece") || l.includes("turtleneck") || l.includes("knit")) return "mid";
  if (l.includes("t-shirt") || l.includes("polo") || l.includes("henley") || l.includes("tank") || l.includes("blouse") || l.includes("long sleeve") || l.includes("jersey") || l.includes("tee") || (l.includes("shirt") && !l.includes("sweatshirt"))) return "base";
  if (l.includes("jean") || l.includes("pant") || l.includes("trouser") || l.includes("chino") || l.includes("short") || l.includes("jogger") || l.includes("skirt")) return "bottom";
  return getSlot(subType);
}

const SLOT_PATTERNS: Record<string, string[]> = {
  foot:   ["sneaker", "boot", "loafer", "slide", "sandal", "shoe", "slipper"],
  outer:  ["jacket", "windbreaker", "blazer", "trench", "overshirt", "shacket"],
  mid:    ["hoodie", "sweatshirt", "sweater", "cardigan", "pullover", "crewneck", "fleece", "turtleneck", "knit"],
  base:   ["t-shirt", "shirt", "polo", "henley", "tank", "blouse", "long sleeve", "jersey", "graphic tee"],
  bottom: ["jeans", "pants", "trouser", "chino", "shorts", "jogger", "sweatpants", "cargo pants", "track pants", "skirt"],
};

async function fetchSlot(brands: string[], slot: string): Promise<GarmentForScoring[]> {
  const filter = SLOT_PATTERNS[slot].map(k => `sub_type.ilike.%${k}%`).join(",");
  const { data } = await sb.from("streetwear_products").select("id,brand,title,sub_type,color_primary,color_secondary,pattern,formality,material,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image_url").in("brand", brands).eq("analyzed", true).not("sub_type", "is", null).or(filter).limit(200);
  return (data ?? []).filter(r => classifySlot(r.sub_type) === slot).map(r => toGarment(r as ProductRow));
}

function pickVaried(items: GarmentForScoring[], n: number): GarmentForScoring[] {
  const picked: GarmentForScoring[] = [];
  const seen = new Set<string>();
  const seenST = new Set<string>();
  for (const i of items) {
    if (picked.length >= n) break;
    const st = (i.sub_type ?? "").toLowerCase();
    if (!seen.has(i.id) && !seenST.has(st)) { picked.push(i); seen.add(i.id); seenST.add(st); }
  }
  for (const i of items) {
    if (picked.length >= n) break;
    if (!seen.has(i.id)) { picked.push(i); seen.add(i.id); }
  }
  return picked;
}

const BRANDS = ["Polo Ralph Lauren", "Barbour", "Drake's", "Sid Mashburn", "Pendleton"];
const FOOT_BRANDS = ["Polo Ralph Lauren", "Allen Edmonds", "Alden", "Quoddy", "Barbour", "Common Projects"];

const wardrobe: GarmentForScoring[] = [];
for (const [slot, n] of [["base",4],["mid",2],["outer",2],["bottom",3]] as [string,number][]) {
  const items = await fetchSlot(BRANDS, slot);
  wardrobe.push(...pickVaried(items, n));
}
const footItems = await fetchSlot(FOOT_BRANDS, "foot");
wardrobe.push(...pickVaried(footItems, 1));

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  WARDROBE F RECHECK — after ≥2-tag directional penalty fix");
console.log("═══════════════════════════════════════════════════════════════════\n");

console.log("  Inventory (with aesthetic_tags):");
for (const item of wardrobe) {
  const slot = classifySlot(item.sub_type) ?? "?";
  const tags = JSON.stringify(item.aesthetic_tags ?? []);
  console.log(`    [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(24)}  ${(item.sub_type ?? "?").padEnd(28)}  ${(item.color_primary ?? "").padEnd(12)}  ${tags}`);
}

const ranked = generateAndRankAllOutfits(wardrobe, { maxTotal: 200 });
const scores = ranked.map(o => o.score);
const minS = Math.min(...scores);
const maxS = Math.max(...scores);
const avgS = scores.reduce((a, b) => a + b, 0) / scores.length;

console.log(`\n  Generated ${ranked.length} outfits`);
console.log(`  Score range: ${minS}–${maxS}  avg ${avgS.toFixed(1)}`);
const great = scores.filter(s => s >= 80).length;
const ok    = scores.filter(s => s >= 65 && s < 80).length;
const mid   = scores.filter(s => s >= 50 && s < 65).length;
const low   = scores.filter(s => s < 50).length;
console.log(`  Buckets: ✅ GREAT(≥80): ${great}  ⚠️ OK(65-79): ${ok}  ⚠️ MID(50-64): ${mid}  ❌ LOW(<50): ${low}`);

console.log("\n  ── BOTTOM 10 (checking if Barbour plaid shirt combos improved) ──");
ranked.slice(-10).forEach((outfit, i) => {
  const score = outfit.score;
  const emoji = score >= 80 ? "✅" : score >= 65 ? "⚠️ " : score >= 50 ? "⚠️ " : "❌";
  console.log(`  #${ranked.length - 9 + i}  ${emoji} Score: ${score}  Config: "${outfit.configName}"`);
  for (const item of outfit.items) {
    const slot = classifySlot(item.sub_type) ?? "?";
    const tags = JSON.stringify(item.aesthetic_tags ?? []);
    console.log(`       [${slot.padEnd(6)}]  ${(item.brand ?? "?").padEnd(22)}  ${(item.sub_type ?? "?").padEnd(26)}  ${tags}`);
  }
});

console.log("\n  ── TOP 5 (sanity check) ──");
ranked.slice(0, 5).forEach((outfit, i) => {
  console.log(`  #${i+1}  ✅ Score: ${outfit.score}  Config: "${outfit.configName}"`);
  for (const item of outfit.items) {
    console.log(`       [${(classifySlot(item.sub_type) ?? "?").padEnd(6)}]  ${(item.brand ?? "?").padEnd(22)}  ${item.sub_type ?? "?"}`);
  }
});

console.log("\n✅  Done.\n");
