import { View, Text, StyleSheet } from "react-native";
import { colors, fontFamily } from "../theme/theme";

// For short list items (colors, aesthetic tags) that read badly as one-per-line. Items wrap
// at their natural width with a small gap rather than fixed 1/3-width columns — a fixed
// column forces short words like "Black" to center in a much wider box than they need,
// which reads as way too spaced out once several rows stack up.
export function GridSection({ items, color = colors.text }: { items: string[]; color?: string }) {
  return (
    <View style={styles.grid}>
      {items.map((t, i) => (
        <Text key={i} style={[styles.item, { color }]}>{t}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", rowGap: 4, columnGap: 14 },
  item: { fontFamily, fontSize: 12 },
});
