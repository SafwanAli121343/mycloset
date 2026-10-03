import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { ScreenCenter } from "./ScreenCenter";
import { TextButton } from "./TextButton";
import { colors, type, spacing } from "../theme/theme";
import type { MainTabParamList } from "../navigation/MainTabs";

// Dims a piece of UI that needs AI access (a score readout, an aesthetic filter chip row) and
// overlays a small "AI · UPGRADE" tag. Same plain-text-button visual language as the rest of the
// app — no boxed/badge styling. Children stay mounted (so layout doesn't jump when a user
// upgrades and the lock disappears) but are non-interactive while locked.
//
// The whole dimmed region is one TouchableOpacity, not just the small label text — a real, fixed
// bug: overlayTag spans the FULL bounds of the locked area, but previously only the tiny
// TextButton inside it actually had a press handler, so tapping anywhere else on a greyed-out
// filter or score readout (almost all of its area) silently did nothing at all. Now any tap on
// the locked region responds the same way the label always has: straight to Upgrade, with the
// already-visible "LABEL: UPGRADE" text as the "this is locked behind Pro" message — it doesn't
// need a separate alert since it's never hidden pending a tap in the first place.
export function LockedOverlay({ locked, label = "AI FEATURE", children }: { locked: boolean; label?: string; children: React.ReactNode }) {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  if (!locked) return <>{children}</>;
  return (
    <View>
      <View pointerEvents="none" style={{ opacity: 0.3 }}>{children}</View>
      <TouchableOpacity style={styles.overlayTag} activeOpacity={0.6} onPress={() => navigation.navigate("Upgrade")}>
        <Text style={[type.label, { color: colors.textMuted }]}>{label}: UPGRADE</Text>
      </TouchableOpacity>
    </View>
  );
}

// Full-screen version for a tab that's entirely AI-dependent (Wardrobe). Matches ScreenCenter's
// existing loading/empty-state layout exactly, just with different content.
export function LockedScreen({ title, description }: { title: string; description: string }) {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  return (
    <ScreenCenter>
      <Text style={[type.title, { textAlign: "center" }]}>{title}</Text>
      <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.lg }]}>
        {description}
      </Text>
      <TextButton label="UPGRADE" onPress={() => navigation.navigate("Upgrade")} />
    </ScreenCenter>
  );
}

const styles = StyleSheet.create({
  overlayTag: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
