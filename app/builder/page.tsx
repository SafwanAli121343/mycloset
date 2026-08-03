"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getSlot } from "@/lib/outfitRules";

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
};

type PanelState = "hidden" | "visible" | "exiting";

// ── Outfit helpers ────────────────────────────────────────────────────────────

const EXCLUSIVE_SLOTS = new Set([
  "base-top","overshirt","mid-layer","vest","outer",
  "pants","shorts","skirt","dress","jumpsuit","shoes","sandals",
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

// ── Builder page ──────────────────────────────────────────────────────────────

export default function BuilderPage() {
  const [allGarments, setAllGarments] = useState<Garment[]>([]);
  const [outfit,      setOutfit]      = useState<Garment[]>([]);
  const [loading,     setLoading]     = useState(true);
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

  const invRef      = useRef<HTMLDivElement>(null);
  const fadeTRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prosTRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const consTRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invBtnTRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch("/api/garments")
      .then(r => r.json())
      .then((data: Garment[]) => { setAllGarments(data); setLoading(false); })
      .catch(() => setLoading(false));
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

  async function handleScore() {
    if (!canScore || scoring) return;
    setScoring(true);
    setResult(null);
    setProsState("hidden");
    setConsState("hidden");
    try {
      const res  = await fetch("/api/scoring/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmentIds: outfit.map(g => g.id) }),
      });
      const data = await res.json() as { score: number; valid: boolean; reason: string | null };
      const pros = [...new Set(outfit.flatMap(g => parseProp(g.pros)))].slice(0, 4);
      const cons = [...new Set(outfit.flatMap(g => parseProp(g.cons)))].slice(0, 4);
      setResult({ score: data.score, valid: data.valid, reason: data.reason, pros, cons });
    } catch { /* silent */ }
    finally { setScoring(false); }
  }

  // ── Slot categorization ───────────────────────────────────────────────────

  const heads: Garment[] = [], outers: Garment[] = [], mids: Garment[] = [];
  const tops:  Garment[] = [], bots:  Garment[]  = [], shoes: Garment[] = [];
  const accs:  Garment[] = [];

  for (const g of outfit) {
    if (g.category === "footwear")  { shoes.push(g);  continue; }
    if (g.category === "bottom")    { bots.push(g);   continue; }
    if (g.category === "accessory") { accs.push(g);   continue; }
    if (g.category === "outerwear") { outers.push(g); continue; }
    const sub = (g.sub_type ?? "").toLowerCase();
    if (sub.includes("hat") || sub.includes("cap") || sub.includes("beanie") ||
        sub.includes("bucket") || sub.includes("beret") || sub.includes("snapback")) {
      heads.push(g); continue;
    }
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

  const invTipIn  = (e: React.MouseEvent<HTMLDivElement>) => {
    const tip  = e.currentTarget.querySelector<HTMLElement>("[data-tip]");
    if (!tip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    tip.style.left    = `${rect.left + rect.width / 2}px`;
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

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", ...FONT }}>
        <style suppressHydrationWarning>{WAVE_CSS}</style>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 160 }}>
          <img src="/loading-tee.png" alt="" draggable={false}
            style={{ width: 270, height: 340, objectFit: "contain", opacity: 0.88 }} />
          <div style={{ width: 190, height: 5, background: "#e8e8e8", overflow: "hidden", marginTop: -88 }}>
            <div style={{ height: "100%", background: "#111", animation: "loadbar 14s ease-out forwards" }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────

  return (
    <main style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#fff", ...FONT, position: "relative" }}>
      <style suppressHydrationWarning>{WAVE_CSS}</style>

      {/* ── Left: score button + slot grid ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        padding: "24px 24px",
        overflowY: "auto", scrollbarWidth: "none",
      }}>

        {/* Score button row — SCORE + CLEAR grouped, midpoint centered above hat col */}
        <div style={{
          width: 5 * B + 4 * G,
          position: "relative", height: 28,
          marginBottom: 20,
        }}>
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

          {/* CLEAR outfit — only visible when pieces are equipped and no analysis is showing */}
          {outfit.length > 0 && !result && (
            <button
              onClick={() => { setOutfit([]); setProsState("hidden"); setConsState("hidden"); }}
              style={{
                position: "absolute", right: 0, top: 0,
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
                  ACCESS DENIED
                </p>
                <p style={{ fontSize: 11, color: "#888", lineHeight: 1.6, margin: 0, whiteSpace: "nowrap" }}>
                  {!result.valid
                    ? `This outfit combination is not valid: ${result.reason ?? "missing required pieces"}.`
                    : "You do not have access to analyzing that given outfit."
                  }
                </p>
              </div>
            )}
          </div>
        )}

        {/* Main slot grid */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(5, ${B}px)`,
            gridAutoRows: `${B}px`,
            gap: G,
            justifyContent: "center",
          }}>
            {S(heads[0], "Hat",                                3, 1, undefined, "right")}
            {S(col1G,    "Outer Layer",                        1, 2)}
            {S(col2G,    col2Role,                             2, 2)}
            {S(tops[0],  tops[0] ? "Base Layer" : "Top Layer", 3, 2)}
            {S(col4G,    col4Role,                             4, 2)}
            {S(col5G,    "Mid Layer",                          5, 2)}
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
            width: "min(260px, 22vw)", background: "#fff",
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
              width: "min(260px, 22vw)", background: "#fff",
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
  );
}
