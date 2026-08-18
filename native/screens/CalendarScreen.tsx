import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, ScrollView, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { apiJson } from "../lib/api";
import { TextButton } from "../components/TextButton";
import { LoadingDots } from "../components/LoadingDots";
import { OutfitSlotGrid } from "../components/OutfitSlotGrid";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import type { SlotGarment } from "../lib/garmentSlots";
import type { MainTabParamList } from "../navigation/MainTabs";

type Garment = SlotGarment & { title: string; brand: string | null };
type OutfitDay = { id: string; notes: string | null; garments: Garment[]; customized?: boolean };
type OutfitMap = Record<string, OutfitDay>;
type Notes = { score: number | null; pros: string[]; cons: string[]; aesthetic: string | null; analyzed: boolean };
type DayWeather = { tempF: number; label: string; condition: string };

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

const today = new Date();
const TODAY_STR = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());

// Not wrapped in the outer ScrollView — only content that's genuinely unbounded (pros/cons)
// needs to scroll, and giving FocusScrollList flex:1 here (rather than nesting it inside
// another ScrollView, where flex:1 can't size against the viewport) is what lets it actually
// fill the remaining screen instead of sitting in an arbitrarily short fixed box.
// The slot grid alone (hat/outer/top/mid row, extras row, bottom, shoes, accessories) can
// easily run to 500-650px on a phone screen — taller than what's left after the header/nav
// rows above it. This used to sit inside a plain, non-scrolling View, so on anything but a
// tall device the bottom of the grid (and the pros/cons wheel entirely) was simply cut off
// with no way to reach it. Now the whole thing scrolls, and the wheel gets a fixed height
// instead of flex:1 (which only means something inside a bounded parent, not a ScrollView's
// naturally-growing content) so it still reads as a small picker-wheel window, not something
// that expands to swallow the rest of the page.
function DayOutfit({ notes, garments }: { notes: Notes; garments: Garment[] }) {
  const focusItems: FocusItem[] = [
    ...notes.pros.map(t => ({ text: t, color: colors.good })),
    ...notes.cons.map(t => ({ text: t, color: colors.bad })),
  ];
  return (
    <ScrollView style={{ flex: 1, width: "100%" }} contentContainerStyle={{ alignItems: "center", paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
      {/* Gated on "analyzed" (the notes JSON actually having pros/cons keys), not just a
         non-null score — a generated-but-not-yet-analyzed day shouldn't show a stale/zero score. */}
      {notes.analyzed && notes.score != null && notes.score > 0 && (
        <Text style={{ fontSize: 40, fontWeight: "700", color: scoreColor(notes.score), marginTop: spacing.md }}>{notes.score}</Text>
      )}
      {notes.aesthetic && <Text style={[type.label, { marginTop: 2, marginBottom: spacing.md }]}>{notes.aesthetic.toUpperCase()}</Text>}
      <OutfitSlotGrid garments={garments} />
      {!notes.analyzed && (
        <Text style={[type.body, { color: colors.textFaint, marginTop: spacing.lg }]}>No analysis yet for this outfit.</Text>
      )}
      {focusItems.length > 0 && (
        <View style={{ height: 190, width: "100%", marginTop: spacing.lg }}>
          <FocusScrollList items={focusItems} />
        </View>
      )}
    </ScrollView>
  );
}

export default function CalendarScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, "Calendar">>();
  const [view, setView] = useState<"day" | "month">("day");
  const [focusDate, setFocusDate] = useState(TODAY_STR);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [outfits, setOutfits] = useState<OutfitMap>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [weather, setWeather] = useState<Record<string, DayWeather>>({});
  const [regenConfirm, setRegenConfirm] = useState(false);

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

  const monthCenterOffset = Math.max(0, (monthAreaH - monthBlockH) / 2);
  const monthBlockTranslateY = centerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, monthCenterOffset] });
  const panelOpacity = centerAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const panelTranslateY = centerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 16] });

  // Resolve location once per mount (this tab stays mounted across the whole session), not on
  // every generate tap — so weather can be fetched proactively too, matching the website.
  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      try {
        const pos = await Location.getCurrentPositionAsync({});
        setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (userLoc) { params.set("lat", String(userLoc.lat)); params.set("lon", String(userLoc.lon)); }
    apiJson<Record<string, DayWeather>>(`/api/weather?${params}`).then(setWeather).catch(() => {});
  }, [year, month, userLoc]);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const data = await apiJson<OutfitMap>(`/api/outfits?year=${y}&month=${m}`);
      setOutfits(prev => ({ ...prev, ...data }));
    } catch {
      // keep whatever is already cached
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year, month); }, [load, year, month]);

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
  const { y: fy, m: fm, d: fd } = parseDateStr(focusDate);
  const focusWeekday = new Date(fy, fm - 1, fd).getDay();

  const selected = selectedDate ? outfits[selectedDate] : null;
  const selectedNotes = useMemo(() => parseNotes(selected?.notes ?? null), [selected]);

  function goToDay(ds: string) {
    setFocusDate(ds);
    setSelectedDate(null);
    setView("day");
    const { y, m } = parseDateStr(ds);
    if (y !== year || m !== month) { setYear(y); setMonth(m); }
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
          onPress={() => (view === "day" ? setView("month") : goToDay(TODAY_STR))}
        />
      </View>

      {view === "day" ? (
        <>
          <View style={[styles.dayNav, { marginTop: spacing.md }]}>
            <TouchableOpacity onPress={() => goToDay(shiftDay(focusDate, -1))} hitSlop={10}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={{ alignItems: "center", gap: 3 }}>
              <Text style={type.label}>{WEEKDAY[focusWeekday]}</Text>
              <Text style={type.title}>{MONTHS[fm - 1]} {fd}</Text>
              {weather[focusDate] && (
                <Text style={{ fontSize: 10, color: colors.textFaint }}>
                  {weather[focusDate].tempF}°F · {tempCat(weather[focusDate].tempF)}
                  {conditionShort(weather[focusDate].condition) ? ` · ${conditionShort(weather[focusDate].condition)}` : ""}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => goToDay(shiftDay(focusDate, 1))} hitSlop={10}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.lg, alignSelf: "center", marginTop: spacing.md }}>
            <TextButton label="REGEN" size={10} color={colors.gold} onPress={onRegenClick} disabled={generating} loading={generating} />
            {focusOutfit && focusOutfit.garments.length > 0 && (
              <TextButton label="EDIT" size={10} color={colors.textMuted} onPress={() => openEdit(focusOutfit, focusDate)} />
            )}
          </View>

          <View style={{ flex: 1, padding: spacing.lg, paddingTop: spacing.sm, alignItems: "center" }}>
            {loading && !focusOutfit ? (
              <LoadingDots style={{ marginTop: spacing.xl, alignSelf: "center" }} />
            ) : !focusOutfit || focusOutfit.garments.length === 0 ? (
              <Text style={[type.body, { color: colors.textFaint, marginTop: spacing.xl }]}>No outfit for this day.</Text>
            ) : (
              <DayOutfit notes={focusNotes} garments={focusOutfit.garments} />
            )}
          </View>
        </>
      ) : (
        <View style={{ flex: 1 }} onLayout={e => setMonthAreaH(e.nativeEvent.layout.height)}>
          <Animated.View
            onLayout={e => setMonthBlockH(e.nativeEvent.layout.height)}
            style={{ transform: [{ translateY: monthBlockTranslateY }] }}
          >
            <View style={styles.header}>
              <TouchableOpacity onPress={() => { setSelectedDate(null); setMonth(m => (m === 1 ? (setYear(y => y - 1), 12) : m - 1)); }}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </TouchableOpacity>
              <Text style={type.title}>{MONTHS[month - 1]} {year}</Text>
              <TouchableOpacity onPress={() => { setSelectedDate(null); setMonth(m => (m === 12 ? (setYear(y => y + 1), 1) : m + 1)); }}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextButton label="REGEN" size={10} color={colors.gold} onPress={onRegenClick} disabled={generating} loading={generating} style={{ alignSelf: "center", marginTop: spacing.sm }} />

            <View style={styles.dayLabels}>
              {DAY_LABELS.map((d, i) => <Text key={i} style={styles.dayLabel}>{d}</Text>)}
            </View>

            {loading ? (
              <LoadingDots style={{ marginTop: spacing.xl, alignSelf: "center" }} />
            ) : (
              <View style={styles.grid}>
                {cells.map((cell, i) => {
                  if (!cell.current) return <View key={i} style={styles.cell} />;
                  const ds = toDateStr(year, month, cell.day);
                  const outfit = outfits[ds];
                  const isToday = ds === TODAY_STR;
                  const stackPieces = outfit ? outfit.garments.filter(g => g.image).slice(0, 3) : [];
                  const w = weather[ds];
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.cell}
                      onPress={() => setSelectedDate(d => (d === ds ? null : ds))}
                    >
                      <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
                        <Text style={[styles.dayNumText, isToday && { color: "#fff" }]}>{cell.day}</Text>
                      </View>
                      {w && <Text style={styles.cellTemp}>{w.tempF}°</Text>}
                      {/* A small stack of the day's actual pieces (mirrors the Outfits grid's
                         card stacks) instead of a plain dot — reads at a glance as "here's what
                         you're wearing" rather than just "something's planned". */}
                      {stackPieces.length > 0 && (
                        <View style={styles.cellStack}>
                          {stackPieces.map((g, j) => (
                            <Image
                              key={g.id}
                              source={{ uri: g.image! }}
                              style={[styles.cellStackImg, { transform: [{ translateX: j }, { translateY: -j }], zIndex: j }]}
                              resizeMode="contain"
                            />
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </Animated.View>

          {panelMounted && (
            <Animated.View style={{ flex: 1, opacity: panelOpacity, transform: [{ translateY: panelTranslateY }] }}>
              <ScrollView style={styles.detailPanel} contentContainerStyle={{ padding: spacing.md, alignItems: "center" }}>
                <Text style={type.label}>{selectedDate}</Text>
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
      )}

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
  cell: { width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  dayNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNumToday: { backgroundColor: colors.text },
  dayNumText: { fontSize: 13, color: colors.text },
  cellStack: { width: 26, height: 20, alignItems: "center", justifyContent: "center" },
  cellStackImg: { position: "absolute", width: 18, height: 18 },
  detailPanel: { flex: 1, marginTop: spacing.sm },
  cellTemp: { fontSize: 8, color: colors.textFaint },
  confirmOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center", zIndex: 2000 },
  confirmCard: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, width: 300, maxWidth: "88%" },
});
