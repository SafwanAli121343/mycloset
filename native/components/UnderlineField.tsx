import { View, TextInput, Text, StyleSheet, type TextInputProps } from "react-native";
import { colors, fontFamily } from "../theme/theme";

// Matches the website's add-item form fields exactly (fieldInput/fieldHint in
// app/add-item/page.tsx): an underlined, borderless input with a grey hint label pinned to
// the right edge instead of floating above the box. The input reserves paddingRight equal to
// the hint's width so short values sit clear of it; once typed text runs long enough to reach
// that reserved space, it visually meets the hint exactly like the site's version does.
export function UnderlineField({
  hint, required, hintWidth = 60, error, style, ...props
}: TextInputProps & { hint: string; required?: boolean; hintWidth?: number; error?: boolean }) {
  return (
    <View style={[styles.wrap, error && styles.wrapError]}>
      <TextInput {...props} style={[styles.input, { paddingRight: hintWidth }, style]} placeholderTextColor={colors.textFaint} />
      <Text style={styles.hint} pointerEvents="none">
        {hint}{required && <Text style={styles.required}> *</Text>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", borderBottomWidth: 1, borderBottomColor: colors.border, justifyContent: "center" },
  wrapError: { borderBottomColor: colors.bad },
  input: { fontFamily, fontSize: 14, color: colors.text, paddingVertical: 9 },
  hint: { position: "absolute", right: 0, fontFamily, fontSize: 12, color: colors.textFaint },
  required: { color: colors.bad },
});
