import { TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavBarVisibility } from "../lib/NavBarVisibility";
import { colors } from "../theme/theme";

// A persistent top-right toggle for the bottom nav bar: chevron-down (tap to close it) while
// the bar is showing, chevron-up (tap to bring it back) while it's hidden — rather than only
// existing in the hidden state. Suppressed entirely by full-screen overlays that have no use
// for it at all (see useSuppressNavButton).
export function ShowNavButton() {
  const insets = useSafeAreaInsets();
  const { visible, suppressed, show, hide } = useNavBarVisibility();
  if (suppressed) return null;
  return (
    <TouchableOpacity onPress={visible ? hide : show} hitSlop={14} style={[styles.btn, { top: insets.top + 10 }]}>
      <Ionicons name={visible ? "chevron-down-outline" : "chevron-up-outline"} size={22} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { position: "absolute", right: 16, zIndex: 999, elevation: 999 },
});
