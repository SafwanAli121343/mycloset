"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FONT   = { fontFamily: "Arial, sans-serif" } as const;
const CARD_W = 140;
const CARD_H = 185;

type Item = {
  id: string; brand: string; title: string;
  image_url: string; clean_image_url: string | null;
  category: string; sub_type: string | null;
  color_primary: string | null; color_secondary: string | null;
  aesthetic_tags: string[] | null; brand_tier: string | null;
  price_text: string | null; product_url: string | null;
};
type Section = { title: string; subtitle?: string; items: Item[] };

export default function DiscoverPage() {
  const [sections,   setSections]   = useState<Section[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [searchQ,    setSearchQ]    = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [filterState, setFilterState] = useState({
    aesthetics: [] as string[], brand: "", color: "", category: "", sort: "default",
  });

  const today = new Date().toISOString().slice(0, 10);

  const loadSections = useCallback(async (params?: URLSearchParams) => {
    setLoading(true);
    const p = params ?? new URLSearchParams({ date: today });
    try {
      const res = await fetch(`/api/discover/items?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.mode === "sections") {
        setSections(d.sections ?? []);
      } else {
        setSections([{ title: d.label ?? "Results", items: d.items ?? [] }]);
      }
    } catch { /* stay */ }
    setLoading(false);
  }, [today]);

  useEffect(() => { loadSections(); }, [loadSections]);

  const runFilter = useCallback(() => {
    const p = new URLSearchParams({ date: today });
    if (searchQ.trim()) p.set("q", searchQ.trim());
    if (filterState.aesthetics.length) p.set("aesthetic", filterState.aesthetics.join(","));
    if (filterState.brand)    p.set("brand", filterState.brand);
    if (filterState.color)    p.set("color", filterState.color);
    if (filterState.category) p.set("category", filterState.category);
    if (filterState.sort !== "default") p.set("sort", filterState.sort);
    loadSections(p);
  }, [today, searchQ, filterState, loadSections]);

  const clearFilters = useCallback(() => {
    setSearchQ("");
    setFilterState({ aesthetics: [], brand: "", color: "", category: "", sort: "default" });
    loadSections();
  }, [loadSections]);

  const hasFilters = filterState.aesthetics.length > 0 || !!filterState.brand || !!filterState.color || !!filterState.category || filterState.sort !== "default";

  const AESTHETICS = [
    "streetwear","gorpcore","old-money","preppy","quiet-luxury","minimalist",
    "techwear","workwear","athleisure","vintage","grunge","skate","y2k","90s",
    "normcore","hype-streetwear","western","punk","indie-sleaze",
  ];
  const CATEGORIES = ["top","bottom","outerwear","footwear","accessory"];
  const SORTS = [
    { value: "default",   label: "Default" },
    { value: "name_asc",  label: "A → Z" },
    { value: "name_desc", label: "Z → A" },
    { value: "brand",     label: "Brand" },
  ];

  return (
    <main style={{...FONT,minHeight:"100vh",background:"#fff"}}>
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
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
            placeholder="Search items, brands, sub-types…"
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
          {`FILTER${hasFilters ? ` (${[filterState.aesthetics.length > 0, !!filterState.brand, !!filterState.color, !!filterState.category, filterState.sort !== "default"].filter(Boolean).length})` : ""}`}
        </button>
        {(hasFilters || searchQ) && (
          <button onClick={clearFilters} style={{
            height:36,padding:"0 12px",border:"1px solid #d0d0d0",borderRadius:4,
            background:"#fff",color:"#999",fontSize:12,cursor:"pointer",...FONT,
          }}>CLEAR</button>
        )}
      </div>

      {/* ── Filter panel ──────────────────────────────────────────────────────── */}
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
          {/* Category */}
          <div>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#999",margin:"0 0 10px"}}>CATEGORY</p>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {CATEGORIES.map(c=>(
                <button key={c} onClick={()=>setFilterState(p=>({...p,category:p.category===c?"":c}))} style={{
                  padding:"6px 14px",borderRadius:4,
                  border:`1px solid ${filterState.category===c?"#000":"#d0d0d0"}`,
                  background:filterState.category===c?"#000":"#fff",
                  color:filterState.category===c?"#fff":"#555",
                  fontSize:12,cursor:"pointer",...FONT,
                }}>{c.charAt(0).toUpperCase()+c.slice(1)}</button>
              ))}
            </div>
          </div>
          {/* Sort */}
          <div>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#999",margin:"0 0 10px"}}>SORT</p>
            <div style={{display:"flex",gap:8}}>
              {SORTS.map(s=>(
                <button key={s.value} onClick={()=>setFilterState(p=>({...p,sort:s.value}))} style={{
                  padding:"6px 14px",borderRadius:4,
                  border:`1px solid ${filterState.sort===s.value?"#000":"#d0d0d0"}`,
                  background:filterState.sort===s.value?"#000":"#fff",
                  color:filterState.sort===s.value?"#fff":"#555",
                  fontSize:12,cursor:"pointer",...FONT,
                }}>{s.label}</button>
              ))}
            </div>
          </div>
          {/* Brand + color */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,maxWidth:480}}>
            {([ ["BRAND","brand","e.g. Nike, Supreme…"],["COLOR","color","e.g. Olive, Black…"] ] as [string,"brand"|"color",string][]).map(([lbl,key,ph])=>(
              <div key={key}>
                <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#999",margin:"0 0 6px"}}>{lbl}</p>
                <input
                  value={filterState[key]}
                  onChange={e=>setFilterState(p=>({...p,[key]:e.target.value}))}
                  placeholder={ph}
                  style={{width:"100%",height:34,padding:"0 10px",border:"1px solid #d0d0d0",borderRadius:4,fontSize:13,...FONT,outline:"none",boxSizing:"border-box"}}
                />
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{runFilter();setShowFilter(false);}} style={{
              height:36,padding:"0 24px",background:"#000",color:"#fff",
              border:"none",borderRadius:4,fontSize:12,letterSpacing:".08em",cursor:"pointer",...FONT,
            }}>APPLY</button>
            {hasFilters && (
              <button onClick={clearFilters} style={{
                height:36,padding:"0 16px",border:"1px solid #d0d0d0",borderRadius:4,
                background:"#fff",color:"#999",fontSize:12,cursor:"pointer",...FONT,
              }}>RESET</button>
            )}
          </div>
        </div>
      )}

      {/* ── Sections ──────────────────────────────────────────────────────────── */}
      <div style={{padding:"0 0 120px"}}>
        {loading && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"80px 0"}}>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>LOADING…</p>
          </div>
        )}

        {!loading && sections.length === 0 && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"80px 0"}}>
            <p style={{fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"#bbb"}}>NO ITEMS FOUND</p>
          </div>
        )}

        {sections.map(section=>(
          <div key={section.title} style={{marginTop:48,paddingLeft:24,paddingRight:24}}>
            <div style={{marginBottom:20}}>
              <p style={{...FONT,margin:0,fontSize:10,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",color:"#000"}}>
                {section.title}
              </p>
              {section.subtitle && (
                <p style={{...FONT,margin:"4px 0 0",fontSize:11,color:"#aaa",letterSpacing:".04em"}}>
                  {section.subtitle}
                </p>
              )}
            </div>
            <ItemRow items={section.items} />
          </div>
        ))}
      </div>
    </main>
  );
}

// ── Item row ──────────────────────────────────────────────────────────────────

function ItemRow({ items }: { items: Item[] }) {
  const rowRef  = useRef<HTMLDivElement>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(true);

  const checkScroll = () => {
    const el = rowRef.current;
    if (!el) return;
    setCanL(el.scrollLeft > 8);
    setCanR(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };

  useEffect(() => { checkScroll(); }, [items]);

  const scroll = (dir: "left"|"right") => {
    rowRef.current?.scrollBy({ left: dir==="left"?-520:520, behavior:"smooth" });
  };

  return (
    <div style={{position:"relative"}}>
      {canL && (
        <button onClick={()=>scroll("left")} style={{
          position:"absolute",left:-16,top:CARD_H/2-16,zIndex:10,
          width:32,height:32,borderRadius:"50%",
          background:"#fff",border:"1px solid #ddd",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",
          boxShadow:"0 2px 8px rgba(0,0,0,.12)",
        }}>
          <svg width="10" height="17" viewBox="0 0 10 17"><polygon points="10,0 0,8.5 10,17" fill="#555"/></svg>
        </button>
      )}
      <div
        ref={rowRef}
        onScroll={checkScroll}
        style={{
          display:"flex",gap:16,overflowX:"auto",paddingBottom:8,
          scrollSnapType:"x mandatory",
          msOverflowStyle:"none",scrollbarWidth:"none",
        }}
      >
        {items.map(item=>{
          const imgSrc = item.clean_image_url ?? item.image_url;
          return (
            <div
              key={item.id}
              onClick={()=>{ if(item.product_url) window.open(item.product_url,"_blank"); }}
              style={{
                flexShrink:0,scrollSnapAlign:"start",
                display:"flex",flexDirection:"column",gap:8,
                cursor:item.product_url?"pointer":"default",
              }}
            >
              <div style={{
                width:CARD_W,height:CARD_H,
                display:"flex",alignItems:"center",justifyContent:"center",
                border:"1px solid #f0f0f0",borderRadius:2,overflow:"hidden",
                background:"#fff",
              }}>
                {imgSrc && <img src={imgSrc} alt="" style={{
                  maxWidth:"90%",maxHeight:"90%",objectFit:"contain",display:"block",
                  mixBlendMode:"multiply",
                }}/>}
              </div>
              <div style={{width:CARD_W,overflow:"hidden"}}>
                <p style={{...FONT,margin:0,fontSize:10,fontWeight:700,letterSpacing:".06em",
                  color:"#888",textTransform:"uppercase",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {item.brand}
                </p>
                <p style={{...FONT,margin:"2px 0 0",fontSize:11,color:"#333",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.3}}>
                  {item.title}
                </p>
                {item.price_text && (
                  <p style={{...FONT,margin:"2px 0 0",fontSize:11,color:"#aaa",letterSpacing:".02em"}}>
                    {item.price_text}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {canR && (
        <button onClick={()=>scroll("right")} style={{
          position:"absolute",right:-16,top:CARD_H/2-16,zIndex:10,
          width:32,height:32,borderRadius:"50%",
          background:"#fff",border:"1px solid #ddd",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",
          boxShadow:"0 2px 8px rgba(0,0,0,.12)",
        }}>
          <svg width="10" height="17" viewBox="0 0 10 17"><polygon points="0,0 10,8.5 0,17" fill="#555"/></svg>
        </button>
      )}
    </div>
  );
}
