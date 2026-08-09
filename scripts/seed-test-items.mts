/**
 * Deletes the previously hand-inserted test items, then re-adds each one through
 * the same code path the manual-add API route uses: insertGarment + AI inference
 * + functional_slot. Crossing entries are NOT manually injected — the WA page
 * computes them on the next visit, exactly as it does for real user adds.
 */
import { createClient } from "@supabase/supabase-js";
import { insertGarment } from "../lib/db/garments.js";
import { inferGarmentAttributes } from "../lib/aiInference.js";
import { getFunctionalSlot } from "../lib/wardrobeAnalysis.js";

const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// IDs from the previous bad seed run
const OLD_IDS = [
  "1df2cf94-ffc4-4f4e-8953-30a6bb4f190d", // Blazer (no image, no AI)
  "c767e74a-1571-456c-a3b6-f34cd3597629", // Loafers
  "0e0e2c71-561b-4940-bacb-08e5825b0097", // Dress Pants
  "3e60786e-8b38-4e43-b73a-359583f8b6f1", // Red Tee
  "af62b317-2a20-4836-b2c3-b814fc9e6d4e", // Purple Hoodie
  "7cd146f8-e6cf-47d8-ae1f-c27a0aabee09", // Orange Hoodie
  "60447e33-d5-42fc-af6f-5df42270f879",   // Tech Fleece (typo in original)
  "60447e33d542fcaf6f5df42270f879",        // fallback without dashes
];

// Real product image URLs — public CDN / brand images GPT-4o can access
const ITEMS = [
  {
    title: "Bonobos Stretch Weekday Warrior Blazer",
    price: "225",
    source: "Bonobos",
    link: "https://bonobos.com/products/stretch-weekday-warrior-blazer",
    image: "https://cdn.shopify.com/s/files/1/0551/4480/0737/files/2024_Q3_MTO-WW-Blazer_Navy_PDP-Front_1800x.jpg",
    category: "outerwear",
    brand: "Bonobos",
    subType: "Blazer",
    colorPrimary: "Navy",
    material: "Polyester blend",
  },
  {
    title: "Cole Haan Grand Series Jensen Penny Loafer",
    price: "200",
    source: "Cole Haan",
    link: "https://www.colehaan.com/grand-series-jensen-penny-loafer-black-leather/C36821.html",
    image: "https://colehaan.com/dw/image/v2/AAKY_PRD/on/demandware.static/-/Sites-master-catalog-cole-haan/default/dw0ab6a3cb/images/hi-res/C36821_1.jpg",
    category: "footwear",
    brand: "Cole Haan",
    subType: "Loafers",
    colorPrimary: "Black",
    material: "Leather",
  },
  {
    title: "Bonobos Weekday Warrior Dress Pant",
    price: "138",
    source: "Bonobos",
    link: "https://bonobos.com/products/weekday-warrior-pant",
    image: "https://cdn.shopify.com/s/files/1/0551/4480/0737/files/2024_Q3_WW-Pant_Charcoal_PDP-Front_1800x.jpg",
    category: "bottom",
    brand: "Bonobos",
    subType: "Dress Pants",
    colorPrimary: "Charcoal",
    material: "Polyester blend",
  },
  {
    title: "Supreme Box Logo Tee",
    price: "48",
    source: "Supreme",
    link: "https://www.supremenewyork.com/shop/tops-sweaters/tees",
    image: "https://assets.supremenewyork.com/media/img/il_1080xN.6034568516_k4uf.jpg",
    category: "top",
    brand: "Supreme",
    subType: "Graphic Tee",
    colorPrimary: "Red",
    material: "Cotton",
  },
  {
    title: "Adidas Essentials Fleece 3-Stripes Hoodie",
    price: "65",
    source: "Adidas",
    link: "https://www.adidas.com/us/essentials-fleece-3-stripes-full-zip-hoodie/IJ8910.html",
    image: "https://assets.adidas.com/images/h_840,f_auto,q_auto,fl_lossy,c_fill,g_auto/80d3a4e38fa949df9e2ea74a011a8a2b_9366/Essentials_Fleece_3-Stripes_Hoodie_Purple_IJ8910_21_model.jpg",
    category: "top",
    brand: "Adidas",
    subType: "Pullover Hoodie",
    colorPrimary: "Purple",
    material: "Fleece",
  },
  {
    title: "Nike Club Fleece Pullover Hoodie",
    price: "65",
    source: "Nike",
    link: "https://www.nike.com/t/club-fleece-pullover-hoodie-qmFXln/BV2654-886",
    image: "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/i1-4fe53d61-3cdc-4cd2-bf72-65a614fac23e/club-fleece-pullover-hoodie-qmFXln.png",
    category: "top",
    brand: "Nike",
    subType: "Pullover Hoodie",
    colorPrimary: "Orange",
    material: "Fleece",
  },
  {
    title: "Nike Sportswear Tech Fleece Full-Zip Hoodie",
    price: "130",
    source: "Nike",
    link: "https://www.nike.com/t/sportswear-tech-fleece-full-zip-hoodie-DXGHsl/FB7921-010",
    image: "https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/i1-0a8a74db-d1a4-4614-b1b7-6d0e024f7b6d/sportswear-tech-fleece-full-zip-hoodie-DXGHsl.png",
    category: "top",
    brand: "Nike",
    subType: "Zip-Up Hoodie",
    colorPrimary: "Black",
    material: "Tech Fleece",
  },
];

// --- Step 1: delete old items ---
console.log("Deleting old test items...");
const { data: deleted, error: delErr } = await sb
  .from("garments")
  .delete()
  .in("id", OLD_IDS)
  .select("id, title");

if (delErr) console.error("Delete error:", delErr.message);
else console.log(`Deleted ${deleted?.length ?? 0} items:`, deleted?.map(d => d.title));

// Also clean up any stale manual crossings from the bad seed run
// (garment DELETE route normally handles this server-side, but since we're
// bypassing the route here, do it directly)
const { data: waState } = await sb
  .from("wardrobe_analysis_state")
  .select("crossed")
  .eq("user_id", USER_ID)
  .single();

if (waState?.crossed) {
  const cleaned = (waState.crossed as Array<{ garmentId?: string }>)
    .filter(e => !OLD_IDS.includes(e.garmentId ?? ""));
  await sb.from("wardrobe_analysis_state").update({ crossed: cleaned }).eq("user_id", USER_ID);
  console.log(`Cleaned crossed array: ${waState.crossed.length} → ${cleaned.length} entries`);
}

// --- Step 2: re-add each item through the same pipeline as the manual API route ---
console.log("\nRe-adding items with AI inference...");

const DEEP_FIELDS = ["sub_type", "aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "pattern", "item_tier", "novelty_quality"];

for (const item of ITEMS) {
  process.stdout.write(`\n[${item.title}] inserting...`);

  const garment = await insertGarment({
    title:         item.title,
    price:         item.price,
    source:        item.source,
    link:          item.link,
    image:         item.image,
    user_id:       USER_ID,
    category:      item.category,
    brand:         item.brand,
    sub_type:      item.subType,
    color_primary: item.colorPrimary,
    material:      item.material,
  });

  process.stdout.write(` [${garment.id}] running AI inference...`);

  try {
    const result = await inferGarmentAttributes(
      {
        title:        item.title,
        category:     item.category,
        subType:      item.subType,
        brand:        item.brand,
        colorPrimary: item.colorPrimary,
        material:     item.material,
        image:        item.image,
        link:         item.link,
      },
      DEEP_FIELDS,
    );

    const v = result.values;
    const isNovelty = (v.item_tier as string | undefined) === "novelty";
    const updates: Record<string, unknown> = {};

    if (v.sub_type)        updates.sub_type        = v.sub_type;
    if (v.aesthetic_tags)  updates.aesthetic_tags  = v.aesthetic_tags;
    if (v.pattern)         updates.pattern         = v.pattern;
    if (v.formality)       updates.formality       = v.formality;
    if (v.material)        updates.material        = v.material;
    if (v.color_pairings)  updates.color_pairings  = v.color_pairings;
    if (v.color_clashes)   updates.color_clashes   = v.color_clashes;
    if (v.item_tier) {
      updates.tags = { ...(garment.tags ?? {}), tier: [v.item_tier] };
    }
    if (isNovelty) { updates.pros = []; updates.cons = []; }
    else {
      if (v.pros) updates.pros = v.pros;
      if (v.cons) updates.cons = v.cons;
    }

    if (Object.keys(updates).length > 0) {
      await sb.from("garments").update(updates).eq("id", garment.id);
    }

    const finalSubType = (v.sub_type as string | undefined) ?? item.subType;
    const slot = getFunctionalSlot(finalSubType);
    process.stdout.write(` slot=${slot ?? "none"} aesthetics=${JSON.stringify(v.aesthetic_tags ?? [])}\n`);
  } catch (err) {
    console.error(` inference failed:`, err);
  }
}

console.log("\nDone. Visit /wardrobe-analysis to let the WA page compute crossings naturally.");
