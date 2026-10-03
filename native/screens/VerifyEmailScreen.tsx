import { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../lib/AuthContext";
import { TextButton } from "../components/TextButton";
import { colors, type, spacing } from "../theme/theme";

export default function VerifyEmailScreen() {
  const { verifyEmail, resendVerification, verificationRequired, signOut } = useAuth();
  // This screen is mounted two ways: as a registered Tab.Screen (reachable from Settings while
  // soft-gated, where useNavigation() works normally) and standalone in App.tsx in place of
  // MainTabs entirely (hard-gated, no enclosing Navigator) — the try/catch is the only way to
  // support both without duplicating the screen.
  let navigation: { goBack: () => void } | null = null;
  try { navigation = useNavigation() as unknown as { goBack: () => void }; } catch { navigation = null; }
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    setLoading(true);
    const result = await verifyEmail(code.trim());
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setDone(true);
  }

  async function resend() {
    setError("");
    setResent(false);
    const result = await resendVerification();
    if (result.error) setError(result.error);
    else setResent(true);
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.heading}>EMAIL VERIFIED</Text>
          {!verificationRequired && navigation && (
            <TextButton label="CONTINUE" onPress={() => navigation!.goBack()} style={{ marginTop: spacing.xl, alignSelf: "center" }} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.heading}>VERIFY YOUR EMAIL</Text>
        {verificationRequired && (
          <Text style={[type.body, { color: colors.bad, textAlign: "center", marginTop: spacing.md }]}>
            You must verify your email to keep using this account.
          </Text>
        )}
        <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.md, marginBottom: spacing.xl }]}>
          Enter the 6-digit code we emailed you.
        </Text>

        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={colors.textFaint}
          style={styles.codeInput}
        />

        {!!error && <Text style={[type.body, { color: colors.bad, fontSize: 11, textAlign: "center", marginTop: spacing.md }]}>{error}</Text>}
        {resent && !error && <Text style={[type.body, { color: colors.good, fontSize: 11, textAlign: "center", marginTop: spacing.md }]}>CODE RESENT</Text>}

        <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
          <TextButton label={loading ? "VERIFYING..." : "VERIFY"} onPress={submit} disabled={loading || code.length !== 6} loading={loading} />
        </View>

        <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
          <TextButton label="RESEND CODE" color={colors.textFaint} onPress={resend} />
        </View>

        <View style={{ marginTop: spacing.md, alignItems: "center" }}>
          <TextButton label="SIGN OUT" color={colors.textFaint} onPress={() => signOut()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: spacing.lg },
  heading: { ...type.title, textAlign: "center" },
  codeInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text,
    textAlign: "center", fontSize: 28, letterSpacing: 12, padding: spacing.md,
  },
});
