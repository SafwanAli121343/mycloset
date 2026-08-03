import { computeGapProgress, getFunctionalSlot } from "../lib/wardrobeAnalysis.js";

const gap = "formal pant";
const candidates: [string, string][] = [
  ["Pleated Trousers",   "bottom"],
  ["Wide Leg Trousers",  "bottom"],
  ["Dress Pants",        "bottom"],
  ["Tailored Trousers",  "bottom"],
  ["Wide Leg Pants",     "bottom"],  // common AI output, NOT in formal pant map
  ["Baggy Pants",        "bottom"],
  ["Parachute Pants",    "bottom"],
  ["Chinos",             "bottom"],
];

console.log(`Gap: "${gap}"\n`);
for (const [sub, cat] of candidates) {
  const slot = getFunctionalSlot(sub);
  const prog = computeGapProgress(gap, sub, cat, slot);
  const marker = prog >= 100 ? "✓ fills" : prog > 0 ? "~ partial" : "✗ no";
  console.log(`  ${marker}  ${sub.padEnd(22)} slot="${slot ?? "null"}"  progress=${prog}`);
}
