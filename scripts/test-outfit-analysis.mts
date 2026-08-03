#!/usr/bin/env node
// Outfit pros/cons analysis test harness.
// Builds wardrobes from the scraped 300k DB, generates all feasible outfits,
// scores them, then calls GPT-4o on the top N to validate pros/cons quality.
//
// Run: npx tsx --env-file=.env.local scripts/test-outfit-analysis.mts
// Flags:
//   --top=N         how many outfits to analyze per wardrobe (default 5)
//   --wardrobe=NAME run only wardrobes whose name contains this string

import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits, type RankedOutfit } from "../lib/wardrobeOutfitGen.js";
import type { GarmentForScoring } from "../lib/scoring.js";
import { getSlot } from "../lib/scoring.js";
import { analyzeOutfit, deriveOutfitAesthetic } from "../lib/outfitInference.js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── CLI flags ─────────────────────────────────────────────────────────────────

const topFlag   = process.argv.find(a => a.startsWith("--top="));
const TOP_N     = topFlag ? parseInt(topFlag.split("=")[1]) : 5;
const filterArg = process.argv.find(a => a.startsWith("--wardrobe="))?.split("=")[1]?.toLowerCase();

// ── DB helpers ────────────────────────────────────────────────────────────────

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

function toGarment(row: ProductRow): GarmentForScoring {
  return {
    id: row.id, title: row.title, brand: row.brand, sub_type: row.sub_type,
    material: row.material ?? null, color_primary: row.color_primary,
    color_secondary: row.color_secondary ?? null, pattern: row.pattern ?? null,
    formality: row.formality ?? null, aesthetic_tags: row.aesthetic_tags,
    pros: row.pros ?? null, cons: row.cons ?? null,
    color_pairings: row.color_pairings ?? null, color_clashes: row.color_clashes ?? null,
    tags: row.tags ?? null, image: row.image_url ?? null,
  };
}

const SLOT_PATTERNS: Record<string, string[]> = {
  foot:   ["sneaker", "sneakers", "boot", "loafer", "slide", "sandal", "shoe", "slipper", "mule"],
  outer:  ["jacket", "windbreaker", "parka", "anorak", "peacoat", "blazer", "trench", "chore coat", "overshirt", "shacket", "harrington", "coach jacket"],
  mid:    ["hoodie", "sweatshirt", "sweater", "cardigan", "pullover", "crewneck", "fleece", "turtleneck", "quarter zip", "half zip", "knit"],
  base:   ["t-shirt", "shirt", "polo", "henley", "tank", "blouse", "long sleeve", "jersey", "graphic tee"],
  bottom: ["jeans", "pants", "trouser", "chino", "shorts", "jogger", "sweatpants", "cargo pants", "track pants", "skirt"],
};

function classifySlot(subType: string | null): string | null {
  if (!subType) return null;
  const l = subType.toLowerCase();
  if (l.includes("sneaker") || l.includes("boot") || l.includes("loafer") || l.includes("slide") ||
      l.includes("sandal") || l.includes("shoe") || l.includes("slipper") || l.includes("mule")) return "foot";
  if (l.includes("jacket") || l.includes("windbreaker") || l.includes("parka") || l.includes("anorak") ||
      l.includes("peacoat") || l.includes("blazer") || l.includes("trench") || l.includes("overshirt") ||
      l.includes("shacket")) return "outer";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("sweater") || l.includes("cardigan") ||
      l.includes("pullover") || l.includes("crewneck") || l.includes("fleece") || l.includes("turtleneck") ||
      l.includes("quarter zip") || l.includes("half zip") || l.includes("knit")) return "mid";
  if (l.includes("t-shirt") || l.includes("polo") || l.includes("henley") || l.includes("tank") ||
      l.includes("blouse") || l.includes("long sleeve") || l.includes("jersey") || l.includes("tee") ||
      (l.includes("shirt") && !l.includes("sweatshirt"))) return "base";
  if (l.includes("jean") || l.includes("pant") || l.includes("trouser") || l.includes("chino") ||
      l.includes("short") || l.includes("jogger") || l.includes("skirt")) return "bottom";
  return getSlot(subType);
}

async function fetchSlotItems(brands: string[], slot: string, limit = 200): Promise<GarmentForScoring[]> {
  const orFilter = SLOT_PATTERNS[slot].map(k => `sub_type.ilike.%${k}%`).join(",");
  const { data, error } = await sb
    .from("streetwear_products")
    .select("id, brand, title, sub_type, color_primary, color_secondary, pattern, formality, material, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image_url")
    .in("brand", brands)
    .eq("analyzed", true)
    .not("sub_type", "is", null)
    .not("pros", "is", null)    // only items with completed analysis
    .or(orFilter)
    .limit(limit);
  if (error) { console.error(`  DB error fetching ${slot}:`, error.message); return []; }
  return (data ?? []).filter(r => classifySlot(r.sub_type) === slot).map(r => toGarment(r as ProductRow));
}

function pickVaried(items: GarmentForScoring[], n: number): GarmentForScoring[] {
  const picked: GarmentForScoring[] = [];
  const seenSubTypes = new Set<string>();
  const seenIds      = new Set<string>();
  for (const item of items) {
    if (picked.length >= n) break;
    const st = (item.sub_type ?? "").toLowerCase();
    if (!seenIds.has(item.id) && !seenSubTypes.has(st)) {
      picked.push(item); seenIds.add(item.id); seenSubTypes.add(st);
    }
  }
  for (const item of items) {
    if (picked.length >= n) break;
    if (!seenIds.has(item.id)) { picked.push(item); seenIds.add(item.id); }
  }
  return picked;
}

const SLOT_TARGETS = { base: 4, mid: 2, outer: 2, bottom: 3, foot: 2 };

async function buildWardrobe(spec: WardrobeSpec): Promise<GarmentForScoring[]> {
  const wardrobe: GarmentForScoring[] = [];
  for (const slot of Object.keys(SLOT_TARGETS) as (keyof typeof SLOT_TARGETS)[]) {
    const brands = (slot === "foot" && spec.footwearBrands) ? spec.footwearBrands : spec.brands;
    const items  = await fetchSlotItems(brands, slot, 300);
    if (!items.length) {
      console.warn(`  ⚠ No ${slot} items for ${spec.name}`);
      continue;
    }
    wardrobe.push(...pickVaried(items, SLOT_TARGETS[slot]));
  }
  return wardrobe;
}

// ── Wardrobe specs ─────────────────────────────────────────────────────────────
// Hand-picked to represent distinct aesthetics with good coverage in the 300k DB.

type WardrobeSpec = {
  name: string;
  brands: string[];
  footwearBrands?: string[];
};

const WARDROBE_SPECS: WardrobeSpec[] = [
  {
    // Stussy surf-skate meets Palace UK skate — classic streetwear brand synergy.
    // Jordan/Nike footwear grounds the court heritage.
    name: "A — Core Streetwear (Stussy + Palace + Carhartt WIP / Jordan + Nike foot)",
    brands: ["Stussy", "STUSSY", "Palace", "CARHARTT WIP"],
    footwearBrands: ["JORDAN", "JORDAN BRAND", "Nike", "NIKE", "NEW BALANCE"],
  },
  {
    // Nike + Jordan Brand athletic-wear to streetwear crossover.
    // Tests how sportswear pieces combine outside the gym.
    name: "B — Sportswear / Athletic (Nike + Jordan Brand / Jordan + New Balance foot)",
    brands: ["Nike", "NIKE", "JORDAN", "JORDAN BRAND"],
    footwearBrands: ["JORDAN", "JORDAN BRAND", "Nike", "NIKE", "NEW BALANCE"],
  },
  {
    // Jil Sander precision minimalism + Loewe artisanal luxury + Givenchy/Valentino.
    // Tests high-fashion quiet-luxury register.
    name: "C — Minimalist High Fashion (Jil Sander + Loewe + Givenchy + Valentino)",
    brands: ["JIL SANDER", "LOEWE", "GIVENCHY", "VALENTINO", "VALENTINO GARAVANI", "PRADA", "SAINT LAURENT"],
    footwearBrands: ["GIVENCHY", "VALENTINO GARAVANI", "PRADA"],
  },
  {
    // ANN DEMEULEMEESTER dark romance + Balenciaga luxury-street + Kapital craft + CDG deconstruction.
    // Tests avant-garde all-black register.
    name: "D — Avant-Garde Dark (Ann Demeulemeester + Balenciaga + Kapital + CDG + Our Legacy)",
    brands: ["ANN DEMEULEMEESTER", "BALENCIAGA", "KAPITAL", "COMME DES GARCONS HOMME PLUS", "OUR LEGACY"],
    footwearBrands: ["ANN DEMEULEMEESTER", "GIVENCHY"],
  },
  {
    // Carhartt WIP workwear-street + Our Legacy Scandinavian basics + Y-3 sport.
    // Tests workwear-crossover register across relaxed aesthetics.
    name: "E — Workwear Crossover (Carhartt WIP + Our Legacy + Y-3 / New Balance foot)",
    brands: ["CARHARTT WIP", "OUR LEGACY", "Y-3", "KAPITAL"],
    footwearBrands: ["Y-3", "NEW BALANCE", "NIKE", "Nike"],
  },
];

// ── Display helpers ───────────────────────────────────────────────────────────

function scoreLabel(s: number) {
  if (s >= 80) return "✅ GREAT";
  if (s >= 65) return "⚠️  OK";
  if (s >= 50) return "⚠️  MID";
  return "❌ LOW";
}

function printOutfit(rank: number, outfit: RankedOutfit) {
  console.log(`\n  #${rank}  Score: ${outfit.score}  ${scoreLabel(outfit.score)}  Config: "${outfit.configName}"`);
  for (const item of outfit.items) {
    const slot = classifySlot(item.sub_type) ?? "?";
    console.log(`      [${slot.padEnd(6)}] ${(item.brand ?? "?").padEnd(22)} ${(item.sub_type ?? "?").padEnd(26)} ${item.color_primary ?? ""}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const specs = filterArg
  ? WARDROBE_SPECS.filter(s => s.name.toLowerCase().includes(filterArg))
  : WARDROBE_SPECS;

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  OUTFIT PROS/CONS ANALYSIS TEST");
console.log(`  Analyzing top ${TOP_N} outfits per wardrobe  |  ${specs.length} wardrobe(s)`);
console.log("═══════════════════════════════════════════════════════════════════════\n");

for (const spec of specs) {
  if (filterArg && !spec.name.toLowerCase().includes(filterArg)) continue;

  console.log(`\n${"─".repeat(71)}`);
  console.log(`  WARDROBE ${spec.name}`);
  console.log(`${"─".repeat(71)}`);

  const wardrobe = await buildWardrobe(spec);
  if (wardrobe.length < 3) {
    console.log("  ⚠ Not enough items — skipping\n");
    continue;
  }

  console.log(`  ${wardrobe.length} items`);
  for (const item of wardrobe) {
    const slot = classifySlot(item.sub_type) ?? "?";
    const tags = (item.aesthetic_tags ?? []).slice(0, 2).join(", ");
    const hasPros = (item.pros ?? []).length > 0 ? "✓" : "✗";
    console.log(`    [${slot.padEnd(6)}] ${(item.brand ?? "?").padEnd(22)} ${(item.sub_type ?? "?").padEnd(28)} ${item.color_primary ?? ""}  pros:${hasPros}`);
  }

  console.log(`\n  Generating outfits...`);
  const t0 = Date.now();
  const ranked = generateAndRankAllOutfits(wardrobe, { maxTotal: 500 });
  console.log(`  ${ranked.length} outfits generated in ${Date.now() - t0}ms`);

  if (!ranked.length) { console.log("  No valid outfits — skipping\n"); continue; }

  console.log(`\n  Analyzing top ${Math.min(TOP_N, ranked.length)} outfits with GPT-4o...\n`);

  for (let i = 0; i < Math.min(TOP_N, ranked.length); i++) {
    const outfit = ranked[i];
    printOutfit(i + 1, outfit);

    try {
      const t1 = Date.now();
      const result = await analyzeOutfit(outfit.items, {
        score:      outfit.score,
        configName: outfit.configName,
        aesthetic:  deriveOutfitAesthetic(outfit.items),
      });
      const ms = Date.now() - t1;

      console.log(`\n  ── Analysis (${ms}ms) ──────────────────────────────────`);
      console.log(`  Tags: ${result.outfit_tags.join(" · ")}`);
      console.log(`  Pros:`);
      for (const p of result.pros)  console.log(`    + ${p}`);
      console.log(`  Cons:`);
      for (const c of result.cons)  console.log(`    - ${c}`);
    } catch (err) {
      console.error(`  ✘ Analysis failed:`, (err as Error).message);
    }
  }

  console.log();
}

console.log("\n✅ Done.");
