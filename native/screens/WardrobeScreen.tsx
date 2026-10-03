import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused, useFocusEffect } from "@react-navigation/native";
import { Image } from "expo-image";
import { apiJson, apiJsonCached, ApiError, invalidateCache } from "../lib/api";
import { getCached } from "../lib/dataCache";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { BouncingPieces } from "../components/BouncingPieces";
import { ScreenCenter } from "../components/ScreenCenter";
import { ReadyGate } from "../components/ReadyGate";
import { chunk3 } from "../lib/chunk";
import {
  gapTotalProgress, computeGapProgress, computeEffectiveLevel, isConResolved,
  getFunctionalSlot, resolveSubTypeFromTitle, normAesthetic,
  type WardrobeAnalysis, type WABackendState, type CrossedEntry,
} from "../lib/wardrobeAnalysis";
import { sameColorGroup } from "../lib/colorGroups";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import { useEntitlements } from "../lib/billing/Entitlements";
import { LockedScreen } from "../components/LockedFeature";
import { useTutorialDemo } from "../lib/tutorial";
import { sampleWardrobeReport, SAMPLE_IMAGES } from "../lib/tutorialSamples";
import { TextButton } from "../components/TextButton";
import { AnalysisOverlay } from "../components/AnalysisOverlay";
import { useStatusMessage, StatusMessage } from "../components/StatusMessage";
import {
  fetchJobs, startJob, waitForJob, ackJobs, jobFailureMessage, startErrorMessage, WARDROBE_STAGES, type JobsStatus,
} from "../lib/analysisJobs";

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
  const { hasAI, ready: entitlementsReady, refresh: refreshEntitlements } = useEntitlements();
  const [analysis, setAnalysis] = useState<WardrobeAnalysis | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [crossedGaps, setCrossedGaps] = useState<string[]>([]);
  const [crossedColors, setCrossedColors] = useState<string[]>([]);
  const [crossedAesthetics, setCrossedAesthetics] = useState<string[]>([]);
  const [crossedConIndices, setCrossedConIndices] = useState<number[]>([]);
  const [ghostCons, setGhostCons] = useState<string[]>([]);
  const [gapProgress, setGapProgress] = useState<Record<string, number>>({});
  const [pieceImages, setPieceImages] = useState<string[]>([]);
  // Always starts true, unlike other screens' cache-skip: `analysis` below is a derived object
  // that's never itself cached (it's rebuilt via applyState/fetchFreshAnalysis even when the
  // underlying /api/wardrobe/state fetch is cache-warm), so starting loading=false on a warm
  // cache left a window where analysis was still null — flashing "No wardrobe analysis
  // available yet" + RETRY before the near-instant cached fetch resolved.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const retryCount = useRef(0);
  // Only Pro may ask the server for a NEW analysis level. A free user viewing a report they
  // bought sees it as it stands; the next level comes from another purchase ("Perform analysis?").
  const allowFreshRef = useRef(hasAI);
  allowFreshRef.current = hasAI;
  // Free tier: purchased Full Wardrobe Analyses and the report's status (lib/analysisJobs.ts).
  const [wjobs, setWjobs] = useState<JobsStatus | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const { status, showStatus } = useStatusMessage();
  const demo = useTutorialDemo();
  const sampleReport = useMemo(() => sampleWardrobeReport() as WardrobeAnalysis, []);
  const sampleImages = useMemo(() => Object.values(SAMPLE_IMAGES), []);
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

  const load = useCallback(async () => {
    if (!getCached("/api/wardrobe/state")) setLoading(true);
    setError(false);
    setTableMissing(false);
    let willRetry = false;
    try {
      // Both reads are independent — fire the state fetch immediately and only await it once
      // sData is needed below, instead of the two round trips stacking one after the other.
      const statePromise = apiJsonCached<WABackendState | null>("/api/wardrobe/state").then(
        s => ({ ok: true as const, state: s }),
        (e: unknown) => ({ ok: false as const, error: e }),
      );
      // skipOutfits=1 — this screen never reads topOutfits, only pieceCount/pieces/garmentAttrs,
      // and generating topOutfits is a combinatorial search over the whole wardrobe (the
      // expensive part of this route) — see ClosetScreen's SCORING_PATH for the full reasoning.
      const sData = await apiJsonCached<{
        pieceCount: number; pieces: { id: string; image: string | null }[]; garmentAttrs: GarmentAttr[];
      }>("/api/scoring?skipOutfits=1").catch(() => null);
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

        if (allCrossed && allowFreshRef.current) {
          const freshA = await fetchFreshAnalysis(state.analysisHistory, state.crossed);
          const hasContent = freshA.gaps.length > 0 || freshA.colors.missing.length > 0 || freshA.aesthetics.missing.length > 0 || freshA.cons.length > 0;
          if (!hasContent) {
            const sentinelState: WABackendState = { analysisHistory: [...state.analysisHistory, freshA], crossed: state.crossed, currentLevel: state.currentLevel };
            apiJson("/api/wardrobe/state", { method: "PUT", body: JSON.stringify(sentinelState) }).then(() => invalidateCache("/api/wardrobe/state")).catch(() => {});
            applyState(sentinelState, effLevel, displayA);
          } else {
            const newState: WABackendState = { analysisHistory: [...state.analysisHistory, freshA], crossed: state.crossed, currentLevel: state.currentLevel + 1 };
            apiJson("/api/wardrobe/state", { method: "PUT", body: JSON.stringify(newState) }).then(() => invalidateCache("/api/wardrobe/state")).catch(() => {});
            applyState(newState, state.currentLevel + 1, freshA);
          }
        } else {
          applyState(state, effLevel, displayA);
        }
      } else if (!allowFreshRef.current) {
        // Free tier with no visible report: nothing to show (the prompt/lock screen handles it).
        setAnalysis(null);
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
        apiJson("/api/wardrobe/state", { method: "PUT", body: JSON.stringify(newState) }).then(() => invalidateCache("/api/wardrobe/state")).catch(() => {});
      }
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
      // Retry up to 3 times with increasing delays — server cold-starts can take several seconds.
      if (retryCount.current < 3) {
        const delay = [1500, 3000, 5000][retryCount.current] ?? 5000;
        retryCount.current += 1;
        willRetry = true;
        setTimeout(load, delay);
        return;
      }
      setError(true);
    } finally {
      if (!willRetry) setLoading(false);
    }
  }, []);

  const canViewReport = hasAI || wjobs?.wardrobe.report === "purchased";
  useEffect(() => {
    if (entitlementsReady && canViewReport) load();
  }, [load, entitlementsReady, canViewReport]);

  // A purchased analysis finished: load the new report and its piece images while the loading
  // screen is still up, so the whole report appears at once when it lifts.
  const revealReport = useCallback(async () => {
    invalidateCache("/api/wardrobe/state");
    invalidateCache("/api/scoring");
    const s = await fetchJobs().catch(() => null);
    if (s && !unmounted.current) setWjobs(s);
    const sData = await apiJsonCached<{ pieces: { image: string | null }[] }>("/api/scoring?skipOutfits=1").catch(() => null);
    await Promise.all((sData?.pieces ?? []).map(p => p.image ? Image.prefetch(p.image, "memory-disk").catch(() => {}) : null));
    await load();
  }, [load]);

  const followingRef = useRef<string | null>(null);
  const followJob = useCallback(async (jobId: string) => {
    // One watcher per job — revisiting the tab while it runs must not start a second one.
    if (followingRef.current === jobId) return;
    followingRef.current = jobId;
    setAnalyzing(true);
    const job = await waitForJob(jobId, () => unmounted.current);
    if (unmounted.current) return;
    if (job.status === "done") await revealReport();
    else if (job.status === "failed") {
      showStatus(jobFailureMessage(job), "bad");
      fetchJobs().then(s => { if (!unmounted.current) setWjobs(s); }).catch(() => {});
    }
    ackJobs([jobId]);
    followingRef.current = null;
    refreshEntitlements();
    if (!unmounted.current) setAnalyzing(false);
  }, [revealReport, showStatus, refreshEntitlements]);

  // Free tier: re-checked on every visit — credits, the report's status, and any analysis that
  // was running (or finished/failed) while the app was closed.
  useFocusEffect(useCallback(() => {
    if (!entitlementsReady || hasAI) return;
    let cancelled = false;
    fetchJobs().then(async s => {
      if (cancelled) return;
      setWjobs(s);
      const mine = s.jobs.filter(j => j.kind === "wardrobe");
      const running = mine.find(j => j.status === "running");
      if (running && !analyzing) followJob(running.id);
      const finished = mine.filter(j => j.status !== "running");
      if (finished.some(j => j.status === "done")) await revealReport();
      const failed = finished.find(j => j.status === "failed");
      if (failed) showStatus(jobFailureMessage(failed), "bad");
      ackJobs(finished.map(j => j.id));
    }).catch(() => {
      // Offline/failed: show the locked view (with no purchases) rather than loading forever —
      // same fallback as the website. Re-checked on the next visit.
      if (!cancelled) setWjobs(prev => prev ?? { jobs: [], credits: { item: 0, wardrobe: 0, itemBalance: 0, wardrobeBalance: 0 }, wardrobe: { enoughPieces: false, report: "none", canAdvance: false } });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlementsReady, hasAI]));

  async function performAnalysis() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const job = await startJob("wardrobe");
      await followJob(job.id);
    } catch (e) {
      setAnalyzing(false);
      showStatus(startErrorMessage(e), "bad");
      fetchJobs().then(setWjobs).catch(() => {});
    }
  }

  // Every return below keeps the loading overlay in the same place, so it stays up (rather than
  // remounting) while the screen underneath switches from the prompt to the finished report.
  const wrap = (node: React.ReactNode) => (
    <>
      {node}
      <AnalysisOverlay visible={analyzing} stages={WARDROBE_STAGES} />
    </>
  );
  const credits = wjobs?.credits.wardrobe ?? 0;
  const promptText = `You have ${credits} wardrobe ${credits === 1 ? "analysis" : "analyses"} available. Perform analysis?`;

  // Entirely AI-dependent (wardrobe analysis, gap crossing, leveling) — locked wholesale rather
  // than partially degraded, since there's no non-AI subset of this screen that means anything.
  // Wrapped in ReadyGate (components/ReadyGate.tsx). Waits for entitlements first — checking
  // hasAI before the plan is known flashed the locked screen at Pro users for a moment.
  if (!demo && !entitlementsReady) return wrap(<ReadyGate ready={false} />);
  if (!demo && !hasAI) {
    if (!wjobs) return wrap(<ReadyGate ready={false} />);
    if (wjobs.wardrobe.report !== "purchased") {
      if (credits > 0 && wjobs.wardrobe.enoughPieces) {
        return wrap(
          <ReadyGate ready>
          <ScreenCenter>
            <Text style={[type.title, { textAlign: "center" }]}>WARDROBE</Text>
            <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.lg }]}>{promptText}</Text>
            <TextButton label="YES" onPress={performAnalysis} />
            <StatusMessage status={status} style={{ marginTop: spacing.md, textAlign: "center" }} />
          </ScreenCenter>
          </ReadyGate>
        );
      }
      if (credits > 0) {
        return wrap(
          <ReadyGate ready>
          <ScreenCenter>
            <Text style={[type.title, { textAlign: "center" }]}>WARDROBE</Text>
            <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm }]}>
              {`You have ${credits} wardrobe ${credits === 1 ? "analysis" : "analyses"} available. Add a few more pieces first: a wardrobe analysis needs at least 5 items that make a complete outfit (a top, bottoms and shoes).`}
            </Text>
          </ScreenCenter>
          </ReadyGate>
        );
      }
      return wrap(<ReadyGate ready><LockedScreen title="WARDROBE" description="Wardrobe analysis, gap tracking, and leveling all require AI. Upgrade, or buy a Full Wardrobe Analysis, to unlock." /></ReadyGate>);
    }
  }

  if (!demo && loading) return wrap(<ReadyGate ready={false} />);

  if (!demo && tableMissing) {
    return wrap(
      <ReadyGate ready>
      <ScreenCenter>
        <Text style={type.body}>{"Wardrobe leveling isn't set up on the server yet."}</Text>
      </ScreenCenter>
      </ReadyGate>
    );
  }

  if (!demo && (error || !analysis)) {
    return wrap(
      <ReadyGate ready>
      <ScreenCenter>
        <Text style={[type.body, { color: "#ff6b6b" }]}>
          {error ? "RETRY FAILED. WAIT SOME TIME AND TRY AGAIN." : "No wardrobe analysis available yet."}
        </Text>
        <TouchableOpacity onPress={load} style={{ marginTop: spacing.md }}>
          <Text style={[type.button, { color: colors.text }]}>RETRY</Text>
        </TouchableOpacity>
      </ScreenCenter>
      </ReadyGate>
    );
  }

  // First-run tutorial: the sample report (lib/tutorialSamples.ts) in place of this account's own,
  // nothing crossed off yet — display only.
  const v_crossedGaps = demo ? [] : crossedGaps;
  const v_crossedColors = demo ? [] : crossedColors;
  const v_crossedAesthetics = demo ? [] : crossedAesthetics;
  const v_crossedConIndices = demo ? [] : crossedConIndices;
  const v_ghostCons = demo ? [] : ghostCons;
  const v_gapProgress: Record<string, number> = demo ? {} : gapProgress;
  const v_pieceImages = demo ? sampleImages : pieceImages;
  const a = demo ? sampleReport : analysis!;
  const lvl = demo ? 1 : level ?? 1;
  const crossedGapSet = new Set(v_crossedGaps);
  const crossedColorSet = new Set(v_crossedColors);
  const crossedAesSet = new Set(v_crossedAesthetics);

  const allGapsCrossed = a.gaps.length === 0 || a.gaps.every(g => crossedGapSet.has(g.description));
  const allColorsCrossed = a.colors.missing.length === 0 || a.colors.missing.every(c => crossedColorSet.has(c));
  const allAesCrossed = a.aesthetics.missing.length === 0 || a.aesthetics.missing.every(ae => crossedAesSet.has(ae));
  const allConsCrossed = a.cons.length === 0 || a.cons.every((_, i) => v_crossedConIndices.includes(i));

  const gapsLabel = allGapsCrossed ? `GAPS · COMPLETE` : `GAPS · LEVEL ${lvl}`;
  const colorsLabel = allColorsCrossed ? `MISSING COLORS · COMPLETE` : `MISSING COLORS · LEVEL ${lvl}`;
  const aesLabel = allAesCrossed ? `MISSING AESTHETICS · COMPLETE` : `MISSING AESTHETICS · LEVEL ${lvl}`;
  const weaknessesLabel = allConsCrossed ? `WEAKNESSES · COMPLETE` : `WEAKNESSES · LEVEL ${lvl}`;

  const crossedInAnalysis = a.gaps.filter(g => crossedGapSet.has(g.description));
  const activeGaps = a.gaps.filter(g => !crossedGapSet.has(g.description));
  const crossedGhosts = v_crossedGaps.filter(d => !a.gaps.find(g => g.description === d));

  // Same left-to-right, top-to-bottom section order as the website's two-column layout
  // (app/wardrobe-analysis/page.tsx): pros, covered colors, covered aesthetics, insights, then
  // weaknesses, missing colors, missing aesthetics, gaps, overdone.
  const focusItems: FocusItem[] = [];
  if (a.pros.length > 0) {
    focusItems.push({ key: "h-pros", text: "PROS", color: colors.textFaint });
    a.pros.forEach((p, i) => focusItems.push({ key: `pros-${i}`, text: p, color: colors.good }));
  }
  if (a.colors.have.length > 0 || v_crossedColors.length > 0) {
    focusItems.push({ key: "h-colors", text: "COVERED COLORS", color: colors.textFaint });
    chunk3(a.colors.have).forEach((c, i) => focusItems.push({ key: `colors-${i}`, words: c, color: colors.textMuted }));
    if (v_crossedColors.length > 0) chunk3(v_crossedColors).forEach((c, i) => focusItems.push({ key: `colors-x-${i}`, words: c, color: colors.textFaint }));
  }
  if (a.aesthetics.covered.length > 0 || v_crossedAesthetics.length > 0) {
    focusItems.push({ key: "h-aes", text: "COVERED AESTHETICS", color: colors.textFaint });
    chunk3(a.aesthetics.covered.map(x => x.name)).forEach((c, i) => focusItems.push({ key: `aes-${i}`, words: c, color: colors.textMuted }));
    if (v_crossedAesthetics.length > 0) chunk3(v_crossedAesthetics).forEach((c, i) => focusItems.push({ key: `aes-x-${i}`, words: c, color: colors.textFaint }));
  }
  if (a.insights.length > 0) {
    focusItems.push({ key: "h-insights", text: "INSIGHTS", color: colors.textFaint });
    a.insights.forEach((ins, i) => focusItems.push({ key: `insights-${i}`, text: ins, color: colors.textMuted }));
  }
  if (a.cons.length > 0) {
    const visibleCons = a.cons
      .map((text, i) => ({ text, i }))
      .filter(({ text, i }) => {
        const isDuplicate = v_ghostCons.some(g => g.trim().toLowerCase() === text.trim().toLowerCase());
        return !isDuplicate && !v_crossedConIndices.includes(i);
      });
    if (visibleCons.length > 0) {
      focusItems.push({ key: "h-cons", text: weaknessesLabel, color: colors.textFaint });
      visibleCons.forEach(({ text, i }) => focusItems.push({ key: `cons-${i}`, text, color: colors.bad }));
    }
  }
  focusItems.push({ key: "h-mcolors", text: colorsLabel, color: colors.textFaint });
  if (a.colors.missing.length === 0 && v_crossedColors.length === 0) {
    focusItems.push({ key: "mcolors-none", text: "None", color: colors.textFaint });
  } else {
    const extraCrossed = v_crossedColors.filter(c => !a.colors.missing.includes(c));
    chunk3(a.colors.missing).forEach((c, i) => focusItems.push({
      key: `mcolors-${i}`, words: c,
      color: c.every(w => crossedColorSet.has(w)) ? colors.textFaint : colors.textMuted,
    }));
    if (extraCrossed.length > 0) chunk3(extraCrossed).forEach((c, i) => focusItems.push({ key: `mcolors-x-${i}`, words: c, color: colors.textFaint }));
  }
  focusItems.push({ key: "h-maes", text: aesLabel, color: colors.textFaint });
  if (a.aesthetics.missing.length === 0 && v_crossedAesthetics.length === 0) {
    focusItems.push({ key: "maes-none", text: "None", color: colors.textFaint });
  } else {
    const extraCrossed = v_crossedAesthetics.filter(ae => !a.aesthetics.missing.includes(ae));
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
      const prog = v_gapProgress[gap.description] ?? 0;
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

  // A purchased report whose current level is finished can be taken further with another purchase.
  const showAdvancePrompt = !demo && !hasAI && !!wjobs?.wardrobe.canAdvance && credits > 0;

  return wrap(
    <ReadyGate ready images={v_pieceImages}>
    <SafeAreaView
      style={[styles.container, { justifyContent: "center", paddingBottom: insets.bottom }]}
      edges={["top", "left", "right"]}
    >
      <View style={{ alignItems: "center" }}>
        {showAdvancePrompt && (
          <View style={{ alignItems: "center", marginBottom: spacing.md, paddingHorizontal: spacing.lg }}>
            <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginBottom: spacing.xs }]}>{promptText}</Text>
            <TextButton label="YES" onPress={performAnalysis} />
          </View>
        )}
        <StatusMessage status={status} style={{ textAlign: "center" }} />
        <Text style={[type.label, { marginBottom: 2 }]}>LEVEL {lvl}</Text>
        <Text style={{ fontSize: 48, fontWeight: "700", color: scoreColor(a.score) }}>{a.score}</Text>

        <View style={styles.pieceBox}>
          <BouncingPieces width={BOX_W - 3} height={228} remoteUris={v_pieceImages} active={isFocused} />
        </View>
      </View>

      {focusItems.length > 0 && (
        <View style={{ height: 190, marginTop: spacing.lg, marginBottom: spacing.sm }}>
          <FocusScrollList items={focusItems} focal={0.5} />
        </View>
      )}
    </SafeAreaView>
    </ReadyGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pieceBox: { width: BOX_W, height: 230, borderWidth: 1.5, borderColor: colors.text, marginTop: spacing.md, overflow: "hidden" },
});
