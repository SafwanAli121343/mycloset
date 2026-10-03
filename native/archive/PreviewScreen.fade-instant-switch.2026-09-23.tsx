// ============================================================================
// ARCHIVED SNAPSHOT — NOT IMPORTED OR BUILT ANYWHERE. Reference/rollback only.
//
// Captured 2026-09-23, right before replacing the two/three-piece preview's
// compare<->piece and piece<->piece transitions with smooth animated movement
// (sliding pieces) instead of the instant-snap-hidden-behind-a-fade approach
// this version uses.
//
// This is the last version with the "fade chrome out -> insta-switch position
// (plain React state, no Animated involved for X or Y) -> fade chrome back
// in" transition design. Endpoints (compareOffsetX/pieceTargetX geometry) and
// the fade timing/sequencing (runTransition, pendingRevealRef's render-commit
// wait) in this snapshot are CONFIRMED CORRECT on a real device — every
// attempt at animating the position change itself (X via Animated.Value in
// either driver mode, Y via modeP, LayoutAnimation) failed differently on
// this device/RN version (see this file's own extensive comments around
// pieceTargetX, pieceXState, and totalTY for the full history), which is why
// this version settled for an instant, unanimated position change instead.
//
// If a future attempt at smooth sliding movement also has to be abandoned,
// restore from here: the geometry and fade sequencing are known-good, only
// the "how does the position actually change" mechanism needs swapping back
// to the plain-state approach used throughout this file.
// ============================================================================

import { useState, useEffect, useRef, useCallback, useMemo, memo, type ReactNode } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Animated, Easing, Dimensions, ScrollView, unstable_batchedUpdates } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { apiJson, apiFetch } from "../lib/api";
import { setNavigationBlock } from "../lib/navigationBlock";
import { useNavBarVisibility, useSuppressNavButton } from "../lib/NavBarVisibility";
import { TextButton } from "../components/TextButton";
import { UnderlineField } from "../components/UnderlineField";
import { LoadingDots } from "../components/LoadingDots";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { BAR_CONTENT_H, BAR_BOTTOM_GAP } from "../components/BottomNavBar";
import { computeWardrobeImpact, type WardrobeImpact, type OverdoneNote } from "../lib/wardrobeImpact";
import { bucketOf } from "../lib/garmentSlots";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import { useEntitlements } from "../lib/billing/Entitlements";
import { describeColorPairing, colorsPairWell } from "../lib/colorTheory";
import { setCached } from "../lib/dataCache";

// TEMPORARY diagnostic logger for the analyzing->results transition timing investigation — same
// technique already proven for CalendarScreen's own version of this exact class of bug: console.log
// does NOT reliably reach the iOS system log in this dev-client setup (it routes to Metro's own
// remote-console connection instead), confirmed by three failed live tests there. AsyncStorage
// persists to a plain file on disk, readable directly, with no log-routing dependency. Remove once
// the real slow phase here is identified and fixed.
const previewTimingLog: { label: string; t: number; at: string }[] = [];
function logPreviewTiming(label: string, t: number) {
  previewTimingLog.push({ label, t, at: new Date().toISOString() });
  setCached("__preview_timing_log__", previewTimingLog);
}

const MAX_COMPARE = 3;
const CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];
// Fixed height shared by both the closed ("+") and open (mode tabs + photo drop/URL input +
// cancel) states of a slot — kept identical so opening a slot never changes its own height and
// never pushes the rest of the screen around.
const SLOT_H = 130;

type SlotMode = "url" | "photo";
type PreviewSlot = { open: boolean; mode: SlotMode; url: string; image: string | null };
const emptySlot = (): PreviewSlot => ({ open: false, mode: "photo", url: "", image: null });

// ── Data model — mirrors the website's PreviewClient.tsx exactly (see BasicAttrs/DeepAttrs/
// OutfitCountResult there) so the same numbers and fields show up on both platforms. ──────────
type BasicAttrs = {
  title: string; brand: string | null; category: string;
  color_primary: string | null; material: string | null; fit: string | null; image: string | null;
};
type DeepAttrs = {
  sub_type: string | null; aesthetic_tags: string[] | null;
  pros: string[] | null; cons: string[] | null;
  color_pairings: string[] | null; color_clashes: string[] | null;
  formality: string | null;
  // Present at runtime (see lib/aiInference.ts's VISUAL_FIELDS) even though deep-analyze's own
  // documented return type doesn't list them — needed so the piece score the server computes
  // matches what scorePiece would produce once this item is actually saved to the closet.
  item_tier?: string | null; novelty_quality?: number | null;
};
type OutfitRef = { score: number; itemIds: string[] };
type WardrobeItemRef = { id: string; title: string | null; image: string | null; sub_type: string | null; category: string | null; aesthetic_tags: string[] | null };
type Impact = {
  outfitCount: number; avgScore: number; aestheticFit: number; pieceScore: number;
  goodCount: number; midCount: number; badCount: number;
  outfits: OutfitRef[]; items: Record<string, WardrobeItemRef>;
};
type ItemResult = {
  basic: BasicAttrs; deep: DeepAttrs; impact: Impact; overall: number;
  wImpact?: WardrobeImpact | null; overdoneNote?: OverdoneNote;
};

// AI-generated head-to-head comparison text (app/api/preview/compare, /compare3) — every point
// is genuinely relative between the compared items, not each item's standalone pros/cons.
type Cmp2 = { better0: string[]; worse0: string[]; better1: string[]; worse1: string[]; sims: string[]; diffs: string[] };
type Cmp3 = { better: string[][]; worse: string[][]; sims: string[][]; diffs: string[][] };

type IdentifyResp = {
  image?: string | null; title?: string; brand?: string; category?: string;
  color_primary?: string; material?: string; fit?: string;
};

async function identify(slot: PreviewSlot): Promise<(IdentifyResp & { image: string }) | null> {
  if (slot.mode === "photo" && slot.image) {
    const id = await apiJson<IdentifyResp>("/api/garments/analyze", { method: "POST", body: JSON.stringify({ imageDataUrl: slot.image }) });
    return { ...id, image: slot.image };
  }
  if (slot.mode === "url" && slot.url.trim()) {
    const id = await apiJson<IdentifyResp>("/api/garments/analyze", { method: "POST", body: JSON.stringify({ productUrl: slot.url.trim() }) });
    if (!id.image) { console.warn("[Preview] identify: scraped product but no image field", slot.url); return null; }
    return { ...id, image: id.image };
  }
  return null;
}

// The real add-to-closet flow (app/api/garments/upload-image) always removes the background
// before ever showing/saving a garment photo — Preview never did this on either platform, so
// its images kept whatever backdrop the original photo/product page had. Reuses the existing
// generic /api/remove-bg endpoint (already used elsewhere in the app) rather than a new route.
// It returns raw PNG bytes, not JSON, so this reads it as a blob and re-encodes to a data: URL
// for display. Never throws — on any failure (network, model, timeout) the original image is
// used as-is, since a preview item was never going to be saved anyway and a slightly-unpolished
// backdrop is a far smaller problem than the whole analysis failing over a cosmetic step.
async function removeBackgroundRemote(imageUrl: string): Promise<string> {
  try {
    const res = await apiFetch("/api/remove-bg", { method: "POST", body: JSON.stringify({ url: imageUrl }) });
    if (!res.ok) return imageUrl;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : imageUrl);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return imageUrl;
  }
}

function normalizeCategory(raw: string): string {
  const c = raw.toLowerCase();
  return CATEGORIES.includes(c) ? c
    : c.includes("shoe") || c.includes("boot") || c.includes("sneaker") || c.includes("footwear") ? "footwear"
    : c.includes("pant") || c.includes("jean") || c.includes("skirt") || c.includes("short") || c.includes("bottom") ? "bottom"
    : c.includes("jacket") || c.includes("coat") || c.includes("outerwear") ? "outerwear"
    : c.includes("bag") || c.includes("hat") || c.includes("belt") || c.includes("accessory") ? "accessory"
    : "top";
}

// Matches the website's overallScore() exactly (PreviewClient.tsx) — pieceScore/avgScore/
// aestheticFit/outfitCount/goodCount all come from the same server-computed numbers web uses.
function overallScore(impact: Impact): number {
  const goodRatio = impact.outfitCount > 0 ? Math.min((impact.goodCount / impact.outfitCount) * 100 * 2, 100) : 0;
  return Math.round(
    impact.pieceScore * 0.35 +
    impact.avgScore * 0.25 +
    Math.min((impact.outfitCount / 25) * 100, 100) * 0.15 +
    impact.aestheticFit * 0.15 +
    goodRatio * 0.10
  );
}

// ── The 5 per-item info cards — same set, same content sources, as the website's CardKey/
// CARD_LABELS/getCardItems (PreviewClient.tsx). Shown one at a time on mobile (see InfoCard)
// instead of floating panels on 4 screen edges, cycled with arrows rather than 5 toggle buttons.
type CardKey = "pros" | "cons" | "aesthetics" | "piece_pairings" | "pairings";
const CARD_ORDER: CardKey[] = ["pros", "cons", "aesthetics", "piece_pairings", "pairings"];
const CARD_LABELS: Record<CardKey, string> = { pros: "PROS", cons: "CONS", aesthetics: "AESTHETICS", piece_pairings: "PIECE PAIRINGS", pairings: "COLOR PAIRINGS" };
const CARD_COLORS: Record<CardKey, string> = { pros: colors.good, cons: colors.bad, aesthetics: colors.textMuted, piece_pairings: "#00838f", pairings: "#1565c0" };

function getCardLines(key: CardKey, item: ItemResult): string[] {
  const w = item.wImpact;
  switch (key) {
    case "pros":
      return [
        ...(item.deep.pros ?? []),
        ...(w?.fillsGaps ?? []).map(g => `Fills gap: ${g}`),
        ...(w?.addressesWeaknesses ?? []).map(x => `Addresses: ${x}`),
        ...(item.overdoneNote?.type === "pro" ? [item.overdoneNote.text] : []),
      ];
    case "cons":
      return [
        ...(item.deep.cons ?? []),
        ...(item.overdoneNote?.type === "con" ? [item.overdoneNote.text] : []),
      ];
    case "aesthetics":
      return [...(item.deep.aesthetic_tags ?? []), ...(w?.addsAesthetics ?? [])];
    case "pairings": {
      const aiPairings = [...(item.deep.color_pairings ?? []), ...(w?.addsColors ?? [])];
      // Free tier (or any item that never got AI-analyzed): fall back to the deterministic
      // color-theory rule table instead of an empty card — see lib/colorTheory.ts.
      if (aiPairings.length === 0 && item.basic.color_primary) {
        return describeColorPairing(item.basic.color_primary).map(c => `Pairs well with ${c}`);
      }
      return aiPairings;
    }
    case "piece_pairings":
      return Object.values(item.impact.items).slice(0, 15).map(wi =>
        `${wi.title ?? wi.sub_type ?? "Item"}${(wi.aesthetic_tags ?? []).length ? ": " + wi.aesthetic_tags!.slice(0, 2).join(", ") : ""}`
      );
  }
}

// One card visible at a time, header label + left/right arrows to cycle through the 5 kinds —
// the mobile answer to the website's 4-floating-panel layout, which has no room on a phone.
function InfoCard({ item, cardIdx, onCycle, cardOrder }: { item: ItemResult; cardIdx: number; onCycle: (dir: 1 | -1) => void; cardOrder: CardKey[] }) {
  const key = cardOrder[cardIdx];
  const lines = getCardLines(key, item);
  const canCycle = cardOrder.length > 1;
  return (
    <View style={styles.cardBox}>
      <Text style={[type.label, { color: CARD_COLORS[key], textAlign: "center" }]}>{CARD_LABELS[key]}</Text>
      {/* Arrows flank the scrollable body itself (not the header label) — they cycle through
         the available card kinds, which is an action on the body's content, not the label
         above it. Hidden (not just disabled) when there's only one card to show — free tier's
         AI-less items only ever have PAIRINGS, so cycling would just be a no-op. */}
      <View style={{ flexDirection: "row", alignItems: "center", width: "100%", marginTop: spacing.xs }}>
        {/* translateY nudges these up off the row's true geometric center (which alignItems:
           "center" gives them) to match where FocusScrollList's OWN focal row actually lands —
           the focused line's visual center sits a bit above the box's exact midpoint once
           unequal-height neighboring rows are in the mix, so centering the arrows on the box
           itself instead of the current focal row left them looking low relative to it. */}
        {canCycle && (
          <TouchableOpacity onPress={() => onCycle(-1)} hitSlop={12} style={{ paddingHorizontal: spacing.sm, transform: [{ translateY: -10 }] }}>
            <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        <View style={{ height: 190, flex: 1 }}>
          {lines.length > 0
            ? <FocusScrollList items={lines.map((t): FocusItem => ({ text: t, color: CARD_COLORS[key] }))} focal={0.5} />
            : <Text style={[type.body, { color: colors.textFaint, textAlign: "center", marginTop: spacing.lg }]}>Nothing here.</Text>}
        </View>
        {canCycle && (
          <TouchableOpacity onPress={() => onCycle(1)} hitSlop={12} style={{ paddingHorizontal: spacing.sm, transform: [{ translateY: -10 }] }}>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Compact metrics — same 6 numbers as the website's statRows/cmpData.rows, one row per metric
// instead of side-by-side columns (which don't fit next to 2-3 item images on a phone width).
const METRIC_ROWS: { key: keyof Impact | "overall"; label: string }[] = [
  { key: "overall", label: "OVERALL" },
  { key: "pieceScore", label: "PIECE SCORE" },
  { key: "avgScore", label: "AVG OUTFIT" },
  { key: "outfitCount", label: "NEW OUTFITS" },
  { key: "aestheticFit", label: "AESTHETIC %" },
];
function metricValue(r: ItemResult, key: keyof Impact | "overall"): number {
  if (key === "overall") return r.overall;
  const v = r.impact[key];
  return typeof v === "number" ? v : 0;
}
// Matches the website's outfitCountColor() exactly (PreviewClient.tsx) — a raw outfit count
// isn't a 0-100 score, so it gets its own threshold-based coloring instead of scoreColor.
function outfitCountColor(n: number): string {
  return n >= 25 ? colors.good : n >= 10 ? colors.mid : colors.bad;
}
function metricColor(key: keyof Impact | "overall", value: number): string {
  return key === "outfitCount" ? outfitCountColor(value) : scoreColor(value);
}

// Renders each outfit as a real overlapping piece-image stack — the same visual OutfitsScreen
// uses for its cards — instead of a bare numbered chip, per explicit request ("show the outfit
// stacks as if its the outfit screen"). `impact.outfits`/`impact.items` are already capped
// server-side (see app/api/preview/outfit-count/route.ts's visibleOutfits.slice(0,50)) — the
// exact same cap the website's own OutfitGallery is bound by (it calls this identical route),
// so paginating through up to that many here matches site logic exactly rather than under- or
// over-promising. `impact.outfitCount`, separately, is the TRUE uncapped total — that's what the
// headline must show, not outfits.length (which silently maxes out at 50 and reads as if that
// were the whole answer).
const GALLERY_PAGE = 12;
// Exactly 3 per row, matching OutfitsScreen's own card grid — computed from screen width rather
// than a fixed 74px (which happened to fit 4+ per row on most phones instead of the intended 3).
const GALLERY_COLS = 3;
const GALLERY_GAP = spacing.sm;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const STACK_W = Math.floor((SCREEN_W - spacing.lg * 2 - GALLERY_GAP * (GALLERY_COLS - 1)) / GALLERY_COLS);
// Results content's own top padding, before the RESET row now sitting in-flow above the
// piece(s); reused by the entrance-Y math below so "where the piece rests" and "where the scroll
// content starts" can never silently drift apart. Matches ShowNavButton's own insets.top+10 float
// exactly, since RESET (now the first thing in this scrollable content) is meant to start level
// with it — before, this was 30, which put RESET a visible ~20px below the nav arrow instead of
// level with it.
const RESULTS_TOP_PAD = 10;
// RESET now scrolls away with the rest of the content instead of floating fixed on screen (a
// floating RESET/COMPARE was the one thing that never moved while literally everything else on
// this screen scrolled with it) — this is the space it reserves in-flow above the piece(s): its
// own 22px box (matching ShowNavButton's icon height, see RESET's own style comment) plus a gap
// before the image. COMPARE never affects this: it only ever appears in "piece" mode, which is
// always reached well after the entrance animation below has already finished.
const RESET_ROW_H = 22 + spacing.md;
// How far below single-piece preview's own resting Y the compare-mode row sits — purely a
// transform offset (see PiecesRow), never a layout change, so the two positions are always the
// SAME smooth animated shift rather than two disconnected states.
const COMPARE_Y_OFFSET = 36;
// Where the piece(s) start, held, before the entrance's move-up leg — per explicit feedback
// that true vertical center of the visible area (the math this used to be) still read as too
// low. Not attempting to recompute a different "correct" center; just starting higher up the
// screen by this fixed amount instead.
const ENTRANCE_START_Y_BIAS = 130;
function loadingCenterY(insets: { top: number }): number {
  return insets.top + (SCREEN_H - insets.top) / 2 - ENTRANCE_START_Y_BIAS;
}
const STACK_H = STACK_W * 1.05;
type StackPiece = { id: string; image: string | null; category: string | null; sub_type: string | null };
function stackRank(g: StackPiece): number {
  const b = bucketOf(g);
  return b === "accessory" || b === "head" ? 0 : b === "shoes" ? 1 : b === "outer" ? 3 : b === "bottom" ? 4 : 2;
}

// ── Tap-a-stack spread, adapted directly from OutfitsScreen's SpreadOverlay/openStack/
// closeSpread (same tuned timings, same gather-then-spread shape, same real-photo-aspect-ratio
// sizing via containSize) — "replicate the outfit page" for this gallery's own stacks. Simplified
// from the original by dropping its ideal-score pros/cons detail panel, which doesn't have a
// clean equivalent for a hypothetical (not-yet-owned) outfit; the core interaction is identical.
const SPREAD_ITEMS_PER_ROW = 4;
// OutfitsScreen's own SpreadOverlay uses 0.34 here, but that number assumes ITS OWN layout —
// a score band above and a whole pros/cons analysis panel below the pieces, both filling out the
// rest of the screen. This gallery drops that analysis panel entirely (see the comment on
// GallerySpreadOverlay below); 0.4 lands roughly in between what's read as "too high" (0.34) and
// "too low" (0.44) in successive rounds of tuning.
const PIECES_CENTER_Y = SCREEN_H * 0.4;
const SCORE_Y = SCREEN_H * 0.12;
// Minimum clearance a spread row must keep from either screen edge — rows were previously always
// forced onto one line for up to 4 items regardless of how wide they actually were, which on a
// narrow phone ran a 4-(or even 3-)across row right up against the edges. galleryItemsPerRow
// below now wraps to a new row instead whenever a row actually WOULD violate this margin, rather
// than assuming a fixed item count always fits.
const GALLERY_EDGE_MARGIN = spacing.lg;
const galleryImageSizeCache = new Map<string, { width: number; height: number }>();
function cacheGalleryImageSize(uri: string): Promise<void> {
  if (galleryImageSizeCache.has(uri)) return Promise.resolve();
  return Image.loadAsync(uri).then(ref => {
    // A zero (or otherwise non-finite) width/height must NOT get cached as if it were real —
    // see OutfitsScreen's cacheImageSize for why: every consumer of this cache (originScale
    // below) trusts it blindly, and dividing by a photo's own near-zero content size produces
    // NaN/Infinity, which reads as that exact photo's piece rendering at some nonsense position
    // every single time it's opened — a per-image data bug, not a timing race. Leaving this URI
    // uncached falls through to the safe box-ratio approximation instead.
    if (ref.width > 0 && ref.height > 0 && Number.isFinite(ref.width) && Number.isFinite(ref.height)) {
      galleryImageSizeCache.set(uri, { width: ref.width, height: ref.height });
    }
  }).catch(() => {});
}
function containSize(boxW: number, boxH: number, imgW: number, imgH: number): { width: number; height: number } {
  const boxRatio = boxW / boxH;
  const imgRatio = imgW / imgH;
  return imgRatio > boxRatio ? { width: boxW, height: boxW / imgRatio } : { height: boxH, width: boxH * imgRatio };
}
function galleryItemSize(count: number): { w: number; h: number } {
  if (count <= 2) return { w: 118, h: 156 };
  if (count === 3) return { w: 102, h: 136 };
  if (count <= SPREAD_ITEMS_PER_ROW) return { w: 86, h: 116 };
  return { w: 78, h: 104 };
}
function galleryItemsPerRow(count: number, size: { w: number; h: number }): number {
  const maxRowW = SCREEN_W - GALLERY_EDGE_MARGIN * 2;
  const fitCount = Math.floor((maxRowW + 12) / (size.w + 12));
  return Math.max(1, Math.min(SPREAD_ITEMS_PER_ROW, fitCount, count));
}
function gallerySpreadTarget(i: number, count: number, size: { w: number; h: number }): { x: number; y: number } {
  const perRow = galleryItemsPerRow(count, size);
  const rowIdx = Math.floor(i / perRow);
  const colIdx = i % perRow;
  const numRows = Math.ceil(count / perRow);
  const rowCount = rowIdx === numRows - 1 ? count - rowIdx * perRow : perRow;
  const totalW = rowCount * size.w + (rowCount - 1) * 12;
  const startX = (SCREEN_W - totalW) / 2;
  const rowStep = size.h + 16;
  const startY = PIECES_CENTER_Y - ((numRows - 1) * rowStep) / 2;
  return { x: startX + colIdx * (size.w + 12), y: startY + rowIdx * rowStep };
}

function GallerySpreadOverlay({ stacks, initialIndex, cardRect, remeasureIndex, onIndexChange, onClose }: {
  stacks: GallerySpread[]; initialIndex: number; cardRect: { x: number; y: number; width: number; height: number };
  remeasureIndex: (i: number) => Promise<{ x: number; y: number; width: number; height: number } | null>;
  onIndexChange: (i: number) => void; onClose: () => void;
}) {
  useSuppressNavButton();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(initialIndex);
  const current = stacks[idx];
  const sorted = [...current.pieces].sort((a, b) => stackRank(a) - stackRank(b));
  const size = galleryItemSize(sorted.length);
  // Starts as the rect measured at open time, but handleClose re-measures the real card right
  // before animating back to it — anything that shifted the underlying scroll position or layout
  // while this overlay was open (which the earlier, ALWAYS-stale open-time rect could never
  // account for) previously meant the close animation homed in on a spot that no longer matched
  // the real card, so revealing it the instant the overlay unmounted snapped visibly into its
  // actual (different) position — read as an extra, unwanted "shift" right at the end of closing.
  const [originRect, setOriginRect] = useState(cardRect);

  const gatherP = useRef(new Animated.Value(0)).current;
  const spreadP = useRef(new Animated.Value(0)).current;
  const backdropP = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const STANDARD_EASE = Easing.bezier(0.4, 0, 0.2, 1);
  const GATHER_MS = 260;
  const SPREAD_MS = 340;
  const PAUSE_MS = 50;

  useEffect(() => {
    stacks.forEach(s => s.pieces.forEach(g => { if (g.image) cacheGalleryImageSize(g.image); }));
    Animated.sequence([
      Animated.parallel([
        Animated.timing(gatherP, { toValue: 1, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
        Animated.timing(backdropP, { toValue: 1, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
      ]),
      Animated.delay(PAUSE_MS),
      Animated.timing(spreadP, { toValue: 1, duration: SPREAD_MS, easing: STANDARD_EASE, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    setClosing(true);
    // Re-measures whichever card is CURRENTLY on screen (idx), not the originally-tapped one —
    // navigating with the arrows never touched cardRect/originRect before, so closing after
    // navigating away from the first stack always animated back to that first card's position
    // and orientation regardless of which stack was actually showing. Re-measuring is async but
    // the gather leg it needs to be correct for doesn't start until spreadP's own ~300ms leg plus
    // PAUSE_MS have already played out — plenty of time for this to resolve and for React to
    // commit the updated originRect well before gatherP's interpolation values (which read
    // originRect fresh on every render) actually matter.
    remeasureIndex(idx).then(fresh => { if (fresh) setOriginRect(fresh); });
    Animated.sequence([
      Animated.timing(spreadP, { toValue: 0, duration: SPREAD_MS * 0.9, easing: STANDARD_EASE, useNativeDriver: true }),
      Animated.delay(PAUSE_MS),
      Animated.parallel([
        Animated.timing(gatherP, { toValue: 0, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
        Animated.timing(backdropP, { toValue: 0, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
      ]),
    ]).start(({ finished }) => { if (finished) onClose(); });
  }

  // Lets the arrows switch which stack is shown without closing/reopening the overlay — the
  // pieces/score cross-fade to the new stack's content while the backdrop and gather/spread
  // frame stay exactly as they are. Returns, on close, to whichever card is CURRENTLY shown
  // (via onIndexChange + remeasureIndex in handleClose) — not the originally-tapped one, which
  // made no sense once you'd navigated away from it: the close animation would travel to, and
  // assume the orientation of, a stack you weren't even looking at anymore.
  // Matches the website's own navigateOutfit exactly (app/preview/PreviewClient.tsx lines
  // 2413-2445): NOT a lateral scroll — the pieces collapse back into the same gathered center
  // stack they opened from (spreadP 1->0, gatherP left at 1 the whole time since we're not
  // returning all the way to the origin card), the stack's data swaps to the new outfit while
  // fully collapsed (so the swap itself is invisible), and then the new outfit's pieces spread
  // back out (spreadP 0->1) from that same point.
  function navigate(dir: 1 | -1) {
    if (navigating || stacks.length < 2) return;
    const newIdx = (idx + dir + stacks.length) % stacks.length;
    setNavigating(true);
    Animated.timing(spreadP, { toValue: 0, duration: SPREAD_MS, easing: STANDARD_EASE, useNativeDriver: true }).start(() => {
      setIdx(newIdx);
      // Tells the parent which card is now "current" so its hidden-card mask (and therefore
      // where closing this overlay actually reveals/animates back to) moves along with
      // navigation instead of staying pinned to whichever card was tapped to open this in the
      // first place — the background grid is fully covered by the backdrop while this is open,
      // so there's nothing to visually coordinate here beyond this state being correct by close.
      onIndexChange(newIdx);
      // The spread-back-out leg itself starts from the useEffect below, once idx actually
      // changes — see that effect's own comment for why.
    });
  }

  // Kicks off the spread-back-out leg once React has ACTUALLY committed a render reflecting the
  // new idx — replaces an earlier double-rAF defer (waiting 2 frames and hoping that was enough
  // time for React to re-render before spreadP's per-piece targets, which depend on idx via
  // current/sorted/size, got read for real). A fixed frame count is a guess that usually but not
  // always holds; a useEffect keyed on idx is a guarantee — React only runs it after committing a
  // render where idx (and everything derived from it) is already current, by construction, with
  // no timing assumption involved. `navigating` is set true synchronously the moment navigate()
  // is called, well before idx itself changes, so it's already true by the time this effect
  // re-fires from that change — false only on initial mount, which correctly skips it.
  useEffect(() => {
    if (!navigating) return;
    Animated.sequence([
      Animated.delay(PAUSE_MS),
      Animated.timing(spreadP, { toValue: 1, duration: SPREAD_MS, easing: STANDARD_EASE, useNativeDriver: true }),
    ]).start(() => setNavigating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const gatherCX = SCREEN_W / 2;
  const gatherCY = PIECES_CENTER_Y + size.h / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.spreadBackdrop, { opacity: backdropP }]} pointerEvents={closing ? "none" : "auto"}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute", left: 0, right: 0, top: SCORE_Y, alignItems: "center",
          opacity: spreadP, transform: [{ translateY: spreadP.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
        }}
      >
        <Text style={{ fontSize: 44, fontWeight: "700", color: scoreColor(current.score) }}>{current.score}</Text>
      </Animated.View>

      {stacks.length > 1 && !closing && (
        <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: SCORE_Y + 6, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.xl, opacity: backdropP }}>
          <TouchableOpacity onPress={() => navigate(-1)} hitSlop={14}>
            <Ionicons name="chevron-back" size={26} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigate(1)} hitSlop={14}>
            <Ionicons name="chevron-forward" size={26} color={colors.textMuted} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {sorted.map((g, i) => {
        const target = gallerySpreadTarget(i, sorted.length, size);
        const targetCenterX = target.x + size.w / 2;
        const targetCenterY = target.y + size.h / 2;
        const originWidth = STACK_W * 0.6;
        const originHeight = STACK_H * 0.78;
        const originCenterX = originRect.x + STACK_W / 2;
        const originCenterY = originRect.y + STACK_H / 2;

        const naturalSize = g.image ? galleryImageSizeCache.get(g.image) : undefined;
        const fallbackScale = Math.min(originWidth / size.w, originHeight / size.h);
        const computedScale = naturalSize
          ? containSize(originWidth, originHeight, naturalSize.width, naturalSize.height).width /
            containSize(size.w, size.h, naturalSize.width, naturalSize.height).width
          : NaN;
        // Never hand the native animated driver a NaN/Infinity scale — see cacheGalleryImageSize
        // above for why a technically-cached size could still produce one.
        const originScale = Number.isFinite(computedScale) && computedScale > 0 ? computedScale : fallbackScale;

        const gatherTX = gatherP.interpolate({ inputRange: [0, 1], outputRange: [originCenterX - gatherCX, 0], extrapolate: "clamp" });
        const gatherTY = gatherP.interpolate({ inputRange: [0, 1], outputRange: [originCenterY - gatherCY, 0], extrapolate: "clamp" });
        const scale = gatherP.interpolate({ inputRange: [0, 1], outputRange: [originScale, 1], extrapolate: "clamp" });
        const spreadTX = spreadP.interpolate({ inputRange: [0, 1], outputRange: [gatherCX - targetCenterX, 0], extrapolate: "clamp" });
        const spreadTY = spreadP.interpolate({ inputRange: [0, 1], outputRange: [gatherCY - targetCenterY, 0], extrapolate: "clamp" });
        const zIndex = 10 + (sorted.length - i);

        return (
          <Animated.View
            // Keyed by idx (which stack) too, not just g.id — the SAME garment id can appear
            // in multiple stacks shown as you arrow through them, and keying by id alone means
            // React treats "this piece in stack A" and "this piece in stack B" as the SAME
            // element across a navigate(), reusing its native view/animated binding instead of
            // cleanly unmounting the old one and mounting a fresh one. That reuse is exactly
            // what let a piece from the outfit you just navigated AWAY from linger, mid-
            // animation, at its old position while the new stack's own gather was already
            // running — reading as a piece detached and floating off to one side. Including idx
            // forces a genuine remount on every navigate, so nothing can ever carry state over
            // between two different stacks.
            key={`${idx}-${g.id}`}
            pointerEvents="none"
            style={{
              position: "absolute", left: target.x, top: target.y, width: size.w, height: size.h, zIndex,
              transform: [
                { translateX: Animated.add(gatherTX, spreadTX) as unknown as number },
                { translateY: Animated.add(gatherTY, spreadTY) as unknown as number },
                { scale },
              ],
            }}
          >
            {g.image ? <Image source={{ uri: g.image }} style={{ width: "100%", height: "100%" }} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
          </Animated.View>
        );
      })}

      <Animated.View style={{ opacity: backdropP, position: "absolute", top: insets.top + 10, left: 16 }} pointerEvents={closing ? "none" : "auto"}>
        <TouchableOpacity onPress={handleClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

type Rect = { x: number; y: number; width: number; height: number };
type GallerySpread = { pieces: StackPiece[]; score: number };

// `onOpenSpread`/`hiddenIndex` are lifted to the top-level PreviewScreen rather than owned here
// — see the top-level `gallerySpread`/`gallerySpreadHiddenIndex` state and its
// <GallerySpreadOverlay> render site for why: the overlay MUST render outside the page's own
// scrolling container (a sibling of the ScrollView, exactly like OutfitsScreen keeps its
// SpreadOverlay a sibling of its FlatList, screens/OutfitsScreen.tsx line 773) — a RN
// `position:"absolute"` view positions relative to its nearest ancestor's box, not the true
// screen/window, so an overlay rendered (as this one previously was) *inside* the scrollable
// content moved with scroll, making its SCREEN_H-fraction-based positions land wherever the
// content happened to be scrolled to. That was the real cause of the reported "spreads from the
// bottom of the screen" / "lands in the wrong (lower) spot" bugs — not the gather/spread math
// itself, which already matched OutfitsScreen's own SpreadOverlay.
function OutfitStackGallery({ impact, previewPiece, onOpenSpread, hiddenIndex }: {
  impact: Impact; previewPiece: StackPiece;
  onOpenSpread: (index: number, stacks: GallerySpread[], cardRect: Rect, remeasureIndex: (i: number) => Promise<Rect | null>) => void;
  hiddenIndex: number | null;
}) {
  // A background rAF-chunked ramp (4 -> 8 -> 12) was tried here instead of mounting all 12 stacks'
  // worth of Images synchronously (that one-shot mount was the real cost behind PieceInfo taking
  // seconds to appear/settle). It made things WORSE, not better: it only PAUSES while a piece is
  // inactive, it doesn't reset — so if a piece's ramp hadn't finished growing before the user
  // switched away (extremely likely; users switch every 1-4s, well inside the few-hundred-ms each
  // remaining chunk can take), the leftover chunks fire the instant that piece is revisited,
  // indistinguishable from a fresh mount. Confirmed directly: real logged timestamps showed
  // switchPiece taking 2.2-3.2s to EVERY piece, first visit or not, exactly matching this
  // mechanism. Simplest correct fix: don't auto-grow at all. Show a small fixed page (cheap to
  // mount, once, no background follow-up) and let the pre-existing, purely manual "SHOW MORE"
  // button below handle the rest — a user-initiated tap has no "did it finish in time" race.
  const INITIAL_GALLERY_PAGE = 4;
  const [shownCount, setShownCount] = useState(Math.min(INITIAL_GALLERY_PAGE, GALLERY_PAGE));
  const cardRefs = useRef<Record<number, View | null>>({});
  // This component unmounts the instant resultsPhase/pieceIdx changes away from whichever item it
  // belongs to (it's one branch of PieceInfo's own ternary), but openStack's measureRect await
  // keeps running to completion regardless — JS promises don't get cancelled just because the
  // component that started them went away. Switching back to compare (or to a different piece)
  // fast enough, right after tapping a stack, let that stale callback fire onOpenSpread AFTER the
  // resultsPhase-change cleanup effect had already run and closed any spread — reopening one from
  // nowhere, for an item no longer even on screen. Checking this on the way out closes the gap.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // Guards against a real race: openStack awaits measureRect before it ever touches state, so a
  // second tap (on this card or a different one) landing inside that gap fires a second
  // measureRect + onOpenSpread while the first is still in flight. GallerySpreadOverlay only
  // plays its gather/spread sequence on MOUNT (empty-deps effect) — once `gallerySpread` is
  // already non-null, a second onOpenSpread just swaps its stacks/cardRect props on the SAME
  // still-mounted instance without replaying that effect, so an already-running gather/spread
  // animation suddenly recomputes its origin/target from the NEW props mid-flight, discontinuously
  // jumping a piece onto a different trajectory — read as a piece "flying"/floating to nowhere
  // near the stack. Blocking re-entry here (reset once the overlay actually opens or the
  // measurement fails) closes that window at its source instead of tolerating a race downstream.
  const openingRef = useRef(false);

  function stackFor(o: OutfitRef): GallerySpread {
    // A combo's itemIds occasionally repeats the same id (an algorithmic-combo-generation
    // edge case) — pieces are keyed by id in GallerySpreadOverlay's own render, so a
    // duplicate id means two elements sharing one React key, which can silently inherit each
    // other's native/animated state and reads as one specific piece flying off to an
    // unrelated position. See OutfitsScreen's dedupeIds for the same fix, applied there too.
    const dedupedIds = o.itemIds.filter((id, i) => o.itemIds.indexOf(id) === i);
    const pieces: StackPiece[] = [
      ...(previewPiece.image ? [previewPiece] : []),
      ...dedupedIds.map(id => impact.items[id]).filter((g): g is WardrobeItemRef => !!g),
    ].sort((a, b) => stackRank(a) - stackRank(b));
    return { pieces, score: o.score };
  }

  async function openStack(i: number) {
    if (openingRef.current) return;
    openingRef.current = true;
    // Falls back to true screen center (matching OutfitsScreen's own openStack, line 625)
    // rather than silently doing nothing when measurement fails, so a mis-timed tap still opens
    // the stack instead of appearing to do nothing.
    const fallbackRect: Rect = { x: SCREEN_W / 2 - STACK_W / 2, y: SCREEN_H / 2 - STACK_H / 2, width: STACK_W, height: STACK_H };
    const cardRect = (await measureRectStable(cardRefs.current[i])) ?? fallbackRect;
    if (!mountedRef.current) return;
    // The FULL outfit list (not just the tapped one) so the overlay's own left/right arrows can
    // navigate between stacks without closing and reopening — matching Outfits page's own
    // "browse without leaving the spread view" feel.
    // remeasureIndex lets the overlay re-check ANY card's CURRENT position right before it
    // closes — not just this one — so navigating to a different stack via the overlay's own
    // arrows and then closing animates back to THAT card, not the one originally tapped.
    // cardRefs is stable for as long as this component stays mounted, which is the whole time
    // the overlay is open (it's a sibling overlay, not a replacement).
    onOpenSpread(i, impact.outfits.map(stackFor), cardRect, remeasureIndex);
    openingRef.current = false;
  }

  // This grid is PAGINATED (shownCount, "SHOW MORE" below) — cardRefs only ever gets populated
  // for cards that have actually been rendered. Navigating the overlay past whatever page was
  // showing when it opened meant this index's ref never existed, so measureRect silently
  // returned null and the caller's fallback (stick with whatever origin it already had, i.e. the
  // originally-tapped card) kicked in — the real cause of "closing still returns to the first
  // stack I clicked on" surviving the earlier remeasureIndex fix. Expanding the page to include
  // the requested index — invisibly, since the whole grid sits behind the overlay's own opaque
  // backdrop the entire time — before measuring closes that gap.
  async function remeasureIndex(idx: number): Promise<Rect | null> {
    if (idx >= shownCount) {
      setShownCount(idx + 1);
      await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
    }
    return measureRectStable(cardRefs.current[idx]);
  }

  if (impact.outfits.length === 0) return null;
  const shown = impact.outfits.slice(0, shownCount);
  const canShowMore = shownCount < impact.outfits.length;
  return (
    <View style={{ marginTop: spacing.md, width: "100%", alignItems: "center" }}>
      <Text style={type.label}>{impact.outfitCount} OUTFITS</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm }}>
        {shown.map((o, i) => {
          const { pieces } = stackFor(o);
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.6}
              ref={el => { cardRefs.current[i] = el as unknown as View; }}
              style={{ width: STACK_W, alignItems: "center", gap: 2 }}
              onPress={() => openStack(i)}
            >
              <View style={{ width: STACK_W, height: STACK_H, alignItems: "center", justifyContent: "center" }}>
                {pieces.map((g, j) => g.image && (
                  <Image
                    key={g.id}
                    source={{ uri: g.image }}
                    style={{ position: "absolute", width: STACK_W * 0.6, height: STACK_H * 0.78, zIndex: pieces.length - j }}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={0}
                  />
                ))}
              </View>
              <Text style={{ fontSize: 10, fontWeight: "700", color: scoreColor(o.score) }}>{o.score}</Text>
              {/* A flat color mask, not opacity on the card itself — exactly OutfitsScreen's own
                 OutfitCard technique. Toggling opacity on the card (as this previously did)
                 toggles the Image views' own visibility, which risks a native recomposite the
                 instant they reappear — reading as the stack "refreshing" right as the spread
                 closed. This way the images are never touched; only an opaque mask on top of
                 them fades away, and it always mounts (opacity-only, never conditionally
                 rendered) since a freshly-mounted mask's own first frame can paint a beat late. */}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: hiddenIndex === i ? 1 : 0, zIndex: 1000 }]} />
            </TouchableOpacity>
          );
        })}
      </View>
      {canShowMore && (
        <TextButton label="SHOW MORE" size={10} color={colors.textMuted} onPress={() => setShownCount(c => c + GALLERY_PAGE)} style={{ marginTop: spacing.md }} />
      )}
    </View>
  );
}

// How this item would move the EXISTING wardrobe forward — surfaced as extra lines inside the
// pros/aesthetics/pairings cards above (see getCardLines) rather than its own block, matching
// how the website folds "GAPS FILLED" etc. into the relevant card instead of a separate section.

// ── Single item's info block: title/brand/score/stats/cards/gallery — used both for a lone item
// and, in piece view, for whichever item of 2-3 is currently focused. Deliberately does NOT
// render the piece's own image — see SinglePieceImage (n===1) and PiecesRow (n>1) below, which
// own the image(s) directly so an image is never unmounted/remounted (let alone duplicated into
// a "flying" overlay) when switching between compare and piece view; only this info block fades
// out/in around that switch. ─────────────────────────────────────────────────────────────────
// Fades in whatever it wraps every time `active` transitions false -> true — covers the first
// time a piece is actually revealed (see mountedPieceIdx's comment: every instance is mounted
// eagerly now, but hidden until settled) AND every later revisit, which used to be a flat,
// instant `display` toggle with zero transition — confirmed directly as the dominant cause of
// switching reading as a "teleport": the pieces themselves barely move for 2 items, so the
// title/score/cards/gallery hard-cutting to a different item with no transition at all was the
// actual visible event on every switch.
//
// A shared chromeOpacity dip-then-recover was tried TWICE for this instead and failed both times
// under completely normal use: once it combined with an unrelated mount-cost bug to make
// switches take 2+ seconds, and once — with that bug gone — a real device test with taps well
// under a second apart showed the screen going blank for the whole burst, because a single
// shared value's fade-out from a NEW tap can land before the PREVIOUS tap's fade-back-in ever
// finished, and it never recovers while taps keep coming. This version can't fail that way: each
// piece owns its OWN opacity value (no cross-talk between pieces), and it only ever resets-then-
// rises toward 1 — never dips as a shared "mask" something else has to recover from. Switching
// away just hides it instantly via the parent's display:none (see the results render), which
// doesn't care what this value is mid-flight; switching back always starts a fresh 0->1 fade
// regardless of whatever incomplete state a previous, interrupted switch left behind.
function RevealOnActive({ active, children }: { active: boolean; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  // Starts false unconditionally, NOT initialized from `active` — this component only ever
  // mounts (see mountedPieceIdx's own comment: lazy, on first visit) in the SAME render where
  // `active` is already true, since a piece only gets added to that set precisely when it's
  // about to become the shown one. Seeding this ref from `active` would make THIS EXACT mount's
  // own effect see active===prevActiveRef.current (both true) and treat it as "no transition,"
  // never firing the fade on the one case that matters most: a brand new piece appearing.
  const prevActiveRef = useRef(false);
  useEffect(() => {
    if (active && !prevActiveRef.current) {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    prevActiveRef.current = active;
  }, [active, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

// memo()'d now that a wImpact merge for item A's own entry (setResults(prev =>
// prev.map(...)), which leaves every OTHER item's object reference untouched) would otherwise
// still re-render item B's/C's own already-settled, unrelated
// PieceInfo instances for no reason, real reconciliation work competing with whatever's animating.
const PieceInfo = memo(function PieceInfo({
  item, gallerySpreadHiddenIndex, onOpenGallerySpread,
}: {
  item: ItemResult; gallerySpreadHiddenIndex: number | null;
  onOpenGallerySpread: (index: number, stacks: GallerySpread[], cardRect: Rect, remeasureIndex: (i: number) => Promise<Rect | null>) => void;
}) {
  const { hasAI } = useEntitlements();
  const cardOrder = hasAI ? CARD_ORDER : (["pairings"] as CardKey[]);
  const [cardIdx, setCardIdx] = useState(0);
  // Reset to PROS whenever a different item becomes focused (piece view paging, or a fresh
  // single-item result) — matches the website defaulting to Pros on every new result.
  useEffect(() => { setCardIdx(0); }, [item]);

  const previewPiece = { id: "__preview__", image: item.basic.image, category: item.basic.category, sub_type: item.deep.sub_type };

  return (
    <View style={{ width: "100%", alignItems: "center" }}>
      {/* Reclaiming the screen's now-smaller top padding as breathing room BETWEEN blocks
         instead — image-to-title, title-to-score, and score-to-scrollable-text (cardBox below)
         all got wider gaps than the tightened, cramped spacing an earlier pass used. */}
      <Text style={[type.title, { textAlign: "center", marginTop: spacing.xs }]}>{item.basic.title}</Text>
      {item.basic.brand && <Text style={[type.label, { marginTop: 2 }]}>{item.basic.brand.toUpperCase()}</Text>}

      {hasAI ? (
        <>
          <Text style={[styles.bigScore, { color: scoreColor(item.overall), marginTop: spacing.lg }]}>{item.overall}</Text>
          <Text style={type.label}>OVERALL</Text>

          {/* Explicit 2x2 grid (was a flex-wrap row relying on however 4 items happened to reflow)
             so AESTHETIC % always lands directly under AVG OUTFIT, not wherever wrapping put it. */}
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            {[METRIC_ROWS.slice(1, 3), METRIC_ROWS.slice(3, 5)].map((row, ri) => (
              <View key={ri} style={styles.statsRow}>
                {row.map(m => (
                  <View key={m.key} style={styles.stat}>
                    <Text style={[type.title, { fontSize: 16, color: metricColor(m.key, metricValue(item, m.key)) }]}>{metricValue(item, m.key)}</Text>
                    <Text style={[type.label, { fontSize: 8 }]}>{m.label}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </>
      ) : (
        // Free tier: no scoring/analysis — outfit COUNT is still shown (structural, not AI),
        // scores/aesthetic-fit are not.
        <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
          <Text style={[type.title, { fontSize: 16 }]}>{item.impact.outfitCount}</Text>
          <Text style={type.label}>POSSIBLE OUTFITS</Text>
        </View>
      )}

      <InfoCard item={item} cardIdx={cardIdx} onCycle={dir => setCardIdx(i => (i + dir + cardOrder.length) % cardOrder.length)} cardOrder={cardOrder} />

      <OutfitStackGallery impact={item.impact} previewPiece={previewPiece} onOpenSpread={onOpenGallerySpread} hiddenIndex={gallerySpreadHiddenIndex} />
    </View>
  );
});

// n===1's own image — held centered, then slides up into its resting spot (see the entrance
// animation in finishConfirmAndAnalyze). Never part of PiecesRow since a lone item has no
// compare/preview distinction to share a row for.
//
// memo()'d for the identical reason PiecesRow already is: without it, every wardrobe-impact
// merge (setResults(prev => prev.map(...)), touching only wImpact/overdoneNote — fields this
// component never reads) forces a full re-render of this Image right in the middle of its own
// entrance hold-then-move animation. Confirmed directly: real logged timestamps showed the
// one-piece entrance's hold+move taking 3865ms against the two-piece row's 1410ms for the
// identical coded 850+420=1270ms sequence — the extra ~2.5s lines up with exactly this class of
// unnecessary re-render competing for the JS/UI thread while the animation is trying to run.
// Paired with the `visualResults` (see its own comment) the caller now passes instead of raw
// `results`, this item prop stays reference-stable across any wImpact-only update, so memo has
// something stable to actually compare against.
const SinglePieceImage = memo(function SinglePieceImage({ item, imageEntrance }: { item: ItemResult; imageEntrance: Animated.Value }) {
  const insets = useSafeAreaInsets();
  // Formula and layout now match PiecesRow's own NATURAL_Y/entrance exactly (n>1's version,
  // confirmed to actually rest correctly) instead of this component's own separate, slightly
  // different version — no extra `+ spacing.sm` term, and no marginTop on the wrapper either
  // (PiecesRow's row has none), since that mismatch was the one real, concrete difference
  // between a formula that was reported working and one that wasn't. Also dropped the
  // 1.35->1 scale interpolation PiecesRow never had — a piece that's simultaneously scaling AND
  // translating reads as less "at rest" during the hold than one that's purely repositioning,
  // which is exactly the quality difference being described between the two.
  const NATURAL_Y = insets.top + RESULTS_TOP_PAD + RESET_ROW_H + (styles.resultImg.width as number) / 2;
  const startOffset = loadingCenterY(insets) - NATURAL_Y;
  const imgTranslateY = imageEntrance.interpolate({ inputRange: [0, 1], outputRange: [startOffset, 0] });
  return (
    <Animated.View style={{ transform: [{ translateY: imgTranslateY }] }}>
      {item.basic.image ? <Image source={{ uri: item.basic.image }} style={styles.resultImg} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
    </Animated.View>
  );
});

// 2-piece images match the single-item view's own 140px (styles.resultImg) exactly — 3-piece
// only steps down because 3*140px plus gaps overflows every real phone width.
function arrangedImgSize(n: number): number { return n === 2 ? (styles.resultImg.width as number) : 104; }
function arrangedGap(n: number): number { return n === 2 ? spacing.xl + spacing.xs : spacing.md; }
// Fixed spacing between piece CENTERS in compare mode — evenly spread, wide enough to compare
// comfortably. This never changes; it's the layout the row is naturally in (via flex+gap) at
// pieceX=0, and what it returns to on the way back from preview.
function compareStep(n: number): number { return arrangedImgSize(n) + arrangedGap(n); }
function compareOffsetX(n: number, i: number): number { return (i - (n - 1) / 2) * compareStep(n); }
// Distance from either screen edge a piece's own edge must keep clear. For 2 full-size (140px)
// pieces at equal size (no shrinking — explicitly not wanted) on a ~390-430pt phone screen,
// centering one piece completely leaves only ~125-145px on either side for the other, LESS than
// its own 140px width: "fully centered," "same size," and "other piece fully on-screen with zero
// overlap" cannot all be true simultaneously, ever, on this screen width — a real geometric
// constraint, not a bug. Checked the actual numbers directly rather than guess: a LARGER margin
// here pushes the unfocused piece CLOSER to center, which INCREASES how much of it the focused
// piece's own higher zIndex covers — the opposite of "more visible." At the original 8px margin,
// 117 of 140px stayed visible; a much larger margin was tried here first and actually dropped
// that to 61px — a real, verified regression, reverted immediately once the arithmetic was
// checked. 0 margin (this piece's edge landing exactly at the screen edge, zero clearance)
// maximizes total visible width at 125 of 140px — better than either direction — and this stays
// FULLY on screen (no overflow past SCREEN_W itself), just with no breathing room left over.
const WALL_MARGIN = 0;
function wallLimit(size: number): number { return SCREEN_W / 2 - size / 2 - WALL_MARGIN; }
// SEVERAL designs were tried here before this one, across many rounds of real device testing —
// worth reading in full before touching this again, because the failures were each specific enough
// to rule out entire categories of "obvious" fixes:
// 1. An earlier [0,1]-progress version needed a rebuilt interpolation node on every focus change (a
//    real, reported "wrong intermediate position" bug).
// 2. A single shared `shiftPx`, clamped per piece via a derived interpolation, read as
//    architecturally sound and even measured correctly ONCE in isolation, but repeated, systematic
//    testing kept showing pieces never actually reaching their target position at all — sometimes
//    stuck at the compare layout's own natural position regardless of which piece was "focused."
// 3. An independent-per-piece Animated.Value (retargeted via plain, unanimated .setValue() calls,
//    zero Animated.timing involved) STILL silently failed to apply on a real device — which is what
//    ultimately ruled out animation timing/races as a cause and pointed at Animated.Value +
//    useNativeDriver instead: a native view whose transform had EVER been driven by
//    useNativeDriver:true can silently ignore a LATER plain-JS (non-timing) style update to that
//    same property, because the native side had already taken direct ownership of that view's
//    transform matrix.
// 4. Plain React state (pieceXState, a real JS number array) fixed #3's specific mechanism — no
//    ambiguity at rest — with every transition (open/switch/close) animating toward it via one
//    shared, rebuilt-per-tap one-shot Animated.Value (transitionProgress), the view remounting (see
//    the since-removed pieceViewGen) at the instant control handed back from that animated node to
//    the plain number. That fixed the ENTRANCE's own one-time version of this handoff, but broke
//    again on the SECOND open/switch/close onward: rebuilding transitionProgress's interpolation
//    node fresh every tap and calling .start() on it in the same synchronous tick raced React's own
//    commit of that brand-new node to the native view — unlike modeP/totalTY's own interpolation
//    (see its own comment), which is built exactly ONCE, ever, and only ever has its DRIVING value
//    retargeted afterward, with nothing to rebuild or re-attach.
// 5. #3's own idea again — an independent-per-piece Animated.Value, this time retargeted ONLY via
//    Animated.timing(..., {useNativeDriver:true}), never a plain .setValue() jump, with
//    PiecesRow's pieceTransforms building each interpolation from it exactly ONCE. Reasoned soundly
//    on paper (avoids every mechanism #1-#4 are individually known to fail on) — and STILL froze
//    mid-transition and landed on the wrong final X on a real device. The common thread across
//    EVERY attempt above that used useNativeDriver:true for X, regardless of exact shape, is that
//    it never actually held up under real testing; #2 and #3's "stuck at the wrong position"
//    symptom in particular recurred here too.
// 6. Went JS-driven (useNativeDriver:false) for the first time, but kept pieceXAnim as a purely
//    cosmetic MIRROR of a separate pieceXState (a real JS number array, set instantly/synchronously
//    by openPiece/backToCompare/switchPiece — same idea as #4), trailing it via a plain useEffect
//    watching pieceXState. Also hit two real bugs: (a) rendering pieceXAnim combined with
//    entranceP's own native-driver interpolation via Animated.add — even ONCE, even pre-settle when
//    pieceXAnim was still just sitting at 0 — permanently flagged it native-owned inside RN, so the
//    FIRST later useNativeDriver:false .timing() call on it threw a hard render-error crash on a
//    real device ("Attempting to run JS driven animation on animated node that has been moved to
//    'native'..."); (b) even after removing that mixing, endpoints came out visually ONE STEP
//    BEHIND — compare -> piece read as "both slide up, nothing separates," and piece -> compare
//    read as "one centers, other to the side" (i.e. showing whatever the PREVIOUS transition's
//    target was, not the one just requested) — the extra state-plus-watching-effect layer between
//    "what was tapped" and "what actually animates" was real indirection with no way to easily
//    verify it stayed in sync, and evidently didn't.
// 7. Removed that layer — pieceXAnim retargeted DIRECTLY via Animated.timing(...,
//    {useNativeDriver:false}).start(), called right inside openPiece/backToCompare/switchPiece
//    themselves, no separate state, nothing to go stale. This one was verified with real
//    instrumentation (logPreviewTiming, reading the actual persisted log off the simulator's disk,
//    plus __getValue() snapshots before/after each transition) rather than reasoned about — and the
//    instrumentation showed pieceXAnim's JS-side value WAS updating correctly (e.g. 0 -> -32.7,
//    -78.0 after a real transition) while a screenshot of the SAME live app, at a stable point with
//    no animation in flight, showed the pieces rendered at their untouched natural positions —
//    confirmed with a fresh reload and a deliberate single-tap-then-hold test, not stale evidence.
//    The JS value was correct; the native view never reflected it. That gap — a raw Animated.Value
//    sitting inside a transform array's translateX with useNativeDriver:false not reliably reaching
//    the native side — is a known rough edge on React Native's New Architecture (this project runs
//    RN 0.81 / Expo 54, New Architecture on by default), and is not something any JS-side fix to
//    this file can route around.
// This version abandons Animated.Value for X entirely, for both directions (native-driver AND
// JS-driven have now each failed differently, on a real device, confirmed by real evidence rather
// than reasoning about it) — pieceXState (main component) is plain React state again, set
// instantly by openPiece/backToCompare/switchPiece exactly like the ORIGINAL pre-animation version
// of this screen (confirmed correct then, confirmed correct again now — a real device retest with
// this version landed on the right endpoint for open/close/switch alike). A LayoutAnimation.
// configureNext() pass was tried on top, to get a smooth transition without reintroducing Animated
// — also confirmed NOT to work, on a real device: it visibly animated nothing for switchPiece
// specifically (nothing else on screen changes for that transition to mask an unanimated snap),
// reproducing the ORIGINAL "text alternates, image doesn't" report this whole effort started from.
// Almost certainly because pieceX moves via style.transform (a paint-time property) rather than an
// actual Yoga layout/frame change, which is specifically what LayoutAnimation's "update" tracks —
// removed rather than left in a state that only sometimes visibly does anything. pieceXState is
// currently an unanimated, instant snap; see runTransition's own comment. entranceTX (pre-settle
// only) is untouched by any of this.
function pieceTargetX(n: number, pieceIdx: number, focusedIdx: number | null, wall: number): number {
  if (focusedIdx === null) return 0; // compare mode — natural flex position, no shift at all
  const naturalPos = compareOffsetX(n, pieceIdx);
  // Shift that brings the FOCUSED piece's own natural position to dead center (0).
  const shift = -compareOffsetX(n, focusedIdx);
  // Clamp the piece's FINAL absolute position to the wall, not the raw shift — clamping the
  // shift let the other piece's already-off-center natural position add on top of a
  // wall-sized shift and land it far past the wall. This also guarantees the focused piece
  // itself always lands exactly at 0: naturalPos + shift is 0 by construction when
  // pieceIdx === focusedIdx, which is always within [-wall, wall].
  const finalPos = Math.max(-wall, Math.min(wall, naturalPos + shift));
  return finalPos - naturalPos;
}

// ── Shared image row for 2-3 items — used for BOTH compare and preview(piece) layouts. Per the
// explicit simplifying insight this was rebuilt around: compare and preview differ ONLY in
// horizontal placement, never vertically — so there is exactly ONE row of real images (never
// unmounted, remounted, or duplicated into a flying overlay for any of these transitions), and
// the only thing that ever changes is a plain per-piece horizontal offset — each piece's own
// independent pieceX value (see pieceTargetX's own comment).
// Memoized, and does not take pieceIdx at all — it never actually used it (nothing here reads
// which piece is "current"; badges/images/metric text are keyed by array index i, not by which
// one is focused). onTapPiece is built from stable refs (see pieceIdxRef/resultsPhaseRef below)
// specifically so this memo isn't defeated by that prop silently changing reference on every
// switch.
const PiecesRow = memo(function PiecesRow({
  results, entranceP, entranceSettled, pieceXState, resultsPhase, chromeOpacity, onTapPiece, focalMetric,
}: {
  results: ItemResult[]; entranceP: Animated.Value; entranceSettled: boolean; pieceXState: number[];
  resultsPhase: "compare" | "piece"; chromeOpacity: Animated.Value;
  onTapPiece: (i: number) => void; focalMetric: keyof Impact | "overall";
}) {
  const insets = useSafeAreaInsets();
  const n = results.length;
  const size = arrangedImgSize(n);
  const gap = arrangedGap(n);
  const ranked = [...results].map((r, i) => i).sort((a, b) => results[b].overall - results[a].overall);
  function badgeFor(i: number): { text: string; color: string } {
    if (n === 2) return i === ranked[0] ? { text: "BETTER", color: colors.good } : { text: "WORSE", color: colors.bad };
    const pos = ranked.indexOf(i);
    return pos === 0 ? { text: "BEST", color: colors.good } : pos === n - 1 ? { text: "WORST", color: colors.bad } : { text: "MID", color: colors.textMuted };
  }

  // Entrance holds the gathered stack at the SAME center point the loading spinner uses (see
  // loadingCenterY) before sliding up into its resting row position, which is COMPARE_Y_OFFSET
  // BELOW the flex-natural position (matching SinglePieceImage's own resting spot) — compare
  // mode's row reads as properly centered lower down; going into single-piece preview shifts it
  // the rest of the way up to that natural spot (see modeTY below).
  const NATURAL_Y = insets.top + RESULTS_TOP_PAD + RESET_ROW_H + size / 2;
  const entranceStartY = loadingCenterY(insets) - NATURAL_Y;
  // Once settled, Y is a plain number derived straight from resultsPhase — COMPARE_Y_OFFSET in
  // compare, 0 in piece view — no Animated.Value involved at all, same reasoning and same fix as
  // pieceTransforms below: modeP (an Animated.Value) used to carry this, animated via
  // Animated.timing while chrome/X animated in parallel, but per explicit direction NOTHING about
  // position animates anymore — everything happens instantly, hidden behind a chrome fade (see
  // runTransition) — so modeP was reduced to a single .setValue() call, and THAT hit the exact
  // same "plain .setValue() on a value that's ever been driven by the native driver doesn't apply
  // cleanly" limitation documented at length elsewhere in this file (see pieceXState's own
  // history): reported as visible "micro shifts" instead of one clean instant jump. Removing
  // modeP/Animated from the picture for Y entirely, the same way pieceXState already did for X,
  // removes the mechanism that symptom depends on rather than patching around it again.
  const totalTY = useMemo(() => {
    if (entranceSettled) return (resultsPhase === "compare" ? COMPARE_Y_OFFSET : 0) as unknown as number;
    return entranceP.interpolate({ inputRange: [0, 1], outputRange: [entranceStartY, COMPARE_Y_OFFSET] }) as unknown as number;
  }, [entranceP, entranceStartY, entranceSettled, resultsPhase]);
  // Recomputed whenever pieceXState changes (i.e. every tap) — deliberately, unlike totalTY above.
  // That's fine here specifically BECAUSE pieceXState is a plain JS number with no Animated node to
  // desync from: once entranceSettled, this is just pieceXState[i], a real number, handed straight
  // to the style prop on a real re-render (pieceXState is a real React state array — see its own
  // comment for why: every Animated.Value-based attempt at this specifically, in either driver mode,
  // failed differently on a real device).
  const pieceTransforms = useMemo(() => {
    return Array.from({ length: n }, (_, i) => {
      // Once the one-time entrance is settled, entranceTX is not just assumed to have cancelled to
      // 0, it's structurally REMOVED from the computation entirely (pieceXState[i] used alone).
      // Every fix attempted for an EARLIER version of this bug (a shared shiftPx, an independent
      // per-piece Animated.Value, an instant .setValue(), forcing compareEntranceP/imageEntrance to
      // exactly 1) changed how pieceX itself was driven and NONE of them changed this specific
      // symptom at all — the focused piece landing off toward its own natural side, the far piece
      // pushed even further — which means the common factor across every attempt, entranceTX being
      // ADDED to the result forever (not just during the actual entrance), was never actually ruled
      // out, only ever patched around. This removes it from the equation by construction once it's
      // no longer needed, instead of continuing to trust that a shared, interpolation-driven value
      // reliably reaches exactly 0 and stays there.
      if (entranceSettled) return pieceXState[i] ?? 0;
      const cOffset = compareOffsetX(n, i);
      return entranceP.interpolate({ inputRange: [0, 1], outputRange: [-cOffset, 0] }) as unknown as number;
    });
  }, [n, entranceP, entranceSettled, pieceXState]);

  return (
    // key includes entranceSettled — same remount-on-handoff reasoning as the per-piece views
    // below: totalTY is a native-driver interpolation pre-settle, then a plain number after, and
    // reusing the same native view across that handoff is what left it stuck before.
    <Animated.View key={String(entranceSettled)} style={{ flexDirection: "row", justifyContent: "center", gap, width: "100%", transform: [{ translateY: totalTY }] }}>
      {results.map((r, i) => {
        const badge = badgeFor(i);
        // No scale/resize here, deliberately — a scale-based "focus" effect (bigger when
        // centered, smaller toward the wall) was tried and reverted per explicit direction: it
        // added visible jitter/unsmoothness and wasn't wanted in the first place — position-only
        // sliding, unchanged size, is the original and correct design. Only horizontal position
        // ever moves.
        return (
          // key includes entranceSettled: translateX is native-driver-animated (entranceTX, via
          // entranceP/compareEntranceP's own useNativeDriver:true timing) before settling, then a
          // PLAIN JS NUMBER (pieceXState[i]) after — reusing the SAME native view across that
          // handoff leaves it stuck on whatever the native driver set last, since native-driver
          // updates bypass the normal style diff plain JS updates rely on. This is the ORIGINAL bug
          // this whole effort started from ("text alternates, image doesn't") and the original fix:
          // remounting fresh exactly once, right as control changes hands from native-driver to
          // plain JS, so the new view was never touched by the native driver. Only needs to key off
          // entranceSettled (not a repeatedly-bumped generation counter, as an earlier version of
          // this same fix used) because pieceXState, now that X is fully off Animated, never goes
          // BACK to being native-driver-controlled after settling — the handoff only ever happens
          // once, ever, per mount.
          <Animated.View key={`${i}-${entranceSettled}`} style={{ width: size, alignItems: "center", zIndex: i, transform: [{ translateX: pieceTransforms[i] }] }}>
            {/* Badges are compare-only content — mounted only in compare, so they cut out cleanly
               as part of the transition rather than lingering as a separately-fading "lighter
               text" stage (explicitly not wanted). Gated on resultsPhase (not just opacity) so
               they don't silently reappear once chromeOpacity fades back to 1 for the piece
               view's own info block. */}
            {resultsPhase === "compare" && (
              <Animated.Text style={[type.label, { fontSize: 9, color: badge.color, marginBottom: 2, opacity: chromeOpacity }]}>{badge.text}</Animated.Text>
            )}
            {/* activeOpacity=1: TouchableOpacity's own default press-dim was compounding with the
               deliberate opacity/position logic elsewhere in this transition and read as a stray
               highlight/"refresh" flash the instant a piece was tapped. */}
            <TouchableOpacity activeOpacity={1} onPress={() => onTapPiece(i)}>
              {r.basic.image ? (
                <Image source={{ uri: r.basic.image }} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory-disk" transition={0} />
              ) : null}
            </TouchableOpacity>
            {/* Compare-only, like the badge above — the metrics scroll list now shows headers
               only (see CompareMetricsList), and this is where its numbers actually live:
               whichever metric is currently focal there. */}
            {resultsPhase === "compare" && (
              <Animated.Text style={{ fontSize: 15, fontWeight: "700", marginTop: 4, color: metricColor(focalMetric, metricValue(r, focalMetric)), opacity: chromeOpacity }}>
                {metricValue(r, focalMetric)}
              </Animated.Text>
            )}
          </Animated.View>
        );
      })}
    </Animated.View>
  );
});

// Same header-then-values shape for BOTH 2 and 3 pieces now — an earlier version put the 2-piece
// field label inline between both scores on ONE row (a 3-way `spread` split: score / label /
// score), but with only 1/3 of the row's width to work with, longer labels ("AESTHETIC %", "NEW
// OUTFITS") were visibly compressed, and — worse — squeezed the two score segments narrow enough
// to clip them too. Giving the header its own full-width row (matching 3-piece) fixes both: the
// label gets the whole row to itself, and the values row below is just the 2 (or 3) scores with
// nothing else competing for space.
// Headers only now — the actual numbers moved to a small readout under each piece in PiecesRow,
// keyed to whichever header is currently focal in this list (see onFocalIndexChange below and
// PreviewScreen's own focalMetric state). Scrolling through PROS/CONS-style header text and
// separately reading numbers elsewhere felt disconnected from what's actually being compared;
// this way scrubbing through metrics directly drives the number under each piece.
function buildMetricHeaderItems(): FocusItem[] {
  return METRIC_ROWS.map(m => ({ key: m.key, text: m.label, header: true, color: colors.textFaint }));
}

// Rebuilt on FocusScrollList (the same magnifiable scrollable text InfoCard/PieceInfo's cards
// use) at its own font size, rather than a plain static list.
// Same height/position as before the number-under-piece rework — that rework's only actual
// change here is the DATA (headers only now, see buildMetricHeaderItems), not this list's own
// size or placement. Shrinking the container along with it made it read as compressed and sit
// higher, overlapping the numbers now living under each piece.
const COMPARE_METRICS_H = 220;
function CompareMetricsList({ onFocalMetricChange }: { onFocalMetricChange: (key: keyof Impact | "overall") => void }) {
  // No marginTop here — the caller (PreviewScreen's results render) computes an explicit
  // marginTop that centers this whole block in the real leftover space below the pieces, so this
  // component's own height needs to be the ONLY thing baked in here.
  return (
    <View style={{ height: COMPARE_METRICS_H, width: "100%" }}>
      <FocusScrollList items={buildMetricHeaderItems()} focal={0.5} onFocalIndexChange={i => onFocalMetricChange(METRIC_ROWS[i].key)} />
    </View>
  );
}
// Free tier's compare-mode content: no AI head-to-head, just whether the selected pieces' own
// colors pair well together — the same deterministic rule table Preview's per-piece PAIRINGS
// card falls back to (see getCardLines/colorTheory.ts). Same fixed height as CompareMetricsList
// so compareHeaderMarginTop's centering math doesn't need a separate branch for this case.
function FreeCompareColorPairings({ items }: { items: ItemResult[] }) {
  const pairs: { a: string; b: string; ok: boolean }[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].basic.color_primary, b = items[j].basic.color_primary;
      if (a && b) pairs.push({ a, b, ok: colorsPairWell(a, b) });
    }
  }
  return (
    <View style={{ height: COMPARE_METRICS_H, width: "100%", alignItems: "center", justifyContent: "center", gap: spacing.sm }}>
      <Text style={type.label}>COLOR PAIRINGS</Text>
      {pairs.length === 0 && <Text style={[type.body, { color: colors.textFaint }]}>Not enough color data to compare.</Text>}
      {pairs.map((p, i) => (
        <Text key={i} style={[type.body, { fontSize: 12, color: p.ok ? colors.good : colors.textMuted, textAlign: "center" }]}>
          {p.a} + {p.b}: {p.ok ? "pairs well" : "no strong pairing"}
        </Text>
      ))}
    </View>
  );
}

// PiecesRow's own row height beyond the raw image: compare mode's badge above it (~9pt text +
// 2px margin) and metric number below it (~15pt bold text + 4px margin) — both real, rendered
// content (see PiecesRow's badge/metric Text elements) that a pure `size` estimate would miss.
const COMPARE_ROW_EXTRA = 40;
// Explicit, computed centering for CompareMetricsList in compare mode — replaces an earlier
// flex:1/justifyContent:"center" attempt that never actually centered anything: flex:1 on a
// child of a ScrollView's own content is a well-known unreliable combination in React Native
// (flexGrow:1 on contentContainerStyle is a scroll-view-specific hack for "at least screen
// height," which doesn't reliably cascade into letting a nested child's own flex:1 further
// subdivide that space) — no amount of retrying the same flex approach was going to fix that.
// Computing the real available band directly from the same fixed constants everything else in
// this file already uses (RESULTS_TOP_PAD, RESET_ROW_H, the piece size, the reserved nav-bar
// band) and centering THIS component's own known height within it sidesteps the unreliable
// mechanism entirely.
function compareHeaderMarginTop(n: number, insets: { top: number; bottom: number }): number {
  const piecesRowBottom = insets.top + RESULTS_TOP_PAD + RESET_ROW_H + arrangedImgSize(n) + COMPARE_ROW_EXTRA;
  const navBarTop = SCREEN_H - (BAR_CONTENT_H + insets.bottom + BAR_BOTTOM_GAP);
  const available = navBarTop - piecesRowBottom;
  return Math.max(spacing.sm, (available - COMPARE_METRICS_H) / 2);
}

function measureRect(target: View | null): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise(resolve => {
    if (!target) { resolve(null); return; }
    target.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

// Same reasoning as CalendarScreen's measureDestinationCell / OutfitsScreen's
// measureRectStable: a card whose layout JUST changed (shownCount just expanded a page,
// results just merged in wardrobe-impact data, the grid reflowed) can report a stale/
// transient position from measureInWindow for a frame or two before native layout actually
// settles — trusting the very first reading risked opening the gather animation from a real
// rect, just the WRONG one, which reads as a piece flying off toward wherever that stale
// position happened to be rather than smoothly opening from the tapped card. Requires the
// SAME rect on two consecutive frames before trusting it.
async function measureRectStable(target: View | null): Promise<{ x: number; y: number; width: number; height: number } | null> {
  let lastRect: { x: number; y: number; width: number; height: number } | null = null;
  let attempts = 0;
  while (attempts < 10) {
    const rect = await measureRect(target);
    if (rect && lastRect && rect.x === lastRect.x && rect.y === lastRect.y && rect.width === lastRect.width && rect.height === lastRect.height) {
      return rect;
    }
    lastRect = rect;
    attempts++;
    await new Promise<void>(res => requestAnimationFrame(() => res()));
  }
  return lastRect;
}

// Wraps one `step`'s entire content block so entering that step (input/identifying/confirming/
// results) always fades smoothly in rather than snapping onto the screen the instant the previous
// step's content unmounts — a plain instant swap between two very different-looking full screens
// (e.g. RESET jumping straight from a finished result back to a blank input form) read as a flash.
// A fresh Animated.Value per mount rather than one shared value reset via a state-driven effect —
// it genuinely starts at 0 on its very first render (no earlier frame exists to leak a stale
// value through), and since each `step` block only mounts/unmounts on an actual step change (not
// on in-place paging like confirmIdx or pieceIdx advancing), this fires exactly once per real
// screen transition and never in between.
function StepFade({ children }: { children: ReactNode }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Animated.timing(p, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }));
  }, [p]);
  return <Animated.View style={{ flex: 1, opacity: p }}>{children}</Animated.View>;
}

// Matches the website's Preview tool: up to 3 input slots, analyzed together — one item gives a
// single fit check, more than one becomes a comparison. Staged flow mirrors the website's
// PageStep exactly: input → identifying → confirming (one item at a time) → analyzing → results.
export default function PreviewScreen() {
  const insets = useSafeAreaInsets();
  const { hasAI } = useEntitlements();
  const { setSuppressed } = useNavBarVisibility();
  const [slots, setSlots] = useState<PreviewSlot[]>(() => Array.from({ length: MAX_COMPARE }, emptySlot));
  const [step, setStep] = useState<"input" | "identifying" | "confirming" | "analyzing" | "results">("input");
  const [stageLabel, setStageLabel] = useState("");
  const [pending, setPending] = useState<(IdentifyResp & { image: string })[]>([]);
  const [confirmIdx, setConfirmIdx] = useState(0);
  const [results, setResults] = useState<ItemResult[]>([]);
  // A reference-stable view of `results` for whatever only needs the VISUAL fields (image,
  // overall score) — PiecesRow and SinglePieceImage, i.e. exactly the two components driving the
  // entrance/switch/openPiece animations. The wardrobe-impact merge above creates a new
  // `results` array on every single per-item resolution (confirmed via real logged timestamps:
  // openPiece/switchPiece, coded at ~550ms/340ms, were actually taking 3+ seconds and 570-810ms
  // respectively) — but that merge only ever touches wImpact/overdoneNote, fields PiecesRow and
  // SinglePieceImage never read (getCardLines, the actual consumer, reads them from `results`
  // directly, not from this). PiecesRow is already memo()'d specifically to skip re-rendering
  // when nothing it displays changed, but memo's shallow comparison still sees a "different"
  // results array on every wImpact merge and re-renders anyway — real reconciliation work
  // (multiple Images, several Animated.Text nodes) landing at the exact moment an entrance/
  // switch/openPiece animation is trying to run smoothly, competing for the same JS/UI thread.
  // Recomputing visualKey is cheap (a join over at most 3 items); useMemo only returns a NEW
  // array when that key's actual VALUE changes, so a wImpact-only update leaves PiecesRow's own
  // memo comparison seeing the identical reference it saw before — genuinely nothing to do.
  const visualResultsKey = results.map(r => `${r.basic.image}|${r.overall}`).join("");
  const visualResults = useMemo(() => results, [visualResultsKey]);
  // Bumped once per genuinely fresh analysis (see finishConfirmAndAnalyze), NOT on the later
  // per-item wardrobe-impact merge (setResults(prev => prev.map(...)) below) — that merge
  // creates a new `results` array reference too, which, if the entrance effect were keyed on
  // `results` itself, would re-fire the ENTIRE hold-then-move sequence a second time whenever
  // that impact call happened to resolve WHILE the first entrance was still mid-flight,
  // redirecting pieceX/imageEntrance from wherever they currently were instead of leaving them
  // alone. Keying on this counter instead means the entrance only ever plays once per real
  // "confirm & analyze," regardless of what else touches `results` afterward.
  const [entranceKey, setEntranceKey] = useState(0);
  const [cmp2, setCmp2] = useState<Cmp2 | null>(null);
  const [cmp3, setCmp3] = useState<Cmp3 | null>(null);
  const [resultsPhase, setResultsPhase] = useState<"compare" | "piece">("compare");
  const [pieceIdx, setPieceIdx] = useState(0);
  // PieceInfo's OutfitStackGallery mounts several outfit stacks worth of <Image>s, a real
  // synchronous cost. Mounting every result's instance up front (all at once, the moment results
  // is first set) was tried — reasoning that doing it while "analyzing…" is still on screen,
  // before the results screen or its animations exist, would be a safe time to pay that cost —
  // but a real device test showed switchPiece landing at a uniform ~950-1300ms against a coded
  // 340ms budget, roughly 3x worse than the ~500-635ms this same interaction measured at right
  // before that change. Reverted back to lazy-but-sticky: each item's PieceInfo mounts on its OWN
  // first visit (activeIdx below) and then stays mounted (display:"none" while inactive) — a
  // revisit is a display toggle, not a remount, and no two instances ever pay their mount cost in
  // the same commit. pieceInfoSettled still gates the FIRST mount past the entrance's own
  // animation window.
  const [pieceInfoSettled, setPieceInfoSettled] = useState(false);
  const [mountedPieceIdx, setMountedPieceIdx] = useState<Set<number>>(new Set());
  // Always-fresh mirrors so onTapPiece (below) can read the CURRENT values without listing them
  // as its own useCallback deps — same pattern as BuilderScreen's sheetOpenRef, used here so
  // onTapPiece's reference stays stable across a piece switch instead of changing every single
  // time pieceIdx does, which would otherwise defeat PiecesRow's memoization (see its own
  // comment) right when that memo matters most.
  const resultsPhaseRef = useRef(resultsPhase);
  const pieceIdxRef = useRef(pieceIdx);
  const pieceInfoSettledRef = useRef(pieceInfoSettled);
  resultsPhaseRef.current = resultsPhase;
  pieceIdxRef.current = pieceIdx;
  pieceInfoSettledRef.current = pieceInfoSettled;
  // Which metric's number currently shows under each piece in compare mode — driven by whichever
  // header is focal in CompareMetricsList's own scroll list (see FocusScrollList's
  // onFocalIndexChange). Defaults to OVERALL, matching the list's own initial scroll position.
  const [focalMetric, setFocalMetric] = useState<keyof Impact | "overall">("overall");

  const chromeOpacity = useRef(new Animated.Value(1)).current;
  const imageEntrance = useRef(new Animated.Value(0)).current;
  // Compare-phase entrance only — pieces start overlapping in one small stack at screen center
  // and animate out to their real fixed home slots (see PiecesRow). Runs once, the first time
  // results ever land in compare phase; switching phases later reuses pieceX/modeP instead.
  const compareEntranceP = useRef(new Animated.Value(0)).current;
  // Each piece's X position — plain React state, a real JS number array, set INSTANTLY and
  // synchronously by openPiece/backToCompare/switchPiece — exactly the original, pre-animation
  // mechanism this screen used before ANY of this session's animation work, confirmed correct then
  // and unchanged now. Every Animated.Value-based attempt at animating this directly (four across
  // this session: a rebuilt-per-tap shared interpolation; an independent-per-piece Animated.Value
  // via useNativeDriver:true; the same via useNativeDriver:false driven through a separate watching
  // effect; the same driven directly from the tap handler) reached a DIFFERENT real failure on an
  // actual device — landing at the wrong position, freezing, or (confirmed via this session's own
  // diagnostic logging AND a live device screenshot) the underlying value visibly changing while
  // the rendered view never moved at all. That last one in particular — a real, verified gap
  // between "the JS value updated" and "the native transform reflects it" for a raw Animated.Value
  // sitting inside a transform array with useNativeDriver:false — is a known rough edge on React
  // Native's newer architecture (this project runs RN 0.81 / Expo 54, New Architecture by default).
  // Plain state removes Animated from the picture for X entirely: pieceXState changing IS a real
  // React re-render with a real new number in the style prop, guaranteed to reach the view. Per
  // explicit direction, no longer even trying to animate the position change itself (X or Y) —
  // see runTransition's own comment for the current fade-out/apply/fade-in shape, where pieceXState
  // changes instantly while chrome is fully invisible instead.
  const [pieceXState, setPieceXState] = useState<number[]>([0, 0, 0]);
  // The info block's own Y position — compare's header margin, or 0 (natural) in piece view. Was
  // driven by modeP (an Animated.Value, interpolated) until this same session established, twice
  // over (see pieceXState's and totalTY's own history), that a value ever driven by
  // useNativeDriver:true doesn't reliably accept later plain .setValue() calls — and per explicit
  // direction, nothing about position animates anymore anyway (see runTransition), so there's no
  // remaining reason for this to be an Animated node instead of a plain derived number.
  const infoBlockTranslateY = resultsPhase === "compare" ? compareHeaderMarginTop(results.length, insets) - spacing.sm : 0;
  // Two separate state vars (not one combined object) updated TOGETHER, exactly mirroring
  // OutfitsScreen's own hiddenCardIndex/spread split — see closeGallerySpread below for why the
  // close path in particular needs unstable_batchedUpdates around both.
  const [galleryHiddenIndex, setGalleryHiddenIndex] = useState<number | null>(null);
  const [gallerySpread, setGallerySpread] = useState<{ stacks: GallerySpread[]; initialIndex: number; cardRect: Rect; remeasureIndex: (i: number) => Promise<Rect | null> } | null>(null);
  const openGallerySpread = useCallback((i: number, stacks: GallerySpread[], cardRect: Rect, remeasureIndex: (i: number) => Promise<Rect | null>) => {
    // Second line of defense against the same re-entrant-open race OutfitStackGallery's own
    // openingRef guards against — the overlay's backdrop can't block a tap that lands before it
    // exists yet, so this also refuses to replace an already-open spread's props out from under it.
    setGallerySpread(prev => (prev ? prev : { stacks, initialIndex: i, cardRect, remeasureIndex }));
    setGalleryHiddenIndex(prev => (prev !== null ? prev : i));
  }, []);
  // Moves the background grid's "hidden card" mask along as the overlay's own arrows navigate to
  // a different stack — without this, the mask (and therefore what closing the overlay reveals
  // as already-in-place) stayed pinned to whichever card was originally tapped, regardless of
  // which stack was actually being viewed by the time you closed it.
  const onGallerySpreadIndexChange = useCallback((i: number) => { setGalleryHiddenIndex(i); }, []);
  // Batched because this fires from the overlay's Animated native-driver completion callback,
  // which (unlike a JS-originated event) React does not automatically batch — unbatched, the
  // real card's opacity and the overlay's unmount would land as two separate renders instead of
  // one, with a frame in between showing either both or neither. Exactly OutfitsScreen's own
  // closeSpread, for the identical reason (see screens/OutfitsScreen.tsx).
  const closeGallerySpread = useCallback(() => {
    unstable_batchedUpdates(() => {
      setGalleryHiddenIndex(null);
      setGallerySpread(null);
    });
  }, []);
  // A spread stack belongs to whichever item is currently focused — closing it on any switch
  // away from that item avoids a stale spread (wrong item's outfits) surviving the switch.
  useEffect(() => { closeGallerySpread(); }, [pieceIdx, resultsPhase, closeGallerySpread]);

  // Nav bar toggle disappears the instant analysis starts and doesn't come back until the user
  // is actually looking at a finished result — every intermediate stage (identifying,
  // confirming, analyzing) suppresses it.
  useEffect(() => {
    const suppress = step !== "input" && step !== "results";
    if (!suppress) return;
    setSuppressed(true);
    return () => setSuppressed(false);
  }, [step, setSuppressed]);

  // Deliberately does NOT touch chromeOpacity here. It's bound to the results view, which this
  // same call is about to unmount — Animated.Value.setValue() applies immediately on the native
  // side, independent of React's own (batched) render cycle, so resetting it to its "settled"
  // value in this same tick made the still-mounted results content visibly snap to full opacity
  // for one frame before React actually got around to tearing it down — a real flash right as
  // RESET was tapped. It doesn't need resetting for correctness anyway: finishConfirmAndAnalyze
  // already explicitly initializes it before the next time results ever appear.
  function resetPreview() {
    setSlots(Array.from({ length: MAX_COMPARE }, emptySlot));
    setStep("input"); setStageLabel(""); setPending([]); setConfirmIdx(0);
    setResults([]); setCmp2(null); setCmp3(null); setResultsPhase("compare"); setPieceIdx(0);
  }

  // Block navigation while running — abandoning mid-flow wastes the API calls and leaves the
  // screen in a broken half-analyzed state.
  useEffect(() => {
    const running = step !== "input" && step !== "results";
    if (running) {
      setNavigationBlock({ message: "Preview analysis is running. Leave and cancel it?", onCancel: resetPreview });
    } else {
      setNavigationBlock(null);
    }
    return () => setNavigationBlock(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function updateSlot(i: number, patch: Partial<PreviewSlot>) {
    setSlots(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function pickPhoto(i: number, fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", `mycloset needs ${fromCamera ? "camera" : "photo library"} access.`);
      return;
    }
    // quality 0.8 sent this whole photo to OpenAI as an inline base64 data URI (this app has
    // no image-resize step, unlike a typical web upload which lands on a smaller hosted URL) —
    // a full-resolution phone photo at that quality, analyzed at detail:"high", was slow enough
    // to trip the OpenAI circuit breaker's 15s per-call timeout (see
    // lib/openaiCircuitBreaker.ts), surfacing as a generic "Analysis failed" 500. 0.5 keeps
    // plenty of visual detail for the analysis while meaningfully shrinking the payload.
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType ?? "image/jpeg";
    updateSlot(i, { image: `data:${mime};base64,${result.assets[0].base64}` });
  }

  function openPhotoPicker(i: number) {
    Alert.alert("Add Photo", undefined, [
      { text: "Take Photo", onPress: () => pickPhoto(i, true) },
      { text: "Choose from Library", onPress: () => pickPhoto(i, false) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const active = slots.some(s => (s.mode === "photo" && s.image) || (s.mode === "url" && s.url.trim()));

  // Stage 1: identify every filled slot, ONE AT A TIME (matches the website's sequential
  // runBasicAnalysis loop) — then move to confirming. Takes an optional explicit slot list (used
  // by the DEV preload button below) instead of always reading `slots` state directly, since
  // calling setSlots() then immediately startIdentify() in the same handler would read the OLD
  // `slots` value — setState hasn't re-rendered yet.
  async function startIdentify(overrideSlots?: PreviewSlot[], skipConfirm?: boolean) {
    const src = overrideSlots ?? slots;
    setStep("identifying");
    setStageLabel("Identifying items…");
    const found: (IdentifyResp & { image: string })[] = [];
    for (let i = 0; i < src.length; i++) {
      const id = await identify(src[i]).catch(e => { console.error(`[Preview] slot ${i} identify failed:`, e); return null; });
      if (id) found.push(id);
    }
    if (found.length === 0) {
      Alert.alert("Couldn't identify", "Try a clearer photo or a different link.");
      setStep("input"); setStageLabel("");
      return;
    }
    setStageLabel("Removing backgrounds…");
    const cleaned = await Promise.all(found.map(async f => ({ ...f, image: await removeBackgroundRemote(f.image) })));
    setPending(cleaned);
    if (skipConfirm) { finishConfirmAndAnalyze(cleaned); return; }
    setConfirmIdx(0);
    setStep("confirming");
  }

  function patchPending(i: number, patch: Partial<Omit<IdentifyResp, "image">>) {
    setPending(prev => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  // Stage 2 → 3: once every identified item's fields are confirmed, run deep-analyze +
  // outfit-count + wardrobe-impact for all of them IN PARALLEL (matches the website: sequential
  // for identify, parallel for the deep stage).
  // Takes an optional explicit pending list (used by the DEV preload button, same reason
  // startIdentify does — setPending() then immediately calling this in the same handler would
  // read the OLD `pending` value).
  async function finishConfirmAndAnalyze(overridePending?: (IdentifyResp & { image: string })[]) {
    const src = overridePending ?? pending;
    const pt0 = Date.now();
    const pdt = () => Date.now() - pt0;
    logPreviewTiming("finishConfirmAndAnalyze started", 0);
    // Fire-and-forget, started as early as possible — the two real network calls below
    // (deep-analyze, outfit-count) take real, visible time (that's what the "analyzing"/
    // "computing" labels are telling the user), which is exactly the window a slow first image
    // decode can hide inside instead of stalling the entrance animation once results finally
    // land. Same fix already applied to Calendar's own day-open prefetch.
    src.forEach(p => { if (p.image) Image.prefetch(p.image).catch(() => {}); });
    setStep("analyzing");
    setStageLabel("Analyzing attributes…");
    const settled = await Promise.all(
      src.map(async (p, i): Promise<ItemResult | null> => {
        const category = normalizeCategory(p.category ?? "top");
        const deep = await apiJson<DeepAttrs>("/api/preview/deep-analyze", {
          method: "POST",
          body: JSON.stringify({ title: p.title ?? "Item", brand: p.brand, category, color_primary: p.color_primary, material: p.material, fit: p.fit, image: p.image }),
        }).catch(e => { console.error(`[Preview] slot ${i} deep-analyze failed:`, e); return null; });
        if (!deep) return null;
        if (i === 0) setStageLabel("Computing outfit compatibility…");
        const basic: BasicAttrs = { title: p.title ?? "Item", brand: p.brand ?? null, category, color_primary: p.color_primary ?? null, material: p.material ?? null, fit: p.fit ?? null, image: p.image };
        // outfit-count and wardrobe-impact both only depend on deep/basic, not on each other —
        // run them together instead of one after the other, so this item's total wait is
        // whichever one is slower, not their sum. wImpact/overdoneNote used to be computed AFTER
        // results were already showing, one setResults(prev => prev.map(...)) per item as each
        // resolved — a real, confirmed cause of jank: results is read directly by the entrance
        // hold's own timing-critical window (PreviewScreen re-rendering competes with the
        // Animated.sequence's delay->move handoff for the JS thread — the exact mechanism a
        // one-piece entrance was already found to be vulnerable to earlier this session), so a
        // wImpact call landing mid-hold could visibly rush or skip the "stay still first" pause.
        // Computing it here means every item's ItemResult is fully complete, wImpact included,
        // before results is ever set for the first time — nothing touches it again afterward.
        const [impact, wImpactResult] = await Promise.all([
          apiJson<Impact>("/api/preview/outfit-count", {
            method: "POST",
            body: JSON.stringify({
              garment: {
                title: p.title ?? "Item", brand: p.brand, category,
                sub_type: deep.sub_type, material: p.material, color_primary: p.color_primary,
                formality: deep.formality, aesthetic_tags: deep.aesthetic_tags, pros: deep.pros, cons: deep.cons,
                color_pairings: deep.color_pairings, color_clashes: deep.color_clashes, image: p.image,
                tags: { tier: deep.item_tier ?? null, novelty_score: deep.novelty_quality ?? null },
              },
            }),
          }).catch(e => { console.error(`[Preview] slot ${i} outfit-count failed:`, e); return null; }),
          computeWardrobeImpact({
            title: basic.title, sub_type: deep.sub_type, category: basic.category,
            color_primary: basic.color_primary, aesthetic_tags: deep.aesthetic_tags, image: basic.image,
          }).catch(e => { console.error(`[Preview] slot ${i} wardrobe-impact failed:`, e); return { impact: null, overdoneNote: null }; }),
        ]);
        if (!impact) return null;
        return { basic, deep, impact, overall: overallScore(impact), wImpact: wImpactResult.impact, overdoneNote: wImpactResult.overdoneNote };
      })
    );
    logPreviewTiming(`Promise.all resolved (${settled.length} items)`, pdt());
    const good = settled.filter((r): r is ItemResult => r !== null).sort((a, b) => b.overall - a.overall);
    if (good.length === 0) {
      Alert.alert("Couldn't analyze", "Try a clearer photo or a different link.");
      setStep("input"); setStageLabel("");
      return;
    }
    // Batched: this whole block runs from an async function's post-await continuation, not a
    // React/native-bridge event React auto-batches — five separate setState calls here (an
    // earlier version) could commit as up to five separate renders instead of one. The
    // Animated.Value .setValue() calls are plain synchronous writes, not state, so they're
    // already correct by the time any of those renders happen regardless of batching — but the
    // RENDER ITSELF (first mount of the whole results tree — SinglePieceImage/PiecesRow, images,
    // info block) still had to happen up to five times over, which is real reconciliation work,
    // not free. See the useEffect below for why that mattered.
    unstable_batchedUpdates(() => {
      setResults(good);
      setEntranceKey(k => k + 1);
      setResultsPhase("compare");
      setPieceIdx(0);
      setPieceInfoSettled(false);
      setMountedPieceIdx(new Set());
      chromeOpacity.setValue(0);
      imageEntrance.setValue(0);
      compareEntranceP.setValue(0);
      setPieceXState([0, 0, 0]);
      setStep("results");
      setStageLabel("");
    });
    logPreviewTiming("batched setState (step=results) called", pdt());

    // AI head-to-head comparison — only meaningful once there's something to compare.
    const desc = (r: ItemResult) => ({
      title: r.basic.title, category: r.basic.category, sub_type: r.deep.sub_type ?? null,
      color_primary: r.basic.color_primary ?? null, formality: r.deep.formality ?? null,
      aesthetic_tags: r.deep.aesthetic_tags ?? null, pros: r.deep.pros ?? null, cons: r.deep.cons ?? null,
    });
    if (!hasAI) {
      // Free tier: no AI head-to-head comparison — CompareMetricsList's own render already
      // swaps to a color-pairings-only view when hasAI is false (see the results render below).
    } else if (good.length === 2) {
      apiJson<{ better_a?: string[]; worse_a?: string[]; better_b?: string[]; worse_b?: string[]; similarities?: string[]; differences?: string[] }>(
        "/api/preview/compare",
        { method: "POST", body: JSON.stringify({ a: desc(good[0]), b: desc(good[1]) }) },
      ).then(d => setCmp2({
        better0: d.better_a ?? [], worse0: d.worse_a ?? [], better1: d.better_b ?? [], worse1: d.worse_b ?? [],
        sims: d.similarities ?? [], diffs: d.differences ?? [],
      })).catch(() => {});
    } else if (good.length === 3) {
      apiJson<{
        better_a?: string[]; worse_a?: string[]; better_b?: string[]; worse_b?: string[]; better_c?: string[]; worse_c?: string[];
        sims_a?: string[]; diffs_a?: string[]; sims_b?: string[]; diffs_b?: string[]; sims_c?: string[]; diffs_c?: string[];
      }>("/api/preview/compare3", { method: "POST", body: JSON.stringify({ a: desc(good[0]), b: desc(good[1]), c: desc(good[2]) }) })
        .then(d => setCmp3({
          better: [d.better_a ?? [], d.better_b ?? [], d.better_c ?? []],
          worse: [d.worse_a ?? [], d.worse_b ?? [], d.worse_c ?? []],
          sims: [d.sims_a ?? [], d.sims_b ?? [], d.sims_c ?? []],
          diffs: [d.diffs_a ?? [], d.diffs_b ?? [], d.diffs_c ?? []],
        })).catch(() => {});
    }
  }

  // Kicks off the entrance hold-then-move once React has ACTUALLY committed a render reflecting
  // the fresh `results` — replaces a double-requestAnimationFrame defer that used to live inside
  // finishConfirmAndAnalyze itself. That defer assumed 2 frames was always enough time for React
  // to finish mounting the entire results tree (SinglePieceImage/PiecesRow, images, info block)
  // for the very first time — real reconciliation work, not free, and worse before this same
  // effect's setState calls were batched (see finishConfirmAndAnalyze above): up to five separate
  // renders instead of one, each a chance to blow past a fixed 2-frame budget. If the JS/React
  // side hadn't actually finished painting by frame 2, this .sequence()'s HOLD_MS delay — running
  // on the native thread via useNativeDriver, which does NOT wait for JS to catch up — started
  // counting down before there was anything on screen to show it, silently consuming some or all
  // of the intended hold before the user's first actual glimpse of the piece. A fixed frame count
  // is a guess that usually but not always holds; a useEffect keyed on a commit is a guarantee —
  // React only runs it after committing a render where everything derived from that commit is
  // already current, no timing assumption involved.
  //
  // Keyed on `entranceKey`, NOT on `results` itself: results.forEach's wardrobe-impact calls
  // below resolve LATER and call setResults(prev => prev.map(...)) to merge each item's impact
  // in — a different array reference every time, same as a fresh analysis. An effect keyed on
  // `results` directly re-fired this ENTIRE hold-then-move sequence a second time whenever that
  // merge happened to land WHILE the first entrance was still mid-flight, redirecting
  // pieceX/imageEntrance from wherever they currently were (mid-hold or mid-move) instead of
  // leaving an already-correct animation alone — a real, self-inflicted freeze/restart, not a
  // perception issue. entranceKey only changes once per genuine "confirm & analyze".
  useEffect(() => {
    if (step !== "results" || results.length === 0) return;
    const et0 = Date.now();
    logPreviewTiming(`entrance effect fired (n=${results.length}), commit received`, 0);
    // 2-3 pieces hold noticeably longer than a lone one — CompareMetricsList's own header list
    // also has to be read (multiple numbers across pieces) before the eye is ready for motion,
    // not just the pieces themselves settling in place.
    const HOLD_MS = results.length > 1 ? 1100 : 850;
    const MOVE_MS = 420;
    const moveAnim = results.length > 1
      ? Animated.timing(compareEntranceP, { toValue: 1, duration: MOVE_MS, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true })
      : Animated.timing(imageEntrance, { toValue: 1, duration: MOVE_MS, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true });
    Animated.sequence([Animated.delay(HOLD_MS), moveAnim]).start(() => {
      logPreviewTiming("hold+move done, chrome fade starting", Date.now() - et0);
      // Force this to EXACTLY its intended final value rather than trusting the animation
      // reported completion accurately — compareEntranceP/imageEntrance are shared,
      // interpolation-driven values (entranceTX in PiecesRow reads compareEntranceP via
      // .interpolate() for every piece), the same class of value that's repeatedly failed to
      // reach its real target elsewhere in this file this session even after its own .start()
      // callback fired. A residual, NOT-quite-1 value here doesn't fail loudly — every piece
      // just gets a small uncorrected offset in the direction AWAY from its own natural side
      // (entranceTX's outputRange is [-cOffset, 0]), reading as "the focused piece isn't quite
      // centered" and "the far piece is pushed even further than intended" — confirmed directly
      // against a real screenshot showing exactly that combination. Costs nothing if the
      // animation already reached 1 cleanly; only ever corrects toward the value that was
      // always the goal.
      compareEntranceP.setValue(1);
      imageEntrance.setValue(1);
      Animated.timing(chromeOpacity, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
        logPreviewTiming("chrome fade done, FULLY SETTLED", Date.now() - et0);
        setPieceInfoSettled(true);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entranceKey]);

  // Adds whichever piece index is currently "active" to the sticky mounted set — for n===1
  // that's index 0, gated on pieceInfoSettled (post-entrance) so its first mount never competes
  // with the entrance animation. For n>1 it's whichever index openPiece/switchPiece just focused,
  // added the moment it's tapped.
  useEffect(() => {
    if (!pieceInfoSettled) return;
    const activeIdx = results.length === 1 ? 0 : (resultsPhase === "piece" ? pieceIdx : null);
    if (activeIdx === null || mountedPieceIdx.has(activeIdx)) return;
    // Deferred a couple of frames, specifically so a first-visit's real, synchronous mount cost
    // (OutfitStackGallery's several <Image>s — already measured on a real device at ~950-1300ms,
    // see this state's own comment) lands AFTER the tap's own chrome-fade-out/piece-move animation
    // has actually gotten its first native-driver dispatch out, not in the SAME tick as the tap
    // racing it. Chrome is already fading toward invisible by the time this runs, so the mount's
    // real cost lands while there's nothing on screen to visibly stall — instead of blocking the
    // JS thread right as the animation is trying to start, reading as the whole screen freezing.
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setMountedPieceIdx(prev => new Set(prev).add(activeIdx));
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(raf1); };
  }, [pieceInfoSettled, resultsPhase, pieceIdx, results.length, mountedPieceIdx]);

  // Plain-number targets for every piece, given who's focused (or null for compare) — ordinary
  // arithmetic, no Animated involved at all. See pieceTargetX's own comment for the geometry. This
  // is UNCHANGED from the original, pre-animation version of this screen — the animation layer
  // added around it (runTransition below) never touches this math or its result: null always means
  // every piece at its natural, equally-spaced compare position; a real index always means that
  // piece centered and the other(s) pushed toward the wall.
  function pieceXTargets(focusedIdx: number | null): number[] {
    const wall = wallLimit(arrangedImgSize(results.length));
    return Array.from({ length: results.length }, (_, j) => pieceTargetX(results.length, j, focusedIdx, wall));
  }

  // Set right before applyChange() below, checked by the reveal effect just past it — see
  // runTransition's own comment for why the fade-back-in can't just fire in the same synchronous
  // callback as applyChange().
  const pendingRevealRef = useRef(false);
  // Fires the fade-back-in, but only once React has actually committed the render applyChange()
  // triggered — NOT in the same synchronous tick applyChange() runs in. Measured directly (frame-
  // by-frame luma analysis of a real screen recording, not just watched by eye): starting the
  // fade-in immediately produced a smooth partial rise, then a ~100-150ms FLAT PLATEAU, then a
  // sudden one-frame jump to the final content, on EVERY transition, consistently. chromeOpacity is
  // native-driver-animated, so once .start()ed it climbs 0->1 on the native thread regardless of
  // what the JS thread is doing — but the CONTENT inside it (whichever piece's info, or
  // CompareMetricsList) only updates once React actually re-renders and commits, which is NOT
  // guaranteed to happen before the animation starts, or even before it finishes: the container was
  // rising in opacity over stale/incomplete content, which then snapped to correct once React's
  // commit finally landed — reads as a flash/flicker, worse the longer that render takes (worst for
  // backToCompare specifically, since CompareMetricsList remounts fully fresh every time, unlike
  // PieceInfo which stays mounted and just toggles display). Waiting for a real commit of the
  // relevant state (via this effect's own dependencies) before ever starting the reveal removes the
  // race by construction instead of guessing at a frame count or timeout to wait first.
  useEffect(() => {
    if (!pendingRevealRef.current) return;
    pendingRevealRef.current = false;
    Animated.timing(chromeOpacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceIdx, resultsPhase, pieceXState]);

  // Shared two-stage transition for every switch: open (compare -> piece), close (piece ->
  // compare, i.e. backToCompare), and switch (piece -> a different piece, staying in piece view).
  // (1) fade chrome out — everything EXCEPT the two piece images, which never fade at all (they're
  // not wrapped in chromeOpacity anywhere — see PiecesRow); once fully invisible, apply the actual
  // change — pieceIdx/resultsPhase/pieceXState all update in one synchronous batch (applyChange),
  // which is also what totalTY/infoBlockTranslateY (both derived straight from resultsPhase now, no
  // Animated involved) pick up — an "insta switch," deliberately: nothing about WHERE things end up
  // is animated at all, only the opacity wrapping it, so there's no sliding motion to get wrong
  // (every attempt at animating the piece slide itself, in either driver mode, failed differently on
  // a real device this session — see pieceXState's own comment). (2) fade chrome back in — but see
  // pendingRevealRef's own comment for why that's a separate effect, not the next line here. Chrome
  // is a real Animated.timing 0->1->0 sequence, not a state toggle, specifically so a later tap can
  // cleanly INTERRUPT an in-flight fade (Animated.timing redirects smoothly from wherever it
  // currently is) instead of causing any kind of double-render or flash — the `finished` check below
  // skips applying a superseded call's own change; the newer call's own fade-out either continues
  // from where the old one left off or restarts, and IT applies its own (more current) change once
  // IT actually completes uninterrupted.
  const runTransition = useCallback((applyChange: () => void) => {
    Animated.timing(chromeOpacity, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return; // superseded by a newer tap's own fade-out, which owns applying ITS change
      pendingRevealRef.current = true;
      applyChange();
    });
  }, [chromeOpacity]);

  // Compare -> piece(preview) view — the reverse of backToCompare below. pieceIdx/resultsPhase/
  // pieceXState only change once chrome has fully faded out (see runTransition's own comment) — not
  // immediately at tap time — so the compare-only badges/CompareMetricsList are still what's fading
  // OUT (never an abrupt cut to piece content mid-fade), and the newly-focused piece's PieceInfo
  // only becomes eligible (`active`) once chrome is about to fade back IN, already fully switched
  // (its actual mount is additionally deferred a couple of frames past that — see mountedPieceIdx's
  // own comment — so a first-visit's real mount cost can't stall anything visible).
  const openPiece = useCallback((i: number) => {
    runTransition(() => {
      setPieceIdx(i);
      setResultsPhase("piece");
      setPieceXState(pieceXTargets(i));
    });
  }, [runTransition, results.length]);

  const backToCompare = useCallback(() => {
    runTransition(() => {
      setResultsPhase("compare");
      setPieceXState(pieceXTargets(null));
    });
  }, [runTransition, results.length]);

  // Switching which piece is focused while ALREADY in piece view — resultsPhase is untouched
  // (stays "piece"), so this never touches Y, only each piece's own X position.
  const switchPiece = useCallback((newIdx: number) => {
    runTransition(() => {
      setPieceIdx(newIdx);
      setPieceXState(pieceXTargets(newIdx));
    });
  }, [runTransition, results.length]);

  // Tapping any piece previews it (replaces the removed PREVIEW button); tapping a non-centered
  // piece while already in preview switches focus to it (the "rearrange"). Reads resultsPhase/
  // pieceIdx via the refs above rather than closing over the state directly, specifically so
  // this function's OWN reference stays stable across renders — it's passed straight through to
  // PiecesRow (now memoized), and a useCallback whose deps include pieceIdx would hand that memo
  // a brand-new onTapPiece on every single switchPiece() call, defeating it every time.
  const onTapPiece = useCallback((i: number) => {
    // No-ops before the entrance has settled — focus doesn't exist as a concept until the
    // entrance's own hold+move has landed, so there's nothing meaningful to switch to yet.
    if (!pieceInfoSettledRef.current) return;
    if (resultsPhaseRef.current === "compare") { openPiece(i); return; }
    if (i !== pieceIdxRef.current) switchPiece(i);
  }, [openPiece, switchPiece]);

  const canConfirmField = pending[confirmIdx];

  return (
    <>
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {step === "input" && (
        <StepFade><>
          {/* Pulled out of the centered ScrollView below so it can get its own top clearance
             from ShowNavButton (floats at insets.top+10 in this corner) without shifting the
             slots/ANALYZE block, which stays centered in whatever space remains beneath it. */}
          <Text style={[styles.intro, { marginTop: spacing.xl, paddingHorizontal: spacing.lg }]}>
            ENTER UP TO {MAX_COMPARE} ITEMS TO SEE HOW WELL THEY'D FIT YOUR CLOSET.
          </Text>
          {/* Plain View, not a ScrollView — 3 slots + the ANALYZE button comfortably fit in the
             remaining space on any real device; scrolling to reach a button that's already on
             screen was pure friction, not a real overflow case. */}
          <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, paddingBottom: spacing.xl }}>
          <View style={{ gap: spacing.md }}>
            {slots.map((slot, i) => (
              <View key={i}>
                {!slot.open ? (
                  <TouchableOpacity style={styles.slotClosed} onPress={() => updateSlot(i, { open: true })}>
                    <Text style={styles.plus}>+</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.slotOpen}>
                    <View style={styles.modeRow}>
                      {(["photo", "url"] as SlotMode[]).map(m => (
                        <TouchableOpacity key={m} onPress={() => updateSlot(i, { mode: m })}>
                          <Text style={[styles.modeTab, slot.mode === m && styles.modeTabActive]}>{m === "url" ? "URL" : "PHOTO"}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {slot.mode === "url" ? (
                      // autoFocus removed — it forced the native keyboard to open the instant
                      // this tab was tapped, and that keyboard-open is real native work (view
                      // controller + animation), not app logic, which read as the switch itself
                      // lagging. The switch is now instant; tapping the field itself still brings
                      // the keyboard up normally.
                      <TextInput
                        value={slot.url}
                        onChangeText={t => updateSlot(i, { url: t })}
                        placeholder="Paste URL"
                        placeholderTextColor={colors.textFaint}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        style={styles.urlInput}
                      />
                    ) : (
                      <TouchableOpacity style={styles.photoDrop} onPress={() => openPhotoPicker(i)}>
                        {slot.image
                          ? <Image source={{ uri: slot.image }} style={styles.photoDropImg} contentFit="contain" cachePolicy="memory-disk" transition={0} />
                          : <Text style={styles.uploadHint}>TAP TO UPLOAD</Text>}
                      </TouchableOpacity>
                    )}

                    <TextButton label="CANCEL" size={9} color={colors.bad} onPress={() => updateSlot(i, emptySlot())} style={{ marginTop: spacing.sm }} />
                  </View>
                )}
              </View>
            ))}
          </View>

          <TextButton
            label="ANALYZE"
            color={colors.good}
            disabled={!active}
            onPress={() => startIdentify()}
            style={{ alignSelf: "center", marginTop: spacing.md }}
          />
          {/* TEMPORARY — for testing the two-piece preview animations without re-entering URLs
             every time. Remove once animation testing is done; __DEV__ keeps it out of any
             release build regardless. */}
          {__DEV__ && (
            <TextButton
              label="DEV: LOAD TEST PAIR"
              color={colors.textFaint}
              onPress={() => {
                const devSlots: PreviewSlot[] = [
                  { open: true, mode: "url", url: "https://www.stussy.com/collections/tees/products/1905205-kids-tee-blue", image: null },
                  { open: true, mode: "url", url: "https://www.stussy.com/collections/tees/products/1905216-fresh-foils-tee-rock", image: null },
                  emptySlot(),
                ];
                setSlots(devSlots);
                startIdentify(devSlots, true);
              }}
              style={{ alignSelf: "center", marginTop: spacing.sm }}
            />
          )}
          </View>
        </></StepFade>
      )}

      {(step === "identifying" || step === "analyzing") && (
        // No paddingBottom reservation — the floating bottom nav bar is explicitly suppressed for
        // this entire step (see the "Nav bar toggle disappears" effect above), so there's no
        // occluded space to exclude here; a plain flex:1/justifyContent:"center" already centers
        // over exactly what's visible.
        <StepFade><View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
          <LoadingDots />
          <Text style={{ fontSize: 10, color: colors.textFaint, textAlign: "center" }}>{stageLabel}</Text>
        </View></StepFade>
      )}

      {step === "confirming" && canConfirmField && (
        // Same reasoning as the identifying/analyzing step above — the nav bar is suppressed here
        // too, so no bottom reservation is needed. Extra bottom padding biases the centered
        // content up slightly off dead-center, same nudge technique as Settings/DayOutfit, per
        // the same "reads as very slightly low" feedback.
        <StepFade><ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingBottom: spacing.lg + 60 }}>
          {pending.length > 1 && (
            <Text style={[type.label, { textAlign: "center", marginBottom: spacing.sm }]}>{confirmIdx + 1} / {pending.length}</Text>
          )}
          <Text style={[type.title, { textAlign: "center" }]}>CONFIRM DETAILS</Text>
          {canConfirmField.image && (
            <Image source={{ uri: canConfirmField.image }} style={[styles.resultImg, { alignSelf: "center", marginTop: spacing.md }]} contentFit="contain" cachePolicy="memory-disk" transition={0} />
          )}
          <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
            <UnderlineField value={canConfirmField.title ?? ""} onChangeText={t => patchPending(confirmIdx, { title: t })} hint="Name" hintWidth={50} />
            <UnderlineField value={canConfirmField.brand ?? ""} onChangeText={t => patchPending(confirmIdx, { brand: t })} hint="Brand" hintWidth={45} />
            <UnderlineField value={canConfirmField.color_primary ?? ""} onChangeText={t => patchPending(confirmIdx, { color_primary: t })} hint="Color" hintWidth={45} />
            <UnderlineField value={canConfirmField.material ?? ""} onChangeText={t => patchPending(confirmIdx, { material: t })} hint="Material" hintWidth={65} />
            <UnderlineField value={canConfirmField.fit ?? ""} onChangeText={t => patchPending(confirmIdx, { fit: t })} hint="Fit" hintWidth={35} autoCapitalize="none" />
          </View>
          <View style={[styles.catRow, { marginTop: spacing.lg }]}>
            {CATEGORIES.map(c => (
              <TextButton
                key={c} label={c} size={11}
                color={normalizeCategory(canConfirmField.category ?? "") === c ? colors.text : colors.textFaint}
                onPress={() => patchPending(confirmIdx, { category: c })}
                style={styles.catChip}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: spacing.lg, alignSelf: "center", marginTop: spacing.lg }}>
            <TextButton label="CANCEL" size={9} color={colors.bad} onPress={resetPreview} />
            <TextButton
              label={confirmIdx < pending.length - 1 ? "CONFIRM" : "CONFIRM & ANALYZE"}
              color={colors.good}
              onPress={() => (confirmIdx < pending.length - 1 ? setConfirmIdx(i => i + 1) : finishConfirmAndAnalyze())}
            />
          </View>
        </ScrollView></StepFade>
      )}

      {step === "results" && results.length > 0 && (
        <StepFade><>
          {/* paddingTop trimmed to just clear RESET/COMPARE's floating row (insets.top+10, its
             own height, a little breathing room) rather than the much larger gap this used to
             reserve — that space bought nothing since RESET/COMPARE floats outside the scroll
             flow now. The image/row is the first thing in the scrollable content, exactly where
             SinglePieceImage's own NATURAL_Y expects to find it. */}
          {/* paddingTop is RESULTS_TOP_PAD alone, NOT insets.top + RESULTS_TOP_PAD — this
             ScrollView already sits inside the enclosing SafeAreaView (edges include "top"),
             which applies insets.top as its OWN padding automatically. Adding insets.top again
             here double-counted it: everything below rendered a full extra insets.top lower than
             intended, invisible on the small ~20px inset of an iPhone SE (what this was
             originally tuned against) but glaring on a notched/Dynamic-Island device's ~50-59px
             inset — exactly why this kept reading as "too much space" / "starts too low" no
             matter how many times the individual pixel constants got retuned. NATURAL_Y and
             loadingCenterY below were never wrong; they already assumed insets.top is applied
             exactly once (by SafeAreaView) — this was the one place actually double-applying it. */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, paddingTop: RESULTS_TOP_PAD, alignItems: "center" }}>
            {/* In-flow (was a fixed floating column) — RESET/COMPARE scroll away with everything
               else instead of being pinned to the screen while the rest of the content moves
               underneath. Same row, per explicit request — COMPARE previously lived as its own
               fixed top-right element (a reversal of an even earlier request to split them);
               back on this same in-flow row now, right-aligned opposite RESET, so it scrolls
               away exactly like RESET does instead of hovering fixed regardless of scroll. */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: spacing.md }}>
              <TouchableOpacity onPress={resetPreview} hitSlop={10} style={{ height: 22, justifyContent: "center" }}>
                <Text style={{ fontSize: 9, fontWeight: "700", letterSpacing: 1, color: colors.bad }}>RESET</Text>
              </TouchableOpacity>
              {results.length > 1 && resultsPhase === "piece" && hasAI && (
                // marginRight reserves the same space the fixed ShowNavButton arrow (top-right,
                // its own 22px box plus a gap) always occupies at this same row height, so
                // COMPARE sits clearly to its left instead of crowding right up against it.
                <Animated.View style={{ opacity: chromeOpacity, marginRight: 22 + spacing.md }}>
                  <TouchableOpacity onPress={backToCompare} hitSlop={10} style={{ height: 22, justifyContent: "center" }}>
                    <Text style={{ fontSize: 9, fontWeight: "700", letterSpacing: 1, color: colors.textMuted }}>COMPARE</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}
            </View>

            {results.length > 1 ? (
              <PiecesRow
                results={visualResults} entranceP={compareEntranceP} entranceSettled={pieceInfoSettled} pieceXState={pieceXState}
                resultsPhase={resultsPhase} chromeOpacity={chromeOpacity} onTapPiece={onTapPiece} focalMetric={focalMetric}
              />
            ) : (
              <SinglePieceImage item={visualResults[0]} imageEntrance={imageEntrance} />
            )}

            {/* Tightened from spacing.lg — this plus PieceInfo's own title marginTop were adding
               up to a much bigger gap than needed between the piece(s) and everything below
               them; small but non-zero so it never touches regardless of piece size (140px vs
               104px), since both share this same fixed clearance rather than a size-relative one. */}
            {/* Compare mode's header list gets an explicitly computed marginTop (see
               compareHeaderMarginTop) instead of the PieceInfo branches' plain top-down flow:
               PieceInfo is long, naturally-flowing content (title/score/stats/cards/gallery) that
               should just start below the pieces, but CompareMetricsList is a short, fixed-height
               header list with nothing else below it — left at a plain marginTop, it sat right
               under the pieces with a large dead gap of empty screen beneath it instead of
               occupying the middle of that leftover space. */}
            <Animated.View
              style={{
                width: "100%", alignItems: "center", opacity: chromeOpacity,
                // Fixed layout marginTop (an earlier attempt assigned an interpolated Animated
                // node straight to marginTop and hit "Style property 'marginTop' is not supported
                // by native animated module" at runtime — it's a layout property, not one of the
                // transform/opacity properties the native module supports). The actual position
                // difference between compare's header margin and piece view's flat spacing is
                // expressed as a translateY transform instead: infoBlockTranslateY, a plain number
                // derived straight from resultsPhase (see its own comment) — this DOES "teleport"
                // between the two the instant resultsPhase flips, deliberately, since that flip
                // only ever happens once chromeOpacity has already faded this block to fully
                // invisible (see runTransition) — nothing is on screen to read the jump as a
                // teleport.
                marginTop: spacing.sm,
                transform: [{ translateY: results.length > 1 ? infoBlockTranslateY : 0 }],
              }}
            >
              {/* CompareMetricsList/FreeCompareColorPairings are cheap (fixed-height header list,
                 no images) — mount lazily, exactly on entering compare. Every PieceInfo instance
                 (see mountedPieceIdx's own comment) is already mounted by the time this ever
                 renders — done a screen earlier, while "analyzing…" was still up — so `active`
                 here is purely about VISIBILITY (display:"none" while inactive, RevealOnActive's
                 fade on becoming active), never about triggering a mount. Gated on
                 pieceInfoSettled so nothing actually reveals itself before the entrance's own
                 hold+move+chrome-fade has finished, same as always. */}
              {results.length > 1 && resultsPhase === "compare" && (
                hasAI ? <CompareMetricsList onFocalMetricChange={setFocalMetric} /> : <FreeCompareColorPairings items={results} />
              )}
              {results.map((r, i) => {
                const active = pieceInfoSettled && (results.length === 1 || (resultsPhase === "piece" && pieceIdx === i));
                if (!mountedPieceIdx.has(i)) return null;
                return (
                  <View key={i} style={{ width: "100%", display: active ? "flex" : "none" }}>
                    <RevealOnActive active={active}>
                      <PieceInfo
                        item={r}
                        gallerySpreadHiddenIndex={active ? galleryHiddenIndex : null}
                        onOpenGallerySpread={openGallerySpread}
                      />
                    </RevealOnActive>
                  </View>
                );
              })}
            </Animated.View>
          </ScrollView>
        </></StepFade>
      )}

      {step === "input" && (
        <View style={{ flexShrink: 0, height: BAR_CONTENT_H + insets.bottom + BAR_BOTTOM_GAP }} />
      )}
    </SafeAreaView>
    {/* A true sibling of SafeAreaView, not a descendant of it — GallerySpreadOverlay's own math
       (SCORE_Y/PIECES_CENTER_Y as raw SCREEN_H fractions, gatherCX/gatherCY) assumes a coordinate
       space starting at the TRUE top of the screen, to match cardRect (measured via
       measureInWindow, which also returns true-window coordinates). SafeAreaView applies
       insets.top as its OWN padding on everything inside it, so rendering this overlay as a
       descendant — as it was before — silently shifted its entire coordinate space down by
       insets.top relative to cardRect's true-window numbers: a real, physical mismatch between
       "where the tapped card actually is" and "where this overlay thinks screen-fractions land,"
       not just a rounding error. That mismatch is exactly the kind of thing that reads as pieces
       "shifting" or landing slightly off during the gather animation. */}
    {gallerySpread && (
      <GallerySpreadOverlay
        stacks={gallerySpread.stacks} initialIndex={gallerySpread.initialIndex} cardRect={gallerySpread.cardRect}
        remeasureIndex={gallerySpread.remeasureIndex} onIndexChange={onGallerySpreadIndexChange}
        onClose={closeGallerySpread}
      />
    )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  spreadBackdrop: { backgroundColor: "#ffffffee" },
  intro: { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: colors.text, textAlign: "center", lineHeight: 18, marginBottom: spacing.xl },
  slotClosed: { height: SLOT_H, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  plus: { fontSize: 26, color: colors.textFaint },
  slotOpen: { height: SLOT_H, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  modeRow: { flexDirection: "row", gap: 16, marginBottom: spacing.sm },
  modeTab: { fontSize: 10, letterSpacing: 1.2, color: colors.textFaint, fontWeight: "400" },
  modeTabActive: { color: colors.text, fontWeight: "700" },
  urlInput: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9, fontSize: 14, color: colors.text },
  photoDrop: { height: 68, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  photoDropImg: { width: "90%", height: "85%" },
  uploadHint: { fontSize: 9, letterSpacing: 1, color: colors.textFaint },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, justifyContent: "center" },
  catChip: { paddingVertical: 6, paddingHorizontal: 4 },
  resultImg: { width: 140, height: 140 },
  bigScore: { fontSize: 40, fontWeight: "700" },
  statsRow: { flexDirection: "row", justifyContent: "center" },
  // Fixed width (not just flex-wrap's natural sizing) so both grid rows share the same two
  // column positions regardless of how long each row's numbers/labels happen to be.
  stat: { alignItems: "center", gap: 2, width: 110 },
  cardBox: { width: "100%", marginTop: spacing.lg },
});
