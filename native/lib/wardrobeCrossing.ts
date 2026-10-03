import { apiJson, invalidateCache } from "./api";
import { sameColorGroup } from "./colorGroups";
import {
  gapTotalProgress, computeGapProgress, normAesthetic, conMatches, GAP_AES,
  type WABackendState, type CrossedEntry,
} from "./wardrobeAnalysis";

export type SavedGarment = {
  id: string;
  title?: string | null;
  sub_type?: string | null;
  category?: string | null;
  color_primary?: string | null;
  aesthetic_tags?: string[] | null;
  functional_slot?: string | null;
  image?: string | null;
  pattern?: string | null;
};

// Direct port of the crossing computation embedded in app/add-item/page.tsx's post-save block:
// figures out which of the wardrobe's currently-missing gaps/colors/aesthetics/weaknesses this
// newly-added item resolves (at every level up through the current one, so an item added late
// still gets full credit for older levels too), then appends the result via the same
// POST /api/wardrobe/state/cross the website uses. Best-effort throughout — a failure here
// should never block "item added to your closet", so every step swallows its own errors.
//
// One deliberate deviation from the website: this always reads live /api/wardrobe/state instead
// of a localStorage-cached copy. The website's cache read is a client-side performance
// optimization (and if literally absent, the website's add-item flow silently skips crossing
// entirely until the next full analysis) — reading live here is simpler, can't go stale, and
// means crossing works even if Wardrobe hasn't been opened yet this session.
export async function crossNewItemAgainstWardrobe(saved: SavedGarment, formCategory: string): Promise<void> {
  let state: WABackendState | null;
  try {
    state = await apiJson<WABackendState | null>("/api/wardrobe/state");
  } catch {
    return;
  }
  if (!state || state.analysisHistory.length === 0) return;

  const level = state.currentLevel;
  const analysis = state.analysisHistory[level - 1];
  if (!analysis) return;

  const garmentId = saved.id;
  const sub = (saved.sub_type ?? "").toLowerCase();
  const cat = (saved.category ?? formCategory ?? "").toLowerCase();
  const norm = normAesthetic;

  const patternStr = (saved.pattern ?? "").toLowerCase();
  const titleStr = (saved.title ?? saved.sub_type ?? "").toLowerCase();
  const patternImplied: string[] = [];
  if (patternStr.includes("camo") || titleStr.includes("camo") || titleStr.includes("camouflage")) patternImplied.push("military", "gorpcore");
  if (patternStr.includes("plaid") || patternStr.includes("tartan") || titleStr.includes("plaid")) patternImplied.push("preppy", "ivy league");
  if (patternStr.includes("tie-dye") || patternStr.includes("tie dye") || titleStr.includes("tie dye")) patternImplied.push("y2k");
  const aestheticCandidates = [...new Set([...(saved.aesthetic_tags ?? []), ...patternImplied])];

  const newEntries: CrossedEntry[] = [];

  // ── Algorithmic crossing for ALL prior levels ──────────────────────────
  for (let L = 1; L < level; L++) {
    const priorA = state.analysisHistory[L - 1];
    if (!priorA) continue;
    const priorColKeys = new Set(state.crossed.filter(e => e.category === "color" && e.analysisLevel === L).map(e => e.key));
    const priorAesKeys = new Set(state.crossed.filter(e => e.category === "aesthetic" && e.analysisLevel === L).map(e => e.key));
    const priorConKeys = new Set(state.crossed.filter(e => e.category === "con" && e.analysisLevel === L).map(e => e.key));

    for (const g of priorA.gaps) {
      if (gapTotalProgress(state.crossed, g.description, L) >= 100) continue;
      if (state.crossed.some(e => e.category === "gap" && e.key === g.description && e.garmentId === garmentId && e.analysisLevel === L)) continue;
      const progress = computeGapProgress(g.description, saved.sub_type, cat, saved.functional_slot);
      if (progress > 0) newEntries.push({ category: "gap", key: g.description, garmentId, analysisLevel: L, progress });
    }
    if (saved.color_primary) {
      for (const c of priorA.colors.missing) {
        if (priorColKeys.has(c)) continue;
        if (sameColorGroup(saved.color_primary, c)) newEntries.push({ category: "color", key: c, garmentId, analysisLevel: L });
      }
    }
    for (const tag of aestheticCandidates) {
      const nt = norm(tag);
      for (const aName of priorA.aesthetics.missing) {
        if (priorAesKeys.has(aName)) continue;
        if (norm(aName) === nt) newEntries.push({ category: "aesthetic", key: aName, garmentId, analysisLevel: L });
      }
    }
    const priorConGapLinks = priorA.conGapLinks ?? {};
    const priorCrossedGapKeysLower = new Set([
      ...priorA.gaps.filter(g => gapTotalProgress(state!.crossed, g.description, L) >= 100).map(g => g.description.toLowerCase()),
      ...newEntries.filter(e => e.category === "gap" && e.analysisLevel === L).map(e => e.key.toLowerCase()),
    ]);
    for (let i = 0; i < priorA.cons.length; i++) {
      if (priorConKeys.has(String(i))) continue;
      const linkedGap = priorConGapLinks[String(i)];
      if (conMatches(priorA.cons[i], sub, cat, priorCrossedGapKeysLower, linkedGap)) {
        newEntries.push({ category: "con", key: String(i), garmentId, analysisLevel: L });
      }
    }
  }

  // ── Current level: algorithmic ──────────────────────────
  const existingColKeys = new Set(state.crossed.filter(e => e.category === "color" && e.analysisLevel === level).map(e => e.key));
  const existingAesKeys = new Set(state.crossed.filter(e => e.category === "aesthetic" && e.analysisLevel === level).map(e => e.key));
  const existingConKeys = new Set(state.crossed.filter(e => e.category === "con" && e.analysisLevel === level).map(e => e.key));

  for (const g of analysis.gaps) {
    if (gapTotalProgress(state.crossed, g.description, level) >= 100) continue;
    if (state.crossed.some(e => e.category === "gap" && e.key === g.description && e.garmentId === garmentId && e.analysisLevel === level)) continue;
    const progress = computeGapProgress(g.description, saved.sub_type, cat, saved.functional_slot);
    if (progress > 0) newEntries.push({ category: "gap", key: g.description, garmentId, analysisLevel: level, progress });
  }
  if (saved.color_primary) {
    for (const c of analysis.colors.missing) {
      if (existingColKeys.has(c)) continue;
      if (sameColorGroup(saved.color_primary, c)) newEntries.push({ category: "color", key: c, garmentId, analysisLevel: level });
    }
  }
  for (const tag of aestheticCandidates) {
    const nt = norm(tag);
    for (const aName of analysis.aesthetics.missing) {
      if (existingAesKeys.has(aName)) continue;
      if (norm(aName) === nt) newEntries.push({ category: "aesthetic", key: aName, garmentId, analysisLevel: level });
    }
  }
  const allCrossedGapKeysLower = new Set([
    ...analysis.gaps.filter(g => gapTotalProgress(state.crossed, g.description, level) >= 100).map(g => g.description.toLowerCase()),
    ...newEntries.filter(e => e.category === "gap").map(e => e.key.toLowerCase()),
  ]);
  const conGapLinks = analysis.conGapLinks ?? {};
  for (let i = 0; i < analysis.cons.length; i++) {
    if (existingConKeys.has(String(i))) continue;
    const linkedGap = conGapLinks[String(i)];
    if (conMatches(analysis.cons[i], sub, cat, allCrossedGapKeysLower, linkedGap)) {
      newEntries.push({ category: "con", key: String(i), garmentId, analysisLevel: level });
    }
  }

  // ── AI image-based fallback for anything the algorithmic pass at the current level missed ──
  const algorithmicGapKeys = new Set(newEntries.filter(e => e.category === "gap").map(e => e.key));
  const unmatchedGaps = analysis.gaps.filter(g => !algorithmicGapKeys.has(g.description) && gapTotalProgress(state!.crossed, g.description, level) < 100);
  const algorithmicAesKeys = new Set(newEntries.filter(e => e.category === "aesthetic").map(e => e.key));
  const algorithmicColorKeys = new Set(newEntries.filter(e => e.category === "color").map(e => e.key));
  const algorithmicConKeys = new Set(newEntries.filter(e => e.category === "con").map(e => e.key));
  const unmatchedAes = analysis.aesthetics.missing.filter(a => !existingAesKeys.has(a) && !algorithmicAesKeys.has(a));
  const unmatchedColor = analysis.colors.missing.filter(c => !existingColKeys.has(c) && !algorithmicColorKeys.has(c));
  const unmatchedCons = analysis.cons
    .map((con, i) => ({ con, i }))
    .filter(({ i }) => !existingConKeys.has(String(i)) && !algorithmicConKeys.has(String(i)))
    .map(({ con }) => con);

  const aiEntries: CrossedEntry[] = [];
  if ((unmatchedGaps.length || unmatchedAes.length || unmatchedColor.length || unmatchedCons.length) && saved.image) {
    try {
      const res = await apiJson<{
        gap_fills?: string[]; aesthetic_fills?: string[]; color_fills?: string[]; weakness_fills?: string[];
      }>("/api/wardrobe/gap-check", {
        method: "POST",
        body: JSON.stringify({
          sub_type: saved.sub_type, category: cat, image: saved.image,
          gap_descriptions: unmatchedGaps.map(g => g.description),
          aesthetic_gaps: unmatchedAes,
          color_gaps: unmatchedColor,
          weakness_gaps: unmatchedCons,
        }),
      });
      for (const d of res.gap_fills ?? []) {
        if (unmatchedGaps.some(g => g.description === d)) aiEntries.push({ category: "gap", key: d, garmentId, analysisLevel: level, progress: 100 });
      }
      for (const aName of res.aesthetic_fills ?? []) {
        if (unmatchedAes.includes(aName)) aiEntries.push({ category: "aesthetic", key: aName, garmentId, analysisLevel: level });
      }
      for (const c of res.color_fills ?? []) {
        // Matches the website's own check exactly (app/add-item/page.tsx) — accept the fill when
        // the item simply has no primary color recorded at all, not only when it has one that
        // matches. Native previously required a matching color_primary unconditionally, so an
        // item with no color on file could never fill a color gap even when the AI vision call
        // (which sees the actual image) said it did.
        if (unmatchedColor.includes(c) && (!saved.color_primary || sameColorGroup(saved.color_primary, c))) {
          aiEntries.push({ category: "color", key: c, garmentId, analysisLevel: level });
        }
      }
      for (const w of res.weakness_fills ?? []) {
        const idx = analysis.cons.indexOf(w);
        if (idx !== -1 && !existingConKeys.has(String(idx))) aiEntries.push({ category: "con", key: String(idx), garmentId, analysisLevel: level });
      }
      // Infer aesthetics from every gap fill (algorithmic + AI) via the same keyword map used
      // by the website — e.g. filling a "blazer" gap implies progress on formal/business-casual.
      const allGapFills = [...newEntries.filter(e => e.category === "gap").map(e => e.key), ...(res.gap_fills ?? [])];
      const crossedAesNorms = new Set([
        ...existingAesKeys, ...algorithmicAesKeys,
        ...aiEntries.filter(e => e.category === "aesthetic").map(e => norm(e.key)),
      ]);
      for (const gapKey of allGapFills) {
        const gl = gapKey.toLowerCase();
        for (const [kw, aesList] of GAP_AES) {
          if (!gl.includes(kw)) continue;
          for (const aName of aesList) {
            if (analysis.aesthetics.missing.includes(aName) && !crossedAesNorms.has(norm(aName))) {
              aiEntries.push({ category: "aesthetic", key: aName, garmentId, analysisLevel: level });
              crossedAesNorms.add(norm(aName));
            }
          }
        }
      }
    } catch {
      // best-effort — algorithmic entries below still get saved
    }
  }

  const all = [...newEntries, ...aiEntries];
  if (all.length > 0) {
    await apiJson("/api/wardrobe/state/cross", { method: "POST", body: JSON.stringify(all) })
      // Closet/Wardrobe read wardrobe state through the 45s cache — without this, a new item's
      // crossings didn't show up there until that expired.
      .then(() => invalidateCache("/api/wardrobe/state"))
      .catch(() => {});
  }
}
