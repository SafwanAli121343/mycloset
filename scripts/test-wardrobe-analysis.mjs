// Quick test of wardrobe analysis prompt quality.
// Usage: node test-wardrobe-analysis.mjs [n=20]
// Pulls n random garments from the DB and calls the analysis.

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { createRequire } from "module";

// Load env vars from .env.local
const envPath = "/Users/safwanali/MyCloset/mycloset/.env.local";
const envVars = {};
try {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) envVars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {
  console.error("Could not read .env.local:", e.message);
  process.exit(1);
}

const sb = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: envVars.OPENAI_API_KEY });

const n = parseInt(process.argv[2] ?? "20", 10);

const FIELDS =
  "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
  "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image";

// ------------ scoring helpers (inline subset) --------------------------------

function getSlot(sub_type) {
  if (!sub_type) return null;
  const s = sub_type.toLowerCase();
  if (["t-shirt","graphic tee","long sleeve tee","polo","oxford shirt","flannel shirt","linen shirt","dress shirt","camp collar shirt","work shirt","henley","tank top","blouse","knit top","printed shirt","silk shirt"].some(k => s.includes(k.toLowerCase()))) return "base";
  if (["hoodie","sweatshirt","sweater","crewneck","cardigan","quarter zip","half zip","fleece pullover","knitwear","turtleneck","mock neck"].some(k => s.includes(k.toLowerCase()))) return "mid";
  if (["vest","gilet"].some(k => s.includes(k.toLowerCase()))) return "vest";
  if (["jacket","coat","blazer","bomber","trench","puffer","overcoat","moto","biker","denim jacket","leather jacket"].some(k => s.includes(k.toLowerCase()))) return "outer";
  if (["pants","jeans","trousers","shorts","chinos","cargo","joggers","sweatpants","leggings","skirt"].some(k => s.includes(k.toLowerCase()))) return "bottom";
  if (["shoes","sneakers","boots","loafers","sandals","slides","oxfords","derby","mule","chelsea"].some(k => s.includes(k.toLowerCase()))) return "foot";
  if (["overall","jumpsuit","romper","dungaree"].some(k => s.includes(k.toLowerCase()))) return "onepiece";
  return "acc";
}

function scoreBasic(g) {
  // Very rough scoring for the test
  const materialTiers = { cashmere:5, wool:4, leather:4, silk:4, linen:3, cotton:3, denim:3, polyester:2, nylon:2, acrylic:1 };
  const mat = (g.material ?? "").toLowerCase();
  const matTier = Object.entries(materialTiers).find(([k]) => mat.includes(k))?.[1] ?? 2;
  const matScore = matTier * 8;
  const tagBonus = (g.aesthetic_tags?.length ?? 0) * 4;
  return Math.min(100, matScore + tagBonus + 30);
}

// Normalize aesthetic tag names to consistent display names
const AESTHETIC_ALIASES = {
  "boho": "bohemian",
  "old-money": "old money",
  "quiet-luxury": "quiet luxury",
  "90s": "90s retro",
};
function normalizeAesthetic(tag) {
  return AESTHETIC_ALIASES[tag] ?? tag;
}

// Functional slot groupings — used to produce "Functional roles covered" for GPT
const SLOT_MAP = {
  "base layer": ["T-Shirt","Graphic Tee","Long Sleeve Tee","Henley","Tank Top","Blouse","Polo","Knit Top","Printed Shirt","Silk Shirt"],
  "casual shirt / button-up": ["Dress Shirt","Oxford Shirt","Flannel Shirt","Linen Shirt","Work Shirt","Camp Collar Shirt"],
  "pullover mid layer": ["Hoodie","Sweatshirt","Sweater","Crewneck","Fleece Pullover","Knitwear","Turtleneck"],
  "zip-up / open mid layer": ["Zip-Up Hoodie","Cardigan","Quarter Zip","Half Zip"],
  "lightweight jacket": ["Harrington Jacket","Bomber Jacket","Denim Jacket","Varsity Jacket","Track Jacket","Windbreaker"],
  "structured outerwear": ["Blazer","Sport Coat","Suit Jacket"],
  "heavy outerwear": ["Leather Jacket","Moto Jacket","Puffer Jacket","Overcoat","Trench Coat","Peacoat"],
  "denim bottom": ["Jeans","Relaxed Jeans","Baggy Jeans","Slim Jeans","Straight Jeans","Selvedge Jeans"],
  "casual pant": ["Chinos","Cargo Pants","Joggers","Sweatpants","Corduroy Pants"],
  "formal pant": ["Dress Pants","Trousers","Slacks"],
  "shorts": ["Shorts","Basketball Shorts","Swim Shorts"],
  "casual sneaker": ["Sneakers","Basketball Sneakers","Running Shoes","Low-Top Sneakers","High-Top Sneakers"],
  "casual sandal / slide": ["Sandals","Slides","Birkenstocks","Mules"],
  "boot": ["Work Boots","Chelsea Boots","Combat Boots","Chukka Boots","Hiking Boots"],
  "dress shoe": ["Oxford Shoes","Derby Shoes","Loafers","Monk Straps"],
  "vest / outerwear vest": ["Vest","Gilet","Puffer Vest"],
};

function getSlotForSubType(sub_type) {
  if (!sub_type) return null;
  const sWords = new Set(sub_type.toLowerCase().split(/\s+/));
  let bestSlot = null;
  let bestScore = -1;

  for (const [slot, types] of Object.entries(SLOT_MAP)) {
    for (const t of types) {
      const tWords = new Set(t.toLowerCase().split(/\s+/));
      const sInT = [...sWords].every(w => tWords.has(w));
      const tInS = [...tWords].every(w => sWords.has(w));
      if (!sInT && !tInS) continue;
      const overlap = [...sWords].filter(w => tWords.has(w)).length;
      // Prefer exact/mutual match, then more overlap
      const score = overlap + (sInT && tInS ? 100 : 0) + (sInT ? 10 : 0) + (tInS ? 10 : 0);
      if (score > bestScore) { bestScore = score; bestSlot = slot; }
    }
  }
  return bestSlot;
}

function buildWardrobeStr(garments, n) {
  const cats = ["top","bottom","outerwear","footwear","accessory"];
  const catLabels = { top:"TOPS", bottom:"BOTTOMS", outerwear:"OUTERWEAR", footwear:"FOOTWEAR", accessory:"ACCESSORIES" };

  let itemNum = 1;
  let s = `=== WARDROBE (${garments.length} pieces) ===\n\n`;

  for (const cat of cats) {
    const items = garments.filter(g => g.category === cat);
    if (!items.length) continue;
    s += `${catLabels[cat]} (${items.length}):\n`;
    for (const g of items) {
      const slot = getSlotForSubType(g.sub_type);
      const normalizedAesthetics = (g.aesthetic_tags ?? []).map(normalizeAesthetic);
      const parts = [
        `[#${itemNum++}] ${g.sub_type ?? "?"} (${g.brand ?? "?"})`,
        slot ? `→ slot:"${slot}"` : null,
        g.color_primary ? `color:${g.color_primary}${g.color_secondary ? `/${g.color_secondary}` : ""}` : null,
        normalizedAesthetics.length ? `aesthetics:[${normalizedAesthetics.join(", ")}]` : null,
      ].filter(Boolean).join(" · ");
      s += `  ${parts}\n`;
    }
    s += "\n";
  }

  const aestheticCounts = {};
  for (const g of garments)
    for (const t of g.aesthetic_tags ?? [])  {
      const norm = normalizeAesthetic(t);
      aestheticCounts[norm] = (aestheticCounts[norm] ?? 0) + 1;
    }

  const subTypeCounts = {};
  for (const g of garments)
    if (g.sub_type) subTypeCounts[g.sub_type] = (subTypeCounts[g.sub_type] ?? 0) + 1;

  const overdone = Object.entries(subTypeCounts).filter(([,v]) => v >= 3).sort((a,b) => b[1]-a[1]);

  const allColors = [...new Set([
    ...garments.map(g => g.color_primary),
    ...garments.map(g => g.color_secondary),
  ].filter(Boolean))];

  // Compute functional slots covered
  const coveredSlots = new Set(garments.map(g => getSlotForSubType(g.sub_type)).filter(Boolean));
  const allSlots = Object.keys(SLOT_MAP);
  const missingSlots = allSlots.filter(s => !coveredSlots.has(s));

  // Compute absent aesthetics programmatically
  const KNOWN_AESTHETICS = [
    "streetwear","minimalist","old money","preppy","techwear","workwear","bohemian",
    "skate","grunge","punk","normcore","athleisure","vintage","retro","quiet luxury",
    "maximalist","goth","avant-garde","cottagecore","coastal","dark academia",
    "military","western","Y2K","90s retro","hip-hop","surf","ivy league",
  ];
  const presentAestheticNames = new Set(Object.keys(aestheticCounts));
  const absentAesthetics = KNOWN_AESTHETICS.filter(a => !presentAestheticNames.has(a));

  s += `=== METRICS ===\n`;
  s += `Colors present: ${allColors.join(", ")}\n`;
  s += `Aesthetics present: ${Object.entries(aestheticCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}(${v})`).join(", ") || "none"}\n`;
  s += `Aesthetics completely absent: ${absentAesthetics.join(", ")}\n`;
  const catCounts = { top:0, bottom:0, outerwear:0, footwear:0, accessory:0 };
  for (const g of garments) if (g.category) catCounts[g.category] = (catCounts[g.category]??0)+1;
  s += `Category counts: ${Object.entries(catCounts).map(([k,v])=>`${k}:${v}`).join(", ")}\n`;
  s += `Functional slots COVERED: ${[...coveredSlots].join(", ")}\n`;
  s += `Functional slots MISSING: ${missingSlots.join(", ")}\n`;
  if (overdone.length) s += `High-frequency sub-types (3+): ${overdone.map(([k,v])=>`${k}×${v}`).join(", ")}\n`;
  else s += `High-frequency sub-types (3+): none\n`;

  return s;
}

async function main() {
  console.log(`Fetching ${n} random garments...`);
  const { data, error } = await sb.from("garments").select(FIELDS);
  if (error || !data?.length) { console.error("DB error:", error?.message ?? "no data"); process.exit(1); }

  const shuffled = [...data].sort(() => Math.random() - 0.5);
  const garments = shuffled.slice(0, n);

  console.log(`\nWardrobe (${garments.length} items):`);
  console.log(garments.map((g, i) => `  [${i+1}] ${g.category?.padEnd(10)} ${g.sub_type?.padEnd(25)} ${g.color_primary?.padEnd(15)} ${g.brand ?? ""}`).join("\n"));

  const wardrobeSection = buildWardrobeStr(garments, n);

  console.log("\nCalling GPT-4o...");
  const t0 = Date.now();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a professional menswear stylist and wardrobe analyst. Give HONEST, SPECIFIC, ACTIONABLE analysis of the wardrobe provided. Every observation must be grounded in the actual wardrobe data. Be direct and precise.`
      },
      {
        role: "user",
        content: `${wardrobeSection}

Analyze this wardrobe. Return ONLY valid JSON (no markdown fences):
{
  "pros": [
    "The color palette holds a tight range of controlled neutrals with deliberate accent pops: cohesive and low-conflict across the full wardrobe.",
    "..."
  ],
  "cons": [
    "With only 2 outerwear pieces and no heavy outerwear, cold-weather layering options are thin: the wardrobe cannot handle a sustained temperature drop.",
    "..."
  ],
  "gaps": [
    {
      "description": "structured outerwear",
      "type": "piece_type",
      "impact": "high",
      "reason": "No blazer or sport coat: the wardrobe has no smart-casual register and cannot dress up beyond a button-up shirt."
    }
  ],
  "overdone": [],
  "missing_aesthetics": ["avant-garde", "military"],
  "missing_colors": ["Burgundy", "Olive"],
  "insights": [
    "Four baggy/relaxed denim pieces dominate the bottom half: versatile in isolation but heavy on one silhouette.",
    "..."
  ]
}

Hard rules:
- pros: 4-6 full-sentence observations about the WARDROBE AS A WHOLE. Analyze its aesthetic direction, color story, category balance, silhouette range, or formality coverage. Write about the collection as a singular entity — do NOT frame pros as what a specific piece does for or adds to the wardrobe.
- cons: 4-6 full-sentence observations. Reference category counts, slot absences, or color/aesthetic weaknesses of the wardrobe as a whole.
- gaps: 2-6 items ordered high→low impact. ONLY use slot names from "Functional slots MISSING". Never suggest a slot from "Functional slots COVERED".
- overdone: 0-4 items. ONLY include sub-types from "High-frequency sub-types (3+)". If that line says "none", return [].
- missing_aesthetics: 2-3 items. ONLY choose from "Aesthetics completely absent" — never pick from "Aesthetics present".
- missing_colors: 2-5 colors absent from "Colors present" that would benefit this specific wardrobe.
- insights: 2-4 full-sentence observations unique to this wardrobe. No em dashes — use colons instead.`
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0.25,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nGPT response (${elapsed}s):\n`);

  try {
    const result = JSON.parse(completion.choices[0].message.content ?? "{}");
    console.log(JSON.stringify(result, null, 2));

    // Evaluate
    console.log("\n=== SELF-EVALUATION ===");
    console.log(`Pros: ${result.pros?.length ?? 0} items`);
    console.log(`Cons: ${result.cons?.length ?? 0} items`);
    console.log(`Gaps: ${result.gaps?.length ?? 0} items`);
    console.log(`Overdone: ${result.overdone?.length ?? 0} items`);
    console.log(`Missing aesthetics: ${(result.missing_aesthetics ?? []).join(", ")}`);
    console.log(`Missing colors: ${(result.missing_colors ?? []).join(", ")}`);
    console.log(`Insights: ${result.insights?.length ?? 0} items`);
  } catch {
    console.error("Failed to parse JSON:", completion.choices[0].message.content);
  }
}

main().catch(console.error);
