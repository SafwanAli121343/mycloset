// Reliable garment audit: GPT gives its OWN assessment from image alone,
// we compare programmatically to what's in DB. No hallucinated "stored" values.
// Run: node scripts/audit-garments.mjs [--id <id>] [--limit <n>]

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  "https://jhnwystsohdgzuvqnouy.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g"
);
const openai = new OpenAI({
  apiKey: "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"
});

const NAMED_COLORS = [
  "Black","Charcoal","Slate Gray","Gray","Heather Gray","Light Gray","Ash Gray",
  "Off-White","Ivory","Cream","White","Stone","Espresso","Chocolate","Brown",
  "Chestnut","Camel","Tan","Khaki","Sand","Beige","Taupe","Crimson","Red",
  "Brick Red","Maroon","Burgundy","Wine","Rust","Terracotta","Coral","Salmon",
  "Blush","Pink","Hot Pink","Fuchsia","Magenta","Mauve","Purple","Violet",
  "Plum","Eggplant","Lavender","Lilac","Silver","Rose Gold","Platinum","Bronze",
  "Orange","Burnt Orange","Amber","Honey","Wheat","Caramel","Peach","Apricot",
  "Yellow","Mustard","Gold","Butter","Lime","Green","Kelly Green","Emerald",
  "Forest Green","Hunter Green","Olive","Army Green","Sage","Mint","Seafoam",
  "Teal","Turquoise","Sky Blue","Baby Blue","Periwinkle","Blue","Royal Blue",
  "Cobalt","Steel Blue","Denim Blue","Navy",
].join(", ");

const args = process.argv.slice(2);
const singleId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 40;

let query = supabase.from("garments").select("*").not("image", "is", null).order("created_at", { ascending: false });
if (singleId) query = query.eq("id", singleId);
else query = query.limit(limit);

const { data: garments, error } = await query;
if (error || !garments?.length) { console.error("Fetch failed:", error); process.exit(1); }

console.log(`Auditing ${garments.length} garments...\n`);

const fieldStats = {}; // field -> { wrong, total }
const prosConsScores = [];

for (const g of garments) {
  if (!g.image) continue;

  // Ask GPT for its OWN assessment — no stored values in the prompt
  let gpt;
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert fashion analyst for a streetwear/high-fashion wardrobe app targeting a Gen Z/millennial audience who follows Supreme drops, wears Rick Owens, knows their Jordan colorways, and reads Highsnobiety. Your analysis must be brutally honest and culturally literate — not generic mall-brand descriptions.

ACCURACY RULES:
- color_primary: the SINGLE largest-surface-area fabric color. For multi-color/plaid/striped items: the most dominant. NEVER pick a secondary as primary.
- color_secondary: ONLY return a non-null value if there is a DELIBERATE designer element in a clearly different color (stripe, logo, graphic, contrast panel). For solid items: ALWAYS null, even if you see shadows/folds/shading. Return null when unsure.
- brand: read from the ITEM itself (label, logo, text on garment). Ignore the retailer.
- fit: "slim" ONLY when the item is clearly body-fitted. Default to "regular" when cut is standard. Use "tailored" for structured suiting.
- pros: minimum 4, must be specific to THIS item and THIS cultural context. Reference which specific aesthetics it fits and HOW. Be a stylist, not a PR rep.
- cons: minimum 3, be genuinely honest. If something is mid, say it. If it's dated, say it.
- pros_quality and cons_quality: rate your own output 1-5 for specificity and cultural accuracy.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Item title: "${g.title}"
Category: ${g.category}
${g.brand ? `Known brand: ${g.brand}` : ""}
${g.price ? `Price: $${g.price}` : ""}

Analyze this image and return JSON:
{
  "color_primary": "<one name from: ${NAMED_COLORS}>",
  "color_secondary": "<one name from the same list, or null — STRICT: null for solid items, shading, or any uncertainty>",
  "brand": "<exact brand from item itself, or null>",
  "sub_type": "<specific type: T-Shirt, Hoodie, Jeans, Sneakers, Ring, etc.>",
  "material": "<primary material in 1-3 words>",
  "fit": "<slim|regular|relaxed|oversized|baggy|tapered|straight|wide|skinny|boxy|tailored — default regular if unsure>",
  "pattern": "<solid|striped|plaid|camo|graphic|floral|checkered|houndstooth|tie-dye|other>",
  "formality": "<casual|smart-casual|business|formal>",
  "aesthetic_tags": ["<1-4 from: streetwear, old-money, minimalist, techwear, workwear, athleisure, vintage, grunge, skate, preppy, quiet-luxury, normcore, gorpcore, punk, goth, maximalist, y2k, 90s, indie-sleaze>"],
  "pros": ["<minimum 4 — be specific, culturally literate, reference the exact item. Cover: which specific aesthetics/contexts it excels in and WHY, how it interacts with trends, silhouette/proportion notes, versatility vs statement potential, seasonal use. Apply 2025 streetwear/high-fashion standards. Each pro is 1-2 sentences.>"],
  "cons": ["<minimum 3 — genuinely honest. Call out if it's mid, played out, polarizing, or hard to style. Each con is 1-2 sentences.>"],
  "pros_quality": <1-5>,
  "cons_quality": <1-5>
}`
            },
            { type: "image_url", image_url: { url: g.image, detail: "high" } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1200,
    });
    gpt = JSON.parse(res.choices[0].message.content || "{}");
  } catch (err) {
    console.log(`✗ [${g.id.slice(0,8)}] ${g.title.slice(0,50)} — API error: ${err.message}\n`);
    continue;
  }

  // Normalize helpers
  const colorSynonyms = {
    // Off-white family
    "sail": "cream", "ivory": "cream", "off-white": "cream", "ecru": "cream", "bone": "cream",
    // Gray family
    "heather gray": "ash gray", "light gray": "ash gray", "slate gray": "gray", "charcoal": "gray",
    // Blue family
    "dark blue": "denim blue", "navy blue": "navy", "indigo": "denim blue", "cobalt": "blue",
    // Green family
    "dark green": "forest green", "army green": "olive", "hunter green": "forest green",
    // Neutral family
    "khaki": "beige", "tan": "beige", "sand": "beige", "taupe": "beige", "stone": "beige",
    // Red family
    "crimson": "red", "scarlet": "red", "brick red": "red",
    // Brown family
    "camel": "tan", "wheat": "tan", "coffee": "brown", "chocolate": "espresso",
  };
  const normColor = (v) => {
    if (!v || v === "null") return v;
    return colorSynonyms[v.toLowerCase()] || v.toLowerCase();
  };

  // Material: extract base family. Priority: leather > denim > wool > mesh > nylon > cotton > polyester
  // Denim IS cotton but we prefer specificity for denim so it's treated as equivalent to cotton for jeans.
  const baseMaterial = (v) => {
    if (!v || v === "null") return "null";
    const s = v.toLowerCase()
      .replace(/\d+%/g, "")           // strip "100%", "80%", etc.
      .replace(/\(.*?\)/g, "")        // strip parenthetical notes
      .split(/[\s,/&+]+/)
      .filter(w => w.length > 2 && !["and","the","with","from","made"].includes(w));
    if (s.some(w => ["leather","suede","nubuck","nappa"].includes(w))) return "leather";
    if (s.some(w => ["wool","cashmere","merino"].includes(w))) return "wool";
    if (s.some(w => ["mesh","net"].includes(w))) return "mesh";
    if (s.some(w => ["nylon","polyamide"].includes(w))) return "nylon";
    // denim and cotton are equivalent for this comparison
    if (s.some(w => ["cotton","denim","canvas","flannel","jersey","fleece","twill"].includes(w))) return "cotton";
    if (s.some(w => ["polyester","poly","acrylic"].includes(w))) return "polyester";
    if (s.some(w => ["tech","performance","spandex","elastane"].includes(w))) return "synthetic";
    return s[0] || "null";
  };

  // sub_type: treat plural/singular/variant names as equivalent
  const normSubType = (v) => {
    if (!v) return "null";
    return v.toLowerCase()
      .replace("polo shirt", "polo")
      .replace("button-up shirt", "shirt")
      .replace("button up shirt", "shirt")
      .replace("mesh shirt", "shirt")
      .replace("work boots", "boots")
      .replace("track pants", "track pant")   // plural
      .replace("sweatpants", "track pant")
      .trim();
  };

  // pattern: normalize gpt vocabulary to our stored vocabulary
  const normPattern = (v) => {
    if (!v) return "null";
    const p = v.toLowerCase();
    if (p === "color block" || p === "color-block" || p === "colorblock") return "other";
    return p;
  };

  // Compare each field programmatically
  const fields = ["color_primary","color_secondary","brand","sub_type","material","fit","pattern","formality"];
  const diffs = [];
  for (const f of fields) {
    const stored = (g[f] ?? "null").toString().toLowerCase().trim();
    const computed = (gpt[f] ?? "null").toString().toLowerCase().trim();
    if (!fieldStats[f]) fieldStats[f] = { wrong: 0, total: 0 };
    fieldStats[f].total++;

    let match = false;
    if (f === "color_primary" || f === "color_secondary") {
      match = normColor(stored) === normColor(computed);
    } else if (f === "material") {
      match = baseMaterial(stored) === baseMaterial(computed);
    } else if (f === "sub_type") {
      match = normSubType(stored) === normSubType(computed);
    } else if (f === "pattern") {
      match = normPattern(stored) === normPattern(computed);
    } else if (f === "fit") {
      // "relaxed" and "regular" are auditor's most common disagreement — image-only GPT defaults to regular
      // for items where internet context set relaxed; treat as soft mismatch (report but weight less)
      const fitSynonyms = { "boxy": "relaxed", "loose": "relaxed" };
      const normFit = (v) => fitSynonyms[v] || v;
      match = normFit(stored) === normFit(computed);
    } else {
      match = stored === computed;
    }

    if (!match && !(stored === "null" && computed === "null")) {
      diffs.push({ field: f, stored: g[f] ?? null, gpt: gpt[f] ?? null });
      fieldStats[f].wrong++;
    }
  }

  // Check aesthetic tags overlap
  const storedTags = new Set((g.aesthetic_tags || []).map(t => t.toLowerCase()));
  const gptTags = (gpt.aesthetic_tags || []).map(t => t.toLowerCase());
  const tagOverlap = gptTags.filter(t => storedTags.has(t)).length;
  const tagMissing = gptTags.filter(t => !storedTags.has(t));

  // Evaluate pros/cons quality
  const prosQ = gpt.pros_quality || 0;
  const consQ = gpt.cons_quality || 0;
  prosConsScores.push({ id: g.id, title: g.title, prosQ, consQ });

  const status = diffs.length === 0 ? "✓" : diffs.length <= 2 ? "~" : "✗";
  console.log(`${status} [${g.id.slice(0,8)}] ${g.title.slice(0,55)}`);
  console.log(`   DB:  brand="${g.brand}" color="${g.color_primary}/${g.color_secondary}" fit="${g.fit}" sub="${g.sub_type}"`);
  console.log(`   GPT: brand="${gpt.brand}" color="${gpt.color_primary}/${gpt.color_secondary}" fit="${gpt.fit}" sub="${gpt.sub_type}"`);

  if (diffs.length > 0) {
    for (const d of diffs) {
      console.log(`   ❌ ${d.field}: stored="${d.stored}" → gpt="${d.gpt}"`);
    }
  }
  if (tagMissing.length > 0) {
    console.log(`   ⚡ aesthetic: stored=${JSON.stringify([...storedTags])} missing=${JSON.stringify(tagMissing)}`);
  }
  console.log(`   pros_quality=${prosQ}/5  cons_quality=${consQ}/5`);
  if (gpt.pros?.length) {
    console.log(`   PROS SAMPLE: ${gpt.pros[0]?.slice(0, 100)}`);
  }
  if (gpt.cons?.length) {
    console.log(`   CONS SAMPLE: ${gpt.cons[0]?.slice(0, 100)}`);
  }
  console.log(`   tags.sw_cat=${JSON.stringify(g.tags?.streetwear_category)}`);
  console.log(`   tags.features=${JSON.stringify(g.tags?.features)}`);
  console.log();

  await new Promise(r => setTimeout(r, 300));
}

// Summary
console.log("═══ FIELD ACCURACY ═══");
const totalItems = garments.filter(g => g.image).length;
for (const [field, stat] of Object.entries(fieldStats).sort((a,b) => b[1].wrong - a[1].wrong)) {
  const pct = ((1 - stat.wrong / stat.total) * 100).toFixed(0);
  const bar = "█".repeat(Math.round(+pct / 10)) + "░".repeat(10 - Math.round(+pct / 10));
  console.log(`  ${field.padEnd(16)} ${bar} ${pct}% (${stat.wrong} wrong / ${stat.total})`);
}

const avgPros = (prosConsScores.reduce((s,x) => s + x.prosQ, 0) / prosConsScores.length).toFixed(2);
const avgCons = (prosConsScores.reduce((s,x) => s + x.consQ, 0) / prosConsScores.length).toFixed(2);
console.log(`\n═══ PROS/CONS QUALITY ═══`);
console.log(`  Average pros: ${avgPros}/5  cons: ${avgCons}/5`);
const low = prosConsScores.filter(x => x.prosQ < 4 || x.consQ < 4).map(x => `  ${x.title.slice(0,45)} (pros=${x.prosQ} cons=${x.consQ})`);
if (low.length) { console.log(`  Items needing better pros/cons:`); low.forEach(l => console.log(l)); }
