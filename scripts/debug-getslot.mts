import { getSlot, scoreOutfit } from "../lib/scoring.js";
import type { GarmentForScoring } from "../lib/scoring.js";

console.log("getSlot('flannel'):", getSlot("flannel"));
console.log("getSlot('harrington jacket'):", getSlot("harrington jacket"));

const makeItem = (id: string, sub_type: string, brand: string, tags: string[], color: string = "Black"): GarmentForScoring => ({
  id, title: sub_type, brand, sub_type, material: "cotton", color_primary: color,
  color_secondary: null, pattern: null, formality: null, aesthetic_tags: tags,
  pros: null, cons: null, color_pairings: null, color_clashes: null, tags: null, image: null,
});

const flannel = makeItem("1", "flannel", "Dickies", ["streetwear"], "Red");
const tee    = makeItem("1", "t-shirt", "Dickies", ["streetwear"], "Red");
const harrington = makeItem("2", "harrington jacket", "A.PRESSE", ["quiet-luxury"], "Black");
const jeans  = makeItem("3", "jeans", "Stussy", ["streetwear", "vintage"], "Blue");
const birk   = makeItem("4", "sandals", "Birkenstock", ["streetwear"], "Black");

console.log("\nSlots in flannel outfit:");
for (const i of [flannel, harrington, jeans, birk]) {
  console.log(" ", i.sub_type, "→", getSlot(i.sub_type));
}

const s_flannel = scoreOutfit([flannel, harrington, jeans, birk]);
const s_tee     = scoreOutfit([tee,    harrington, jeans, birk]);
console.log("\nScore (flannel + harrington):", s_flannel);
console.log("Score (tee + harrington):", s_tee);
console.log("Difference:", s_tee - s_flannel, "(should be positive if directional penalty fires for flannel)");
