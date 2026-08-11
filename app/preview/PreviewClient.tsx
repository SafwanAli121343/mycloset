"use client";
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import type { CSSProperties, ChangeEvent } from "react";
import { computeGapProgress, getFunctionalSlot, gapTotalProgress } from "@/lib/wardrobeAnalysis";
import type { CrossedEntry } from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";
import { scorePiece } from "@/lib/scoring";
import type { GarmentForScoring } from "@/lib/scoring";

const FONT: CSSProperties = { fontFamily: "Arial, sans-serif" };

// Gap description keyword → aesthetics it implies (used by both algorithmic and AI image check)
const GAP_AES: [string, string[]][] = [
  ["formal",          ["formal", "business casual"]],
  ["business casual", ["business casual", "smart casual"]],
  ["dress shoe",      ["formal", "business casual"]],
  ["blazer",          ["formal", "business casual", "smart casual", "preppy"]],
  ["sport coat",      ["formal", "smart casual", "preppy"]],
  ["chino",           ["business casual", "preppy", "smart casual"]],
  ["military",        ["military", "gorpcore"]],
  ["cargo",           ["gorpcore", "military"]],
  ["western",         ["western", "americana"]],
  ["athletic",        ["athleisure", "gorpcore"]],
];
const MAX_COMPARE        = 3;
const CATS               = ["top","sweater","vest","outerwear","bottom","footwear","one-piece","accessory"] as const;
const SPREAD_W           = 120;
const SPREAD_H           = 190;
const SPREAD_SCALE       = 5;
const COL_GAP            = 28;
const SPREAD_COL_GAP     = 28;
const ROW_GAP            = 28;
const ITEMS_PER_ROW      = 3;
const OUTFITS_PER_PAGE   = 9;
const OVERLAY_TOP_OFFSET = 50;
const HDR_H              = 48; // fixed header bar height

const KEYFRAMES_CSS = `
  @keyframes _spin         { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes stackReveal   { from{opacity:0}              to{opacity:1}                }
  @keyframes slideInLeft   { from{transform:translateX(-100%)} to{transform:translateX(0)} }
  @keyframes slideOutLeft  { from{transform:translateX(0)} to{transform:translateX(-100%)} }
  @keyframes slideInRight  { from{transform:translateX(100%)} to{transform:translateX(0)} }
  @keyframes slideOutRight { from{transform:translateX(0)} to{transform:translateX(100%)} }
  @keyframes slideInUp     { from{transform:translateY(100%)} to{transform:translateY(0)} }
  @keyframes slideOutDown  { from{transform:translateY(0)} to{transform:translateY(100%)} }
  @keyframes slideInDown   { from{transform:translateY(-100%)} to{transform:translateY(0)} }
  @keyframes slideOutUp    { from{transform:translateY(0)} to{transform:translateY(-100%)} }
  @keyframes loadbar       { 0%{width:0%} 55%{width:65%} 80%{width:84%} 100%{width:93%} }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

type PageStep  = "input"|"basic_analyzing"|"confirming"|"deep_analyzing"|"results";
type InputMode = "url"|"image";
type BasicAttrs = {
  title:string; brand:string|null; category:string;
  color_primary:string|null; material:string|null;
  fit:string|null; image:string|null; price:string|null;
};
type DeepAttrs = {
  sub_type:string|null; aesthetic_tags:string[]|null;
  pros:string[]|null; cons:string[]|null;
  color_pairings:string[]|null; color_clashes:string[]|null;
  formality:string|null; pattern:string|null;
  // /api/preview/deep-analyze's underlying inference always computes these (they're
  // in VISUAL_FIELDS), the route just doesn't filter them out of the response - so
  // they're present at runtime even though nothing previously typed/read them here.
  item_tier?:string|null; novelty_quality?:number|null;
};
type OutfitItem = {
  id:string; title:string|null; image:string|null;
  sub_type:string|null; category:string|null;
  aesthetic_tags:string[]|null;
};
type OutfitCountResult = {
  outfitCount:number; avgScore:number; aestheticFit:number;
  goodCount:number; midCount:number; badCount:number;
  outfits:{score:number; itemIds:string[]}[];
  items:Record<string,OutfitItem>;
};
type Slot = {
  open:boolean; inputMode:InputMode; url:string; imageDataUrl:string|null;
  basic:BasicAttrs|null; confirmedBasic:BasicAttrs|null;
  removedBgUrl:string|null; basicError:string|null;
  analysisStep:"deep"|"outfits"|null;
  deep:DeepAttrs|null; outfitData:OutfitCountResult|null;
  deepError:string|null; showAllOutfits:boolean;
};
type CardKey = "pros"|"cons"|"aesthetics"|"pairings"|"piece_pairings";
type CardDir = "left"|"right"|"bottom"|"top";
type CardSlots = {left:CardKey|null; right:CardKey|null; bottom:CardKey|null; top:CardKey|null};
type SpreadCfg = {containerW:number; containerH:number; stackLeft:number; stackTop:number};

// ── Module-level helpers ──────────────────────────────────────────────────────

function normalizeToJpeg(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/png")) {
    return Promise.resolve(dataUrl);
  }
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function emptySlot(): Slot {
  return {
    open:false, inputMode:"url", url:"", imageDataUrl:null,
    basic:null, confirmedBasic:null, removedBgUrl:null, basicError:null,
    analysisStep:null, deep:null, outfitData:null, deepError:null, showAllOutfits:false,
  };
}
function hasInput(s:Slot) {
  return (s.inputMode==="url" && !!s.url.trim()) || (s.inputMode==="image" && !!s.imageDataUrl);
}

function stackOrder(item:{sub_type:string|null; category?:string|null}): number {
  const cat = (item.category ?? "").toLowerCase().trim();
  if (cat==="accessory"||cat==="accessories"||cat.startsWith("access")) return 0;
  if (cat==="footwear"||cat==="shoes"||cat.startsWith("foot"))           return 1;
  if (cat==="outerwear"||cat.startsWith("outer"))                        return 3;
  if (cat==="bottom"||cat==="bottoms"||cat==="pants"||cat==="skirts"||cat==="shorts") return 4;
  if (cat==="top"||cat==="tops"||cat==="shirts"||cat==="shirt")          return 2;
  const s = (item.sub_type ?? "").toLowerCase();
  if (["ring","watch","bracelet","chain","necklace","earring","bag","hat","cap","beanie","belt","scarf","glasses","sunglass"].some(k=>s.includes(k))) return 0;
  if (["shoe","boot","sneaker","loafer","sandal","slide","oxford","derby","mule"].some(k=>s.includes(k))) return 1;
  if (["jacket","coat","blazer","bomber","cardigan"].some(k=>s.includes(k))) return 3;
  if (["pant","jean","trouser","chino","short","skirt","legging"].some(k=>s.includes(k))) return 4;
  return 2;
}
function sortItems(items:OutfitItem[]) { return [...items].sort((a,b)=>stackOrder(a)-stackOrder(b)); }

function getSpreadPos(i:number, total:number, zoom=1, vZoom=zoom):{left:number;top:number} {
  const step    = zoom *(SPREAD_W+SPREAD_COL_GAP);
  const rowStep = vZoom*(SPREAD_H+ROW_GAP);
  const rowIdx      = Math.floor(i/ITEMS_PER_ROW);
  const colIdx      = i%ITEMS_PER_ROW;
  const top         = rowIdx*rowStep;
  const numFullRows = Math.floor(total/ITEMS_PER_ROW);
  const remainder   = total%ITEMS_PER_ROW;
  const isLastRow   = rowIdx===numFullRows && remainder>0;
  const itemsInRow  = isLastRow ? remainder : ITEMS_PER_ROW;
  if (itemsInRow===ITEMS_PER_ROW) return {left: colIdx*step, top};
  if (itemsInRow===1) return {left: step, top};
  return {left: (colIdx+0.5)*step, top};
}
function buildSpreadCfg(N:number, zoom=1, vZoom=zoom): SpreadCfg {
  const step    = zoom *(SPREAD_W+SPREAD_COL_GAP);
  const rowStep = vZoom*(SPREAD_H+ROW_GAP);
  const numRows    = Math.max(1, Math.ceil(N/ITEMS_PER_ROW));
  const containerW = (ITEMS_PER_ROW-1)*step+SPREAD_W;
  const containerH = (numRows-1)*rowStep+SPREAD_H;
  return {containerW, containerH, stackLeft:(containerW-SPREAD_W)/2, stackTop:(containerH-SPREAD_H)/2};
}
function computeSafeScale(containerH:number, containerW:number, vh:number, vw:number): number {
  const byH = (vh - 160) / containerH;
  const byW = vw / containerW;
  return Math.min(SPREAD_SCALE, Math.max(0.5, byH), Math.max(0.5, byW));
}
function spreadZoom(N:number): number {
  return Math.ceil(N/ITEMS_PER_ROW) >= 3 ? 1.55 : 1.85;
}
function vSpreadZoom(N:number): number {
  return Math.ceil(N/ITEMS_PER_ROW) >= 3 ? 1.32 : 1.85;
}
const DEFAULT_CFG = buildSpreadCfg(3);

// ── Score helpers ─────────────────────────────────────────────────────────────

function sColor(v:number) { return v>=75?"#1d9e52":v>=50?"#c88800":"#c83030"; }
function outfitCountColor(n:number) { return n>=25?"#1d9e52":n>=10?"#c88800":"#c83030"; }
function pieceMatchColor(n:number)  { return n>=10?"#1d9e52":n>=4?"#c88800":"#c83030"; }
// Thresholds scale with total outfits so a 20-outfit wardrobe and an 800-outfit wardrobe
// are judged by the same ideal ratios, not the same absolute counts.
// Good: ≥30% good = green, 15–29% = amber, <15% = red
function goodOutfitColor(n:number, total:number) {
  const pct = total > 0 ? n / total : 0;
  return pct >= 0.30 ? "#1d9e52" : pct >= 0.15 ? "#c88800" : "#c83030";
}
// Mid: ≥25% mid = green, 12–24% = amber, <12% = red
function midOutfitColor(n:number, total:number) {
  const pct = total > 0 ? n / total : 0;
  return pct >= 0.25 ? "#1d9e52" : pct >= 0.12 ? "#c88800" : "#c83030";
}
// Bad: <20% bad = green, 20–39% = amber, ≥40% = red (inverted — fewer is better)
function badOutfitColor(n:number, total:number) {
  const pct = total > 0 ? n / total : 0;
  return pct < 0.20 ? "#1d9e52" : pct < 0.40 ? "#c88800" : "#c83030";
}
function pieceScore(cb:BasicAttrs, deep:DeepAttrs): number {
  // Same tags.tier/novelty_score shape app/api/garments/route.ts writes to the DB on
  // save - without this, scorePiece() can't tell a novelty/statement item apart from
  // a standard one here, so preview could score the exact same item completely
  // differently than closet/add-item do once it's actually added.
  const tags = deep.item_tier
    ? { tier: [deep.item_tier], ...(deep.novelty_quality != null ? { novelty_score: [String(deep.novelty_quality)] } : {}) }
    : null;
  const g: GarmentForScoring = {
    id: "__preview__",
    title: cb.title,
    brand: cb.brand,
    category: cb.category,
    sub_type: deep.sub_type,
    material: cb.material,
    color_primary: cb.color_primary,
    color_secondary: null,
    pattern: deep.pattern,
    formality: deep.formality,
    aesthetic_tags: deep.aesthetic_tags,
    pros: deep.pros,
    cons: deep.cons,
    color_pairings: deep.color_pairings,
    color_clashes: deep.color_clashes,
    tags,
    image: cb.image,
  };
  return scorePiece(g);
}
function overallScore(ps:number, od:OutfitCountResult) {
  // goodRatio: what fraction of outfits are high-quality (score ≥75), scaled to 100
  const total = od.outfitCount || 1;
  const goodRatio = Math.min((od.goodCount ?? 0) / total * 100 * 2, 100); // 50%+ good = 100 pts
  return Math.round(ps*0.35 + od.avgScore*0.25 + Math.min(od.outfitCount/25*100,100)*0.15 + od.aestheticFit*0.15 + goodRatio*0.10);
}
function compareScore(slot:Slot, max:number) {
  if (!slot.deep||!slot.outfitData) return 0;
  const on = max>0?(slot.outfitData.outfitCount/max)*100:0;
  const cr = Math.min((slot.deep.color_pairings?.length??0)/20*100, 100);
  return Math.round(slot.outfitData.avgScore*0.40+on*0.30+slot.outfitData.aestheticFit*0.20+cr*0.10);
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

async function blobToDataUrl(blob:Blob): Promise<string> {
  return new Promise((res,rej)=>{
    const r=new FileReader(); r.onload=()=>res(r.result as string); r.onerror=rej; r.readAsDataURL(blob);
  });
}
const txtBtn = (color:string, disabled=false): CSSProperties => ({
  border:"none", background:"none", cursor:disabled?"not-allowed":"pointer",
  fontSize:10, fontWeight:700, letterSpacing:"0.14em", padding:0,
  color:disabled?"#ccc":color, fontFamily:"Arial, sans-serif",
});
const cardBtnStyle = (color:string): CSSProperties => ({
  border:"none", background:"none", cursor:"pointer", padding:0,
  fontSize:9, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase",
  color, fontFamily:"Arial, sans-serif", whiteSpace:"nowrap",
});

const CARD_DEFAULT_DIR: Record<CardKey,CardDir> = {pros:"left", cons:"right", aesthetics:"left", pairings:"right", piece_pairings:"left"};
const CARD_COLORS: Record<CardKey,string>       = {pros:"#2e7d32", cons:"#c00", aesthetics:"#555", pairings:"#1565c0", piece_pairings:"#00838f"};
const CARD_LABELS: Record<CardKey,string>       = {pros:"Pros", cons:"Cons", aesthetics:"Aesthetics", pairings:"Color pairings", piece_pairings:"Piece pairings"};

function findCardDir(key:CardKey, slots:CardSlots): CardDir|null {
  const def = CARD_DEFAULT_DIR[key];
  const order: CardDir[] = def==="right" ? ["right","left","bottom","top"] : ["left","right","bottom","top"];
  for (const d of order) if (slots[d]===null) return d;
  return null; // all 4 slots occupied
}

function getCardItems(key:CardKey, deep:DeepAttrs, outfitItems?:Record<string,OutfitItem>): string[] {
  if (key==="pros")           return deep.pros??[];
  if (key==="cons")           return deep.cons??[];
  if (key==="pairings")       return deep.color_pairings??[];
  if (key==="piece_pairings") return Object.values(outfitItems??{}).map(i=>{
    const name=i.title??i.sub_type??i.id;
    const aesthetic=(i.aesthetic_tags??[]).slice(0,2).join(", ");
    return aesthetic?`${name} → ${aesthetic}`:name;
  }).filter(Boolean) as string[];
  return deep.aesthetic_tags??[];
}
// Appends the overdone/variety note (see waImpact/selWaImpact effects) as a plain
// line in the matching pros or cons card - same list, not a separate section.
function cardItemsWithOverdone(
  key:CardKey, deep:DeepAttrs, outfitItems:Record<string,OutfitItem>|undefined,
  note:{type:"pro"|"con"; text:string}|null,
): string[] {
  const base=getCardItems(key,deep,outfitItems);
  if (note?.type==="pro" && key==="pros") return [...base, note.text];
  if (note?.type==="con" && key==="cons") return [...base, note.text];
  return base;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PreviewPage() {
  const [slots,    setSlots]    = useState<Slot[]>(()=>Array.from({length:MAX_COMPARE},emptySlot));
  const [pageStep, setPageStep] = useState<PageStep>("input");
  const [confirmIdx, setConfirmIdx] = useState(0);

  const updateSlot = useCallback((idx:number, patch:Partial<Slot>) => {
    setSlots(prev=>prev.map((s,i)=>i===idx?{...s,...patch}:s));
  },[]);

  const makeFilePick = useCallback((idx:number)=>(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      const raw=ev.target?.result as string;
      const dataUrl=await normalizeToJpeg(raw);
      updateSlot(idx,{imageDataUrl:dataUrl});
    };
    reader.readAsDataURL(file); e.target.value="";
  },[updateSlot]);

  async function runBasicAnalysis(idx:number, slot:Slot) {
    const body:Record<string,string>={};
    if (slot.inputMode==="url") body.productUrl=slot.url;
    else if (slot.imageDataUrl) body.imageDataUrl=slot.imageDataUrl;
    else { updateSlot(idx,{basicError:"No input."}); return; }
    const res=await fetch("/api/garments/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const json=await res.json();
    if (!res.ok||json.error) { updateSlot(idx,{basicError:json.error??"Could not identify item."}); return; }
    const basic:BasicAttrs=json;
    const imgSrc=basic.image??slot.imageDataUrl;
    let removedBgUrl:string|null=null;
    if (imgSrc) {
      try {
        const bgRes=await fetch("/api/remove-bg",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:imgSrc})});
        if (bgRes.ok) removedBgUrl=await blobToDataUrl(await bgRes.blob());
      } catch { /* optional */ }
    }
    updateSlot(idx,{basic,confirmedBasic:{...basic},removedBgUrl});
  }

  async function runDeepAnalysis(idx:number, confirmed:BasicAttrs, imageDataUrl:string|null) {
    updateSlot(idx,{analysisStep:"deep",deepError:null});
    const img=confirmed.image??imageDataUrl;
    if (!img) { updateSlot(idx,{deepError:"No image.",analysisStep:null}); return; }
    const deepRes=await fetch("/api/preview/deep-analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:confirmed.title,brand:confirmed.brand,category:confirmed.category,color_primary:confirmed.color_primary,material:confirmed.material,fit:confirmed.fit,image:img})});
    const deepJson=await deepRes.json();
    if (!deepRes.ok||deepJson.error) {
      const msg=deepRes.status===401?"Session expired — please go to the dashboard and log in again.":(deepJson.error??"Analysis failed.");
      updateSlot(idx,{deepError:msg,analysisStep:null}); return;
    }
    const deep:DeepAttrs=deepJson;
    updateSlot(idx,{deep,analysisStep:"outfits"});
    const outfitRes=await fetch("/api/preview/outfit-count",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({garment:{title:confirmed.title,brand:confirmed.brand,category:confirmed.category,sub_type:deep.sub_type,material:confirmed.material,color_primary:confirmed.color_primary,formality:deep.formality,aesthetic_tags:deep.aesthetic_tags,pros:deep.pros,cons:deep.cons,color_pairings:deep.color_pairings,color_clashes:deep.color_clashes,image:confirmed.image}})});
    const outfitJson=await outfitRes.json();
    if (!outfitRes.ok||outfitJson.error) {
      const msg=outfitRes.status===401?"Session expired — please go to the dashboard and log in again.":(outfitJson.error??"Outfit analysis failed.");
      updateSlot(idx,{deepError:msg,analysisStep:null}); return;
    }
    updateSlot(idx,{outfitData:outfitJson as OutfitCountResult,analysisStep:null});
  }

  const filledSlots=slots.map((s,i)=>({s,i})).filter(({s})=>hasInput(s));

  async function handleAnalyzeAll() {
    if (!filledSlots.length) return;
    setPageStep("basic_analyzing");
    setConfirmIdx(0);
    for (const {s,i} of filledSlots) {
      await runBasicAnalysis(i,s);
    }
    setPageStep("confirming");
  }
  function handleConfirmItem() {
    const confirmable=slots.filter(s=>s.confirmedBasic!==null);
    if (confirmIdx>=confirmable.length-1) { handleConfirm(); return; }
    setConfirmIdx(prev=>prev+1);
  }
  async function handleConfirm() {
    const toRun=slots.map((s,i)=>({s,i})).filter(({s})=>s.confirmedBasic!==null);
    if (!toRun.length) return;
    setPageStep("deep_analyzing");
    await Promise.all(toRun.map(({s,i})=>runDeepAnalysis(i,s.confirmedBasic!,s.imageDataUrl)));
    setPageStep("results");
  }
  function handleReset() { setSlots(Array.from({length:MAX_COMPARE},emptySlot)); setPageStep("input"); }

  const analyzedSlots=slots.filter(s=>s.deep&&s.outfitData);
  const maxOutfits=Math.max(1,...analyzedSlots.map(s=>s.outfitData?.outfitCount??0));

  if (pageStep==="input") {
    const active=filledSlots.length>0;
    return (
      <main style={{...FONT,minHeight:"100vh",background:"#fff",padding:"24px",paddingBottom:"18vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <p style={{fontSize:11,fontWeight:700,letterSpacing:"0.13em",color:"#111",textAlign:"center",maxWidth:560,marginBottom:40,lineHeight:1.7}}>
          ENTER UP TO {MAX_COMPARE} ITEMS TO DETERMINE HOW WELL THEY WOULD FIT IN YOUR CLOSET.
        </p>
        <div style={{display:"flex",gap:20,justifyContent:"center",flexWrap:"wrap",width:"100%"}}>
          {slots.map((slot,i)=>(
            <div key={i} style={{flex:"1 1 240px",minWidth:220,maxWidth:320}}>
              <InputSlot slot={slot} onFilePick={makeFilePick(i)}
                onUrlChange={url=>updateSlot(i,{url})}
                onModeChange={mode=>updateSlot(i,{inputMode:mode})}
                onOpen={()=>updateSlot(i,{open:true})}
                onCancel={()=>updateSlot(i,emptySlot())} />
            </div>
          ))}
        </div>
        <button onClick={handleAnalyzeAll} disabled={!active} style={{...txtBtn("#2a7a2a",!active),marginTop:32,fontSize:11}}>ANALYZE</button>
      </main>
    );
  }

  if (pageStep==="basic_analyzing") return (
    <main style={{...FONT,height:"100vh",background:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,paddingBottom:"8vh"}}>
      <style suppressHydrationWarning>{KEYFRAMES_CSS}</style>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <Spinner size={17}/>
        <span style={{fontSize:15,letterSpacing:"0.08em",color:"#666"}}>Identifying item...</span>
      </div>
    </main>
  );

  if (pageStep==="confirming") {
    const confirmable=slots.map((s,i)=>({s,i})).filter(({s})=>s.confirmedBasic!==null);
    if (!confirmable.length) return (
      <main style={{...FONT,minHeight:"100vh",background:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
        <p style={{fontSize:14,color:"#888"}}>Could not identify any items.</p>
        <button onClick={handleReset} style={txtBtn("#c83030")}>START OVER</button>
      </main>
    );
    const safeIdx=Math.min(confirmIdx,confirmable.length-1);
    const {s:slot,i:slotIdx}=confirmable[safeIdx];
    const isLast=safeIdx>=confirmable.length-1;
    const cb=slot.confirmedBasic!;
    const imgSrc=slot.removedBgUrl??slot.basic?.image??slot.imageDataUrl;
    const set=(field:keyof BasicAttrs,val:string|null)=>updateSlot(slotIdx,{confirmedBasic:{...cb,[field]:val}});
    return (
      <main style={{...FONT,minHeight:"100vh",background:"#fff",padding:"64px 24px 80px",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <style suppressHydrationWarning>{KEYFRAMES_CSS}</style>
        <p style={{fontSize:13,fontWeight:700,letterSpacing:"0.2em",color:"#111",marginBottom:8}}>CONFIRM DETAILS</p>
        {confirmable.length>1&&(
          <p style={{fontSize:10,color:"#bbb",letterSpacing:"0.12em",marginBottom:36}}>{safeIdx+1} / {confirmable.length}</p>
        )}
        {confirmable.length===1&&<div style={{marginBottom:36}}/>}
        <div style={{width:"100%",maxWidth:400}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:36,minHeight:220}}>
              {imgSrc?<img src={imgSrc} alt="" style={{maxHeight:220,maxWidth:"100%",objectFit:"contain"}}/>
                :<span style={{fontSize:12,color:"#ddd",letterSpacing:"0.1em"}}>No image</span>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:18}}>
              <FieldHint value={cb.title}            onChange={v=>set("title",v)}              hint="Title"/>
              <FieldHint value={cb.brand??       ""} onChange={v=>set("brand",v||null)}         hint="Brand"/>
              <FieldHint value={cb.color_primary??""}onChange={v=>set("color_primary",v||null)} hint="Color"/>
              <FieldHint value={cb.material??    ""} onChange={v=>set("material",v||null)}      hint="Material"/>
              <FieldHint value={cb.fit??         ""} onChange={v=>set("fit",v||null)}           hint="Fit"/>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center",paddingTop:10}}>
                {CATS.map(c=>(
                  <button key={c} onClick={()=>set("category",c)} style={{
                    background:"none",border:"none",cursor:"pointer",padding:0,
                    fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",
                    fontWeight:cb.category===c?700:400,
                    color:cb.category===c?"#111":"#bbb",...FONT,
                  }}>{c}</button>
                ))}
              </div>
            </div>
            {slot.basicError&&<p style={{fontSize:11,color:"#c83030",marginTop:12}}>{slot.basicError}</p>}
        </div>
        <div style={{display:"flex",gap:24,marginTop:20}}>
          <button onClick={handleReset} style={txtBtn("#c83030")}>CANCEL</button>
          <button onClick={handleConfirmItem} style={txtBtn("#2a7a2a")}>
            {isLast?"CONFIRM & ANALYZE":"CONFIRM"}
          </button>
        </div>
      </main>
    );
  }

  if (pageStep==="deep_analyzing") {
    const active=slots.filter(s=>s.confirmedBasic!==null);
    const anyDeep=active.some(s=>s.analysisStep==="deep");
    const anyOutfits=active.some(s=>s.analysisStep==="outfits");
    const label=anyDeep?"Analyzing attributes...":anyOutfits?"Computing outfit compatibility...":"Queued";
    return (
      <main style={{...FONT,height:"100vh",background:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,paddingBottom:"8vh"}}>
        <style suppressHydrationWarning>{KEYFRAMES_CSS}</style>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <Spinner size={17}/>
          <span style={{fontSize:15,letterSpacing:"0.08em",color:"#666"}}>{label}</span>
        </div>
      </main>
    );
  }

  if (analyzedSlots.length===0) {
    const errors=slots.map(s=>s.deepError).filter(Boolean);
    const sessionExpired=errors.some(e=>typeof e==="string"&&e.includes("Session expired"));
    return (
    <main style={{...FONT,minHeight:"100vh",background:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
      <p style={{fontSize:14,color:"#888"}}>Analysis could not complete.</p>
      {errors.map((e,i)=><p key={i} style={{fontSize:12,color:"#c83030",maxWidth:400,textAlign:"center"}}>{e}</p>)}
      {sessionExpired
        ? <a href="/dashboard" style={{...FONT,fontSize:13,color:"#1565c0",textDecoration:"underline",cursor:"pointer"}}>Go to Dashboard</a>
        : <button onClick={handleReset} style={txtBtn("#c83030")}>START OVER</button>
      }
    </main>
  );
  }

  if (analyzedSlots.length===1) return <SingleResult slot={analyzedSlots[0]} onReset={handleReset}/>;
  const scoredSlots=analyzedSlots.map(slot=>({slot,cScore:compareScore(slot,maxOutfits)}));
  return <MultiResult scoredSlots={scoredSlots} onReset={handleReset}/>;
}

// ── InputSlot ─────────────────────────────────────────────────────────────────

function InputSlot({slot,onFilePick,onUrlChange,onModeChange,onOpen,onCancel}:{
  slot:Slot; onFilePick:(e:ChangeEvent<HTMLInputElement>)=>void;
  onUrlChange:(url:string)=>void; onModeChange:(mode:InputMode)=>void;
  onOpen:()=>void; onCancel:()=>void;
}) {
  const inputRef=useRef<HTMLInputElement|null>(null);
  if (!slot.open) return (
    <div onClick={onOpen} style={{height:160,border:"1px dashed #ddd",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
      <span style={{fontSize:24,color:"#ccc"}}>+</span>
    </div>
  );
  return (
    <div style={{border:"1px solid #ddd"}}>
      <div style={{display:"flex",gap:14,padding:"12px 14px 0"}}>
        {(["url","image"] as InputMode[]).map(mode=>(
          <button key={mode} onClick={()=>onModeChange(mode)} style={{
            border:"none",background:"none",cursor:"pointer",padding:0,
            fontSize:10,letterSpacing:"0.14em",...FONT,
            fontWeight:slot.inputMode===mode?700:400,
            color:slot.inputMode===mode?"#111":"#bbb",
          }}>{mode==="url"?"URL":"PHOTO"}</button>
        ))}
      </div>
      <div style={{padding:"10px 14px 14px"}}>
        {slot.inputMode==="url"?(
          <input autoFocus type="url" placeholder="Paste URL" value={slot.url}
            onChange={e=>onUrlChange(e.target.value)}
            style={{width:"100%",border:"none",borderBottom:"1px solid #ddd",padding:"7px 0",fontSize:12,outline:"none",...FONT,boxSizing:"border-box"}}/>
        ):(
          <>
            <input ref={inputRef} type="file" accept="image/*" style={{display:"none"}} onChange={onFilePick}/>
            <div onClick={()=>inputRef.current?.click()} style={{border:"1px dashed #ccc",height:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",gap:5}}>
              {slot.imageDataUrl?<img src={slot.imageDataUrl} style={{maxHeight:74,maxWidth:"100%",objectFit:"contain"}} alt=""/>
                :<><span style={{fontSize:18,color:"#ccc"}}>↑</span><span style={{fontSize:9,color:"#bbb",letterSpacing:"0.1em"}}>CLICK TO UPLOAD</span></>}
            </div>
          </>
        )}
        <div style={{marginTop:12}}><button onClick={onCancel} style={txtBtn("#c83030")}>CANCEL</button></div>
      </div>
    </div>
  );
}

// ── SlideCard — calendar-style edge-anchored, form-fitting ────────────────────

function SlideCard({cardKey,dir,items,exiting,onHide,sections}:{
  cardKey:CardKey; dir:CardDir; items:string[]; exiting:boolean; onHide:()=>void;
  sections?:{header:string; items:string[]}[];
}) {
  const color=CARD_COLORS[cardKey];
  const label=CARD_LABELS[cardKey];
  const scrollRef=useRef<HTMLDivElement>(null);
  const [atTop,setAtTop]=useState(true);
  const [atBot,setAtBot]=useState(false);

  // useLayoutEffect (not useEffect) so this is measured and corrected BEFORE the
  // browser paints - otherwise the fade/arrow can flash into the wrong visibility
  // for a frame (e.g. showing "more below" on content that already fits) whenever
  // a card mounts or its items change.
  useLayoutEffect(()=>{
    const el=scrollRef.current;
    if(!el) return;
    setAtBot(el.scrollHeight<=el.clientHeight+8);
  },[items]);

  function handleScroll(e:React.UIEvent<HTMLDivElement>){
    const el=e.currentTarget;
    setAtTop(el.scrollTop<=8);
    setAtBot(el.scrollHeight<=el.clientHeight+8||el.scrollTop+el.clientHeight>=el.scrollHeight-8);
  }

  const animIn  = dir==="left"?"slideInLeft" :dir==="right"?"slideInRight" :dir==="top"?"slideInDown" :"slideInUp";
  const animOut = dir==="left"?"slideOutLeft":dir==="right"?"slideOutRight":dir==="top"?"slideOutUp"  :"slideOutDown";

  const posStyle: CSSProperties =
    dir==="left"  ? {position:"fixed",left:0, top:"50%",transform:"translateY(-50%)",zIndex:900} :
    dir==="right" ? {position:"fixed",right:0,top:"50%",transform:"translateY(-50%)",zIndex:900} :
    dir==="top"   ? {position:"fixed",top:0,  left:"50%",transform:"translateX(-50%)",zIndex:900} :
                    {position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",zIndex:900};

  const shadow =
    dir==="left"  ? "4px 0 20px rgba(0,0,0,0.09)"  :
    dir==="right" ? "-4px 0 20px rgba(0,0,0,0.09)" :
    dir==="top"   ? "0 4px 20px rgba(0,0,0,0.09)"  :
                    "0 -4px 20px rgba(0,0,0,0.09)";

  const isVertical = dir==="left"||dir==="right";

  return (
    <div style={posStyle}>
      <div key={exiting?"out":"in"} style={{
        position:"relative",
        width:isVertical?"min(240px,24vw)":"min(320px,70vw)",
        background:"#fff",
        boxShadow:shadow,
        maxHeight:isVertical?"78vh":"44vh",
        display:"flex",
        flexDirection:"column",
        ...FONT,
        textAlign:"center",
        animation:`${exiting?animOut:animIn} 0.25s ease forwards`,
      }}>
        {/* Scrollable content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{overflowY:"auto",scrollbarWidth:"none",flex:1,padding:"24px 20px 18px"}}
        >
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.18em",textTransform:"uppercase",color,marginBottom:14}}>{label}</p>
          {items.map((item,i)=>(
            <p key={i} style={{fontSize:12,color:"#333",lineHeight:1.65,margin:"0 0 8px"}}>{item}</p>
          ))}
          {items.length===0&&<p style={{fontSize:12,color:"#ccc"}}>Nothing to show.</p>}
          {(sections??[]).map(({header,items:sItems})=>(
            <div key={header}>
              <div style={{height:14}}/>
              <p style={{fontSize:9,fontWeight:700,letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:8}}>{header}</p>
              {sItems.length>0
                ? sItems.map((s,i)=><p key={i} style={{fontSize:12,color:"#333",lineHeight:1.65,margin:"0 0 8px"}}>{s}</p>)
                : <p style={{fontSize:12,color:"#ccc"}}>None</p>
              }
            </div>
          ))}
        </div>

        {/* Top fade */}
        <div style={{
          position:"absolute",top:0,left:0,right:0,height:50,
          background:"linear-gradient(to bottom,rgba(255,255,255,1) 0%,rgba(255,255,255,0) 100%)",
          pointerEvents:"none",
          opacity:atTop?0:1,transition:"opacity 0.3s ease",
        }}/>

        {/* Bottom fade + arrow */}
        <div style={{position:"absolute",bottom:0,left:0,right:0,pointerEvents:"none"}}>
          <div style={{
            height:60,width:"100%",
            background:"linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(255,255,255,1) 60%)",
            opacity:atBot?0:1,transition:"opacity 0.3s ease",
          }}/>
          <div
            onClick={()=>{
              const el=scrollRef.current;
              if(!el) return;
              atBot?el.scrollTo({top:0,behavior:"smooth"}):el.scrollBy({top:200,behavior:"smooth"});
            }}
            style={{
              background:"#fff",width:"100%",display:"flex",justifyContent:"center",
              paddingTop:4,paddingBottom:12,cursor:"pointer",pointerEvents:"auto",
              opacity:(atTop&&atBot)?0:1,transition:"opacity 0.3s ease",
            }}
          >
            {atBot
              ? <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 7L7 1L13 7" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 1L7 7L13 1" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SingleResult ──────────────────────────────────────────────────────────────

function SingleResult({slot,onReset}:{slot:Slot; onReset:()=>void}) {
  const {confirmedBasic:cb,removedBgUrl,deep,outfitData}=slot;
  if (!cb||!deep||!outfitData) return null;

  const imgSrc=removedBgUrl??cb.image??slot.imageDataUrl;
  const pScore=pieceScore(cb,deep);
  const oScore=overallScore(pScore,outfitData);

  // Entrance animation
  const [imgAtTop,       setImgAtTop]       = useState(false);
  const [contentVisible, setContentVisible] = useState(false);

  useEffect(()=>{
    const t1=setTimeout(()=>setImgAtTop(true), 300);
    const t2=setTimeout(()=>setContentVisible(true), 1050);
    return ()=>{clearTimeout(t1);clearTimeout(t2);};
  },[]);

  // Wardrobe fill impact — computed from wa_cache in localStorage.
  // waImpactReady only flips true once the FINAL result is known (algorithmic-only when
  // nothing needed an AI image check, or algorithmic+AI merged once that check resolves).
  // waImpact is never published with a partial/about-to-change result, so any card that
  // shows it never has its content pop in or change after the user opens it.
  type WImpact = {fillsGaps:string[]; addsAesthetics:string[]; addsColors:string[]; addressesWeaknesses:string[]};
  const [waImpact, setWaImpact] = useState<WImpact|null>(null);
  const [waImpactReady, setWaImpactReady] = useState(false);
  // A card the user clicked to open before waImpact was ready — opened automatically
  // once it settles, so those cards never appear then change.
  const [pendingCardOpen, setPendingCardOpen] = useState<CardKey|null>(null);
  // Whether this item piles onto an already-overdone sub-type in the wardrobe, or
  // instead diversifies a slot that has one. Shown as a plain pro/con line, not a
  // separate "sections" header, matching how the rest of pros/cons already read.
  const [overdoneNote, setOverdoneNote] = useState<{type:"pro"|"con"; text:string}|null>(null);

  useEffect(()=>{
    if (!deep||!cb) return;
    try {
      const raw=localStorage.getItem("wa_cache_v20");
      if (!raw) return;
      const parsed=JSON.parse(raw) as {
        backendState:{
          analysisHistory:Array<{
            gaps:{description:string}[];
            colors:{missing:string[]};
            aesthetics:{missing:string[]};
            cons:string[];
            conGapLinks?:Record<string,string>;
            overdone?:{description:string; count:number; suggestion:string}[];
          }>;
          crossed:CrossedEntry[];
          currentLevel:number;
        };
      };
      const level=parsed.backendState?.currentLevel??1;
      const analysis=parsed.backendState?.analysisHistory?.[level-1]
                  ?? parsed.backendState?.analysisHistory?.[0];
      if (!analysis) return;
      const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
      const cat=(cb.category??"").toLowerCase();
      const crossed:CrossedEntry[]=parsed.backendState?.crossed??[];

      // Filter out gaps already fully resolved by existing wardrobe items
      const openGaps=analysis.gaps.filter(g=>gapTotalProgress(crossed,g.description,level)<100);

      // Use the same slot-based algorithm as wardrobeAnalysis for accurate gap matching
      const funcSlot=getFunctionalSlot(deep.sub_type??"");
      const algorithmic=openGaps.filter(g=>
        computeGapProgress(g.description,deep.sub_type??"",cat,funcSlot)>=100
      ).map(g=>g.description);

      // Overdone/variety: does this item pile onto a sub-type the wardrobe already has
      // too much of, or does it diversify a slot that has that problem?
      const overdoneEntries=analysis.overdone??[];
      if (deep.sub_type && overdoneEntries.length) {
        const subNorm=deep.sub_type.toLowerCase().trim();
        const matched=overdoneEntries.find(o=>o.description.toLowerCase().trim()===subNorm);
        if (matched) {
          setOverdoneNote({type:"con",text:`Overdoes ${matched.description}`});
        } else if (funcSlot && overdoneEntries.some(o=>getFunctionalSlot(o.description)===funcSlot)) {
          setOverdoneNote({type:"pro",text:"Increases variety"});
        } else {
          setOverdoneNote(null);
        }
      } else {
        setOverdoneNote(null);
      }

      // Pattern/title-implied aesthetics — use substring matching so "camouflage" still resolves to military
      const patternStr=(deep.pattern??'').toLowerCase();
      const titleStr=(cb.title??'').toLowerCase();
      const sub=(deep.sub_type??'').toLowerCase();
      const patternImplied:string[]=[];

      if (patternStr.includes("camo")||titleStr.includes("camo")||titleStr.includes("camouflage")||sub.includes("camo"))
        patternImplied.push("military","gorpcore");
      if (patternStr.includes("plaid")||patternStr.includes("tartan")||titleStr.includes("plaid"))
        patternImplied.push("preppy","ivy league");
      if (patternStr.includes("tie-dye")||patternStr.includes("tie dye")||titleStr.includes("tie dye"))
        patternImplied.push("y2k");
      const allAestheticCandidates = [...new Set([...(deep.aesthetic_tags??[]), ...patternImplied])];
      const baseAesthetics = allAestheticCandidates
        .filter(t=>analysis.aesthetics.missing.some(m=>norm(m)===norm(t)));
      // Infer additional aesthetics from filled gaps (e.g. "formal pant" → "formal", "business casual")
      const algoAesNorms=new Set(baseAesthetics.map(norm));
      const gapInferredAes:string[]=[];
      for(const gap of algorithmic){
        const gl=gap.toLowerCase();
        for(const[kw,aes]of GAP_AES)if(gl.includes(kw))for(const a of aes)
          if(analysis.aesthetics.missing.includes(a)&&!algoAesNorms.has(norm(a))){gapInferredAes.push(a);algoAesNorms.add(norm(a));}
      }
      const addsAesthetics=[...baseAesthetics,...gapInferredAes];
      const pColor=cb.color_primary??null;
      const addsColors=pColor
        ?analysis.colors.missing.filter(m=>sameColorGroup(pColor,m))
        :[];

      // Open weaknesses (cons not yet crossed at this level), matched against this
      // item using the SAME deterministic algorithm as add-item/page.tsx's con-matching
      // (sub_type/category substring, linked-gap resolution, or gap-text substring) so
      // preview and add-item never disagree about whether an item fills a weakness.
      const crossedConKeys=new Set(crossed.filter(e=>e.category==="con"&&e.analysisLevel===level).map(e=>e.key));
      const conGapLinks=analysis.conGapLinks??{};
      const openCons:string[]=[];
      const algorithmicWeaknesses:string[]=[];
      for(let i=0;i<(analysis.cons??[]).length;i++){
        if(crossedConKeys.has(String(i))) continue;
        const conText=analysis.cons[i];
        openCons.push(conText);
        const con=conText.toLowerCase();
        const linkedGap=conGapLinks[String(i)];
        const matches=
          (!!sub&&con.includes(sub))||
          (!!cat&&con.includes(cat))||
          (!!linkedGap&&algorithmic.some(d=>d.toLowerCase()===linkedGap.toLowerCase()))||
          algorithmic.some(d=>con.includes(d.toLowerCase()));
        if(matches) algorithmicWeaknesses.push(conText);
      }

      // AI image check: typed groups so GPT has context for each category
      const imgUrl=removedBgUrl??cb.image;
      const unmatchedGaps=openGaps.filter(g=>!algorithmic.includes(g.description)).map(g=>g.description);
      const unmatchedAesthetics=analysis.aesthetics.missing.filter(m=>
        !addsAesthetics.some(a=>norm(a)===norm(m))
      );
      const unmatchedColors=analysis.colors.missing.filter(m=>
        !addsColors.some(c=>norm(c)===norm(m))
      );
      // Only ask the AI about weaknesses the deterministic pass above didn't already resolve.
      const unmatchedCons=openCons.filter(c=>!algorithmicWeaknesses.includes(c));
      const anyUnmatched=unmatchedGaps.length||unmatchedAesthetics.length||unmatchedColors.length||unmatchedCons.length;
      if (anyUnmatched&&imgUrl) {
        // Don't publish waImpact yet — the algorithmic result here is a partial answer that
        // the AI check below can still add to. Publishing early and updating later is exactly
        // the "pops in after you're already looking at it" behavior we're avoiding, so wait
        // for this to settle (success or failure) and publish the FINAL result exactly once.
        fetch("/api/wardrobe/gap-check",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            sub_type:deep.sub_type,category:cb.category,image:imgUrl,
            gap_descriptions:unmatchedGaps,
            aesthetic_gaps:unmatchedAesthetics,
            color_gaps:unmatchedColors,
            weakness_gaps:unmatchedCons,
          }),
        }).then(r=>r.json()).then((res:{gap_fills?:string[];aesthetic_fills?:string[];color_fills?:string[];weakness_fills?:string[]})=>{
          // Infer additional aesthetics from all gap fills (algorithmic + AI)
          const allGapFills=[...algorithmic,...(res.gap_fills??[])];
          const postAiAes=[...addsAesthetics,...(res.aesthetic_fills??[])];
          const postAiAesNorms=new Set(postAiAes.map(norm));
          for(const gap of allGapFills){
            const gl=gap.toLowerCase();
            for(const[kw,aes]of GAP_AES)if(gl.includes(kw))for(const a of aes)
              if(analysis.aesthetics.missing.includes(a)&&!postAiAesNorms.has(norm(a))){postAiAes.push(a);postAiAesNorms.add(norm(a));}
          }
          const aiWeaknesses=(res.weakness_fills??[]).filter(w=>!algorithmicWeaknesses.includes(w));
          setWaImpact({
            fillsGaps:allGapFills.slice(0,3),
            addsAesthetics:postAiAes,
            addsColors:[...addsColors,...(res.color_fills??[])],
            addressesWeaknesses:[...algorithmicWeaknesses,...aiWeaknesses],
          });
          setWaImpactReady(true);
        }).catch(()=>{
          // AI check failed — publish the algorithmic-only result as final rather than
          // leaving the UI stuck waiting forever.
          setWaImpact({fillsGaps:algorithmic.slice(0,3),addsAesthetics,addsColors,addressesWeaknesses:algorithmicWeaknesses});
          setWaImpactReady(true);
        });
      } else {
        // Nothing left for the AI to check — the algorithmic result is already final.
        setWaImpact({fillsGaps:algorithmic.slice(0,3),addsAesthetics,addsColors,addressesWeaknesses:algorithmicWeaknesses});
        setWaImpactReady(true);
      }
    } catch {}
  },[]);

  // Card panel state
  const [leftCard,   setLeftCard]   = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [rightCard,  setRightCard]  = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [bottomCard, setBottomCard] = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [topCard,    setTopCard]    = useState<{key:CardKey;exiting:boolean}|null>(null);
  // Tracks insertion order oldest→newest for eviction when a 5th card is opened
  const [openOrder,  setOpenOrder]  = useState<CardKey[]>([]);

  function visibleMap(): CardSlots {
    return {
      left:   leftCard   && !leftCard.exiting   ? leftCard.key   : null,
      right:  rightCard  && !rightCard.exiting  ? rightCard.key  : null,
      bottom: bottomCard && !bottomCard.exiting ? bottomCard.key : null,
      top:    topCard    && !topCard.exiting    ? topCard.key    : null,
    };
  }
  function setterFor(dir:CardDir) {
    if (dir==="left")   return setLeftCard;
    if (dir==="right")  return setRightCard;
    if (dir==="top")    return setTopCard;
    return setBottomCard;
  }
  function dirOf(key:CardKey, vm:CardSlots): CardDir|null {
    if (vm.left===key)   return "left";
    if (vm.right===key)  return "right";
    if (vm.bottom===key) return "bottom";
    if (vm.top===key)    return "top";
    return null;
  }
  function exitCardInDir(dir:CardDir) {
    const setter=setterFor(dir);
    setter(prev=>prev?{...prev,exiting:true}:null);
    setTimeout(()=>setter(null), 250);
  }
  function exitCard(key:CardKey) {
    const vm=visibleMap();
    const d=dirOf(key,vm); if (!d) return;
    exitCardInDir(d);
  }
  // Cards whose extra sections come from waImpact — must wait for it to be ready
  // so the card never opens with partial data that then changes underneath the user.
  const WA_DEPENDENT_KEYS = new Set<CardKey>(["pros","aesthetics","pairings"]);

  function openCardImmediate(key:CardKey) {
    const vm=visibleMap();
    if (Object.values(vm).includes(key)) {
      // Already open — close it and remove from order
      exitCard(key);
      setOpenOrder(prev=>prev.filter(k=>k!==key));
      return;
    }
    const dir=findCardDir(key,vm);
    if (dir!==null) {
      // Free slot — open immediately
      setterFor(dir)({key,exiting:false});
      setOpenOrder(prev=>[...prev,key]);
    } else {
      // All 4 slots full — evict the oldest card, open new one in that same slot
      const oldest=openOrder[0];
      if (!oldest) return;
      const evictDir=dirOf(oldest,vm);
      if (!evictDir) return;
      const evictSetter=setterFor(evictDir);
      // Animate out the oldest card
      evictSetter(prev=>prev?{...prev,exiting:true}:null);
      setOpenOrder(prev=>[...prev.filter(k=>k!==oldest),key]);
      setTimeout(()=>{
        evictSetter(null);
        // Slide the new card into the just-vacated slot
        setTimeout(()=>setterFor(evictDir)({key,exiting:false}),20);
      },250);
    }
  }
  function openCard(key:CardKey) {
    if (isOpen(key)) { openCardImmediate(key); return; } // closing is always immediate
    if (WA_DEPENDENT_KEYS.has(key) && !waImpactReady) {
      // Not ready yet — queue it (clicking again cancels the queued open) instead of
      // opening now with data that would change under the user a moment later.
      setPendingCardOpen(prev=>prev===key?null:key);
      return;
    }
    openCardImmediate(key);
  }
  // Once waImpact settles, automatically open whatever card the user already asked for.
  useEffect(()=>{
    if (waImpactReady && pendingCardOpen) {
      const key=pendingCardOpen;
      setPendingCardOpen(null);
      openCardImmediate(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[waImpactReady]);
  function isOpen(key:CardKey) {
    const vm=visibleMap(); return Object.values(vm).includes(key);
  }

  const previewItem:OutfitItem={id:"__preview__",title:cb.title,image:imgSrc,sub_type:deep.sub_type,category:cb.category,aesthetic_tags:deep.aesthetic_tags??null};

  // Button label/color helpers — a queued (not-yet-ready) card reads as "loading" so the
  // click still feels responsive instead of appearing to do nothing.
  function btnLabel(key:CardKey, show:string, hide:string) {
    if (pendingCardOpen===key) return "Loading...";
    return isOpen(key)?hide:show;
  }
  function btnColor(key:CardKey, base:string) { return (isOpen(key)||pendingCardOpen===key)?"#999":base; }

  const pieceMatchCount = Object.keys(outfitData.items).length;

  return (
    <div style={{...FONT,minHeight:"100vh",background:"#fff"}}>
      <style suppressHydrationWarning>{KEYFRAMES_CSS}</style>

      <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingBottom:80}}>

        {/* Title bar + brand — fade in after image settles */}
        <div style={{
          opacity:contentVisible?1:0,
          transition:"opacity 0.6s ease",
          width:"100%",
          display:"flex",
          flexDirection:"column",
          alignItems:"center",
        }}>
        <div style={{
          width:"100%",
          height:52,
          display:"grid",
          gridTemplateColumns:"1fr auto 1fr",
          alignItems:"center",
          paddingInline:24,
        }}>
          <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-end",paddingRight:56}}>
            <button onClick={()=>openCard("pros")}          style={cardBtnStyle(btnColor("pros",          CARD_COLORS.pros))}>          {btnLabel("pros",          "Show pros",          "Hide pros")}          </button>
            <button onClick={()=>openCard("aesthetics")}    style={cardBtnStyle(btnColor("aesthetics",    CARD_COLORS.aesthetics))}>    {btnLabel("aesthetics",    "Show aesthetics",    "Hide aesthetics")}    </button>
            <button onClick={()=>openCard("piece_pairings")}style={cardBtnStyle(btnColor("piece_pairings",CARD_COLORS.piece_pairings))}>{btnLabel("piece_pairings","Show piece pairings","Hide piece pairings")} </button>
          </div>
          {/* Center: title */}
          <p style={{...FONT,fontSize:21,fontWeight:700,textAlign:"center",lineHeight:1.2,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"28vw"}}>
            {cb.title}
          </p>
          <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-start",paddingLeft:56}}>
            <button onClick={()=>openCard("cons")}     style={cardBtnStyle(btnColor("cons",    CARD_COLORS.cons))}>     {btnLabel("cons",    "Show cons",         "Hide cons")}          </button>
            <button onClick={()=>openCard("pairings")} style={cardBtnStyle(btnColor("pairings",CARD_COLORS.pairings))}> {btnLabel("pairings","Show color pairings","Hide color pairings")} </button>
            <button onClick={onReset}                  style={cardBtnStyle("#c83030")}>Reset</button>
          </div>
        </div>
        {cb.brand&&<p style={{...FONT,fontSize:11,fontWeight:700,color:"#111",letterSpacing:"0.15em",margin:0,marginTop:-4,marginBottom:12}}>{cb.brand.toUpperCase()}</p>}
        </div>

        {/* Item image — always visible; CSS transform starts at viewport center, transitions to natural position */}
        {imgSrc&&<img src={imgSrc} alt={cb.title} style={{
          height:210,maxWidth:"60%",objectFit:"contain",marginBottom:28,
          transform:imgAtTop?"none":"translateY(calc(50vh - 178px))",
          transition:"transform 0.7s cubic-bezier(0.4,0,0.2,1)",
        }}/>}

        {/* Stats and gallery — fade in after image settles */}
        <div style={{opacity:contentVisible?1:0,transition:"opacity 0.6s ease",display:"flex",flexDirection:"column",alignItems:"center",width:"100%"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:24,marginBottom:36,paddingInline:24}}>
            <div style={{display:"flex",gap:56,alignItems:"flex-start",justifyContent:"center",flexWrap:"wrap"}}>
              <StatNum value={`${pScore}`}                   label="Piece score"      color={sColor(pScore)}/>
              <StatNum value={`${outfitData.avgScore}`}      label="Avg outfit score" color={sColor(outfitData.avgScore)}/>
              <StatNum value={`${outfitData.outfitCount}`}   label="New outfits"      color={outfitCountColor(outfitData.outfitCount)}/>
              <StatNum value={`${outfitData.goodCount ?? 0}`}  label="Good outfits"     color={goodOutfitColor(outfitData.goodCount ?? 0, outfitData.outfitCount)}/>
              <StatNum value={`${outfitData.midCount ?? 0}`}  label="Mid outfits"      color={midOutfitColor(outfitData.midCount ?? 0, outfitData.outfitCount)}/>
              <StatNum value={`${outfitData.badCount ?? 0}`}  label="Bad outfits"      color={badOutfitColor(outfitData.badCount ?? 0, outfitData.outfitCount)}/>
              <StatNum value={`${outfitData.aestheticFit}%`} label="Aesthetic fit"    color={sColor(outfitData.aestheticFit)}/>
              <StatNum value={`${pieceMatchCount}`}          label="Piece matches"    color={pieceMatchColor(pieceMatchCount)}/>
            </div>
            <StatNum value={`${oScore}`} label="Overall" color={sColor(oScore)} big/>
          </div>
          {outfitData.outfits.length>0&&(
            <OutfitGallery outfits={outfitData.outfits} items={outfitData.items} previewItem={previewItem} totalCount={outfitData.outfitCount}/>
          )}
        </div>
      </div>

      {/* Slide cards */}
      {([leftCard,rightCard,bottomCard,topCard] as const).map((c,i)=>{
        if (!c) return null;
        const dir=(["left","right","bottom","top"] as const)[i];
        const cardSections=waImpact!=null ? (
          c.key==="pros"       ? [{header:"GAPS FILLED",            items:waImpact.fillsGaps},{header:"WEAKNESSES ADDRESSED",items:waImpact.addressesWeaknesses}] :
          c.key==="aesthetics" ? [{header:"AESTHETICS FILLED",      items:waImpact.addsAesthetics}]        :
          c.key==="pairings"   ? [{header:"COLORS FILLED",          items:waImpact.addsColors}]            :
          undefined
        ) : undefined;
        return <SlideCard key={dir} cardKey={c.key} dir={dir} items={cardItemsWithOverdone(c.key,deep,outfitData.items,overdoneNote)} exiting={c.exiting} onHide={()=>exitCard(c.key)} sections={cardSections}/>;
      })}

    </div>
  );
}

// ── MultiResult ───────────────────────────────────────────────────────────────

type RankLabel = "best"|"second"|"worst";
const RANK_BADGE: Record<RankLabel,{badge:string;color:string}> = {
  best:   {badge:"★", color:"#1d9e52"},
  second: {badge:"•", color:"#f0b429"},
  worst:  {badge:"—", color:"#c83030"},
};
// Layout constants for the 5-column compare view
const ITEM_COL_W  = 230;
const SCORE_COL_W = 230;

function MultiResult({scoredSlots,onReset}:{
  scoredSlots:{slot:Slot;cScore:number}[]; onReset:()=>void;
}) {
  const n=scoredSlots.length;
  const STRIP_W=110, STRIP_GAP=24, STRIP_STEP=STRIP_W+STRIP_GAP;

  const [imgAtTop,      setImgAtTop]      = useState(n===2);
  const [contentVisible,setContentVisible]= useState(false);
  const [selectedIdx,   setSelectedIdx]   = useState<number|null>(null);
  const [leftCard,      setLeftCard]      = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [rightCard,     setRightCard]     = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [bottomCard,    setBottomCard]    = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [topCard,       setTopCard]       = useState<{key:CardKey;exiting:boolean}|null>(null);
  const [openOrder,     setOpenOrder]     = useState<CardKey[]>([]);
  const [aiCmp, setAiCmp] = useState<{better0:string[];worse0:string[];better1:string[];worse1:string[];sims:string[];diffs:string[]}|"loading"|null>(n===2?"loading":null);
  const [aiCmp3, setAiCmp3] = useState<{better:string[][];worse:string[][];sims:string[][];diffs:string[][]}|"loading"|null>(n===3?"loading":null);
  const [stripSettled,             setStripSettled]             = useState(false);
  const [compareEntranceTransforms]= useState<[string,string]>(["translateY(35vh)","translateY(35vh)"]);
  const [surAlpha, setSurAlpha] = useState(1);
  const [transAnim, setTransAnim] = useState<{
    images:string[]; fromX:number[]; fromY:number;
    toX:number[]; toY:number; phase:'setup'|'active';
  }|null>(null);
  const itemRefs=useRef<(HTMLDivElement|null)[]>([null,null,null]);
  const pieceImgRefs=useRef<(HTMLDivElement|null)[]>([null,null,null]);
  const [pieceViewOrder, setPieceViewOrder] = useState<number[]>([0,1,2]);
  const prevSelectedIdx=useRef<number|null>(null);
  const [itemPageX,setItemPageX]=useState<number[]>([]);
  const panelScrollRefs=useRef<(HTMLDivElement|null)[]>([null,null,null]);
  const [panelsAtBottom,setPanelsAtBottom]=useState<boolean[]>(()=>Array(n).fill(false));
  const [panelsAtTop,   setPanelsAtTop   ]=useState<boolean[]>(()=>Array(n).fill(true));
  const [loaderShowing,setLoaderShowing]=useState(n===2);
  const [loaderShowing3,setLoaderShowing3]=useState(n===3);
  const [selWaImpact,setSelWaImpact]=useState<{fillsGaps:string[];addsAesthetics:string[];addsColors:string[];addressesWeaknesses:string[]}|null>(null);
  const [selWaImpactReady,setSelWaImpactReady]=useState(false);
  const [pendingCardOpen,setPendingCardOpen]=useState<CardKey|null>(null);
  const [selOverdoneNote,setSelOverdoneNote]=useState<{type:"pro"|"con"; text:string}|null>(null);
  const [compareEntered,setCompareEntered]=useState(false);
  const [three3Phase,setThree3Phase]=useState<'waiting'|'stacked'|'distributing'|'done'>(n===3?'waiting':'done');
  const [three3Moving,setThree3Moving]=useState(false);
  const three3AnimStarted=useRef(false);
  useEffect(()=>{
    const t1=setTimeout(()=>setImgAtTop(true), 300);
    const t2=setTimeout(()=>setContentVisible(true), 1050);
    // n===3: content visibility triggered after AI compare loads (not on a timer)
    return ()=>{clearTimeout(t1);clearTimeout(t2);};
  },[]);

  useEffect(()=>{
    if(!imgAtTop||selectedIdx!==null||n!==2) return;
    const raf=requestAnimationFrame(()=>{
      const xs=itemRefs.current.map(el=>{
        if(!el) return typeof window!=="undefined"?window.innerWidth/2:0;
        const r=el.getBoundingClientRect();
        return r.left+r.width/2;
      });
      setItemPageX(xs);
    });
    return ()=>cancelAnimationFrame(raf);
  },[imgAtTop,selectedIdx,n]);

  useEffect(()=>{
    if(n!==2) return;
    const [s0,s1]=scoredSlots;
    const d0=s0.slot.deep, d1=s1.slot.deep;
    const cb0=s0.slot.confirmedBasic, cb1=s1.slot.confirmedBasic;
    if(!d0||!d1||!cb0||!cb1) { setAiCmp(null); return; }
    fetch("/api/preview/compare",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        a:{title:cb0.title,category:cb0.category,sub_type:d0.sub_type,color_primary:cb0.color_primary??null,formality:d0.formality??null,aesthetic_tags:d0.aesthetic_tags??null,pros:d0.pros??null,cons:d0.cons??null},
        b:{title:cb1.title,category:cb1.category,sub_type:d1.sub_type,color_primary:cb1.color_primary??null,formality:d1.formality??null,aesthetic_tags:d1.aesthetic_tags??null,pros:d1.pros??null,cons:d1.cons??null},
      }),
    }).then(r=>r.json()).then(data=>{
      if(data.error) throw new Error(data.error);
      setAiCmp({better0:data.better_a??[],worse0:data.worse_a??[],better1:data.better_b??[],worse1:data.worse_b??[],sims:data.similarities??[],diffs:data.differences??[]});
      setContentVisible(true);
      setCompareEntered(true);
      setTimeout(()=>setLoaderShowing(false), 450);
    }).catch(()=>{
      setAiCmp(null);
      setContentVisible(true);
      setCompareEntered(true);
      setTimeout(()=>setLoaderShowing(false), 450);
    });
  },[]);

  useEffect(()=>{
    if(n!==3) return;
    const [s0,s1,s2]=scoredSlots;
    const d0=s0.slot.deep,d1=s1.slot.deep,d2=s2.slot.deep;
    const cb0=s0.slot.confirmedBasic,cb1=s1.slot.confirmedBasic,cb2=s2.slot.confirmedBasic;
    if(!d0||!d1||!d2||!cb0||!cb1||!cb2){
      setAiCmp3(null);setContentVisible(true);setCompareEntered(true);
      requestAnimationFrame(()=>setThree3Phase(p=>p==='waiting'?'stacked':p));
      setTimeout(()=>setLoaderShowing3(false),450);return;
    }
    fetch("/api/preview/compare3",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        a:{title:cb0.title,category:cb0.category,sub_type:d0.sub_type,color_primary:cb0.color_primary??null,formality:d0.formality??null,aesthetic_tags:d0.aesthetic_tags??null,pros:d0.pros??null,cons:d0.cons??null},
        b:{title:cb1.title,category:cb1.category,sub_type:d1.sub_type,color_primary:cb1.color_primary??null,formality:d1.formality??null,aesthetic_tags:d1.aesthetic_tags??null,pros:d1.pros??null,cons:d1.cons??null},
        c:{title:cb2.title,category:cb2.category,sub_type:d2.sub_type,color_primary:cb2.color_primary??null,formality:d2.formality??null,aesthetic_tags:d2.aesthetic_tags??null,pros:d2.pros??null,cons:d2.cons??null},
      }),
    }).then(r=>r.json()).then(data=>{
      if(data.error) throw new Error(data.error);
      setAiCmp3({better:[data.better_a??[],data.better_b??[],data.better_c??[]],worse:[data.worse_a??[],data.worse_b??[],data.worse_c??[]],sims:[data.sims_a??[],data.sims_b??[],data.sims_c??[]],diffs:[data.diffs_a??[],data.diffs_b??[],data.diffs_c??[]]});
      setContentVisible(true);setCompareEntered(true);
      requestAnimationFrame(()=>setThree3Phase(p=>p==='waiting'?'stacked':p));
      setTimeout(()=>setLoaderShowing3(false),450);
    }).catch(()=>{
      setAiCmp3(null);setContentVisible(true);setCompareEntered(true);
      requestAnimationFrame(()=>setThree3Phase(p=>p==='waiting'?'stacked':p));
      setTimeout(()=>setLoaderShowing3(false),450);
    });
  },[]);

  // useLayoutEffect, measured synchronously right after this render's DOM commit -
  // no rAF delay needed, and it avoids a frame where the fade/arrow show the wrong
  // (stale or default) visibility before snapping to the real one.
  useLayoutEffect(()=>{
    if(aiCmp==="loading")return;
    setPanelsAtBottom(Array.from({length:n},(_,i)=>{
      const el=panelScrollRefs.current[i];
      return el?(el.scrollHeight<=el.clientHeight+8):false;
    }));
    setPanelsAtTop(Array.from({length:n},(_,i)=>{
      const el=panelScrollRefs.current[i];
      return el?el.scrollTop<=8:true;
    }));
  },[aiCmp]);

  useEffect(()=>{ prevSelectedIdx.current=selectedIdx; },[selectedIdx]);

  useEffect(()=>{
    setSelWaImpactReady(false);
    if(selectedIdx===null){setSelWaImpact(null);setSelOverdoneNote(null);return;}
    let cancelled=false;
    const selSlot=scoredSlots[selectedIdx]?.slot;
    const sCb=selSlot?.confirmedBasic;
    const sDp=selSlot?.deep;
    const sBg=selSlot?.removedBgUrl;
    if(!sDp||!sCb){setSelWaImpact(null);return;}
    try{
      const raw=localStorage.getItem("wa_cache_v20");
      if(!raw){setSelWaImpact(null);return;}
      const parsed=JSON.parse(raw) as {backendState:{analysisHistory:Array<{gaps:{description:string}[];colors:{missing:string[]};aesthetics:{missing:string[]};cons:string[];conGapLinks?:Record<string,string>;overdone?:{description:string;count:number;suggestion:string}[]}>;crossed:CrossedEntry[];currentLevel:number}};
      const level=parsed.backendState?.currentLevel??1;
      const analysis=parsed.backendState?.analysisHistory?.[level-1]??parsed.backendState?.analysisHistory?.[0];
      if(!analysis){setSelWaImpact(null);return;}
      const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
      const cat=(sCb.category??"").toLowerCase();
      const crossed:CrossedEntry[]=parsed.backendState?.crossed??[];
      const openGaps=analysis.gaps.filter(g=>gapTotalProgress(crossed,g.description,level)<100);
      const funcSlot=getFunctionalSlot(sDp.sub_type??"");
      const algorithmic=openGaps.filter(g=>computeGapProgress(g.description,sDp.sub_type??"",cat,funcSlot)>=100).map(g=>g.description);

      // Overdone/variety - same logic as the single-item waImpact effect above.
      const overdoneEntries=analysis.overdone??[];
      if (sDp.sub_type && overdoneEntries.length) {
        const subNorm=sDp.sub_type.toLowerCase().trim();
        const matched=overdoneEntries.find(o=>o.description.toLowerCase().trim()===subNorm);
        if (matched) setSelOverdoneNote({type:"con",text:`Overdoes ${matched.description}`});
        else if (funcSlot && overdoneEntries.some(o=>getFunctionalSlot(o.description)===funcSlot)) setSelOverdoneNote({type:"pro",text:"Increases variety"});
        else setSelOverdoneNote(null);
      } else {
        setSelOverdoneNote(null);
      }
      const patternStr=(sDp.pattern??'').toLowerCase();
      const titleStr=(sCb.title??'').toLowerCase();
      const sub=(sDp.sub_type??'').toLowerCase();
      const patternImplied:string[]=[];
      if(patternStr.includes("camo")||titleStr.includes("camo")||titleStr.includes("camouflage")||sub.includes("camo"))patternImplied.push("military","gorpcore");
      if(patternStr.includes("plaid")||patternStr.includes("tartan")||titleStr.includes("plaid"))patternImplied.push("preppy","ivy league");
      if(patternStr.includes("tie-dye")||patternStr.includes("tie dye")||titleStr.includes("tie dye"))patternImplied.push("y2k");
      const allAestheticCandidates=[...new Set([...(sDp.aesthetic_tags??[]),...patternImplied])];
      const baseAesthetics=allAestheticCandidates.filter(t=>analysis.aesthetics.missing.some(m=>norm(m)===norm(t)));
      const algoAesNorms=new Set(baseAesthetics.map(norm));
      const gapInferredAes:string[]=[];
      for(const gap of algorithmic){const gl=gap.toLowerCase();for(const[kw,aes]of GAP_AES)if(gl.includes(kw))for(const a of aes)if(analysis.aesthetics.missing.includes(a)&&!algoAesNorms.has(norm(a))){gapInferredAes.push(a);algoAesNorms.add(norm(a));}}
      const addsAesthetics=[...baseAesthetics,...gapInferredAes];
      const pColor=sCb.color_primary??null;
      const addsColors=pColor?analysis.colors.missing.filter(m=>sameColorGroup(pColor,m)):[];
      // Weakness matching mirrors add-item/page.tsx's deterministic con-matching (see the
      // single-item waImpact effect above for the full rationale).
      const crossedConKeys=new Set(crossed.filter(e=>e.category==="con"&&e.analysisLevel===level).map(e=>e.key));
      const conGapLinks=analysis.conGapLinks??{};
      const openCons:string[]=[];
      const algorithmicWeaknesses:string[]=[];
      for(let i=0;i<(analysis.cons??[]).length;i++){
        if(crossedConKeys.has(String(i))) continue;
        const conText=analysis.cons[i];
        openCons.push(conText);
        const con=conText.toLowerCase();
        const linkedGap=conGapLinks[String(i)];
        const matches=
          (!!sub&&con.includes(sub))||
          (!!cat&&con.includes(cat))||
          (!!linkedGap&&algorithmic.some(d=>d.toLowerCase()===linkedGap.toLowerCase()))||
          algorithmic.some(d=>con.includes(d.toLowerCase()));
        if(matches) algorithmicWeaknesses.push(conText);
      }
      const imgUrl=sBg??sCb.image;
      const unmatchedGaps=openGaps.filter(g=>!algorithmic.includes(g.description)).map(g=>g.description);
      const unmatchedAesthetics=analysis.aesthetics.missing.filter(m=>!addsAesthetics.some(a=>norm(a)===norm(m)));
      const unmatchedColors=analysis.colors.missing.filter(m=>!addsColors.some(c=>norm(c)===norm(m)));
      const unmatchedCons=openCons.filter(c=>!algorithmicWeaknesses.includes(c));
      const anyUnmatched=unmatchedGaps.length||unmatchedAesthetics.length||unmatchedColors.length||unmatchedCons.length;
      if(anyUnmatched&&imgUrl){
        // Don't publish until this settles — see the single-item waImpact effect above.
        fetch("/api/wardrobe/gap-check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sub_type:sDp.sub_type,category:sCb.category,image:imgUrl,gap_descriptions:unmatchedGaps,aesthetic_gaps:unmatchedAesthetics,color_gaps:unmatchedColors,weakness_gaps:unmatchedCons})})
          .then(r=>r.json()).then((res:{gap_fills?:string[];aesthetic_fills?:string[];color_fills?:string[];weakness_fills?:string[]})=>{
            if(cancelled)return;
            const allGapFills=[...algorithmic,...(res.gap_fills??[])];
            const postAiAes=[...addsAesthetics,...(res.aesthetic_fills??[])];
            const postAiAesNorms=new Set(postAiAes.map(norm));
            for(const gap of allGapFills){const gl=gap.toLowerCase();for(const[kw,aes]of GAP_AES)if(gl.includes(kw))for(const a of aes)if(analysis.aesthetics.missing.includes(a)&&!postAiAesNorms.has(norm(a))){postAiAes.push(a);postAiAesNorms.add(norm(a));}}
            const aiWeaknesses=(res.weakness_fills??[]).filter(w=>!algorithmicWeaknesses.includes(w));
            setSelWaImpact({fillsGaps:allGapFills.slice(0,3),addsAesthetics:postAiAes,addsColors:[...addsColors,...(res.color_fills??[])],addressesWeaknesses:[...algorithmicWeaknesses,...aiWeaknesses]});
            setSelWaImpactReady(true);
          }).catch(()=>{
            if(cancelled)return;
            setSelWaImpact({fillsGaps:algorithmic.slice(0,3),addsAesthetics,addsColors,addressesWeaknesses:algorithmicWeaknesses});
            setSelWaImpactReady(true);
          });
      } else {
        setSelWaImpact({fillsGaps:algorithmic.slice(0,3),addsAesthetics,addsColors,addressesWeaknesses:algorithmicWeaknesses});
        setSelWaImpactReady(true);
      }
    }catch{setSelWaImpact(null);}
    return()=>{cancelled=true;};
  },[selectedIdx]);

  useEffect(()=>{
    if(three3Phase!=='stacked') return;
    if(three3AnimStarted.current) return;
    three3AnimStarted.current=true;
    const t=setTimeout(()=>{
      // Frame 1: enable the transition property (transform still at stack offset)
      setThree3Phase('distributing');
      // Frame 2: change the transform — browser now sees it against an active transition
      requestAnimationFrame(()=>{
        setThree3Moving(true);
        setTimeout(()=>setThree3Phase('done'),720);
      });
    },500);
    return ()=>clearTimeout(t);
  },[three3Phase]);

  const sorted=[...scoredSlots.entries()].sort(([,a],[,b])=>b.cScore-a.cScore).map(([i])=>i);
  const rankOf=(i:number):RankLabel=>{const r=sorted.indexOf(i);if(r===0)return"best";if(r===n-1)return"worst";return"second";};
  // Use the same overallScore formula as the display so ties/labels match what the user sees
  const _scores=scoredSlots.map(({slot})=>{
    if(!slot.confirmedBasic||!slot.deep||!slot.outfitData) return 0;
    return overallScore(pieceScore(slot.confirmedBasic,slot.deep),slot.outfitData);
  });
  function getStripInfo(i:number):{label:string;color:string}{
    if(n===2){
      if(_scores[0]===_scores[1])return{label:"TIE",color:"#d97706"};
      return rankOf(i)==="best"?{label:"BETTER",color:"#2e7d32"}:{label:"WORSE",color:"#c00000"};
    }
    const max=Math.max(..._scores),min=Math.min(..._scores);
    if(_scores.every(s=>s===max))return{label:"TIE",color:"#d97706"};
    if(_scores.filter(s=>s===max).length===2)
      return _scores[i]===max?{label:"TIED BEST",color:"#2e7d32"}:{label:"WORST",color:"#c00000"};
    if(_scores.filter(s=>s===min).length===2)
      return _scores[i]===min?{label:"TIED WORST",color:"#c00000"}:{label:"BEST",color:"#2e7d32"};
    const rank=rankOf(i);
    return rank==="best"?{label:"BEST",color:"#2e7d32"}:rank==="second"?{label:"MID",color:"#d97706"}:{label:"WORST",color:"#c00000"};
  }

  function visibleMap():CardSlots{return{left:leftCard&&!leftCard.exiting?leftCard.key:null,right:rightCard&&!rightCard.exiting?rightCard.key:null,bottom:bottomCard&&!bottomCard.exiting?bottomCard.key:null,top:topCard&&!topCard.exiting?topCard.key:null};}
  function setterFor(dir:CardDir){if(dir==="left")return setLeftCard;if(dir==="right")return setRightCard;if(dir==="top")return setTopCard;return setBottomCard;}
  function dirOf(key:CardKey,vm:CardSlots):CardDir|null{if(vm.left===key)return"left";if(vm.right===key)return"right";if(vm.bottom===key)return"bottom";if(vm.top===key)return"top";return null;}
  function exitCardInDir(dir:CardDir){const s=setterFor(dir);s(p=>p?{...p,exiting:true}:null);setTimeout(()=>s(null),250);}
  function exitCard(key:CardKey){const vm=visibleMap();const d=dirOf(key,vm);if(!d)return;exitCardInDir(d);}
  const WA_DEPENDENT_KEYS = new Set<CardKey>(["pros","aesthetics","pairings"]);
  function openCardImmediate(key:CardKey){
    const vm=visibleMap();
    if(Object.values(vm).includes(key)){exitCard(key);setOpenOrder(p=>p.filter(k=>k!==key));return;}
    const dir=findCardDir(key,vm);
    if(dir!==null){setterFor(dir)({key,exiting:false});setOpenOrder(p=>[...p,key]);}
    else{const oldest=openOrder[0];if(!oldest)return;const ed=dirOf(oldest,vm);if(!ed)return;const es=setterFor(ed);es(p=>p?{...p,exiting:true}:null);setOpenOrder(p=>[...p.filter(k=>k!==oldest),key]);setTimeout(()=>{es(null);setTimeout(()=>setterFor(ed)({key,exiting:false}),20);},250);}
  }
  function isOpen(key:CardKey){return Object.values(visibleMap()).includes(key);}
  function openCard(key:CardKey){
    if(isOpen(key)){openCardImmediate(key);return;}
    if(WA_DEPENDENT_KEYS.has(key)&&!selWaImpactReady){setPendingCardOpen(prev=>prev===key?null:key);return;}
    openCardImmediate(key);
  }
  // Once selWaImpact settles, automatically open whatever card the user already asked for.
  useEffect(()=>{
    if(selWaImpactReady&&pendingCardOpen){const key=pendingCardOpen;setPendingCardOpen(null);openCardImmediate(key);}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selWaImpactReady]);
  function btnLabel(key:CardKey,show:string,hide:string){
    if(pendingCardOpen===key) return "Loading...";
    return isOpen(key)?hide:show;
  }
  function btnColor(key:CardKey,base:string){return (isOpen(key)||pendingCardOpen===key)?"#999":base;}

  const inCompare=selectedIdx===null;
  const CMP_CTR_Y_OFFSET = 41;
  function closeAllCards(){setLeftCard(null);setRightCard(null);setBottomCard(null);setTopCard(null);setOpenOrder([]);}
  function getImgs():string[]{return scoredSlots.map(({slot:s})=>s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl??'');}
  function getInitialArrangement(i:number):number[]{
    const others=[0,1,2].filter(x=>x!==i);
    return [others[0],i,others[1]];
  }
  function selectItem(i:number){
    if(selectedIdx===i||transAnim!==null)return;
    closeAllCards();
    if(selectedIdx===null){
      // Scroll to top and lock scrolling — animation always starts from a consistent position.
      window.scrollTo(0,0);
      document.body.style.overflow='hidden';

      // Read compare image centers from live DOM before anything changes.
      const vh=window.innerHeight;
      const rects=itemRefs.current.slice(0,n).map(el=>el?.getBoundingClientRect()??null);
      const fromX=rects.map(r=>r?Math.round(r.left+r.width/2):0);
      const fromY=rects[0]?Math.round(rects[0].bottom-110):Math.round(vh/2-CMP_CTR_Y_OFFSET);

      // For n===3: set display order so selected piece is always at center slot.
      if(n===3) setPieceViewOrder(getInitialArrangement(i));

      // Fade to white, place overlay at compare positions, mount piece view — all one commit.
      setSurAlpha(0);
      setTransAnim({images:getImgs(),fromX,fromY,toX:Array(n).fill(0),toY:0,phase:'setup'});
      flushSync(()=>setSelectedIdx(i));

      // Piece view is now in DOM. Measure REAL pixel positions — no approximation.
      // getBoundingClientRect() reflects CSS transforms, so n===3 per-piece offsets are included.
      requestAnimationFrame(()=>{
        const destRects=pieceImgRefs.current.slice(0,n).map(el=>el?.getBoundingClientRect()??null);
        const toX=destRects.map(r=>r?r.left+r.width/2:window.innerWidth/2);
        const toY=destRects[0]?destRects[0].top+destRects[0].height/2:178;

        setTransAnim(p=>p?{...p,toX,toY}:null);
        requestAnimationFrame(()=>{
          setTransAnim(p=>p?{...p,phase:'active'}:null);
          setTimeout(()=>{
            setSurAlpha(1);
            setTimeout(()=>{
              setTransAnim(null);
              document.body.style.overflow='';
            },450);
          },520);
        });
      });
    } else {
      // Within piece view: for n===3 swap clicked piece with current center.
      if(n===3){
        const dp=pieceViewOrder.indexOf(i);
        if(dp===0) setPieceViewOrder([pieceViewOrder[1],pieceViewOrder[0],pieceViewOrder[2]]);
        else if(dp===2) setPieceViewOrder([pieceViewOrder[0],pieceViewOrder[2],pieceViewOrder[1]]);
      }
      setSelectedIdx(i);
    }
  }
  function returnToCompare(){
    if(transAnim!==null)return;
    closeAllCards();
    window.scrollTo(0,0);
    document.body.style.overflow='hidden';

    // Read piece image centers before unmounting.
    // pieceImgRefs are indexed by display position; map back to piece index for overlay.
    const displayRects=pieceImgRefs.current.slice(0,n).map(el=>el?.getBoundingClientRect()??null);
    // getBoundingClientRect() reflects CSS transforms, so n===3 per-piece offsets are included.
    const fromX=displayRects.map(r=>r?Math.round(r.left+r.width/2):0);
    const fromY=displayRects[0]?Math.round(displayRects[0].top+displayRects[0].height/2):178;

    // Fade to white, place overlay at piece positions, mount compare view — all one commit.
    setSurAlpha(0);
    setTransAnim({images:getImgs(),fromX,fromY,toX:Array(n).fill(0),toY:0,phase:'setup'});
    flushSync(()=>{setSelectedIdx(null);if(n===3)setPieceViewOrder([0,1,2]);});

    // Compare view is now in DOM. Measure REAL compare image positions.
    requestAnimationFrame(()=>{
      const vh=window.innerHeight;
      const destRects=itemRefs.current.slice(0,n).map(el=>el?.getBoundingClientRect()??null);
      const toX=destRects.map(r=>r?r.left+r.width/2:0);
      const toY=destRects[0]?destRects[0].bottom-110:vh/2-CMP_CTR_Y_OFFSET;

      setTransAnim(p=>p?{...p,toX,toY}:null);
      requestAnimationFrame(()=>{
        setTransAnim(p=>p?{...p,phase:'active'}:null);
        setTimeout(()=>{
          setSurAlpha(1);
          setTimeout(()=>{
            setTransAnim(null);
            document.body.style.overflow='';
          },450);
        },520);
      });
    });
  }

  // Selected-slot derived data (null in compare mode)
  const selSS=selectedIdx!==null?scoredSlots[selectedIdx]:null;
  const cb=selSS?.slot.confirmedBasic??null;
  const deep=selSS?.slot.deep??null;
  const outfitData=selSS?.slot.outfitData??null;
  const pScore=cb&&deep&&outfitData?pieceScore(cb,deep):0;
  const oScore=cb&&deep&&outfitData?overallScore(pScore,outfitData):0;
  const pieceMatchCount=outfitData?Object.keys(outfitData.items).length:0;
  const previewItem=cb&&deep&&selSS?{id:"__preview__",title:cb.title,image:selSS.slot.removedBgUrl??cb.image??selSS.slot.imageDataUrl,sub_type:deep.sub_type,category:cb.category,aesthetic_tags:deep.aesthetic_tags??null} as OutfitItem:null;

  // Strip translate: centers on selected item
  const stripTranslate=`translateX(calc(50vw - ${(selectedIdx??0)*STRIP_STEP+STRIP_W/2}px))`;

  // Precompute 2-item comparison data
  const cmpData=(n===2)?(()=>{
    const s0=scoredSlots[0],s1=scoredSlots[1];
    const cb0=s0.slot.confirmedBasic,cb1=s1.slot.confirmedBasic;
    const d0=s0.slot.deep,d1=s1.slot.deep;
    const od0=s0.slot.outfitData,od1=s1.slot.outfitData;
    if(!cb0||!cb1||!d0||!d1||!od0||!od1) return null;
    const ps0=pieceScore(cb0,d0),ps1=pieceScore(cb1,d1);
    const os0=overallScore(ps0,od0),os1=overallScore(ps1,od1);
    const pm0=Object.keys(od0.items).length,pm1=Object.keys(od1.items).length;
    const name0=s0.slot.confirmedBasic?.title??"Item 1";
    const name1=s1.slot.confirmedBasic?.title??"Item 2";
    const rows=[
      {label:"Overall",a:os0,b:os1,cFn:sColor},
      {label:"Piece score",a:ps0,b:ps1,cFn:sColor},
      {label:"Avg outfit score",a:od0.avgScore,b:od1.avgScore,cFn:sColor},
      {label:"New outfits",a:od0.outfitCount,b:od1.outfitCount,cFn:outfitCountColor},
      {label:"Aesthetic fit",a:od0.aestheticFit,b:od1.aestheticFit,cFn:sColor,suffix:"%"},
      {label:"Piece matches",a:pm0,b:pm1,cFn:pieceMatchColor},
    ] as {label:string;a:number;b:number;cFn:(v:number)=>string;suffix?:string}[];
    function betterThan(myPS:number,myOD:typeof od0,myPM:number,myD:typeof d0,thPS:number,thOD:typeof od1,thPM:number,thD:typeof d1):string[]{
      const pts:string[]=[];
      if(myOD.outfitCount>thOD.outfitCount) pts.push(`More outfit combinations (${myOD.outfitCount} vs ${thOD.outfitCount})`);
      if(myOD.avgScore>thOD.avgScore) pts.push(`Higher outfit quality (${myOD.avgScore} vs ${thOD.avgScore})`);
      if(myOD.aestheticFit>thOD.aestheticFit) pts.push(`Better wardrobe integration (${myOD.aestheticFit}% vs ${thOD.aestheticFit}%)`);
      if(myPS>thPS) pts.push(`Stronger piece score (${myPS} vs ${thPS})`);
      if(myPM>thPM) pts.push(`Pairs with more existing items (${myPM} vs ${thPM})`);
      const thPros=new Set(thD.pros??[]);
      (myD.pros??[]).filter(p=>!thPros.has(p)).forEach(p=>pts.push(p));
      return pts;
    }
    function worseThan(myPS:number,myOD:typeof od0,myPM:number,myD:typeof d0,thPS:number,thOD:typeof od1,thPM:number,thD:typeof d1):string[]{
      const pts:string[]=[];
      if(myOD.outfitCount<thOD.outfitCount) pts.push(`Fewer outfit combinations (${myOD.outfitCount} vs ${thOD.outfitCount})`);
      if(myOD.avgScore<thOD.avgScore) pts.push(`Lower outfit quality (${myOD.avgScore} vs ${thOD.avgScore})`);
      if(myOD.aestheticFit<thOD.aestheticFit) pts.push(`Lower wardrobe integration (${myOD.aestheticFit}% vs ${thOD.aestheticFit}%)`);
      if(myPS<thPS) pts.push(`Weaker piece score (${myPS} vs ${thPS})`);
      if(myPM<thPM) pts.push(`Fewer wardrobe pairings (${myPM} vs ${thPM})`);
      const thCons=new Set(thD.cons??[]);
      (myD.cons??[]).filter(c=>!thCons.has(c)).forEach(c=>pts.push(c));
      return pts;
    }
    const aes0=new Set(d0.aesthetic_tags??[]),aes1=new Set(d1.aesthetic_tags??[]);
    const sharedAes=(d0.aesthetic_tags??[]).filter(t=>aes1.has(t));
    const onlyAes0=(d0.aesthetic_tags??[]).filter(t=>!aes1.has(t));
    const onlyAes1=(d1.aesthetic_tags??[]).filter(t=>!aes0.has(t));
    const sharedPros=(d0.pros??[]).filter(p=>(d1.pros??[]).includes(p));
    const sims:string[]=[],diffs:string[]=[];
    if(sharedAes.length>0) sims.push(`Shared aesthetic: ${sharedAes.join(", ")}`);
    if(d0.formality&&d1.formality&&d0.formality===d1.formality) sims.push(`Same formality (${d0.formality})`);
    sharedPros.slice(0,3).forEach(p=>sims.push(p));
    if(Math.abs(os0-os1)<=8) sims.push(`Comparable overall quality (${os0} vs ${os1})`);
    if(d0.sub_type&&d1.sub_type&&d0.sub_type!==d1.sub_type) diffs.push(`${d0.sub_type} vs ${d1.sub_type}`);
    if(d0.formality&&d1.formality&&d0.formality!==d1.formality) diffs.push(`${name0}: ${d0.formality} / ${name1}: ${d1.formality}`);
    if(onlyAes0.length>0) diffs.push(`${name0}: ${onlyAes0.join(", ")}`);
    if(onlyAes1.length>0) diffs.push(`${name1}: ${onlyAes1.join(", ")}`);
    if(Math.abs(os0-os1)>8) diffs.push(`${Math.abs(os0-os1)}-point quality gap`);
    return{
      rows,names:[name0,name1],
      better0:betterThan(ps0,od0,pm0,d0,ps1,od1,pm1,d1),
      worse0:worseThan(ps0,od0,pm0,d0,ps1,od1,pm1,d1),
      better1:betterThan(ps1,od1,pm1,d1,ps0,od0,pm0,d0),
      worse1:worseThan(ps1,od1,pm1,d1,ps0,od0,pm0,d0),
      sims,diffs,
    };
  })():null;

  const vis=contentVisible;

  return (
    <div style={{...FONT,minHeight:"100vh",background:"#fff"}}>
      <style suppressHydrationWarning>{KEYFRAMES_CSS}</style>
      {/* ── n===2: unified three-column layout (compare + selected, no branch swap) ── */}
      {/* Compare loading overlay — spinner that fades out when AI data arrives */}
      {n===2&&loaderShowing&&(
        <div style={{position:"fixed",inset:0,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",...FONT,
          zIndex:100,opacity:aiCmp==="loading"?1:0,transition:aiCmp==="loading"?"none":"opacity 0.4s ease",
          pointerEvents:aiCmp==="loading"?"auto":"none"}}>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:120}}>
            <Spinner size={17}/>
            <span style={{fontSize:15,letterSpacing:"0.08em",color:"#666"}}>Comparing items...</span>
          </div>
        </div>
      )}
      {n===3&&loaderShowing3&&(
        <div style={{position:"fixed",inset:0,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",...FONT,
          zIndex:100,opacity:aiCmp3==="loading"?1:0,transition:aiCmp3==="loading"?"none":"opacity 0.4s ease",
          pointerEvents:aiCmp3==="loading"?"auto":"none"}}>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:120}}>
            <Spinner size={17}/>
            <span style={{fontSize:15,letterSpacing:"0.08em",color:"#666"}}>Comparing items...</span>
          </div>
        </div>
      )}
      {n===2&&(()=>{
        if(aiCmp==="loading") return null;
        const resolved=aiCmp??{
          better0:cmpData?.better0??[],worse0:cmpData?.worse0??[],
          better1:cmpData?.better1??[],worse1:cmpData?.worse1??[],
          sims:cmpData?.sims??[],diffs:cmpData?.diffs??[],
        };
        function renderPanel(better:string[],worse:string[],title:string|null|undefined,pIdx:number) {
          const panelOpacity=(!vis?0:!inCompare?0:1)*surAlpha;
          const atBot=panelsAtBottom[pIdx]??false;
          const atTop=panelsAtTop[pIdx]??true;
          const sections=[
            ...(better.length>0?[{label:"BETTER",items:better,color:"#2e7d32"}]:[]),
            ...(worse.length>0?[{label:"WORSE",items:worse,color:"#c00"}]:[]),
            ...(resolved.sims.length>0?[{label:"SIMILARITIES",items:resolved.sims,color:"#555"}]:[]),
            ...(resolved.diffs.length>0?[{label:"DIFFERENCES",items:resolved.diffs,color:"#555"}]:[]),
          ];
          return (
            <div style={{flex:"1 1 0",maxWidth:440,alignSelf:"stretch",position:"relative",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
              <div style={{height:52,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",paddingInline:18}}>
                {title&&<p style={{...FONT,fontSize:13,fontWeight:700,textAlign:"center",letterSpacing:"0.05em",margin:0,lineHeight:1.3,opacity:panelOpacity,transition:"opacity 0.4s ease"}}>{title}</p>}
              </div>
              <div
                ref={el=>{panelScrollRefs.current[pIdx]=el;}}
                onScroll={e=>{
                  const el=e.currentTarget;
                  const isBot=el.scrollHeight<=el.clientHeight+8||el.scrollTop+el.clientHeight>=el.scrollHeight-8;
                  const isTop=el.scrollTop<=8;
                  setPanelsAtBottom(prev=>{const arr=[...prev];arr[pIdx]=isBot;return arr;});
                  setPanelsAtTop(prev=>{const arr=[...prev];arr[pIdx]=isTop;return arr;});
                }}
                style={{flex:1,overflowY:"auto",scrollbarWidth:"none" as const,textAlign:"center",paddingBottom:180,paddingInline:18,opacity:panelOpacity,transition:"opacity 0.4s ease",pointerEvents:inCompare?"auto":"none"}}
              >
                {sections.map((s,si)=>(
                  <div key={si} style={{marginBottom:si<sections.length-1?32:0}}>
                    <p style={{...FONT,fontSize:13,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase" as const,marginBottom:16,marginTop:0}}>{s.label}</p>
                    {s.items.map((text,j)=><p key={j} style={{...FONT,fontSize:17,color:s.color,marginBottom:14,lineHeight:1.7,marginTop:0}}>{text}</p>)}
                  </div>
                ))}
              </div>
              {/* Top fade — appears as user scrolls down */}
              <div style={{position:"absolute",top:52,left:0,right:0,height:80,
                background:"linear-gradient(to bottom,rgba(255,255,255,1) 0%,rgba(255,255,255,0) 100%)",
                pointerEvents:"none",opacity:atTop?0:1,transition:"opacity 0.3s ease"}}/>
              {/* Bottom section — gradient hides scrollable content; arrow flips and scrolls */}
              <div style={{position:"absolute",bottom:0,left:0,right:0,pointerEvents:"none"}}>
                <div style={{height:220,width:"100%",background:"linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(255,255,255,1) 35%)",
                  opacity:atBot?0:1,transition:"opacity 0.3s ease"}}/>
                <div onClick={()=>{const el=panelScrollRefs.current[pIdx];if(!el)return;atBot?el.scrollTo({top:0,behavior:"smooth"}):el.scrollBy({top:300,behavior:"smooth"});}}
                  style={{background:"#fff",width:"100%",display:"flex",justifyContent:"center",paddingTop:4,paddingBottom:16,
                    cursor:"pointer",pointerEvents:"auto",
                    opacity:(atTop&&atBot)?0:1,transition:"opacity 0.3s ease"}}>
                  {atBot
                    ? <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 7L7 1L13 7" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 1L7 7L13 1" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  }
                </div>
              </div>
            </div>
          );
        }

        const title0=scoredSlots[0].slot.confirmedBasic?.title;
        const title1=scoredSlots[1].slot.confirmedBasic?.title;

        return (
          <div style={{display:"flex",flexDirection:"column",opacity:compareEntered?1:0,transition:"opacity 0.4s ease"}}>

            {/* === COMPARE MODE: full-viewport 5-column, Reset button overlaid === */}
            {inCompare&&(
              <div style={{display:"flex",justifyContent:"center",height:"100vh",overflow:"hidden" as const,position:"relative" as const}}>
                {/* Reset button — absolute so it overlays the top-right of the panel area */}
                <div style={{position:"absolute" as const,top:14,right:24,zIndex:2,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                  <button onClick={onReset} style={cardBtnStyle("#c83030")}>Reset</button>
                </div>
                {renderPanel(resolved.better0,resolved.worse0,title0,0)}
                <div style={{width:ITEM_COL_W,flexShrink:0,display:"flex",justifyContent:"center",alignItems:"flex-start",paddingTop:"calc(50vh - 175px)" as unknown as number,overflow:"visible" as const,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                  {(()=>{
                    const s=scoredSlots[0].slot;
                    const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                    const isBetter0=rankOf(0)==="best";
                    return (
                      <div ref={el=>{itemRefs.current[0]=el;}} onClick={()=>selectItem(0)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",
                        transform:imgAtTop?"none":compareEntranceTransforms[0],
                        transition:"transform 0.7s cubic-bezier(0.4,0,0.2,1)"}}>
                        <p style={{...FONT,fontSize:12,fontWeight:700,letterSpacing:"0.12em",color:isBetter0?"#2e7d32":"#c00",margin:0}}>{isBetter0?"BETTER":"WORSE"}</p>
                        {sImg&&<img src={sImg} alt="" style={{height:220,maxWidth:ITEM_COL_W,objectFit:"contain",display:"block"}}/>}
                      </div>
                    );
                  })()}
                </div>
                <div style={{width:SCORE_COL_W,flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",paddingTop:"calc(50vh - 260px)" as unknown as number}}>
                  <div style={{width:"100%",opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                    {cmpData?.rows.map(({label,a,b,cFn,suffix=""})=>{
                      return (
                        <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:22}}>
                          <span style={{...FONT,fontSize:44,fontWeight:800,color:cFn(a)}}>{a}{suffix}</span>
                          <span style={{...FONT,fontSize:13,fontWeight:700,color:"#111",letterSpacing:"0.1em",whiteSpace:"nowrap" as const}}>{label.toUpperCase()}</span>
                          <span style={{...FONT,fontSize:44,fontWeight:800,color:cFn(b)}}>{b}{suffix}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{width:ITEM_COL_W,flexShrink:0,display:"flex",justifyContent:"center",alignItems:"flex-start",paddingTop:"calc(50vh - 175px)" as unknown as number,overflow:"visible" as const,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                  {(()=>{
                    const s=scoredSlots[1].slot;
                    const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                    const isBetter1=rankOf(1)==="best";
                    return (
                      <div ref={el=>{itemRefs.current[1]=el;}} onClick={()=>selectItem(1)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",
                        transform:imgAtTop?"none":compareEntranceTransforms[1],
                        transition:"transform 0.7s cubic-bezier(0.4,0,0.2,1)"}}>
                        <p style={{...FONT,fontSize:12,fontWeight:700,letterSpacing:"0.12em",color:isBetter1?"#2e7d32":"#c00",margin:0}}>{isBetter1?"BETTER":"WORSE"}</p>
                        {sImg&&<img src={sImg} alt="" style={{height:220,maxWidth:ITEM_COL_W,objectFit:"contain",display:"block"}}/>}
                      </div>
                    );
                  })()}
                </div>
                {renderPanel(resolved.better1,resolved.worse1,title1,1)}
              </div>
            )}

            {/* === SPECIFIC MODE: header — normal flow, scrolls with page === */}
            {!inCompare&&cb&&(
              <div style={{height:52,display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",
                paddingInline:24,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-end",paddingRight:56}}>
                  <button onClick={()=>openCard("pros")}          style={cardBtnStyle(btnColor("pros",          CARD_COLORS.pros))}>          {btnLabel("pros",          "Show pros",          "Hide pros")}          </button>
                  <button onClick={()=>openCard("aesthetics")}    style={cardBtnStyle(btnColor("aesthetics",    CARD_COLORS.aesthetics))}>    {btnLabel("aesthetics",    "Show aesthetics",    "Hide aesthetics")}    </button>
                  <button onClick={()=>openCard("piece_pairings")}style={cardBtnStyle(btnColor("piece_pairings",CARD_COLORS.piece_pairings))}>{btnLabel("piece_pairings","Show piece pairings","Hide piece pairings")} </button>
                </div>
                <p style={{...FONT,fontSize:21,fontWeight:700,textAlign:"center",lineHeight:1.2,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"28vw"}}>{cb.title}</p>
                <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-start",paddingLeft:56}}>
                  <button onClick={()=>openCard("cons")}     style={cardBtnStyle(btnColor("cons",    CARD_COLORS.cons))}>     {btnLabel("cons",    "Show cons",         "Hide cons")}          </button>
                  <button onClick={()=>openCard("pairings")} style={cardBtnStyle(btnColor("pairings",CARD_COLORS.pairings))}> {btnLabel("pairings","Show color pairings","Hide color pairings")} </button>
                  <button onClick={onReset}                  style={cardBtnStyle("#c83030")}>Reset</button>
                </div>
              </div>
            )}

            {/* Overlay container — always in DOM so its GPU compositing layer is never destroyed mid-animation */}
            <div style={{position:"fixed" as const,inset:0,pointerEvents:"none" as const,zIndex:999}}>
              {transAnim&&transAnim.images.map((img,idx)=>{
                const a=transAnim;
                const cx=a.phase==='active'?a.toX[idx]:a.fromX[idx];
                const cy=a.phase==='active'?a.toY:a.fromY;
                return (
                  <div key={idx} style={{position:"absolute" as const,left:0,top:0,width:220,height:220,
                    transform:`translate(${cx-110}px,${cy-110}px)`,
                    transition:a.phase==='active'?"transform 0.5s cubic-bezier(0.4,0,0.2,1)":"none",
                    opacity:1,
                    pointerEvents:"none" as const}}>
                    {img&&<img src={img} alt="" style={{width:220,height:220,objectFit:"contain" as const,display:"block"}}/>}
                  </div>
                );
              })}
            </div>

            {/* === SPECIFIC MODE: image strip — normal flow, scrolls with page === */}
            {!inCompare&&(
              <div style={{width:"100%",display:"flex",justifyContent:"center",overflow:"hidden",
                paddingBlock:16,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                <div style={{display:"flex",gap:48,alignItems:"center",
                  transform:`translateX(${((n-1)/2-(selectedIdx??0))*268}px)`,
                  transition:(prevSelectedIdx.current!==null&&selectedIdx!==null)?"transform 0.5s cubic-bezier(0.4,0,0.2,1)":"none"}}>
                  {scoredSlots.map(({slot:s},i)=>{
                    const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                    const isSelected=selectedIdx===i;
                    const {label:stripLabel,color:stripColor}=getStripInfo(i);
                    return (
                      <div key={i} onClick={()=>!isSelected&&selectItem(i)}
                        style={{display:"flex",flexDirection:"column",alignItems:"center",cursor:isSelected?"default":"pointer"}}>
                        <div style={{height:22,display:"flex",alignItems:"center",marginBottom:6}}>
                          <span style={{...FONT,fontSize:11,fontWeight:700,letterSpacing:"0.13em",color:stripColor}}>{stripLabel}</span>
                        </div>
                        <div ref={el=>{pieceImgRefs.current[i]=el;}}
                          style={{width:220,display:"flex",justifyContent:"center"}}>
                          {sImg&&<img src={sImg} alt="" style={{height:220,maxWidth:220,objectFit:"contain",display:"block"}}/>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* === SPECIFIC MODE: scrollable content — follows image strip in normal flow === */}
            {!inCompare&&selectedIdx!==null&&cb&&deep&&outfitData&&(
              <div style={{paddingBottom:80,display:"flex",flexDirection:"column",alignItems:"center",width:"100%",opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
                  <button onClick={returnToCompare} style={txtBtn("#888")}>COMPARE VIEW</button>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:24,marginBottom:36,paddingInline:24}}>
                  <div style={{display:"flex",gap:56,alignItems:"flex-start",justifyContent:"center",flexWrap:"wrap"}}>
                    <StatNum value={`${pScore}`}                   label="Piece score"      color={sColor(pScore)}/>
                    <StatNum value={`${outfitData.avgScore}`}      label="Avg outfit score" color={sColor(outfitData.avgScore)}/>
                    <StatNum value={`${outfitData.outfitCount}`}   label="New outfits"      color={outfitCountColor(outfitData.outfitCount)}/>
                    <StatNum value={`${outfitData.aestheticFit}%`} label="Aesthetic fit"    color={sColor(outfitData.aestheticFit)}/>
                    <StatNum value={`${pieceMatchCount}`}          label="Piece matches"    color={pieceMatchColor(pieceMatchCount)}/>
                  </div>
                  <StatNum value={`${oScore}`} label="Overall" color={sColor(oScore)} big/>
                </div>
                {outfitData.outfits.length>0&&previewItem&&(
                  <OutfitGallery outfits={outfitData.outfits} items={outfitData.items} previewItem={previewItem} totalCount={outfitData.outfitCount}/>
                )}
              </div>
            )}

          </div>
        );
      })()}

      {/* ── n===1: single-item centered column ── */}
      {n===1&&(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingBottom:80}}>

        {/* Selected-mode header bar — sticky so it doesn't scroll away */}
        {!inCompare&&cb&&deep&&outfitData&&(
          <div style={{opacity:vis?1:0,transition:"opacity 0.6s ease",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",position:"sticky",top:0,zIndex:10,background:"#fff"}}>
            <div style={{width:"100%",height:52,display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",paddingInline:24}}>
              <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-end",paddingRight:56}}>
                <button onClick={()=>openCard("pros")}          style={cardBtnStyle(btnColor("pros",          CARD_COLORS.pros))}>          {btnLabel("pros",          "Show pros",          "Hide pros")}          </button>
                <button onClick={()=>openCard("aesthetics")}    style={cardBtnStyle(btnColor("aesthetics",    CARD_COLORS.aesthetics))}>    {btnLabel("aesthetics",    "Show aesthetics",    "Hide aesthetics")}    </button>
                <button onClick={()=>openCard("piece_pairings")}style={cardBtnStyle(btnColor("piece_pairings",CARD_COLORS.piece_pairings))}>{btnLabel("piece_pairings","Show piece pairings","Hide piece pairings")} </button>
              </div>
              <p style={{...FONT,fontSize:21,fontWeight:700,textAlign:"center",lineHeight:1.2,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"28vw"}}>{cb.title}</p>
              <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-start",paddingLeft:56}}>
                <button onClick={()=>openCard("cons")}     style={cardBtnStyle(btnColor("cons",    CARD_COLORS.cons))}>     {btnLabel("cons",    "Show cons",         "Hide cons")}          </button>
                <button onClick={()=>openCard("pairings")} style={cardBtnStyle(btnColor("pairings",CARD_COLORS.pairings))}> {btnLabel("pairings","Show color pairings","Hide color pairings")} </button>
                <button onClick={onReset}                  style={cardBtnStyle("#c83030")}>Reset</button>
              </div>
            </div>
            {cb.brand&&<p style={{...FONT,fontSize:11,fontWeight:700,color:"#111",letterSpacing:"0.15em",margin:0,marginTop:-4,marginBottom:12}}>{cb.brand.toUpperCase()}</p>}
          </div>
        )}

        {/* Compare-mode top bar */}
        {inCompare&&(
          <div style={{opacity:vis?1:0,transition:"opacity 0.6s ease",width:"100%",height:52,display:"flex",alignItems:"center",justifyContent:"flex-end",paddingInline:24,position:"sticky",top:0,zIndex:10,background:"#fff"}}>
            <button onClick={onReset} style={cardBtnStyle("#c83030")}>Reset</button>
          </div>
        )}

        {/* Compare-mode items */}
        {inCompare&&(()=>{
          const CMP_W=480, cmpGap=12;
          const cmpItemW=(CMP_W-cmpGap*(n-1))/n;
          return (
            <div style={{display:"flex",gap:cmpGap,width:"100%",maxWidth:520,paddingInline:20,marginBottom:20}}>
              {scoredSlots.map(({slot:s},i)=>{
                const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                const scb=s.confirmedBasic;
                const {badge,color}=RANK_BADGE[rankOf(i)];
                const d=s.deep,od=s.outfitData;
                const ps=scb&&d&&od?pieceScore(scb,d):0;
                const os=scb&&d&&od?overallScore(ps,od):0;
                const naturalCenter=i*(cmpItemW+cmpGap)+cmpItemW/2;
                const xOff=imgAtTop?0:Math.round(CMP_W/2-naturalCenter);
                return (
                  <div key={i} onClick={()=>imgAtTop&&selectItem(i)}
                    style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",
                      cursor:imgAtTop?"pointer":"default",gap:8,
                      transition:"transform 0.7s cubic-bezier(0.4,0,0.2,1)",
                      transform:imgAtTop?"none":`translateX(${xOff}px) translateY(calc(50vh - 178px))`}}>
                    {scb&&<p style={{...FONT,fontSize:10,fontWeight:700,textAlign:"center",width:"100%",lineHeight:1.3,margin:0,opacity:vis?1:0,transition:"opacity 0.5s ease"}}>{scb.title}</p>}
                    {sImg&&<img src={sImg} alt="" style={{height:160,maxWidth:"100%",objectFit:"contain",display:"block"}}/>}
                    <p style={{...FONT,fontSize:12,fontWeight:700,letterSpacing:"0.08em",color,margin:0,marginTop:4,opacity:vis?1:0,transition:"opacity 0.5s ease"}}>{badge}</p>
                    {d&&od&&(
                      <div style={{opacity:vis?1:0,transition:"opacity 0.5s ease"}}>
                        <StatNum value={`${os}`} label="Overall" color={sColor(os)} small/>
                        <StatNum value={`${od.outfitCount}`} label="Outfits" color={outfitCountColor(od.outfitCount)} small/>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Selected-mode item strip — sticky below the header */}
        {!inCompare&&(
          <div style={{width:"100%",overflow:"hidden",marginBottom:20,opacity:vis?1:0,transition:"opacity 0.6s ease",position:"sticky",top:52,zIndex:9,background:"#fff"}}>
            <div style={{display:"flex",gap:STRIP_GAP,alignItems:"flex-end",transition:"transform 0.4s cubic-bezier(0.4,0,0.2,1)",transform:stripTranslate}}>
              {scoredSlots.map(({slot:s},i)=>{
                const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                const sel=selectedIdx===i;
                const {badge,color}=RANK_BADGE[rankOf(i)];
                return (
                  <div key={i} onClick={()=>!sel&&selectItem(i)}
                    style={{width:STRIP_W,flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",cursor:sel?"default":"pointer",transition:"opacity 0.25s"}}>
                    <div style={{transition:"transform 0.4s cubic-bezier(0.4,0,0.2,1),filter 0.4s ease",transform:sel?"translateY(-12px)":"translateY(0)",filter:sel?"drop-shadow(0 10px 20px rgba(0,0,0,0.18))":"none"}}>
                      {sImg&&<img src={sImg} alt="" style={{height:sel?210:148,width:"100%",objectFit:"contain",display:"block",transition:"height 0.3s ease"}}/>}
                    </div>
                    {sel&&<p style={{...FONT,fontSize:8,fontWeight:700,letterSpacing:"0.12em",color,marginTop:5,marginBottom:0}}>{badge}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected-item content */}
        {!inCompare&&cb&&deep&&outfitData&&(
          <div style={{opacity:vis?1:0,transition:"opacity 0.6s ease",display:"flex",flexDirection:"column",alignItems:"center",width:"100%"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
              <button onClick={returnToCompare} style={txtBtn("#888")}>COMPARE VIEW</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:24,marginBottom:36,paddingInline:24}}>
              <div style={{display:"flex",gap:56,alignItems:"flex-start",justifyContent:"center",flexWrap:"wrap"}}>
                <StatNum value={`${pScore}`}                   label="Piece score"      color={sColor(pScore)}/>
                <StatNum value={`${outfitData.avgScore}`}      label="Avg outfit score" color={sColor(outfitData.avgScore)}/>
                <StatNum value={`${outfitData.outfitCount}`}   label="New outfits"      color={outfitCountColor(outfitData.outfitCount)}/>
                <StatNum value={`${outfitData.aestheticFit}%`} label="Aesthetic fit"    color={sColor(outfitData.aestheticFit)}/>
                <StatNum value={`${pieceMatchCount}`}          label="Piece matches"    color={pieceMatchColor(pieceMatchCount)}/>
              </div>
              <StatNum value={`${oScore}`} label="Overall" color={sColor(oScore)} big/>
            </div>
            {outfitData.outfits.length>0&&previewItem&&(
              <OutfitGallery outfits={outfitData.outfits} items={outfitData.items} previewItem={previewItem} totalCount={outfitData.outfitCount}/>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── n===3: horizontal compare + shared piece view ── */}
      {n===3&&(()=>{
        const slots3=scoredSlots.map(({slot})=>{
          const scb3=slot.confirmedBasic,d=slot.deep,od=slot.outfitData;
          const ps=scb3&&d&&od?pieceScore(scb3,d):0;
          const os=scb3&&d&&od?overallScore(ps,od):0;
          const pm=od?Object.keys(od.items).length:0;
          return {slot,d,od,ps,os,pm};
        });
        const statRows=[
          {label:"Overall",     vals:slots3.map(s=>s.os),                   cFn:sColor,          suffix:""},
          {label:"Piece Score", vals:slots3.map(s=>s.ps),                   cFn:sColor,          suffix:""},
          {label:"Avg Outfit",  vals:slots3.map(s=>s.od?.avgScore??0),      cFn:sColor,          suffix:""},
          {label:"New Outfits", vals:slots3.map(s=>s.od?.outfitCount??0),   cFn:outfitCountColor,suffix:""},
          {label:"Aesthetic",   vals:slots3.map(s=>s.od?.aestheticFit??0),  cFn:sColor,          suffix:"%"},
          {label:"Matches",     vals:slots3.map(s=>s.pm),                   cFn:pieceMatchColor, suffix:""},
        ];
        // Use AI-generated content when loaded; fall back to numeric computed data
        const resolved3=aiCmp3&&aiCmp3!=="loading"?aiCmp3:null;
        function perPieceBetter(i:number):string[]{
          if(resolved3) return resolved3.better[i]??[];
          const my=slots3[i];
          const [a,b]=slots3.filter((_,j)=>j!==i);
          const pts:string[]=[];
          const myOC=my.od?.outfitCount??0,aOC=a.od?.outfitCount??0,bOC=b.od?.outfitCount??0;
          if(myOC>aOC&&myOC>bOC) pts.push(`More outfit combinations (${myOC} vs ${aOC}, ${bOC})`);
          else if(myOC>aOC) pts.push(`More outfit combinations (${myOC} vs ${aOC})`);
          else if(myOC>bOC) pts.push(`More outfit combinations (${myOC} vs ${bOC})`);
          const myAV=my.od?.avgScore??0,aAV=a.od?.avgScore??0,bAV=b.od?.avgScore??0;
          if(myAV>aAV&&myAV>bAV) pts.push(`Higher outfit quality (${myAV} vs ${aAV}, ${bAV})`);
          else if(myAV>aAV) pts.push(`Higher outfit quality (${myAV} vs ${aAV})`);
          else if(myAV>bAV) pts.push(`Higher outfit quality (${myAV} vs ${bAV})`);
          const myAE=my.od?.aestheticFit??0,aAE=a.od?.aestheticFit??0,bAE=b.od?.aestheticFit??0;
          if(myAE>aAE&&myAE>bAE) pts.push(`Better wardrobe integration (${myAE}% vs ${aAE}%, ${bAE}%)`);
          else if(myAE>aAE) pts.push(`Better wardrobe integration (${myAE}% vs ${aAE}%)`);
          else if(myAE>bAE) pts.push(`Better wardrobe integration (${myAE}% vs ${bAE}%)`);
          if(my.ps>a.ps&&my.ps>b.ps) pts.push(`Stronger piece score (${my.ps} vs ${a.ps}, ${b.ps})`);
          else if(my.ps>a.ps) pts.push(`Stronger piece score (${my.ps} vs ${a.ps})`);
          else if(my.ps>b.ps) pts.push(`Stronger piece score (${my.ps} vs ${b.ps})`);
          if(my.pm>a.pm&&my.pm>b.pm) pts.push(`Pairs with more existing items (${my.pm} vs ${a.pm}, ${b.pm})`);
          else if(my.pm>a.pm) pts.push(`Pairs with more existing items (${my.pm} vs ${a.pm})`);
          else if(my.pm>b.pm) pts.push(`Pairs with more existing items (${my.pm} vs ${b.pm})`);
          const otherPros=new Set([...(a.d?.pros??[]),...(b.d?.pros??[])]);
          (my.d?.pros??[]).filter(p=>!otherPros.has(p)).forEach(p=>pts.push(p));
          return pts;
        }
        function perPieceWorse(i:number):string[]{
          if(resolved3) return resolved3.worse[i]??[];
          const my=slots3[i];
          const [a,b]=slots3.filter((_,j)=>j!==i);
          const pts:string[]=[];
          const myOC=my.od?.outfitCount??0,aOC=a.od?.outfitCount??0,bOC=b.od?.outfitCount??0;
          if(myOC<aOC&&myOC<bOC) pts.push(`Fewer outfit combinations (${myOC} vs ${aOC}, ${bOC})`);
          else if(myOC<aOC) pts.push(`Fewer outfit combinations (${myOC} vs ${aOC})`);
          else if(myOC<bOC) pts.push(`Fewer outfit combinations (${myOC} vs ${bOC})`);
          const myAV=my.od?.avgScore??0,aAV=a.od?.avgScore??0,bAV=b.od?.avgScore??0;
          if(myAV<aAV&&myAV<bAV) pts.push(`Lower outfit quality (${myAV} vs ${aAV}, ${bAV})`);
          else if(myAV<aAV) pts.push(`Lower outfit quality (${myAV} vs ${aAV})`);
          else if(myAV<bAV) pts.push(`Lower outfit quality (${myAV} vs ${bAV})`);
          const myAE=my.od?.aestheticFit??0,aAE=a.od?.aestheticFit??0,bAE=b.od?.aestheticFit??0;
          if(myAE<aAE&&myAE<bAE) pts.push(`Lower wardrobe integration (${myAE}% vs ${aAE}%, ${bAE}%)`);
          else if(myAE<aAE) pts.push(`Lower wardrobe integration (${myAE}% vs ${aAE}%)`);
          else if(myAE<bAE) pts.push(`Lower wardrobe integration (${myAE}% vs ${bAE}%)`);
          if(my.ps<a.ps&&my.ps<b.ps) pts.push(`Weaker piece score (${my.ps} vs ${a.ps}, ${b.ps})`);
          else if(my.ps<a.ps) pts.push(`Weaker piece score (${my.ps} vs ${a.ps})`);
          else if(my.ps<b.ps) pts.push(`Weaker piece score (${my.ps} vs ${b.ps})`);
          if(my.pm<a.pm&&my.pm<b.pm) pts.push(`Fewer wardrobe pairings (${my.pm} vs ${a.pm}, ${b.pm})`);
          else if(my.pm<a.pm) pts.push(`Fewer wardrobe pairings (${my.pm} vs ${a.pm})`);
          else if(my.pm<b.pm) pts.push(`Fewer wardrobe pairings (${my.pm} vs ${b.pm})`);
          const otherCons=new Set([...(a.d?.cons??[]),...(b.d?.cons??[])]);
          (my.d?.cons??[]).filter(c=>!otherCons.has(c)).forEach(c=>pts.push(c));
          return pts;
        }
        function perPieceSims(i:number):string[]{
          if(resolved3) return resolved3.sims[i]??[];
          return [];
        }
        function perPieceDiffs(i:number):string[]{
          if(resolved3) return resolved3.diffs[i]??[];
          return [];
        }
        function renderPanel3(better:string[],worse:string[],sims:string[],diffs:string[],pIdx:number){
          const panelOpacity=(!vis?0:!inCompare?0:three3Phase==='done'?1:0)*surAlpha;
          const atBot=panelsAtBottom[pIdx]??false;
          const atTop=panelsAtTop[pIdx]??true;
          const sections=[
            ...(better.length>0?[{label:"BETTER",items:better,color:"#2e7d32"}]:[]),
            ...(worse.length>0?[{label:"WORSE",items:worse,color:"#c00"}]:[]),
            ...(sims.length>0?[{label:"SIMILARITIES",items:sims,color:"#555"}]:[]),
            {label:"DIFFERENCES",items:diffs.length>0?diffs:["None"],color:diffs.length>0?"#555":"#bbb"},
          ];
          return (
            <div style={{flex:1,width:"100%",maxWidth:380,position:"relative",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
              <div ref={el=>{panelScrollRefs.current[pIdx]=el;}}
                onScroll={e=>{
                  const el=e.currentTarget;
                  const isBot=el.scrollHeight<=el.clientHeight+8||el.scrollTop+el.clientHeight>=el.scrollHeight-8;
                  const isTop=el.scrollTop<=8;
                  setPanelsAtBottom(prev=>{const arr=[...prev];arr[pIdx]=isBot;return arr;});
                  setPanelsAtTop(prev=>{const arr=[...prev];arr[pIdx]=isTop;return arr;});
                }}
                style={{flex:1,overflowY:"auto",scrollbarWidth:"none" as const,textAlign:"center",
                  paddingBottom:160,paddingInline:18,paddingTop:8,
                  opacity:panelOpacity,transition:"opacity 0.4s ease",pointerEvents:inCompare?"auto":"none"}}>
                {sections.map((s,si)=>(
                  <div key={si} style={{marginBottom:si<sections.length-1?32:0}}>
                    <p style={{...FONT,fontSize:13,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase" as const,marginBottom:16,marginTop:0}}>{s.label}</p>
                    {s.items.map((text,j)=><p key={j} style={{...FONT,fontSize:17,color:s.color,marginBottom:14,lineHeight:1.7,marginTop:0}}>{text}</p>)}
                  </div>
                ))}
              </div>
              <div style={{position:"absolute",top:0,left:0,right:0,height:60,
                background:"linear-gradient(to bottom,rgba(255,255,255,1) 0%,rgba(255,255,255,0) 100%)",
                pointerEvents:"none",opacity:atTop?0:1,transition:"opacity 0.3s ease"}}/>
              <div style={{position:"absolute",bottom:0,left:0,right:0,pointerEvents:"none"}}>
                <div style={{height:140,width:"100%",background:"linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(255,255,255,1) 35%)",
                  opacity:atBot?0:1,transition:"opacity 0.3s ease"}}/>
                <div onClick={()=>{const el=panelScrollRefs.current[pIdx];if(!el)return;atBot?el.scrollTo({top:0,behavior:"smooth"}):el.scrollBy({top:240,behavior:"smooth"});}}
                  style={{background:"#fff",width:"100%",display:"flex",justifyContent:"center",paddingTop:4,paddingBottom:12,
                    cursor:"pointer",pointerEvents:"auto",opacity:(atTop&&atBot)?0:1,transition:"opacity 0.3s ease"}}>
                  {atBot
                    ? <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 7L7 1L13 7" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 1L7 7L13 1" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  }
                </div>
              </div>
            </div>
          );
        }
        const cmpLabel=(i:number)=>getStripInfo(i).label;
        const cmpColor=(i:number)=>getStripInfo(i).color;
        return (
          <div style={{display:"flex",flexDirection:"column",opacity:compareEntered?1:0,transition:"opacity 0.4s ease"}}>
            {/* ── COMPARE MODE ── */}
            {inCompare&&(
              <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",position:"relative"}}>
                <div style={{position:"absolute",top:14,right:24,zIndex:2,opacity:vis&&three3Phase==='done'?surAlpha:0,transition:"opacity 0.4s ease"}}>
                  <button onClick={onReset} style={cardBtnStyle("#c83030")}>Reset</button>
                </div>
                {/* Stats header hidden during entrance animation, fades in after distribution */}
                <div style={{flexShrink:0,display:"grid",gridTemplateColumns:"repeat(6,1fr)",width:"100%",
                  opacity:vis&&three3Phase==='done'?surAlpha:0,transition:"opacity 0.4s ease"}}>
                  {statRows.map(({label,vals,cFn,suffix},si)=>(
                    <div key={si} style={{display:"flex",flexDirection:"column",alignItems:"center",
                      paddingBlock:14,paddingInline:6}}>
                      <p style={{...FONT,fontSize:12,fontWeight:700,letterSpacing:"0.12em",color:"#111",
                        margin:0,marginBottom:6,textTransform:"uppercase" as const,textAlign:"center" as const,lineHeight:1.2}}>{label}</p>
                      <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"center"}}>
                        {vals.map((v,vi)=>(
                          <span key={vi} style={{...FONT,fontSize:20,fontWeight:800,color:cFn(v),lineHeight:1}}>{v}{suffix}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Three item+panel columns — overflow:visible during entrance so items can cross column boundaries */}
                <div style={{flex:1,display:"flex",minHeight:0,overflow:three3Phase==='done'?"hidden":"visible"}}>
                  {scoredSlots.map(({slot:s},i)=>{
                    const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                    // Stack: all 3 items overlap at viewport center.
                    // X offset moves col 0 right and col 2 left by 1/3 viewport.
                    // Y offset compensates for the invisible-but-present stats header (~72px)
                    // plus paddingTop (16px) so image center lands at 50vh.
                    const xOff=i===0?"translateX(33.33vw)":i===2?"translateX(-33.33vw)":"";
                    const stackTransform=`${xOff} translateY(calc(40vh - 198px))`.trim();
                    const atStack=three3Phase!=='done'&&!three3Moving;
                    return (
                      <div key={i} style={{flex:"1 1 0",display:"flex",flexDirection:"column",alignItems:"center",
                        minHeight:0,overflow:three3Phase==='done'?"hidden":"visible"}}>
                        <div ref={el=>{itemRefs.current[i]=el;}} onClick={()=>selectItem(i)}
                          style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",
                            paddingTop:16,cursor:"pointer",
                            opacity:vis?surAlpha:0,
                            transform:atStack?stackTransform:"none",
                            transition:three3Phase==='distributing'
                              ?"transform 0.72s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease"
                              :"opacity 0.4s ease"}}>
                          {/* Label hidden during animation so it doesn't appear in the stack */}
                          <p style={{...FONT,fontSize:11,fontWeight:700,letterSpacing:"0.12em",
                            color:cmpColor(i),margin:0,marginBottom:6,
                            visibility:three3Phase==='done'?"visible":"hidden"}}>{cmpLabel(i)}</p>
                          {sImg&&<img src={sImg} alt="" style={{height:220,maxWidth:220,objectFit:"contain",display:"block"}}/>}
                        </div>
                        {/* Title fades in with the rest of the background after distribution */}
                        {s.confirmedBasic?.title&&(
                          <p onClick={()=>selectItem(i)} style={{...FONT,fontSize:10,fontWeight:600,color:"#111",
                            margin:0,marginTop:6,cursor:"pointer",
                            textAlign:"center" as const,paddingInline:8,maxWidth:"90%",lineHeight:1.3,
                            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const,
                            opacity:vis&&three3Phase==='done'?surAlpha:0,transition:"opacity 0.4s ease"}}>
                            {s.confirmedBasic.title}
                          </p>
                        )}
                        {renderPanel3(perPieceBetter(i),perPieceWorse(i),perPieceSims(i),perPieceDiffs(i),i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* ── PIECE VIEW: header ── */}
            {!inCompare&&cb&&(
              <div style={{height:52,display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",
                paddingInline:24,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-end",paddingRight:56}}>
                  <button onClick={()=>openCard("pros")}          style={cardBtnStyle(btnColor("pros",          CARD_COLORS.pros))}>          {btnLabel("pros",          "Show pros",          "Hide pros")}          </button>
                  <button onClick={()=>openCard("aesthetics")}    style={cardBtnStyle(btnColor("aesthetics",    CARD_COLORS.aesthetics))}>    {btnLabel("aesthetics",    "Show aesthetics",    "Hide aesthetics")}    </button>
                  <button onClick={()=>openCard("piece_pairings")}style={cardBtnStyle(btnColor("piece_pairings",CARD_COLORS.piece_pairings))}>{btnLabel("piece_pairings","Show piece pairings","Hide piece pairings")} </button>
                </div>
                <p style={{...FONT,fontSize:21,fontWeight:700,textAlign:"center",lineHeight:1.2,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"28vw"}}>{cb.title}</p>
                <div style={{display:"flex",gap:36,alignItems:"center",justifyContent:"flex-start",paddingLeft:56}}>
                  <button onClick={()=>openCard("cons")}     style={cardBtnStyle(btnColor("cons",    CARD_COLORS.cons))}>     {btnLabel("cons",    "Show cons",         "Hide cons")}          </button>
                  <button onClick={()=>openCard("pairings")} style={cardBtnStyle(btnColor("pairings",CARD_COLORS.pairings))}> {btnLabel("pairings","Show color pairings","Hide color pairings")} </button>
                  <button onClick={onReset}                  style={cardBtnStyle("#c83030")}>Reset</button>
                </div>
              </div>
            )}
            {/* ── OVERLAY (fixed, GPU layer always in DOM during animation) ── */}
            <div style={{position:"fixed" as const,inset:0,pointerEvents:"none" as const,zIndex:999}}>
              {transAnim&&transAnim.images.map((img,idx)=>{
                const a=transAnim;
                const cx=a.phase==='active'?a.toX[idx]:a.fromX[idx];
                const cy=a.phase==='active'?a.toY:a.fromY;
                return (
                  <div key={idx} style={{position:"absolute" as const,left:0,top:0,width:220,height:220,
                    transform:`translate(${cx-110}px,${cy-110}px)`,
                    transition:a.phase==='active'?"transform 0.5s cubic-bezier(0.4,0,0.2,1)":"none",
                    opacity:1,pointerEvents:"none" as const}}>
                    {img&&<img src={img} alt="" style={{width:220,height:220,objectFit:"contain" as const,display:"block"}}/>}
                  </div>
                );
              })}
            </div>
            {/* ── PIECE VIEW: image strip ── */}
            {!inCompare&&(
              <div style={{width:"100%",display:"flex",justifyContent:"center",overflow:"hidden",
                paddingBlock:16,opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                <div style={{display:"flex",gap:48,alignItems:"center",
                  transform:`translateX(${n===3?0:((n-1)/2-(selectedIdx??0))*268}px)`,
                  transition:(prevSelectedIdx.current!==null&&selectedIdx!==null)?"transform 0.5s cubic-bezier(0.4,0,0.2,1)":"none"}}>
                  {scoredSlots.map(({slot:s},i)=>{
                    const sImg=s.removedBgUrl??s.confirmedBasic?.image??s.imageDataUrl;
                    const isSelected=selectedIdx===i;
                    const {label:stripLabel,color:stripColor}=getStripInfo(i);
                    // Pieces stay in original DOM order; per-piece translateX creates visual reordering with smooth animation.
                    const pieceTransX=n===3?(pieceViewOrder.indexOf(i)-i)*268:0;
                    return (
                      <div key={i} onClick={()=>!isSelected&&selectItem(i)}
                        style={{display:"flex",flexDirection:"column",alignItems:"center",cursor:isSelected?"default":"pointer",
                          transform:`translateX(${pieceTransX}px)`,
                          transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)"}}>
                        <div style={{height:22,display:"flex",alignItems:"center",marginBottom:6}}>
                          <span style={{...FONT,fontSize:11,fontWeight:700,letterSpacing:"0.13em",color:stripColor}}>{stripLabel}</span>
                        </div>
                        <div ref={el=>{pieceImgRefs.current[i]=el;}} style={{width:220,display:"flex",justifyContent:"center"}}>
                          {sImg&&<img src={sImg} alt="" style={{height:220,maxWidth:220,objectFit:"contain",display:"block"}}/>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* ── PIECE VIEW: scrollable content ── */}
            {!inCompare&&selectedIdx!==null&&cb&&deep&&outfitData&&(
              <div style={{paddingBottom:80,display:"flex",flexDirection:"column",alignItems:"center",width:"100%",opacity:vis?surAlpha:0,transition:"opacity 0.4s ease"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
                  <button onClick={returnToCompare} style={txtBtn("#888")}>COMPARE VIEW</button>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:24,marginBottom:36,paddingInline:24}}>
                  <div style={{display:"flex",gap:56,alignItems:"flex-start",justifyContent:"center",flexWrap:"wrap"}}>
                    <StatNum value={`${pScore}`}                   label="Piece score"      color={sColor(pScore)}/>
                    <StatNum value={`${outfitData.avgScore}`}      label="Avg outfit score" color={sColor(outfitData.avgScore)}/>
                    <StatNum value={`${outfitData.outfitCount}`}   label="New outfits"      color={outfitCountColor(outfitData.outfitCount)}/>
                    <StatNum value={`${outfitData.aestheticFit}%`} label="Aesthetic fit"    color={sColor(outfitData.aestheticFit)}/>
                    <StatNum value={`${pieceMatchCount}`}          label="Piece matches"    color={pieceMatchColor(pieceMatchCount)}/>
                  </div>
                  <StatNum value={`${oScore}`} label="Overall" color={sColor(oScore)} big/>
                </div>
                {outfitData.outfits.length>0&&previewItem&&(
                  <OutfitGallery outfits={outfitData.outfits} items={outfitData.items} previewItem={previewItem} totalCount={outfitData.outfitCount}/>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Slide cards (selected mode only) */}
      {!inCompare&&deep&&outfitData&&(
        <>
          {([leftCard,rightCard,bottomCard,topCard] as const).map((c,i)=>{
            if(!c) return null;
            const dir=(["left","right","bottom","top"] as const)[i];
            const secs=selWaImpact!=null?(
              c.key==="pros"       ?[{header:"GAPS FILLED",items:selWaImpact.fillsGaps},{header:"WEAKNESSES ADDRESSED",items:selWaImpact.addressesWeaknesses}]:
              c.key==="aesthetics" ?[{header:"AESTHETICS FILLED",items:selWaImpact.addsAesthetics}]:
              c.key==="pairings"   ?[{header:"COLORS FILLED",items:selWaImpact.addsColors}]:
              undefined
            ):undefined;
            return <SlideCard key={dir} cardKey={c.key} dir={dir} items={cardItemsWithOverdone(c.key,deep,outfitData!.items,selOverdoneNote)} exiting={c.exiting} onHide={()=>exitCard(c.key)} sections={secs}/>;
          })}
        </>
      )}

      {/* White bg covers page until items settle */}
      {!contentVisible&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#fff",
          opacity:imgAtTop?0:1,transition:"opacity 0.6s ease",zIndex:500,pointerEvents:"none"}}/>
      )}
    </div>
  );
}

// ── OutfitGallery — exact outfits-page animation ──────────────────────────────

function OutfitGallery({outfits,items,previewItem,totalCount,compact=false}:{
  outfits:{score:number;itemIds:string[]}[];
  items:Record<string,OutfitItem>;
  previewItem:OutfitItem;
  totalCount:number;
  compact?:boolean;
}) {
  const [shownCount, setShownCount] = useState(OUTFITS_PER_PAGE);

  const [galleryPhase,          setGalleryPhase]          = useState<"gallery"|"overlay">("gallery");
  const [bgVisible,             setBgVisible]             = useState(false);
  const [isSpread,              setIsSpread]              = useState(false);
  const [animateItems,          setAnimateItems]          = useState(false);
  const [activeIdx,             setActiveIdx]             = useState(0);
  const [displayIdx,            setDisplayIdx]            = useState(0);
  const [spreadCfg,             setSpreadCfg]             = useState<SpreadCfg>(DEFAULT_CFG);
  const [containerTransform,    setContainerTransform]    = useState("translate(0,0) scale(1)");
  const [containerTransitionOn, setContainerTransitionOn] = useState(false);
  const [pieceZoom, setPieceZoom] = useState(1);

  const stackRefs           = useRef<Map<number,HTMLElement>>(new Map());
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const timerRef            = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const activeIdxRef        = useRef(0);
  const containerWRef       = useRef(DEFAULT_CFG.containerW);
  const containerHRef       = useRef(DEFAULT_CFG.containerH);
  const rAFIdRef            = useRef(0);
  const globalSafeScaleRef  = useRef(SPREAD_SCALE);

  function buildItems(outfit:{score:number;itemIds:string[]}): OutfitItem[] {
    const wardrobe=outfit.itemIds.map(id=>items[id]).filter((x):x is OutfitItem=>!!x);
    return sortItems([previewItem,...wardrobe]);
  }

  // Compute uniform scale once from the largest outfit (+1 for preview item)
  useEffect(()=>{
    if (!outfits.length) return;
    const maxN = Math.max(...outfits.map(o => o.itemIds.length + 1));
    const cfg  = buildSpreadCfg(maxN);
    globalSafeScaleRef.current = computeSafeScale(
      cfg.containerH, cfg.containerW,
      document.documentElement.clientHeight,
      document.documentElement.clientWidth,
    );
  }, [outfits]);

  const rawShown  = outfits.slice(0, shownCount);
  const fullRows  = Math.floor(rawShown.length / ITEMS_PER_ROW);
  const shown     = rawShown.slice(0, fullRows * ITEMS_PER_ROW);
  const canShowMore = shownCount < outfits.length;

  function openOutfit(idx:number) {
    clearTimeout(timerRef.current); cancelAnimationFrame(rAFIdRef.current);
    if (overlayContainerRef.current) {
      overlayContainerRef.current.style.transition="";
      overlayContainerRef.current.style.transform="";
    }
    const el=stackRefs.current.get(idx); if (!el) return;
    const rect=el.getBoundingClientRect();
    const vw=document.documentElement.clientWidth;
    const vh=document.documentElement.clientHeight;
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    const si=buildItems(outfits[idx]);
    const cfg=buildSpreadCfg(si.length,spreadZoom(si.length),vSpreadZoom(si.length));
    const galleryTx=cx-vw/2-cfg.containerW/2;
    const galleryTy=cy-(vh/2-OVERLAY_TOP_OFFSET)-cfg.containerH/2;
    // Settled/spread position is scaled down to whatever fits the viewport
    // (globalSafeScaleRef, computed from the largest outfit in this set) instead
    // of always rendering at full size - otherwise a wide spread (many items, or
    // the 1.85x zoom used for <3 rows) can render wider than the screen and its
    // pieces spill past the edges / overlap the fixed score readout above it.
    // translate() runs in the PARENT's (unscaled) coordinate space and is applied
    // before scale(), so centering a SCALED box means halving the SCALED size,
    // not the raw container size.
    const scale=globalSafeScaleRef.current;
    const centerTx=-cfg.containerW*scale/2;
    const centerTy=-cfg.containerH*scale/2;
    activeIdxRef.current=idx; containerWRef.current=cfg.containerW; containerHRef.current=cfg.containerH;
    setSpreadCfg(cfg); setActiveIdx(idx); setDisplayIdx(idx);
    setIsSpread(false); setAnimateItems(false); setBgVisible(false); setPieceZoom(1);
    setContainerTransitionOn(false);
    setContainerTransform(`translate(${galleryTx}px,${galleryTy}px) scale(1)`);
    setGalleryPhase("overlay");
    timerRef.current=setTimeout(()=>{
      // Move to centre AND fade bg to white simultaneously
      setContainerTransitionOn(true);
      setContainerTransform(`translate(${centerTx}px,${centerTy}px) scale(${scale})`);
      setBgVisible(true);
      timerRef.current=setTimeout(()=>{
        // Move + bg both done; zoom pieces while stacked
        setPieceZoom(1.85);
        timerRef.current=setTimeout(()=>{
          // Pieces big; fly to spread positions
          setAnimateItems(true); setIsSpread(true);
          timerRef.current=setTimeout(()=>setAnimateItems(false),350);
        },400);
      },420);
    },100);
  }

  function closeOverlay() {
    clearTimeout(timerRef.current); cancelAnimationFrame(rAFIdRef.current);
    // Step 1: pieces gather; score/pros/cons fade; bg stays white
    setAnimateItems(true); setIsSpread(false);
    timerRef.current=setTimeout(()=>{
      // Step 2: pieces shrink while still on white background
      setAnimateItems(false); setPieceZoom(1);
      timerRef.current=setTimeout(()=>{
        // Step 3: white background fades away
        setBgVisible(false);
        timerRef.current=setTimeout(()=>{
          // Step 4: fly back to gallery slot
          setContainerTransitionOn(false);
          const el=stackRefs.current.get(activeIdxRef.current);
          const vw=document.documentElement.clientWidth;
          const vh=document.documentElement.clientHeight;
          const cW=containerWRef.current; const cH=containerHRef.current;
          const c=overlayContainerRef.current;
          let startTx=-cW/2, startTy=-cH/2, startScale=SPREAD_SCALE;
          if (c) {
            const m=new DOMMatrix(window.getComputedStyle(c).transform);
            startTx=m.m41; startTy=m.m42; startScale=m.m11;
            c.style.transition="none";
            c.style.transform=`translate(${startTx}px,${startTy}px) scale(${startScale})`;
          }
          let initTx=startTx, initTy=startTy, FAR=false;
          if (el) {
            const r0=el.getBoundingClientRect();
            const cx0=r0.left+r0.width/2; const cy0=r0.top+r0.height/2;
            initTx=cx0-vw/2-cW/2; initTy=cy0-(vh/2-OVERLAY_TOP_OFFSET)-cH/2;
            FAR=r0.bottom<0||r0.top>vh||r0.right<0||r0.left>vw;
          }
          const rawDx=initTx-startTx; const rawDy=initTy-startTy;
          const initDist=Math.sqrt(rawDx*rawDx+rawDy*rawDy);
          let fixTx=initTx, fixTy=initTy;
          if (FAR&&initDist>0) {
            const vs=rawDy>=0?1:-1; const vv=vh*0.6*vs;
            const dd=Math.sqrt(rawDx*rawDx+vv*vv);
            const ndx=dd>0?rawDx/dd:0; const ndy=dd>0?vv/dd:vs;
            const sl=vw/2+startTx; const st=vh/2-OVERLAY_TOP_OFFSET+startTy;
            const PAD=30; const cands:number[]=[];
            if (ndx>0) cands.push((vw+PAD-sl)/ndx);
            if (ndx<0) cands.push((-cW-PAD-sl)/ndx);
            if (ndy>0) cands.push((vh+PAD-st)/ndy);
            if (ndy<0) cands.push((-cH-PAD-st)/ndy);
            const ed=Math.min(...cands.filter(v=>v>0),initDist);
            fixTx=startTx+ndx*ed; fixTy=startTy+ndy*ed;
          }
          const DUR=380; let t0=-1;
          const tick=(ts:number)=>{
            if (t0<0) t0=ts;
            const t=Math.min((ts-t0)/DUR,1);
            const e=t<1?1-Math.pow(1-t,3):1;
            let ttx:number, tty:number;
            if (FAR) { ttx=fixTx; tty=fixTy; }
            else {
              ttx=startTx; tty=startTy;
              if (el) { const r=el.getBoundingClientRect(); ttx=r.left+r.width/2-vw/2-cW/2; tty=r.top+r.height/2-(vh/2-OVERLAY_TOP_OFFSET)-cH/2; }
            }
            const tx=startTx+(ttx-startTx)*e; const ty=startTy+(tty-startTy)*e;
            const sc=startScale+(1-startScale)*e;
            if (c) { c.style.transition="none"; c.style.transform=`translate(${tx}px,${ty}px) scale(${sc})`; }
            if (t<1) rAFIdRef.current=requestAnimationFrame(tick);
            else requestAnimationFrame(()=>setGalleryPhase("gallery"));
          };
          rAFIdRef.current=requestAnimationFrame(tick);
        },350); // bg fade (.3s ease)
      },400); // piece shrink (.35s ease + buffer)
    },300); // gather (.28s ease-out + buffer)
  }

  function navigateOutfit(newIdx:number) {
    if (newIdx<0||newIdx>=outfits.length) return;
    clearTimeout(timerRef.current);
    // Gather current pieces (score fades via isSpread=false; no shrink)
    setAnimateItems(true); setIsSpread(false);

    timerRef.current = setTimeout(() => {
      // Swap to new outfit while pieces are stacked at center (imperceptible)
      const newItems=buildItems(outfits[newIdx]);
      const cfg=buildSpreadCfg(newItems.length,spreadZoom(newItems.length),vSpreadZoom(newItems.length));
      setSpreadCfg(cfg);
      containerWRef.current=cfg.containerW; containerHRef.current=cfg.containerH;
      setContainerTransitionOn(false);
      // Same viewport-safe scale as openOutfit() - each outfit can have a different
      // item count, but globalSafeScaleRef is sized to the largest outfit in this
      // set, so it stays valid (and never needs recomputing) across navigation.
      const navScale=globalSafeScaleRef.current;
      setContainerTransform(`translate(${-cfg.containerW*navScale/2}px,${-cfg.containerH*navScale/2}px) scale(${navScale})`);
      activeIdxRef.current=newIdx;
      setActiveIdx(newIdx);
      if (newIdx>=shownCount) {
        const neededRows=Math.floor(newIdx/ITEMS_PER_ROW)+1;
        setShownCount(neededRows*ITEMS_PER_ROW);
      }
      setDisplayIdx(newIdx);

      timerRef.current = setTimeout(() => {
        // Distribute new outfit's pieces
        setIsSpread(true);
        timerRef.current = setTimeout(() => setAnimateItems(false), 300);
      }, 30);
    }, 300);
  }

  const current=outfits[displayIdx]??null;
  const currentItems=current?buildItems(current):[];
  const N=currentItems.length;
  const posZoom =spreadZoom(N);
  const posVZoom=vSpreadZoom(N);
  const {containerW,containerH,stackLeft,stackTop}=spreadCfg;
  const sc=(s:number)=>s>=75?"#1d9e52":s>=50?"#c88800":"#c83030";

  return (
    <div style={{width:"100%",paddingTop:20}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",columnGap:compact?12:COL_GAP,rowGap:compact?36:64,padding:`0 ${compact?8:28}px`}}>
        {shown.map((outfit,idx)=>{
          const sorted=buildItems(outfit);
          const scoreC=sc(outfit.score);
          return (
            <div key={idx} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
              <div style={{width:"100%",height:compact?120:SPREAD_H,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div
                  ref={el=>{if(el)stackRefs.current.set(idx,el as HTMLElement);else stackRefs.current.delete(idx);}}
                  onClick={()=>galleryPhase==="gallery"&&!compact&&openOutfit(idx)}
                  style={{
                    position:"relative",width:compact?80:SPREAD_W,height:compact?120:SPREAD_H,
                    cursor:compact?"default":"pointer",
                    opacity:galleryPhase!=="gallery"&&activeIdx===idx?0:1,
                    transition:"none",
                  }}
                >
                  <div style={{position:"absolute",inset:0,animation:"stackReveal 0.15s ease forwards"}}>
                    {sorted.map((item,si)=>{
                      const isAcc=stackOrder(item)===0;
                      return (
                        <div key={item.id} style={{position:"absolute",inset:0,zIndex:sorted.length-si,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {item.image&&<img src={item.image} alt="" style={{maxWidth:isAcc?"55%":"100%",maxHeight:isAcc?"55%":"100%",objectFit:"contain",display:"block"}}/>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p style={{...FONT,margin:0,fontSize:compact?10:13,fontWeight:700,letterSpacing:".06em",color:scoreC}}>
                {outfit.score} / 100
              </p>
            </div>
          );
        })}
      </div>

      {canShowMore&&(
        <div style={{textAlign:"center",marginTop:52}}>
          <button onClick={()=>setShownCount(c=>c+OUTFITS_PER_PAGE)} style={txtBtn("#888")}>SHOW MORE</button>
        </div>
      )}

      {galleryPhase!=="gallery"&&(
        <>
          <div style={{position:"fixed",inset:0,zIndex:2000}}/>
          <div style={{position:"fixed",inset:0,zIndex:2001,background:"#fff",opacity:bgVisible?1:0,transition:"opacity .3s ease",pointerEvents:"none"}}/>
          <div ref={overlayContainerRef} style={{
            position:"fixed",
            top:`calc(50% - ${OVERLAY_TOP_OFFSET}px)`,
            left:"50%",
            width:containerW,height:containerH,
            transform:containerTransform,
            transition:containerTransitionOn?"transform .38s cubic-bezier(.4,0,.2,1)":"none",
            zIndex:2002,
          }}>
            {currentItems.map((item,i)=>{
              const sp=getSpreadPos(i,N,posZoom,posVZoom);
              const dx=isSpread?sp.left-stackLeft:0;
              const dy=isSpread?sp.top-stackTop:0;
              const isAcc=stackOrder(item)===0;
              return (
                <div key={`${displayIdx}-${item.id}`} style={{
                  position:"absolute",left:stackLeft,top:stackTop,
                  width:SPREAD_W,height:SPREAD_H,
                  zIndex:N-i,
                  transform:`translate(${dx}px,${dy}px)`,
                  transition:"transform .28s ease-out",
                }}>
                  <div style={{
                    position:"absolute",inset:0,
                    transform:`scale(${pieceZoom})`,
                    transition:"transform .35s ease",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    filter:"drop-shadow(0 2px 10px rgba(0,0,0,0.13))",
                  }}>
                    {item.image&&<img src={item.image} alt="" style={{maxWidth:isAcc?"55%":"100%",maxHeight:isAcc?"55%":"100%",objectFit:"contain",display:"block"}}/>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{position:"fixed",inset:0,zIndex:2003,pointerEvents:"none"}}>
            {/* Close + nav arrows are SVG (not text glyphs) so they render identically on
                every device/platform regardless of font/encoding support. Only appear after
                the spread animation is fully done. */}
            {(() => { const done = isSpread && !animateItems; return (<>
              <button onClick={closeOverlay} style={{position:"absolute",top:20,right:22,background:"none",border:"none",cursor:"pointer",lineHeight:1,padding:4,opacity:done?1:0,transition:"opacity 0.4s ease",pointerEvents:done?"auto":"none"}}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 1L15 15M15 1L1 15" stroke="#000" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              <button
                onClick={()=>navigateOutfit(displayIdx-1)}
                style={{position:"absolute",left:18,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:displayIdx>0?"pointer":"default",lineHeight:1,padding:"4px 10px",opacity:done?1:0,transition:"opacity 0.4s ease",pointerEvents:done?"auto":"none"}}
              >
                <svg width="14" height="24" viewBox="0 0 14 24" fill="none"><path d="M11 2L3 12L11 22" stroke={displayIdx>0?"#333":"#ddd"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button
                onClick={()=>navigateOutfit(displayIdx+1)}
                style={{position:"absolute",right:18,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:displayIdx<outfits.length-1?"pointer":"default",lineHeight:1,padding:"4px 10px",opacity:done?1:0,transition:"opacity 0.4s ease",pointerEvents:done?"auto":"none"}}
              >
                <svg width="14" height="24" viewBox="0 0 14 24" fill="none"><path d="M3 2L11 12L3 22" stroke={displayIdx<outfits.length-1?"#333":"#ddd"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </>); })()}
            <p style={{position:"absolute",top:28,left:"50%",transform:"translateX(-50%)",margin:0,fontSize:22,fontWeight:700,letterSpacing:".06em",color:sc(current?.score??0),opacity:isSpread?1:0,transition:"opacity .3s .1s",...FONT}}>
              {current?.score} / 100
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function StatNum({value,label,color,small,big}:{value:string;label:string;color:string;small?:boolean;big?:boolean}) {
  return (
    <div style={{textAlign:"center"}}>
      <p style={{...FONT,fontSize:big&&small?24:big?46:small?16:28,fontWeight:700,color,lineHeight:1,marginBottom:small?4:7}}>{value}</p>
      <p style={{...FONT,fontSize:small?9:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#111"}}>{label}</p>
    </div>
  );
}

function FieldHint({value,onChange,hint}:{value:string;onChange:(v:string)=>void;hint:string}) {
  return (
    <div style={{position:"relative"}}>
      <input value={value} onChange={e=>onChange(e.target.value)} style={{
        width:"100%",border:"none",borderBottom:"1px solid #e8e8e8",
        padding:"9px 80px 9px 0",fontSize:14,outline:"none",...FONT,
        boxSizing:"border-box",background:"transparent",
      }}/>
      <span style={{position:"absolute",right:0,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#ccc",pointerEvents:"none",...FONT}}>
        {hint}
      </span>
    </div>
  );
}

function Spinner({size=20}:{size?:number}) {
  return <div style={{width:size,height:size,border:`${size>16?2:1.5}px solid #eee`,borderTopColor:"#555",borderRadius:"50%",animation:"_spin 0.8s linear infinite",flexShrink:0}}/>;
}
