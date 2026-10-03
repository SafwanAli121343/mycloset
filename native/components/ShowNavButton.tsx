import { useEffect, useRef } from "react";
import { TouchableOpacity, StyleSheet, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavBarVisibility } from "../lib/NavBarVisibility";
import { colors } from "../theme/theme";

// A persistent top-right toggle for the bottom nav bar: chevron-down (tap to close it) while
// the bar is showing, chevron-up (tap to bring it back) while it's hidden — rather than only
// existing in the hidden state. Faded out (never unmounted) while a full-screen overlay
// suppresses it (see useSuppressNavButton) — same reasoning as NavBarContentMask: a
// conditionally-unmounted view comes back as a brand-new native view, and that fresh view's
// first painted frame doesn't yet have its (persistent, native-driven) opacity connected, so it
// briefly paints at its native default — fully opaque/visible — before catching up a frame
// later. This button sits at the mirror position of a spread overlay's own close (×) button
// (both top-right-ish), so that one-frame pop-in landed right where the eye already was the
// instant a stack finished closing — read as exactly the "flash" on close.
// The top band's shared center line. The chevron below sits NAV_ROW_TOP below the safe-area top
// in a NAV_ROW_H box, so its center is insets.top + NAV_ROW_TOP + NAV_ROW_H / 2. Every screen's
// own top-row control (RESET, MONTH VIEW, FILTER, tabs, page titles) uses these same two numbers
// so everything in that band shares one exact vertical center with this button.
export const NAV_ROW_TOP = 10;
export const NAV_ROW_H = 22;

export function ShowNavButton() {
  const insets = useSafeAreaInsets();
  const { visible, suppressed, show, hide } = useNavBarVisibility();
  const opacity = useRef(new Animated.Value(suppressed ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: suppressed ? 0 : 1, duration: 180, useNativeDriver: true }).start();
  }, [suppressed, opacity]);

  return (
    <Animated.View pointerEvents={suppressed ? "none" : "auto"} style={[styles.btn, { top: insets.top + NAV_ROW_TOP, opacity }]}>
      <TouchableOpacity onPress={visible ? hide : show} hitSlop={14}>
        <Ionicons name={visible ? "chevron-down-outline" : "chevron-up-outline"} size={NAV_ROW_H} color={colors.textMuted} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: { position: "absolute", right: 16, zIndex: 999, elevation: 999 },
});
