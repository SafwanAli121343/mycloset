/**
 * Comprehensive test for formal pant gap leniency.
 * Tests ALL sub_types that could plausibly be encountered when a user has a "formal pant" gap.
 * Also verifies that the casual pant gap and other bottom gaps are not broken.
 */
import { computeGapProgress, getFunctionalSlot } from "../lib/wardrobeAnalysis.js";

let passed = 0;
let failed = 0;

function check(label: string, actual: number | string | null, expected: number | string | null, note?: string) {
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

// ── Block 1: Slot assignments ─────────────────────────────────────────────────
console.log("\n=== Block 1: Slot assignments ===\n");

// Items that SHOULD be in formal pant slot
const formalPantItems = [
  "Dress Pants", "Trousers", "Tailored Trousers", "Wide Leg Trousers",
  "Pleated Trousers", "Cropped Trousers", "Slacks", "Velvet Trousers",
  "Pleated Pants", "Wide Pleated Pants", "Tailored Pants", "Wide Leg Pleated Pants",
];
for (const sub of formalPantItems) {
  check(`getFunctionalSlot("${sub}") === "formal pant"`, getFunctionalSlot(sub), "formal pant");
}

// Items that SHOULD stay in casual pant slot (not reclassified)
const casualPantItems = [
  "Chinos", "Cargo Pants", "Joggers", "Sweatpants", "Track Pants",
  "Linen Pants", "Parachute Pants", "Baggy Pants", "Jogger Pants",
  "Wide Leg Pants", "Straight Pants", "Tapered Pants", "Relaxed Pants",
  "Slim Pants", "Balloon Pants", "Utility Pants", "Drawstring Pants",
];
for (const sub of casualPantItems) {
  check(`getFunctionalSlot("${sub}") === "casual pant"`, getFunctionalSlot(sub), "casual pant");
}

// ── Block 2: Formal pant gap — FILLS (should return 100) ────────────────────
console.log("\n=== Block 2: Items that FILL the 'formal pant' gap ===\n");

const fillsFormalPant: [string, string][] = [
  // Classic formal items
  ["Dress Pants",            "bottom"],
  ["Trousers",               "bottom"],
  ["Tailored Trousers",      "bottom"],
  ["Wide Leg Trousers",      "bottom"],
  ["Pleated Trousers",       "bottom"],
  ["Slacks",                 "bottom"],
  ["Velvet Trousers",        "bottom"],
  // New lenient items — pleated = formal-adjacent
  ["Pleated Pants",          "bottom"],
  ["Wide Pleated Pants",     "bottom"],
  ["Tailored Pants",         "bottom"],
  ["Wide Leg Pleated Pants", "bottom"],
];
for (const [sub, cat] of fillsFormalPant) {
  const slot = getFunctionalSlot(sub);
  const prog = computeGapProgress("formal pant", sub, cat, slot);
  check(`"${sub}" fills "formal pant" (progress=100)`, prog, 100);
}

// ── Block 3: Formal pant gap — DOES NOT FILL (should return 0) ──────────────
console.log("\n=== Block 3: Items that do NOT fill the 'formal pant' gap ===\n");

const doesNotFillFormalPant: [string, string][] = [
  ["Chinos",          "bottom"],  // smart-casual but not formal-slot
  ["Cargo Pants",     "bottom"],
  ["Wide Leg Pants",  "bottom"],  // casual even though wide leg
  ["Straight Pants",  "bottom"],
  ["Tapered Pants",   "bottom"],
  ["Baggy Pants",     "bottom"],
  ["Jogger Pants",    "bottom"],
  ["Sweatpants",      "bottom"],
  ["Leggings",        "bottom"],
  ["Shorts",          "bottom"],
  ["Jeans",           "bottom"],
  ["Slim Jeans",      "bottom"],
  ["Parachute Pants", "bottom"],
  // Tops and other categories
  ["T-Shirt",         "top"],
  ["Hoodie",          "top"],
  ["Blazer",          "outerwear"],
];
for (const [sub, cat] of doesNotFillFormalPant) {
  const slot = getFunctionalSlot(sub);
  const prog = computeGapProgress("formal pant", sub, cat, slot);
  check(`"${sub}" does NOT fill "formal pant" (progress=0)`, prog, 0);
}

// ── Block 4: Absence-phrased formal gaps ────────────────────────────────────
console.log("\n=== Block 4: Absence-phrased formal gaps ===\n");

// Realistic absence-phrased gaps the AI can produce alongside slot names
const absenceGaps = [
  "no formal pant",
  "missing formal trouser",
  "no formal options",
];
for (const gap of absenceGaps) {
  // Dress Pants should fill all of these
  const slot = getFunctionalSlot("Dress Pants");
  const prog = computeGapProgress(gap, "Dress Pants", "bottom", slot);
  check(`"Dress Pants" fills absence gap "${gap}" (progress=100)`, prog, 100);
}
// Pleated Pants should fill absence formal gaps too
for (const gap of absenceGaps) {
  const slot = getFunctionalSlot("Pleated Pants");
  const prog = computeGapProgress(gap, "Pleated Pants", "bottom", slot);
  check(`"Pleated Pants" fills absence gap "${gap}" (progress=100)`, prog, 100);
}
// Casual pants should NOT fill absence formal gaps
for (const gap of absenceGaps) {
  const slot = getFunctionalSlot("Baggy Pants");
  const prog = computeGapProgress(gap, "Baggy Pants", "bottom", slot);
  check(`"Baggy Pants" does NOT fill absence gap "${gap}" (progress=0)`, prog, 0);
}

// ── Block 5: Casual pant gap — not broken by reclassification ───────────────
console.log("\n=== Block 5: 'casual pant' gap still works correctly ===\n");

const fillsCasualPant: [string, string][] = [
  ["Chinos",          "bottom"],
  ["Cargo Pants",     "bottom"],
  ["Joggers",         "bottom"],
  ["Wide Leg Pants",  "bottom"],
  ["Straight Pants",  "bottom"],
  ["Tapered Pants",   "bottom"],
  ["Baggy Pants",     "bottom"],
  ["Jogger Pants",    "bottom"],
  ["Linen Pants",     "bottom"],
];
for (const [sub, cat] of fillsCasualPant) {
  const slot = getFunctionalSlot(sub);
  const prog = computeGapProgress("casual pant", sub, cat, slot);
  check(`"${sub}" fills "casual pant" (progress=100)`, prog, 100);
}

// Pleated Pants (now formal) should NOT fill casual pant gap
const formalNowItems = ["Pleated Pants","Dress Pants","Trousers","Slacks"];
for (const sub of formalNowItems) {
  const slot = getFunctionalSlot(sub);
  const prog = computeGapProgress("casual pant", sub, "bottom", slot);
  check(`"${sub}" does NOT fill "casual pant" (progress=0)`, prog, 0);
}

// ── Block 6: Slot cross-contamination guard — outerwear gaps ────────────────
console.log("\n=== Block 6: Outerwear slot cross-contamination is unchanged ===\n");

check(
  '"Blazer" fills "structured outerwear" (100)',
  computeGapProgress("structured outerwear", "Blazer", "outerwear", getFunctionalSlot("Blazer")),
  100
);
check(
  '"Blazer" does NOT fill "heavy outerwear" (0)',
  computeGapProgress("heavy outerwear", "Blazer", "outerwear", getFunctionalSlot("Blazer")),
  0
);
check(
  '"Puffer Jacket" fills "heavy outerwear" (100)',
  computeGapProgress("heavy outerwear", "Puffer Jacket", "outerwear", getFunctionalSlot("Puffer Jacket")),
  100
);
check(
  '"Puffer Jacket" does NOT fill "structured outerwear" (0)',
  computeGapProgress("structured outerwear", "Puffer Jacket", "outerwear", getFunctionalSlot("Puffer Jacket")),
  0
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(56)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed === 0) console.log("ALL TESTS PASSED ✓");
else console.log(`FAILED: ${failed} test(s)`);
process.exit(failed > 0 ? 1 : 0);
