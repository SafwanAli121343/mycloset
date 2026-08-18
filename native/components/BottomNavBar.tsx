import { useRef, useEffect } from "react";
import { TouchableOpacity, Text, StyleSheet, Animated, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/AuthContext";
import { useNavBarVisibility } from "../lib/NavBarVisibility";
import { colors, fontFamily, spacing } from "../theme/theme";
import type { MainTabParamList } from "../navigation/MainTabs";

type TabKey = keyof MainTabParamList;

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "Closet", label: "Closet", icon: "shirt-outline" },
  { key: "Add", label: "Add", icon: "add-circle-outline" },
  { key: "Calendar", label: "Cal", icon: "calendar-outline" },
  { key: "Outfits", label: "Outfits", icon: "albums-outline" },
  { key: "Builder", label: "Build", icon: "construct-outline" },
  { key: "Preview", label: "Preview", icon: "eye-outline" },
  { key: "Wardrobe", label: "Wardrobe", icon: "sparkles-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
];

// Exported so screens with their own bottom-anchored content (Builder's score/inventory
// controls, etc.) can reserve exactly enough space for the bar instead of guessing at a
// padding value — mirrors the website's own TAB_BAR_H export (components/MobileTabBar.tsx).
export const BAR_CONTENT_H = 64;

export function BottomNavBar({ activeTab, onNavigate }: { activeTab: TabKey | undefined; onNavigate: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { visible } = useNavBarVisibility();
  const translateY = useRef(new Animated.Value(0)).current;
  const totalH = BAR_CONTENT_H + insets.bottom;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : totalH + 20,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY, totalH]);

  return (
    <Animated.View
      style={[styles.bar, { paddingBottom: insets.bottom, transform: [{ translateY }] }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {TABS.map(t => {
          const active = activeTab === t.key;
          return (
            <TouchableOpacity key={t.key} style={styles.item} onPress={() => onNavigate(t.key)} hitSlop={4}>
              <Ionicons name={t.icon} size={26} color={active ? colors.text : colors.textFaint} />
              <Text style={[styles.label, { color: active ? colors.text : colors.textFaint, fontWeight: active ? "700" : "400" }]} numberOfLines={1}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.item} onPress={signOut} hitSlop={4}>
          <Ionicons name="log-out-outline" size={26} color={colors.bad} />
          <Text style={[styles.label, { color: colors.bad }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: 6, minHeight: BAR_CONTENT_H,
  },
  row: { flexGrow: 1, alignItems: "center", paddingHorizontal: spacing.md },
  item: { width: 78, alignItems: "center", justifyContent: "center", gap: 4 },
  // Matches the website's own bottom tab bar exactly (components/MobileTabBar.tsx): Arial/
  // Helvetica, uppercase, 0.06em letter-spacing, weight only bumping to 700 when active — sized
  // up a bit from the site's own 8.5px/20px-icon numbers since this bar carries more items
  // (9 vs the site's 5) in a horizontally-scrolling row rather than a fixed one-screen-wide row.
  label: { fontFamily, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" },
});
