#!/usr/bin/env node
/**
 * Full wardrobe-analysis lifecycle test.
 *
 * Tests every case the user described:
 *   - Analyzing 4 different synthetic wardrobes (sparse → strong)
 *   - Adding items that fill gaps, colors, and aesthetics (should cross / progress)
 *   - Adding items that fill NOTHING (should return 0 progress)
 *   - Adding items that partially fill a gap (should return 25–75)
 *   - Accumulating two partial items until the gap resolves
 *   - Removing an item that was crossing something (regression)
 *   - Score bumping: only applies when gap is fully resolved
 *
 * Run: npx tsx --env-file=.env.local scripts/test-wa-lifecycle.mts
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  computeMetrics,
  buildWardrobePromptSection,
  resolveSubTypeFromTitle,
  getFunctionalSlot,
  gapTotalProgress,
  computeGapProgress,
  computeEffectiveLevel,
  colorIsCovered,
  normalizeAesthetic,
  type WardrobeAnalysis,
  type WABackendState,
  type CrossedEntry,
  type WardrobeGap,
} from "../lib/wardrobeAnalysis.js";
import type { GarmentForScoring } from "../lib/scoring.js";

// ── Config ────────────────────────────────────────────────────────────────────

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ── Shared garment type (from DB) ─────────────────────────────────────────────

type RawGarment = GarmentForScoring & {
  category?: string | null;
  title?: string | null;
  brand?: string | null;
  functional_slot?: string | null;
};

// ── Console helpers ───────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  yellow:"\x1b[33m",
  cyan:  "\x1b[36m",
  gray:  "\x1b[90m",
};
const OK   = C.green  + "✓" + C.reset;
const FAIL = C.red    + "✗" + C.reset;
const WARN = C.yellow + "⚠" + C.reset;

let totalPass = 0;
let totalFail = 0;

function check(label: string, got: unknown, expected: unknown, tolerance = 0): boolean {
  const pass = typeof got === "number" && typeof expected === "number"
    ? Math.abs(got - expected) <= tolerance
    : got === expected;
  if (pass) {
    totalPass++;
    console.log(`  ${OK} ${label}`);
  } else {
    totalFail++;
    console.log(`  ${FAIL} ${label} — got ${C.red}${got}${C.reset}, expected ${C.green}${expected}${C.reset}`);
  }
  return pass;
}

function checkRange(label: string, got: number, lo: number, hi: number): boolean {
  const pass = got >= lo && got <= hi;
  if (pass) {
    totalPass++;
    console.log(`  ${OK} ${label} (${got})`);
  } else {
    totalFail++;
    console.log(`  ${FAIL} ${label} — got ${C.red}${got}${C.reset}, expected ${lo}–${hi}`);
  }
  return pass;
}

function section(title: string) {
  console.log(`\n${C.bold}${C.cyan}══ ${title} ══${C.reset}`);
}

// ── GPT analysis (mirrors route.ts exactly) ───────────────────────────────────

function stripDash(s: string) { return s.replace(/\s*—\s*/g, ": "); }

async function runAnalysis(garments: RawGarment[]): Promise<WardrobeAnalysis> {
  const resolved: RawGarment[] = garments.map(g =>
    g.sub_type ? g : { ...g, sub_type: resolveSubTypeFromTitle(g.title ?? "") }
  );

  const metrics = computeMetrics(resolved as GarmentForScoring[]);
  const wardrobeSection = buildWardrobePromptSection(resolved, metrics);
  const coveredAesthetics = Object.entries(metrics.aestheticCounts)
    .sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const fallbackMissing = metrics.absentAesthetics.slice(0, 3);

  const systemPrompt = `You are a professional menswear stylist and wardrobe analyst. Give HONEST, SPECIFIC, ACTIONABLE analysis grounded in the wardrobe data provided. Every observation must be traceable to the actual items, counts, or colors listed. Be direct and precise.`;

  const userPrompt = `${wardrobeSection}

Analyze this wardrobe. Return ONLY valid JSON (no markdown fences):
{
  "pros": ["..."],
  "cons": ["..."],
  "gaps": [{"description": "structured outerwear","type":"piece_type","impact":"high","reason":"..."}],
  "overdone": [],
  "missing_aesthetics": ["avant-garde"],
  "missing_colors": ["Burgundy"],
  "insights": ["..."]
}

Hard rules:
- pros: 3-6 full-sentence observations about the WARDROBE AS A WHOLE.
- cons: 0-4 full-sentence observations. Only report genuine weaknesses grounded in the data. Return [] if there are none.
- gaps: 0-4 items ordered high→low impact. ONLY use slot names from "Functional slots MISSING". Return [] if there are no meaningful functional gaps. Critical: if ALL footwear slots are missing, include at least one footwear gap.
- overdone: 0-4 items from "High-frequency sub-types (3+)" only. Return [] if none.
- missing_aesthetics: 2-3 items ONLY from "Aesthetics completely absent".
- missing_colors: 2-5 colors absent from "Colors present" that would benefit this wardrobe.
- insights: 2-4 full-sentence observations unique to this wardrobe.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0.25,
  });

  let gpt: {
    pros?: string[]; cons?: string[];
    gaps?: Array<{ description: string; type: string; impact: string; reason: string }>;
    overdone?: Array<{ description: string; count: number; suggestion: string }>;
    missing_aesthetics?: string[]; missing_colors?: string[]; insights?: string[];
  } = {};
  try { gpt = JSON.parse(completion.choices[0].message.content ?? "{}"); } catch { gpt = {}; }

  const missingColors = gpt.missing_colors?.length ? gpt.missing_colors : metrics.missingEssentials.slice(0, 6);
  const missingAesthetics = gpt.missing_aesthetics?.length
    ? gpt.missing_aesthetics.filter(a => !metrics.aestheticCounts[a])
    : fallbackMissing;

  return {
    score: metrics.score,
    scoreBreakdown: {
      pieceQuality:        Math.round((metrics.avgPieceScore / 100) * 25),
      categoryCoverage:    Math.min([...metrics.slotCoverage].reduce((acc, s) => {
        const pts: Record<string, number> = { base:5, bottom:5, foot:4, outer:2, mid:1, vest:1, acc:1, onepiece:2 };
        return acc + (pts[s] ?? 0);
      }, 0), 20),
      colorCohesion:       Math.round((1 - metrics.missingEssentials.length / 15) * 20),
      outfitPotential:     metrics.comboCountEstimate >= 30 ? 15 : metrics.comboCountEstimate >= 10 ? 10 : 7,
      qualityDistribution: Math.max(0, (metrics.heroCount >= 1 ? 5 : 0) + (metrics.workhouseCount >= 2 ? 4 : 0) - (metrics.weakCount > metrics.pieceCount * 0.3 ? 3 : 0)),
      aestheticDepth:      Math.min(10, Object.keys(metrics.aestheticCounts).length * 1.5),
    },
    pieceCount:  metrics.pieceCount,
    pros:        (gpt.pros ?? []).map(stripDash),
    cons:        (gpt.cons ?? []).map(stripDash),
    colors: { have: metrics.allColors, missing: missingColors },
    aesthetics:  { covered: coveredAesthetics, missing: missingAesthetics },
    subTypeFrequency: metrics.subTypeCounts,
    gaps: (gpt.gaps ?? []).map(g => ({
      description: g.description,
      type:        (g.type as WardrobeGap["type"]) || "piece_type",
      impact:      (g.impact as WardrobeGap["impact"]) || "medium",
      reason:      stripDash(g.reason),
      costPoints:  metrics.slotCostMap[g.description] ?? 0,
    })),
    overdone: gpt.overdone ?? [],
    insights: (gpt.insights ?? []).map(stripDash),
    generatedAt: new Date().toISOString(),
    conGapLinks: (() => {
      const links: Record<string, string> = {};
      for (let i = 0; i < (gpt.cons ?? []).length; i++) {
        const conLc = (gpt.cons ?? [])[i].toLowerCase();
        for (const gap of (gpt.gaps ?? [])) {
          const kws = gap.description.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
          if (kws.some(w => conLc.includes(w))) { links[String(i)] = gap.description; break; }
        }
      }
      return links;
    })(),
  };
}

// ── Simulate add-item crossing logic ──────────────────────────────────────────

function simulateAddItem(
  item: { id: string; sub_type?: string | null; category?: string | null; color_primary?: string | null; aesthetic_tags?: string[] | null; functional_slot?: string | null },
  analysis: WardrobeAnalysis,
  existingCrossed: CrossedEntry[],
  level: number,
): CrossedEntry[] {
  const garmentId = item.id;
  const sub  = (item.sub_type ?? "").toLowerCase();
  const cat  = (item.category ?? "").toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const newEntries: CrossedEntry[] = [];

  // Gaps (progress-based)
  for (const g of analysis.gaps) {
    const totalSoFar = gapTotalProgress(existingCrossed, g.description, level);
    if (totalSoFar >= 100) continue;
    const alreadyContributed = existingCrossed.some(
      e => e.category === "gap" && e.key === g.description && e.garmentId === garmentId && e.analysisLevel === level
    );
    if (alreadyContributed) continue;
    const progress = computeGapProgress(g.description, item.sub_type, item.category, item.functional_slot);
    if (progress > 0) newEntries.push({ category: "gap", key: g.description, garmentId, analysisLevel: level, progress });
  }

  // Colors (binary)
  if (item.color_primary) {
    const pc = norm(item.color_primary);
    for (const c of analysis.colors.missing) {
      const alreadyCrossed = existingCrossed.some(e => e.category === "color" && e.key === c && e.analysisLevel === level);
      if (alreadyCrossed) continue;
      const nm = norm(c);
      if (nm === pc || nm.includes(pc) || pc.includes(nm)) {
        newEntries.push({ category: "color", key: c, garmentId, analysisLevel: level });
      }
    }
  }

  // Aesthetics (binary)
  for (const tag of (item.aesthetic_tags ?? [])) {
    const nt = norm(tag);
    for (const a of analysis.aesthetics.missing) {
      const alreadyCrossed = existingCrossed.some(e => e.category === "aesthetic" && e.key === a && e.analysisLevel === level);
      if (alreadyCrossed) continue;
      if (norm(a) === nt) newEntries.push({ category: "aesthetic", key: a, garmentId, analysisLevel: level });
    }
  }

  // Cons (linked to gaps or keyword match)
  const resolvedGapKeys = new Set([
    ...analysis.gaps.filter(g => gapTotalProgress([...existingCrossed, ...newEntries], g.description, level) >= 100).map(g => g.description),
    ...newEntries.filter(e => e.category === "gap").map(e => e.key),
  ]);
  const conGapLinks = analysis.conGapLinks ?? {};
  for (let i = 0; i < analysis.cons.length; i++) {
    const alreadyCrossed = existingCrossed.some(e => e.category === "con" && e.key === String(i) && e.analysisLevel === level);
    if (alreadyCrossed) continue;
    const con = analysis.cons[i].toLowerCase();
    const linkedGap = conGapLinks[String(i)];
    const matches = (sub && con.includes(sub)) || (cat && con.includes(cat)) ||
      (linkedGap && resolvedGapKeys.has(linkedGap)) ||
      [...resolvedGapKeys].some(d => con.includes(d));
    if (matches) newEntries.push({ category: "con", key: String(i), garmentId, analysisLevel: level });
  }

  return newEntries;
}

// Compute display score from a backend state
function computeScore(analysis: WardrobeAnalysis, crossed: CrossedEntry[], level: number): number {
  const gapProgressMap: Record<string, number> = {};
  for (const g of analysis.gaps) gapProgressMap[g.description] = gapTotalProgress(crossed, g.description, level);
  const fullyResolved = Object.entries(gapProgressMap).filter(([, p]) => p >= 100).map(([k]) => k);
  const crossedColorKeys = new Set(crossed.filter(e => e.category === "color" && e.analysisLevel === level).map(e => e.key));
  const crossedAesKeys   = new Set(crossed.filter(e => e.category === "aesthetic" && e.analysisLevel === level).map(e => e.key));

  let score = analysis.score;
  for (const key of fullyResolved) {
    const gap = analysis.gaps.find(g => g.description === key);
    score = Math.min(100, score + (gap?.costPoints ?? 0));
  }
  score = Math.min(100, score + crossedColorKeys.size * 2);
  score = Math.min(100, score + crossedAesKeys.size * 1);
  return score;
}

// ── Build synthetic wardrobes ─────────────────────────────────────────────────

function makeItem(overrides: Partial<RawGarment> & { id: string }): RawGarment {
  return {
    sub_type: null, category: null, color_primary: "Black", color_secondary: null,
    material: "Cotton", pattern: "solid", formality: "casual",
    aesthetic_tags: ["streetwear"], pros: ["well-constructed"], cons: null,
    color_pairings: ["White", "Navy"], color_clashes: null, tags: null,
    image: null, title: null, brand: null, functional_slot: null,
    ...overrides,
  } as RawGarment;
}

// ── WARDROBE A: sparse streetwear (missing boots, heavy outerwear, formal pant) ─

const WA_SPARSE: RawGarment[] = [
  makeItem({ id: "a1", sub_type: "Graphic Tee",          category: "top",       color_primary: "White",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "a2", sub_type: "Graphic Tee",          category: "top",       color_primary: "Black",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "a3", sub_type: "Hoodie",               category: "top",       color_primary: "Gray",   aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "a4", sub_type: "Straight Leg Jeans",   category: "bottom",    color_primary: "Navy",   aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "a5", sub_type: "Cargo Pants",          category: "bottom",    color_primary: "Olive",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "a6", sub_type: "Sneakers",             category: "footwear",  color_primary: "White",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "a7", sub_type: "Bomber Jacket",        category: "outerwear", color_primary: "Black",  aesthetic_tags: ["streetwear"] }),
];

// ── WARDROBE B: mid-range mixed (missing structured outerwear, formal pant, dress shoe) ─

const WA_MID: RawGarment[] = [
  makeItem({ id: "b1",  sub_type: "Oxford Shirt",         category: "top",       color_primary: "White",  aesthetic_tags: ["preppy"] }),
  makeItem({ id: "b2",  sub_type: "Graphic Tee",          category: "top",       color_primary: "Black",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "b3",  sub_type: "Crewneck Sweatshirt",  category: "top",       color_primary: "Gray",   aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "b4",  sub_type: "Zip-Up Hoodie",        category: "top",       color_primary: "Charcoal", aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "b5",  sub_type: "Straight Leg Jeans",   category: "bottom",    color_primary: "Navy",   aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "b6",  sub_type: "Chinos",               category: "bottom",    color_primary: "Tan",    aesthetic_tags: ["preppy"] }),
  makeItem({ id: "b7",  sub_type: "Chelsea Boots",        category: "footwear",  color_primary: "Brown",  aesthetic_tags: ["old money"] }),
  makeItem({ id: "b8",  sub_type: "Sneakers",             category: "footwear",  color_primary: "White",  aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "b9",  sub_type: "Trench Coat",          category: "outerwear", color_primary: "Camel",  aesthetic_tags: ["old money"] }),
  makeItem({ id: "b10", sub_type: "Denim Jacket",         category: "outerwear", color_primary: "Indigo", aesthetic_tags: ["streetwear"] }),
];

// ── WARDROBE C: well-covered (expect few/no gaps) ────────────────────────────

const WA_STRONG: RawGarment[] = [
  makeItem({ id: "c1",  sub_type: "Oxford Shirt",            category: "top",       color_primary: "White",    aesthetic_tags: ["minimalist","old money"] }),
  makeItem({ id: "c2",  sub_type: "Graphic Tee",             category: "top",       color_primary: "Black",    aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "c3",  sub_type: "Crewneck Sweater",        category: "top",       color_primary: "Cream",    aesthetic_tags: ["old money"] }),
  makeItem({ id: "c4",  sub_type: "Hoodie",                  category: "top",       color_primary: "Gray",     aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "c5",  sub_type: "Flannel Shirt",           category: "top",       color_primary: "Burgundy", aesthetic_tags: ["workwear"] }),
  makeItem({ id: "c6",  sub_type: "Straight Leg Jeans",      category: "bottom",    color_primary: "Navy",     aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "c7",  sub_type: "Chinos",                  category: "bottom",    color_primary: "Tan",      aesthetic_tags: ["preppy"] }),
  makeItem({ id: "c8",  sub_type: "Dress Pants",             category: "bottom",    color_primary: "Charcoal", aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "c9",  sub_type: "Sneakers",                category: "footwear",  color_primary: "White",    aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "c10", sub_type: "Chelsea Boots",           category: "footwear",  color_primary: "Brown",    aesthetic_tags: ["old money"] }),
  makeItem({ id: "c11", sub_type: "Oxford Shoes",            category: "footwear",  color_primary: "Black",    aesthetic_tags: ["minimalist"] }),
  makeItem({ id: "c12", sub_type: "Blazer",                  category: "outerwear", color_primary: "Navy",     aesthetic_tags: ["old money"] }),
  makeItem({ id: "c13", sub_type: "Trench Coat",             category: "outerwear", color_primary: "Camel",    aesthetic_tags: ["old money"] }),
  makeItem({ id: "c14", sub_type: "Leather Jacket",          category: "outerwear", color_primary: "Black",    aesthetic_tags: ["streetwear"] }),
];

// ── WARDROBE D: overdone tops, missing bottoms ────────────────────────────────

const WA_LOPSIDED: RawGarment[] = [
  makeItem({ id: "d1",  sub_type: "Graphic Tee", category: "top",      color_primary: "Black",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d2",  sub_type: "Graphic Tee", category: "top",      color_primary: "White",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d3",  sub_type: "Graphic Tee", category: "top",      color_primary: "Gray",   aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d4",  sub_type: "Graphic Tee", category: "top",      color_primary: "Navy",   aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d5",  sub_type: "Hoodie",       category: "top",      color_primary: "Black",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d6",  sub_type: "Hoodie",       category: "top",      color_primary: "Gray",   aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d7",  sub_type: "Hoodie",       category: "top",      color_primary: "White",  aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d8",  sub_type: "Straight Leg Jeans", category: "bottom", color_primary: "Indigo", aesthetic_tags: ["streetwear"] }),
  makeItem({ id: "d9",  sub_type: "Sneakers",     category: "footwear", color_primary: "White",  aesthetic_tags: ["streetwear"] }),
];

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function testWardrobe(name: string, garments: RawGarment[]) {
  section(`WARDROBE ${name} — ${garments.length} pieces`);
  console.log(C.gray + "  Running GPT analysis..." + C.reset);

  const analysis = await runAnalysis(garments);
  console.log(`  Score: ${analysis.score} | Gaps: ${analysis.gaps.length} | Cons: ${analysis.cons.length} | Missing colors: ${analysis.colors.missing.length} | Missing aesthetics: ${analysis.aesthetics.missing.length}`);
  console.log(`  Gaps: [${analysis.gaps.map(g => `"${g.description}"`).join(", ")}]`);
  console.log(`  Missing colors: [${analysis.colors.missing.join(", ")}]`);
  console.log(`  Missing aesthetics: [${analysis.aesthetics.missing.join(", ")}]`);

  const level = 1;
  let crossed: CrossedEntry[] = [];

  // ── 1. Add items that SHOULD fill each gap ───────────────────────────────

  if (analysis.gaps.length > 0) {
    console.log(`\n  ${C.bold}[A] Adding correct items for each gap${C.reset}`);
    for (const gap of analysis.gaps) {
      // Build an item that matches this gap's slot exactly
      const slot = gap.description; // gap description IS the slot name from the prompt
      const typicalItem = makeItem({
        id:             `fill_${gap.description.replace(/\s+/g, "_")}`,
        sub_type:       slot,       // exact slot name as sub_type
        category:       guessCategoryFromSlot(slot),
        functional_slot: slot,
      });
      const progress = computeGapProgress(gap.description, typicalItem.sub_type, typicalItem.category, typicalItem.functional_slot);
      checkRange(`Gap "${gap.description}" — exact slot item progress`, progress, 75, 100);
    }
  }

  // ── 2. Add items that SHOULD NOT fill any gap ────────────────────────────

  console.log(`\n  ${C.bold}[B] Adding wrong-category items (expect 0 gap progress)${C.reset}`);
  const wrongItem = makeItem({ id: "wrong", sub_type: "Graphic Tee", category: "top", functional_slot: "base layer" });
  for (const gap of analysis.gaps) {
    if (gap.description.includes("base") || gap.description.includes("top")) continue; // skip if genuinely relevant
    const progress = computeGapProgress(gap.description, wrongItem.sub_type, wrongItem.category, wrongItem.functional_slot);
    check(`Gap "${gap.description}" — wrong item gives 0`, progress, 0);
  }

  // ── 3. Add item that partially fills a "variety" gap (if any) ───────────

  console.log(`\n  ${C.bold}[C] Partial-fill: one item toward a variety gap${C.reset}`);
  const varietyGapDesc = "needs more variety in outerwear";
  const dusters = makeItem({ id: "duster", sub_type: "Duster", category: "outerwear", functional_slot: "heavy outerwear" });
  const prog1 = computeGapProgress(varietyGapDesc, dusters.sub_type, dusters.category, dusters.functional_slot);
  checkRange(`Duster progress toward "${varietyGapDesc}"`, prog1, 25, 75);
  // Accumulate two items
  const entry1: CrossedEntry = { category: "gap", key: varietyGapDesc, garmentId: "duster1", analysisLevel: 1, progress: prog1 };
  const entry2: CrossedEntry = { category: "gap", key: varietyGapDesc, garmentId: "duster2", analysisLevel: 1, progress: prog1 };
  const total = gapTotalProgress([entry1, entry2], varietyGapDesc, 1);
  check(`Two ${prog1}% items accumulate to ${Math.min(100, prog1 * 2)}% total`, total, Math.min(100, prog1 * 2));

  // ── 4. Full add-item cycle for real gaps ─────────────────────────────────

  if (analysis.gaps.length > 0) {
    section(`WARDROBE ${name} — [D] Full add-item cycle`);
    const gap0 = analysis.gaps[0];
    const slot0 = gap0.description;
    const filler = makeItem({
      id: "filler1",
      sub_type: slot0,
      category: guessCategoryFromSlot(slot0),
      functional_slot: slot0,
      color_primary: analysis.colors.missing[0] ?? "Black",
      aesthetic_tags: analysis.aesthetics.missing.length > 0
        ? [analysis.aesthetics.missing[0]]
        : ["streetwear"],
    });

    const entries = simulateAddItem(filler, analysis, crossed, level);
    crossed = [...crossed, ...entries];

    const gapEntries = entries.filter(e => e.category === "gap");
    const colorEntries = entries.filter(e => e.category === "color");
    const aesEntries   = entries.filter(e => e.category === "aesthetic");
    const conEntries   = entries.filter(e => e.category === "con");

    check(`Filler item adds gap entry for "${gap0.description}"`, gapEntries.some(e => e.key === gap0.description), true);

    const gapProgress0 = gapTotalProgress(crossed, gap0.description, level);
    checkRange(`Gap "${gap0.description}" total progress after filler`, gapProgress0, 75, 100);

    if (analysis.colors.missing.length > 0 && filler.color_primary) {
      const candidateColor = analysis.colors.missing.find(c =>
        colorIsCovered(c, [filler.color_primary!])
      );
      if (candidateColor) {
        check(`Color "${candidateColor}" crossed by filler`, colorEntries.some(e => e.key === candidateColor), true);
      }
    }

    if (analysis.aesthetics.missing.length > 0 && (filler.aesthetic_tags?.length ?? 0) > 0) {
      const candidateAes = analysis.aesthetics.missing.find(a =>
        (filler.aesthetic_tags ?? []).map(t => normalizeAesthetic(t).toLowerCase()).includes(a.toLowerCase())
      );
      if (candidateAes) {
        check(`Aesthetic "${candidateAes}" crossed by filler`, aesEntries.some(e => e.key === candidateAes), true);
      }
    }

    console.log(`  ${C.gray}Gap entries: ${gapEntries.length} | Color entries: ${colorEntries.length} | Aesthetic entries: ${aesEntries.length} | Con entries: ${conEntries.length}${C.reset}`);

    // Score should increase only when gap reaches 100%
    const scoreBefore = analysis.score;
    const scoreAfter  = computeScore(analysis, crossed, level);
    if (gapProgress0 >= 100 && gap0.costPoints > 0) {
      check(`Score bumped by ${gap0.costPoints} when gap fully resolved`, scoreAfter, Math.min(100, scoreBefore + gap0.costPoints + colorEntries.length * 2 + aesEntries.length * 1));
    } else if (gapProgress0 < 100) {
      check(`Score NOT bumped while gap still in progress`, scoreAfter <= scoreBefore + colorEntries.length * 2 + aesEntries.length * 1, true);
    }

    // ── 5. Regression: remove the filler item ──────────────────────────────

    console.log(`\n  ${C.bold}[E] Regression: remove filler item${C.reset}`);
    const crossedAfterRemoval = crossed.filter(e => e.garmentId !== "filler1");
    const bs: WABackendState = {
      analysisHistory: [analysis],
      crossed:         crossedAfterRemoval,
      currentLevel:    1,
    };
    const effLevelAfter = computeEffectiveLevel(bs.analysisHistory, bs.crossed, bs.currentLevel);
    check(`Effective level stays at 1 after regression (gap re-opened)`, effLevelAfter, 1);
    const gapProgressAfter = gapTotalProgress(crossedAfterRemoval, gap0.description, level);
    check(`Gap "${gap0.description}" progress returns to 0 after removal`, gapProgressAfter, 0);
    const scoreAfterRemoval = computeScore(analysis, crossedAfterRemoval, level);
    check(`Score regresses after removal`, scoreAfterRemoval <= scoreAfter, true);

    // ── 6. Level advancement: cross everything ─────────────────────────────

    console.log(`\n  ${C.bold}[F] Level advancement: close all gaps + colors + aesthetics${C.reset}`);
    let allCrossed: CrossedEntry[] = [];

    // Cross all gaps
    for (const g of analysis.gaps) {
      allCrossed.push({ category: "gap", key: g.description, garmentId: "fill_all", analysisLevel: level, progress: 100 });
    }
    // Cross all missing colors
    for (const c of analysis.colors.missing) {
      allCrossed.push({ category: "color", key: c, garmentId: "fill_all", analysisLevel: level });
    }
    // Cross all missing aesthetics
    for (const a of analysis.aesthetics.missing) {
      allCrossed.push({ category: "aesthetic", key: a, garmentId: "fill_all", analysisLevel: level });
    }

    const bsFull: WABackendState = {
      analysisHistory: [analysis],
      crossed:         allCrossed,
      currentLevel:    1,
    };
    const effLevelFull = computeEffectiveLevel(bsFull.analysisHistory, bsFull.crossed, bsFull.currentLevel);
    // If everything is fully crossed, computeEffectiveLevel should return 1
    // (all resolved at level 1 → needsFresh triggers next analysis)
    check(`All crossed → effectiveLevel returns currentLevel (1)`, effLevelFull, 1);

    // ── 7. Second item adding same gap already at 100 — should not re-add ──

    console.log(`\n  ${C.bold}[G] Duplicate prevention: add same-gap item twice${C.reset}`);
    const crossed100: CrossedEntry[] = [
      { category: "gap", key: gap0.description, garmentId: "first", analysisLevel: level, progress: 100 },
    ];
    const entries2 = simulateAddItem(filler, analysis, crossed100, level);
    const dupGapEntries = entries2.filter(e => e.category === "gap" && e.key === gap0.description);
    check(`No duplicate gap entry after gap already at 100%`, dupGapEntries.length, 0);
  }
}

function guessCategoryFromSlot(slot: string): string {
  const s = slot.toLowerCase();
  if (s.includes("sneaker") || s.includes("boot") || s.includes("sandal") || s.includes("shoe") || s.includes("slide")) return "footwear";
  if (s.includes("outerwear") || s.includes("jacket") || s.includes("blazer") || s.includes("vest")) return "outerwear";
  if (s.includes("pant") || s.includes("denim") || s.includes("short") || s.includes("trouser") || s.includes("bottom")) return "bottom";
  if (s.includes("dress")) return "bottom";
  return "top";
}

// ── Run all wardrobes ─────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.bold}${C.cyan}Wardrobe Analysis Lifecycle Test${C.reset}`);
  console.log(`Running ${C.bold}4 wardrobes${C.reset} against GPT-4o analysis + full crossing/regression cycle\n`);

  await testWardrobe("A (sparse streetwear)",   WA_SPARSE);
  await testWardrobe("B (mid-range mixed)",      WA_MID);
  await testWardrobe("C (well-covered)",         WA_STRONG);
  await testWardrobe("D (overdone tops)",        WA_LOPSIDED);

  console.log(`\n${C.bold}══ RESULTS ══${C.reset}`);
  console.log(`${C.green}Passed: ${totalPass}${C.reset}  ${C.red}Failed: ${totalFail}${C.reset}`);

  if (totalFail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
