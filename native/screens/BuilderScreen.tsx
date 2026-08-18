import { useEffect, useState, useCallback, useRef, forwardRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
  Animated, Easing, PanResponder, Dimensions, type GestureResponderEvent, type PanResponderGestureState,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { apiJson, ApiError } from "../lib/api";
import { TextButton } from "../components/TextButton";
import { LoadingDots } from "../components/LoadingDots";
import { ScreenCenter } from "../components/ScreenCenter";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { BAR_CONTENT_H } from "../components/BottomNavBar";
import { bucketOf, sortTops, type Bucket, type SlotGarment } from "../lib/garmentSlots";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import type { MainTabParamList } from "../navigation/MainTabs";

type Garment = SlotGarment & {
  title: string; brand: string | null;
  pros: string[] | null; cons: string[] | null;
};

type ScoreResult = { score: number; valid: boolean; reason: string | null; serverError?: boolean };
const IDEAL_THRESHOLD = 75;
type Rect = { x: number; y: number; width: number; height: number };

// How many of a given bucket an outfit can actually hold — matches the website's own outfit-
// validity rule (lib/scoring.ts: every slot maxes at 1 except "base", which allows layering up
// to 3). Everything except Top and Accessories is single-occupancy, which is also why you
// could add multiple pairs of shoes before — nothing was enforcing this on the native side.
const MAX_PER_BUCKET: Record<Bucket, number> = {
  head: 1, outer: 1, top: 3, mid: 1, bottom: 1, shoes: 1, accessory: Infinity,
};

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_H = SCREEN_H * 0.5;
const SHEET_TOP = SCREEN_H - SHEET_H;
const ITEM_SIZE = 76;

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
  return (
    <View ref={ref} collapsable={false} style={[styles.slot, style]}>
      <TouchableOpacity onPress={onTap} style={StyleSheet.absoluteFill} activeOpacity={items.length ? 1 : 0.6} />
      {items.length === 0 ? (
        <View pointerEvents="none">
          <Text style={{ fontSize: 20, color: colors.textFaint, textAlign: "center" }}>+</Text>
          <Text style={[type.label, { fontSize: 7.5, marginTop: 2 }]}>{label}</Text>
        </View>
      ) : showSingle ? (
        <>
          {items[0].image ? (
            <Image source={{ uri: items[0].image }} style={styles.singleImg} resizeMode="contain" />
          ) : null}
          {/* Only one possible occupant here (pants/shoes/etc — anything but Top or
             Accessories), so the remove control belongs to the whole box, not a per-item chip. */}
          <TouchableOpacity onPress={() => onRemove(items[0].id)} style={styles.singleRemove} hitSlop={8}>
            <Text style={styles.singleRemoveText}>✕</Text>
          </TouchableOpacity>
        </>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center" }}>
          {items.map(g => (
            <TouchableOpacity key={g.id} onPress={() => onRemove(g.id)} style={styles.slotChip}>
              {g.image ? <Image source={{ uri: g.image }} style={styles.slotChipImg} resizeMode="contain" /> : null}
              <Text style={styles.slotChipRemove}>✕</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
});

// The item itself just reports gesture events with absolute page coordinates — all the actual
// drag state (the floating ghost, which slot it's over, hiding the sheet) lives in
// BuilderScreen so the ghost can render above the sheet's clipped ScrollView instead of being
// cut off at the sheet's edge.
function DraggableItem({ g, isDragging, onGrant, onMove, onRelease }: {
  g: Garment; isDragging: boolean;
  onGrant: (g: Garment, pageX: number, pageY: number) => void;
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
      onPanResponderGrant: (evt: GestureResponderEvent) => onGrant(g, evt.nativeEvent.pageX, evt.nativeEvent.pageY),
      onPanResponderMove: (_evt, gesture: PanResponderGestureState) => onMove(gesture.moveX, gesture.moveY),
      onPanResponderRelease: (_evt, gesture: PanResponderGestureState) => onRelease(gesture.moveX, gesture.moveY),
      onPanResponderTerminate: (_evt, gesture: PanResponderGestureState) => onRelease(gesture.moveX, gesture.moveY),
    })
  ).current;

  return (
    <View {...responder.panHandlers} style={styles.sheetItem}>
      {!isDragging && g.image ? <Image source={{ uri: g.image }} style={styles.sheetItemImg} resizeMode="contain" /> : null}
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
  onGrant: (g: Garment, pageX: number, pageY: number) => void;
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
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Builder">>();
  const [allGarments, setAllGarments] = useState<Garment[]>([]);
  const [outfit, setOutfit] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [sheetForceHidden, setSheetForceHidden] = useState(false);
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

  const load = useCallback(async () => {
    try {
      const data = await apiJson<Garment[]>("/api/garments");
      setAllGarments(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const outfitIds = new Set(outfit.map(g => g.id));
  const canScore =
    outfit.some(g => bucketOf(g) === "top") &&
    outfit.some(g => bucketOf(g) === "bottom") &&
    outfit.some(g => bucketOf(g) === "shoes");

  // Single-occupancy buckets (pants, shoes, etc.) replace whatever was already there instead
  // of stacking a second one in; multi-occupancy buckets (Top's layering, Accessories) just
  // reject the add once genuinely full rather than silently going over.
  function addItem(g: Garment) {
    const bucket = bucketOf(g);
    const max = MAX_PER_BUCKET[bucket];
    setOutfit(prev => {
      const inBucket = prev.filter(x => bucketOf(x) === bucket);
      if (inBucket.length >= max) {
        if (max === 1) return [...prev.filter(x => bucketOf(x) !== bucket), g];
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

  function onDragGrant(g: Garment, pageX: number, pageY: number) {
    dragGarmentRef.current = g;
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
    if (rect && inRect(pageX, pageY, rect)) {
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

  const isEligible = !!result?.valid && result.score >= IDEAL_THRESHOLD;

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

  if (loading) {
    return <ScreenCenter><LoadingDots /></ScreenCenter>;
  }

  // Top gets the same base-layer-first sort the website's Builder applies (isOuterCapableTop) —
  // so the primary/first Top chip is always a true base layer, not whichever button-up/oxford
  // happened to be added first.
  const inBucket = (b: Bucket) => {
    const items = outfit.filter(g => bucketOf(g) === b);
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
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {editCtx && (
        <View style={styles.editBanner}>
          <Text style={[type.label, { color: colors.textMuted }]}>EDITING {editCtx.date}</Text>
          <View style={{ flexDirection: "row", gap: 18 }}>
            <TextButton label="CANCEL" size={9} color={colors.textFaint} onPress={cancelEdit} />
            <TextButton label={saving ? "SAVING..." : "SAVE"} size={9} color={colors.gold} loading={saving} disabled={saving} onPress={saveEdit} />
          </View>
        </View>
      )}

      <View style={styles.topRow}>
        {result ? (
          isEligible ? (
            <Text style={{ fontSize: 24, fontWeight: "700", color: scoreColor(result.score) }}>{result.score}</Text>
          ) : (
            <Animated.View style={[styles.resultError, { opacity: resultFade }]}>
              <Text style={styles.resultErrorTitle}>{result.serverError ? "SOMETHING WENT WRONG" : "ACCESS DENIED"}</Text>
              <Text style={styles.resultErrorBody}>
                {result.serverError
                  ? "Couldn't score that outfit — try again."
                  : !result.valid
                  ? `This outfit combination is not valid: ${result.reason ?? "missing required pieces"}.`
                  : "This outfit scored below the ideal threshold — try a different combination."}
              </Text>
            </Animated.View>
          )
        ) : <View style={{ height: 30 }} />}
      </View>

      <ScrollView
        contentContainerStyle={[styles.silhouette, { paddingBottom: BAR_CONTENT_H + insets.bottom + spacing.lg }]}
        scrollEnabled={!dragGarment}
      >
        <Slot ref={slotRefs.head} label="HEAD" single items={inBucket("head")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotHead} />

        <View style={styles.torsoRow}>
          <Slot ref={slotRefs.outer} label="OUTER" single items={inBucket("outer")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotTorso} />
          <Slot ref={slotRefs.top} label="TOP" single={false} items={inBucket("top")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotTorso} />
          <Slot ref={slotRefs.mid} label="MID" single items={inBucket("mid")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotTorso} />
        </View>

        <Slot ref={slotRefs.bottom} label="BOTTOM" single items={inBucket("bottom")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotWide} />
        <Slot ref={slotRefs.shoes} label="SHOES" single items={inBucket("shoes")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotWide} />
        <Slot ref={slotRefs.accessory} label="ACCESSORIES" single={false} items={inBucket("accessory")} onTap={() => setSheetOpen(true)} onRemove={removeItem} style={styles.slotWide} />

        <TextButton label={sheetOpen ? "CLOSE INVENTORY" : "OPEN INVENTORY"} size={10} color={colors.textMuted} onPress={() => setSheetOpen(v => !v)} style={{ marginTop: spacing.md }} />

        {isEligible && prosConsFocus.length > 0 && (
          <TextButton
            label={showProsCons ? "HIDE PROS & CONS" : "VIEW PROS & CONS"}
            size={9}
            color={colors.textMuted}
            onPress={() => setShowProsCons(v => !v)}
            style={{ marginTop: spacing.sm }}
          />
        )}
        {showProsCons && isEligible && prosConsFocus.length > 0 && (
          <View style={{ height: 170, width: "100%", marginTop: 8 }}>
            <FocusScrollList items={prosConsFocus} />
          </View>
        )}

        <TextButton
          label={scoring ? "SCORING..." : "SCORE"}
          loading={scoring}
          disabled={!canScore || scoring}
          onPress={handleScore}
          style={{ marginTop: spacing.lg }}
        />
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
          {dragGarment.image ? <Image source={{ uri: dragGarment.image }} style={styles.sheetItemImg} resizeMode="contain" /> : null}
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topRow: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  resultError: { backgroundColor: "#fff5f5", borderWidth: 1, borderColor: "#fca5a5", paddingVertical: 10, paddingHorizontal: 16, width: "100%" },
  resultErrorTitle: { fontSize: 9, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase", color: colors.bad, textAlign: "center", marginBottom: 4 },
  resultErrorBody: { fontSize: 11, color: colors.textMuted, lineHeight: 17, textAlign: "center" },
  editBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm,
  },
  silhouette: { flexGrow: 1, alignItems: "center", justifyContent: "flex-start", padding: spacing.lg, paddingTop: spacing.sm, gap: 16 },
  torsoRow: { flexDirection: "row", gap: 8 },
  slot: {
    minHeight: 84, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
    alignItems: "center", justifyContent: "center", paddingVertical: 6, paddingHorizontal: 4,
  },
  slotHead: { width: 100 },
  slotTorso: { width: 96, minHeight: 100 },
  slotWide: { width: 288 },
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
