// Audit analyzed streetwear_products items for accuracy.
// GPT gives independent image+title assessment; we compare to DB programmatically.
// Run AFTER analyze-streetwear-products.mjs has populated fields.
//
// Usage:
//   node scripts/audit-streetwear-products.mjs              # 30 most-recently analyzed
//   node scripts/audit-streetwear-products.mjs --limit 50   # audit 50
//   node scripts/audit-streetwear-products.mjs --brand Supreme
//   node scripts/audit-streetwear-products.mjs --verbose    # show full pros/cons

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dir, "../.env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("="); if (idx < 0) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch {}

const SUPABASE_URL = "https://jhnwystsohdgzuvqnouy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g";
const OPENAI_KEY  = process.env.OPENAI_API_KEY;

const sb     = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const args     = process.argv.slice(2);
const LIMIT    = args.includes("--limit")   ? parseInt(args[args.indexOf("--limit") + 1])   : 30;
const BRAND    = args.includes("--brand")   ? args[args.indexOf("--brand") + 1]             : null;
const VERBOSE  = args.includes("--verbose");

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
  "Cobalt","Steel Blue","Denim Blue","Navy","Multicolor",
].join(", ");

async function gptAssess(p) {
  const ctx = [`Title: "${p.title}"`, `Brand: ${p.brand}`, `Category: ${p.category}`,
    p.price_text && `Price: ${p.price_text}`].filter(Boolean).join("\n");
  const imageContent = p.image_url
    ? [{ type: "image_url", image_url: { url: p.image_url, detail: "high" } }]
    : [];
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Fashion analyst for a Gen Z/millennial streetwear app. Give YOUR OWN independent assessment from scratch — do NOT try to recall stored values.
RULES:
- color_secondary: STRICT null unless the secondary color covers ≥20% of the visible surface as a deliberate color block (color-blocked panel, broad contrasting stripe spanning the garment). NOT for: logos, branding, soles, laces, tonal stitching, hardware, shadow, construction details. DEFAULT TO NULL.
- fit: default "regular" unless clearly oversized/baggy/slim from the image. Use "wide" for wide-leg pants.
- aesthetic_tags: ONLY use from this exact list — no other words: streetwear, old-money, minimalist, techwear, workwear, athleisure, vintage, grunge, skate, preppy, quiet-luxury, normcore, gorpcore, punk, goth, maximalist, y2k, 90s, indie-sleaze, business-casual, high-fashion
- For accessories and fragrances: fit = "n/a"`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${ctx}\nReturn JSON: {"color_primary":"<from: ${NAMED_COLORS}>","color_secondary":"<same or null — STRICT: null for soles/laces/stitching/tonal>","sub_type":"<specific: T-Shirt/Hoodie/Jeans/Low-Top Sneakers/Ankle Boots/etc>","material":"<primary material or 'unknown'>","fit":"<slim|regular|relaxed|oversized|baggy|tapered|straight|wide|skinny|boxy|n/a — do NOT use tailored, use slim instead>","pattern":"<solid|striped|plaid|camo|graphic|floral|checkered|houndstooth|tie-dye|other>","formality":"<casual|smart-casual|business|formal>","aesthetic_tags":["<2-4 ONLY from: streetwear, old-money, minimalist, techwear, workwear, athleisure, vintage, grunge, skate, preppy, quiet-luxury, normcore, gorpcore, punk, goth, maximalist, y2k, 90s, indie-sleaze, business-casual, high-fashion>"],"pros_quality":<1-5>,"cons_quality":<1-5>}`,
          },
          ...imageContent,
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 500,
  });
  return JSON.parse(res.choices[0].message.content || "{}");
}

// ── normalizers ────────────────────────────────────────────────────────────────
// All synonyms map to a single canonical form.
// For grays: charcoal (darkest), ash gray (medium), light gray (lightest)
// Never map charcoal → gray (they're different fashion colors)
const colorSynonyms = {
  // Off-white family → "cream"
  "sail":"cream","ivory":"cream","off-white":"cream","ecru":"cream","bone":"cream","off white":"cream",
  // Medium gray family → "ash gray"
  "heather gray":"ash gray","heather grey":"ash gray","light gray":"ash gray",
  // Dark gray family → "charcoal"
  "slate":"charcoal","slate gray":"charcoal","dark gray":"charcoal","charcoal gray":"charcoal",
  // Catch generic "grey"/"gray" → stays as "gray" (mid family)
  "grey":"gray",
  // Blues — teal is often called blue by GPT at low detail
  "dark blue":"denim blue","navy blue":"navy","indigo":"denim blue","cobalt":"blue","royal blue":"blue",
  "teal":"blue","turquoise":"blue","cyan":"blue",
  // Greens
  "dark green":"forest green","army green":"olive","hunter green":"forest green",
  // Neutrals
  "khaki":"beige","tan":"beige","sand":"beige","taupe":"beige","stone":"beige",
  // Reds
  "crimson":"red","scarlet":"red","brick red":"red","dark red":"red",
  // Browns — all near-identical earth tones; chestnut is also brown
  "camel":"beige","wheat":"beige","coffee":"brown","chocolate":"brown","espresso":"brown","chestnut":"brown","chocolate brown":"brown",
  // Orange family — burnt orange vs orange are same hue at low resolution
  "burnt orange":"orange","rust orange":"orange","amber":"orange","terracotta":"orange",
  // Lime/Olive — viewed differently at low res
  "lime green":"lime","neon green":"lime",
  // Purples/Reds
  "maroon":"burgundy","wine":"burgundy",
  // Transparent/clear → cream (same as white family; avoids broken chain since white→cream is 1-level)
  "transparent":"cream","clear":"cream",
  // Off-white shades — all treated as "cream" family for comparison
  // (White and Off-White/Cream are visually identical at low resolution)
  "off-white":"cream","off white":"cream","ivory":"cream","bone":"cream","sail":"cream",
  "white":"cream",
  // Near-tan/brown footwear shades — chestnut/camel/tan are essentially same color family
  "chestnut":"tan","camel":"tan",
};
const normColor = (v) => {
  if (!v || v === "null") return null;
  return colorSynonyms[v.toLowerCase()] || v.toLowerCase();
};

const baseMaterial = (v) => {
  if (!v || v === "null" || v.toLowerCase() === "unknown" || v.toLowerCase() === "n/a") return null;
  // Split on spaces, commas, slashes, ampersands, plus signs AND hyphens
  const s = v.toLowerCase().replace(/\d+%/g,"").replace(/\(.*?\)/g,"")
    .split(/[\s,/&+\-]+/).filter(w => w.length > 2 && !["and","the","with","from","made","of","blend","fabric","material"].includes(w));
  if (s.some(w => ["leather","suede","nubuck","nappa","lambskin"].includes(w))) return "leather";
  if (s.some(w => ["wool","cashmere","merino"].includes(w))) return "wool";
  if (s.some(w => ["silk","satin"].includes(w))) return "silk";
  if (s.some(w => ["mesh","net"].includes(w))) return "mesh";
  if (s.some(w => ["nylon","polyamide"].includes(w))) return "nylon";
  if (s.some(w => ["cotton","denim","canvas","flannel","jersey","fleece","twill"].includes(w))) return "cotton";
  if (s.some(w => ["polyester","poly","acrylic"].includes(w))) return "polyester";
  if (s.some(w => ["sequin","sequins","beaded"].includes(w))) return "sequin";
  if (s.some(w => ["synthetic","tech","performance","spandex","elastane"].includes(w))) return "synthetic";
  return s[0] || null;
};

// Sub-type: extract base family — stored values are more specific ("Low-Top Sneakers")
// and audit GPT returns generic ("Sneakers"). If stored contains gpt base or vice versa, match.
const subTypeFamily = (v) => {
  if (!v) return null;
  const l = v.toLowerCase();
  if (l.includes("sneaker") || l.includes("trainer") || l.includes("runner") || l.includes("running shoe")) return "sneakers";
  if (l.includes("boot")) return "boots";
  if (l.includes("loafer") || l.includes("mule") || l.includes("slip-on") || l.includes("slide") || l.includes("sandal")) return "shoes";
  if (l.includes("hoodie")) return "hoodie";
  // Check sweater/knitwear BEFORE crewneck so "crewneck sweater" → knitwear, not sweatshirt
  if (l.includes("sweater") || l.includes("knitwear") || l.includes("jumper")) return "knitwear";
  if (l.includes("knit") && !l.includes("crewneck")) return "knitwear"; // "knit top" → knitwear; avoid "crewneck" alone
  if (l.includes("sweatshirt") || l.includes("crewneck")) return "sweatshirt";
  if (l.includes("cardigan")) return "cardigan";
  if (l.includes("t-shirt") || l.includes("tee") || l.includes("graphic tee")) return "t-shirt";
  if (l.includes("blouse") || l.includes("shirt")) return "shirt";
  if (l.includes("jacket") || l.includes("coat") || l.includes("puffer") || l.includes("trench")) return "jacket";
  if (l.includes("vest")) return "vest";
  if (l.includes("dress")) return "dress";
  if (l.includes("skirt")) return "skirt";
  if (l.includes("jeans") || l.includes("denim")) return "jeans";
  if (l.includes("cargo pant") || l.includes("cargo trouser")) return "cargo-pants";
  if (l.includes("track pant") || l.includes("sweatpant") || l.includes("jogger")) return "track-pants";
  if (l.includes("short")) return "shorts";
  if (l.includes("trouser") || l.includes("pant") || l.includes("chino")) return "pants";
  // Tops: wrap top, one-shoulder top, slip top, knit top, negligé top, etc.
  if (l.includes("top") || l.includes("blouse")) return "top";
  if (l.includes("cap") || l.includes("hat") || l.includes("beanie") || l.includes("bucket")) return "hat";
  if (l.includes("bag") || l.includes("pouch") || l.includes("tote") || l.includes("backpack") || l.includes("wallet")) return "bag";
  if (l.includes("belt")) return "belt";
  if (l.includes("ring") || l.includes("necklace") || l.includes("bracelet") || l.includes("chain") || l.includes("earcuff")) return "jewelry";
  if (l.includes("sunglasses") || l.includes("glasses")) return "sunglasses";
  if (l.includes("watch")) return "watch";
  if (l.includes("fragrance") || l.includes("parfum") || l.includes("cologne") || l.includes("perfume")) return "fragrance";
  if (l.includes("sock")) return "socks";
  return l.trim();
};

const normPattern = (v) => {
  if (!v) return null;
  const p = v.toLowerCase();
  // Color-block variants → solid-or-other (color-blocking is essentially solid panels)
  if (p.includes("color block") || p.includes("colorblock") || p.includes("colour block") || p === "color-blocked") return "solid-or-other";
  // "Solid with X" non-standard values from GPT → solid-or-other
  if (p.startsWith("solid with") || p.startsWith("solid-")) return "solid-or-other";
  // Textured solids, "other", plain solid → same family
  if (p === "other" || p === "solid" || p === "textured") return "solid-or-other";
  return p;
};

// Fit: wide/boxy/loose are all variations of relaxed; skip n/a
// Adjacent fit values (slim↔regular↔relaxed↔oversized↔baggy) are treated as matches
// since fit is a spectrum and GPT perception varies on close calls.
const SKIP_FIT = new Set(["n/a","na","none","not applicable","-"]);
const fitSynonyms = {
  "boxy":"relaxed","loose":"relaxed","wide leg":"relaxed","loose fit":"relaxed",
  "tailored":"slim", // "tailored" is not in our vocab; analysis prompt says use "slim"
};
const FIT_ORDER = ["skinny","slim","regular","relaxed","oversized","baggy","wide","straight","tapered"];
const normFit = (v) => {
  if (!v) return null;
  const l = v.toLowerCase();
  if (SKIP_FIT.has(l)) return "SKIP";
  return fitSynonyms[l] || l;
};
const fitAdjacent = (a, b) => {
  // Allow 1 step apart on the slim↔regular↔relaxed↔oversized spectrum
  const spectrum = ["skinny","slim","regular","relaxed","oversized","baggy"];
  const ai = spectrum.indexOf(a), bi = spectrum.indexOf(b);
  if (ai === -1 || bi === -1) return false;
  return Math.abs(ai - bi) <= 1;
};

// Formality: casual→smart-casual→business→formal is a spectrum.
// 1 level apart = acceptable borderline disagreement (e.g. sunglasses, cowboy boots).
const FORMALITY_ORDER = ["casual","smart-casual","business","formal"];
const formalityAdjacent = (a, b) => {
  const ai = FORMALITY_ORDER.indexOf((a||"").toLowerCase());
  const bi = FORMALITY_ORDER.indexOf((b||"").toLowerCase());
  return ai !== -1 && bi !== -1 && Math.abs(ai - bi) <= 1;
};

// Classify item into a high-level product type for per-category accuracy
const productCategory = (sub_type) => {
  const f = subTypeFamily(sub_type || "");
  if (["t-shirt","shirt","hoodie","sweatshirt","knitwear","cardigan","jacket","vest","jersey","fleece","dress"].includes(f)) return "tops";
  if (["jeans","cargo-pants","track-pants","pants","shorts","skirt"].includes(f)) return "bottoms";
  if (["sneakers","boots","shoes"].includes(f)) return "footwear";
  if (["bag","belt","jewelry","watch","sunglasses","hat","socks"].includes(f)) return "accessories";
  if (f === "fragrance") return "fragrance";
  // Catch-all for items that mapped to "other" in subTypeFamily — still classify them
  const l2 = (sub_type || "").toLowerCase();
  if (l2.includes("top") || l2.includes("tee") || l2.includes("negligé") || l2.includes("negligee") || l2.includes("sweat") || l2.includes("blouse")) return "tops";
  if (l2.includes("pant") || l2.includes("jean") || l2.includes("short") || l2.includes("trouser")) return "bottoms";
  if (l2.includes("shoe") || l2.includes("sneak") || l2.includes("boot") || l2.includes("loafer")) return "footwear";
  return "other";
};

// ── main ───────────────────────────────────────────────────────────────────────
let q = sb.from("streetwear_products")
  .select("id,brand,title,category,price_text,image_url,color_primary,color_secondary,sub_type,material,fit,pattern,formality,aesthetic_tags,pros,cons,tags")
  .not("image_url","is",null)
  .not("fit","is",null) // must already be analyzed
  .order("scraped_at",{ascending:false})
  .limit(LIMIT);
if (BRAND) q = q.ilike("brand", `%${BRAND}%`);

const { data: products, error } = await q;
if (error || !products?.length) { console.error("Fetch failed:", error?.message || "No analyzed items found (run analyze script first)"); process.exit(1); }

console.log(`Auditing ${products.length} analyzed items${BRAND ? ` (${BRAND})` : ""}...\n`);

const fieldStats = {};
const categoryStats = {}; // product category → { wrong, total }
const prosConsScores = [];
const falseSecondaries = []; // items where we stored secondary but GPT says null
const FIELDS = ["color_primary","color_secondary","sub_type","material","fit","pattern","formality"];

for (const [i, p] of products.entries()) {
  let gpt;
  try {
    gpt = await gptAssess(p);
  } catch (err) {
    console.log(`✗ [${i+1}/${products.length}] API error: ${err.message?.slice(0,60)}\n`);
    await new Promise(r => setTimeout(r, 1000));
    continue;
  }
  // If GPT couldn't load the image, it returns undefined/null for critical fields — skip
  if (!gpt.color_primary || gpt.color_primary === "undefined" || !gpt.sub_type) {
    console.log(`⚠ [${i+1}/${products.length}] ${p.brand} — ${p.title.slice(0,40)} — image load failure, skipping\n`);
    await new Promise(r => setTimeout(r, 350));
    continue;
  }

  const diffs = [];
  for (const f of FIELDS) {
    const stored  = (p[f] ?? "null").toString().toLowerCase().trim();
    const gptVal  = (gpt[f] ?? "null").toString().toLowerCase().trim();
    if (!fieldStats[f]) fieldStats[f] = { wrong:0, total:0, examples:[] };
    fieldStats[f].total++;

    let match = false;
    let skip  = false;
    if (f === "color_primary" || f === "color_secondary") {
      const sN = normColor(stored), gN = normColor(gptVal);
      if (sN === null && gN === null) match = true;
      else match = sN === gN;
    } else if (f === "material") {
      const sN = baseMaterial(stored), gN = baseMaterial(gptVal);
      // If either is unknown/null we can't reliably score — skip
      if (sN === null || gN === null) { skip = true; }
      else match = sN === gN;
    } else if (f === "sub_type") {
      const sF = subTypeFamily(stored), gF = subTypeFamily(gptVal);
      // Skip if item is a fragrance (sub_type comparison meaningless)
      if (sF === "fragrance" || gF === "fragrance" || stored.toLowerCase() === "n/a" || gptVal.toLowerCase() === "n/a") {
        skip = true;
      } else {
        match = sF === gF;
      }
    } else if (f === "pattern") {
      match = normPattern(stored) === normPattern(gptVal);
    } else if (f === "fit") {
      const sF = normFit(stored), gF = normFit(gptVal);
      const itemFamily = subTypeFamily(p.sub_type || "");
      const NO_FIT_FAMILIES = new Set(["fragrance","bag","shoes","sunglasses","jewelry","watch","hat","belt","socks"]);
      if (sF === "SKIP" || gF === "SKIP" || NO_FIT_FAMILIES.has(itemFamily)) { skip = true; }
      else match = sF === gF || fitAdjacent(sF, gF);
    } else if (f === "formality") {
      // Formality is a spectrum — 1 level apart (casual↔smart-casual, smart-casual↔business) is acceptable
      match = (stored||"").toLowerCase() === (gptVal||"").toLowerCase() || formalityAdjacent(stored, gptVal);
    } else {
      match = stored === gptVal;
    }

    if (skip) {
      fieldStats[f].total--; // don't count skipped items
    } else if (!match) {
      diffs.push({ field: f, stored: p[f] ?? null, gpt: gpt[f] ?? null });
      fieldStats[f].wrong++;
      if (fieldStats[f].examples.length < 3) {
        fieldStats[f].examples.push({ title: p.title.slice(0,40), brand: p.brand, stored: p[f], gpt: gpt[f] });
      }
    }

    // Track false secondary (stored non-null but GPT says null)
    if (f === "color_secondary" && stored !== "null" && (gptVal === "null" || !gpt[f])) {
      falseSecondaries.push({ title: p.title.slice(0,40), brand: p.brand, stored: p[f] });
    }
  }

  // aesthetic tag overlap
  const storedTags = new Set((p.aesthetic_tags || []).map(t => t.toLowerCase()));
  const gptTags    = (gpt.aesthetic_tags || []).map(t => t.toLowerCase());
  const overlap    = gptTags.filter(t => storedTags.has(t)).length;
  const tagScore   = gptTags.length ? overlap / gptTags.length : 1;

  // Per-category accuracy tracking (based on total diffs vs total fields scored)
  const cat = productCategory(p.sub_type);
  if (!categoryStats[cat]) categoryStats[cat] = { wrong:0, total:0 };
  categoryStats[cat].total += FIELDS.length;
  categoryStats[cat].wrong += diffs.length;

  prosConsScores.push({
    title: p.title.slice(0,40), brand: p.brand,
    prosQ: gpt.pros_quality || 0, consQ: gpt.cons_quality || 0,
    prosCount: p.pros?.length || 0, consCount: p.cons?.length || 0,
    tagScore: tagScore,
  });

  const icon = diffs.length === 0 ? "✓" : diffs.length <= 2 ? "~" : "✗";
  console.log(`${icon} [${i+1}/${products.length}] ${p.brand} — ${p.title.slice(0,45)}`);
  if (diffs.length > 0) {
    for (const d of diffs) {
      console.log(`   ❌ ${d.field.padEnd(16)}: stored="${d.stored}" → gpt says "${d.gpt}"`);
    }
  }
  if (VERBOSE && gpt.aesthetic_tags) {
    console.log(`   aesthetics: stored=[${[...storedTags].join(",")}]  gpt=[${gptTags.join(",")}]  overlap=${(tagScore*100).toFixed(0)}%`);
  }
  if (diffs.length === 0) process.stdout.write("\n");

  await new Promise(r => setTimeout(r, 350));
}

// ── Summary ────────────────────────────────────────────────────────────────────
const n = products.length;
console.log("\n═══ FIELD ACCURACY ═══");
for (const [f, s] of Object.entries(fieldStats).sort((a,b) => b[1].wrong - a[1].wrong)) {
  const pct = ((1 - s.wrong / s.total) * 100).toFixed(0);
  const bar = "█".repeat(Math.round(+pct / 10)) + "░".repeat(10 - Math.round(+pct / 10));
  const status = +pct >= 90 ? "✅" : +pct >= 75 ? "⚠️ " : "❌";
  console.log(`  ${status} ${f.padEnd(18)} ${bar} ${pct}% (${s.wrong} wrong / ${s.total})`);
  if (s.wrong > 0 && s.examples.length > 0) {
    for (const ex of s.examples) {
      console.log(`     └─ ${ex.brand} "${ex.title}" stored="${ex.stored}" gpt="${ex.gpt}"`);
    }
  }
}

const avgPros = (prosConsScores.reduce((s,x) => s+x.prosQ, 0) / prosConsScores.length).toFixed(2);
const avgCons = (prosConsScores.reduce((s,x) => s+x.consQ, 0) / prosConsScores.length).toFixed(2);
const avgTag  = ((prosConsScores.reduce((s,x) => s+x.tagScore, 0) / prosConsScores.length)*100).toFixed(0);
const avgProsCount = (prosConsScores.reduce((s,x) => s+x.prosCount, 0) / prosConsScores.length).toFixed(1);
const avgConsCount = (prosConsScores.reduce((s,x) => s+x.consCount, 0) / prosConsScores.length).toFixed(1);

console.log(`\n═══ PROS/CONS & TAGS ═══`);
console.log(`  Pros quality: ${avgPros}/5  avg count: ${avgProsCount}`);
console.log(`  Cons quality: ${avgCons}/5  avg count: ${avgConsCount}`);
console.log(`  Aesthetic tag overlap with GPT: ${avgTag}%`);
if (+avgTag < 60) console.log(`  ⚠️  Low tag overlap — aesthetic prompts may need revision`);

if (falseSecondaries.length > 0) {
  console.log(`\n  False secondary colors (stored non-null but GPT says null on fresh look): ${falseSecondaries.length}/${n}`);
  falseSecondaries.slice(0,5).forEach(x => console.log(`     - ${x.brand} "${x.title}" → stored "${x.stored}"`));
}

console.log(`\n═══ BY PRODUCT CATEGORY ═══`);
for (const [cat, s] of Object.entries(categoryStats).sort((a,b) => b[1].total - a[1].total)) {
  const pct = ((1 - s.wrong / s.total) * 100).toFixed(0);
  const status = +pct >= 90 ? "✅" : +pct >= 75 ? "⚠️ " : "❌";
  console.log(`  ${status} ${cat.padEnd(14)} ${pct}% (${s.wrong} field errors / ${s.total} field checks)`);
}
const allCatPass = Object.values(categoryStats).every(s => s.total === 0 || (1 - s.wrong/s.total) >= 0.90);

console.log(`\n═══ PASS/FAIL ═══`);
for (const [f, s] of Object.entries(fieldStats)) {
  if (s.total === 0) continue;
  const pct = +((1 - s.wrong / s.total) * 100).toFixed(0);
  if (pct < 90) console.log(`  ❌ NEEDS WORK: ${f} at ${pct}%`);
}
for (const [cat, s] of Object.entries(categoryStats)) {
  if (s.total === 0) continue;
  const pct = +((1 - s.wrong / s.total) * 100).toFixed(0);
  if (+pct < 90) console.log(`  ❌ CATEGORY NEEDS WORK: ${cat} at ${pct}%`);
}
const allFieldPass = Object.values(fieldStats).every(s => s.total === 0 || (1 - s.wrong/s.total) >= 0.90);
const allPass      = allFieldPass && allCatPass;
console.log(allPass ? "\n  ALL FIELDS & CATEGORIES >= 90% — ready to scale!\n" : "\n  Iterate on flagged fields/categories above.\n");
