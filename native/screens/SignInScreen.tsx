import { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../lib/AuthContext";
import { colors, type, spacing } from "../theme/theme";
import type { AuthStackParamList } from "../navigation/AuthStack";

export default function SignInScreen() {
  const { signIn } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    const result = await signIn(email, password);
    if (result.error) { setError(result.error); setLoading(false); }
  }

  return (
    // behavior "height" (not "padding") avoids the ping-pong resize/jitter iOS shows when
    // focus moves between two stacked inputs and the padding-based approach recalculates
    // insets on every focus change; keyboardVerticalOffset keeps it from over-correcting.
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "height" : undefined} keyboardVerticalOffset={0}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.form}>
          <Text style={styles.heading}>LOG IN</Text>

          <Text style={type.label}>EMAIL</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            blurOnSubmit={false}
            style={styles.input}
          />

          <Text style={[type.label, { marginTop: spacing.md }]}>PASSWORD</Text>
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            style={styles.input}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? "LOGGING IN..." : "LOG IN"}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate("SignUp")} style={{ marginTop: spacing.lg }}>
            <Text style={styles.link}>NO ACCOUNT? <Text style={styles.linkBold}>CREATE ONE</Text></Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.text, justifyContent: "center", padding: spacing.lg },
  form: { width: "100%" },
  heading: { ...type.title, color: "#fff", fontSize: 22, textAlign: "center", marginBottom: spacing.xl },
  input: {
    borderWidth: 1, borderColor: "#3a3a3a", backgroundColor: "#0a0a0a", color: "#fff",
    padding: 12, fontSize: 16, marginTop: spacing.xs,
  },
  error: { color: "#ff6b6b", fontSize: 11, marginTop: spacing.md, textTransform: "uppercase", letterSpacing: 0.5 },
  button: { backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3a", padding: 14, alignItems: "center", marginTop: spacing.lg },
  buttonText: { ...type.button, color: "#fff" },
  link: { color: "#888", fontSize: 11, textAlign: "center", letterSpacing: 0.5, textTransform: "uppercase" },
  linkBold: { color: "#ccc", fontWeight: "700", textDecorationLine: "underline" },
});
