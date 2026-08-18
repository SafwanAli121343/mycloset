import { apiJson } from "./api";
import { sameColorGroup } from "./colorGroups";
import {
  gapTotalProgress, computeGapProgress, getFunctionalSlot, normAesthetic, GAP_AES,
  type WABackendState,
} from "./wardrobeAnalysis";

export type WardrobeImpact = {
  fillsGaps: string[];
  addsAesthetics: string[];
  addsColors: string[];
  addressesWeaknesses: string[];
};
export type OverdoneNote = { type: "pro" | "con"; text: string } | null;

type CandidateItem = {
  title?: string | null;
  sub_type?: string | null;
  category?: string | null;
  color_primary?: string | null;
  aesthetic_tags?: string[] | null;
  pattern?: string | null;
  image?: string | null;
};

// Direct port of PreviewClient.tsx's wardrobe-fill-impact effect: how would adding this
// candidate item move the user's existing wardrobe forward — which open gaps would it close,
// which missing aesthetics/colors would it add, which unresolved weaknesses would it address —
// plus whether it piles onto an already-overdone sub-type or diversifies one. Reads live
// /api/wardrobe/state instead of the website's localStorage cache (same deliberate,
// disclosed deviation as the rest of native's wardrobe-crossing ports — see
// wardrobeCrossing.ts), and reuses the exact same matching primitives already ported there so
// preview, add-item, and the wardrobe screen can never disagree about what "fills a gap" means.
export async function computeWardrobeImpact(item: CandidateItem): Promise<{ impact: WardrobeImpact | null; overdoneNote: OverdoneNote }> {
  let state: WABackendState | null;
  try {
    state = await apiJson<WABackendState | null>("/api/wardrobe/state");
  } catch {
    return { impact: null, overdoneNote: null };
  }
  if (!state || state.analysisHistory.length === 0) return { impact: null, overdoneNote: null };

  const level = Math.max(1, Math.min(state.currentLevel, state.analysisHistory.length));
  const analysis = state.analysisHistory[level - 1] ?? state.analysisHistory[0];
  if (!analysis) return { impact: null, overdoneNote: null };

  const norm = normAesthetic;
  const cat = (item.category ?? "").toLowerCase();
  const sub = (item.sub_type ?? "").toLowerCase();
  const crossed = state.crossed;

  const openGaps = analysis.gaps.filter(g => gapTotalProgress(crossed, g.description, level) < 100);
  const funcSlot = getFunctionalSlot(item.sub_type ?? "");
  const algorithmic = openGaps
    .filter(g => computeGapProgress(g.description, item.sub_type ?? "", cat, funcSlot) >= 100)
    .map(g => g.description);

  let overdoneNote: OverdoneNote = null;
  const overdoneEntries = analysis.overdone ?? [];
  if (item.sub_type && overdoneEntries.length) {
    const subNorm = item.sub_type.toLowerCase().trim();
    const matched = overdoneEntries.find(o => o.description.toLowerCase().trim() === subNorm);
    if (matched) overdoneNote = { type: "con", text: `Overdoes ${matched.description}` };
    else if (funcSlot && overdoneEntries.some(o => getFunctionalSlot(o.description) === funcSlot)) overdoneNote = { type: "pro", text: "Increases variety" };
  }

  const patternStr = (item.pattern ?? "").toLowerCase();
  const titleStr = (item.title ?? "").toLowerCase();
  const patternImplied: string[] = [];
  if (patternStr.includes("camo") || titleStr.includes("camo") || titleStr.includes("camouflage") || sub.includes("camo")) patternImplied.push("military", "gorpcore");
  if (patternStr.includes("plaid") || patternStr.includes("tartan") || titleStr.includes("plaid")) patternImplied.push("preppy", "ivy league");
  if (patternStr.includes("tie-dye") || patternStr.includes("tie dye") || titleStr.includes("tie dye")) patternImplied.push("y2k");
  const allAestheticCandidates = [...new Set([...(item.aesthetic_tags ?? []), ...patternImplied])];
  const baseAesthetics = allAestheticCandidates.filter(t => analysis.aesthetics.missing.some(m => norm(m) === norm(t)));
  const algoAesNorms = new Set(baseAesthetics.map(norm));
  const gapInferredAes: string[] = [];
  for (const gap of algorithmic) {
    const gl = gap.toLowerCase();
    for (const [kw, aesList] of GAP_AES) {
      if (!gl.includes(kw)) continue;
      for (const a of aesList) {
        if (analysis.aesthetics.missing.includes(a) && !algoAesNorms.has(norm(a))) { gapInferredAes.push(a); algoAesNorms.add(norm(a)); }
      }
    }
  }
  const addsAesthetics = [...baseAesthetics, ...gapInferredAes];

  const pColor = item.color_primary ?? null;
  const addsColors = pColor ? analysis.colors.missing.filter(m => sameColorGroup(pColor, m)) : [];

  const crossedConKeys = new Set(crossed.filter(e => e.category === "con" && e.analysisLevel === level).map(e => e.key));
  const conGapLinks = analysis.conGapLinks ?? {};
  const openCons: string[] = [];
  const algorithmicWeaknesses: string[] = [];
  for (let i = 0; i < (analysis.cons ?? []).length; i++) {
    if (crossedConKeys.has(String(i))) continue;
    const conText = analysis.cons[i];
    openCons.push(conText);
    const con = conText.toLowerCase();
    const linkedGap = conGapLinks[String(i)];
    const matches =
      (!!sub && con.includes(sub)) ||
      (!!cat && con.includes(cat)) ||
      (!!linkedGap && algorithmic.some(d => d.toLowerCase() === linkedGap.toLowerCase())) ||
      algorithmic.some(d => con.includes(d.toLowerCase()));
    if (matches) algorithmicWeaknesses.push(conText);
  }

  const unmatchedGaps = openGaps.filter(g => !algorithmic.includes(g.description)).map(g => g.description);
  const unmatchedAesthetics = analysis.aesthetics.missing.filter(m => !addsAesthetics.some(a => norm(a) === norm(m)));
  const unmatchedColors = analysis.colors.missing.filter(m => !addsColors.some(c => norm(c) === norm(m)));
  const unmatchedCons = openCons.filter(c => !algorithmicWeaknesses.includes(c));
  const anyUnmatched = unmatchedGaps.length || unmatchedAesthetics.length || unmatchedColors.length || unmatchedCons.length;

  if (anyUnmatched && item.image) {
    try {
      const res = await apiJson<{ gap_fills?: string[]; aesthetic_fills?: string[]; color_fills?: string[]; weakness_fills?: string[] }>(
        "/api/wardrobe/gap-check",
        {
          method: "POST",
          body: JSON.stringify({
            sub_type: item.sub_type, category: item.category, image: item.image,
            gap_descriptions: unmatchedGaps, aesthetic_gaps: unmatchedAesthetics,
            color_gaps: unmatchedColors, weakness_gaps: unmatchedCons,
          }),
        },
      );
      const allGapFills = [...algorithmic, ...(res.gap_fills ?? [])];
      const postAiAes = [...addsAesthetics, ...(res.aesthetic_fills ?? [])];
      const postAiAesNorms = new Set(postAiAes.map(norm));
      for (const gap of allGapFills) {
        const gl = gap.toLowerCase();
        for (const [kw, aesList] of GAP_AES) {
          if (!gl.includes(kw)) continue;
          for (const a of aesList) {
            if (analysis.aesthetics.missing.includes(a) && !postAiAesNorms.has(norm(a))) { postAiAes.push(a); postAiAesNorms.add(norm(a)); }
          }
        }
      }
      const aiWeaknesses = (res.weakness_fills ?? []).filter(w => !algorithmicWeaknesses.includes(w));
      return {
        impact: {
          fillsGaps: allGapFills.slice(0, 3),
          addsAesthetics: postAiAes,
          addsColors: [...addsColors, ...(res.color_fills ?? [])],
          addressesWeaknesses: [...algorithmicWeaknesses, ...aiWeaknesses],
        },
        overdoneNote,
      };
    } catch {
      // fall through to the algorithmic-only result below
    }
  }

  return {
    impact: { fillsGaps: algorithmic.slice(0, 3), addsAesthetics, addsColors, addressesWeaknesses: algorithmicWeaknesses },
    overdoneNote,
  };
}
