import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavBarVisibility } from "../lib/NavBarVisibility";
import { BAR_CONTENT_H, BAR_BOTTOM_GAP } from "./BottomNavBar";
import { colors } from "../theme/theme";

// Whatever a screen renders at the very bottom (a scrolled-to-the-end list, a fixed action row,
// etc.) can sit in the same footer strip the floating BottomNavBar occupies. While the bar is
// up, that strip should read as "nav controls", not a mix of nav pill and whatever content
// happens to be peeking out from behind/around it — so this covers exactly that strip,
// opaque, capturing taps, whenever the bar is visible, and fades out of the way (both visually
// and for touches) as soon as it's dismissed. Suppressed the same way ShowNavButton is, for
// full-screen overlays that don't have a bar to begin with.
export function NavBarContentMask() {
  const insets = useSafeAreaInsets();
  const { visible, suppressed } = useNavBarVisibility();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible && !suppressed ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, suppressed, opacity]);

  // Always mounted — visibility is driven entirely through `opacity`, never through
  // conditionally returning null. This view previously unmounted while suppressed and
  // remounted on close; the fresh native view's first painted frame didn't yet have the
  // (persistent, native-driven) opacity value connected to it, so it briefly painted at its
  // default — fully opaque — before catching up a frame later. That showed as an opaque bar
  // flashing across the bottom of the screen right at the moment an outfit's spread view
  // closed, exactly the "refresh" near the bottom of the grid. Never unmounting this view
  // removes the native reconnect entirely, rather than papering over its timing.
  const totalH = BAR_CONTENT_H + insets.bottom + BAR_BOTTOM_GAP;

  return (
    <Animated.View
      pointerEvents={visible && !suppressed ? "auto" : "none"}
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: totalH,
        backgroundColor: colors.bg, opacity,
      }}
    />
  );
}
