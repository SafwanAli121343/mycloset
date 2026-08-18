import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Ctx = { visible: boolean; suppressed: boolean; show: () => void; hide: () => void; setSuppressed: (v: boolean) => void };
const NavBarContext = createContext<Ctx>({ visible: true, suppressed: false, show: () => {}, hide: () => {}, setSuppressed: () => {} });

// Tracks whether the bottom nav bar should be showing. Starts visible; any interaction with
// the actual screen content (tap or scroll) hides it (see the capture-phase touch listener in
// App.tsx, which wraps only the screen-content region — not this bar itself, so tapping a tab
// button doesn't immediately hide the bar it was just used to reach). Tapping the "show nav"
// button that appears in the bar's place brings it back until the next interaction.
//
// `suppressed` is separate from `visible` — it's for a full-screen overlay (like Outfits'
// spread animation) where neither the bar NOR its "show nav" toggle make sense at all, rather
// than just being temporarily hidden. Tracked as a counter internally (via useSuppressNavButton)
// so nested/overlapping suppressions can't clear each other early, but exposed as a boolean.
export function NavBarVisibilityProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  const [suppressCount, setSuppressCount] = useState(0);
  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);
  const setSuppressed = useCallback((v: boolean) => setSuppressCount(c => Math.max(0, c + (v ? 1 : -1))), []);
  const value = useMemo(
    () => ({ visible, suppressed: suppressCount > 0, show, hide, setSuppressed }),
    [visible, suppressCount, show, hide, setSuppressed]
  );
  return <NavBarContext.Provider value={value}>{children}</NavBarContext.Provider>;
}

export function useNavBarVisibility() {
  return useContext(NavBarContext);
}

// Call from a full-screen overlay while it's mounted (e.g. Outfits' spread view) to hide the
// "show nav" button entirely for as long as that overlay is up.
export function useSuppressNavButton() {
  const { setSuppressed } = useContext(NavBarContext);
  useEffect(() => {
    setSuppressed(true);
    return () => setSuppressed(false);
  }, [setSuppressed]);
}
