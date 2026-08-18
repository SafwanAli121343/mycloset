import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { apiJson, ApiError } from "../lib/api";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { BouncingPieces } from "../components/BouncingPieces";
import { BAR_CONTENT_H } from "../components/BottomNavBar";
import { LoadingDots } from "../components/LoadingDots";
import { ScreenCenter } from "../components/ScreenCenter";
import { chunk3 } from "../lib/chunk";
import {
  gapTotalProgress, computeGapProgress, computeEffectiveLevel, isConResolved,
  getFunctionalSlot, resolveSubTypeFromTitle, normAesthetic,
  type WardrobeAnalysis, type WABackendState, type CrossedEntry,
} from "../lib/wardrobeAnalysis";
import { sameColorGroup } from "../lib/colorGroups";
import { colors, type, spacing, scoreColor } from "../theme/theme";

type GarmentAttr = { id: string; sub_type: string | null; category: string | null; color_primary: string | null; aesthetic_tags: string[] | null };
const GAP_COLOR: Record<"high" | "medium" | "low", string> = { high: colors.bad, medium: colors.mid, low: colors.textMuted };
function gapProgressColor(p: number): string {
  if (p >= 75) return "#88aa00";
  if (p >= 50) return "#b8a000";
  if (p >= 25) return "#cc7700";
  return "#cc3300";
}

const { width: SCREEN_W } = Dimensions.get("window");
const BOX_W = SCREEN_W - spacing.lg * 2;

// A full native port of the website's wardrobe-analysis crossing/leveling system
// (app/wardrobe-analysis/page.tsx + lib/wardrobeAnalysis.ts): the same GET/PUT
// /api/wardrobe/state and POST /api/wardrobe/analysis endpoints, the same effective-level
// computation, gap partial-progress accumulation, con resolution rules, ghost items from
// resolved prior levels, and the same frozen-base-score + per-unit-point-weight scoring so
// remove/re-add stays symmetric. Two deliberate differences from the website, both scoped
// deviations rather than gaps in the crossing logic itself:
//  - No localStorage-equivalent (AsyncStorage) fast-path cache. The website's cache is a
//    perf/offline-resilience optimization, not a behavior a user would notice as a "feature" —
//    this always reads live state instead, which is simpler and can't ever go stale.
//  - No un-crossing on garment delete (DELETE /api/wardrobe/state/cross) — native has no
//    delete-garment flow anywhere yet, so there is no trigger point to hook it to.
export default function WardrobeScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [analysis, setAnalysis] = useState<WardrobeAnalysis | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [crossedGaps, setCrossedGaps] = useState<string[]>([]);
  const [crossedColors, setCrossedColors] = useState<string[]>([]);
  const [crossedAesthetics, setCrossedAesthetics] = useState<string[]>([]);
  const [crossedConIndices, setCrossedConIndices] = useState<number[]>([]);
  const [ghostCons, setGhostCons] = useState<string[]>([]);
  const [gapProgress, setGapProgress] = useState<Record<string, number>>({});
  const [pieceImages, setPieceImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setTableMissing(false);
    try {
      // Both reads are independent — fire the state fetch immediately and only await it once
      // sData is needed below, instead of the two round trips stacking one after the other.
      const statePromise = apiJson<WABackendState | null>("/api/wardrobe/state").then(
        s => ({ ok: true as const, state: s }),
        (e: unknown) => ({ ok: false as const, error: e }),
      );
      const sData = await apiJson<{
        pieceCount: number; pieces: { id: string; image: string | null }[]; garmentAttrs: GarmentAttr[];
      }>("/api/scoring").catch(() => null);
      setPieceImages((sData?.pieces ?? []).map(p => p.image).filter((u): u is string => !!u));
      const attrs = sData?.garmentAttrs ?? [];

      function fetchFreshAnalysis(priorAnalyses: WardrobeAnalysis[] = [], crossed: CrossedEntry[] = []) {
        return apiJson<WardrobeAnalysis>("/api/wardrobe/analysis", {
          method: "POST",
          body: JSON.stringify({ priorAnalyses, crossed }),
        });
      }

      // Mirrors the website's applyState(): derives every crossed/ghost/progress/score display
      // value from a WABackendState + the level currently being displayed.
      function applyState(bs: WABackendState, effLevel: number, displayA: WardrobeAnalysis) {
        const gapProgressMap: Record<string, number> = {};
        for (const g of displayA.gaps) gapProgressMap[g.description] = gapTotalProgress(bs.crossed, g.description, effLevel);
        setGapProgress(gapProgressMap);
        setCrossedGaps(Object.entries(gapProgressMap).filter(([, p]) => p >= 100).map(([k]) => k));

        const atLevel = bs.crossed.filter(e => e.analysisLevel === effLevel);
        setCrossedColors([...new Set(atLevel.filter(e => e.category === "color").map(e => e.key))]);
        setCrossedAesthetics([...new Set(atLevel.filter(e => e.category === "aesthetic").map(e => e.key))]);
        setCrossedConIndices(displayA.cons.map((_, i) => i).filter(i => isConResolved(bs.crossed, displayA.conGapLinks, i, effLevel)));
        setLevel(effLevel);

        const ghosts: string[] = [];
        for (let L = 1; L < effLevel; L++) {
          const prevA = bs.analysisHistory[L - 1];
          if (!prevA) continue;
          prevA.cons.forEach((text, i) => { if (isConResolved(bs.crossed, prevA.conGapLinks, i, L)) ghosts.push(text); });
        }
        setGhostCons(ghosts);

        // Frozen base score + per-unit point weights so remove/re-add of the same item is
        // always exactly symmetric — see lib/wardrobeAnalysis.ts's WardrobeAnalysis.pointWeights.
        const baseScore = bs.analysisHistory[0]?.score ?? displayA.score;
        const pw = bs.analysisHistory[0]?.pointWeights ?? { gap: 4, color: 1, aesthetic: 1, con: 1 };
        let totalPts = 0;
        for (let L = 1; L <= effLevel; L++) {
          const levelA = bs.analysisHistory[L - 1];
          if (!levelA) break;
          const lc = bs.crossed.filter(e => e.analysisLevel === L);
          for (const g of levelA.gaps) {
            if (gapTotalProgress(bs.crossed, g.description, L) >= 100) {
              totalPts += g.costPoints > 0 ? g.costPoints : g.impact === "high" ? pw.gap : g.impact === "medium" ? Math.ceil(pw.gap / 2) : 1;
            }
          }
          totalPts += new Set(lc.filter(e => e.category === "color").map(e => e.key)).size * pw.color;
          totalPts += new Set(lc.filter(e => e.category === "aesthetic").map(e => e.key)).size * pw.aesthetic;
          let lcConCount = 0;
          levelA.cons.forEach((_, i) => { if (isConResolved(bs.crossed, levelA.conGapLinks, i, L)) lcConCount++; });
          totalPts += lcConCount * pw.con;
        }
        const bumpedScore = Math.min(100, baseScore + totalPts);

        const priorAesSet = new Set(bs.analysisHistory.slice(0, effLevel - 1).flatMap(a => a.aesthetics.missing.map(ae => ae.toLowerCase())));
        const priorColSet = new Set(bs.analysisHistory.slice(0, effLevel - 1).flatMap(a => a.colors.missing.map(c => c.toLowerCase().trim())));

        const liveSubTypeCounts: Record<string, number> = {};
        for (const g of attrs) if (g.sub_type) liveSubTypeCounts[g.sub_type] = (liveSubTypeCounts[g.sub_type] ?? 0) + 1;
        const liveOverdone = displayA.overdone.map(o => ({ ...o, count: liveSubTypeCounts[o.description] ?? 0 })).filter(o => o.count >= 3);

        const filtered: WardrobeAnalysis = {
          ...(effLevel <= 1 ? displayA : {
            ...displayA,
            aesthetics: { ...displayA.aesthetics, missing: displayA.aesthetics.missing.filter(ae => !priorAesSet.has(ae.toLowerCase())) },
            colors: { ...displayA.colors, missing: displayA.colors.missing.filter(c => !priorColSet.has(c.toLowerCase().trim())) },
          }),
          overdone: liveOverdone,
        };
        setAnalysis({ ...filtered, score: bumpedScore });
      }

      const stateResult = await statePromise;
      if (!stateResult.ok) {
        const e = stateResult.error;
        if (e instanceof ApiError && e.status === 503) { setTableMissing(true); setLoading(false); return; }
        throw e;
      }
      const state: WABackendState | null = stateResult.state;

      if (state && state.analysisHistory.length > 0) {
        const effLevel = computeEffectiveLevel(state.analysisHistory, state.currentLevel);
        const displayA = state.analysisHistory[effLevel - 1];
        if (!displayA) throw new Error("Missing analysis for effective level");

        if (state.analysisHistory.length > state.currentLevel) {
          // Already tried advancing and GPT had nothing new — don't re-query.
          applyState(state, effLevel, displayA);
          setLoading(false);
          return;
        }

        const atL = state.crossed.filter(e => e.analysisLevel === effLevel);
        const allCrossed =
          (displayA.gaps.length === 0 || displayA.gaps.every(g => gapTotalProgress(state!.crossed, g.description, effLevel) >= 100)) &&
          (displayA.cons.length === 0 || displayA.cons.every((_, i) => isConResolved(state!.crossed, displayA.conGapLinks, i, effLevel))) &&
          (displayA.colors.missing.length === 0 || displayA.colors.missing.every(c => atL.some(e => e.category === "color" && e.key === c))) &&
          (displayA.aesthetics.missing.length === 0 || displayA.aesthetics.missing.every(ae => atL.some(e => e.category === "aesthetic" && e.key === ae)));

        if (allCrossed) {
          const freshA = await fetchFreshAnalysis(state.analysisHistory, state.crossed);
          const hasContent = freshA.gaps.length > 0 || freshA.colors.missing.length > 0 || freshA.aesthetics.missing.length > 0 || freshA.cons.length > 0;
          if (!hasContent) {
            const sentinelState: WABackendState = { analysisHistory: [...state.analysisHistory, freshA], crossed: state.crossed, currentLevel: state.currentLevel };
            apiJson("/api/wardrobe/state", { method: "PUT", body: JSON.stringify(sentinelState) }).catch(() => {});
            applyState(sentinelState, effLevel, displayA);
          } else {
            const newState: WABackendState = { analysisHistory: [...state.analysisHistory, freshA], crossed: state.crossed, currentLevel: state.currentLevel + 1 };
            apiJson("/api/wardrobe/state", { method: "PUT", body: JSON.stringify(newState) }).catch(() => {});
            applyState(newState, state.currentLevel + 1, freshA);
          }
        } else {
          applyState(state, effLevel, displayA);
        }
      } else {
        // Recovery path: no backend state yet. Deterministically auto-cross colors/aesthetics/
        // gaps/cons the current wardrobe already resolves, exactly like the website's rebuild
        // path — gap-crossing here uses the same computeGapProgress matcher used on every
        // subsequent add, so a fresh install ends up in the same place item-by-item adds would.
        const freshA = await fetchFreshAnalysis();
        const norm = normAesthetic;
        const autoCrossed: CrossedEntry[] = [];

        for (const gap of freshA.gaps) {
          for (const g of attrs) {
            const sub = g.sub_type ?? resolveSubTypeFromTitle("");
            const funcSlot = getFunctionalSlot(sub);
            const cat = (g.category ?? "").toLowerCase();
            const progress = computeGapProgress(gap.description, sub, cat, funcSlot);
            if (progress > 0) autoCrossed.push({ category: "gap", key: gap.description, garmentId: g.id, analysisLevel: 1, progress });
          }
        }
        for (const missingColor of freshA.colors.missing) {
          const filler = attrs.find(g => g.color_primary && sameColorGroup(g.color_primary, missingColor));
          if (filler) autoCrossed.push({ category: "color", key: missingColor, garmentId: filler.id, analysisLevel: 1 });
        }
        for (const missingAes of freshA.aesthetics.missing) {
          const filler = attrs.find(g => (g.aesthetic_tags ?? []).some(t => norm(t) === norm(missingAes)));
          if (filler) autoCrossed.push({ category: "aesthetic", key: missingAes, garmentId: filler.id, analysisLevel: 1 });
        }
        for (let ci = 0; ci < freshA.cons.length; ci++) {
          const linkedGap = (freshA.conGapLinks ?? {})[String(ci)];
          if (!linkedGap || gapTotalProgress(autoCrossed, linkedGap, 1) >= 100) {
            autoCrossed.push({ category: "con", key: String(ci), garmentId: undefined as unknown as string, analysisLevel: 1 });
          }
        }

        const atL1 = autoCrossed.filter(e => e.analysisLevel === 1);
        const l1Complete =
          (freshA.gaps.length === 0 || freshA.gaps.every(g => gapTotalProgress(autoCrossed, g.description, 1) >= 100)) &&
          (freshA.colors.missing.length === 0 || freshA.colors.missing.every(c => atL1.some(e => e.category === "color" && e.key === c))) &&
          (freshA.aesthetics.missing.length === 0 || freshA.aesthetics.missing.every(ae => atL1.some(e => e.category === "aesthetic" && e.key === ae)));

        let newState: WABackendState;
        if (l1Complete) {
          let freshA2 = freshA;
          let reachedL2 = false;
          try { freshA2 = await fetchFreshAnalysis([freshA], autoCrossed); reachedL2 = true; } catch { /* stay at level 1 */ }
          newState = { analysisHistory: reachedL2 ? [freshA, freshA2] : [freshA], crossed: autoCrossed, currentLevel: reachedL2 ? 2 : 1 };
          applyState(newState, newState.currentLevel, reachedL2 ? freshA2 : freshA);
        } else {
          newState = { analysisHistory: [freshA], crossed: autoCrossed, currentLevel: 1 };
          applyState(newState, 1, freshA);
        }
        apiJson("/api/wardrobe/state", { method: "PUT", body: JSON.stringify(newState) }).catch(() => {});
      }
    } catch (e) {
      setError(true);
      if (!(e instanceof ApiError)) console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ScreenCenter><LoadingDots /></ScreenCenter>;

  if (tableMissing) {
    return (
      <ScreenCenter>
        <Text style={type.body}>Wardrobe leveling isn't set up on the server yet.</Text>
      </ScreenCenter>
    );
  }

  if (error || !analysis) {
    return (
      <ScreenCenter>
        <Text style={type.body}>No wardrobe analysis available yet.</Text>
        <TouchableOpacity onPress={load} style={{ marginTop: spacing.md }}>
          <Text style={[type.button, { color: colors.text, textDecorationLine: "underline" }]}>RETRY</Text>
        </TouchableOpacity>
      </ScreenCenter>
    );
  }

  const a = analysis;
  const lvl = level ?? 1;
  const crossedGapSet = new Set(crossedGaps);
  const crossedColorSet = new Set(crossedColors);
  const crossedAesSet = new Set(crossedAesthetics);

  const allGapsCrossed = a.gaps.length === 0 || a.gaps.every(g => crossedGapSet.has(g.description));
  const allColorsCrossed = a.colors.missing.length === 0 || a.colors.missing.every(c => crossedColorSet.has(c));
  const allAesCrossed = a.aesthetics.missing.length === 0 || a.aesthetics.missing.every(ae => crossedAesSet.has(ae));
  const allConsCrossed = a.cons.length === 0 || a.cons.every((_, i) => crossedConIndices.includes(i));

  const gapsLabel = allGapsCrossed ? `GAPS · COMPLETE` : `GAPS · LEVEL ${lvl}`;
  const colorsLabel = allColorsCrossed ? `MISSING COLORS · COMPLETE` : `MISSING COLORS · LEVEL ${lvl}`;
  const aesLabel = allAesCrossed ? `MISSING AESTHETICS · COMPLETE` : `MISSING AESTHETICS · LEVEL ${lvl}`;
  const weaknessesLabel = allConsCrossed ? `WEAKNESSES · COMPLETE` : `WEAKNESSES · LEVEL ${lvl}`;

  const crossedInAnalysis = a.gaps.filter(g => crossedGapSet.has(g.description));
  const activeGaps = a.gaps.filter(g => !crossedGapSet.has(g.description));
  const crossedGhosts = crossedGaps.filter(d => !a.gaps.find(g => g.description === d));

  // Same left-to-right, top-to-bottom section order as the website's two-column layout
  // (app/wardrobe-analysis/page.tsx): pros, covered colors, covered aesthetics, insights, then
  // weaknesses, missing colors, missing aesthetics, gaps, overdone.
  const focusItems: FocusItem[] = [];
  if (a.pros.length > 0) {
    focusItems.push({ key: "h-pros", text: "PROS", color: colors.textFaint });
    a.pros.forEach((p, i) => focusItems.push({ key: `pros-${i}`, text: p, color: colors.good }));
  }
  if (a.colors.have.length > 0 || crossedColors.length > 0) {
    focusItems.push({ key: "h-colors", text: "COVERED COLORS", color: colors.textFaint });
    chunk3(a.colors.have).forEach((c, i) => focusItems.push({ key: `colors-${i}`, words: c, color: colors.textMuted }));
    if (crossedColors.length > 0) chunk3(crossedColors).forEach((c, i) => focusItems.push({ key: `colors-x-${i}`, words: c, color: colors.textFaint }));
  }
  if (a.aesthetics.covered.length > 0 || crossedAesthetics.length > 0) {
    focusItems.push({ key: "h-aes", text: "COVERED AESTHETICS", color: colors.textFaint });
    chunk3(a.aesthetics.covered.map(x => x.name)).forEach((c, i) => focusItems.push({ key: `aes-${i}`, words: c, color: colors.textMuted }));
    if (crossedAesthetics.length > 0) chunk3(crossedAesthetics).forEach((c, i) => focusItems.push({ key: `aes-x-${i}`, words: c, color: colors.textFaint }));
  }
  if (a.insights.length > 0) {
    focusItems.push({ key: "h-insights", text: "INSIGHTS", color: colors.textFaint });
    a.insights.forEach((ins, i) => focusItems.push({ key: `insights-${i}`, text: ins, color: colors.textMuted }));
  }
  if (a.cons.length > 0) {
    const visibleCons = a.cons
      .map((text, i) => ({ text, i }))
      .filter(({ text, i }) => {
        const isDuplicate = ghostCons.some(g => g.trim().toLowerCase() === text.trim().toLowerCase());
        return !isDuplicate && !crossedConIndices.includes(i);
      });
    if (visibleCons.length > 0) {
      focusItems.push({ key: "h-cons", text: weaknessesLabel, color: colors.textFaint });
      visibleCons.forEach(({ text, i }) => focusItems.push({ key: `cons-${i}`, text, color: colors.bad }));
    }
  }
  focusItems.push({ key: "h-mcolors", text: colorsLabel, color: colors.textFaint });
  if (a.colors.missing.length === 0 && crossedColors.length === 0) {
    focusItems.push({ key: "mcolors-none", text: "None", color: colors.textFaint });
  } else {
    const extraCrossed = crossedColors.filter(c => !a.colors.missing.includes(c));
    chunk3(a.colors.missing).forEach((c, i) => focusItems.push({
      key: `mcolors-${i}`, words: c,
      color: c.every(w => crossedColorSet.has(w)) ? colors.textFaint : colors.textMuted,
    }));
    if (extraCrossed.length > 0) chunk3(extraCrossed).forEach((c, i) => focusItems.push({ key: `mcolors-x-${i}`, words: c, color: colors.textFaint }));
  }
  focusItems.push({ key: "h-maes", text: aesLabel, color: colors.textFaint });
  if (a.aesthetics.missing.length === 0 && crossedAesthetics.length === 0) {
    focusItems.push({ key: "maes-none", text: "None", color: colors.textFaint });
  } else {
    const extraCrossed = crossedAesthetics.filter(ae => !a.aesthetics.missing.includes(ae));
    chunk3(a.aesthetics.missing).forEach((c, i) => focusItems.push({
      key: `maes-${i}`, words: c,
      color: c.every(w => crossedAesSet.has(w)) ? colors.textFaint : colors.textMuted,
    }));
    if (extraCrossed.length > 0) chunk3(extraCrossed).forEach((c, i) => focusItems.push({ key: `maes-x-${i}`, words: c, color: colors.textFaint }));
  }
  focusItems.push({ key: "h-gaps", text: gapsLabel, color: colors.textFaint });
  if (activeGaps.length === 0 && crossedInAnalysis.length === 0 && crossedGhosts.length === 0) {
    focusItems.push({ key: "gaps-none", text: "None", color: colors.textFaint });
  } else {
    activeGaps.forEach((gap, i) => {
      const prog = gapProgress[gap.description] ?? 0;
      const isInProgress = prog > 0 && prog < 100;
      const descColor = isInProgress ? gapProgressColor(prog) : GAP_COLOR[gap.impact];
      const desc = gap.description.charAt(0).toUpperCase() + gap.description.slice(1);
      focusItems.push({
        key: `gap-${i}`,
        text: gap.costPoints > 0 ? `${desc} (+${gap.costPoints} pts)` : desc,
        color: descColor,
      });
      focusItems.push({ key: `gap-reason-${i}`, text: gap.reason, color: colors.textMuted });
    });
    crossedInAnalysis.forEach((gap, i) => {
      const desc = gap.description.charAt(0).toUpperCase() + gap.description.slice(1);
      focusItems.push({ key: `gap-x-${i}`, text: desc, color: colors.textFaint });
    });
    crossedGhosts.forEach((desc, i) => {
      focusItems.push({ key: `gap-ghost-${i}`, text: desc.charAt(0).toUpperCase() + desc.slice(1), color: colors.textFaint });
    });
  }
  if (a.overdone.length > 0) {
    focusItems.push({ key: "h-overdone", text: "OVERDONE", color: colors.textFaint });
    a.overdone.forEach((o, i) => {
      focusItems.push({ key: `overdone-${i}`, text: `${o.description} ×${o.count}`, color: colors.mid });
      focusItems.push({ key: `overdone-sugg-${i}`, text: o.suggestion, color: colors.text });
    });
  }

  return (
    <SafeAreaView
      style={[styles.container, { justifyContent: "center", paddingBottom: insets.bottom + BAR_CONTENT_H }]}
      edges={["top", "left", "right"]}
    >
      <View style={{ alignItems: "center" }}>
        <Text style={[type.label, { marginBottom: 2 }]}>LEVEL {lvl}</Text>
        <Text style={{ fontSize: 48, fontWeight: "700", color: scoreColor(a.score) }}>{a.score}</Text>

        <View style={styles.pieceBox}>
          <BouncingPieces width={BOX_W - 3} height={228} remoteUris={pieceImages} active={isFocused} />
        </View>
      </View>

      {focusItems.length > 0 && (
        <View style={{ height: 190, marginTop: spacing.lg, marginBottom: spacing.sm }}>
          <FocusScrollList items={focusItems} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pieceBox: { width: BOX_W, height: 230, borderWidth: 1.5, borderColor: colors.text, marginTop: spacing.md, overflow: "hidden" },
});
