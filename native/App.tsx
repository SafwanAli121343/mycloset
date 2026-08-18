import { useState } from "react";
import { View } from "react-native";
import { enableScreens } from "react-native-screens";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

// The bottom-tab navigator wraps each screen in a native react-native-screens Screen so
// inactive tabs can be detached from the native view hierarchy for memory. That attach/detach
// happens at the native layer, outside any background color set via screenOptions.sceneStyle —
// which only paints an inner JS-level wrapper, not the native Screen container itself — so on a
// tab switch there could be a frame where the newly-attaching screen hadn't composited yet and
// whatever was behind it (another screen, or nothing) showed through, reading as a flash. This
// app is a flat 8-tab bar, not a deep stack, so the memory case for native-level detachment is
// weak; disabling it trades that modest saving for tab switches that are guaranteed to be a
// plain, synchronous JS view swap with no native transition to glitch.
enableScreens(false);
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { NavBarVisibilityProvider, useNavBarVisibility } from "./lib/NavBarVisibility";
import AuthStack from "./navigation/AuthStack";
import MainTabs, { type MainTabParamList } from "./navigation/MainTabs";
import { BottomNavBar } from "./components/BottomNavBar";
import { ShowNavButton } from "./components/ShowNavButton";
import { LoadingDots } from "./components/LoadingDots";
import { colors } from "./theme/theme";

function Root() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <LoadingDots />
      </View>
    );
  }

  return isSignedIn ? <MainTabs /> : <AuthStack />;
}

// Any tap or scroll ON THE SCREEN CONTENT hides the bottom bar — this wraps only the screen
// area (a sibling of BottomNavBar/ShowNavButton in AppShell below, not an ancestor of them),
// so using the bar itself to switch tabs never triggers its own hide. The listener is
// capture-phase and always returns false ("didn't claim it"), so it observes every touch
// without intercepting or altering how any individual screen actually handles it.
function ScreenArea({ children }: { children: React.ReactNode }) {
  const { hide } = useNavBarVisibility();
  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => { hide(); return false; }}
      onMoveShouldSetResponderCapture={() => { hide(); return false; }}
    >
      {children}
    </View>
  );
}

function AppShell() {
  const { isSignedIn } = useAuth();
  const navigationRef = useNavigationContainerRef<MainTabParamList>();
  const [routeName, setRouteName] = useState<string | undefined>();

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => setRouteName(navigationRef.getCurrentRoute()?.name)}
      onStateChange={() => setRouteName(navigationRef.getCurrentRoute()?.name)}
    >
      <ScreenArea>
        <Root />
      </ScreenArea>
      {isSignedIn && (
        <BottomNavBar
          activeTab={routeName as keyof MainTabParamList | undefined}
          onNavigate={tab => navigationRef.isReady() && navigationRef.navigate(tab)}
        />
      )}
      {isSignedIn && <ShowNavButton />}
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavBarVisibilityProvider>
          <AppShell />
        </NavBarVisibilityProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
