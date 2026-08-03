/**
 * Tests outfit generation correctness after categoryAwareSlot + getSlot fixes.
 *
 * Covers:
 *  1. getSlot no longer misclassifies "Flat Front Dress Pants" as onepiece
 *  2. categoryAwareSlot: user-selected category overrides sub_type keyword matching
 *  3. End-to-end: ambiguous sub_type + category="bottom" generates outfits
 *  4. End-to-end: "Flat Front Dress Pants" now generates outfits (getSlot fix)
 *  5. Regression: normal tee + jeans + sneakers still generates outfits
 *  6. Regression: onepiece + shoes still generates outfits
 *  7. Regression: two tops, no bottom → 0 outfits (invalid combo)
 *  8. Category cascade: category="top" falls through to sub_type for base vs mid
 *
 * Run: npx tsx scripts/test-outfit-gen-category.mts
 */

import { generateAndRankAllOutfits } from "../lib/wardrobeOutfitGen.js";
import { getSlot } from "../lib/scoring.js";
import type { GarmentForScoring } from "../lib/scoring.js";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown, note?: string) {
  if (actual === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.log(`  ✗  ${label}`);
    console.log(`       expected: ${expected}`);
    console.log(`       got:      ${actual}`);
    if (note) console.log(`       note: ${note}`);
    failed++;
  }
}

function checkGt(label: string, actual: number, min: number, note?: string) {
  if (actual > min) {
    console.log(`  ✓  ${label} (${actual} > ${min})`);
    passed++;
  } else {
    console.log(`  ✗  ${label}`);
    console.log(`       expected: > ${min}`);
    console.log(`       got:      ${actual}`);
    if (note) console.log(`       note: ${note}`);
    failed++;
  }
}

// ── Garment factory ───────────────────────────────────────────────────────────

let _id = 0;
function g(
  sub_type: string,
  overrides: Partial<GarmentForScoring> & { category?: string } = {},
): GarmentForScoring {
  return {
    id: `item-${++_id}`,
    title: sub_type,
    brand: "TestBrand",
    sub_type,
    material: "Cotton",
    color_primary: "White",
    color_secondary: null,
    pattern: "Solid",
    formality: "Casual",
    aesthetic_tags: ["streetwear"],
    pros: null,
    cons: null,
    color_pairings: null,
    color_clashes: null,
    tags: null,
    image: null,
    ...overrides,
  };
}

// ── Block 1: getSlot bug fix — "dress X pant/trouser/short" → bottom ─────────
console.log("\n=== Block 1: getSlot no longer misclassifies dress-prefix pants ===\n");

const dressBottomTypes = [
  "Flat Front Dress Pants",
  "Dress Pants",
  "Dress Trousers",
  "Pleated Dress Pants",
  "Slim Fit Dress Pants",
  "Cropped Dress Pants",
  "Dress Shorts",
];
for (const sub of dressBottomTypes) {
  check(`getSlot("${sub}") === "bottom"`, getSlot(sub), "bottom");
}

// These should remain onepiece
const realDresses = ["Little Black Dress", "Midi Dress", "Wrap Dress", "Sundress", "Shirt Dress"];
for (const sub of realDresses) {
  check(`getSlot("${sub}") === "onepiece"`, getSlot(sub), "onepiece");
}

// ── Block 2: categoryAwareSlot — category wins over sub_type ─────────────────
console.log("\n=== Block 2: category field overrides sub_type for bucketing ===\n");

// Use a white tee + black sneakers as the rest of the wardrobe
const tee     = g("T-Shirt",   { color_primary: "White", aesthetic_tags: ["streetwear"] });
const sneaker = g("Sneakers",  { color_primary: "White", aesthetic_tags: ["streetwear"] });

// Item with unrecognizable sub_type but correct category
// "Woven Twill Bottoms" contains no keyword getSlot knows ("bottom" is not a keyword,
// only slot names like "pant", "jean", "trouser", etc. are).
const ambiguousPant = g("Woven Twill Bottoms", { category: "bottom", color_primary: "Black" });
const wardrobeA = [tee, sneaker, ambiguousPant];
const resultsA = generateAndRankAllOutfits(wardrobeA);
const hypoAOutfits = resultsA.filter(o => o.items.some(i => i.id === ambiguousPant.id));
checkGt(
  '"Woven Twill Bottoms" with category=bottom generates outfits',
  hypoAOutfits.length, 0,
  "categoryAwareSlot should slot this as bottom despite unrecognized sub_type",
);

// Confirm getSlot("Woven Twill Bottoms") returns null (no keyword match)
check(
  'getSlot("Woven Twill Bottoms") === null (no keyword match)',
  getSlot("Woven Twill Bottoms"), null,
);

// Without category, same unrecognized sub_type → 0 outfits (getSlot returns null)
const ambiguousPantNoCategory = g("Woven Twill Bottoms", { color_primary: "Black" });
const wardrobeB = [tee, sneaker, ambiguousPantNoCategory];
const resultsB = generateAndRankAllOutfits(wardrobeB);
const hypoBOutfits = resultsB.filter(o => o.items.some(i => i.id === ambiguousPantNoCategory.id));
check(
  '"Woven Twill Bottoms" with NO category generates 0 outfits (unknown sub_type)',
  hypoBOutfits.length, 0,
  "confirms category is what makes the difference",
);

// ── Block 3: "Flat Front Dress Pants" now generates outfits (getSlot fix) ────
console.log("\n=== Block 3: Flat Front Dress Pants generates outfits via getSlot fix ===\n");

const dressPants = g("Flat Front Dress Pants", { color_primary: "Charcoal", formality: "Formal" });
const dressTee   = g("T-Shirt",  { color_primary: "White", aesthetic_tags: ["smart casual"] });
const dressShoe  = g("Oxford Shoes", { color_primary: "Black", formality: "Formal" });
const wardrobeC  = [dressTee, dressShoe, dressPants];
const resultsC   = generateAndRankAllOutfits(wardrobeC);
const hypoCOutfits = resultsC.filter(o => o.items.some(i => i.id === dressPants.id));
checkGt(
  '"Flat Front Dress Pants" generates outfits (was misclassified as onepiece before fix)',
  hypoCOutfits.length, 0,
);

// ── Block 4: Nordstrom-style "Pleated Pants" generates outfits ────────────────
console.log('\n=== Block 4: "Pleated Pants" with category=bottom generates outfits ===\n');

const pleatedPants = g("Pleated Pants", {
  category: "bottom",
  color_primary: "Navy",
  formality: "Smart Casual",
  aesthetic_tags: ["streetwear"],
});
const wardrobeD = [
  g("T-Shirt",  { color_primary: "White", aesthetic_tags: ["streetwear"] }),
  g("Sneakers", { color_primary: "White", aesthetic_tags: ["streetwear"] }),
  pleatedPants,
];
const resultsD = generateAndRankAllOutfits(wardrobeD);
const hypoDOutfits = resultsD.filter(o => o.items.some(i => i.id === pleatedPants.id));
checkGt('"Pleated Pants" category=bottom generates outfits', hypoDOutfits.length, 0);

// ── Block 5: Regression — plain tee + jeans + sneakers ───────────────────────
console.log("\n=== Block 5: Regression — standard tee + jeans + sneakers ===\n");

const wardrobeE = [
  g("T-Shirt",  { color_primary: "White", aesthetic_tags: ["streetwear"] }),
  g("Jeans",    { color_primary: "Blue",  aesthetic_tags: ["streetwear"] }),
  g("Sneakers", { color_primary: "White", aesthetic_tags: ["streetwear"] }),
];
const resultsE = generateAndRankAllOutfits(wardrobeE);
checkGt("tee + jeans + sneakers generates outfits", resultsE.length, 0);

// ── Block 6: Regression — onepiece + shoes ───────────────────────────────────
console.log("\n=== Block 6: Regression — onepiece + shoes ===\n");

const wardrobeF = [
  g("Midi Dress", { color_primary: "Black", aesthetic_tags: ["minimalist"] }),
  g("Sneakers",   { color_primary: "White", aesthetic_tags: ["minimalist"] }),
];
const resultsF = generateAndRankAllOutfits(wardrobeF);
checkGt("onepiece (Midi Dress) + shoes generates outfits", resultsF.length, 0);

// ── Block 7: Regression — two tops, no bottom → 0 outfits ────────────────────
console.log("\n=== Block 7: Regression — two tops, no bottom = 0 outfits ===\n");

const wardrobeG = [
  g("T-Shirt",  { color_primary: "White" }),
  g("Hoodie",   { color_primary: "Grey"  }),
  g("Sneakers", { color_primary: "White" }),
];
const resultsG = generateAndRankAllOutfits(wardrobeG);
check(
  "two tops + no bottom = 0 valid outfits",
  resultsG.length, 0,
  "no bottom → no valid combination",
);

// ── Block 8: category=top falls through to sub_type for base vs mid ──────────
console.log("\n=== Block 8: category=top falls through — hoodie still slots as mid ===\n");

const hoodie = g("Hoodie", { category: "top", color_primary: "Grey", aesthetic_tags: ["streetwear"] });
const wardrobeH = [
  g("T-Shirt",  { color_primary: "White", aesthetic_tags: ["streetwear"] }),
  g("Jeans",    { color_primary: "Blue",  aesthetic_tags: ["streetwear"] }),
  g("Sneakers", { color_primary: "White", aesthetic_tags: ["streetwear"] }),
  hoodie,
];
const resultsH = generateAndRankAllOutfits(wardrobeH);
const hoodeOutfits = resultsH.filter(o => o.items.some(i => i.id === hoodie.id));
checkGt(
  "Hoodie with category=top slots as mid (sub_type fallback), generates outfits",
  hoodeOutfits.length, 0,
);

// ── Block 9: category wins even for "Dress Pants" (double safety) ─────────────
console.log("\n=== Block 9: category=bottom + sub_type=Dress Pants → bottom slot ===\n");

const dressPants2 = g("Dress Pants", {
  category: "bottom",
  color_primary: "Charcoal",
  aesthetic_tags: ["smart casual"],
});
const wardrobeI = [
  g("T-Shirt",    { color_primary: "White", aesthetic_tags: ["smart casual"] }),
  g("Sneakers",   { color_primary: "White", aesthetic_tags: ["smart casual"] }),
  dressPants2,
];
const resultsI = generateAndRankAllOutfits(wardrobeI);
const hypoIOutfits = resultsI.filter(o => o.items.some(i => i.id === dressPants2.id));
checkGt(
  '"Dress Pants" with category=bottom generates outfits',
  hypoIOutfits.length, 0,
);

// ── Block 10: Preview slot isolation — no competition from existing same-slot items ──
console.log("\n=== Block 10: Preview slot isolation (no floor pressure from same-slot items) ===\n");

import { resolveSlot } from "../lib/scoring.js";

// Build a wardrobe with many existing bottoms that score well — these would normally raise
// the dynamic floor and prune the preview item's outfits in a naive combined run.
const tops: GarmentForScoring[] = Array.from({ length: 6 }, (_, i) =>
  g(`T-Shirt${i}`, { sub_type: "T-Shirt", color_primary: i % 2 === 0 ? "White" : "Black", category: "top", aesthetic_tags: ["streetwear"] })
);
const existingBottoms: GarmentForScoring[] = Array.from({ length: 8 }, (_, i) =>
  g(`Jeans${i}`, { sub_type: "Jeans", color_primary: i % 2 === 0 ? "Blue" : "Black", category: "bottom", aesthetic_tags: ["streetwear"] })
);
const shoes: GarmentForScoring[] = [
  g("Sneakers", { category: "footwear", color_primary: "White", aesthetic_tags: ["streetwear"] }),
  g("Boots",    { sub_type: "Chelsea Boots", category: "footwear", color_primary: "Black", aesthetic_tags: ["streetwear"] }),
];

// Preview item: navy pleated pants
const previewItem = g("Pleated Pants", {
  category: "bottom",
  color_primary: "Navy",
  formality: "Smart Casual",
  aesthetic_tags: ["smart casual"],
});

// Naive approach: full wardrobe + preview, filter after → undercounts due to floor
const naiveWardrobe = [...tops, ...existingBottoms, ...shoes, previewItem];
const naiveRanked = generateAndRankAllOutfits(naiveWardrobe, { maxTotal: 3000 });
const naiveHypo = naiveRanked.filter(o => o.items.some(i => i.id === previewItem.id));

// Correct approach: remove same-slot items from wardrobe before generating
const hypoSlot = resolveSlot(previewItem);
const isolatedWardrobe = [
  ...naiveWardrobe.filter(item => item.id !== previewItem.id && resolveSlot(item) !== hypoSlot),
  previewItem,
];
const isolatedRanked = generateAndRankAllOutfits(isolatedWardrobe, { maxTotal: 10000 });

// Expected: 6 tops × 2 shoes = 12 outfits minimum for "Clean minimal" config alone
checkGt("isolated run generates ≥12 outfits (6 tops × 2 shoes)", isolatedRanked.length, 11);
// The isolated run should always produce at least as many preview outfits as the naive run
checkGt(
  "isolated run finds at least as many preview outfits as naive filter",
  isolatedRanked.length, naiveHypo.length - 1,
);
// Verify every outfit in isolated run contains the preview item
const allContainPreview = isolatedRanked.every(o => o.items.some(i => i.id === previewItem.id));
check("every outfit in isolated run contains the preview item", allContainPreview, true);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(56)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed === 0) console.log("ALL TESTS PASSED ✓");
else console.log(`FAILED: ${failed} test(s)`);
process.exit(failed > 0 ? 1 : 0);
