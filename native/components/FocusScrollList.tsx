import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, Text, StyleSheet, ScrollView, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fontFamily } from "../theme/theme";

// Distance (in scroll px) over which one step of the scale/opacity/tilt falloff plays out.
const FALLOFF = 56;
const CHARS_PER_LINE = 30;
const LINE_H = 24;
// A large, fixed buffer. Correction only ever happens once the scroll comes to REST (see
// onSettle) — never mid-gesture — so this only needs to be big enough that a single realistic
// fling can't blow past it and reach the true first/last copy while still moving. It does NOT
// need to be "exactly right"; bigger just means more margin, and rows are cheap (plain Text).
const N_COPIES = 21;
const MID_COPY = 10;
const { width: SCREEN_W } = Dimensions.get("window");

export type FocusItem =
  | { key?: string; text: string; color?: string }
  | { key?: string; words: string[]; color?: string };

// Rough same-frame fallback used only until MeasurePass's real measurements land (below) —
// deliberately NOT inflated for peak-scale growth. A row's `transform: scale` at focus is a
// paint-only effect: it never changes the row's actual layout box, so the real ScrollView always
// advances by each row's plain resting height regardless of how big that row visually gets. Row
// spacing headroom for that visual growth comes from styles.row's real paddingVertical instead
// (a genuine layout value, unlike transform) — see its comment.
const PEAK_SCALE = 1.22;
function estimateHeight(item: FocusItem): number {
  if ("words" in item) return 44;
  const lines = Math.max(1, Math.ceil(item.text.length / CHARS_PER_LINE));
  return 16 + lines * LINE_H;
}

// Horizontal padding each row reserves (see styles.row) — text is constrained to fit within
// this width AT REST, shrunk by PEAK_SCALE, so that once the focused row scales UP to
// PEAK_SCALE it lands exactly at the screen edge instead of overflowing past it.
const ROW_H_PADDING = 20;
const TEXT_MAX_W = (SCREEN_W - ROW_H_PADDING * 2) / PEAK_SCALE;

function signatureOf(items: FocusItem[]): string {
  return items.map(it => ("words" in it ? "w:" + it.words.join("") : "t:" + it.text)).join("");
}

// Renders each distinct row once, off-screen and invisible, in the EXACT same layout (styles.row/
// styles.text, real font metrics and wrapping) the interactive list uses at rest, purely to read
// its true rendered height via onLayout. A hand-rolled character-count formula (estimateHeight,
// above) was tried first for this and is why the magnify effect never visibly worked: it doesn't
// match real font-metric line wrapping, and across a 21-copy looped list that per-row error
// accumulates into hundreds of px of drift, so the row the math calls "centered" and the row
// actually sitting at the screen's center silently stop being the same row. Doing this measurement
// pass ONCE, before the interactive ScrollView ever mounts (not via onLayout on the live scrolling
// rows), sidesteps the exact failure mode the original single-pass, estimate-only design was
// trying to avoid: a live remeasurement arriving mid-gesture and yanking the position math out
// from under a scroll the user is already mid-interaction with.
function MeasurePass({ items, onDone }: { items: FocusItem[]; onDone: (heights: number[]) => void }) {
  const heights = useRef<number[]>([]);
  const doneRef = useRef(false);
  return (
    <View style={styles.measurePass} pointerEvents="none">
      {items.map((item, i) => (
        <View
          key={i}
          style={styles.row}
          onLayout={e => {
            heights.current[i] = e.nativeEvent.layout.height;
            if (doneRef.current || heights.current.filter(h => h != null).length !== items.length) return;
            doneRef.current = true;
            onDone(heights.current);
          }}
        >
          {"words" in item ? (
            <View style={styles.wordRow}>
              {item.words.map((w, wi) => <Text key={wi} style={styles.text}>{w}</Text>)}
            </View>
          ) : (
            <Text style={styles.text}>{item.text}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// The iOS picker-wheel effect (think the date/time spinner in Settings) — but looping, not
// bounded: the row nearest the center of the visible area reads as "focused" — biggest,
// flattest, full opacity — and every other row shrinks, dims, and tilts on its X-axis the
// further it sits from center. Scrolling past the first or last logical row wraps around instead
// of stopping, in both directions: the item list renders N_COPIES times back to back, and once
// the scroll comes to rest anywhere outside the safe middle band, it's silently, invisibly
// snapped back to the equivalent position in the middle copy (every copy is identical content,
// so the jump is imperceptible). Correction is settle-only, never mid-scroll — an earlier version
// corrected continuously during onScroll, which fights the ScrollView's native momentum physics
// and reads as the scroll "stopping you" mid-gesture before letting you continue.
//
// scrollY is driven with useNativeDriver: false, deliberately — see MeasurePass's comment for the
// row-height side of this same design; this half is about scrollY itself. `.setValue()` is called
// explicitly right after every programmatic scrollTo (initial centering, loop-wrap settle), so
// scrollY can never drift out of sync with the real scroll position regardless of whether a given
// scrollTo call happens to trigger a native onScroll dispatch on its own.
export function FocusScrollList({ items }: { items: FocusItem[] }) {
  const scrollY = useRef(new Animated.Value(0)).current;
  const [viewportH, setViewportH] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const loop = items.length > 1;
  const signature = useMemo(() => signatureOf(items), [items]);
  const hasCenteredRef = useRef(false);
  const [measured, setMeasured] = useState<number[] | null>(null);

  useEffect(() => { hasCenteredRef.current = false; setMeasured(null); }, [signature]);

  const heights = useMemo(
    () => items.map((item, i) => measured?.[i] ?? estimateHeight(item)),
    [items, measured]
  );

  const loopedHeights = useMemo(
    () => (loop ? Array.from({ length: N_COPIES }, () => heights).flat() : heights),
    [heights, loop]
  );
  const loopedItems = useMemo(
    () => (loop ? Array.from({ length: N_COPIES }, () => items).flat() : items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, loop]
  );

  const { centers, oneCopyH } = useMemo(() => {
    let y = 0;
    const centers: number[] = [];
    for (const h of loopedHeights) {
      centers.push(y + h / 2);
      y += h;
    }
    const oneCopyH = loop ? y / N_COPIES : y;
    return { centers, oneCopyH };
  }, [loopedHeights, loop]);

  // Starting position: the first logical row centered in the viewport, in the middle copy — not
  // scrolled-to-the-top, so the wheel effect is already in its focused state the instant this
  // mounts. Fires at most once per distinct item list (guarded by hasCenteredRef), and only once
  // real measurements are in so this initial jump uses the same accurate heights as everything
  // after it.
  useEffect(() => {
    if (!loop || viewportH <= 0 || !measured || hasCenteredRef.current) return;
    hasCenteredRef.current = true;
    const target = Math.max(0, MID_COPY * oneCopyH - viewportH / 2 + heights[0] / 2);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: target, animated: false });
      scrollY.setValue(target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop, oneCopyH, viewportH, signature, measured]);

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false },
  );

  // The ONLY loop-wrap correction: once the scroll comes to rest, remap wherever it landed to
  // the equivalent offset in the middle copy via modulo — works regardless of how far or how
  // fast the scroll traveled to get there, so there's no buffer size that could ever be "not
  // enough" the way a mid-scroll threshold check could be outrun.
  const onSettle = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    if (!loop || oneCopyH <= 0) return;
    const y = e.nativeEvent.contentOffset.y;
    const within = ((y % oneCopyH) + oneCopyH) % oneCopyH;
    const target = MID_COPY * oneCopyH + within;
    if (Math.abs(target - y) > 1) {
      scrollRef.current?.scrollTo({ y: target, animated: false });
      scrollY.setValue(target);
    }
  };

  if (items.length === 0) return null;

  // Non-looping (single-item) fallback still needs a little top/bottom breathing room so its
  // one row can center without clipping against the viewport edge when magnified.
  const padY = loop ? 0 : Math.max(0, viewportH / 2 - heights[0] / 2);

  return (
    <View style={{ flex: 1 }} onLayout={e => setViewportH(e.nativeEvent.layout.height)}>
      {measured === null && <MeasurePass items={items} onDone={setMeasured} />}
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onMomentumScrollEnd={onSettle}
        onScrollEndDrag={onSettle}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces={!loop}
        contentContainerStyle={{ paddingVertical: padY }}
      >
        {loopedItems.map((item, i) => {
          const focusOffset = centers[i] - viewportH / 2;
          const inputRange = [focusOffset - 2*FALLOFF, focusOffset - FALLOFF, focusOffset, focusOffset + FALLOFF, focusOffset + 2*FALLOFF];
          const scale = scrollY.interpolate({ inputRange, outputRange: [0.78, 0.9, 1.22, 0.9, 0.78], extrapolate: "clamp" });
          const opacity = scrollY.interpolate({ inputRange, outputRange: [0.4, 0.7, 1, 0.7, 0.4], extrapolate: "clamp" });
          const rotateX = scrollY.interpolate({ inputRange, outputRange: ["18deg","9deg","0deg","-9deg","-18deg"], extrapolate: "clamp" });
          const color = item.color ?? colors.text;
          return (
            <Animated.View key={`${item.key ?? i}-${i}`} style={[styles.row, { opacity, transform: [{ perspective: 500 }, { rotateX }, { scale }] }]}>
              {"words" in item ? (
                <View style={styles.wordRow}>{item.words.map((w, wi) => <Text key={wi} style={[styles.text, { color }]}>{w}</Text>)}</View>
              ) : (
                <Text style={[styles.text, { color }]}>{item.text}</Text>
              )}
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
      <LinearGradient colors={["#ffffff", "#ffffff00"]} style={styles.fadeTop} pointerEvents="none" />
      <LinearGradient colors={["#ffffff00", "#ffffff"]} style={styles.fadeBottom} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  measurePass: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  // paddingVertical is real reserved layout space (unlike a row's `transform: scale`, which is
  // paint-only) — sized to comfortably fit a single line's growth from resting size up to
  // PEAK_SCALE without visually colliding into whichever row sits next to it once focused.
  row: { alignItems: "center", justifyContent: "center", paddingHorizontal: ROW_H_PADDING, paddingVertical: 12 },
  wordRow: { flexDirection: "row", flexWrap: "nowrap", gap: 18, justifyContent: "center", maxWidth: TEXT_MAX_W },
  text: { fontFamily, fontSize: 19, textAlign: "center", lineHeight: 22, fontWeight: "500", maxWidth: TEXT_MAX_W },
  fadeTop: { position: "absolute", top: 0, left: 0, right: 0, height: 28 },
  fadeBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 28 },
});
