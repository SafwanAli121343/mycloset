import { createClient } from "@supabase/supabase-js";
import { scoreOutfit } from "../lib/scoring.js";
import { getSlot } from "../lib/scoring.js";
import type { GarmentForScoring } from "../lib/scoring.js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Row = { id: string; brand: string|null; title: string|null; sub_type: string|null; color_primary: string|null; color_secondary: string|null; pattern: string|null; formality: string|null; material: string|null; aesthetic_tags: string[]|null; pros: string[]|null; cons: string[]|null; color_pairings: string[]|null; color_clashes: string[]|null; tags: Record<string,unknown>|null; image_url: string|null };

function toG(r: Row): GarmentForScoring {
  return { id: r.id, title: r.title, brand: r.brand, sub_type: r.sub_type, material: r.material??null, color_primary: r.color_primary, color_secondary: r.color_secondary??null, pattern: r.pattern??null, formality: r.formality??null, aesthetic_tags: r.aesthetic_tags, pros: r.pros??null, cons: r.cons??null, color_pairings: r.color_pairings??null, color_clashes: r.color_clashes??null, tags: r.tags??null, image: r.image_url??null };
}

async function get(brand: string, kw: string): Promise<GarmentForScoring|null> {
  const { data } = await sb.from("streetwear_products").select("id,brand,title,sub_type,color_primary,color_secondary,pattern,formality,material,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image_url").eq("brand",brand).eq("analyzed",true).ilike("sub_type",`%${kw}%`).not("sub_type","is",null).limit(1);
  return data?.length ? toG(data[0] as Row) : null;
}

async function getOr(brands: string[], kw: string): Promise<GarmentForScoring|null> {
  for (const b of brands) { const r = await get(b, kw); if (r) return r; } return null;
}

function lbl(i: GarmentForScoring) { return `${(i.brand??'?').padEnd(26)} ${(i.sub_type??'?').padEnd(30)} tags: ${(i.aesthetic_tags??[]).join(',')}` }
function sep(s: number) { return s>=70 ? '✅ GOOD' : s>=55 ? '⚠️ MID' : '❌ LOW'; }

console.log("═══════════════════════════════════════════════════════════");
console.log("  PAIR SCORING TESTS — Verifying Structural Penalties");
console.log("═══════════════════════════════════════════════════════════\n");

// Fetch items
const [
  dickie_flannel, awake_flannel, apresse_harrington,
  stussy_polo, noah_polo,
  htg_trackpants, thombrowne_trackpants,
  stussy_tee, carhartt_tee,
  stussy_jeans, represent_sweatpants,
  birkenstocks,
] = await Promise.all([
  get("Dickies","flannel"), get("Awake NY","flannel"),
  get("A.PRESSE","harrington"),
  get("Stussy","polo"), get("Noah","polo"),
  get("Honor The Gift","track pants"), get("Thom Browne","track pants"),
  get("Stussy","t-shirt"), getOr(["Carhartt WIP","Carhartt"],"t-shirt"),
  get("Stussy","jeans"), get("REPRESENT","sweatpants"),
  get("Birkenstock","sandal"),
]);

const tests = [
  {
    name: "❶  Dickies flannel + A.PRESSE Harrington + jeans + Birkenstock",
    desc: "Structured workwear flannel (streetwear) under quiet-luxury jacket → directional penalty should fire",
    items: [dickie_flannel, apresse_harrington, stussy_jeans, birkenstocks],
    wantLow: true,
  },
  {
    name: "❷  Stussy tee + A.PRESSE Harrington + jeans + Birkenstock",
    desc: "Plain tee (neutral) under quiet-luxury jacket → directional penalty SHOULD NOT fire",
    items: [stussy_tee, apresse_harrington, stussy_jeans, birkenstocks],
    wantLow: false,
  },
  {
    name: "❸  Stussy polo + Honor The Gift track pants + Birkenstock",
    desc: "Streetwear polo + streetwear track pants → both streetwear, register penalty SHOULD NOT fire",
    items: [stussy_polo, htg_trackpants, birkenstocks],
    wantLow: false,
  },
  {
    name: "❹  Noah polo + Thom Browne track pants + Birkenstock",
    desc: "Thom Browne track pants (streetwear) + Noah polo (streetwear,vintage) — shared aesthetic, no penalty",
    items: [noah_polo, thombrowne_trackpants, birkenstocks],
    wantLow: false,
  },
  {
    name: "❺  Noah polo + REPRESENT sweatpants + Birkenstock",
    desc: "Noah polo (streetwear,vintage) + REPRESENT sweatpants (streetwear,quiet-luxury) — shared streetwear, no penalty",
    items: [noah_polo, represent_sweatpants, birkenstocks],
    wantLow: false,
  },
  {
    name: "❻  Awake NY flannel + A.PRESSE Harrington + Stussy jeans + Birkenstock",
    desc: "Another streetwear flannel under quiet-luxury jacket → penalty should fire",
    items: [awake_flannel, apresse_harrington, stussy_jeans, birkenstocks],
    wantLow: true,
  },
];

for (const t of tests) {
  const valid = t.items.filter((i): i is GarmentForScoring => i != null);
  if (valid.length < t.items.filter(Boolean).length) { console.log(`SKIP ${t.name} — missing DB item\n`); continue; }
  console.log(t.name);
  console.log(`  ${t.desc}`);
  for (const i of valid) console.log(`  > ${lbl(i)}`);
  const score = scoreOutfit(valid);
  const correct = t.wantLow ? score < 60 : score >= 55;
  console.log(`  Score: ${score} ${sep(score)}  ${correct ? '✔ Correct' : '✘ UNEXPECTED'}\n`);
}
