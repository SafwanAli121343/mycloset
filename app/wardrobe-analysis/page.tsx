"use client";
import { PAYMENTS_LIVE } from "@/lib/client/paidFeatures";
import { useEntitlements } from "@/contexts/EntitlementsContext";
import { ReadyGate } from "@/components/ReadyGate";
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { WardrobeAnalysis, WABackendState, CrossedEntry } from "@/lib/wardrobeAnalysis";
import { computeEffectiveLevel, gapTotalProgress, computeGapProgress, getFunctionalSlot, resolveSubTypeFromTitle } from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { AnalysisOverlay } from "@/components/AnalysisOverlay";
import { useTutorialDemo } from "@/lib/client/tutorialState";
import { sampleWardrobeReport, SAMPLE_IMAGES } from "@/lib/client/tutorialSamples";
import {
  fetchJobs, startJob, waitForJob, ackJobs, jobFailureMessage, WARDROBE_STAGES, type JobsStatus,
} from "@/lib/client/analysisJobs";

const FONT = { fontFamily: "Arial, sans-serif" };
const LOADING_IMG = "/loading-tee.png";
const SPEED = 65;
const HEADER_H = 104;
const COLOR_LIMIT = 6;
const AES_LIMIT   = 6;

const KEYFRAMES = `
@keyframes loadbar {
  0%   { width: 0% }
  55%  { width: 65% }
  80%  { width: 84% }
  100% { width: 93% }
}
`;

function scoreColor(s: number) {
  return s >= 75 ? "#1d9e52" : s >= 50 ? "#c88800" : "#c83030";
}
function impactColor(i: string) {
  return i === "high" ? "#c83030" : i === "medium" ? "#c88800" : "#999";
}
// Progress 1—99 → color spectrum red → orange → yellow → yellow-green
function gapProgressColor(progress: number): string {
  if (progress >= 75) return "#88aa00";
  if (progress >= 50) return "#b8a000";
  if (progress >= 25) return "#cc7700";
  return "#cc3300";
}

const COLOR_HEX: Record<string, string> = {
  "Black":        "#111",
  "White":        "#bbb",
  "Navy":         "#1a3060",
  "Gray":         "#808080",
  "Grey":         "#808080",
  "Silver":       "#999",
  "Beige":        "#c8a882",
  "Tan":          "#c4a067",
  "Camel":        "#c19a6b",
  "Brown":        "#6b3a2a",
  "Cream":        "#c4ba8a",
  "Ivory":        "#c4bf9a",
  "Khaki":        "#a39060",
  "Stone":        "#928e80",
  "Charcoal":     "#444",
  "Olive":        "#6b7a2a",
  "Burgundy":     "#6e1423",
  "Forest Green": "#2d5c27",
  "Green":        "#2d7d30",
  "Red":          "#cc1111",
  "Blue":         "#1a4b8c",
  "Indigo":       "#3b3b9a",
  "Yellow":       "#b8960a",
  "Orange":       "#cc5500",
  "Pink":         "#cc5588",
  "Purple":       "#6b2b8a",
  "Gold":         "#b8900a",
  "Rose":         "#c87070",
  "Teal":         "#1d7a7a",
  "Rust":         "#8b3a1a",
  "Ash Heather":  "#8a8a8a",
  "Ash":          "#8a8a8a",
  "Heather":      "#8a8a8a",
  "Wheat":        "#c8a050",
  "Coral":        "#cc4433",
  "Sand":         "#c8a882",
  "Cobalt":       "#0047ab",
};
function colorHex(name: string): string {
  if (COLOR_HEX[name]) return COLOR_HEX[name];
  return COLOR_HEX[name.split(" ")[0]] ?? "#333";
}

type Phase = "loading" | "counting" | "lifting" | "settled";
type PieceImg = { id: string; image: string | null; sub_type: string | null };
type Ball = { x: number; y: number; vx: number; vy: number };

// ── Cache helpers ──────────────────────────────────────────────────────────────
interface WACache {
  pieceCount: number;
  backendState: WABackendState;
}
function readWACache(): WACache | null {
  try { const r = localStorage.getItem("wa_cache_v20"); return r ? (JSON.parse(r) as WACache) : null; }
  catch { return null; }
}
function saveWACache(c: WACache): void {
  try { localStorage.setItem("wa_cache_v20", JSON.stringify(c)); } catch {}
}

// A con is "resolved" at a given level iff a crossing entry exists for it AND either:
//  - that entry is tied to a real item (garmentId set) — its lifecycle is already kept
//    accurate by the delete cascade, which strips entries by garmentId when an item is
//    removed, so existence alone is trustworthy; or
//  - it's one of the garmentId-less entries created by initial auto-crossing at
//    analysis-generation time (see the Level 1 auto-cross block below) — these can never
//    be removed by the delete cascade, so we must live-check the linked gap instead.
// Single source of truth used everywhere a con's resolution status matters, so the display
// (crossed indices, ghost cons), the score, and the level-advancement check can never disagree.
function isConResolved(
  crossed: CrossedEntry[],
  conGapLinks: Record<string, string> | undefined,
  index: number,
  level: number,
): boolean {
  const entry = crossed.find(e => e.category === "con" && e.key === String(index) && e.analysisLevel === level);
  if (!entry) return false;
  if (entry.garmentId) return true;
  const linkedGap = (conGapLinks ?? {})[String(index)];
  return linkedGap ? gapTotalProgress(crossed, linkedGap, level) >= 100 : true;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p style={{ ...FONT, fontSize: 16, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", textAlign: "center", margin: "0 0 14px" }}>
      {label}
    </p>
  );
}
function ItemText({ text, color = "#222" }: { text: string; color?: string }) {
  return (
    <p style={{ ...FONT, fontSize: 17, color, margin: "0 0 10px", lineHeight: 1.5 }}>
      {text}
    </p>
  );
}
function ShowMoreBtn({ showing, total, limit, onToggle }: { showing: boolean; total: number; limit: number; onToggle: () => void }) {
  if (total <= limit) return null;
  return (
    <button onClick={onToggle} style={{ ...FONT, background: "none", border: "none", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#888", cursor: "pointer", padding: 0, textTransform: "uppercase" }}>
      {showing ? "HIDE" : "SHOW MORE"}
    </button>
  );
}
// ── Scroll column wrapper (same pattern as preview comparison panels) ──────────

function ScrollCol({ atTop, atBot, scrollRef, onScroll, children, mobile }: {
  atTop: boolean;
  atBot: boolean;
  scrollRef: (el: HTMLDivElement | null) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
  mobile?: boolean;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

  // Mobile: the three columns stack into one page-scrolled column instead of sitting
  // side by side, so there's no more need for (or room for) each column to scroll
  // independently within a fixed viewport height — render children directly, letting the
  // page itself scroll. The 160px horizontal padding below is also desktop-only sizing
  // (it's breathing room around ~460px-wide columns); at full mobile width it would eat
  // nearly all the screen, so mobile uses simple, much smaller padding instead.
  if (mobile) {
    return <div style={{ padding: "8px 20px 32px", textAlign: "center" }}>{children}</div>;
  }

  return (
    <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div
        ref={el => { innerRef.current = el; scrollRef(el); }}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", textAlign: "center", padding: "20px 160px 180px" }}
      >
        {children}
      </div>

      {/* Top fade — appears after user scrolls down */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 70,
        background: "linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)",
        pointerEvents: "none",
        opacity: atTop ? 0 : 1,
        transition: "opacity 0.3s ease",
      }} />

      {/* Bottom gradient + flip arrow */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, pointerEvents: "none" }}>
        <div style={{
          height: 200, width: "100%",
          background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 38%)",
          opacity: atBot ? 0 : 1,
          transition: "opacity 0.3s ease",
        }} />
        <div
          onClick={() => {
            const el = innerRef.current;
            if (!el) return;
            atBot ? el.scrollTo({ top: 0, behavior: "smooth" }) : el.scrollBy({ top: 300, behavior: "smooth" });
          }}
          style={{
            background: "#fff", width: "100%", display: "flex", justifyContent: "center",
            paddingTop: 4, paddingBottom: 16,
            cursor: "pointer", pointerEvents: "auto",
            opacity: (atTop && atBot) ? 0 : 1,
            transition: "opacity 0.3s ease",
          }}
        >
          {atBot
            ? <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 7L7 1L13 7" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 1L7 7L13 1" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          }
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function WardrobeAnalysisPage() {
  const { hasAI, ready: entitlementsReady, refresh: refreshEntitlements } = useEntitlements();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [phase, setPhase]               = useState<Phase>("loading");
  const [displayScore, setDisplayScore] = useState(0);
  const [analysis, setAnalysis]         = useState<WardrobeAnalysis | null>(null);
  const [pieces, setPieces]             = useState<PieceImg[]>([]);
  const [error, setError]               = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  const [showAllColors,    setShowAllColors]    = useState(false);
  const [showAllMissColor, setShowAllMissColor] = useState(false);
  const [showAllAes,       setShowAllAes]       = useState(false);
  const [showAllMissAes,   setShowAllMissAes]   = useState(false);

  // Items crossed out by newly-added pieces (shown with strikethrough)
  const [crossedGaps,        setCrossedGaps]        = useState<string[]>([]);
  const [crossedColors,      setCrossedColors]      = useState<string[]>([]);
  const [crossedAesthetics,  setCrossedAesthetics]  = useState<string[]>([]);
  const [crossedConIndices,  setCrossedConIndices]  = useState<number[]>([]);
  const [ghostCons,          setGhostCons]          = useState<string[]>([]); // cons from prior levels, already crossed
  const [gapProgress,        setGapProgress]        = useState<Record<string, number>>({});
  const [gapsLevel,          setGapsLevel]          = useState(1);
  const [colorsLevel,        setColorsLevel]        = useState(1);
  const [aestheticsLevel,    setAestheticsLevel]    = useState(1);
  const [weaknessesLevel,    setWeaknessesLevel]    = useState(1);

  // Scroll arrow state: [leftCol, rightCol]
  const colScrollRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const [colAtTop, setColAtTop] = useState([true, true]);
  const [colAtBot, setColAtBot] = useState([false, false]);

  const rectRef        = useRef<HTMLDivElement>(null);
  const imgRefs        = useRef<(HTMLImageElement | null)[]>([]);
  const balls          = useRef<Ball[]>([]);
  const rafId          = useRef(0);
  // Which load already ran (plan + report access + reload count) — a purchase or plan change
  // re-runs it; anything else never loads twice.
  const fetchedRef     = useRef<string | null>(null);
  // Free tier: purchased Full Wardrobe Analyses and the report's status (same as the app).
  const [wj, setWj]                 = useState<JobsStatus | null>(null);
  const [analyzing, setAnalyzing]   = useState(false);
  const [awaitingReveal, setAwaitingReveal] = useState(false);
  const [jobMsg, setJobMsg]         = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const demo = useTutorialDemo();
  const sampleReport = useMemo(() => sampleWardrobeReport() as WardrobeAnalysis, []);
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);
  const canView = hasAI || wj?.wardrobe.report === "purchased";
  const animStarted    = useRef(false);
  const physicsStarted = useRef(false);

  // Fetch analysis — backend state is authoritative; localStorage v7 is a session-level perf cache.
  useEffect(() => {
    if (!entitlementsReady) return;
    // Free tier: wait for the purchase status before deciding what this page shows.
    if (!hasAI && !wj) return;
    const key = `${hasAI}|${canView}|${reloadNonce}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;
    // Only Pro may ask the server for a NEW level; a free user viewing a report they bought sees
    // it as it stands (the next level comes from another purchase).
    const allowFresh = hasAI;
    // Free tier without a purchased report: the prompt / locked view below — nothing to load.
    if (!canView) {
      setAnalysis(null);
      setPhase("settled");
      return;
    }
    setPhase("loading");

    (async () => {
      type GarmentAttr = { id: string; sub_type: string | null; category: string | null; color_primary: string | null; aesthetic_tags: string[] | null };
      const sData: { pieceCount?: number; pieces?: PieceImg[]; wardrobeScore?: number; garmentAttrs?: GarmentAttr[] } | null =
        // skipOutfits=1: this page only reads pieces/pieceCount/garmentAttrs, never topOutfits —
        // the expensive outfit search behind it was pure wasted work here (the app already skips it).
        await fetch("/api/scoring?skipOutfits=1").then(r => r.ok ? r.json() : null).catch(() => null);

      const currentCount = sData?.pieceCount ?? (sData?.pieces?.length ?? 0);
      if (sData?.pieces) setPieces(sData.pieces.filter(p => p.image));

      // Helper: apply a backend state + effective level to all display state vars
      function applyState(bs: WABackendState, effLevel: number, displayA: WardrobeAnalysis) {
        const atLevel = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === effLevel);

        // Per-gap total progress at this level
        const gapProgressMap: Record<string, number> = {};
        for (const g of displayA.gaps) {
          gapProgressMap[g.description] = gapTotalProgress(bs.crossed, g.description, effLevel);
        }
        setGapProgress(gapProgressMap);

        const fullyResolvedGaps = Object.entries(gapProgressMap)
          .filter(([, p]) => p >= 100).map(([k]) => k);
        setCrossedGaps(fullyResolvedGaps);

        const crossedColorKeys = new Set(atLevel.filter((e: CrossedEntry) => e.category === "color").map((e: CrossedEntry) => e.key));
        const crossedAesKeys   = new Set(atLevel.filter((e: CrossedEntry) => e.category === "aesthetic").map((e: CrossedEntry) => e.key));
        setCrossedColors([...crossedColorKeys]);
        setCrossedAesthetics([...crossedAesKeys]);
        // Crossed cons: use the shared isConResolved check so this always agrees with the
        // score computation and the level-advancement check below.
        const crossedConIdxs = displayA.cons
          .map((_, i) => i)
          .filter(i => isConResolved(bs.crossed, displayA.conGapLinks, i, effLevel));
        setCrossedConIndices(crossedConIdxs);
        setGapsLevel(effLevel);
        setColorsLevel(effLevel);
        setAestheticsLevel(effLevel);
        setWeaknessesLevel(effLevel);

        // Ghost cons: cons from PREVIOUS levels that were resolved
        const ghosts: string[] = [];
        for (let L = 1; L < effLevel; L++) {
          const prevA = bs.analysisHistory[L - 1];
          if (!prevA) continue;
          prevA.cons.forEach((text, i) => {
            if (isConResolved(bs.crossed, prevA.conGapLinks, i, L)) ghosts.push(text);
          });
        }
        setGhostCons(ghosts);

        // Base score: the stable Level 1 GPT score. Never changes on item addition
        // so adding weak items can't regress the score. Score only moves via bumps
        // (crossed gaps/aesthetics/colors/cons) or when crossed items are removed.
        //
        // Every resolved gap/color/aesthetic/con has a FIXED point value (costPoints,
        // or 2/1/2 for colors/aesthetics/cons) that never varies with the current score
        // or with which level it's being counted in. Total is a straight sum across all
        // levels, capped once at 100. This is what guarantees removing then re-adding
        // the same item is exactly symmetric (same points off, same points back on) -
        // a previous version applied a diminishing-returns multiplier PER LEVEL, in
        // sequence, so a change to an earlier level's total could shift the multiplier
        // used for a later level's total even though the later level's own crossings
        // never changed - producing exactly the kind of inconsistent remove/re-add
        // delta this replaces.
        const baseScore = bs.analysisHistory[0]?.score ?? displayA.score;
        // Calibrated once at Level 1 generation time from an estimate of how much is
        // genuinely left to find across this wardrobe's whole remaining journey to 100
        // (see WardrobeAnalysis.pointWeights) - frozen forever after that, same as
        // baseScore, so remove/re-add stays exactly symmetric. {gap:4,color:1,
        // aesthetic:1,con:1} is only a fallback for legacy analyses saved before this
        // calibration existed.
        const pw = bs.analysisHistory[0]?.pointWeights ?? { gap: 4, color: 1, aesthetic: 1, con: 1 };
        let totalPts = 0;

        for (let L = 1; L <= effLevel; L++) {
          const levelA = bs.analysisHistory[L - 1];
          if (!levelA) break;
          const lc = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === L);

          for (const g of levelA.gaps) {
            if (gapTotalProgress(bs.crossed, g.description, L) >= 100) {
              // Fallback tiers match the cap applied at generation time (see costPoints
              // in app/api/wardrobe/analysis/route.ts) - only hit for legacy data saved
              // before that cap existed.
              totalPts += g.costPoints > 0 ? g.costPoints : g.impact === "high" ? pw.gap : g.impact === "medium" ? Math.ceil(pw.gap / 2) : 1;
            }
          }
          const lcColKeys = new Set(lc.filter((e: CrossedEntry) => e.category === "color").map((e: CrossedEntry) => e.key));
          totalPts += lcColKeys.size * pw.color;
          const lcAesKeys = new Set(lc.filter((e: CrossedEntry) => e.category === "aesthetic").map((e: CrossedEntry) => e.key));
          totalPts += lcAesKeys.size * pw.aesthetic;
          // Cons: use the shared isConResolved check, one per known con index (never double-
          // counts even if a merge produced multiple crossing rows for the same index).
          let lcConCount = 0;
          levelA.cons.forEach((_, i) => {
            if (isConResolved(bs.crossed, levelA.conGapLinks, i, L)) lcConCount++;
          });
          totalPts += lcConCount * pw.con;
        }
        const bumpedScore = Math.min(100, baseScore + totalPts);
        // Safety net: strip aesthetics/colors that already appeared in a prior level's missing list,
        // in case the data stored in Supabase predates the API-level dedup filter.
        const priorAesSet = new Set(
          bs.analysisHistory.slice(0, effLevel - 1).flatMap(a => a.aesthetics.missing.map(ae => ae.toLowerCase()))
        );
        const priorColSet = new Set(
          bs.analysisHistory.slice(0, effLevel - 1).flatMap(a => a.colors.missing.map(c => c.toLowerCase().trim()))
        );
        // Overdone status is re-checked against the CURRENT wardrobe every time this
        // runs (not the frozen snapshot from whenever this level's analysis was
        // generated), and kept entirely separate from crossing/leveling/scoring:
        // an entry disappears the moment its actual sub-type count drops back below
        // the "overdone" threshold (3+, same threshold used at generation time), and
        // would reappear if it climbed back up — with no points or level interaction.
        const liveSubTypeCounts: Record<string, number> = {};
        for (const g of (sData?.garmentAttrs ?? [])) {
          if (g.sub_type) liveSubTypeCounts[g.sub_type] = (liveSubTypeCounts[g.sub_type] ?? 0) + 1;
        }
        const liveOverdone = displayA.overdone
          .map(o => ({ ...o, count: liveSubTypeCounts[o.description] ?? 0 }))
          .filter(o => o.count >= 3);

        const filteredDisplayA: WardrobeAnalysis = {
          ...(effLevel <= 1 ? displayA : {
            ...displayA,
            aesthetics: {
              ...displayA.aesthetics,
              missing: displayA.aesthetics.missing.filter(ae => !priorAesSet.has(ae.toLowerCase())),
            },
            colors: {
              ...displayA.colors,
              missing: displayA.colors.missing.filter(c => !priorColSet.has(c.toLowerCase().trim())),
            },
          }),
          overdone: liveOverdone,
        };
        setAnalysis({ ...filteredDisplayA, score: bumpedScore });
      }

      // Helper: run fresh GPT analysis, passing prior history (so repeats are excluded) and the
      // live crossed state (so the server only excludes prior items that are STILL currently
      // resolved — anything that was resolved then became unresolved again, e.g. its filling
      // item was deleted, is eligible to be resurfaced in this new level).
      async function fetchFreshAnalysis(priorAnalyses: WardrobeAnalysis[] = [], crossed: CrossedEntry[] = []): Promise<WardrobeAnalysis> {
        return fetch("/api/wardrobe/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priorAnalyses, crossed }),
        }).then(r => {
          if (!r.ok) return r.json().then((e: { error?: string }) => Promise.reject(e.error ?? "Failed"));
          return r.json();
        });
      }

      // Fast path: v7 localStorage matches current piece count
      // Skip cache if everything is resolved — must hit backend to trigger level advancement
      const cache = readWACache();
      if (cache && cache.pieceCount === currentCount && currentCount > 0) {
        const bs       = cache.backendState;
        const effLevel = computeEffectiveLevel(bs.analysisHistory, bs.crossed, bs.currentLevel);
        const displayA = bs.analysisHistory[effLevel - 1];
        if (displayA) {
          // history.length > currentLevel means we already tried advancing and GPT had nothing.
          // Encoded in existing DB fields — no extra column needed, survives across devices.
          if (bs.analysisHistory.length > bs.currentLevel) { applyState(bs, effLevel, displayA); return; }
          const atL = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === effLevel);
          const allResolved =
            (displayA.gaps.length === 0 || displayA.gaps.every(g => gapTotalProgress(bs.crossed, g.description, effLevel) >= 100)) &&
            (displayA.cons.length === 0 || displayA.cons.every((_, i) => isConResolved(bs.crossed, displayA.conGapLinks, i, effLevel))) &&
            (displayA.colors.missing.length === 0 || displayA.colors.missing.every(c => atL.some((e: CrossedEntry) => e.category === "color" && e.key === c))) &&
            (displayA.aesthetics.missing.length === 0 || displayA.aesthetics.missing.every(ae => atL.some((e: CrossedEntry) => e.category === "aesthetic" && e.key === ae)));
          if (!allResolved || !allowFresh) { applyState(bs, effLevel, displayA); return; }
          // Everything resolved — fall through to backend to trigger next level
        }
      }

      // Load authoritative state from backend
      const stateRes = await fetch("/api/wardrobe/state").catch(() => null);
      if (stateRes?.status === 503) {
        const body = await stateRes.json().catch(() => ({})) as { error?: string };
        if (body.error === "table_missing") { setTableMissing(true); setPhase("settled"); return; }
      }
      const fetchFailed = !stateRes || !stateRes.ok;
      const state: WABackendState | null = stateRes?.ok ? await stateRes.json().catch(() => null) : null;

      if (state && state.analysisHistory.length > 0) {
        const effLevel = computeEffectiveLevel(state.analysisHistory, state.crossed, state.currentLevel);
        const displayA = state.analysisHistory[effLevel - 1];

        // history.length > currentLevel: already tried advancing, GPT had nothing — don't re-query.
        if (state.analysisHistory.length > state.currentLevel && displayA) {
          const mergedState = { ...state };
          applyState(mergedState, effLevel, displayA);
          saveWACache({ pieceCount: currentCount, backendState: mergedState });
          return;
        }

        // Merge backend crosses with cache crosses — backend may be missing entries
        // saved locally before a state row existed, or during cache-key transitions.
        const crossKey = (e: CrossedEntry) => `${e.category}|${e.key}|${e.garmentId ?? ""}|${e.analysisLevel}`;
        const backendKeys = new Set(state.crossed.map(crossKey));
        const extraFromCache = (cache?.backendState?.crossed ?? []).filter(e => !backendKeys.has(crossKey(e)));
        const mergedCrossed: CrossedEntry[] = [...state.crossed, ...extraFromCache];

        // Advance to next level only when ALL categories are fully resolved at this level
        const _atL = mergedCrossed.filter((e: CrossedEntry) => e.analysisLevel === effLevel);
        const allCrossed = displayA &&
          (displayA.gaps.length === 0 || displayA.gaps.every(g => gapTotalProgress(mergedCrossed, g.description, effLevel) >= 100)) &&
          (displayA.cons.length === 0 || displayA.cons.every((_, i) => isConResolved(mergedCrossed, displayA.conGapLinks, i, effLevel))) &&
          (displayA.colors.missing.length === 0 || displayA.colors.missing.every(c => _atL.some((e: CrossedEntry) => e.category === "color" && e.key === c))) &&
          (displayA.aesthetics.missing.length === 0 || displayA.aesthetics.missing.every(ae => _atL.some((e: CrossedEntry) => e.category === "aesthetic" && e.key === ae)));

        if (allCrossed && allowFresh) {
          // All current-level items crossed — fetch fresh analysis for the next level.
          // Pass prior history so GPT finds NEW gaps/aesthetics/colors/weaknesses, not repeats.
          let freshA;
          try { freshA = await fetchFreshAnalysis(state.analysisHistory, mergedCrossed); }
          catch (e) { console.error("[WA] fetchFreshAnalysis failed:", e); throw e; }
          // If GPT returned nothing actionable, push the empty entry WITHOUT incrementing
          // currentLevel. analysisHistory.length > currentLevel then acts as a persistent
          // sentinel stored in DB — no extra column needed, survives across all devices/browsers.
          const hasContent = freshA.gaps.length > 0 || freshA.colors.missing.length > 0
                          || freshA.aesthetics.missing.length > 0 || freshA.cons.length > 0;
          if (!hasContent) {
            const sentinelState: WABackendState = {
              analysisHistory: [...state.analysisHistory, freshA], // length = currentLevel + 1
              crossed:         mergedCrossed,
              currentLevel:    state.currentLevel,                 // NOT incremented
            };
            fetch("/api/wardrobe/state", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(sentinelState),
            }).catch(() => {});
            applyState(sentinelState, effLevel, displayA);
            saveWACache({ pieceCount: currentCount, backendState: sentinelState });
            return;
          }
          const newState: WABackendState = {
            analysisHistory: [...state.analysisHistory, freshA],
            crossed:         mergedCrossed,
            currentLevel:    state.currentLevel + 1,
          };
          const newEffLevel = state.currentLevel + 1;
          fetch("/api/wardrobe/state", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newState),
          }).catch(() => {});
          applyState(newState, newEffLevel, freshA);
          saveWACache({ pieceCount: currentCount, backendState: newState });
        } else {
          // Save merged crosses so cache never regresses to fewer entries than we have locally
          const mergedState = { ...state, crossed: mergedCrossed };
          applyState(mergedState, effLevel, displayA);
          saveWACache({ pieceCount: currentCount, backendState: mergedState });
        }
      } else if ((fetchFailed || !state) && cache?.backendState?.analysisHistory?.length) {
        // Backend unavailable or no state, but localStorage has valid state — use cache.
        // Also run level-advancement check here so a backend outage doesn't block progression.
        if (fetchFailed) console.warn("[WA] backend state fetch failed (500?) - using cache for level check");
        const bs = cache.backendState;
        const effLevel = computeEffectiveLevel(bs.analysisHistory, bs.crossed, bs.currentLevel);
        const displayA = bs.analysisHistory[effLevel - 1];
        if (displayA) {
          if (bs.analysisHistory.length > bs.currentLevel) { applyState(bs, effLevel, displayA); saveWACache({ pieceCount: currentCount, backendState: bs }); return; }
          const atL = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === effLevel);
          const allResolved =
            (displayA.gaps.length === 0 || displayA.gaps.every(g => gapTotalProgress(bs.crossed, g.description, effLevel) >= 100)) &&
            (displayA.cons.length === 0 || displayA.cons.every((_, i) => isConResolved(bs.crossed, displayA.conGapLinks, i, effLevel))) &&
            (displayA.colors.missing.length === 0 || displayA.colors.missing.every(c => atL.some((e: CrossedEntry) => e.category === "color" && e.key === c))) &&
            (displayA.aesthetics.missing.length === 0 || displayA.aesthetics.missing.every(ae => atL.some((e: CrossedEntry) => e.category === "aesthetic" && e.key === ae)));
          if (allResolved && allowFresh) {
            let freshA;
            try { freshA = await fetchFreshAnalysis(bs.analysisHistory, bs.crossed); }
            catch (e) { console.error("[WA] fetchFreshAnalysis failed:", e); applyState(bs, effLevel, displayA); return; }
            const hasContent = freshA.gaps.length > 0 || freshA.colors.missing.length > 0
                            || freshA.aesthetics.missing.length > 0 || freshA.cons.length > 0;
            if (!hasContent) {
              const sentinelState: WABackendState = {
                analysisHistory: [...bs.analysisHistory, freshA],
                crossed:         bs.crossed,
                currentLevel:    bs.currentLevel,
              };
              fetch("/api/wardrobe/state", {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sentinelState),
              }).catch(() => {});
              applyState(sentinelState, effLevel, displayA);
              saveWACache({ pieceCount: currentCount, backendState: sentinelState });
              return;
            }
            const newState: WABackendState = {
              analysisHistory: [...bs.analysisHistory, freshA],
              crossed:         bs.crossed,
              currentLevel:    bs.currentLevel + 1,
            };
            fetch("/api/wardrobe/state", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newState),
            }).catch(() => {});
            applyState(newState, bs.currentLevel + 1, freshA);
            saveWACache({ pieceCount: currentCount, backendState: newState });
          } else {
            applyState(bs, effLevel, displayA);
            saveWACache({ pieceCount: currentCount, backendState: bs });
          }
        }
      } else if (!allowFresh) {
        // Free tier and the report couldn't be read: show the purchase prompt instead.
        setAnalysis(null);
        setPhase("settled");
      } else {
        // No valid state — rebuild crossing state from current wardrobe.
        // Always advance to Level 2: this path only runs as recovery (the user had history
        // that got lost), so gap-crossing gates are skipped. Gaps remain open for the user
        // to fill manually; only colors, aesthetics, and cons are auto-crossed.
        const freshA = await fetchFreshAnalysis();
        const attrs = sData?.garmentAttrs ?? [];
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

        const autoCrossed: CrossedEntry[] = [];

        for (const gap of freshA.gaps) {
          for (const g of attrs) {
            const sub = g.sub_type ?? resolveSubTypeFromTitle("");
            const funcSlot = getFunctionalSlot(sub);
            const cat = (g.category ?? "").toLowerCase();
            const progress = computeGapProgress(gap.description, sub, cat, funcSlot);
            if (progress > 0) {
              autoCrossed.push({ category: "gap", key: gap.description, garmentId: g.id, analysisLevel: 1, progress });
            }
          }
        }
        for (const missingColor of freshA.colors.missing) {
          const filler = attrs.find(g => g.color_primary && sameColorGroup(g.color_primary, missingColor));
          if (filler) autoCrossed.push({ category: "color", key: missingColor, garmentId: filler.id, analysisLevel: 1 });
        }
        for (const missingAes of freshA.aesthetics.missing) {
          const filler = attrs.find(g =>
            (g.aesthetic_tags ?? []).some(t => norm(t) === norm(missingAes))
          );
          if (filler) autoCrossed.push({ category: "aesthetic", key: missingAes, garmentId: filler.id, analysisLevel: 1 });
        }
        for (let ci = 0; ci < freshA.cons.length; ci++) {
          const linkedGap = (freshA.conGapLinks ?? {})[String(ci)];
          if (!linkedGap || gapTotalProgress(autoCrossed, linkedGap, 1) >= 100) {
            autoCrossed.push({ category: "con", key: String(ci), garmentId: undefined as unknown as string, analysisLevel: 1 });
          }
        }

        // Check if Level 1 is fully resolved after auto-crossing
        const atL1 = autoCrossed.filter(e => e.analysisLevel === 1);
        const l1GapsOk = freshA.gaps.length === 0 || freshA.gaps.every(g => gapTotalProgress(autoCrossed, g.description, 1) >= 100);
        const l1ColsOk = freshA.colors.missing.length === 0 || freshA.colors.missing.every(c => atL1.some(e => e.category === "color" && e.key === c));
        const l1AesOk  = freshA.aesthetics.missing.length === 0 || freshA.aesthetics.missing.every(ae => atL1.some(e => e.category === "aesthetic" && e.key === ae));
        const l1Complete = l1GapsOk && l1ColsOk && l1AesOk;

        let newState: WABackendState;
        if (l1Complete) {
          let freshA2: WardrobeAnalysis;
          try { freshA2 = await fetchFreshAnalysis([freshA], autoCrossed); }
          catch { freshA2 = freshA; }
          const reachedL2 = freshA2 !== freshA;
          newState = {
            analysisHistory: reachedL2 ? [freshA, freshA2] : [freshA],
            crossed:         autoCrossed,
            currentLevel:    reachedL2 ? 2 : 1,
          };
          applyState(newState, newState.currentLevel, reachedL2 ? freshA2 : freshA);
        } else {
          newState = { analysisHistory: [freshA], crossed: autoCrossed, currentLevel: 1 };
          applyState(newState, 1, freshA);
        }
        // Only PUT to backend if there was truly no state (first visit or wiped row).
        // Never overwrite existing backend state with a rebuild that couldn't advance.
        if (!state || !state.analysisHistory.length) {
          fetch("/api/wardrobe/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newState) }).catch(() => {});
        }
        saveWACache({ pieceCount: currentCount, backendState: newState });
      }
    })().catch((err: unknown) => {
      setError(typeof err === "string" ? err : "Failed to load");
      setPhase("settled");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlementsReady, hasAI, canView, reloadNonce, wj]);

  // A purchased analysis finished: drop the local copy, reload the report from the server, and
  // keep the loading screen up until it's on the page (then it all appears at once).
  function revealReport() {
    try { localStorage.removeItem("wa_cache_v20"); } catch {}
    animStarted.current = false;
    setAwaitingReveal(true);
    setReloadNonce(n => n + 1);
  }
  useEffect(() => {
    if (awaitingReveal && phase !== "loading" && (analysis || error)) {
      setAwaitingReveal(false);
      setAnalyzing(false);
    }
  }, [awaitingReveal, phase, analysis, error]);

  const followingRef = useRef<string | null>(null);
  async function followJob(jobId: string) {
    // One watcher per job — revisiting the tab while it runs must not start a second one.
    if (followingRef.current === jobId) return;
    followingRef.current = jobId;
    setAnalyzing(true);
    const job = await waitForJob(jobId, () => unmounted.current);
    if (unmounted.current) return;
    ackJobs([jobId]);
    followingRef.current = null;
    refreshEntitlements();
    const s = await fetchJobs().catch(() => null);
    if (s && !unmounted.current) setWj(s);
    if (job.status === "done") { revealReport(); return; }
    if (job.status === "failed") setJobMsg(jobFailureMessage(job));
    setAnalyzing(false);
  }

  // Free tier: purchase status, plus an analysis that was running (or finished/failed) while the
  // page was closed.
  useEffect(() => {
    if (!entitlementsReady || hasAI) return;
    let cancelled = false;
    fetchJobs().then(s => {
      if (cancelled) return;
      setWj(s);
      const mine = s.jobs.filter(j => j.kind === "wardrobe");
      const running = mine.find(j => j.status === "running");
      if (running) followJob(running.id);
      const finished = mine.filter(j => j.status !== "running");
      if (finished.some(j => j.status === "done")) { try { localStorage.removeItem("wa_cache_v20"); } catch {} }
      const failed = finished.find(j => j.status === "failed");
      if (failed) setJobMsg(jobFailureMessage(failed));
      ackJobs(finished.map(j => j.id));
    }).catch(() => setWj({ jobs: [], credits: { item: 0, wardrobe: 0, itemBalance: 0, wardrobeBalance: 0 }, wardrobe: { enoughPieces: false, report: "none", canAdvance: false } }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlementsReady, hasAI]);

  async function performAnalysis() {
    if (analyzing) return;
    setJobMsg(null);
    setAnalyzing(true);
    try {
      const job = await startJob("wardrobe");
      await followJob(job.id);
    } catch (e) {
      setAnalyzing(false);
      setJobMsg(e instanceof Error ? e.message : "Couldn't start the analysis. Nothing was used — please try again.");
      fetchJobs().then(setWj).catch(() => {});
    }
  }
  const credits = wj?.credits.wardrobe ?? 0;
  const promptText = `You have ${credits} wardrobe ${credits === 1 ? "analysis" : "analyses"} available. Perform analysis?`;
  const overlay = <AnalysisOverlay visible={analyzing} stages={WARDROBE_STAGES} />;

  // Tutorial: the bouncing box shows the sample pieces; the account's own come back afterwards.
  const savedPiecesRef = useRef<PieceImg[] | null>(null);
  useEffect(() => {
    if (demo === (savedPiecesRef.current !== null)) return;
    cancelAnimationFrame(rafId.current);
    physicsStarted.current = false;
    if (demo) {
      savedPiecesRef.current = pieces;
      setPieces(Object.entries(SAMPLE_IMAGES).map(([k, image]) => ({ id: `sample-${k}`, image, sub_type: null })));
    } else {
      setPieces(savedPiecesRef.current ?? []);
      savedPiecesRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  // Count-up animation (once)
  useEffect(() => {
    if (!analysis || animStarted.current) return;
    animStarted.current = true;

    setPhase("counting");
    const target   = analysis.score;
    const duration = 700;
    const start    = Date.now();

    function animate() {
      const elapsed = Date.now() - start;
      const t       = Math.min(elapsed / duration, 1);
      const eased   = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(eased * target));
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayScore(target);
        setTimeout(() => setPhase("lifting"),  400);
        setTimeout(() => setPhase("settled"), 1350);
      }
    }
    requestAnimationFrame(animate);
  }, [analysis]);

  // Physics — starts as soon as the rect is rendered (during "counting", behind the blanket).
  // Pieces are already moving when the blanket fades out.
  useEffect(() => {
    if (phase === "loading" || physicsStarted.current || pieces.length === 0) return;

    physicsStarted.current = true;

    function startPhysics() {
      const rect = rectRef.current;
      if (!rect) { requestAnimationFrame(startPhysics); return; }
      const W = rect.offsetWidth;
      const H = rect.offsetHeight;
      if (W === 0 || H === 0) { requestAnimationFrame(startPhysics); return; }

      balls.current = pieces.map((_, i) => {
        const angle = (i / pieces.length) * Math.PI * 2;
        return {
          x: W / 2 + Math.cos(angle) * W * 0.28,
          y: H / 2 + Math.sin(angle) * H * 0.28,
          vx: SPEED * (i % 2 === 0 ? 1 : -1),
          vy: SPEED * (i % 3 === 0 ? 1 : -1),
        };
      });

      // Apply the starting circle positions synchronously, right now, instead of
      // waiting for the first tick() call - otherwise every piece sits at its
      // default left:0/top:0 (stacked together) for a visible moment before
      // jumping out to the circle and starting to move.
      balls.current.forEach((b, i) => {
        const el = imgRefs.current[i];
        if (el) { el.style.left = `${b.x}px`; el.style.top = `${b.y}px`; }
      });

      let lastTime = 0;
      function tick(now: number) {
        const r = rectRef.current;
        if (!r) return;
        const RW = r.offsetWidth;
        const RH = r.offsetHeight;
        const dt = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, 3 / 60);
        lastTime = now;

        balls.current.forEach((b, i) => {
          const el = imgRefs.current[i];
          if (!el) return;
          const pw = el.offsetWidth  || 50;
          const ph = el.offsetHeight || 80;

          b.x += b.vx * dt;
          b.y += b.vy * dt;

          if (b.x <= 0)       { b.x = 0;       b.vx =  Math.abs(b.vx); }
          if (b.x + pw >= RW) { b.x = RW - pw; b.vx = -Math.abs(b.vx); }
          if (b.y <= 0)       { b.y = 0;       b.vy =  Math.abs(b.vy); }
          if (b.y + ph >= RH) { b.y = RH - ph; b.vy = -Math.abs(b.vy); }

          b.vx = SPEED * Math.sign(b.vx);
          b.vy = SPEED * Math.sign(b.vy);

          el.style.left = `${b.x}px`;
          el.style.top  = `${b.y}px`;
        });

        rafId.current = requestAnimationFrame(tick);
      }
      rafId.current = requestAnimationFrame(tick);
    }

    // No artificial startup delay - startPhysics() already polls via
    // requestAnimationFrame until the rect has real layout dimensions, so
    // calling it immediately is just as safe and starts the animation (and
    // applies the initial positions above) as early as possible.
    startPhysics();
    // Nothing to cancel here - the RAF loop itself must survive phase changes,
    // and is cancelled separately (on unmount) below.
  }, [phase, pieces]);

  // Cancel RAF on unmount only
  useEffect(() => () => { cancelAnimationFrame(rafId.current); }, []);

  // After settling, measure whether columns need scroll arrows
  useEffect(() => {
    if (phase !== "settled") return;
    requestAnimationFrame(() => {
      setColAtBot([0, 1].map(i => {
        const el = colScrollRefs.current[i];
        return el ? el.scrollHeight <= el.clientHeight + 8 : true;
      }));
    });
  }, [phase]);

  // ── Loading screen ─────────────────────────────────────────────────────────────

  // Every return is wrapped in ReadyGate (components/ReadyGate.tsx): three dots until the page
  // (piece images included) is fully drawn, then everything at once.
  if (!demo && (phase === "loading" || (!hasAI && !wj && entitlementsReady))) return <>{overlay}<ReadyGate ready={false} /></>;

  // ── Free tier without a purchased report: the purchase prompt, or the lock ─────

  if (!demo && !hasAI && !canView) {
    const enough = !!wj?.wardrobe.enoughPieces;
    return (
      <ReadyGate ready>
      {overlay}
      <main className="center-lift" style={{ minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
        <p style={{ ...FONT, fontSize: 12, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", margin: 0 }}>Wardrobe</p>
        <p style={{ ...FONT, fontSize: 13, color: "#555", maxWidth: 420, lineHeight: 1.6, margin: "10px 0 18px" }}>
          {credits > 0 && enough
            ? promptText
            : credits > 0
            ? `You have ${credits} wardrobe ${credits === 1 ? "analysis" : "analyses"} available. Add a few more pieces first: a wardrobe analysis needs at least 5 items that make a complete outfit (a top, bottoms and shoes).`
            : PAYMENTS_LIVE
            ? "Wardrobe analysis, gap tracking, and leveling all require AI. Upgrade, or buy a Full Wardrobe Analysis, in the MyCloset app."
            : "The wardrobe report isn't available on your account."}
        </p>
        {credits > 0 && enough && (
          <button onClick={performAnalysis} disabled={analyzing} style={{ ...FONT, border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, letterSpacing: ".14em" }}>
            YES
          </button>
        )}
        {jobMsg && <p style={{ ...FONT, fontSize: 11, color: "#c83030", marginTop: 14, maxWidth: 420 }}>{jobMsg}</p>}
      </main>
      </ReadyGate>
    );
  }

  // ── Setup required screen ─────────────────────────────────────────────────────

  if (tableMissing) {
    const sql = `CREATE TABLE IF NOT EXISTS wardrobe_analysis_state (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  analysis_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  crossed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_level    integer NOT NULL DEFAULT 1,
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE wardrobe_analysis_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages wardrobe analysis state"
  ON wardrobe_analysis_state FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');`;
    return (
      <ReadyGate ready>
      <main className="center-lift" style={{ minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <p style={{ ...FONT, fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#c83030", marginBottom: 16 }}>
          Setup Required
        </p>
        <p style={{ ...FONT, fontSize: 14, color: "#444", maxWidth: 520, textAlign: "center", lineHeight: 1.6, marginBottom: 24 }}>
          The wardrobe analysis table hasn&apos;t been created yet. Run this SQL in your Supabase project&apos;s SQL editor, then refresh the page.
        </p>
        <pre style={{ ...FONT, background: "#f4f4f4", padding: "16px 20px", fontSize: 12, lineHeight: 1.7, textAlign: "left", overflowX: "auto", maxWidth: 620, width: "100%", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#222" }}>
          {sql}
        </pre>
        <button onClick={() => router.push("/dashboard")} style={{ ...FONT, marginTop: 28, border: "1px solid #000", padding: "8px 16px", fontSize: 11, background: "none", cursor: "pointer", letterSpacing: ".08em", textTransform: "uppercase" }}>
          {"< BACK"}
        </button>
      </main>
      </ReadyGate>
    );
  }

  // ── Error screen ───────────────────────────────────────────────────────────────

  if (!demo && (error || !analysis)) {
    return (
      <ReadyGate ready>
      <main className="center-lift" style={{ minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <p style={{ ...FONT, fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#c83030" }}>
          {error ?? "No wardrobe found"}
        </p>
        <button onClick={() => router.push("/dashboard")} style={{ ...FONT, marginTop: 20, border: "1px solid #000", padding: "8px 16px", fontSize: 11, background: "none", cursor: "pointer", letterSpacing: ".08em", textTransform: "uppercase" }}>
          {"< BACK"}
        </button>
      </main>
      </ReadyGate>
    );
  }

  // First-run tutorial: the sample report (lib/client/tutorialSamples.ts), nothing crossed off yet
  // — display only.
  const v_crossedGaps = demo ? [] : crossedGaps;
  const v_crossedColors = demo ? [] : crossedColors;
  const v_crossedAesthetics = demo ? [] : crossedAesthetics;
  const v_crossedConIndices = demo ? [] : crossedConIndices;
  const v_ghostCons = demo ? [] : ghostCons;
  const v_gapProgress: Record<string, number> = demo ? {} : gapProgress;
  const v_displayScore = demo ? sampleReport.score : displayScore;
  const a           = demo ? sampleReport : analysis!;
  const isAnimating = phase === "counting" || phase === "lifting";

  const scoreTransform = phase === "counting"
    ? "translate(-50%, -50%) scale(1.67)"
    : "translate(-50%, calc(48px - 30vh)) scale(1)";

  const covColors  = showAllColors    ? a.colors.have    : a.colors.have.slice(0, COLOR_LIMIT);
  const missColors = showAllMissColor ? a.colors.missing : a.colors.missing.slice(0, COLOR_LIMIT);
  const covAes     = showAllAes       ? a.aesthetics.covered : a.aesthetics.covered.slice(0, AES_LIMIT);
  const missAes    = showAllMissAes   ? a.aesthetics.missing : a.aesthetics.missing.slice(0, AES_LIMIT);

  const crossedGapSet = new Set(v_crossedGaps);
  const crossedColorSet = new Set(v_crossedColors);
  const crossedAesSet   = new Set(v_crossedAesthetics);

  const allGapsCrossed   = a.gaps.length === 0 || a.gaps.every(g => crossedGapSet.has(g.description));
  const allColorsCrossed = a.colors.missing.length === 0 || a.colors.missing.every(c => crossedColorSet.has(c));
  const allAesCrossed    = a.aesthetics.missing.length === 0 || a.aesthetics.missing.every(ae => crossedAesSet.has(ae));
  // v_crossedConIndices is already computed via the authoritative isConResolved check
  // (applyState above) — no need to re-derive resolution here.
  const allConsCrossed   = a.cons.length === 0 || a.cons.every((_, i) => v_crossedConIndices.includes(i));

  function gapsLabel()       { return allGapsCrossed       ? "Gaps: Complete"               : `Gaps: Level ${(demo ? 1 : gapsLevel)}`; }
  function colorsLabel()     { return allColorsCrossed     ? "Missing Colors: Complete"     : `Missing Colors: Level ${(demo ? 1 : colorsLevel)}`; }
  function aesLabel()        { return allAesCrossed        ? "Missing Aesthetics: Complete" : `Missing Aesthetics: Level ${(demo ? 1 : aestheticsLevel)}`; }
  function weaknessesLabel() { return allConsCrossed       ? "Weaknesses: Complete"         : `Weaknesses: Level ${(demo ? 1 : weaknessesLevel)}`; }

  // Gaps: split into active vs crossed-in-analysis vs crossed-ghosts (filled, no longer in analysis)
  const crossedInAnalysis = a.gaps.filter(g => crossedGapSet.has(g.description));
  const activeGaps        = a.gaps.filter(g => !crossedGapSet.has(g.description));
  const crossedGhosts     = v_crossedGaps.filter(d => !a.gaps.find(g => g.description === d));

  function makeScrollHandler(idx: number) {
    return (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const isBot = el.scrollHeight <= el.clientHeight + 8 || el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      const isTop = el.scrollTop <= 8;
      setColAtTop(prev => { const arr = [...prev]; arr[idx] = isTop;  return arr; });
      setColAtBot(prev => { const arr = [...prev]; arr[idx] = isBot;  return arr; });
    };
  }

  // ── Main render ────────────────────────────────────────────────────────────────

  return (
    <ReadyGate ready images={pieces.map(p => p.image)}>
    <main style={{ height: "100dvh", overflow: "hidden", background: "#fff" }}>
      <style>{KEYFRAMES}</style>
      {overlay}

      {/* A purchased report whose current level is finished can be taken further with another
          purchase (same prompt as the app). */}
      {!demo && !hasAI && (jobMsg || (wj?.wardrobe.canAdvance && credits > 0)) && (
        <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 30, textAlign: "center", background: "#fff", padding: "6px 14px", maxWidth: "90vw" }}>
          {wj?.wardrobe.canAdvance && credits > 0 && (
            <>
              <p style={{ ...FONT, fontSize: 12, color: "#555", margin: 0 }}>{promptText}</p>
              <button onClick={performAnalysis} disabled={analyzing} style={{ ...FONT, border: "none", background: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: ".14em", marginTop: 4 }}>YES</button>
            </>
          )}
          {jobMsg && <p style={{ ...FONT, fontSize: 11, color: "#c83030", margin: "4px 0 0" }}>{jobMsg}</p>}
        </div>
      )}

      {/* White blanket — covers everything while counting/lifting */}
      {isAnimating && (
        <div style={{
          position: "fixed", inset: 0, background: "#fff", zIndex: 10, pointerEvents: "none",
          opacity: phase === "lifting" ? 0 : 1,
          transition: phase === "lifting" ? "opacity 0.6s ease 0.25s" : "none",
        }} />
      )}

      {/* Score — positioned above the bouncing box */}
      <div style={{
        position: "fixed", top: "30vh", left: "50%",
        transform: scoreTransform,
        transition: "transform 0.72s cubic-bezier(0.4, 0, 0.2, 1)",
        zIndex: 20, pointerEvents: "none",
        color: scoreColor(v_displayScore),
        fontSize: 48, fontWeight: 700, lineHeight: 1, textAlign: "center",
        ...FONT,
      }}>
        {v_displayScore}
      </div>


      {/* Body — centered max-width container. Mobile: three side-by-side columns (each with
          160px of horizontal padding baked in for the desktop reading width) have nowhere
          near enough room on a ~375px phone — they'd squeeze to near-zero and clip. Mobile
          stacks them into one normally-scrolled page instead (see the `mobile` prop on
          ScrollCol above), so the fixed viewport-height + internal-scroll setup below is
          desktop-only; mobile just lets the page grow and scroll naturally. */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        ...(isMobile
          ? { marginTop: HEADER_H }
          : { height: `calc(100vh - ${HEADER_H}px)`, marginTop: HEADER_H }),
      }}>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", width: "100%", minWidth: 0 }}>

          {/* ── LEFT column ── */}
          <ScrollCol
            mobile={isMobile}
            atTop={colAtTop[0]}
            atBot={colAtBot[0]}
            scrollRef={el => { colScrollRefs.current[0] = el; }}
            onScroll={makeScrollHandler(0)}
          >
            {a.pros.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label="Strengths" />
                {a.pros.map((text, i) => <ItemText key={i} text={text} color="#2e7d32" />)}
              </div>
            )}
            {a.colors.have.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label="Covered Colors" />
                {a.colors.have.length <= 2 ? (
                  <div style={{ display: "flex", justifyContent: "center", gap: "0 18px" }}>
                    {covColors.map(c => (
                      <p key={c} style={{ ...FONT, fontSize: 15, color: colorHex(c), margin: 0, textAlign: "center", lineHeight: 1.4 }}>{c}</p>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "center", gap: "10px 16px" }}>
                    {covColors.map(c => (
                      <p key={c} style={{ ...FONT, fontSize: 15, color: colorHex(c), margin: 0, textAlign: "center", lineHeight: 1.4 }}>{c}</p>
                    ))}
                  </div>
                )}
                {a.colors.have.length > COLOR_LIMIT && (
                  <div style={{ marginTop: 10 }}>
                    <ShowMoreBtn showing={showAllColors} total={a.colors.have.length} limit={COLOR_LIMIT} onToggle={() => setShowAllColors(v => !v)} />
                  </div>
                )}
                {/* Newly-covered colors (were missing, now filled by a new piece) */}
                {v_crossedColors.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "6px 14px" }}>
                    {v_crossedColors.map(c => (
                      <p key={c} style={{ ...FONT, fontSize: 15, color: "#ccc", margin: 0, textAlign: "center", textDecoration: "line-through" }}>{c}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(a.aesthetics.covered.length > 0 || v_crossedAesthetics.length > 0) && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label="Covered Aesthetics" />
                {a.aesthetics.covered.length <= 2 && v_crossedAesthetics.length === 0 ? (
                  <div style={{ display: "flex", justifyContent: "center", gap: "0 18px" }}>
                    {covAes.map(({ name, count }) => (
                      <p key={name} style={{ ...FONT, fontSize: 15, color: "#222", margin: 0, textAlign: "center", lineHeight: 1.4 }}>
                        {name}
                        <span style={{ display: "block", fontSize: 10, color: "#bbb" }}>{count}pc</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "center", gap: "10px 16px" }}>
                    {covAes.map(({ name, count }) => (
                      <p key={name} style={{ ...FONT, fontSize: 15, color: "#222", margin: 0, textAlign: "center", lineHeight: 1.4 }}>
                        {name}
                        <span style={{ display: "block", fontSize: 10, color: "#bbb" }}>{count}pc</span>
                      </p>
                    ))}
                    {v_crossedAesthetics.map(a => (
                      <p key={a} style={{ ...FONT, fontSize: 15, color: "#ccc", margin: 0, textAlign: "center", lineHeight: 1.4, textDecoration: "line-through" }}>{a}</p>
                    ))}
                  </div>
                )}
                {a.aesthetics.covered.length > AES_LIMIT && (
                  <div style={{ marginTop: 10 }}>
                    <ShowMoreBtn showing={showAllAes} total={a.aesthetics.covered.length} limit={AES_LIMIT} onToggle={() => setShowAllAes(v => !v)} />
                  </div>
                )}
              </div>
            )}
            {a.insights.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label="Insights" />
                {a.insights.map((text, i) => <ItemText key={i} text={text} color="#555" />)}
              </div>
            )}
          </ScrollCol>

          {/* ── CENTER column — bouncing rectangle ── */}
          <div style={{
            width: isMobile ? "100%" : "clamp(300px, 36vw, 460px)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            alignItems: "stretch",
            padding: isMobile ? "0 24px" : "0 12px",
            paddingTop: isMobile ? 16 : "clamp(16px, 4vh, 48px)",
          }}>
            <div
              ref={rectRef}
              data-tutorial="wardrobe.box"
              data-tut-moving
              style={{
                width: "100%",
                height: isMobile ? "clamp(240px, 42vh, 380px)" : "clamp(340px, 52vh, 500px)",
                border: "1px solid #111",
                position: "relative",
                overflow: "hidden",
                background: "#fafafa",
                flexShrink: 0,
              }}
            >
              {pieces.map((p, i) => (
                <img
                  key={p.id}
                  ref={el => { imgRefs.current[i] = el; }}
                  src={p.image!}
                  alt={p.sub_type ?? ""}
                  draggable={false}
                  style={{
                    position: "absolute",
                    height: 80,
                    width: "auto",
                    objectFit: "contain",
                    left: 0, top: 0,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ))}
            </div>
            <div style={{
              textAlign: "center",
              marginTop: 14,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#999",
              ...FONT,
            }}>
              LEVEL {(demo ? 1 : gapsLevel)}
            </div>

          </div>

          {/* ── RIGHT column ── */}
          <ScrollCol
            mobile={isMobile}
            atTop={colAtTop[1]}
            atBot={colAtBot[1]}
            scrollRef={el => { colScrollRefs.current[1] = el; }}
            onScroll={makeScrollHandler(1)}
          >
            {a.cons.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label={weaknessesLabel()} />
                {a.cons.map((text, i) => {
                  const isDuplicate = v_ghostCons.some(g => g.trim().toLowerCase() === text.trim().toLowerCase());
                  const isCrossed = isDuplicate || v_crossedConIndices.includes(i);
                  if (isCrossed) return null;
                  return <ItemText key={i} text={text} color="#c00" />;
                })}
              </div>
            )}
            <div style={{ marginBottom: 28 }}>
                <SectionLabel label={colorsLabel()} />
                {a.colors.missing.length === 0 && v_crossedColors.length === 0 ? (
                  <p style={{ ...FONT, fontSize: 15, color: "#bbb", margin: 0, textAlign: "center" }}>None</p>
                ) : (() => {
                  const extraCrossed = v_crossedColors.filter(c => !a.colors.missing.includes(c));
                  // A fixed 3-column grid mis-centers when only 1-2 cells are actually
                  // filled (justifyContent centers the whole 3-track structure, not the
                  // content within it) - fall back to a centered flex row in that case,
                  // same fix already used above for covered colors/aesthetics.
                  const total = missColors.length + extraCrossed.length;
                  const items = [
                    ...missColors.map(c => ({ key: c, text: c, crossed: crossedColorSet.has(c) })),
                    ...extraCrossed.map(c => ({ key: `cx-${c}`, text: c, crossed: true })),
                  ];
                  const itemStyle = (crossed: boolean, text: string) => ({
                    ...FONT, fontSize: 15, color: crossed ? "#ccc" : colorHex(text), margin: 0,
                    textAlign: "center" as const, lineHeight: 1.4, textDecoration: crossed ? "line-through" as const : "none" as const,
                  });
                  return total <= 2 ? (
                    <div style={{ display: "flex", justifyContent: "center", gap: "0 18px" }}>
                      {items.map(it => <p key={it.key} style={itemStyle(it.crossed, it.text)}>{it.text}</p>)}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "center", gap: "10px 16px" }}>
                      {items.map(it => <p key={it.key} style={itemStyle(it.crossed, it.text)}>{it.text}</p>)}
                    </div>
                  );
                })()}
                {a.colors.missing.length > COLOR_LIMIT && (
                  <div style={{ marginTop: 10 }}>
                    <ShowMoreBtn showing={showAllMissColor} total={a.colors.missing.length} limit={COLOR_LIMIT} onToggle={() => setShowAllMissColor(v => !v)} />
                  </div>
                )}
              </div>
            <div style={{ marginBottom: 28 }}>
                <SectionLabel label={aesLabel()} />
                {a.aesthetics.missing.length === 0 && v_crossedAesthetics.length === 0 ? (
                  <p style={{ ...FONT, fontSize: 15, color: "#bbb", margin: 0, textAlign: "center" }}>None</p>
                ) : (() => {
                  const extraCrossed = v_crossedAesthetics.filter(ae => !a.aesthetics.missing.includes(ae));
                  // Same fixed-3-column-grid mis-centering fix as missing colors above.
                  const total = missAes.length + extraCrossed.length;
                  const items = [
                    ...missAes.map(name => ({ key: name, text: name, crossed: crossedAesSet.has(name) })),
                    ...extraCrossed.map(ae => ({ key: `cx-${ae}`, text: ae, crossed: true })),
                  ];
                  const itemStyle = (crossed: boolean) => ({
                    ...FONT, fontSize: 15, color: crossed ? "#ccc" : "#222", margin: 0,
                    textAlign: "center" as const, lineHeight: 1.4, textDecoration: crossed ? "line-through" as const : "none" as const,
                  });
                  return total <= 2 ? (
                    <div style={{ display: "flex", justifyContent: "center", gap: "0 18px" }}>
                      {items.map(it => <p key={it.key} style={itemStyle(it.crossed)}>{it.text}</p>)}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "center", gap: "10px 16px" }}>
                      {items.map(it => <p key={it.key} style={itemStyle(it.crossed)}>{it.text}</p>)}
                    </div>
                  );
                })()}
                {a.aesthetics.missing.length > AES_LIMIT && (
                  <div style={{ marginTop: 10 }}>
                    <ShowMoreBtn showing={showAllMissAes} total={a.aesthetics.missing.length} limit={AES_LIMIT} onToggle={() => setShowAllMissAes(v => !v)} />
                  </div>
                )}
              </div>
            <div style={{ marginBottom: 28 }}>
                <SectionLabel label={gapsLabel()} />
                {activeGaps.length === 0 && crossedInAnalysis.length === 0 && crossedGhosts.length === 0 ? (
                  <p style={{ ...FONT, fontSize: 15, color: "#bbb", margin: 0, textAlign: "center" }}>None</p>
                ) : (
                  <>
                    {/* Active gaps — not yet fully resolved */}
                    {activeGaps.map((gap, i) => {
                      const prog = v_gapProgress[gap.description] ?? 0;
                      const isInProgress = prog > 0 && prog < 100;
                      const descColor = isInProgress ? gapProgressColor(prog) : impactColor(gap.impact);
                      return (
                        <div key={i} style={{ marginBottom: 18 }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8 }}>
                            {isInProgress && (
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: descColor, flexShrink: 0 }} />
                            )}
                            <p style={{ ...FONT, fontSize: 17, fontWeight: 600, color: descColor, margin: "0 0 4px", lineHeight: 1.4 }}>
                              {gap.description.charAt(0).toUpperCase() + gap.description.slice(1)}
                            </p>
                            {gap.costPoints > 0 && (
                              <span style={{ ...FONT, fontSize: 12, fontWeight: 700, color: "#1d9e52", whiteSpace: "nowrap" }}>
                                +{gap.costPoints} pts
                              </span>
                            )}
                          </div>
                          <p style={{ ...FONT, fontSize: 17, color: "#555", margin: 0, lineHeight: 1.5 }}>
                            {gap.reason}
                          </p>
                        </div>
                      );
                    })}
                    {/* Crossed gaps still in analysis (filled by newly added item) */}
                    {crossedInAnalysis.map((gap, i) => (
                      <div key={`cxa-${i}`} style={{ marginBottom: 14 }}>
                        <p style={{ ...FONT, fontSize: 17, fontWeight: 600, color: "#ccc", margin: 0, lineHeight: 1.4, textDecoration: "line-through" }}>
                          {gap.description.charAt(0).toUpperCase() + gap.description.slice(1)}
                        </p>
                      </div>
                    ))}
                    {/* Crossed gaps from previous analysis (no longer in current gaps) */}
                    {crossedGhosts.map((desc, i) => (
                      <div key={`cxg-${i}`} style={{ marginBottom: 14 }}>
                        <p style={{ ...FONT, fontSize: 17, fontWeight: 600, color: "#ccc", margin: 0, lineHeight: 1.4, textDecoration: "line-through" }}>
                          {desc.charAt(0).toUpperCase() + desc.slice(1)}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            {a.overdone.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label="Overdone" />
                {a.overdone.map((item, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <p style={{ ...FONT, fontSize: 17, fontWeight: 600, color: "#c88800", margin: "0 0 4px", lineHeight: 1.4 }}>
                      {item.description}{" "}<span style={{ fontWeight: 400, fontSize: 14 }}>×{item.count}</span>
                    </p>
                    <p style={{ ...FONT, fontSize: 17, color: "#111", margin: 0, lineHeight: 1.5 }}>
                      {item.suggestion}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollCol>

        </div>
      </div>
    </main>
    </ReadyGate>
  );
}
