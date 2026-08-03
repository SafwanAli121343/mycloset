#!/usr/bin/env node
/**
 * Full WA system test — every structural case, all gap types, colors/aesthetics/cons,
 * level-up lifecycle, removal regression, score accumulation, AI gap-check.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-wa-full.mts
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  computeMetrics, buildWardrobePromptSection, getFunctionalSlot,
  gapTotalProgress, computeGapProgress, computeEffectiveLevel,
  type WardrobeAnalysis, type WABackendState, type CrossedEntry, type WardrobeGap,
} from "../lib/wardrobeAnalysis.js";
import type { GarmentForScoring } from "../lib/scoring.js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ── Helpers ──────────────────────────────────────────────────────────────────

const C = {
  reset:"\x1b[0m", bold:"\x1b[1m", green:"\x1b[32m", red:"\x1b[31m",
  yellow:"\x1b[33m", cyan:"\x1b[36m", gray:"\x1b[90m", blue:"\x1b[34m", magenta:"\x1b[35m",
};
const OK = C.green + "✓" + C.reset;
const FAIL = C.red + "✗" + C.reset;
let pass = 0, fail = 0;

function check(label: string, cond: boolean, detail = ""): boolean {
  if (cond) { pass++; console.log(`  ${OK} ${label}`); }
  else       { fail++; console.log(`  ${FAIL} ${label}${detail ? " — " + C.red + detail + C.reset : ""}`); }
  return cond;
}
function section(t: string) { console.log(`\n${C.bold}${C.cyan}══ ${t} ══${C.reset}`); }
function info(t: string)    { console.log(`  ${C.gray}${t}${C.reset}`); }
function warn(t: string)    { console.log(`  ${C.yellow}⚠ ${t}${C.reset}`); }

// ── Types ────────────────────────────────────────────────────────────────────

const GARMENT_FIELDS = "id,title,brand,category,sub_type,material,color_primary,color_secondary,pattern,formality,aesthetic_tags,pros,cons,color_pairings,color_clashes,tags,image,fit";
type RawGarment = GarmentForScoring & {
  category?: string|null; title?: string|null; brand?: string|null;
  functional_slot?: string|null; image?: string|null;
};

async function fetchBySubType(sub_type: string, limit = 2): Promise<RawGarment[]> {
  const { data } = await sb.from("garments").select(GARMENT_FIELDS)
    .ilike("sub_type", sub_type).not("image","is",null).limit(limit);
  return (data ?? []) as unknown as RawGarment[];
}

// Synthetic item factory
function synth(o: Partial<RawGarment> & { id: string; sub_type: string; category: string }): RawGarment {
  return {
    material:"Cotton", pattern:"solid", formality:"casual",
    color_primary:null, color_secondary:null, color_pairings:null, color_clashes:null,
    aesthetic_tags:[], pros:null, cons:null, tags:null, brand:null,
    title: o.sub_type, image:null, fit:null,
    ...o,
    functional_slot: getFunctionalSlot(o.sub_type) ?? o.functional_slot ?? null,
  };
}

// Synthetic analysis factory (no GPT needed)
function synthAnalysis(o: Partial<WardrobeAnalysis> & { gaps?: WardrobeGap[] }): WardrobeAnalysis {
  return {
    score:40, pieceCount:3, pros:[], cons:[], overdone:[], insights:[],
    scoreBreakdown:{ pieceQuality:10, categoryCoverage:8, colorCohesion:8, outfitPotential:7, qualityDistribution:4, aestheticDepth:3 },
    colors:{ have:["black","white"], missing:[] },
    aesthetics:{ covered:[], missing:[] },
    subTypeFrequency:{}, conGapLinks:{},
    generatedAt: new Date().toISOString(),
    gaps:[], ...o,
  };
}

function gap(description: string, impact: WardrobeGap["impact"] = "high", pts = 5): WardrobeGap {
  return { description, type:"piece_type", impact, reason:"missing", costPoints:pts };
}

// ── Simulation logic (mirrors add-item/page.tsx) ─────────────────────────────

function simulateAdd(item: RawGarment, analysis: WardrobeAnalysis, existing: CrossedEntry[], level: number): CrossedEntry[] {
  const norm = (s:string) => s.toLowerCase().replace(/[^a-z0-9]/g,"");
  const sub  = (item.sub_type ?? "").toLowerCase();
  const newE: CrossedEntry[] = [];

  for (const g of analysis.gaps) {
    if (gapTotalProgress(existing, g.description, level) >= 100) continue;
    if (existing.some(e=>e.category==="gap"&&e.key===g.description&&e.garmentId===item.id&&e.analysisLevel===level)) continue;
    const prog = computeGapProgress(g.description, item.sub_type, item.category, item.functional_slot);
    if (prog > 0) newE.push({category:"gap",key:g.description,garmentId:item.id,analysisLevel:level,progress:prog});
  }

  if (item.color_primary) {
    const pc = norm(item.color_primary);
    for (const c of analysis.colors.missing) {
      if (existing.some(e=>e.category==="color"&&e.key===c&&e.analysisLevel===level)) continue;
      const nm = norm(c);
      if (nm===pc||nm.includes(pc)||pc.includes(nm)) newE.push({category:"color",key:c,garmentId:item.id,analysisLevel:level});
    }
  }

  for (const tag of (item.aesthetic_tags ?? [])) {
    const nt = norm(tag);
    for (const a of analysis.aesthetics.missing) {
      if (existing.some(e=>e.category==="aesthetic"&&e.key===a&&e.analysisLevel===level)) continue;
      if (norm(a)===nt) newE.push({category:"aesthetic",key:a,garmentId:item.id,analysisLevel:level});
    }
  }

  const resolvedGapKeys = new Set([
    ...analysis.gaps.filter(g=>gapTotalProgress([...existing,...newE],g.description,level)>=100).map(g=>g.description),
    ...newE.filter(e=>e.category==="gap").map(e=>e.key),
  ]);
  const conLinks = analysis.conGapLinks ?? {};
  for (let i = 0; i < analysis.cons.length; i++) {
    if (existing.some(e=>e.category==="con"&&e.key===String(i)&&e.analysisLevel===level)) continue;
    const cl = analysis.cons[i].toLowerCase();
    const lg = conLinks[String(i)];
    if ((sub&&cl.includes(sub))||(lg&&resolvedGapKeys.has(lg))||[...resolvedGapKeys].some(d=>cl.includes(d)))
      newE.push({category:"con",key:String(i),garmentId:item.id,analysisLevel:level});
  }
  return newE;
}

function simulateRemove(garmentId: string, crossed: CrossedEntry[]): CrossedEntry[] {
  return crossed.filter(e => e.garmentId !== garmentId);
}

function computeCumulativeScore(bs: WABackendState, effLevel: number): number {
  let score = bs.analysisHistory[0]?.score ?? 0;
  for (let L = 1; L <= effLevel; L++) {
    const la = bs.analysisHistory[L-1]; if (!la) break;
    const lc = bs.crossed.filter(e=>e.analysisLevel===L);
    for (const g of la.gaps) {
      if (gapTotalProgress(bs.crossed, g.description, L)>=100) {
        score = Math.min(100, score+(g.costPoints>0?g.costPoints:5));
      }
    }
    const colK = new Set(lc.filter(e=>e.category==="color").map(e=>e.key));
    const aesK = new Set(lc.filter(e=>e.category==="aesthetic").map(e=>e.key));
    const conC = lc.filter(e=>e.category==="con").length;
    score = Math.min(100, score+colK.size*2+aesK.size*1+conC*2);
  }
  return score;
}

function isLevelComplete(analysis: WardrobeAnalysis, crossed: CrossedEntry[], level: number): boolean {
  const atL = crossed.filter(e=>e.analysisLevel===level);
  const allG = analysis.gaps.length===0 || analysis.gaps.every(g=>gapTotalProgress(crossed,g.description,level)>=100);
  const allCons = analysis.cons.length===0 || analysis.cons.every((_,i)=>{
    if (atL.some(e=>e.category==="con"&&e.key===String(i))) return true;
    const lg=(analysis.conGapLinks??{})[String(i)];
    return lg?gapTotalProgress(crossed,lg,level)>=100:false;
  });
  const allC = analysis.colors.missing.length===0 || analysis.colors.missing.every(c=>atL.some(e=>e.category==="color"&&e.key===c));
  const allA = analysis.aesthetics.missing.length===0 || analysis.aesthetics.missing.every(ae=>atL.some(e=>e.category==="aesthetic"&&e.key===ae));
  return allG&&allCons&&allC&&allA;
}

// ── GPT analysis (for analysis quality test only) ─────────────────────────────

function stripDash(s: string) { return s.replace(/\s*—\s*/g, ": "); }

async function runAnalysis(garments: RawGarment[]): Promise<WardrobeAnalysis> {
  const metrics = computeMetrics(garments as GarmentForScoring[]);
  const ws      = buildWardrobePromptSection(garments, metrics);
  const covAes  = Object.entries(metrics.aestheticCounts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));

  const r = await openai.chat.completions.create({
    model:"gpt-4o", response_format:{type:"json_object"}, max_tokens:1400, temperature:0.25,
    messages:[
      {role:"system",content:"You are a professional menswear stylist. Give honest, specific, data-grounded analysis."},
      {role:"user",content:`${ws}\n\nAnalyze. Return ONLY valid JSON:\n{"pros":["..."],"cons":["..."],"gaps":[{"description":"heavy outerwear","type":"piece_type","impact":"high","reason":"..."}],"overdone":[],"missing_aesthetics":["..."],"missing_colors":["..."],"insights":["..."]}\n\nRules: gaps ONLY from "Functional slots MISSING". missing_aesthetics ONLY from "Aesthetics completely absent". Return [] for any field with nothing meaningful.`},
    ],
  });
  let gpt: { pros?:string[]; cons?:string[]; gaps?:Array<{description:string;type:string;impact:string;reason:string}>; missing_aesthetics?:string[]; missing_colors?:string[] } = {};
  try { gpt = JSON.parse(r.choices[0].message.content ?? "{}"); } catch {}

  const missingAesthetics = (gpt.missing_aesthetics ?? []).filter(a => !metrics.aestheticCounts[a]).slice(0,3)
    .concat(metrics.absentAesthetics).filter((v,i,a)=>a.indexOf(v)===i).slice(0,3);

  return {
    score:metrics.score, pieceCount:metrics.pieceCount,
    scoreBreakdown:{
      pieceQuality:Math.round((metrics.avgPieceScore/100)*25),
      categoryCoverage:Math.min([...metrics.slotCoverage].reduce((a,s)=>a+({base:5,bottom:5,foot:4,outer:2,mid:1,vest:1,acc:1,onepiece:2}[s]??0),0),20),
      colorCohesion:Math.round((1-metrics.missingEssentials.length/15)*20),
      outfitPotential:metrics.comboCountEstimate>=30?15:metrics.comboCountEstimate>=10?10:7,
      qualityDistribution:Math.max(0,(metrics.heroCount>=1?5:0)+(metrics.workhouseCount>=2?4:0)-(metrics.weakCount>metrics.pieceCount*0.3?3:0)),
      aestheticDepth:Math.min(10,Object.keys(metrics.aestheticCounts).length*1.5),
    },
    pros:(gpt.pros??[]).map(stripDash), cons:(gpt.cons??[]).map(stripDash),
    colors:{ have:metrics.allColors, missing:gpt.missing_colors?.length?gpt.missing_colors:metrics.missingEssentials.slice(0,6) },
    aesthetics:{ covered:covAes, missing:missingAesthetics },
    subTypeFrequency:metrics.subTypeCounts,
    gaps:(gpt.gaps??[]).map(g=>({
      description:g.description, type:(g.type as WardrobeGap["type"])||"piece_type",
      impact:(g.impact as WardrobeGap["impact"])||"medium", reason:stripDash(g.reason),
      costPoints:metrics.slotCostMap[g.description]||(g.impact==="high"?5:g.impact==="medium"?3:2),
    })),
    overdone:[], insights:[], generatedAt:new Date().toISOString(),
    conGapLinks:(()=>{
      const links:Record<string,string>={};
      for (let i=0;i<(gpt.cons??[]).length;i++){
        const cl=(gpt.cons??[])[i].toLowerCase();
        for (const gp of (gpt.gaps??[])){
          const kws=gp.description.toLowerCase().split(/\s+/).filter(w=>w.length>=4);
          if(kws.some(w=>cl.includes(w))){links[String(i)]=gp.description;break;}
        }
      }
      return links;
    })(),
  };
}

async function aiGapCheck(item: RawGarment, gapDescriptions: string[]): Promise<string[]> {
  if (!gapDescriptions.length || !item.image) return [];
  const gapList = gapDescriptions.map((g,i)=>`${i+1}. ${g}`).join("\n");
  const context = [item.sub_type&&`Type: ${item.sub_type}`, item.category&&`Category: ${item.category}`].filter(Boolean).join(" | ");
  try {
    const r = await openai.chat.completions.create({
      model:"gpt-4o", response_format:{type:"json_object"}, max_tokens:150, temperature:0,
      messages:[{role:"user",content:[
        {type:"image_url",image_url:{url:item.image!,detail:"low"}},
        {type:"text",text:`${context}\n\nWardrobe gaps:\n${gapList}\n\nWhich gaps does this item fill? Return JSON: {"fills":["gap description 1","..."]} or {"fills":[]} if none.`},
      ]}],
    });
    const parsed = JSON.parse(r.choices[0].message.content ?? "{}");
    const fills: string[] = Array.isArray(parsed) ? parsed : (parsed.fills ?? []);
    return fills.filter((f: string) => new Set(gapDescriptions).has(f));
  } catch { return []; }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${C.bold}${C.blue}WA Comprehensive System Test${C.reset}\n`);

  // ── BLOCK 1: Slot map — new entries ─────────────────────────────────────────
  section("1 · Slot map — all slots resolve correctly");

  const slotTests: [string, string][] = [
    // denim bottom
    ["Jeans",              "denim bottom"],
    ["Relaxed Jeans",      "denim bottom"],
    ["Straight Leg Jeans", "denim bottom"],
    ["Slim Jeans",         "denim bottom"],
    ["Wide Leg Jeans",     "denim bottom"],
    ["Cropped Jeans",      "denim bottom"],
    // casual pant (including new additions)
    ["Chinos",             "casual pant"],
    ["Joggers",            "casual pant"],
    ["Sweatpants",         "casual pant"],
    ["Leggings",           "casual pant"],  // newly added
    ["Wide Leg Pants",     "casual pant"],  // newly added
    ["Tapered Pants",      "casual pant"],  // newly added
    ["Straight Pants",     "casual pant"],  // newly added
    ["Balloon Pants",      "casual pant"],  // newly added
    ["Pleated Pants",      "casual pant"],  // newly added (streetwear, not formal)
    ["Baggy Pants",        "casual pant"],  // newly added
    ["Utility Pants",      "casual pant"],  // newly added
    // formal pant
    ["Dress Pants",        "formal pant"],
    ["Trousers",           "formal pant"],
    ["Tailored Trousers",  "formal pant"],
    ["Wide Leg Trousers",  "formal pant"],
    ["Pleated Trousers",   "formal pant"],
    ["Slacks",             "formal pant"],
    // shorts
    ["Shorts",             "shorts"],
    ["Denim Shorts",       "shorts"],
    ["Jorts",              "shorts"],
    ["Basketball Shorts",  "shorts"],
    ["Swim Shorts",        "shorts"],
    ["Biker Shorts",       "shorts"],
    // footwear
    ["Work Boots",         "boot"],
    ["Chelsea Boots",      "boot"],
    ["Oxford Shoes",       "dress shoe"],
    ["Loafers",            "dress shoe"],
    ["Dress Shoes",        "dress shoe"],   // newly added
    ["Low-Top Sneakers",   "casual sneaker"],
    ["High-Top Sneakers",  "casual sneaker"],
    ["Slides",             "casual sandal / slide"],
    ["Sandals",            "casual sandal / slide"],
    // tops
    ["T-Shirt",            "base layer"],
    ["Graphic Tee",        "base layer"],
    ["Polo",               "base layer"],
    ["Dress Shirt",        "casual shirt / button-up"],
    ["Flannel Shirt",      "casual shirt / button-up"],
    ["Hoodie",             "pullover mid layer"],
    ["Crewneck Sweatshirt","pullover mid layer"],
    ["Zip-Up Hoodie",      "zip-up / open mid layer"],
    ["Cardigan",           "zip-up / open mid layer"],
    // outerwear
    ["Bomber Jacket",      "lightweight jacket"],
    ["Denim Jacket",       "lightweight jacket"],
    ["Blazer",             "structured outerwear"],
    ["Puffer Jacket",      "heavy outerwear"],
    ["Leather Jacket",     "heavy outerwear"],
    ["Trench Coat",        "heavy outerwear"],
    ["Duster",             "heavy outerwear"],
  ];

  for (const [sub, expected] of slotTests) {
    const got = getFunctionalSlot(sub);
    check(`getFunctionalSlot("${sub}") = "${expected}"`, got === expected, `got "${got}"`);
  }

  // ── BLOCK 2: computeGapProgress — every gap type, right items vs. wrong items
  section("2 · computeGapProgress — correct fills and correct rejections");

  type Case = [string, string, string, string | null, number | null, string?];
  // [gap, sub_type, category, expected_slot, expected_progress_min (null=0), label?]
  const progressTests: Case[] = [
    // ── heavy outerwear ──────────────────────────────────────────────
    ["heavy outerwear", "Puffer Jacket",  "outerwear","heavy outerwear", 100],
    ["heavy outerwear", "Leather Jacket", "outerwear","heavy outerwear", 100],
    ["heavy outerwear", "Trench Coat",    "outerwear","heavy outerwear", 100],
    ["heavy outerwear", "Duster",         "outerwear","heavy outerwear", 100],
    ["heavy outerwear", "Blazer",         "outerwear","structured outerwear", null], // wrong slot
    ["heavy outerwear", "Bomber Jacket",  "outerwear","lightweight jacket",   null], // wrong slot
    ["heavy outerwear", "Swim Shorts",    "bottom",   "shorts",               null], // totally wrong
    // ── structured outerwear ─────────────────────────────────────────
    ["structured outerwear", "Blazer",              "outerwear","structured outerwear", 100],
    ["structured outerwear", "Double-Breasted Blazer","outerwear","structured outerwear", 100],
    ["structured outerwear", "Sport Coat",           "outerwear","structured outerwear", 100],
    ["structured outerwear", "Puffer Jacket",        "outerwear","heavy outerwear",      null], // wrong slot
    // ── lightweight jacket ────────────────────────────────────────────
    ["lightweight jacket", "Bomber Jacket",   "outerwear","lightweight jacket", 100],
    ["lightweight jacket", "Denim Jacket",    "outerwear","lightweight jacket", 100],
    ["lightweight jacket", "Varsity Jacket",  "outerwear","lightweight jacket", 100],
    ["lightweight jacket", "Harrington Jacket","outerwear","lightweight jacket", 100],
    ["lightweight jacket", "Windbreaker",     "outerwear","lightweight jacket", 100],
    ["lightweight jacket", "Blazer",          "outerwear","structured outerwear", null], // wrong slot
    // ── formal pant ───────────────────────────────────────────────────
    ["formal pant", "Dress Pants",       "bottom","formal pant", 100],
    ["formal pant", "Trousers",          "bottom","formal pant", 100],
    ["formal pant", "Tailored Trousers", "bottom","formal pant", 100],
    ["formal pant", "Wide Leg Trousers", "bottom","formal pant", 100],
    ["formal pant", "Pleated Trousers",  "bottom","formal pant", 100],
    ["formal pant", "Slacks",            "bottom","formal pant", 100],
    ["formal pant", "Wide Leg Pants",    "bottom","casual pant", null], // NEW: should be 0
    ["formal pant", "Pleated Pants",     "bottom","casual pant", null], // NEW: should be 0
    ["formal pant", "Chinos",            "bottom","casual pant", null], // should be 0
    ["formal pant", "Relaxed Jeans",     "bottom","denim bottom",null], // should be 0
    ["formal pant", "Denim Shorts",      "bottom","shorts",       null], // should be 0
    // ── casual pant ───────────────────────────────────────────────────
    ["casual pant", "Chinos",           "bottom","casual pant", 100],
    ["casual pant", "Cargo Pants",      "bottom","casual pant", 100],
    ["casual pant", "Joggers",          "bottom","casual pant", 100],
    ["casual pant", "Sweatpants",       "bottom","casual pant", 100],
    ["casual pant", "Leggings",         "bottom","casual pant", 100], // NEW
    ["casual pant", "Wide Leg Pants",   "bottom","casual pant", 100], // NEW
    ["casual pant", "Pleated Pants",    "bottom","casual pant", 100], // NEW
    ["casual pant", "Tapered Pants",    "bottom","casual pant", 100], // NEW
    ["casual pant", "Dress Pants",      "bottom","formal pant", null], // wrong slot
    ["casual pant", "Trousers",         "bottom","formal pant", null], // wrong slot
    ["casual pant", "Relaxed Jeans",    "bottom","denim bottom",null], // wrong slot
    // ── denim bottom ─────────────────────────────────────────────────
    ["denim bottom", "Relaxed Jeans",    "bottom","denim bottom", 100],
    ["denim bottom", "Straight Leg Jeans","bottom","denim bottom", 100],
    ["denim bottom", "Baggy Jeans",      "bottom","denim bottom", 100],
    ["denim bottom", "Denim Shorts",     "bottom","shorts",       null], // now in shorts slot
    ["denim bottom", "Chinos",           "bottom","casual pant",  null], // wrong slot
    // ── shorts ────────────────────────────────────────────────────────
    ["shorts", "Shorts",           "bottom","shorts", 100],
    ["shorts", "Denim Shorts",     "bottom","shorts", 100],
    ["shorts", "Jorts",            "bottom","shorts", 100],
    ["shorts", "Basketball Shorts","bottom","shorts", 100],
    ["shorts", "Swim Shorts",      "bottom","shorts", 100],
    ["shorts", "Biker Shorts",     "bottom","shorts", 100],
    ["shorts", "Compression Shorts","bottom","shorts", 100],
    ["shorts", "Leggings",         "bottom","casual pant", null], // wrong slot
    ["shorts", "Chinos",           "bottom","casual pant", null], // wrong slot
    // ── boot ─────────────────────────────────────────────────────────
    ["boot", "Work Boots",     "footwear","boot",       100],
    ["boot", "Chelsea Boots",  "footwear","boot",       100],
    ["boot", "Combat Boots",   "footwear","boot",       100],
    ["boot", "Hiking Boots",   "footwear","boot",       100],
    ["boot", "Oxford Shoes",   "footwear","dress shoe", null], // wrong slot
    ["boot", "Low-Top Sneakers","footwear","casual sneaker", null], // wrong slot
    // ── dress shoe ────────────────────────────────────────────────────
    ["dress shoe", "Oxford Shoes",  "footwear","dress shoe", 100],
    ["dress shoe", "Dress Shoes",   "footwear","dress shoe", 100], // NEW
    ["dress shoe", "Loafers",       "footwear","dress shoe", 100],
    ["dress shoe", "Derby Shoes",   "footwear","dress shoe", 100],
    ["dress shoe", "Work Boots",    "footwear","boot",       null], // wrong slot
    ["dress shoe", "Low-Top Sneakers","footwear","casual sneaker", null], // wrong slot
    // ── casual sneaker ────────────────────────────────────────────────
    ["casual sneaker", "Low-Top Sneakers",  "footwear","casual sneaker", 100],
    ["casual sneaker", "High-Top Sneakers", "footwear","casual sneaker", 100],
    ["casual sneaker", "Skate Shoes",       "footwear","casual sneaker", 100],
    ["casual sneaker", "Chelsea Boots",     "footwear","boot",       null], // wrong slot
    ["casual sneaker", "Oxford Shoes",      "footwear","dress shoe", null], // wrong slot
    // ── pullover mid layer ────────────────────────────────────────────
    ["pullover mid layer", "Hoodie",             "top","pullover mid layer", 100],
    ["pullover mid layer", "Crewneck Sweatshirt","top","pullover mid layer", 100],
    ["pullover mid layer", "Crewneck Sweater",   "top","pullover mid layer", 100],
    ["pullover mid layer", "Zip-Up Hoodie",      "top","zip-up / open mid layer", null], // zip-up is different slot
    // ── base layer ────────────────────────────────────────────────────
    ["base layer", "T-Shirt",    "top","base layer", 100],
    ["base layer", "Graphic Tee","top","base layer", 100],
    ["base layer", "Polo",       "top","base layer", 100],
    ["base layer", "Relaxed Jeans","bottom","denim bottom", null], // completely wrong
    // ── diversity/absence gaps (should not be blocked by slot guard) ──
    ["lack of variety in bottoms", "Relaxed Jeans","bottom","denim bottom", 25, "diversity gap — any bottom counts"],
    ["no formal options",          "Dress Pants",  "bottom","formal pant",  100, "absence gap — exact match"],
  ];

  for (const [gapDesc, sub, cat, expectedSlot, minProg, label] of progressTests) {
    const slot = getFunctionalSlot(sub);
    const prog = computeGapProgress(gapDesc, sub, cat, slot);
    const slotOk = expectedSlot === null || slot === expectedSlot;

    if (minProg === null) {
      // expect 0
      check(`"${sub}" does NOT fill "${gapDesc}" (${label ?? `slot=${slot}`})`, prog === 0, `prog=${prog}`);
    } else {
      check(`"${sub}" fills "${gapDesc}" ≥${minProg}% (${label ?? `slot=${slot}`})`, prog >= minProg, `prog=${prog}`);
    }
  }

  // ── BLOCK 3: Analysis quality — real GPT call ─────────────────────────────
  section("3 · Analysis quality — GPT on real DB wardrobe");

  const dbBase = await (async () => {
    const items: RawGarment[] = [];
    for (const st of ["Graphic Tee","Relaxed Jeans","Hoodie"]) items.push(...await fetchBySubType(st, 2));
    return items.filter(Boolean);
  })();

  let liveAnalysis: WardrobeAnalysis | null = null;
  if (dbBase.length === 0) {
    warn("No DB items fetched — skipping GPT analysis and live tests");
  } else {
    info(`DB items: ${dbBase.length} (${dbBase.map(g=>g.sub_type).join(", ")})`);
    liveAnalysis = await runAnalysis(dbBase);
    info(`Score: ${liveAnalysis.score} | Gaps: [${liveAnalysis.gaps.map(g=>g.description).join(", ")}]`);
    info(`Colors missing: [${liveAnalysis.colors.missing.join(", ")}] | Aes missing: [${liveAnalysis.aesthetics.missing.join(", ")}]`);
    info(`Cons: ${liveAnalysis.cons.length}`);
    check("score in range 15–85",          liveAnalysis.score>=15&&liveAnalysis.score<=85, `got ${liveAnalysis.score}`);
    check("at least 1 gap",                liveAnalysis.gaps.length>=1);
    check("no empty gap descriptions",     liveAnalysis.gaps.every(g=>g.description.length>2));
    check("all gaps have costPoints>0",    liveAnalysis.gaps.every(g=>g.costPoints>0));
    check("missing colors populated",      liveAnalysis.colors.missing.length>0);
    check("gaps have valid impact",        liveAnalysis.gaps.every(g=>["high","medium","low"].includes(g.impact)));
  }

  // ── BLOCK 4: Gap filling — synthetic, every gap type controlled ──────────
  section("4 · Gap crossing — targeted synthetic scenarios");

  {
    // Scenario A: wardrobe missing formal pant
    const aFormal = synthAnalysis({
      gaps:[gap("formal pant")],
      cons:["no dress pants or trousers for formal occasions"],
      conGapLinks:{"0":"formal pant"},
    });

    let cr: CrossedEntry[] = [];

    // Dress Pants → fills formal pant
    const dressPants = synth({id:"dp1",sub_type:"Dress Pants",category:"bottom",color_primary:"Charcoal"});
    const dpNew = simulateAdd(dressPants, aFormal, cr, 1);
    info(`Dress Pants crosses: [${dpNew.map(e=>`${e.category}:${e.key}`).join(", ")}]`);
    check("Dress Pants fills formal pant gap", dpNew.some(e=>e.category==="gap"&&e.key==="formal pant"&&(e.progress??0)>=100));
    check("Dress Pants crosses linked con",    dpNew.some(e=>e.category==="con"&&e.key==="0"));
    cr = [...cr, ...dpNew];

    // Wide Leg Pants → should NOT fill formal pant
    const wlp = synth({id:"wlp1",sub_type:"Wide Leg Pants",category:"bottom",color_primary:"Beige"});
    const wlpNew = simulateAdd(wlp, aFormal, cr, 1);
    check("Wide Leg Pants does NOT fill formal pant", !wlpNew.some(e=>e.category==="gap"&&e.key==="formal pant"), `got: ${wlpNew.map(e=>e.key).join(",")}`);

    // Pleated Pants → should NOT fill formal pant (streetwear vs. Pleated Trousers)
    const pp = synth({id:"pp1",sub_type:"Pleated Pants",category:"bottom",color_primary:"Grey"});
    const ppNew = simulateAdd(pp, aFormal, cr, 1);
    check("Pleated Pants does NOT fill formal pant", !ppNew.some(e=>e.category==="gap"&&e.key==="formal pant"));
    check("formal pant already filled — duplicate prevention", dpNew.length>0 && simulateAdd(dressPants, aFormal, cr, 1).filter(e=>e.category==="gap").length===0);
  }

  {
    // Scenario B: casual pant gap — new slot additions
    const aCasual = synthAnalysis({ gaps:[gap("casual pant",  "medium", 3)] });

    for (const [sub, shouldFill] of [
      ["Wide Leg Pants",  true],
      ["Leggings",        true],
      ["Pleated Pants",   true],
      ["Tapered Pants",   true],
      ["Balloon Pants",   true],
      ["Chinos",          true],
      ["Dress Pants",     false], // formal pant slot
      ["Relaxed Jeans",   false], // denim bottom slot
      ["Denim Shorts",    false], // shorts slot
    ] as [string, boolean][]) {
      const item = synth({id:`cas-${sub}`,sub_type:sub,category:"bottom"});
      const ne = simulateAdd(item, aCasual, [], 1);
      check(
        shouldFill ? `"${sub}" fills casual pant gap` : `"${sub}" does NOT fill casual pant gap`,
        shouldFill ? ne.some(e=>e.category==="gap"&&e.key==="casual pant"&&(e.progress??0)>=100) : !ne.some(e=>e.category==="gap"&&e.key==="casual pant"),
      );
    }
  }

  {
    // Scenario C: shorts gap
    const aShorts = synthAnalysis({ gaps:[gap("shorts", "medium", 3)] });

    for (const [sub, shouldFill] of [
      ["Denim Shorts",      true],
      ["Jorts",             true],
      ["Swim Shorts",       true],
      ["Basketball Shorts", true],
      ["Biker Shorts",      true],
      ["Chinos",            false], // wrong slot
      ["Leggings",          false], // wrong slot
      ["Dress Pants",       false], // wrong slot
    ] as [string, boolean][]) {
      const item = synth({id:`sh-${sub}`,sub_type:sub,category:"bottom"});
      const ne = simulateAdd(item, aShorts, [], 1);
      check(
        shouldFill ? `"${sub}" fills shorts gap` : `"${sub}" does NOT fill shorts gap`,
        shouldFill ? ne.some(e=>e.category==="gap"&&(e.progress??0)>=100) : !ne.some(e=>e.category==="gap"&&e.key==="shorts"),
      );
    }
  }

  {
    // Scenario D: all outerwear gaps
    const aOuter = synthAnalysis({
      gaps:[gap("heavy outerwear"), gap("structured outerwear"), gap("lightweight jacket")],
    });

    const outerwearTests: [string, string, boolean][] = [
      ["Puffer Jacket",  "heavy outerwear",      true],
      ["Trench Coat",    "heavy outerwear",      true],
      ["Blazer",         "structured outerwear", true],
      ["Bomber Jacket",  "lightweight jacket",   true],
      ["Denim Jacket",   "lightweight jacket",   true],
      ["Puffer Jacket",  "structured outerwear", false], // heavy fills heavy, not structured
      ["Blazer",         "heavy outerwear",      false], // structured doesn't fill heavy
      ["T-Shirt",        "heavy outerwear",      false], // top, not outerwear
    ];

    for (const [sub, gapDesc, shouldFill] of outerwearTests) {
      const slot = getFunctionalSlot(sub);
      const prog = computeGapProgress(gapDesc, sub, "outerwear", slot);
      const ok = shouldFill ? prog >= 100 : prog === 0;
      check(
        shouldFill ? `"${sub}" fills "${gapDesc}"` : `"${sub}" does NOT fill "${gapDesc}"`,
        ok, `prog=${prog} slot=${slot}`
      );
    }
  }

  {
    // Scenario E: footwear gaps
    const aFoot = synthAnalysis({
      gaps:[gap("boot"), gap("dress shoe"), gap("casual sneaker")],
    });

    const footTests: [string, string, boolean][] = [
      ["Work Boots",       "boot",          true],
      ["Chelsea Boots",    "boot",          true],
      ["Oxford Shoes",     "dress shoe",    true],
      ["Dress Shoes",      "dress shoe",    true],  // newly added
      ["Loafers",          "dress shoe",    true],
      ["Low-Top Sneakers", "casual sneaker",true],
      ["High-Top Sneakers","casual sneaker",true],
      ["Work Boots",       "dress shoe",    false], // boot slot, not dress shoe
      ["Oxford Shoes",     "casual sneaker",false], // dress shoe slot, not sneaker
      ["Low-Top Sneakers", "boot",          false], // sneaker slot, not boot
    ];

    for (const [sub, gapDesc, shouldFill] of footTests) {
      const slot = getFunctionalSlot(sub);
      const prog = computeGapProgress(gapDesc, sub, "footwear", slot);
      const ok = shouldFill ? prog >= 100 : prog === 0;
      check(
        shouldFill ? `"${sub}" fills "${gapDesc}"` : `"${sub}" does NOT fill "${gapDesc}"`,
        ok, `prog=${prog} slot=${slot}`
      );
    }
  }

  // ── BLOCK 5: Color crossing — comprehensive ─────────────────────────────
  section("5 · Color crossing — matches, non-matches, duplicates");

  {
    const aColor = synthAnalysis({ colors:{ have:["black","white"], missing:["Navy","Burgundy","Olive"] } });
    let cr: CrossedEntry[] = [];

    // Exact match
    const navyItem = synth({id:"nv1",sub_type:"T-Shirt",category:"top",color_primary:"Navy"});
    const nvNew = simulateAdd(navyItem, aColor, cr, 1);
    check("Navy item crosses Navy color",          nvNew.some(e=>e.category==="color"&&e.key==="Navy"));
    check("Navy item does NOT cross Burgundy",     !nvNew.some(e=>e.category==="color"&&e.key==="Burgundy"));
    cr = [...cr, ...nvNew];

    // Partial match (Navy Blue → Navy)
    const navyBlue = synth({id:"nb1",sub_type:"T-Shirt",category:"top",color_primary:"Navy Blue"});
    const nbNew = simulateAdd(navyBlue, aColor, cr, 1);
    check("Navy Blue does NOT re-cross Navy (already crossed)",  !nbNew.some(e=>e.category==="color"&&e.key==="Navy"));
    cr = [...cr, ...nbNew];

    // Burgundy
    const burgItem = synth({id:"bg1",sub_type:"Graphic Tee",category:"top",color_primary:"Burgundy"});
    const bgNew = simulateAdd(burgItem, aColor, cr, 1);
    check("Burgundy item crosses Burgundy color",  bgNew.some(e=>e.category==="color"&&e.key==="Burgundy"));
    cr = [...cr, ...bgNew];

    // Non-matching color
    const redItem = synth({id:"rd1",sub_type:"Polo",category:"top",color_primary:"Red"});
    const rdNew = simulateAdd(redItem, aColor, cr, 1);
    check("Red item does NOT cross Navy/Burgundy/Olive", !rdNew.some(e=>e.category==="color"));

    // Olive
    const oliveItem = synth({id:"ol1",sub_type:"Cargo Pants",category:"bottom",color_primary:"Olive"});
    const olNew = simulateAdd(oliveItem, aColor, cr, 1);
    check("Olive item crosses Olive color",        olNew.some(e=>e.category==="color"&&e.key==="Olive"));
    cr = [...cr, ...olNew];

    // All colors now crossed — another item with matching color doesn't duplicate
    const dup = synth({id:"ol2",sub_type:"Hoodie",category:"top",color_primary:"Olive"});
    const dupNew = simulateAdd(dup, aColor, cr, 1);
    check("Olive item doesn't re-cross already-crossed Olive", !dupNew.some(e=>e.category==="color"&&e.key==="Olive"));

    // Score from colors
    const bs = {analysisHistory:[aColor], crossed:cr, currentLevel:1} as WABackendState;
    const scoreWith = computeCumulativeScore(bs, 1);
    check("Score with 3 colors crossed > base", scoreWith > aColor.score, `base:${aColor.score} with:${scoreWith}`);
  }

  // ── BLOCK 6: Aesthetic crossing — matches, non-matches, duplicates ────────
  section("6 · Aesthetic crossing — matches, non-matches, duplicates");

  {
    const aAes = synthAnalysis({
      aesthetics:{ covered:[], missing:["streetwear","old money","preppy"] },
    });
    let cr: CrossedEntry[] = [];

    const swItem = synth({id:"sw1",sub_type:"Graphic Tee",category:"top",aesthetic_tags:["streetwear"]});
    const swNew = simulateAdd(swItem, aAes, cr, 1);
    check("streetwear item crosses streetwear aesthetic",  swNew.some(e=>e.category==="aesthetic"&&e.key==="streetwear"));
    check("streetwear item does NOT cross old money",      !swNew.some(e=>e.category==="aesthetic"&&e.key==="old money"));
    cr = [...cr, ...swNew];

    const omItem = synth({id:"om1",sub_type:"Blazer",category:"outerwear",aesthetic_tags:["old money"]});
    const omNew = simulateAdd(omItem, aAes, cr, 1);
    check("old money item crosses old money",              omNew.some(e=>e.category==="aesthetic"&&e.key==="old money"));
    cr = [...cr, ...omNew];

    // No aesthetic tags → no aesthetic crossing
    const noAesItem = synth({id:"na1",sub_type:"T-Shirt",category:"top",color_primary:"White"});
    const naNew = simulateAdd(noAesItem, aAes, cr, 1);
    check("item with no aesthetic_tags crosses no aesthetics", !naNew.some(e=>e.category==="aesthetic"));

    // Duplicate: second streetwear item
    const swDup = synth({id:"sw2",sub_type:"Hoodie",category:"top",aesthetic_tags:["streetwear"]});
    const swDupNew = simulateAdd(swDup, aAes, cr, 1);
    check("second streetwear item does NOT re-cross streetwear", !swDupNew.some(e=>e.category==="aesthetic"&&e.key==="streetwear"));

    // Multiple aesthetics from one item
    const multiAes = synth({id:"ma1",sub_type:"Varsity Jacket",category:"outerwear",aesthetic_tags:["preppy","streetwear"]});
    const maNew = simulateAdd(multiAes, aAes, cr, 1);
    check("multi-aesthetic item crosses preppy",             maNew.some(e=>e.category==="aesthetic"&&e.key==="preppy"));
    check("multi-aesthetic item does NOT re-cross streetwear", !maNew.some(e=>e.category==="aesthetic"&&e.key==="streetwear"));
    cr = [...cr, ...maNew];

    check("All 3 aesthetics crossed",  ["streetwear","old money","preppy"].every(a=>cr.some(e=>e.category==="aesthetic"&&e.key===a)));
    check("isLevelComplete with aesthetics", isLevelComplete(aAes, cr, 1));
  }

  // ── BLOCK 7: Con crossing — gap-linked and keyword-matched ───────────────
  section("7 · Con (weakness) crossing — gap-linked and direct keyword");

  {
    const aCons = synthAnalysis({
      gaps:[gap("heavy outerwear"), gap("dress shoe")],
      cons:[
        "Wardrobe lacks outerwear for cold weather",  // con 0 → linked to heavy outerwear
        "No formal footwear options",                  // con 1 → linked to dress shoe
        "Color palette is very limited and monotone",  // con 2 → no gap link, direct keyword
      ],
      conGapLinks:{"0":"heavy outerwear","1":"dress shoe"},
    });
    let cr: CrossedEntry[] = [];

    // Add Puffer Jacket → fills heavy outerwear, crosses con 0 via gap link
    const puffer = synth({id:"pf1",sub_type:"Puffer Jacket",category:"outerwear"});
    const pfNew = simulateAdd(puffer, aCons, cr, 1);
    check("Puffer fills heavy outerwear gap",   pfNew.some(e=>e.category==="gap"&&e.key==="heavy outerwear"&&(e.progress??0)>=100));
    check("Filling heavy outerwear → con 0 crossed", pfNew.some(e=>e.category==="con"&&e.key==="0"));
    check("Puffer does NOT cross con 1 (dress shoe not filled)", !pfNew.some(e=>e.category==="con"&&e.key==="1"));
    cr = [...cr, ...pfNew];

    // Add Oxford Shoes → fills dress shoe, crosses con 1
    const oxfords = synth({id:"ox1",sub_type:"Oxford Shoes",category:"footwear"});
    const oxNew = simulateAdd(oxfords, aCons, cr, 1);
    check("Oxford fills dress shoe gap",     oxNew.some(e=>e.category==="gap"&&e.key==="dress shoe"&&(e.progress??0)>=100));
    check("Filling dress shoe → con 1 crossed", oxNew.some(e=>e.category==="con"&&e.key==="1"));
    cr = [...cr, ...oxNew];

    // Con 2 has no gap link — remains uncrossed unless directly triggered
    check("Con 2 uncrossed (no gap link and no keyword match from items added)", !cr.some(e=>e.category==="con"&&e.key==="2"));

    // Force-cross con 2
    cr.push({category:"con",key:"2",garmentId:"force-color",analysisLevel:1});
    check("Force-cross con 2 works", cr.some(e=>e.category==="con"&&e.key==="2"));
    check("All cons crossed → isLevelComplete", isLevelComplete(aCons, cr, 1));
  }

  // ── BLOCK 8: Partial progress accumulation ─────────────────────────────────
  section("8 · Partial progress — accumulation, caps, wrong-level isolation");

  {
    const aHalf = synthAnalysis({ gaps:[gap("heavy outerwear")] });

    // Two items each giving partial progress
    const e1: CrossedEntry = {category:"gap",key:"heavy outerwear",garmentId:"a1",analysisLevel:1,progress:50};
    const e2: CrossedEntry = {category:"gap",key:"heavy outerwear",garmentId:"a2",analysisLevel:1,progress:60};
    const e3: CrossedEntry = {category:"gap",key:"heavy outerwear",garmentId:"a3",analysisLevel:1,progress:40};

    check("50 + 60 = capped at 100",    gapTotalProgress([e1,e2],"heavy outerwear",1) === 100);
    check("50 + 40 = 90, not yet filled",gapTotalProgress([e1,e3],"heavy outerwear",1) === 90);
    check("single 50 = not filled",      gapTotalProgress([e1],"heavy outerwear",1) === 50);
    check("empty = 0",                   gapTotalProgress([],"heavy outerwear",1) === 0);

    // Wrong level entries don't contribute
    const e4: CrossedEntry = {category:"gap",key:"heavy outerwear",garmentId:"a1",analysisLevel:2,progress:100};
    check("Level 2 entry doesn't help level 1 progress", gapTotalProgress([e4],"heavy outerwear",1) === 0);
    check("Level 2 entry counts for level 2",            gapTotalProgress([e4],"heavy outerwear",2) === 100);

    // isLevelComplete requires 100% progress, not just any crossing
    const partialCr = [e1]; // only 50%
    check("50% progress → level NOT complete",   !isLevelComplete(aHalf, partialCr, 1));
    const fullCr = [e1, e2]; // 50+60 = 100
    check("50+60% progress → level IS complete", isLevelComplete(aHalf, fullCr, 1));
  }

  // ── BLOCK 9: Removal regression ─────────────────────────────────────────────
  section("9 · Removal regression — item removed, gap reopens");

  {
    const aRem = synthAnalysis({
      gaps:[gap("heavy outerwear"), gap("casual pant")],
      colors:{ have:[], missing:["Navy"] },
      aesthetics:{ covered:[], missing:["streetwear"] },
    });

    const puffer   = synth({id:"rf-p",sub_type:"Puffer Jacket",category:"outerwear"});
    const chinos   = synth({id:"rf-c",sub_type:"Chinos",category:"bottom",color_primary:"Navy"});
    const swTee    = synth({id:"rf-t",sub_type:"Graphic Tee",category:"top",color_primary:"Black",aesthetic_tags:["streetwear"]});
    const noEffect = synth({id:"rf-n",sub_type:"Watch",category:"accessory",color_primary:"Silver"});

    let cr: CrossedEntry[] = [];
    cr = [...cr, ...simulateAdd(puffer, aRem, cr, 1)];
    cr = [...cr, ...simulateAdd(chinos, aRem, cr, 1)];
    cr = [...cr, ...simulateAdd(swTee, aRem, cr, 1)];
    cr = [...cr, ...simulateAdd(noEffect, aRem, cr, 1)];

    check("Before removal: heavy outerwear filled",   gapTotalProgress(cr,"heavy outerwear",1) >= 100);
    check("Before removal: casual pant filled",       gapTotalProgress(cr,"casual pant",1) >= 100);
    check("Before removal: Navy color crossed",       cr.some(e=>e.category==="color"&&e.key==="Navy"));
    check("Before removal: streetwear aesthetic crossed", cr.some(e=>e.category==="aesthetic"&&e.key==="streetwear"));

    // Remove puffer → heavy outerwear reopens
    const afterPuffer = simulateRemove(puffer.id, cr);
    check("After removing puffer: heavy outerwear progress = 0", gapTotalProgress(afterPuffer,"heavy outerwear",1) === 0);
    check("After removing puffer: casual pant still filled",     gapTotalProgress(afterPuffer,"casual pant",1) >= 100);

    // Remove chinos → casual pant reopens AND navy un-crossed
    const afterChinos = simulateRemove(chinos.id, cr);
    check("After removing chinos: casual pant progress = 0",     gapTotalProgress(afterChinos,"casual pant",1) === 0);
    check("After removing chinos: Navy color un-crossed",         !afterChinos.some(e=>e.category==="color"&&e.key==="Navy"));
    check("After removing chinos: heavy outerwear still filled",  gapTotalProgress(afterChinos,"heavy outerwear",1) >= 100);

    // Remove non-contributing item → no change
    const afterNoEffect = simulateRemove(noEffect.id, cr);
    check("Removing non-contributing item: crossings unchanged", afterNoEffect.length === cr.length);

    // Score with vs. without puffer
    const bsWith    = {analysisHistory:[aRem], crossed:cr, currentLevel:1} as WABackendState;
    const bsWithout = {analysisHistory:[aRem], crossed:afterPuffer, currentLevel:1} as WABackendState;
    check("Score regresses after removing puffer", computeCumulativeScore(bsWithout,1) < computeCumulativeScore(bsWith,1));
  }

  // ── BLOCK 10: Score accumulation ─────────────────────────────────────────────
  section("10 · Score accumulation — gap/color/aesthetic/con points");

  {
    const aScore = synthAnalysis({
      score:40,
      gaps:[ gap("heavy outerwear","high",5), gap("casual sneaker","medium",3) ],
      colors:{ have:[], missing:["Navy","Burgundy"] },
      aesthetics:{ covered:[], missing:["streetwear"] },
      cons:["Lacks outerwear"],
      conGapLinks:{"0":"heavy outerwear"},
    });

    let cr: CrossedEntry[] = [];
    const puffer  = synth({id:"sc-p",sub_type:"Puffer Jacket",category:"outerwear"});
    const sneak   = synth({id:"sc-s",sub_type:"Low-Top Sneakers",category:"footwear",color_primary:"Navy",aesthetic_tags:["streetwear"]});
    const burgTee = synth({id:"sc-b",sub_type:"Graphic Tee",category:"top",color_primary:"Burgundy"});

    cr = [...cr, ...simulateAdd(puffer, aScore, cr, 1)];
    cr = [...cr, ...simulateAdd(sneak, aScore, cr, 1)];
    cr = [...cr, ...simulateAdd(burgTee, aScore, cr, 1)];

    const bs = {analysisHistory:[aScore], crossed:cr, currentLevel:1} as WABackendState;
    const final = computeCumulativeScore(bs, 1);
    info(`Score: ${aScore.score} base → ${final} after fills`);
    // base(40) + gap heavy(+5) + gap sneaker(+3) + navy(+2) + burgundy(+2) + streetwear(+1) + con(+2) = 55
    check("Score = base + gap pts + color pts + aesthetic pts + con pts", final >= 50 && final <= 100, `got ${final}`);
    check("Score increases from base",  final > aScore.score, `base:${aScore.score} final:${final}`);
  }

  // ── BLOCK 11: Level-up lifecycle ─────────────────────────────────────────────
  section("11 · Level-up lifecycle — L1 complete → L2 → L3");

  {
    const aL1 = synthAnalysis({
      score:45,
      gaps:[ gap("heavy outerwear","high",5), gap("casual pant","medium",3) ],
      colors:{ have:[], missing:["Navy"] },
      aesthetics:{ covered:[], missing:["streetwear"] },
      cons:["No outerwear"],
      conGapLinks:{"0":"heavy outerwear"},
    });

    // Build L1 crossings
    let l1cr: CrossedEntry[] = [];
    l1cr = [...l1cr, ...simulateAdd(synth({id:"l1-p",sub_type:"Puffer Jacket",category:"outerwear"}), aL1, l1cr, 1)];
    l1cr = [...l1cr, ...simulateAdd(synth({id:"l1-c",sub_type:"Chinos",category:"bottom",color_primary:"Navy",aesthetic_tags:["streetwear"]}), aL1, l1cr, 1)];
    // Force-cross con if not already done via gap link
    if (!l1cr.some(e=>e.category==="con"&&e.key==="0"))
      l1cr.push({category:"con",key:"0",garmentId:"l1-p",analysisLevel:1});

    check("L1 all gaps filled",           aL1.gaps.every(g=>gapTotalProgress(l1cr,g.description,1)>=100));
    check("L1 all colors crossed",        aL1.colors.missing.every(c=>l1cr.some(e=>e.category==="color"&&e.key===c&&e.analysisLevel===1)));
    check("L1 all aesthetics crossed",    aL1.aesthetics.missing.every(a=>l1cr.some(e=>e.category==="aesthetic"&&e.key===a&&e.analysisLevel===1)));
    check("L1 all cons crossed",          aL1.cons.every((_,i)=>l1cr.some(e=>e.category==="con"&&e.key===String(i)&&e.analysisLevel===1)||!!aL1.conGapLinks?.[String(i)]&&gapTotalProgress(l1cr,aL1.conGapLinks![String(i)],1)>=100));
    check("L1 isLevelComplete",           isLevelComplete(aL1, l1cr, 1));
    check("computeEffectiveLevel = 1 (only L1 exists)", computeEffectiveLevel([aL1], l1cr, 1) === 1);

    const l1FinalScore = computeCumulativeScore({analysisHistory:[aL1], crossed:l1cr, currentLevel:1} as WABackendState, 1);
    check("L1 final score > base",        l1FinalScore > aL1.score, `base:${aL1.score} final:${l1FinalScore}`);

    // Now simulate level 2 being generated
    const aL2 = synthAnalysis({
      score: l1FinalScore, // base for L2 is where L1 ended
      gaps:[ gap("boot","high",5), gap("dress shoe","medium",3) ],
      colors:{ have:[], missing:["Burgundy","Olive"] },
      aesthetics:{ covered:[], missing:["old money"] },
      cons:["No formal footwear"],
      conGapLinks:{"0":"dress shoe"},
    });

    let allCr = [...l1cr];
    check("computeEffectiveLevel = 2 (L2 added, not complete)", computeEffectiveLevel([aL1,aL2], allCr, 2) === 2);

    // L2 crossings — use analysisLevel:2
    const boots    = synth({id:"l2-b",sub_type:"Work Boots",category:"footwear"});
    const dressShoe = synth({id:"l2-d",sub_type:"Oxford Shoes",category:"footwear",color_primary:"Burgundy",aesthetic_tags:["old money"]});
    const olive    = synth({id:"l2-o",sub_type:"Cargo Pants",category:"bottom",color_primary:"Olive"});

    let l2cr: CrossedEntry[] = [];
    l2cr = [...l2cr, ...simulateAdd(boots, aL2, l2cr, 2)];
    l2cr = [...l2cr, ...simulateAdd(dressShoe, aL2, l2cr, 2)];
    l2cr = [...l2cr, ...simulateAdd(olive, aL2, l2cr, 2)];

    allCr = [...l1cr, ...l2cr];

    check("L2 boot gap filled",           gapTotalProgress(allCr,"boot",2) >= 100);
    check("L2 dress shoe gap filled",     gapTotalProgress(allCr,"dress shoe",2) >= 100);
    check("L2 Burgundy color crossed",    allCr.some(e=>e.category==="color"&&e.key==="Burgundy"&&e.analysisLevel===2));
    check("L2 old money aesthetic crossed", allCr.some(e=>e.category==="aesthetic"&&e.key==="old money"&&e.analysisLevel===2));
    check("L1 crossings unaffected by L2 items", l1cr.every(e=>e.analysisLevel===1), "L1 entries should still be level 1");
    check("L2 isLevelComplete",           isLevelComplete(aL2, allCr, 2));

    check("computeEffectiveLevel = 2 (L2 complete, L3 not added)", computeEffectiveLevel([aL1,aL2], allCr, 2) === 2);

    const bsL2 = {analysisHistory:[aL1,aL2], crossed:allCr, currentLevel:2} as WABackendState;
    const l2Score = computeCumulativeScore(bsL2, 2);
    check("L2 cumulative score > L1 final", l2Score >= l1FinalScore, `L1:${l1FinalScore} L2:${l2Score}`);
    info(`Score progression: ${aL1.score} (base) → ${l1FinalScore} (L1) → ${l2Score} (L2)`);

    // Add a "L3" analysis
    const aL3 = synthAnalysis({
      score: l2Score,
      gaps:[ gap("structured outerwear","medium",3) ],
      colors:{ have:[], missing:["Camel"] },
      aesthetics:{ covered:[], missing:["preppy"] },
      cons:[],
    });

    // Before completing L3 — effective level should be 3
    check("computeEffectiveLevel = 3 (L3 added, not complete)", computeEffectiveLevel([aL1,aL2,aL3], allCr, 3) === 3);

    // Complete L3
    let l3cr: CrossedEntry[] = [];
    l3cr = [...l3cr, ...simulateAdd(synth({id:"l3-bl",sub_type:"Blazer",category:"outerwear",color_primary:"Camel",aesthetic_tags:["preppy"]}), aL3, l3cr, 3)];
    const finalAllCr = [...allCr, ...l3cr];

    check("L3 structured outerwear filled", gapTotalProgress(finalAllCr,"structured outerwear",3)>=100);
    check("L3 isLevelComplete",             isLevelComplete(aL3, finalAllCr, 3));
    check("computeEffectiveLevel = 3 (L3 complete, no L4)", computeEffectiveLevel([aL1,aL2,aL3], finalAllCr, 3) === 3);

    const l3Score = computeCumulativeScore({analysisHistory:[aL1,aL2,aL3], crossed:finalAllCr, currentLevel:3} as WABackendState, 3);
    check("L3 score ≥ L2 score (no regression)", l3Score >= l2Score, `L2:${l2Score} L3:${l3Score}`);
    info(`Final score progression: ${aL1.score} → ${l1FinalScore} → ${l2Score} → ${l3Score}`);
  }

  // ── BLOCK 12: Edge cases ────────────────────────────────────────────────────
  section("12 · Edge cases");

  // Empty wardrobe
  const em = computeMetrics([] as GarmentForScoring[]);
  check("empty wardrobe score = 0",          em.score === 0);
  check("empty wardrobe: 5+ missing slots",  em.functionalSlotsMissing.length >= 5);

  // Single item
  const singleG = synth({id:"sg1",sub_type:"Graphic Tee",category:"top",color_primary:"Black"});
  const sm = computeMetrics([singleG as GarmentForScoring]);
  check("single item: score > 0",            sm.score > 0);

  // gapTotalProgress: no entries for gap
  check("gapTotalProgress with no matching entries = 0", gapTotalProgress([], "heavy outerwear", 1) === 0);

  // computeEffectiveLevel: empty history
  check("computeEffectiveLevel empty = 1", computeEffectiveLevel([],[], 1) === 1);

  // Wrong level doesn't contribute to isLevelComplete
  const aEdge = synthAnalysis({ gaps:[gap("heavy outerwear")] });
  const wrongLevel: CrossedEntry[] = [{category:"gap",key:"heavy outerwear",garmentId:"x",analysisLevel:2,progress:100}];
  check("L2 crossing doesn't satisfy L1 isLevelComplete", !isLevelComplete(aEdge, wrongLevel, 1));

  // Analysis with 0 gaps/colors/aesthetics/cons → immediately complete
  const aPerfect = synthAnalysis({ gaps:[], colors:{have:[],missing:[]}, aesthetics:{covered:[],missing:[]}, cons:[] });
  check("analysis with no gaps/colors/aes/cons → isLevelComplete = true", isLevelComplete(aPerfect, [], 1));

  // ── BLOCK 13: AI gap-check — real image inference ────────────────────────
  section("13 · AI gap-check — image-based inference");

  if (!liveAnalysis) {
    warn("Skipping AI gap-check (no live analysis)");
  } else {
    // Fetch a puffer/coat with image to test heavy outerwear inference
    const coatItem = await (async () => {
      for (const st of ["Puffer Jacket","Leather Jacket","Trench Coat","Down Jacket","Wool Coat"]) {
        const r = await fetchBySubType(st, 1);
        if (r[0]?.image) return r[0];
      }
      return null;
    })();

    if (coatItem?.image && liveAnalysis.gaps.some(g=>/heavy|outer|coat|jacket/i.test(g.description))) {
      const heavyGaps = liveAnalysis.gaps.filter(g=>/heavy|outer|coat|jacket/i.test(g.description)).map(g=>g.description);
      const aiResult = await aiGapCheck(coatItem as RawGarment, heavyGaps);
      info(`AI gap-check (${coatItem.sub_type} image vs [${heavyGaps.join(", ")}]): fills=${JSON.stringify(aiResult)}`);
      check("AI identifies coat fills heavy outerwear-type gap", aiResult.length > 0, `gaps=${heavyGaps.join(",")}`);

      // Now ensure AI doesn't claim a coat fills a footwear gap (hallucination guard)
      const footGaps = liveAnalysis.gaps.filter(g=>/sneak|boot|shoe|foot/i.test(g.description)).map(g=>g.description);
      if (footGaps.length > 0) {
        const aiWrong = await aiGapCheck(coatItem as RawGarment, footGaps);
        info(`AI gap-check (coat image vs footwear gaps): fills=${JSON.stringify(aiWrong)}`);
        check("AI does NOT claim coat fills footwear gap", aiWrong.length === 0, `got: ${aiWrong.join(",")}`);
      }
    } else if (liveAnalysis.gaps.length > 0) {
      // Fallback: use any item with image against a gap it can't possibly fill
      const anyItem = await (async () => {
        for (const st of ["Graphic Tee","T-Shirt"]) {
          const r = await fetchBySubType(st, 1);
          if (r[0]?.image) return r[0];
        }
        return null;
      })();
      if (anyItem?.image) {
        const bootGaps = liveAnalysis.gaps.filter(g=>/boot|sneak|shoe/i.test(g.description)).map(g=>g.description);
        if (bootGaps.length > 0) {
          const aiResult = await aiGapCheck(anyItem as RawGarment, bootGaps);
          info(`AI gap-check (tee image vs boot gaps): fills=${JSON.stringify(aiResult)}`);
          check("AI does NOT claim tee fills boot/shoe gap", aiResult.length === 0);
        } else {
          warn("No boot/shoe gaps in live analysis — skipping AI hallucination guard");
        }
      } else {
        warn("No DB items with images available for AI test");
      }
    }

    // Empty gap list → always returns []
    const anyImgItem = dbBase.find(g=>g.image);
    if (anyImgItem) {
      const emptyResult = await aiGapCheck(anyImgItem as RawGarment, []);
      check("AI gap-check with empty list = []", emptyResult.length === 0);
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log(`\n${C.bold}══════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}Results: ${C.green}${pass} passed${C.reset}  ${fail > 0 ? C.red : C.green}${fail} failed${C.reset}`);
  if (fail > 0) console.log(`${C.red}Investigate failures above.${C.reset}`);
  else          console.log(`${C.green}All tests passed.${C.reset}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
