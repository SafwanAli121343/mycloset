import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson, apiJsonCached, invalidateCache, ApiError } from "../lib/api";
import { tutorialTarget } from "../lib/tutorial";
import { useEntitlements } from "../lib/billing/Entitlements";
import { setNavigationBlock } from "../lib/navigationBlock";
import { TextButton } from "../components/TextButton";
import { UnderlineField } from "../components/UnderlineField";
import { AestheticPicker } from "../components/AestheticPicker";
import { LoadingDots } from "../components/LoadingDots";
import { useStatusMessage, StatusMessage } from "../components/StatusMessage";
import { crossNewItemAgainstWardrobe, type SavedGarment } from "../lib/wardrobeCrossing";
import { BAR_CONTENT_H, BAR_BOTTOM_GAP } from "../components/BottomNavBar";
import { NAV_ROW_TOP, NAV_ROW_H } from "../components/ShowNavButton";
import { colors, type, spacing } from "../theme/theme";

// Both tabs' initial (no image yet) capture section reserves this same height — the photo tab's
// camera/library row is naturally 120px tall, the URL tab's field+button is naturally shorter —
// so switching tabs before adding anything doesn't change the overall content block's height and
// shift the tab row / everything else up or down.
const CAPTURE_SECTION_MIN_H = 120;
// Preview image size — same 220 the old scrolling version used. Removing the ScrollView (see the
// root View's own comment) didn't need shrinking this: pairing fields two-per-row instead of one
// long stacked column freed up enough room on its own to keep the image full-size and still fit
// everything with no scrolling.
// 200 (was 220): part of the tightened vertical rhythm (SECTION_GAP/ROW_GAP below) that lifts
// ADD TO CLOSET/CANCEL clear of the bottom nav bar while keeping everything on one screen.
const PREVIEW_IMG_SIZE = 200;
// One consistent rhythm for the filled-out form: SECTION_GAP between major blocks (fields,
// categories, the ADD button), ROW_GAP between field rows. Was a looser 38/28, which ran the
// CANCEL button down to the bottom bar's edge.
const SECTION_GAP = spacing.lg + 4;
const ROW_GAP = spacing.md + 6;

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
  const { hasAI } = useEntitlements();
  const [tab, setTab] = useState<Tab>("photo");
  const { status, showStatus } = useStatusMessage();

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
  // Always user-entered, never AI-filled — /api/garments/analyze only returns basic
  // identification fields (title/brand/category/color/material/fit), never a guessed aesthetic.
  // This is the one tag both free and paid users pick themselves via AestheticPicker, which is
  // exactly what makes it usable as a free-tier, non-AI signal for style matching elsewhere
  // (see /api/garments/pairings's color+aesthetic fallback for a free/lapsed user).
  const [aesthetic, setAesthetic] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [adding, setAdding] = useState(false);

  // Block navigation while AI analysis is running — tapping another tab would abandon
  // the analysis mid-flight; the banner lets the user consciously confirm they want to leave.
  useEffect(() => {
    if (analyzing) {
      setNavigationBlock({ message: "AI analysis is in progress. Leave and cancel it?", onCancel: resetForm });
    } else {
      setNavigationBlock(null);
    }
    return () => setNavigationBlock(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing]);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function resetForm() {
    setImageUri(null); setImagePreview(null);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setPrice(""); setFit(""); setAesthetic("");
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
  //
  // The ArrayBuffer -> base64 conversion below used to accumulate into a single string via `+=`
  // in a loop (`binary += String.fromCharCode(...)`), which is the classic slow path for this —
  // repeated `+=` re-copies the whole string so far on every chunk, meaning cost grows
  // quadratically with image size, all synchronously on the JS thread (nothing else can render
  // while it runs). That was very likely the real cause behind "the image takes a moment to pop
  // in": collecting each chunk into an array and joining ONCE at the end is the standard fix —
  // same total character-building work, but done once instead of on every chunk. Chunk size
  // itself (8192) is unrelated to this and stays the same — that limit exists so
  // String.fromCharCode's own argument spread never exceeds what an engine allows in one call.
  async function applyBgRemoval(imageUrl: string) {
    try {
      const res = await apiFetch("/api/remove-bg", { method: "POST", body: JSON.stringify({ url: imageUrl }) });
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const chunkSize = 8192;
      const chunks: string[] = [];
      for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
      }
      setImagePreview(`data:image/png;base64,${btoa(chunks.join(""))}`);
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
      showStatus(`mycloset needs ${fromCamera ? "camera" : "photo library"} access to add an item.`, "bad");
      return;
    }
    // See PreviewScreen's identical pickPhoto for why 0.5: a full-resolution photo at 0.8 sent
    // as an inline base64 data URI, analyzed at detail:"high", risks tripping the OpenAI
    // circuit breaker's 15s per-call timeout (lib/openaiCircuitBreaker.ts).
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mime = asset.mimeType ?? "image/jpeg";
    const dataUrl = asset.base64 ? `data:${mime};base64,${asset.base64}` : null;

    setImageUri(asset.uri);
    setImagePreview(dataUrl ?? asset.uri);
    setAnalyzed(false);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit(""); setAesthetic("");
    if (dataUrl) await runAIAnalysis(dataUrl, undefined);
  }

  async function handleUrlAnalyze() {
    if (!urlInput.trim()) return;
    setUrlError(null);
    setAnalyzed(false);
    setImageUri(null); setImagePreview(null);
    setTitle(""); setBrand(""); setCategory(""); setColor(""); setMaterial(""); setFit(""); setAesthetic("");
    const ok = await runAIAnalysis(undefined, urlInput.trim());
    if (!ok) setUrlError("Couldn't retrieve a product from that link. Try a different URL, or add the item by uploading a photo.");
  }

  async function handleAdd() {
    if (!title.trim() || !category) {
      showStatus("Title and category are required.", "bad");
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
          aesthetic: aesthetic.trim() || undefined,
          image: finalImage,
          category,
          link: tab === "url" ? urlInput.trim() || undefined : undefined,
        }),
      });
      // Without this, Closet/Outfits/Builder keep serving whatever /api/garments and
      // /api/scoring responses they'd already cached (up to 45s stale, or older still if some
      // other screen's own fetch is what's backing that shared cache entry) — the new item
      // would show up with no score at all until that cache happened to expire on its own.
      invalidateCache("/api/garments");
      invalidateCache("/api/scoring");
      invalidateCache("/api/outfits");
      // Settle everything Closet will show for this item BEFORE confirming the add, so it's
      // already sitting there complete when the user switches tabs — no "closet is empty"
      // flash, no text appearing before its image, no Pairs With popping in a moment later.
      //   1. Pairings first: the endpoint also persists style_pairings, so it must land before
      //      the garments refetch below. Cached under the same path Closet reads it from.
      //   2. The image is decoded into the memory/disk cache now, not on first view.
      //   3. Re-warming /api/garments (and scores for Pro) writes the shared cache, which the
      //      always-mounted Closet subscribes to — it updates in the background immediately.
      // Each step is best-effort: a failure only means Closet fetches that piece itself later.
      if (saved?.id) {
        await Promise.all([
          apiJsonCached(`/api/garments/pairings?id=${saved.id}`, 10 * 60_000).catch(() => null),
          saved.image ? Image.prefetch(saved.image, "memory-disk").catch(() => false) : null,
        ]);
        await Promise.all([
          apiJsonCached("/api/garments").catch(() => null),
          hasAI ? apiJsonCached("/api/scoring?skipOutfits=1").catch(() => null) : null,
        ]);
      }
      resetForm();
      // Shown AFTER resetForm() clears the image/fields — the status message itself lives
      // outside that conditionally-rendered block (see the tab row's own position below) so it
      // stays visible for its full 3s regardless.
      showStatus("Item successfully added!", "good");
      // Fire-and-forget, same as the website: never let wardrobe-leveling bookkeeping block or
      // slow down the "item added" confirmation the user is already looking at.
      if (saved?.id) crossNewItemAgainstWardrobe(saved, category).catch(() => {});
    } catch (e) {
      showStatus(e instanceof ApiError ? e.message : "Something went wrong. Please try again.", "bad");
    } finally {
      setAdding(false);
    }
  }

  const canAdd = !!(title.trim() && category && !adding);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* No ScrollView — this screen is meant to fit entirely on one page with no scrolling
         (image, fields, category row, and the ADD button all visible at once without hiding
         anything below the fold). flex:1 + justifyContent:"center" centers short content
         (nothing added yet) the same way the old ScrollView's flexGrow:1 centering did; unlike a
         ScrollView, content that somehow runs taller than the screen simply clips instead of
         scrolling. Image size and spacing are left at their original, generous values (a first
         pass that shrank both to guarantee a fit was reverted — real device testing showed it
         left a large dead-space gap at the bottom, tighter than necessary); the 2-per-row field
         layout below (instead of one long stacked column) is what actually earns the room needed
         to fit everything without scrolling.

         justifyContent switches to "flex-start" once there's an image (fields showing) — centering
         is only for the short "nothing added yet" state. With the fields block's generous spacing,
         the filled-out form got tall enough that centering it as one block pushed its TOP (the
         PHOTO/URL tab row) up past the safe area and under the notch — a real, reported bug, not
         just a cosmetic preference. Anchoring to the top once there's real content to show means
         the tab row always starts right at the safe top edge no matter how tall the form gets;
         if it ever runs long it clips at the BOTTOM instead, which is a far less jarring failure
         than the top row disappearing under the status bar/notch.

         The floating BottomNavBar isn't part of this SafeAreaView's own layout (it's a sibling
         overlay elsewhere in the tree, positioned off insets.bottom directly) — without
         reserving its footprint here too, this View centers against the FULL remaining height as
         if that space were actually visible, so "centered" content would sit visibly lower than
         the true visible area above the bar. The spacer below (matching PreviewScreen's
         identical fix) reserves that footprint outside the centering pair. */}
      <View style={{ flex: 1, justifyContent: imagePreview ? "flex-start" : "center", padding: spacing.xl + 4, paddingTop: NAV_ROW_TOP }}>
        <View style={styles.tabRow} ref={tutorialTarget("add.main")} collapsable={false}>
          <TextButton label="PHOTO" size={11} color={tab === "photo" ? colors.text : colors.textFaint} onPress={() => setTab("photo")} style={styles.tabBtn} />
          <TextButton label="URL" size={11} color={tab === "url" ? colors.text : colors.textFaint} onPress={() => setTab("url")} style={styles.tabBtn} />
        </View>

        {/* Lives outside the tab/image/fields content below (which resetForm() clears on a
           successful add) so "Item successfully added!" stays visible for its full 3s instead of
           disappearing the instant the form resets. Reserves a fixed line height always, shown
           or not, so the rest of the layout doesn't shift up/down when a message appears. */}
        <View style={styles.statusSlot}>
          <StatusMessage status={status} style={{ fontSize: 12 }} />
        </View>

        {tab === "photo" ? (
          imagePreview ? (
            <TouchableOpacity onPress={() => { setImageUri(null); setImagePreview(null); setAnalyzed(false); }} style={styles.imagePreviewWrap}>
              <Image source={{ uri: imagePreview }} style={styles.imagePreview} contentFit="contain" cachePolicy="memory-disk" transition={0} />
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
                <Image source={{ uri: imagePreview }} style={styles.imagePreview} contentFit="contain" cachePolicy="memory-disk" transition={0} />
              </View>
            )}
            {/* Matches the website: the URL field + ANALYZE button disappear once analysis has
               actually filled in a result — nothing left to paste/analyze at that point. */}
            {!analyzed && (
              // Matches the photo tab's camera/library row height when there's no image yet
              // (CAPTURE_SECTION_MIN_H) — this field+button pair is naturally shorter, and
              // without reserving the same height, switching between PHOTO and URL before
              // adding anything shifted the tab row and everything below it up or down.
              <View style={!imagePreview ? { minHeight: CAPTURE_SECTION_MIN_H, justifyContent: "center" } : undefined}>
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
              </View>
            )}
            {urlError && <Text style={[type.body, { color: colors.bad, fontSize: 12, marginTop: spacing.sm, textAlign: "center" }]}>{urlError}</Text>}
          </View>
        )}


        {analyzing && tab === "photo" && (
          <View style={{ marginTop: spacing.md, alignSelf: "center" }}><LoadingDots /></View>
        )}

        {/* Matches the website's staged flow exactly: add an image/URL, run (or skip) analysis,
           THEN the editable fields appear — not all at once. Gated on having an image rather
           than on `analyzed` alone so a URL/photo that fails analysis still lets the user fill
           the fields in by hand instead of getting stuck with no way forward. */}
        {!!imagePreview && !analyzing && (
          <>
            {analyzed && (
              <Text style={[type.label, { alignSelf: "center", marginTop: spacing.md, color: colors.good }]}>AUTO-FILLED: REVIEW BELOW</Text>
            )}

            {/* 2-per-row instead of a single stacked column — the change that makes fitting this
               whole form on one screen with no scrolling possible while still keeping the image
               and spacing full-size; these are all short values (a name, a brand, a color word,
               ...) that don't need a full row each. Title pairs with Brand rather than sitting
               alone: 6 fields split evenly into 3 rows this way, instead of an awkward leftover
               single field in a row by itself. */}
            <View style={{ gap: ROW_GAP, marginTop: SECTION_GAP }}>
              <View style={styles.fieldRow}>
                <UnderlineField containerStyle={styles.fieldHalf} value={title} onChangeText={setTitle} hint="Name" required hintWidth={50} />
                <UnderlineField containerStyle={styles.fieldHalf} value={brand} onChangeText={setBrand} hint="Brand" hintWidth={45} />
              </View>
              <View style={styles.fieldRow}>
                <UnderlineField containerStyle={styles.fieldHalf} value={color} onChangeText={setColor} hint="Color" hintWidth={45} />
                <UnderlineField containerStyle={styles.fieldHalf} value={material} onChangeText={setMaterial} hint="Material" hintWidth={65} />
              </View>
              <View style={styles.fieldRow}>
                <UnderlineField containerStyle={styles.fieldHalf} value={price} onChangeText={setPrice} hint="Price" hintWidth={45} keyboardType="decimal-pad" />
                <UnderlineField containerStyle={styles.fieldHalf} value={fit} onChangeText={setFit} hint="Fit" hintWidth={35} autoCapitalize="none" error={!!fieldError} />
              </View>
              {/* Full width, not paired — its dropdown needs the room, and it's the last field
                 before the category row, so the dropdown (which floats below it) never has
                 another real field underneath it to cover. Always available for both free and
                 paid users — this is never AI-filled (see the aesthetic state's own comment). */}
              <AestheticPicker value={aesthetic} onChange={setAesthetic} />
              {fieldError && <Text style={[type.body, { color: colors.bad, fontSize: 12 }]}>{fieldError}</Text>}
            </View>

            <View style={[styles.catRow, { marginTop: SECTION_GAP }]}>
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
              style={{ alignSelf: "center", marginTop: SECTION_GAP }}
            />
            <TextButton
              label="CANCEL"
              size={10}
              color={colors.bad}
              onPress={resetForm}
              disabled={adding}
              style={{ alignSelf: "center", marginTop: spacing.md }}
            />
          </>
        )}
      </View>
      {/* Reserves the floating nav bar's own footprint outside the centering pair above — see
         the comment on the root View for why this is needed at all. */}
      <View style={{ flexShrink: 0, height: BAR_CONTENT_H + insets.bottom + BAR_BOTTOM_GAP }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // On the nav chevron's exact center line (see ShowNavButton's NAV_ROW_*) — the container's
  // paddingTop is NAV_ROW_TOP, and this row is NAV_ROW_H tall with its tabs centered in it.
  tabRow: { flexDirection: "row", gap: spacing.lg, justifyContent: "center", alignItems: "center", height: NAV_ROW_H, marginBottom: spacing.lg },
  // Fixed-height slot for StatusMessage so it reserves its line even while empty (status is
  // null) — without this, the rest of the form shifts down by one line for 3s every time a
  // message shows, then shifts back up when it clears.
  statusSlot: { minHeight: 16, justifyContent: "center", marginBottom: spacing.sm },
  tabBtn: { paddingHorizontal: 4 },
  photoButtons: { flexDirection: "row", gap: spacing.md, justifyContent: "center", alignItems: "center", minHeight: CAPTURE_SECTION_MIN_H },
  photoBtn: {
    width: 120, height: 120, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  imagePreviewWrap: { alignItems: "center" },
  imagePreview: { width: PREVIEW_IMG_SIZE, height: PREVIEW_IMG_SIZE, backgroundColor: colors.fill },
  retake: { ...type.label, marginTop: spacing.sm },
  fieldRow: { flexDirection: "row", gap: spacing.md },
  fieldHalf: { flex: 1 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, justifyContent: "center" },
  catChip: { paddingVertical: 6, paddingHorizontal: 4 },
});
