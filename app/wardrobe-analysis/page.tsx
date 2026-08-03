"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { WardrobeAnalysis, WABackendState, CrossedEntry } from "@/lib/wardrobeAnalysis";
import { computeEffectiveLevel, gapTotalProgress } from "@/lib/wardrobeAnalysis";

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
// Progress 1–99 → color spectrum red → orange → yellow → yellow-green
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
  try { const r = localStorage.getItem("wa_cache_v8"); return r ? (JSON.parse(r) as WACache) : null; }
  catch { return null; }
}
function saveWACache(c: WACache): void {
  try { localStorage.setItem("wa_cache_v8", JSON.stringify(c)); } catch {}
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p style={{ ...FONT, fontSize: 16, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", margin: "0 0 14px" }}>
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

function ScrollCol({ atTop, atBot, scrollRef, onScroll, children }: {
  atTop: boolean;
  atBot: boolean;
  scrollRef: (el: HTMLDivElement | null) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

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
  const router = useRouter();
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
  const fetchedRef     = useRef(false);
  const animStarted    = useRef(false);
  const physicsStarted = useRef(false);

  // Fetch analysis — backend state is authoritative; localStorage v7 is a session-level perf cache.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      const sData: { pieceCount?: number; pieces?: PieceImg[] } | null =
        await fetch("/api/scoring").then(r => r.ok ? r.json() : null).catch(() => null);

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
        setCrossedConIndices(atLevel.filter((e: CrossedEntry) => e.category === "con").map((e: CrossedEntry) => Number(e.key)));
        setGapsLevel(effLevel);
        setColorsLevel(effLevel);
        setAestheticsLevel(effLevel);
        setWeaknessesLevel(effLevel);

        // Ghost cons: cons from PREVIOUS levels that were already crossed — shown as greyed strikethrough
        const ghosts: string[] = [];
        for (let L = 1; L < effLevel; L++) {
          const prevA = bs.analysisHistory[L - 1];
          if (!prevA) continue;
          const prevCrossed = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === L);
          prevA.cons.forEach((text, i) => {
            const directlyCrossed = prevCrossed.some((e: CrossedEntry) => e.category === "con" && e.key === String(i));
            const linkedGap = (prevA.conGapLinks ?? {})[String(i)];
            const viaCap = linkedGap ? gapTotalProgress(bs.crossed, linkedGap, L) >= 100 : false;
            if (directlyCrossed || viaCap) ghosts.push(text);
          });
        }
        setGhostCons(ghosts);

        // Score: accumulate from level-1 base score — new level analyses only provide gap/weakness
        // content, their GPT score is never used as the base (it would cause regressions).
        // Diminishing returns: bumps taper as score approaches 100.
        const baseScore = bs.analysisHistory[0]?.score ?? displayA.score;
        let bumpedScore = baseScore;

        function scoreBonus(current: number, pts: number): number {
          if (pts <= 0) return 0;
          const factor = current < 70 ? 1.0 : current < 80 ? 0.7 : current < 90 ? 0.45 : 0.2;
          return Math.max(0, Math.round(pts * factor));
        }

        for (let L = 1; L <= effLevel; L++) {
          const levelA = bs.analysisHistory[L - 1];
          if (!levelA) break;
          const lc = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === L);
          // Gap bumps
          for (const g of levelA.gaps) {
            if (gapTotalProgress(bs.crossed, g.description, L) >= 100) {
              const pts = g.costPoints > 0 ? g.costPoints : g.impact === "high" ? 5 : g.impact === "medium" ? 3 : 2;
              bumpedScore = Math.min(100, bumpedScore + scoreBonus(bumpedScore, pts));
            }
          }
          // Color bumps (unique keys only)
          const lcColKeys = new Set(lc.filter((e: CrossedEntry) => e.category === "color").map((e: CrossedEntry) => e.key));
          bumpedScore = Math.min(100, bumpedScore + scoreBonus(bumpedScore, lcColKeys.size * 2));
          // Aesthetic bumps
          const lcAesKeys = new Set(lc.filter((e: CrossedEntry) => e.category === "aesthetic").map((e: CrossedEntry) => e.key));
          bumpedScore = Math.min(100, bumpedScore + scoreBonus(bumpedScore, lcAesKeys.size));
          // Con bumps
          const lcConCount = lc.filter((e: CrossedEntry) => e.category === "con").length;
          bumpedScore = Math.min(100, bumpedScore + scoreBonus(bumpedScore, lcConCount * 2));
        }
        // High-water mark: score can never go below the previous highest it reached
        if (bs.highestScore && bs.highestScore > bumpedScore) bumpedScore = bs.highestScore;
        // Persist the new high-water mark back into the state so it survives level transitions
        if (!bs.highestScore || bumpedScore > bs.highestScore) bs.highestScore = bumpedScore;
        setAnalysis({ ...displayA, score: bumpedScore });
      }

      // Helper: run fresh GPT analysis, passing prior history so repeats are excluded
      async function fetchFreshAnalysis(priorAnalyses: WardrobeAnalysis[] = []): Promise<WardrobeAnalysis> {
        return fetch("/api/wardrobe/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priorAnalyses }),
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
          const atL = bs.crossed.filter((e: CrossedEntry) => e.analysisLevel === effLevel);
          const allResolved =
            (displayA.gaps.length === 0 || displayA.gaps.every(g => gapTotalProgress(bs.crossed, g.description, effLevel) >= 100)) &&
            (displayA.cons.length === 0 || displayA.cons.every((_, i) => {
              if (atL.some((e: CrossedEntry) => e.category === "con" && e.key === String(i))) return true;
              const linkedGap = (displayA.conGapLinks ?? {})[String(i)];
              return linkedGap ? gapTotalProgress(bs.crossed, linkedGap, effLevel) >= 100 : false;
            })) &&
            (displayA.colors.missing.length === 0 || displayA.colors.missing.every(c => atL.some((e: CrossedEntry) => e.category === "color" && e.key === c))) &&
            (displayA.aesthetics.missing.length === 0 || displayA.aesthetics.missing.every(ae => atL.some((e: CrossedEntry) => e.category === "aesthetic" && e.key === ae)));
          if (!allResolved) { applyState(bs, effLevel, displayA); return; }
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

        // Advance to next level only when ALL categories are fully resolved at this level
        const _atL = state.crossed.filter((e: CrossedEntry) => e.analysisLevel === effLevel);
        const allCrossed = displayA &&
          (displayA.gaps.length === 0 || displayA.gaps.every(g => gapTotalProgress(state.crossed, g.description, effLevel) >= 100)) &&
          (displayA.cons.length === 0 || displayA.cons.every((_, i) => {
            if (_atL.some((e: CrossedEntry) => e.category === "con" && e.key === String(i))) return true;
            const linkedGap = (displayA.conGapLinks ?? {})[String(i)];
            return linkedGap ? gapTotalProgress(state.crossed, linkedGap, effLevel) >= 100 : false;
          })) &&
          (displayA.colors.missing.length === 0 || displayA.colors.missing.every(c => _atL.some((e: CrossedEntry) => e.category === "color" && e.key === c))) &&
          (displayA.aesthetics.missing.length === 0 || displayA.aesthetics.missing.every(ae => _atL.some((e: CrossedEntry) => e.category === "aesthetic" && e.key === ae)));

        if (allCrossed) {
          // All current-level items crossed — fetch fresh analysis for the next level.
          // Pass prior history so GPT finds NEW gaps/aesthetics/colors/weaknesses, not repeats.
          const freshA = await fetchFreshAnalysis(state.analysisHistory);
          const newState: WABackendState = {
            analysisHistory: [...state.analysisHistory, freshA],
            crossed:         state.crossed,
            currentLevel:    state.currentLevel + 1,
            highestScore:    state.highestScore,  // carried forward
          };
          const newEffLevel = state.currentLevel + 1;
          fetch("/api/wardrobe/state", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newState),
          }).catch(() => {});
          applyState(newState, newEffLevel, freshA);
          saveWACache({ pieceCount: currentCount, backendState: newState });
        } else {
          applyState(state, effLevel, displayA);
          saveWACache({ pieceCount: currentCount, backendState: state });
        }
      } else if (fetchFailed && cache?.backendState?.analysisHistory?.length) {
        // Backend fetch failed (network error / auth / server error) but localStorage has
        // valid state — use it rather than wiping everything with a fresh analysis.
        // This prevents accidental state resets on transient backend failures.
        const bs = cache.backendState;
        const effLevel = computeEffectiveLevel(bs.analysisHistory, bs.crossed, bs.currentLevel);
        const displayA = bs.analysisHistory[effLevel - 1];
        if (displayA) {
          applyState(bs, effLevel, displayA);
          saveWACache({ pieceCount: currentCount, backendState: bs });
        }
      } else {
        // No state anywhere — first-time analysis (or intentional reset)
        const freshA = await fetchFreshAnalysis();
        const newState: WABackendState = {
          analysisHistory: [freshA],
          crossed:         [],
          currentLevel:    1,
        };
        fetch("/api/wardrobe/state", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newState),
        }).catch(() => {});
        applyState(newState, 1, freshA);
        saveWACache({ pieceCount: currentCount, backendState: newState });
      }
    })().catch((err: unknown) => {
      setError(typeof err === "string" ? err : "Failed to load");
      setPhase("settled");
    });
  }, []);

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

    const t = setTimeout(startPhysics, 50);
    // Only cancel the startup delay — the RAF itself must survive phase changes
    return () => { clearTimeout(t); };
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

  if (phase === "loading") {
    return (
      <main style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <style>{KEYFRAMES}</style>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 160 }}>
          <img src={LOADING_IMG} alt="" draggable={false} style={{ width: 270, height: 340, objectFit: "contain", opacity: 0.88 }} />
          <div style={{ width: 190, height: 5, background: "#e8e8e8", overflow: "hidden", marginTop: -88 }}>
            <div style={{ height: "100%", background: "#111", animation: "loadbar 8s ease-out forwards" }} />
          </div>
        </div>
      </main>
    );
  }

  // ── Setup required screen ─────────────────────────────────────────────────────

  if (tableMissing) {
    const sql = `CREATE TABLE IF NOT EXISTS wardrobe_analysis_state (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  crossed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_level    integer NOT NULL DEFAULT 1,
  updated_at       timestamptz DEFAULT now()
);
ALTER TABLE wardrobe_analysis_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own wardrobe analysis state"
  ON wardrobe_analysis_state FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`;
    return (
      <main style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
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
          ← BACK
        </button>
      </main>
    );
  }

  // ── Error screen ───────────────────────────────────────────────────────────────

  if (error || !analysis) {
    return (
      <main style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <p style={{ ...FONT, fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#c83030" }}>
          {error ?? "No wardrobe found"}
        </p>
        <button onClick={() => router.push("/dashboard")} style={{ ...FONT, marginTop: 20, border: "1px solid #000", padding: "8px 16px", fontSize: 11, background: "none", cursor: "pointer", letterSpacing: ".08em", textTransform: "uppercase" }}>
          ← BACK
        </button>
      </main>
    );
  }

  const a           = analysis;
  const isAnimating = phase === "counting" || phase === "lifting";

  const scoreTransform = phase === "counting"
    ? "translate(-50%, -50%) scale(1.67)"
    : "translate(-50%, calc(48px - 30vh)) scale(1)";

  const covColors  = showAllColors    ? a.colors.have    : a.colors.have.slice(0, COLOR_LIMIT);
  const missColors = showAllMissColor ? a.colors.missing : a.colors.missing.slice(0, COLOR_LIMIT);
  const covAes     = showAllAes       ? a.aesthetics.covered : a.aesthetics.covered.slice(0, AES_LIMIT);
  const missAes    = showAllMissAes   ? a.aesthetics.missing : a.aesthetics.missing.slice(0, AES_LIMIT);

  const crossedGapSet = new Set(crossedGaps);
  const crossedColorSet = new Set(crossedColors);
  const crossedAesSet   = new Set(crossedAesthetics);

  const allGapsCrossed   = a.gaps.length === 0 || a.gaps.every(g => crossedGapSet.has(g.description));
  const allColorsCrossed = a.colors.missing.length === 0 || a.colors.missing.every(c => crossedColorSet.has(c));
  const allAesCrossed    = a.aesthetics.missing.length === 0 || a.aesthetics.missing.every(ae => crossedAesSet.has(ae));
  const allConsCrossed   = a.cons.length === 0 || a.cons.every((_, i) =>
    crossedConIndices.includes(i) || ((a.conGapLinks ?? {})[String(i)] ? crossedGapSet.has((a.conGapLinks ?? {})[String(i)]) : false)
  );

  function gapsLabel()       { return allGapsCrossed       ? "Gaps: Complete"               : `Gaps: Level ${gapsLevel}`; }
  function colorsLabel()     { return allColorsCrossed     ? "Missing Colors: Complete"     : `Missing Colors: Level ${colorsLevel}`; }
  function aesLabel()        { return allAesCrossed        ? "Missing Aesthetics: Complete" : `Missing Aesthetics: Level ${aestheticsLevel}`; }
  function weaknessesLabel() { return allConsCrossed       ? "Weaknesses: Complete"         : `Weaknesses: Level ${weaknessesLevel}`; }

  // Gaps: split into active vs crossed-in-analysis vs crossed-ghosts (filled, no longer in analysis)
  const crossedInAnalysis = a.gaps.filter(g => crossedGapSet.has(g.description));
  const activeGaps        = a.gaps.filter(g => !crossedGapSet.has(g.description));
  const crossedGhosts     = crossedGaps.filter(d => !a.gaps.find(g => g.description === d));

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
    <main style={{ height: "100vh", overflow: "hidden", background: "#fff" }}>
      <style>{KEYFRAMES}</style>

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
        color: scoreColor(displayScore),
        fontSize: 48, fontWeight: 700, lineHeight: 1, textAlign: "center",
        ...FONT,
      }}>
        {displayScore}
      </div>


      {/* Body — centered max-width container */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        height: `calc(100vh - ${HEADER_H}px)`,
        marginTop: HEADER_H,
      }}>
        <div style={{ display: "flex", width: "100%", minWidth: 0 }}>

          {/* ── LEFT column ─────────────────────────────────────────────────────── */}
          <ScrollCol
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
                      <p key={c} style={{ ...FONT, fontSize: 15, color: colorHex(c), margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word" }}>{c}</p>
                    ))}
                  </div>
                )}
                {a.colors.have.length > COLOR_LIMIT && (
                  <div style={{ marginTop: 10 }}>
                    <ShowMoreBtn showing={showAllColors} total={a.colors.have.length} limit={COLOR_LIMIT} onToggle={() => setShowAllColors(v => !v)} />
                  </div>
                )}
                {/* Newly-covered colors (were missing, now filled by a new piece) */}
                {crossedColors.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "6px 14px" }}>
                    {crossedColors.map(c => (
                      <p key={c} style={{ ...FONT, fontSize: 15, color: "#ccc", margin: 0, textAlign: "center", textDecoration: "line-through" }}>{c}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(a.aesthetics.covered.length > 0 || crossedAesthetics.length > 0) && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label="Covered Aesthetics" />
                {a.aesthetics.covered.length <= 2 && crossedAesthetics.length === 0 ? (
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
                      <p key={name} style={{ ...FONT, fontSize: 15, color: "#222", margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word" }}>
                        {name}
                        <span style={{ display: "block", fontSize: 10, color: "#bbb" }}>{count}pc</span>
                      </p>
                    ))}
                    {crossedAesthetics.map(a => (
                      <p key={a} style={{ ...FONT, fontSize: 15, color: "#ccc", margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word", textDecoration: "line-through" }}>{a}</p>
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

          {/* ── CENTER column — bouncing rectangle ──────────────────────────── */}
          <div style={{
            width: "clamp(300px, 36vw, 460px)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            alignItems: "stretch",
            padding: "0 12px",
            paddingTop: "clamp(16px, 4vh, 48px)",
          }}>
            <div
              ref={rectRef}
              style={{
                width: "100%",
                height: "clamp(340px, 52vh, 500px)",
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
              LEVEL {gapsLevel}
            </div>

          </div>

          {/* ── RIGHT column ────────────────────────────────────────────────────── */}
          <ScrollCol
            atTop={colAtTop[1]}
            atBot={colAtBot[1]}
            scrollRef={el => { colScrollRefs.current[1] = el; }}
            onScroll={makeScrollHandler(1)}
          >
            {(a.cons.length > 0 || ghostCons.length > 0) && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel label={weaknessesLabel()} />
                {/* Ghost cons from fully-completed prior levels */}
                {ghostCons.map((text, i) => (
                  <p key={`gc-${i}`} style={{ ...FONT, fontSize: 17, color: "#ccc", margin: "0 0 12px", lineHeight: 1.5, textDecoration: "line-through" }}>{text}</p>
                ))}
                {/* Current level cons */}
                {a.cons.map((text, i) => {
                  const linkedGap = (a.conGapLinks ?? {})[String(i)];
                  const isCrossed =
                    crossedConIndices.includes(i) ||
                    (linkedGap ? crossedGapSet.has(linkedGap) : false);
                  return isCrossed
                    ? <p key={i} style={{ ...FONT, fontSize: 17, color: "#ccc", margin: "0 0 12px", lineHeight: 1.5, textDecoration: "line-through" }}>{text}</p>
                    : <ItemText key={i} text={text} color="#c00" />;
                })}
              </div>
            )}
            <div style={{ marginBottom: 28 }}>
                <SectionLabel label={colorsLabel()} />
                {a.colors.missing.length === 0 && crossedColors.length === 0 ? (
                  <p style={{ ...FONT, fontSize: 15, color: "#bbb", margin: 0, textAlign: "center" }}>None</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "center", gap: "10px 16px" }}>
                    {missColors.map(c => {
                      const isCrossed = crossedColorSet.has(c);
                      return (
                        <p key={c} style={{ ...FONT, fontSize: 15, color: isCrossed ? "#ccc" : colorHex(c), margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word", textDecoration: isCrossed ? "line-through" : "none" }}>{c}</p>
                      );
                    })}
                    {crossedColors.filter(c => !a.colors.missing.includes(c)).map(c => (
                      <p key={`cx-${c}`} style={{ ...FONT, fontSize: 15, color: "#ccc", margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word", textDecoration: "line-through" }}>{c}</p>
                    ))}
                  </div>
                )}
                {a.colors.missing.length > COLOR_LIMIT && (
                  <div style={{ marginTop: 10 }}>
                    <ShowMoreBtn showing={showAllMissColor} total={a.colors.missing.length} limit={COLOR_LIMIT} onToggle={() => setShowAllMissColor(v => !v)} />
                  </div>
                )}
              </div>
            <div style={{ marginBottom: 28 }}>
                <SectionLabel label={aesLabel()} />
                {a.aesthetics.missing.length === 0 && crossedAesthetics.length === 0 ? (
                  <p style={{ ...FONT, fontSize: 15, color: "#bbb", margin: 0, textAlign: "center" }}>None</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", justifyContent: "center", gap: "10px 16px" }}>
                    {missAes.map(name => {
                      const isCrossed = crossedAesSet.has(name);
                      return (
                        <p key={name} style={{ ...FONT, fontSize: 15, color: isCrossed ? "#ccc" : "#222", margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word", textDecoration: isCrossed ? "line-through" : "none" }}>{name}</p>
                      );
                    })}
                    {crossedAesthetics.filter(ae => !a.aesthetics.missing.includes(ae)).map(ae => (
                      <p key={`cx-${ae}`} style={{ ...FONT, fontSize: 15, color: "#ccc", margin: 0, textAlign: "center", lineHeight: 1.4, wordBreak: "break-word", textDecoration: "line-through" }}>{ae}</p>
                    ))}
                  </div>
                )}
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
                      const prog = gapProgress[gap.description] ?? 0;
                      const isInProgress = prog > 0 && prog < 100;
                      const descColor = isInProgress ? gapProgressColor(prog) : impactColor(gap.impact);
                      return (
                        <div key={i} style={{ marginBottom: 18 }}>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8 }}>
                            {isInProgress && (
                              <span style={{ fontSize: 10, color: descColor, lineHeight: 1, marginBottom: 1, flexShrink: 0 }}>●</span>
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
  );
}
