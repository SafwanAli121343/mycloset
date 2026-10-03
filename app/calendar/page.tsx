"use client";
import { ReadyGate } from "@/components/ReadyGate";
import { useTutorialDemo } from "@/lib/client/tutorialState";
import { sampleCloset, sampleOutfits, SAMPLE_IMAGES } from "@/lib/client/tutorialSamples";
import { LoadingDots } from "@/components/LoadingDots";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { getSlot } from "@/lib/outfitRules";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { getCurrentLocation } from "@/lib/native/geolocation";
import type { CSSProperties, ReactNode } from "react";

const FONT: CSSProperties = { fontFamily: "Arial, sans-serif" };

const MONTHS = [
  "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER",
];
const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const CATEGORIES = ["all","top","bottom","footwear","outerwear","accessory"];

type Garment = {
  id: string;
  title: string;
  brand: string | null;
  image: string | null;
  category: string;
  sub_type: string | null;
  color_primary: string | null;
  pros: string[] | null;
  cons: string[] | null;
  color_pairings: string[] | null;
};

type OutfitDay = {
  id: string;
  garments: Garment[];
  notes?: string | null;
  ai_garment_ids?: string[] | null;
  customized?: boolean;
};

type DayWeather = { tempF: number; label: string; condition: string };

function parseNotes(notes?: string | null): {
  aesthetic: string; note: string;
  configName: string; complexityTier: number; styleScore: number;
  pros: string[]; cons: string[]; outfit_tags: string[];
  analyzed: boolean;
} {
  const empty = { aesthetic: "", note: "", configName: "", complexityTier: 0, styleScore: 0, pros: [], cons: [], outfit_tags: [], analyzed: false };
  if (!notes) return empty;
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
    return {
      aesthetic:      typeof parsed.aesthetic      === "string" ? parsed.aesthetic      : "",
      note:           typeof parsed.note           === "string" ? parsed.note           : "",
      configName:     typeof parsed.configName     === "string" ? parsed.configName     : "",
      complexityTier: typeof parsed.complexityTier === "number" ? parsed.complexityTier : 0,
      styleScore:     typeof parsed.styleScore     === "number" ? parsed.styleScore     : 0,
      pros:           Array.isArray(parsed.pros)        ? (parsed.pros as string[])        : [],
      cons:           Array.isArray(parsed.cons)        ? (parsed.cons as string[])        : [],
      outfit_tags:    Array.isArray(parsed.outfit_tags) ? (parsed.outfit_tags as string[]) : [],
      analyzed:       "pros" in parsed || "cons" in parsed,
    };
  } catch { return empty; }
}
type OutfitMap = Record<string, OutfitDay>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateStr(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }
function addMonths(y: number, m: number, n: number) {
  const d = new Date(y, m - 1 + n, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// Removes trailing week rows made up only of the next month's days.
function trimEmptyWeeks<T extends { current: boolean }>(cells: T[]): T[] {
  let end = cells.length;
  while (end >= 7 && cells.slice(end - 7, end).every(c => !c.current)) end -= 7;
  return cells.slice(0, end);
}

function getCalendarCells(year: number, month: number) {
  const firstDow    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDays    = new Date(year, month - 1, 0).getDate();
  const cells: { day: number; current: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--)   cells.push({ day: prevDays - i, current: false });
  for (let d = 1; d <= daysInMonth; d++)     cells.push({ day: d,           current: true  });
  const rem = 42 - cells.length;
  for (let d = 1; d <= rem; d++)             cells.push({ day: d,           current: false });
  return cells;
}

function formatDetailDate(ds: string) {
  const [y, m, d] = ds.split("-").map(Number);
  const dow = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"][
    new Date(y, m - 1, d).getDay()
  ];
  return `${dow}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

// ── Shared button styles ──────────────────────────────────────────────────────

const BTN_PRIMARY: CSSProperties = {
  background: "#111", color: "#fff", border: "none",
  padding: "9px 22px", fontSize: 10, letterSpacing: "0.12em",
  textTransform: "uppercase", cursor: "pointer", ...FONT,
};

// ── Overlay ───────────────────────────────────────────────────────────────────

function Overlay({ children, onClose, showClose = true, innerStyle, gap, sidePanel }: { children: ReactNode; onClose: () => void; showClose?: boolean; innerStyle?: CSSProperties; gap?: number; sidePanel?: ReactNode }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: gap ?? 0,
      }}
    >
      <div style={{
        background: "#fff", position: "relative",
        padding: "36px 40px", maxWidth: "90vw", maxHeight: "90vh",
        overflowY: "auto", scrollbarWidth: "none",
        ...innerStyle,
      }}>
        {showClose && (
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: 14, right: 18,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 14, color: "#bbb", lineHeight: 1, ...FONT,
            }}
          >
            ✕
          </button>
        )}
        {children}
      </div>
      {sidePanel}
    </div>
  );
}

// ── Day Cell ──────────────────────────────────────────────────────────────────

function conditionShort(condition: string): string {
  if (condition === "snow")          return "Snow";
  if (condition === "rain")          return "Rain";
  if (condition === "cloudy")        return "Cloudy";
  if (condition === "partly cloudy") return "Partly";
  return "";
}

function DayCell({
  day, current, isToday, outfit, weather, onClick, skeletal,
}: {
  day: number; current: boolean; isToday: boolean;
  outfit?: OutfitDay; weather?: DayWeather; onClick: () => void;
  skeletal?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const broken      = outfit && outfit.garments.length === 0;
  const allGarments = outfit?.garments ?? [];
  const bouncingGs  = allGarments.filter(g => g.image);
  const hasBouncing = current && !skeletal && bouncingGs.length > 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRefs      = useRef<(HTMLImageElement | null)[]>([]);
  const ballsRef     = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const rafRef       = useRef(0);

  useEffect(() => {
    if (!hasBouncing) return;
    const SPEED = 55;
    const IW = 28, IH = 36;
    ballsRef.current = bouncingGs.map((_, i) => ({
      x: Math.random() * 20 + i * 8,
      y: Math.random() * 10,
      vx: SPEED * (i % 2 === 0 ? 1 : -1) * (0.85 + Math.random() * 0.3),
      vy: SPEED * (i % 3 === 0 ? 1 : -1) * (0.85 + Math.random() * 0.3),
    }));
    let lastT = 0;
    function tick(now: number) {
      if (!lastT) { lastT = now; rafRef.current = requestAnimationFrame(tick); return; }
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      const el = containerRef.current;
      if (!el) { rafRef.current = requestAnimationFrame(tick); return; }
      const W = Math.max(0, el.clientWidth  - IW);
      const H = Math.max(0, el.clientHeight - IH);
      ballsRef.current.forEach((b, i) => {
        b.x += b.vx * dt;  b.y += b.vy * dt;
        if (b.x < 0) { b.x = 0; b.vx =  Math.abs(b.vx); }
        if (b.x > W) { b.x = W; b.vx = -Math.abs(b.vx); }
        if (b.y < 0) { b.y = 0; b.vy =  Math.abs(b.vy); }
        if (b.y > H) { b.y = H; b.vy = -Math.abs(b.vy); }
        const img = imgRefs.current[i];
        if (img) img.style.transform = `translate(${b.x}px, ${b.y}px)`;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [hasBouncing, outfit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={current ? onClick : undefined}
      onMouseEnter={() => current && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: "1px solid #ebebeb", padding: "7px 9px",
        cursor: current ? "pointer" : "default",
        opacity: current ? 1 : 0.28,
        overflow: "hidden", display: "flex", flexDirection: "column",
        background: hovered ? "#fafafa" : "#fff",
        transition: "background 0.12s", boxSizing: "border-box",
      }}
    >
      {/* Top row: temp/condition left, day number right. The day number stays while loading (the
         layout holds); the temperature only appears with the outfit, never before or after it. */}
      {(
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          {current && weather && !skeletal ? (
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
              <span style={{ fontSize: 9, color: "#aaa", ...FONT }}>{weather.tempF}°F</span>
              {conditionShort(weather.condition) && (
                <span style={{ fontSize: 8, color: "#bbb", ...FONT }}>{conditionShort(weather.condition)}</span>
              )}
            </div>
          ) : <div />}
          <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? "#111" : "#ccc", ...FONT }}>
            {day}
          </span>
        </div>
      )}

      {/* The site's standard three dots in the stack area — while the month's outfits + weather
          load, or auto-generation is in flight. */}
      {skeletal && current && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingDots />
        </div>
      )}

      {hasBouncing && (
        <div ref={containerRef} data-tut-moving style={{ flex: 1, position: "relative", minHeight: 50, marginTop: 2, overflow: "hidden" }}>
          {bouncingGs.map((g, i) => (
            <img
              key={g.id}
              ref={el => { imgRefs.current[i] = el; }}
              src={g.image!} alt="" draggable={false}
              style={{ width: 28, height: 36, objectFit: "contain", position: "absolute", top: 0, left: 0, willChange: "transform" }}
            />
          ))}
        </div>
      )}

      {!skeletal && !hasBouncing && allGarments.length > 0 && !broken && (
        <div style={{ marginTop: 4, display: "flex", gap: 3, flexWrap: "wrap", overflow: "hidden" }}>
          {allGarments.map(g =>
            g.image
              ? <img key={g.id} src={g.image} alt="" draggable={false} style={{ width: 28, height: 36, objectFit: "contain" }} />
              : <div key={g.id} style={{ width: 28, height: 36, background: "#f0f0f0" }} />
          )}
        </div>
      )}

      {/* Broken outfit indicator — outfit in DB but garment references are stale */}
      {!skeletal && broken && (
        <span style={{ fontSize: 8, color: "#e08000", marginTop: 4, letterSpacing: "0.05em", ...FONT }}>↺ stale</span>
      )}

      {!skeletal && outfit?.ai_garment_ids && !broken && (
        <div style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "#bbb",
          marginTop: "auto", alignSelf: "flex-start",
        }} />
      )}
    </div>
  );
}

// A 7-column grid full of 28x36 garment thumbnails per cell (DayCell above) simply has
// nowhere to put those thumbnails at phone width — each cell would be ~45-50px wide, smaller
// than one thumbnail. Rather than shrink everything into unreadable mush, the mobile grid
// drops the thumbnails and shows only what actually fits meaningfully at that size: the date,
// today's ring, and a status dot (has an outfit / needs attention / empty) — full outfit
// imagery lives one tap away in the day-detail view, which has the room to show it properly.
function MobileDayCell({
  day, current, isToday, outfit, onClick, skeletal,
}: {
  day: number; current: boolean; isToday: boolean;
  outfit?: OutfitDay; onClick: () => void; skeletal?: boolean;
}) {
  const broken = outfit && outfit.garments.length === 0;
  const hasOutfit = !!outfit && !broken;
  return (
    <div
      onClick={current ? onClick : undefined}
      style={{
        aspectRatio: "1 / 1",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4, cursor: current ? "pointer" : "default", opacity: current ? 1 : 0.25,
        background: "#fff", position: "relative",
      }}
    >
      <span style={{
        fontSize: 13, fontWeight: isToday ? 700 : 400, color: isToday ? "#fff" : "#333",
        ...FONT,
        ...(isToday ? {
          background: "#111", borderRadius: "50%", width: 24, height: 24,
          display: "flex", alignItems: "center", justifyContent: "center",
        } : {}),
      }}>
        {day}
      </span>
      {!skeletal && current && (
        <div style={{
          width: 5, height: 5, borderRadius: "50%",
          background: broken ? "#e08000" : hasOutfit ? "#1d9e52" : "transparent",
        }} />
      )}
      {skeletal && current && (
        <div style={{
          width: 5, height: 5, borderRadius: "50%", background: "#d0d0d0",
          animation: "waveDot 0.9s ease-in-out infinite",
        }} />
      )}
    </div>
  );
}

// ── Day Detail Modal ──────────────────────────────────────────────────────────

function DayDetailModal({
  dateStr, outfit, weather, onClose, onPrev, onNext, allGarments, onSaveEdit,
}: {
  dateStr: string; outfit: OutfitDay; weather?: DayWeather;
  onClose: () => void;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  allGarments: Garment[];
  onSaveEdit: (ids: string[]) => Promise<void>;
}) {
  type PanelState = "hidden" | "visible" | "exiting";
  const [prosState,      setProsState]      = useState<PanelState>("hidden");
  const [consState,      setConsState]      = useState<PanelState>("hidden");
  const [editMode,       setEditMode]       = useState(false);
  const [editExiting,    setEditExiting]    = useState(false);
  const [editGarments,   setEditGarments]   = useState<Garment[]>(outfit.garments);
  const [dragId,         setDragId]         = useState<string | null>(null);
  const [dragOverSlot,   setDragOverSlot]   = useState<string | null>(null);
  const [editSaving,     setEditSaving]     = useState(false);
  const [editSaveDone,   setEditSaveDone]   = useState(false);
  const prosTimerRef       = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const consTimerRef       = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveExitTimerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelRequestedRef = useRef(false);
  // Always points to the latest outfit prop so closures inside timers get fresh data
  const outfitRef = useRef(outfit);
  outfitRef.current = outfit;
  // Tracks whether the entry animation has already played — prevents re-renders caused
  // by setOutfits() in the parent from restarting the slideCardToLeft animation mid-edit
  const editEnteredRef = useRef(false);
  useEffect(() => {
    if (!editMode) { editEnteredRef.current = false; return; }
    const t = setTimeout(() => { editEnteredRef.current = true; }, 310);
    return () => clearTimeout(t);
  }, [editMode]);
  const { aesthetic, styleScore, pros, cons, analyzed } = parseNotes(outfit.notes);

  const editIds       = new Set(editGarments.map(g => g.id));
  const dragSource    = allGarments.find(g => g.id === dragId) ?? null;
  const dragFromOutfit = !!dragSource && editIds.has(dragSource.id);
  const editAvail     = allGarments.filter(g => !editIds.has(g.id));

  const tipIn  = (e: React.MouseEvent<HTMLDivElement>) => {
    const tip = e.currentTarget.querySelector<HTMLElement>("[data-tip]");
    if (!tip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    tip.style.left    = `${rect.left + rect.width / 2}px`;
    tip.style.top     = `${rect.top}px`;
    tip.style.display = "block";
  };
  const tipOut = (e: React.MouseEvent<HTMLDivElement>) =>
    e.currentTarget.querySelector<HTMLElement>("[data-tip]")?.style.setProperty("display", "none");

  function enterEdit() {
    const anyOpen = prosState !== "hidden" || consState !== "hidden";
    if (prosState !== "hidden") togglePros();
    if (consState !== "hidden") toggleCons();
    if (anyOpen) setTimeout(() => setEditMode(true), 270);
    else setEditMode(true);
  }

  function cancelEdit() {
    clearTimeout(saveExitTimerRef.current);
    if (editSaving) {
      // Flag the in-flight save to abort its DONE!/exit flow once it resolves
      cancelRequestedRef.current = true;
      return;
    }
    setEditExiting(true);
    setTimeout(() => {
      setEditMode(false);
      setEditExiting(false);
      setEditSaveDone(false);
      setDragId(null);
      setDragOverSlot(null);
      setEditGarments(outfitRef.current.garments);
    }, 320);
  }

  function dropOnSlot(slotId: string) {
    if (!dragSource || dragFromOutfit) { setDragId(null); setDragOverSlot(null); return; }
    const slot = editGarments.find(g => g.id === slotId);
    if (!slot) { setDragId(null); setDragOverSlot(null); return; }
    const withoutSlot = editGarments.filter(g => g.id !== slotId);
    if (!canAddToOutfit(withoutSlot, dragSource)) { setDragId(null); setDragOverSlot(null); return; }
    setEditGarments([...withoutSlot, dragSource]);
    setDragId(null); setDragOverSlot(null);
  }

  async function saveEdit() {
    cancelRequestedRef.current = false;
    setEditSaving(true);
    try {
      await onSaveEdit(editGarments.map(g => g.id));
      if (cancelRequestedRef.current) {
        // User clicked CANCEL while the network request was in flight — stay in edit mode
        cancelRequestedRef.current = false;
        setEditSaving(false);
        return;
      }
      setEditSaving(false);
      setEditSaveDone(true);
      saveExitTimerRef.current = setTimeout(() => {
        cancelEdit();
      }, 1800);
    } catch {
      cancelRequestedRef.current = false;
      setEditSaving(false);
    }
  }

  function togglePros() {
    if (prosState === "hidden") { setProsState("visible"); }
    else {
      setProsState("exiting");
      clearTimeout(prosTimerRef.current);
      prosTimerRef.current = setTimeout(() => setProsState("hidden"), 230);
    }
  }
  function toggleCons() {
    if (consState === "hidden") { setConsState("visible"); }
    else {
      setConsState("exiting");
      clearTimeout(consTimerRef.current);
      consTimerRef.current = setTimeout(() => setConsState("hidden"), 230);
    }
  }

  return (
    <>
      {/* ── Pros panel — fixed to left screen edge, vertically centered ── */}
      {!editMode && prosState !== "hidden" && (
        <div style={{ position: "fixed", left: 0, top: "50%", transform: "translateY(-50%)", zIndex: 1001 }}>
          <div key={prosState === "exiting" ? "pros-out" : "pros-in"} style={{
            width: "min(280px, 85vw)", background: "#fff",
            boxShadow: "4px 0 24px rgba(0,0,0,0.12)",
            overflowY: "auto", scrollbarWidth: "none" as const,
            maxHeight: "80vh", padding: "32px 24px",
            animation: prosState === "exiting"
              ? "slideOutToLeft 0.25s ease forwards"
              : "slideInFromLeft 0.25s ease forwards",
            textAlign: "center" as const, ...FONT,
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#1d9e52",
              textTransform: "uppercase" as const, marginBottom: 20 }}>PROS</p>
            {pros.length > 0
              ? pros.map((p, i) => (
                <p key={i} style={{ fontSize: 12, color: "#333", lineHeight: 1.65,
                  margin: "0 0 12px", letterSpacing: "0.02em" }}>{p}</p>
              ))
              : <p style={{ fontSize: 12, color: "#bbb", lineHeight: 1.6, margin: 0 }}>
                  {analyzed ? "None" : "No analysis yet for this outfit."}
                </p>
            }
          </div>
        </div>
        )}

      <Overlay onClose={editMode ? () => {} : onClose} showClose={false}
        innerStyle={editMode ? {
          animation: editExiting
            ? "slideCardToCenter 0.28s ease forwards"
            : (editEnteredRef.current ? undefined : "slideCardToLeft 0.28s ease"),
          maxWidth: "none", minWidth: 810,
        } : { minWidth: 810 }}
        gap={editMode ? 20 : 0}
        sidePanel={editMode ? (() => {
          const totalBoxes = Math.max(
            Math.ceil(allGarments.length / 5) * 5,
            editAvail.length
          );
          const emptyCount = totalBoxes - editAvail.length;
          const invOver = dragOverSlot === "__inventory";
          return (
            <div style={{
              width: 810,
              maxHeight: "90vh",
              background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
              overflowY: "auto", scrollbarWidth: "none" as const,
              animation: editExiting
                ? "slideOutToRight 0.28s ease forwards"
                : "slideInFromRight 0.28s ease",
              padding: "36px 0",
              display: "grid", gridTemplateColumns: "repeat(5, 142px)",
              justifyContent: "center",
              gap: 5, alignContent: "start",
              boxSizing: "border-box",
            }}>
              {editAvail.map(g => (
                <div
                  key={g.id}
                  draggable
                  onDragStart={() => setDragId(g.id)}
                  onDragEnd={() => { setDragId(null); setDragOverSlot(null); }}
                  onMouseEnter={tipIn}
                  onMouseLeave={tipOut}
                  style={{
                    width: 142, height: 142, flexShrink: 0,
                    border: `1px solid ${dragId === g.id ? "#999" : "#d8d8d8"}`,
                    background: "#f3f3f3", cursor: "grab",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    position: "relative",
                    opacity: dragId === g.id ? 0.45 : 1,
                    transition: "opacity 0.1s",
                  }}
                >
                  {g.image && <img src={g.image} alt="" draggable={false} style={{ width: 132, height: 132, objectFit: "contain" }} />}
                  <DndGarmentTip g={g} />
                </div>
              ))}
              {Array.from({ length: emptyCount }).map((_, i) => {
                const isTarget = dragFromOutfit && i < editGarments.length;
                return (
                  <div
                    key={`inv-empty-${i}`}
                    style={{
                      width: 142, height: 142,
                      background: isTarget && invOver ? "#f0fff4" : "transparent",
                      border: isTarget
                        ? invOver ? "2px dashed #2e7d32" : "1px dashed #aaa"
                        : "1px solid #e8e8e8",
                      transition: "all 0.1s",
                    }}
                    onDragOver={isTarget ? (e => { e.preventDefault(); setDragOverSlot("__inventory"); }) : undefined}
                    onDragLeave={isTarget ? (() => setDragOverSlot(null)) : undefined}
                    onDrop={isTarget && dragSource ? (() => {
                      setEditGarments(prev => prev.filter(g => g.id !== dragSource.id));
                      setDragId(null); setDragOverSlot(null);
                    }) : undefined}
                  />
                );
              })}
            </div>
          );
        })() : null}
      >
        <div style={{ ...FONT, minWidth: 340 }}>

          {/* ── Ticker row — nav arrows + scrolling date + close ── */}
          {(() => {
          const [yr, mo, dy] = dateStr.split("-").map(Number);
          const dow = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"][
            new Date(yr, mo - 1, dy).getDay()
          ];
          const monthDay = `${MONTHS[mo - 1]} ${dy}, ${yr}`;
          function tempCat(f: number) {
            if (f >= 86) return "HOT"; if (f >= 72) return "WARM";
            if (f >= 60) return "MILD"; if (f >= 46) return "COOL";
            if (f >= 32) return "COLD"; return "FREEZING";
          }
          const items = [
            dow, monthDay,
            ...(weather ? [
              `${weather.tempF}°F`,
              tempCat(weather.tempF),
              conditionShort(weather.condition).toUpperCase(),
            ] : []),
          ].filter(Boolean);
          return (
            <div style={{ margin: "-36px -40px 22px", display: "flex", alignItems: "center" }}>
              <button
                onClick={() => onPrev?.()}
                disabled={!onPrev}
                style={{ background: "none", border: "none",
                  cursor: onPrev ? "pointer" : "default", opacity: onPrev ? 1 : 0.18,
                  padding: "0 12px", lineHeight: 1, height: 42, flexShrink: 0 }}>
                <svg width="8" height="13" viewBox="0 0 10 17"><polygon points="10,0 0,8.5 10,17" fill="#111" /></svg>
              </button>
              <div style={{ flex: 1 }} />
              <div style={{ overflow: "hidden", width: 260, height: 42, flexShrink: 0,
                background: "#f0f0f0", display: "flex", alignItems: "center" }}>
                <div style={{ display: "inline-flex", whiteSpace: "nowrap",
                  animation: "ticker-r 20s linear infinite" }}>
                  {[0, 1].map(pass => (
                    <span key={pass} style={{ display: "inline-flex", alignItems: "center" }}>
                      {items.map((txt, i) => (
                        <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
                          <span style={{ color: "#111", fontSize: 10, letterSpacing: "0.13em",
                            textTransform: "uppercase", padding: "0 18px", ...FONT }}>{txt}</span>
                          <span style={{ color: "#ccc", fontSize: 13 }}>|</span>
                        </span>
                      ))}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => onNext?.()}
                disabled={!onNext}
                style={{ background: "none", border: "none",
                  cursor: onNext ? "pointer" : "default", opacity: onNext ? 1 : 0.18,
                  padding: "0 12px", lineHeight: 1, height: 42, flexShrink: 0 }}>
                <svg width="8" height="13" viewBox="0 0 10 17"><polygon points="0,0 10,8.5 0,17" fill="#111" /></svg>
              </button>
              <button
                onClick={onClose}
                style={{ background: "none", border: "none", cursor: "pointer",
                  fontSize: 14, color: "#bbb", lineHeight: 1, height: 42, flexShrink: 0,
                  padding: "0 10px 0 0" }}>
                ✕
              </button>
            </div>
          );
        })()}

          {/* ── "[aesthetic]" OUTFIT heading with pros/cons toggles ── */}
          {/* Always rendered so the card height stays constant between edit and view modes. */}
          {/* visibility:hidden in edit mode keeps the space but hides the content. */}
          <div style={{ visibility: editMode ? "hidden" : "visible" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                {analyzed ? (
                  <button
                    onClick={togglePros}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      fontSize: 9, letterSpacing: "0.12em", color: "#1d9e52",
                      textTransform: "uppercase", padding: 0, minWidth: 68,
                      textAlign: "left", ...FONT }}
                  >
                    {prosState !== "hidden" ? "HIDE PROS" : "SHOW PROS"}
                  </button>
                ) : (
                  <span style={{ minWidth: 68 }} />
                )}
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
                  textAlign: "center", textTransform: "uppercase", margin: 0 }}>
                  {aesthetic ? `"${aesthetic}"` : "OUTFIT"}
                </p>
                {analyzed ? (
                  <button
                    onClick={toggleCons}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      fontSize: 9, letterSpacing: "0.12em", color: "#c83030",
                      textTransform: "uppercase", padding: 0, minWidth: 68,
                      textAlign: "right", ...FONT }}
                  >
                    {consState !== "hidden" ? "HIDE CONS" : "SHOW CONS"}
                  </button>
                ) : (
                  <span style={{ minWidth: 68 }} />
                )}
              </div>
              {analyzed && styleScore > 0 && (
                <p style={{
                  fontSize: 13, fontWeight: 700, letterSpacing: "0.06em",
                  textAlign: "center", marginBottom: 22,
                  color: styleScore >= 75 ? "#1d9e52" : styleScore >= 50 ? "#c88800" : "#c83030",
                }}>
                  {styleScore} / 100
                </p>
              )}
              {(!analyzed || !styleScore) && <div style={{ marginBottom: 22 }} />}
          </div>


        {/* Outfit slot grid */}
        {(() => {
          const B = 142; const G = 5;

          const heads: Garment[] = [], outers: Garment[] = [], mids: Garment[] = [];
          const tops:  Garment[] = [], bots:  Garment[] = [], shoes: Garment[] = [];
          const accs:  Garment[] = [];

          for (const g of (editMode ? editGarments : outfit.garments)) {
            if (g.category === "footwear")  { shoes.push(g);  continue; }
            if (g.category === "bottom")    { bots.push(g);   continue; }
            if (g.category === "outerwear") { outers.push(g); continue; }
            // sub_type-based hat detection runs BEFORE the category === "accessory" fallback —
            // hats commonly get category "accessory" from the AI tagger, which used to make them
            // get grabbed by that check first and never reach this one, so a hat could never
            // actually land in the dedicated Hat slot.
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

          const leftG  = outers[0];
          const rightG = mids[0] ?? outers[1];

          // Sort tops so true base items (tees, henleys, thermals) come first,
          // outer-capable items (button-ups, oxfords, flannels) come last.
          // This ensures tops[0] = innermost (center/base slot) and extras = outer roles.
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
          tops.sort((a, b) => (isOuterCapableTop(a) ? 1 : 0) - (isOuterCapableTop(b) ? 1 : 0));

          const BOX: CSSProperties = {
            width: B, height: B, flexShrink: 0,
            background: "#f3f3f3",
            border: "1px solid #d8d8d8",
            position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "default", overflow: "visible",
          };

          // Defensive parser: handles both actual arrays and JSON-stringified arrays
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
                <div style={{ color: "#777", fontSize: 8, letterSpacing: "0.12em",
                  textTransform: "uppercase", marginBottom: 4 }}>
                  {role}{extra ? ` · ${extra}` : ""}
                </div>
                <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 3, lineHeight: 1.3 }}>{nm}</div>
                {g.color_primary && (
                  <div style={{ color: "#bbb", fontSize: 8, marginBottom: 2 }}>{g.color_primary}</div>
                )}
                {pros.map((p, i) => <div key={`p${i}`} style={{ color: "#7dbc7d", fontSize: 8 }}>{p}</div>)}
                {con.map((c, i)  => <div key={`n${i}`} style={{ color: "#bc7d7d", fontSize: 8 }}>{c}</div>)}
                {pairs.length > 0 && (
                  <div style={{ color: "#bbb", fontSize: 8, marginTop: 3 }}>Pairs w/ {pairs.join(", ")}</div>
                )}
              </div>
            );
          }

          function EmptyTip({ role, tipDir = "above" }: { role: string; tipDir?: TipDir }) {
            return (
              <div data-tip="" style={{ ...TIP_WRAP, width: 130, ...tipPos(tipDir) }}>
                <div style={{ color: "#e04040", fontWeight: 700, fontSize: 8,
                  letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>
                  EMPTY
                </div>
                <div style={{ color: "#888", fontSize: 8, textTransform: "uppercase",
                  letterSpacing: "0.08em" }}>
                  {role}
                </div>
              </div>
            );
          }

          const onIn  = (e: { currentTarget: Element }) =>
            (e.currentTarget.querySelector<HTMLElement>("[data-tip]") ?? null)?.style.setProperty("display", "block");
          const onOut = (e: { currentTarget: Element }) =>
            (e.currentTarget.querySelector<HTMLElement>("[data-tip]") ?? null)?.style.setProperty("display", "none");


          // Grid layout (5 cols × 4 rows):
          //   row 1:          col 3 = HAT
          //   row 2: OUTER  TOP2(extra)  TOP1(primary)  TOP3(extra)  MID
          //   row 3:          col 3 = PANTS
          //   row 4:          col 3 = SHOES
          function S(g: Garment | undefined, role: string, col: number, row: number, extra?: string, tipDir: TipDir = "above") {
            const emptySlotId = `__empty_${col}_${row}`;
            // Visual feedback — only when dragging FROM inventory (not from outfit)
            const isOver      = editMode && !dragFromOutfit && !!g && dragOverSlot === g.id;
            const canDrop     = isOver && !!dragSource && canAddToOutfit(
              editGarments.filter(x => x.id !== g!.id), dragSource
            );
            const isEmptyOver  = editMode && !dragFromOutfit && !g && dragOverSlot === emptySlotId;
            const emptyCanDrop = isEmptyOver && !!dragSource && canAddToOutfit(editGarments, dragSource);
            return (
              <div
                style={{
                  ...BOX, gridColumn: col, gridRow: row,
                  cursor: editMode && g ? "grab" : "default",
                  ...(editMode && g ? {
                    border: isOver ? `2px solid ${canDrop ? "#2e7d32" : "#c00"}` : "1px solid #d8d8d8",
                    background: isOver ? (canDrop ? "#f0fff4" : "#fff5f5") : "#f3f3f3",
                    transition: "border-color 0.1s, background 0.1s",
                  } : {}),
                  ...(editMode && !g ? {
                    border: isEmptyOver ? `2px dashed ${emptyCanDrop ? "#2e7d32" : "#c00"}` : "1px dashed #bbb",
                    background: isEmptyOver ? (emptyCanDrop ? "#f0fff4" : "#fff5f5") : "transparent",
                    transition: "border-color 0.1s, background 0.1s",
                  } : {}),
                }}
                draggable={editMode && !!g}
                onDragStart={editMode && g ? (() => setDragId(g.id)) : undefined}
                onDragEnd={editMode ? (() => { setDragId(null); setDragOverSlot(null); }) : undefined}
                onMouseEnter={onIn} onMouseLeave={onOut}
                onDragOver={editMode && !dragFromOutfit ? (e => {
                  if (g) {
                    if (dragSource && canAddToOutfit(editGarments.filter(x => x.id !== g.id), dragSource)) {
                      e.preventDefault(); setDragOverSlot(g.id);
                    }
                  } else if (dragSource && canAddToOutfit(editGarments, dragSource)) {
                    e.preventDefault(); setDragOverSlot(emptySlotId);
                  }
                }) : undefined}
                onDragLeave={editMode ? (() => setDragOverSlot(null)) : undefined}
                onDrop={editMode ? (() => {
                  if (dragFromOutfit) { setDragId(null); setDragOverSlot(null); return; }
                  if (g) { dropOnSlot(g.id); }
                  else if (dragSource && canAddToOutfit(editGarments, dragSource)) {
                    setEditGarments(prev => [...prev, dragSource]);
                    setDragId(null); setDragOverSlot(null);
                  } else { setDragId(null); setDragOverSlot(null); }
                }) : undefined}
              >
                {g?.image && (
                  <img src={g.image} alt="" draggable={false}
                    style={{ width: B - 10, height: B - 10, objectFit: "contain" }} />
                )}
                {g ? <Tip g={g} role={role} extra={extra} tipDir={tipDir} /> : <EmptyTip role={role} tipDir={tipDir} />}
              </div>
            );
          }

          // Sliding adjacency: items gravitate toward the center (col 3) to avoid gaps.
          // Col 2 takes tops[1] first; if that slot is empty, leftG (jacket) slides into col 2.
          // Col 1 is only occupied when BOTH tops[1] AND leftG are present.
          // Mirror logic applies to col 4 / col 5.
          const col1G = (tops[1] && leftG)  ? leftG  : undefined;
          const col2G = tops[1]             ? tops[1] : leftG;
          const col4G = tops[2]             ? tops[2] : rightG;
          const col5G = (tops[2] && rightG) ? rightG  : undefined;

          const hasBothExtraTops = !!tops[1] && !!tops[2];
          const leftTopRole  = hasBothExtraTops ? "Outer Layer 1" : "Outer Layer";
          const rightTopRole = hasBothExtraTops ? "Outer Layer 2" : "Outer Layer";
          const col2Role = tops[1] ? leftTopRole  : leftG  ? "Outer Layer" : "Top Layer";
          const col4Role = tops[2] ? rightTopRole : rightG ? "Mid Layer"   : "Top Layer";

          const MIN_ACC = 10;
          const accSlots: (Garment | undefined)[] = [
            ...accs, ...Array(Math.max(0, MIN_ACC - accs.length)).fill(undefined),
          ];

          return (
            <div style={{ marginBottom: 28 }}>
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

              {/* Accessory boxes — 2 rows of 5 */}
              <div style={{
                display: "grid", gridTemplateColumns: `repeat(5, ${B}px)`,
                gap: G, justifyContent: "center",
              }}>
                {accSlots.map((g, i) => (
                  <div key={i} style={BOX} onMouseEnter={onIn} onMouseLeave={onOut}>
                    {g?.image && (
                      <img src={g.image} alt="" draggable={false}
                        style={{ width: B - 10, height: B - 10, objectFit: "contain" }} />
                    )}
                    {g ? <Tip g={g} role="Accessory" extra={accLabel(g)} /> : <EmptyTip role="Accessory" />}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", alignItems: "center", minHeight: 36 }}>
            {editMode ? (
              <>
                <button onClick={cancelEdit}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "9px 22px",
                    fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" as const,
                    color: "#c00", ...FONT }}>CANCEL</button>
                <button onClick={saveEdit} disabled={editSaving || editSaveDone}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "9px 22px",
                    fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" as const,
                    color: editSaving ? "#b8860b" : "#2e7d32", ...FONT }}>
                  {editSaving ? "SAVING…" : editSaveDone ? "DONE!" : "DONE"}
                </button>
              </>
            ) : (
              <button
                onClick={enterEdit}
                onMouseEnter={e => { e.currentTarget.style.color = "#111"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#bbb"; }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
                  fontSize: 14, letterSpacing: "0.14em", textTransform: "uppercase",
                  color: "#bbb", transition: "color 0.15s", lineHeight: 1, ...FONT }}
              >EDIT</button>
            )}
          </div>
        </div>
      </Overlay>

      {/* ── Cons panel — fixed to right screen edge, vertically centered ── */}
      {!editMode && consState !== "hidden" && (
        <div style={{ position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 1001 }}>
          <div key={consState === "exiting" ? "cons-out" : "cons-in"} style={{
            width: "min(280px, 85vw)", background: "#fff",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            overflowY: "auto", scrollbarWidth: "none" as const,
            maxHeight: "80vh", padding: "32px 24px",
            animation: consState === "exiting"
              ? "slideOutToRight 0.25s ease forwards"
              : "slideInFromRight 0.25s ease forwards",
            textAlign: "center" as const, ...FONT,
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#c83030",
              textTransform: "uppercase" as const, marginBottom: 20 }}>CONS</p>
            {cons.length > 0
              ? cons.map((c, i) => (
                <p key={i} style={{ fontSize: 12, color: "#555", lineHeight: 1.65,
                  margin: "0 0 12px", letterSpacing: "0.02em" }}>{c}</p>
              ))
              : <p style={{ fontSize: 12, color: "#bbb", lineHeight: 1.6, margin: 0 }}>
                  {analyzed ? "None" : "No analysis yet for this outfit."}
                </p>
            }
          </div>
        </div>
      )}
    </>
  );
}

// ── Outfit Builder Modal ──────────────────────────────────────────────────────

function OutfitBuilderModal({
  dateStr, garments, existingIds, onSave, onClose,
}: {
  dateStr: string; garments: Garment[];
  existingIds?: string[]; onSave: (ids: string[]) => Promise<void>; onClose: () => void;
}) {
  const [selected,  setSelected]  = useState<Set<string>>(new Set(existingIds ?? []));
  const [catFilter, setCatFilter] = useState("all");
  const [saving,    setSaving]    = useState(false);

  const visible = catFilter === "all" ? garments : garments.filter(g => g.category === catFilter);

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleSave() {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    await onSave([...selected]);
    setSaving(false);
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ ...FONT, width: "min(660px, 82vw)", display: "flex", flexDirection: "column", maxHeight: "76vh" }}>
        <p style={{ fontSize: 10, letterSpacing: "0.15em", color: "#aaa", marginBottom: 6 }}>
          {formatDetailDate(dateStr)}
        </p>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 20 }}>
          {existingIds?.length ? "EDIT OUTFIT" : "BUILD OUTFIT"}
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", flexShrink: 0 }}>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)} style={{
              padding: "5px 12px", fontSize: 9, letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: "pointer", border: "1px solid",
              borderColor: catFilter === cat ? "#111" : "#ddd",
              background:  catFilter === cat ? "#111" : "#fff",
              color:       catFilter === cat ? "#fff" : "#aaa", ...FONT,
            }}>
              {cat}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", minHeight: 0 }}>
          {visible.length === 0
            ? <p style={{ fontSize: 12, color: "#ccc", padding: "24px 0", textAlign: "center" }}>No items in this category.</p>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, paddingBottom: 4 }}>
                {visible.map(g => {
                  const sel = selected.has(g.id);
                  return (
                    <div key={g.id} onClick={() => toggle(g.id)} style={{
                      cursor: "pointer", textAlign: "center", padding: 8,
                      border: `2px solid ${sel ? "#111" : "#ebebeb"}`,
                      background: sel ? "#f8f8f8" : "#fff",
                      transition: "border-color 0.1s, background 0.1s",
                    }}>
                      {g.image
                        ? <img src={g.image} alt="" style={{ width: "100%", height: 110, objectFit: "contain", display: "block" }} />
                        : <div style={{ height: 110, background: "#f3f3f3" }} />
                      }
                      <p style={{ fontSize: 10, color: "#888", marginTop: 7, lineHeight: 1.3 }}>
                        {g.brand ?? g.title}
                      </p>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>

        <div style={{ paddingTop: 16, marginTop: 12, borderTop: "1px solid #ebebeb", display: "flex", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "#aaa", letterSpacing: "0.08em" }}>
            {selected.size} {selected.size === 1 ? "ITEM" : "ITEMS"} SELECTED
          </span>
          <button onClick={handleSave} disabled={selected.size === 0 || saving}
            style={{ ...BTN_PRIMARY, marginLeft: "auto", opacity: selected.size === 0 ? 0.35 : 1 }}>
            {saving ? "SAVING…" : "SAVE OUTFIT"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Drag-drop outfit editor ───────────────────────────────────────────────────

function parseDndProp(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
  }
  return [];
}

function dndSlotRole(g: Garment): string {
  if (g.category === "footwear")  return "SHOES";
  if (g.category === "bottom")    return "PANTS";
  if (g.category === "outerwear") return "OUTERWEAR";
  // Checked before category === "accessory" — hats commonly get that category from the AI
  // tagger, which would otherwise claim them before this hat-specific check ever runs.
  const sub = (g.sub_type ?? "").toLowerCase();
  if (sub.includes("hat") || sub.includes("cap") || sub.includes("beanie") || sub.includes("beret") || (sub.includes("bucket") && !sub.includes("bag"))) return "HAT";
  if (g.category === "accessory") return "ACCESSORY";
  if (sub.includes("hoodie") || sub.includes("sweatshirt") || sub.includes("sweater") || sub.includes("crewneck") || sub.includes("pullover") || sub.includes("cardigan") || sub.includes("fleece")) return "MID LAYER";
  if (sub.includes("flannel") || sub.includes("oxford") || sub.includes("chambray") || sub.includes("button-up") || sub.includes("button up") || sub.includes("button-down") || sub.includes("linen shirt") || sub.includes("camp collar")) return "OUTER LAYER";
  return "BASE LAYER";
}

// Slots where only ONE item is allowed in an outfit.
// Accessories, hats, etc. can stack so they're intentionally excluded.
const EXCLUSIVE_SLOTS = new Set([
  "base-top", "overshirt", "mid-layer", "vest", "outer",
  "pants", "shorts", "skirt", "dress", "jumpsuit",
  "shoes", "sandals",
]);

function gSlot(g: Garment): string {
  return getSlot({ category: g.category, sub_type: g.sub_type ?? null, title: g.title });
}

// Returns true if `toAdd` can be placed into `existing` without creating a conflict.
// Accessories and unknown slots are always addable (multiple allowed).
// Exclusive slots are only addable if that slot isn't already filled.
function canAddToOutfit(existing: Garment[], toAdd: Garment): boolean {
  const slot = gSlot(toAdd);
  if (!EXCLUSIVE_SLOTS.has(slot)) return true;
  return !existing.some(g => gSlot(g) === slot);
}

function DndGarmentTip({ g }: { g: Garment }) {
  const nm  = [g.brand, g.title].filter(Boolean).join(" ");
  const pro = parseDndProp(g.pros).slice(0, 2);
  const con = parseDndProp(g.cons).slice(0, 1);
  const tip: CSSProperties = {
    display: "none", position: "fixed",
    top: 0, left: 0, transform: "translate(-50%, calc(-100% - 6px))",
    background: "#1a1a1a", color: "#e8e8e8", fontSize: 9,
    padding: "9px 11px", pointerEvents: "none", zIndex: 9000,
    letterSpacing: "0.04em", lineHeight: 1.6, width: 174, ...FONT,
  };
  return (
    <div data-tip="" style={tip}>
      <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 3, lineHeight: 1.3 }}>{nm}</div>
      {g.color_primary && <div style={{ color: "#bbb", fontSize: 8, marginBottom: 2 }}>{g.color_primary}</div>}
      {g.sub_type && <div style={{ color: "#888", fontSize: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{g.sub_type}</div>}
      {pro.map((p, i) => <div key={`p${i}`} style={{ color: "#7dbc7d", fontSize: 8 }}>{p}</div>)}
      {con.map((c, i) => <div key={`n${i}`} style={{ color: "#bc7d7d", fontSize: 8 }}>{c}</div>)}
    </div>
  );
}

// ── Generating overlay ────────────────────────────────────────────────────────

// Save the attached t-shirt image as /public/loading-tee.png to use it here.
const LOADING_IMG = "/loading-tee.png";

const WAVE_CSS = `
  @keyframes waveDot {
    0%,60%,100%{transform:translateY(0)}
    30%{transform:translateY(-10px)}
  }
  @keyframes loadbar {
    0%  { width: 0% }
    55% { width: 65% }
    80% { width: 84% }
    100%{ width: 93% }
  }
  @keyframes skeleton {
    0%   { transform: translateX(-100%) }
    100% { transform: translateX(350%) }
  }
  @keyframes slideInFromLeft {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0); }
  }
  @keyframes slideCardToLeft {
    from { transform: translateX(415px); }
    to   { transform: translateX(0); }
  }
  @keyframes slideCardToCenter {
    from { transform: translateX(0);     }
    to   { transform: translateX(415px); }
  }
  @keyframes slideCardToRight {
    0%   { transform: translateX(0);    opacity: 1; }
    70%  { transform: translateX(360px); opacity: 1; }
    100% { transform: translateX(415px); opacity: 0; }
  }
  @keyframes slideInFromRight {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }
  @keyframes slideOutToLeft {
    from { transform: translateX(0); }
    to   { transform: translateX(-100%); }
  }
  @keyframes slideOutToRight {
    0%   { transform: translateX(0);    opacity: 1; }
    70%  { transform: translateX(80%);  opacity: 1; }
    100% { transform: translateX(100%); opacity: 0; }
  }
  @keyframes ticker-r {
    0%   { transform: translateX(-50%); }
    100% { transform: translateX(0%); }
  }
`;

// Every load uses the same three dots as the rest of the site and the app (was a shirt image
// with a progress bar). Name kept so the overlays below didn't need restructuring.
function LoadingShirtBar(_props: { barDuration: string }) {
  return <LoadingDots />;
}

function GeneratingOverlay({ message: _message }: { message: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(255,255,255,0.92)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <LoadingShirtBar barDuration="10s" />
    </div>
  );
}

function InitializingScreen({
  message: _message, showOnceNote: _showOnceNote = false,
}: {
  message: string; showOnceNote?: boolean;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000,
      background: "#fff",
      display: "flex",
      alignItems: "center", justifyContent: "center",
      ...FONT,
    }}>
      <LoadingShirtBar barDuration="14s" />
    </div>
  );
}

// ── Month outfit cache ────────────────────────────────────────────────────────
// Keyed by "YYYY-M". Persisted to localStorage so data survives tab/browser
// restarts. Hydrated client-side via useEffect (not useRef init) because
// useRef initializers run during SSR where window is undefined.
const SETUP_KEY       = "outfit_setup_v13"; // bumped: force re-setup after outfit_items fix
const MONTH_CACHE_KEY = "outfits_cache_v14"; // bumped: bust stale cache

function cacheLoad(): Record<string, OutfitMap> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(MONTH_CACHE_KEY) ?? "{}"); }
  catch { return {}; }
}
function cacheSave(cache: Record<string, OutfitMap>) {
  try { localStorage.setItem(MONTH_CACHE_KEY, JSON.stringify(cache)); }
  catch {}
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type GenerateResult = { ok: true } | { ok: false; message: string };

async function callGenerate(year: number, month: number, lat?: number, lon?: number, overwrite?: boolean): Promise<GenerateResult> {
  const body: Record<string, unknown> = { year, month };
  if (lat !== undefined) body.lat = lat;
  if (lon !== undefined) body.lon = lon;
  if (overwrite !== undefined) body.overwrite = overwrite;
  try {
    const res = await fetch("/api/outfits/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    if (data.code === "INSUFFICIENT_WARDROBE") {
      return { ok: false, message: "Add a few more items to your wardrobe (at least one top, bottom, and pair of shoes) to generate outfits." };
    }
    return { ok: false, message: typeof data.error === "string" ? data.error : "Couldn't generate outfits — try again." };
  } catch {
    return { ok: false, message: "Couldn't reach the server — check your connection and try again." };
  }
}

export default function OutfitsPage() {
  const isMobile = useIsMobile();
  const today = new Date();

  // Whether the wardrobe can form even one valid outfit — the exact check generation itself
  // applies (/api/outfits/readiness). false → the whole page is one "add more items" message;
  // the first-visit setup below also waits for true, so it can't burn its once-ever run on a
  // wardrobe that's still too small (it used to mark itself done after failing, leaving the
  // current month un-generated forever). Re-checked whenever the tab regains focus, so adding
  // items elsewhere activates the calendar without a manual reload. Same as the app.
  const [calReady, setCalReady] = useState<boolean | null>(null);
  const demo = useTutorialDemo();
  const sampleOutfitList = useMemo(() => {
    const byId = Object.fromEntries(sampleCloset(SAMPLE_IMAGES).garments.map(g => [g.id, g as unknown as Garment]));
    return sampleOutfits().map(o => o.itemIds.map(id => byId[id]));
  }, []);
  useEffect(() => {
    const check = () => {
      fetch("/api/outfits/readiness").then(r => (r.ok ? r.json() : null))
        .then((d: { ready?: boolean } | null) => { if (d) setCalReady(!!d.ready); })
        .catch(() => {});
    };
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  // Starts empty — hydrated from localStorage in useEffect below (useRef initializer
  // and useState lazy-init both run during SSR where window is undefined, so neither
  // can read localStorage; useEffect is the only safe client-side-only hook).
  const monthCacheRef = useRef<Record<string, OutfitMap>>({});

  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [outfits,       setOutfits]       = useState<OutfitMap>({});
  const [garments,      setGarments]      = useState<Garment[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [garmentsReady, setGarmentsReady] = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [generateMsg,   setGenerateMsg]   = useState("");
  const [initializing,  setInitializing]  = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [regenConfirm,  setRegenConfirm]  = useState(false);

  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [buildDate,  setBuildDate]  = useState<string | null>(null);
  const [isEditing,  setIsEditing]  = useState(false);
  // Weather kept PER MONTH (like the outfits cache): a month's cells only show their contents once
  // its weather AND outfits are both in, so temperatures never pop in after the outfits — and a
  // revisited month already has both, so it appears complete immediately.
  const [weatherByMonth, setWeatherByMonth] = useState<Record<string, Record<string, DayWeather>>>({});
  const weather = weatherByMonth[`${year}-${month}`] ?? {};
  const [geoResolved,  setGeoResolved]  = useState(false);
  const [userLoc,      setUserLoc]      = useState<{ lat: number; lon: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [showLocInput,  setShowLocInput]  = useState(false);
  const [locQuery,      setLocQuery]      = useState("");
  const [locResults,    setLocResults]    = useState<{ lat: number; lon: number; label: string }[]>([]);
  const [locBusy,       setLocBusy]       = useState(false);

  const autoGenRef          = useRef(false);     // only auto-generate once per session
  const locReady            = useRef(false);     // true once geoloc resolved (success or denied)
  const loadReqId           = useRef(0);         // incremented on each load; stale responses are discarded
  const autoGeneratedMonths = useRef<Set<string>>(new Set()); // prevents re-trying a failed auto-generate

  const [autoGenerating, setAutoGenerating] = useState(false);

  // Pending navigation: set when user tries to go to a future ungenerated month.
  // The modal shows on top of the CURRENT month — not the blank future month.
  const [pendingNav,        setPendingNav]        = useState<{ year: number; month: number } | null>(null);
  const [pendingGenerating, setPendingGenerating] = useState(false);

  // Geolocation — use cached coords immediately so weather fires once with real location.
  // Fresh geolocation runs in background and updates cache for next visit. getCurrentLocation()
  // uses the native Capacitor plugin inside the app shell (proper native permission dialog)
  // and falls back to the standard web API in a regular browser — same either way from here.
  useEffect(() => {
    let settled = false;
    const resolve = (loc: { lat: number; lon: number } | null) => {
      if (loc) setUserLoc(loc);
      if (!settled) { settled = true; locReady.current = true; setGeoResolved(true); }
    };

    const cached = localStorage.getItem("mycloset_userloc");
    if (cached) {
      try {
        resolve(JSON.parse(cached) as { lat: number; lon: number });
      } catch { resolve(null); }
      // Still refresh coords in background (don't setGeoResolved again — already done)
      getCurrentLocation().then(loc => {
        if (loc) { setUserLoc(loc); localStorage.setItem("mycloset_userloc", JSON.stringify(loc)); }
      });
      return;
    }

    // No cache: wait for geolocation (or timeout) before fetching weather
    const t = setTimeout(() => resolve(null), 2000);
    getCurrentLocation().then(loc => {
      clearTimeout(t);
      if (loc) localStorage.setItem("mycloset_userloc", JSON.stringify(loc));
      resolve(loc);
    });
    return () => clearTimeout(t);
  }, []);

  // Fetch weather only after geolocation is settled — fires exactly once per month with final coords
  useEffect(() => {
    if (!geoResolved) return;
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (userLoc) { params.set("lat", String(userLoc.lat)); params.set("lon", String(userLoc.lon)); }
    const key = `${year}-${month}`;
    // Stored under its own month key — a slower response for a month the user already left can
    // never overwrite the month on screen.
    const apply = (data: Record<string, DayWeather>) => setWeatherByMonth(prev => ({ ...prev, [key]: data }));
    fetch(`/api/weather?${params}`)
      .then(r => r.ok ? r.json() : {})
      .then((data: Record<string, DayWeather>) => apply(data))
      .catch(() => apply({}));
  }, [year, month, userLoc, geoResolved]);

  // Resolve a human-readable place name for whatever coordinates are actually in use, so the
  // user can see (and sanity-check) what location their weather-based outfit picks come from.
  useEffect(() => {
    if (!userLoc) { setLocationLabel(null); return; }
    let cancelled = false;
    fetch(`/api/geocode?lat=${userLoc.lat}&lon=${userLoc.lon}`)
      .then(r => r.ok ? r.json() : { label: null })
      .then((data: { label: string | null }) => { if (!cancelled) setLocationLabel(data.label); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userLoc]);

  async function searchLocation(q: string) {
    setLocQuery(q);
    if (q.trim().length < 2) { setLocResults([]); return; }
    setLocBusy(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      const data = res.ok ? await res.json() : { results: [] };
      setLocResults(data.results ?? []);
    } finally {
      setLocBusy(false);
    }
  }

  function chooseLocation(loc: { lat: number; lon: number; label: string }) {
    setUserLoc({ lat: loc.lat, lon: loc.lon });
    setLocationLabel(loc.label);
    localStorage.setItem("mycloset_userloc", JSON.stringify({ lat: loc.lat, lon: loc.lon }));
    setShowLocInput(false);
    setLocQuery("");
    setLocResults([]);
  }

  const loadOutfits = useCallback(async (y: number, m: number) => {
    const key = `${y}-${m}`;
    // Cache hit (non-empty): render instantly with no loading state.
    // An empty cached object means generation never ran or failed — treat as miss.
    const cached = monthCacheRef.current[key];
    if (cached && Object.keys(cached).length > 0) {
      setOutfits(cached);
      setLoading(false);
      return;
    }
    const reqId = ++loadReqId.current;
    setLoading(true);
    const res = await fetch(`/api/outfits?year=${y}&month=${m}`);
    if (reqId !== loadReqId.current) return; // a newer request superseded this one
    if (res.ok) {
      const data = await res.json() as OutfitMap;
      monthCacheRef.current[key] = data;
      cacheSave(monthCacheRef.current);
      setOutfits(data);
    } else {
      setOutfits({});
    }
    setLoading(false);
  }, []);

  // ── localStorage hydration — useLayoutEffect so the cache is applied BEFORE the
  // browser paints, eliminating the loading flash for users with cached data.
  // The loadOutfits effect that follows reads monthCacheRef (populated here) correctly
  // because effects in the same component always run in declaration order.
  useLayoutEffect(() => {
    const cache = cacheLoad();
    monthCacheRef.current = cache;
    const key = `${year}-${month}`;
    if (cache[key] && Object.keys(cache[key]).length > 0) {
      setOutfits(cache[key]);
      setLoading(false);
    }
    // Pre-warm next two generated months in background (fire-and-forget)
    if (typeof window !== "undefined" && localStorage.getItem(SETUP_KEY) === "true") {
      const m1 = addMonths(year, month, 1);
      const m2 = addMonths(year, month, 2);
      for (const { y, m } of [{ y: m1.year, m: m1.month }, { y: m2.year, m: m2.month }]) {
        const k = `${y}-${m}`;
        if (!cache[k]) {
          fetch(`/api/outfits?year=${y}&month=${m}`)
            .then(r => r.ok ? r.json() : {})
            .then(data => {
              monthCacheRef.current[k] = data as OutfitMap;
              cacheSave(monthCacheRef.current);
            })
            .catch(() => {});
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadOutfits(year, month); }, [year, month, loadOutfits]);

  useEffect(() => {
    fetch("/api/garments")
      .then(r => r.json())
      .then((data: Garment[]) => {
        setGarments(data);
        setGarmentsReady(true);
      });
  }, []);

  // Initial 3-month setup: runs once ever (guarded by localStorage key + autoGenRef).
  // Blocks the page entirely (InitializingScreen) until all three months are generated.
  // After setup, navigating to new months shows a manual "Generate" button instead.
  useEffect(() => {
    if (autoGenRef.current || loading || !garmentsReady || garments.length === 0 || calReady !== true) return;
    autoGenRef.current = true;

    const isSetupDone = typeof window !== "undefined" && localStorage.getItem(SETUP_KEY) === "true";
    if (isSetupDone) return;

    (async () => {
      // Wait for geolocation to resolve (up to 2.2s) so generate calls are coordinate-aware
      await new Promise<void>(res => {
        if (locReady.current) { res(); return; }
        const check = setInterval(() => { if (locReady.current) { clearInterval(check); res(); } }, 50);
        setTimeout(() => { clearInterval(check); res(); }, 2200);
      });

      setInitializing(true);
      setGenerateMsg("Setting up your wardrobe calendar…");

      const m1  = addMonths(year, month, 1);
      const m2  = addMonths(year, month, 2);
      const lat = userLoc?.lat;
      const lon = userLoc?.lon;

      try {
        const results = await Promise.all([
          callGenerate(year,       month,    lat, lon),
          callGenerate(m1.year, m1.month, lat, lon),
          callGenerate(m2.year, m2.month, lat, lon),
        ]);
        const firstFailure = results.find((r): r is { ok: false; message: string } => !r.ok);
        if (firstFailure) setGenerateError(firstFailure.message);
      } finally {
        // Always mark setup done — prevents the reset+regen loop on navigation return.
        // If some months failed the user can regenerate them manually.
        localStorage.setItem(SETUP_KEY, "true");
      }

      // Pre-fetch all 3 generated months into cache so switching between them is instant
      const [d0, d1, d2] = await Promise.all([
        fetch(`/api/outfits?year=${year}&month=${month}`).then(r => r.ok ? r.json() : {}),
        fetch(`/api/outfits?year=${m1.year}&month=${m1.month}`).then(r => r.ok ? r.json() : {}),
        fetch(`/api/outfits?year=${m2.year}&month=${m2.month}`).then(r => r.ok ? r.json() : {}),
      ]);
      monthCacheRef.current[`${year}-${month}`]       = d0 as OutfitMap;
      monthCacheRef.current[`${m1.year}-${m1.month}`] = d1 as OutfitMap;
      monthCacheRef.current[`${m2.year}-${m2.month}`] = d2 as OutfitMap;
      cacheSave(monthCacheRef.current);
      setOutfits(d0 as OutfitMap);
      setInitializing(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, garmentsReady, calReady]);

  // Auto-generate outfits for months within the initial 3-month range that ended up
  // completely blank (generation failed or was never triggered for that month).
  // Fires once per month per session (autoGeneratedMonths ref prevents retries).
  // Computes blank-day count inline to avoid declaration-order issues.
  useEffect(() => {
    if (loading || initializing || generating || pendingGenerating) return;
    if (!garmentsReady || garments.length === 0) return;
    const currIdx         = year * 12 + month;
    const generatedEndIdx = today.getFullYear() * 12 + (today.getMonth() + 1) + 2;
    const isCurrentMonth  = year === today.getFullYear() && month === today.getMonth() + 1;
    if (isCurrentMonth || currIdx > generatedEndIdx) return;
    const monthKey = `${year}-${month}`;
    if (autoGeneratedMonths.current.has(monthKey)) return;
    // Count how many days in this month have no outfit
    const dim   = new Date(year, month, 0).getDate();
    const blank = Array.from({ length: dim }, (_, i) => toDateStr(year, month, i + 1))
      .filter(d => !outfits[d]).length;
    if (blank === dim) {
      autoGeneratedMonths.current.add(monthKey);
      // Silent auto-generate: show skeleton bars in day cells rather than an overlay.
      (async () => {
        setAutoGenerating(true);
        try {
          const result = await callGenerate(year, month, userLoc?.lat, userLoc?.lon);
          if (!result.ok) { setGenerateError(result.message); return; }
          delete monthCacheRef.current[`${year}-${month}`];
          cacheSave(monthCacheRef.current);
          await loadOutfits(year, month);
        } finally {
          setAutoGenerating(false);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, loading, outfits, garmentsReady, initializing, generating, pendingGenerating]);

  function prevMonth() {
    if (year === today.getFullYear() && month === today.getMonth() + 1) return;
    setLoading(true); // show skeletons immediately so old month data doesn't flash
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else              setMonth(m => m - 1);
  }
  function nextMonth() {
    const nextY = month === 12 ? year + 1 : year;
    const nextM = month === 12 ? 1 : month + 1;
    // If this month is beyond the 3 auto-generated months and not cached (non-empty), intercept.
    // Show a confirmation modal on top of the current calendar instead of jumping to a blank month.
    const nextIdx         = nextY * 12 + nextM;
    const generatedEndIdx = today.getFullYear() * 12 + (today.getMonth() + 1) + 2;
    const cachedData      = monthCacheRef.current[`${nextY}-${nextM}`];
    const isCached        = !!(cachedData && Object.keys(cachedData).length > 0);
    if (nextIdx > generatedEndIdx && !isCached) {
      setPendingNav({ year: nextY, month: nextM });
    } else {
      setLoading(true); // show skeletons immediately so old month data doesn't flash
      setYear(nextY);
      setMonth(nextM);
    }
  }

  function handleDayClick(ds: string) {
    const o = outfits[ds];
    if (!o)                       { setIsEditing(false); setBuildDate(ds); return; }
    if (o.garments.length === 0)  { setIsEditing(true);  setBuildDate(ds); return; } // broken — open builder
    setDetailDate(ds);
  }

  async function handleSaveOutfit(ids: string[]) {
    if (!buildDate) return;
    const existing = outfits[buildDate];
    if (existing) {
      await fetch("/api/outfits", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: existing.id, garment_ids: ids }),
      });
    } else {
      await fetch("/api/outfits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: buildDate, garment_ids: ids }),
      });
    }
    setBuildDate(null);
    delete monthCacheRef.current[`${year}-${month}`];
    cacheSave(monthCacheRef.current);
    await loadOutfits(year, month);
  }

  async function handleGenerate(overwriteAll = false) {
    setGenerating(true);
    setGenerateMsg(overwriteAll ? "Regenerating all outfits…" : "Styling your month…");
    try {
      const result = await callGenerate(year, month, userLoc?.lat, userLoc?.lon, overwriteAll || hasBrokenOutfits);
      if (!result.ok) { setGenerateError(result.message); return; }
      delete monthCacheRef.current[`${year}-${month}`];
      cacheSave(monthCacheRef.current);
      await loadOutfits(year, month);
    } finally {
      setGenerating(false);
    }
  }

  // Generates a future ungenerated month then navigates to it.
  // Shows a full-screen loading state (not the semi-transparent GeneratingOverlay)
  // so the user never sees a blank calendar for the pending month.
  async function handlePendingGenerate() {
    if (!pendingNav) return;
    const { year: pY, month: pM } = pendingNav;
    setPendingNav(null);
    setPendingGenerating(true);
    try {
      const result = await callGenerate(pY, pM, userLoc?.lat, userLoc?.lon);
      if (!result.ok) { setGenerateError(result.message); return; }
      const data = await fetch(`/api/outfits?year=${pY}&month=${pM}`).then(r => r.ok ? r.json() : {});
      monthCacheRef.current[`${pY}-${pM}`] = data as OutfitMap;
      cacheSave(monthCacheRef.current);
      setOutfits(data as OutfitMap);
      setLoading(false);
      setYear(pY);
      setMonth(pM);
    } finally {
      setPendingGenerating(false);
    }
  }

  const allCells        = getCalendarCells(year, month);
  // Tutorial samples: drop the trailing week rows that are all next month's (empty) days.
  const cells           = demo ? trimEmptyWeeks(allCells) : allCells;
  const onThisMonth     = year === today.getFullYear() && month === today.getMonth() + 1;
  const daysInMonth     = new Date(year, month, 0).getDate();
  const monthDates      = Array.from({ length: daysInMonth }, (_, i) => toDateStr(year, month, i + 1));
  // First-run tutorial: every day of the month shows a sample outfit (lib/client/tutorialSamples.ts)
  // — display only; nothing is fetched, generated or saved for them.
  const shownOutfits: OutfitMap = demo ? Object.fromEntries(monthDates.map((d, i) => {
    const o = sampleOutfitList[i % sampleOutfitList.length];
    return [d, { id: `sample-${d}`, garments: o }];
  })) : outfits;
  const blankDays       = monthDates.filter(d => !shownOutfits[d]).length;
  const hasBrokenOutfits = monthDates.some(d => shownOutfits[d] && shownOutfits[d].garments.length === 0);
  const needsGeneration = blankDays > 0 || hasBrokenOutfits;
  const hasCustomizedDay = monthDates.some(d => shownOutfits[d]?.customized);

  function onRegenClick() {
    // A full-month regen (nothing left blank/broken) deletes and replaces every day,
    // including ones the user hand-edited via the builder — confirm first when that's at risk.
    if (!needsGeneration && hasCustomizedDay) { setRegenConfirm(true); return; }
    handleGenerate(needsGeneration ? false : true);
  }

  // Precompute prev/next for the day detail modal navigation (stable, computed from current outfits)
  const validDatesForNav = Object.keys(shownOutfits)
    .filter(d => (shownOutfits[d]?.garments.length ?? 0) > 0)
    .sort();
  const navIdx         = detailDate ? validDatesForNav.indexOf(detailDate) : -1;
  const prevDetailDate = navIdx > 0 ? validDatesForNav[navIdx - 1] : null;
  const nextDetailDate = navIdx < validDatesForNav.length - 1 ? validDatesForNav[navIdx + 1] : null;

  // Block entire page render during initial 3-month setup
  // Every return below is wrapped in ReadyGate (components/ReadyGate.tsx): three dots until the
  // page is 100% ready, then everything at once — including while readiness (calReady) is still
  // unknown, so the calendar can't flash before switching to "add more items".
  if (!demo && (initializing || calReady === null)) return <ReadyGate ready={false} />;

  if (!demo && calReady === false) {
    return (
      <ReadyGate ready>
      <main className="center-lift" style={{ ...FONT, height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", padding: 24, boxSizing: "border-box" }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#999", textAlign: "center", margin: 0 }}>
          Add more items to activate your calendar!
        </p>
      </main>
      </ReadyGate>
    );
  }

  // Full-screen on initial page load (outfits state is empty — no prior month data in memory).
  // When navigating between months, outfits still holds the previous month's data so this
  // condition is false and the calendar shows with skeleton dots in each day cell instead.
  if (!demo && loading && Object.keys(outfits).length === 0) return <ReadyGate ready={false} />;

  // Full-screen loading while generating a newly-navigated future month
  if (!demo && pendingGenerating) return <ReadyGate ready={false} />;

  return (
    <ReadyGate ready>
    <main className="nav-row-host" style={{
      // --tut-bottom: the first-run tutorial's text strip under the calendar (0 otherwise).
      ...FONT, height: "calc(100dvh - var(--tut-bottom, 0px))", display: "flex", flexDirection: "column",
      padding: "20px 20px 16px", boxSizing: "border-box", background: "#fff",
    }}>
      <style suppressHydrationWarning>{WAVE_CSS}</style>
      {generating && <GeneratingOverlay message={generateMsg} />}

      {/* Generate-failure banner — dismissible, sits above the calendar rather than
          blocking it, since generation failures shouldn't lock the user out of the page. */}
      {generateError && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 2100,
          background: "#111", color: "#fff", padding: "12px 20px", maxWidth: 380,
          display: "flex", alignItems: "center", gap: 14, ...FONT,
        }}>
          <p style={{ fontSize: 10, letterSpacing: "0.04em", lineHeight: 1.5, margin: 0 }}>{generateError}</p>
          <button
            onClick={() => setGenerateError(null)}
            style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 13, flexShrink: 0, ...FONT }}
          >
            ✕
          </button>
        </div>
      )}

      {/* REGEN-on-customized-month confirmation — a full regen deletes every day this
          month, including manually-edited ones, so confirm before wiping them out. */}
      {regenConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000,
          background: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          ...FONT,
        }}>
          <div style={{
            background: "#fff", border: "1px solid #e8e8e8",
            padding: "36px 40px", maxWidth: 340, textAlign: "center",
            display: "flex", flexDirection: "column", gap: 18,
          }}>
            <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: "#111", margin: 0 }}>
              REGENERATE {MONTHS[month - 1]}?
            </p>
            <p style={{ fontSize: 11, letterSpacing: "0.06em", color: "#666", margin: 0, lineHeight: 1.6 }}>
              This month has outfits you customized by hand. Regenerating will replace every day, including your edits. This can't be undone.
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button
                onClick={() => { setRegenConfirm(false); handleGenerate(true); }}
                style={{ background: "#111", color: "#fff", border: "none", cursor: "pointer", padding: "10px 24px", fontSize: 9, letterSpacing: "0.18em", ...FONT }}
              >
                REPLACE ALL
              </button>
              <button
                onClick={() => setRegenConfirm(false)}
                style={{ background: "none", color: "#aaa", border: "1px solid #e0e0e0", cursor: "pointer", padding: "10px 24px", fontSize: 9, letterSpacing: "0.18em", ...FONT }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Future month confirmation — intercepts navigation BEFORE the month changes,
          so current calendar stays visible behind the modal. */}
      {pendingNav && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000,
          background: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          ...FONT,
        }}>
          <div style={{
            background: "#fff", border: "1px solid #e8e8e8",
            padding: "36px 40px", maxWidth: 320, textAlign: "center",
            display: "flex", flexDirection: "column", gap: 18,
          }}>
            <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: "#111", margin: 0 }}>
              {MONTHS[pendingNav.month - 1]} {pendingNav.year}
            </p>
            <p style={{ fontSize: 11, letterSpacing: "0.06em", color: "#666", margin: 0, lineHeight: 1.6 }}>
              Outfits haven't been generated for this month yet. Would you like to generate them now?
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button
                onClick={handlePendingGenerate}
                style={{ background: "#111", color: "#fff", border: "none", cursor: "pointer", padding: "10px 24px", fontSize: 9, letterSpacing: "0.18em", ...FONT }}
              >
                GENERATE
              </button>
              <button
                onClick={() => setPendingNav(null)}
                style={{ background: "none", color: "#aaa", border: "1px solid #e0e0e0", cursor: "pointer", padding: "10px 24px", fontSize: 9, letterSpacing: "0.18em", ...FONT }}
              >
                NOT NOW
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Month header — on mobile, on the nav icons' center line (.nav-row, globals.css). */}
      <div className="nav-row" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, marginBottom: 6, flexShrink: 0 }}>
        <button
          onClick={prevMonth}
          disabled={onThisMonth}
          style={{ background: "none", border: "none", cursor: onThisMonth ? "default" : "pointer", padding: "4px 8px", opacity: onThisMonth ? 0.1 : 1 }}
        >
          <svg width="10" height="17" viewBox="0 0 10 17"><polygon points="10,0 0,8.5 10,17" fill="#111" /></svg>
        </button>
        <p data-tutorial="calendar.title" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.2em", color: "#111", minWidth: 230, textAlign: "center", margin: 0 }}>
          {MONTHS[month - 1]} {year}
        </p>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px" }}>
          <svg width="10" height="17" viewBox="0 0 10 17"><polygon points="0,0 10,8.5 0,17" fill="#111" /></svg>
        </button>
      </div>

      {/* Sub-header: REGEN only — consistent across all months, no flicker */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, flexShrink: 0, minHeight: 22 }}>
        {!generating && (
          <button
            onClick={onRegenClick}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, letterSpacing: "0.14em", color: "#c8a800", ...FONT }}
          >
            REGEN
          </button>
        )}
      </div>

      {/* Location indicator — shows what place the weather-based outfit picks are based on,
          with a manual fallback for when browser geolocation was denied/unavailable. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, flexShrink: 0, minHeight: 16, position: "relative" }}>
        {userLoc ? (
          <button
            onClick={() => setShowLocInput(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 8, letterSpacing: "0.08em", color: "#bbb", ...FONT }}
          >
            WEATHER NEAR {locationLabel ? locationLabel.toUpperCase() : "…"}
          </button>
        ) : geoResolved ? (
          <button
            onClick={() => setShowLocInput(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 8, letterSpacing: "0.08em", color: "#c8a800", ...FONT }}
          >
            LOCATION UNAVAILABLE — SET MANUALLY
          </button>
        ) : null}

        {showLocInput && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 1500, background: "#fff", border: "1px solid #e0e0e0",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)", padding: 12, width: 220,
          }}>
            <input
              autoFocus
              value={locQuery}
              onChange={e => searchLocation(e.target.value)}
              placeholder="Enter a city…"
              style={{
                width: "100%", boxSizing: "border-box", border: "1px solid #ddd", padding: "7px 9px",
                fontSize: 11, letterSpacing: "0.02em", outline: "none", ...FONT,
              }}
            />
            {locBusy && <p style={{ fontSize: 9, color: "#bbb", margin: "8px 0 0" }}>Searching…</p>}
            {!locBusy && locResults.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                {locResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => chooseLocation(r)}
                    style={{
                      background: "none", border: "none", textAlign: "left", cursor: "pointer",
                      fontSize: 10, letterSpacing: "0.02em", color: "#333", padding: "5px 4px", ...FONT,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#f6f6f6"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Day-of-week labels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6, flexShrink: 0 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 9, letterSpacing: "0.13em", color: "#ccc", paddingBottom: 4 }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid — mobile trades per-day thumbnails for a compact numbers+dot grid
          (see MobileDayCell); the full outfit is one tap away in the day-detail view. */}
      <div
        data-tutorial="calendar.grid"
        style={{
          flex: isMobile ? "0 0 auto" : 1, minHeight: 0,
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: isMobile ? undefined : `repeat(${cells.length / 7}, 1fr)`,
          gap: 1, background: "#ebebeb",
        }}
      >
        {cells.map((cell, i) => {
          const ds = cell.current ? toDateStr(year, month, cell.day) : "";
          const isToday =
            cell.current && cell.day === today.getDate() &&
            month === today.getMonth() + 1 && year === today.getFullYear();
          const monthReady = demo || (!loading && !autoGenerating && `${year}-${month}` in weatherByMonth);
          const commonProps = {
            day: cell.day, current: cell.current, isToday,
            outfit: cell.current && monthReady ? shownOutfits[ds] : undefined,
            onClick: () => cell.current && monthReady && handleDayClick(ds),
            skeletal: !monthReady && cell.current,
          };
          return isMobile
            ? <MobileDayCell key={i} {...commonProps} />
            : <DayCell key={i} {...commonProps} weather={cell.current ? weather[ds] : undefined} />;
        })}
      </div>

      {/* Day detail overlay */}
      {!demo && detailDate && outfits[detailDate] && (
        <DayDetailModal
          key={detailDate}
          dateStr={detailDate}
          outfit={outfits[detailDate]}
          weather={weather[detailDate]}
          onClose={() => setDetailDate(null)}
          onPrev={prevDetailDate ? () => setDetailDate(prevDetailDate) : null}
          onNext={nextDetailDate ? () => setDetailDate(nextDetailDate) : null}
          allGarments={garments}
          onSaveEdit={async (ids) => {
            const existing = outfits[detailDate];
            if (existing) {
              await fetch("/api/outfits", {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: existing.id, garment_ids: ids }),
              });
            }
            // Silently refresh so the modal's outfit prop updates and the calendar
            // reflects the new garments when the user closes — no loading state shown
            const key = `${year}-${month}`;
            delete monthCacheRef.current[key];
            cacheSave(monthCacheRef.current);
            const res = await fetch(`/api/outfits?year=${year}&month=${month}`);
            if (res.ok) {
              const data = await res.json() as OutfitMap;
              monthCacheRef.current[key] = data;
              cacheSave(monthCacheRef.current);
              setOutfits(data);
            }
          }}
        />
      )}

      {/* Outfit builder overlay (broken / new day) */}
      {buildDate && (
        <OutfitBuilderModal
          dateStr={buildDate}
          garments={garments}
          existingIds={isEditing && outfits[buildDate] ? outfits[buildDate].garments.map(g => g.id) : undefined}
          onSave={handleSaveOutfit}
          onClose={() => setBuildDate(null)}
        />
      )}
    </main>
    </ReadyGate>
  );
}
