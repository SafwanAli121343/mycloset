"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { setTutorialDemo } from "@/lib/client/tutorialState";

// The website's first-run tutorial — same steps and wording as the app's
// native/components/TutorialOverlay.tsx, laid out differently: the app shrinks each page into a
// preview card (phones have no spare room), while a computer screen does — so here each step
// opens the real page at full size and puts the text in empty space right beside the feature,
// with an arrow across the gap to it. The spot is chosen by measuring everything visible on the
// page, so the text and arrow never cover anything. Offered once per new account ("TUTORIAL?"
// YES / NO, /api/user/tutorial). The nav stays hidden until the last step, which explains it.

type Zone = { x: number; y: number; w: number; h: number }; // fractions of the viewport
// target: the data-tutorial marker to point at. Without one, the tour points at the page's main
// content as a whole (the area everything visible on it spans).
// roomBelow: the page has no free space at all (Calendar fills the window) — it's made a little
// shorter (via --tut-bottom) to open a strip underneath for the text, instead of shifting it down.
type Step = { href: string; title: string; text: string; target?: string; zone?: Zone; navbar?: boolean; settingsPage?: string; where?: string; roomBelow?: boolean };

const STEPS: Step[] = [
  { href: "/closet", target: "closet.main", zone: { x: 0.06, y: 0.16, w: 0.88, h: 0.4 }, title: "MY CLOSET", where: "Open it any time with MY CLOSET on the main menu.",
    text: "Every piece you own lives here; flip through with the arrows. The score, pros and cons and pairings on each piece are AI analysis, part of MyCloset Pro." },
  { href: "/add-item", target: "add.main", zone: { x: 0.08, y: 0.08, w: 0.84, h: 0.1 }, title: "ADD ITEMS", where: "Open it with ADD ITEM on the main menu.",
    text: "Add pieces by uploading a photo or pasting a product link. The details get filled in for you." },
  { href: "/calendar", target: "calendar.grid", roomBelow: true, title: "CALENDAR", where: "Open it with CALENDAR on the main menu.",
    text: "An outfit planned for every day of the month, matched to your weather. Tap a day to see it." },
  { href: "/outfits", target: "outfits.grid", title: "OUTFITS", where: "Open it with OUTFITS on the main menu.",
    text: "Every outfit your closet can make, best first. Click a stack to spread it out. Outfit scores and analysis are part of MyCloset Pro." },
  { href: "/builder", target: "builder.slots", title: "BUILD", where: "Open it with BUILDER on the main menu.",
    text: "Put together your own outfit, piece by piece, and see how it scores." },
  { href: "/preview", target: "preview.slot", title: "PREVIEW", where: "Open it with PREVIEW on the main menu.",
    text: "Thinking of buying something? See how it would fit your wardrobe before you buy it." },
  { href: "/wardrobe-analysis", target: "wardrobe.box", title: "WARDROBE", where: "Open it with WARDROBE on the main menu.",
    text: "Your wardrobe report: an overall score, plus the gaps, missing colors and weaknesses to work on next. The report needs MyCloset Pro (or a one-time Full Wardrobe Analysis)." },
  { href: "/upgrade", target: "upgrade.plans", title: "UPGRADE", where: "Open it with UPGRADE on the main menu.",
    text: "Go Pro for every AI feature, or buy a one-time item score or full wardrobe analysis, right here." },
  { href: "/settings", settingsPage: "FEEDBACK", target: "settings.feedback", zone: { x: 0.08, y: 0.18, w: 0.84, h: 0.4 }, title: "FEEDBACK", where: "Open SETTINGS on the main menu, then flip to FEEDBACK with the arrows.",
    text: "Found a bug or have an idea? Send it from Settings → Feedback. Every message gets read." },
  { href: "/closet", navbar: true, title: "NAVIGATION",
    text: "The door icon takes you back to the main menu, which lists every page. On a phone, the bar along the bottom jumps between the main pages too." },
];

const DIM = "rgba(0,0,0,0.55)"; // only behind the "TUTORIAL?" question card
const NO_AUTH = new Set(["/", "/sign-in", "/sign-up", "/forgot-password", "/verify-email", "/privacy", "/terms", "/eula", "/cookies"]);
const FONT = { fontFamily: "Arial, sans-serif" } as const;

// line: a thin border/divider line — text must stay off it, but an arrow may cross it.
type Box = { x: number; y: number; w: number; h: number; line?: boolean };

const BOX_W = 320;
const GAP = 46;        // space between the feature and the text (room for a visible arrow)
const MARGIN = 16;     // keep clear of the window edges
const FADE_MS = 240;   // the white fade between steps

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function visible(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
  }
  return true;
}

// Everything visible on the page the tutorial's text and arrow must stay clear of: every line of
// text, every image/icon/field/button, and every box that's actually drawn (a background other
// than the page's white, a border, or a shadow — e.g. the upload area, the wardrobe piece box).
function occupiedBoxes(): Box[] {
  const stage = document.getElementById("tut-stage");
  if (!stage) return [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const out: Box[] = [];
  const add = (b: DOMRect, line = false) => {
    if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > vh || b.right < 0 || b.left > vw) return;
    if (b.width * b.height > vw * vh * 0.8) return; // page-sized wrappers aren't "content"
    out.push({ x: b.left, y: b.top, w: b.width, h: b.height, line });
  };
  // Text, line by line.
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() || !n.parentElement || !visible(n.parentElement)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) add(r);
  }
  // Drawn elements.
  for (const el of stage.querySelectorAll<HTMLElement>("*")) {
    // Inside an area whose pictures keep moving (data-tut-moving, e.g. the wardrobe's bouncing
    // pieces): the area itself counts as one block, the moving pictures don't. Its text (labels)
    // still counts as usual.
    if (el.tagName === "IMG" && el.parentElement?.closest("[data-tut-moving]")) continue;
    const tag = el.tagName;
    const media = tag === "IMG" || tag === "svg" || tag === "CANVAS" || tag === "VIDEO" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    let drawn = media;
    if (!drawn) {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      const paintedBg = bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg) && bg !== "rgb(255, 255, 255)";
      const bordered = ["Top", "Right", "Bottom", "Left"].some(side =>
        parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none");
      const filled = !!paintedBg || cs.boxShadow !== "none" || cs.backgroundImage !== "none";
      if (!filled && bordered && visible(el)) {
        // A large outlined area (e.g. a panel with a divider border): only its border lines are
        // drawn — the space inside is free. Small outlined boxes count as a whole.
        const r = el.getBoundingClientRect();
        // (An area marked data-tut-moving always counts whole: its moving contents aren't tracked.)
        if (r.width * r.height > vw * vh * 0.12 && !el.hasAttribute("data-tut-moving")) {
          const bw = (side: string) => parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0;
          if (bw("top")) add(new DOMRect(r.left, r.top, r.width, Math.max(2, bw("top"))), true);
          if (bw("bottom")) add(new DOMRect(r.left, r.bottom - Math.max(2, bw("bottom")), r.width, Math.max(2, bw("bottom"))), true);
          if (bw("left")) add(new DOMRect(r.left, r.top, Math.max(2, bw("left")), r.height), true);
          if (bw("right")) add(new DOMRect(r.right - Math.max(2, bw("right")), r.top, Math.max(2, bw("right")), r.height), true);
          continue;
        }
      }
      drawn = filled || bordered;
    }
    if (drawn && visible(el)) add(el.getBoundingClientRect());
  }
  return out;
}

// An arrow that would cross a divider line stops short of it instead (still pointing at the
// feature on the other side), so it never touches the line.
function stopAtLines(a: Arrow, others: Box[]): Arrow {
  const p = { x: a.x1, y: a.y1 }, q = { x: a.x2, y: a.y2 };
  let tMin = 1;
  for (const o of others) if (o.line) { const t = segmentEntry(p, q, o); if (t !== null && t < tMin) tMin = t; }
  if (tMin >= 1) return a;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const t = Math.max(0, tMin - 26 / len);
  return { x1: p.x, y1: p.y, x2: p.x + (q.x - p.x) * t, y2: p.y + (q.y - p.y) * t };
}

// Where (0..1 along p→q) the segment first enters box b, or null if it doesn't.
function segmentEntry(p: { x: number; y: number }, q: { x: number; y: number }, b: Box): number | null {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const checks: [number, number][] = [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]];
  for (const [pp, qq] of checks) {
    if (pp === 0) { if (qq < 0) return null; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 0.001 ? t0 : null;
}

// Does the segment p→q pass through box b? (Liang–Barsky clip.)
function segmentHits(p: { x: number; y: number }, q: { x: number; y: number }, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const checks: [number, number][] = [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]];
  for (const [pp, qq] of checks) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 0.001;
}

type Arrow = { x1: number; y1: number; x2: number; y2: number };
type Pt = { x: number; y: number };

// Points along the edges of `b` that face `other` (the sides an arrow between them can leave or
// arrive from).
function facingPoints(b: Box, other: Box): Pt[] {
  const pts: Pt[] = [];
  const fr = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
  if (other.y >= b.y + b.h) for (const f of fr) pts.push({ x: b.x + b.w * f, y: b.y + b.h });      // other is below
  if (other.y + other.h <= b.y) for (const f of fr) pts.push({ x: b.x + b.w * f, y: b.y });        // above
  if (other.x >= b.x + b.w) for (const f of fr) pts.push({ x: b.x + b.w, y: b.y + b.h * f });      // right
  if (other.x + other.w <= b.x) for (const f of fr) pts.push({ x: b.x, y: b.y + b.h * f });        // left
  return pts;
}

const clearance = (o: Box): Box => ({ x: o.x - 22, y: o.y - 22, w: o.w + 44, h: o.h + 44 });

// The arrow from the text to the feature: tries start/end points along their facing edges and
// keeps the shortest one that stays clear of everything else on the page. `crossings` > 0 means
// no fully clear path existed (the placement step avoids choosing those spots).
function bestArrow(text: Box, target: Box, others: Box[]): { arrow: Arrow | null; crossings: number; lineCost: number } {
  let best: { arrow: Arrow; crossings: number; len: number } | null = null;
  for (const a of facingPoints(text, target)) {
    for (const b of facingPoints(target, text)) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 20) continue;
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const arrow = { x1: a.x + ux * 6, y1: a.y + uy * 6, x2: b.x - ux * 16, y2: b.y - uy * 16 };
      // Crossing a thin divider line is fine for an arrow (only real content counts).
      const crossings = others.filter(o => !o.line && segmentHits({ x: arrow.x1, y: arrow.y1 }, { x: arrow.x2, y: arrow.y2 }, clearance(o))).length;
      const cost = len;
      if (!best || crossings < best.crossings || (crossings === best.crossings && cost < best.len)) best = { arrow, crossings, len: cost };
      if (best.crossings === 0 && b === facingPoints(target, text)[0]) break;
    }
  }
  return best ? { arrow: best.arrow, crossings: best.crossings, lineCost: best.len } : { arrow: null, crossings: 0, lineCost: 0 };
}

// The closest spot for the text next to the feature where neither the text nor its arrow touches
// anything on the page. Candidates: the four sides of the feature at several alignments, then a
// scan of the whole window.
function placeText(target: Box, w: number, h: number, occupied: Box[]): { box: Box; arrow: Arrow | null; score: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  // Things fully inside the feature are part of what's being pointed at; anything else — even
  // something just overlapping its edge, like a label — must be kept clear.
  const others = occupied.filter(o => overlapArea(o, target) < o.w * o.h * 0.95);
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const cands: Box[] = [];
  for (const t of [0.5, 0, 1, 0.25, 0.75]) {
    cands.push({ x: target.x + target.w + GAP, y: target.y + (target.h - h) * t, w, h });
    cands.push({ x: target.x - GAP - w, y: target.y + (target.h - h) * t, w, h });
    cands.push({ x: target.x + (target.w - w) * t, y: target.y + target.h + GAP, w, h });
    cands.push({ x: target.x + (target.w - w) * t, y: target.y - GAP - h, w, h });
  }
  // Beside the feature reads best (the text sits in the open space next to it, e.g. the gap
  // between columns), so a spot above/below it has to be clearly closer to win.
  const besideBonus = (c: Box) => (c.x >= target.x + target.w || c.x + c.w <= target.x ? 0 : 160);
  for (let y = MARGIN; y + h <= vh - MARGIN; y += 16) for (let x = MARGIN; x + w <= vw - MARGIN; x += 16) cands.push({ x, y, w, h });
  let best: { box: Box; arrow: Arrow | null } | null = null, bestScore = Infinity;
  for (const c of cands) {
    if (c.x < MARGIN || c.y < MARGIN || c.x + c.w > vw - MARGIN || c.y + c.h > vh - MARGIN) continue;
    // Always a real gap to the feature, so there's room for the arrow between them.
    if (overlapArea(c, { x: target.x - (GAP - 4), y: target.y - (GAP - 4), w: target.w + 2 * (GAP - 4), h: target.h + 2 * (GAP - 4) }) > 0) continue;
    const padded = { x: c.x - 18, y: c.y - 18, w: c.w + 36, h: c.h + 36 };
    // Divider lines get extra room, so the text (and its arrow's tail) sits clearly away from them.
    const lineGap = { x: c.x - 110, y: c.y - 18, w: c.w + 220, h: c.h + 36 };
    const covered = others.reduce((sum, o) => sum + overlapArea(o.line ? lineGap : padded, o), 0);
    if (covered * 50 + Math.hypot(c.x + c.w / 2 - cx, c.y + c.h / 2 - cy) + besideBonus(c) >= bestScore) continue; // can't win
    // The arrow (line + head) needs clearance too, not just a technically-missed line.
    const { arrow, crossings, lineCost } = bestArrow(c, target, others);
    const dist = Math.hypot(c.x + c.w / 2 - cx, c.y + c.h / 2 - cy);
    void lineCost;
    const score = covered * 50 + crossings * 40000 + dist + besideBonus(c);
    if (score < bestScore) { bestScore = score; best = { box: c, arrow }; }
  }
  if (best?.arrow) best = { ...best, arrow: stopAtLines(best.arrow, others) };
  return best ? { ...best, score: bestScore } : { box: { x: Math.max(MARGIN, (vw - w) / 2), y: vh - h - MARGIN, w, h }, arrow: null, score: Infinity };
}

// Makes room under a full-window page (see Step.roomBelow); 0 = normal height.
function setBottomRoom(px: number) {
  document.documentElement.style.setProperty("--tut-bottom", `${Math.max(0, px)}px`);
}

// Slides the page down by `px` (0 = back in place) to open a clear band at the top.
function setBand(px: number) {
  if (px > 0) {
    document.documentElement.style.setProperty("--tut-band", `${px}px`);
    document.body.setAttribute("data-tut-band", "1");
  } else {
    document.body.removeAttribute("data-tut-band");
  }
}

function setNavHidden(hidden: boolean) {
  if (hidden) document.body.setAttribute("data-tutorial-nonav", "1");
  else document.body.removeAttribute("data-tutorial-nonav");
}

// Waits until the page has finished loading and stopped moving: no loading dots up, every image
// on it decoded, and the layout unchanged across several checks in a row.
async function pageSettled(isCurrent: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  let last = "", stableFor = 0, lastMoving = "";
  while (isCurrent() && Date.now() - start < timeoutMs) {
    await sleep(90);
    const loading = [...document.querySelectorAll('[aria-label="Loading"]')].some(visible);
    const imgs = [...document.querySelectorAll<HTMLImageElement>("#tut-stage img")];
    const imagesDone = imgs.every(i => i.complete);
    // Moving pictures (data-tut-moving, e.g. the wardrobe's bouncing pieces) must already be in
    // motion — positioned by their animation — not still bunched at their starting spot.
    const movingImgs = [...document.querySelectorAll<HTMLImageElement>("[data-tut-moving] img")];
    const movingSig = movingImgs.map(i => `${i.style.left},${i.style.top},${i.style.transform}`).join("|");
    const movingPlaced = movingImgs.every(i => i.style.left !== "" || i.style.transform !== "") &&
      (movingImgs.length === 0 || (movingSig !== lastMoving && lastMoving !== ""));
    lastMoving = movingSig;
    const sig = occupiedBoxes().map(b => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join("|");
    if (!loading && imagesDone && movingPlaced && sig === last && sig) stableFor++;
    else stableFor = 0;
    last = sig;
    if (stableFor >= 3) return;
  }
}

export default function Tutorial() {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [prompt, setPrompt] = useState(false);
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  // Placement for the current step (null while the next one is being prepared).
  const [layout, setLayout] = useState<{ box: Box; arrow: Arrow | null; compact: boolean } | null>(null);
  // White fade covering the page while it changes between steps.
  const [curtain, setCurtain] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);
  const measureCompactRef = useRef<HTMLDivElement>(null);
  const runRef = useRef(0);
  const checkedRef = useRef(false);
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  // Offered once, on the first signed-in page, to accounts created with the prompt pending.
  useEffect(() => {
    if (!isSignedIn || checkedRef.current || NO_AUTH.has(pathname)) return;
    checkedRef.current = true;
    fetch("/api/user/tutorial").then(r => r.ok ? r.json() : null).then(d => { if (d?.pending) setPrompt(true); }).catch(() => {});
  }, [isSignedIn, pathname]);

  useEffect(() => () => { setNavHidden(false); setTutorialDemo(false); setBand(0); setBottomRoom(0); }, []);

  // One step, start to finish: fade the page out, change it underneath (navigate, open the
  // Settings page, show the samples), wait until it's fully loaded and still, place the text,
  // then fade the page and the text in together.
  const runStep = useCallback(async (i: number) => {
    const run = ++runRef.current;
    const current = () => runRef.current === run;
    const step = STEPS[i];
    setCurtain(true);
    setLayout(null);
    await sleep(FADE_MS);
    if (!current()) return;
    setBand(0);
    setBottomRoom(0);
    setStepIdx(i);
    setTutorialDemo(true);
    setNavHidden(!step.navbar);
    if (step.settingsPage) {
      try { sessionStorage.setItem("mc_settings_page", step.settingsPage); } catch {}
      window.dispatchEvent(new CustomEvent("mc:settings-page", { detail: step.settingsPage }));
    }
    if (pathRef.current !== step.href) {
      router.push(step.href);
      const t0 = Date.now();
      while (current() && pathRef.current !== step.href && Date.now() - t0 < 8000) await sleep(50);
    }
    await pageSettled(current);
    if (!current()) return;
    window.scrollTo(0, 0);
    await sleep(60);

    const vw = window.innerWidth, vh = window.innerHeight;
    const occupied = occupiedBoxes();
    let target: Box | null = null;
    let targetEl: HTMLElement | null = null;
    const ids = step.navbar ? ["navbar", "navbar-door"] : step.target ? [step.target] : [];
    for (const id of ids) {
      for (const el of document.querySelectorAll<HTMLElement>(`[data-tutorial="${id}"]`)) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < vh && visible(el)) { target = { x: b.left, y: b.top, w: b.width, h: b.height }; targetEl = el; break; }
      }
      if (target) break;
    }
    if (!target && !step.target && !step.navbar && occupied.length) {
      // No marker: the page's main content as a whole.
      const x0 = Math.min(...occupied.map(o => o.x)), y0 = Math.min(...occupied.map(o => o.y));
      const x1 = Math.max(...occupied.map(o => o.x + o.w)), y1 = Math.max(...occupied.map(o => o.y + o.h));
      target = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (!target && step.zone) target = { x: step.zone.x * vw, y: step.zone.y * vh, w: step.zone.w * vw, h: step.zone.h * vh };
    // The text can take a few shapes — the usual column, wider/shorter blocks that fit a thin strip
    // (e.g. under a box), or a narrower/taller one — and uses whichever fits clear, nearest the
    // feature. The usual shape wins whenever it fits.
    const measure = (w: number, compact: boolean) => {
      const el = compact ? measureCompactRef.current : measureRef.current;
      if (!el) return 200;
      el.style.width = `${w}px`;
      return el.offsetHeight;
    };
    let placed: { box: Box; arrow: Arrow | null; score: number; compact: boolean } = { box: { x: (vw - BOX_W) / 2, y: (vh - 200) / 2, w: BOX_W, h: 200 }, arrow: null, score: Infinity, compact: false };
    if (target) {
      // Usual shape first; then wider/narrower blocks; then a compact version (smaller type) for
      // pages with only a thin strip of free space. Each change of shape has to clearly win.
      const shapes: [number, boolean, number][] = [[BOX_W, false, 0], [260, false, 60], [440, false, 220], [560, false, 220], [440, true, 900], [560, true, 900]];
      for (const [w, compact, cost] of shapes) {
        if (w > vw - 2 * MARGIN) continue;
        const p = placeText(target, w, measure(w, compact), occupied);
        if (p.score + cost < placed.score) placed = { ...p, score: p.score + cost, compact };
      }
    }
    if (target && step.roomBelow) {
      // Shorten the page just enough for the text underneath it; the page keeps its normal top.
      const w = Math.min(860, vw - 2 * MARGIN);
      const h = measure(w, true);
      const room = Math.round(h + GAP + 12);
      setBottomRoom(room);
      await sleep(60);
      if (!current()) return;
      const b = targetEl?.getBoundingClientRect();
      const t2: Box = b ? { x: b.left, y: b.top, w: b.width, h: b.height } : target;
      const box: Box = { x: (vw - w) / 2, y: vh - h - 10, w, h };
      const ax = Math.max(t2.x + 12, Math.min(t2.x + t2.w - 12, box.x + w / 2));
      placed = { box, arrow: { x1: ax, y1: box.y - 6, x2: ax, y2: t2.y + t2.h + 14 }, score: 0, compact: true };
    } else if (target && placed.score >= 5000) {
      // No clear spot anywhere (the page fills the whole window, e.g. Calendar): make room rather
      // than cover anything — slide the page down to open a clear band at the top for the text,
      // with the arrow pointing down at the feature. Undone on the next step.
      // As little room as possible: a wide, compact (short) block, and only as much space as it needs.
      const w = Math.min(860, vw - 2 * MARGIN);
      const h = measure(w, true);
      const band = Math.round(h + GAP);
      setBand(band);
      await sleep(40);
      if (!current()) return;
      const b = targetEl?.getBoundingClientRect();
      const shifted: Box = b ? { x: b.left, y: b.top, w: b.width, h: b.height } : { ...target, y: target.y + band };
      const box: Box = { x: (vw - w) / 2, y: 10, w, h };
      // The arrow still keeps clear of the page's content (e.g. a title right above the feature).
      const after = occupiedBoxes().filter(o => overlapArea(o, shifted) < o.w * o.h * 0.95);
      const arrowX = Math.max(shifted.x + 12, Math.min(shifted.x + shifted.w - 12, box.x + w / 2));
      const routed = bestArrow(box, shifted, after);
      placed = {
        box,
        arrow: routed.arrow && routed.crossings === 0 ? routed.arrow : { x1: box.x + w / 2, y1: box.y + h + 4, x2: arrowX, y2: Math.max(box.y + h + 20, shifted.y - 6) },
        score: 0, compact: true,
      };
    }
    if (!current()) return;
    setLayout(placed);
    setCurtain(false);
  }, [router]);

  function answer(yes: boolean) {
    setPrompt(false);
    fetch("/api/user/tutorial", { method: "POST" }).catch(() => {});
    if (yes) runStep(0);
  }

  const finish = useCallback(async () => {
    const run = ++runRef.current;
    setCurtain(true);
    setLayout(null);
    await sleep(FADE_MS);
    if (runRef.current !== run) return;
    setStepIdx(null);
    setBand(0);
    setBottomRoom(0);
    setTutorialDemo(false);
    setNavHidden(false);
    if (pathRef.current !== "/closet") router.push("/closet");
    await pageSettled(() => runRef.current === run);
    if (runRef.current === run) setCurtain(false);
  }, [router]);

  if (prompt) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 10001, background: DIM, display: "flex", alignItems: "center", justifyContent: "center", ...FONT }}>
        <div style={{ background: "#fff", padding: "28px 32px", width: 300, maxWidth: "88vw", textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.14em", margin: 0 }}>TUTORIAL?</p>
          <p style={{ fontSize: 13, color: "#555", margin: "8px 0 0" }}>A quick walk through everything MyCloset can do.</p>
          <div style={{ display: "flex", gap: 36, justifyContent: "center", marginTop: 22 }}>
            <button onClick={() => answer(false)} style={btn("#aaa")}>NO</button>
            <button onClick={() => answer(true)} style={btn("#111")}>YES</button>
          </div>
        </div>
      </div>
    );
  }
  if (stepIdx === null && !curtain) return null;

  const step = stepIdx !== null ? STEPS[stepIdx] : null;
  const last = stepIdx === STEPS.length - 1;
  const renderText = (compact: boolean) => step && (
    <>
      <p style={{ color: "#111", fontSize: compact ? 12 : 13, fontWeight: 700, letterSpacing: "0.16em", margin: `0 0 ${compact ? 3 : 6}px` }}>{step.title}</p>
      <p style={{ color: "#111", fontSize: compact ? 13 : 15, fontWeight: 600, lineHeight: compact ? 1.35 : 1.5, margin: 0 }}>{step.text}</p>
      {step.where && <p style={{ color: "#555", fontSize: compact ? 11 : 12, fontWeight: 700, letterSpacing: "0.04em", margin: `${compact ? 5 : 10}px 0 0` }}>{step.where}</p>}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 22, marginTop: compact ? 7 : 14 }}>
        {!last && <button onClick={finish} style={btn("#8f8f8f")}>SKIP</button>}
        <button onClick={() => (last ? finish() : runStep((stepIdx ?? 0) + 1))} style={btn("#111")}>{last ? "DONE" : "NEXT"}</button>
      </div>
    </>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10001, ...FONT }}>
      {/* Transparent: blocks clicks on the page so the tour can't be wandered out of mid-way. */}

      {/* The white fade between steps — the page changes underneath it, out of sight. */}
      <div style={{ position: "fixed", inset: 0, background: "#fff", opacity: curtain ? 1 : 0, transition: `opacity ${FADE_MS}ms ease`, pointerEvents: "none" }} />

      {/* Invisible copy of the text, used only to measure its height for placement. */}
      <div ref={measureRef} aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: BOX_W, textAlign: "center", visibility: "hidden" }}>{renderText(false)}</div>
      <div ref={measureCompactRef} aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: BOX_W, textAlign: "center", visibility: "hidden" }}>{renderText(true)}</div>

      {layout?.arrow && (
        <svg width="100%" height="100%" style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: curtain ? 0 : 1, transition: `opacity ${FADE_MS}ms ease` }}>
          <defs>
            <marker id="tut-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#111" />
            </marker>
          </defs>
          <line x1={layout.arrow.x1} y1={layout.arrow.y1} x2={layout.arrow.x2} y2={layout.arrow.y2} stroke="#111" strokeWidth="2.5" strokeLinecap="round" markerEnd="url(#tut-head)" />
        </svg>
      )}

      {layout && step && (
        <div style={{
          position: "fixed", left: layout.box.x, top: layout.box.y, width: layout.box.w, textAlign: "center",
          opacity: curtain ? 0 : 1, transition: `opacity ${FADE_MS}ms ease`,
        }}>
          {renderText(layout.compact)}
        </div>
      )}
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return { background: "none", border: "none", cursor: "pointer", color, fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", padding: 0, fontFamily: "Arial, sans-serif" };
}
