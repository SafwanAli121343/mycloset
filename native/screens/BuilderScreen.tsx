import { useEffect, useState, useCallback, useRef, forwardRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Easing, PanResponder, Dimensions, type GestureResponderEvent, type PanResponderGestureState,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { apiJson, apiJsonCached, ApiError, invalidateCache } from "../lib/api";
import { getCached } from "../lib/dataCache";
import { TextButton } from "../components/TextButton";
import { ReadyGate } from "../components/ReadyGate";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { bucketOf, sortTops, type Bucket, type SlotGarment } from "../lib/garmentSlots";
import { PAYMENTS_ENABLED } from "../lib/config";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import { useEntitlements } from "../lib/billing/Entitlements";
import { NAV_ROW_TOP, NAV_ROW_H } from "../components/ShowNavButton";
import type { MainTabParamList } from "../navigation/MainTabs";

type Garment = SlotGarment & {
  title: string; brand: string | null;
  pros: string[] | null; cons: string[] | null;
};

type ScoreResult = { score: number | null; valid: boolean; reason: string | null; serverError?: boolean; locked?: boolean };
// No minimum: every scored outfit gets its score and analysis (the old 75 cut-off rejected
// lower-scoring outfits in Builder and left them unanalyzed on Outfits).
const IDEAL_THRESHOLD = 0;
type Rect = { x: number; y: number; width: number; height: number };

// How many of a given bucket an outfit can actually hold — matches the website's own outfit-
// validity rule (lib/scoring.ts: every slot maxes at 1 except "base", which allows layering up
// to 3). Everything except Top and Accessories is single-occupancy, which is also why you
// could add multiple pairs of shoes before — nothing was enforcing this on the native side.
const MAX_PER_BUCKET: Record<Bucket, number> = {
  head: 1, outer: 1, top: 1, mid: 1, bottom: 1, shoes: 1, accessory: Infinity,
};

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");
const SHEET_H = SCREEN_H * 0.5;
const SHEET_TOP = SCREEN_H - SHEET_H;
const ITEM_SIZE = 76;
// Dynamic slot widths so the silhouette never overflows on narrow devices (iPhone SE = 320pt).
// silhouette padding is spacing.lg (24pt) each side → inner content area = SCREEN_W - 48.
const SLOT_INNER_W = SCREEN_W - spacing.lg * 2;
const SLOT_WIDE_W = SLOT_INNER_W;
const SLOT_TORSO_W = Math.floor((SLOT_INNER_W - 16) / 3); // 3 slots + 2 gaps of 8pt

function measureView(ref: React.RefObject<View | null>): Promise<Rect | null> {
  return new Promise(resolve => {
    if (!ref.current) return resolve(null);
    ref.current.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}
function inRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

const Slot = forwardRef<View, {
  label: string; items: Garment[]; single: boolean; onTap: () => void; onRemove: (id: string) => void; style?: object;
}>(function Slot({ label, items, single, onTap, onRemove, style }, ref) {
  const showSingle = single && items.length > 0;
  const isEmpty = items.length === 0;
  return (
    <View ref={ref} collapsable={false} style={[styles.slot, style]}>
      <TouchableOpacity onPress={onTap} style={StyleSheet.absoluteFill} activeOpacity={isEmpty ? 0.6 : 1} />
      {/* Always-mounted empty placeholder — opacity-switched so the Image (if present) mounts
         once and stays mounted, never triggering a remount/reload flash when an item is added. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", opacity: isEmpty ? 1 : 0 }]}>
        <Text style={{ fontSize: 20, color: colors.textFaint, textAlign: "center" }}>+</Text>
        <Text style={[type.label, { fontSize: 7.5, marginTop: 2 }]}>{label}</Text>
      </View>
      {showSingle && items[0].image ? (
        <Image source={{ uri: items[0].image }} style={styles.singleImg} contentFit="contain" cachePolicy="memory-disk" transition={0} />
      ) : null}
      {showSingle ? (
        <TouchableOpacity onPress={() => onRemove(items[0].id)} style={styles.singleRemove} hitSlop={8}>
          <Text style={styles.singleRemoveText}>✕</Text>
        </TouchableOpacity>
      ) : !isEmpty ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center" }}>
          {items.map(g => (
            <TouchableOpacity key={g.id} onPress={() => onRemove(g.id)} style={styles.slotChip}>
              {g.image ? <Image source={{ uri: g.image }} style={styles.slotChipImg} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
              <Text style={styles.slotChipRemove}>✕</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
});

// The item itself just reports gesture events with absolute page coordinates — all the actual
// drag state (the floating ghost, which slot it's over, hiding the sheet) lives in
// BuilderScreen so the ghost can render above the sheet's clipped ScrollView instead of being
// cut off at the sheet's edge.
function DraggableItem({ g, isDragging, onGrant, onMove, onRelease }: {
  g: Garment; isDragging: boolean;
  onGrant: (g: Garment, pageX: number, pageY: number, origin: Rect | null) => void;
  onMove: (pageX: number, pageY: number) => void;
  onRelease: (pageX: number, pageY: number) => void;
}) {
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      // Origin is computed SYNCHRONOUSLY from the touch point now, not from an async
      // measureInWindow callback — that callback could still be unresolved by the time a very
      // fast grab-and-release gesture already reached onPanResponderRelease (measureInWindow is
      // a real native-bridge round trip, not free), leaving dragOriginRef pointed at whatever
      // the PREVIOUS drag left there (it's never reset between drags) instead of this one's real
      // origin — a stale, wrong "home" for the one path (onDragRelease's sheetOpenRef+origin
      // branch) specifically meant to prevent a miss from flying all the way off the bottom of
      // the screen. Approximating the origin as an ITEM_SIZE box centered on the touch point
      // (exactly how dragPos itself is initialized two lines below, in onDragGrant) is a few
      // pixels less precise than the real measured rect if the finger wasn't dead-center on the
      // item, but it can never be null or stale, which matters far more here than a few pixels.
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { pageX, pageY } = evt.nativeEvent;
        onGrant(g, pageX, pageY, { x: pageX - ITEM_SIZE / 2, y: pageY - ITEM_SIZE / 2, width: ITEM_SIZE, height: ITEM_SIZE });
      },
      onPanResponderMove: (_evt, gesture: PanResponderGestureState) => onMove(gesture.moveX, gesture.moveY),
      onPanResponderRelease: (_evt, gesture: PanResponderGestureState) => onRelease(gesture.moveX, gesture.moveY),
      onPanResponderTerminate: (_evt, gesture: PanResponderGestureState) => onRelease(gesture.moveX, gesture.moveY),
    })
  ).current;

  return (
    <View {...responder.panHandlers} style={styles.sheetItem}>
      {g.image ? <Image source={{ uri: g.image }} style={[styles.sheetItemImg, { opacity: isDragging ? 0 : 1 }]} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
    </View>
  );
}

// Inventory sheet lives inline in the screen (not a Modal) so a drag gesture can travel
// visually from an item in the sheet up onto a slot above it. `scrollEnabled` is turned off
// for the whole time anything is being dragged. `forceHidden` slides the whole sheet out of
// the way once the drag crosses above the sheet's top edge, so every slot is visible while
// you're choosing where to drop.
function InventorySheet({
  visible, forceHidden, items, draggingId, onGrant, onMove, onRelease, onClose,
}: {
  visible: boolean; forceHidden: boolean; items: Garment[]; draggingId: string | null;
  onGrant: (g: Garment, pageX: number, pageY: number, origin: Rect | null) => void;
  onMove: (pageX: number, pageY: number) => void;
  onRelease: (pageX: number, pageY: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SHEET_H)).current;

  useEffect(() => {
    const shouldShow = visible && !forceHidden;
    Animated.spring(translateY, { toValue: shouldShow ? 0 : SHEET_H, useNativeDriver: true, bounciness: 4 }).start();
  }, [visible, forceHidden, translateY]);

  return (
    <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY }] }]} pointerEvents={visible ? "auto" : "none"}>
      <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.sheetClose}>
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </TouchableOpacity>
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEnabled={!draggingId}
        contentContainerStyle={[styles.sheetGrid, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        {items.length === 0 && (
          <Text style={[type.body, { color: colors.textFaint, padding: spacing.xl }]}>Nothing here yet.</Text>
        )}
        {items.map(g => (
          <DraggableItem
            key={g.id} g={g} isDragging={draggingId === g.id}
            onGrant={onGrant} onMove={onMove} onRelease={onRelease}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

export default function BuilderScreen() {
  const insets = useSafeAreaInsets();
  const { hasAI } = useEntitlements();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Builder">>();
  const [allGarments, setAllGarments] = useState<Garment[]>(() => getCached<Garment[]>("/api/garments") ?? []);
  const [outfit, setOutfit] = useState<Garment[]>([]);
  const [scrollH, setScrollH] = useState(0);
  // Slot overrides for pieces not shown in their own bucket's slot: a calendar day opened for
  // editing can carry a second top (a tee under a flannel), and Top holds one piece, so the extra
  // one sits in the free Outer or Mid slot, the way the calendar's own grid draws it.
  const [placed, setPlaced] = useState<Record<string, Bucket>>({});
  const slotOf = (g: Garment): Bucket => placed[g.id] ?? bucketOf(g);
  const [loading, setLoading] = useState(!getCached("/api/garments"));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [showProsCons, setShowProsCons] = useState(false);
  const resultFade = useRef(new Animated.Value(1)).current;

  // Set when we got here via Calendar's EDIT button rather than a plain visit to the tab —
  // swaps the SCORE-only flow for a SAVE that writes back to that specific calendar day.
  const [editCtx, setEditCtx] = useState<{ date: string; outfitId?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [dragGarment, setDragGarment] = useState<Garment | null>(null);
  const dragGarmentRef = useRef<Garment | null>(null);
  const dragOriginRef = useRef<Rect | null>(null);
  const [sheetForceHidden, setSheetForceHidden] = useState(false);
  // Mirrors of sheetOpen/sheetForceHidden that onDragRelease reads instead of the raw state.
  // DraggableItem's PanResponder is built once via useRef(PanResponder.create({...})).current,
  // so its onPanResponderRelease handler permanently closes over whatever onRelease (and
  // everything IT closes over) was on that item's very FIRST render — and since inventory items
  // are populated well before the sheet is ever opened for the first time, that first render
  // always has sheetOpen=false baked in, forever, for every item. A plain `if (sheetOpen …)` read
  // inside onDragRelease would therefore always see stale, permanently-false state no matter how
  // many times the real sheet opens and closes afterward. Refs sidestep this entirely: dereferencing
  // `.current` always reads the live value regardless of which render's closure is doing the reading.
  const sheetOpenRef = useRef(false);
  const sheetForceHiddenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;
  sheetForceHiddenRef.current = sheetForceHidden;
  const dragPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const slotRefs = useRef<Record<Bucket, React.RefObject<View | null>>>({
    head: { current: null }, outer: { current: null }, top: { current: null }, mid: { current: null },
    bottom: { current: null }, shoes: { current: null }, accessory: { current: null },
  }).current;

  // Builder is a scratch pad, not a saved draft — leaving the tab (to Closet, Calendar, etc.)
  // and coming back should find it empty again, not still holding whatever combination was left
  // there. Tabs persist their mounted screens for instant switching, so without this the outfit
  // would otherwise sit in state indefinitely across visits. A save (editCtx) already clears its
  // own state on success, so this only matters for the abandon-without-saving case.
  useEffect(() => {
    const unsub = navigation.addListener("blur", () => {
      setOutfit([]);
      setResult(null);
      setShowProsCons(false);
      setSheetOpen(false);
      setEditCtx(null);
      setDragGarment(null);
      dragGarmentRef.current = null;
      setSheetForceHidden(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const lastGarmentsJsonRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await apiJsonCached<Garment[]>("/api/garments");
      // Same class of bug found and fixed in Calendar/Outfits: this refetches on every tab
      // FOCUS (see the focus listener below), on a 45s ttl, with no check that anything actually
      // changed. The common real usage pattern here is "switch to Builder, immediately grab an
      // inventory item" — meaning this background refetch is very plausibly still in flight
      // exactly while a drag is starting, handing the inventory sheet a brand-new (but usually
      // identical) `allGarments` array — and therefore a brand-new `sheetItems` — mid-gesture.
      // Skipping the update when nothing actually changed removes that churn entirely rather
      // than relying on the drag machinery being provably unaffected by it.
      const json = JSON.stringify(data);
      if (lastGarmentsJsonRef.current !== json) {
        lastGarmentsJsonRef.current = json;
        setAllGarments(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reload garments on focus so items added in AddItem are immediately visible without restart.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => { load(); });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Consumes Calendar's edit hand-off exactly once per navigate() call: params only carry
  // useful data right after Calendar sends them, so they're cleared immediately after being
  // read (via setParams) rather than left around to re-trigger this on every unrelated
  // re-render or re-visit of this already-mounted tab.
  useEffect(() => {
    const p = route.params;
    if (!p?.editDate || allGarments.length === 0) return;
    const matched = (p.initialIds ?? [])
      .map(id => allGarments.find(g => g.id === id))
      .filter((g): g is Garment => !!g);
    const extraTops = sortTops(matched.filter(g => bucketOf(g) === "top")).slice(1);
    const nextPlaced: Record<string, Bucket> = {};
    const free = (["outer", "mid"] as Bucket[]).filter(b => !matched.some(g => bucketOf(g) === b));
    for (const g of extraTops) { const b = free.shift(); if (b) nextPlaced[g.id] = b; }
    setPlaced(nextPlaced);
    setOutfit(matched);
    setEditCtx({ date: p.editDate, outfitId: p.editOutfitId });
    setResult(null);
    setShowProsCons(false);
    navigation.setParams({ editDate: undefined, editOutfitId: undefined, initialIds: undefined });
  }, [route.params, allGarments, navigation]);

  async function saveEdit() {
    if (!editCtx) return;
    setSaving(true);
    try {
      const garment_ids = outfit.map(g => g.id);
      if (editCtx.outfitId) {
        await apiJson("/api/outfits", { method: "PUT", body: JSON.stringify({ id: editCtx.outfitId, garment_ids }) });
      } else {
        await apiJson("/api/outfits", { method: "POST", body: JSON.stringify({ date: editCtx.date, garment_ids }) });
      }
      // Also drops all-combos/other months that include this outfit; Calendar itself does a
      // fresh load on refreshAt.
      invalidateCache("/api/outfits");
      setEditCtx(null);
      setOutfit([]);
      setResult(null);
      navigation.navigate("Calendar", { refreshAt: Date.now() });
    } catch {
      // leave editCtx active so SAVE can be retried without losing the in-progress edit
    } finally {
      setSaving(false);
    }
  }
  function cancelEdit() {
    setEditCtx(null);
    setOutfit([]);
    setResult(null);
    setShowProsCons(false);
  }
  // Plain reset (not tied to an edit hand-off) — clears the outfit-in-progress and its score so
  // you can start a fresh combination without leaving the tab.
  function resetBuilder() {
    setOutfit([]);
    setResult(null);
    setShowProsCons(false);
  }

  const outfitIds = new Set(outfit.map(g => g.id));
  const canScore =
    outfit.some(g => bucketOf(g) === "top") &&
    outfit.some(g => bucketOf(g) === "bottom") &&
    outfit.some(g => bucketOf(g) === "shoes");

  // Single-occupancy buckets (every slot but Accessories, Top included) replace whatever was
  // already there instead of stacking a second one in — Top used to take 3, drawn stacked in one
  // box, so earlier tops peeked out behind the newest and reappeared when it was removed.
  function addItem(g: Garment) {
    const bucket = bucketOf(g);
    const max = MAX_PER_BUCKET[bucket];
    setOutfit(prev => {
      const inBucket = prev.filter(x => slotOf(x) === bucket);
      if (inBucket.length >= max) {
        if (max === 1) return [...prev.filter(x => slotOf(x) !== bucket), g];
        return prev;
      }
      return [...prev, g];
    });
    setResult(null);
    setShowProsCons(false);
  }
  function removeItem(id: string) {
    setOutfit(prev => prev.filter(g => g.id !== id));
    setResult(null);
    setShowProsCons(false);
  }

  function onDragGrant(g: Garment, pageX: number, pageY: number, origin: Rect | null) {
    dragGarmentRef.current = g;
    dragOriginRef.current = origin;
    setDragGarment(g);
    setSheetForceHidden(false);
    dragPos.setValue({ x: pageX - ITEM_SIZE / 2, y: pageY - ITEM_SIZE / 2 });
  }
  // Sticky: once the drag has crossed above the sheet's top edge, the sheet stays hidden for
  // the rest of THAT gesture, even if the finger moves back down again (e.g. re-aiming at
  // BOTTOM/SHOES, which sit lower on screen) — it used to toggle live off the current fingertip
  // position, so the sheet would slide back open mid-drag, while the piece was still in hand,
  // the instant the finger dipped back below that line.
  function onDragMove(pageX: number, pageY: number) {
    dragPos.setValue({ x: pageX - ITEM_SIZE / 2, y: pageY - ITEM_SIZE / 2 });
    if (pageY < SHEET_TOP - 12) setSheetForceHidden(true);
  }
  async function onDragRelease(pageX: number, pageY: number) {
    const g = dragGarmentRef.current;
    if (!g) return;
    dragGarmentRef.current = null;
    const bucket = bucketOf(g);
    const rect = await measureView(slotRefs[bucket]);
    // A slot the inventory sheet is STILL covering (open, not yet forced away by this drag
    // crossing above its top edge) shouldn't count as a valid target even if its geometric rect
    // technically overlaps the release point — measureView reports the real position regardless
    // of what's drawn on top of it, but the user can't see that slot to aim for it, so scoring a
    // "hit" there reads as the piece vanishing into an invisible target. Slots that sit above
    // where the sheet visually starts (HEAD/TOP/OUTER/MID, typically) are never covered even
    // while the sheet is shown, so this only blocks the ones actually sitting behind it.
    const sheetCovering = sheetOpenRef.current && !sheetForceHiddenRef.current && !!rect && rect.y >= SHEET_TOP;
    if (rect && !sheetCovering && inRect(pageX, pageY, rect)) {
      // Slower, gentler settle instead of a quick linear-ish snap — 160ms at ease-out quad read
      // as a "jump" straight to the target rather than actually dropping in.
      Animated.timing(dragPos, {
        toValue: { x: rect.x + rect.width / 2 - ITEM_SIZE / 2, y: rect.y + rect.height / 2 - ITEM_SIZE / 2 },
        duration: 280,
        easing: Easing.out(Easing.back(1.15)),
        useNativeDriver: true,
      }).start(() => {
        addItem(g);
        setDragGarment(null);
        setSheetForceHidden(false);
      });
      return;
    }
    // A miss while the sheet is open has an actual visible "home" to return to — flying it all
    // the way off the bottom and then popping back into the grid never made sense while that grid
    // was right there. This checks sheetOpenRef ALONE, not also requiring the sheet to be
    // currently visible on screen: reaching for a top-row slot (HEAD/TOP/OUTER/MID) means
    // dragging above SHEET_TOP, which sets sheetForceHidden and slides the sheet away for the
    // rest of the gesture — checking !sheetForceHiddenRef here (an earlier version of this fix
    // did) meant every miss anywhere near the top row fell through to the off-screen branch
    // instead, which is exactly what "still goes all the way down" was describing. The sheet
    // reappears the instant this gesture ends regardless (setSheetForceHidden(false) below), so
    // sheetOpen is the only thing that actually needs to be true for "there's a home to return to."
    const origin = dragOriginRef.current;
    if (sheetOpenRef.current && origin) {
      Animated.timing(dragPos, {
        toValue: { x: origin.x, y: origin.y },
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setDragGarment(null);
        setSheetForceHidden(false);
      });
      return;
    }
    dragPos.stopAnimation(({ x }) => {
      Animated.timing(dragPos, {
        toValue: { x, y: SCREEN_H + ITEM_SIZE },
        duration: 260,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setDragGarment(null);
        setSheetForceHidden(false);
      });
    });
  }

  async function handleScore() {
    setScoring(true);
    setShowProsCons(false);
    try {
      const data = await apiJson<ScoreResult>("/api/scoring/outfit", {
        method: "POST",
        body: JSON.stringify({ garmentIds: outfit.map(g => g.id) }),
      });
      setResult(data);
    } catch (e) {
      setResult({ score: 0, valid: false, reason: e instanceof ApiError ? e.message : "Something went wrong.", serverError: true });
    } finally {
      setScoring(false);
    }
  }

  const isEligible = !!result?.valid && result.score != null && result.score >= IDEAL_THRESHOLD;

  // Auto-fade a non-eligible result (invalid combo, server error, or a valid-but-low score) —
  // exactly like the website: fade starts at 3.2s, result clears at 3.9s, so the box doesn't
  // just sit there forever demanding a dismiss tap.
  useEffect(() => {
    if (!result || isEligible) { resultFade.setValue(1); return; }
    resultFade.setValue(1);
    const fadeT = setTimeout(() => Animated.timing(resultFade, { toValue: 0, duration: 700, useNativeDriver: true }).start(), 3200);
    const clearT = setTimeout(() => setResult(null), 3900);
    return () => { clearTimeout(fadeT); clearTimeout(clearT); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Wrapped in ReadyGate (components/ReadyGate.tsx): dots until the whole builder is drawn.
  if (loading) {
    return <ReadyGate ready={false} />;
  }

  // Top gets the same base-layer-first sort the website's Builder applies (isOuterCapableTop) —
  // so the primary/first Top chip is always a true base layer, not whichever button-up/oxford
  // happened to be added first.
  const inBucket = (b: Bucket) => {
    const items = outfit.filter(g => slotOf(g) === b);
    return b === "top" ? sortTops(items) : items;
  };
  const sheetItems = allGarments.filter(g => !outfitIds.has(g.id));
  // Only meaningful (and only shown) once you've actually scored this exact combination —
  // pros/cons for an unscored outfit could be stale from a previous combination. Deduped and
  // capped at 4 each, exactly like the website's handleScore().
  const pros = isEligible ? [...new Set(outfit.flatMap(g => g.pros ?? []))].slice(0, 4) : [];
  const cons = isEligible ? [...new Set(outfit.flatMap(g => g.cons ?? []))].slice(0, 4) : [];
  const prosConsFocus: FocusItem[] = [
    ...pros.map(p => ({ text: p, color: colors.good })),
    ...cons.map(c => ({ text: c, color: colors.bad })),
  ];

  return (
    <ReadyGate ready>
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {editCtx && (
        // Editing a calendar day: SAVE then CANCEL, top left, where the "EDITING <date>" label was.
        <View style={styles.editBanner}>
          <TextButton label={saving ? "SAVING..." : "SAVE"} size={9} color={colors.gold} loading={saving} disabled={saving} onPress={saveEdit} />
          <TextButton label="CANCEL" size={9} color={colors.textFaint} onPress={cancelEdit} />
        </View>
      )}

      <View style={styles.topRow}>
        {/* Errors only — a score shows under the boxes (with RESET in SCORE's place). */}
        {result ? (
          isEligible || (result.locked && !PAYMENTS_ENABLED) ? null : (
            <Animated.View style={[styles.resultError, { opacity: resultFade }]}>
              <Text style={styles.resultErrorTitle}>{result.locked ? "AI SCORING LOCKED" : result.serverError ? "SOMETHING WENT WRONG" : "ACCESS DENIED"}</Text>
              <Text style={styles.resultErrorBody}>
                {result.locked
                  ? "Upgrade to score outfits with AI."
                  : result.serverError
                  ? "Couldn't score that outfit. Try again."
                  : !result.valid
                  ? `This outfit combination is not valid: ${result.reason ?? "missing required pieces"}.`
                  : "Couldn't score that outfit. Try again."}
              </Text>
            </Animated.View>
          )
        ) : null}
      </View>

      {/* The boxes, score and SCORE/RESET stay centered in the first screenful (minHeight = the
         visible height), so scoring never shifts the boxes; the pros and cons sit below it,
         reached by scrolling down. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.silhouetteScroll}
        onLayout={e => setScrollH(e.nativeEvent.layout.height)}
        scrollEnabled={!dragGarment}
      >
       <View style={[styles.silhouette, { minHeight: scrollH, paddingBottom: insets.bottom + spacing.lg }]}>
        <Slot ref={slotRefs.head} label="HEAD" single items={inBucket("head")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotHead} />

        <View style={styles.torsoRow}>
          <Slot ref={slotRefs.outer} label="OUTER" single items={inBucket("outer")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotTorso} />
          <Slot ref={slotRefs.top} label="TOP" single items={inBucket("top")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotTorso} />
          <Slot ref={slotRefs.mid} label="MID" single items={inBucket("mid")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotTorso} />
        </View>

        <Slot ref={slotRefs.bottom} label="BOTTOM" single items={inBucket("bottom")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotWide} />
        <Slot ref={slotRefs.shoes} label="SHOES" single items={inBucket("shoes")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotWide} />
        <Slot ref={slotRefs.accessory} label="ACCESSORIES" single={false} items={inBucket("accessory")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotWide} />

        {/* Always mounted, hidden via opacity rather than conditionally rendered — a
           conditional {!sheetOpen && ...} removes this from layout the instant sheetOpen
           flips true, which is a synchronous, unanimated reflow: everything below it jumps up
           to fill the gap immediately, well before the sheet's own ~300ms spring animation
           has moved anywhere. Keeping it mounted (same reserved layout space always) means
           tapping "open inventory" is followed by exactly one thing changing on screen — the
           sheet sliding up — instead of an instant text-disappear-then-reflow-then-sheet-
           arrives sequence that read as jittery. disabled prevents a tap landing on it while
           it's invisible. */}
        <TextButton
          label="OPEN INVENTORY" size={10} color={colors.textMuted} onPress={() => setSheetOpen(true)}
          disabled={sheetOpen} style={{ marginTop: spacing.md, opacity: sheetOpen ? 0 : 1 }}
        />

        {/* Scoring is Pro-only — free users get no SCORE button at all (rather than one that
           only ever answers "AI SCORING LOCKED"); building and saving outfits still works.
           The score line's height is always reserved so the boxes never move when it appears. */}
        {hasAI && (
          <View style={styles.scoreLine}>
            {isEligible && <Text style={[styles.scoreText, { color: scoreColor(result!.score) }]}>{result!.score}</Text>}
          </View>
        )}
        {hasAI && (isEligible ? (
          <TextButton label="RESET" color={colors.bad} onPress={resetBuilder} />
        ) : (
          <TextButton
            label={scoring ? "SCORING..." : "SCORE"}
            loading={scoring}
            disabled={!canScore || scoring}
            onPress={handleScore}
          />
        ))}
       </View>

        {isEligible && (pros.length > 0 || cons.length > 0) && (
          // Bottom padding clears the floating nav bar so the last con can be scrolled into view.
          <View style={[styles.prosCons, { paddingBottom: insets.bottom + 110 }]}>
            {pros.length > 0 && <Text style={[type.label, { color: colors.good, textAlign: "center" }]}>PROS</Text>}
            {pros.map(p => <Text key={`p-${p}`} style={styles.prosConsLine}>{p}</Text>)}
            {cons.length > 0 && <Text style={[type.label, { color: colors.bad, textAlign: "center", marginTop: pros.length ? spacing.lg : 0 }]}>CONS</Text>}
            {cons.map(c => <Text key={`c-${c}`} style={styles.prosConsLine}>{c}</Text>)}
          </View>
        )}
      </ScrollView>

      <InventorySheet
        visible={sheetOpen}
        forceHidden={sheetForceHidden}
        items={sheetItems}
        draggingId={dragGarment?.id ?? null}
        onGrant={onDragGrant}
        onMove={onDragMove}
        onRelease={onDragRelease}
        onClose={() => setSheetOpen(false)}
      />

      {dragGarment && (
        <Animated.View pointerEvents="none" style={[styles.ghost, { transform: dragPos.getTranslateTransform() }]}>
          {dragGarment.image ? <Image source={{ uri: dragGarment.image }} style={styles.sheetItemImg} contentFit="contain" cachePolicy="memory-disk" transition={0} /> : null}
        </Animated.View>
      )}
    </SafeAreaView>
    </ReadyGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topRow: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: 0 },
  resultError: { backgroundColor: "#fff5f5", borderWidth: 1, borderColor: "#fca5a5", paddingVertical: 10, paddingHorizontal: 16, width: "100%" },
  resultErrorTitle: { fontSize: 9, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase", color: colors.bad, textAlign: "center", marginBottom: 4 },
  resultErrorBody: { fontSize: 11, color: colors.textMuted, lineHeight: 17, textAlign: "center" },
  editBanner: {
    flexDirection: "row", alignItems: "center", gap: 18,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  // Without an explicit style={flex:1} on the ScrollView, it sizes to its content and never
  // fills the screen — leaving flexGrow:1 below inert and a short outfit pinned to the top with
  // the rest of the screen blank underneath SCORE. silhouetteScroll makes the ScrollView itself
  // fill the remaining space so flexGrow:1 + center below actually has room to center into.
  silhouetteScroll: { flex: 1, width: "100%" },
  scoreLine: { height: 48, justifyContent: "center", alignItems: "center", marginTop: -4 },
  scoreText: { fontSize: 36, lineHeight: 44, fontWeight: "700", textAlign: "center" },
  prosCons: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm, alignItems: "center" },
  prosConsLine: { fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: "center" },
  silhouette: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, paddingTop: spacing.xs, gap: 16 },
  torsoRow: { flexDirection: "row", gap: 8 },
  slot: {
    minHeight: 84, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
    alignItems: "center", justifyContent: "center", paddingVertical: 6, paddingHorizontal: 4,
  },
  slotHead: { width: 100 },
  slotTorso: { width: SLOT_TORSO_W, minHeight: 100 },
  slotWide: { width: SLOT_WIDE_W },
  slotChip: { width: 66, height: 66, marginHorizontal: 4 },
  slotChipImg: { width: "100%", height: "100%" },
  slotChipRemove: { position: "absolute", top: -2, right: -2, color: colors.bad, fontSize: 10, fontWeight: "700" },
  // Fixed square, not a percentage of the parent slot — slotWide (BOTTOM/SHOES, 288px wide but
  // only ~84px tall) has a very different width vs height, so a percentage-based size stretched
  // into a wide rectangle instead of staying square. Matches ITEM_SIZE so the dropped ghost and
  // the item's final rendered size line up exactly, with no visible snap between the two.
  singleImg: { width: ITEM_SIZE, height: ITEM_SIZE },
  singleRemove: { position: "absolute", top: 2, right: 2, padding: 3 },
  singleRemoveText: { color: colors.bad, fontSize: 12, fontWeight: "700" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.bg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  sheetClose: { position: "absolute", top: 10, right: 12, zIndex: 20, padding: 4 },
  sheetGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.md, paddingTop: 40, gap: 12, justifyContent: "center" },
  sheetItem: { width: ITEM_SIZE, height: ITEM_SIZE, alignItems: "center", justifyContent: "center" },
  sheetItemImg: { width: "90%", height: "90%" },
  ghost: {
    position: "absolute", left: 0, top: 0, width: ITEM_SIZE, height: ITEM_SIZE,
    alignItems: "center", justifyContent: "center", zIndex: 999, elevation: 999,
  },
});
