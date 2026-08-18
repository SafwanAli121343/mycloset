import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../lib/AuthContext";
import { apiJson, ApiError } from "../lib/api";
import { TextButton } from "../components/TextButton";
import { colors, type, spacing } from "../theme/theme";

type Gender = "male" | "female" | "unisex" | null;
const PREF_KEY = "mc_prefs_gender";

const GENDER_OPTIONS: { value: Exclude<Gender, null>; label: string; sub: string }[] = [
  { value: "male", label: "MALE", sub: "menswear, streetwear, men's accessories" },
  { value: "female", label: "FEMALE", sub: "womenswear, street style, women's accessories" },
  { value: "unisex", label: "UNISEX", sub: "gender-neutral and unisex pieces only" },
];

// Direct port of app/settings/page.tsx: the gender preference (stored on-device — SecureStore
// here instead of localStorage) and the image-repair tool. Sign-out is native's own addition
// (the website's equivalent lives in its own nav, not this page) since a settings screen without
// any way to sign out would be a real gap on mobile specifically.
export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [gender, setGenderState] = useState<Gender>(null);
  const [saved, setSaved] = useState(false);
  const [fixStatus, setFixStatus] = useState<string | null>(null);
  const [fixRunning, setFixRunning] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY).then(v => {
      if (v === "male" || v === "female" || v === "unisex") setGenderState(v);
    });
  }, []);

  function setGender(g: Exclude<Gender, null>) {
    setGenderState(g);
    SecureStore.setItemAsync(PREF_KEY, g).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function fixImages() {
    setFixRunning(true);
    setFixStatus("Scanning...");
    try {
      const d = await apiJson<{ total: number; processed: number; remaining: number }>("/api/garments/fix-images", { method: "POST" });
      if (d.total === 0) {
        setFixStatus("All images are already on Supabase Storage.");
      } else {
        setFixStatus(`Fixed ${d.processed} of ${d.total} items.${d.remaining > 0 ? ` Run again for ${d.remaining} remaining.` : ""}`);
      }
    } catch (e) {
      setFixStatus(`Failed: ${e instanceof ApiError ? e.message : String(e)}`);
    } finally {
      setFixRunning(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={{ padding: spacing.lg, paddingTop: 52 }}>
        {user && (
          <View style={{ marginBottom: spacing.xl }}>
            <Text style={type.label}>ACCOUNT</Text>
            <Text style={[type.body, { marginTop: 6 }]}>{user.email}</Text>
          </View>
        )}

        <Text style={type.label}>YOUR GENDER</Text>
        <Text style={[type.body, { color: colors.textMuted, fontSize: 12, marginTop: 6, marginBottom: spacing.md }]}>
          Used to tailor shopping recommendations — menswear vs. womenswear, accessories, and cuts.
        </Text>
        {GENDER_OPTIONS.map(opt => {
          const active = gender === opt.value;
          return (
            <TouchableOpacity key={opt.value} onPress={() => setGender(opt.value)} style={[styles.optRow, active && styles.optRowActive]}>
              <View style={[styles.radio, active && styles.radioActive]} />
              <View>
                <Text style={[type.button, { fontSize: 10, color: active ? "#fff" : colors.text }]}>{opt.label}</Text>
                <Text style={{ fontSize: 9, color: active ? "#ccc" : colors.textFaint, letterSpacing: 0.4, marginTop: 2 }}>{opt.sub}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        {saved && <Text style={{ fontSize: 9, color: colors.good, letterSpacing: 1.2, textTransform: "uppercase", marginTop: spacing.sm }}>SAVED</Text>}

        <View style={styles.section}>
          <Text style={type.label}>FIX ITEM IMAGES</Text>
          <Text style={[type.body, { color: colors.textMuted, fontSize: 12, marginTop: 6, marginBottom: spacing.md }]}>
            Some items may have broken images in the outfits gallery. This re-uploads them to our storage so they load correctly. Run it once — repeat if any remain (processes 50 at a time).
          </Text>
          <TextButton label={fixRunning ? "PROCESSING..." : "FIX IMAGES"} onPress={fixImages} disabled={fixRunning} loading={fixRunning} />
          {fixStatus && <Text style={[type.body, { color: colors.textMuted, fontSize: 11, marginTop: spacing.sm }]}>{fixStatus}</Text>}
        </View>

        <Text style={{ fontSize: 9, color: colors.textFaint, letterSpacing: 0.6, marginTop: spacing.xl, lineHeight: 16 }}>
          PREFERENCES ARE STORED ON THIS DEVICE.{"\n"}SHOPPING RECOMMENDATIONS REFRESH ON NEXT VISIT.
        </Text>

        <TouchableOpacity onPress={confirmSignOut} style={[styles.row, { marginTop: spacing.xl }]}>
          <Text style={[type.button, { color: colors.bad, fontSize: 11 }]}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: { paddingVertical: spacing.md },
  section: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  optRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  optRowActive: { borderColor: colors.text, backgroundColor: colors.text },
  radio: { width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.borderStrong },
  radioActive: { borderColor: "#fff", backgroundColor: "#fff" },
});
