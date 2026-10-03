import { useRef } from "react";
import { View, StyleSheet, Dimensions, Animated } from "react-native";
import { Image } from "expo-image";
import { colors } from "../theme/theme";
import { LoadingDots } from "./LoadingDots";
import { bucketOf, sortTops, type SlotGarment } from "../lib/garmentSlots";

export type BoxRect = { x: number; y: number; width: number; height: number };

// Same stability check CalendarScreen's own measureDestinationCell uses (see its comment): a
// view whose layout JUST changed — which, for this box, is true on literally every call, since
// onLayout only fires because SOMETHING about its geometry just settled — can report a stale or
// transient position from measureInWindow for a frame or two before native layout truly
// finishes, before snapping to its real, final coordinates. Trusting the very FIRST reading (a
// plain single-shot measureInWindow, no retry) is exactly what a previous version of this did,
// and is a real, concrete mechanism for a garment appearing to fly to (or from) the wrong spot
// during the calendar's gather animation — reported as "a fragment piece in the top right" —
// specifically on a box's FIRST-ever measurement this session (a day view mounting for the very
// first time has more settling to do than one already warmed up from a prior visit), which
// matches the reported "only the first animation, later ones are fine" pattern. Requiring the
// SAME rect on two consecutive frames before reporting it makes a transient reading self-correct
// silently instead of being trusted and handed off as this box's real position.
function measureBoxRect(target: View): Promise<BoxRect | null> {
  return new Promise(resolve => {
    let lastRect: BoxRect | null = null;
    const deadline = Date.now() + 400;
    const poll = () => {
      target.measureInWindow((x, y, width, height) => {
        const rect = width > 0 && height > 0 ? { x, y, width, height } : null;
        if (rect && lastRect && rect.x === lastRect.x && rect.y === lastRect.y && rect.width === lastRect.width && rect.height === lastRect.height) {
          resolve(rect);
          return;
        }
        lastRect = rect;
        if (Date.now() >= deadline) { resolve(lastRect); return; }
        requestAnimationFrame(poll);
      });
    };
    poll();
  });
}

const { width: SCREEN_W } = Dimensions.get("window");
const GAP = 5;
// Capped rather than purely screen-width-derived — on a wide phone the uncapped size (up to
// ~110px/box) made a full grid (head/outer-top-mid/bottom/shoes, sometimes an extras row and an
// accessories row) run 500-650px tall, taller than what's left after the calendar day view's own
// header/nav/REGEN rows — forcing the whole day view to scroll just to see it all. Capping the
// box size keeps the grid compact enough to fit on screen without scrolling for the common case.
export const BOX = Math.min(76, Math.floor((SCREEN_W - 48 - GAP * 2) / 3));
// Larger boxes for the free tier's calendar day view, which has no pros/cons list below the grid
// and so has the room. Bounded by width (3 per row) and by height (a 4-row grid within ~55% of
// the screen), so it never overflows a small phone.
const { height: SCREEN_H } = Dimensions.get("window");
export const BOX_LARGE = Math.min(
  Math.round(BOX * 1.25),
  Math.floor((SCREEN_W - 48 - GAP * 2) / 3),
  Math.floor((SCREEN_H * 0.55 - GAP * 3) / 4),
);

function Box({ g, onMeasured, frameOpacity, hidePieces, size = BOX, loadingDots }: {
  g?: SlotGarment; onMeasured?: (id: string, rect: BoxRect) => void;
  frameOpacity?: Animated.Value | Animated.AnimatedInterpolation<number> | number;
  hidePieces?: boolean;
  size?: number;
  loadingDots?: boolean;
}) {
  const ref = useRef<View>(null);
  return (
    <View
      ref={ref}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      // onLayout fires once this box's own layout has settled; measureBoxRect (see its own
      // comment) gives ABSOLUTE screen coordinates, confirmed stable across two consecutive
      // frames — the same coordinate space as everything else these positions get compared
      // against (day-cell rects, etc.), not relative-to-parent.
      onLayout={g && onMeasured ? () => {
        const target = ref.current;
        if (!target) return;
        measureBoxRect(target).then(rect => { if (rect) onMeasured(g.id, rect); });
      } : undefined}
    >
      {/* The border/background frame is a separate layer from the image so the two can fade
         independently — the calendar's closing transition fades the frame away while keeping
         the actual piece image on screen at full opacity throughout. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.boxFrame, { opacity: frameOpacity ?? 1 }]} />
      {/* cachePolicy/transition=0 — without these, switching to a different day's outfit (prev/
         next in the day view, or a fresh day landed on via search) could re-fetch/re-decode an
         already-cached image and crossfade it in by default, reading as the piece flashing or
         popping in instead of just being there. Same fix already applied to every other Image in
         this app's calendar/gallery stacks. */}
      {g?.image ? <Image source={{ uri: g.image }} style={styles.img} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
      {/* A flat color mask over just the image, not opacity on the frame/wrapper — the calendar's
         month<->day transition needs the FRAME to keep fading in on its own (via frameOpacity)
         while the image underneath stays covered until the animated overlay standing in for it
         hands off. Gating the whole box (frame included) behind one hard, non-animated opacity
         toggle — an earlier version of the calendar screen did exactly that — meant the frame's
         own smooth fade was invisible the entire time (hidden behind the same toggle) and only
         became visible already-fully-faded-in the instant the toggle flipped, popping into
         existence instead of fading like everything else around it — reading as a hard screen
         refresh right as the transition finished. Masking only the image (same technique as
         OutfitsScreen's own stack mask) lets the border fade in for real while the piece stays
         hidden until it's ready to swap in without a visible seam. */}
      {hidePieces && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />}
      {/* The calendar day view's loading state: the real box layout, three dots in each box. */}
      {loadingDots && <LoadingDots />}
    </View>
  );
}

// Read-only version of the website's outfit slot grid (app/calendar/page.tsx): hat centered on
// its own row, outer/top/mid sharing one row (mirroring the desktop's 5-col row 2), then pants
// and shoes each centered on their own row below, with accessories in a wrapped row at the
// bottom. Every slot type always renders a box — even empty — matching the desktop reference
// (S(...) there always draws a box with an EmptyTip when nothing fills it), rather than only
// showing up once something occupies it. No drag/drop here — Builder is where an outfit
// actually gets edited.
export function OutfitSlotGrid({ garments, onBoxMeasured, frameOpacity, hidePieces, boxSize = BOX, loadingDots }: {
  garments: SlotGarment[]; onBoxMeasured?: (id: string, rect: BoxRect) => void;
  frameOpacity?: Animated.Value | Animated.AnimatedInterpolation<number> | number;
  hidePieces?: boolean;
  boxSize?: number;
  loadingDots?: boolean;
}) {
  const heads = garments.filter(g => bucketOf(g) === "head");
  const outers = garments.filter(g => bucketOf(g) === "outer");
  // Sorted so a true base layer (tee, henley) always lands in tops[0] — the base/center slot —
  // rather than whichever top happened to be added first, matching the website's outfit grid.
  const tops = sortTops(garments.filter(g => bucketOf(g) === "top"));
  const mids = garments.filter(g => bucketOf(g) === "mid");
  const bottoms = garments.filter(g => bucketOf(g) === "bottom");
  const shoes = garments.filter(g => bucketOf(g) === "shoes");
  const accs = garments.filter(g => bucketOf(g) === "accessory");

  // A 2nd top (e.g. a base tee plus a longsleeve shirt worn over it) or 2nd outer layer fills
  // the main row's own MID slot when nothing else needs it, instead of pushing an entire extra
  // row below the main one — that box is already sitting right there empty. Only genuinely
  // overflows to a separate row when there's more than one extra piece at once (2nd top AND 2nd
  // outer together, or a real mid-layer garment already claims the slot) — a rare case, unlike
  // the common "base tee under a shirt" one this was actually landing in an unnecessary extra
  // row for, which also ate into the space left for the pros/cons text below the whole grid.
  let midFiller = mids[0];
  let topsOverflowStart = 1;
  let outersOverflowStart = 1;
  if (!midFiller && tops[1]) {
    midFiller = tops[1];
    topsOverflowStart = 2;
  } else if (!midFiller && outers[1]) {
    midFiller = outers[1];
    outersOverflowStart = 2;
  }
  const overflow = [...outers.slice(outersOverflowStart), ...tops.slice(topsOverflowStart)];

  return (
    <View style={{ alignItems: "center", gap: GAP }}>
      {/* Every Box is keyed by its garment id (falling back to a stable per-slot label when
         empty), even the fixed single-slot ones below that aren't in a .map() — without a key
         tied to WHICH garment is showing, switching to a different day whose outfit happens to
         have the same slot shape (very common: two "top+bottom+shoes" days) updates these boxes
         in place rather than mounting fresh ones. onLayout only fires on an actual geometry
         change, not a prop change, so a same-shape update would never re-fire it — leaving any
         onBoxMeasured caller (see CalendarScreen's day<->month transition) with a stale rect
         under the OLD garment's id and no rect at all for the new one. Keying by id forces a
         real remount, which always fires onLayout at least once, whenever the shown garment
         actually changes. */}
      <Box key={heads[0]?.id ?? "head"} g={heads[0]} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />
      <View style={{ flexDirection: "row", gap: GAP }}>
        <Box key={outers[0]?.id ?? "outer"} g={outers[0]} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />
        <Box key={tops[0]?.id ?? "top"} g={tops[0]} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />
        <Box key={midFiller?.id ?? "mid"} g={midFiller} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />
      </View>
      {overflow.length > 0 && (
        <View style={{ flexDirection: "row", gap: GAP, flexWrap: "wrap", justifyContent: "center" }}>
          {overflow.map(g => <Box key={g.id} g={g} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />)}
        </View>
      )}
      <Box key={bottoms[0]?.id ?? "bottom"} g={bottoms[0]} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />
      <Box key={shoes[0]?.id ?? "shoes"} g={shoes[0]} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />
      {accs.length > 0 && (
        <View style={{ flexDirection: "row", gap: GAP, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
          {accs.map(g => <Box key={g.id} g={g} onMeasured={onBoxMeasured} frameOpacity={frameOpacity} hidePieces={hidePieces} size={boxSize} loadingDots={loadingDots} />)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  boxFrame: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  img: { width: "80%", height: "80%" },
});
