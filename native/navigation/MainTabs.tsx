import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { colors } from "../theme/theme";
import ClosetScreen from "../screens/ClosetScreen";
import AddItemScreen from "../screens/AddItemScreen";
import CalendarScreen from "../screens/CalendarScreen";
import OutfitsScreen from "../screens/OutfitsScreen";
import BuilderScreen from "../screens/BuilderScreen";
import PreviewScreen from "../screens/PreviewScreen";
import WardrobeScreen from "../screens/WardrobeScreen";
import SettingsScreen from "../screens/SettingsScreen";
import UpgradeScreen from "../screens/UpgradeScreen";
import VerifyEmailScreen from "../screens/VerifyEmailScreen";

export type MainTabParamList = {
  Closet: undefined;
  Add: undefined;
  Calendar: { refreshAt?: number } | undefined;
  Outfits: undefined;
  // Set when Calendar's EDIT button sends an existing day's outfit here to be edited with
  // Builder's own slot/inventory UI, rather than duplicating that whole editor a second time.
  Builder: { editDate?: string; editOutfitId?: string; initialIds?: string[] } | undefined;
  Preview: undefined;
  Wardrobe: undefined;
  Upgrade: undefined;
  Settings: undefined;
  // Not in BottomNavBar's fixed tab list (see BottomNavBar.tsx) — reachable only via Settings'
  // "Verify Now" link during the soft-gate window. Past the 7-day grace period, App.tsx renders
  // this screen standalone instead of MainTabs entirely, so this registration only matters
  // while the account is still soft-gated.
  VerifyEmail: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// Real bottom-tabs (not a flat stack) specifically so switching tabs doesn't unmount/refetch a
// screen every time — React Navigation keeps each tab's screen instance mounted once visited,
// so coming back to a tab you've already opened is instant, no reload. The navigator's own tab
// bar UI is suppressed (tabBar={() => null}) — BottomNavBar.tsx renders a custom one outside
// this tree entirely (see App.tsx) so the screen-content interaction detector that auto-hides
// it doesn't also cover the bar itself.
export default function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Closet"
      tabBar={() => null}
      // sceneStyle gives the native screen container itself an opaque background before any
      // screen's own content paints — without it, react-native-screens' native attach/detach
      // cycle during a tab switch can show through to whatever's behind (black, or another
      // screen) for a single frame, which read as the whole content area "flashing".
      screenOptions={{ headerShown: false, lazy: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tab.Screen name="Closet" component={ClosetScreen} />
      <Tab.Screen name="Add" component={AddItemScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="Outfits" component={OutfitsScreen} />
      <Tab.Screen name="Builder" component={BuilderScreen} />
      <Tab.Screen name="Preview" component={PreviewScreen} />
      <Tab.Screen name="Wardrobe" component={WardrobeScreen} />
      <Tab.Screen name="Upgrade" component={UpgradeScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
      <Tab.Screen name="VerifyEmail" component={VerifyEmailScreen} />
    </Tab.Navigator>
  );
}
