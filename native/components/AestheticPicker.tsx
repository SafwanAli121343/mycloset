import { useState } from "react";
import { View, TextInput, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fontFamily } from "../theme/theme";
import { KNOWN_AESTHETICS } from "../lib/aesthetics";

const PAGE_SIZE = 3;

// Same underlined-field visual language as UnderlineField, plus a small paged dropdown of
// KNOWN_AESTHETICS (native/lib/aesthetics.ts) underneath. Lets a user either type freely (live-
// filtered against the list as they go) or browse it 3 at a time via a down arrow, which grows an
// up arrow the moment they're not on the first page anymore. Deliberately free-typing rather than
// select-only — a value not in the list is still accepted (stored as whatever the user typed),
// the list is guidance, not a hard constraint.
//
// The backdrop below (not the TextInput's own onBlur) is what closes the dropdown on an outside
// tap — react-native fires onBlur BEFORE a touch on another element's onPress resolves, so relying
// on blur to close this would eat the very tap meant to select a suggestion.
export function AestheticPicker({
  value, onChange, containerStyle,
}: { value: string; onChange: (v: string) => void; containerStyle?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  const q = value.trim().toLowerCase();
  const filtered = q ? KNOWN_AESTHETICS.filter(a => a.includes(q)) : KNOWN_AESTHETICS;
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const hasPrev = page > 0;
  const hasMore = (page + 1) * PAGE_SIZE < filtered.length;

  function selectValue(v: string) {
    onChange(v);
    setOpen(false);
  }

  function handleChangeText(t: string) {
    onChange(t);
    setPage(0); // filtering changes the result set — start back at the top of it
    if (!open) setOpen(true);
  }

  return (
    <View style={[styles.wrap, containerStyle]}>
      <View style={styles.fieldWrap}>
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          onFocus={() => setOpen(true)}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          placeholderTextColor={colors.textFaint}
        />
        <Text style={styles.hint} pointerEvents="none">Aesthetic</Text>
      </View>

      {open && (
        <>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={styles.dropdown}>
            {pageItems.length === 0 ? (
              <Text style={styles.optionText}>No matches — your own text is still fine</Text>
            ) : (
              pageItems.map(a => (
                <TouchableOpacity key={a} onPress={() => selectValue(a)} style={styles.option}>
                  <Text style={styles.optionText}>{a}</Text>
                </TouchableOpacity>
              ))
            )}
            {(hasPrev || hasMore) && (
              <View style={styles.arrowRow}>
                <TouchableOpacity onPress={() => setPage(p => p - 1)} disabled={!hasPrev} hitSlop={8}>
                  <Ionicons name="chevron-up" size={14} color={hasPrev ? colors.textMuted : "transparent"} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPage(p => p + 1)} disabled={!hasMore} hitSlop={8}>
                  <Ionicons name="chevron-down" size={14} color={hasMore ? colors.textMuted : "transparent"} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  fieldWrap: { position: "relative", borderBottomWidth: 1, borderBottomColor: colors.border, justifyContent: "center" },
  input: { fontFamily, fontSize: 14, color: colors.text, paddingVertical: 9, paddingRight: 62 },
  hint: { position: "absolute", right: 0, fontFamily, fontSize: 12, color: colors.textFaint },
  // Fixed-position full-bleed catcher rather than a real full-screen overlay (no Modal/Portal
  // available here) — large enough that any realistic outside tap on this screen lands on it and
  // closes the dropdown, while the dropdown itself renders after it in the tree and sits on top.
  backdrop: { position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 1 },
  dropdown: {
    position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 4, zIndex: 2,
  },
  option: { paddingVertical: 8, paddingHorizontal: 10 },
  optionText: { fontFamily, fontSize: 13, color: colors.text, textTransform: "capitalize" },
  arrowRow: { flexDirection: "row", justifyContent: "center", gap: 24, paddingTop: 4, paddingBottom: 2 },
});
