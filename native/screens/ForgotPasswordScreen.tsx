import { useState } from "react";
import { View, Text, TextInput, StyleSheet, Pressable, Keyboard } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiJson, ApiError } from "../lib/api";
import { UnderlineField } from "../components/UnderlineField";
import { TextButton } from "../components/TextButton";
import { colors, type, spacing } from "../theme/theme";
import type { AuthStackParamList } from "../navigation/AuthStack";

type Step = "email" | "code" | "password" | "done";

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitEmail() {
    setError("");
    setLoading(true);
    await apiJson("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: email.trim() }) }).catch(() => {});
    setLoading(false);
    setStep("code");
  }

  async function submitCode() {
    setError("");
    setLoading(true);
    try {
      await apiJson("/api/auth/verify-reset-code", { method: "POST", body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      setStep("password");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitPassword() {
    setError("");
    if (newPassword !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      await apiJson("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
      });
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.heading}>PASSWORD RESET.</Text>
          <TextButton
            label="RETURN TO LOG-IN"
            color={colors.textFaint}
            onPress={() => navigation.navigate("SignIn")}
            style={{ marginTop: spacing.xl, alignSelf: "center" }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <Pressable style={styles.container} onPress={Keyboard.dismiss}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.inner}>
          <Text style={styles.heading}>RESET PASSWORD</Text>

          {step === "email" && (
            <>
              <View style={{ marginTop: spacing.xl }}>
                <UnderlineField
                  hint="EMAIL"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                />
              </View>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
                <TextButton label={loading ? "SENDING..." : "SEND CODE"} onPress={submitEmail} disabled={loading || !email.trim()} loading={loading} />
              </View>
            </>
          )}

          {step === "code" && (
            <>
              <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.md }]}>
                Enter the 6-digit code sent to {email}.
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
              {!!error && <Text style={styles.error}>{error}</Text>}
              <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
                <TextButton label={loading ? "CHECKING..." : "CONTINUE"} onPress={submitCode} disabled={loading || code.length !== 6} loading={loading} />
              </View>
            </>
          )}

          {step === "password" && (
            <>
              <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
                <UnderlineField hint="NEW" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
                <UnderlineField hint="CONFIRM" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
              </View>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
                <TextButton label={loading ? "SAVING..." : "RESET PASSWORD"} onPress={submitPassword} disabled={loading} loading={loading} />
              </View>
            </>
          )}

          <TextButton
            label="RETURN TO LOG-IN"
            color={colors.textFaint}
            onPress={() => navigation.navigate("SignIn")}
            style={{ marginTop: spacing.xl, alignSelf: "center" }}
          />
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: spacing.lg },
  heading: { ...type.title, textAlign: "center" },
  error: { color: colors.bad, fontSize: 11, textAlign: "center", marginTop: spacing.md, textTransform: "uppercase", letterSpacing: 0.5 },
  codeInput: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text,
    textAlign: "center", fontSize: 24, letterSpacing: 10, padding: spacing.md, marginTop: spacing.lg,
  },
});
