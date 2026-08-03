#!/usr/bin/env node
// Tests comparison quality: derived approach vs AI prompt.
// Run: npx tsx --env-file=.env.local scripts/test-comparison.mts
//
// Pulls random pairs from streetwear_products (some same-category, some cross-category)
// and evaluates BETTER / WORSE / SIMILARITIES / DIFFERENCES for each approach.

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Row = {
  id: string; title: string | null; brand: string | null;
  category: string | null; sub_type: string | null;
  material: string | null; color_primary: string | null;
  formality: string | null; aesthetic_tags: string[] | null;
  pros: string[] | null; cons: string[] | null;
};

// ── Derived comparison (current in-UI approach) ───────────────────────────────
function derived(a: Row, b: Row) {
  const aesA = new Set(a.aesthetic_tags ?? []);
  const aesB = new Set(b.aesthetic_tags ?? []);
  const prosA = new Set(a.pros ?? []);
  const prosB = new Set(b.pros ?? []);
  const consA = new Set(a.cons ?? []);
  const consB = new Set(b.cons ?? []);

  const better_a = (a.pros ?? []).filter(p => !prosB.has(p));
  const worse_a  = (a.cons ?? []).filter(c => !consB.has(c));
  const better_b = (b.pros ?? []).filter(p => !prosA.has(p));
  const worse_b  = (b.cons ?? []).filter(c => !consA.has(c));

  const sharedAes = (a.aesthetic_tags ?? []).filter(t => aesB.has(t));
  const onlyA     = (a.aesthetic_tags ?? []).filter(t => !aesB.has(t));
  const onlyB     = (b.aesthetic_tags ?? []).filter(t => !aesA.has(t));
  const sharedPros = (a.pros ?? []).filter(p => prosB.has(p));

  const sims: string[] = [];
  if (sharedAes.length > 0) sims.push(`Shared aesthetic: ${sharedAes.join(", ")}`);
  if (a.formality && b.formality && a.formality === b.formality) sims.push(`Same formality: ${a.formality}`);
  sharedPros.slice(0, 3).forEach(p => sims.push(p));

  const diffs: string[] = [];
  if (a.sub_type && b.sub_type && a.sub_type !== b.sub_type) diffs.push(`${a.sub_type} vs ${b.sub_type}`);
  if (a.formality && b.formality && a.formality !== b.formality) diffs.push(`${a.formality} vs ${b.formality}`);
  if (onlyA.length > 0) diffs.push(`${a.title}: ${onlyA.join(", ")}`);
  if (onlyB.length > 0) diffs.push(`${b.title}: ${onlyB.join(", ")}`);

  return { better_a, worse_a, better_b, worse_b, sims, diffs };
}

// ── AI comparison ─────────────────────────────────────────────────────────────
async function compareAI(a: Row, b: Row) {
  const desc = (r: Row) =>
    `${r.title ?? "?"} (${r.category ?? "?"}/${r.sub_type ?? "?"})
  Material: ${r.material ?? "?"}  Color: ${r.color_primary ?? "?"}  Formality: ${r.formality ?? "?"}
  Aesthetics: ${(r.aesthetic_tags ?? []).join(", ") || "none"}
  Strengths: ${(r.pros ?? []).join(", ") || "none"}
  Weaknesses: ${(r.cons ?? []).join(", ") || "none"}`;

  const prompt = `You are a fashion stylist comparing two clothing items to help someone decide between them.

ITEM A — ${desc(a)}

ITEM B — ${desc(b)}

Compare these two items RELATIVE TO EACH OTHER. Do not restate generic strengths or weaknesses — every point must be comparative (i.e., how A compares TO B, not just what A is like in isolation).

Rules:
- BETTER_A: what A does meaningfully better THAN B. Only cite A's advantage if B's data confirms B is weaker there — do not infer B lacks something just because it wasn't listed.
- WORSE_A: what A does meaningfully worse THAN B. Same rule: only cite A's weakness if B's data confirms B handles it better.
- BETTER_B: what B does meaningfully better THAN A (same rule)
- WORSE_B: what B does meaningfully worse THAN A (same rule)
- SIMILARITIES: genuine shared traits (aesthetic, formality, use-case, care needs, styling context)
- DIFFERENCES: meaningful distinctions that affect when to choose one — seasonal range, silhouette, color versatility, styling range

Keep each point to one clear sentence. Aim for 2–4 points per field. Output ONLY valid JSON.

{
  "better_a": [],
  "worse_a": [],
  "better_b": [],
  "worse_b": [],
  "similarities": [],
  "differences": []
}`;

  const res = await oa.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 1200,
  });

  const txt = res.choices[0]?.message?.content ?? "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON in:\n${txt}`);
  return JSON.parse(m[0]) as {
    better_a: string[]; worse_a: string[];
    better_b: string[]; worse_b: string[];
    similarities: string[]; differences: string[];
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { data, error } = await sb
    .from("streetwear_products")
    .select("id, title, brand, category, sub_type, material, color_primary, formality, aesthetic_tags, pros, cons")
    .eq("analyzed", true)
    .not("pros", "is", null)
    .not("aesthetic_tags", "is", null)
    .not("sub_type", "is", null)
    .limit(200);

  if (error || !data?.length) { console.error("DB error:", error); return; }

  const rows = data as Row[];
  console.log(`Fetched ${rows.length} products.\n`);

  // Build pairs: 3 same-category, 2 cross-category
  const bycat: Record<string, Row[]> = {};
  for (const r of rows) {
    const k = r.category ?? "?";
    if (!bycat[k]) bycat[k] = [];
    bycat[k].push(r);
  }

  const pairs: [Row, Row][] = [];

  // Same-category pairs (different sub_types where possible)
  for (const cat of Object.keys(bycat)) {
    if (pairs.length >= 3) break;
    const pool = bycat[cat];
    if (pool.length < 2) continue;
    // Try to find two with different sub_types
    const a = pool[0];
    const b = pool.find((r, i) => i > 0 && r.sub_type !== a.sub_type) ?? pool[1];
    pairs.push([a, b]);
  }

  // Cross-category pairs
  const cats = Object.keys(bycat).filter(c => bycat[c].length > 0);
  for (let i = 0; i < cats.length - 1 && pairs.length < 5; i++) {
    pairs.push([bycat[cats[i]][0], bycat[cats[i + 1]][0]]);
  }

  for (let pi = 0; pi < pairs.length; pi++) {
    const [a, b] = pairs[pi];
    console.log("=".repeat(70));
    console.log(`PAIR ${pi + 1}:`);
    console.log(`  A: ${a.title} | ${a.category}/${a.sub_type} | ${a.formality}`);
    console.log(`     Aesthetics: ${(a.aesthetic_tags ?? []).join(", ")}`);
    console.log(`     Pros: ${(a.pros ?? []).join("; ")}`);
    console.log(`     Cons: ${(a.cons ?? []).join("; ")}`);
    console.log(`  B: ${b.title} | ${b.category}/${b.sub_type} | ${b.formality}`);
    console.log(`     Aesthetics: ${(b.aesthetic_tags ?? []).join(", ")}`);
    console.log(`     Pros: ${(b.pros ?? []).join("; ")}`);
    console.log(`     Cons: ${(b.cons ?? []).join("; ")}`);
    console.log();

    const d = derived(a, b);
    console.log("── DERIVED ──────────────────────────────────────────────");
    console.log(`A BETTER: ${d.better_a.join(" | ") || "(none)"}`);
    console.log(`A WORSE:  ${d.worse_a.join(" | ") || "(none)"}`);
    console.log(`B BETTER: ${d.better_b.join(" | ") || "(none)"}`);
    console.log(`B WORSE:  ${d.worse_b.join(" | ") || "(none)"}`);
    console.log(`SIMILAR:  ${d.sims.join(" | ") || "(none)"}`);
    console.log(`DIFFER:   ${d.diffs.join(" | ") || "(none)"}`);

    try {
      const ai = await compareAI(a, b);
      console.log("\n── AI ───────────────────────────────────────────────────");
      console.log(`A BETTER: ${ai.better_a.join(" | ") || "(none)"}`);
      console.log(`A WORSE:  ${ai.worse_a.join(" | ") || "(none)"}`);
      console.log(`B BETTER: ${ai.better_b.join(" | ") || "(none)"}`);
      console.log(`B WORSE:  ${ai.worse_b.join(" | ") || "(none)"}`);
      console.log(`SIMILAR:  ${ai.similarities.join(" | ") || "(none)"}`);
      console.log(`DIFFER:   ${ai.differences.join(" | ") || "(none)"}`);
    } catch (e) {
      console.error("AI error:", e instanceof Error ? e.message : e);
    }

    console.log();
    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(console.error);
