import { useRef, useEffect, useState } from "react";
import { TouchableOpacity, Text, StyleSheet, Animated, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/AuthContext";
import { useNavBarVisibility } from "../lib/NavBarVisibility";
import { useHiddenTabs } from "../lib/billing/paidFeatures";
import { ConfirmDialog } from "./ConfirmDialog";
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
  { key: "Upgrade", label: "Upgrade", icon: "logo-usd" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
];

export const BAR_CONTENT_H = 64;
// Gap between the pill's bottom edge and the safe-area bottom edge — gives the floating look.
// Screens that reserve space for the bar should add this to their BAR_CONTENT_H + insets.bottom.
export const BAR_BOTTOM_GAP = 12;

export function BottomNavBar({ activeTab, onNavigate }: { activeTab: TabKey | undefined; onNavigate: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  const { signOut, isGuest } = useAuth();
  // A guest has no email to sign back in with, so signing out loses the closet: confirm first.
  const [confirmGuestSignOut, setConfirmGuestSignOut] = useState(false);
  const onSignOut = () => { if (isGuest) setConfirmGuestSignOut(true); else signOut(); };
  const { visible } = useNavBarVisibility();
  const hiddenTabs = useHiddenTabs();
  const totalH = BAR_CONTENT_H + insets.bottom + BAR_BOTTOM_GAP;
  // Starts at whichever position actually matches `visible` on this component's first mount
  // (rather than always literally 0) — this mounts for the first time at the exact moment the
  // user enters the app, so if `visible` had already flipped false by then, a hardcoded-visible
  // starting value would paint one full frame at the wrong (visible) position before the effect
  // below caught up and animated it away — a real, findable one-frame flash-then-hide.
  const translateY = useRef(new Animated.Value(visible ? 0 : totalH + 20)).current;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    Animated.timing(translateY, {
      toValue: visible ? 0 : totalH + 20,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY, totalH]);

  return (
    <Animated.View
      style={[styles.bar, { bottom: insets.bottom + BAR_BOTTOM_GAP, transform: [{ translateY }] }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {TABS.filter(t => !hiddenTabs.has(t.key)).map(t => {
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
        <TouchableOpacity style={styles.item} onPress={onSignOut} hitSlop={4}>
          <Ionicons name="log-out-outline" size={26} color={colors.bad} />
          <Text style={[styles.label, { color: colors.bad }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
      <ConfirmDialog
        visible={confirmGuestSignOut}
        title="SIGN OUT?"
        body="You're using a guest account. Signing out deletes access to this closet for good. Create an account in Settings first to keep it."
        confirmLabel="SIGN OUT"
        confirmColor={colors.bad}
        onCancel={() => setConfirmGuestSignOut(false)}
        onConfirm={() => { setConfirmGuestSignOut(false); signOut(); }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute", left: 16, right: 16,
    height: BAR_CONTENT_H,
    backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: BAR_CONTENT_H / 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: "hidden",
  },
  row: { flexGrow: 1, alignItems: "center", paddingHorizontal: spacing.sm },
  item: { width: 72, alignItems: "center", justifyContent: "center", gap: 4 },
  label: { fontFamily, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" },
});
