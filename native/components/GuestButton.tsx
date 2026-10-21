import { useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useAuth } from "../lib/AuthContext";
import { LoadingDots } from "./LoadingDots";

// "CONTINUE WITHOUT AN ACCOUNT" on Log In / Create Account (App Store guideline 5.1.1(v)): starts a
// guest account with no personal info; Settings → Account offers to add an email later.
export function GuestButton({ style }: { style?: object }) {
  const { continueAsGuest } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    if (busy) return;
    setBusy(true); setError("");
    const r = await continueAsGuest();
    if (r.error) { setError(r.error); setBusy(false); }
  }
  return (
    <View style={[{ alignItems: "center" }, style]}>
      {/* Same height either way, so nothing shifts while the guest account is being made. */}
      <TouchableOpacity onPress={go} disabled={busy} hitSlop={8} style={{ height: 16, justifyContent: "center" }}>
        {busy ? <LoadingDots color="#ccc" size={5} /> : <Text style={styles.link}>CONTINUE WITHOUT AN ACCOUNT</Text>}
      </TouchableOpacity>
      <Text style={styles.note}>By continuing you agree to the Terms of Use and Privacy Policy.</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { color: "#ccc", fontSize: 11, fontWeight: "700", textAlign: "center", letterSpacing: 0.5, textTransform: "uppercase" },
  note: { color: "#666", fontSize: 9, textAlign: "center", marginTop: 6, letterSpacing: 0.3 },
  error: { color: "#e05555", fontSize: 10, textAlign: "center", marginTop: 6 },
});
