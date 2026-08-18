import { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Easing } from "react-native";
import { colors } from "../theme/theme";

// Matches the website's ".adding-dot" loading indicator exactly (app/add-item/page.tsx
// DOT_KEYFRAMES): three dots fading 0->1->0 on a 1.2s loop, staggered 0.2s apart. Used
// everywhere a spinner would otherwise appear, for a consistent app-wide loading feel.
export function LoadingDots({ color = colors.textMuted, size = 6, style }: { color?: string; size?: number; style?: object }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(v, { toValue: 1, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 720, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(Math.max(0, 400 - i * 200)),
        ])
      )
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [values]);

  return (
    <View style={[styles.row, style]}>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dot: {},
});
