"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const FONT = { fontFamily: "Arial, sans-serif" } as const;
const LOADING_IMG = "/loading-tee.png";
const S_H               = 130;  // gallery stack cell height
const E_GAP             = 6;    // px gap between items when spread
const SPREAD_W          = 120;  // target spread item width (portrait)
const SPREAD_H          = 190;  // target spread item height (portrait, taller → bigger pictures)
const OVERLAY_TOP_OFFSET = 50;  // px above viewport center for overlay items
const SPREAD_SCALE      = 1.45; // how much items scale up when spread in overlay

const KEYFRAMES = `
  @keyframes loadbar {
    0%   { width: 0% }
    55%  { width: 65% }
    80%  { width: 84% }
    100% { width: 93% }
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

type GalleryItem = {
  id:            string;
  title:         string | null;
  image:         string | null;
  sub_type:      string | null;
  category:      string | null;
  color_primary: string | null;
};

type GalleryOutfit = {
  id:        string;
  date:      string | null;
  items:     GalleryItem[];
  score:     number | null;
  pros:      string[];
  cons:      string[];
  aesthetic: string | null;
};

type SpreadCfg = {
  containerW:  number;
  containerH:  number;  // tall enough for both stacked (cellH) and spread (spreadItemH)
  stackLeft:   number;  // horizontal offset for stacked items within the wide container
  stackTop:    number;  // vertical offset to center stacked items within taller container
  cellW:       number;  // gallery cell width (used for stacked sizing)
  cellH:       number;  // gallery cell height (S_H)
  spreadItemW: number;
  spreadItemH: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stackOrder(item: GalleryItem): number {
  switch ((item.category ?? "").toLowerCase()) {
    case "accessory":  return 0;
    case "footwear":   return 1;
    case "top":        return 2;
    case "outerwear":  return 3;
    case "bottom":     return 4;
  }
  const sub = (item.sub_type ?? "").toLowerCase();
  if (sub.includes("ring")    || sub.includes("watch")    || sub.includes("bracelet") ||
      sub.includes("chain")   || sub.includes("necklace") || sub.includes("earring")  ||
      sub.includes("bag")     || sub.includes("hat")      || sub.includes("cap")      ||
      sub.includes("beanie")  || sub.includes("belt")     || sub.includes("scarf")    ||
      sub.includes("glasses") || sub.includes("sunglass")) return 0;
  if (sub.includes("shoe")    || sub.includes("boot")     || sub.includes("sneaker")  ||
      sub.includes("loafer")  || sub.includes("sandal")   || sub.includes("slide")    ||
      sub.includes("oxford")  || sub.includes("derby")    || sub.includes("mule"))    return 1;
  if (sub.includes("jacket")  || sub.includes("coat")     || sub.includes("blazer")   ||
      sub.includes("bomber")  || sub.includes("cardigan")) return 3;
  if (sub.includes("pant")    || sub.includes("jean")     || sub.includes("trouser")  ||
      sub.includes("chino")   || sub.includes("short")    || sub.includes("skirt")    ||
      sub.includes("legging")) return 4;
  return 2;
}

function sortItems(items: GalleryItem[]): GalleryItem[] {
  return [...items].sort((a, b) => stackOrder(a) - stackOrder(b));
}

// Items are always SPREAD_W × SPREAD_H in both stacked and spread states —
// no size change ever occurs. Only `left` animates during spread/unspreading.
function buildSpreadCfg(Nlocal: number, cellW: number, cellH: number): SpreadCfg {
  const containerW = Nlocal * SPREAD_W + Math.max(0, Nlocal - 1) * E_GAP;
  const containerH = SPREAD_H;
  const stackLeft  = (containerW - SPREAD_W) / 2;
  return { containerW, containerH, stackLeft, stackTop: 0, cellW, cellH, spreadItemW: SPREAD_W, spreadItemH: SPREAD_H };
}

const DEFAULT_CFG: SpreadCfg = {
  containerW: 390, containerH: SPREAD_H,
  stackLeft: 135, stackTop: 0,
  cellW: 120, cellH: S_H,
  spreadItemW: SPREAD_W, spreadItemH: SPREAD_H,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GeneratePage() {
  const [outfits, setOutfits]       = useState<GalleryOutfit[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [phase, setPhase]           = useState<"gallery" | "overlay">("gallery");
  const [bgVisible, setBgVisible]   = useState(false);
  const [isSpread, setIsSpread]     = useState(false);
  const [activeIdx, setActiveIdx]   = useState(0);
  const [displayIdx, setDisplayIdx] = useState(0);
  const [navFading, setNavFading]   = useState(false);
  const [spreadCfg, setSpreadCfg]   = useState<SpreadCfg>(DEFAULT_CFG);
  const [containerTransform,    setContainerTransform]    = useState("translate(-50%, -50%)");
  const [containerTransitionOn, setContainerTransitionOn] = useState(false);
  const [scaleVal,              setScaleVal]              = useState(1);

  const stackRefs = useRef<Map<number, HTMLElement>>(new Map());
  const timerRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch("/api/outfits/gallery")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { outfits: GalleryOutfit[] }) => { setOutfits(d.outfits); setLoading(false); })
      .catch(() => { setFetchError(true); setLoading(false); });
  }, []);

  // ── Open: fly from grid → center, bg fades, items spread ──────────────────

  const openOutfit = useCallback((idx: number, outfitsArr: GalleryOutfit[]) => {
    clearTimeout(timerRef.current);
    const el = stackRefs.current.get(idx);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const dx   = rect.left + rect.width  / 2 - vw / 2;
    const dy   = rect.top  + rect.height / 2 - (vh / 2 - OVERLAY_TOP_OFFSET);

    const si  = sortItems(outfitsArr[idx].items);
    const cfg = buildSpreadCfg(si.length, rect.width, rect.height);
    setSpreadCfg(cfg);
    setActiveIdx(idx);
    setDisplayIdx(idx);
    setIsSpread(false);
    setBgVisible(false);
    setScaleVal(1);
    setContainerTransitionOn(false);
    setContainerTransform(`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`);
    setPhase("overlay");

    requestAnimationFrame(() => requestAnimationFrame(() => {
      setContainerTransitionOn(true);
      setContainerTransform("translate(-50%, -50%)");
      timerRef.current = setTimeout(() => {
        setBgVisible(true);
        setScaleVal(SPREAD_SCALE);
        timerRef.current = setTimeout(() => setIsSpread(true), 280);
      }, 400);
    }));
  }, []);

  // ── Close: reassemble → bg fades → flies back ─────────────────────────────

  const closeOverlay = useCallback(() => {
    clearTimeout(timerRef.current);
    setIsSpread(false);
    setScaleVal(1);

    timerRef.current = setTimeout(() => {
      setBgVisible(false);

      timerRef.current = setTimeout(() => {
        const el = stackRefs.current.get(activeIdx);
        if (el) {
          const rect = el.getBoundingClientRect();
          const vw   = window.innerWidth;
          const vh   = window.innerHeight;
          const dx   = rect.left + rect.width  / 2 - vw / 2;
          const dy   = rect.top  + rect.height / 2 - (vh / 2 - OVERLAY_TOP_OFFSET);
          setContainerTransitionOn(true);
          setContainerTransform(`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`);
        }
        timerRef.current = setTimeout(() => {
          setContainerTransitionOn(false);
          setPhase("gallery");
        }, 400);
      }, 300);
    }, 380);
  }, [activeIdx]);

  // ── Navigate: collapse → swap → spread ────────────────────────────────────

  const navigateTo = useCallback((newIdx: number, outfitsArr: GalleryOutfit[], cfg: SpreadCfg) => {
    if (navFading) return;
    setNavFading(true);
    setIsSpread(false);
    timerRef.current = setTimeout(() => {
      const si     = sortItems(outfitsArr[newIdx].items);
      const newCfg = buildSpreadCfg(si.length, cfg.cellW, cfg.cellH);
      setSpreadCfg(newCfg);
      setDisplayIdx(newIdx);
      setActiveIdx(newIdx);
      timerRef.current = setTimeout(() => {
        setIsSpread(true);
        setNavFading(false);
      }, 80);
    }, 350);
  }, [navFading]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const current = outfits[displayIdx] ?? null;
  const items   = current ? sortItems(current.items) : [];
  const N       = items.length;
  const { containerW, containerH, stackLeft } = spreadCfg;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <main style={{ ...FONT, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 160 }}>
        <img src={LOADING_IMG} alt="" draggable={false}
          style={{ width: 270, height: 340, objectFit: "contain", opacity: 0.88 }} />
        <div style={{ width: 190, height: 5, background: "#e8e8e8", overflow: "hidden", marginTop: -88 }}>
          <div style={{ height: "100%", background: "#111", animation: "loadbar 8s ease-out forwards" }} />
        </div>
      </div>
    </main>
  );

  if (fetchError) return (
    <main style={{ ...FONT, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>
      <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#bbb" }}>FAILED TO LOAD</p>
    </main>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{ ...FONT, minHeight: "100vh", background: "#fff" }}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>

      {/* Empty state */}
      {outfits.length === 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#bbb" }}>
            GENERATE OUTFITS FROM THE CALENDAR FIRST
          </p>
        </div>
      )}

      {/* Gallery grid */}
      {outfits.length > 0 && (
        <div style={{
          display:             "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          columnGap:           20,
          rowGap:              160,
          padding:             "40px 28px 72px",
        }}>
          {outfits.map((outfit, idx) => {
            const si    = sortItems(outfit.items);
            const score = outfit.score;
            const scoreColor = score == null ? "#ccc"
              : score >= 75 ? "#1d9e52"
              : score >= 50 ? "#c88800"
              : "#c83030";
            return (
              <div key={outfit.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                {/* Stack cell — white bg so multiply blend works */}
                <div
                  ref={el => { if (el) stackRefs.current.set(idx, el as HTMLElement); else stackRefs.current.delete(idx); }}
                  onClick={() => phase === "gallery" && openOutfit(idx, outfits)}
                  style={{
                    position:   "relative",
                    width:      "100%",
                    height:     S_H,
                    background: "#fff",
                    cursor:     "pointer",
                    opacity:    phase !== "gallery" && activeIdx === idx ? 0 : 1,
                    transition: phase !== "gallery" ? "opacity 0.2s" : "none",
                  }}
                >
                  {si.map((item, i) => (
                    <div key={item.id} style={{
                      position: "absolute", inset: 0, zIndex: si.length - i,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {item.image && (
                        <img src={item.image} alt="" style={{
                          maxWidth: "100%", maxHeight: "100%",
                          objectFit: "contain", display: "block",
                          mixBlendMode: "multiply",
                        }} />
                      )}
                    </div>
                  ))}
                </div>

                <p style={{ ...FONT, margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: scoreColor }}>
                  {score != null ? `${score} / 100` : "—"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Overlay ───────────────────────────────────────────────────────── */}
      {phase !== "gallery" && (
        <>
          {/* Transparent blocker */}
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} />

          {/* White background — fades in after fly-in */}
          <div style={{
            position:      "fixed",
            inset:         0,
            zIndex:        201,
            background:    "#fff",
            opacity:       bgVisible ? 1 : 0,
            transition:    "opacity 0.3s ease",
            pointerEvents: "none",
          }} />

          {/* Items container — transparent, flies from grid to center.
              Always sized to fit the spread layout; stacked items are centered
              inside it so the fly-in target aligns with the gallery stack. */}
          <div style={{
            position:   "fixed",
            top:        `calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
            left:       "50%",
            width:      containerW,
            height:     containerH,
            transform:  `${containerTransform} scale(${scaleVal})`,
            transition: containerTransitionOn ? "transform 0.38s cubic-bezier(0.4,0,0.2,1)" : "none",
            zIndex:     202,
          }}>
            {items.map((item, i) => {
              return (
                <div key={item.id} style={{
                  position: "absolute",
                  left:     isSpread ? i * (SPREAD_W + E_GAP) : stackLeft,
                  top:      0,
                  width:    SPREAD_W,
                  height:   SPREAD_H,
                  zIndex:   isSpread ? 1 : (N - i),
                  transition: "left 0.28s ease-out",
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                }}>
                  {item.image && (
                    <img src={item.image} alt="" style={{
                      maxWidth:     "100%",
                      maxHeight:    "100%",
                      objectFit:    "contain",
                      display:      "block",
                      mixBlendMode: "multiply",
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* UI controls layer */}
          <div style={{ position: "fixed", inset: 0, zIndex: 203, pointerEvents: "none" }}>

            {/* Close ✕ */}
            <button onClick={closeOverlay} style={{
              position:      "absolute",
              top:           20,
              right:         22,
              background:    "none",
              border:        "none",
              cursor:        "pointer",
              fontSize:      22,
              color:         "#000",
              lineHeight:    1,
              padding:       4,
              pointerEvents: "auto",
              ...FONT,
            }}>×</button>

            {/* Score */}
            {current?.score != null && (
              <p style={{
                position:      "absolute",
                top:           28,
                left:          "50%",
                transform:     "translateX(-50%)",
                margin:        0,
                fontSize:      22,
                fontWeight:    700,
                letterSpacing: "0.06em",
                textAlign:     "center",
                color:         current.score >= 75 ? "#1d9e52" : current.score >= 50 ? "#c88800" : "#c83030",
                opacity:       isSpread ? 1 : 0,
                transition:    "opacity 0.3s 0.1s",
                whiteSpace:    "nowrap",
                ...FONT,
              }}>
                {current.score} / 100
              </p>
            )}

            {/* Left arrow — far left of screen */}
            <button
              onClick={() => outfits.length > 1 && navigateTo(
                (displayIdx - 1 + outfits.length) % outfits.length, outfits, spreadCfg
              )}
              style={{
                position:      "absolute",
                left:          18,
                top:           "50%",
                transform:     "translateY(-50%)",
                background:    "none",
                border:        "none",
                cursor:        outfits.length > 1 ? "pointer" : "default",
                opacity:       bgVisible && outfits.length > 1 ? 1 : 0,
                transition:    "opacity 0.2s",
                padding:       "12px 10px",
                pointerEvents: "auto",
              }}
            >
              <svg width="8" height="13" viewBox="0 0 10 17">
                <polygon points="10,0 0,8.5 10,17" fill="#111" />
              </svg>
            </button>

            {/* Right arrow — far right of screen */}
            <button
              onClick={() => outfits.length > 1 && navigateTo(
                (displayIdx + 1) % outfits.length, outfits, spreadCfg
              )}
              style={{
                position:      "absolute",
                right:         18,
                top:           "50%",
                transform:     "translateY(-50%)",
                background:    "none",
                border:        "none",
                cursor:        outfits.length > 1 ? "pointer" : "default",
                opacity:       bgVisible && outfits.length > 1 ? 1 : 0,
                transition:    "opacity 0.2s",
                padding:       "12px 10px",
                pointerEvents: "auto",
              }}
            >
              <svg width="8" height="13" viewBox="0 0 10 17">
                <polygon points="0,0 10,8.5 0,17" fill="#111" />
              </svg>
            </button>

          </div>

          {/* Pros — plain text left of items, no card */}
          {bgVisible && (
            <div style={{
              position:   "fixed",
              top:        `calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
              right:      `calc(50% + ${containerW / 2 * SPREAD_SCALE + 56}px)`,
              transform:  "translateY(-50%)",
              width:      190,
              zIndex:     204,
              textAlign:  "center",
              opacity:    isSpread ? 1 : 0,
              transition: "opacity 0.3s",
              ...FONT,
            }}>
              <p style={{
                fontSize:      16,
                fontWeight:    700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                margin:        "0 0 14px",
              }}>PROS</p>
              {(current?.pros ?? []).length > 0
                ? current!.pros.map((p, i) => (
                    <p key={i} style={{ fontSize: 17, color: "#2e7d32", lineHeight: 1.5, margin: "0 0 10px" }}>{p}</p>
                  ))
                : <p style={{ fontSize: 17, color: "#bbb", margin: 0 }}>None</p>
              }
            </div>
          )}

          {/* Cons — plain text right of items, no card */}
          {bgVisible && (
            <div style={{
              position:   "fixed",
              top:        `calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
              left:       `calc(50% + ${containerW / 2 * SPREAD_SCALE + 56}px)`,
              transform:  "translateY(-50%)",
              width:      190,
              zIndex:     204,
              textAlign:  "center",
              opacity:    isSpread ? 1 : 0,
              transition: "opacity 0.3s",
              ...FONT,
            }}>
              <p style={{
                fontSize:      16,
                fontWeight:    700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                margin:        "0 0 14px",
              }}>CONS</p>
              {(current?.cons ?? []).length > 0
                ? current!.cons.map((c, i) => (
                    <p key={i} style={{ fontSize: 17, color: "#c00", lineHeight: 1.5, margin: "0 0 10px" }}>{c}</p>
                  ))
                : <p style={{ fontSize: 17, color: "#bbb", margin: 0 }}>None</p>
              }
            </div>
          )}
        </>
      )}
    </main>
  );
}
