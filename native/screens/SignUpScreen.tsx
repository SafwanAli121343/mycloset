import { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../lib/AuthContext";
import { colors, type, spacing } from "../theme/theme";
import type { AuthStackParamList } from "../navigation/AuthStack";

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  async function handleSubmit() {
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    const result = await signUp(email, password);
    if (result.error) { setError(result.error); setLoading(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "height" : undefined} keyboardVerticalOffset={0}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.form}>
          <Text style={styles.heading}>CREATE AN ACCOUNT</Text>

          <Text style={type.label}>EMAIL</Text>
          <TextInput
            value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
            returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} blurOnSubmit={false}
            style={styles.input}
          />

          <Text style={[type.label, { marginTop: spacing.md }]}>PASSWORD</Text>
          <TextInput
            ref={passwordRef} value={password} onChangeText={setPassword} secureTextEntry
            returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} blurOnSubmit={false}
            style={styles.input}
          />

          <Text style={[type.label, { marginTop: spacing.md }]}>CONFIRM PASSWORD</Text>
          <TextInput
            ref={confirmRef} value={confirm} onChangeText={setConfirm} secureTextEntry
            returnKeyType="done" onSubmitEditing={handleSubmit}
            style={styles.input}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}</Text>
          </TouchableOpacity>

          <Text style={styles.terms}>By creating an account you agree to our Terms of Service and Privacy Policy.</Text>

          <TouchableOpacity onPress={() => navigation.navigate("SignIn")} style={{ marginTop: spacing.md }}>
            <Text style={styles.link}>ALREADY HAVE AN ACCOUNT? <Text style={styles.linkBold}>LOG IN</Text></Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Matches SignInScreen's dark theme — these two screens are directly linked in the same auth
  // flow (each has a link to the other), so they need to look like one continuous flow rather
  // than jumping between a black screen and a white one.
  container: { flex: 1, backgroundColor: colors.text, justifyContent: "center", padding: spacing.lg },
  form: { width: "100%" },
  heading: { ...type.title, color: "#fff", fontSize: 20, textAlign: "center", marginBottom: spacing.xl },
  input: {
    borderWidth: 1, borderColor: "#3a3a3a", backgroundColor: "#0a0a0a", color: "#fff",
    padding: 12, fontSize: 16, marginTop: spacing.xs,
  },
  error: { color: "#ff6b6b", fontSize: 11, marginTop: spacing.md, textTransform: "uppercase", letterSpacing: 0.5 },
  button: { backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3a", padding: 14, alignItems: "center", marginTop: spacing.lg },
  buttonText: { ...type.button, color: "#fff" },
  terms: { color: "#888", fontSize: 9, textAlign: "center", marginTop: spacing.md, letterSpacing: 0.3, lineHeight: 14 },
  link: { color: "#888", fontSize: 11, textAlign: "center", letterSpacing: 0.5, textTransform: "uppercase" },
  linkBold: { color: "#ccc", fontWeight: "700", textDecorationLine: "underline" },
});
