import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  computeMetrics,
  buildWardrobePromptSection,
  resolveSubTypeFromTitle,
  type WardrobeAnalysis,
} from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";
import type { GarmentForScoring } from "@/lib/scoring";

export const maxDuration = 60;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type RawGarment = GarmentForScoring & { category?: string | null; title?: string | null; brand?: string | null };

const GARMENT_FIELDS =
  "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
  "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image, fit";

// POST /api/wardrobe/analysis
// Body: { priorAnalyses?: WardrobeAnalysis[] }
// Same as GET but passes history context so GPT avoids repeating previously covered items.
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { priorAnalyses?: WardrobeAnalysis[] } = {};
  try { body = await req.json(); } catch { /* ignore, treat as no context */ }

  const { data, error } = await sb
    .from("garments")
    .select(GARMENT_FIELDS)
    .eq("user_id", session.userId);
  if (error || !data?.length) return NextResponse.json({ error: "No garments" }, { status: 404 });

  return analyzeWardrobe(data as unknown as RawGarment[], body.priorAnalyses ?? []);
}

// ── Test mode: GET /api/wardrobe/analysis?test=1&n=20
// Pulls random garments from the entire garments table (all users) for testing.

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp       = req.nextUrl.searchParams;
  const testMode = sp.get("test") === "1";
  const testN    = Math.min(parseInt(sp.get("n") ?? "20", 10), 60);

  let garments: RawGarment[];

  if (testMode) {
    // Random wardrobe from all available garments (for prompt testing)
    const { data, error } = await sb.from("garments").select(GARMENT_FIELDS);
    if (error || !data?.length) return NextResponse.json({ error: "No garments" }, { status: 404 });
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    garments = shuffled.slice(0, testN) as unknown as RawGarment[];
  } else {
    const { data, error } = await sb
      .from("garments")
      .select(GARMENT_FIELDS)
      .eq("user_id", session.userId);
    if (error || !data?.length) return NextResponse.json({ error: "No garments" }, { status: 404 });
    garments = data as unknown as RawGarment[];
  }

  return analyzeWardrobe(garments, []);
}

function stripDash(s: string): string {
  return s.replace(/\s*—\s*/g, ": ");
}

async function analyzeWardrobe(garments: RawGarment[], priorAnalyses: WardrobeAnalysis[]): Promise<NextResponse> {
  // Fill in sub_type from title for items added without deep analysis,
  // so scoring, the GPT prompt, and gap detection all see the garment correctly.
  const resolvedGarments: RawGarment[] = garments.map(g =>
    g.sub_type ? g : { ...g, sub_type: resolveSubTypeFromTitle(g.title ?? "") }
  );

  const metrics = computeMetrics(resolvedGarments as GarmentForScoring[]);
  const wardrobeSection = buildWardrobePromptSection(resolvedGarments, metrics);

  const coveredAesthetics = Object.entries(metrics.aestheticCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));


  // Fallback missing aesthetics = absent aesthetics list from metrics
  const fallbackMissingAesthetics = metrics.absentAesthetics.slice(0, 3);

  // Build exclusion block from all prior analyses so GPT never repeats something already covered
  let priorSection = "";
  if (priorAnalyses.length > 0) {
    const seenGaps      = [...new Set(priorAnalyses.flatMap(a => a.gaps.map(g => g.description)))];
    const seenAesthetics= [...new Set(priorAnalyses.flatMap(a => a.aesthetics.missing))];
    const seenColors    = [...new Set(priorAnalyses.flatMap(a => a.colors.missing))];
    const seenCons      = [...new Set(priorAnalyses.flatMap(a => a.cons))];
    const lines: string[] = ["PREVIOUSLY COVERED — do NOT repeat any of these in your output:"];
    if (seenGaps.length)       lines.push(`  Gaps already suggested: ${seenGaps.join(", ")}`);
    if (seenAesthetics.length) lines.push(`  Missing aesthetics already suggested: ${seenAesthetics.join(", ")}`);
    if (seenColors.length)     lines.push(`  Missing colors already suggested: ${seenColors.join(", ")}`);
    if (seenCons.length)       lines.push(`  Weaknesses from prior analysis (go DEEPER — same category is fine, but add new specificity, context, or scenario): ${seenCons.join(" | ")}`);
    lines.push("Find NEW gaps, aesthetics, and colors not in the above lists.");
    lines.push("For weaknesses (cons): go deeper than the prior level. Identify SPECIFIC subcategory gaps, context failures (weather, occasion, formality transition), silhouette over-reliance, or systemic pattern issues not captured before. Every wardrobe has more specific weaknesses to surface — never return [].");
    priorSection = "\n\n" + lines.join("\n");
  }

  const systemPrompt = `You are a professional menswear stylist and wardrobe analyst. Give HONEST, SPECIFIC, ACTIONABLE analysis grounded in the wardrobe data provided. Every observation must be traceable to the actual items, counts, or colors listed. Be direct and precise.`;

  const userPrompt = `${wardrobeSection}${priorSection}

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
- pros: 3-6 full-sentence observations about the WARDROBE AS A WHOLE. Analyze its aesthetic direction, color story, category balance, silhouette range, or formality coverage. Write about the collection as a singular entity — do NOT frame pros as what a specific piece does for or adds to the wardrobe.
- cons: 2-4 full-sentence observations. Every wardrobe below a perfect score has weaknesses — find them. Even strong wardrobes have blind spots: over-reliance on one silhouette, limited occasion coverage, weather-specific gaps, formality transition failures, or lack of versatility in a category. Be specific and grounded in the data. Never return [].
- gaps: 0-4 items ordered high→low impact. ONLY use slot names from "Functional slots MISSING". Never suggest a slot from "Functional slots COVERED". Return [] if there are no meaningful functional gaps. Critical: if ALL footwear slots are missing (casual sneaker, boot, dress shoe, casual sandal / slide are ALL in "Functional slots MISSING"), you MUST include at least one footwear gap — it is the single highest-impact omission possible.
- overdone: 0-4 items. ONLY include sub-types from "High-frequency sub-types (3+)". If that line says "none", return [].
- missing_aesthetics: 2-3 items. ONLY choose from "Aesthetics completely absent" — never pick from "Aesthetics present".
- missing_colors: 2-5 colors that are genuinely absent and would benefit this wardrobe. CRITICAL: check "Color families covered" first — if a family is listed there, every synonym in that family is ALREADY PRESENT. Never suggest any color from a covered family. Never suggest a color from "All colors treated as present". Choose contextually: a streetwear wardrobe benefits from Olive, Burgundy; a formal wardrobe benefits from Brown, Burgundy. If warm neutrals are covered (Beige present → Camel/Cream/Tan covered), skip them and suggest other palette gaps instead.
- insights: 2-4 full-sentence observations unique to this wardrobe. No em dashes — use colons instead.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0.25,
  });

  let gpt: {
    pros?: string[]; cons?: string[];
    gaps?: Array<{ description: string; type: string; impact: string; reason: string }>;
    overdone?: Array<{ description: string; count: number; suggestion: string }>;
    missing_aesthetics?: string[];
    missing_colors?: string[];
    insights?: string[];
  } = {};

  try {
    gpt = JSON.parse(completion.choices[0].message.content ?? "{}");
  } catch {
    gpt = {};
  }

  // Use GPT-provided missing colors if available, fall back to computed
  // Post-process: strip any color GPT suggested that's already covered by a wardrobe color's synonym family
  const rawMissingColors = gpt.missing_colors?.length ? gpt.missing_colors : metrics.missingEssentials.slice(0, 6);
  const wardrobeColorNorms = metrics.allColors.map(c => c.toLowerCase().trim());
  const missingColors = rawMissingColors.filter(mc => !wardrobeColorNorms.some(wc => sameColorGroup(mc, wc)));

  // Use GPT-provided missing aesthetics; validate they're actually absent; fall back to computed
  const missingAesthetics = (gpt.missing_aesthetics?.length
    ? gpt.missing_aesthetics.filter(a => !metrics.aestheticCounts[a])
    : fallbackMissingAesthetics);

  const analysis: WardrobeAnalysis = {
    score:       metrics.score,
    scoreBreakdown: {
      // Approximate breakdown from the formula in scoring.ts
      pieceQuality:        Math.round((metrics.avgPieceScore / 100) * 25),
      categoryCoverage:    Math.min(
        ([...metrics.slotCoverage].reduce((acc, s) => {
          const pts: Record<string, number> = { base:5, bottom:5, foot:4, outer:2, mid:1, vest:1, acc:1, onepiece:2 };
          return acc + (pts[s] ?? 0);
        }, 0)),
        20,
      ),
      colorCohesion:       Math.round((1 - metrics.missingEssentials.length / 15) * 20),
      outfitPotential:     metrics.comboCountEstimate >= 30 ? 15 : metrics.comboCountEstimate >= 10 ? 10 : metrics.comboCountEstimate >= 5 ? 7 : 4,
      qualityDistribution: Math.max(0, (metrics.heroCount >= 1 ? 5 : 0) + (metrics.workhouseCount >= 2 ? 4 : 0) - (metrics.weakCount > metrics.pieceCount * 0.3 ? 3 : 0)),
      aestheticDepth:      Math.min(10, Object.keys(metrics.aestheticCounts).length * 1.5),
    },
    pieceCount:  metrics.pieceCount,
    pros:        (gpt.pros    ?? []).map(stripDash),
    cons:        (gpt.cons    ?? []).map(stripDash),
    colors: {
      have:    metrics.allColors,
      missing: missingColors,
    },
    aesthetics: {
      covered: coveredAesthetics,
      missing: missingAesthetics,
    },
    subTypeFrequency: metrics.subTypeCounts,
    gaps:     (gpt.gaps ?? []).map(g => ({
      description: g.description,
      type:        (g.type as "piece_type" | "specific_piece" | "category") || "piece_type",
      impact:      (g.impact as "high" | "medium" | "low") || "medium",
      reason:      stripDash(g.reason),
      costPoints:  metrics.slotCostMap[g.description] ||
                   (g.impact === "high" ? 5 : g.impact === "medium" ? 3 : 2),
    })),
    overdone: gpt.overdone ?? [],
    insights: (gpt.insights ?? []).map(stripDash),
    generatedAt: new Date().toISOString(),
    conGapLinks: (() => {
      const links: Record<string, string> = {};
      const cons = gpt.cons ?? [];
      const gaps = gpt.gaps ?? [];
      for (let i = 0; i < cons.length; i++) {
        const conLc = cons[i].toLowerCase();
        for (const gap of gaps) {
          const keywords = gap.description.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
          if (keywords.some(w => conLc.includes(w))) {
            links[String(i)] = gap.description;
            break;
          }
        }
      }
      return links;
    })(),
  };

  return NextResponse.json(analysis);
}
