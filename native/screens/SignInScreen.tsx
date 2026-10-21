import { useRef, useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Pressable,
  StyleSheet, Animated, Platform, Keyboard,
  type KeyboardEvent,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { GuestButton } from "../components/GuestButton";
import { useAuth } from "../lib/AuthContext";
import { apiJson } from "../lib/api";
import { colors, type, spacing } from "../theme/theme";
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

export default function SignInScreen() {
  const { signIn } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [activeField, setActiveField] = useState<"email" | "password">("email");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // Ref tracks active field synchronously so onChangeText routes correctly
  // without waiting for a state re-render cycle
  const activeRef = useRef<"email" | "password">("email");
  const lift = useKeyboardLift();
  // "FORGOT PASSWORD?" only while reset emails can actually be sent (/api/auth/options).
  const [emailEnabled, setEmailEnabled] = useState(false);
  useEffect(() => {
    apiJson<{ emailEnabled: boolean }>("/api/auth/options").then(d => setEmailEnabled(!!d.emailEnabled)).catch(() => {});
  }, []);

  function handleChange(text: string) {
    if (error) setError("");
    if (activeRef.current === "email") setEmail(text);
    else setPassword(text);
  }

  function focusField(field: "email" | "password") {
    activeRef.current = field;
    setActiveField(field);
    inputRef.current?.focus(); // no-op when already focused; recovers if somehow lost
  }

  async function handleSubmit() {
    const trimEmail = email.trim();
    const trimPassword = password.trim();
    if (!trimEmail) { focusField("email"); setError("Please enter your email."); return; }
    if (!trimPassword) { focusField("password"); setError("Please enter your password."); return; }
    setError("");
    setLoading(true);
    const result = await signIn(trimEmail, trimPassword);
    setLoading(false);
    if (result.error) setError(result.error);
  }

  return (
    <Pressable style={styles.container} onPress={Keyboard.dismiss}>
      <Animated.View
        style={[styles.inner, { transform: [{ translateY: lift }] }]}
        shouldRasterizeIOS
        renderToHardwareTextureAndroid
      >
        {/*
         * This TextInput is always the iOS first responder.
         * ALL keyboard-config props are CONSTANT — iOS reloads the keyboard
         * whenever any of these change, which is what causes jitter.
         * Field switches only update `value` (safe) and the visual boxes below.
         */}
        <TextInput
          ref={inputRef}
          value={activeField === "email" ? email : password}
          onChangeText={handleChange}
          onSubmitEditing={() => {
            if (activeRef.current === "email") focusField("password");
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

        <Text style={styles.heading}>LOG IN</Text>

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

        <Text style={[styles.error, !error && styles.errorHidden]} numberOfLines={2}>{error}</Text>

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? "LOGGING IN..." : "LOG IN"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")} disabled={!emailEnabled} style={{ marginTop: spacing.md, opacity: emailEnabled ? 1 : 0 }}>
          <Text style={styles.link}>FORGOT PASSWORD?</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("SignUp")} style={{ marginTop: spacing.lg }}>
          <Text style={styles.link}>NO ACCOUNT? <Text style={styles.linkBold}>CREATE ONE</Text></Text>
        </TouchableOpacity>

        <GuestButton style={{ marginTop: spacing.xl }} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.text, justifyContent: "center" },
  inner: { padding: spacing.lg },
  hiddenInput: { position: "absolute", top: -1000, left: 0, right: 0, height: 44, opacity: 0 },
  heading: { ...type.title, color: "#fff", fontSize: 22, textAlign: "center", marginBottom: spacing.xl },
  box: {
    borderWidth: 1, borderColor: "#3a3a3a", backgroundColor: "#0a0a0a",
    padding: 12, marginTop: spacing.xs, minHeight: 44, justifyContent: "center",
  },
  boxActive: { borderColor: "#666" },
  boxText: { color: "#fff", fontSize: 16 },
  boxPlaceholder: { color: "#444" },
  // Fixed height (2 lines' worth) so the box occupies the same space whether the message is
  // short, wraps to a second line, or is empty — the visible/hidden toggle (via opacity below)
  // must never itself change layout, or the boxes above/below drift on every show/hide cycle.
  error: {
    color: "#ff6b6b", fontSize: 11, lineHeight: 15, height: 30, marginTop: spacing.md,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  errorHidden: { opacity: 0 },
  button: { backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3a", padding: 14, alignItems: "center", marginTop: spacing.lg },
  buttonText: { ...type.button, color: "#fff" },
  link: { color: "#888", fontSize: 11, textAlign: "center", letterSpacing: 0.5, textTransform: "uppercase" },
  linkBold: { color: "#ccc", fontWeight: "700" },
});
