import { getSlot } from "../lib/scoring.js";
import type { GarmentForScoring } from "../lib/scoring.js";

const makeItem = (id: string, sub_type: string, tags: string[]): GarmentForScoring => ({
  id, title: sub_type, brand: "Test", sub_type, material: "cotton", color_primary: "Black",
  color_secondary: null, pattern: null, formality: null, aesthetic_tags: tags,
  pros: null, cons: null, color_pairings: null, color_clashes: null, tags: null, image: null,
});

const flannel = makeItem("1", "flannel", ["streetwear"]);
const tee    = makeItem("1", "t-shirt", ["streetwear"]);
const harrington = makeItem("2", "harrington jacket", ["quiet-luxury"]);
const jeans  = makeItem("3", "jeans", ["streetwear", "vintage"]);
const birk   = makeItem("4", "sandals", ["streetwear"]);

// Simulate the directional penalty logic from scoring.ts
function testDirectionalPenalty(items: GarmentForScoring[]) {
  const isMicroAcc = (item: GarmentForScoring) => {
    const s = (item.sub_type || "").toLowerCase();
    return s.includes("ring") || s.includes("necklace") || s.includes("chain") ||
           s.includes("pendant") || s.includes("watch") || s.includes("bracelet") || s.includes("anklet");
  };
  const scoringItems = items.filter(i => !isMicroAcc(i));

  const isSimpleBase = (item: GarmentForScoring): boolean => {
    const l = (item.sub_type ?? "").toLowerCase();
    return (
      l.includes("tee") || l.includes("t-shirt") ||
      l.includes("tank") || l.includes("henley") ||
      l.includes("long sleeve") || l.includes("sleeveless") ||
      l.includes("jersey")
    );
  };

  const outerLayer = scoringItems.find(i => getSlot(i.sub_type) === "outer");
  const baseLayers = scoringItems.filter(i => getSlot(i.sub_type) === "base");

  console.log("  outerLayer:", outerLayer?.sub_type, "tags:", outerLayer?.aesthetic_tags);
  console.log("  baseLayers:", baseLayers.map(i => `${i.sub_type}(${(i.aesthetic_tags ?? []).join(",")})`).join(", "));

  let aestheticPenaltyMult = 1.0;
  if (outerLayer) {
    const outerTags = new Set((outerLayer.aesthetic_tags ?? []).map(t => t.toLowerCase()));
    for (const baseItem of baseLayers) {
      const simple = isSimpleBase(baseItem);
      console.log(`  baseItem: ${baseItem.sub_type}, isSimpleBase: ${simple}`);
      if (simple) continue;
      const baseTags = (baseItem.aesthetic_tags ?? []).map(t => t.toLowerCase());
      const hasSharedTag = baseTags.some(t => outerTags.has(t));
      console.log(`  baseTags: [${baseTags}], outerTags: {${[...outerTags]}}, hasShared: ${hasSharedTag}`);
      if (!hasSharedTag && outerTags.size > 0 && baseTags.length > 0) {
        aestheticPenaltyMult = Math.min(aestheticPenaltyMult, 0.60);
        console.log("  → DIRECTIONAL PENALTY FIRES: ×0.60");
      }
    }
  }
  console.log("  Final aestheticPenaltyMult:", aestheticPenaltyMult);
  return aestheticPenaltyMult;
}

console.log("\n=== FLANNEL + HARRINGTON ===");
testDirectionalPenalty([flannel, harrington, jeans, birk]);

console.log("\n=== TEE + HARRINGTON ===");
testDirectionalPenalty([tee, harrington, jeans, birk]);
