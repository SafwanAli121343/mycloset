import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Easing, Modal, Dimensions, unstable_batchedUpdates, Share } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { apiJson, apiJsonCached } from "../lib/api";
import { getCached, setCached } from "../lib/dataCache";

// TEMPORARY diagnostic logger for the closing-transition timing investigation. console.log
// does NOT reliably reach the iOS system log in this dev-client setup (it routes to Metro's
// own remote-console connection instead, which isn't something this tool session can read) —
// confirmed by testing: three separate live runs, zero of the console.log calls below ever
// showed up via `xcrun simctl log show`, even filtering directly for their own literal text.
// AsyncStorage, by contrast, persists to a plain manifest.json file inside the app's own
// container on disk — directly readable from outside the app entirely, sidestepping whatever
// is swallowing console output. Every call appends (never overwrites) so multiple transitions
// across multiple test runs all land in one ordered timeline. Remove once the real slow phase
// is identified and fixed.
const calTimingLog: { label: string; t: number; at: string }[] = [];
function logCalTiming(label: string, t: number) {
  calTimingLog.push({ label, t, at: new Date().toISOString() });
  setCached("__caltiming_log__", calTimingLog);
}
import { TextButton } from "../components/TextButton";
import { LoadingDots } from "../components/LoadingDots";
import { LoadingMessages } from "../components/LoadingMessages";
import { OutfitSlotGrid, BOX as DAY_BOX, type BoxRect } from "../components/OutfitSlotGrid";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import { bucketOf, type SlotGarment } from "../lib/garmentSlots";
import type { MainTabParamList } from "../navigation/MainTabs";

type Garment = SlotGarment & { title: string; brand: string | null };
type OutfitDay = { id: string; notes: string | null; garments: Garment[]; customized?: boolean };
type OutfitMap = Record<string, OutfitDay>;
type Notes = { score: number | null; pros: string[]; cons: string[]; aesthetic: string | null; analyzed: boolean };
type DayWeather = { tempF: number; label: string; condition: string };
type Rect = { x: number; y: number; width: number; height: number };

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
// Real, fixed size of a piece image inside a month cell's mini-stack (styles.cellStackImg) — the
// shrink animation's final content size needs to match this exactly, not a fraction of the
// measured cellStack BOX (26x20, styles.cellStack), which has a different aspect ratio than the
// square images inside it and was making the shrunk overlay land visibly smaller than the real
// thing it hands off to.
const MONTH_CELL_IMG = 18;
// A real day-view box's own content size (OutfitSlotGrid's styles.img is 80% of its fixed,
// uniform DAY_BOX square) — used to pre-size pieces to their eventual distribute size DURING the
// resize phase, before any of them start moving to their own separate positions.
const DAY_BOX_CONTENT = DAY_BOX * 0.8;

function measureRect(target: View | null): Promise<Rect | null> {
  return new Promise(resolve => {
    if (!target) { resolve(null); return; }
    target.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

// Same stability check measureDestinationCell already uses (see its own comment): a view whose
// layout just changed — which describes the tapped month cell the instant this runs, since
// openDaySpread's own useEffect fires right after a commit that just reconciled the whole grid —
// can report a stale/transient position for a frame or two before native layout truly settles.
// Trusting a single measureRect reading here (an earlier version of this file did exactly that)
// is a real, concrete mechanism for the grow animation starting from the wrong spot — visible as
// a stray fragment landing away from where the real stack actually is — most likely on a box's
// FIRST-ever measurement this session, before anything has had a chance to settle once already.
// Requiring the SAME rect on two consecutive frames makes a transient reading self-correct
// silently instead of being handed off as this cell's real origin.
async function measureRectStable(target: View | null): Promise<Rect | null> {
  let lastRect: Rect | null = null;
  const deadline = Date.now() + 400;
  while (Date.now() < deadline) {
    const rect = await measureRect(target);
    if (rect && lastRect && rect.x === lastRect.x && rect.y === lastRect.y && rect.width === lastRect.width && rect.height === lastRect.height) {
      return rect;
    }
    lastRect = rect;
    await new Promise<void>(res => requestAnimationFrame(() => res()));
  }
  return lastRect;
}

// Same "smaller items on top" convention used elsewhere this session (Outfits screen's own
// card stacks): accessories/shoes render highest, bottoms lowest.
function stackRank(g: SlotGarment): number {
  const b = bucketOf(g);
  return b === "accessory" || b === "head" ? 0 : b === "shoes" ? 1 : b === "outer" ? 3 : b === "bottom" ? 4 : 2;
}

const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const DAY_LABELS = ["S","M","T","W","T","F","S"];
const WEEKDAY = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];

function conditionShort(condition: string): string {
  if (condition === "snow") return "Snow";
  if (condition === "rain") return "Rain";
  if (condition === "cloudy") return "Cloudy";
  if (condition === "partly cloudy") return "Partly";
  return "";
}
function tempCat(f: number): string {
  if (f >= 86) return "HOT";
  if (f >= 72) return "WARM";
  if (f >= 60) return "MILD";
  if (f >= 46) return "COOL";
  if (f >= 32) return "COLD";
  return "FREEZING";
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateStr(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }
function parseDateStr(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function shiftDay(s: string, delta: number): string {
  const { y, m, d } = parseDateStr(s);
  const dt = new Date(y, m - 1, d + delta);
  return toDateStr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}
function parseNotes(notes: string | null): Notes {
  try {
    const p = JSON.parse(notes ?? "{}");
    return {
      score: typeof p.styleScore === "number" ? p.styleScore : null,
      pros: Array.isArray(p.pros) ? p.pros : [],
      cons: Array.isArray(p.cons) ? p.cons : [],
      aesthetic: typeof p.aesthetic === "string" ? p.aesthetic : null,
      // "analyzed" means the notes JSON actually has pros/cons keys present, not merely that
      // score is populated — matches the website's exact check, so a generated-but-not-yet-
      // analyzed day reads as "no analysis yet" rather than silently showing a stale/zero score.
      analyzed: "pros" in p || "cons" in p,
    };
  } catch {
    return { score: null, pros: [], cons: [], aesthetic: null, analyzed: false };
  }
}
function getCells(year: number, month: number) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: { day: number; current: boolean }[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: 0, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, current: true });
  return cells;
}

function getTodayStr() {
  const t = new Date();
  return toDateStr(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

// ── Converge overlay — step 2 of the calendar transition ────────────────────────────────────
// Runs AFTER the chrome/frame fade (see openDaySpread/startClosingTransition) has already
// finished, once the tapped pieces are the only thing left on screen. Animates every garment
// from its own real, measured origin rect to ONE shared, overlapping stack at `target` — exactly
// the same "gather" shape as the Outfits screen's own stack-open animation, just always landing
// centered rather than at a further destination (there's no distribute-to-boxes step yet).
// For the month->day direction every garment shares the SAME origin (the tiny month-cell stack
// rect) since there's nothing else to measure per-piece there; for day->month each garment has
// its own real box rect.
// Generalized over which end is "shared" and which is "per-garment" — a plain Rect for either
// origins or targets means every garment uses that SAME rect (the month-cell-stack case, or the
// center-stack case); a Map means each garment has its OWN rect (real day-view box positions).
// This one component now covers all four phases: gather (many day-boxes -> one center),
// grow (one tiny month-cell origin -> one bigger center), distribute (one center -> many
// day-view box positions), and shrink (one center -> one destination month cell).
function resolveRect(spec: Map<string, Rect> | Rect, id: string): Rect | undefined {
  return spec instanceof Map ? spec.get(id) : spec;
}
function ConvergeOverlay({ garments, origins, targets, progress, targetContentFraction = 0.6, targetContentSize, originContentSize, opacity = 1, fanIndexOffset = false }: {
  garments: Garment[];
  origins: Map<string, Rect> | Rect;
  targets: Map<string, Rect> | Rect;
  progress: Animated.Value;
  targetContentFraction?: number;
  // Lets a phase fade the WHOLE overlay in/out (e.g. the frozen post-distribute tail fading in
  // alongside dayChromeOpacity) without touching the per-piece position/scale math above — kept
  // as a separate prop rather than baked into progress so it never interacts with the
  // grow/resize/distribute motion itself, only whatever sits on top of that motion once it's done.
  opacity?: Animated.Value | Animated.AnimatedInterpolation<number> | number;
  // Fixed WxH to land at, overriding targetContentFraction — for a destination whose real
  // content size isn't a fraction of the measured box (e.g. a month cell's mini-stack image,
  // which is a fixed 18x18 square regardless of the box's own, differently-proportioned size).
  targetContentSize?: { width: number; height: number };
  // Same idea as targetContentSize but for the STARTING size — lets a phase pick up exactly
  // where a PRIOR phase's own targetContentSize left off (e.g. the resize-in-place step handing
  // off to the position-only move that follows it), so scale computes to a constant 1 throughout
  // instead of silently changing size again during a movement that's meant to be size-neutral.
  originContentSize?: { width: number; height: number };
  // Replicates the real month cell's own per-piece translateX:j/translateY:-j fan offset (see
  // cellStackImg) — the real cell staggers each piece by a couple of pixels instead of stacking
  // them in one exact pile. The overlay never did this: every piece here shares one target
  // center point, landing perfectly overlapping with zero offset. Small (1-2px), but real — the
  // instant the frozen overlay hands off to the real cell, whichever piece sits further back
  // visibly shifts to pick up an offset it never had during the animation. Only meaningful for a
  // phase actually landing in the month cell (the shrink phase), not gather/resize.
  fanIndexOffset?: boolean;
}) {
  const sorted = useMemo(() => [...garments].sort((a, b) => stackRank(a) - stackRank(b)), [garments]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      {sorted.map((g, i) => {
        const origin = resolveRect(origins, g.id);
        const target = resolveRect(targets, g.id);
        if (!origin || !target || !g.image) return null;
        const originCenterX = origin.x + origin.width / 2;
        const originCenterY = origin.y + origin.height / 2;
        const originSize = originContentSize ? Math.min(originContentSize.width, originContentSize.height) : Math.min(origin.width, origin.height) * 0.8;
        const targetCenterX = target.x + target.width / 2;
        const targetCenterY = target.y + target.height / 2;
        const contentW = targetContentSize ? targetContentSize.width : target.width * targetContentFraction;
        const contentH = targetContentSize ? targetContentSize.height : target.height * targetContentFraction;
        const tx = progress.interpolate({ inputRange: [0, 1], outputRange: [originCenterX - targetCenterX, 0] });
        const ty = progress.interpolate({ inputRange: [0, 1], outputRange: [originCenterY - targetCenterY, 0] });
        const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [originSize / Math.min(contentW, contentH), 1] });
        return (
          <Animated.View
            key={g.id}
            style={{
              // zIndex: sorted.length - i, matching the SAME "smaller items on top" convention
              // established (and verified working) in OutfitsScreen's own stack render
              // (outfitItems.length - i there) — low-stackRank pieces (accessories/shoes) get the
              // HIGHEST zIndex, bottoms/outer get the lowest, since sorted is ascending by
              // stackRank. A previous version of this file used a bare `zIndex: i` here — the
              // opposite direction — reasoning that it should match the month cell's own mini-stack
              // (whose `zIndex: j` was ALSO backwards relative to this same convention). That made
              // the two agree with each other, but both wrong the same way: pants/outer pieces
              // rendered frontmost instead of buried, confirmed directly in a screen recording
              // (the gathered pile's unoccluded, most-visible piece was the pants, with the jacket
              // and boots barely peeking out at the edges — backwards from the intended "small
              // items sit on top of the pile" look). Fixed at the source instead: both this and the
              // month cell's own zIndex now use the correct length-minus-index direction, so they
              // stay consistent with each other AND with the one already-correct reference
              // implementation.
              position: "absolute", left: targetCenterX - contentW / 2, top: targetCenterY - contentH / 2,
              width: contentW, height: contentH, zIndex: sorted.length - i,
              // The fan offset is added as a SEPARATE, constant transform entry rather than
              // folded into tx/ty's own interpolation — tx/ty go to exactly 0 at progress=1
              // (this piece's target IS its origin-relative center by construction), so adding a
              // flat, non-interpolated i/-i here lands at exactly the same final pixel the real
              // cell's own transform: [{translateX:j},{translateY:-j}] does, with no risk of
              // fighting the progress-driven animation itself.
              transform: fanIndexOffset
                ? [{ translateX: tx }, { translateY: ty }, { scale }, { translateX: i }, { translateY: -i }]
                : [{ translateX: tx }, { translateY: ty }, { scale }],
            }}
          >
            <Image source={{ uri: g.image }} style={{ width: "100%", height: "100%" }} contentFit="contain" cachePolicy="memory-disk" transition={0} />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}
function centerRect(target: { x: number; y: number; size: number }): Rect {
  return { x: target.x - target.size / 2, y: target.y - target.size / 2, width: target.size, height: target.size };
}

// ── Day view header: nav row + REGEN/EDIT ────────────────────────────────────────────────────
function DayHeader({
  focusDate, focusOutfit, notes, weather, generating, onRegenClick, onEdit, onPrev, onNext, chromeOpacity,
}: {
  focusDate: string; focusOutfit: OutfitDay | undefined; notes: Notes; weather: Record<string, DayWeather>;
  generating: boolean; onRegenClick: () => void; onEdit: () => void;
  onPrev: () => void; onNext: () => void;
  chromeOpacity: Animated.Value | Animated.AnimatedInterpolation<number> | number;
}) {
  const { y: fy, m: fm, d: fd } = parseDateStr(focusDate);
  const focusWeekday = new Date(fy, fm - 1, fd).getDay();
  return (
    <Animated.View style={{ opacity: chromeOpacity }}>
      {/* Weekday and date combined onto one line (was two: a WEEKDAY label above a separate
         MONTH DAY title) — same information, one less text line's worth of height, keeping the
         same centered-date-with-chevrons shape. */}
      <View style={[styles.dayNav, { marginTop: spacing.xs }]}>
        <TouchableOpacity onPress={onPrev} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ alignItems: "center", gap: 2 }}>
          <Text style={type.title}>{WEEKDAY[focusWeekday].slice(0, 3)}, {MONTHS[fm - 1].slice(0, 3)} {fd}</Text>
          {weather[focusDate] && (
            <Text style={{ fontSize: 10, color: colors.textFaint }}>
              {weather[focusDate].tempF}°F · {tempCat(weather[focusDate].tempF)}
              {conditionShort(weather[focusDate].condition) ? ` · ${conditionShort(weather[focusDate].condition)}` : ""}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={onNext} hitSlop={10}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
      {/* REGEN/EDIT/score in a true 3-column grid (equal flex:1 columns) instead of
         justifyContent:"space-between" — with "space-between", the center column's position
         is a function of the two side labels' own widths (REGEN vs EDIT are different lengths),
         so the score visibly leaned toward whichever side had the narrower label. Equal-width
         flex columns keep the center one exactly centered regardless of label length. Padding
         nudges REGEN/EDIT inward from the edges (not further apart) per explicit request. */}
      <View style={{ flexDirection: "row", alignItems: "center", width: "100%", paddingHorizontal: spacing.xl + spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <TextButton label="REGEN" size={10} color={colors.gold} onPress={onRegenClick} disabled={generating} loading={generating} />
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          {notes.analyzed && notes.score != null && notes.score > 0 && (
            <Text style={{ fontSize: 26, fontWeight: "700", color: scoreColor(notes.score) }}>{notes.score}</Text>
          )}
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          {focusOutfit && focusOutfit.garments.length > 0 && (
            <TextButton label="EDIT" size={10} color={colors.textMuted} onPress={onEdit} />
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// No outer scroll — the day view should show everything (nav, buttons, grid, accessories link)
// without needing to scroll down to reach it. OutfitSlotGrid's box size is capped compact enough
// (see OutfitSlotGrid.tsx) that the grid plus everything else here fits in the remaining space
// for the common case. Only the pros/cons list below still scrolls, in its own fixed-height,
// self-contained panel — that's the kind of "block of text you scroll through" that's fine to
// keep scrollable, not the whole screen.
//
// chromeOpacity fades the accessories-button/notes area AND (via frameOpacity, passed through to
// OutfitSlotGrid) each box's border/background frame — but NOT the piece images themselves,
// which stay at full opacity throughout the fade. Once that fade completes, ConvergeOverlay takes
// over animating the pieces toward a center stack — at that exact instant piecesHidden switches
// the real grid's images off (they've already been measured via onBoxMeasured by then), so the
// overlay's floating copies take over from the identical on-screen spot with no visible seam.
function DayOutfit({ notes, garments, chromeOpacity, onBoxMeasured, piecesHidden }: {
  notes: Notes; garments: Garment[];
  chromeOpacity: Animated.Value | Animated.AnimatedInterpolation<number> | number;
  onBoxMeasured?: (id: string, rect: BoxRect) => void;
  piecesHidden?: boolean;
}) {
  const [showAccs, setShowAccs] = useState(false);
  const accs = garments.filter(g => bucketOf(g) === "accessory");
  const nonAccGarments = garments.filter(g => bucketOf(g) !== "accessory");
  const focusItems: FocusItem[] = [
    ...(notes.aesthetic ? [{ text: notes.aesthetic.toUpperCase(), color: colors.textFaint, header: true }] : []),
    ...notes.pros.map(t => ({ text: t, color: colors.good })),
    ...notes.cons.map(t => ({ text: t, color: colors.bad })),
  ];
  return (
    // flex:1 belongs HERE, not on the parent's justifyContent — the grid should stay anchored
    // right where it naturally sits (directly below DayHeader, no gap), and only the leftover
    // space BELOW it (where the pros/cons text lives) should center its own content. Giving this
    // whole block flex:1 fills the real available height; giving ONLY the text wrapper below
    // flex:1 + justifyContent:"center" (not this outer view) means the grid keeps its natural
    // top-anchored position while the text centers in whatever's actually left underneath it —
    // centering the OUTER block as one unit (an earlier version of this fix) moved the grid down
    // too, opening a new gap between the header and the grid that was never asked for.
    <View style={{ flex: 1, width: "100%", alignItems: "center" }}>
      {/* No opacity here — piecesHidden used to gate this whole wrapper (frame AND image) behind
         one hard, non-animated toggle. That hid the box FRAME too, so its own chromeOpacity fade
         ran its full course while invisible and only became visible already-at-full-opacity the
         instant the toggle flipped — the frame (and the grid as a whole) popped into existence
         instead of fading in like the header/notes around it. hidePieces (passed to
         OutfitSlotGrid below) now masks only the piece IMAGES, so the frame's own fade is real
         and visible the whole time. */}
      <View style={{ width: "100%", alignItems: "center", marginTop: spacing.sm }}>
        <OutfitSlotGrid garments={nonAccGarments} frameOpacity={chromeOpacity} onBoxMeasured={onBoxMeasured} hidePieces={piecesHidden} />
      </View>

      {/* paddingBottom biases the centered content up slightly off dead-center — a small,
         deliberate nudge per explicit feedback that exact center read as very slightly too low. */}
      <Animated.View style={{ flex: 1, alignItems: "center", justifyContent: "center", width: "100%", opacity: chromeOpacity, paddingBottom: 20 }}>
        {accs.length > 0 && (
          <TextButton label="SHOW ACCESSORIES" size={10} color={colors.textMuted} onPress={() => setShowAccs(true)} style={{ marginTop: spacing.sm }} />
        )}
        {!notes.analyzed && (
          <Text style={[type.body, { color: colors.textFaint, marginTop: spacing.md }]}>No analysis yet for this outfit.</Text>
        )}
        {focusItems.length > 0 && (
          <View style={{ height: 195, width: "100%", marginTop: spacing.md }}>
            <FocusScrollList items={focusItems} focal={0.5} />
          </View>
        )}
      </Animated.View>

      {/* Accessories popup — same bottom-sheet style as Builder's InventorySheet */}
      <Modal visible={showAccs} transparent animationType="slide" onRequestClose={() => setShowAccs(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowAccs(false)} />
          <View style={{ backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg, paddingBottom: spacing.xl }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
              <Text style={type.label}>ACCESSORIES</Text>
              <TouchableOpacity onPress={() => setShowAccs(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                {accs.map(g => (
                  <View key={g.id} style={{ width: 80, height: 80, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
                    {g.image ? <Image source={{ uri: g.image }} style={{ width: "80%", height: "80%" }} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Month view body: header + grid of day cells ──────────────────────────────────────────────
// Current opening behavior: tapping a day with an outfit fades out everything BUT that day's own
// stack (monthChromeOpacity + revealDate — every OTHER cell's stack fades with the rest, that one
// cell's stays pinned to full opacity). Once that fade completes, the tapped cell's rect (via
// dayStackRefs) gets measured and GrowOverlay takes over animating toward a bigger, centered
// stack — at that exact instant growHiddenDate switches the real cell's stack off, so the
// overlay's floating copies take over from the identical on-screen spot with no visible seam.
const MonthBody = memo(function MonthBody({
  year, month, cells, outfits, weather, todayStr, generating, onRegenClick,
  onPrevMonth, onNextMonth, onOpenDay, onSelectDay, monthChromeOpacity, revealDate, growHiddenDate, closingHiddenDate, dayStackRefs,
  monthBlockTranslateY, monthOpacity, onBlockLayout, onAreaLayout, loading,
}: {
  year: number; month: number; cells: { day: number; current: boolean }[];
  outfits: OutfitMap; weather: Record<string, DayWeather>; todayStr: string;
  generating: boolean; onRegenClick: () => void;
  onPrevMonth: () => void; onNextMonth: () => void;
  onOpenDay: (ds: string) => void; onSelectDay: (ds: string) => void;
  monthChromeOpacity: Animated.Value | Animated.AnimatedInterpolation<number> | number;
  revealDate: string | null;
  growHiddenDate: string | null;
  // The day->month counterpart to growHiddenDate — see its own cell-render comment for why this
  // needs to exist at all: without it, the destination cell's image is gated by monthChromeOpacity
  // (unlike the day view's own images, which are NEVER gated by dayChromeOpacity), which is what
  // forced the closing transition to keep its overlay frozen for the whole chrome fade instead of
  // swapping atomically the way the opening transition already does.
  closingHiddenDate: string | null;
  dayStackRefs: React.RefObject<Record<string, View | null>>;
  monthBlockTranslateY: Animated.Value | Animated.AnimatedInterpolation<number> | number;
  monthOpacity: number;
  onBlockLayout?: (e: { nativeEvent: { layout: { height: number } } }) => void;
  onAreaLayout?: (e: { nativeEvent: { layout: { height: number } } }) => void;
  loading: boolean;
}) {
  // Measured, not estimated: the clip below used to compute its own height from a static
  // formula (screen width minus assumed padding, divided into 7 assumed-equal columns) — a
  // real per-row height that never actually matched whatever this exact clip is cutting through
  // would explain persistent, unexplained bleed no amount of formula-checking ever turned up.
  // Measuring this wrapper's OWN real rendered width removes the guesswork: cellSize is computed
  // from the actual pixels this row has to work with, not an assumption about what they should
  // be.
  const [gridW, setGridW] = useState(SCREEN_W - spacing.sm * 2);
  // collapsable={false} below is load-bearing, not decoration — a bare flex:1 View with no other
  // visual style is exactly the kind of wrapper React Native is allowed to flatten out of the
  // native view hierarchy entirely (a performance optimization). Once flattened, there's no real
  // native view left to ever dispatch onLayout from — confirmed directly via logCalTiming's state
  // dump: monthBlockH (the child below, which has real visual content and was never flattened)
  // reliably measured 319, while monthAreaH (this exact view) stayed 0 for the entire session,
  // every single time, from the very first frame onward. monthMeasured requires BOTH to be
  // positive before the whole month block is allowed to become visible — so this one silently-
  // never-firing measurement was permanently hiding a transition that had otherwise completed
  // correctly, which is why every fix aimed at the transition's own timing logic changed nothing:
  // the actual bug was never in the animation sequence at all.
  return (
    <View style={{ flex: 1 }} onLayout={onAreaLayout} collapsable={false}>
      <Animated.View onLayout={onBlockLayout} style={{ opacity: monthOpacity, transform: [{ translateY: monthBlockTranslateY }] }}>
        <Animated.View style={{ opacity: monthChromeOpacity }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onPrevMonth}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </TouchableOpacity>
            <Text style={type.title}>{MONTHS[month - 1]} {year}</Text>
            <TouchableOpacity onPress={onNextMonth}>
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
          <TextButton label="REGEN" size={10} color={colors.gold} onPress={onRegenClick} disabled={generating} loading={generating} style={{ alignSelf: "center", marginTop: spacing.xs }} />

          <View style={styles.dayLabels}>
            {DAY_LABELS.map((d, i) => <Text key={i} style={styles.dayLabel}>{d}</Text>)}
          </View>

        {!loading && (
          // Hard clip to exactly the real number of rows this month needs — a brute-force
          // backstop regardless of cause: getCells/cells.map only ever produce real day/blank
          // cells for the actual month (verified correct — daysInMonth via `new Date(year,
          // month, 0).getDate()` is exact, no off-by-one), so nothing legitimate should ever
          // render below this height. If anything else ever does (a stuck overlay, a stray
          // absolutely-positioned leftover), overflow:hidden guarantees it's invisible rather
          // than relying on tracking down every possible source of it.
          <View
            // gridW is the WRAPPER's own measured width — the same border-box width
            // styles.grid itself has, since it just stretches to fill this wrapper. It does
            // NOT have styles.grid's own paddingHorizontal:spacing.sm subtracted out yet, which
            // is exactly the mistake the previous version of this made: using the raw measured
            // width (bigger than the real per-cell content width) made cellSize an OVERESTIMATE,
            // which made 5-rows-worth of clip height taller than 5 real rows actually are —
            // tall enough to expose a slice of whatever sits just past them again. Subtracting
            // the same padding styles.grid itself subtracts (spacing.sm on each side) restores
            // the tight, correct-sized clip.
            style={{ height: Math.ceil(cells.length / 7) * ((gridW - spacing.sm * 2) / 7), overflow: "hidden" }}
            onLayout={e => setGridW(e.nativeEvent.layout.width)}
            // Same bare-style profile (no background/border, just height+overflow) as the
            // onAreaLayout view that turned out to be silently flattened out of the native view
            // hierarchy — see its own comment for the confirmed mechanism. Applying the same
            // guard here defensively: if THIS view were ever flattened too, gridW would stay
            // stuck at its initial estimate instead of correcting to the real measured width,
            // which would show up as cell sizes visibly shifting whenever (if ever) a late
            // measurement did land — exactly the kind of "content still settling" look a clean
            // opacity fade shouldn't have.
            collapsable={false}
          >
          <View style={styles.grid}>
            {cells.map((cell, i) => {
              // Keyed by the actual date (or a month-scoped blank slot), not the bare positional
              // index i — a positional key means React treats "the 5th grid cell" as the same
              // persistent thing across ANY month change where a cell at that position happens to
              // stay the same TYPE (blank->blank, or a real day->a different real day), reusing
              // the underlying native view and only patching its props rather than remounting it.
              // That's the correct, desired behavior for a genuinely unchanged cell, but it means
              // any lingering rendering state tied to the OLD occupant of that slot is only ever
              // "supposed to" get overwritten by the new props, not guaranteed to. Keying by the
              // real date makes every distinct day (and every distinct month's leading blanks) a
              // genuinely distinct React identity, forcing a real mount/unmount whenever the
              // ACTUAL date changes instead of trusting an in-place prop update to fully replace
              // everything — the same fix already applied to OutfitSlotGrid's own boxes for
              // exactly this class of stale-content-on-reuse bug.
              if (!cell.current) return <View key={`blank-${year}-${month}-${i}`} style={styles.cell} />;
              const ds = toDateStr(year, month, cell.day);
              const outfit = outfits[ds];
              const isToday = ds === todayStr;
              // Sorted by the SAME stackRank the grow/shrink ConvergeOverlay uses for its own
              // z-order (see openDaySpread/startClosingTransition) — this array's order directly
              // controls each image's zIndex (j) below. Left unsorted, the overlay's frozen final
              // frame (stackRank order) and this real cell (natural/unsorted garment order) could
              // stack their pieces in a DIFFERENT front-to-back arrangement, so the instant the
              // overlay handed off to this real cell the pile visibly "reoriented" itself.
              const stackPieces = outfit ? [...outfit.garments].filter(g => g.image).sort((a, b) => stackRank(a) - stackRank(b)).slice(0, 3) : [];
              const w = weather[ds];
              // Everything about a cell fades with the rest of the month EXCEPT the one
              // revealDate cell's own stack, which stays pinned at full opacity while literally
              // everything else (including that same cell's day-number/temp) fades away — until
              // growHiddenDate flips to that same date, at which point GrowOverlay has taken over
              // and this real stack must disappear so the two don't render on top of each other.
              // isSpecialCell cells render a plain View with a literal opacity number, NEVER
              // Animated.View bound to monthChromeOpacity — a style prop that's bound to an
              // Animated node on some renders and a flat literal on others is exactly the pattern
              // that left the real stack still visible ("a copy") while the overlay animated away
              // from it: React Native's native-driven Animated bridge doesn't reliably tear down
              // its own binding just because a later render's JS value looks like a plain number.
              // Keeping this one cell permanently OFF that binding avoids the whole class of bug.
              // closingHiddenDate is this same treatment for the OPPOSITE (day->month) direction:
              // masked (specialOpacity 0) for as long as the closing overlay is doing its own
              // gather/resize/shrink motion above it, then unmasked in the exact same batch the
              // overlay clears — an atomic swap, matching openDaySpread's own handoff exactly,
              // which only works because this image is excluded from monthChromeOpacity's fade.
              const isSpecialCell = revealDate === ds || growHiddenDate === ds || closingHiddenDate === ds;
              const specialOpacity = (growHiddenDate === ds || closingHiddenDate === ds) ? 0 : 1;
              return (
                <TouchableOpacity
                  key={ds}
                  style={styles.cell}
                  // activeOpacity=1 disables TouchableOpacity's own default press-dim — this
                  // cell's visibility is already fully and deliberately driven by
                  // monthChromeOpacity/stackOpacity above, and that separate, automatic dimming
                  // effect was compounding with them in a way that read as the tapped stack
                  // "staying lit up" well after the actual tap/touch had ended.
                  activeOpacity={1}
                  // A day with an actual outfit opens the full gather/distribute animation; a
                  // day with nothing planned has no stack to animate, so it keeps the existing
                  // lightweight "select day, show detail panel below" behavior.
                  onPress={() => (stackPieces.length > 0 ? onOpenDay(ds) : onSelectDay(ds))}
                >
                  <View style={{ alignItems: "center", gap: 4 }}>
                    {/* Plain View, no per-cell opacity binding — inherits monthChromeOpacity's
                       fade naturally via normal compositing now that the grid lives inside the
                       same Animated.View as the header (see MonthBody's own top-level return).
                       Was its own individual Animated.View bound to monthChromeOpacity, one of
                       up to ~60 separate native animated bindings (two per cell, times ~30 cells)
                       all needing configuration at the exact same instant the fade started — a
                       real, quantifiable performance asymmetry against the day view, which has
                       far fewer Animated.View instances for its own equivalent fade. */}
                    <View style={{ alignItems: "center", gap: 4 }}>
                      <View style={styles.dayNum}>
                        <Text style={[styles.dayNumText, isToday && styles.dayNumTextToday]}>{cell.day}</Text>
                      </View>
                      {w && <Text style={styles.cellTemp}>{w.tempF}°</Text>}
                    </View>
                    {/* A small stack of the day's actual pieces (mirrors the Outfits grid's card
                       stacks) instead of a plain dot. */}
                    {stackPieces.length > 0 && (
                      isSpecialCell ? (
                        <View ref={r => { dayStackRefs.current[ds] = r; }} style={styles.cellStack}>
                          {stackPieces.map((g, j) => (
                            <Image
                              key={g.id}
                              source={{ uri: g.image! }}
                              // zIndex: stackPieces.length - j — small items (accessories/shoes,
                              // lowest stackRank, lowest j since stackPieces is ascending-sorted)
                              // sit frontmost, matching OutfitsScreen's own stack (and this same
                              // file's ConvergeOverlay, fixed the same way — see its comment).
                              style={[styles.cellStackImg, { transform: [{ translateX: j }, { translateY: -j }], zIndex: stackPieces.length - j }]}
                              contentFit="contain"
                              cachePolicy="memory-disk"
                              transition={0}
                            />
                          ))}
                          {/* A flat color mask, not opacity on the images themselves — exactly
                             OutfitsScreen's own OutfitCard technique (see its comment there):
                             toggling opacity on the Image views directly risks a native
                             recomposite the instant they reappear, reading as the stack
                             "refreshing" right when the overlay hands off back to this real
                             cell. zIndex is required, not decorative, once any sibling image
                             carries its own explicit zIndex. */}
                          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: specialOpacity === 0 ? 1 : 0, zIndex: 1000 }]} />
                        </View>
                      ) : (
                        <View ref={r => { dayStackRefs.current[ds] = r; }} style={styles.cellStack}>
                          {stackPieces.map((g, j) => (
                            <Image
                              key={g.id}
                              source={{ uri: g.image! }}
                              style={[styles.cellStackImg, { transform: [{ translateX: j }, { translateY: -j }], zIndex: stackPieces.length - j }]}
                              contentFit="contain"
                              cachePolicy="memory-disk"
                              transition={0}
                            />
                          ))}
                        </View>
                      )
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          </View>
        )}
        </Animated.View>
      </Animated.View>
      {/* Rendered as its own sibling, entirely OUTSIDE the header+grid block's own
         monthBlockTranslateY transform, not nested inside it (an earlier version was) — that
         transform's offset is computed from monthBlockH, which is only ever measured once real
         grid content exists (the hidden probe mount that does the pre-measuring is explicitly
         gated on !loading). On the very first-ever visit to month view, before that measurement
         has happened even once, monthBlockH is still its initial 0 — computing an offset as if
         the block were far shorter than it will actually be, which shoves the header+loading
         content down by up to 30% of the whole available area for no reason tied to what's
         actually on screen. Centering this directly within the full monthAreaH region, with no
         dependency on the grid's own measured height at all, means the loading state always
         lands in the true visual center regardless of whether a measurement has landed yet. */}
      {loading && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, opacity: monthChromeOpacity }}>
            <LoadingDots />
            <LoadingMessages />
          </Animated.View>
        </View>
      )}
    </View>
  );
});

export default function CalendarScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Calendar">>();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<"day" | "month">("day");
  const todayStr = getTodayStr();
  const todayDate = new Date();
  const [focusDate, setFocusDate] = useState(todayStr);
  const [year, setYear] = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth() + 1);
  const [outfits, setOutfits] = useState<OutfitMap>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [weather, setWeather] = useState<Record<string, DayWeather>>({});
  // Separate from `loading` (which only tracks the /api/outfits fetch) on purpose — weather text
  // (tempF/condition next to each day) was popping in visibly AFTER the loading dots had already
  // disappeared and the real boxes were showing, because nothing gated the dots on the weather
  // fetch too. Reset to false at the START of each weather fetch (not just left true from a
  // previous month) so switching months re-shows the dots until the NEW month's weather is
  // actually in, rather than briefly showing empty/mismatched weather text for the new dates.
  const [weatherReady, setWeatherReady] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  // `loading`/`weatherReady` both intentionally reset on EVERY fetch, including a silent
  // background refresh of a month whose data is already sitting on screen (apiJsonCached's own
  // 5-minute TTL, or simply re-fetching once a cached entry ages out) — necessary so switching to
  // a genuinely new month still shows the loading dots. But that same reset also fires the exact
  // instant a day->month transition happens to land while one of those background refreshes is
  // in flight, which swaps MonthBody's already-correct, already-visible grid out for a spinner
  // and back again the moment the refresh settles — a real, visible "snap" instead of the
  // intended smooth monthChromeOpacity fade, confirmed directly from a screen recording. These
  // two sets track which (year, month) keys have ever loaded successfully at least once; once a
  // month's real content has been shown, a later background refresh of that SAME month no longer
  // gets to hide it behind a spinner again — only a genuinely new, never-before-loaded month does.
  const loadedOutfitMonthsRef = useRef(new Set<string>());
  const loadedWeatherMonthsRef = useRef(new Set<string>());
  const monthKey = `${year}-${month}`;
  const monthEverLoaded = loadedOutfitMonthsRef.current.has(monthKey) && loadedWeatherMonthsRef.current.has(monthKey);
  const showLoadingUI = (loading || !weatherReady) && !monthEverLoaded;

  // ── Month<->day transition — deliberately minimal right now, built step by step. ────────────
  // Current behavior, exactly and only this: tapping a day's stack (or TODAY/MONTH VIEW) fades
  // out everything but that day's own pieces, then cuts straight to the other view once the fade
  // completes. Piece movement between the two views comes later, once this base step is
  // confirmed to look right. Real Animated.Values (not plain booleans) specifically so the fade
  // is an actual animation, not an instant snap — and so it starts the instant the tap fires,
  // never delayed behind (or prolonging) the TouchableOpacity's own normal, brief press-feedback
  // dimming, which is untouched here and always ends exactly when the touch itself does.
  const dayChromeOpacity = useRef(new Animated.Value(1)).current;
  const monthChromeOpacity = useRef(new Animated.Value(1)).current;
  const [revealDate, setRevealDate] = useState<string | null>(null);
  const transitioningRef = useRef(false);
  // Counter-keyed, commit-guaranteed fade triggers for both chrome fade-ins (month->day and
  // day->month) — the SAME "entranceKey" pattern already proven for Preview's own entrance
  // animation this session, applied here instead of a guessed double-requestAnimationFrame
  // defer. A double-rAF only guarantees SOME frame was drawn, not that the real, comparatively
  // heavy tree being faded in (a 30-odd-cell month grid, or a full day view with its
  // OutfitSlotGrid/header/notes) actually finished mounting — if that content was still
  // assembling when the deferred .start() fired, the fade's own visible first frame could
  // already be partway through, reading as chrome "spawning in" fully formed rather than
  // visibly fading.
  //
  // A prior attempt at fixing this used a plain ref (set synchronously right before setView)
  // read back inside a useEffect keyed on `view` itself. That was reverted after a live test
  // showed the fade sometimes not firing at all — plausible root cause: `view` is a single
  // shared piece of state multiple call sites schedule a "pending" fade against, and a
  // useEffect keyed on view alone can't distinguish "view just changed FOR THIS transition" from
  // any other reason `view` might independently line up with what a stale pending ref expected,
  // or fail to re-fire if some other update coalesces into the same commit. A dedicated,
  // monotonically-incrementing counter — bumped exactly once per intended trigger, matching
  // Preview's own entranceKey — can't have that ambiguity: the effect's dependency changing IS
  // the signal, with no shared-state reuse to race against.
  const [monthFadeKey, setMonthFadeKey] = useState(0);
  const monthFadeDoneRef = useRef<(() => void) | null>(null);
  // Optional async step that runs AFTER the real month view has committed (this effect only
  // fires once that's true) but BEFORE the fade itself starts — used by the closing transition's
  // shrink-completion handoff to re-measure the destination cell against the now-real mount and
  // correct shrinkTarget, so any positional correction lands on an otherwise-idle frame instead
  // of surfacing as a jump once everything else has already faded in and settled.
  const monthFadeBeforeRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (monthFadeKey === 0) return;
    // TEMPORARY diagnostic logging — this is the one effect in the whole closing-transition
    // chain (see logCalTiming's own header comment) that had none, despite being the exact spot
    // reported stuck: "stack lands in the right position, then the whole screen goes white and
    // stays." If `before()` never resolves or throws, .start() below never runs and
    // monthChromeOpacity stays at 0 forever — which is exactly white-and-stuck. Remove once the
    // real cause is confirmed from a real run's log (long-press TODAY/MONTH VIEW to retrieve it).
    logCalTiming("monthFadeKey effect fired", 0);
    (async () => {
      const before = monthFadeBeforeRef.current;
      monthFadeBeforeRef.current = null;
      try {
        if (before) {
          logCalTiming("monthFadeKey: awaiting before()", 0);
          await before();
          logCalTiming("monthFadeKey: before() resolved", 0);
        }
      } catch (e) {
        logCalTiming(`monthFadeKey: before() THREW: ${e instanceof Error ? e.message : String(e)}`, 0);
      }
      logCalTiming("monthFadeKey: starting chrome fade-in", 0);
      // Fixed-duration setTimeout instead of this animation's own .start() completion callback —
      // a useNativeDriver:true callback is not reliable on this device/RN setup (proven
      // independently in PreviewScreen's own equivalent transition chain, same symptom: gating
      // cleanup on that callback meant it could simply never fire, leaving monthChromeOpacity
      // stuck at 0 forever — chrome invisible against colors.bg's actual white, i.e. exactly
      // "lands in the right position, then the whole screen goes white and stays"). A timer
      // matched to the animation's own configured duration doesn't depend on that callback at all.
      Animated.timing(monthChromeOpacity, { toValue: 1, duration: 280, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }).start();
      setTimeout(() => {
        logCalTiming("monthFadeKey: chrome fade-in (timer) fired", 0);
        const done = monthFadeDoneRef.current;
        monthFadeDoneRef.current = null;
        done?.();
        logCalTiming("monthFadeKey: monthFadeDoneRef done() called", 0);
      }, 280);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFadeKey]);
  const [dayFadeKey, setDayFadeKey] = useState(0);
  const dayFadeDoneRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (dayFadeKey === 0) return;
    // 420ms, not 280 — this key only ever bumps from ONE place: the month->day distribute
    // handoff (see its own call site, the only caller that ever passes fadeInChrome:true), where
    // the box frames, header, score and pros/cons list all fade in together around the
    // already-landed pieces. At 280ms, with that much content appearing across the whole screen
    // at once, it read as everything "spawning in" rather than a real, visible fade — per
    // explicit feedback asking for this to be more clearly defined as a fade. Longer gives the
    // eye enough time to actually register the opacity ramping rather than reading two frames
    // apart as on/off.
    // Same fixed-duration setTimeout fix as monthFadeKey's own effect above, for the identical
    // reason — see its comment. Same animation, same unreliable-callback risk.
    Animated.timing(dayChromeOpacity, { toValue: 1, duration: 420, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }).start();
    setTimeout(() => {
      const done = dayFadeDoneRef.current;
      dayFadeDoneRef.current = null;
      done?.();
    }, 420);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFadeKey]);
  // Both trimmed down from 500/380 — this whole open transition chains FOUR of these
  // sequentially (chrome fade-out, grow, resize, distribute, then a chrome fade-in on top), which
  // at the old durations added up to a genuinely slow ~2s round trip for what should read as a
  // quick tap-to-open. Still slow enough to see each phase, just not sluggish.
  const TRANSITION_FADE_MS = 300;
  const CONVERGE_MS = 260;
  // Roughly OutfitsScreen's own card-stack size — "appropriate" for something that's about to
  // distribute back out into day-view boxes in a later step, though the exact number is still
  // tunable once that step exists.
  const CONVERGE_SIZE = 150;
  const CONVERGE_TARGET = { x: SCREEN_W / 2, y: SCREEN_H * 0.46, size: CONVERGE_SIZE };
  // The ACTUAL content size a piece ends up at once gather/grow finishes (ConvergeOverlay's own
  // default targetContentFraction, 0.6, applied to CONVERGE_SIZE) — the resize phase that follows
  // needs its OWN origin sized to match this exactly. Leaving resize's origin at ITS default
  // sizing heuristic (0.8 of the box, i.e. 120) when the piece was actually left at 90 by the
  // phase before it was a real, visible discontinuity: resize's first frame would suddenly jump
  // the piece from 90px to 120px before it started shrinking down again — read as a stutter/size
  // jump right at the gather-to-resize (or grow-to-resize) handoff.
  const CONVERGE_CONTENT = CONVERGE_SIZE * 0.6;

  // Day->month, phase 2 (gather): once the chrome/frame fade above finishes, the day grid's
  // real, measured box positions (dayBoxRects, always kept current while day view is shown) feed
  // a ConvergeOverlay that animates every piece from its own box to one shared, overlapping
  // stack at CONVERGE_TARGET. dayBoxRectsRef mirrors the state synchronously (state updates are
  // batched/async; the distribute phase below needs to poll "has every id arrived yet" in a
  // plain loop, which needs a ref, not a state closure that could be reading a stale snapshot).
  const [dayBoxRects, setDayBoxRects] = useState<Map<string, BoxRect>>(new Map());
  const dayBoxRectsRef = useRef<Map<string, BoxRect>>(new Map());
  // OutfitSlotGrid's boxes report themselves independently (one onLayout call per box), and
  // dayBoxRects/onBoxMeasured is now wired into the REAL, always-visible day view too (not just
  // the hidden measuring mounts) — dayBoxRects needs to stay current any time the user might tap
  // "MONTH VIEW". Committing each box's measurement as its own separate setState meant simply
  // opening the day tab fired N sequential re-renders of the whole CalendarScreen tree right
  // after mount (one per box), which is real, avoidable work — exactly the kind of thing that
  // reads as "takes a bit to load" on a screen that used to just be ready instantly. Buffering
  // arrivals in a plain ref and flushing them as ONE state update per animation frame collapses
  // however many boxes report in the same frame into a single re-render.
  const pendingBoxRectsRef = useRef<Map<string, BoxRect>>(new Map());
  const boxRectFlushScheduledRef = useRef(false);
  const handleBoxMeasured = useCallback((id: string, rect: BoxRect) => {
    const existing = dayBoxRectsRef.current.get(id);
    if (existing && existing.x === rect.x && existing.y === rect.y && existing.width === rect.width) return;
    pendingBoxRectsRef.current.set(id, rect);
    if (boxRectFlushScheduledRef.current) return;
    boxRectFlushScheduledRef.current = true;
    requestAnimationFrame(() => {
      boxRectFlushScheduledRef.current = false;
      const pending = pendingBoxRectsRef.current;
      pendingBoxRectsRef.current = new Map();
      setDayBoxRects(prev => {
        const next = new Map(prev);
        pending.forEach((r, k) => next.set(k, r));
        dayBoxRectsRef.current = next;
        return next;
      });
    });
  }, []);
  // Day->month, phase 3 (shrink): once gathered at center, the stack shrinks into the
  // destination month cell — measured from a HIDDEN MonthBody mount (rendered below, whenever
  // `gathering` is truthy) since the real month grid isn't shown at all while still on day view.
  const [gathering, setGathering] = useState(false);
  // "resize" sits BETWEEN gather and shrink: the stack scales in place (still centered, still
  // one shared point) from its gathered size down to the exact size it'll be inside the month
  // cell, THEN the (now size-stable) stack purely translates to the destination in "shrink" —
  // instead of scaling and translating at once, which read as the piece's size visibly wobbling
  // mid-flight rather than a clean move.
  const [closingPhase, setClosingPhase] = useState<"gather" | "resize" | "shrink">("gather");
  const [shrinkTarget, setShrinkTarget] = useState<Rect | null>(null);
  const gatherP = useRef(new Animated.Value(0)).current;
  const shrinkResizeP = useRef(new Animated.Value(0)).current;
  const shrinkP = useRef(new Animated.Value(0)).current;

  // Month->day, phase 2 (grow): once the month chrome fade finishes, the tapped cell's real
  // stack rect is measured fresh (it never moves during the fade, so this is safe to do right as
  // the fade completes rather than before it starts) and a ConvergeOverlay grows every one of
  // that day's non-accessory pieces — all sharing that SAME tiny origin, since the real month
  // cell only ever shows one overlapping mini-stack, not per-garment positions — out to the same
  // shared CONVERGE_TARGET.
  // Month->day, phase 3 (distribute): from that center stack, pieces distribute out to where the
  // real day-view boxes will land — measured from a HIDDEN DayHeader+DayOutfit mount (rendered
  // below, whenever `growing` is truthy) positioned exactly where the real day content will sit,
  // so cutting over to the real view afterward is seamless.
  const dayStackRefs = useRef<Record<string, View | null>>({});
  const [growing, setGrowing] = useState<{ date: string; origin: Rect } | null>(null);
  // "resize" sits BETWEEN grow and distribute for the identical reason closingPhase's own
  // "resize" does: the stack scales in place (still centered, still one shared point) from its
  // grown size down to the exact size it'll be inside a real day-view box, THEN the (now
  // size-stable) pieces purely translate outward in "distribute" — no more scaling while also
  // moving to a different position for each piece, which read as their sizes visibly adjusting
  // mid-flight.
  const [growPhase, setGrowPhase] = useState<"grow" | "resize" | "distribute">("grow");
  const growP = useRef(new Animated.Value(0)).current;
  const growResizeP = useRef(new Animated.Value(0)).current;
  const distributeP = useRef(new Animated.Value(0)).current;

  // Polls dayBoxRectsRef (kept in sync by handleBoxMeasured) until every requested id has
  // arrived or a generous frame budget runs out — the hidden day mount only needs a handful of
  // frames to lay out, but this is a safety valve against a garment whose box never measures for
  // some edge-case reason, so distribute still eventually runs with whatever DID arrive rather
  // than hanging the whole transition.
  async function waitForBoxRects(ids: string[]): Promise<void> {
    // Bounded by a Promise.race against a single setTimeout fired once up front, NOT by
    // re-checking Date.now() only between loop iterations (an earlier version of this did that,
    // and a screen recording of a real hang confirmed exactly the failure mode this comment used
    // to only warn about hypothetically: when the JS thread is badly congested, a SINGLE
    // requestAnimationFrame round-trip inside the loop can itself take seconds to fire — and
    // since the deadline was only re-checked AFTER that slow await resolved, the loop could
    // overshoot its "500ms" budget by however long that one slow iteration took, with no upper
    // bound. Racing against an independently-scheduled timer means the cap is enforced the
    // instant the JS thread is free enough to service ANY pending timer/frame callback, not only
    // once this specific loop's own in-flight iteration happens to finish.
    await Promise.race([
      (async () => {
        while (!ids.every(id => dayBoxRectsRef.current.has(id))) {
          await new Promise<void>(res => requestAnimationFrame(() => res()));
        }
      })(),
      new Promise<void>(res => setTimeout(res, 500)),
    ]);
  }
  // Polls the hidden MonthBody mount's ref for the destination cell — same reasoning as
  // waitForBoxRects, just for the single shrink-destination rect instead of a set of ids.
  // Requires the SAME rect to come back on two consecutive frames before trusting it: a view
  // that just mounted (or whose ancestor just relaid-out, which is exactly this hidden mount's
  // situation) can report a stale/transient position from measureInWindow for a frame or two
  // before native layout actually settles — trusting the very first non-null reading was landing
  // the shrink animation at that transient, wrong spot ("some random spot almost on the
  // screen") instead of the cell's real final position.
  async function measureDestinationCell(date: string): Promise<Rect | null> {
    // Same Promise.race-against-one-timer reasoning as waitForBoxRects above (see its comment)
    // — a loop that only re-checks its deadline between iterations can overshoot by however long
    // a single congested iteration takes, with no cap. `done` flips as soon as the race settles
    // either way, so the polling loop below stops issuing further measureRect/rAF round-trips
    // once the timeout has already won — it would otherwise keep running harmlessly in the
    // background, but there's no reason to keep spending frames on it.
    let lastRect: Rect | null = null;
    let done = false;
    const poll = (async () => {
      while (!done) {
        const rect = await measureRect(dayStackRefs.current[date]);
        if (done) break;
        if (rect && lastRect && rect.x === lastRect.x && rect.y === lastRect.y && rect.width === lastRect.width && rect.height === lastRect.height) {
          done = true;
          return rect;
        }
        lastRect = rect;
        await new Promise<void>(res => requestAnimationFrame(() => res()));
      }
      return lastRect;
    })();
    const timeout = new Promise<Rect | null>(res => setTimeout(() => res(lastRect), 400));
    const result = await Promise.race([poll, timeout]);
    done = true;
    return result;
  }

  // Month view starts with the header+grid block vertically centered (nothing to show below it
  // yet) and slides up to the top once a day is picked, making room for the detail panel to fade
  // in underneath — rather than the grid sitting pinned to the top with a slab of dead space
  // under it the whole time. Driven off whether ANY day is selected, not which one, so tapping a
  // different day while the panel's already open updates its content without replaying the slide.
  const hasSelection = !!selectedDate;
  const centerAnim = useRef(new Animated.Value(hasSelection ? 0 : 1)).current;
  const [monthBlockH, setMonthBlockH] = useState(0);
  const [monthAreaH, setMonthAreaH] = useState(0);
  const [panelMounted, setPanelMounted] = useState(hasSelection);

  useEffect(() => {
    if (hasSelection) setPanelMounted(true);
    Animated.timing(centerAnim, {
      toValue: hasSelection ? 0 : 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !hasSelection) setPanelMounted(false); });
  }, [hasSelection, centerAnim]);

  // Every prior tuning attempt at this multiplier from before the onAreaLayout/collapsable fix
  // above was silently a no-op: monthAreaH was stuck at 0 the entire time, which made
  // (monthAreaH - monthBlockH) negative and Math.max(0, ...) clamp the result to 0 regardless of
  // which multiplier was tried. Now that monthAreaH genuinely measures, this is the first time
  // this value has ever actually applied — real feedback so far: 0.3 too high, 0.5 too low, 0.4
  // and 0.37 both still slightly too low, 0.34 overshot back too high, 0.36 still slightly too
  // low again. Narrowing tightly between 0.34 and 0.36.
  const monthCenterOffset = Math.max(0, (monthAreaH - monthBlockH) * 0.35);
  // Memoized — MonthBody is wrapped in memo() (see its own comment) specifically so it can skip
  // re-rendering when nothing it displays actually changed, but .interpolate() creates a brand
  // new AnimatedInterpolation object every time it's called. Calling it inline in the render body
  // (an earlier version of this did) handed MonthBody a "different" prop by reference on every
  // single render regardless of whether monthCenterOffset's actual value had moved at all,
  // defeating memo for this prop specifically.
  const monthBlockTranslateY = useMemo(
    () => centerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, monthCenterOffset] }),
    [centerAnim, monthCenterOffset]
  );
  // Same reference-stability reasoning as monthBlockTranslateY above, for the two onLayout props
  // — an inline `e => setMonthBlockH(...)` is also a fresh function every render.
  //
  // Accepts only the FIRST non-zero measurement, then ignores every later one — not just a
  // performance nicety. monthBlockH covers the grid, whose own rendered height depends on gridW
  // (see its own state below), which itself starts as a plain estimate (SCREEN_W - spacing.sm*2)
  // and corrects to its real measured value a render later via the grid clip wrapper's OWN
  // onLayout. If that correction ever lands a different number than the estimate, the grid's
  // height changes, which changes THIS block's own measured height, which changes
  // monthCenterOffset and shifts the whole month block — entirely on its own, with no animation
  // or user action involved. That matches a real, reported symptom precisely: the calendar
  // shifting either right as a month-ending transition settles, or right as an idle month view
  // sits there before any transition has even started — both are exactly "some time after this
  // block first mounted, its measured height turned out to differ from the first pass." Locking
  // in the first successful reading makes that impossible: there is no second measurement left
  // to disagree with the first. The pre-existing !loading gate on the hidden probe mount already
  // ensures this first reading happens only once real outfit data (and therefore the grid's real
  // content) is present, so "first" here doesn't mean "before the layout has anything real to
  // measure."
  // The height is read synchronously, right here, and only the extracted NUMBER is handed to the
  // updater below — not `e` or `e.nativeEvent` themselves. React's synthetic event object is
  // pooled/recycled once this handler returns; reading e.nativeEvent lazily INSIDE the setState
  // updater (an earlier version of this did) crashed with "Cannot read property 'layout' of
  // null" the moment that updater actually ran, because by then React had already nulled out
  // the recycled event's nativeEvent out from under it.
  //
  // Mirrored into a ref (assigned every render, read inside the callback) rather than closed
  // over directly, so this can check the CURRENT loading value without loading itself becoming
  // a dependency — adding it as a real dependency would give handleBlockLayout/handleAreaLayout
  // a new identity every time loading changes, which is exactly the kind of prop-reference churn
  // MonthBody's own memo() exists to avoid. Needed now that MonthBody stays permanently mounted
  // (see the render below) instead of being torn down and rebuilt on every view switch — its
  // very first onLayout can now fire while `loading` is still true (mounted at the same time as
  // the rest of this screen, before outfits data has ever arrived), which would otherwise lock
  // in a too-short, loading-dots-only height as this block's permanent measurement forever.
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const handleBlockLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    if (loadingRef.current) return;
    const height = e.nativeEvent.layout.height;
    setMonthBlockH(prev => (prev > 0 ? prev : height));
  }, []);
  const handleAreaLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    if (loadingRef.current) return;
    const height = e.nativeEvent.layout.height;
    setMonthAreaH(prev => (prev > 0 ? prev : height));
  }, []);
  // Both onLayout measurements (monthAreaH from the outer flex:1 wrapper, monthBlockH from the
  // header+grid block itself) land a frame or two after first mount, not before — so
  // monthCenterOffset is 0 on that very first render regardless of centerAnim's value, and the
  // block briefly paints top-aligned before snapping (not animating — centerAnim's own value
  // never changes here, only what it's interpreted against does) down to its real centered
  // position the instant real measurements arrive. That snap is exactly "starts in the original
  // orientation before switching". Hiding the block until both measurements are in makes that
  // whole pre-measurement window invisible instead of trying to animate away a jump.
  const monthMeasured = monthAreaH > 0 && monthBlockH > 0;
  const panelOpacity = centerAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const panelTranslateY = centerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 16] });

  // TEMPORARY diagnostic — the timing log (logCalTiming) already proved the closing-transition
  // state machine completes fully even in a run that visually never clears, which rules out a
  // stuck callback. What it can't show is whether the variables that actually CONTROL what's
  // rendered are correct at that moment. This dumps every one of them the instant `view` changes
  // (the exact moment the visual swap is supposed to happen) so a real repro's log shows not just
  // "did the code run" but "what would it have actually painted." Long-press TODAY/MONTH VIEW to
  // retrieve, same as the timing log. Remove once the real cause is confirmed.
  useEffect(() => {
    logCalTiming(
      `VIEW CHANGED to "${view}" | monthMeasured=${monthMeasured} (areaH=${monthAreaH}, blockH=${monthBlockH}) | ` +
      `gathering=${gathering} shrinkTarget=${shrinkTarget ? "set" : "null"} | selectedDate=${selectedDate} panelMounted=${panelMounted} | ` +
      `loading=${loading} weatherReady=${weatherReady}`,
      0
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Resolve location once per mount (this tab stays mounted across the whole session), not on
  // every generate tap — so weather can be fetched proactively too, matching the website.
  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      try {
        // Explicit High accuracy rather than the default (Balanced, ~100m) — weather doesn't
        // meaningfully vary over 100m, but this costs nothing and keeps native and web
        // consistently requesting the best location reading each platform can give.
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {}
    })();
  }, []);

  useEffect(() => {
    setWeatherReady(false);
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (userLoc) { params.set("lat", String(userLoc.lat)); params.set("lon", String(userLoc.lon)); }
    apiJsonCached<Record<string, DayWeather>>(`/api/weather?${params}`, 300_000)
      .then(setWeather)
      .catch(() => {})
      // Marked ready on failure too — a dead weather endpoint shouldn't spin the loading dots
      // forever; the day cells already render fine with no weather text via the existing
      // `weather[date] &&` guards, which is the correct degraded state, not an infinite wait.
      .finally(() => {
        setWeatherReady(true);
        loadedWeatherMonthsRef.current.add(`${year}-${month}`);
      });
  }, [year, month, userLoc]);

  const calRetryCount = useRef(0);
  const loadRef = useRef<(y: number, m: number) => Promise<void>>(async () => {});
  // Tracks the last JSON actually applied to `outfits` per path — see the equality check below.
  const lastLoadedJsonRef = useRef<Record<string, string>>({});
  const load = useCallback(async (y: number, m: number) => {
    // Skip the loading state entirely when the data is already in the in-memory cache — but the
    // ttl here MUST match the ttl the actual fetch below uses. Calling getCached(path) with no
    // ttl treats ANY prior entry as fresh forever, regardless of age — so any time this tab had
    // been open more than 5 minutes, the loading indicator was suppressed for what was actually
    // about to be a real network round trip (apiJsonCached's own 300_000 ttl had already expired).
    const path = `/api/outfits?year=${y}&month=${m}`;
    if (!getCached(path, 300_000)) setLoading(true);
    try {
      const data = await apiJsonCached<OutfitMap>(path, 300_000);
      // Skip the setState entirely when the refetched data is byte-identical to what's already
      // showing — the overwhelmingly common case for a background 5-minute refresh of a month
      // nobody has changed. Without this, every such refresh handed every consumer of `outfits`
      // (the month grid, the day view, any in-flight transition reading dayBoxRects/outfits[ds])
      // a BRAND NEW object reference purely from re-fetching identical data, forcing a re-render
      // that read as the whole screen "refreshing" — and since this is tied to how long the tab
      // had been sitting open rather than to any specific tap, it never reproduced reliably on a
      // quick retest, which is exactly why it kept surviving repeated rounds of fixing the
      // TRANSITION code (which was never the actual source).
      const json = JSON.stringify(data);
      if (lastLoadedJsonRef.current[path] !== json) {
        lastLoadedJsonRef.current[path] = json;
        setOutfits(prev => ({ ...prev, ...data }));
      }
      calRetryCount.current = 0;
      setLoading(false);
      loadedOutfitMonthsRef.current.add(`${y}-${m}`);
    } catch {
      // Retry up to 3 times — server cold-starts can take several seconds.
      if (calRetryCount.current < 3) {
        const delay = [1500, 3000, 5000][calRetryCount.current] ?? 5000;
        calRetryCount.current += 1;
        // NOT calling setLoading(false) here — a retry is scheduled, so loading is still
        // genuinely in progress. This used to sit in a `finally` block below, which — a real,
        // classic JS gotcha — runs unconditionally no matter what the try/catch did, including
        // right after this exact `return`. That flipped `loading` to false immediately on the
        // very FIRST failed attempt, while `outfits` still held no entry for today (the retry
        // hadn't resolved yet) — rendering "No outfit for this day" for real, existing data,
        // which then corrected itself once the retry actually succeeded moments later. A first
        // attempt failing is genuinely common right at cold start (auth/network not fully up
        // yet), matching exactly what was reported: a false "no outfit" message on first entering
        // the app that self-corrects once the real data arrives.
        setTimeout(() => loadRef.current(y, m), delay);
        return;
      }
      // Retries exhausted — genuinely done trying, whatever's already cached is what will show.
      setLoading(false);
    }
  }, []);
  loadRef.current = load;

  useEffect(() => { load(year, month); }, [load, year, month]);

  // Prefetches every month-cell garment image the instant outfits load — the month grid sits
  // invisible behind day view for as long as a day is open (it's "always mounted," but mounted
  // doesn't mean every cell's image has actually been decoded), so without this, the FIRST time
  // any given month's grid becomes visible, every cell's image decodes for the first time right
  // as monthChromeOpacity is fading it in — reading as content visibly assembling itself DURING
  // the fade ("a refresh"), not a clean fade of already-complete content. Same fix, same
  // reasoning, as openDaySpread's own Image.prefetch() call for day-view images — this is its
  // month-view counterpart. (An earlier attempt at exactly this made no visible difference, but
  // that was tested while the month view was still unconditionally hidden by the monthMeasured
  // bug — there was nothing to actually observe improving. Now that reveal is fixed, this can
  // genuinely be judged.)
  const prefetchedMonthImagesRef = useRef(new Set<string>());
  useEffect(() => {
    for (const outfit of Object.values(outfits)) {
      for (const g of outfit.garments) {
        if (g.image && bucketOf(g) !== "accessory" && !prefetchedMonthImagesRef.current.has(g.image)) {
          prefetchedMonthImagesRef.current.add(g.image);
          Image.prefetch(g.image).catch(() => {});
        }
      }
    }
  }, [outfits]);

  // Builder's SAVE (after editing a day's outfit there) sends us back here with a fresh
  // timestamp so this already-mounted tab knows to refetch instead of showing stale data.
  useEffect(() => {
    if (route.params?.refreshAt) load(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.refreshAt]);

  function openEdit(outfit: OutfitDay, date: string) {
    navigation.navigate("Builder", {
      editDate: date,
      editOutfitId: outfit.id,
      initialIds: outfit.garments.map(g => g.id),
    });
  }

  async function handleGenerate(overwriteAll = false) {
    setGenerating(true);
    try {
      await apiJson("/api/outfits/generate", {
        method: "POST",
        body: JSON.stringify({ year, month, lat: userLoc?.lat, lon: userLoc?.lon, overwrite: overwriteAll || hasBrokenOutfits }),
      });
      await load(year, month);
    } catch {
      // generation can legitimately take a while (AI analysis per day) — silent on failure,
      // the REGEN button remains available to retry
    } finally {
      setGenerating(false);
    }
  }

  // A full-month regen (nothing left blank/broken) deletes and replaces every day, including
  // ones the user hand-edited via Builder — confirm first when that's at risk, matching the
  // website's onRegenClick.
  function onRegenClick() {
    if (!needsGeneration && hasCustomizedDay) { setRegenConfirm(true); return; }
    handleGenerate(needsGeneration ? false : true);
  }

  const cells = useMemo(() => getCells(year, month), [year, month]);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthDates = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => toDateStr(year, month, i + 1)), [year, month, daysInMonth]);
  const blankDays = monthDates.filter(d => !outfits[d]).length;
  const hasBrokenOutfits = monthDates.some(d => outfits[d] && outfits[d].garments.length === 0);
  const needsGeneration = blankDays > 0 || hasBrokenOutfits;
  const hasCustomizedDay = monthDates.some(d => outfits[d]?.customized);
  const focusOutfit = outfits[focusDate];
  const focusNotes = useMemo(() => parseNotes(focusOutfit?.notes ?? null), [focusOutfit]);

  const selected = selectedDate ? outfits[selectedDate] : null;
  const selectedNotes = useMemo(() => parseNotes(selected?.notes ?? null), [selected]);

  // dayChromeOpacity is reset here — on every entry into day view — rather than at the end of
  // startClosingTransition's own animation. Animated.Value.setValue() is an immediate, direct
  // native update, completely independent of React's own (batched, asynchronous) render cycle
  // that setView() goes through — resetting it back to 1 in the same tick as LEAVING day view
  // snapped the still-mounted DayHeader/DayOutfit's opacity back to fully visible for a frame
  // (a real, visible flash of the header/pros-cons list) before React actually got around to
  // unmounting them. Doing the reset here instead, at the moment day view is being entered
  // (month is what's mounted then, so this can never flash it), is race-free by construction.
  // fadeInChrome: used only by the end of the month->day distribute animation, where the pieces
  // have just finished laying out in their real box positions and everything ELSE on the day
  // view (header, nav, notes) should quickly fade in around them rather than snapping straight
  // to fully visible — every other caller (prev/next day, tapping a day with no stack to
  // animate) wants the chrome simply there immediately, no transition to speak of.
  function goToDay(ds: string, opts?: { fadeInChrome?: boolean; onChromeFadeDone?: () => void }) {
    dayChromeOpacity.setValue(opts?.fadeInChrome ? 0 : 1);
    // Batched — every call site that matters here (openDaySpread's distribute-phase completion,
    // the early-measurement-failure fallback) runs from an Animated native-driver completion
    // callback, which — unlike a JS-originated event — React does NOT automatically batch. Left
    // unbatched, setFocusDate/setSelectedDate/setView/setYear/setMonth could each commit as their
    // own separate render, briefly showing month-view state mixed with day-view state (or the
    // new date with the old view, etc.) before settling on the final combination a frame or two
    // later — read as the whole screen visibly "refreshing" right as the day view finished
    // assembling, not a rendering artifact of anything else running at the time.
    const { y, m } = parseDateStr(ds);
    if (opts?.fadeInChrome) dayFadeDoneRef.current = opts.onChromeFadeDone ?? null;
    unstable_batchedUpdates(() => {
      setFocusDate(ds);
      setSelectedDate(null);
      setView("day");
      if (y !== year || m !== month) { setYear(y); setMonth(m); }
      if (opts?.fadeInChrome) setDayFadeKey(k => k + 1);
    });
  }

  // Runs an Animated.timing only once the state update that mounts its target overlay has
  // actually been committed and painted — starting it in the very same synchronous callback as
  // the setState (as an earlier version of this did) let the animation begin ticking on the
  // native thread before the overlay component existed to display it, so by the time it finally
  // appeared a chunk of the animation had already silently played out — reading as a "teleport"
  // straight to a near-final frame instead of a smooth, fully-visible motion.
  function runConvergeAfterMount(progress: Animated.Value, onDone: () => void) {
    // Reset happens immediately (synchronously, same tick as the setState that mounts the
    // overlay) — the overlay's very first rendered frame must already read progress=0, which is
    // exactly the origin position, or it would flash whatever value was left over from a
    // previous run before snapping back to the start. Only the animation's actual .start() is
    // deferred, so it begins once the overlay is truly on screen to display it.
    progress.setValue(0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Animated.timing(progress, {
        toValue: 1, duration: CONVERGE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(onDone);
    }));
  }

  // Month->day transition: (1) fade out everything in month view EXCEPT the tapped day's own
  // stack; (2) measure that stack's real rect and grow it into a bigger, centered stack;
  // (3) distribute from there out to where the real day-view boxes will land; (4) cut to day
  // view once that completes.
  function openDaySpread(ds: string) {
    if (transitioningRef.current) return;
    const outfit = outfits[ds];
    const nonAcc = outfit ? outfit.garments.filter(g => bucketOf(g) !== "accessory" && g.image) : [];
    if (nonAcc.length === 0) { goToDay(ds); return; }
    transitioningRef.current = true;
    // Fire-and-forget prefetch, started as early as possible (the instant the tap that will
    // eventually need these exact images is known) rather than leaving the FIRST decode of each
    // one to happen whenever the real day view's OutfitSlotGrid first mounts them — which, on a
    // cold cache, lands right at the distribute-to-real-view handoff (see its own comment: the
    // swap assumes the overlay and the real content are already pixel-identical the instant
    // distribute completes). A slow first decode there is a real, reported symptom (a duplicate/
    // shadow visible only the first time a given day's images are ever shown this session) —
    // by the time distribute's own ~1s of grow/resize/move animation has played out, a prefetch
    // started right now has had that whole window to finish, so the swap actually gets the
    // already-decoded image it assumes.
    nonAcc.forEach(g => { if (g.image) Image.prefetch(g.image).catch(() => {}); });
    setRevealDate(ds);
    // The actual fade-and-everything-after now lives in the useEffect below, keyed on
    // revealDate — see that effect's own comment for why. openDaySpread itself just requests
    // the transition; it doesn't drive it.
  }

  // Runs the month->day open sequence once React has ACTUALLY committed a render reflecting the
  // new revealDate — replaces a double-requestAnimationFrame defer that used to sit here,
  // guessing 2 frames was always enough time for that commit to land before starting the fade.
  // The ORIGINAL comment on that defer explained exactly why it existed: starting the fade in
  // the same tick as setRevealDate(ds) left the tapped cell's stack still bound to
  // monthChromeOpacity from the PREVIOUS render for the fade's first several frames — fading
  // along with everything else, then snapping back full-opacity once the real re-render finally
  // landed, before the grow animation proper. Two rAFs was a fix for that — but a fixed frame
  // count is a guess that usually, not always, holds, and this exact class of bug (a
  // requestAnimationFrame defer standing in for a real "did React commit yet" signal) is what
  // was already found and replaced with a commit-guaranteed useEffect elsewhere in this codebase
  // this session (Preview's entrance, Preview's gallery navigation) — never here, despite this
  // being the oldest and most heavily-patched instance of exactly that problem. If the commit
  // sometimes took longer than 2 frames — very plausible on a screen this size, with everything
  // else this component re-renders — the fade could still start early relative to the real
  // stack's re-bound opacity, reading as a hard cut/"disappear" rather than a smooth 300ms fade,
  // intermittently and without a clean reproduction, exactly matching how long this has resisted
  // a fix.
  useEffect(() => {
    if (!revealDate) return;
    const ds = revealDate;
    const outfit = outfits[ds];
    const nonAcc = outfit ? outfit.garments.filter(g => bucketOf(g) !== "accessory" && g.image) : [];
    // Deferred by the same double-rAF this file already uses in runConvergeAfterMount, and for
    // the same reason: this effect fires right after React commits a render where revealDate
    // just changed — which, for this specific commit, means the WHOLE month grid (30+ cells,
    // each with its own Animated.View wrapper) just reconciled, real synchronous work. Calling
    // .start() immediately in that same tick risked the native side's own animation setup
    // landing late relative to when the JS call fired — useNativeDriver:true hands the actual
    // ticking to the native thread, but the INITIAL bridge call that configures it still needs
    // the JS thread to be free to process promptly, and a delayed setup can mean the animation's
    // own internal clock has already run down before its first frame is visibly on screen —
    // exactly what reads as the fade being skipped rather than smoothly playing out. Two rAFs
    // guarantees the JS thread has had a couple of genuinely free frames first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
    Animated.timing(monthChromeOpacity, {
      toValue: 0, duration: TRANSITION_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(async () => {
        const origin = await measureRectStable(dayStackRefs.current[ds]);
        if (!origin) {
          unstable_batchedUpdates(() => { goToDay(ds); setRevealDate(null); });
          transitioningRef.current = false;
          return;
        }
        // Batched — this whole callback runs from the Animated native-driver's completion
        // callback, which (unlike a JS-originated event) is NOT automatically batched by React.
        // setGrowPhase and setGrowing landing as two separate renders left one frame where
        // growPhase had already flipped to "grow" but growing was still null — nothing visibly
        // wrong on ITS own, but a real gap in what should be one atomic "start growing" moment,
        // and exactly the class of bug behind the "slight refresh/disappears" symptom elsewhere
        // in this same transition (see OutfitsScreen's own closeSpread, which batches for the
        // identical reason).
        unstable_batchedUpdates(() => {
          setGrowPhase("grow");
          setGrowing({ date: ds, origin });
        });
        runConvergeAfterMount(growP, async () => {
          // Phase 3: resize IN PLACE (still centered, one shared point) from the grown size down
          // to the exact size each piece will be inside a real day-view box — before any of them
          // start moving toward their own separate positions. Runs at the same time as waiting
          // for the hidden day mount to report real box positions (rendered below whenever
          // `growing` is set), since neither depends on the other.
          setGrowPhase("resize");
          const boxRectsReady = waitForBoxRects(nonAcc.map(g => g.id));
          await new Promise<void>(resolve => runConvergeAfterMount(growResizeP, resolve));
          await boxRectsReady;
          // Phase 4: distribute — pieces are already at the correct final size, so this is a
          // pure position move with no further scale change.
          setGrowPhase("distribute");
          runConvergeAfterMount(distributeP, () => {
            // Pieces are now laid out in their real box positions, pixel-identical to where the
            // real day view's own (currently image-masked, see OutfitSlotGrid's hidePieces) boxes
            // sit — so clearing `growing` HERE, immediately, swaps the frozen overlay for the real
            // (now-unmasked) images in one atomic batch with no visible change: same picture, same
            // spot, same opacity, just a different component providing it. Only the FRAME/header/
            // notes (bound to chromeOpacity, never gated by piecesHidden) still have their own
            // 280ms fade-in left to run, exactly matching the request this was built around: once
            // pieces are laid out, they just sit there — the rest fades in around them.
            //
            // An earlier version of this kept `growing` set (overlay frozen on top) through the
            // ENTIRE chrome fade-in, delaying this swap until fadeInChrome's own callback fired,
            // specifically to avoid revealing the real pieces before they were ready. But the real
            // pieces were ALREADY ready the instant distribute completed (dayBoxRects, which the
            // real boxes are laid out from, is exactly what distribute's own targets came from) —
            // the only thing that version was actually protecting against was the box FRAME
            // popping in unfaded, which piecesHidden used to hide by gating the whole box
            // (frame included) behind one hard, non-animated opacity toggle. That's fixed at the
            // source now (hidePieces only masks the image), so there's nothing left to wait for.
            unstable_batchedUpdates(() => {
              setRevealDate(null);
              setGrowing(null);
              goToDay(ds, {
                fadeInChrome: true,
                onChromeFadeDone: () => { transitioningRef.current = false; },
              });
            });
          });
        });
      });
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealDate]);

  // Day->month transition: (1) fade out everything in day view EXCEPT the actual piece images
  // (box frames fade too); (2) once dayBoxRects has each piece's real box position, converge them
  // into one shared, centered stack; (3) shrink that stack into the destination month cell;
  // (4) cut to month view once that completes.
  function startClosingTransition() {
    if (transitioningRef.current) { logCalTiming("startClosingTransition called but already transitioning, ignored", Date.now()); return; }
    logCalTiming("startClosingTransition invoked", Date.now());
    // Entering month view here in both branches below — safe to reset monthChromeOpacity
    // unconditionally right now, before month is even mounted (day view is what's on screen),
    // for the same race reason goToDay resets dayChromeOpacity on ITS way in rather than
    // openDaySpread resetting it on the way out. Starts at 0 (not 1) now — it fades in only once
    // the shrink animation actually completes, rather than the month chrome being instantly
    // fully visible the moment view flips over with no reveal of its own.
    monthChromeOpacity.setValue(0);
    if (!focusOutfit || focusOutfit.garments.length === 0) {
      unstable_batchedUpdates(() => { setView("month"); setMonthFadeKey(k => k + 1); });
      return;
    }
    const closingDate = focusDate;
    const closingGarments = focusOutfit.garments.filter(g => bucketOf(g) !== "accessory" && g.image);
    transitioningRef.current = true;
    // TEMPORARY timing instrumentation — every prior attempt to find where the multi-second
    // gap in this transition actually comes from has relied on inferring timing from a screen
    // recording (imprecise, and everything native-driven ticks with zero JS-visible output, so a
    // recording can't tell "a native animation is genuinely running" apart from "the JS thread
    // is stuck"). console.log calls DO show up in the OS log, timestamped, regardless of which
    // of those is true — this pins the real answer down to a specific phase instead of another
    // guess. Remove once the actual slow phase is identified and fixed.
    const t0 = Date.now();
    const dt = () => Date.now() - t0;
    logCalTiming("tap received", 0);
    // Waited on BEFORE the fade-out even starts, not just left to whatever's already in
    // dayBoxRectsRef by the time gather reads it — a day reached via prev/next (goToDay's own
    // fadeInChrome path, not through openDaySpread's own distribute) never runs
    // waitForBoxRects at all on the way in, so a fast enough tap-to-close right after switching
    // days could start gathering before every box has even measured once. Missing an origin
    // entirely just drops that one piece from the overlay (ConvergeOverlay skips anything
    // without both an origin and a target) — a real, if different, version of the same "not
    // everything was ready yet" symptom. Waiting here first means gather always has a real
    // measured rect for every piece before it ever animates anything.
    waitForBoxRects(closingGarments.map(g => g.id)).then(() => {
    logCalTiming(`waitForBoxRects resolved`, dt());
    // Deferred by the same double-rAF used everywhere else in this transition (see
    // runConvergeAfterMount's own comment for the full reasoning) — this specific fade-out was
    // the one spot in the whole chain that called .start() immediately, straight out of a
    // promise continuation, with no defer at all. A promise resolving is not a guarantee the JS
    // thread is actually free right then — if something else had it busy at that exact instant,
    // this animation's own native setup could land late enough that its first visible frame was
    // already well into (or past) the fade, reading as chrome just vanishing instead of fading —
    // a real, reported symptom ("sometimes things just seem to disappear immediately"), and the
    // one place in this function that never had the same protection every other phase transition
    // already does.
    requestAnimationFrame(() => requestAnimationFrame(() => {
    Animated.timing(dayChromeOpacity, {
      toValue: 0, duration: TRANSITION_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      logCalTiming(`fade-out done, gather starting`, dt());
      // Batched for the same reason as openDaySpread's grow-phase start — this fires from a
      // native Animated completion callback, which React does not auto-batch.
      unstable_batchedUpdates(() => {
        setClosingPhase("gather");
        setGathering(true);
      });
      runConvergeAfterMount(gatherP, async () => {
        logCalTiming(`gather done, resize starting`, dt());
        // Phase 3: resize IN PLACE (still centered, one shared point) from the gathered size
        // down to MONTH_CELL_IMG — the exact size the piece will be inside the destination month
        // cell — before it starts moving toward that cell at all. Measuring the destination
        // happens at the same time, since neither depends on the other.
        const destReady = measureDestinationCell(closingDate);
        setClosingPhase("resize");
        await new Promise<void>(resolve => runConvergeAfterMount(shrinkResizeP, resolve));
        logCalTiming(`resize done`, dt());
        const rect = await destReady;
        logCalTiming(`measureDestinationCell resolved (rect=${rect ? "ok" : "null"})`, dt());
        // A deliberate beat at the gathered/resized center before the diagonal move to the
        // destination cell starts — per explicit feedback that resize-then-immediately-shrink
        // read as one motion happening too fast to register as two separate, purposeful steps
        // (converge to center, THEN travel diagonally) rather than a single continuous slide.
        // Runs even when destReady already resolved during the resize animation itself (the
        // common case, since measureDestinationCell's 400ms budget usually finishes well before
        // shrinkResizeP's 260ms does) — otherwise the pause would only ever appear on the rarer
        // slow-measurement path, making the pacing inconsistent depending on how fast the
        // measurement happened to be.
        await new Promise<void>(resolve => setTimeout(resolve, 180));
        logCalTiming(`pause done, shrink starting`, dt());
        if (!rect) {
          unstable_batchedUpdates(() => { setView("month"); setGathering(false); setMonthFadeKey(k => k + 1); });
          transitioningRef.current = false;
          return;
        }
        // Phase 4: shrink — the destination is ALREADY known and the piece is ALREADY at
        // MONTH_CELL_IMG size, so closingPhase and shrinkTarget flip together, atomically, and
        // this phase is a pure position move with no further scale change. An earlier version
        // flipped closingPhase to "shrink" BEFORE the destination was measured, which meant the
        // overlay briefly rendered with origins===targets (both defaulting to the gathered
        // center) — pieces would sit frozen there for a beat, then "reset" back to center-ish and
        // replay once the real target finally arrived, reading as the animation running twice.
        unstable_batchedUpdates(() => {
          setClosingPhase("shrink");
          setShrinkTarget(rect);
        });
        // Reverted the concurrent-reveal restructuring attempted here — two variants both broke
        // the shrink motion itself (the piece stayed frozen at its gathered/centered position and
        // never visibly moved to the destination cell), even with the reveal's setView deferred by
        // the same double-rAF this file uses elsewhere: the concurrent re-measurement polling in
        // monthFadeBeforeRef (measureDestinationCell, up to 400ms of its own rAF-driven loop)
        // overlapping with shrinkP's own active animation was still enough contention to break it,
        // not just which one got the first frame. Back to sequential — reveal begins only once the
        // piece has actually landed. The "refresh" this was meant to fix is a real, separate
        // problem still worth solving, but not at the cost of the one animation this transition
        // actually revolves around.
        runConvergeAfterMount(shrinkP, () => {
          logCalTiming(`shrink done, atomic swap to month view`, dt());
          // Atomic swap — mirrors openDaySpread's own month->day handoff exactly (see its
          // distribute-completion comment: "clearing growing HERE, immediately... swaps the
          // frozen overlay for the real images in one atomic batch with no visible change").
          // That handoff only works there because the day view's piece images are NEVER gated
          // by dayChromeOpacity — only the frame/chrome around them fades. The month grid's own
          // cell images WERE gated by monthChromeOpacity, which is exactly why this direction
          // couldn't do the same atomic swap and instead kept the overlay frozen for the entire
          // 280ms chrome fade as a workaround — the two transitions were structurally different,
          // not just visually. closingHiddenDate (passed to MonthBody below) now excludes the
          // destination cell's own image from monthChromeOpacity's fade the same way
          // growHiddenDate already does for the opening direction, so this can clear the overlay
          // in the SAME batch as setView instead of waiting out the whole fade first.
          unstable_batchedUpdates(() => {
            setView("month");
            setGathering(false);
            setShrinkTarget(null);
            setMonthFadeKey(k => k + 1);
          });
          // transitioningRef stays true until the chrome fade for the REST of the month view
          // (header, day-labels, every other cell) actually finishes — same timing discipline
          // openDaySpread's own onChromeFadeDone already uses, so a new transition can't start
          // mid-fade even though the overlay itself already handed off immediately above.
          monthFadeDoneRef.current = () => {
            logCalTiming(`monthChromeOpacity fade-in done, FULLY SETTLED`, dt());
            transitioningRef.current = false;
          };
        });
      });
    });
    }));
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Nothing else lives in the top-right corner — that's always ShowNavButton's spot (see
         useSuppressNavButton usage elsewhere / the app-wide button-collision policy). REGEN
         used to sit here via justifyContent:"space-between" and directly overlapped it. */}
      <View style={styles.topRow}>
        <TextButton
          label={view === "day" ? "MONTH VIEW" : "TODAY"}
          size={10}
          color={colors.textMuted}
          // openDaySpread already falls back to a plain goToDay when there's no stack to
          // animate (today has no outfit yet) — same rule the month grid's own cells use, so
          // TODAY behaves exactly like tapping today's cell directly.
          onPress={() => (view === "day" ? startClosingTransition() : openDaySpread(todayStr))}
          // TEMPORARY (__DEV__ only) — long-press dumps logCalTiming's AsyncStorage-backed
          // timeline (see its own header comment for why console.log doesn't work here) via the
          // share sheet, for diagnosing the white-screen repro. A long-press on this existing
          // button rather than a separate one placed nearby — the previous version sat close
          // enough to the floating bottom nav bar's own button to register as a double-tap on
          // both. onLongPress and onPress are mutually exclusive per gesture in React Native, so
          // this can't interfere with the button's real short-tap behavior. Remove once fixed.
          onLongPress={__DEV__ ? () => {
            const log = getCached<{ label: string; t: number; at: string }[]>("__caltiming_log__") ?? [];
            Share.share({ message: log.map(e => `[${e.at}] +${e.t}ms  ${e.label}`).join("\n") || "no log entries yet" }).catch(() => {});
          } : undefined}
        />
      </View>

      {/* Both day and month content are ALWAYS mounted now — only visibility/interactivity
         (opacity + pointerEvents) switches with `view`, never actual presence in the tree. An
         earlier version conditionally rendered only whichever view was active, tearing the
         other one's entire tree down and rebuilding it from scratch on every single transition
         — confirmed directly, via real per-phase timestamps logged from three separate live
         test runs, to cost 4-6 SECONDS every time (the "gather" and final chrome-fade-in phases,
         the only two points in the transition where a MonthBody instance — a ~35-cell grid, each
         cell its own Animated.View plus conditional garment images — went from unmounted to
         mounted). Every OTHER phase in those same runs landed within a couple hundred ms of its
         coded duration; only the two phases that coincided with a fresh mount blew up, by roughly
         20x. Keeping both trees permanently mounted (paying that cost once, at whatever point
         CalendarScreen itself first mounts, rather than on every single transition) also makes
         the separate "hidden measuring probe" MonthBody instance that used to sit below entirely
         redundant — the one real, always-mounted instance already provides dayStackRefs/
         monthAreaH/monthBlockH at all times, visible or not, so that whole duplicate mount (and
         its own share of this exact cost) is deleted below instead of kept around.
         React.memo on MonthBody (see its own definition) is what keeps this permanently-mounted
         instance cheap while invisible: props only actually change when the underlying data does,
         not on every render of this component, so it mostly just sits idle. */}
      <View style={{ flex: 1 }}>
        {/* 0.001, not a literal 0, when inactive — a subtree sitting at true opacity 0 can be
           skipped by the native compositor as a real performance optimization (nothing to
           composite, no pixels contributed), meaning the exact moment this flips to 1 can pay a
           one-time real compositing setup cost (allocating render targets, bringing the ~35-cell
           month grid's images into the composited layer tree) right when the transition needs to
           be smooth — a plausible contributor to the reported "refresh" independent of whether
           monthChromeOpacity itself fades cleanly. 0.001 keeps this wrapper permanently in the
           composited layer tree (that one-time cost is paid harmlessly at mount, long before any
           transition), while being visually indistinguishable from fully invisible — and unlike
           making this permanently opaque, it can never make the inactive view visibly bleed
           through, since dayChromeOpacity/monthChromeOpacity aren't guaranteed to be 0 while
           their view is inactive (both default to 1) — 0.001 compounded with anything up to 1 is
           still imperceptible. */}
        <View style={[StyleSheet.absoluteFill, { opacity: view === "day" ? 1 : 0.001 }]} pointerEvents={view === "day" ? "auto" : "none"}>
        <View style={{ flex: 1 }}>
          <DayHeader
            focusDate={focusDate}
            focusOutfit={focusOutfit}
            notes={focusNotes}
            weather={weather}
            generating={generating}
            onRegenClick={onRegenClick}
            onEdit={() => focusOutfit && openEdit(focusOutfit, focusDate)}
            onPrev={() => { if (!transitioningRef.current) goToDay(shiftDay(focusDate, -1)); }}
            onNext={() => { if (!transitioningRef.current) goToDay(shiftDay(focusDate, 1)); }}
            chromeOpacity={dayChromeOpacity}
          />

          {/* justifyContent:"center" — this had no justifyContent at all before, so its
             flex-start default just top-aligned DayOutfit's content and dumped every bit of
             extra room at the bottom. Invisible on a short screen (iPhone SE) where there wasn't
             much idle space to begin with; glaring on a taller one (iPhone 17e) where centering
             actually splits that idle space evenly instead of stacking it all below. */}
          <View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, alignItems: "center", justifyContent: "center" }}>
            {showLoadingUI && !focusOutfit ? (
              // paddingBottom biases the dots up off dead-center of this LEFTOVER space (below
              // DayHeader's own nav/REGEN/score rows) — centering exactly within what's left
              // after the header reads as noticeably low relative to the screen as a whole,
              // since the header itself isn't part of this flex area at all. Same nudge
              // technique already used a few lines down for DayOutfit's own pros/cons centering.
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: spacing.xl * 2 }}>
                <LoadingDots />
              </View>
            ) : !focusOutfit || focusOutfit.garments.length === 0 ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Text style={[type.body, { color: colors.textFaint }]}>No outfit for this day.</Text>
              </View>
            ) : (
              <DayOutfit
                notes={focusNotes} garments={focusOutfit.garments} chromeOpacity={dayChromeOpacity}
                onBoxMeasured={handleBoxMeasured}
                // gathering: hides the real pieces while the day->month closing overlay takes
                // over (unchanged). growing: hides them for the brief window right after the
                // month->day distribute animation cuts over to this real view but is still
                // holding its own frozen overlay on top through the chrome fade — see
                // openDaySpread's distribute completion.
                piecesHidden={gathering || !!growing}
              />
            )}
          </View>
        </View>
        </View>

        {/* 0.001 not 0 — see the matching comment on the day wrapper above for why. */}
        <View style={[StyleSheet.absoluteFill, { opacity: view === "month" ? 1 : 0.001 }]} pointerEvents={view === "month" ? "auto" : "none"}>
        <View style={{ flex: 1 }}>
          <MonthBody
            year={year} month={month} cells={cells} outfits={outfits} weather={weather} todayStr={todayStr}
            generating={generating} onRegenClick={onRegenClick}
            // Guarded the same way openDaySpread/startClosingTransition already guard
            // themselves: nothing here previously stopped a month-arrow tap from changing
            // year/month state WHILE a day's grow/distribute animation was still mid-flight
            // (that async chain holds closures over the OLD date, not the new month), so its
            // ConvergeOverlay could still land and render stray, unlabeled garment icons on top
            // of the now-different month grid once it finally resolved — a real, previously
            // unguarded race, not a rendering bug in the grid itself (getCells/MonthBody only
            // ever render exactly the current month's real cells).
            onPrevMonth={() => { if (transitioningRef.current) return; setSelectedDate(null); setMonth(m => (m === 1 ? (setYear(y => y - 1), 12) : m - 1)); }}
            onNextMonth={() => { if (transitioningRef.current) return; setSelectedDate(null); setMonth(m => (m === 12 ? (setYear(y => y + 1), 1) : m + 1)); }}
            onOpenDay={openDaySpread}
            onSelectDay={ds => setSelectedDate(d => (d === ds ? null : ds))}
            monthChromeOpacity={monthChromeOpacity}
            revealDate={revealDate}
            growHiddenDate={growing?.date ?? null}
            // focusDate is stable for the entire closing sequence (nothing else changes it until
            // goToDay is called, which doesn't happen here) — gathering is exclusively driven by
            // this direction, so there's no ambiguity about which cell this refers to.
            closingHiddenDate={gathering ? focusDate : null}
            dayStackRefs={dayStackRefs}
            monthBlockTranslateY={monthBlockTranslateY}
            // Was `monthMeasured ? 1 : 0` — a SECOND, independent visibility gate stacked on top
            // of monthChromeOpacity's own fade, meant only to hide the brief top-aligned-before-
            // centering flash on the very first-ever month-view mount (see monthCenterOffset's
            // comment). But monthAreaH specifically (one of monthMeasured's two required
            // measurements) could fail to ever go positive — confirmed directly via logCalTiming:
            // monthBlockH measured 319 while monthAreaH stayed 0 for the entire session, session
            // after session — permanently pinning this at 0 regardless of whether
            // monthChromeOpacity had already finished fading to 1. That's the actual white-screen
            // bug: the transition was completing correctly every time, underneath a wrapper this
            // gate never let become visible. monthChromeOpacity is already the real, working
            // fade-in; gating on TOP of it with a measurement that isn't guaranteed to ever land
            // was always the fragile part. monthAreaH/monthBlockH still feed monthCenterOffset's
            // positioning below, just no longer block visibility outright.
            monthOpacity={1}
            onBlockLayout={handleBlockLayout}
            onAreaLayout={handleAreaLayout}
            // showLoadingUI (not the raw loading/weatherReady flags) — MonthBody's own `loading`
            // prop gates both the visible LoadingDots AND the real grid content, so this is the
            // one place that needs to account for weather too, without MonthBody itself needing
            // to know weather exists at all. showLoadingUI additionally suppresses the spinner
            // once this exact month has ever loaded before, so a background refresh landing mid-
            // transition can't swap the already-correct grid out for a spinner and back again.
            loading={showLoadingUI}
          />

          {panelMounted && (
            <Animated.View style={{ flex: 1, opacity: panelOpacity, transform: [{ translateY: panelTranslateY }] }}>
              {/* Fade at the top of the scrollable panel so content disappears smoothly
                 as it passes under the calendar header above rather than hard-cutting */}
              <LinearGradient
                colors={[colors.bg, `${colors.bg}00`]}
                style={{ position: "absolute", top: 0, left: 0, right: 0, height: 32, zIndex: 1 }}
                pointerEvents="none"
              />
              <ScrollView style={styles.detailPanel} contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.lg, alignItems: "center", paddingBottom: insets.bottom + spacing.md }}>
                <Text style={type.label}>{selectedDate ? (() => { const { y, m, d } = parseDateStr(selectedDate); return `${MONTHS[m-1]} ${d}, ${y}`; })() : ""}</Text>
                {selectedDate && weather[selectedDate] && (
                  <Text style={{ fontSize: 10, color: colors.textFaint, marginTop: 2 }}>
                    {weather[selectedDate].tempF}°F · {tempCat(weather[selectedDate].tempF)}
                  </Text>
                )}
                {!selected || selected.garments.length === 0 ? (
                  <Text style={[type.body, { color: colors.textFaint, marginTop: spacing.sm }]}>No outfit for this day.</Text>
                ) : (
                  <>
                    {selectedNotes.analyzed && selectedNotes.score != null && selectedNotes.score > 0 && (
                      <Text style={{ fontSize: 24, fontWeight: "700", color: scoreColor(selectedNotes.score), marginTop: 2 }}>{selectedNotes.score}</Text>
                    )}
                    {selectedNotes.aesthetic && <Text style={[type.label, { marginTop: 2, marginBottom: spacing.sm }]}>{selectedNotes.aesthetic.toUpperCase()}</Text>}
                    <View style={{ marginTop: spacing.sm }}>
                      <OutfitSlotGrid garments={selected.garments} />
                    </View>
                  </>
                )}
                {selected && selected.garments.length > 0 && (
                  <TextButton label="VIEW DAY" size={9} color={colors.textMuted} style={{ marginTop: spacing.md }} onPress={() => goToDay(selectedDate!)} />
                )}
              </ScrollView>
            </Animated.View>
          )}
        </View>
        </View>

        {/* Hidden measuring mount for the opening distribute phase — same idea, mirrored: the
           real DayHeader+DayOutfit, invisible, positioned where the real day content will sit
           once view flips over, purely so OutfitSlotGrid's boxes report their real eventual
           positions via onBoxMeasured before the real day view ever exists.
           Nested HERE, inside this same outer flex:1 wrapper (below topRow), not as a sibling of
           it — an earlier version had this one level up, a direct sibling of topRow AND this
           whole wrapper. StyleSheet.absoluteFill sizes itself to whatever its own immediate
           parent is; one level up, that parent was the FULL SafeAreaView content area (topRow
           included), while the real day content two lines above sits INSIDE this wrapper, which
           only spans the area BELOW topRow. Both rendered the identical DayHeader+DayOutfit
           layout, but starting from two different vertical origins offset by exactly topRow's
           own height — so every box this probe measured (and handed to the distribute animation
           as its target) was already off by that same amount before the animation ever started,
           landing every piece too high, then requiring a hard, un-animated snap down the instant
           the real (correctly positioned, since it sits in the right wrapper) content took over
           and revealed the true position. Matches exactly what was reported: consistent, not
           occasional, since the offset is a fixed layout constant, not a timing race. */}
        {growing && (() => {
          const hiddenOutfit = outfits[growing.date];
          if (!hiddenOutfit) return null;
          const hiddenNotes = parseNotes(hiddenOutfit.notes);
          return (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={{ flex: 1, opacity: 0 }}>
                <DayHeader
                  focusDate={growing.date} focusOutfit={hiddenOutfit} notes={hiddenNotes} weather={weather}
                  generating={false} onRegenClick={() => {}} onEdit={() => {}} onPrev={() => {}} onNext={() => {}}
                  chromeOpacity={1}
                />
                <View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, alignItems: "center" }}>
                  <DayOutfit notes={hiddenNotes} garments={hiddenOutfit.garments} chromeOpacity={1} onBoxMeasured={handleBoxMeasured} />
                </View>
              </View>
            </View>
          );
        })()}
      </View>

      {gathering && focusOutfit && (() => {
        const closingGarments = focusOutfit.garments.filter(g => bucketOf(g) !== "accessory" && g.image);
        if (closingPhase === "gather") {
          return <ConvergeOverlay garments={closingGarments} origins={dayBoxRects} targets={centerRect(CONVERGE_TARGET)} progress={gatherP} />;
        }
        // Resize: same center point on both ends, only the CONTENT size changes — from the
        // gathered size down to MONTH_CELL_IMG, exactly what the shrink phase below uses as ITS
        // OWN starting size. Pure scale, zero position change.
        if (closingPhase === "resize") {
          return (
            <ConvergeOverlay
              garments={closingGarments} origins={centerRect(CONVERGE_TARGET)} targets={centerRect(CONVERGE_TARGET)}
              originContentSize={{ width: CONVERGE_CONTENT, height: CONVERGE_CONTENT }}
              targetContentSize={{ width: MONTH_CELL_IMG, height: MONTH_CELL_IMG }} progress={shrinkResizeP}
            />
          );
        }
        // Shrink: origin's content size matches exactly what resize just left it at, so scale
        // computes to a constant 1 the whole way — a pure position move into the destination
        // cell, no more size change happening at the same time as it travels there.
        return (
          <ConvergeOverlay
            garments={closingGarments} origins={centerRect(CONVERGE_TARGET)} targets={shrinkTarget ?? centerRect(CONVERGE_TARGET)}
            originContentSize={{ width: MONTH_CELL_IMG, height: MONTH_CELL_IMG }}
            targetContentSize={{ width: MONTH_CELL_IMG, height: MONTH_CELL_IMG }} progress={shrinkP}
            fanIndexOffset
          />
        );
      })()}

      {growing && (() => {
        const growOutfit = outfits[growing.date];
        const growGarments = growOutfit ? growOutfit.garments.filter(g => bucketOf(g) !== "accessory" && g.image) : [];
        if (growPhase === "grow") {
          return (
            <ConvergeOverlay garments={growGarments} origins={growing.origin} targets={centerRect(CONVERGE_TARGET)} progress={growP} />
          );
        }
        // Resize: same center point on both ends (origins===targets), only the CONTENT size
        // changes — from the grow phase's own centered size down to DAY_BOX_CONTENT, which is
        // exactly the size distribute's real targets use below. Pure scale, zero position change.
        if (growPhase === "resize") {
          return (
            <ConvergeOverlay
              garments={growGarments} origins={centerRect(CONVERGE_TARGET)} targets={centerRect(CONVERGE_TARGET)}
              originContentSize={{ width: CONVERGE_CONTENT, height: CONVERGE_CONTENT }}
              targetContentSize={{ width: DAY_BOX_CONTENT, height: DAY_BOX_CONTENT }} progress={growResizeP}
            />
          );
        }
        // Distribute: from the center stack out to each piece's own real day-view box position.
        // originContentSize matches exactly what the resize phase just left every piece at, so
        // scale computes to a constant 1 the whole way — a pure position move, no more size
        // change happening at the same time as the pieces head to their separate destinations.
        return (
          <ConvergeOverlay
            garments={growGarments} origins={centerRect(CONVERGE_TARGET)} targets={dayBoxRects}
            originContentSize={{ width: DAY_BOX_CONTENT, height: DAY_BOX_CONTENT }}
            targetContentFraction={0.8} progress={distributeP}
          />
        );
      })()}

      {/* A full regen deletes every day this month, including hand-edited ones — confirm first. */}
      {regenConfirm && (
        <View style={styles.confirmOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setRegenConfirm(false)} />
          <View style={styles.confirmCard}>
            <Text style={[type.title, { textAlign: "center" }]}>REGENERATE {MONTHS[month - 1]}?</Text>
            <Text style={[type.body, { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: spacing.sm, lineHeight: 18 }]}>
              This month has outfits you customized by hand. Regenerating will replace every day, including your edits. This can&apos;t be undone.
            </Text>
            <View style={{ flexDirection: "row", gap: spacing.lg, justifyContent: "center", marginTop: spacing.lg }}>
              <TextButton label="CANCEL" size={9} color={colors.textFaint} onPress={() => setRegenConfirm(false)} />
              <TextButton label="REPLACE ALL" size={9} color={colors.bad} onPress={() => { setRegenConfirm(false); handleGenerate(true); }} />
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  dayNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xl, width: "100%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingTop: spacing.sm },
  dayLabels: { flexDirection: "row", paddingHorizontal: spacing.sm, marginTop: spacing.sm },
  dayLabel: { flex: 1, textAlign: "center", fontSize: 9, color: colors.textFaint, letterSpacing: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.sm },
  // overflow:"hidden" here is the actual root fix for the "extra days"/stray-temperature bug,
  // not just the outer clip wrapper above it. A cell's content column (day number 24px + gap 4 +
  // temp text ~10px + gap 4 + a 20px outfit-stack box, when a day has one) adds up to MORE than
  // this aspectRatio:1 cell's own fixed height (~52-55px on a typical device width), and RN's
  // default overflow is "visible" — so on every row with at least one day that has an outfit
  // stack, that cell's content painted a few px past its own bottom edge. Later JSX siblings
  // paint on top, so for every row except the LAST one this bleed landed underneath the next
  // row's own cells and was invisible. The last row has no next row to hide behind, so its
  // bleed (the tail end of that cell's content) rendered into the genuinely empty space below
  // the grid — the "extra day" that was never a real day cell at all, just overflow from a real
  // one. Clipping each cell to its own box makes this structurally impossible regardless of
  // content height, independent of the outer row-count clip below (which stays as a second
  // backstop for anything else that might ever render below the real rows).
  cell: { width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" },
  // Today used to be a filled circle behind the number — in a cell this small (14.28% width,
  // square aspect ratio) that extra 24x24 badge routinely overlapped the outfit stack
  // thumbnail rendered right below it. Bolding the number instead needs no extra vertical
  // space, so it can never collide with anything else in the cell — but the box was left at its
  // old 24px height anyway. A 13pt number only needs ~16-18px, and the full per-cell content
  // stack (this box + gap + cellTemp + gap + cellStack) added up to ~62px against a real
  // ~59px-tall square cell at typical screen widths — a few pixels over, silently clipped by
  // the cell's own overflow:hidden, cutting the very bottom off the icon stack in every cell
  // that has one. Shrinking this box to fit its actual content removes that overflow instead of
  // padding it into the icon stack's clip budget.
  dayNum: { width: 24, height: 18, alignItems: "center", justifyContent: "center" },
  dayNumText: { fontSize: 13, color: colors.text },
  dayNumTextToday: { fontWeight: "700" },
  cellStack: { width: 26, height: 20, alignItems: "center", justifyContent: "center" },
  cellStackImg: { position: "absolute", width: MONTH_CELL_IMG, height: MONTH_CELL_IMG },
  detailPanel: { flex: 1, marginTop: spacing.sm },
  cellTemp: { fontSize: 8, color: colors.textFaint },
  confirmOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center", zIndex: 2000 },
  confirmCard: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, width: 300, maxWidth: "88%" },
});
