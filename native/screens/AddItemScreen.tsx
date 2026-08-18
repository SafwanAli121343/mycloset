import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson, ApiError } from "../lib/api";
import { TextButton } from "../components/TextButton";
import { UnderlineField } from "../components/UnderlineField";
import { LoadingDots } from "../components/LoadingDots";
import { BAR_CONTENT_H } from "../components/BottomNavBar";
import { crossNewItemAgainstWardrobe, type SavedGarment } from "../lib/wardrobeCrossing";
import { colors, type, spacing } from "../theme/theme";

const CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"] as const;
type Category = (typeof CATEGORIES)[number];
type Tab = "photo" | "url";

// Direct port of app/add-item/page.tsx's VALID_FITS.
const VALID_FITS = new Set([
  "slim", "regular", "relaxed", "oversized", "baggy", "tapered", "straight", "wide", "skinny", "boxy",
]);

type AIFields = {
  title?: string; brand?: string; category?: string;
  color_primary?: string; material?: string; fit?: string; image?: string;
};

// Mirrors the website's add-item flow exactly (same two entry points — photo or product URL —
// same /api/garments/analyze AI call to auto-fill fields, same field set, same fit validation,
// same upload-then-post sequencing), reformatted for a phone: one column instead of the site's
// tutorial-modal/camera-preview layout, and native's own camera/library picker instead of
// getUserMedia. The photo-tips tutorial slides are the one piece intentionally left out — pure
// photography guidance, not a decision the app makes on the user's behalf.
export default function AddItemScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("photo");

  // imageUri: the local file, uploaded as-is on submit (the upload endpoint does its own
  // server-side background removal, same as the website's flow) — only ever set on the photo
  // tab. imagePreview: whatever should actually be shown right now (local photo, scraped
  // product image, or the background-removed version once that call resolves).
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [color, setColor] = useState("");
  const [material, setMaterial] = useState("");
  const [price, setPrice] = useState("");
  const [fit, setFit] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function resetForm() {
    setImageUri(null); setImagePreview(null);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setPrice(""); setFit("");
    setUrlInput(""); setAnalyzed(false); setUrlError(null); setFieldError(null);
  }

  function applyAIFields(fields: AIFields) {
    if (fields.title) setTitle(fields.title);
    if (fields.brand) setBrand(fields.brand);
    if (fields.category && (CATEGORIES as readonly string[]).includes(fields.category)) setCategory(fields.category as Category);
    if (fields.color_primary) setColor(fields.color_primary);
    if (fields.material) setMaterial(fields.material);
    if (fields.fit) setFit(fields.fit);
    if (fields.image) setImagePreview(fields.image);
  }

  // Non-blocking preview polish — the item's actually-stored image gets background-removed
  // server-side regardless (upload-image does its own pass), so this only affects what the user
  // sees while still on this screen, not what ends up saved.
  async function applyBgRemoval(imageUrl: string) {
    try {
      const res = await apiFetch("/api/remove-bg", { method: "POST", body: JSON.stringify({ url: imageUrl }) });
      if (!res.ok) return;
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(blob);
    } catch {
      // keep whatever preview is already showing
    }
  }

  async function runAIAnalysis(imageDataUrl?: string, productUrl?: string): Promise<boolean> {
    setAnalyzing(true);
    try {
      const fields = await apiJson<AIFields>("/api/garments/analyze", {
        method: "POST",
        body: JSON.stringify({ imageDataUrl, productUrl }),
      });
      applyAIFields(fields);
      setAnalyzed(true);
      const imageToProcess = productUrl ? fields.image : imageDataUrl;
      if (imageToProcess) applyBgRemoval(imageToProcess);
      return true;
    } catch {
      return false;
    } finally {
      setAnalyzing(false);
    }
  }

  async function pickImage(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", `mycloset needs ${fromCamera ? "camera" : "photo library"} access to add an item.`);
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mime = asset.mimeType ?? "image/jpeg";
    const dataUrl = asset.base64 ? `data:${mime};base64,${asset.base64}` : null;

    setImageUri(asset.uri);
    setImagePreview(dataUrl ?? asset.uri);
    setAnalyzed(false);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit("");
    if (dataUrl) await runAIAnalysis(dataUrl, undefined);
  }

  async function handleUrlAnalyze() {
    if (!urlInput.trim()) return;
    setUrlError(null);
    setAnalyzed(false);
    setImageUri(null); setImagePreview(null);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit("");
    const ok = await runAIAnalysis(undefined, urlInput.trim());
    if (!ok) setUrlError("Couldn't retrieve a product from that link. Try a different URL, or add the item by uploading a photo.");
  }

  async function handleAdd() {
    if (!title.trim() || !category) {
      Alert.alert("Missing info", "Title and category are required.");
      return;
    }
    if (fit.trim() && !VALID_FITS.has(fit.trim().toLowerCase())) {
      setFieldError(`"${fit.trim()}" is not a valid fit. Use: slim, regular, relaxed, oversized, baggy, tapered, straight, wide, skinny, or boxy.`);
      return;
    }
    setFieldError(null);
    setAdding(true);
    try {
      let finalImage: string | undefined = imagePreview ?? undefined;
      // Photo-tab items upload the ORIGINAL local file, not the (possibly background-removed)
      // preview — upload-image runs its own server-side removal on whatever it's given, exactly
      // matching the website's own handleAdd().
      if (imageUri) {
        const fd = new FormData();
        // React Native's FormData accepts this {uri,name,type} shape for a file part — fetch
        // streams directly from the local file, no in-memory base64 round trip needed.
        fd.append("file", { uri: imageUri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
        const upRes = await apiFetch("/api/garments/upload-image", { method: "POST", body: fd });
        if (upRes.ok) finalImage = (await upRes.json()).url;
      }

      const saved = await apiJson<SavedGarment>("/api/garments", {
        method: "POST",
        body: JSON.stringify({
          manual: true,
          title: title.trim(),
          brand: brand.trim() || undefined,
          color_primary: color.trim() || undefined,
          material: material.trim() || undefined,
          price: price.trim() || undefined,
          fit: fit.trim() || undefined,
          image: finalImage,
          category,
          link: tab === "url" ? urlInput.trim() || undefined : undefined,
        }),
      });
      Alert.alert("Added", "Item added to your closet.");
      resetForm();
      // Fire-and-forget, same as the website: never let wardrobe-leveling bookkeeping block or
      // slow down the "item added" confirmation the user is already looking at.
      if (saved?.id) crossNewItemAgainstWardrobe(saved, category).catch(() => {});
    } catch (e) {
      Alert.alert("Something went wrong", e instanceof ApiError ? e.message : "Please try again.");
    } finally {
      setAdding(false);
    }
  }

  const canAdd = !!(title.trim() && category && !adding);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* flexGrow:1 + justifyContent:"center" together, not flexGrow:1 alone — a ScrollView
         necessarily fills the screen either way (it has to, to scroll), so removing flexGrow:1
         by itself doesn't shrink anything; it just moves which layer's background shows through
         the same dead space below short content. Centering the content within that filled space
         is what actually gets rid of the visual gap, and it degrades to ordinary top-down
         scrolling on its own once content is tall enough to fill/exceed the screen (analysis
         results, error text, etc. — justifyContent:"center" has no effect once there's no slack
         left to distribute). */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingTop: spacing.lg, paddingBottom: insets.bottom + BAR_CONTENT_H + spacing.lg }}>
        <View style={styles.tabRow}>
          <TextButton label="PHOTO" size={11} color={tab === "photo" ? colors.text : colors.textFaint} onPress={() => setTab("photo")} style={styles.tabBtn} />
          <TextButton label="URL" size={11} color={tab === "url" ? colors.text : colors.textFaint} onPress={() => setTab("url")} style={styles.tabBtn} />
        </View>

        {tab === "photo" ? (
          imagePreview ? (
            <TouchableOpacity onPress={() => { setImageUri(null); setImagePreview(null); setAnalyzed(false); }} style={styles.imagePreviewWrap}>
              <Image source={{ uri: imagePreview }} style={styles.imagePreview} resizeMode="contain" />
              <Text style={styles.retake}>{analyzing ? "ANALYZING…" : "TAP TO RETAKE"}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(true)}>
                <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
                <Text style={[type.label, { marginTop: 4 }]}>CAMERA</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(false)}>
                <Ionicons name="images-outline" size={26} color={colors.textMuted} />
                <Text style={[type.label, { marginTop: 4 }]}>LIBRARY</Text>
              </TouchableOpacity>
            </View>
          )
        ) : (
          <View>
            {imagePreview && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: imagePreview }} style={styles.imagePreview} resizeMode="contain" />
              </View>
            )}
            <UnderlineField
              value={urlInput}
              onChangeText={setUrlInput}
              hint="Product URL"
              hintWidth={90}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{ marginTop: imagePreview ? spacing.md : 0 }}
            />
            <TextButton
              label={analyzing ? "ANALYZING…" : "ANALYZE"}
              onPress={handleUrlAnalyze}
              disabled={analyzing || !urlInput.trim()}
              loading={analyzing}
              style={{ alignSelf: "center", marginTop: spacing.md }}
            />
            {urlError && <Text style={[type.body, { color: colors.bad, fontSize: 12, marginTop: spacing.sm, textAlign: "center" }]}>{urlError}</Text>}
          </View>
        )}

        {analyzing && tab === "photo" && (
          <View style={{ marginTop: spacing.md, alignSelf: "center" }}><LoadingDots /></View>
        )}
        {analyzed && (
          <Text style={[type.label, { alignSelf: "center", marginTop: spacing.sm, color: colors.good }]}>AI-FILLED — REVIEW BELOW</Text>
        )}

        <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
          <UnderlineField value={title} onChangeText={setTitle} hint="Name" required hintWidth={50} />
          <UnderlineField value={brand} onChangeText={setBrand} hint="Brand" hintWidth={45} />
          <UnderlineField value={color} onChangeText={setColor} hint="Color" hintWidth={45} />
          <UnderlineField value={material} onChangeText={setMaterial} hint="Material" hintWidth={65} />
          <UnderlineField value={price} onChangeText={setPrice} hint="Price" hintWidth={45} keyboardType="decimal-pad" />
          <UnderlineField value={fit} onChangeText={setFit} hint="Fit" hintWidth={35} autoCapitalize="none" error={!!fieldError} />
          {fieldError && <Text style={[type.body, { color: colors.bad, fontSize: 12 }]}>{fieldError}</Text>}
        </View>

        <View style={[styles.catRow, { marginTop: spacing.lg }]}>
          {CATEGORIES.map(c => (
            <TextButton
              key={c}
              label={c}
              size={11}
              color={category === c ? colors.text : colors.textFaint}
              onPress={() => setCategory(c)}
              style={styles.catChip}
            />
          ))}
        </View>

        <TextButton
          label={adding ? "ADDING..." : "ADD TO CLOSET"}
          color={colors.good}
          onPress={handleAdd}
          disabled={!canAdd}
          loading={adding}
          style={{ alignSelf: "center", marginTop: spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  tabRow: { flexDirection: "row", gap: spacing.lg, justifyContent: "center", marginBottom: spacing.lg },
  tabBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  photoButtons: { flexDirection: "row", gap: spacing.md, justifyContent: "center" },
  photoBtn: {
    width: 120, height: 120, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  imagePreviewWrap: { alignItems: "center" },
  imagePreview: { width: 220, height: 220, backgroundColor: colors.fill },
  retake: { ...type.label, marginTop: spacing.sm },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, justifyContent: "center" },
  catChip: { paddingVertical: 6, paddingHorizontal: 4 },
});
