"use client";
import { peekCache, rememberCache } from "@/lib/clientCache";
import { useEntitlements } from "@/contexts/EntitlementsContext";
import { useTutorialDemo } from "@/lib/client/tutorialState";
import { sampleCloset, SAMPLE_IMAGES } from "@/lib/client/tutorialSamples";
import { ReadyGate } from "@/components/ReadyGate";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getSlot } from "@/lib/outfitRules";
import { useIsMobile } from "@/lib/hooks/useIsMobile";

const FONT: CSSProperties = { fontFamily: "Arial, sans-serif" };
const B = 142;
const G = 5;
const MIN_ACC = 10;
const IDEAL_THRESHOLD = 75;
const CATS = ["all","top","bottom","footwear","outerwear","accessory"] as const;

const WAVE_CSS = `
  @keyframes loadbar {
    0%  { width: 0% }
    55% { width: 65% }
    80% { width: 84% }
    100%{ width: 93% }
  }
  @keyframes slideInFromLeft {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0); }
  }
  @keyframes slideOutToLeft {
    from { transform: translateX(0); }
    to   { transform: translateX(-100%); }
  }
  @keyframes slideInFromRight {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }
  @keyframes slideOutToRight {
    from { transform: translateX(0); }
    to   { transform: translateX(100%); }
  }
`;

type Garment = {
  id: string; title: string; brand: string | null;
  image: string | null; category: string; sub_type: string | null;
  color_primary: string | null; pros: unknown; cons: unknown;
  color_pairings: unknown;
};

type ScoreResult = {
  score: number; valid: boolean; reason: string | null; pros: string[]; cons: string[];
  serverError?: boolean;
  // Free tier: /api/scoring/outfit returns { score: null, locked: true } — scoring is Pro-only.
  // Without this flag the page read that as a below-threshold score ("ACCESS DENIED … scored
  // below the ideal threshold"), which is just wrong. Same handling as the app's Builder.
  locked?: boolean;
};

type PanelState = "hidden" | "visible" | "exiting";

// ── Outfit helpers ────────────────────────────────────────────────────────────

const EXCLUSIVE_SLOTS = new Set([
  "base-top","overshirt","mid-layer","vest","outer",
  "pants","shorts","skirt","dress","jumpsuit","overalls","shoes","sandals",
]);

function gSlot(g: Garment): string {
  return getSlot({ category: g.category, sub_type: g.sub_type ?? null, title: g.title });
}

function canAddToOutfit(existing: Garment[], toAdd: Garment): boolean {
  const slot = gSlot(toAdd);
  if (!EXCLUSIVE_SLOTS.has(slot)) return true;
  return !existing.some(g => gSlot(g) === slot);
}

function parseProp(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; }
    catch { return []; }
  }
  return [];
}

function accLabel(g: Garment): string {
  const s = (g.sub_type ?? g.title ?? "").toLowerCase();
  if (s.includes("ring"))                                                        return "Hand";
  if (s.includes("watch"))                                                       return "Left Wrist";
  if (s.includes("bracelet") || s.includes("bangle"))                           return "Wrist";
  if (s.includes("necklace") || s.includes("chain") || s.includes("pendant"))   return "Neck";
  if (s.includes("earring"))                                                     return "Ears";
  if (s.includes("belt"))                                                        return "Waist";
  if (s.includes("bag") || s.includes("backpack") || s.includes("tote") || s.includes("purse")) return "Carried";
  if (s.includes("hat") || s.includes("cap") || s.includes("beanie"))           return "Head";
  if (s.includes("sunglasses") || s.includes("glasses"))                        return "Face";
  if (s.includes("scarf"))                                                       return "Neck";
  if (s.includes("gloves"))                                                      return "Hands";
  return "Accessory";
}

function isOuterCapableTop(g: Garment): boolean {
  const sub = (g.sub_type ?? "").toLowerCase();
  return (
    sub.includes("flannel") || sub.includes("oxford") || sub.includes("camp collar") ||
    sub.includes("bowling") || sub.includes("western") || sub.includes("chambray") ||
    sub.includes("button-up") || sub.includes("button up") ||
    sub.includes("button-down") || sub.includes("button down") ||
    sub.includes("dress shirt") || sub.includes("work shirt") ||
    sub.includes("linen shirt") || sub.includes("denim shirt") ||
    sub.includes("printed shirt") || sub.includes("silk shirt") ||
    sub.includes("rugby") ||
    (sub.includes("polo") && !sub.includes("polo neck"))
  );
}

// ── Mobile bucketing ──────────────────────────────────────────────────────────
// Mirrors the same category/sub_type grouping the desktop grid uses (see the "Slot
// categorization" loop below) as a pure per-item function, so the mobile picker can filter
// available items by the same buckets without duplicating desktop's slot state.

type Bucket = "head" | "outer" | "mid" | "top" | "bottom" | "shoes" | "accessory";

const BUCKET_LABEL: Record<Bucket, string> = {
  head: "Head", outer: "Outerwear", mid: "Mid Layer", top: "Top",
  bottom: "Bottom", shoes: "Shoes", accessory: "Accessories",
};
const BUCKET_ORDER: Bucket[] = ["head", "outer", "top", "mid", "bottom", "shoes", "accessory"];

function bucketOf(g: Garment): Bucket {
  if (g.category === "footwear")  return "shoes";
  if (g.category === "bottom")    return "bottom";
  if (g.category === "outerwear") return "outer";
  // Checked before category === "accessory" — hats commonly get that category from the AI
  // tagger, which would otherwise claim them before this hat-specific check ever runs, and this
  // is the function canAddToOutfit uses to validate drops, so that made the Hat slot reject
  // (or silently misfile) every hat drag.
  const sub = (g.sub_type ?? "").toLowerCase();
  if (sub.includes("hat") || sub.includes("cap") || sub.includes("beanie") ||
      (sub.includes("bucket") && !sub.includes("bag")) || sub.includes("beret") || sub.includes("snapback")) return "head";
  if (g.category === "accessory") return "accessory";
  if (sub.includes("hoodie") || sub.includes("sweatshirt") || sub.includes("zip-up") ||
      sub.includes("zip up") || sub.includes("sweater") || sub.includes("pullover") ||
      sub.includes("crewneck") || sub.includes("fleece") || sub.includes("cardigan")) return "mid";
  return "top";
}

// ── Builder page ──────────────────────────────────────────────────────────────

export default function BuilderPage() {
  // Scoring is Pro-only — free users get no SCORE button (building/saving still works).
  const { hasAI } = useEntitlements();
  const isMobile = useIsMobile();
  const [allGarments, setAllGarments] = useState<Garment[]>(() => peekCache<Garment[]>("/api/garments") ?? []);
  const [outfit,      setOutfit]      = useState<Garment[]>([]);
  const [loading,     setLoading]     = useState(() => !peekCache("/api/garments"));
  const [loadError,   setLoadError]   = useState(false);
  const [cat,         setCat]         = useState<typeof CATS[number]>("all");
  const [dragId,      setDragId]      = useState<string | null>(null);
  const [dragOver,    setDragOver]    = useState<string | null>(null);
  const [scoring,     setScoring]     = useState(false);
  const [result,      setResult]      = useState<ScoreResult | null>(null);
  const [errorFading, setErrorFading] = useState(false);
  const [prosState,   setProsState]   = useState<PanelState>("hidden");
  const [consState,   setConsState]   = useState<PanelState>("hidden");
  const [invVisible,  setInvVisible]  = useState(true);
  const [showInvBtn,  setShowInvBtn]  = useState(false);
  const [pickerBucket, setPickerBucket] = useState<Bucket | null>(null);

  // First-run tutorial: the sample closet in the inventory and a sample outfit in the slots
  // (lib/client/tutorialSamples.ts); the account's own pieces come back afterwards. Never cached.
  const demo = useTutorialDemo();
  const savedRef = useRef<{ all: Garment[]; outfit: Garment[] } | null>(null);
  useEffect(() => {
    if (demo === (savedRef.current !== null)) return;
    if (demo) {
      savedRef.current = { all: allGarments, outfit };
      const sample = sampleCloset(SAMPLE_IMAGES).garments as unknown as Garment[];
      setAllGarments(sample);
      setOutfit(sample.filter(g => ["sample-tee", "sample-jeans", "sample-jacket"].includes(g.id)));
      setResult(null);
      setLoading(false);
    } else {
      setAllGarments(savedRef.current!.all);
      setOutfit(savedRef.current!.outfit);
      savedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const invRef      = useRef<HTMLDivElement>(null);
  const fadeTRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prosTRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const consTRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invBtnTRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch("/api/garments")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Garment[]) => {
        rememberCache("/api/garments", data);
        // Arrived mid-tutorial: keep it for afterwards instead of replacing the samples on screen.
        if (savedRef.current) savedRef.current = { ...savedRef.current, all: data };
        else setAllGarments(data);
        setLoading(false);
      })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  // Auto-fade error results after a delay
  useEffect(() => {
    if (!result) { setErrorFading(false); return; }
    const eligible = result.valid && result.score >= IDEAL_THRESHOLD;
    if (eligible) { setErrorFading(false); return; }
    setErrorFading(false);
    clearTimeout(fadeTRef.current);
    clearTimeout(clearTRef.current);
    fadeTRef.current  = setTimeout(() => setErrorFading(true), 3200);
    clearTRef.current = setTimeout(() => setResult(null), 3900);
    return () => { clearTimeout(fadeTRef.current); clearTimeout(clearTRef.current); };
  }, [result]);

  // Delay SHOW INVENTORY button until panel has fully closed so it doesn't overlap HIDE INVENTORY
  useEffect(() => {
    clearTimeout(invBtnTRef.current);
    if (!invVisible) {
      invBtnTRef.current = setTimeout(() => setShowInvBtn(true), 360);
    } else {
      setShowInvBtn(false);
    }
    return () => clearTimeout(invBtnTRef.current);
  }, [invVisible]);

  function togglePros() {
    if (prosState === "visible") {
      setProsState("exiting");
      clearTimeout(prosTRef.current);
      prosTRef.current = setTimeout(() => setProsState("hidden"), 280);
    } else {
      setProsState("visible");
    }
  }

  function toggleCons() {
    if (consState === "visible") {
      setConsState("exiting");
      clearTimeout(consTRef.current);
      consTRef.current = setTimeout(() => setConsState("hidden"), 280);
    } else {
      setConsState("visible");
    }
  }

  const outfitIds      = new Set(outfit.map(g => g.id));
  const dragSource     = allGarments.find(g => g.id === dragId) ?? null;
  const dragFromOutfit = !!dragSource && outfitIds.has(dragSource.id);

  const editAvail = cat === "all"
    ? allGarments.filter(g => !outfitIds.has(g.id))
    : allGarments.filter(g => g.category === cat && !outfitIds.has(g.id));

  function dropOnSlot(existingId: string) {
    if (!dragSource || dragFromOutfit) { setDragId(null); setDragOver(null); return; }
    const without = outfit.filter(g => g.id !== existingId);
    if (!canAddToOutfit(without, dragSource)) { setDragId(null); setDragOver(null); return; }
    setOutfit([...without, dragSource]);
    setDragId(null); setDragOver(null);
    setResult(null);
  }

  function dropOnEmpty() {
    if (!dragSource || dragFromOutfit) { setDragId(null); setDragOver(null); return; }
    if (!canAddToOutfit(outfit, dragSource)) { setDragId(null); setDragOver(null); return; }
    setOutfit(prev => [...prev, dragSource!]);
    setDragId(null); setDragOver(null);
    setResult(null);
  }

  function removeFromOutfit(id: string) {
    setOutfit(prev => prev.filter(g => g.id !== id));
    setDragId(null); setDragOver(null);
    setResult(null);
  }

  // Mobile tap-to-add — same validity rule desktop's drag-and-drop uses (canAddToOutfit),
  // just triggered by a tap instead of a drop. Native HTML drag-and-drop doesn't work
  // reliably on touch devices, so mobile needs its own add path rather than reusing drag state.
  function mobileAddItem(g: Garment) {
    if (!canAddToOutfit(outfit, g)) return;
    setOutfit(prev => [...prev, g]);
    setResult(null);
    setPickerBucket(null);
  }

  async function handleScore() {
    if (!canScore || scoring) return;
    setScoring(true);
    setResult(null);
    setProsState("hidden");
    setConsState("hidden");
    try {
      const res = await fetch("/api/scoring/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmentIds: outfit.map(g => g.id) }),
      });
      if (!res.ok) {
        setResult({ score: 0, valid: false, reason: null, pros: [], cons: [], serverError: true });
        return;
      }
      const data = await res.json() as { score: number | null; valid: boolean; reason: string | null; locked?: boolean };
      if (data.locked) {
        setResult({ score: 0, valid: false, reason: null, pros: [], cons: [], locked: true });
        return;
      }
      const pros = [...new Set(outfit.flatMap(g => parseProp(g.pros)))].slice(0, 4);
      const cons = [...new Set(outfit.flatMap(g => parseProp(g.cons)))].slice(0, 4);
      setResult({ score: data.score ?? 0, valid: data.valid, reason: data.reason, pros, cons });
    } catch {
      setResult({ score: 0, valid: false, reason: null, pros: [], cons: [], serverError: true });
    }
    finally { setScoring(false); }
  }

  // ── Slot categorization ───────────────────────────────────────────────────

  const heads: Garment[] = [], outers: Garment[] = [], mids: Garment[] = [];
  const tops:  Garment[] = [], bots:  Garment[]  = [], shoes: Garment[] = [];
  const accs:  Garment[] = [];

  for (const g of outfit) {
    if (g.category === "footwear")  { shoes.push(g);  continue; }
    if (g.category === "bottom")    { bots.push(g);   continue; }
    if (g.category === "outerwear") { outers.push(g); continue; }
    // sub_type-based hat detection runs BEFORE the category === "accessory" fallback below —
    // hats commonly get category "accessory" from the AI tagger (a reasonable classification on
    // its own), which used to make them get grabbed by that check first and land in the generic
    // ACCESSORIES slot instead of ever reaching this hat check, so the dedicated Hat slot could
    // never actually hold one.
    const sub = (g.sub_type ?? "").toLowerCase();
    if (sub.includes("hat") || sub.includes("cap") || sub.includes("beanie") ||
        (sub.includes("bucket") && !sub.includes("bag")) || sub.includes("beret") || sub.includes("snapback")) {
      heads.push(g); continue;
    }
    if (g.category === "accessory") { accs.push(g); continue; }
    if (sub.includes("hoodie") || sub.includes("sweatshirt") || sub.includes("zip-up") ||
        sub.includes("zip up") || sub.includes("sweater") || sub.includes("pullover") ||
        sub.includes("crewneck") || sub.includes("fleece") || sub.includes("cardigan")) {
      mids.push(g); continue;
    }
    tops.push(g);
  }

  tops.sort((a, b) => (isOuterCapableTop(a) ? 1 : 0) - (isOuterCapableTop(b) ? 1 : 0));

  const leftG  = outers[0];
  const rightG = mids[0] ?? outers[1];

  const col1G = (tops[1] && leftG)  ? leftG  : undefined;
  const col2G = tops[1]             ? tops[1] : leftG;
  const col4G = tops[2]             ? tops[2] : rightG;
  const col5G = (tops[2] && rightG) ? rightG  : undefined;

  const hasBothExtraTops = !!tops[1] && !!tops[2];
  const leftTopRole  = hasBothExtraTops ? "Outer Layer 1" : "Outer Layer";
  const rightTopRole = hasBothExtraTops ? "Outer Layer 2" : "Outer Layer";
  const col2Role = tops[1] ? leftTopRole  : leftG  ? "Outer Layer" : "Top Layer";
  const col4Role = tops[2] ? rightTopRole : rightG ? "Mid Layer"   : "Top Layer";

  const accSlots: (Garment | undefined)[] = [
    ...accs, ...Array(Math.max(0, MIN_ACC - accs.length)).fill(undefined),
  ];

  const canScore = tops.length > 0 && bots.length > 0 && shoes.length > 0;

  // ── Slot render helpers ───────────────────────────────────────────────────

  const BOX: CSSProperties = {
    width: B, height: B, flexShrink: 0,
    background: "#f3f3f3", border: "1px solid #d8d8d8",
    position: "relative",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "default", overflow: "visible",
  };

  const TIP_WRAP: CSSProperties = {
    display: "none", position: "absolute",
    bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
    background: "#1a1a1a", color: "#e8e8e8",
    fontSize: 9, padding: "9px 11px", pointerEvents: "none", zIndex: 30,
    letterSpacing: "0.04em", lineHeight: "1.6", ...FONT,
  };

  type TipDir = "above" | "right" | "left";
  function tipPos(dir: TipDir): CSSProperties {
    if (dir === "right") return { bottom: "auto", left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
    if (dir === "left")  return { bottom: "auto", left: "auto", right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
    return {};
  }

  function Tip({ g, role, extra, tipDir = "above" }: { g: Garment; role: string; extra?: string; tipDir?: TipDir }) {
    const nm    = [g.brand, g.title].filter(Boolean).join(" ");
    const pros  = parseProp(g.pros).slice(0, 2);
    const con   = parseProp(g.cons).slice(0, 1);
    const pairs = parseProp(g.color_pairings).slice(0, 2);
    return (
      <div data-tip="" style={{ ...TIP_WRAP, width: 186, ...tipPos(tipDir) }}>
        <div style={{ color: "#777", fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
          {role}{extra ? ` · ${extra}` : ""}
        </div>
        <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 3, lineHeight: 1.3 }}>{nm}</div>
        {g.color_primary && <div style={{ color: "#bbb", fontSize: 8, marginBottom: 2 }}>{g.color_primary}</div>}
        {pros.map((p, i) => <div key={`p${i}`} style={{ color: "#7dbc7d", fontSize: 8 }}>{p}</div>)}
        {con.map((c, i)  => <div key={`n${i}`} style={{ color: "#bc7d7d", fontSize: 8 }}>{c}</div>)}
        {pairs.length > 0 && <div style={{ color: "#bbb", fontSize: 8, marginTop: 3 }}>Pairs w/ {pairs.join(", ")}</div>}
      </div>
    );
  }

  function EmptyTip({ role, tipDir = "above" }: { role: string; tipDir?: TipDir }) {
    return (
      <div data-tip="" style={{ ...TIP_WRAP, width: 130, ...tipPos(tipDir) }}>
        <div style={{ color: "#e04040", fontWeight: 700, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>EMPTY</div>
        <div style={{ color: "#888", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>{role}</div>
      </div>
    );
  }

  const onIn  = (e: React.MouseEvent<HTMLDivElement>) =>
    (e.currentTarget.querySelector<HTMLElement>("[data-tip]"))?.style.setProperty("display", "block");
  const onOut = (e: React.MouseEvent<HTMLDivElement>) =>
    (e.currentTarget.querySelector<HTMLElement>("[data-tip]"))?.style.setProperty("display", "none");

  function S(g: Garment | undefined, role: string, col: number, row: number, extra?: string, tipDir: TipDir = "above") {
    const emptyId    = `__empty_${col}_${row}`;
    const isOver     = !dragFromOutfit && !!g && dragOver === g.id;
    const canDrop    = isOver && !!dragSource && canAddToOutfit(outfit.filter(x => x.id !== g!.id), dragSource);
    const isEmpOver  = !dragFromOutfit && !g && dragOver === emptyId;
    const empCanDrop = isEmpOver && !!dragSource && canAddToOutfit(outfit, dragSource);

    return (
      <div
        // The first-run tutorial points at the pants slot (the middle of the outfit).
        data-tutorial={role === "Pants" ? "builder.piece" : undefined}
        style={{
          ...BOX, gridColumn: col, gridRow: row,
          cursor: g ? "grab" : "default",
          ...(g ? {
            border: isOver ? `2px solid ${canDrop ? "#2e7d32" : "#c00"}` : "1px solid #d8d8d8",
            background: isOver ? (canDrop ? "#f0fff4" : "#fff5f5") : "#f3f3f3",
            transition: "border-color 0.1s, background 0.1s",
          } : {
            border: isEmpOver ? `2px dashed ${empCanDrop ? "#2e7d32" : "#c00"}` : "1px dashed #bbb",
            background: isEmpOver ? (empCanDrop ? "#f0fff4" : "#fff5f5") : "transparent",
            transition: "border-color 0.1s, background 0.1s",
          }),
        }}
        draggable={!!g}
        onDragStart={g ? () => setDragId(g.id) : undefined}
        onDragEnd={() => { setDragId(null); setDragOver(null); }}
        onMouseEnter={onIn} onMouseLeave={onOut}
        onDragOver={!dragFromOutfit ? (e => {
          if (g && dragSource && canAddToOutfit(outfit.filter(x => x.id !== g.id), dragSource)) {
            e.preventDefault(); setDragOver(g.id);
          } else if (!g && dragSource && canAddToOutfit(outfit, dragSource)) {
            e.preventDefault(); setDragOver(emptyId);
          }
        }) : undefined}
        onDragLeave={() => setDragOver(null)}
        onDrop={() => {
          if (dragFromOutfit) { setDragId(null); setDragOver(null); return; }
          if (g) dropOnSlot(g.id);
          else   dropOnEmpty();
        }}
      >
        {!g && (
          <span style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
            color: "#d8d8d8", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 0, ...FONT,
          }}>
            {role}
          </span>
        )}
        {g?.image && <img src={g.image} alt="" draggable={false} style={{ width: B - 10, height: B - 10, objectFit: "contain", position: "relative", zIndex: 1 }} />}
        {g ? <Tip g={g} role={role} extra={extra} tipDir={tipDir} /> : <EmptyTip role={role} tipDir={tipDir} />}
      </div>
    );
  }

  // ── Inventory tooltip (fixed position) ───────────────────────────────────

  function InvTip({ g }: { g: Garment }) {
    const nm  = [g.brand, g.title].filter(Boolean).join(" ");
    const pro = parseProp(g.pros).slice(0, 2);
    const con = parseProp(g.cons).slice(0, 1);
    const s: CSSProperties = {
      display: "none", position: "fixed", top: 0, left: 0,
      transform: "translate(-50%, calc(-100% - 6px))",
      background: "#1a1a1a", color: "#e8e8e8", fontSize: 9,
      padding: "9px 11px", pointerEvents: "none", zIndex: 9000,
      letterSpacing: "0.04em", lineHeight: 1.6, width: 174, ...FONT,
    };
    return (
      <div data-tip="" style={s}>
        <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 3, lineHeight: 1.3 }}>{nm}</div>
        {g.color_primary && <div style={{ color: "#bbb", fontSize: 8, marginBottom: 2 }}>{g.color_primary}</div>}
        {g.sub_type && <div style={{ color: "#888", fontSize: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{g.sub_type}</div>}
        {pro.map((p, i) => <div key={`p${i}`} style={{ color: "#7dbc7d", fontSize: 8 }}>{p}</div>)}
        {con.map((c, i) => <div key={`n${i}`} style={{ color: "#bc7d7d", fontSize: 8 }}>{c}</div>)}
      </div>
    );
  }

  const INV_TIP_HALF_W = 87; // half of InvTip's fixed 174px width
  const invTipIn  = (e: React.MouseEvent<HTMLDivElement>) => {
    const tip  = e.currentTarget.querySelector<HTMLElement>("[data-tip]");
    if (!tip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // The tooltip is horizontally centered on whatever `left` is set to (translateX(-50%)), so
    // centering it on items near either edge of the inventory grid ran it off the viewport and
    // clipped it. Clamping keeps the tooltip fully on-screen; it just stops tracking dead-center
    // over items that are within half the tooltip's width of an edge.
    const center = rect.left + rect.width / 2;
    const clamped = Math.min(Math.max(center, INV_TIP_HALF_W), window.innerWidth - INV_TIP_HALF_W);
    tip.style.left    = `${clamped}px`;
    tip.style.top     = `${rect.top}px`;
    tip.style.display = "block";
  };
  const invTipOut = (e: React.MouseEvent<HTMLDivElement>) =>
    e.currentTarget.querySelector<HTMLElement>("[data-tip]")?.style.setProperty("display", "none");

  const totalBoxes = Math.max(Math.ceil(allGarments.length / 5) * 5, editAvail.length);
  const emptyCount = totalBoxes - editAvail.length;
  const invOver    = dragOver === "__inventory";

  const scoreColor = !result ? "#111"
    : result.score >= 75 ? "#1d9e52"
    : result.score >= 50 ? "#c88800"
    : "#c83030";

  const isEligible = result?.valid && result.score >= IDEAL_THRESHOLD;

  // ── Loading screen ────────────────────────────────────────────────────────

  // Wrapped in ReadyGate (components/ReadyGate.tsx): three dots until the page is fully drawn.
  if (loading) return <ReadyGate ready={false} />;

  // ── Mobile page ──────────────────────────────────────────────────────────
  // The desktop grid is a fixed 5×142px layout (710px+ wide) with native HTML5 drag-and-drop,
  // neither of which works on a phone — the grid can't fit and touch browsers largely ignore
  // the drag-and-drop API. Rather than shrink the same grid into something unreadable, mobile
  // restructures around the same underlying slots as a vertical list of category rows (tap a
  // filled item to remove it, tap + to open a full-screen picker), grouped by the same
  // bucketOf() categories the desktop grid visually encodes through column position.

  if (isMobile) {
    const pickerItems = pickerBucket ? editAvail.filter(g => bucketOf(g) === pickerBucket) : [];
    const smallBtn: CSSProperties = {
      background: "none", border: "none", padding: 0, cursor: "pointer",
      fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", ...FONT,
    };

    return (
      <ReadyGate ready>
      <main style={{ minHeight: "100dvh", background: "#fff", ...FONT, display: "flex", flexDirection: "column" }}>
        <style suppressHydrationWarning>{WAVE_CSS}</style>

        <div style={{ flex: 1, minHeight: 0 }} />

        <div style={{ padding: "0 20px 4px", textAlign: "center", flexShrink: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", color: "#111", margin: 0 }}>BUILD OUTFIT</p>
        </div>

        {/* Score result */}
        {result && (
          <div style={{ padding: "12px 20px 0", flexShrink: 0 }}>
            {isEligible ? (
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.02em", color: scoreColor }}>
                  {result.score} / 100
                </span>
                <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8 }}>
                  <button onClick={togglePros} style={{ ...smallBtn, color: prosState === "visible" ? "#1d9e52" : "#aaa" }}>
                    {prosState === "visible" ? "HIDE PROS" : "SHOW PROS"}
                  </button>
                  <button onClick={toggleCons} style={{ ...smallBtn, color: consState === "visible" ? "#c83030" : "#aaa" }}>
                    {consState === "visible" ? "HIDE CONS" : "SHOW CONS"}
                  </button>
                  <button
                    onClick={() => { setResult(null); setProsState("hidden"); setConsState("hidden"); }}
                    style={{ ...smallBtn, color: "#c83030" }}
                  >
                    CLEAR
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: "10px 16px", background: "#fff5f5", border: "1px solid #fca5a5", textAlign: "center" }}>
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#c00", margin: "0 0 4px", ...FONT }}>
                  {result.locked ? "AI SCORING LOCKED" : result.serverError ? "SOMETHING WENT WRONG" : "ACCESS DENIED"}
                </p>
                <p style={{ fontSize: 11, color: "#888", lineHeight: 1.6, margin: 0, ...FONT }}>
                  {result.locked
                    ? "Scoring outfits is a Pro feature. Upgrade in the MyCloset app."
                    : result.serverError
                    ? "Couldn't score that outfit — try again."
                    : !result.valid
                    ? `This outfit combination is not valid: ${result.reason ?? "missing required pieces"}.`
                    : "This outfit scored below the ideal threshold — try a different combination."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Slot rows — one per category, filled items as tap-to-remove chips + a tap-to-add tile.
            flex: 0 1 auto so a short outfit doesn't get stretched to fill the whole screen —
            it sizes to its content and the spacers above/below share the rest, keeping the
            page centered instead of pinned to the top with slack dumped below. */}
        <div style={{ flex: "0 1 auto", overflowY: "auto", padding: "16px 20px calc(24px + 48px + 60px + var(--safe-bottom))" }}>
          {BUCKET_ORDER.map(bucket => {
            const items = outfit.filter(g => bucketOf(g) === bucket);
            return (
              <div key={bucket} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#999", margin: "0 0 8px", ...FONT }}>
                  {BUCKET_LABEL[bucket]}
                </p>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
                  {items.map(g => (
                    <div
                      key={g.id}
                      onClick={() => removeFromOutfit(g.id)}
                      style={{
                        width: 84, height: 84, flexShrink: 0, position: "relative",
                        background: "#f3f3f3", border: "1px solid #d8d8d8",
                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                      }}
                    >
                      {g.image
                        ? <img src={g.image} alt="" draggable={false} style={{ width: 68, height: 68, objectFit: "contain" }} />
                        : <span style={{ fontSize: 8, color: "#999", textAlign: "center", padding: 4, ...FONT }}>{g.title}</span>}
                      <span style={{
                        position: "absolute", top: 3, right: 4, fontSize: 11, color: "#c83030",
                        fontWeight: 700, lineHeight: 1,
                      }}>
                        ✕
                      </span>
                    </div>
                  ))}
                  <button
                    onClick={() => setPickerBucket(bucket)}
                    style={{
                      width: 84, height: 84, flexShrink: 0, border: "1px dashed #bbb", background: "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 22, color: "#bbb", cursor: "pointer", ...FONT,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0 }} />

        {/* Bottom action bar — fixed above the tab bar */}
        <div style={{
          position: "fixed", bottom: "calc(60px + var(--safe-bottom))", left: 0, right: 0,
          background: "#fff", borderTop: "1px solid #ebebeb",
          padding: "14px 20px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 28,
          zIndex: 100,
        }}>
{hasAI && (
          <button
            onClick={handleScore}
            disabled={!canScore || scoring}
            style={{
              background: "none", border: "none", padding: 0, cursor: !canScore ? "default" : "pointer",
              fontSize: 12, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
              color: !canScore ? "#ccc" : "#111", ...FONT,
            }}
          >
            {scoring ? "SCORING…" : "SCORE"}
          </button>
          )}
          {outfit.length > 0 && !result && (
            <button
              onClick={() => { setOutfit([]); setProsState("hidden"); setConsState("hidden"); }}
              style={{ ...smallBtn, color: "#c83030" }}
            >
              CLEAR ALL
            </button>
          )}
        </div>

        {/* Picker — full-screen so there's room to actually see items, unlike a narrow sheet */}
        {pickerBucket && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "#fff", display: "flex", flexDirection: "column" }}>
            {/* On mobile: on the nav icons' center line, with CLOSE kept clear of them (the
               nav floats above this picker in the top-right corner). See globals.css .nav-row*. */}
            <div className="nav-row-host" style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "calc(18px + var(--safe-top)) 20px 16px", borderBottom: "1px solid #ebebeb", flexShrink: 0,
            }}>
              <div className="nav-row nav-row-clear-right" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#111", margin: 0, ...FONT }}>
                ADD {BUCKET_LABEL[pickerBucket].toUpperCase()}
              </p>
              <button onClick={() => setPickerBucket(null)} style={{ ...smallBtn, color: "#999", fontSize: 10 }}>
                CLOSE
              </button>
              </div>
            </div>
            <div style={{
              flex: 1, overflowY: "auto", padding: 16,
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, alignContent: "start",
            }}>
              {pickerItems.length === 0 && (
                <p style={{ gridColumn: "1 / -1", textAlign: "center", color: "#bbb", fontSize: 11, letterSpacing: "0.04em", padding: "60px 0", ...FONT }}>
                  No {BUCKET_LABEL[pickerBucket].toLowerCase()} items in your wardrobe.
                </p>
              )}
              {pickerItems.map(g => {
                const valid = canAddToOutfit(outfit, g);
                return (
                  <button
                    key={g.id}
                    onClick={() => valid && mobileAddItem(g)}
                    disabled={!valid}
                    style={{
                      aspectRatio: "1 / 1", background: "#f3f3f3", border: "1px solid #d8d8d8",
                      opacity: valid ? 1 : 0.35, display: "flex", alignItems: "center", justifyContent: "center",
                      padding: 6, cursor: valid ? "pointer" : "default",
                    }}
                  >
                    {g.image
                      ? <img src={g.image} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : <span style={{ fontSize: 9, color: "#999", textAlign: "center", ...FONT }}>{g.title}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Pros / cons — full-width bottom sheets rather than desktop's edge-sliver panels */}
        {(prosState !== "hidden" || consState !== "hidden") && result && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.25)" }}
            onClick={() => { if (prosState === "visible") togglePros(); if (consState === "visible") toggleCons(); }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: "absolute", left: 0, right: 0, bottom: 0,
                background: "#fff", padding: "24px 24px calc(28px + var(--safe-bottom))",
                maxHeight: "60vh", overflowY: "auto", textAlign: "center", ...FONT,
              }}
            >
              {prosState !== "hidden" && (
                <>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#1d9e52", textTransform: "uppercase", marginBottom: 16 }}>PROS</p>
                  {result.pros.length > 0
                    ? result.pros.map((p, i) => <p key={i} style={{ fontSize: 12, color: "#333", lineHeight: 1.65, margin: "0 0 10px" }}>{p}</p>)
                    : <p style={{ fontSize: 12, color: "#ccc" }}>None</p>}
                </>
              )}
              {consState !== "hidden" && (
                <>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#c83030", textTransform: "uppercase", marginBottom: 16 }}>CONS</p>
                  {result.cons.length > 0
                    ? result.cons.map((c, i) => <p key={i} style={{ fontSize: 12, color: "#333", lineHeight: 1.65, margin: "0 0 10px" }}>{c}</p>)
                    : <p style={{ fontSize: 12, color: "#ccc" }}>None</p>}
                </>
              )}
            </div>
          </div>
        )}
      </main>
      </ReadyGate>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────

  return (
    <ReadyGate ready>
    <main style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#fff", ...FONT, position: "relative" }}>
      <style suppressHydrationWarning>{WAVE_CSS}</style>

      {/* ── Left: score button + slot grid ── */}
      <div style={{
        flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center",
        padding: "10px 24px 0",
        overflowY: "auto", overflowX: "auto", scrollbarWidth: "none",
      }}>

        {/* Score button row — SCORE + CLEAR grouped, midpoint centered above hat col */}
        <div style={{
          width: 5 * B + 4 * G,
          position: "relative", height: 28,
          marginBottom: 6,
        }}>
{hasAI && (
          <button
            onClick={handleScore}
            disabled={!canScore || scoring}
            style={{
              position: "absolute", left: "50%", transform: "translateX(-50%)",
              background: "none", border: "none", padding: 0,
              cursor: !canScore ? "default" : "pointer",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
              color: !canScore ? "#ccc" : "#111", ...FONT,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => { if (canScore) e.currentTarget.style.color = "#555"; }}
            onMouseLeave={e => { e.currentTarget.style.color = !canScore ? "#ccc" : "#111"; }}
          >
            {scoring ? "SCORING…" : "SCORE"}
          </button>
          )}

          {/* CLEAR outfit — only visible when pieces are equipped and no analysis is showing */}
          {outfit.length > 0 && !result && (
            <button
              onClick={() => { setOutfit([]); setProsState("hidden"); setConsState("hidden"); }}
              style={{
                // top: 15.5 — level with HIDE INVENTORY across the divider (its row starts 24px
                // down; this column's padding is 10px).
                position: "absolute", right: 0, top: 15.5, lineHeight: "12px",
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "#c83030", ...FONT,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#ff4444"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#c83030"; }}
            >
              CLEAR
            </button>
          )}

        </div>

        {/* Score result */}
        {result && (
          <div style={{
            width: isEligible ? 5 * B + 4 * G : "fit-content",
            marginBottom: 16,
          }}>
            {isEligible ? (
              <div style={{ position: "relative", display: "flex", alignItems: "center", height: 36 }}>
                {/* Show Pros — left */}
                <button
                  onClick={togglePros}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                    color: prosState === "visible" ? "#1d9e52" : "#aaa", ...FONT,
                    transition: "color 0.15s", flexShrink: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#1d9e52"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = prosState === "visible" ? "#1d9e52" : "#aaa"; }}
                >
                  {prosState === "visible" ? "HIDE PROS" : "SHOW PROS"}
                </button>

                {/* Score — absolutely centered so it always sits above hat col regardless of button widths */}
                <span style={{
                  position: "absolute", left: "50%", transform: "translateX(-50%)",
                  fontSize: 24, fontWeight: 700, letterSpacing: "0.04em",
                  color: scoreColor, whiteSpace: "nowrap", pointerEvents: "none",
                }}>
                  {result.score} / 100
                </span>

                {/* Show Cons + Clear — right */}
                <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
                  <button
                    onClick={toggleCons}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                      color: consState === "visible" ? "#c83030" : "#aaa", ...FONT,
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#c83030"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = consState === "visible" ? "#c83030" : "#aaa"; }}
                  >
                    {consState === "visible" ? "HIDE CONS" : "SHOW CONS"}
                  </button>
                  <button
                    onClick={() => { setResult(null); setProsState("hidden"); setConsState("hidden"); }}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                      color: "#c83030", ...FONT,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#ff4444"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "#c83030"; }}
                  >
                    CLEAR
                  </button>
                </div>
              </div>
            ) : (
              <div style={{
                padding: "10px 16px",
                background: "#fff5f5",
                border: "1px solid #fca5a5",
                textAlign: "center",
                opacity: errorFading ? 0 : 1,
                transition: "opacity 0.7s ease",
              }}>
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: "#c00", margin: "0 0 4px" }}>
                  {result.locked ? "AI SCORING LOCKED" : result.serverError ? "SOMETHING WENT WRONG" : "ACCESS DENIED"}
                </p>
                <p style={{ fontSize: 11, color: "#888", lineHeight: 1.6, margin: 0, whiteSpace: "nowrap" }}>
                  {result.locked
                    ? "Scoring outfits is a Pro feature. Upgrade in the MyCloset app."
                    : result.serverError
                    ? "Couldn't score that outfit — try again."
                    : !result.valid
                    ? `This outfit combination is not valid: ${result.reason ?? "missing required pieces"}.`
                    : "This outfit scored below the ideal threshold — try a different combination."
                  }
                </p>
              </div>
            )}
          </div>
        )}

        {/* Main slot grid */}
        <div data-tutorial="builder.slots" style={{ marginBottom: 8 }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(5, ${B}px)`,
            gridAutoRows: `${B}px`,
            gap: G,
            justifyContent: "center",
          }}>
            {S(heads[0], "Hat",                                3, 1, undefined, "right")}
            {/* col1 (leftmost) and col5 (rightmost) get an explicit direction — left to their
               default "above" (horizontally centered on the box) runs the fixed-width tooltip
               off the edge of the viewport on whichever side has little to no room, clipping it. */}
            {/* col1/col5 only render at all once a second layering top (tops[1]/tops[2]) exists
               to push leftG/rightG out there — col1G/col5G are only ever populated in that same
               case (see their definitions above). Without this guard, the common case of a
               single outer layer + a base top rendered col1 as an EMPTY "Outer Layer" placeholder
               sitting right beside col2, which was already showing that same real, filled "Outer
               Layer" item — two boxes with the same label, one real and one a confusing dupe. */}
            {tops[1] && S(col1G, "Outer Layer", 1, 2, undefined, "right")}
            {S(col2G,    col2Role,                             2, 2)}
            {S(tops[0],  tops[0] ? "Base Layer" : "Top Layer", 3, 2)}
            {S(col4G,    col4Role,                             4, 2)}
            {tops[2] && S(col5G, "Mid Layer", 5, 2, undefined, "left")}
            {S(bots[0],  "Pants",                              3, 3, undefined, "left")}
            {S(shoes[0], "Shoes",                              3, 4, undefined, "right")}
          </div>

          {/* Accessory boxes */}
          <div style={{
            display: "grid", gridTemplateColumns: `repeat(5, ${B}px)`,
            gap: G, justifyContent: "center",
          }}>
            {accSlots.map((g, i) => {
              const isAccOver  = !dragFromOutfit && dragOver === `__acc_${i}`;
              const accCanDrop = isAccOver && !!dragSource && canAddToOutfit(outfit, dragSource);
              return (
                <div key={i}
                  style={{
                    ...BOX,
                    cursor: g ? "grab" : "default",
                    ...(g ? {} : {
                      border: isAccOver ? `2px dashed ${accCanDrop ? "#2e7d32" : "#c00"}` : "1px dashed #bbb",
                      background: isAccOver ? (accCanDrop ? "#f0fff4" : "#fff5f5") : "transparent",
                      transition: "border-color 0.1s, background 0.1s",
                    }),
                  }}
                  draggable={!!g}
                  onDragStart={g ? () => setDragId(g.id) : undefined}
                  onDragEnd={() => { setDragId(null); setDragOver(null); }}
                  onMouseEnter={onIn} onMouseLeave={onOut}
                  onDragOver={!dragFromOutfit && dragSource ? (e => {
                    if (canAddToOutfit(outfit, dragSource)) {
                      e.preventDefault(); setDragOver(`__acc_${i}`);
                    }
                  }) : undefined}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={() => {
                    if (dragFromOutfit) { setDragId(null); setDragOver(null); return; }
                    dropOnEmpty();
                  }}
                >
                  {!g && (
                    <span style={{
                      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
                      color: "#d8d8d8", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 0, ...FONT,
                    }}>
                      Accessory
                    </span>
                  )}
                  {g?.image && <img src={g.image} alt="" draggable={false} style={{ width: B - 10, height: B - 10, objectFit: "contain", position: "relative", zIndex: 1 }} />}
                  {g ? <Tip g={g} role="Accessory" extra={accLabel(g)} /> : <EmptyTip role="Accessory" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Spacer — reserves layout space while fixed inventory panel slides in/out */}
      <div style={{ width: invVisible ? "50vw" : "0", flexShrink: 0, transition: "width 0.35s ease" }} />

      {/* ── Right: inventory — position:fixed so it slides as a unit from the right ── */}
      <div style={{
        position: "fixed", right: 0, top: 0, bottom: 0,
        width: "50vw",
        background: "#fff",
        borderLeft: "1px solid #ebebeb",
        display: "flex", flexDirection: "column",
        transform: invVisible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.35s ease",
        zIndex: 40,
      }}>

          {/* Category filter row — spacer balances HIDE INVENTORY so categories stay centered */}
          <div style={{
            display: "flex", alignItems: "center",
            padding: "24px 24px 14px", flexShrink: 0,
          }}>
            {/* invisible spacer — same font/text as HIDE INVENTORY to reserve exact width */}
            <span style={{
              visibility: "hidden", pointerEvents: "none",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
              whiteSpace: "nowrap", ...FONT,
            }}>HIDE INVENTORY</span>

            {/* centered categories */}
            <div style={{ flex: 1, display: "flex", gap: 18, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              {CATS.map(c => (
                <button key={c} onClick={() => setCat(c)} style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                  fontWeight: cat === c ? 700 : 400,
                  color: cat === c ? "#111" : "#bbb",
                  ...FONT,
                }}>
                  {c}
                </button>
              ))}
            </div>

            {/* HIDE INVENTORY — inline so it slides with the panel */}
            <button
              onClick={() => setInvVisible(false)}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "#b89500", whiteSpace: "nowrap", ...FONT,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#d4ad00"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#b89500"; }}
            >
              HIDE INVENTORY
            </button>
          </div>

          {/* Garment grid */}
          <div
            ref={invRef}
            style={{
              flex: 1, overflowY: "auto", scrollbarWidth: "none",
              padding: "10px 0 24px",
              display: "grid",
              gridTemplateColumns: `repeat(5, ${B}px)`,
              justifyContent: "center",
              gap: G,
              alignContent: "start",
            }}
            onDragOver={dragFromOutfit ? (e => { e.preventDefault(); setDragOver("__inventory"); }) : undefined}
            onDragLeave={dragFromOutfit ? (() => setDragOver(null)) : undefined}
            onDrop={dragFromOutfit && dragSource ? (() => removeFromOutfit(dragSource.id)) : undefined}
          >
            {loadError && editAvail.length === 0 && (
              <p style={{
                gridColumn: "1 / -1", textAlign: "center", fontSize: 11, color: "#c00",
                letterSpacing: "0.06em", padding: "40px 0", ...FONT,
              }}>
                Couldn't load your wardrobe — refresh to try again.
              </p>
            )}
            {editAvail.map(g => (
              <div
                key={g.id}
                draggable
                onDragStart={() => setDragId(g.id)}
                onDragEnd={() => { setDragId(null); setDragOver(null); }}
                onMouseEnter={invTipIn}
                onMouseLeave={invTipOut}
                style={{
                  width: B, height: B, flexShrink: 0,
                  border: `1px solid ${dragId === g.id ? "#999" : "#d8d8d8"}`,
                  background: "#f3f3f3", cursor: "grab",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative",
                  opacity: dragId === g.id ? 0.45 : 1,
                  transition: "opacity 0.1s",
                }}
              >
                {g.image && <img src={g.image} alt="" draggable={false} style={{ width: B - 10, height: B - 10, objectFit: "contain" }} />}
                <InvTip g={g} />
              </div>
            ))}
            {Array.from({ length: emptyCount }).map((_, i) => {
              const isTarget = dragFromOutfit && i < outfit.length;
              return (
                <div key={`inv-empty-${i}`} style={{
                  width: B, height: B,
                  background: isTarget && invOver ? "#f0fff4" : "transparent",
                  border: isTarget
                    ? invOver ? "2px dashed #2e7d32" : "1px dashed #aaa"
                    : "1px solid #e8e8e8",
                  transition: "all 0.1s",
                }} />
              );
            })}
          </div>
      </div>

      {/* ── Pros panel — slides in from left ── */}
      {prosState !== "hidden" && result && (
        <div style={{ position: "fixed", left: 0, top: "50%", transform: "translateY(-50%)", zIndex: 1100 }}>
          <div key={prosState} style={{
            width: "min(260px, 85vw)", background: "#fff",
            boxShadow: "4px 0 20px rgba(0,0,0,0.10)",
            overflowY: "auto", scrollbarWidth: "none" as const,
            maxHeight: "70vh", padding: "28px 22px",
            animation: prosState === "exiting"
              ? "slideOutToLeft 0.25s ease forwards"
              : "slideInFromLeft 0.25s ease forwards",
            textAlign: "center" as const,
            ...FONT,
          }}>
            <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#1d9e52", margin: "0 0 16px" }}>PROS</p>
            {result.pros.length > 0
              ? result.pros.map((p, i) => (
                <p key={i} style={{ fontSize: 11, color: "#555", lineHeight: 1.65, margin: "0 0 10px" }}>{p}</p>
              ))
              : <p style={{ fontSize: 11, color: "#ccc" }}>None</p>
            }
          </div>
        </div>
      )}

      {/* SHOW INVENTORY — fixed at the same spot HIDE INVENTORY occupies in the panel header */}
      {showInvBtn && (
        <button
          onClick={() => setInvVisible(true)}
          style={{
            position: "fixed", top: 24, right: 24, zIndex: 200,
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "#b89500", ...FONT,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#d4ad00"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#b89500"; }}
        >
          SHOW INVENTORY
        </button>
      )}

      {/* ── Cons panel ── */}
      {/* Outer wrapper is clipped to the outfit area so the divider acts as the screen edge */}
      {consState !== "hidden" && result && (
        <div style={{
          position: "fixed", left: 0, top: 0,
          width: invVisible ? "50vw" : "100vw",
          height: "100vh",
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: 1100,
          transition: "width 0.35s ease",
        }}>
          {/* Panel sits at the right edge of the wrapper; overflow:hidden clips its start position */}
          <div style={{
            position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
            pointerEvents: "auto",
          }}>
            <div key={consState} style={{
              width: "min(260px, 85vw)", background: "#fff",
              boxShadow: "-4px 0 20px rgba(0,0,0,0.10)",
              overflowY: "auto", scrollbarWidth: "none" as const,
              maxHeight: "70vh", padding: "28px 22px",
              animation: consState === "exiting"
                ? "slideOutToRight 0.25s ease forwards"
                : "slideInFromRight 0.25s ease forwards",
              textAlign: "center" as const,
              ...FONT,
            }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
                color: "#c83030", margin: "0 0 16px" }}>CONS</p>
              {result.cons.length > 0
                ? result.cons.map((c, i) => (
                  <p key={i} style={{ fontSize: 11, color: "#555", lineHeight: 1.65, margin: "0 0 10px" }}>{c}</p>
                ))
                : <p style={{ fontSize: 11, color: "#ccc" }}>None</p>
              }
            </div>
          </div>
        </div>
      )}
    </main>
    </ReadyGate>
  );
}
