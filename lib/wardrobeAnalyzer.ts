// The Wardrobe tab report's analysis — shared by /api/wardrobe/analysis (Pro, interactive) and
// the purchased-analysis job runner (lib/analysisJobs.ts), which must run it outside a request.
// Moved out of the route file: Next.js route files may only export handlers/config.
import { aiChat, type AiActor, type AiCallOpts } from "@/lib/aiGateway";
import { getUserProfile, profileSystemMessage } from "@/lib/userAge";
import {
  computeMetrics,
  buildWardrobePromptSection,
  resolveSubTypeFromTitle,
  gapTotalProgress,
  type WardrobeAnalysis,
  type CrossedEntry,
} from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";
import type { GarmentForScoring } from "@/lib/scoring";
import { getUserById, type User } from "@/lib/db/users";
import { resolveEntitlement, consumeAiCredit, consumeErrorMessage } from "@/lib/billing/entitlements";


export type RawGarment = GarmentForScoring & { category?: string | null; title?: string | null; brand?: string | null };

export const GARMENT_FIELDS =
  "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
  "pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image, fit";

// POST /api/wardrobe/analysis
// Body: { priorAnalyses?: WardrobeAnalysis[], crossed?: CrossedEntry[] }
// Same as GET but passes history context so GPT avoids repeating previously covered items.
// `crossed` is the live crossing state: a prior gap/color/aesthetic only stays excluded from
// this new level's suggestions if it's STILL currently resolved. If its filling item was since
// deleted (so it's no longer crossed), it becomes eligible to be surfaced again here.
// Entirely AI-driven (wardrobe leveling/gap analysis) — no non-AI subset makes sense here, same
// reasoning native's WardrobeScreen already uses to lock the whole tab rather than partially
// degrade it. Was previously ungated server-side (client-side locks existed but weren't the only
// path to this endpoint), a real gap found in the free-tier AI audit. This is also the single most
// expensive AI action in the app (reasons over the entire closet in one prompt), so it's a real
// interactive action worth a proper error, not a silent fallback, once a Pro user hits their
// monthly $ cap — unlike garments/pairings' background call, the user is actively sitting on the
// Wardrobe tab waiting for this.
export async function requireAi(userId: string): Promise<{ allowed: boolean; user: User | null; errorMessage?: string }> {
  const billingUser = await getUserById(userId).catch(() => null);
  if (!billingUser || !resolveEntitlement(billingUser).hasAI) {
    return { allowed: false, user: billingUser, errorMessage: "Wardrobe analysis requires an upgrade." };
  }
  const result = await consumeAiCredit(billingUser);
  if (!result.allowed) return { allowed: false, user: billingUser, errorMessage: consumeErrorMessage(result.reason) };
  return { allowed: true, user: billingUser };
}


// ── Test mode: GET /api/wardrobe/analysis?test=1&n=20
// Pulls random garments from the entire garments table (all users) for testing.


function stripDash(s: string): string {
  return s.replace(/\s*—\s*/g, ": ");
}

// Deterministic safety net: strips any color GPT proposed that's already covered by a wardrobe
// color's family (per COLOR_GROUPS — the heuristic), already used in a prior level, or duplicates
// another candidate GPT proposed in the same response. The actual shade-similarity judgment call
// (is this candidate too close to an owned color?) is made by GPT itself as part of generating the
// list in the first place — see the missing_colors instructions below — not by a second AI pass
// after the fact. This filter only catches what the deterministic family table already knows for
// certain, as a backstop against GPT instruction-following slips.
function dedupeAgainstWardrobe(
  candidates: string[],
  wardrobeColorNorms: string[],
  priorColorsSet: Set<string>,
): string[] {
  const kept: string[] = [];
  for (const mcRaw of candidates) {
    const mc = mcRaw.trim();
    if (!mc) continue;
    if (wardrobeColorNorms.some(wc => sameColorGroup(mc, wc))) continue;
    if (priorColorsSet.has(mc.toLowerCase())) continue;
    if (kept.some(k => sameColorGroup(k, mc))) continue;
    kept.push(mc);
  }
  return kept;
}

// Throws on a failed, truncated or unreadable AI reply — never returns an empty report as if it
// were a real one (a purchased analysis must only count when it actually produced something).
export async function analyzeWardrobe(
  garments: RawGarment[], priorAnalyses: WardrobeAnalysis[], crossed: CrossedEntry[],
  billingUser: AiActor, ai: AiCallOpts = {},
): Promise<WardrobeAnalysis> {
  // Fill in sub_type from title for items added without deep analysis,
  // so scoring, the GPT prompt, and gap detection all see the garment correctly.
  const resolvedGarments: RawGarment[] = garments.map(g =>
    g.sub_type ? g : { ...g, sub_type: resolveSubTypeFromTitle(g.title ?? "") }
  );

  const metrics = computeMetrics(resolvedGarments as GarmentForScoring[]);
  const wardrobeSection = buildWardrobePromptSection(resolvedGarments, metrics);

  // Calibrate leveling point values ONCE at Level 1 generation time, from a rough
  // estimate of how much is genuinely left to find across this wardrobe's whole
  // remaining journey to 100 (see WardrobeAnalysis.pointWeights for the full
  // rationale). Only computed for Level 1 - every later level reuses this same
  // value unchanged (via priorAnalyses[0].pointWeights below), so a wardrobe with
  // a lot left to discover gets proportionally smaller per-item rewards than a
  // near-complete one, without ever recomputing from current state (which would
  // break remove/re-add symmetry). Zero extra AI calls - purely computed from
  // metrics already produced above.
  let freshPointWeights: WardrobeAnalysis["pointWeights"];
  if (priorAnalyses.length === 0) {
    const totalGapUnits = metrics.functionalSlotsMissing.length;
    // +4: buffer for GPT's occasional extra creative color suggestion beyond the
    // fixed 15-color essential list.
    const totalColorUnits = metrics.missingEssentials.length + 4;
    const totalAestheticUnits = metrics.absentAesthetics.length;
    // Cons are open-ended (GPT is instructed to keep finding new, deeper ones every
    // level) so there's no real bound to compute - a flat modest estimate instead.
    const totalConUnits = 10;
    const headroom = Math.max(0, 100 - metrics.score);
    // Gaps are weighted 3x a single color/aesthetic/con - each one represents a
    // whole missing functional slot, not a single detail.
    const weightedTotal = totalGapUnits * 3 + totalColorUnits + totalAestheticUnits + totalConUnits;
    const unitValue = weightedTotal > 0 ? headroom / weightedTotal : 1;
    freshPointWeights = {
      gap:       Math.min(6, Math.max(1, Math.round(unitValue * 3))),
      color:     Math.min(3, Math.max(1, Math.round(unitValue))),
      aesthetic: Math.min(3, Math.max(1, Math.round(unitValue))),
      con:       Math.min(2, Math.max(1, Math.round(unitValue))),
    };
  }
  // Level 1's own weights (once it exists) are the canonical, forever-frozen value
  // every later level must reuse - never this level's own freshPointWeights.
  const gapWeight = priorAnalyses[0]?.pointWeights?.gap ?? freshPointWeights?.gap ?? 4;

  const coveredAesthetics = Object.entries(metrics.aestheticCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));


  // Fallback missing aesthetics = absent aesthetics list from metrics
  const fallbackMissingAesthetics = metrics.absentAesthetics.slice(0, 3);

  // Build exclusion block from prior analyses so GPT never repeats something STILL covered.
  // A prior gap/color/aesthetic only counts as "covered" here if it's still currently resolved
  // in `crossed` — if its filling item was since deleted, it's no longer resolved and should be
  // eligible to be suggested again at this new level (see isStillResolved* below).
  const isGapStillResolved = (description: string, level: number) =>
    gapTotalProgress(crossed, description, level) >= 100;
  const isEntryStillResolved = (category: "color" | "aesthetic", key: string, level: number) =>
    crossed.some(e => e.category === category && e.key === key && e.analysisLevel === level);

  let priorSection = "";
  if (priorAnalyses.length > 0) {
    const seenGaps = [...new Set(
      priorAnalyses.flatMap((a, i) => a.gaps.filter(g => isGapStillResolved(g.description, i + 1)).map(g => g.description))
    )];
    const seenAesthetics = [...new Set(
      priorAnalyses.flatMap((a, i) => a.aesthetics.missing.filter(ae => isEntryStillResolved("aesthetic", ae, i + 1)))
    )];
    const seenColors = [...new Set(
      priorAnalyses.flatMap((a, i) => a.colors.missing.filter(c => isEntryStillResolved("color", c, i + 1)))
    )];
    // Cons aren't tracked by resolution here — the instruction below already asks GPT to go
    // deeper rather than treating them as a permanent exclusion list.
    const seenCons = [...new Set(priorAnalyses.flatMap(a => a.cons))];
    const lines: string[] = ["PREVIOUSLY COVERED — do NOT repeat any of these in your output:"];
    if (seenGaps.length)       lines.push(`  Gaps already suggested: ${seenGaps.join(", ")}`);
    if (seenAesthetics.length) lines.push(`  Missing aesthetics already suggested: ${seenAesthetics.join(", ")}`);
    if (seenColors.length)     lines.push(`  Missing colors already suggested: ${seenColors.join(", ")}`);
    if (seenCons.length)       lines.push(`  Weaknesses from prior analysis (go DEEPER — same category is fine, but add new specificity, context, or scenario): ${seenCons.join(" | ")}`);
    lines.push("Find NEW gaps, aesthetics, and colors not in the above lists.");
    lines.push("For weaknesses (cons): go deeper than the prior level. Identify SPECIFIC subcategory gaps, context failures (weather, occasion, formality transition), silhouette over-reliance, or systemic pattern issues not captured before. Every wardrobe has more specific weaknesses to surface — never return [].");
    priorSection = "\n\n" + lines.join("\n");
  }

  const systemPrompt = `You are a professional menswear stylist and wardrobe analyst. Give HONEST, SPECIFIC, ACTIONABLE analysis grounded in the wardrobe data provided. Every observation must be traceable to the actual items, patterns, or colors listed. Be direct and precise.`;

  const userPrompt = `${wardrobeSection}${priorSection}

Analyze this wardrobe. Return ONLY valid JSON (no markdown fences). Every bracketed placeholder below describes what belongs there — it is not example content, and none of it should ever appear literally in your answer:
{
  "pros": ["<full-sentence observation about the wardrobe AS A WHOLE, derived only from the data below>", "..."],
  "cons": ["<full-sentence weakness derived only from the data below>", "..."],
  "gaps": [
    {
      "description": "<a slot name copied verbatim from 'Functional slots MISSING' below>",
      "type": "piece_type",
      "impact": "high | medium | low",
      "reason": "<why this specific wardrobe needs it, derived only from the data below>"
    }
  ],
  "overdone": [
    {
      "description": "<a sub-type copied verbatim from 'High-frequency sub-types' below>",
      "count": <its actual count from the data below, as a number>,
      "suggestion": "<actionable suggestion for diversifying>"
    }
  ],
  "missing_aesthetics": ["<an aesthetic copied verbatim from 'Aesthetics completely absent' below>", "..."],
  "missing_colors": ["<a color genuinely absent from this wardrobe, not a synonym or close shade of any covered color>", "..."],
  "insights": ["<full-sentence observation unique to this wardrobe, derived only from the data below>", "..."]
}

Hard rules — apply identically regardless of what kind of wardrobe this is; none of these are specific to any one wardrobe:
- pros: 3-6 full-sentence observations about the WARDROBE AS A WHOLE. Analyze its aesthetic direction, color story, category balance, silhouette range, or formality coverage. Write about the collection as a singular entity — do NOT frame pros as what a specific piece does for or adds to the wardrobe.
- cons: 2-4 full-sentence observations. Every wardrobe below a perfect score has weaknesses — find them. Consider (only where the data actually supports it): over-reliance on one silhouette, limited occasion coverage, weather-specific gaps, formality transition failures, or lack of versatility in a category. Every con must be grounded in a real, specific pattern from the data below (name the actual color, sub-type, or category involved) — never a generic claim that could apply to any wardrobe. Never return [].
- Across every text field in this response (cons, gaps' reason, overdone's suggestion, insights): never state a specific count or number of items, and avoid broad size words (a lot, too many, too few, several, many, tons) — describe the underlying pattern or imbalance qualitatively instead (e.g. "heavy reliance on graphic tees for casual tops", not "5 graphic tees" or "too many graphic tees"). The wardrobe can change after this analysis is generated (items added or removed), and this level's analysis is never regenerated when that happens, so a stated count or size claim can silently go stale and become wrong.
- gaps: 0-4 items ordered high→low impact. ONLY use slot names from "Functional slots MISSING". Never suggest a slot from "Functional slots COVERED". Return [] if there are no meaningful functional gaps. If ALL footwear slots are missing (casual sneaker, boot, dress shoe, casual sandal / slide are ALL in "Functional slots MISSING"), include at least one footwear gap — going shoeless is always the single highest-impact omission possible, for any wardrobe.
- overdone: 0-4 items. ONLY include sub-types from "High-frequency sub-types (3+)". If that line says "none", return [].
- missing_aesthetics: 2-3 items. ONLY choose from "Aesthetics completely absent" — never pick from "Aesthetics present".
- missing_colors: propose as many colors as this wardrobe genuinely lacks, aiming for 3-6 when the palette supports it (fewer only if the wardrobe's palette is already broad — there is no fixed minimum). Work in two steps for every candidate: (1) identify colors that would meaningfully round out THIS wardrobe's palette given its actual aesthetic direction and existing colors — consider the full color wheel (neutrals, earth tones, jewel tones, accent colors) rather than defaulting to any particular color; (2) check each candidate against "Colors present", "Color families covered", and "All colors treated as present" below, AND against every other candidate already chosen — discard it if it matches, is a synonym of, or is a close shade/tone of any of those (the kind of pair a stylist would call "basically the same color"). Only candidates that survive step 2 go in the final list. Every suggestion must be justified by what this specific wardrobe's data shows is missing — there is no default or generically "safe" color to fall back on.
- insights: 2-4 full-sentence observations unique to this wardrobe. No em dashes — use colons instead.`;

  // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
  const userProfile = await getUserProfile(billingUser === "system" ? null : billingUser.id);
  const completion = await aiChat("openai:chat:wardrobe", {
    model: "gpt-4o",
    messages: [...profileSystemMessage(userProfile), 
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0.25,
  }, billingUser, { timeoutMs: 90_000, ...ai });
  if (completion.finishReason !== "stop") throw new Error(`wardrobe analysis incomplete (${completion.finishReason})`);


  let gpt: {
    pros?: string[]; cons?: string[];
    gaps?: Array<{ description: string; type: string; impact: string; reason: string }>;
    overdone?: Array<{ description: string; count: number; suggestion: string }>;
    missing_aesthetics?: string[];
    missing_colors?: string[];
    insights?: string[];
  } = {};

  try {
    gpt = JSON.parse(completion.content || "");
  } catch {
    throw new Error("wardrobe analysis reply was not valid JSON");
  }

  // Hard dedup sets — never repeat anything STILL currently resolved from a prior level,
  // regardless of GPT compliance. Same resolution-aware logic as seenGaps/seenColors/
  // seenAesthetics above: something resolved-then-unresolved-again is NOT excluded here.
  const priorAestheticsSet = new Set(
    priorAnalyses.flatMap((a, i) => a.aesthetics.missing.filter(ae => isEntryStillResolved("aesthetic", ae, i + 1)).map(ae => ae.toLowerCase()))
  );
  const priorColorsSet = new Set(
    priorAnalyses.flatMap((a, i) => a.colors.missing.filter(c => isEntryStillResolved("color", c, i + 1)).map(c => c.toLowerCase().trim()))
  );
  const priorGapSet = new Set(
    priorAnalyses.flatMap((a, i) => a.gaps.filter(g => isGapStillResolved(g.description, i + 1)).map(g => g.description.toLowerCase()))
  );

  // Use GPT-provided missing colors if available, fall back to computed
  // Post-process: strip any color GPT suggested that's already covered by a wardrobe color's synonym family,
  // that appeared in a prior level's missing colors list, or that duplicates another candidate already
  // kept in this same list (e.g. GPT proposing both "Wine" and "Burgundy" — same family, pick one).
  const rawMissingColors = gpt.missing_colors?.length ? gpt.missing_colors : metrics.missingEssentials.slice(0, 6);
  const wardrobeColorNorms = metrics.allColors.map(c => c.toLowerCase().trim());
  const missingColors = dedupeAgainstWardrobe(rawMissingColors, wardrobeColorNorms, priorColorsSet).slice(0, 6);

  // Use GPT-provided missing aesthetics; validate they're actually absent and not from a prior level; fall back to computed
  const missingAesthetics = (gpt.missing_aesthetics?.length
    ? gpt.missing_aesthetics.filter(a => !metrics.aestheticCounts[a] && !priorAestheticsSet.has(a.toLowerCase()))
    : fallbackMissingAesthetics.filter(a => !priorAestheticsSet.has(a.toLowerCase())));

  // Gaps must come verbatim from "Functional slots MISSING" (the prompt requires this).
  // If GPT paraphrases or invents a slot name, it won't match the canonical set and is dropped.
  // This makes exact-string prior-level dedup reliable: all descriptions share the same vocabulary.
  const validMissingSlots = new Set(metrics.functionalSlotsMissing.map(s => s.toLowerCase()));

  const analysis: WardrobeAnalysis = {
    score:       metrics.score,
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
    gaps:     (gpt.gaps ?? [])
      .filter(g => validMissingSlots.has(g.description.toLowerCase()))
      .filter(g => !priorGapSet.has(g.description.toLowerCase()))
      .map(g => ({
        description: g.description,
        type:        (g.type as "piece_type" | "specific_piece" | "category") || "piece_type",
        impact:      (g.impact as "high" | "medium" | "low") || "medium",
        reason:      stripDash(g.reason),
        // Capped at gapWeight (calibrated once at Level 1 - see freshPointWeights
        // above): slotCostMap is the real scoreWardrobe() marginal-value delta of
        // filling this slot, which for a major missing category (e.g. no footwear at
        // all) can be 10-20+ points on its own - way too large a single-item swing for
        // the leveling score, where a wardrobe may go through many levels before truly
        // reaching 100. The cap keeps gaps meaningfully worth more than a single color/
        // aesthetic/con (see the level-score weights in wardrobe-analysis/page.tsx)
        // without letting one gap dominate the whole level's point budget.
        costPoints:  Math.min(gapWeight, metrics.slotCostMap[g.description] ||
                     (g.impact === "high" ? gapWeight : g.impact === "medium" ? Math.ceil(gapWeight / 2) : 1)),
      })),
    // Validate against real data: only keep sub-types that actually appear 3+ times, and use
    // the real count rather than trusting whatever number GPT returned.
    overdone: (gpt.overdone ?? [])
      .filter(o => (metrics.subTypeCounts[o.description] ?? 0) >= 3)
      .map(o => ({ ...o, count: metrics.subTypeCounts[o.description] })),
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
    // Only set on Level 1 (freshPointWeights is undefined for every later level) -
    // see WardrobeAnalysis.pointWeights for why later levels must never set their own.
    ...(freshPointWeights ? { pointWeights: freshPointWeights } : {}),
  };

  return analysis;
}
