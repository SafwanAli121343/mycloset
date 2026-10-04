"use client";
import { PAYMENTS_LIVE } from "@/lib/client/paidFeatures";
import { peekCache, rememberCache, invalidateClientCache } from "@/lib/clientCache";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { useEntitlements } from "@/contexts/EntitlementsContext";
import { ReadyGate } from "@/components/ReadyGate";
import { describeColorPairing } from "@/lib/colorTheory";
import { KNOWN_AESTHETICS } from "@/lib/constants/attributes";
import { MobileScrollFade } from "@/components/MobileScrollFade";
import { TAB_BAR_H } from "@/components/MobileTabBar";
import { AnalysisOverlay } from "@/components/AnalysisOverlay";
import { useTutorialDemo } from "@/lib/client/tutorialState";
import { sampleCloset, SAMPLE_IMAGES } from "@/lib/client/tutorialSamples";
import {
  fetchJobs, startJob, waitForJob, ackJobs, jobFailureMessage, ITEM_STAGES, type JobsStatus,
} from "@/lib/client/analysisJobs";

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#ccc";
  if (score >= 75) return "#1d9e52";
  if (score >= 50) return "#c88800";
  return "#c83030";
}

const LOADING_IMG = "/loading-tee.png";

const ANIMATIONS = `
  @keyframes slideOutLeft {
    from { transform: translateX(0); }
    to   { transform: translateX(-400%); }
  }
  @keyframes slideOutRight {
    from { transform: translateX(0); }
    to   { transform: translateX(400%); }
  }
  @keyframes slideInFromRight {
    from { transform: translateX(400%); }
    to   { transform: translateX(0); }
  }
  @keyframes slideInFromLeft {
    from { transform: translateX(-400%); }
    to   { transform: translateX(0); }
  }
  @keyframes loadbar {
    0%  { width: 0% }
    55% { width: 65% }
    80% { width: 84% }
    100%{ width: 93% }
  }
  .closet-panel-scroll::-webkit-scrollbar { display: none; }
`;

type Garment = {
  id: string;
  title: string;
  brand: string | null;
  sub_type: string | null;
  material: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  category: string | null;
  image: string | null;
  price: string | null;
  pros: string[] | null;
  cons: string[] | null;
  color_pairings: string[] | null;
  color_clashes: string[] | null;
  style_pairings: string[] | null;
  aesthetic_tags?: string[] | null;
  // AI analysis paid for with a one-time purchase — visible on free tier (score stays Pro-only).
  ai_unlocked?: boolean;
};

type EditState = {
  id: string;
  title: string;
  brand: string;
  color_primary: string;
  category: string;
  aesthetic: string;
};
// PATCH body — `aesthetic` is the manual-aesthetic field the server stores as aesthetic_tags.
type EditUpdate = Partial<Garment> & { aesthetic?: string };

const EDIT_CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];

function EditModal({ initial, onSave, onClose }: {
  initial: EditState;
  onSave: (updated: EditUpdate) => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<EditState>(initial);
  const [saving,   setSaving]   = useState(false);
  const [saveDone, setSaveDone] = useState(false);

  function set(key: keyof EditState, val: string) {
    setFields(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    setSaving(true);
    await onSave({
      title:         fields.title.trim()         || undefined,
      brand:         fields.brand.trim()         || null,
      color_primary: fields.color_primary.trim() || null,
      category:      fields.category             || undefined,
      // Only sent when changed, so saving other fields never touches an AI-derived aesthetic.
      ...(fields.aesthetic !== initial.aesthetic ? { aesthetic: fields.aesthetic.trim() } : {}),
    });
    setSaving(false);
    setSaveDone(true);
    setTimeout(() => onClose(), 2000);
  }



  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        paddingBottom: "8vh",
      }}
    >
      <div style={{
        background: "#fff", padding: "36px 40px 28px", width: 360, maxWidth: "90vw",
        position: "relative",
      }}>

        {/* close icon - SVG, not a text glyph, so it renders identically on every device/platform */}
        <button onClick={onClose} style={{
          position: "absolute", top: 14, right: 18,
          background: "none", border: "none", cursor: "pointer",
          lineHeight: 1,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1L11 11M11 1L1 11" stroke="#bbb" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>

        {/* Input rows — hint floats right on the bar, always visible */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {([
            { key: "title",         hint: "Title"         },
            { key: "brand",         hint: "Brand"         },
            { key: "color_primary", hint: "Primary Color" },
            { key: "aesthetic",     hint: "Aesthetic"     },
          ] as { key: keyof EditState; hint: string }[]).map(({ key, hint }) => (
            <div key={key} style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
              <input
                value={fields[key]}
                onChange={e => set(key, e.target.value)}
                list={key === "aesthetic" ? "edit-aesthetic-options" : undefined}
                style={{
                  width: "100%", border: "none", padding: "7px 90px 7px 0",
                  fontSize: 12, outline: "none", background: "transparent",
                  boxSizing: "border-box", ...FONT,
                }}
              />
              <span style={{
                position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
                fontSize: 12, color: "#ccc", pointerEvents: "none", ...FONT,
              }}>
                {hint}
              </span>
            </div>
          ))}
        </div>

        <datalist id="edit-aesthetic-options">
          {KNOWN_AESTHETICS.map(a => <option key={a} value={a} />)}
        </datalist>

        {/* Category + Cancel/Save */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", marginBottom: 0 }}>
            {EDIT_CATEGORIES.map(c => (
              <button key={c} onClick={() => set("category", c)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                fontWeight: fields.category === c ? 700 : 400,
                color: fields.category === c ? "#111" : "#bbb", ...FONT,
              }}>
                {c}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: saveDone ? "center" : "space-between", alignItems: "center" }}>
            {saveDone ? (
              <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const,
                color: "#1d9e52", position: "relative", top: 9, ...FONT }}>DONE!</span>
            ) : (
              <>
                <button
                  onClick={onClose}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                    color: "#c83030", padding: 0, ...FONT,
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: "none", border: "none",
                    cursor: saving ? "default" : "pointer",
                    fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                    color: saving ? "#aaa" : "#1d9e52", padding: 0, ...FONT,
                  }}
                >
                  {saving ? "SAVING..." : "SAVE"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type Phase = "idle" | "out" | "in";

const FONT = { fontFamily: "Arial, sans-serif" };

// Responsive compression: the bottom action bar has a sane min/max height so it
// stays readable and never gets squeezed to nothing, and the closet illustration
// caps itself to whatever's left after that bar (plus a little breathing room)
// instead of a flat 82vh that can overflow a short viewport and clip the bar
// below it (the "EDIT/REMOVE cut off on smaller screens" case).
const BOTTOM_BAR_H = "clamp(64px, 9vh, 96px)";
const CLOSET_IMG_H = `min(82vh, calc(100vh - ${BOTTOM_BAR_H} - 24px))`;
const CLOSET_IMG_H_EMPTY = "min(82vh, calc(100vh - 60px))";


function Arrow({ dir, onClick, disabled, small }: { dir: "left" | "right"; onClick: () => void; disabled?: boolean; small?: boolean }) {
  const w = small ? 12 : 20, h = small ? 17 : 28;
  const points = dir === "left" ? `${w},0 0,${h / 2} ${w},${h}` : `0,0 ${w},${h / 2} 0,${h}`;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none", border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: small ? "0 10px" : "0 20px", flexShrink: 0,
        opacity: disabled ? 0.2 : 1,
      }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polygon points={points} fill="#111" />
      </svg>
    </button>
  );
}

type PanelSection = {
  label: string;
  items: string[];
  color: string;
  emptyText?: string;
};

// Same scroll-fade + click-to-scroll-arrow system used in wardrobe-analysis/page.tsx's
// ScrollCol and preview/PreviewClient.tsx's SlideCard: a top fade appears once scrolled
// past the top, a bottom fade + clickable chevron appears while more content remains
// below (the chevron flips to "back to top" once at the bottom).
function SidePanel({ sections, side = "right", spacerHeight = "20vh" }: { sections: PanelSection[]; side?: "left" | "right"; spacerHeight?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBot, setAtBot] = useState(false);

  function updateEdges() {
    const el = scrollRef.current;
    if (!el) return;
    const isBot = el.scrollHeight <= el.clientHeight + 8 || el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    const isTop = el.scrollTop <= 8;
    setAtBot(isBot);
    setAtTop(isTop);
  }

  useLayoutEffect(() => { updateEdges(); });

  const visible = sections.filter(s => s.items.length > 0 || !!s.emptyText);
  if (!visible.length) return <div style={{ flex: 1 }} />;

  return (
    <div style={{ flex: 1, alignSelf: "stretch", position: "relative", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div style={{ height: spacerHeight, flexShrink: 0 }} />

      <div
        ref={scrollRef}
        onScroll={updateEdges}
        className="closet-panel-scroll"
        style={{
          flex: 1, overflowY: "auto", scrollbarWidth: "none",
          textAlign: "center", paddingBottom: 40, minHeight: 0,
          paddingLeft: 12, paddingRight: 12,
        }}
      >
        {visible.map((s, si) => (
          <div key={si} style={{ marginBottom: si < visible.length - 1 ? 28 : 0 }}>
            <p style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14, ...FONT }}>
              {s.label}
            </p>
            {s.items.length > 0
              ? s.items.map((text, i) => (
                  <p key={i} style={{ fontSize: 17, color: s.color, marginBottom: 10, lineHeight: 1.5, ...FONT }}>
                    {text.replace(/ — /g, ": ")}
                  </p>
                ))
              : <p style={{ fontSize: 17, color: "#bbb", ...FONT }}>{s.emptyText}</p>
            }
          </div>
        ))}
      </div>

      {/* Top fade - appears after the user scrolls down */}
      <div style={{
        position: "absolute", top: spacerHeight, left: 0, right: 0, height: 50,
        background: "linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)",
        pointerEvents: "none",
        opacity: atTop ? 0 : 1,
        transition: "opacity 0.3s ease",
      }} />

      {/* Bottom fade + flip arrow */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, pointerEvents: "none" }}>
        <div style={{
          height: 90, width: "100%",
          background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 55%)",
          opacity: atBot ? 0 : 1,
          transition: "opacity 0.3s ease",
        }} />
        <div
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            atBot ? el.scrollTo({ top: 0, behavior: "smooth" }) : el.scrollBy({ top: 220, behavior: "smooth" });
          }}
          style={{
            background: "#fff", width: "100%", display: "flex", justifyContent: "center",
            paddingTop: 4, paddingBottom: 12,
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

// Free tier gets only what the free plan includes: Pairs With (the pairings route's non-AI
// color/aesthetic match for free users) and Colors from the deterministic color rules. No
// score, Pros, Cons or Avoid — those are Pro/AI, and their headers over "analyzing…"/"none"
// read as broken for an item that will never be analyzed. Same as the app's Closet.
function freeSections(item: { color_primary?: string | null }, pairings: string[]): PanelSection[] {
  const colorMatches = item.color_primary ? describeColorPairing(item.color_primary) : [];
  return [
    { label: "PAIRS WITH", items: pairings, color: "#555", emptyText: "nothing in your wardrobe pairs well with this yet — add more items" },
    ...(colorMatches.length ? [{ label: "COLORS", items: [colorMatches.join(" · ")], color: "#555" }] : []),
  ];
}

export default function ClosetPage() {
  const { hasAI, ready: entitlementsReady, refresh: refreshEntitlements } = useEntitlements();
  const router = useRouter();
  const isMobile = useIsMobile();
  // Stale-while-revalidate (lib/clientCache.ts): a revisit opens instantly with the last list.
  const [garments, setGarments] = useState<Garment[]>(() => peekCache<Garment[]>("/api/garments") ?? []);
  const [index, setIndex]       = useState(0);
  const [phase, setPhase]       = useState<Phase>("idle");
  const [dir, setDir]           = useState<"left" | "right">("right");
  const [animKey, setAnimKey]   = useState(0);
  const [loading, setLoading]   = useState(() => !peekCache("/api/garments"));
  const [loadError, setLoadError] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [freshPairings, setFreshPairings] = useState<Record<string, string[] | null>>({});
  const [editItem, setEditItem] = useState<EditState | null>(null);
  const [scores, setScores]     = useState<Record<string, number>>(() => peekCache<Record<string, number>>("closet:scores") ?? {});
  // sub_type.toLowerCase() → suggestion text from WA analysis overdone array
  const [overdoneMap, setOverdoneMap] = useState<Record<string, string>>({});

  // First-run tutorial: the sample closet (lib/client/tutorialSamples.ts) in place of this
  // account's own — usually still empty for a new account. Display only; never cached or saved.
  const demo = useTutorialDemo();
  // Free-only release: the samples show what this account gets — no AI.
  const sample = useMemo(() => {
    const c = sampleCloset(SAMPLE_IMAGES);
    return PAYMENTS_LIVE || hasAI ? c : { ...c, garments: c.garments.map(g => ({ ...g, ai_unlocked: false })) };
  }, [hasAI]);
  const shownGarments = demo ? (sample.garments as unknown as Garment[]) : garments;
  const shownScores = demo ? sample.scores : scores;
  // Purchased "Use score?" (free tier) — same flow as the app's Closet (lib/client/analysisJobs.ts).
  const [jobs, setJobs] = useState<JobsStatus | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

  const busy = useRef(false);
  const refreshedRef   = useRef<Set<string>>(new Set());
  const preloadedRef   = useRef<Set<string>>(new Set());

  function preloadAround(list: Garment[], center: number) {
    // Preload the center image + 2 ahead + 1 behind so navigation is instant
    const indices = [-1, 0, 1, 2].map(d => (center + d + list.length) % list.length);
    for (const i of indices) {
      const url = list[i]?.image;
      if (!url || preloadedRef.current.has(url)) continue;
      preloadedRef.current.add(url);
      const img = new Image();
      img.src = url;
    }
  }

  useEffect(() => {
    let cancelled = false;

    // Scoring is fetched on its own, outside the main Promise.all, with its own cold-start
    // retry budget — previously a failed/slow /api/scoring response was swallowed via
    // .catch(() => null) inside the same Promise.all as /api/garments, so it never triggered
    // the outer retry-with-backoff below (that only re-runs on a /api/garments failure) and
    // every item's score was stuck missing until a full page reload gave it a fresh attempt.
    async function loadScores() {
      for (const delay of [0, 1500, 3000, 5000]) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (cancelled) return;
        try {
          // skipOutfits=1: only pieces[].score is read here — the full response also runs the
          // expensive whole-wardrobe outfit search (topOutfits), which the app already skips.
          const res = await fetch("/api/scoring?skipOutfits=1");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const scoringData = await res.json();
          if (cancelled) return;
          if (scoringData?.pieces) {
            const map: Record<string, number> = {};
            for (const p of scoringData.pieces) map[p.id] = p.score;
            setScores(map);
            rememberCache("closet:scores", map);
          }
          return;
        } catch { /* retry */ }
      }
    }

    async function load(attempt: number) {
      try {
        const [data, waState] = await Promise.all([
          fetch("/api/garments").then(r => {
            if (r.status === 401) { router.push("/sign-in"); return null; }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          }),
          fetch("/api/wardrobe/state").then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (cancelled) return;
        if (data === null) return; // redirecting to sign-in

        if (waState?.analysisHistory?.length && waState.currentLevel >= 1) {
          const level = Math.max(1, Math.min(waState.currentLevel, waState.analysisHistory.length));
          const analysis = waState.analysisHistory[level - 1];
          // Re-check against the CURRENT wardrobe (data, just fetched) rather than the
          // frozen count from whenever this level's analysis was generated - an entry
          // stops showing the moment its actual sub-type count drops back below the
          // overdone threshold (3+), independent of levels/scoring.
          const liveSubTypeCounts: Record<string, number> = {};
          for (const g of (data as Garment[])) {
            if (g.sub_type) liveSubTypeCounts[g.sub_type] = (liveSubTypeCounts[g.sub_type] ?? 0) + 1;
          }
          const omap: Record<string, string> = {};
          for (const o of (analysis?.overdone ?? [])) {
            if ((liveSubTypeCounts[o.description] ?? 0) >= 3) {
              omap[o.description.toLowerCase()] = o.suggestion;
            }
          }
          setOverdoneMap(omap);
        }

        setGarments(data);
        setLoading(false);
        preloadAround(data, 0);
        const seed: Record<string, string[]> = {};
        for (const g of data) {
          seed[g.id] = g.style_pairings ?? [];
          if (g.style_pairings?.length) {
            refreshedRef.current.add(g.id);
          }
        }
        setFreshPairings(seed);
      } catch {
        if (cancelled) return;
        // Retry with backoff before giving up — a dev-server cold start (or a transient
        // network blip) on /api/garments used to go straight to "COULDN'T LOAD YOUR CLOSET"
        // and require a manual page reload for something that often resolves on its own a
        // few seconds later, same as the native app's wardrobe/calendar screens.
        const delays = [1500, 3000, 5000];
        if (attempt < delays.length) {
          setTimeout(() => load(attempt + 1), delays[attempt]);
          return;
        }
        setLoadError(true);
        setLoading(false);
      }
    }

    load(0);
    loadScores();
    return () => { cancelled = true; };
  }, [router]);

  // Keep the shared cache in step with every change to the list (load, delete, edit), so a revisit
  // never resurrects a deleted item; a changed wardrobe also invalidates what's derived from it.
  const prevGarmentsJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const json = JSON.stringify(garments.map(g => [g.id, g.color_primary, g.category, g.sub_type]));
    if (prevGarmentsJsonRef.current !== null && prevGarmentsJsonRef.current !== json) {
      invalidateClientCache("outfits:"); invalidateClientCache("closet:scores");
    }
    prevGarmentsJsonRef.current = json;
    rememberCache("/api/garments", garments);
  }, [garments, loading]);

  // Poll for analysis data on garments that were just added (pros === null means analysis pending)
  useEffect(() => {
    // Free-tier items are never AI-analyzed (pros stays null by design) — nothing to wait for.
    if (!hasAI) return;
    const pending = garments.filter(g => g.pros === null);
    if (pending.length === 0) return;
    const timer = setTimeout(async () => {
      try {
        const fresh = await fetch("/api/garments").then(r => r.ok ? r.json() : null);
        if (fresh) setGarments(fresh);
      } catch {}
    }, 3500);
    return () => clearTimeout(timer);
  }, [garments]);

  useEffect(() => {
    const item = garments[index];
    if (!item || refreshedRef.current.has(item.id)) return;
    refreshedRef.current.add(item.id);
    // Silent background fetch — no loading state, no "PAIRS WITH ·" spinner
    fetch(`/api/garments/pairings?id=${item.id}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { pairings: string[] } | null) => {
        if (data?.pairings?.length) {
          setFreshPairings(prev => ({ ...prev, [item.id]: data.pairings }));
        }
      })
      .catch(() => {});
  }, [index, garments]);

  // Once the score is ready: the item's new details, score, pairings and image are all loaded
  // while the loading screen is still up, so everything appears at once when it lifts.
  async function revealScored(garmentId: string) {
    invalidateClientCache("closet:scores");
    const [fresh, scoring, pairs] = await Promise.all([
      fetch("/api/garments").then(r => r.ok ? r.json() as Promise<Garment[]> : null).catch(() => null),
      fetch("/api/scoring?skipOutfits=1").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/garments/pairings?id=${garmentId}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const img = fresh?.find(g => g.id === garmentId)?.image;
    if (img) await new Promise<void>(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = img; });
    if (unmounted.current) return;
    if (fresh) setGarments(fresh);
    if (scoring?.pieces) {
      const map: Record<string, number> = {};
      for (const p of scoring.pieces as { id: string; score: number }[]) map[p.id] = p.score;
      setScores(map);
      rememberCache("closet:scores", map);
    }
    if (pairs?.pairings) setFreshPairings(prev => ({ ...prev, [garmentId]: pairs.pairings }));
    refreshedRef.current.add(garmentId);
  }

  const followingRef = useRef<string | null>(null);
  async function followJob(jobId: string, garmentId: string) {
    // One watcher per job — revisiting the tab while it runs must not start a second one.
    if (followingRef.current === jobId) return;
    followingRef.current = jobId;
    setScoringId(garmentId);
    const job = await waitForJob(jobId, () => unmounted.current);
    if (unmounted.current) return;
    if (job.status === "done") await revealScored(garmentId);
    else if (job.status === "failed") setRemoveError(jobFailureMessage(job));
    ackJobs([jobId]);
    followingRef.current = null;
    refreshEntitlements();
    fetchJobs().then(s => { if (!unmounted.current) setJobs(s); }).catch(() => {});
    if (!unmounted.current) setScoringId(null);
  }

  // Free tier: credits, plus a score that was running (or finished/failed) while the page was
  // closed — the loading screen picks up where it left off.
  useEffect(() => {
    if (!entitlementsReady || hasAI || loading) return;
    let cancelled = false;
    fetchJobs().then(async s => {
      if (cancelled) return;
      setJobs(s);
      const items = s.jobs.filter(j => j.kind === "item");
      const running = items.find(j => j.status === "running");
      if (running?.targetId) {
        const at = garments.findIndex(g => g.id === running.targetId);
        if (at >= 0) setIndex(at);
        followJob(running.id, running.targetId);
      }
      const finished = items.filter(j => j.status !== "running");
      for (const j of finished) if (j.status === "done" && j.targetId) await revealScored(j.targetId);
      const failed = finished.find(j => j.status === "failed");
      if (failed) setRemoveError(jobFailureMessage(failed));
      ackJobs(finished.map(j => j.id));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlementsReady, hasAI, loading]);

  async function spendScore(garmentId: string) {
    if (scoringId) return;
    setScoringId(garmentId);
    try {
      const job = await startJob("item", garmentId);
      await followJob(job.id, garmentId);
    } catch (e) {
      setScoringId(null);
      setRemoveError(e instanceof Error ? e.message : "Couldn't start the analysis. Nothing was used — please try again.");
      fetchJobs().then(setJobs).catch(() => {});
    }
  }

  function navigate(d: "left" | "right") {
    if (busy.current || shownGarments.length < 2) return;
    busy.current = true;
    setDir(d);
    setPhase("out");

    setTimeout(() => {
      setIndex((prev) => {
        const next = d === "right"
          ? (prev + 1) % shownGarments.length
          : (prev - 1 + shownGarments.length) % shownGarments.length;
        preloadAround(shownGarments, next);
        return next;
      });
      setAnimKey((k) => k + 1);
      setPhase("in");
      setTimeout(() => {
        setPhase("idle");
        busy.current = false;
      }, 300);
    }, 190);
  }

  async function removeItem() {
    if (!garments[index]) return;
    const id = garments[index].id;
    let res: Response;
    try {
      res = await fetch(`/api/garments?id=${id}`, { method: "DELETE" });
    } catch {
      setRemoveError("Couldn't reach the server — check your connection and try again.");
      return;
    }
    if (!res.ok) {
      setRemoveError("Couldn't remove that item — try again.");
      return;
    }
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);

    // Silently regenerate any calendar months whose outfits included the removed garment.
    // Those outfits were deleted server-side; calling generate fills the now-blank dates.
    const affected = (data as { affectedMonths?: string[] }).affectedMonths ?? [];
    for (const monthKey of affected) {
      const [y, m] = monthKey.split("-").map(Number);
      fetch("/api/outfits/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ year: y, month: m, overwrite: false }),
      }).catch(() => {});
    }

    try {
      const raw = localStorage.getItem("wa_cache_v20");
      if (raw) {
        const cache = JSON.parse(raw);
        if (cache?.backendState?.crossed) {
          // Mirror the backend deletion in the local cache so the WA page fast-path
          // also reflects the correct state without needing a backend round-trip.
          const deleted = cache.backendState.crossed.filter(
            (e: { garmentId?: string | null }) => e.garmentId === id
          );
          cache.backendState.crossed = cache.backendState.crossed.filter(
            (e: { garmentId?: string | null }) => e.garmentId !== id
          );
          if (deleted.length > 0) {
            if (!cache.removedCrossings) cache.removedCrossings = {};
            cache.removedCrossings[id] = deleted;
          }
          cache.pieceCount = -1;
          localStorage.setItem("wa_cache_v20", JSON.stringify(cache));
        } else {
          localStorage.removeItem("wa_cache_v20");
        }
      }
    } catch {
      try { localStorage.removeItem("wa_cache_v20"); } catch {}
    }
    const updated = garments.filter((g) => g.id !== id);
    setGarments(updated);
    setIndex((prev) => Math.min(prev, Math.max(updated.length - 1, 0)));
  }

  function openEdit() {
    if (!item) return;
    setEditItem({
      id:            item.id,
      title:         item.title,
      brand:         item.brand ?? "",
      color_primary: item.color_primary ?? "",
      category:      item.category ?? "",
      aesthetic:     item.aesthetic_tags?.[0] ?? "",
    });
  }

  async function saveEdit(updated: EditUpdate) {
    if (!item) return;
    await fetch("/api/garments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, ...updated }),
    });
    const { aesthetic, ...rest } = updated;
    setGarments(prev => prev.map(g =>
      g.id !== item.id ? g : {
        ...g, ...rest,
        ...(aesthetic !== undefined ? { aesthetic_tags: aesthetic ? [aesthetic] : null } : {}),
      }
    ));
    // Modal closes itself after showing DONE! for 2 seconds via its onClose callback.
  }


  const item = shownGarments[index % Math.max(1, shownGarments.length)] ?? null;

  const pairingsForItem = !item ? [] : demo ? (item.style_pairings ?? []) : (freshPairings[item.id] ?? []);

  const outAnim = dir === "right"
    ? "slideOutLeft 0.18s ease-in forwards"
    : "slideOutRight 0.18s ease-in forwards";
  const inAnim = dir === "right"
    ? "slideInFromRight 0.28s ease-out forwards"
    : "slideInFromLeft 0.28s ease-out forwards";

  // Closet frame is always visible — only the item area shows loading state.
  // This makes the page feel instant: layout appears immediately on navigation.
  const showEmpty = !loading && shownGarments.length === 0;

  // Every return is wrapped in ReadyGate (components/ReadyGate.tsx): the three dots stay up until
  // the page — current item image included — is fully drawn, then it all appears at once.
  if (loading && !demo) return <ReadyGate ready={false} />;

  // Free tier with a purchased Single Item Analysis: score THIS item (same as the app).
  const scoreButton = item && !hasAI && !item.ai_unlocked && (jobs?.credits.item ?? 0) > 0 ? (
    <button
      onClick={() => spendScore(item.id)}
      disabled={!!scoringId}
      style={{ background: "none", border: "none", cursor: "pointer", marginTop: 6, padding: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#1d9e52", ...FONT }}
    >
      USE SCORE?
    </button>
  ) : null;

  return (
    <ReadyGate ready images={[item?.image]}>
    <main
      style={{
        ...FONT,
        height: "100dvh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}
    >
      <style suppressHydrationWarning>{ANIMATIONS}</style>

      {removeError && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 2100,
          background: "#111", color: "#fff", padding: "12px 20px", maxWidth: 380,
          display: "flex", alignItems: "center", gap: 14, ...FONT,
        }}>
          <p style={{ fontSize: 10, letterSpacing: "0.04em", lineHeight: 1.5, margin: 0 }}>{removeError}</p>
          <button
            onClick={() => setRemoveError(null)}
            style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 13, flexShrink: 0, ...FONT }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Load-failure state — distinct from the legitimately-empty-wardrobe state below */}
      {!demo && loadError && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "#c00", fontSize: 14, letterSpacing: "0.08em" }}>
            COULDN&apos;T LOAD YOUR CLOSET
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 10, background: "none", border: "1px solid #ccc", padding: "8px 18px", cursor: "pointer", fontSize: 11, letterSpacing: "0.08em", ...FONT }}
          >
            RETRY
          </button>
        </div>
      )}

      {/* Empty state — only shown after load confirms no garments */}
      {!loadError && showEmpty && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <img
            data-tutorial="closet.main"
            src="/closet.png"
            alt="closet"
            style={{ height: CLOSET_IMG_H_EMPTY, width: "auto", display: "block" }}
            draggable={false}
          />
          <p style={{ marginTop: 14, color: "#aaa", fontSize: 14, letterSpacing: "0.08em" }}>
            YOUR CLOSET IS EMPTY
          </p>
        </div>
      )}

      {/* Main layout — rendered only after data is fully loaded */}
      {!showEmpty && (
        <>
          {/* Mobile: the desktop row below needs ~2x a phone's width (two flex:1 text
              columns plus a fixed-height-driven closet illustration all side by side) — at
              375px the side panels would get squeezed to near-zero and clip. Mobile instead
              stacks a smaller illustration + nav arrows on top, with every info section
              (score/pros/pairs/colors/cons/avoid/overdone) as one scrollable list below it,
              so the same information is all still reachable, just vertically instead of in
              two side columns that no longer fit. */}
          {isMobile && item && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, width: "100%" }}>
              <div data-tutorial="closet.main" style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 0 0" }}>
                <Arrow dir="left" onClick={() => navigate("left")} disabled={shownGarments.length < 2} small />
                <div style={{ position: "relative", display: "inline-block" }}>
                  <img src="/closet.png" alt="closet" style={{ height: "26vh", width: "auto", display: "block" }} draggable={false} />
                  <div style={{
                    position: "absolute", top: "21%", left: "29%", right: "29%", bottom: "26%",
                    overflow: "hidden", clipPath: "inset(0)",
                    display: "flex", justifyContent: "center", alignItems: "center",
                  }}>
                    <div key={animKey} style={{
                      width: "100%", display: "flex", justifyContent: "center", alignItems: "center",
                      animation: phase === "out" ? outAnim : phase === "in" ? inAnim : "none",
                    }}>
                      {item.image ? (
                        <img src={item.image} alt={item.title} draggable={false}
                          style={{ display: "block", maxHeight: "8vh", maxWidth: "100%", height: "auto", width: "auto", objectFit: "contain" }} />
                      ) : (
                        <div style={{ height: "8vh", width: 50, background: "#eee" }} />
                      )}
                    </div>
                  </div>
                </div>
                <Arrow dir="right" onClick={() => navigate("right")} disabled={shownGarments.length < 2} small />
              </div>

              {/* Title + score up top, right under the image — the two things worth seeing
                  at a glance before scrolling for detail. Score is just the colored number
                  (no "SCORE" label) matching how scores read everywhere else in the app. */}
              <div style={{ flexShrink: 0, textAlign: "center", padding: "6px 20px 10px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  {item.brand ?? item.title}
                </p>
                {(hasAI || item.ai_unlocked) && (
                  <p style={{
                    fontSize: 22, fontWeight: 700, margin: "2px 0 0",
                    color: scoreColor(shownScores[item.id]),
                  }}>
                    {shownScores[item.id] != null ? shownScores[item.id] : "—"}
                  </p>
                )}
                {scoreButton}
              </div>

              <MobileScrollFade padding={`4px 24px calc(20px + ${TAB_BAR_H}px + var(--safe-bottom))`}>
                {(!hasAI && !item.ai_unlocked ? freeSections(item, pairingsForItem) : [
                  { label: "PROS", items: item.pros ?? [], color: "#2e7d32", emptyText: item.pros === null ? "analyzing…" : "none" },
                  { label: "PAIRS WITH", items: pairingsForItem, color: "#555", emptyText: item.pros === null ? "analyzing…" : "nothing in your wardrobe pairs well with this yet — add more items" },
                  { label: "COLORS", items: item.color_pairings ?? [], color: "#555" },
                  { label: "CONS", items: item.cons ?? [], color: "#c00", emptyText: item.cons === null ? "analyzing…" : "no cons" },
                  { label: "AVOID", items: item.color_clashes ?? [], color: "#c00", emptyText: item.color_clashes === null ? "analyzing…" : "none" },
                  ...(item.sub_type && overdoneMap[item.sub_type.toLowerCase()]
                    ? [{ label: "OVERDONE", items: [overdoneMap[item.sub_type.toLowerCase()]], color: "#c88800" }]
                    : []),
                ] as PanelSection[]).map(section => (
                  <div key={section.label} style={{ marginBottom: 18, textAlign: "center" }}>
                    <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: "#bbb", textTransform: "uppercase", margin: "0 0 6px" }}>
                      {section.label}
                    </p>
                    {section.items.length > 0 ? (
                      section.items.map((t, i) => (
                        <p key={i} style={{ fontSize: 12, color: section.color, lineHeight: 1.6, margin: "0 0 4px" }}>{t}</p>
                      ))
                    ) : (
                      <p style={{ fontSize: 12, color: "#ccc", margin: 0 }}>{section.emptyText ?? "none"}</p>
                    )}
                  </div>
                ))}
              </MobileScrollFade>
            </div>
          )}

          {/* Desktop: full-width row [PROS/PAIRS flex:1] [Arrow] [Closet] [Arrow] [CONS/AVOID flex:1] */}
          {!isMobile && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", width: "100%", minHeight: 0, overflow: "hidden" }}>
            <SidePanel
              side="left"
              spacerHeight="calc(20vh - 82px)"
              sections={
                !item
                  ? []
                  : !hasAI && !item.ai_unlocked
                  ? freeSections(item, pairingsForItem)
                  : [
                      ...(hasAI || item.ai_unlocked ? [{ label: "SCORE", items: [shownScores[item.id] != null ? `${shownScores[item.id]} / 100` : "—"], color: "#111" }] : []),
                      { label: "PROS", items: item.pros ?? [], color: "#2e7d32", emptyText: item.pros === null ? "analyzing…" : "none" },
                      {
                        label: "PAIRS WITH",
                        items: pairingsForItem,
                        color: "#555",
                        emptyText: item.pros === null ? "analyzing…" : "nothing in your wardrobe pairs well with this yet — add more items",
                      },
                      { label: "COLORS", items: item.color_pairings ?? [], color: "#555" },
                    ]
              }
            />

            {/* Center block — arrow + closet image + arrow */}
            <div data-tutorial="closet.main" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <Arrow dir="left" onClick={() => navigate("left")} disabled={shownGarments.length < 2} />

              <div style={{ position: "relative", display: "inline-block" }}>
                <img
                  src="/closet.png"
                  alt="closet"
                  style={{ height: CLOSET_IMG_H, width: "auto", display: "block" }}
                  draggable={false}
                />
                {/* Garment area — loading spinner or actual item image */}
                <div
                  style={{
                    position: "absolute",
                    top: "21%", left: "29%", right: "29%", bottom: "26%",
                    overflow: "hidden",
                    clipPath: "inset(0)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <div
                    key={animKey}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      animation:
                        phase === "out" ? outAnim :
                        phase === "in"  ? inAnim  :
                        "none",
                    }}
                  >
                    {item?.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        draggable={false}
                        style={{ display: "block", maxHeight: "20vh", maxWidth: "100%", height: "auto", width: "auto", objectFit: "contain" }}
                      />
                    ) : (
                      <div style={{ height: "20vh", width: 120, background: "#eee" }} />
                    )}
                  </div>
                </div>
              </div>

              <Arrow dir="right" onClick={() => navigate("right")} disabled={shownGarments.length < 2} />
            </div>

            <SidePanel
              side="right"
              sections={
                !item || (!hasAI && !item.ai_unlocked)
                  ? []
                  : (() => {
                      const overdoneSuggestion = item.sub_type ? overdoneMap[item.sub_type.toLowerCase()] : undefined;
                      return [
                        { label: "CONS",  items: item.cons ?? [],          color: "#c00", emptyText: item.cons === null ? "analyzing…" : "no cons" },
                        { label: "AVOID", items: item.color_clashes ?? [], color: "#c00", emptyText: item.color_clashes === null ? "analyzing…" : "none" },
                        ...(overdoneSuggestion ? [{ label: "OVERDONE", items: [overdoneSuggestion], color: "#c88800" }] : []),
                      ];
                    })()
              }
            />
          </div>
          )}

          {/* Bottom: brand name + remove — clamped height so it never shifts on tall
              screens but never gets squeezed below a readable minimum on short ones */}
          <div style={{ height: BOTTOM_BAR_H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {item && (
              <>
                <p style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>
                  {item.brand ?? item.title}
                </p>
                {item.brand && (
                  <p style={{ fontSize: 11, color: "#888", marginTop: 3, letterSpacing: "0.05em", margin: "3px 0 0" }}>
                    {item.title}
                  </p>
                )}
                {!isMobile && scoreButton}
                <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                  <button
                    onClick={openEdit}
                    onMouseEnter={e => (e.currentTarget.style.color = "#111")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#bbb")}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 10, letterSpacing: "0.12em", color: "#bbb",
                      textTransform: "uppercase", transition: "color 0.15s",
                    }}
                  >
                    EDIT
                  </button>
                  <button
                    onClick={removeItem}
                    onMouseEnter={e => (e.currentTarget.style.color = "#111")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#bbb")}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 10, letterSpacing: "0.12em", color: "#bbb",
                      textTransform: "uppercase", transition: "color 0.15s",
                    }}
                  >
                    REMOVE ITEM
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {editItem && (
        <EditModal
          initial={editItem}
          onSave={saveEdit}
          onClose={() => setEditItem(null)}
        />
      )}
      <AnalysisOverlay visible={!!scoringId} stages={ITEM_STAGES} />
    </main>
    </ReadyGate>
  );
}
