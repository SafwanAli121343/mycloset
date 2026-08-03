"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// ── Constants (match outfits page exactly) ────────────────────────────────────
const FONT               = { fontFamily: "Arial, sans-serif" } as const;
const LOADING_IMG        = "/loading-tee.png";
const SPREAD_COL_GAP     = 28;
const ROW_GAP            = 28;
const SPREAD_W           = 120;
const SPREAD_H           = 190;
const SPREAD_SCALE       = 5;
const ITEMS_PER_ROW      = 3;
const OVERLAY_TOP_OFFSET = 50;

const KEYFRAMES = `
  @keyframes loadbar    { 0%{width:0%} 55%{width:65%} 80%{width:84%} 100%{width:93%} }
  @keyframes stackReveal{ from{opacity:0} to{opacity:1} }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
  id: string; brand: string; title: string;
  image_url: string; clean_image_url: string | null;
  category: string; sub_type: string | null;
  color_primary: string | null; aesthetic_tags: string[] | null;
  brand_tier: string | null; price_text: string | null;
  product_url: string | null;
};

type OutfitCombo = { id: string; items: Product[] };
type Section     = { aesthetic: string; label: string; outfits: OutfitCombo[] };

type SpreadCfg = { containerW: number; containerH: number; stackLeft: number; stackTop: number };

// ── Stack helpers (identical to outfits page) ─────────────────────────────────

function stackOrder(item: { category: string; sub_type: string | null }): number {
  switch ((item.category ?? "").toLowerCase()) {
    case "accessory": return 0;
    case "footwear":  return 1;
    case "top":       return 2;
    case "outerwear": return 3;
    case "bottom":    return 4;
  }
  const s = (item.sub_type ?? "").toLowerCase();
  if (["ring","watch","bracelet","chain","necklace","earring","bag","hat","cap","beanie","belt","scarf","glasses","sunglass"].some(k=>s.includes(k))) return 0;
  if (["shoe","boot","sneaker","loafer","sandal","slide","oxford","derby","mule"].some(k=>s.includes(k))) return 1;
  if (["jacket","coat","blazer","bomber","cardigan"].some(k=>s.includes(k))) return 3;
  if (["pant","jean","trouser","chino","short","skirt","legging"].some(k=>s.includes(k))) return 4;
  return 2;
}
function sortItems(items: Product[]) { return [...items].sort((a,b)=>stackOrder(a)-stackOrder(b)); }

function getSpreadPos(i: number, total: number, zoom=1, vZoom=zoom): {left:number;top:number} {
  const step    = zoom  * (SPREAD_W + SPREAD_COL_GAP);
  const rowStep = vZoom * (SPREAD_H + ROW_GAP);
  const rowIdx  = Math.floor(i / ITEMS_PER_ROW);
  const colIdx  = i % ITEMS_PER_ROW;
  const top     = rowIdx * rowStep;
  const numFullRows = Math.floor(total / ITEMS_PER_ROW);
  const remainder   = total % ITEMS_PER_ROW;
  const isLastRow   = rowIdx === numFullRows && remainder > 0;
  const itemsInRow  = isLastRow ? remainder : ITEMS_PER_ROW;
  if (itemsInRow === ITEMS_PER_ROW) return { left: colIdx * step, top };
  if (itemsInRow === 1) return { left: step, top };
  return { left: (colIdx + 0.5) * step, top };
}

function buildSpreadCfg(N: number, zoom=1, vZoom=zoom): SpreadCfg {
  const step    = zoom  * (SPREAD_W + SPREAD_COL_GAP);
  const rowStep = vZoom * (SPREAD_H + ROW_GAP);
  const numRows = Math.max(1, Math.ceil(N / ITEMS_PER_ROW));
  const containerW = (ITEMS_PER_ROW - 1) * step + SPREAD_W;
  const containerH = (numRows - 1) * rowStep + SPREAD_H;
  return { containerW, containerH, stackLeft: (containerW - SPREAD_W)/2, stackTop: (containerH - SPREAD_H)/2 };
}

function computeSafeScale(cH: number, cW: number, vh: number, vw: number) {
  return Math.min(SPREAD_SCALE, Math.max(0.5,(vh-160)/cH), Math.max(0.5,vw/cW));
}
function spreadZoom(N: number)  { return Math.ceil(N/ITEMS_PER_ROW)>=3 ? 1.55 : 1.85; }
function vSpreadZoom(N: number) { return Math.ceil(N/ITEMS_PER_ROW)>=3 ? 1.32 : 1.85; }

const DEFAULT_CFG = buildSpreadCfg(3);

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InspoPage() {
  const [sections,   setSections]   = useState<Section[]>([]);
  const [allOutfits, setAllOutfits] = useState<OutfitCombo[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [searchQ,    setSearchQ]    = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [filterState, setFilterState] = useState({
    aesthetics: [] as string[], brand: "", color: "", brandTier: "",
  });

  // ── Overlay state (identical to outfits page) ─────────────────────────────
  const [phase,                setPhase]                = useState<"gallery"|"overlay">("gallery");
  const [bgVisible,            setBgVisible]            = useState(false);
  const [isSpread,             setIsSpread]             = useState(false);
  const [animateItems,         setAnimateItems]         = useState(false);
  const [activeIdx,            setActiveIdx]            = useState(0);
  const [displayIdx,           setDisplayIdx]           = useState(0);
  const [navFading,            setNavFading]            = useState(false);
  const [spreadCfg,            setSpreadCfg]            = useState<SpreadCfg>(DEFAULT_CFG);
  const [containerTransform,   setContainerTransform]   = useState("translate(0px,0px) scale(1)");
  const [containerTransitionOn,setContainerTransitionOn]= useState(false);
  const [pieceZoom,            setPieceZoom]            = useState(1);

  const stackRefs          = useRef<Map<number, HTMLElement>>(new Map());
  const timerRef           = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const activeIdxRef       = useRef(0);
  const containerWRef      = useRef(DEFAULT_CFG.containerW);
  const containerHRef      = useRef(DEFAULT_CFG.containerH);
  const overlayContainerRef= useRef<HTMLDivElement>(null);
  const rAFIdRef           = useRef(0);
  const globalSafeScaleRef = useRef(SPREAD_SCALE);

  const today = new Date().toISOString().slice(0, 10);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadSections = useCallback(async (params?: URLSearchParams) => {
    setLoading(true);
    const p = params ?? new URLSearchParams({ date: today });
    try {
      const res = await fetch(`/api/discover/outfits?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();

      if (d.mode === "sections") {
        const secs: Section[] = d.sections ?? [];
        setSections(secs);
        const flat = secs.flatMap(s => s.outfits);
        setAllOutfits(flat);

        if (flat.length > 0) {
          const maxN = Math.max(...flat.map(o => o.items.length));
          const cfg = buildSpreadCfg(maxN);
          globalSafeScaleRef.current = computeSafeScale(
            cfg.containerH, cfg.containerW,
            document.documentElement.clientHeight,
            document.documentElement.clientWidth,
          );
        }
      } else {
        const outfits: OutfitCombo[] = d.outfits ?? [];
        const fakeSec: Section = { aesthetic: "filtered", label: d.label ?? "Results", outfits };
        setSections([fakeSec]);
        setAllOutfits(outfits);
      }
    } catch { /* stay with whatever we have */ }
    setLoading(false);
  }, [today]);

  useEffect(() => { loadSections(); }, [loadSections]);

  const runFilter = useCallback(() => {
    const p = new URLSearchParams({ date: today });
    if (searchQ.trim()) p.set("q", searchQ.trim());
    if (filterState.aesthetics.length) p.set("aesthetic", filterState.aesthetics.join(","));
    if (filterState.brand) p.set("brand", filterState.brand);
    if (filterState.color) p.set("color", filterState.color);
    if (filterState.brandTier) p.set("brand_tier", filterState.brandTier);
    loadSections(p);
  }, [today, searchQ, filterState, loadSections]);

  const clearFilters = useCallback(() => {
    setSearchQ("");
    setFilterState({ aesthetics: [], brand: "", color: "", brandTier: "" });
    loadSections();
  }, [loadSections]);

  // ── Animation logic (identical to outfits page) ───────────────────────────

  const openOutfit = useCallback((idx: number) => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(rAFIdRef.current);
    if (overlayContainerRef.current) {
      overlayContainerRef.current.style.transition = "";
      overlayContainerRef.current.style.transform  = "";
    }
    const el = stackRefs.current.get(idx);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const cx  = rect.left + rect.width  / 2;
    const cy  = rect.top  + rect.height / 2;

    const si  = sortItems(allOutfits[idx]?.items ?? []);
    const cfg = buildSpreadCfg(si.length, spreadZoom(si.length), vSpreadZoom(si.length));

    const galleryTx = cx - vw/2 - cfg.containerW/2;
    const galleryTy = cy - (vh/2 - OVERLAY_TOP_OFFSET) - cfg.containerH/2;
    const centerTx  = -cfg.containerW/2;
    const centerTy  = -cfg.containerH/2;

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
      setContainerTransitionOn(true);
      setContainerTransform(`translate(${centerTx}px,${centerTy}px) scale(1)`);
      setBgVisible(true);
      timerRef.current = setTimeout(() => {
        setPieceZoom(1.85);
        timerRef.current = setTimeout(() => {
          setAnimateItems(true); setIsSpread(true);
          timerRef.current = setTimeout(() => setAnimateItems(false), 350);
        }, 400);
      }, 420);
    }, 100);
  }, [allOutfits]);

  const closeOverlay = useCallback(() => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(rAFIdRef.current);
    setAnimateItems(true); setIsSpread(false);

    timerRef.current = setTimeout(() => {
      setAnimateItems(false); setPieceZoom(1);
      timerRef.current = setTimeout(() => {
        setBgVisible(false);
        timerRef.current = setTimeout(() => {
          setContainerTransitionOn(false);
          const el = stackRefs.current.get(activeIdxRef.current);
          const vw = document.documentElement.clientWidth;
          const vh = document.documentElement.clientHeight;
          const cW = containerWRef.current;
          const cH = containerHRef.current;
          const c  = overlayContainerRef.current;
          let startTx = -cW/2, startTy = -cH/2, startScale = SPREAD_SCALE;
          if (c) {
            const m = new DOMMatrix(window.getComputedStyle(c).transform);
            startTx = m.m41; startTy = m.m42; startScale = m.m11;
            c.style.transition = "none";
            c.style.transform  = `translate(${startTx}px,${startTy}px) scale(${startScale})`;
          }
          let initTx = startTx, initTy = startTy, FAR = false;
          if (el) {
            const r = el.getBoundingClientRect();
            initTx = r.left + r.width/2 - vw/2 - cW/2;
            initTy = r.top  + r.height/2 - (vh/2 - OVERLAY_TOP_OFFSET) - cH/2;
            FAR = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
          }
          const rawDx = initTx - startTx, rawDy = initTy - startTy;
          const initDist = Math.sqrt(rawDx*rawDx + rawDy*rawDy);
          let fixTx = initTx, fixTy = initTy;
          if (FAR && initDist > 0) {
            const vSign = rawDy >= 0 ? 1 : -1;
            const vVirt = vh * 0.6 * vSign;
            const dDist = Math.sqrt(rawDx*rawDx + vVirt*vVirt);
            const ndx = dDist>0?rawDx/dDist:0, ndy = dDist>0?vVirt/dDist:vSign;
            const sx = vw/2+startTx, sy = vh/2-OVERLAY_TOP_OFFSET+startTy;
            const PAD = 30;
            const cands: number[] = [];
            if (ndx>0) cands.push((vw+PAD-sx)/ndx);
            if (ndx<0) cands.push((-cW-PAD-sx)/ndx);
            if (ndy>0) cands.push((vh+PAD-sy)/ndy);
            if (ndy<0) cands.push((-cH-PAD-sy)/ndy);
            const exitD = Math.min(...cands.filter(v=>v>0), initDist);
            fixTx = startTx+ndx*exitD; fixTy = startTy+ndy*exitD;
          }
          const DUR = 380; let startTime = -1;
          const tick = (ts: number) => {
            if (startTime < 0) startTime = ts;
            const t     = Math.min((ts-startTime)/DUR, 1);
            const eased = t < 1 ? 1-Math.pow(1-t,3) : 1;
            let targetTx = initTx, targetTy = initTy;
            if (!FAR && el) {
              const r = el.getBoundingClientRect();
              targetTx = r.left+r.width/2-vw/2-cW/2;
              targetTy = r.top+r.height/2-(vh/2-OVERLAY_TOP_OFFSET)-cH/2;
            } else if (FAR) { targetTx = fixTx; targetTy = fixTy; }
            const tx = startTx+(targetTx-startTx)*eased;
            const ty = startTy+(targetTy-startTy)*eased;
            const sc = startScale+(1-startScale)*eased;
            if (c) { c.style.transition="none"; c.style.transform=`translate(${tx}px,${ty}px) scale(${sc})`; }
            if (t<1) { rAFIdRef.current = requestAnimationFrame(tick); }
            else { requestAnimationFrame(() => setPhase("gallery")); }
          };
          rAFIdRef.current = requestAnimationFrame(tick);
        }, 350);
      }, 400);
    }, 300);
  }, []);

  const navigateTo = useCallback((newIdx: number) => {
    if (navFading) return;
    setNavFading(true);
    setAnimateItems(true); setIsSpread(false);
    timerRef.current = setTimeout(() => {
      const n = sortItems(allOutfits[newIdx]?.items ?? []).length;
      const cfg = buildSpreadCfg(n, spreadZoom(n), vSpreadZoom(n));
      setSpreadCfg(cfg);
      containerWRef.current = cfg.containerW;
      containerHRef.current = cfg.containerH;
      activeIdxRef.current  = newIdx;
      setContainerTransitionOn(false);
      setContainerTransform(`translate(${-cfg.containerW/2}px,${-cfg.containerH/2}px) scale(1)`);
      setDisplayIdx(newIdx); setActiveIdx(newIdx);
      timerRef.current = setTimeout(() => {
        setIsSpread(true);
        timerRef.current = setTimeout(() => { setAnimateItems(false); setNavFading(false); }, 300);
      }, 30);
    }, 300);
  }, [navFading, allOutfits]);

  // ── Overlay derived state ─────────────────────────────────────────────────

  const current    = allOutfits[displayIdx] ?? null;
  const items      = current ? sortItems(current.items) : [];
  const N          = items.length;
  const posZoom    = spreadZoom(N);
  const posVZoom   = vSpreadZoom(N);
  const { containerW, containerH, stackLeft, stackTop } = spreadCfg;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading && sections.length === 0) return (
    <main style={{...FONT,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#fff"}}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:160}}>
        <img src={LOADING_IMG} alt="" draggable={false} style={{width:270,height:340,objectFit:"contain",opacity:.88}}/>
        <div style={{width:190,height:5,background:"#e8e8e8",overflow:"hidden",marginTop:-88}}>
          <div style={{height:"100%",background:"#111",animation:"loadbar 4s ease-out forwards"}}/>
        </div>
      </div>
    </main>
  );

  const hasFilters = filterState.aesthetics.length>0 || filterState.brand || filterState.color || filterState.brandTier;

  const AESTHETICS = [
    "streetwear","gorpcore","old-money","preppy","quiet-luxury","minimalist",
    "techwear","workwear","athleisure","vintage","grunge","skate","y2k","90s",
    "normcore","hype-streetwear","western","punk","indie-sleaze",
  ];
  const TIERS = ["budget","mid","premium","luxury"];

  return (
    <main style={{...FONT,minHeight:"100vh",background:"#fff"}}>
      <style suppressHydrationWarning>{KEYFRAMES}</style>

      {/* ── Top bar: search + filter ─────────────────────────────────────── */}
      <div style={{
        position:"sticky",top:0,zIndex:50,background:"#fff",
        borderBottom:"1px solid #e8e8e8",padding:"12px 24px",
        display:"flex",gap:10,alignItems:"center",
      }}>
        <form
          onSubmit={e=>{e.preventDefault(); runFilter();}}
          style={{display:"flex",flex:1,gap:8,alignItems:"center"}}
        >
          <input
            value={searchQ}
            onChange={e=>setSearchQ(e.target.value)}
            placeholder="Search outfits, brands, aesthetics…"
            style={{
              flex:1,height:36,padding:"0 12px",
              border:"1px solid #d0d0d0",borderRadius:4,
              fontSize:13,...FONT,outline:"none",
            }}
          />
          <button type="submit" style={{
            height:36,padding:"0 16px",background:"#000",color:"#fff",
            border:"none",borderRadius:4,fontSize:12,letterSpacing:".08em",
            cursor:"pointer",...FONT,
          }}>SEARCH</button>
        </form>
        <button
          onClick={()=>setShowFilter(f=>!f)}
          style={{
            height:36,padding:"0 16px",
            border:`1px solid ${hasFilters?"#000":"#d0d0d0"}`,borderRadius:4,
            background:hasFilters?"#000":"#fff",
            color:hasFilters?"#fff":"#555",
            fontSize:12,letterSpacing:".08em",cursor:"pointer",...FONT,
            whiteSpace:"nowrap",
          }}
        >
          FILTER{hasFilters?` (${filterState.aesthetics.length+(filterState.brand?1:0)+(filterState.color?1:0)+(filterState.brandTier?1:0)})`:""}
        </button>
        {(hasFilters||searchQ) && (
          <button onClick={clearFilters} style={{
            height:36,padding:"0 12px",border:"1px solid #d0d0d0",borderRadius:4,
            background:"#fff",color:"#999",fontSize:12,cursor:"pointer",...FONT,
          }}>CLEAR</button>
        )}
      </div>

      {/* ── Filter panel ────────────────────────────────────────────────────── */}
      {showFilter && (
        <div style={{
          borderBottom:"1px solid #e8e8e8",padding:"20px 24px",
          display:"flex",flexDirection:"column",gap:18,background:"#fafafa",
        }}>
          {/* Aesthetics */}
          <div>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#999",margin:"0 0 10px"}}>AESTHETIC</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {AESTHETICS.map(a=>(
                <button key={a} onClick={()=>setFilterState(p=>({
                  ...p,aesthetics:p.aesthetics.includes(a)?p.aesthetics.filter(x=>x!==a):[...p.aesthetics,a]
                }))} style={{
                  padding:"5px 12px",borderRadius:20,
                  border:`1px solid ${filterState.aesthetics.includes(a)?"#000":"#d0d0d0"}`,
                  background:filterState.aesthetics.includes(a)?"#000":"#fff",
                  color:filterState.aesthetics.includes(a)?"#fff":"#555",
                  fontSize:12,cursor:"pointer",...FONT,
                }}>{a}</button>
              ))}
            </div>
          </div>
          {/* Brand tier */}
          <div>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#999",margin:"0 0 10px"}}>BRAND TIER</p>
            <div style={{display:"flex",gap:8}}>
              {TIERS.map(t=>(
                <button key={t} onClick={()=>setFilterState(p=>({...p,brandTier:p.brandTier===t?"":t}))} style={{
                  padding:"6px 16px",borderRadius:4,
                  border:`1px solid ${filterState.brandTier===t?"#000":"#d0d0d0"}`,
                  background:filterState.brandTier===t?"#000":"#fff",
                  color:filterState.brandTier===t?"#fff":"#555",
                  fontSize:12,cursor:"pointer",...FONT,
                }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
              ))}
            </div>
          </div>
          {/* Brand + color text inputs */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,maxWidth:480}}>
            {[["BRAND","brand","e.g. Nike, Supreme…"],["COLOR","color","e.g. Olive, Black…"]].map(([lbl,key,ph])=>(
              <div key={key}>
                <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#999",margin:"0 0 6px"}}>{lbl}</p>
                <input
                  value={filterState[key as "brand"|"color"]}
                  onChange={e=>setFilterState(p=>({...p,[key]:e.target.value}))}
                  placeholder={ph}
                  style={{width:"100%",height:34,padding:"0 10px",border:"1px solid #d0d0d0",borderRadius:4,fontSize:13,...FONT,outline:"none"}}
                />
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{runFilter();setShowFilter(false);}} style={{
              height:36,padding:"0 24px",background:"#000",color:"#fff",
              border:"none",borderRadius:4,fontSize:12,letterSpacing:".08em",cursor:"pointer",...FONT,
            }}>APPLY</button>
            {hasFilters&&<button onClick={clearFilters} style={{
              height:36,padding:"0 16px",border:"1px solid #d0d0d0",borderRadius:4,
              background:"#fff",color:"#999",fontSize:12,cursor:"pointer",...FONT,
            }}>RESET</button>}
          </div>
        </div>
      )}

      {/* ── Sections ─────────────────────────────────────────────────────────── */}
      <div style={{padding:"0 0 120px"}}>
        {loading && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"80px 0"}}>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>LOADING…</p>
          </div>
        )}

        {!loading && sections.length === 0 && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"80px 0"}}>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>NO OUTFITS FOUND</p>
          </div>
        )}

        {sections.map(section=>{
          const sectionOutfits = section.outfits;
          return (
            <div key={section.aesthetic} style={{marginTop:48,paddingLeft:24,paddingRight:24}}>
              {/* Section header */}
              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:20}}>
                <p style={{...FONT,margin:0,fontSize:10,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",color:"#000"}}>
                  {section.label}
                </p>
              </div>

              {/* Horizontal scroll row */}
              <OutfitRow
                outfits={sectionOutfits}
                allOutfits={allOutfits}
                phase={phase}
                activeIdx={activeIdx}
                stackRefs={stackRefs}
                onOpen={openOutfit}
              />
            </div>
          );
        })}
      </div>

      {/* ── Overlay (identical to outfits page) ──────────────────────────────── */}
      {phase!=="gallery" && (
        <>
          <div style={{position:"fixed",inset:0,zIndex:200}} onClick={closeOverlay}/>

          <div style={{
            position:"fixed",inset:0,zIndex:201,background:"#fff",
            opacity:bgVisible?1:0,transition:"opacity .3s ease",pointerEvents:"none",
          }}/>

          <div ref={overlayContainerRef} style={{
            position:"fixed",
            top:`calc(50% - ${OVERLAY_TOP_OFFSET}px)`,left:"50%",
            width:containerW,height:containerH,
            transform:containerTransform,
            transition:containerTransitionOn?"transform .38s cubic-bezier(.4,0,.2,1)":"none",
            zIndex:202,
          }}>
            {items.map((item,i)=>{
              const sp = getSpreadPos(i,N,posZoom,posVZoom);
              const dx = isSpread ? sp.left-stackLeft : 0;
              const dy = isSpread ? sp.top-stackTop   : 0;
              const isAcc = stackOrder(item)===0;
              const imgSrc = item.clean_image_url ?? item.image_url;
              return (
                <div key={`${displayIdx}-${item.id}`} style={{
                  position:"absolute",left:stackLeft,top:stackTop,
                  width:SPREAD_W,height:SPREAD_H,zIndex:N-i,
                  transform:`translate(${dx}px,${dy}px)`,
                  transition:"transform .28s ease-out",
                }}>
                  <div style={{
                    position:"absolute",inset:0,
                    transform:`scale(${pieceZoom})`,
                    transition:"transform .35s ease",
                    display:"flex",alignItems:"center",justifyContent:"center",
                  }}>
                    {imgSrc && <img src={imgSrc} alt="" style={{
                      maxWidth:isAcc?"55%":"100%",maxHeight:isAcc?"55%":"100%",
                      objectFit:"contain",display:"block",
                      mixBlendMode:"multiply",
                    }}/>}
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
            }}>×</button>

            {/* Outfit info */}
            {bgVisible && current && (
              <p style={{
                position:"absolute",top:28,left:"50%",transform:"translateX(-50%)",
                margin:0,fontSize:10,fontWeight:700,letterSpacing:".18em",
                textTransform:"uppercase",textAlign:"center",whiteSpace:"nowrap",color:"#000",
                opacity:isSpread?1:0,transition:"opacity .3s .15s",...FONT,
              }}>{current.items.map(i=>i.brand).filter((b,i,a)=>a.indexOf(b)===i).join(" · ")}</p>
            )}

            <button
              onClick={()=>allOutfits.length>1 && navigateTo((displayIdx-1+allOutfits.length)%allOutfits.length)}
              style={{
                position:"absolute",left:18,top:"50%",transform:"translateY(-50%)",
                background:"none",border:"none",
                cursor:allOutfits.length>1?"pointer":"default",
                opacity:bgVisible&&allOutfits.length>1?1:0,transition:"opacity .2s",
                padding:"12px 10px",pointerEvents:"auto",
              }}>
              <svg width="14" height="23" viewBox="0 0 10 17"><polygon points="10,0 0,8.5 10,17" fill="#111"/></svg>
            </button>

            <button
              onClick={()=>allOutfits.length>1 && navigateTo((displayIdx+1)%allOutfits.length)}
              style={{
                position:"absolute",right:18,top:"50%",transform:"translateY(-50%)",
                background:"none",border:"none",
                cursor:allOutfits.length>1?"pointer":"default",
                opacity:bgVisible&&allOutfits.length>1?1:0,transition:"opacity .2s",
                padding:"12px 10px",pointerEvents:"auto",
              }}>
              <svg width="14" height="23" viewBox="0 0 10 17"><polygon points="0,0 10,8.5 0,17" fill="#111"/></svg>
            </button>
          </div>
        </>
      )}
    </main>
  );
}

// ── Outfit row (horizontal scroll) ────────────────────────────────────────────

type OutfitRowProps = {
  outfits: OutfitCombo[];
  allOutfits: OutfitCombo[];
  phase: "gallery" | "overlay";
  activeIdx: number;
  stackRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  onOpen: (globalIdx: number) => void;
};

function OutfitRow({ outfits, allOutfits, phase, activeIdx, stackRefs, onOpen }: OutfitRowProps) {
  const rowRef  = useRef<HTMLDivElement>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(true);

  const checkScroll = () => {
    const el = rowRef.current;
    if (!el) return;
    setCanL(el.scrollLeft > 8);
    setCanR(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };

  useEffect(() => { checkScroll(); }, [outfits]);

  const scroll = (dir: "left"|"right") => {
    rowRef.current?.scrollBy({ left: dir==="left"?-500:500, behavior:"smooth" });
  };

  return (
    <div style={{position:"relative"}}>
      {canL && (
        <button
          onClick={()=>scroll("left")}
          style={{
            position:"absolute",left:-16,top:"50%",transform:"translateY(-50%)",
            zIndex:10,width:32,height:32,borderRadius:"50%",
            background:"#fff",border:"1px solid #ddd",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 2px 8px rgba(0,0,0,.12)",
          }}
        >
          <svg width="10" height="17" viewBox="0 0 10 17"><polygon points="10,0 0,8.5 10,17" fill="#555"/></svg>
        </button>
      )}
      <div
        ref={rowRef}
        onScroll={checkScroll}
        style={{
          display:"flex",gap:28,overflowX:"auto",paddingBottom:8,
          scrollSnapType:"x mandatory",
          msOverflowStyle:"none",scrollbarWidth:"none",
        }}
      >
        {outfits.map(outfit => {
          const globalIdx = allOutfits.findIndex(o=>o.id===outfit.id);
          const si = sortItems(outfit.items);
          return (
            <div
              key={outfit.id}
              style={{flexShrink:0,scrollSnapAlign:"start",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}
            >
              <div style={{width:SPREAD_W,height:SPREAD_H,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div
                  ref={el=>{
                    if (el) stackRefs.current.set(globalIdx, el);
                    else stackRefs.current.delete(globalIdx);
                  }}
                  onClick={()=>phase==="gallery"&&globalIdx>=0&&onOpen(globalIdx)}
                  style={{
                    position:"relative",width:SPREAD_W,height:SPREAD_H,
                    cursor:"pointer",background:"#fff",
                    opacity:phase!=="gallery"&&activeIdx===globalIdx?0:1,
                    transition:"none",
                  }}
                >
                  <div style={{position:"absolute",inset:0,animation:"stackReveal 0.15s ease forwards"}}>
                    {si.map((item,i)=>{
                      const isAcc = stackOrder(item)===0;
                      const imgSrc = item.clean_image_url ?? item.image_url;
                      return (
                        <div key={item.id} style={{
                          position:"absolute",inset:0,zIndex:si.length-i,
                          display:"flex",alignItems:"center",justifyContent:"center",
                        }}>
                          {imgSrc && <img src={imgSrc} alt="" style={{
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
              {/* Brand labels */}
              <p style={{...FONT,margin:0,fontSize:10,color:"#aaa",textAlign:"center",letterSpacing:".04em",maxWidth:SPREAD_W,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {[...new Set(outfit.items.map(i=>i.brand))].join(" · ")}
              </p>
            </div>
          );
        })}
      </div>
      {canR && (
        <button
          onClick={()=>scroll("right")}
          style={{
            position:"absolute",right:-16,top:"50%",transform:"translateY(-50%)",
            zIndex:10,width:32,height:32,borderRadius:"50%",
            background:"#fff",border:"1px solid #ddd",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 2px 8px rgba(0,0,0,.12)",
          }}
        >
          <svg width="10" height="17" viewBox="0 0 10 17"><polygon points="0,0 10,8.5 0,17" fill="#555"/></svg>
        </button>
      )}
    </div>
  );
}
