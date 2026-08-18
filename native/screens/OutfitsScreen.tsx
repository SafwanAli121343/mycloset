import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { View, Text, Image, StyleSheet, FlatList, TouchableOpacity, Animated, Dimensions, Easing, ScrollView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../lib/api";
import { LoadingDots } from "../components/LoadingDots";
import { TextButton } from "../components/TextButton";
import { ScreenCenter } from "../components/ScreenCenter";
import { BAR_CONTENT_H } from "../components/BottomNavBar";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { useSuppressNavButton } from "../lib/NavBarVisibility";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import type { SlotGarment } from "../lib/garmentSlots";

type GalleryItem = SlotGarment & {
  title: string | null; pros: string[] | null; cons: string[] | null;
  aesthetic_tags?: string[] | null; color_primary?: string | null;
};
type ComboOutfit = { score: number; itemIds: string[] };
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
  outfit, items, originRect, onClose,
}: {
  outfit: ComboOutfit; items: Record<string, GalleryItem>; originRect: Rect; onClose: () => void;
}) {
  useSuppressNavButton();
  const insets = useSafeAreaInsets();
  // No item-count cap here — the website's spread shows every piece in the outfit, not just
  // the first 4 (a 5+ piece outfit, e.g. with accessories, was silently dropping items before).
  const outfitItems = sortItems(outfit.itemIds.map(id => items[id]).filter((g): g is GalleryItem => !!g));
  const size = itemSize(outfitItems.length);
  const progress = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);

  // Matches the website's actual pacing (app/outfits/page.tsx openOutfit/closeOverlay): roughly
  // 1.2s open / 1s close, not the ~0.6s/0.5s this had before — the site plays this as three
  // clearly distinct beats (travel to center → zoom up while still stacked → fan out to the
  // spread layout), and compressing that into a much shorter, two-point animation is what read
  // as "fast and oddly timed."
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress]);

  function handleClose() {
    setClosing(true);
    Animated.timing(progress, { toValue: 0, duration: 1000, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) onClose();
    });
  }

  // Deduped and capped at 4 each — matches the website's outfit-list load (all-combos
  // response is post-processed the same way before it ever reaches display).
  // The website only shows the score AND pros/cons for ideal-scoring outfits (>=75) — a
  // below-threshold outfit's detail view is pieces only, no number, no analysis. isIdeal gates
  // both below, matching that exactly rather than always showing whatever data exists.
  const isIdeal = outfit.score >= IDEAL_THRESHOLD;
  const outfitPros = isIdeal ? [...new Set(outfitItems.flatMap(it => it.pros ?? []))].slice(0, 4) : [];
  const outfitCons = isIdeal ? [...new Set(outfitItems.flatMap(it => it.cons ?? []))].slice(0, 4) : [];
  const detailFocus: FocusItem[] = [
    ...outfitPros.map(t => ({ text: t, color: colors.good })),
    ...outfitCons.map(t => ({ text: t, color: colors.bad })),
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]} pointerEvents={closing ? "none" : "auto"}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      {isIdeal && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, right: 0, top: SCORE_Y, alignItems: "center",
            opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
          }}
        >
          <Text style={{ fontSize: 44, fontWeight: "700", color: scoreColor(outfit.score) }}>{outfit.score}</Text>
        </Animated.View>
      )}

      {outfitItems.map((it, i) => {
        const target = spreadTarget(i, outfitItems.length, size);
        const targetCenterX = target.x + size.w / 2;
        const targetCenterY = target.y + size.h / 2;
        // Origin: stacked at the tapped card's position, same small per-layer offset the
        // closed stack card itself uses, at the stack thumbnail's size.
        const originW = CARD_W * 0.6;
        const originCenterX = originRect.x + originRect.width / 2 + i * 3;
        const originCenterY = originRect.y + originRect.height / 2 - i * 3;
        // Three phases, like the website: (0→0.33) the still-overlapping stack travels from the
        // tapped card to the center of the screen as the backdrop fades to white; (0.33→0.65) it
        // holds at center and zooms up while STILL stacked (not yet spread); (0.65→1) it fans out
        // into the spread layout at full size. Position only changes in phases 1 and 3 — it holds
        // at center through the whole zoom phase, matching the site's own beat.
        const centerX = SCREEN_W / 2, centerY = PIECES_CENTER_Y + size.h / 2;
        const stackedPeakScale = (originW / size.w) * 1.55;
        const scale = progress.interpolate({
          inputRange: [0, 0.33, 0.65, 1],
          outputRange: [originW / size.w, originW / size.w, stackedPeakScale, 1],
        });
        const translateX = progress.interpolate({
          inputRange: [0, 0.33, 0.65, 1],
          outputRange: [originCenterX - targetCenterX, centerX - targetCenterX, centerX - targetCenterX, 0],
        });
        const translateY = progress.interpolate({
          inputRange: [0, 0.33, 0.65, 1],
          outputRange: [originCenterY - targetCenterY, centerY - targetCenterY, centerY - targetCenterY, 0],
        });
        return (
          <Animated.View
            key={it.id}
            pointerEvents="none"
            style={{
              position: "absolute", left: target.x, top: target.y, width: size.w, height: size.h, zIndex: 10 + i,
              transform: [{ translateX }, { translateY }, { scale }],
            }}
          >
            {it.image ? <Image source={{ uri: it.image }} style={{ width: "100%", height: "100%" }} resizeMode="contain" /> : null}
          </Animated.View>
        );
      })}

      <Animated.View
        pointerEvents={closing ? "none" : "box-none"}
        style={{ position: "absolute", left: 0, right: 0, top: ANALYSIS_TOP, height: ANALYSIS_H, opacity: progress }}
      >
        {detailFocus.length > 0 && <FocusScrollList items={detailFocus} />}
      </Animated.View>

      <Animated.View style={{ opacity: progress, position: "absolute", top: insets.top + 10, left: 16 }} pointerEvents={closing ? "none" : "auto"}>
        <TouchableOpacity onPress={handleClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
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
      <ScrollView style={styles.filterPanel} contentContainerStyle={{ padding: spacing.md }} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </Animated.View>
  );
}

// Every feasible outfit combination from your closet, ranked highest-first — same source and
// same (unfiltered) result count as the website's /outfits page (GET /api/outfits/all-combos).
export default function OutfitsScreen() {
  const [data, setData] = useState<ComboResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [spread, setSpread] = useState<{ outfit: ComboOutfit; rect: Rect; index: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [filterAesthetics, setFilterAesthetics] = useState<string[]>([]);
  const [filterColors, setFilterColors] = useState<string[]>([]);
  const [filterPieces, setFilterPieces] = useState<string[]>([]);
  const [atTop, setAtTop] = useState(true);
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const cardRefs = useRef<Record<number, View | null>>({});

  // Prefetches every piece photo a batch of outfits needs before that batch is ever added to
  // the FlatList's data — so an outfit can never become tappable before its images are ready.
  // This is what actually fixes the "pieces take a moment to load in" bug: it wasn't really
  // about images being slow, it was that fast-scrolling could reach an outfit whose photos had
  // literally never been requested yet, and only the tap itself triggered the fetch.
  function prefetchBatch(batch: ComboOutfit[], items: Record<string, GalleryItem>) {
    const uris = new Set<string>();
    for (const o of batch) for (const id of o.itemIds) {
      const uri = items[id]?.image;
      if (uri) uris.add(uri);
    }
    return Promise.all([...uris].map(u => Image.prefetch(u).catch(() => {})));
  }

  const load = useCallback(async () => {
    try {
      const res = await apiJson<ComboResponse>("/api/outfits/all-combos");
      await prefetchBatch(res.outfits.slice(0, INITIAL_PAGE_SIZE), res.items);
      setData(res);
      setVisibleCount(INITIAL_PAGE_SIZE);
    } catch {
      setData({ total: 0, items: {}, outfits: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? {};
  const allOutfits = data?.outfits ?? [];
  const outfits = useMemo(() => allOutfits.filter(o => {
    if (o.score < minScore) return false;
    const outfitItems = o.itemIds.map(id => items[id]).filter((g): g is GalleryItem => !!g);
    if (filterAesthetics.length > 0 && !outfitItems.some(it => it.aesthetic_tags?.some(t => filterAesthetics.includes(t)))) return false;
    if (filterColors.length > 0 && !outfitItems.some(it => it.color_primary && filterColors.some(c => it.color_primary!.toLowerCase() === c.toLowerCase()))) return false;
    if (filterPieces.length > 0 && !o.itemIds.some(id => filterPieces.includes(id))) return false;
    return true;
  }), [allOutfits, minScore, filterAesthetics, filterColors, filterPieces, items]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    for (const g of Object.values(items)) if (g.color_primary) set.add(g.color_primary);
    return [...set].sort();
  }, [items]);
  const availablePieces = useMemo(() => {
    return Object.values(items)
      .filter(g => g.title)
      .map(g => ({ id: g.id, label: g.title!.trim().split(/\s+/).slice(0, 3).join(" ") }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);
  const hasFilters = minScore > 0 || filterAesthetics.length > 0 || filterColors.length > 0 || filterPieces.length > 0;
  function clearFilters() {
    setMinScore(0); setFilterAesthetics([]); setFilterColors([]); setFilterPieces([]);
  }
  function toggle(arr: string[], setArr: (v: string[]) => void, v: string) {
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  }

  // Filter changes invalidate the current page window entirely — start fresh from page 1
  // rather than keeping a visibleCount that referred to the old (unfiltered) ordering. Also
  // re-prefetch that new page 1 (fire-and-forget, not blocking the filter tap): most images are
  // already cached from earlier browsing since outfits reuse the same closet photos, but a
  // filter can surface a combination whose pieces were never rendered before.
  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE);
    prefetchBatch(outfits.slice(0, INITIAL_PAGE_SIZE), items).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScore, filterAesthetics, filterColors, filterPieces]);

  const visibleOutfits = useMemo(() => outfits.slice(0, visibleCount), [outfits, visibleCount]);
  const hasMore = visibleCount < outfits.length;

  async function showMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextBatch = outfits.slice(visibleCount, visibleCount + PAGE_SIZE);
    await prefetchBatch(nextBatch, items);
    setVisibleCount(v => v + PAGE_SIZE);
    setLoadingMore(false);
  }

  function openStack(i: number, outfit: ComboOutfit) {
    const node = cardRefs.current[i];
    node?.measureInWindow((x, y, width, height) => {
      setSpread({ outfit, rect: { x, y, width, height }, index: i });
    });
  }

  // Matches Closet/Wardrobe/Builder: nothing but centered dots while loading, not a header
  // shell with blank/hidden content above them — that's what made the dots land at a visibly
  // different height here than on those other screens.
  if (loading) return <ScreenCenter><LoadingDots /></ScreenCenter>;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* FILTER sits top-left, not top-right — the "show/hide nav" toggle always lives
         top-right (see ShowNavButton), so nothing else should compete for that corner. */}
      <View style={styles.header}>
        <View style={{ width: 60 }}>
          <TextButton label={filterOpen ? "CLOSE" : "FILTER"} size={10} color={colors.textMuted} onPress={() => setFilterOpen(v => !v)} />
        </View>
        <Text style={[type.title, { flex: 1, textAlign: "center" }]}>{data ? `${outfits.length} OUTFITS` : ""}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollableFilterPanel open={filterOpen} maxHeight={SCREEN_H * 0.4}>
          {hasFilters && (
            <TextButton label="CLEAR FILTERS" size={9} color={colors.textFaint} onPress={clearFilters} style={{ alignSelf: "center", marginBottom: spacing.md }} />
          )}

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
            <Text style={{ fontSize: 13, color: colors.text, minWidth: 28, textAlign: "center" }}>{minScore > 0 ? minScore : "—"}</Text>
            <TouchableOpacity onPress={() => setMinScore(s => Math.min(100, s + 5))} hitSlop={10}>
              <Ionicons name="add" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>

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
                  <TextButton key={p.id} label={p.label} size={10} color={filterPieces.includes(p.id) ? colors.text : colors.textFaint} onPress={() => toggle(filterPieces, setFilterPieces, p.id)} />
                ))}
              </View>
            </>
          )}
      </ScrollableFilterPanel>

      {outfits.length === 0 ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.textFaint, textAlign: "center" }]}>
            {allOutfits.length === 0 ? "Add a few more items to your closet to generate outfit combinations." : "No outfits match filters."}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={visibleOutfits}
            keyExtractor={(_, i) => String(i)}
            numColumns={COLS}
            initialNumToRender={18}
            windowSize={7}
            maxToRenderPerBatch={18}
            removeClippedSubviews
            contentContainerStyle={styles.grid}
            columnWrapperStyle={{ gap: GRID_GAP }}
            onScroll={e => setAtTop(e.nativeEvent.contentOffset.y <= 4)}
            scrollEventThrottle={16}
            ListFooterComponent={hasMore ? (
              <TouchableOpacity onPress={showMore} disabled={loadingMore} style={styles.showMore}>
                {loadingMore ? <LoadingDots /> : <Text style={[type.button, { color: colors.text }]}>SHOW MORE</Text>}
              </TouchableOpacity>
            ) : null}
            renderItem={({ item: o, index: i }) => {
              const outfitItems = sortItems(o.itemIds.map(id => items[id]).filter((g): g is GalleryItem => !!g)).slice(0, 4);
              const ideal = o.score >= IDEAL_THRESHOLD;
              return (
                <TouchableOpacity
                  ref={r => { cardRefs.current[i] = r; }}
                  style={[styles.card, spread?.index === i && { opacity: 0 }]}
                  onPress={() => openStack(i, o)}
                >
                  <View style={styles.stack}>
                    {outfitItems.map((it, j) => (
                      it.image ? (
                        <Image
                          key={it.id}
                          source={{ uri: it.image }}
                          style={[styles.stackImg, { transform: [{ translateX: j }, { translateY: -j }], zIndex: j }]}
                          resizeMode="contain"
                        />
                      ) : null
                    ))}
                  </View>
                  {/* Only ideal-scoring outfits get a score label in the grid — matches the
                     website leaving non-ideal stacks unlabeled rather than showing every score. */}
                  {ideal && <Text style={{ fontSize: 13, fontWeight: "700", color: scoreColor(o.score) }}>{o.score}</Text>}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          />
          {/* Fades the grid out under the header as you scroll up, rather than content cutting
             off sharply right at the header's edge. */}
          <LinearGradient
            colors={["#ffffff", "#ffffff00"]}
            style={[styles.fadeTop, { opacity: atTop ? 0 : 1 }]}
            pointerEvents="none"
          />
        </View>
      )}

      {spread && (
        <SpreadOverlay outfit={spread.outfit} items={items} originRect={spread.rect} onClose={() => setSpread(null)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  filterPanel: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  filterLabel: { ...type.label, textAlign: "center", marginTop: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, paddingBottom: spacing.xl + BAR_CONTENT_H },
  grid: { padding: spacing.md },
  showMore: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg, minHeight: 44 },
  card: { width: CARD_W, alignItems: "center", gap: 4 },
  stack: { width: CARD_W, height: STACK_H, alignItems: "center", justifyContent: "center" },
  stackImg: { position: "absolute", width: CARD_W * 0.6, height: STACK_H * 0.78 },
  fadeTop: { position: "absolute", top: 0, left: 0, right: 0, height: 26 },
  backdrop: { backgroundColor: "#ffffffee" },
});
