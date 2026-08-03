"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const FONT = { fontFamily: "Arial, sans-serif" } as const;
const LOADING_IMG        = "/loading-tee.png";
const SPREAD_COL_GAP     = 28;
const ROW_GAP            = 28;
const SPREAD_W           = 120;
const SPREAD_H           = 190;
const SPREAD_SCALE       = 5;
const ITEMS_PER_ROW      = 3;
const OVERLAY_TOP_OFFSET = 50;
const IDEAL_THRESHOLD    = 75;
const FILTER_PANEL_W = 264;
const COLORS_CHUNK   = 14;
const PIECES_CHUNK   = 10;

const AESTHETICS = [
  "streetwear","gorpcore","old-money","preppy","quiet-luxury","minimalist",
  "techwear","workwear","athleisure","vintage","grunge","skate","y2k","90s",
  "normcore","hype-streetwear","western","punk","indie-sleaze","goth","maximalist",
];

const NAMED_COLORS = [
  "Black","Charcoal","Slate Gray","Gray","Heather Gray","Light Gray","Ash Gray",
  "Off-White","Ivory","Cream","White","Stone","Espresso","Chocolate","Brown",
  "Chestnut","Camel","Tan","Khaki","Sand","Beige","Taupe","Crimson","Red",
  "Brick Red","Maroon","Burgundy","Wine","Rust","Terracotta","Coral","Salmon",
  "Blush","Pink","Hot Pink","Fuchsia","Magenta","Mauve","Purple","Violet",
  "Plum","Eggplant","Lavender","Lilac","Silver","Rose Gold","Platinum","Bronze",
  "Orange","Burnt Orange","Amber","Honey","Wheat","Caramel","Peach","Apricot",
  "Yellow","Mustard","Gold","Butter","Lime","Green","Kelly Green","Emerald",
  "Forest Green","Hunter Green","Olive","Army Green","Sage","Mint","Seafoam",
  "Teal","Turquoise","Sky Blue","Baby Blue","Periwinkle","Blue","Royal Blue",
  "Cobalt","Steel Blue","Denim Blue","Navy","Multicolor",
];

const KEYFRAMES = `
  @keyframes loadbar {
    0%   { width: 0% }
    55%  { width: 65% }
    80%  { width: 84% }
    100% { width: 93% }
  }
  @keyframes stackReveal {
    from { opacity: 0 }
    to   { opacity: 1 }
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 1.5px solid #bbb;
    cursor: pointer;
  }
  input[type=range]::-moz-range-thumb {
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 1.5px solid #bbb;
    cursor: pointer;
  }
`;

type GalleryItem = {
  id: string; title: string | null; image: string | null;
  brand: string | null;
  sub_type: string | null; category: string | null; color_primary: string | null;
  aesthetic_tags?: string[] | null;
  pros?: string[] | null; cons?: string[] | null;
};
type GalleryOutfit = {
  id: string; items: GalleryItem[];
  score: number | null; pros?: string[]; cons?: string[]; aesthetic?: string | null;
};
type SpreadCfg = { containerW: number; containerH: number; stackLeft: number; stackTop: number; };

// stackOrder: used for SPREAD positions (accessories spread first so they get
// consistent grid slots). Lower = earlier in the spread layout.
function stackOrder(item: GalleryItem): number {
  switch ((item.category ?? "").toLowerCase()) {
    case "accessory": return 0; case "footwear": return 1;
    case "top": return 2; case "outerwear": return 3; case "bottom": return 4;
  }
  const s = (item.sub_type ?? "").toLowerCase();
  if (["ring","watch","bracelet","chain","necklace","earring","bag","hat","cap","beanie","belt","scarf","glasses","sunglass"].some(k => s.includes(k))) return 0;
  if (["shoe","boot","sneaker","loafer","sandal","slide","oxford","derby","mule"].some(k => s.includes(k))) return 1;
  if (["jacket","coat","blazer","bomber","cardigan"].some(k => s.includes(k))) return 3;
  if (["pant","jean","trouser","chino","short","skirt","legging"].some(k => s.includes(k))) return 4;
  return 2;
}
function sortItems(items: GalleryItem[]) { return [...items].sort((a,b) => stackOrder(a)-stackOrder(b)); }

function dominantAesthetic(items: GalleryItem[]): string | null {
  const counts: Record<string, number> = {};
  for (const item of items)
    for (const t of item.aesthetic_tags ?? [])
      counts[t] = (counts[t] ?? 0) + 1;
  if (!Object.keys(counts).length) return null;
  const max = Math.max(...Object.values(counts));
  return Object.entries(counts).find(([, v]) => v === max)?.[0] ?? null;
}


function getSpreadPos(i: number, total: number, zoom = 1, vZoom = zoom): { left: number; top: number } {
  const step    = zoom  * (SPREAD_W + SPREAD_COL_GAP);
  const rowStep = vZoom * (SPREAD_H + ROW_GAP);
  const rowIdx      = Math.floor(i / ITEMS_PER_ROW);
  const colIdx      = i % ITEMS_PER_ROW;
  const top         = rowIdx * rowStep;
  const numFullRows = Math.floor(total / ITEMS_PER_ROW);
  const remainder   = total % ITEMS_PER_ROW;
  const isLastRow   = rowIdx === numFullRows && remainder > 0;
  const itemsInRow  = isLastRow ? remainder : ITEMS_PER_ROW;
  if (itemsInRow === ITEMS_PER_ROW) return { left: colIdx * step, top };
  if (itemsInRow === 1) return { left: step, top };
  return { left: (colIdx + 0.5) * step, top };
}

function buildSpreadCfg(N: number, zoom = 1, vZoom = zoom): SpreadCfg {
  const step    = zoom  * (SPREAD_W + SPREAD_COL_GAP);
  const rowStep = vZoom * (SPREAD_H + ROW_GAP);
  const numRows    = Math.max(1, Math.ceil(N / ITEMS_PER_ROW));
  const containerW = (ITEMS_PER_ROW - 1) * step + SPREAD_W;
  const containerH = (numRows - 1) * rowStep + SPREAD_H;
  return { containerW, containerH, stackLeft: (containerW - SPREAD_W) / 2, stackTop: (containerH - SPREAD_H) / 2 };
}
function computeSafeScale(containerH: number, containerW: number, vh: number, vw: number): number {
  const byH = (vh - 160) / containerH;
  const byW = vw / containerW;
  return Math.min(SPREAD_SCALE, Math.max(0.5, byH), Math.max(0.5, byW));
}
function spreadZoom(N: number): number {
  return Math.ceil(N / ITEMS_PER_ROW) >= 3 ? 1.55 : 1.85;
}
function vSpreadZoom(N: number): number {
  return Math.ceil(N / ITEMS_PER_ROW) >= 3 ? 1.32 : 1.85;
}

const DEFAULT_CFG = buildSpreadCfg(3);

export default function OutfitsPage() {
  const [outfits, setOutfits]       = useState<GalleryOutfit[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string|null>(null);
  const [gridPadV, setGridPadV]     = useState(24);

  const [showFilter,       setShowFilter]       = useState(false);
  const [filterAesthetics, setFilterAesthetics] = useState<string[]>([]);
  const [filterMinScore,   setFilterMinScore]   = useState(0);
  const [filterColors,     setFilterColors]     = useState<string[]>([]);
  const [filterPieces,     setFilterPieces]     = useState<string[]>([]);
  const [colorsShown,      setColorsShown]      = useState(COLORS_CHUNK);
  const [piecesShown,      setPiecesShown]      = useState(PIECES_CHUNK);

  const [phase, setPhase]               = useState<"gallery"|"overlay">("gallery");
  const [bgVisible, setBgVisible]       = useState(false);
  const [isSpread, setIsSpread]         = useState(false);
  const [animateItems, setAnimateItems] = useState(false);
  const [activeIdx, setActiveIdx]       = useState(0);
  const [displayIdx, setDisplayIdx]     = useState(0);
  const [navFading, setNavFading]       = useState(false);
  const [spreadCfg, setSpreadCfg]       = useState<SpreadCfg>(DEFAULT_CFG);
  const [containerTransform,    setContainerTransform]    = useState("translate(0px,0px) scale(1)");
  const [containerTransitionOn, setContainerTransitionOn] = useState(false);
  const [pieceZoom, setPieceZoom] = useState(1);

  const [displayCount, setDisplayCount] = useState(0);

  const gridRef            = useRef<HTMLDivElement>(null);
  const displayCountRef    = useRef(0);
  const countAnimRef       = useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  const stackRefs          = useRef<Map<number, HTMLElement>>(new Map());
  const timerRef           = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const activeIdxRef       = useRef(0);
  const containerWRef      = useRef(DEFAULT_CFG.containerW);
  const containerHRef      = useRef(DEFAULT_CFG.containerH);
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const rAFIdRef           = useRef(0);
  // Uniform scale across all outfits — computed from the largest outfit so every
  // outfit's pieces appear at the same size, and nothing is ever clipped.
  const globalSafeScaleRef = useRef(SPREAD_SCALE);

  useEffect(() => {
    fetch("/api/outfits/all-combos?max=2000")
      .then(r => r.text().then(txt => {
        if (!r.ok) return Promise.reject(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
        try { return JSON.parse(txt); }
        catch { return Promise.reject(`Bad JSON: ${txt.slice(0, 200)}`); }
      }))
      .then(async (d: { items: Record<string, GalleryItem>; outfits: Array<{ score: number; itemIds: string[] }> }) => {
        const outfitList = d.outfits.map((o, i) => {
          const items = o.itemIds.map(id => d.items[id]).filter(Boolean) as GalleryItem[];
          const pros = [...new Set(items.flatMap(item => item.pros ?? []))].slice(0, 4);
          const cons = [...new Set(items.flatMap(item => item.cons ?? []))].slice(0, 4);
          return {
            id:    String(i),
            score: o.score,
            items,
            pros:  pros.length > 0 ? pros : undefined,
            cons:  cons.length > 0 ? cons : undefined,
          };
        });
        setOutfits(outfitList);

        // Uniform spread scale — based on the largest outfit so all pieces look the same size.
        if (outfitList.length > 0) {
          const maxN = Math.max(...outfitList.map(o => sortItems(o.items).length));
          const cfg  = buildSpreadCfg(maxN);
          globalSafeScaleRef.current = computeSafeScale(
            cfg.containerH, cfg.containerW,
            document.documentElement.clientHeight,
            document.documentElement.clientWidth,
          );
        }

        // Preload every item image so the gallery renders fully populated.
        // Deduplicate URLs so each image is only fetched once.
        const urls = [...new Set(
          outfitList.flatMap(o => o.items.map(item => item.image).filter(Boolean) as string[])
        )];
        await Promise.all(
          urls.map(src => new Promise<void>(res => {
            const img = new Image(); img.onload = img.onerror = () => res(); img.src = src;
          }))
        );

        setLoading(false);
      })
      .catch((e: unknown) => { setFetchError(String(e)); setLoading(false); });
  }, []);

  // Measure the rendered grid height (includes score badges) to compute exact
  // vertical centering padding. Runs before paint so there's no visible flash.
  useLayoutEffect(() => {
    if (loading || !gridRef.current) return;
    const el = gridRef.current;
    el.style.paddingTop    = '0';
    el.style.paddingBottom = '0';
    const contentH = el.offsetHeight;
    // React will overwrite these inline styles on the next render with gridPadV
    const viewH = window.innerHeight;
    setGridPadV(Math.max(24, Math.floor((viewH - contentH) / 2)));
  }, [loading]);

  const openOutfit = useCallback((idx: number, arr: GalleryOutfit[]) => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(rAFIdRef.current);
    // Clear any direct DOM overrides left by a cancelled fly-back rAF loop
    if (overlayContainerRef.current) {
      overlayContainerRef.current.style.transition = '';
      overlayContainerRef.current.style.transform  = '';
    }
    const el = stackRefs.current.get(idx);
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // No Math.round — sub-pixel precision so overlay items land exactly on gallery card pixels.
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;

    const si  = sortItems(arr[idx].items);
    const cfg = buildSpreadCfg(si.length, spreadZoom(si.length), vSpreadZoom(si.length));

    const galleryTx = cx - vw / 2 - cfg.containerW / 2;
    const galleryTy = cy - (vh / 2 - OVERLAY_TOP_OFFSET) - cfg.containerH / 2;
    const centerTx  = -cfg.containerW / 2;
    const centerTy  = -cfg.containerH / 2;

    activeIdxRef.current  = idx;
    containerWRef.current = cfg.containerW;
    containerHRef.current = cfg.containerH;

    setSpreadCfg(cfg);
    setActiveIdx(idx); setDisplayIdx(idx);
    setNavFading(false);
    setIsSpread(false); setAnimateItems(false); setBgVisible(false); setPieceZoom(1);
    setContainerTransitionOn(false);
    setContainerTransform(`translate(${galleryTx}px,${galleryTy}px) scale(1)`);
    setPhase("overlay");

    timerRef.current = setTimeout(() => {
      // Move to centre AND fade bg to white simultaneously
      setContainerTransitionOn(true);
      setContainerTransform(`translate(${centerTx}px,${centerTy}px) scale(1)`);
      setBgVisible(true);
      timerRef.current = setTimeout(() => {
        // Move + bg both done; zoom pieces up while stacked
        setPieceZoom(1.85);
        timerRef.current = setTimeout(() => {
          // Pieces big; fly to spread positions
          setAnimateItems(true); setIsSpread(true);
          timerRef.current = setTimeout(() => setAnimateItems(false), 350);
        }, 400);
      }, 420);
    }, 100);
  }, []);

  const closeOverlay = useCallback(() => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(rAFIdRef.current);
    // Step 1: pieces gather; score/pros/cons fade; bg stays white
    setAnimateItems(true); setIsSpread(false);

    timerRef.current = setTimeout(() => {
      // Step 2: pieces shrink while still on white background
      setAnimateItems(false); setPieceZoom(1);

      timerRef.current = setTimeout(() => {
        // Step 3: white background fades away
        setBgVisible(false);

        timerRef.current = setTimeout(() => {
          // Step 4: fly back to gallery slot
          setContainerTransitionOn(false);

          const el = stackRefs.current.get(activeIdxRef.current);
          const vw = document.documentElement.clientWidth;
          const vh = document.documentElement.clientHeight;
          const cW = containerWRef.current;
          const cH = containerHRef.current;
          const c  = overlayContainerRef.current;

          let startTx    = -cW / 2;
          let startTy    = -cH / 2;
          let startScale = SPREAD_SCALE;
          if (c) {
            const m = new DOMMatrix(window.getComputedStyle(c).transform);
            startTx    = m.m41;
            startTy    = m.m42;
            startScale = m.m11;
            c.style.transition = 'none';
            c.style.transform  = `translate(${startTx}px,${startTy}px) scale(${startScale})`;
          }

          let initTargetTx = startTx;
          let initTargetTy = startTy;
          let FAR = false;
          if (el) {
            const r0 = el.getBoundingClientRect();
            const cx0 = r0.left + r0.width  / 2;
            const cy0 = r0.top  + r0.height / 2;
            initTargetTx = cx0 - vw / 2 - cW / 2;
            initTargetTy = cy0 - (vh / 2 - OVERLAY_TOP_OFFSET) - cH / 2;
            FAR = r0.bottom < 0 || r0.top > vh || r0.right < 0 || r0.left > vw;
          }
          const rawDx    = initTargetTx - startTx;
          const rawDy    = initTargetTy - startTy;
          const initDist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);

          let fixedTargetTx = initTargetTx;
          let fixedTargetTy = initTargetTy;
          if (FAR && initDist > 0) {
            const vertSign = rawDy >= 0 ? 1 : -1;
            const virtualV = vh * 0.6 * vertSign;
            const dirDist  = Math.sqrt(rawDx * rawDx + virtualV * virtualV);
            const ndx = dirDist > 0 ? rawDx    / dirDist : 0;
            const ndy = dirDist > 0 ? virtualV / dirDist : vertSign;
            const scrLeft = vw / 2 + startTx;
            const scrTop  = vh / 2 - OVERLAY_TOP_OFFSET + startTy;
            const PAD = 30;
            const candidates: number[] = [];
            if (ndx > 0) candidates.push((vw + PAD  - scrLeft) / ndx);
            if (ndx < 0) candidates.push((-cW - PAD - scrLeft) / ndx);
            if (ndy > 0) candidates.push((vh + PAD  - scrTop)  / ndy);
            if (ndy < 0) candidates.push((-cH - PAD - scrTop)  / ndy);
            const exitDist = Math.min(...candidates.filter(v => v > 0), initDist);
            fixedTargetTx  = startTx + ndx * exitDist;
            fixedTargetTy  = startTy + ndy * exitDist;
          }

          const DURATION = 380;
          let startTime  = -1;

          const tick = (ts: number) => {
            if (startTime < 0) startTime = ts;
            const t     = Math.min((ts - startTime) / DURATION, 1);
            const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;

            let targetTx: number;
            let targetTy: number;
            if (FAR) {
              targetTx = fixedTargetTx;
              targetTy = fixedTargetTy;
            } else {
              targetTx = startTx;
              targetTy = startTy;
              if (el) {
                const r  = el.getBoundingClientRect();
                const cx = r.left + r.width  / 2;
                const cy = r.top  + r.height / 2;
                targetTx = cx - vw / 2 - cW / 2;
                targetTy = cy - (vh / 2 - OVERLAY_TOP_OFFSET) - cH / 2;
              }
            }

            const tx    = startTx + (targetTx - startTx) * eased;
            const ty    = startTy + (targetTy - startTy) * eased;
            const scale = startScale + (1 - startScale) * eased;

            if (c) {
              c.style.transition = 'none';
              c.style.transform  = `translate(${tx}px,${ty}px) scale(${scale})`;
            }

            if (t < 1) {
              rAFIdRef.current = requestAnimationFrame(tick);
            } else {
              requestAnimationFrame(() => setPhase("gallery"));
            }
          };

          rAFIdRef.current = requestAnimationFrame(tick);
        }, 350); // bg fade (.3s ease)
      }, 400); // piece shrink (.35s ease + buffer)
    }, 300); // gather (.28s ease-out + buffer)
  }, []);

  const navigateTo = useCallback((newIdx: number, arr: GalleryOutfit[]) => {
    if (navFading) return;
    setNavFading(true);
    // Gather current pieces (score/pros/cons fade via isSpread=false; no shrink)
    setAnimateItems(true); setIsSpread(false);

    timerRef.current = setTimeout(() => {
      // Swap to new outfit while pieces are stacked at center (imperceptible)
      const n   = sortItems(arr[newIdx].items).length;
      const cfg = buildSpreadCfg(n, spreadZoom(n), vSpreadZoom(n));
      setSpreadCfg(cfg);
      containerWRef.current = cfg.containerW;
      containerHRef.current = cfg.containerH;
      activeIdxRef.current  = newIdx;
      setContainerTransitionOn(false);
      setContainerTransform(`translate(${-cfg.containerW / 2}px,${-cfg.containerH / 2}px) scale(1)`);
      setDisplayIdx(newIdx); setActiveIdx(newIdx);

      timerRef.current = setTimeout(() => {
        // Distribute new outfit's pieces
        setIsSpread(true);
        timerRef.current = setTimeout(() => {
          setAnimateItems(false);
          setNavFading(false);
        }, 300);
      }, 30);
    }, 300);
  }, [navFading]);

  const filteredOutfits = outfits.filter(o => {
    if (filterAesthetics.length > 0) {
      if (!o.items.some(item =>
        item.aesthetic_tags?.some((t: string) => filterAesthetics.includes(t))
      )) return false;
    }
    if (filterMinScore > 0 && (o.score == null || o.score < filterMinScore)) return false;
    if (filterColors.length > 0) {
      if (!o.items.some(item =>
        filterColors.some(c => item.color_primary?.toLowerCase() === c.toLowerCase())
      )) return false;
    }
    if (filterPieces.length > 0) {
      if (!o.items.some(item => filterPieces.includes(item.id))) return false;
    }
    return true;
  });

  const current     = filteredOutfits[displayIdx] ?? null;
  const items       = current ? sortItems(current.items) : [];
  const N           = items.length;
  const posZoom  = spreadZoom(N);
  const posVZoom = vSpreadZoom(N);
  const { containerW, containerH, stackLeft, stackTop } = spreadCfg;
  const panelOffset = containerW / 2 + 160;
  const currentScore = current?.score ?? null;
  const isIdeal      = currentScore != null && currentScore >= IDEAL_THRESHOLD;

  const availablePieces = useMemo(() => {
    const seen = new Map<string, string>(); // id → label
    for (const o of outfits) {
      for (const item of o.items) {
        if (!seen.has(item.id) && item.title) {
          const label = item.title.trim().split(/\s+/).slice(0, 3).join(" ");
          seen.set(item.id, label);
        }
      }
    }
    return [...seen.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [outfits]);

  useEffect(() => {
    const target = filteredOutfits.length;
    clearInterval(countAnimRef.current);
    const start = displayCountRef.current;
    const diff  = target - start;
    if (diff === 0) return;
    const steps = Math.max(1, Math.min(Math.abs(diff), 10));
    let step = 0;
    countAnimRef.current = setInterval(() => {
      step++;
      if (step >= steps) {
        displayCountRef.current = target;
        setDisplayCount(target);
        clearInterval(countAnimRef.current);
      } else {
        const val = Math.round(start + diff * (step / steps));
        displayCountRef.current = val;
        setDisplayCount(val);
      }
    }, 14);
    return () => clearInterval(countAnimRef.current);
  }, [filteredOutfits.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <main style={{...FONT,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#fff"}}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:160}}>
        <img src={LOADING_IMG} alt="" draggable={false} style={{width:270,height:340,objectFit:"contain",opacity:.88}}/>
        <div style={{width:190,height:5,background:"#e8e8e8",overflow:"hidden",marginTop:-88}}>
          <div style={{height:"100%",background:"#111",animation:"loadbar 8s ease-out forwards"}}/>
        </div>
      </div>
    </main>
  );

  if (fetchError) return (
    <main style={{...FONT,height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#fff",gap:8}}>
      <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>FAILED TO LOAD</p>
      <p style={{fontSize:11,color:"#bbb",maxWidth:400,textAlign:"center"}}>{fetchError}</p>
    </main>
  );

  const hasFilters = filterAesthetics.length > 0 || filterMinScore > 0 || filterColors.length > 0 || filterPieces.length > 0;
  const clearFilters = () => { setFilterAesthetics([]); setFilterMinScore(0); setFilterColors([]); setFilterPieces([]); };

  return (
    <main style={{...FONT,minHeight:"100vh",background:"#fff"}}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>

      {/* ── Filter panel — slides in from right ───────────────────────────── */}
      <div style={{
        position:"fixed",top:0,right:0,bottom:0,width:FILTER_PANEL_W,zIndex:100,
        background:"#fff",borderLeft:"1px solid #e8e8e8",
        transform:showFilter?"translateX(0)":`translateX(${FILTER_PANEL_W}px)`,
        transition:"transform .32s cubic-bezier(0.4,0,0.2,1)",
        willChange:"transform",
        overflowY:"auto",padding:"24px 20px",display:"flex",flexDirection:"column",gap:24,
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <p style={{...FONT,margin:0,fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase"}}>Filters</p>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            {hasFilters && (
              <button onClick={clearFilters} style={{...FONT,fontSize:10,color:"#999",background:"none",border:"none",cursor:"pointer",padding:0,letterSpacing:".06em"}}>CLEAR</button>
            )}
            <button onClick={()=>setShowFilter(false)} style={{...FONT,fontSize:11,color:"#e03030",background:"none",border:"none",cursor:"pointer",padding:0,letterSpacing:".04em"}}>Close</button>
          </div>
        </div>

        {/* Aesthetics */}
        <div>
          <p style={{...FONT,margin:"0 0 10px",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#000"}}>Aesthetic</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center"}}>
            {AESTHETICS.map(a=>{
              const on = filterAesthetics.includes(a);
              return (
                <button key={a} onClick={()=>setFilterAesthetics(prev=>prev.includes(a)?prev.filter(x=>x!==a):[...prev,a])} style={{
                  ...FONT,padding:"3px 8px",fontSize:11,cursor:"pointer",
                  background:"none",border:"none",
                  color:on?"#000":"#bbb",fontWeight:on?600:400,
                }}>{a}</button>
              );
            })}
          </div>
        </div>

        {/* Min score */}
        <div>
          <p style={{...FONT,margin:"0 0 10px",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#000"}}>Min Score</p>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <input type="range" min={0} max={100} step={5} value={filterMinScore}
              onChange={e=>setFilterMinScore(Number(e.target.value))} style={{flex:1,accentColor:"#000"}}/>
            <span style={{...FONT,fontSize:12,color:"#555",minWidth:24,textAlign:"right"}}>
              {filterMinScore>0?filterMinScore:"—"}
            </span>
          </div>
        </div>

        {/* Color */}
        <div>
          <p style={{...FONT,margin:"0 0 10px",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#000"}}>Color</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center"}}>
            {NAMED_COLORS.slice(0, colorsShown).map(c=>{
              const on = filterColors.includes(c);
              return (
                <button key={c} onClick={()=>setFilterColors(prev=>prev.includes(c)?prev.filter(x=>x!==c):[...prev,c])} style={{
                  ...FONT,padding:"3px 7px",fontSize:11,cursor:"pointer",
                  background:"none",border:"none",
                  color:on?"#000":"#bbb",fontWeight:on?600:400,
                }}>{c}</button>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:6}}>
            {colorsShown > COLORS_CHUNK && (
              <button onClick={()=>setColorsShown(n=>Math.max(COLORS_CHUNK,n-COLORS_CHUNK))}
                style={{...FONT,fontSize:10,color:"#000",background:"none",border:"none",cursor:"pointer",letterSpacing:".06em"}}>
                Hide
              </button>
            )}
            {colorsShown < NAMED_COLORS.length && (
              <button onClick={()=>setColorsShown(n=>Math.min(NAMED_COLORS.length,n+COLORS_CHUNK))}
                style={{...FONT,fontSize:10,color:"#000",background:"none",border:"none",cursor:"pointer",letterSpacing:".06em"}}>
                Show more
              </button>
            )}
          </div>
        </div>

        {/* Piece */}
        <div>
          <p style={{...FONT,margin:"0 0 10px",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#000"}}>Piece</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center"}}>
            {availablePieces.slice(0, piecesShown).map(({id,label})=>{
              const on = filterPieces.includes(id);
              return (
                <button key={id} onClick={()=>setFilterPieces(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])} style={{
                  ...FONT,padding:"3px 7px",fontSize:11,cursor:"pointer",
                  background:"none",border:"none",
                  color:on?"#000":"#bbb",fontWeight:on?600:400,
                }}>{label}</button>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:6}}>
            {piecesShown > PIECES_CHUNK && (
              <button onClick={()=>setPiecesShown(n=>Math.max(PIECES_CHUNK,n-PIECES_CHUNK))}
                style={{...FONT,fontSize:10,color:"#000",background:"none",border:"none",cursor:"pointer",letterSpacing:".06em"}}>
                Hide
              </button>
            )}
            {piecesShown < availablePieces.length && (
              <button onClick={()=>setPiecesShown(n=>Math.min(availablePieces.length,n+PIECES_CHUNK))}
                style={{...FONT,fontSize:10,color:"#000",background:"none",border:"none",cursor:"pointer",letterSpacing:".06em"}}>
                Show more
              </button>
            )}
          </div>
        </div>

        {hasFilters && (
          <p style={{...FONT,fontSize:11,color:"#bbb",marginTop:"auto"}}>
            {filteredOutfits.length} / {outfits.length} outfits
          </p>
        )}
      </div>

      {/* Transparent click-away to close panel */}
      {showFilter && (
        <div
          onClick={()=>setShowFilter(false)}
          style={{position:"fixed",inset:0,zIndex:99}}
        />
      )}

      <div>

      {/* ── Outfit count — scrolls away with the page ─────────────────────── */}
      <div style={{
        textAlign:"center",padding:"18px 0 0",
        transform:showFilter?"translateX(-28px)":"translateX(0)",
        transition:"transform .32s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <span style={{...FONT,fontSize:13,fontWeight:700,color:"#000",letterSpacing:".02em"}}>{displayCount}</span>
      </div>

      {/* ── Filter icon — scrolls away with the page ──────────────────────── */}
      <div style={{display:"flex",justifyContent:"flex-end",padding:"4px 20px 0"}}>
        <button
          onClick={()=>setShowFilter(f=>!f)}
          style={{background:"none",border:"none",cursor:"pointer",padding:6,color:hasFilters?"#000":"#888"}}
          aria-label="Toggle filters"
        >
          <svg width="20" height="15" viewBox="0 0 20 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" overflow="visible">
            <line x1="0" y1="1.5"  x2="20" y2="1.5"/>
            <circle cx="5"  cy="1.5"  r="2.2" fill="#fff" stroke="currentColor" strokeWidth="1.6"/>
            <line x1="0" y1="7.5"  x2="20" y2="7.5"/>
            <circle cx="14" cy="7.5"  r="2.2" fill="#fff" stroke="currentColor" strokeWidth="1.6"/>
            <line x1="0" y1="13.5" x2="20" y2="13.5"/>
            <circle cx="9"  cy="13.5" r="2.2" fill="#fff" stroke="currentColor" strokeWidth="1.6"/>
          </svg>
        </button>
      </div>

      {outfits.length === 0 && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
          <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>NO OUTFITS — ADD MORE ITEMS TO YOUR CLOSET</p>
        </div>
      )}

      {outfits.length > 0 && filteredOutfits.length === 0 && (
        <div style={{position:"fixed",top:"38%",left:"50%",transform:"translate(-50%,-50%)",pointerEvents:"none",whiteSpace:"nowrap"}}>
          <p style={{...FONT,margin:0,fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>NO OUTFITS MATCH FILTERS</p>
        </div>
      )}

      {filteredOutfits.length > 0 && (
        <div ref={gridRef} style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",columnGap:20,rowGap:64,padding:`${gridPadV}px 28px ${Math.max(gridPadV, 120)}px`}}>
          {filteredOutfits.map((outfit, idx) => {
            const si         = sortItems(outfit.items);
            const score      = outfit.score;
            const ideal      = score != null && score >= IDEAL_THRESHOLD;
            const scoreColor = score==null?"#ccc":score>=75?"#1d9e52":score>=50?"#c88800":"#c83030";
            const colIdx     = idx % 3;
            const shiftX     = showFilter ? -(colIdx * 28) : 0;
            return (
              <div key={outfit.id} style={{
                display:"flex",flexDirection:"column",alignItems:"center",gap:8,
                transform:`translateX(${shiftX}px)`,
                transition:"transform .32s cubic-bezier(0.4,0,0.2,1)",
                willChange:"transform",
              }}>
                <div style={{width:"100%",height:SPREAD_H,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <div
                    ref={el => { if(el) stackRefs.current.set(idx,el as HTMLElement); else stackRefs.current.delete(idx); }}
                    onClick={() => phase==="gallery" && openOutfit(idx,filteredOutfits)}
                    style={{
                      position:"relative", width:SPREAD_W, height:SPREAD_H,
                      cursor:"pointer", background:"#fff",
                      opacity: phase!=="gallery" && activeIdx===idx ? 0 : 1,
                      transition:"none",
                    }}
                  >
                  <div style={{position:"absolute",inset:0,animation:"stackReveal 0.15s ease forwards"}}>
                    {si.map((item,i) => {
                      const isAcc = stackOrder(item) === 0;
                      return (
                        <div key={item.id} style={{
                          position:"absolute",inset:0,zIndex:si.length-i,
                          display:"flex",alignItems:"center",justifyContent:"center",
                        }}>
                          {item.image && <img src={item.image} alt="" style={{
                            maxWidth:isAcc?"55%":"100%",
                            maxHeight:isAcc?"55%":"100%",
                            objectFit:"contain",display:"block",
                            mixBlendMode:"multiply",
                          }}/>}
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>
                {ideal && (
                  <p style={{...FONT,margin:"12px 0 0",fontSize:12,fontWeight:700,letterSpacing:".06em",color:scoreColor}}>
                    {score} / 100
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      </div>{/* end content squish wrapper */}

      {/* Overlay */}
      {phase!=="gallery" && (
        <>
          <div style={{position:"fixed",inset:0,zIndex:200}}/>

          <div style={{position:"fixed",inset:0,zIndex:201,background:"#fff",
            opacity:bgVisible?1:0,transition:"opacity .3s ease",pointerEvents:"none"}}/>

          <div ref={overlayContainerRef} style={{
            position:"fixed",
            top:`calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
            left:"50%",
            width:containerW, height:containerH,
            transform:containerTransform,
            transition:containerTransitionOn?"transform .38s cubic-bezier(.4,0,.2,1)":"none",
            zIndex:202,
          }}>
            {items.map((item,i) => {
              const sp = getSpreadPos(i,N,posZoom,posVZoom);
              const dx = isSpread ? sp.left - stackLeft : 0;
              const dy = isSpread ? sp.top  - stackTop  : 0;
              const isAcc = stackOrder(item) === 0;
              return (
                <div key={`${displayIdx}-${item.id}`} style={{
                  position:"absolute",left:stackLeft,top:stackTop,
                  width:SPREAD_W,height:SPREAD_H,
                  zIndex:N-i,
                  transform:`translate(${dx}px,${dy}px)`,
                  transition:animateItems?"transform .28s ease-out":"none",
                }}>
                  <div style={{
                    position:"absolute",inset:0,
                    transform:`scale(${pieceZoom})`,
                    transition:"transform .35s ease",
                    display:"flex",alignItems:"center",justifyContent:"center",
                  }}>
                    {item.image && <img src={item.image} alt="" style={{
                      maxWidth:isAcc?"55%":"100%",
                      maxHeight:isAcc?"55%":"100%",
                      objectFit:"contain",display:"block",
                      mixBlendMode:"multiply",
                    }}/>}
                  </div>
                  {/* Item label — fades in when spread */}
                  <div style={{
                    position:"absolute",
                    top:SPREAD_H + 10,
                    left:"50%",transform:"translateX(-50%)",
                    width:SPREAD_W + 40,
                    textAlign:"center",
                    opacity:isSpread ? 1 : 0,
                    transition:"opacity .25s .1s",
                    pointerEvents:"none",
                  }}>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div style={{position:"fixed",inset:0,zIndex:203,pointerEvents:"none"}}>

            <button onClick={closeOverlay} style={{
              position:"absolute",top:20,right:22,background:"none",border:"none",
              cursor:"pointer",fontSize:22,color:"#000",lineHeight:1,padding:4,
              pointerEvents:"auto",...FONT,
              opacity:bgVisible?1:0,transition:"opacity .3s ease"}}>×</button>

            {current?.aesthetic ? (
              <p style={{
                position:"absolute",top:28,left:"50%",transform:"translateX(-50%)",
                margin:0,fontSize:11,color:"#000",letterSpacing:".04em",
                textAlign:"center",whiteSpace:"nowrap",
                opacity:isSpread?1:0,transition:"opacity .3s .1s",...FONT,
              }}>Aesthetic: {current.aesthetic}</p>
            ) : null}

            {isIdeal && (
              <p style={{
                position:"absolute",top:50,left:"50%",transform:"translateX(-50%)",
                margin:0,fontSize:22,fontWeight:700,letterSpacing:".06em",
                textAlign:"center",whiteSpace:"nowrap",
                color:currentScore!>=75?"#1d9e52":currentScore!>=50?"#c88800":"#c83030",
                opacity:isSpread?1:0,transition:"opacity .3s .15s",...FONT,
              }}>{currentScore} / 100</p>
            )}

            <button onClick={() => filteredOutfits.length>1 && navigateTo((displayIdx-1+filteredOutfits.length)%filteredOutfits.length,filteredOutfits)}
              style={{position:"absolute",left:18,top:"50%",transform:"translateY(-50%)",
                background:"none",border:"none",cursor:filteredOutfits.length>1?"pointer":"default",
                opacity:bgVisible&&filteredOutfits.length>1?1:0,transition:"opacity .2s",
                padding:"12px 10px",pointerEvents:"auto"}}>
              <svg width="14" height="23" viewBox="0 0 10 17"><polygon points="10,0 0,8.5 10,17" fill="#111"/></svg>
            </button>

            <button onClick={() => filteredOutfits.length>1 && navigateTo((displayIdx+1)%filteredOutfits.length,filteredOutfits)}
              style={{position:"absolute",right:18,top:"50%",transform:"translateY(-50%)",
                background:"none",border:"none",cursor:filteredOutfits.length>1?"pointer":"default",
                opacity:bgVisible&&filteredOutfits.length>1?1:0,transition:"opacity .2s",
                padding:"12px 10px",pointerEvents:"auto"}}>
              <svg width="14" height="23" viewBox="0 0 10 17"><polygon points="0,0 10,8.5 0,17" fill="#111"/></svg>
            </button>

          </div>

          {/* Pros/cons panels — only when there's actual content */}
          {bgVisible && isIdeal && (current?.pros ?? []).length > 0 && (
            <div style={{position:"fixed",top:`calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
              right:`calc(50% + ${panelOffset}px)`,transform:"translateY(-50%)",
              width:190,zIndex:204,textAlign:"center",
              opacity:isSpread?1:0,transition:"opacity .3s",...FONT}}>
              <p style={{fontSize:16,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",margin:"0 0 14px"}}>PROS</p>
              {current!.pros!.map((p,i)=><p key={i} style={{fontSize:19,color:"#2e7d32",lineHeight:1.5,margin:"0 0 10px"}}>{p}</p>)}
            </div>
          )}

          {bgVisible && isIdeal && (current?.cons ?? []).length > 0 && (
            <div style={{position:"fixed",top:`calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
              left:`calc(50% + ${panelOffset}px)`,transform:"translateY(-50%)",
              width:190,zIndex:204,textAlign:"center",
              opacity:isSpread?1:0,transition:"opacity .3s",...FONT}}>
              <p style={{fontSize:16,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",margin:"0 0 14px"}}>CONS</p>
              {current!.cons!.map((c,i)=><p key={i} style={{fontSize:19,color:"#c00",lineHeight:1.5,margin:"0 0 10px"}}>{c}</p>)}
            </div>
          )}
        </>
      )}
    </main>
  );
}
