import { useState, useEffect, useRef } from "react";
import { useKeyboardLift } from "./lib/useKeyboardLift";
import { View, Text, TouchableOpacity, Animated, Easing } from "react-native";
import { apiJsonCached } from "./lib/api";
import { initDataCache } from "./lib/dataCache";
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
//
// (Tried enabling this + enableFreeze() at one point, on the theory that all 9 tabs staying
// permanently mounted and "hot" was contributing to animation stutter elsewhere. In practice it
// made every single tab switch pay real native attach/detach cost instead — an app-wide
// slowdown that was immediately, universally felt, for a background-contention theory that
// didn't actually fix the animation issues it was meant to help. Reverted.)
enableScreens(false);
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { EntitlementsProvider } from "./lib/billing/Entitlements";
import { NavBarVisibilityProvider, useNavBarVisibility } from "./lib/NavBarVisibility";
import AuthStack from "./navigation/AuthStack";
import MainTabs, { type MainTabParamList } from "./navigation/MainTabs";
import VerifyEmailScreen from "./screens/VerifyEmailScreen";
import { BottomNavBar } from "./components/BottomNavBar";
import { ShowNavButton } from "./components/ShowNavButton";
import { NavBarContentMask } from "./components/NavBarContentMask";
import { TutorialOverlay } from "./components/TutorialOverlay";
import { useTutorialStage, setStageNode } from "./lib/tutorial";
import { LoadingDots } from "./components/LoadingDots";
import { ScreenCenter } from "./components/ScreenCenter";
import { colors, spacing, type as typeStyles } from "./theme/theme";
import { getNavigationBlock, type NavigationBlockInfo } from "./lib/navigationBlock";

// Any tap or scroll ON THE SCREEN CONTENT hides the bottom bar — this wraps only the screen
// area (a sibling of BottomNavBar/ShowNavButton in AppShell below, not an ancestor of them),
// so using the bar itself to switch tabs never triggers its own hide. The listener is
// capture-phase and always returns false ("didn't claim it"), so it observes every touch
// without intercepting or altering how any individual screen actually handles it.
function ScreenArea({ children, hasEntered }: { children: React.ReactNode; hasEntered: boolean }) {
  const { hide } = useNavBarVisibility();
  // ScreenArea itself mounts once, at app startup (it wraps the loading spinner / AuthStack /
  // MainTabs ternary, unconditionally) — NOT at the moment hasEntered flips true. An earlier fix
  // anchored its grace window to ScreenArea's own mount time, which meant the window had already
  // expired by the time the user actually reached the entrance tap, seconds or longer after
  // launch — a no-op. A second fix re-armed the window from a useEffect keyed on hasEntered, but
  // that still raced a busy JS thread: the moment hasEntered flips is also the moment MainTabs's
  // whole tab stack mounts for the first time (heavy — every screen's own initial effects, data-
  // cache reads, etc.), and native touch delivery doesn't wait for React effects to flush. If a
  // touch's responder-capture callback reached the JS thread before that queued effect got a
  // turn to run, armedAtRef was still its stale/initial value, so the elapsed-time check saw a
  // huge delta and hid the bar immediately — a no-op grace window again, just for a subtler
  // reason. Arming it INLINE during render instead (comparing against the previous render's
  // hasEntered via a plain ref, no effect involved) closes that gap: by the time this component
  // re-renders with hasEntered=true, armedAtRef is already correct before any child touch
  // handling from that new state is even possible.
  const armedAtRef = useRef(0);
  const prevHasEnteredRef = useRef(hasEntered);
  if (hasEntered && !prevHasEnteredRef.current) {
    armedAtRef.current = Date.now();
  }
  prevHasEnteredRef.current = hasEntered;
  const guardedHide = () => { if (Date.now() - armedAtRef.current > 900) hide(); };

  // First-run tutorial: the page shrinks into a preview card at the top so the tutorial's text
  // below it never overlaps anything (lib/tutorial.ts). Two nested views keep the math simple:
  // the outer one moves the card down, the inner one scales it from its top edge.
  const stage = useTutorialStage();
  const scale = useRef(new Animated.Value(1)).current;
  const top = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: stage?.scale ?? 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(top, { toValue: stage?.top ?? 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [stage, scale, top]);
  const staged = !!stage;
  // Keeps the field being typed in above the keyboard on every signed-in screen (Sign In / Sign
  // Up have their own lift).
  const keyboardLift = useKeyboardLift(hasEntered);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => { guardedHide(); return false; }}
      onMoveShouldSetResponderCapture={() => { guardedHide(); return false; }}
    >
      <Animated.View style={{ flex: 1, transform: [{ translateY: Animated.add(top, keyboardLift) }] }}>
        <Animated.View
          ref={setStageNode as never}
          collapsable={false}
          style={[
            { flex: 1, transform: [{ scale }], transformOrigin: "50% 0%" },
            staged && { borderWidth: 3, borderColor: colors.borderStrong, borderRadius: 44, overflow: "hidden" },
          ]}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// Top-of-screen banner shown when a significant process (AI analysis, etc.) is running and the
// user tries to navigate away. Slides in from the top, dismisses by tapping outside or after
// the user makes a decision. Not a modal — keeps the current screen visible in the background.
function NavBlockBanner({
  message, pendingTab, onConfirmLeave, onDismiss,
}: {
  message: string; pendingTab: string; onConfirmLeave: () => void; onDismiss: () => void;
}) {
  const slideY = useRef(new Animated.Value(-120)).current;
  useEffect(() => {
    Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slideY]);
  return (
    <TouchableOpacity style={{ position: "absolute", inset: 0 } as object} activeOpacity={1} onPress={onDismiss}>
      <Animated.View style={{
        position: "absolute", top: 0, left: 0, right: 0,
        backgroundColor: colors.bg, borderBottomWidth: 1, borderColor: colors.border,
        paddingTop: 56, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        transform: [{ translateY: slideY }],
        shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 8,
      }}>
        <Text style={[typeStyles.body, { textAlign: "center", marginBottom: spacing.md }]}>{message}</Text>
        <TouchableOpacity onPress={onConfirmLeave} hitSlop={8} style={{ alignSelf: "center" }}>
          <Text style={{ fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", fontSize: 11, color: colors.bad }}>CANCEL AND LEAVE</Text>
        </TouchableOpacity>
      </Animated.View>
    </TouchableOpacity>
  );
}

function AppShell() {
  const { isLoaded, isSignedIn, sessionConfirmed, verificationRequired } = useAuth();
  const [cacheReady, setCacheReady] = useState(false);
  const [minDelayDone, setMinDelayDone] = useState(false);
  const navigationRef = useNavigationContainerRef<MainTabParamList>();
  const [routeName, setRouteName] = useState<string | undefined>();
  const [blockedNav, setBlockedNav] = useState<{ tab: keyof MainTabParamList; block: NavigationBlockInfo } | null>(null);
  const [hasEntered, setHasEntered] = useState(false);

  // Hydrate the in-memory cache from AsyncStorage before any screen renders,
  // so every getCached() call in screen useState() initializers is a synchronous hit.
  // minDelayDone ensures the loading screen is visible for at least 400ms even when
  // everything resolves near-instantly (Clerk auth reads from local storage synchronously
  // on return visits, so without this the loading screen can flash for <50ms and disappear).
  useEffect(() => {
    initDataCache().then(() => setCacheReady(true));
    const t = setTimeout(() => setMinDelayDone(true), 400);
    return () => clearTimeout(t);
  }, []);

  // Eagerly prefetch the most-used endpoints the moment the user is signed in so
  // every tab's first visit reads from cache instead of the network.
  useEffect(() => {
    if (!isSignedIn) return;
    apiJsonCached("/api/garments").catch(() => {});
    // skipOutfits=1: matches the exact path Closet/Wardrobe actually request (see
    // ClosetScreen's SCORING_PATH) — a mismatched cache key here would prefetch a response
    // those screens never read from, defeating the whole point of eagerly warming the cache.
    apiJsonCached("/api/scoring?skipOutfits=1").catch(() => {});
    apiJsonCached("/api/wardrobe/state").catch(() => {});
    apiJsonCached("/api/outfits/all-combos", 60_000).catch(() => {});
    // Pre-fetch this month's and next month's calendar outfits so Calendar tab is instant.
    const now = new Date();
    const y = now.getFullYear(); const m = now.getMonth() + 1;
    const nextM = m === 12 ? 1 : m + 1; const nextY = m === 12 ? y + 1 : y;
    apiJsonCached(`/api/outfits?year=${y}&month=${m}`, 300_000).catch(() => {});
    apiJsonCached(`/api/outfits?year=${nextY}&month=${nextM}`, 300_000).catch(() => {});
  }, [isSignedIn]);

  // appReady gates both the screen content AND the nav bar — the bar must not be visible
  // during the loading screen, even if isSignedIn is already true from a cached session.
  // When isSignedIn IS true, it also waits on sessionConfirmed: isLoaded/isSignedIn can flip
  // true immediately off an optimistic on-device cache, with a background call afterward
  // sometimes finding that cached session was actually already expired — showing ENTER (or any
  // real content) on the strength of the cache alone, then yanking it away a moment later, was
  // exactly the "loading -> ENTER flashes -> login screen" bug. No such wait applies when
  // isSignedIn is false — there's nothing optimistic to confirm on the logged-out path.
  const appReady = isLoaded && cacheReady && minDelayDone && (isSignedIn ? sessionConfirmed : true);

  function handleNavigate(tab: keyof MainTabParamList) {
    if (!navigationRef.isReady()) return;
    const block = getNavigationBlock();
    if (block) {
      setBlockedNav({ tab, block });
      return;
    }
    navigationRef.navigate(tab);
  }

  function confirmLeave() {
    if (!blockedNav) return;
    blockedNav.block.onCancel();
    const tab = blockedNav.tab;
    setBlockedNav(null);
    setTimeout(() => navigationRef.isReady() && navigationRef.navigate(tab), 50);
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => setRouteName(navigationRef.getCurrentRoute()?.name)}
      onStateChange={() => setRouteName(navigationRef.getCurrentRoute()?.name)}
    >
      <ScreenArea hasEntered={hasEntered}>
        {appReady
          ? (isSignedIn
              ? (verificationRequired ? <VerifyEmailScreen /> : <MainTabs />)
              : <AuthStack />)
          : (
            // ScreenCenter, same as every screen's own loading dots (components/ReadyGate.tsx),
            // so the dots don't jump position when this hands off to a screen still loading.
            <ScreenCenter>
              <LoadingDots />
            </ScreenCenter>
          )
        }
      </ScreenArea>
      {/* Entry gate: shown after loading completes, before the first real screen. Black bg,
         white ENTER button — one deliberate tap separates the loading phase from the app. */}
      {appReady && isSignedIn && !verificationRequired && !hasEntered && (
        <View style={{ position: "absolute", inset: 0, backgroundColor: "#000", alignItems: "center", justifyContent: "center" } as object}>
          <TouchableOpacity onPress={() => setHasEntered(true)} hitSlop={20}>
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 2.5, textTransform: "uppercase" }}>ENTER</Text>
          </TouchableOpacity>
        </View>
      )}
      {appReady && isSignedIn && !verificationRequired && hasEntered && <NavBarContentMask />}
      {appReady && isSignedIn && !verificationRequired && hasEntered && (
        <BottomNavBar
          activeTab={routeName as keyof MainTabParamList | undefined}
          onNavigate={handleNavigate}
        />
      )}
      {appReady && isSignedIn && !verificationRequired && hasEntered && <ShowNavButton />}
      {/* First-run tutorial — offered once to a new account right after ENTER. */}
      {appReady && isSignedIn && !verificationRequired && hasEntered && (
        <TutorialOverlay navigate={tab => { if (navigationRef.isReady()) navigationRef.navigate(tab); }} />
      )}
      {blockedNav && (
        <NavBlockBanner
          message={blockedNav.block.message}
          pendingTab={blockedNav.tab}
          onConfirmLeave={confirmLeave}
          onDismiss={() => setBlockedNav(null)}
        />
      )}
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <EntitlementsProvider>
          <NavBarVisibilityProvider>
            <AppShell />
          </NavBarVisibilityProvider>
        </EntitlementsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
