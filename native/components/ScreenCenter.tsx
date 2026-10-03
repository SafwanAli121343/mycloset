import type { ReactNode } from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/theme";

// The one shared "whole screen is just loading/empty/error state" treatment — used identically
// by every full-screen loading state (Closet, Wardrobe, Builder, Outfits) instead of each screen
// hand-rolling its own centering. Every one of those had a slightly different recipe (some via
// SafeAreaView's default all-edge inset behavior, some via a plain View with no inset handling
// at all, different extra padding constants) — which is exactly why the loading dots landed at a
// visibly different height from one screen to the next. Insets are read explicitly here (not via
// SafeAreaView's own default edge behavior) so the vertical math is the same everywhere,
// regardless of how any individual screen happens to be wrapped.
export function ScreenCenter({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.center, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
});
