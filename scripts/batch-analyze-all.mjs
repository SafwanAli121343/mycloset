// Parallel batch analysis of all streetwear_products needing full analysis.
// Runs N workers concurrently to maximize throughput.
// Safe to kill and restart — skips items already having full analysis.
//
// Usage:
//   node scripts/batch-analyze-all.mjs              # 4 workers, 100 items/worker
//   node scripts/batch-analyze-all.mjs --workers 8  # 8 concurrent workers
//   node scripts/batch-analyze-all.mjs --brand Supreme  # one brand only

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

const args      = process.argv.slice(2);
const WORKERS   = args.includes("--workers") ? parseInt(args[args.indexOf("--workers") + 1]) : 4;
const BRAND     = args.includes("--brand") ? args[args.indexOf("--brand") + 1] : null;
const PAGE_SIZE = 100; // items fetched per worker per page

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

const SW_CATS = "hype-streetwear,skate-streetwear,old-money,athletic-prep,gorpcore,workwear-utility,punk-goth,quiet-luxury,maximalist-luxury,normcore,techwear,vintage-90s,preppy-classic,y2k,indie-grunge,high-fashion,mall-core,cottagecore";

async function analyze(p) {
  const ctx = [`Title: "${p.title}"`, `Brand: ${p.brand}`, `Category: ${p.category}`,
    p.price_text && `Price: ${p.price_text}`, p.brand_tier && `Tier: ${p.brand_tier}`]
    .filter(Boolean).join("\n");

  const imageContent = p.image_url
    ? [{ type: "image_url", image_url: { url: p.image_url, detail: "low" } }]
    : [];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Fashion analyst for streetwear/high-fashion app. Gen Z/millennial audience. Apply 2025 standards.
color_primary: single dominant color. color_secondary: ONLY deliberate design element (null for solids).
sub_type: SPECIFIC (T-Shirt/Hoodie/Jeans/Sneakers/Cargo Pants etc, never just "top" or "bottom").
pros: min 4, specific to brand culture and this item. cons: min 3, honest.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${ctx}\nReturn JSON:
{"color_primary":"<from: ${NAMED_COLORS}>","color_secondary":"<same list or null>","sub_type":"<specific>","material":"<primary material>","fit":"<slim|regular|relaxed|oversized|baggy|tapered|straight|wide|skinny|boxy|tailored>","pattern":"<solid|striped|plaid|camo|graphic|floral|checkered|houndstooth|tie-dye|other>","formality":"<casual|smart-casual|business|formal>","aesthetic_tags":["<2-4: streetwear,old-money,minimalist,techwear,workwear,athleisure,vintage,grunge,skate,preppy,quiet-luxury,normcore,gorpcore,punk,goth,maximalist,y2k,90s,indie-sleaze,business-casual,high-fashion>"],"pros":["<4+ specific, 1-2 sentences each>"],"cons":["<3+ honest, 1-2 sentences each>"],"tags":{"color":[],"type":[],"aesthetic":[],"brand":[],"price":[],"streetwear_category":["<1-3: ${SW_CATS}>"],"features":[]}}`,
          },
          ...imageContent,
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  });
  return JSON.parse(res.choices[0].message.content || "{}");
}

async function fetchPage(offset) {
  let q = sb.from("streetwear_products")
    .select("id,brand,title,category,price_text,brand_tier,image_url,sub_type,color_primary")
    .not("image_url", "is", null)
    .is("fit", null) // Only items not yet deeply analyzed
    .range(offset, offset + PAGE_SIZE - 1);
  if (BRAND) q = q.ilike("brand", `%${BRAND}%`);
  const { data } = await q;
  return data || [];
}

let totalUpdated = 0, totalFailed = 0;
const startTime = Date.now();

async function worker(id) {
  let offset = id * PAGE_SIZE;
  let consecutive_empty = 0;
  while (true) {
    const items = await fetchPage(offset);
    if (!items.length) {
      consecutive_empty++;
      if (consecutive_empty >= WORKERS) break; // all workers hitting empty pages
      offset += WORKERS * PAGE_SIZE;
      continue;
    }
    consecutive_empty = 0;

    for (const p of items) {
      try {
        const r = await analyze(p);
        const update = {
          color_primary:   r.color_primary || p.color_primary,
          color_secondary: r.color_secondary || null,
          sub_type:        r.sub_type || p.sub_type,
          material:        r.material,
          fit:             r.fit,
          pattern:         r.pattern,
          formality:       r.formality,
          tags:            r.tags || null,
          analyzed:        true,
        };
        if (r.aesthetic_tags?.length) update.aesthetic_tags = r.aesthetic_tags;
        if (r.pros?.length)           update.pros = r.pros;
        if (r.cons?.length)           update.cons = r.cons;

        const { error } = await sb.from("streetwear_products").update(update).eq("id", p.id);
        if (error) {
          totalFailed++;
          process.stderr.write(`W${id} ✗ ${error.message?.slice(0,60)}\n`);
        } else {
          totalUpdated++;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const rate = (totalUpdated / ((Date.now() - startTime) / 3600000)).toFixed(0);
          process.stdout.write(`\rW${id} | ${totalUpdated} done | ${totalFailed} failed | ${rate}/hr | ${elapsed}s   `);
        }
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        totalFailed++;
        process.stderr.write(`\nW${id} error: ${err.message?.slice(0, 80)}\n`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    offset += WORKERS * PAGE_SIZE;
  }
}

// Count total items needing analysis
const { count } = await sb.from("streetwear_products")
  .select("*", { count: "exact", head: true })
  .not("image_url", "is", null)
  .is("fit", null);

console.log(`Items needing deep analysis: ${count}`);
console.log(`Running ${WORKERS} workers. Each item: ~$0.005. Estimated cost: $${((count || 0) * 0.005).toFixed(0)}\n`);

// Launch workers
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));

console.log(`\n\nComplete! Updated: ${totalUpdated}  Failed: ${totalFailed}`);
