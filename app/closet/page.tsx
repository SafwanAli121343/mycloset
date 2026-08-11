"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
};

type EditState = {
  id: string;
  title: string;
  brand: string;
  color_primary: string;
  category: string;
};

const EDIT_CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];

function EditModal({ initial, onSave, onClose }: {
  initial: EditState;
  onSave: (updated: Partial<Garment>) => Promise<void>;
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
          ] as { key: keyof EditState; hint: string }[]).map(({ key, hint }) => (
            <div key={key} style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
              <input
                value={fields[key]}
                onChange={e => set(key, e.target.value)}
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


function Arrow({ dir, onClick, disabled }: { dir: "left" | "right"; onClick: () => void; disabled?: boolean }) {
  const points = dir === "left" ? "20,0 0,14 20,28" : "0,0 20,14 0,28";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none", border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: "0 20px", flexShrink: 0,
        opacity: disabled ? 0.2 : 1,
      }}
    >
      <svg width="20" height="28" viewBox="0 0 20 28">
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

export default function ClosetPage() {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [index, setIndex]       = useState(0);
  const [phase, setPhase]       = useState<Phase>("idle");
  const [dir, setDir]           = useState<"left" | "right">("right");
  const [animKey, setAnimKey]   = useState(0);
  const [loading, setLoading]   = useState(true);
  const [freshPairings, setFreshPairings] = useState<Record<string, string[] | null>>({});
  const [editItem, setEditItem] = useState<EditState | null>(null);
  const [scores, setScores]     = useState<Record<string, number>>({});
  // sub_type.toLowerCase() → suggestion text from WA analysis overdone array
  const [overdoneMap, setOverdoneMap] = useState<Record<string, string>>({});

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
    Promise.all([
      fetch("/api/garments").then(r => r.json()),
      fetch("/api/scoring").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/wardrobe/state").then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([data, scoringData, waState]) => {
      if (scoringData?.pieces) {
        const map: Record<string, number> = {};
        for (const p of scoringData.pieces) map[p.id] = p.score;
        setScores(map);
      }

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
    });
  }, []);

  // Poll for analysis data on garments that were just added (pros === null means analysis pending)
  useEffect(() => {
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

  function navigate(d: "left" | "right") {
    if (busy.current || garments.length < 2) return;
    busy.current = true;
    setDir(d);
    setPhase("out");

    setTimeout(() => {
      setIndex((prev) => {
        const next = d === "right"
          ? (prev + 1) % garments.length
          : (prev - 1 + garments.length) % garments.length;
        preloadAround(garments, next);
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
    const res  = await fetch(`/api/garments?id=${id}`, { method: "DELETE" });
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
    });
  }

  async function saveEdit(updated: Partial<Garment>) {
    if (!item) return;
    await fetch("/api/garments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, ...updated }),
    });
    setGarments(prev => prev.map(g =>
      g.id === item.id ? { ...g, ...updated } : g
    ));
    // Modal closes itself after showing DONE! for 2 seconds via its onClose callback.
  }


  const item = garments[index] ?? null;

  const pairingsForItem = item ? (freshPairings[item.id] ?? []) : [];

  const outAnim = dir === "right"
    ? "slideOutLeft 0.18s ease-in forwards"
    : "slideOutRight 0.18s ease-in forwards";
  const inAnim = dir === "right"
    ? "slideInFromRight 0.28s ease-out forwards"
    : "slideInFromLeft 0.28s ease-out forwards";

  // Closet frame is always visible — only the item area shows loading state.
  // This makes the page feel instant: layout appears immediately on navigation.
  const showEmpty = !loading && garments.length === 0;

  if (loading) {
    return (
      <main style={{ ...FONT, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <style suppressHydrationWarning>{ANIMATIONS}</style>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 160 }}>
          <img src={LOADING_IMG} alt="" draggable={false} style={{ width: 270, height: 340, objectFit: "contain", opacity: 0.88 }} />
          <div style={{ width: 190, height: 5, background: "#e8e8e8", overflow: "hidden", marginTop: -88 }}>
            <div style={{ height: "100%", background: "#111", animation: "loadbar 8s ease-out forwards" }} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        ...FONT,
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}
    >
      <style suppressHydrationWarning>{ANIMATIONS}</style>

      {/* Empty state — only shown after load confirms no garments */}
      {showEmpty && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <img
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
          {/* Full-width row: [PROS/PAIRS flex:1] [Arrow] [Closet] [Arrow] [CONS/AVOID flex:1] */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", width: "100%", minHeight: 0, overflow: "hidden" }}>
            <SidePanel
              side="left"
              spacerHeight="calc(20vh - 82px)"
              sections={
                !item
                  ? []
                  : [
                      { label: "SCORE", items: [scores[item.id] != null ? `${scores[item.id]} / 100` : "—"], color: "#111" },
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
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <Arrow dir="left" onClick={() => navigate("left")} disabled={garments.length < 2} />

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

              <Arrow dir="right" onClick={() => navigate("right")} disabled={garments.length < 2} />
            </div>

            <SidePanel
              side="right"
              sections={
                !item
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
    </main>
  );
}
