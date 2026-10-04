// Sample closet, outfits and wardrobe report shown ONLY during the first-run tutorial, so a brand
// new account (nothing added yet) still sees what each page looks like in use. Pure data — never
// saved anywhere. Kept identical, by hand, to the app's copy (native/lib/tutorialSamples.ts) —
// same convention as every other native/web pair here; only the image paths differ.

export type SampleImages = { tee: string; navyTee: string; jacket: string; jeans: string; cargos: string };

export type SampleGarment = {
  id: string; title: string; brand: string | null; sub_type: string; category: string;
  color_primary: string; image: string; aesthetic_tags: string[];
  pros: string[]; cons: string[]; color_pairings: string[]; color_clashes: string[];
  style_pairings: string[]; ai_unlocked: boolean;
};

export function sampleCloset(img: SampleImages): { garments: SampleGarment[]; scores: Record<string, number> } {
  const garments: SampleGarment[] = [
    {
      id: "sample-jacket", title: "Chore Jacket", brand: "Sample", sub_type: "Chore Jacket", category: "outerwear",
      color_primary: "Tan", image: img.jacket, aesthetic_tags: ["workwear", "casual"],
      pros: ["Workwear staple: layers over almost anything", "Tan reads warm and easy to match", "Structured shoulders sharpen basic tees"],
      cons: ["Boxy cut can swamp slimmer frames", "Too heavy for hot days"],
      color_pairings: ["Cream", "Navy", "Indigo denim", "Olive", "Black"], color_clashes: ["Orange", "Mustard"],
      style_pairings: ["Straight Leg Jeans → workwear", "Heavyweight Tee → casual"], ai_unlocked: true,
    },
    {
      id: "sample-tee", title: "Heavyweight Tee", brand: "Sample", sub_type: "T-Shirt", category: "top",
      color_primary: "Cream", image: img.tee, aesthetic_tags: ["minimalist", "casual"],
      pros: ["Cream softens darker layers", "Thick fabric holds its shape", "Works under jackets and overshirts"],
      cons: ["Shows stains easily", "Can look washed out alone"],
      color_pairings: ["Tan", "Navy", "Olive", "Brown", "Indigo denim"], color_clashes: ["Pale yellow"],
      style_pairings: ["Chore Jacket → workwear", "Cargo Pants → casual"], ai_unlocked: true,
    },
    {
      id: "sample-jeans", title: "Straight Leg Jeans", brand: "Sample", sub_type: "Straight Leg Jeans", category: "bottom",
      color_primary: "Indigo", image: img.jeans, aesthetic_tags: ["casual", "workwear"],
      pros: ["Straight leg balances boxy tops", "Mid wash goes with nearly everything", "Dresses up or down easily"],
      cons: ["Overlaps with other blue denim"],
      color_pairings: ["Cream", "Tan", "White", "Black", "Grey"], color_clashes: ["Bright blue"],
      style_pairings: ["Chore Jacket → workwear", "Pocket Tee → casual"], ai_unlocked: true,
    },
    {
      id: "sample-navy", title: "Pocket Tee", brand: "Sample", sub_type: "T-Shirt", category: "top",
      color_primary: "Navy", image: img.navyTee, aesthetic_tags: ["casual", "preppy"],
      pros: ["Navy is an easy neutral", "Pocket adds detail without noise"],
      cons: ["Close in tone to dark denim", "Basic on its own"],
      color_pairings: ["Khaki", "Cream", "Tan", "Grey"], color_clashes: ["Black"],
      style_pairings: ["Cargo Pants → casual"], ai_unlocked: true,
    },
    {
      id: "sample-cargos", title: "Cargo Pants", brand: "Sample", sub_type: "Cargo Pants", category: "bottom",
      color_primary: "Khaki", image: img.cargos, aesthetic_tags: ["streetwear", "workwear"],
      pros: ["Relaxed fit for everyday wear", "Khaki pairs with most tops"],
      cons: ["Pockets add bulk at the thigh", "Too casual for dressier plans"],
      color_pairings: ["Navy", "Cream", "Olive", "Black", "White"], color_clashes: ["Tan (too close)"],
      style_pairings: ["Pocket Tee → casual"], ai_unlocked: true,
    },
  ];
  return { garments, scores: { "sample-jacket": 84, "sample-tee": 78, "sample-jeans": 80, "sample-navy": 72, "sample-cargos": 74 } };
}

export type SampleOutfit = { score: number; itemIds: string[]; analysis: { pros: string[]; cons: string[] } };

export function sampleOutfits(): SampleOutfit[] {
  return [
    { score: 88, itemIds: ["sample-tee", "sample-jeans", "sample-jacket"],
      analysis: { pros: ["Cream tee + tan jacket: warm, tonal layering", "Indigo jeans ground the light top half"], cons: ["Safe combo: add an accessory for interest"] } },
    { score: 83, itemIds: ["sample-navy", "sample-cargos", "sample-jacket"],
      analysis: { pros: ["Navy + khaki: classic, easy contrast", "Jacket ties the workwear feel together"], cons: ["Cargos + jacket pockets: a bit busy"] } },
    { score: 79, itemIds: ["sample-tee", "sample-cargos"],
      analysis: { pros: ["Relaxed, light palette for warm days"], cons: ["Cream + khaki: low contrast"] } },
    { score: 77, itemIds: ["sample-navy", "sample-jeans"],
      analysis: { pros: ["Clean, simple everyday pairing"], cons: ["Navy + indigo: very close tones"] } },
    { score: 76, itemIds: ["sample-navy", "sample-jeans", "sample-jacket"],
      analysis: { pros: ["Jacket breaks up the all-blue look"], cons: ["Dark top and bottom feel heavy"] } },
    { score: 75, itemIds: ["sample-tee", "sample-jeans"],
      analysis: { pros: ["Timeless tee and jeans"], cons: ["Plain: works best with a layer"] } },
  ];
}

export function sampleWardrobeReport() {
  return {
    score: 64,
    pieceCount: 5,
    pros: [
      "A tight, warm palette of cream, tan, navy and khaki: almost everything pairs with everything else.",
      "Workwear basics with clean lines make an easy everyday foundation.",
    ],
    cons: [
      "No footwear yet, so no outfit is actually complete.",
      "Heavy reliance on casual tees leaves nothing for dressier plans.",
    ],
    colors: { have: ["Cream", "Tan", "Navy", "Indigo", "Khaki"], missing: ["Black", "Olive", "White"] },
    aesthetics: { covered: [{ name: "casual", count: 5 }, { name: "workwear", count: 4 }], missing: ["minimalist", "smart casual"] },
    subTypeFrequency: { "T-Shirt": 2 },
    gaps: [
      { description: "casual sneaker", type: "piece_type" as const, impact: "high" as const, reason: "Every outfit needs shoes, and sneakers cover the most of this closet.", costPoints: 0 },
      { description: "button-up shirt", type: "piece_type" as const, impact: "medium" as const, reason: "A collared layer opens up smarter looks with the same bottoms.", costPoints: 0 },
    ],
    overdone: [],
    insights: [
      "The chore jacket is doing the most work here: it appears in your strongest outfits.",
      "Adding one darker neutral would give the light pieces more contrast.",
    ],
    generatedAt: new Date(0).toISOString(),
    conGapLinks: { "0": "casual sneaker" },
    pointWeights: { gap: 4, color: 1, aesthetic: 1, con: 1 },
  };
}

// Ids are recognizable so nothing outside the tutorial ever treats a sample as real data.
export const isSampleId = (id: string) => id.startsWith("sample-");

export const SAMPLE_IMAGES: SampleImages = {
  tee: "/scatter/piece26.png", navyTee: "/scatter/piece23.png", jacket: "/scatter/piece37.png",
  jeans: "/scatter/piece51.png", cargos: "/scatter/piece53.png",
};
