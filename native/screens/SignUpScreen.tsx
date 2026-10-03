import { useRef, useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
  StyleSheet, Animated, Platform, Keyboard, ScrollView,
  type KeyboardEvent,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../lib/AuthContext";
import { colors, type, spacing } from "../theme/theme";
import { LegalModal, type LegalDocId } from "../components/LegalModal";
import type { AuthStackParamList } from "../navigation/AuthStack";

const LIFT_RATIO = 0.42;

function useKeyboardLift() {
  const lift = useRef(new Animated.Value(0)).current;
  const shown = useRef(false);

  useEffect(() => {
    const SHOW = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const HIDE = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: KeyboardEvent) => {
      if (shown.current) return;
      shown.current = true;
      Animated.timing(lift, {
        toValue: -(e.endCoordinates.height * LIFT_RATIO),
        duration: e.duration ?? 250,
        useNativeDriver: true,
      }).start();
    };

    const onHide = (e: KeyboardEvent) => {
      if (!shown.current) return;
      shown.current = false;
      Animated.timing(lift, {
        toValue: 0,
        duration: e.duration ?? 220,
        useNativeDriver: true,
      }).start();
    };

    const s1 = Keyboard.addListener(SHOW, onShow);
    const s2 = Keyboard.addListener(HIDE, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, [lift]);

  return lift;
}

type Field = "email" | "password" | "confirm";

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [activeField, setActiveField] = useState<Field>("email");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
  const inputRef = useRef<TextInput>(null);
  const activeRef = useRef<Field>("email");
  const lift = useKeyboardLift();

  function handleChange(text: string) {
    if (error) setError("");
    if (activeRef.current === "email") setEmail(text);
    else if (activeRef.current === "password") setPassword(text);
    else setConfirm(text);
  }

  function focusField(field: Field) {
    activeRef.current = field;
    setActiveField(field);
    inputRef.current?.focus();
  }

  function fieldValue() {
    if (activeField === "email") return email;
    if (activeField === "password") return password;
    return confirm;
  }

  async function handleSubmit() {
    const trimEmail = email.trim();
    if (!trimEmail) { focusField("email"); setError("Please enter your email."); return; }
    if (!password) { focusField("password"); setError("Please enter a password."); return; }
    if (password !== confirm) { focusField("confirm"); setError("Passwords do not match."); return; }
    if (!agreed) { setError("Please agree to the Terms of Service and Privacy Policy to continue."); return; }
    setError("");
    setLoading(true);
    const result = await signUp(trimEmail, password);
    setLoading(false);
    if (result.error) setError(result.error);
  }

  return (
    <Pressable style={styles.container} onPress={Keyboard.dismiss}>
      <Animated.View
        style={[styles.lift, { transform: [{ translateY: lift }] }]}
        shouldRasterizeIOS
        renderToHardwareTextureAndroid
      >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
        >
          {/*
           * All keyboard-config props are CONSTANT so iOS never reloads the keyboard
           * during field switches. Only `value` changes, which is safe.
           */}
          <TextInput
            ref={inputRef}
            value={fieldValue()}
            onChangeText={handleChange}
            onSubmitEditing={() => {
              if (activeRef.current === "email") focusField("password");
              else if (activeRef.current === "password") focusField("confirm");
              else handleSubmit();
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
            secureTextEntry={false}
            textContentType="none"
            returnKeyType="next"
            accessible={false}
            style={styles.hiddenInput}
          />

          <Text style={styles.heading}>CREATE AN ACCOUNT</Text>

          <Text style={type.label}>EMAIL</Text>
          <TouchableOpacity
            onPress={() => focusField("email")}
            style={[styles.box, activeField === "email" && styles.boxActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.boxText, !email && styles.boxPlaceholder]}>
              {email || "Enter email"}
            </Text>
          </TouchableOpacity>

          <Text style={[type.label, { marginTop: spacing.md }]}>PASSWORD</Text>
          <TouchableOpacity
            onPress={() => focusField("password")}
            style={[styles.box, activeField === "password" && styles.boxActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.boxText, !password && styles.boxPlaceholder]}>
              {password ? "•".repeat(password.length) : "Enter password"}
            </Text>
          </TouchableOpacity>

          <Text style={[type.label, { marginTop: spacing.md }]}>CONFIRM PASSWORD</Text>
          <TouchableOpacity
            onPress={() => focusField("confirm")}
            style={[styles.box, activeField === "confirm" && styles.boxActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.boxText, !confirm && styles.boxPlaceholder]}>
              {confirm ? "•".repeat(confirm.length) : "Enter password again"}
            </Text>
          </TouchableOpacity>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {/* Explicit, logged-nowhere-but-here consent gate — required before account creation
             rather than a passive footnote, so signup itself is the moment of agreement (both
             stores expect a real acceptance step, not just a line of text). */}
          <TouchableOpacity
            style={styles.agreeRow}
            onPress={() => setAgreed(v => !v)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]} />
            <Text style={styles.agreeText}>
              I agree to the{" "}
              <Text style={styles.agreeLink} onPress={() => setLegalDoc("terms")}>Terms of Service</Text>
              {", "}
              <Text style={styles.agreeLink} onPress={() => setLegalDoc("privacy")}>Privacy Policy</Text>
              {", and "}
              <Text style={styles.agreeLink} onPress={() => setLegalDoc("eula")}>EULA</Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, !agreed && styles.buttonDisabled]} onPress={handleSubmit} disabled={loading || !agreed}>
            <Text style={styles.buttonText}>{loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate("SignIn")} style={{ marginTop: spacing.md }}>
            <Text style={styles.link}>ALREADY HAVE AN ACCOUNT? <Text style={styles.linkBold}>LOG IN</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
      <LegalModal doc={legalDoc} visible={legalDoc !== null} onClose={() => setLegalDoc(null)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.text, justifyContent: "center" },
  lift: { width: "100%" },
  hiddenInput: { position: "absolute", top: -1000, left: 0, right: 0, height: 44, opacity: 0 },
  inner: { padding: spacing.lg },
  heading: { ...type.title, color: "#fff", fontSize: 20, textAlign: "center", marginBottom: spacing.xl },
  box: {
    borderWidth: 1, borderColor: "#3a3a3a", backgroundColor: "#0a0a0a",
    padding: 12, marginTop: spacing.xs, minHeight: 44, justifyContent: "center",
  },
  boxActive: { borderColor: "#666" },
  boxText: { color: "#fff", fontSize: 16 },
  boxPlaceholder: { color: "#444" },
  error: { color: "#ff6b6b", fontSize: 11, marginTop: spacing.md, textTransform: "uppercase", letterSpacing: 0.5 },
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: spacing.lg },
  checkbox: { width: 16, height: 16, borderWidth: 1, borderColor: "#666", marginTop: 2 },
  checkboxChecked: { backgroundColor: "#fff", borderColor: "#fff" },
  agreeText: { flex: 1, color: "#aaa", fontSize: 11, lineHeight: 16 },
  agreeLink: { color: "#fff", fontWeight: "700", textDecorationLine: "underline" },
  button: { backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3a", padding: 14, alignItems: "center", marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { ...type.button, color: "#fff" },
  link: { color: "#888", fontSize: 11, textAlign: "center", letterSpacing: 0.5, textTransform: "uppercase" },
  linkBold: { color: "#ccc", fontWeight: "700" },
});
