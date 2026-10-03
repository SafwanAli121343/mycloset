"use client";
import { invalidateClientCache } from "@/lib/clientCache";
import { KNOWN_AESTHETICS } from "@/lib/constants/attributes";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { gapTotalProgress, computeGapProgress } from "@/lib/wardrobeAnalysis";
import type { CrossedEntry } from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";

const FONT = { fontFamily: "Arial, sans-serif" };

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
const CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];
const SKIP_KEY   = "mycloset_skip_photo_tips";
const VALID_FITS = new Set(["slim", "regular", "relaxed", "oversized", "baggy", "tapered", "straight", "wide", "skinny", "boxy"]);

const DOT_KEYFRAMES = `
@keyframes dotFade {
  0%,80%,100% { opacity: 0; }
  40%          { opacity: 1; }
}
.adding-dot { animation: dotFade 1.2s infinite; display: inline-block; }
.adding-dot:nth-child(2) { animation-delay: 0.2s; }
.adding-dot:nth-child(3) { animation-delay: 0.4s; }
`;

const fieldInput: React.CSSProperties = {
  width: "100%", border: "none", padding: "7px 0", fontSize: 12,
  outline: "none", background: "transparent", boxSizing: "border-box",
  fontFamily: "Arial, sans-serif",
};

const fieldHint: React.CSSProperties = {
  position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
  fontSize: 12, color: "#ccc", pointerEvents: "none", fontFamily: "Arial, sans-serif",
};

type Tab     = "photo" | "url";
type AIFields = {
  title?: string; brand?: string; category?: string;
  color_primary?: string; material?: string; fit?: string; image?: string;
};

// ── T-shirt icon ─────────────────────────────────────────────────────────────

function TShirt({ size = 60, color = "#ccc", style = {} }: {
  size?: number; color?: string; style?: React.CSSProperties;
}) {
  const h = size * (90 / 100);
  return (
    <svg width={size} height={h} viewBox="0 0 100 90" style={style}>
      <path
        d="
          M 37 2
          L 4 0
          L 0 26
          L 21 33
          L 19 90
          L 81 90
          L 79 33
          L 100 26
          L 96 0
          L 63 2
          Q 57 17 50 17
          Q 43 17 37 2
          Z
        "
        fill={color}
      />
    </svg>
  );
}

// ── Tutorial slides ───────────────────────────────────────────────────────────

const SLIDES = [
  { title: "LAY IT FLAT",      body: "Place the item completely flat on a plain, solid-colour surface. Unfold it fully so all details are visible.", visual: "flat" },
  { title: "FILL THE FRAME",   body: "Get close enough that the item fills most of the photo. Leave only a small border of background around it.",  visual: "frame" },
  { title: "EVEN LIGHTING",    body: "Use soft, indirect light. Avoid harsh shadows from overhead lamps, camera flash, or direct sunlight.",         visual: "light" },
  { title: "PLAIN BACKGROUND", body: "A single-colour surface works best — white, grey, or black. Avoid patterns or other objects nearby.",          visual: "bg" },
  { title: "ONE ITEM ONLY",    body: "Each photo should contain exactly one item. For multiple pieces, photograph each one separately.",              visual: "one" },
];

function SlideVisual({ type }: { type: string }) {
  const wrap: React.CSSProperties = {
    height: 130, background: "#f5f5f5",
    display: "flex", alignItems: "center", justifyContent: "center",
    marginBottom: 20, gap: 10, padding: "0 16px",
  };
  const frame = (active: boolean): React.CSSProperties => ({
    flex: 1, maxWidth: 100, height: 96, position: "relative", overflow: "hidden",
    border: `2px solid ${active ? "#888" : "#ccc"}`,
    background: active ? "#ebebeb" : "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
  });
  const lbl = (active: boolean): React.CSSProperties => ({
    position: "absolute", bottom: 4, fontSize: 7,
    letterSpacing: "0.1em", color: active ? "#555" : "#aaa",
  });

  if (type === "flat") return (
    <div style={wrap}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <TShirt size={82} color="#ccc" />
        <div style={{ width: 130, height: 2, background: "#c0c0c0", marginTop: 3 }} />
      </div>
    </div>
  );

  if (type === "frame") return (
    <div style={wrap}>
      <div style={frame(false)}>
        <TShirt size={26} color="#bbb" />
        <span style={lbl(false)}>TOO FAR</span>
      </div>
      <div style={frame(true)}>
        <TShirt size={62} color="#999" />
        <span style={lbl(true)}>GOOD</span>
      </div>
    </div>
  );

  if (type === "light") return (
    <div style={wrap}>
      <div style={{ ...frame(false), background: "linear-gradient(130deg,#b8b8b8 20%,#888 100%)" }}>
        <TShirt size={44} color="rgba(210,210,210,0.55)" />
        <span style={{ ...lbl(false), color: "#ddd" }}>SHADOWS</span>
      </div>
      <div style={frame(true)}>
        <TShirt size={44} color="#bbb" />
        <span style={lbl(true)}>EVEN</span>
      </div>
    </div>
  );

  if (type === "bg") return (
    <div style={wrap}>
      <div style={{ ...frame(false), background: "transparent" }}>
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} style={{
            position: "absolute", width: "25%", height: "25%",
            background: i % 2 === 0 ? "#d8d8d8" : "#c4c4c4",
            left: `${(i % 4) * 25}%`, top: `${Math.floor(i / 4) * 25}%`,
          }} />
        ))}
        <TShirt size={38} color="#888" style={{ position: "relative", zIndex: 1 }} />
        <span style={{ ...lbl(false), zIndex: 1 }}>BUSY BG</span>
      </div>
      <div style={frame(true)}>
        <TShirt size={48} color="#bbb" />
        <span style={lbl(true)}>PLAIN</span>
      </div>
    </div>
  );

  if (type === "one") return (
    <div style={wrap}>
      <div style={frame(false)}>
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
          <TShirt size={24} color="#bbb" />
          <TShirt size={20} color="#c8c8c8" style={{ transform: "rotate(14deg) translateY(-5px)" }} />
          <TShirt size={18} color="#d0d0d0" style={{ transform: "rotate(-10deg) translateY(-2px)" }} />
        </div>
        <span style={lbl(false)}>MULTIPLE</span>
      </div>
      <div style={frame(true)}>
        <TShirt size={54} color="#aaa" />
        <span style={lbl(true)}>ONE ITEM</span>
      </div>
    </div>
  );

  return null;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AddItemPage() {
  const { user } = useAuth();

  const cameraRef  = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  const [tab, setTab]       = useState<Tab>("photo");
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [imagePreview, setImagePreview] = useState("");
  const [imageFile, setImageFile]       = useState<File | null>(null);
  const [title, setTitle]       = useState("");
  const [brand, setBrand]       = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor]       = useState("");
  const [material, setMaterial] = useState("");
  const [price, setPrice]       = useState("");
  const [fit, setFit]           = useState("");
  // Manual aesthetic — same as the app's AestheticPicker: available to every tier (it's the one
  // "AI" field a free user can set), never AI-filled, stored with aesthetic_source "manual".
  const [aesthetic, setAesthetic] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const [analyzing, setAnalyzing]         = useState(false);
  const [adding, setAdding]               = useState(false);
  const [analyzed, setAnalyzed]           = useState(false);
  const [showTutorial, setShowTutorial]   = useState(false);
  const [tutorialSlide, setTutorialSlide] = useState(0);
  const [showCamera, setShowCamera]           = useState(false);
  const [cameraErrMsg, setCameraErrMsg]       = useState<string | null>(null);
  const [noCameraDetected, setNoCameraDetected] = useState(false);
  const [cameraErrShake, setCameraErrShake]   = useState(false);
  const [galleryHover, setGalleryHover]       = useState(false);
  const [urlError, setUrlError]               = useState<string | null>(null);
  const [removingBg, setRemovingBg]           = useState(false);
  const [fieldError, setFieldError]           = useState<string | null>(null);

  // Attach stream to video element once the camera modal mounts
  useEffect(() => {
    if (showCamera && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [showCamera]);

  function showNotice(type: "ok" | "err", text: string) {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 3500);
  }

  function resetForm() {
    setImagePreview(""); setImageFile(null);
    setTitle(""); setBrand(""); setCategory("");
    setColor(""); setMaterial(""); setPrice(""); setFit(""); setAesthetic("");
    setUrlInput(""); setAnalyzed(false); setCameraErrMsg(null);
    setUrlError(null); setFieldError(null);
  }

  function applyAIFields(fields: AIFields) {
    if (fields.title)         setTitle(fields.title);
    if (fields.brand)         setBrand(fields.brand);
    if (fields.category)      setCategory(fields.category);
    if (fields.color_primary) setColor(fields.color_primary);
    if (fields.material)      setMaterial(fields.material);
    if (fields.fit)           setFit(fields.fit);
    if (fields.image)         setImagePreview(fields.image);
  }

  async function applyBgRemoval(imageUrl: string) {
    setRemovingBg(true);
    try {
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: imageUrl }),
        signal: AbortSignal.timeout(55000),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(blob);
    } catch {
      // Keep original image on failure
    } finally {
      setRemovingBg(false);
    }
  }

  // ── Camera (getUserMedia on desktop, file input fallback) ─────────────────

  async function startCamera() {
    setCameraErrMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setNoCameraDetected(true);
      setCameraErrMsg("No camera detected on this device. Select an image using the option below.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setShowCamera(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setNoCameraDetected(true);
        setCameraErrMsg("No camera detected on this device. Select an image using the option below.");
      } else {
        // Permission denied or hardware error — fall back to file picker silently
        cameraRef.current?.click();
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  }

  // Release the camera on unmount too (e.g. navigating away via back button or a
  // nav link while the camera modal is open) - the explicit close/capture buttons
  // already call stopCamera(), but nothing previously covered leaving the page any
  // other way, so the stream (and the hardware camera light) stayed on indefinitely.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    stopCamera();
    processCapture(dataUrl);
  }

  async function processCapture(dataUrl: string) {
    const file = dataUrlToFile(dataUrl, "photo.jpg");
    setImageFile(file);
    setImagePreview(dataUrl);
    setAnalyzed(false);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit(""); setAesthetic("");
    await runAIAnalysis(dataUrl, undefined);
  }

  // ── Tutorial ──────────────────────────────────────────────────────────────

  function launchCamera() {
    if (noCameraDetected) {
      setCameraErrMsg("No camera detected on this device. Select an image using the option below.");
      setCameraErrShake(true);
      setTimeout(() => setCameraErrShake(false), 500);
      return;
    }
    const skip = typeof window !== "undefined" && localStorage.getItem(SKIP_KEY) === "1";
    if (skip) { startCamera(); return; }
    setTutorialSlide(0);
    setShowTutorial(true);
  }

  function closeTutorial()  { setShowTutorial(false); startCamera(); }
  function neverShow()      {
    if (typeof window !== "undefined") localStorage.setItem(SKIP_KEY, "1");
    setShowTutorial(false);
    startCamera();
  }

  // ── AI analysis ───────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const raw    = await fileToDataUrl(file);
    const dataUrl = await normalizeToJpeg(raw); // AVIF/HEIC → JPEG before sending to server
    setImagePreview(dataUrl);
    setAnalyzed(false);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit(""); setAesthetic("");
    await runAIAnalysis(dataUrl, undefined);
  }

  async function handleUrlAnalyze() {
    if (!urlInput.trim()) return;
    setUrlError(null);
    setAnalyzing(true); setAnalyzed(false);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit(""); setAesthetic("");
    const ok = await runAIAnalysis(undefined, urlInput.trim());
    if (!ok) setUrlError("Couldn't retrieve a product from that link. Try a different URL, or add the item by uploading a photo.");
    setAnalyzing(false);
  }

  async function runAIAnalysis(imageDataUrl?: string, productUrl?: string): Promise<boolean> {
    setAnalyzing(true);
    try {
      const res  = await fetch("/api/garments/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, productUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (!productUrl) showNotice("err", json.error ?? "Analysis failed — fill in fields manually.");
        return false;
      }
      applyAIFields(json as AIFields);
      setAnalyzed(true);
      // Kick off background removal non-blocking — image updates when ready
      const imageToProcess = productUrl ? (json as AIFields).image : imageDataUrl;
      if (imageToProcess) applyBgRemoval(imageToProcess);
      return true;
    } catch {
      if (!productUrl) showNotice("err", "Analysis failed — fill in fields manually.");
      return false;
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAdd() {
    if (!title.trim() || !category || !user?.id) return;

    // Field validation
    if (fit.trim() && !VALID_FITS.has(fit.trim().toLowerCase())) {
      setFieldError(`"${fit.trim()}" is not a valid fit. Use: slim, regular, relaxed, oversized, baggy, tapered, straight, wide, skinny, or boxy.`);
      return;
    }
    setFieldError(null);

    setAdding(true);

    let finalImage = imagePreview || undefined;
    let res: Response;
    try {
      if (imageFile) {
        const fd = new FormData();
        fd.append("file", imageFile);
        const up = await fetch("/api/garments/upload-image", { method: "POST", body: fd });
        if (up.ok) finalImage = (await up.json()).url;
      }

      res = await fetch("/api/garments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manual: true,
          title: title.trim(), brand: brand.trim() || undefined,
          color_primary: color.trim() || undefined, material: material.trim() || undefined,
          price: price.trim() || undefined, fit: fit.trim() || undefined,
          aesthetic: aesthetic.trim() || undefined,
          image: finalImage, category, user_id: user.id,
          link: tab === "url" ? urlInput : undefined,
        }),
      });
    } catch {
      showNotice("err", "Couldn't reach the server — check your connection and try again.");
      setAdding(false);
      return;
    }

    if (!res.ok) { showNotice("err", "Something went wrong. Please try again."); setAdding(false); return; }
    // The wardrobe changed — drop every page's cached copy that depends on it (lib/clientCache.ts)
    // so Closet/Outfits/Builder show the new item on their next visit instead of the old list.
    invalidateClientCache();
    const saved = await res.json() as {
      id?: string | null;
      title?: string | null; sub_type?: string | null; category?: string | null;
      color_primary?: string | null; aesthetic_tags?: string[] | null;
      functional_slot?: string | null; image?: string | null;
      pattern?: string | null;
    };

    // Update the WA cache: compute which gaps/colors/aesthetics/cons the new item crosses,
    // record them with garment attribution, update localStorage, and fire-and-forget to backend.
    try {
      const WA_KEY    = "wa_cache_v20";
      const garmentId = saved.id ?? "";
      const raw       = localStorage.getItem(WA_KEY);

      type WACacheV7 = {
        pieceCount: number;
        backendState: {
          analysisHistory: Array<{
            score: number;
            gaps: Array<{ description: string; costPoints?: number }>;
            cons: string[];
            colors: { have: string[]; missing: string[] };
            aesthetics: { covered: unknown[]; missing: string[] };
            conGapLinks?: Record<string, string>;
          }>;
          crossed: Array<{ category: string; key: string; garmentId: string; analysisLevel: number; progress?: number }>;
          currentLevel: number;
        };
      };

      if (raw) {
        const cache    = JSON.parse(raw) as WACacheV7 & { removedCrossings?: Record<string, WACacheV7["backendState"]["crossed"]> };
        const bs       = cache.backendState;
        const level    = bs.currentLevel;
        const analysis = bs.analysisHistory[level - 1];

        // If this exact item was previously removed, restore its crossings first so the
        // score delta on re-add exactly matches the delta on remove.
        const prevCrossings = cache.removedCrossings?.[garmentId];
        if (prevCrossings && prevCrossings.length > 0) {
          bs.crossed = [...bs.crossed, ...prevCrossings];
          delete cache.removedCrossings![garmentId];
          // pieceCount and cache save happen in the normal flow below — don't double-increment.
          fetch("/api/wardrobe/state/cross", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(prevCrossings),
          }).catch(() => {});
          // Fall through — fresh analysis below will skip already-restored entries and add any new-level crossings.
        }

        if (analysis) {
          const sub  = (saved.sub_type ?? "").toLowerCase();
          const cat  = (saved.category ?? category ?? "").toLowerCase();
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

          // Pattern/aesthetic inference — item-specific, used across all levels
          const patternStr = (saved.pattern ?? "").toLowerCase();
          const titleStr   = (saved.title   ?? saved.sub_type ?? "").toLowerCase();
          const patternImplied: string[] = [];
          if (patternStr.includes("camo") || titleStr.includes("camo") || titleStr.includes("camouflage"))
            patternImplied.push("military", "gorpcore");
          if (patternStr.includes("plaid") || patternStr.includes("tartan") || titleStr.includes("plaid"))
            patternImplied.push("preppy", "ivy league");
          if (patternStr.includes("tie-dye") || patternStr.includes("tie dye") || titleStr.includes("tie dye"))
            patternImplied.push("y2k");
          const aestheticCandidates = [...new Set([...(saved.aesthetic_tags ?? []), ...patternImplied])];

          const newEntries: WACacheV7["backendState"]["crossed"] = [];

          // ── Algorithmic crossing for ALL prior levels ──────────────────────────
          // Ensures removing-then-re-adding an item restores its full score delta
          // even when it was originally added at a lower level.
          for (let L = 1; L < level; L++) {
            const priorA = bs.analysisHistory[L - 1];
            if (!priorA) continue;
            const priorColKeys = new Set(bs.crossed.filter(e => e.category === "color"     && e.analysisLevel === L).map(e => e.key));
            const priorAesKeys = new Set(bs.crossed.filter(e => e.category === "aesthetic" && e.analysisLevel === L).map(e => e.key));
            const priorConKeys = new Set(bs.crossed.filter(e => e.category === "con"       && e.analysisLevel === L).map(e => e.key));
            for (const g of priorA.gaps) {
              if (gapTotalProgress(bs.crossed as CrossedEntry[], g.description, L) >= 100) continue;
              if (bs.crossed.some((e: { category: string; key: string; garmentId: string; analysisLevel: number }) =>
                e.category === "gap" && e.key === g.description && e.garmentId === garmentId && e.analysisLevel === L)) continue;
              const progress = computeGapProgress(g.description, saved.sub_type, saved.category ?? category, saved.functional_slot);
              if (progress > 0) newEntries.push({ category: "gap", key: g.description, garmentId, analysisLevel: L, progress });
            }
            if (saved.color_primary) {
              for (const c of priorA.colors.missing) {
                if (priorColKeys.has(c)) continue;
                if (sameColorGroup(saved.color_primary, c)) newEntries.push({ category: "color", key: c, garmentId, analysisLevel: L });
              }
            }
            for (const tag of aestheticCandidates) {
              const nt = norm(tag);
              for (const a of priorA.aesthetics.missing) {
                if (priorAesKeys.has(a)) continue;
                if (norm(a) === nt) newEntries.push({ category: "aesthetic", key: a, garmentId, analysisLevel: L });
              }
            }
            // Cons: same keyword-match logic as current level
            const priorConGapLinks = (priorA.conGapLinks ?? {}) as Record<string, string>;
            // Lowercased at the source — con.includes(d) and the linkedGap lookup below both
            // compare against an already-lowercased `con`, so a gap description with any
            // uppercase letters (most of them, since they're written as normal sentences) would
            // otherwise never match at all. Matches native's own conMatches, which already does
            // this (native/lib/wardrobeCrossing.ts) — this was the one place native was actually
            // right and the site had the bug.
            const priorCrossedGapKeys = new Set([
              ...priorA.gaps.filter(g => gapTotalProgress(bs.crossed as CrossedEntry[], g.description, L) >= 100).map(g => g.description.toLowerCase()),
              ...newEntries.filter(e => e.category === "gap" && e.analysisLevel === L).map(e => e.key.toLowerCase()),
            ]);
            for (let i = 0; i < priorA.cons.length; i++) {
              if (priorConKeys.has(String(i))) continue;
              const con = priorA.cons[i].toLowerCase();
              const linkedGap = priorConGapLinks[String(i)];
              const matches =
                (sub && con.includes(sub)) ||
                (cat && con.includes(cat)) ||
                (linkedGap && priorCrossedGapKeys.has(linkedGap.toLowerCase())) ||
                [...priorCrossedGapKeys].some(d => con.includes(d));
              if (matches) newEntries.push({ category: "con", key: String(i), garmentId, analysisLevel: L });
            }
          }

          // ── Current level: algorithmic + AI gap-check ──────────────────────────
          const existingColKeys = new Set(bs.crossed.filter(e => e.category === "color"     && e.analysisLevel === level).map(e => e.key));
          const existingAesKeys = new Set(bs.crossed.filter(e => e.category === "aesthetic" && e.analysisLevel === level).map(e => e.key));
          const existingConKeys = new Set(bs.crossed.filter(e => e.category === "con"       && e.analysisLevel === level).map(e => e.key));

          for (const g of analysis.gaps) {
            const totalSoFar = gapTotalProgress(bs.crossed as CrossedEntry[], g.description, level);
            if (totalSoFar >= 100) continue;
            const alreadyContributed = bs.crossed.some(
              (e: { category: string; key: string; garmentId: string; analysisLevel: number }) =>
                e.category === "gap" && e.key === g.description && e.garmentId === garmentId && e.analysisLevel === level
            );
            if (alreadyContributed) continue;
            const progress = computeGapProgress(g.description, saved.sub_type, saved.category ?? category, saved.functional_slot);
            if (progress > 0) newEntries.push({ category: "gap", key: g.description, garmentId, analysisLevel: level, progress });
          }

          if (saved.color_primary) {
            for (const c of analysis.colors.missing) {
              if (existingColKeys.has(c)) continue;
              if (sameColorGroup(saved.color_primary, c)) newEntries.push({ category: "color", key: c, garmentId, analysisLevel: level });
            }
          }

          for (const tag of aestheticCandidates) {
            const nt = norm(tag);
            for (const a of analysis.aesthetics.missing) {
              if (existingAesKeys.has(a)) continue;
              if (norm(a) === nt) newEntries.push({ category: "aesthetic", key: a, garmentId, analysisLevel: level });
            }
          }

          // Gaps already fully resolved + gaps newly touched by this item (for con-linking).
          // Lowercased at the source, same reasoning as priorCrossedGapKeys above.
          const allCrossedGapKeys = new Set([
            ...analysis.gaps
              .filter(g => gapTotalProgress(bs.crossed as CrossedEntry[], g.description, level) >= 100)
              .map(g => g.description.toLowerCase()),
            ...newEntries.filter(e => e.category === "gap").map(e => e.key.toLowerCase()),
          ]);
          const conGapLinks = (analysis.conGapLinks ?? {}) as Record<string, string>;
          for (let i = 0; i < analysis.cons.length; i++) {
            if (existingConKeys.has(String(i))) continue;
            const con = analysis.cons[i].toLowerCase();
            const linkedGap = conGapLinks[String(i)];
            const matches =
              (sub && con.includes(sub)) ||
              (cat && con.includes(cat)) ||
              (linkedGap && allCrossedGapKeys.has(linkedGap.toLowerCase())) ||
              [...allCrossedGapKeys].some(d => con.includes(d));
            if (matches) newEntries.push({ category: "con", key: String(i), garmentId, analysisLevel: level });
          }

          // Determine which gaps had 0 algorithmic progress — ask AI + image for those
          const algorithmicGapKeys = new Set(newEntries.filter(e => e.category === "gap").map(e => e.key));
          const unmatched = analysis.gaps.filter(g =>
            !algorithmicGapKeys.has(g.description) &&
            gapTotalProgress(bs.crossed as CrossedEntry[], g.description, level) < 100
          );

          const applyEntries = (extra: typeof newEntries) => {
            const all = [...newEntries, ...extra];
            if (all.length > 0) {
              bs.crossed = [...bs.crossed, ...all];
              localStorage.setItem(WA_KEY, JSON.stringify(cache));
              fetch("/api/wardrobe/state/cross", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(all),
              }).catch(() => {});
            }
          };

          cache.pieceCount += 1;
          localStorage.setItem(WA_KEY, JSON.stringify(cache));

          // Collect everything the algorithmic pass missed, per category
          const algorithmicAesKeys    = new Set(newEntries.filter(e => e.category === "aesthetic").map(e => e.key));
          const algorithmicColorKeys  = new Set(newEntries.filter(e => e.category === "color").map(e => e.key));
          const algorithmicConKeys    = new Set(newEntries.filter(e => e.category === "con").map(e => e.key));

          const unmatchedAes   = analysis.aesthetics.missing.filter(a => !existingAesKeys.has(a) && !algorithmicAesKeys.has(a));
          const unmatchedColor = analysis.colors.missing.filter(c => !existingColKeys.has(c) && !algorithmicColorKeys.has(c));
          const unmatchedCons  = analysis.cons
            .map((con, i) => ({ con, i }))
            .filter(({ i }) => !existingConKeys.has(String(i)) && !algorithmicConKeys.has(String(i)))
            .map(({ con }) => con);

          const hasImageWork = (unmatched.length || unmatchedAes.length || unmatchedColor.length || unmatchedCons.length) && saved.image;

          if (hasImageWork) {
            fetch("/api/wardrobe/gap-check", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sub_type: saved.sub_type, category: saved.category ?? category, image: saved.image,
                gap_descriptions: unmatched.map(g => g.description),
                aesthetic_gaps:   unmatchedAes,
                color_gaps:       unmatchedColor,
                weakness_gaps:    unmatchedCons,
              }),
            }).then(r => r.json()).then((res: {
              gap_fills?: string[]; aesthetic_fills?: string[];
              color_fills?: string[]; weakness_fills?: string[];
            }) => {
              const aiEntries: typeof newEntries = [];
              for (const d of (res.gap_fills ?? [])) {
                if (unmatched.some(g => g.description === d))
                  aiEntries.push({ category: "gap" as const, key: d, garmentId, analysisLevel: level, progress: 100 });
              }
              for (const a of (res.aesthetic_fills ?? [])) {
                if (unmatchedAes.includes(a))
                  aiEntries.push({ category: "aesthetic" as const, key: a, garmentId, analysisLevel: level });
              }
              for (const c of (res.color_fills ?? [])) {
                if (unmatchedColor.includes(c) && (!saved.color_primary || sameColorGroup(saved.color_primary, c)))
                  aiEntries.push({ category: "color" as const, key: c, garmentId, analysisLevel: level });
              }
              for (const w of (res.weakness_fills ?? [])) {
                const idx = analysis.cons.indexOf(w);
                if (idx !== -1 && !existingConKeys.has(String(idx)))
                  aiEntries.push({ category: "con" as const, key: String(idx), garmentId, analysisLevel: level });
              }
              // Infer aesthetics from all gap fills (algorithmic + AI)
              const allGapFills = [
                ...newEntries.filter(e => e.category === "gap").map(e => e.key),
                ...(res.gap_fills ?? []),
              ];
              const crossedAesNorms = new Set([
                ...existingAesKeys,
                ...algorithmicAesKeys,
                ...aiEntries.filter(e => e.category === "aesthetic").map(e => norm(e.key)),
              ]);
              for (const gap of allGapFills) {
                const gl = gap.toLowerCase();
                for (const [kw, aes] of GAP_AES) {
                  if (gl.includes(kw)) {
                    for (const a of aes) {
                      if (analysis.aesthetics.missing.includes(a) && !crossedAesNorms.has(norm(a))) {
                        aiEntries.push({ category: "aesthetic" as const, key: a, garmentId, analysisLevel: level });
                        crossedAesNorms.add(norm(a));
                      }
                    }
                  }
                }
              }
              applyEntries(aiEntries);
            }).catch(() => applyEntries([]));
          } else {
            applyEntries([]);
          }
        }
      } else {
        localStorage.removeItem(WA_KEY);
      }
    } catch { try { localStorage.removeItem("wa_cache_v20"); } catch {} }

    // Pre-compute pairings so the closet never shows "no items pair with this"
    if (saved.id) {
      fetch(`/api/garments/pairings?id=${saved.id}`).catch(() => {});
    }

    showNotice("ok", "ITEM ADDED TO CLOSET");
    resetForm();
    setAdding(false);
  }

  function tabBtn(t: Tab) {
    const active = tab === t;
    return {
      background: "none", border: "none", borderBottom: "none",
      cursor: "pointer", fontSize: 9, letterSpacing: "0.18em",
      textTransform: "uppercase" as const,
      color: active ? "#111" : "#bbb",
      fontWeight: active ? 700 : 400,
      paddingBottom: 6, paddingLeft: 0, paddingRight: 0, marginRight: 24,
      fontFamily: "Arial, sans-serif",
    };
  }

  const canAdd = !!(title.trim() && category && !adding);
  const slide  = SLIDES[tutorialSlide];
  const isLast = tutorialSlide === SLIDES.length - 1;

  const translateY = tab === "photo" ? "translateY(-2vh)" : "translateY(-4vh)";

  return (
    <main className="center-lift" style={{ ...FONT, minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3vh 5vw calc(3vh + 60px + var(--safe-bottom))" }}>
      <style suppressHydrationWarning>{`
        @keyframes errShake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-5px); }
          40%       { transform: translateX(5px); }
          60%       { transform: translateX(-4px); }
          80%       { transform: translateX(4px); }
        }
        ${DOT_KEYFRAMES}
      `}</style>

      {/* ── Camera modal ──────────────────────────────────────────────────────── */}
      {showCamera && (
        <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", maxHeight: "72vh", objectFit: "cover" }}
          />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 28 }}>
            <button
              onClick={capturePhoto}
              style={{ width: 68, height: 68, borderRadius: "50%", background: "#fff", border: "5px solid rgba(255,255,255,0.35)", cursor: "pointer", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 36 }}>
              <button
                onClick={() => { stopCamera(); galleryRef.current?.click(); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", ...FONT }}
              >
                UPLOAD INSTEAD
              </button>
              <button
                onClick={stopCamera}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", ...FONT }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tutorial modal ────────────────────────────────────────────────────── */}
      {showTutorial && (
        <div
          onClick={e => { if (e.target === e.currentTarget) closeTutorial(); }}
          style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px" }}
        >
          <div style={{ background: "#fff", width: "100%", maxWidth: 360, padding: "28px 24px", transform: "translateY(-8vh)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 5 }}>
                {SLIDES.map((_, i) => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === tutorialSlide ? "#111" : "#ddd" }} />
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={closeTutorial} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, color: "#bbb", letterSpacing: "0.1em", textTransform: "uppercase", padding: 0, ...FONT }}>
                  SKIP
                </button>
              </div>
            </div>

            <SlideVisual type={slide.visual} />

            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8, ...FONT }}>
              {slide.title}
            </p>
            <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 24, ...FONT }}>
              {slide.body}
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={() => setTutorialSlide(s => s - 1)}
                style={{ background: "none", border: "none", cursor: tutorialSlide > 0 ? "pointer" : "default", fontSize: 10, color: "#888", letterSpacing: "0.1em", textTransform: "uppercase", padding: 0, visibility: tutorialSlide > 0 ? "visible" : "hidden", ...FONT }}
              >
                {"< BACK"}
              </button>
              <button
                onClick={isLast ? closeTutorial : () => setTutorialSlide(s => s + 1)}
                style={{ background: "none", border: "none", padding: 0, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", color: "#111", fontWeight: 700, ...FONT }}
              >
                {isLast ? "TAKE PHOTO" : "NEXT →"}
              </button>
            </div>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button onClick={neverShow} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, color: "#ccc", letterSpacing: "0.1em", textTransform: "uppercase", padding: 0, ...FONT }}>
                Don&apos;t show this again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 420, transform: translateY }}>

        <div data-tutorial="add.main" style={{ display: "flex", justifyContent: "center", marginBottom: 0 }}>
          <button style={tabBtn("photo")} onClick={() => { setTab("photo"); resetForm(); }}>UPLOAD PHOTO</button>
          <button style={tabBtn("url")}   onClick={() => { setTab("url");   resetForm(); }}>PASTE URL</button>
        </div>

        <div style={{ width: "100%" }}>

          {/* ── PHOTO TAB ───────────────────────────────────────────────────── */}
          {tab === "photo" && (
            <div style={{ marginBottom: 32 }}>
              {/* Fallback file inputs */}
              <input ref={cameraRef}  type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFileChange} />
              <input ref={galleryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />

              {!imagePreview ? (
                <>
                  <div
                    onClick={launchCamera}
                    style={{
                      width: "100%", aspectRatio: "1",
                      border: "1px dashed #ccc", background: "#fafafa",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", marginBottom: 16,
                    }}
                  >
                    <p style={{ fontSize: 10, letterSpacing: "0.14em", color: "#888", textTransform: "uppercase", textAlign: "center", padding: "0 24px" }}>
                      TAP TO TAKE PHOTO OF ITEM
                    </p>
                  </div>

                  {cameraErrMsg && (
                    <div style={{
                      border: "1.5px solid #c00", background: "#fff5f5",
                      padding: "10px 14px", marginBottom: 12, textAlign: "center",
                      animation: cameraErrShake ? "errShake 0.5s ease" : "none",
                    }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#c00", letterSpacing: "0.07em", lineHeight: 1.55, margin: 0, ...FONT }}>
                        {cameraErrMsg}
                      </p>
                    </div>
                  )}

                  <div style={{ textAlign: "center" }}>
                    <button
                      onClick={() => galleryRef.current?.click()}
                      onMouseEnter={() => setGalleryHover(true)}
                      onMouseLeave={() => setGalleryHover(false)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                        color: galleryHover ? "#444" : "#bbb",
                        padding: 0,
                        fontFamily: "Arial, sans-serif", transition: "color 0.15s",
                      }}
                    >
                      OR, UPLOAD AN IMAGE
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <img src={imagePreview} alt="preview" style={{ maxHeight: 280, maxWidth: "100%", display: "block", objectFit: "contain" }} />
                    <button
                      onClick={() => { resetForm(); launchCamera(); }}
                      style={{ position: "absolute", top: 6, right: 6, background: "none", color: "#b8860b", border: "none", fontSize: 9, letterSpacing: "0.1em", padding: "4px 8px", cursor: "pointer", textTransform: "uppercase", fontWeight: 700, ...FONT }}
                    >
                      CHANGE
                    </button>
                  </div>
                </div>
              )}

              {analyzing && (
                <p style={{ fontSize: 10, color: "#aaa", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 12, textAlign: "center" }}>
                  ANALYZING IMAGE…
                </p>
              )}
              {!analyzing && removingBg && imagePreview && (
                <p style={{ fontSize: 10, color: "#aaa", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 12, textAlign: "center" }}>
                  REMOVING BACKGROUND…
                </p>
              )}
            </div>
          )}

          {/* ── URL TAB ─────────────────────────────────────────────────────── */}
          {tab === "url" && (
            <div style={{ marginBottom: 32 }}>
              {!analyzed && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                <input
                  type="url" placeholder="https://..."
                  value={urlInput} onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleUrlAnalyze()}
                  style={{ flex: 1, border: "none", borderBottom: "1px solid #ddd", padding: "10px 0", fontSize: 12, outline: "none", fontFamily: "Arial, sans-serif", background: "transparent" }}
                />
                <button
                  onClick={handleUrlAnalyze} disabled={!urlInput.trim() || analyzing}
                  onMouseEnter={e => { if (urlInput.trim() && !analyzing) (e.currentTarget as HTMLButtonElement).style.color = "#111"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = (!urlInput.trim() || analyzing) ? "#ddd" : "#bbb"; }}
                  style={{
                    background: "none", border: "none", padding: 0, flexShrink: 0,
                    fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                    fontFamily: "Arial, sans-serif", cursor: urlInput.trim() && !analyzing ? "pointer" : "default",
                    color: analyzing ? "#111" : (!urlInput.trim() ? "#ddd" : "#bbb"),
                    fontWeight: analyzing ? 700 : 400,
                    transition: "color 0.15s",
                  }}
                >
                  {analyzing ? <><span className="adding-dot">.</span><span className="adding-dot">.</span><span className="adding-dot">.</span></> : "ANALYZE"}
                </button>
              </div>
              )}


              {imagePreview && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
                  <img src={imagePreview} alt="preview" referrerPolicy="no-referrer" crossOrigin="anonymous" style={{ maxHeight: 180, maxWidth: "100%", objectFit: "contain", display: "block" }} />
                  {removingBg && (
                    <p style={{ fontSize: 10, color: "#aaa", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 8 }}>
                      REMOVING BACKGROUND…
                    </p>
                  )}
                </div>
              )}
              {urlError && (
                <p style={{ fontSize: 11, fontWeight: 700, color: "#c00", letterSpacing: "0.06em", lineHeight: 1.55, marginTop: 8, ...FONT }}>
                  {urlError}
                </p>
              )}
            </div>
          )}

          {/* ── SHARED FIELDS ───────────────────────────────────────────────── */}
          {(analyzed || imagePreview) && !analyzing && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              <div style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
                <input value={title} onChange={e => setTitle(e.target.value)} style={{ ...fieldInput, paddingRight: 60 }} />
                <span style={fieldHint}>Name <span style={{ color: "#e00" }}>*</span></span>
              </div>

              <div style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
                <input value={brand} onChange={e => setBrand(e.target.value)} style={{ ...fieldInput, paddingRight: 52 }} />
                <span style={fieldHint}>Brand</span>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap", padding: "2px 0" }}>
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => setCategory(cat)} style={{
                    background: "none", border: "none", cursor: "pointer", padding: "2px 0",
                    fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                    fontWeight: category === cat ? 700 : 400,
                    color: category === cat ? "#111" : "#bbb",
                    fontFamily: "Arial, sans-serif",
                  }}>
                    {cat}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
                  <input value={color} onChange={e => setColor(e.target.value)} style={{ ...fieldInput, paddingRight: 50 }} />
                  <span style={fieldHint}>Color</span>
                </div>
                <div style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
                  <input value={material} onChange={e => setMaterial(e.target.value)} style={{ ...fieldInput, paddingRight: 66 }} />
                  <span style={fieldHint}>Material</span>
                </div>
                <div style={{ position: "relative", borderBottom: fit.trim() && !VALID_FITS.has(fit.trim().toLowerCase()) ? "1px solid #c00" : "1px solid #ddd" }}>
                  <input
                    value={fit}
                    onChange={e => { setFit(e.target.value); setFieldError(null); }}
                    style={{ ...fieldInput, paddingRight: 32 }}
                  />
                  <span style={fieldHint}>Fit</span>
                </div>
                <div style={{ position: "relative", borderBottom: "1px solid #ddd" }}>
                  <input value={price} onChange={e => setPrice(e.target.value)} style={{ ...fieldInput, paddingRight: 44 }} />
                  <span style={fieldHint}>Price</span>
                </div>
                {/* Full width; the datalist gives type-or-pick suggestions from the same list
                   the app's picker and the AI classifier use. */}
                <div style={{ position: "relative", borderBottom: "1px solid #ddd", gridColumn: "1 / -1" }}>
                  <input value={aesthetic} onChange={e => setAesthetic(e.target.value)} list="aesthetic-options" style={{ ...fieldInput, paddingRight: 72 }} />
                  <span style={fieldHint}>Aesthetic</span>
                  <datalist id="aesthetic-options">
                    {KNOWN_AESTHETICS.map(a => <option key={a} value={a} />)}
                  </datalist>
                </div>
              </div>

              {fieldError && (
                <p style={{ fontSize: 11, fontWeight: 700, color: "#c00", letterSpacing: "0.05em", lineHeight: 1.55, margin: 0, ...FONT }}>
                  {fieldError}
                </p>
              )}

              <div style={{ display: "flex", gap: 28, marginTop: 6, justifyContent: "center", width: "100%", paddingLeft: 20 }}>
                <button
                  onClick={resetForm}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "9px 0",
                    fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                    color: "#c00", fontFamily: "Arial, sans-serif" }}
                >
                  CANCEL
                </button>
                <button
                  onClick={handleAdd} disabled={!canAdd}
                  style={{ background: "none", border: "none", cursor: canAdd ? "pointer" : "default", padding: "9px 0",
                    fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                    color: canAdd ? "#2e7d32" : "#aaa", fontFamily: "Arial, sans-serif" }}
                >
                  {adding ? <>ADDING<span className="adding-dot">.</span><span className="adding-dot">.</span><span className="adding-dot">.</span></> : "ADD TO CLOSET"}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div style={{ position: "fixed", bottom: 48, left: "50%", transform: "translateX(-50%)", zIndex: 1000, background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", padding: "16px 32px", pointerEvents: "none" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: notice.type === "ok" ? "#2e7d32" : "#c00", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap" }}>
            {notice.text}
          </p>
        </div>
      )}
    </main>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Convert any image format (AVIF, HEIC, WebP, etc.) to JPEG in the browser.
// The browser's canvas handles decoding; output is always a JPEG data URL.
// Falls back to the original if the browser can't decode the format.
function normalizeToJpeg(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/png")) {
    return Promise.resolve(dataUrl);
  }
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(",");
  const mime   = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}
