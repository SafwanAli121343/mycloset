import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, Text, StyleSheet, ScrollView, Dimensions, type GestureResponderEvent } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fontFamily } from "../theme/theme";

const FALLOFF = 56;
const DEFAULT_FOCAL = 0.45;
const { width: SCREEN_W } = Dimensions.get("window");
const PEAK_SCALE = 1.22;
const ROW_H_PADDING = 20;
const TEXT_MAX_W = (SCREEN_W - ROW_H_PADDING * 2) / PEAK_SCALE;
const FONT_SIZE = 19;
const LINE_H = 24;

// Every row's height is now a fixed constant determined purely by its KIND (header / body /
// word-chip), never by measuring its actual rendered text. This traded away tight per-entry
// spacing for something that matters more here: with real per-entry heights, every item switch
// changed the ScrollView's row layout (different text = different measured heights), and no
// matter how that height was sourced — a rough estimate, a real async measurement, even a
// PRE-fetched exact measurement done before the switch ever happened — React Native's native
// layout engine still had to physically reflow the rows to match, one frame after the new
// scale/opacity interpolation (computed synchronously from the new geometry) had already been
// applied. That layout-commit-vs-interpolation-commit gap, not any data accuracy problem, is
// what kept reading as "starts in the wrong spot, then corrects" no matter how the underlying
// height was sourced. With heights fixed by kind, a switch changes the TEXT inside rows but
// never the ROWS' geometry itself (same kind sequence structure independent of what the words
// are) — there's nothing for native layout to reflow, so there's nothing to catch up to.
// BODY_H fits 3 lines at normal size; longer text ends in an ellipsis. To read it, the user
// resizes that bullet's text (row heights never change, so nothing reflows):
//   • double tap: one SIZE_STEP smaller, down to SIZE_MIN (smaller text fits more lines in the
//     same row); at SIZE_MIN, double taps step back up until it's normal size again;
//   • press and hold: grows gradually back to normal size while held.
// Sizes are per bullet (shared by its looped copies) and reset when the list's items change.
// Was 40 — fine when headers are interleaved with much-taller body rows (InfoCard's own
// pros/cons lists), where the body rows themselves provide breathing room. A list of NOTHING but
// headers back-to-back (PreviewScreen's compare metrics) had barely any gap between consecutive
// rows at that height, and — since each row's own center-to-center distance was well under
// FALLOFF (56) — the next row over was still mostly inside the "close to peak" falloff zone,
// making the magnify/demagnify effect barely register between adjacent items. Taller rows fix
// both: more visual space between header lines, and centers now further apart than FALLOFF, so
// the scale/opacity swing between focused and adjacent rows reads as a real, visible effect.
const HEADER_H = 60;
const BODY_LINES = 3;
const SIZE_STEP = 0.1;
const SIZE_MIN = 0.6;
const DOUBLE_TAP_MS = 300;
const HOLD_TICK_MS = 60;
const HOLD_STEP = 0.025;
const BODY_H = 16 + BODY_LINES * LINE_H;
// Tall enough for TWO wrapped lines (was 44, single-line only, with flexWrap:"nowrap" on the row
// below) — a "words" row's total content (e.g. 3 color names) can genuinely be wider than the
// screen, and nowrap just let it silently run off both edges instead of wrapping. `spread` rows
// are a fixed shape (always exactly one line per slot, never wrapping) and use their own,
// shorter height so they don't inherit this row's now-larger empty space for no reason.
const WORDS_H = 64;
const SPREAD_H = 44;

export type FocusItem =
  | { key?: string; text: string; color?: string; header?: boolean }
  // Each word can carry its own color (falling back to the row's own `color`, then the default
  // text color) — added so a single row can mix e.g. two differently-scored numbers around a
  // neutral label (see PreviewScreen's 2-piece compare metrics) without giving up the shared
  // magnify/loop mechanics every other FocusScrollList row already gets.
  | { key?: string; words: (string | { text: string; color?: string })[]; color?: string }
  // Like `words`, but laid out edge-to-edge across the FULL row width instead of a tight
  // centered cluster: the first entry pins to the left edge, the last to the right edge, and
  // anything in between centers — e.g. a score on each side of a centered field label. Same
  // font/size/color rules as `words` (per-entry color, falling back to the row's own `color`,
  // then the default text color); only the horizontal placement differs.
  | { key?: string; spread: (string | { text: string; color?: string })[]; color?: string };

function rowHeight(item: FocusItem): number {
  if ("words" in item) return WORDS_H;
  if ("spread" in item) return SPREAD_H;
  return item.header ? HEADER_H : BODY_H;
}

function computeNCopies(items: FocusItem[]): number {
  const totalH = items.reduce((s, it) => s + rowHeight(it), 0);
  const needed = Math.ceil(2500 / Math.max(totalH, 50)) * 2 + 1;
  return Math.min(21, Math.max(7, needed));
}

export function FocusScrollList({ items, focal = DEFAULT_FOCAL, onFocalIndexChange }: {
  items: FocusItem[]; focal?: number;
  // Reports which ORIGINAL item (index into `items`, already un-looped) currently sits nearest
  // the focal point, only when it actually changes — a consumer (e.g. PreviewScreen's per-piece
  // score readout keyed to whichever metric header is centered) can use this to know which item
  // is "primary" right now without duplicating this list's own loop/centering math.
  onFocalIndexChange?: (index: number) => void;
}) {
  const scrollY = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0); // current scroll offset, for mapping a touch to its row
  const [viewportH, setViewportH] = useState(0);
  // Text size per bullet (index into `items`): scale 1 = normal; dir = what the next double tap
  // does. See SIZE_STEP.
  const [sizes, setSizes] = useState<Record<number, { scale: number; dir: "down" | "up" }>>({});
  // Keyed on the text itself: screens rebuild `items` on every render, which mustn't reset sizes.
  const itemsKey = items.map(it => ("text" in it ? it.text : "")).join("\n");
  useEffect(() => { setSizes({}); }, [itemsKey]);
  const lastTapRef = useRef<{ idx: number; at: number } | null>(null);
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => { if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; } };
  useEffect(() => stopHold, []);
  const onBodyTap = (idx: number) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (!last || last.idx !== idx || now - last.at > DOUBLE_TAP_MS) { lastTapRef.current = { idx, at: now }; return; }
    lastTapRef.current = null;
    setSizes(prev => {
      const cur = prev[idx] ?? { scale: 1, dir: "down" as const };
      if (cur.dir === "down") {
        const scale = Math.max(SIZE_MIN, +(cur.scale - SIZE_STEP).toFixed(3));
        return { ...prev, [idx]: { scale, dir: scale <= SIZE_MIN ? "up" : "down" } };
      }
      const scale = Math.min(1, +(cur.scale + SIZE_STEP).toFixed(3));
      return { ...prev, [idx]: { scale, dir: scale >= 1 ? "down" : "up" } };
    });
  };
  const onBodyHold = (idx: number) => {
    stopHold();
    holdRef.current = setInterval(() => {
      setSizes(prev => {
        const cur = prev[idx];
        if (!cur || cur.scale >= 1) { stopHold(); return cur ? { ...prev, [idx]: { scale: 1, dir: "down" } } : prev; }
        const scale = Math.min(1, cur.scale + HOLD_STEP);
        return { ...prev, [idx]: { scale, dir: scale >= 1 ? "down" : cur.dir } };
      });
    }, HOLD_TICK_MS);
  };
  const scrollRef = useRef<ScrollView>(null);
  const loop = items.length > 1;
  const lastFocalIndexRef = useRef<number | null>(null);

  // Stays false until after the very first scrollTo fires.
  // The container renders with opacity:0 until this is true, hiding the initial
  // y=0 flash that would otherwise appear before the centering effect fires.
  const [centered, setCentered] = useState(false);
  const hasCenteredRef = useRef(false);

  const nCopies = useMemo(() => loop ? computeNCopies(items) : 1, [items, loop]);
  const midCopy = Math.floor(nCopies / 2);

  const heights = useMemo(() => items.map(rowHeight), [items]);

  const loopedHeights = useMemo(
    () => (loop ? Array.from({ length: nCopies }, () => heights).flat() : heights),
    [heights, loop, nCopies]
  );
  const loopedItems = useMemo(
    () => (loop ? Array.from({ length: nCopies }, () => items).flat() : items),
    [items, loop, nCopies]
  );

  const { centers, oneCopyH } = useMemo(() => {
    let y = 0;
    const cs: number[] = [];
    for (const h of loopedHeights) {
      cs.push(y + h / 2);
      y += h;
    }
    return { centers: cs, oneCopyH: loop ? y / nCopies : y };
  }, [loopedHeights, loop, nCopies]);

  // Initial centering: fires once when viewportH is first known.
  // Sets opacity visible only after the scrollTo is queued so the user never
  // sees the y=0 starting position.
  useEffect(() => {
    if (!loop || viewportH <= 0 || hasCenteredRef.current) return;
    hasCenteredRef.current = true;
    const target = Math.max(0, midCopy * oneCopyH - viewportH * focal + heights[0] / 2);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: target, animated: false });
      scrollY.setValue(target);
      offsetRef.current = target;
      // Make visible only after the scroll position is set.
      setCentered(true);
      reportFocalIndex(target);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportH, loop, oneCopyH, focal, midCopy, heights]);

  // Finds whichever item is currently nearest the focal point and reports it (deduped) — reads
  // the real scroll offset via Animated.event's `listener` option, which fires on the JS thread
  // on every scroll update even with useNativeDriver:true (the interpolations themselves stay
  // fully native either way; this is purely an additional, cheap JS-side observer).
  function reportFocalIndex(offsetY: number) {
    if (!onFocalIndexChange || items.length === 0) return;
    const target = offsetY + viewportH * focal;
    let bestI = 0, bestDist = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(centers[i] - target);
      if (d < bestDist) { bestDist = d; bestI = i; }
    }
    const originalIndex = bestI % items.length;
    if (lastFocalIndexRef.current !== originalIndex) {
      lastFocalIndexRef.current = originalIndex;
      onFocalIndexChange(originalIndex);
    }
  }

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: true, listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => { offsetRef.current = e.nativeEvent.contentOffset.y; reportFocalIndex(e.nativeEvent.contentOffset.y); } },
  );

  // Does NOT re-center on item switch, and doesn't need to: with fixed row heights, oneCopyH
  // and centers[] are the same for every item with the same section structure, so the scroll
  // offset the user is already sitting at keeps meaning the same thing after a switch — the new
  // item's text just renders under it in place.

  // After a fling ends: only correct loop position if near the buffer edge.
  // Does NOT snap to nearest item — stays exactly where deceleration stopped.
  const onMomentumEnd = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    if (!loop || oneCopyH <= 0) return;
    const y = e.nativeEvent.contentOffset.y;
    const copyN = Math.floor(y / oneCopyH);
    if (copyN >= 3 && copyN <= nCopies - 4) return;
    const within = ((y % oneCopyH) + oneCopyH) % oneCopyH;
    const target = midCopy * oneCopyH + within;
    if (Math.abs(target - y) > 0.5) {
      scrollRef.current?.scrollTo({ y: target, animated: false });
      scrollY.setValue(target);
      offsetRef.current = target;
    }
  };

  // Taps and holds are read from raw touches on the (untransformed) wrapper, then mapped to the
  // row under the finger from the scroll offset. A Pressable on each row didn't work: the rows
  // carry 3D perspective transforms, which iOS doesn't hit-test reliably. Touches that move are
  // scrolls and are ignored.
  const padY = loop || items.length === 0 ? 0 : Math.max(0, viewportH / 2 - heights[0] / 2);
  const wrapRef = useRef<View>(null);
  const wrapTopRef = useRef(0);
  const touchRef = useRef<{ x: number; y: number; at: number; moved: boolean; idx: number | null } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoldTimer = () => { if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; } };
  useEffect(() => clearHoldTimer, []);
  const bodyIndexAt = (pageY: number): number | null => {
    const y = offsetRef.current + (pageY - wrapTopRef.current) - padY;
    for (let i = 0; i < loopedHeights.length; i++) {
      const top = centers[i] - loopedHeights[i] / 2;
      if (y >= top && y < top + loopedHeights[i]) {
        const it = loopedItems[i];
        return "text" in it && !it.header ? i % items.length : null;
      }
    }
    return null;
  };
  const onTouchStart = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length > 1) { touchRef.current = null; return; }
    const { pageX, pageY } = e.nativeEvent;
    touchRef.current = { x: pageX, y: pageY, at: Date.now(), moved: false, idx: null };
    clearHoldTimer();
    wrapRef.current?.measureInWindow((_x, top) => {
      wrapTopRef.current = top;
      if (touchRef.current) touchRef.current.idx = bodyIndexAt(pageY);
    });
    holdTimerRef.current = setTimeout(() => {
      const t = touchRef.current;
      if (t && !t.moved && t.idx !== null && (sizes[t.idx]?.scale ?? 1) < 1) onBodyHold(t.idx);
    }, 250);
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    const t = touchRef.current;
    if (!t || t.moved) return;
    if (Math.abs(e.nativeEvent.pageX - t.x) > 10 || Math.abs(e.nativeEvent.pageY - t.y) > 10) {
      t.moved = true; clearHoldTimer(); stopHold();
    }
  };
  const onTouchEnd = () => {
    const t = touchRef.current;
    touchRef.current = null;
    clearHoldTimer();
    const wasHolding = !!holdRef.current;
    stopHold();
    if (!t || t.moved || wasHolding || Date.now() - t.at > 250) return;
    const idx = t.idx ?? bodyIndexAt(t.y);
    if (idx !== null) onBodyTap(idx);
  };
  const onTouchCancel = () => { touchRef.current = null; clearHoldTimer(); stopHold(); };

  if (items.length === 0) return null;

  return (
    <View
      ref={wrapRef}
      style={{ flex: 1, opacity: centered || !loop ? 1 : 0 }}
      onLayout={e => {
        setViewportH(e.nativeEvent.layout.height);
        wrapRef.current?.measureInWindow((_x, top) => { wrapTopRef.current = top; });
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces={!loop}
        contentContainerStyle={{ paddingVertical: padY }}
      >
        {loopedItems.map((item, i) => {
          const focusOffset = centers[i] - viewportH * focal;
          const inputRange = [focusOffset - 2*FALLOFF, focusOffset - FALLOFF, focusOffset, focusOffset + FALLOFF, focusOffset + 2*FALLOFF];
          const scale = scrollY.interpolate({ inputRange, outputRange: [0.78, 0.9, 1.22, 0.9, 0.78], extrapolate: "clamp" });
          const opacity = scrollY.interpolate({ inputRange, outputRange: [0.4, 0.7, 1, 0.7, 0.4], extrapolate: "clamp" });
          const rotateX = scrollY.interpolate({ inputRange, outputRange: ["18deg","9deg","0deg","-9deg","-18deg"], extrapolate: "clamp" });
          const color = item.color ?? colors.text;
          return (
            <Animated.View key={`${item.key ?? i}-${i}`} style={[styles.row, { height: rowHeight(item), opacity, transform: [{ perspective: 500 }, { rotateX }, { scale }] }]}>
              {"words" in item ? (
                <View style={styles.wordRow}>{item.words.map((w, wi) => {
                  const text = typeof w === "string" ? w : w.text;
                  const wordColor = typeof w === "string" ? color : (w.color ?? color);
                  return <Text key={wi} style={[styles.text, { color: wordColor }]}>{text}</Text>;
                })}</View>
              ) : "spread" in item ? (
                <View style={styles.spreadRow}>{item.spread.map((w, wi) => {
                  const text = typeof w === "string" ? w : w.text;
                  const wordColor = typeof w === "string" ? color : (w.color ?? color);
                  const align = wi === 0 ? "left" : wi === item.spread.length - 1 ? "right" : "center";
                  return (
                    <Text key={wi} style={[styles.text, styles.spreadText, { color: wordColor, textAlign: align }]} numberOfLines={1}>
                      {text}
                    </Text>
                  );
                })}</View>
              ) : (
                <Text
                  style={[styles.text, { color }, !item.header && (() => {
                    const k = sizes[i % items.length]?.scale ?? 1;
                    return k < 1 ? { fontSize: FONT_SIZE * k, lineHeight: (LINE_H - 2) * k } : null;
                  })()]}
                  numberOfLines={item.header ? 1 : Math.max(BODY_LINES, Math.floor((BODY_H - 16) / (LINE_H * (sizes[i % items.length]?.scale ?? 1))))}
                  ellipsizeMode="tail"
                  // Headers get one row all to themselves and should basically never need this —
                  // but a genuinely long field name still shouldn't truncate with "…" when it
                  // could just be readable at a slightly smaller size instead. 0.7 wasn't a low
                  // enough floor for a longer phrase (e.g. "Classic streetwear appeal") to ever
                  // reach a size that actually fits this row's width — iOS stops shrinking at
                  // the floor and falls back to a hard ellipsis truncation instead, which is
                  // exactly the cut-off-mid-word look this was meant to prevent in the first
                  // place. Lower floor gives long phrases real room to shrink into before that
                  // fallback ever kicks in.
                  adjustsFontSizeToFit={item.header}
                  minimumFontScale={item.header ? 0.5 : undefined}
                >
                  {item.text}
                </Text>
              )}
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
      <LinearGradient colors={[colors.bg, `${colors.bg}00`]} style={styles.fadeTop} pointerEvents="none" />
      <LinearGradient colors={[`${colors.bg}00`, colors.bg]} style={styles.fadeBottom} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", justifyContent: "center", paddingHorizontal: ROW_H_PADDING },
  wordRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", maxWidth: TEXT_MAX_W },
  spreadRow: { flexDirection: "row", alignItems: "center", width: "100%" },
  text: { fontFamily, fontSize: FONT_SIZE, textAlign: "center", lineHeight: LINE_H - 2, fontWeight: "500", maxWidth: TEXT_MAX_W },
  spreadText: { flex: 1, maxWidth: undefined },
  fadeTop: { position: "absolute", top: 0, left: 0, right: 0, height: 28 },
  fadeBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 28 },
});
