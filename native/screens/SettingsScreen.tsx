import { NAV_ROW_TOP, NAV_ROW_H } from "../components/ShowNavButton";
import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView, Share, Linking, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../lib/AuthContext";
import { useEntitlements } from "../lib/billing/Entitlements";
import { apiJson, apiFetch, ApiError } from "../lib/api";
import { tutorialTarget, setTutorialSettingsHandler } from "../lib/tutorial";
import { TextButton } from "../components/TextButton";
import { UnderlineField } from "../components/UnderlineField";
import { useStatusMessage, StatusMessage } from "../components/StatusMessage";
import { LegalModal, type LegalDocId } from "../components/LegalModal";
import { PAYMENTS_ENABLED } from "../lib/config";
import { colors, type, spacing } from "../theme/theme";
import type { MainTabParamList } from "../navigation/MainTabs";

type Gender = "male" | "female" | "unisex" | null;
const PREF_KEY = "mc_prefs_gender";
const GENDERS: Exclude<Gender, null>[] = ["male", "female", "unisex"];

const PAGES = ["ACCOUNT", "PLAN", "GENDER & AGE", "FEEDBACK", "LEGAL"] as const;
type Page = (typeof PAGES)[number];

function CenteredTextButton({ label, onPress, color, disabled, loading }: {
  label: string; onPress: () => void; color?: string; disabled?: boolean; loading?: boolean;
}) {
  return (
    <View style={{ alignItems: "center", marginBottom: spacing.sm }}>
      <TextButton label={label} onPress={onPress} color={color} disabled={disabled} loading={loading} />
    </View>
  );
}

export default function SettingsScreen() {
  const { user, signOut, emailVerified } = useAuth();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const insets = useSafeAreaInsets();
  const entitlements = useEntitlements();
  const [gender, setGenderState] = useState<Gender>(null);
  const [saved, setSaved] = useState(false);
  // Age lives on the server (users.age) — it's read by every AI style-analysis prompt
  // (lib/userAge.ts on the backend), unlike gender which is a local display preference.
  const [ageText, setAgeText] = useState("");
  const savedAgeRef = useRef<string>("");
  const [ageError, setAgeError] = useState("");

  // Feedback page — stored server-side (POST /api/feedback → the `feedback` table).
  const [feedback, setFeedback] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; ok: boolean } | null>(null);
  async function sendFeedback() {
    const message = feedback.trim();
    if (!message || feedbackBusy) return;
    setFeedbackBusy(true);
    setFeedbackMsg(null);
    try {
      await apiJson("/api/feedback", { method: "POST", body: JSON.stringify({ message, platform: Platform.OS === "android" ? "android" : "ios" }) });
      setFeedback("");
      setFeedbackMsg({ text: "Sent! Thank you.", ok: true });
    } catch (e) {
      setFeedbackMsg({ text: e instanceof ApiError ? e.message : "Couldn't send. Try again.", ok: false });
    } finally {
      setFeedbackBusy(false);
    }
  }
  const { status: accountStatus, showStatus: showAccountStatus } = useStatusMessage();

  // Paged like Preview's InfoCard — one section visible at a time, arrows to cycle — instead of
  // one long scroll with every section stacked. Same header-with-flanking-arrows pattern.
  const [pageIdx, setPageIdx] = useState(0);
  // The first-run tutorial opens the FEEDBACK page to show where feedback goes.
  useEffect(() => {
    setTutorialSettingsHandler(p => { const i = PAGES.indexOf(p as Page); if (i >= 0) setPageIdx(i); });
    return () => setTutorialSettingsHandler(null);
  }, []);
  const page: Page = PAGES[pageIdx];
  function cyclePage(dir: 1 | -1) {
    setPageIdx(i => (i + dir + PAGES.length) % PAGES.length);
  }

  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);


  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY).then(v => {
      if (v === "male" || v === "female" || v === "unisex") setGenderState(v);
    });
    // The account's saved age + gender (server) win over the device's local gender copy.
    apiJson<{ age: number | null; gender: Gender }>("/api/user/profile")
      .then(r => {
        const t = r.age != null ? String(r.age) : ""; savedAgeRef.current = t; setAgeText(t);
        if (r.gender) { setGenderState(r.gender); SecureStore.setItemAsync(PREF_KEY, r.gender).catch(() => {}); }
      })
      .catch(() => {});
  }, []);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function saveAge() {
    const t = ageText.trim();
    if (t === savedAgeRef.current) return;
    setAgeError("");
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isInteger(n) || n < 13 || n > 120)) {
      setAgeError("Enter a whole number from 13 to 120.");
      return;
    }
    try {
      await apiJson("/api/user/profile", { method: "PATCH", body: JSON.stringify({ age: n }) });
      savedAgeRef.current = t;
      flashSaved();
    } catch (e) {
      setAgeError(e instanceof ApiError ? e.message : "Couldn't save your age. Try again.");
    }
  }

  function setGender(g: Exclude<Gender, null>) {
    setGenderState(g);
    SecureStore.setItemAsync(PREF_KEY, g).catch(() => {});
    // Also saved to the account — the AI analysis prompts read it (lib/userAge.ts on the backend).
    apiJson("/api/user/profile", { method: "PATCH", body: JSON.stringify({ gender: g }) }).catch(() => {});
    flashSaved();
  }

  async function submitPasswordChange() {
    setPwError("");
    if (!currentPw) { setPwError("Enter your current password."); return; }
    if (newPw.length < 8) { setPwError("New password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setPwError("New passwords do not match."); return; }
    setPwBusy(true);
    try {
      await apiJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      setPwSuccess(true);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setTimeout(() => { setChangingPw(false); setPwSuccess(false); }, 1500);
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setPwBusy(false);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      const res = await apiFetch("/api/user/export");
      const json = await res.text();
      await Share.share({ message: json, title: "mycloset-export.json" });
    } catch {
      showAccountStatus("Export failed. Please try again.", "bad");
    } finally {
      setExporting(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account, closet, and all saved outfits. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]
    );
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await apiFetch("/api/user/delete", { method: "DELETE" });
      await signOut();
    } catch {
      showAccountStatus("Something went wrong. Please try again.", "bad");
      setDeleting(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  }

  const tierLabel = entitlements.tier.toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* SafeAreaView already applies insets.top — the old paddingTop: insets.top applied it a
         second time, dropping the title far below the nav chevron it shares the top band with.
         Now on the chevron's exact center line (see ShowNavButton's NAV_ROW_*). */}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <View style={{ marginTop: NAV_ROW_TOP, height: NAV_ROW_H, justifyContent: "center" }}>
          <Text style={[type.title, { textAlign: "center" }]}>SETTINGS</Text>
        </View>
        <View style={styles.pagerHeader}>
          <TouchableOpacity onPress={() => cyclePage(-1)} hitSlop={12} style={styles.pagerArrow}>
            <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[type.label, { flex: 1, textAlign: "center" }]}>{page}</Text>
          <TouchableOpacity onPress={() => cyclePage(1)} hitSlop={12} style={styles.pagerArrow}>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Extra bottom padding beyond the plain nav-bar-clearance amount biases the centered
         content up slightly off dead-center — same nudge technique as Calendar's DayOutfit,
         per the same kind of "reads as very slightly low" feedback. */}
      {/* automaticallyAdjustKeyboardInsets (iOS) scrolls the focused field — the feedback box,
         the age field, the password fields — above the keyboard instead of under it;
         keyboardShouldPersistTaps lets SEND/SAVE register on the first tap with the keyboard up. */}
      <ScrollView showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, paddingBottom: insets.bottom + 130, justifyContent: "center" }}>
        {page === "ACCOUNT" && (
          <View>
            {user && <Text style={[type.body, { textAlign: "center", marginBottom: spacing.md }]}>{user.email}</Text>}

            {!emailVerified && (
              <View style={{ alignItems: "center", marginBottom: spacing.md }}>
                <Text style={[type.body, { color: colors.bad, fontSize: 11, marginBottom: 4 }]}>EMAIL NOT VERIFIED</Text>
                <TextButton label="VERIFY NOW" onPress={() => navigation.navigate("VerifyEmail")} />
              </View>
            )}

            {!changingPw ? (
              <CenteredTextButton label="CHANGE PASSWORD" onPress={() => setChangingPw(true)} />
            ) : (
              <View style={{ marginBottom: spacing.md }}>
                <View style={{ marginBottom: spacing.sm }}>
                  <UnderlineField hint="CURRENT" value={currentPw} onChangeText={setCurrentPw} secureTextEntry autoCapitalize="none" />
                </View>
                <View style={{ marginBottom: spacing.sm }}>
                  <UnderlineField hint="NEW" value={newPw} onChangeText={setNewPw} secureTextEntry autoCapitalize="none" />
                </View>
                <View style={{ marginBottom: spacing.md }}>
                  <UnderlineField hint="CONFIRM" value={confirmPw} onChangeText={setConfirmPw} secureTextEntry autoCapitalize="none" />
                </View>
                {!!pwError && <Text style={[type.body, { color: colors.bad, fontSize: 11, textAlign: "center", marginBottom: spacing.sm }]}>{pwError}</Text>}
                {pwSuccess && <Text style={[type.body, { color: colors.good, fontSize: 11, textAlign: "center", marginBottom: spacing.sm }]}>PASSWORD UPDATED</Text>}
                <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.lg }}>
                  <TextButton label="CANCEL" color={colors.textFaint} onPress={() => { setChangingPw(false); setPwError(""); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }} />
                  <TextButton label={pwBusy ? "SAVING..." : "SAVE"} onPress={submitPasswordChange} disabled={pwBusy} loading={pwBusy} />
                </View>
              </View>
            )}

            <CenteredTextButton label={exporting ? "EXPORTING..." : "EXPORT MY DATA"} onPress={onExport} disabled={exporting} loading={exporting} />
            <CenteredTextButton label={deleting ? "DELETING..." : "DELETE ACCOUNT"} color={colors.bad} onPress={confirmDelete} disabled={deleting} loading={deleting} />
            <View style={{ minHeight: 16, justifyContent: "center" }}>
              <StatusMessage status={accountStatus} style={{ fontSize: 11 }} />
            </View>
          </View>
        )}

        {page === "PLAN" && (
          <View>
            <Text style={[type.body, { textAlign: "center", marginBottom: spacing.md }]}>
              {tierLabel}
            </Text>
            {PAYMENTS_ENABLED && (
              <CenteredTextButton label={entitlements.tier === "free" ? "UPGRADE" : "MANAGE PLAN"} onPress={() => navigation.navigate("Upgrade")} />
            )}
            {entitlements.tier !== "free" && !entitlements.isFullAccessOverride && (
              <CenteredTextButton
                label="CANCEL SUBSCRIPTION"
                color={colors.textFaint}
                onPress={() => Linking.openURL(
                  Platform.OS === "ios" ? "itms-apps://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions"
                )}
              />
            )}
            {/* No redeem-key field in the app: App Store guideline 3.1.1 (and Google Play's
               billing policy) don't allow unlocking features with the app's own keys/codes —
               only the store's in-app purchase. Keys are redeemed on the website instead;
               whatever they grant applies here too (allowed, since Pro is also sold in-app). */}
            {/* One-time purchases you have, by type. */}
            {PAYMENTS_ENABLED && (
            <View style={{ marginTop: spacing.lg, gap: spacing.xs, alignItems: "center" }}>
              <Text style={[type.body, { fontSize: 12 }]}>Single Item Analysis: {entitlements.itemScans ?? 0}</Text>
              <Text style={[type.body, { fontSize: 12 }]}>Full Wardrobe Analysis: {entitlements.wardrobeScans ?? 0}</Text>
              {/* Where each one is used — both only spend once the result is actually ready. */}
              {((entitlements.itemScans ?? 0) > 0 || (entitlements.wardrobeScans ?? 0) > 0) && (
                <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: spacing.xs, paddingHorizontal: spacing.lg }}>
                  Use a Single Item Analysis with USE SCORE? on an item in My Closet, and a Full Wardrobe Analysis from the Wardrobe tab.
                </Text>
              )}
            </View>
            )}

          </View>
        )}

        {page === "GENDER & AGE" && (
          <View>
            <View style={styles.genderRow}>
              {GENDERS.map(g => (
                <TextButton key={g} label={g.toUpperCase()} color={gender === g ? colors.text : colors.textFaint} onPress={() => setGender(g)} />
              ))}
            </View>
            {/* Saved on blur / keyboard done — tailors the AI analysis to the user's age. */}
            <UnderlineField
              value={ageText}
              onChangeText={t => { setAgeText(t.replace(/[^0-9]/g, "").slice(0, 3)); setAgeError(""); }}
              onBlur={saveAge}
              onSubmitEditing={saveAge}
              hint="Age"
              hintWidth={40}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={3}
              error={!!ageError}
              containerStyle={{ marginTop: spacing.lg, alignSelf: "center", width: 160 }}
            />
            {ageError ? <Text style={{ fontSize: 11, color: colors.bad, textAlign: "center", marginTop: spacing.sm }}>{ageError}</Text> : null}
            {saved && <Text style={{ fontSize: 9, color: colors.good, letterSpacing: 1.2, textTransform: "uppercase", textAlign: "center", marginTop: spacing.sm }}>SAVED</Text>}
          </View>
        )}

        {page === "FEEDBACK" && (
          <View ref={tutorialTarget("settings.feedback")} collapsable={false}>
            <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginBottom: spacing.md }]}>
              You are able to send a message to our team below:
            </Text>
            {/* multiline + a growing height (up to a cap, then it scrolls) so a whole paragraph
               stays visible while typing. */}
            <TextInput
              value={feedback}
              onChangeText={t => { setFeedback(t); setFeedbackMsg(null); }}
              multiline
              maxLength={5000}
              placeholder="Type your message…"
              placeholderTextColor={colors.textFaint}
              textAlignVertical="top"
              style={styles.feedbackBox}
            />
            <View style={{ alignItems: "center", marginTop: spacing.md }}>
              <TextButton label={feedbackBusy ? "SENDING..." : "SEND"} size={10} color={colors.text} onPress={sendFeedback} disabled={!feedback.trim() || feedbackBusy} loading={feedbackBusy} />
            </View>
            {feedbackMsg && (
              <Text style={{ fontSize: 11, color: feedbackMsg.ok ? colors.good : colors.bad, textAlign: "center", marginTop: spacing.sm }}>{feedbackMsg.text}</Text>
            )}
          </View>
        )}

        {page === "LEGAL" && (
          <View style={styles.legalRow}>
            <TextButton label="TERMS" size={10} color={colors.textMuted} onPress={() => setLegalDoc("terms")} />
            <TextButton label="PRIVACY" size={10} color={colors.textMuted} onPress={() => setLegalDoc("privacy")} />
            <TextButton label="EULA" size={10} color={colors.textMuted} onPress={() => setLegalDoc("eula")} />
            <TextButton label="COOKIES" size={10} color={colors.textMuted} onPress={() => setLegalDoc("cookies")} />
          </View>
        )}

        <TouchableOpacity onPress={confirmSignOut} style={{ marginTop: spacing.xl, alignItems: "center" }}>
          <Text style={[type.button, { color: colors.bad, fontSize: 11 }]}>SIGN OUT</Text>
        </TouchableOpacity>
      </ScrollView>
      <LegalModal doc={legalDoc} visible={legalDoc !== null} onClose={() => setLegalDoc(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  feedbackBox: {
    minHeight: 120, maxHeight: 240, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, paddingTop: spacing.md, fontSize: 13, lineHeight: 19, color: colors.text,
  },
  container: { flex: 1, backgroundColor: colors.bg },
  pagerHeader: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, paddingBottom: spacing.md },
  pagerArrow: { padding: spacing.xs },
  genderRow: { flexDirection: "row", justifyContent: "center", gap: spacing.lg },
  legalRow: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: spacing.lg },
});
