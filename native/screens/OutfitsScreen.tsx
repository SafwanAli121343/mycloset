import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Animated, Dimensions, Easing, unstable_batchedUpdates , ScrollView } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { apiJson, apiJsonCached } from "../lib/api";
import { getCached } from "../lib/dataCache";
import { LoadingDots } from "../components/LoadingDots";
import { TextButton } from "../components/TextButton";
import { ReadyGate } from "../components/ReadyGate";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { useFocusEffect } from "@react-navigation/native";
import { useSuppressNavButton } from "../lib/NavBarVisibility";
import { NAV_ROW_TOP, NAV_ROW_H } from "../components/ShowNavButton";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import type { SlotGarment } from "../lib/garmentSlots";
import { useEntitlements } from "../lib/billing/Entitlements";
import { useTutorialDemo } from "../lib/tutorial";
import { sampleCloset, sampleOutfits, SAMPLE_IMAGES } from "../lib/tutorialSamples";

type GalleryItem = SlotGarment & {
  title: string | null; pros: string[] | null; cons: string[] | null;
  aesthetic_tags?: string[] | null; color_primary?: string | null;
};
type OutfitAnalysis = { pros: string[]; cons: string[] };
// `analysis` is present when the server already has this outfit's AI analysis stored (Pro).
type ComboOutfit = { score: number; itemIds: string[]; analysis?: OutfitAnalysis };

// Same key the server uses (lib/outfitAnalysisStore.ts comboKey).
function comboKey(ids: string[]): string {
  return [...new Set(ids)].sort().join("|");
}
const ANALYSIS_UNAVAILABLE = "Analysis unavailable right now. Try again later.";
type ComboResponse = { total: number; items: Record<string, GalleryItem>; outfits: ComboOutfit[] };
type Rect = { x: number; y: number; width: number; height: number };

// Direct port of app/outfits/page.tsx's filter panel: same four filter dimensions (aesthetic,
// min score, color, specific pieces), same match semantics (aesthetic/color/piece are "any of
// the selected"; a piece/color option only shows if it's actually present in at least one
// outfit — the website's own color list is fixed/exhaustive since desktop has room for a long
// scrollable panel, native derives colors live from what's actually filterable to keep the
// option list relevant on a phone screen; a scoped, disclosed format adaptation, not a
// difference in what can be filtered).
const AESTHETICS = [
  "streetwear", "gorpcore", "old-money", "preppy", "quiet-luxury", "minimalist",
  "techwear", "workwear", "athleisure", "vintage", "grunge", "skate", "y2k", "90s",
  "normcore", "hype-streetwear", "western", "punk", "indie-sleaze", "goth", "maximalist",
];

// Direct port of app/outfits/page.tsx's stackOrder/sortItems: the visual order pieces render
// in for both the collapsed stack thumbnail (z-order — later items sit on top) and the spread
// layout, so the same outfit always layers itself the same way on both platforms — accessories
// and footwear toward the back, bottoms rendered last/most visible.
function stackOrder(item: GalleryItem): number {
  switch ((item.category ?? "").toLowerCase()) {
    case "accessory": return 0;
    case "footwear": return 1;
    case "top": return 2;
    case "outerwear": return 3;
    case "bottom": return 4;
  }
  const s = (item.sub_type ?? "").toLowerCase();
  if (["ring", "watch", "bracelet", "chain", "necklace", "earring", "bag", "hat", "cap", "beanie", "belt", "scarf", "glasses", "sunglass"].some(k => s.includes(k))) return 0;
  if (["shoe", "boot", "sneaker", "loafer", "sandal", "slide", "oxford", "derby", "mule"].some(k => s.includes(k))) return 1;
  if (["jacket", "coat", "blazer", "bomber", "cardigan"].some(k => s.includes(k))) return 3;
  if (["pant", "jean", "trouser", "chino", "short", "skirt", "legging"].some(k => s.includes(k))) return 4;
  return 2;
}
function sortItems<T extends GalleryItem>(items: T[]): T[] {
  return [...items].sort((a, b) => stackOrder(a) - stackOrder(b));
}
// A combo's itemIds occasionally repeats the same id (an algorithmic-combo-generation edge
// case, not something this screen controls) — every render of a stack keys its pieces by
// `it.id` (both the collapsed grid thumbnail and the spread overlay), so a duplicate id means
// TWO elements with the identical React key. React's reconciliation for duplicate keys is
// undefined: the second element can silently inherit a native view/animated binding meant for
// a DIFFERENT render pass rather than getting its own, which is exactly the kind of bug that
// reads as one specific piece flying off to some unrelated position while everything else in
// the same stack renders correctly — a per-item data issue, not a timing or math one.
// Dedupes to first occurrence, right where ids are first read, so nothing downstream (sorting,
// keying, gather/spread math) ever sees a repeated id at all.
function dedupeIds(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const COLS = 3;
const PAGE_SIZE = 30;
// The first page blocks the loading spinner on every one of its images finishing prefetch (so
// no stack is ever tappable before its photos are ready — see prefetchBatch below). A smaller
// initial batch means less to wait on before the screen shows anything at all; "Show More"
// pages can stay larger since their own prefetch happens behind an already-visible button, not
// the app's very first paint of this screen.
const INITIAL_PAGE_SIZE = 12;
const GRID_GAP = 14;
const CARD_W = Math.floor((SCREEN_W - spacing.md * 2 - GRID_GAP * (COLS - 1)) / COLS);
const STACK_H = CARD_W * 1.05;

// Rough row height (stack + score label + gap) used only to size the automatic "fill the
// screen" batch below — an estimate, not a layout measurement, so it can be computed once from
// known screen dimensions instead of reacting to onLayout/onContentSizeChange. That reactive
// version (an effect keyed on measured viewport/content height) used to be able to refire on
// its own well after the screen had already settled — any time those measurements changed for
// unrelated reasons (font metrics settling, a relayout) it would silently kick off another
// "Show More"-style fetch, which is what looked like stacks vanishing into a loading state with
// no user action. A one-shot target computed up front can't refire like that.
const ROW_H_ESTIMATE = STACK_H + 20 + GRID_GAP;
const AUTOFILL_TARGET = Math.ceil(SCREEN_H / ROW_H_ESTIMATE + 1) * COLS;

// Vertical zones for the spread view: score up top, pieces in the middle (sized to make the
// most of the space available), analysis below in a fixed-height band — not stretched all the
// way to the bottom of the screen, which was showing too many lines of the picker-wheel at
// once.
const SCORE_Y = SCREEN_H * 0.12;
const PIECES_CENTER_Y = SCREEN_H * 0.34;
const ANALYSIS_TOP = SCREEN_H * 0.5;
const ANALYSIS_H = 190;

const SPREAD_ITEMS_PER_ROW = 3;
const IDEAL_THRESHOLD = 75;

function itemSize(count: number): { w: number; h: number } {
  if (count <= 2) return { w: 118, h: 156 };
  if (count === 3) return { w: 102, h: 136 };
  if (count <= SPREAD_ITEMS_PER_ROW) return { w: 86, h: 116 };
  // 4+ pieces (e.g. with accessories) wrap into rows of 3 rather than one ever-widening row
  // that would run off the sides of the screen — a real bug fixed alongside removing the
  // 4-item cap that used to silently drop pieces past the 4th.
  return { w: 78, h: 104 };
}

function spreadTarget(i: number, count: number, size: { w: number; h: number }): { x: number; y: number } {
  if (count <= SPREAD_ITEMS_PER_ROW) {
    const totalW = count * size.w + (count - 1) * 12;
    const startX = (SCREEN_W - totalW) / 2;
    return { x: startX + i * (size.w + 12), y: PIECES_CENTER_Y };
  }
  const rowIdx = Math.floor(i / SPREAD_ITEMS_PER_ROW);
  const colIdx = i % SPREAD_ITEMS_PER_ROW;
  const numRows = Math.ceil(count / SPREAD_ITEMS_PER_ROW);
  const rowCount = rowIdx === numRows - 1 ? count - rowIdx * SPREAD_ITEMS_PER_ROW : SPREAD_ITEMS_PER_ROW;
  const totalW = rowCount * size.w + (rowCount - 1) * 12;
  const startX = (SCREEN_W - totalW) / 2;
  const rowStep = size.h + 16;
  const startY = PIECES_CENTER_Y - ((numRows - 1) * rowStep) / 2;
  return { x: startX + colIdx * (size.w + 12), y: startY + rowIdx * rowStep };
}

// The lowest Y the piece grid actually reaches — ANALYSIS_TOP below assumed the grid always fit
// in a fixed band, which held for the common 1-3 item case but not for a 4+ item outfit (with
// accessories) that wraps to 2-3 rows: that grid's real bottom edge can land well past
// ANALYSIS_TOP, overlapping the pros/cons text under it. Mirrors spreadTarget's own row math so
// this always matches whatever the grid actually rendered, rather than a second guess at it.
function pieceGridBottom(count: number, size: { w: number; h: number }): number {
  if (count <= SPREAD_ITEMS_PER_ROW) return PIECES_CENTER_Y + size.h;
  const numRows = Math.ceil(count / SPREAD_ITEMS_PER_ROW);
  const rowStep = size.h + 16;
  const startY = PIECES_CENTER_Y - ((numRows - 1) * rowStep) / 2;
  return startY + (numRows - 1) * rowStep + size.h;
}

// Real (decoded) pixel dimensions per image URI — populated by prefetchBatch alongside
// Image.prefetch, so by the time any outfit is tappable its photos' dimensions are already
// known synchronously. Module-level (not per-screen-instance) since a URI's dimensions never
// change and outfits reuse the same closet photos repeatedly.
// Uses expo-image's loadAsync (not a separate getSize call) so this reads from the exact same
// cache the rendered <Image> below draws from — one shared cache, not two independent ones that
// could disagree about what's actually ready.
const imageSizeCache = new Map<string, { width: number; height: number }>();
function cacheImageSize(uri: string): Promise<void> {
  if (imageSizeCache.has(uri)) return Promise.resolve();
  return Image.loadAsync(uri)
    .then(ref => {
      // A zero (or otherwise non-finite) width/height — a corrupt file, a truncated decode,
      // some format expo-image can't size correctly — must NOT get cached as if it were real:
      // every consumer of this cache (originScale below) trusts whatever's in here blindly, and
      // dividing by a photo's own near-zero content size produces NaN/Infinity, which reads as
      // that exact photo's piece rendering at some nonsense position (often a screen corner)
      // every single time it's opened, consistently — a real, per-image data bug, not a timing
      // race. Leaving this URI uncached here means originScale's own naturalSize check below
      // falls through to its safe box-ratio approximation instead, exactly as if the load had
      // simply failed.
      if (ref.width > 0 && ref.height > 0 && Number.isFinite(ref.width) && Number.isFinite(ref.height)) {
        imageSizeCache.set(uri, { width: ref.width, height: ref.height });
      }
    })
    .catch(() => {});
}

// The exact size a photo renders at inside a resizeMode="contain" box, given the photo's own
// pixel aspect ratio — the letterboxed content rect, not the box itself. Needed because the
// same photo is shown in two boxes with DIFFERENT aspect ratios: the grid card's fixed
// CARD_W*0.6 x STACK_H*0.78 slot, and the overlay's per-outfit spread slot (size.w x size.h,
// which varies with piece count). Approximating the scale between them from the two BOXES'
// ratios (as a previous version did) is only correct when a photo's aspect ratio happens to
// match both boxes — for any photo that doesn't, "contain" letterboxes it differently in each
// box, so the photo visibly renders at a different absolute size in the grid than the box-ratio
// math assumed. That's a real, permanent size mismatch, not a one-frame timing race — no amount
// of deferring or fading the handoff can hide it, since it's still visibly the wrong size before
// and after any fade. Computing each box's true letterboxed content size from the photo's actual
// aspect ratio and scaling between THOSE (see originScale below) fixes it at the source.
function containSize(boxW: number, boxH: number, imgW: number, imgH: number): { width: number; height: number } {
  const boxRatio = boxW / boxH;
  const imgRatio = imgW / imgH;
  return imgRatio > boxRatio ? { width: boxW, height: boxW / imgRatio } : { height: boxH, width: boxH * imgRatio };
}

// The website's tap-a-stack interaction: images animate outward from their overlapping stack
// position into a spread, separated layout, and reverse back into the stack — at the same
// screen position it was tapped from — on close. Only `transform`/`opacity` are ever animated
// (never left/top/width/height directly): those two are the only style properties the native
// animation driver supports, and animating anything else through it throws "style property X
// is not supported by native animated module" and silently never actually moves — which is why
// the previous version looked like it just snapped straight to the open state. Position/size
// changes are done by fixing each item's base layout at its TARGET rect and translating/scaling
// FROM the origin offset back to identity, not by animating the rect itself.
function SpreadOverlay({
  outfits, initialIndex, items, cardRect, remeasureIndex, onIndexChange, onClose,
  analyses, analysisFailed, requestAnalysis,
}: {
  outfits: ComboOutfit[]; initialIndex: number; items: Record<string, GalleryItem>; cardRect: Rect;
  remeasureIndex: (i: number) => Promise<Rect | null>; onIndexChange: (i: number) => void; onClose: () => void;
  analyses: Record<string, OutfitAnalysis>; analysisFailed: Record<string, string>; requestAnalysis: (o: ComboOutfit) => void;
}) {
  useSuppressNavButton();
  const insets = useSafeAreaInsets();
  const [navIdx, setNavIdx] = useState(initialIndex);
  const [navigating, setNavigating] = useState(false);
  // Starts as the rect measured at open time, but handleClose re-measures the real card right
  // before animating back to it — anything that shifted the underlying scroll position or layout
  // while this overlay was open otherwise left the close animation homing in on a stale spot,
  // snapping visibly to the card's actual (different) position the instant it's revealed.
  const [originRect, setOriginRect] = useState(cardRect);
  const outfit = outfits[navIdx];
  const outfitItems = sortItems(dedupeIds(outfit.itemIds).map(id => items[id]).filter((g): g is GalleryItem => !!g));
  const size = itemSize(outfitItems.length);

  // Two independent animated values so each phase has its own playhead:
  //   gatherP (0→1): stack travels from card center → screen center, scaling card-size → full
  //   spreadP (0→1): items fan from screen center → their individual spread positions
  // This gives clean constant-speed motion in each phase and means the close animation can
  // reverse each phase independently, so items are already in the correct stack orientation
  // and size before moving back to the card — no "orientation change" on close.
  const gatherP = useRef(new Animated.Value(0)).current;
  const spreadP = useRef(new Animated.Value(0)).current;
  const backdropP = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);

  // Was 380/600/80 (≈1060ms open, ≈1000ms close) — well past what reads as "quick" on a phone
  // tap; 200/260/40 (a first attempt at fixing that) went too far the other way and, combined
  // with useNativeDriver:false below, actually looked laggy rather than snappy. This lands
  // between the two. The website's own transform transitions run at .32s with a
  // cubic-bezier(0.4,0,0.2,1) curve (its standard "ease" for interactive transform changes —
  // see app/outfits/page.tsx's grid-shift transitions) — STANDARD_EASE is that exact curve.
  const STANDARD_EASE = Easing.bezier(0.4, 0, 0.2, 1);
  const GATHER_MS = 260;
  const SPREAD_MS = 340;
  const PAUSE_MS = 50;

  // useNativeDriver: true. A previous pass switched this to false on the theory that a newly
  // mounted native-driven interpolation needs a beat to "connect" and can paint a wrong value
  // on its first frame — but going JS-driven made the animation noticeably laggier (computing
  // several items' worth of translateX/Y/scale/opacity interpolation on the JS thread every
  // frame, for a value that updates on essentially every frame of a sub-300ms animation, is
  // real per-frame work) without actually fixing the flash. The flash's real cause was
  // origin/scale math that only approximated the real stack image's rect (see the per-item
  // origin comment below) — not a driver timing issue — so native driving is the right call
  // for a transform/opacity-only animation like this one.
  useEffect(() => {
    // Open: gather (card→center, scale up) → pause → spread (fan out)
    Animated.sequence([
      Animated.parallel([
        Animated.timing(gatherP, { toValue: 1, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
        Animated.timing(backdropP, { toValue: 1, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
      ]),
      Animated.delay(PAUSE_MS),
      Animated.timing(spreadP, { toValue: 1, duration: SPREAD_MS, easing: STANDARD_EASE, useNativeDriver: true }),
    ]).start();
  }, [gatherP, spreadP, backdropP]);

  function handleClose() {
    setClosing(true);
    // Close: fan back to center (scale stays full) → pause → travel back to card (shrink)
    // Items are already in stack orientation at gatherP=1, so the return trip starts correct.
    // Re-measuring is async but the gather leg it needs to be correct for doesn't start until
    // spreadP's own ~300ms leg plus PAUSE_MS have already played out, giving plenty of time for
    // this to resolve before gatherP's interpolation (which reads originRect fresh every render)
    // actually needs it.
    remeasureIndex(navIdx).then(fresh => { if (fresh) setOriginRect(fresh); });
    Animated.sequence([
      Animated.timing(spreadP, { toValue: 0, duration: SPREAD_MS * 0.9, easing: STANDARD_EASE, useNativeDriver: true }),
      Animated.delay(PAUSE_MS),
      Animated.parallel([
        Animated.timing(gatherP, { toValue: 0, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
        Animated.timing(backdropP, { toValue: 0, duration: GATHER_MS, easing: STANDARD_EASE, useNativeDriver: true }),
      ]),
    ]).start(({ finished }) => {
      if (!finished) return;
      // The stack finishes moving back to its original spot — and that's it. No reveal step, no
      // extra fade, nothing scheduled after this. onClose is one atomic state update (see
      // closeSpread in OutfitsScreen) that swaps the overlay for the real card in the same React
      // commit.
      onClose();
    });
  }

  // Lets the arrows cycle to a different outfit without closing/reopening — matches the
  // website's own navigateOutfit exactly (app/preview/PreviewClient.tsx): NOT a lateral scroll.
  // The current items collapse back into the same gathered center stack they opened from
  // (spreadP 1->0; gatherP stays at 1 the whole time since this never returns to the origin
  // card), the outfit swaps while fully collapsed (invisible), and the new outfit's items spread
  // back out (spreadP 0->1) from that same point.
  function navigate(dir: 1 | -1) {
    if (navigating || outfits.length < 2) return;
    const newIdx = (navIdx + dir + outfits.length) % outfits.length;
    setNavigating(true);
    Animated.timing(spreadP, { toValue: 0, duration: SPREAD_MS, easing: STANDARD_EASE, useNativeDriver: true }).start(() => {
      setNavIdx(newIdx);
      // Tells the parent which card is now "current" — its own `remeasure` closure reads
      // spread.index, so without this, closing after navigating to a different outfit via these
      // arrows would still animate back to (and take on the orientation of) whichever card was
      // originally tapped to open this, not the one actually on screen.
      onIndexChange(newIdx);
      // The spread-back-out animation itself is started from the useEffect below, once navIdx
      // actually changes — see that effect's own comment for why.
    });
  }

  // Kicks off the spread-back-out leg once React has ACTUALLY committed a render reflecting the
  // new navIdx — replaces an earlier double-rAF defer (waiting 2 frames and hoping that was
  // enough time for React to re-render before spreadP's per-item targets, which depend on navIdx
  // via outfit/outfitItems/size, got read for real). A fixed frame count is a guess that usually
  // but not always holds; a useEffect keyed on navIdx is a guarantee — React only runs it after
  // committing a render where navIdx (and everything derived from it in this render) is already
  // current, by construction, with no timing assumption involved. `navigating` is set to true
  // synchronously the moment navigate() is called, well before navIdx itself changes, so it's
  // already true by the time this effect re-fires from that change — false only on initial mount,
  // which correctly skips running this at all.
  useEffect(() => {
    if (!navigating) return;
    Animated.sequence([
      Animated.delay(PAUSE_MS),
      Animated.timing(spreadP, { toValue: 1, duration: SPREAD_MS, easing: STANDARD_EASE, useNativeDriver: true }),
    ]).start(() => setNavigating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navIdx]);

  // Deduped and capped at 4 each — matches the website's outfit-list load (all-combos
  // response is post-processed the same way before it ever reaches display).
  // The website only shows the score AND pros/cons for ideal-scoring outfits (>=75) — a
  // below-threshold outfit's detail view is pieces only, no number, no analysis. isIdeal gates
  // both below, matching that exactly rather than always showing whatever data exists.
  // Pro: the score and the outfit's own AI analysis appear together. An outfit past the first
  // pages isn't analyzed until it's opened — loading dots stand in for both until it arrives.
  const isIdeal = outfit.score != null && outfit.score >= IDEAL_THRESHOLD;
  const key = comboKey(outfit.itemIds);
  const outfitAnalysis = analyses[key];
  const failedMsg = analysisFailed[key];
  const analysisReady = !!outfitAnalysis || !!failedMsg;
  useEffect(() => {
    if (isIdeal && !outfitAnalysis && !failedMsg) requestAnalysis(outfit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const detailFocus: FocusItem[] = outfitAnalysis ? [
    ...outfitAnalysis.pros.slice(0, 4).map(t => ({ text: t, color: colors.good })),
    ...outfitAnalysis.cons.slice(0, 4).map(t => ({ text: t, color: colors.bad })),
  ] : failedMsg ? [{ text: failedMsg, color: colors.textFaint }] : [];

  // Screen center gathering point — items stack here between phase 1 and phase 2.
  const gatherCX = SCREEN_W / 2;
  const gatherCY = PIECES_CENTER_Y + size.h / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropP }]} pointerEvents={closing ? "none" : "auto"}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      {isIdeal && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, right: 0, top: SCORE_Y, alignItems: "center",
            opacity: spreadP, transform: [{ translateY: spreadP.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
          }}
        >
          {analysisReady
            ? <Text style={{ fontSize: 44, fontWeight: "700", color: scoreColor(outfit.score) }}>{outfit.score}</Text>
            : <View style={{ height: 52, justifyContent: "center" }}><LoadingDots /></View>}
        </Animated.View>
      )}

      {outfits.length > 1 && !closing && (
        <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: SCORE_Y + 6, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.xl, opacity: backdropP }}>
          <TouchableOpacity onPress={() => navigate(-1)} hitSlop={14}>
            <Ionicons name="chevron-back" size={26} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigate(1)} hitSlop={14}>
            <Ionicons name="chevron-forward" size={26} color={colors.textMuted} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {outfitItems.map((it, i) => {
        const target = spreadTarget(i, outfitItems.length, size);
        const targetCenterX = target.x + size.w / 2;
        const targetCenterY = target.y + size.h / 2;

        // Every item in the grid thumbnail sits at the exact same spot (see the grid render
        // below — no offset, matching the website's stack: position:inset:0 for every item),
        // so there's a single origin point shared by all of them here too — not a measured
        // rect, since measuring each Image individually proved unreliable. This is the box the
        // grid card actually uses (styles.stackImg) — not an approximation of it.
        const originWidth = CARD_W * 0.6;
        const originHeight = STACK_H * 0.78;
        const originCenterX = originRect.x + CARD_W / 2;
        const originCenterY = originRect.y + STACK_H / 2;

        // Phase 1 (gatherP 0→1): stack travels from the card's stack position → screen center,
        // scaling from the thumbnail's real on-screen size up to full spread size. A single
        // scale (not separate X/Y factors) so the photo's own proportions never distort.
        //
        // originScale is the ratio between how big this exact photo actually renders in each
        // box, not how big the two boxes are relative to each other — see containSize above.
        // Using the box ratio directly (Math.min(originWidth/size.w, originHeight/size.h), the
        // previous approach) is only correct when a photo's own aspect ratio happens to match
        // both boxes; for any photo that doesn't, resizeMode="contain" letterboxes it to a
        // different absolute size in each box, so the overlay would land at a visibly wrong
        // size next to the real grid card — a permanent mismatch, not a timing glitch, which no
        // amount of fading the handoff could ever hide.
        const naturalSize = it.image ? imageSizeCache.get(it.image) : undefined;
        const fallbackScale = Math.min(originWidth / size.w, originHeight / size.h);
        const computedScale = naturalSize
          ? containSize(originWidth, originHeight, naturalSize.width, naturalSize.height).width /
            containSize(size.w, size.h, naturalSize.width, naturalSize.height).width
          : NaN;
        // Belt-and-suspenders on top of cacheImageSize's own validation: even a cached size that
        // LOOKS positive could still produce a non-finite ratio here (e.g. two extreme aspect
        // ratios interacting) — never hand the native animated driver a NaN/Infinity scale, which
        // is exactly what read as this exact piece rendering at some nonsense screen position
        // every time it opened, consistently, rather than a one-off timing glitch.
        const originScale = Number.isFinite(computedScale) && computedScale > 0 ? computedScale : fallbackScale; // dimensions not cached yet — shouldn't happen, see prefetchBatch
        const gatherTX = gatherP.interpolate({ inputRange: [0, 1], outputRange: [originCenterX - gatherCX, 0], extrapolate: "clamp" });
        const gatherTY = gatherP.interpolate({ inputRange: [0, 1], outputRange: [originCenterY - gatherCY, 0], extrapolate: "clamp" });
        const scale = gatherP.interpolate({ inputRange: [0, 1], outputRange: [originScale, 1], extrapolate: "clamp" });

        // Phase 2 (spreadP 0→1): items fan from the gathered center point out to their
        // individual spread targets, and back on close — gatherTX/TY alone carry the item the
        // rest of the way home once gather finishes, so this simply targets 0.
        const spreadTX = spreadP.interpolate({ inputRange: [0, 1], outputRange: [gatherCX - targetCenterX, 0], extrapolate: "clamp" });
        const spreadTY = spreadP.interpolate({ inputRange: [0, 1], outputRange: [gatherCY - targetCenterY, 0], extrapolate: "clamp" });

        // Lower stackOrder (accessories, footwear) renders on top of the pile — same direction
        // as the grid thumbnail below — so the topmost item never changes between collapsed,
        // gathered, and spread states.
        const zIndex = 10 + (outfitItems.length - i);

        return (
          <Animated.View
            // Keyed by navIdx (which outfit) too, not just it.id — the SAME garment id can
            // appear in multiple outfits shown as you arrow through them, and keying by id
            // alone means React treats "this piece in outfit A" and "this piece in outfit B"
            // as the SAME element across a navigate(), reusing its native view/animated
            // binding instead of cleanly unmounting the old one and mounting a fresh one. That
            // reuse is exactly what let a piece from the outfit you just navigated AWAY from
            // linger, mid-animation, at its old position while the new outfit's own gather was
            // already running — reading as a piece detached and floating off to one side.
            // Including navIdx forces a genuine remount on every navigate, so nothing can ever
            // carry state over between two different outfits.
            key={`${navIdx}-${it.id}`}
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
            {it.image ? (
              <Image source={{ uri: it.image }} style={{ width: "100%", height: "100%" }} contentFit="contain" cachePolicy="memory-disk" transition={0} />
            ) : null}
          </Animated.View>
        );
      })}

      <Animated.View
        pointerEvents={closing ? "none" : "box-none"}
        style={{ position: "absolute", left: 0, right: 0, top: Math.max(ANALYSIS_TOP, pieceGridBottom(outfitItems.length, size) + 16) + 24, height: ANALYSIS_H, opacity: spreadP }}
      >
        {isIdeal && !analysisReady
          ? <View style={{ alignItems: "center", paddingTop: spacing.md }}><LoadingDots /></View>
          : detailFocus.length > 0 && <FocusScrollList items={detailFocus} />}
      </Animated.View>

      <Animated.View style={{ opacity: backdropP, position: "absolute", top: insets.top + NAV_ROW_TOP, left: 16 }} pointerEvents={closing ? "none" : "auto"}>
        <TouchableOpacity onPress={handleClose} hitSlop={10}>
          <Ionicons name="close" size={NAV_ROW_H} color={colors.textMuted} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// Slides down/up (an actual height reveal, so content below it visibly gets pushed down as it
// opens) rather than instantly popping in. Height isn't native-driver compatible, but this is a
// rare, short, non-performance-critical toggle, not something that needs 60fps native driving.
// Mounted for the duration of the close animation too (via `open` toggling instead of the
// caller conditionally rendering this at all), so closing it plays in reverse instead of just
// vanishing.
function ScrollableFilterPanel({ open, maxHeight, children }: { open: boolean; maxHeight: number; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(anim, { toValue: open ? 1 : 0, duration: 280, easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: false })
      .start(({ finished }) => { if (finished && !open) setMounted(false); });
  }, [open, anim]);

  if (!mounted) return null;
  const height = anim.interpolate({ inputRange: [0, 1], outputRange: [0, maxHeight] });
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.filterPanel} contentContainerStyle={{ padding: spacing.md }}>
        {children}
      </ScrollView>
    </Animated.View>
  );
}

// Extracted and memoized so that opening/closing a stack — which only ever changes which single
// card is hidden — doesn't force every other visible card in the grid to re-render too. Before
// this, `renderItem` was an inline closure recreated on every OutfitsScreen render; FlatList
// sees that as "renderItem changed" and re-invokes it for every mounted cell, which meant the
// entire grid (sortItems + JSX for every card) recomputed on the exact frame the close animation
// finished — a real, visible re-render "flash" landing right on top of the animation settling
// back into place, distinct from (and in addition to) the earlier native-driver timing fix.
// React.memo only helps if every prop is reference-stable across those renders (see `onOpen`
// and `cardRef` at the call site) — otherwise this component would still re-render every time.
const OutfitCard = memo(function OutfitCard({
  outfit, items, index, hidden, onOpen, cardRef, analyzed,
}: {
  outfit: ComboOutfit; items: Record<string, GalleryItem>; index: number; hidden: boolean;
  onOpen: (index: number, outfit: ComboOutfit) => void; cardRef: (r: View | null) => void;
  analyzed: boolean;
}) {
  const outfitItems = useMemo(
    () => sortItems(dedupeIds(outfit.itemIds).map(id => items[id]).filter((g): g is GalleryItem => !!g)),
    [outfit, items]
  );
  // Memoized so re-rendering this card for an unrelated reason (`hidden` toggling) doesn't hand
  // a fresh `source` object to each Image every time — a cheap, real inefficiency regardless of
  // platform, kept even though it turned out not to be the actual cause of the "flash" (see
  // prefetchBatch's comment for what was).
  const outfitImages = useMemo(
    () => outfitItems.map((it, j) => ({ id: it.id, source: it.image ? { uri: it.image } : null, zIndex: outfitItems.length - j })),
    [outfitItems]
  );
  const ideal = outfit.score != null && outfit.score >= IDEAL_THRESHOLD;
  return (
    <TouchableOpacity ref={cardRef} style={styles.card} onPress={() => onOpen(index, outfit)}>
      <View style={styles.stack}>
        {outfitImages.map(img => (
          img.source ? (
            <Image
              key={img.id}
              source={img.source}
              style={[styles.stackImg, { zIndex: img.zIndex }]}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={0}
            />
          ) : null
        ))}
      </View>
      {/* "?" until this outfit has been analyzed — opening it reveals the score with its analysis. */}
      {ideal && (analyzed
        ? <Text style={{ fontSize: 13, fontWeight: "700", color: scoreColor(outfit.score) }}>{outfit.score}</Text>
        : <Text style={{ fontSize: 13, fontWeight: "700", color: colors.textFaint }}>?</Text>)}
      {/* A flat color mask, not `opacity: 0` on the card itself — hiding this way means the
         Image views underneath are NEVER touched (never toggled invisible/visible), so
         revealing the card on close never asks the OS to recomposite several overlapping
         bitmap layers at once. Always mounted (opacity-only, not conditionally rendered) for
         the same reason ShowNavButton/NavBarContentMask are: a freshly mounted view's first
         frame can paint before its opacity is connected, and this mask disappearing a frame
         late would be exactly as visible as the thing it's meant to prevent.
         zIndex is required, not decorative: the sibling Images above each carry an explicit
         zIndex (1..N), and once ANY sibling in a stack has one, React Native paints the whole
         stack sorted by zIndex (missing ones default to 0) instead of JSX order — so without
         this, the mask's implicit zIndex 0 painted it *behind* every image, fully opaque and
         completely invisible, which is exactly why the covered card still visibly showed
         through the whole time it was supposed to be hidden. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: hidden ? 1 : 0, zIndex: 1000 }]} />
    </TouchableOpacity>
  );
});

// Every feasible outfit combination from your closet, ranked highest-first — same source and
// same (unfiltered) result count as the website's /outfits page (GET /api/outfits/all-combos).
export default function OutfitsScreen() {
  const { hasAI } = useEntitlements();
  const [data, setData] = useState<ComboResponse | null>(() => getCached<ComboResponse>("/api/outfits/all-combos") ?? null);
  const [loading, setLoading] = useState(!getCached("/api/outfits/all-combos"));
  const [spread, setSpread] = useState<{ outfit: ComboOutfit; cardRect: Rect; index: number } | null>(null);
  const [hiddenCardIndex, setHiddenCardIndex] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [filterAesthetics, setFilterAesthetics] = useState<string[]>([]);
  const [filterColors, setFilterColors] = useState<string[]>([]);
  const [filterPieces, setFilterPieces] = useState<string[]>([]);
  // false ("any"/OR): an outfit matches if it contains ANY selected piece — pieces don't all need
  // to occur together. true ("all"/AND, shown in blue): an outfit matches only if it contains
  // EVERY selected piece together. See togglePieceFilter's own comment for how you switch modes.
  const [filterPiecesAll, setFilterPiecesAll] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const demo = useTutorialDemo();
  const sampleData = useMemo<ComboResponse>(() => {
    const { garments } = sampleCloset(SAMPLE_IMAGES);
    const outs = sampleOutfits();
    return { total: outs.length, items: Object.fromEntries(garments.map(g => [g.id, g as unknown as GalleryItem])), outfits: outs };
  }, []);
  const shownData = demo ? sampleData : data;
  // Pro outfit analyses, keyed by comboKey. The first screenful and the FIRST "Show more" are
  // analyzed before they appear; every later "Show more" shows "?" scores, analyzed one at a
  // time when opened (so AI is only spent on outfits someone actually looks at).
  const [analyses, setAnalyses] = useState<Record<string, OutfitAnalysis>>({});
  const analysesRef = useRef<Record<string, OutfitAnalysis>>({});
  const sampleAnalyses = useMemo(() => Object.fromEntries(sampleOutfits().map(o => [comboKey(o.itemIds), o.analysis])), []);
  const shownAnalyses = demo ? sampleAnalyses : analyses;
  const [analysisFailed, setAnalysisFailed] = useState<Record<string, string>>({});
  const showMoreCountRef = useRef(0);
  const hasAIRef = useRef(hasAI);
  hasAIRef.current = hasAI;
  const requestedRef = useRef(new Set<string>());

  const mergeAnalyses = useCallback((add: Record<string, OutfitAnalysis>) => {
    if (!Object.keys(add).length) return;
    analysesRef.current = { ...analysesRef.current, ...add };
    setAnalyses(analysesRef.current);
  }, []);

  // Analyzes the ideal-scoring outfits in `batch` that aren't analyzed yet (Pro only). Failures
  // just leave "?" — opening the outfit tries again.
  const ensureAnalyzed = useCallback(async (batch: ComboOutfit[]) => {
    if (!hasAIRef.current) return;
    const need = batch.filter(o => o.score != null && o.score >= IDEAL_THRESHOLD && !analysesRef.current[comboKey(o.itemIds)]);
    for (let i = 0; i < need.length; i += 40) {
      try {
        const r = await apiJson<{ results: Record<string, OutfitAnalysis> }>("/api/outfits/combo-analysis", {
          method: "POST", body: JSON.stringify({ combos: need.slice(i, i + 40).map(o => o.itemIds) }),
        });
        mergeAnalyses(r.results ?? {});
      } catch { /* stays "?" */ }
    }
  }, [mergeAnalyses]);

  // One outfit, on open.
  const requestAnalysis = useCallback(async (o: ComboOutfit) => {
    const key = comboKey(o.itemIds);
    if (requestedRef.current.has(key)) return;
    requestedRef.current.add(key);
    try {
      const r = await apiJson<{ results: Record<string, OutfitAnalysis>; message?: string }>("/api/outfits/combo-analysis", {
        method: "POST", body: JSON.stringify({ combos: [o.itemIds] }),
      });
      if (r.results?.[key]) mergeAnalyses({ [key]: r.results[key] });
      else setAnalysisFailed(prev => ({ ...prev, [key]: r.message ?? ANALYSIS_UNAVAILABLE }));
    } catch {
      setAnalysisFailed(prev => ({ ...prev, [key]: ANALYSIS_UNAVAILABLE }));
    } finally {
      requestedRef.current.delete(key);
    }
  }, [mergeAnalyses]);
  const cardRefs = useRef<Record<number, View | null>>({});
  const outfitsRetryCount = useRef(0);
  const flatListRef = useRef<FlatList>(null);
  // Stable per-index ref callbacks, cached once and reused — an inline `r => cardRefs.current[i]
  // = r` would be a fresh function every render, which (unlike a mere ref-attach churn) would
  // also defeat OutfitCard's React.memo, since `cardRef` is one of its compared props.
  const cardRefCallbacks = useRef<Record<number, (r: View | null) => void>>({}).current;
  function getCardRef(i: number) {
    if (!cardRefCallbacks[i]) cardRefCallbacks[i] = (r: View | null) => { cardRefs.current[i] = r; };
    return cardRefCallbacks[i];
  }

  // Prefetches every piece photo a batch of outfits needs before that batch is ever added to
  // the FlatList's data — so an outfit can never become tappable before its images are ready.
  // Explicit 'memory-disk' cache policy (not the default) so a prefetched image lands in the
  // fast memory tier, not just disk — and every rendered <Image> below asks for the same
  // 'memory-disk' policy, so it's actually reading the tier this just filled rather than one
  // that still requires a disk read + decode.
  //
  // React Native's core Image (used here before switching to expo-image) turned out not to
  // honor this reliably: photos that WERE genuinely prefetched could still fail to paint the
  // moment their card became visible — confirmed on video, a piece silently missing from a grid
  // card for ~200ms before popping in on its own, with no code path forcing a retry. That's the
  // real mechanism behind the "stack refreshes right after landing" bug: it isn't the close
  // animation's handoff (five different fixes there made no difference) — it's this card's own
  // Image failing to paint promptly the moment it's asked to, on a component that had nothing
  // to do with the overlay. expo-image's cache is specifically built to make "was this
  // prefetched?" a reliable question instead of a best-effort one.
  function prefetchBatch(batch: ComboOutfit[], items: Record<string, GalleryItem>) {
    const uris = new Set<string>();
    for (const o of batch) for (const id of o.itemIds) {
      const uri = items[id]?.image;
      if (uri) uris.add(uri);
    }
    // cacheImageSize alongside prefetch: SpreadOverlay's exact-scale math (see containSize)
    // needs each photo's real aspect ratio, and this guarantees it's already cached by the time
    // any of these outfits become tappable.
    return Promise.all([...uris].map(u => Promise.all([Image.prefetch(u, "memory-disk").catch(() => {}), cacheImageSize(u)])));
  }

  // Grows visibleCount from `startCount` up to AUTOFILL_TARGET (or however many outfits exist),
  // prefetching each batch first — same "never tappable before its images are ready" guarantee
  // as the initial load and manual Show More. Runs once, to completion, fire-and-forget from its
  // callers; nothing re-invokes it later off a layout measurement, which is what let the old
  // version surface as an unprompted loading state well after the screen looked finished.
  async function autoFillToScreen(list: ComboOutfit[], itemsMap: Record<string, GalleryItem>, startCount: number) {
    if (startCount >= AUTOFILL_TARGET || startCount >= list.length) return;
    setLoadingMore(true);
    try {
      let count = startCount;
      while (count < AUTOFILL_TARGET && count < list.length) {
        const next = Math.min(count + INITIAL_PAGE_SIZE, AUTOFILL_TARGET, list.length);
        await Promise.all([prefetchBatch(list.slice(count, next), itemsMap), ensureAnalyzed(list.slice(count, next))]);
        count = next;
        setVisibleCount(count);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const lastLoadedJsonRef = useRef<string | null>(null);
  // Set once every retry has failed — shown as an error with RETRY, never as an empty closet.
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    let willRetry = false;
    try {
      const res = await apiJsonCached<ComboResponse>("/api/outfits/all-combos", 60_000);
      const stored: Record<string, OutfitAnalysis> = {};
      for (const o of res.outfits) if (o.analysis) stored[comboKey(o.itemIds)] = o.analysis;
      mergeAnalyses(stored);
      await Promise.all([
        prefetchBatch(res.outfits.slice(0, INITIAL_PAGE_SIZE), res.items),
        ensureAnalyzed(res.outfits.slice(0, INITIAL_PAGE_SIZE)),
      ]);
      // Same class of bug as Calendar's own load(): if this ever re-runs after the 60s ttl has
      // expired (a retry, a future pull-to-refresh, anything beyond the one-time mount effect
      // below), setData+setVisibleCount ran unconditionally — a silent background refetch of
      // UNCHANGED data would still hand the grid a brand-new object reference AND reset scroll
      // back to the first page, which is a considerably more disruptive "refresh" than a plain
      // re-render. Skipped entirely when the refetched data is byte-identical to what's already
      // showing.
      const json = JSON.stringify(res);
      if (lastLoadedJsonRef.current !== json) {
        lastLoadedJsonRef.current = json;
        setData(res);
        setVisibleCount(INITIAL_PAGE_SIZE);
        showMoreCountRef.current = 0;
      }
      outfitsRetryCount.current = 0;
      setLoadFailed(false);
      // Fire-and-forget: first paint (the small INITIAL_PAGE_SIZE batch above) must not wait on
      // however many more batches it takes to cover a full screen.
      autoFillToScreen(res.outfits, res.items, INITIAL_PAGE_SIZE).catch(() => {});
    } catch (e) {
      console.error("[OutfitsScreen] failed to load all-combos:", e);
      // Retry with backoff before giving up — same cold-start handling as Wardrobe/Calendar/
      // Closet. Without this, a single transient failure (e.g. a dev-server cold compile of
      // this route) permanently showed "0 outfits — add more items", indistinguishable from an
      // actually-empty closet, with no way to recover short of leaving and returning to the tab.
      if (outfitsRetryCount.current < 3) {
        const delay = [1500, 3000, 5000][outfitsRetryCount.current] ?? 5000;
        outfitsRetryCount.current += 1;
        willRetry = true;
        setTimeout(load, delay);
        return;
      }
      // Keep whatever was showing; if nothing was, say it failed (it used to set an empty result
      // here, which read as "add more items" while the closet was actually fine).
      outfitsRetryCount.current = 0;
      setLoadFailed(true);
    } finally {
      if (!willRetry) setLoading(false);
    }
  }, []);

  // On every focus, not just mount — this tab stays mounted for the whole session, so a
  // mount-only load kept showing whatever it got at app start (e.g. "0 outfits") no matter how
  // many items were added since. Add Item / Closet removal clear the /api/outfits* cache, so the
  // next focus refetches; otherwise it's a cache hit and load() skips identical data.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // First-run tutorial: the sample closet's outfits (lib/tutorialSamples.ts), shown with scores and
  // analysis — display only, nothing fetched or saved for them.
  const items = shownData?.items ?? {};
  const allOutfits = shownData?.outfits ?? [];
  const outfits = useMemo(() => allOutfits.filter(o => {
    if (o.score < minScore) return false;
    const outfitItems = o.itemIds.map(id => items[id]).filter((g): g is GalleryItem => !!g);
    if (filterAesthetics.length > 0 && !outfitItems.some(it => it.aesthetic_tags?.some(t => filterAesthetics.includes(t)))) return false;
    if (filterColors.length > 0 && !outfitItems.some(it => it.color_primary && filterColors.some(c => it.color_primary!.toLowerCase() === c.toLowerCase()))) return false;
    if (filterPieces.length > 0) {
      if (filterPiecesAll ? !filterPieces.every(id => o.itemIds.includes(id)) : !o.itemIds.some(id => filterPieces.includes(id))) return false;
    }
    return true;
  }), [allOutfits, minScore, filterAesthetics, filterColors, filterPieces, filterPiecesAll, items]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    for (const g of Object.values(items)) if (g.color_primary) set.add(g.color_primary);
    return [...set].sort();
  }, [items]);
  // Character limit, not a word count — a short piece name like "Nike Air Force 1 Low White"
  // still overflowed a filter chip; a flat character cap keeps every chip's width predictable
  // regardless of how the title happens to be worded.
  const PIECE_LABEL_MAX_CHARS = 18;
  const availablePieces = useMemo(() => {
    return Object.values(items)
      .filter(g => g.title)
      .map(g => {
        const t = g.title!.trim();
        return { id: g.id, label: t.length > PIECE_LABEL_MAX_CHARS ? `${t.slice(0, PIECE_LABEL_MAX_CHARS).trimEnd()}…` : t };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);
  const hasFilters = minScore > 0 || filterAesthetics.length > 0 || filterColors.length > 0 || filterPieces.length > 0;
  function clearFilters() {
    setMinScore(0); setFilterAesthetics([]); setFilterColors([]); setFilterPieces([]); setFilterPiecesAll(false);
  }
  function toggle(arr: string[], setArr: (v: string[]) => void, v: string) {
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  }
  // PIECES has its own toggle, distinct from the plain OR-only `toggle` above: tapping an
  // unselected piece just adds it (mode unchanged). Tapping a piece that's ALREADY selected, while
  // still in "any" mode, doesn't deselect it — it escalates the WHOLE current selection into "all"
  // (AND) mode instead, turning every currently-selected chip blue. Once in "all" mode, tapping an
  // already-selected (blue) chip goes back to being a normal deselect, and if that drops the
  // selection to 1 or 0 pieces, mode resets to "any" automatically — AND is meaningless with fewer
  // than 2 pieces, and this is the only way to get back out of "all" mode shy of Clear Filters.
  function togglePieceFilter(id: string) {
    if (!filterPieces.includes(id)) {
      setFilterPieces([...filterPieces, id]);
      return;
    }
    if (!filterPiecesAll) {
      setFilterPiecesAll(true);
      return;
    }
    const next = filterPieces.filter(x => x !== id);
    setFilterPieces(next);
    if (next.length <= 1) setFilterPiecesAll(false);
  }

  // Filter changes invalidate the current page window entirely — start fresh from page 1
  // rather than keeping a visibleCount that referred to the old (unfiltered) ordering. Also
  // re-prefetch that new page 1 (fire-and-forget, not blocking the filter tap): most images are
  // already cached from earlier browsing since outfits reuse the same closet photos, but a
  // filter can surface a combination whose pieces were never rendered before.
  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE);
    showMoreCountRef.current = 0;
    Promise.all([prefetchBatch(outfits.slice(0, INITIAL_PAGE_SIZE), items), ensureAnalyzed(outfits.slice(0, INITIAL_PAGE_SIZE))])
      .then(() => autoFillToScreen(outfits, items, INITIAL_PAGE_SIZE))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScore, filterAesthetics, filterColors, filterPieces, filterPiecesAll]);

  const visibleOutfits = useMemo(() => outfits.slice(0, visibleCount), [outfits, visibleCount]);
  const hasMore = visibleCount < outfits.length;

  async function showMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextBatch = outfits.slice(visibleCount, visibleCount + PAGE_SIZE);
    // Only the first "Show more" is analyzed up front; later pages show "?" until opened.
    const analyzeNow = showMoreCountRef.current === 0;
    showMoreCountRef.current += 1;
    await Promise.all([prefetchBatch(nextBatch, items), analyzeNow ? ensureAnalyzed(nextBatch) : null]);
    setVisibleCount(v => v + PAGE_SIZE);
    setLoadingMore(false);
  }

  function measureRect(target: { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void } | null): Promise<Rect | null> {
    return new Promise(resolve => {
      if (!target) { resolve(null); return; }
      target.measureInWindow((x, y, width, height) => {
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    });
  }

  // Same reasoning as CalendarScreen's measureDestinationCell: a card whose layout JUST
  // changed (a filter applied, "Show More" loaded more rows above/below it, the grid
  // reflowed) can report a stale/transient position from measureInWindow for a frame or two
  // before native layout actually settles — trusting the very first reading risked opening
  // the gather animation from a real rect, just the WRONG one, which reads as a piece flying
  // off toward wherever that stale position happened to be rather than smoothly opening from
  // the tapped card. Requires the SAME rect on two consecutive frames before trusting it.
  async function measureRectStable(target: { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void } | null): Promise<Rect | null> {
    let lastRect: Rect | null = null;
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

  // The real, complete fix for "flies to the wrong/stale spot" — not just which card the grid
  // hides (hiddenCardIndex), but whether we can even MEASURE the current card at all. FlatList
  // only keeps a WINDOW of cells actually mounted (windowSize={7} above); browsing several
  // outfits away via SpreadOverlay's own arrows can easily land on an index outside that window,
  // where cardRefs.current[idx] is simply null — measureRect on that returns null, and the
  // caller was left holding onto whatever originRect it had BEFORE (the originally-tapped card,
  // possibly scrolled far away by now), which is exactly what "flies to a weird spot" looks like:
  // a real position, just the WRONG one. Forces the target index into the mounted window first
  // (scrollToIndex), then polls (same bounded-frame-budget pattern as Calendar's
  // waitForBoxRects/Preview's remeasureIndex) until that specific ref actually exists and has a
  // real laid-out size, rather than assuming one frame is enough.
  async function remeasureIndex(idx: number): Promise<Rect | null> {
    const already = await measureRectStable(cardRefs.current[idx] ?? null);
    if (already) return already;
    try {
      flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.5 });
    } catch {
      // scrollToIndex can throw synchronously if it thinks the index is out of the currently
      // known content size (no getItemLayout on this list) — the poll below still gives the
      // list's own onScrollToIndexFailed / natural re-layout a chance to catch up regardless.
    }
    let frames = 0;
    while (frames < 60) {
      await new Promise<void>(res => requestAnimationFrame(() => res()));
      const rect = await measureRectStable(cardRefs.current[idx] ?? null);
      if (rect) return rect;
      frames++;
    }
    return null;
  }

  // useCallback with no deps: passed to every OutfitCard as `onOpen`, which is one of its
  // React.memo-compared props — a plain function here would get a new reference every render
  // and defeat the memo for every card, reintroducing a full-grid re-render.
  const openingRef = useRef(false);
  const openStack = useCallback(async (i: number, outfit: ComboOutfit) => {
    // Guards a real race: this measurement is async, so a second tap (this card or a different
    // one) landing before the first resolves fires a second measureRect + setSpread while the
    // first is still in flight — SpreadOverlay only plays its gather/spread sequence on mount, so
    // a second setSpread while one is already open just swaps stacks/cardRect props on the SAME
    // still-mounted instance without replaying that effect, and an already-running animation
    // suddenly recomputes its origin/target from the new props mid-flight — a piece jumping onto
    // a different trajectory, which is exactly what "flies to a weird spot and back" looks like.
    if (openingRef.current || spread) return;
    openingRef.current = true;
    const fallbackRect = { x: SCREEN_W * 0.5 - CARD_W * 0.5, y: SCREEN_H * 0.5 - STACK_H * 0.5, width: CARD_W, height: STACK_H };
    const cardRect = (await measureRectStable(cardRefs.current[i])) ?? fallbackRect;
    // Measuring is async, so hiding the card and mounting the overlay happen together in this
    // one call, after the measurement resolves — never a frame where the card is hidden but the
    // overlay isn't positioned yet, or vice versa.
    setSpread({ outfit, cardRect, index: i });
    setHiddenCardIndex(i);
    openingRef.current = false;
  }, [spread]);

  // One atomic swap: the card reappears and the overlay unmounts in the same React commit, so
  // there's never a frame with both or neither visible. Explicitly batched because this runs
  // from the Animated native-driver's completion callback — a callback arriving over the native
  // bridge, not through any of the JS-side event/promise/timer entry points React's automatic
  // batching patches — so left unbatched, the two setState calls would land as two separate
  // renders instead of one.
  const closeSpread = useCallback(() => {
    unstable_batchedUpdates(() => {
      setHiddenCardIndex(null);
      setSpread(null);
    });
  }, []);

  const renderItem = useCallback(
    ({ item: o, index: i }: { item: ComboOutfit; index: number }) => (
      <OutfitCard outfit={o} items={items} index={i} hidden={hiddenCardIndex === i} onOpen={openStack} cardRef={getCardRef(i)}
        analyzed={!!shownAnalyses[comboKey(o.itemIds)]} />
    ),
    [items, hiddenCardIndex, openStack, shownAnalyses]
  );

  // Matches Closet/Wardrobe/Builder: nothing but centered dots while loading, not a header
  // shell with blank/hidden content above them — that's what made the dots land at a visibly
  // different height here than on those other screens.
  // Wrapped in ReadyGate (components/ReadyGate.tsx): dots until the first page of stacks is fully
  // drawn, then everything at once. load() already prefetches that first page's images.
  if (loading && !demo) return <ReadyGate ready={false} />;

  // Header + filter panel inside ListHeaderComponent so they scroll away with the grid rather
  // than staying locked at the top. Both empty-state and normal-state use the same FlatList so
  // the header consistently scrolls in both cases.
  const listHeader = (
    <View>
      {/* FILTER sits top-left, not top-right — the "show/hide nav" toggle always lives
         top-right (see ShowNavButton), so nothing else should compete for that corner. */}
      <View style={styles.header}>
        <View style={{ width: 60 }}>
          <TextButton label={filterOpen ? "CLOSE" : "FILTER"} size={10} color={colors.textMuted} onPress={() => setFilterOpen(v => !v)} />
        </View>
        {/* Title doubles as a scroll-to-top tap target (standard iOS/Android UX) */}
        <TouchableOpacity style={{ flex: 1, alignItems: "center" }} activeOpacity={0.7} onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}>
          <Text style={type.title}>{data ? `${outfits.length} OUTFITS` : ""}</Text>
        </TouchableOpacity>
        <View style={{ width: 60 }} />
      </View>
      <ScrollableFilterPanel open={filterOpen} maxHeight={SCREEN_H * 0.4}>
        {hasFilters && (
          <TextButton label="CLEAR FILTERS" size={9} color={colors.textFaint} onPress={clearFilters} style={{ alignSelf: "center", marginBottom: spacing.md }} />
        )}
        {/* Aesthetic and score filters only exist for Pro — free outfits carry no scores and
           only manually-picked aesthetics, so these are removed outright (not shown locked),
           leaving free users just the filters that work for them: color and pieces. */}
        {hasAI && (
          <>
          <Text style={styles.filterLabel}>AESTHETIC</Text>
            <View style={styles.chipRow}>
              {AESTHETICS.map(a => (
                <TextButton key={a} label={a} size={10} color={filterAesthetics.includes(a) ? colors.text : colors.textFaint} onPress={() => toggle(filterAesthetics, setFilterAesthetics, a)} />
              ))}
            </View>
          <Text style={styles.filterLabel}>MIN SCORE</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
              <TouchableOpacity onPress={() => setMinScore(s => Math.max(0, s - 5))} hitSlop={10}>
                <Ionicons name="remove" size={16} color={colors.text} />
              </TouchableOpacity>
              <Text style={{ fontSize: 13, color: colors.text, minWidth: 28, textAlign: "center" }}>{minScore > 0 ? minScore : "-"}</Text>
              <TouchableOpacity onPress={() => setMinScore(s => Math.min(100, s + 5))} hitSlop={10}>
                <Ionicons name="add" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
          </>
        )}
        {availableColors.length > 0 && (
          <>
            <Text style={styles.filterLabel}>COLOR</Text>
            <View style={styles.chipRow}>
              {availableColors.map(c => (
                <TextButton key={c} label={c} size={10} color={filterColors.includes(c) ? colors.text : colors.textFaint} onPress={() => toggle(filterColors, setFilterColors, c)} />
              ))}
            </View>
          </>
        )}
        {availablePieces.length > 0 && (
          <>
            <Text style={styles.filterLabel}>PIECES</Text>
            <View style={styles.chipRow}>
              {availablePieces.map(p => (
                <TextButton
                  key={p.id}
                  label={p.label}
                  size={10}
                  color={filterPieces.includes(p.id) ? (filterPiecesAll ? colors.blue : colors.text) : colors.textFaint}
                  onPress={() => togglePieceFilter(p.id)}
                />
              ))}
            </View>
            {filterPieces.length > 1 && (
              <Text style={[type.body, { fontSize: 10, color: colors.textFaint, textAlign: "center", marginTop: spacing.xs }]}>
                {filterPiecesAll ? "Showing outfits with all of these together" : "Tap a selected piece again to require all of them together"}
              </Text>
            )}
          </>
        )}
      </ScrollableFilterPanel>
    </View>
  );

  return (
    <ReadyGate ready>
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <FlatList
        ref={flatListRef}
        data={visibleOutfits}
        keyExtractor={(o) => o.itemIds.join(",")}
        numColumns={COLS}
        initialNumToRender={18}
        windowSize={7}
        maxToRenderPerBatch={18}
        // removeClippedSubviews is a known source of visual glitches around opacity-based
        // hide/show swaps like hiddenCardIndex here — the recycled native view can repaint at
        // the wrong moment right as a card's opacity flips, reading as a flash/refresh. Turned
        // off since correctness on this specific interaction matters more than the scroll-perf
        // gain on a grid this size.
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ gap: GRID_GAP }}
        onScroll={e => setAtTop(e.nativeEvent.contentOffset.y <= 4)}
        scrollEventThrottle={16}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={[type.body, { color: colors.textFaint, textAlign: "center" }]}>
              {loadFailed && allOutfits.length === 0
                ? "Couldn't load your outfits."
                : allOutfits.length === 0 ? "Add a few more items to your closet to generate outfit combinations." : "No outfits match filters."}
            </Text>
            {loadFailed && allOutfits.length === 0 && (
              <TextButton label="RETRY" size={11} onPress={() => { setLoadFailed(false); setLoading(true); load(); }} style={{ marginTop: spacing.md }} />
            )}
          </View>
        }
        ListFooterComponent={hasMore ? (
          <TouchableOpacity onPress={showMore} disabled={loadingMore} style={styles.showMore}>
            {loadingMore ? <LoadingDots /> : <Text style={[type.button, { color: colors.text }]}>SHOW MORE</Text>}
          </TouchableOpacity>
        ) : null}
        // No cap, no offset in OutfitCard — every piece renders directly on top of the others
        // (matching the website's stack: position:inset:0 for every item, see
        // app/outfits/page.tsx), and it's the exact same list/order SpreadOverlay uses. A 4-item
        // cap or any spatial offset was what made items (bottom/pants especially) go missing or
        // misaligned: with zero offset there's nothing to keep in sync, so the resting card can
        // never drift from what the animation's gathered point already looks like.
        //
        // Kept as a stable useCallback (not an inline closure) so its identity only changes when
        // `items` or `hiddenCardIndex` actually change — otherwise FlatList treats every render
        // as "renderItem changed" and re-invokes it for every mounted cell regardless of
        // OutfitCard's own memoization.
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
      />
      {/* Fades the grid under the safe-area edge as the user scrolls — only when not at top
         since when the header is visible there's nothing to fade against. */}
      <LinearGradient
        colors={[colors.bg, `${colors.bg}00`]}
        style={[styles.fadeTop, { opacity: atTop ? 0 : 1 }]}
        pointerEvents="none"
      />
    </SafeAreaView>
    {/* A true sibling of SafeAreaView, not a descendant — SpreadOverlay's own math (SCORE_Y/
       PIECES_CENTER_Y as raw SCREEN_H fractions, gatherCX/gatherCY) assumes a coordinate space
       starting at the TRUE top of the screen, to match cardRect (from measureRect/
       measureInWindow, which also returns true-window coordinates). SafeAreaView applies
       insets.top as its own padding on everything inside it, so rendering this overlay as a
       descendant — as it was before — silently shifted its entire coordinate space down by
       insets.top relative to cardRect's true-window numbers: a real, physical mismatch between
       where the tapped card actually is and where this overlay thinks screen-fractions land, not
       just a rounding error — a very plausible cause of the persistent "pieces fly to a weird
       spot" reports here, on a bigger-inset device where the mismatch is large enough to notice. */}
    {spread && (
      <SpreadOverlay
        outfits={visibleOutfits} initialIndex={spread.index} items={items} cardRect={spread.cardRect}
        remeasureIndex={remeasureIndex}
        // Also travels hiddenCardIndex, not just spread.index — spread.index alone only updates
        // what the OVERLAY itself shows; the underlying grid's own "which card is the empty
        // space" mask (hiddenCardIndex) was never being told navigation had moved on, so it sat
        // frozen on whichever card was ORIGINALLY tapped the entire time you browsed with the
        // arrows. Closing then re-revealed the wrong card (the original one) while the overlay's
        // own re-measure/animate-back logic (see handleClose above) correctly targeted the
        // CURRENT one — the empty space never "traveled" because this was the one piece of state
        // that direction of the fix never touched. Preview's equivalent gallery already gets
        // this right via its own separate galleryHiddenIndex, updated the same way.
        onIndexChange={i => { setSpread(prev => (prev ? { ...prev, index: i } : prev)); setHiddenCardIndex(i); }}
        onClose={closeSpread}
        analyses={shownAnalyses} analysisFailed={analysisFailed} requestAnalysis={requestAnalysis}
      />
    )}
    </ReadyGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // FILTER + title share the nav chevron's exact center line (see ShowNavButton's NAV_ROW_*).
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, marginTop: NAV_ROW_TOP, height: NAV_ROW_H, marginBottom: spacing.sm },
  filterPanel: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  filterLabel: { ...type.label, textAlign: "center", marginTop: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl, paddingVertical: spacing.xl * 2 },
  grid: { padding: spacing.md, paddingBottom: spacing.md },
  showMore: { alignItems: "center", justifyContent: "center", paddingVertical: 0, minHeight: 28 },
  card: { width: CARD_W, alignItems: "center", gap: 4 },
  stack: { width: CARD_W, height: STACK_H, alignItems: "center", justifyContent: "center" },
  stackImg: { position: "absolute", width: CARD_W * 0.6, height: STACK_H * 0.78 },
  fadeTop: { position: "absolute", top: 0, left: 0, right: 0, height: 26 },
  backdrop: { backgroundColor: "#ffffffee" },
});
