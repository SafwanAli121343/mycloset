import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson, ApiError } from "../lib/api";
import { LoadingDots } from "./LoadingDots";
import { colors, type, spacing } from "../theme/theme";

export type LegalDocId = "terms" | "privacy" | "eula" | "cookies";
type LegalSection = { heading: string; body: string };
type LegalDoc = { title: string; lastUpdated: string; sections: LegalSection[] };

// Renders one of the legal documents natively (fetched from /api/legal/[doc], the same content
// the website's own /terms /privacy /eula /cookies pages render — see lib/legal/content.ts on
// the backend) instead of opening a browser. Works pre-login (SignUpScreen) since the endpoint
// needs no auth, and post-login (SettingsScreen) the same way.
export function LegalModal({ doc, visible, onClose }: { doc: LegalDocId | null; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !doc) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    apiJson<LegalDoc>(`/api/legal/${doc}`)
      .then(d => { if (!cancelled) setContent(d); })
      .catch(e => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Couldn't load this document."); });
    return () => { cancelled = true; };
  }, [visible, doc]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top || spacing.lg }]}>
        <View style={styles.header}>
          <Text style={[type.title, { textAlign: "center", flex: 1 }]}>{content?.title ?? ""}</Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          {!content && !error && <View style={{ paddingTop: spacing.xl, alignItems: "center" }}><LoadingDots /></View>}
          {error && <Text style={[type.body, { color: colors.bad, textAlign: "center", marginTop: spacing.xl }]}>{error}</Text>}
          {content && (
            <>
              <Text style={[type.body, { color: colors.textFaint, fontSize: 11, textAlign: "center", marginBottom: spacing.xl }]}>
                LAST UPDATED {content.lastUpdated.toUpperCase()}
              </Text>
              {content.sections.map(s => (
                <View key={s.heading} style={{ marginBottom: spacing.lg }}>
                  <Text style={[type.label, { color: colors.text, textAlign: "center", marginBottom: 6 }]}>
                    {s.heading.replace(/^\d+\.\s*/, "")}
                  </Text>
                  <Text style={[type.body, { color: colors.textMuted }]}>{s.body}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
        <TouchableOpacity onPress={onClose} style={[styles.closeRow, { paddingBottom: insets.bottom || spacing.md }]}>
          <Text style={[type.button, { fontSize: 11 }]}>CLOSE</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  closeRow: { paddingTop: spacing.md, alignItems: "center" },
});
