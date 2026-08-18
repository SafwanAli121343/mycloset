import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Animated, Easing, StyleSheet, TouchableOpacity, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiJson, ApiError } from "../lib/api";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { LoadingDots } from "../components/LoadingDots";
import { ScreenCenter } from "../components/ScreenCenter";
import { TextButton } from "../components/TextButton";
import { UnderlineField } from "../components/UnderlineField";
import { chunk3 } from "../lib/chunk";
import { colors, type, spacing, scoreColor } from "../theme/theme";

type Garment = {
  id: string; title: string; brand: string | null; sub_type: string | null;
  category: string | null; color_primary: string | null; image: string | null;
  pros: string[] | null; cons: string[] | null;
  color_pairings: string[] | null; color_clashes: string[] | null;
  style_pairings: string[] | null;
};

type EditState = { id: string; title: string; brand: string; color_primary: string; category: string };
const EDIT_CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];
const SLIDE_TRAVEL = 340;

// Direct port of app/closet/page.tsx's mobile view: same section set/order (Pros, Pairs With,
// Colors, Cons, Avoid, Overdone), same edit/remove actions and their side effects (calendar
// regen for affected months, wardrobe-leveling cleanup), same live pairings refresh and
// pending-analysis poll. The slide transition (native's own Animated implementation, matching
// the site's slideOut/slideIn keyframes) and the picker-wheel body text are native's format
// adaptations of the same underlying data and actions.
function EditModal({ initial, onSave, onClose }: {
  initial: EditState;
  onSave: (updated: { title?: string; brand: string | null; color_primary: string | null; category?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({
      title: fields.title.trim() || undefined,
      brand: fields.brand.trim() || null,
      color_primary: fields.color_primary.trim() || null,
      category: fields.category || undefined,
    });
    setSaving(false);
    setSaveDone(true);
    setTimeout(onClose, 2000);
  }

  return (
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.modalCard}>
        <TouchableOpacity onPress={onClose} style={styles.modalClose} hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        <View style={{ gap: spacing.md }}>
          <UnderlineField value={fields.title} onChangeText={t => setFields(f => ({ ...f, title: t }))} hint="Title" hintWidth={50} />
          <UnderlineField value={fields.brand} onChangeText={t => setFields(f => ({ ...f, brand: t }))} hint="Brand" hintWidth={45} />
          <UnderlineField value={fields.color_primary} onChangeText={t => setFields(f => ({ ...f, color_primary: t }))} hint="Primary Color" hintWidth={90} />
        </View>

        <View style={[styles.catRow, { marginTop: spacing.lg }]}>
          {EDIT_CATEGORIES.map(c => (
            <TextButton
              key={c}
              label={c}
              size={10}
              color={fields.category === c ? colors.text : colors.textFaint}
              onPress={() => setFields(f => ({ ...f, category: c }))}
            />
          ))}
        </View>

        {saveDone ? (
          <Text style={[type.label, { color: colors.good, alignSelf: "center", marginTop: spacing.lg }]}>DONE!</Text>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg }}>
            <TextButton label="CANCEL" size={10} color={colors.bad} onPress={onClose} />
            <TextButton label={saving ? "SAVING..." : "SAVE"} size={10} color={colors.good} onPress={handleSave} disabled={saving} loading={saving} />
          </View>
        )}
      </View>
    </View>
  );
}

export default function ClosetScreen() {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [overdoneMap, setOverdoneMap] = useState<Record<string, string>>({});
  const [freshPairings, setFreshPairings] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editItem, setEditItem] = useState<EditState | null>(null);
  const slideX = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const refreshedRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    setError(false);
    try {
      const [data, scoring, waState] = await Promise.all([
        apiJson<Garment[]>("/api/garments"),
        apiJson<{ pieces?: { id: string; score: number }[] }>("/api/scoring").catch(() => null),
        apiJson<{ analysisHistory?: { overdone: { description: string; suggestion: string }[] }[]; currentLevel?: number } | null>("/api/wardrobe/state").catch(() => null),
      ]);
      setGarments(data);
      if (scoring?.pieces) {
        const map: Record<string, number> = {};
        for (const p of scoring.pieces) map[p.id] = p.score;
        setScores(map);
      }
      if (waState?.analysisHistory?.length && (waState.currentLevel ?? 0) >= 1) {
        const level = Math.max(1, Math.min(waState.currentLevel ?? 1, waState.analysisHistory.length));
        const analysis = waState.analysisHistory[level - 1];
        // Re-checked against the CURRENT wardrobe (just fetched), not the frozen count from
        // whenever this level's analysis was generated.
        const liveSubTypeCounts: Record<string, number> = {};
        for (const g of data) if (g.sub_type) liveSubTypeCounts[g.sub_type] = (liveSubTypeCounts[g.sub_type] ?? 0) + 1;
        const omap: Record<string, string> = {};
        for (const o of analysis?.overdone ?? []) {
          if ((liveSubTypeCounts[o.description] ?? 0) >= 3) omap[o.description.toLowerCase()] = o.suggestion;
        }
        setOverdoneMap(omap);
      }
      const seed: Record<string, string[]> = {};
      for (const g of data) {
        seed[g.id] = g.style_pairings ?? [];
        if (g.style_pairings?.length) refreshedRef.current.add(g.id);
      }
      setFreshPairings(seed);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    garments.forEach(g => { if (g.image) Image.prefetch(g.image).catch(() => {}); });
  }, [garments]);

  // Items just added may still be mid-analysis (pros === null) — poll for the completed result
  // instead of leaving those sections permanently blank until the next full reload. Bounded to a
  // handful of attempts per pending set: an item whose analysis genuinely never completes (a
  // failed AI call, e.g.) would otherwise keep this refetching every 3.5s forever — each refetch
  // is a brand new garments array, so every screen consumer re-renders (and any in-flight
  // animation reading stale state via closures) on an endless loop.
  const pollAttemptsRef = useRef(0);
  const lastPendingKeyRef = useRef("");
  useEffect(() => {
    const pending = garments.filter(g => g.pros === null);
    if (pending.length === 0) { pollAttemptsRef.current = 0; lastPendingKeyRef.current = ""; return; }
    const pendingKey = pending.map(g => g.id).sort().join(",");
    if (pendingKey !== lastPendingKeyRef.current) { lastPendingKeyRef.current = pendingKey; pollAttemptsRef.current = 0; }
    if (pollAttemptsRef.current >= 4) return;
    pollAttemptsRef.current += 1;
    const timer = setTimeout(async () => {
      try {
        const fresh = await apiJson<Garment[]>("/api/garments");
        setGarments(fresh);
      } catch {}
    }, 3500);
    return () => clearTimeout(timer);
  }, [garments]);

  // Silent background refresh of "Pairs With" for the item currently in view — once per item,
  // no loading state, matches the website's own quiet refresh-on-view behavior.
  useEffect(() => {
    const item = garments[index];
    if (!item || refreshedRef.current.has(item.id)) return;
    refreshedRef.current.add(item.id);
    apiJson<{ pairings: string[] }>(`/api/garments/pairings?id=${item.id}`)
      .then(data => { if (data?.pairings?.length) setFreshPairings(prev => ({ ...prev, [item.id]: data.pairings })); })
      .catch(() => {});
  }, [index, garments]);

  // The slide-IN half used to run inside the slide-OUT callback, immediately after calling
  // setIndex — but setIndex doesn't commit synchronously, so the slide-in animation was
  // starting (and native-thread-animating into view) BEFORE React had actually re-rendered
  // with the new index. For a frame or two it was sliding in the item you were already on
  // (whatever was last committed), only swapping to the correct next item once the state
  // update caught up mid-animation. Moving the slide-in into an effect keyed on `index`
  // guarantees it only ever starts after that commit has already happened.
  const pendingDirRef = useRef<"left" | "right" | null>(null);
  useEffect(() => {
    const dir = pendingDirRef.current;
    if (!dir) return;
    pendingDirRef.current = null;
    slideX.setValue(dir === "right" ? SLIDE_TRAVEL : -SLIDE_TRAVEL);
    Animated.timing(slideX, { toValue: 0, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(() => {
      busy.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function navigate(dir: "left" | "right") {
    if (busy.current || garments.length < 2) return;
    busy.current = true;
    const outTo = dir === "right" ? -SLIDE_TRAVEL : SLIDE_TRAVEL;
    Animated.timing(slideX, { toValue: outTo, duration: 180, easing: Easing.in(Easing.ease), useNativeDriver: true }).start(() => {
      pendingDirRef.current = dir;
      setIndex(i => (dir === "right" ? (i + 1) % garments.length : (i - 1 + garments.length) % garments.length));
    });
  }

  function confirmRemove() {
    const item = garments[index];
    if (!item) return;
    Alert.alert("Remove item?", `${item.brand ?? item.title} will be removed from your closet.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeItem(item.id) },
    ]);
  }

  async function removeItem(id: string) {
    try {
      const data = await apiJson<{ affectedMonths?: string[] }>(`/api/garments?id=${id}`, { method: "DELETE" });
      // Fire-and-forget: regenerate any calendar months whose outfits included this item, and
      // clean up its wardrobe-leveling crossings — native reads live state (no local cache to
      // mirror the deletion into), so this DELETE is the direct equivalent of the website's
      // cache-mutation-then-eventual-resync approach.
      for (const monthKey of data.affectedMonths ?? []) {
        const [y, m] = monthKey.split("-").map(Number);
        apiJson("/api/outfits/generate", { method: "POST", body: JSON.stringify({ year: y, month: m, overwrite: false }) }).catch(() => {});
      }
      apiJson(`/api/wardrobe/state/cross?garmentId=${id}`, { method: "DELETE" }).catch(() => {});
      const updated = garments.filter(g => g.id !== id);
      setGarments(updated);
      setIndex(prev => Math.min(prev, Math.max(updated.length - 1, 0)));
    } catch (e) {
      Alert.alert("Couldn't remove that item", e instanceof ApiError ? e.message : "Try again.");
    }
  }

  function openEdit() {
    const item = garments[index];
    if (!item) return;
    setEditItem({ id: item.id, title: item.title, brand: item.brand ?? "", color_primary: item.color_primary ?? "", category: item.category ?? "" });
  }

  async function saveEdit(updated: { title?: string; brand: string | null; color_primary: string | null; category?: string }) {
    if (!editItem) return;
    try {
      await apiJson("/api/garments", { method: "PATCH", body: JSON.stringify({ id: editItem.id, ...updated }) });
      setGarments(prev => prev.map(g => (g.id === editItem.id ? { ...g, ...updated } as Garment : g)));
    } catch {
      // modal shows DONE! regardless of a transient failure here, matching the website; a
      // stale field is corrected on next full reload
    }
  }

  if (loading) {
    return (
      <ScreenCenter>
        <LoadingDots />
      </ScreenCenter>
    );
  }

  if (error) {
    return (
      <ScreenCenter>
        <Text style={type.body}>Couldn't load your wardrobe.</Text>
        <TouchableOpacity onPress={load} style={{ marginTop: spacing.md }}>
          <Text style={[type.button, { color: colors.text, textDecorationLine: "underline" }]}>RETRY</Text>
        </TouchableOpacity>
      </ScreenCenter>
    );
  }

  if (garments.length === 0) {
    return (
      <ScreenCenter>
        <Ionicons name="shirt-outline" size={64} color={colors.textFaint} />
        <Text style={[type.label, { marginTop: spacing.md, fontSize: 12 }]}>YOUR CLOSET IS EMPTY</Text>
      </ScreenCenter>
    );
  }

  const item = garments[index];
  const pairingsForItem = freshPairings[item.id] ?? [];
  const overdoneSuggestion = item.sub_type ? overdoneMap[item.sub_type.toLowerCase()] : undefined;

  // Same section set and order as the website's mobile view: Pros, Pairs With, Colors, Cons,
  // Avoid, then Overdone only when this item's sub_type is currently overrepresented.
  const focusItems: FocusItem[] = [];
  if (item.pros?.length) {
    focusItems.push({ key: "h-pros", text: "PROS", color: colors.textFaint });
    item.pros.forEach((p, i) => focusItems.push({ key: `pros-${i}`, text: p, color: colors.good }));
  } else {
    focusItems.push({ key: "h-pros", text: "PROS", color: colors.textFaint });
    focusItems.push({ key: "pros-empty", text: item.pros === null ? "analyzing…" : "none", color: colors.textFaint });
  }
  focusItems.push({ key: "h-pairs", text: "PAIRS WITH", color: colors.textFaint });
  if (pairingsForItem.length > 0) {
    // One full line per pairing, not grouped 3-per-row like color names — each entry is a
    // whole compound description ("Item | category | color → style label", per the AI prompt's
    // own format spec in app/api/garments/pairings/route.ts), not a short word. Treating it
    // like the short color-name rows badly overflowed the screen on both edges.
    pairingsForItem.forEach((p, i) => focusItems.push({ key: `pairs-${i}`, text: p, color: colors.textMuted }));
  } else {
    focusItems.push({
      key: "pairs-empty",
      text: item.pros === null ? "analyzing…" : "nothing in your wardrobe pairs well with this yet — add more items",
      color: colors.textFaint,
    });
  }
  if (item.color_pairings?.length) {
    focusItems.push({ key: "h-colors", text: "COLORS", color: colors.textFaint });
    chunk3(item.color_pairings).forEach((c, i) => focusItems.push({ key: `colors-${i}`, words: c, color: colors.textMuted }));
  }
  if (item.cons?.length || item.cons === null) {
    focusItems.push({ key: "h-cons", text: "CONS", color: colors.textFaint });
    if (item.cons?.length) item.cons.forEach((c, i) => focusItems.push({ key: `cons-${i}`, text: c, color: colors.bad }));
    else focusItems.push({ key: "cons-empty", text: item.cons === null ? "analyzing…" : "no cons", color: colors.textFaint });
  }
  if (item.color_clashes?.length) {
    focusItems.push({ key: "h-avoid", text: "AVOID", color: colors.textFaint });
    chunk3(item.color_clashes).forEach((c, i) => focusItems.push({ key: `avoid-${i}`, words: c, color: colors.bad }));
  }
  if (overdoneSuggestion) {
    focusItems.push({ key: "h-overdone", text: "OVERDONE", color: colors.textFaint });
    focusItems.push({ key: "overdone-0", text: overdoneSuggestion, color: colors.mid });
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={{ alignItems: "center", paddingTop: spacing.md, paddingBottom: spacing.sm }}>
        <Text style={type.title}>{item.brand ?? item.title}</Text>
        <Text style={{ fontSize: 26, fontWeight: "700", color: scoreColor(scores[item.id]), marginTop: 2 }}>
          {scores[item.id] != null ? scores[item.id] : "—"}
        </Text>
      </View>

      <View style={styles.imageRow}>
        <TouchableOpacity onPress={() => navigate("left")} disabled={garments.length < 2} style={styles.arrowBtn}>
          <Ionicons name="chevron-back" size={22} color={garments.length < 2 ? colors.border : colors.text} />
        </TouchableOpacity>

        <View style={styles.imageCard}>
          <Animated.View style={{ transform: [{ translateX: slideX }], width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            {item.image ? (
              <Animated.Image source={{ uri: item.image }} style={styles.itemImage} resizeMode="contain" />
            ) : (
              <View style={styles.itemImagePlaceholder} />
            )}
          </Animated.View>
        </View>

        <TouchableOpacity onPress={() => navigate("right")} disabled={garments.length < 2} style={styles.arrowBtn}>
          <Ionicons name="chevron-forward" size={22} color={garments.length < 2 ? colors.border : colors.text} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.lg, justifyContent: "center", marginTop: spacing.xs }}>
        <TextButton label="EDIT" size={10} color={colors.textFaint} onPress={openEdit} />
        <TextButton label="REMOVE ITEM" size={10} color={colors.textFaint} onPress={confirmRemove} />
      </View>

      {focusItems.length > 0 && (
        <View style={{ flex: 1, marginTop: spacing.sm, marginBottom: spacing.sm }}>
          <FocusScrollList items={focusItems} />
        </View>
      )}

      {editItem && <EditModal initial={editItem} onSave={saveEdit} onClose={() => setEditItem(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  imageRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  arrowBtn: { padding: spacing.md },
  imageCard: {
    width: 180, height: 180, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: colors.bg,
  },
  itemImage: { width: "85%", height: "85%" },
  itemImagePlaceholder: { width: "60%", height: "60%", backgroundColor: colors.fill },
  modalOverlay: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", zIndex: 2000 },
  modalCard: { backgroundColor: colors.bg, padding: spacing.xl, paddingTop: spacing.xl + spacing.sm, width: 320, maxWidth: "90%" },
  modalClose: { position: "absolute", top: 12, right: 14 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
});
