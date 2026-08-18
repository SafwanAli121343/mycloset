import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { apiJson, ApiError } from "../lib/api";
import { TextButton } from "../components/TextButton";
import { GridSection } from "../components/GridSection";
import { FocusScrollList } from "../components/FocusScrollList";
import { computeWardrobeImpact, type WardrobeImpact, type OverdoneNote } from "../lib/wardrobeImpact";
import { colors, type, spacing, scoreColor } from "../theme/theme";

const MAX_COMPARE = 3;
const CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];

type SlotMode = "url" | "photo";
type PreviewSlot = { open: boolean; mode: SlotMode; url: string; image: string | null };
const emptySlot = (): PreviewSlot => ({ open: false, mode: "photo", url: "", image: null });

type Analysis = {
  sub_type?: string; aesthetic_tags?: string[]; pros?: string[]; cons?: string[];
  color_pairings?: string[]; color_clashes?: string[]; formality?: string;
};
type Impact = { outfitCount: number; avgScore: number; aestheticFit: number; goodCount: number; midCount: number; badCount: number };
type ItemResult = {
  title: string; image: string | null; category: string; color_primary?: string;
  analysis: Analysis; impact: Impact;
  wImpact?: WardrobeImpact | null; overdoneNote?: OverdoneNote;
};

// AI-generated head-to-head comparison text (app/api/preview/compare, /compare3) — every point
// is genuinely relative between the compared items, not each item's standalone pros/cons.
type Cmp2 = { better0: string[]; worse0: string[]; better1: string[]; worse1: string[]; sims: string[]; diffs: string[] };
type Cmp3 = { better: string[][]; worse: string[][]; sims: string[][]; diffs: string[][] };

type IdentifyResp = {
  image?: string | null; title?: string; brand?: string; category?: string;
  color_primary?: string; material?: string; fit?: string;
};

async function identify(slot: PreviewSlot): Promise<(IdentifyResp & { image: string }) | null> {
  if (slot.mode === "photo" && slot.image) {
    const id = await apiJson<IdentifyResp>("/api/garments/analyze", { method: "POST", body: JSON.stringify({ imageDataUrl: slot.image }) });
    return { ...id, image: slot.image };
  }
  if (slot.mode === "url" && slot.url.trim()) {
    const id = await apiJson<IdentifyResp>("/api/garments/analyze", { method: "POST", body: JSON.stringify({ productUrl: slot.url.trim() }) });
    if (!id.image) return null;
    return { ...id, image: id.image };
  }
  return null;
}

// Matches the website's Preview tool exactly (app/preview/PreviewClient.tsx): up to 3 input
// slots (each a "+" tile that opens into a URL/Photo toggle), analyzed together — one item
// gives a single fit check, more than one becomes a side-by-side comparison. This is also
// where the site's "compare items" capability lives; there's no separate Compare screen.
export default function PreviewScreen() {
  const [slots, setSlots] = useState<PreviewSlot[]>(() => Array.from({ length: MAX_COMPARE }, emptySlot));
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [cmp2, setCmp2] = useState<Cmp2 | null>(null);
  const [cmp3, setCmp3] = useState<Cmp3 | null>(null);

  function updateSlot(i: number, patch: Partial<PreviewSlot>) {
    setSlots(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function pickPhoto(i: number, fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", `mycloset needs ${fromCamera ? "camera" : "photo library"} access.`);
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType ?? "image/jpeg";
    updateSlot(i, { image: `data:${mime};base64,${result.assets[0].base64}` });
  }

  function openPhotoPicker(i: number) {
    Alert.alert("Add Photo", undefined, [
      { text: "Take Photo", onPress: () => pickPhoto(i, true) },
      { text: "Choose from Library", onPress: () => pickPhoto(i, false) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const active = slots.some(s => (s.mode === "photo" && s.image) || (s.mode === "url" && s.url.trim()));

  async function analyzeAll() {
    setAnalyzing(true);
    setResults([]);
    setExpanded(null);
    setCmp2(null);
    setCmp3(null);
    try {
      const settled = await Promise.all(
        slots.map(async (s): Promise<ItemResult | null> => {
          const id = await identify(s).catch(() => null);
          if (!id) return null;
          const category = id.category && CATEGORIES.includes(id.category) ? id.category : "top";
          const deep = await apiJson<Analysis>("/api/preview/deep-analyze", {
            method: "POST",
            body: JSON.stringify({ title: id.title ?? "Item", brand: id.brand, category, color_primary: id.color_primary, material: id.material, fit: id.fit, image: id.image }),
          }).catch(() => null);
          if (!deep) return null;
          const impact = await apiJson<Impact>("/api/preview/outfit-count", {
            method: "POST",
            body: JSON.stringify({
              garment: {
                title: id.title ?? "Item", brand: id.brand, category,
                sub_type: deep.sub_type, material: id.material, color_primary: id.color_primary,
                formality: deep.formality, aesthetic_tags: deep.aesthetic_tags, pros: deep.pros, cons: deep.cons,
                color_pairings: deep.color_pairings, color_clashes: deep.color_clashes, image: id.image,
              },
            }),
          }).catch(() => null);
          if (!impact) return null;
          return { title: id.title ?? "Item", image: id.image, category, color_primary: id.color_primary, analysis: deep, impact };
        })
      );
      const good = settled.filter((r): r is ItemResult => r !== null).sort((a, b) => b.impact.avgScore - a.impact.avgScore);
      if (good.length === 0) Alert.alert("Couldn't analyze", "Try a clearer photo or a different link.");
      setResults(good);

      // Wardrobe impact per result — fired after results are already showing (scores/pros-cons
      // matter more and shouldn't wait on this), one call per item, same as the website.
      good.forEach((r, i) => {
        computeWardrobeImpact({
          title: r.title, sub_type: r.analysis.sub_type, category: r.category,
          color_primary: r.color_primary, aesthetic_tags: r.analysis.aesthetic_tags, image: r.image,
        }).then(({ impact: wImpact, overdoneNote }) => {
          setResults(prev => prev.map((x, xi) => (xi === i ? { ...x, wImpact, overdoneNote } : x)));
        });
      });

      // AI head-to-head comparison — only meaningful once there's something to compare.
      const desc = (r: ItemResult) => ({
        title: r.title, category: r.category, sub_type: r.analysis.sub_type ?? null,
        color_primary: r.color_primary ?? null, formality: r.analysis.formality ?? null,
        aesthetic_tags: r.analysis.aesthetic_tags ?? null, pros: r.analysis.pros ?? null, cons: r.analysis.cons ?? null,
      });
      if (good.length === 2) {
        apiJson<{ better_a?: string[]; worse_a?: string[]; better_b?: string[]; worse_b?: string[]; similarities?: string[]; differences?: string[] }>(
          "/api/preview/compare",
          { method: "POST", body: JSON.stringify({ a: desc(good[0]), b: desc(good[1]) }) },
        ).then(d => setCmp2({
          better0: d.better_a ?? [], worse0: d.worse_a ?? [], better1: d.better_b ?? [], worse1: d.worse_b ?? [],
          sims: d.similarities ?? [], diffs: d.differences ?? [],
        })).catch(() => {});
      } else if (good.length === 3) {
        apiJson<{
          better_a?: string[]; worse_a?: string[]; better_b?: string[]; worse_b?: string[]; better_c?: string[]; worse_c?: string[];
          sims_a?: string[]; diffs_a?: string[]; sims_b?: string[]; diffs_b?: string[]; sims_c?: string[]; diffs_c?: string[];
        }>("/api/preview/compare3", { method: "POST", body: JSON.stringify({ a: desc(good[0]), b: desc(good[1]), c: desc(good[2]) }) })
          .then(d => setCmp3({
            better: [d.better_a ?? [], d.better_b ?? [], d.better_c ?? []],
            worse: [d.worse_a ?? [], d.worse_b ?? [], d.worse_c ?? []],
            sims: [d.sims_a ?? [], d.sims_b ?? [], d.sims_c ?? []],
            diffs: [d.diffs_a ?? [], d.diffs_b ?? [], d.diffs_c ?? []],
          })).catch(() => {});
      }
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* flexGrow:1 + justifyContent:"center": before any results exist, this is just 3 empty
         "+" slots and ANALYZE — noticeably shorter than the screen, and top-anchoring it just
         because that's a ScrollView's default left a large dead gap below ANALYZE down to the
         nav bar. Centering fills that gap while degrading to normal top-down scrolling on its
         own once results (which can get tall) are showing. */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingTop: 52, paddingBottom: spacing.xl }}>
        <Text style={styles.intro}>ENTER UP TO {MAX_COMPARE} ITEMS TO SEE HOW WELL THEY'D FIT YOUR CLOSET.</Text>

        <View style={{ gap: spacing.md }}>
          {slots.map((slot, i) => (
            <View key={i}>
              {!slot.open ? (
                <TouchableOpacity style={styles.slotClosed} onPress={() => updateSlot(i, { open: true })}>
                  <Text style={styles.plus}>+</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.slotOpen}>
                  <View style={styles.modeRow}>
                    {(["photo", "url"] as SlotMode[]).map(m => (
                      <TouchableOpacity key={m} onPress={() => updateSlot(i, { mode: m })}>
                        <Text style={[styles.modeTab, slot.mode === m && styles.modeTabActive]}>{m === "url" ? "URL" : "PHOTO"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {slot.mode === "url" ? (
                    <TextInput
                      autoFocus
                      value={slot.url}
                      onChangeText={t => updateSlot(i, { url: t })}
                      placeholder="Paste URL"
                      placeholderTextColor={colors.textFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={styles.urlInput}
                    />
                  ) : (
                    <TouchableOpacity style={styles.photoDrop} onPress={() => openPhotoPicker(i)}>
                      {slot.image
                        ? <Image source={{ uri: slot.image }} style={styles.photoDropImg} resizeMode="contain" />
                        : <Text style={styles.uploadHint}>TAP TO UPLOAD</Text>}
                    </TouchableOpacity>
                  )}

                  <TextButton label="CANCEL" size={9} color={colors.bad} onPress={() => updateSlot(i, emptySlot())} style={{ marginTop: spacing.sm }} />
                </View>
              )}
            </View>
          ))}
        </View>

        <TextButton
          label={analyzing ? "ANALYZING..." : "ANALYZE"}
          color={colors.good}
          disabled={!active || analyzing}
          loading={analyzing}
          onPress={analyzeAll}
          style={{ alignSelf: "center", marginTop: spacing.xl }}
        />

        {results.length === 1 && (
          <SingleResult result={results[0]} />
        )}

        {results.length > 1 && (
          <View style={{ marginTop: spacing.xl, width: "100%" }}>
            {results.map((r, i) => {
              const cmp = results.length === 2 && cmp2
                ? { better: i === 0 ? cmp2.better0 : cmp2.better1, worse: i === 0 ? cmp2.worse0 : cmp2.worse1, sims: cmp2.sims, diffs: cmp2.diffs }
                : results.length === 3 && cmp3
                ? { better: cmp3.better[i] ?? [], worse: cmp3.worse[i] ?? [], sims: cmp3.sims[i] ?? [], diffs: cmp3.diffs[i] ?? [] }
                : null;
              return (
              <TouchableOpacity key={i} style={styles.compareCard} onPress={() => setExpanded(v => (v === i ? null : i))}>
                <View style={styles.compareRow}>
                  {r.image ? <Image source={{ uri: r.image }} style={styles.compareImg} resizeMode="contain" /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={type.label}>{i === 0 ? "BEST FIT" : `#${i + 1}`}</Text>
                    <Text style={type.body} numberOfLines={1}>{r.title}</Text>
                  </View>
                  <Text style={{ fontSize: 26, fontWeight: "700", color: scoreColor(r.impact.avgScore) }}>{r.impact.avgScore}</Text>
                </View>
                {expanded === i && (
                  <View style={{ marginTop: spacing.sm, alignItems: "center" }}>
                    {cmp ? (
                      <>
                        {cmp.better.length > 0 && <Text style={[type.label, { marginTop: spacing.sm }]}>BETTER HERE</Text>}
                        {cmp.better.map((t, ti) => <Text key={`b${ti}`} style={[type.body, { color: colors.good, fontSize: 12, textAlign: "center", marginTop: 4 }]}>{t}</Text>)}
                        {cmp.worse.length > 0 && <Text style={[type.label, { marginTop: spacing.sm }]}>WORSE HERE</Text>}
                        {cmp.worse.map((t, ti) => <Text key={`w${ti}`} style={[type.body, { color: colors.bad, fontSize: 12, textAlign: "center", marginTop: 4 }]}>{t}</Text>)}
                        {cmp.sims.length > 0 && <Text style={[type.label, { marginTop: spacing.sm }]}>SIMILARITIES</Text>}
                        {cmp.sims.map((t, ti) => <Text key={`s${ti}`} style={[type.body, { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 4 }]}>{t}</Text>)}
                        {cmp.diffs.length > 0 && <Text style={[type.label, { marginTop: spacing.sm }]}>DIFFERENCES</Text>}
                        {cmp.diffs.map((t, ti) => <Text key={`d${ti}`} style={[type.body, { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 4 }]}>{t}</Text>)}
                      </>
                    ) : (
                      <>
                        {(r.analysis.pros ?? []).map((p, pi) => <Text key={`p${pi}`} style={[type.body, { color: colors.good, fontSize: 12, textAlign: "center", marginTop: 4 }]}>{p}</Text>)}
                        {(r.analysis.cons ?? []).map((c, ci) => <Text key={`c${ci}`} style={[type.body, { color: colors.bad, fontSize: 12, textAlign: "center", marginTop: 4 }]}>{c}</Text>)}
                      </>
                    )}
                    <WardrobeImpactBlock impact={r.wImpact} overdoneNote={r.overdoneNote} />
                  </View>
                )}
              </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SingleResult({ result }: { result: ItemResult }) {
  const focusItems = [
    ...(result.analysis.pros ?? []).map(t => ({ text: t, color: colors.good })),
    ...(result.analysis.cons ?? []).map(t => ({ text: t, color: colors.bad })),
  ];
  return (
    <View style={styles.results}>
      {result.image ? <Image source={{ uri: result.image }} style={styles.resultImg} resizeMode="contain" /> : null}
      <Text style={[styles.bigScore, { color: scoreColor(result.impact.avgScore) }]}>{result.impact.avgScore}</Text>
      <Text style={type.label}>AVG SCORE ACROSS {result.impact.outfitCount} POSSIBLE OUTFITS</Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[type.title, { fontSize: 16 }]}>{result.impact.aestheticFit}%</Text>
          <Text style={type.label}>AESTHETIC FIT</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[type.title, { fontSize: 16, color: colors.good }]}>{result.impact.goodCount}</Text>
          <Text style={type.label}>GOOD</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[type.title, { fontSize: 16, color: colors.bad }]}>{result.impact.badCount}</Text>
          <Text style={type.label}>WEAK</Text>
        </View>
      </View>

      {result.analysis.aesthetic_tags && result.analysis.aesthetic_tags.length > 0 && (
        <>
          <Text style={[type.label, { marginTop: spacing.lg, textAlign: "center" }]}>AESTHETIC TAGS</Text>
          <GridSection items={result.analysis.aesthetic_tags} color={colors.textMuted} />
        </>
      )}

      {focusItems.length > 0 && (
        <>
          <Text style={[type.label, { marginTop: spacing.md, textAlign: "center" }]}>PROS & CONS</Text>
          <View style={{ height: 260, width: "100%" }}>
            <FocusScrollList items={focusItems} />
          </View>
        </>
      )}

      <WardrobeImpactBlock impact={result.wImpact} overdoneNote={result.overdoneNote} />
    </View>
  );
}

// How this item would move your EXISTING wardrobe forward, not just how it scores on its own —
// same fillsGaps/addsAesthetics/addsColors/addressesWeaknesses breakdown as the website's
// wardrobe-fill-impact card (see native/lib/wardrobeImpact.ts for the port).
function WardrobeImpactBlock({ impact, overdoneNote }: { impact?: WardrobeImpact | null; overdoneNote?: OverdoneNote }) {
  if (!impact) return null;
  const rows: { label: string; items: string[]; color: string }[] = [
    { label: "FILLS GAPS", items: impact.fillsGaps, color: colors.good },
    { label: "ADDS AESTHETICS", items: impact.addsAesthetics, color: colors.textMuted },
    { label: "ADDS COLORS", items: impact.addsColors, color: colors.textMuted },
    { label: "ADDRESSES WEAKNESSES", items: impact.addressesWeaknesses, color: colors.good },
  ].filter(r => r.items.length > 0);
  if (rows.length === 0 && !overdoneNote) return null;
  return (
    <View style={{ marginTop: spacing.lg, alignItems: "center", width: "100%" }}>
      <Text style={type.label}>WARDROBE IMPACT</Text>
      {rows.map(r => (
        <View key={r.label} style={{ marginTop: spacing.sm, alignItems: "center" }}>
          <Text style={[type.label, { fontSize: 8, color: colors.textFaint }]}>{r.label}</Text>
          {r.items.map((t, i) => <Text key={i} style={[type.body, { color: r.color, fontSize: 12, textAlign: "center", marginTop: 2 }]}>{t}</Text>)}
        </View>
      ))}
      {overdoneNote && (
        <Text style={[type.body, { color: overdoneNote.type === "pro" ? colors.good : colors.bad, fontSize: 12, textAlign: "center", marginTop: spacing.sm }]}>
          {overdoneNote.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: colors.text, textAlign: "center", lineHeight: 18, marginBottom: spacing.xl },
  slotClosed: { height: 110, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  plus: { fontSize: 26, color: colors.textFaint },
  slotOpen: { borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  modeRow: { flexDirection: "row", gap: 16, marginBottom: spacing.sm },
  modeTab: { fontSize: 10, letterSpacing: 1.2, color: colors.textFaint, fontWeight: "400" },
  modeTabActive: { color: colors.text, fontWeight: "700" },
  urlInput: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9, fontSize: 14, color: colors.text },
  photoDrop: { height: 90, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  photoDropImg: { width: "90%", height: "85%" },
  uploadHint: { fontSize: 9, letterSpacing: 1, color: colors.textFaint },
  results: { marginTop: spacing.xl, alignItems: "center" },
  resultImg: { width: 140, height: 140, marginBottom: spacing.sm },
  bigScore: { fontSize: 44, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.lg },
  stat: { alignItems: "center", gap: 2 },
  compareCard: { borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  compareRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  compareImg: { width: 50, height: 60 },
});
