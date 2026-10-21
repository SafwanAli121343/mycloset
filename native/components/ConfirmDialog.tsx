import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../theme/theme";

// The app's own confirm card — same look as the first-run "TUTORIAL?" card (TutorialOverlay):
// dimmed backdrop, centered white card, bold spaced title, muted body, two text buttons
// (cancel left, action right). Used instead of the system Alert for in-app confirmations.
export function ConfirmDialog({
  visible, title, body, confirmLabel, confirmColor = colors.text, cancelLabel = "CANCEL", onConfirm, onCancel,
}: {
  visible: boolean; title: string; body?: string; confirmLabel: string; confirmColor?: string;
  cancelLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={styles.dim} activeOpacity={1} onPress={onCancel}>
        <TouchableOpacity style={styles.card} activeOpacity={1}>
          <Text style={styles.title}>{title}</Text>
          {!!body && <Text style={styles.body}>{body}</Text>}
          <View style={styles.row}>
            <TouchableOpacity onPress={onCancel} hitSlop={12}><Text style={[styles.btn, { color: colors.textFaint }]}>{cancelLabel}</Text></TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} hitSlop={12}><Text style={[styles.btn, { color: confirmColor }]}>{confirmLabel}</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.bg, paddingVertical: 28, paddingHorizontal: 32, alignItems: "center", width: 300 },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: 2, color: colors.text, textAlign: "center" },
  body: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 19 },
  row: { flexDirection: "row", gap: 36, marginTop: 24 },
  btn: { fontSize: 12, fontWeight: "700", letterSpacing: 2 },
});
