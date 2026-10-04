import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { apiJson, ApiError, invalidateCache } from "../api";
import { useAuth } from "../AuthContext";
import { FULL_ACCESS_EMAILS, type TierId } from "./plans";
import { initPurchases } from "./purchases";

type BillingStatus = {
  tier: TierId;
  hasAI: boolean;
  aiCredits: number | null; // null = unlimited (Pro)
  // One-time purchase balances by type (Settings → PLAN): "Single Item Analysis" and
  // "Full Wardrobe Analysis".
  itemScans: number;
  wardrobeScans: number;
  isFullAccessOverride: boolean;
  tierExpiresAt: string | null;
};

type EntitlementsContextType = BillingStatus & {
  loading: boolean;
  // True once auth has loaded and, if signed in, the first status fetch has settled.
  // Before that, tier/hasAI are only the "free" placeholder — screens whose layout differs by
  // tier wait on this so a Pro user never sees the free layout flash first.
  ready: boolean;
  refresh: () => Promise<void>;
  redeemKey: (code: string) => Promise<{ ok: boolean; error?: string }>;
};

const DEFAULT_STATUS: BillingStatus = {
  tier: "free", hasAI: false, aiCredits: 0, isFullAccessOverride: false, tierExpiresAt: null, itemScans: 0, wardrobeScans: 0,
};

const EntitlementsContext = createContext<EntitlementsContextType | null>(null);

// Mirrors AuthContext's shape on purpose: a status object read from the server (never trusted
// as a local guess), refreshed on sign-in and exposed everywhere via useEntitlements(). Every
// gated screen reads `hasAI`/`tier` from here rather than re-deriving it — resolveEntitlement()
// on the backend is the actual source of truth; this is just its client-side mirror.
export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { user, isSignedIn, isLoaded } = useAuth();
  const [status, setStatus] = useState<BillingStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSignedIn) { setStatus(DEFAULT_STATUS); setFetched(false); return; }
    setLoading(true);
    try {
      const d = await apiJson<BillingStatus>("/api/billing/status");
      setStatus(d);
    } catch {
      // Network failure — keep whatever we last had rather than yanking access away offline.
      // The known-locally full-access override (see below) still applies even if this fails.
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [isSignedIn]);

  useEffect(() => { refresh(); }, [refresh]);

  // Store purchases are tied to the signed-in account (no-op while PAYMENTS_ENABLED is false).
  useEffect(() => { if (isLoaded) initPurchases(isSignedIn ? user?.id ?? null : null); }, [isLoaded, isSignedIn, user?.id]);

  // Re-checked whenever the app comes back to the foreground: a subscription bought, renewed or
  // lapsed elsewhere (another device, the App Store's own settings) is picked up without a restart.
  useEffect(() => {
    const sub = AppState.addEventListener("change", st => { if (st === "active") refresh(); });
    return () => sub.remove();
  }, [refresh]);

  // Free ⇄ Pro: every cached response was shaped for the old plan (AI details stripped or not,
  // scores present or not), so drop it all — each screen refetches what the new plan shows.
  const lastHasAI = useRef<boolean | null>(null);
  useEffect(() => {
    if (!fetched) return;
    if (lastHasAI.current !== null && lastHasAI.current !== status.hasAI) invalidateCache();
    lastHasAI.current = status.hasAI;
  }, [status.hasAI, fetched]);

  const redeemKey = useCallback(async (code: string) => {
    try {
      const d = await apiJson<BillingStatus & { ok: boolean }>("/api/billing/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setStatus(s => ({ ...s, tier: d.tier, hasAI: d.hasAI, aiCredits: d.aiCredits }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : "Something went wrong." };
    }
  }, []);

  // Client-side mirror of the same override the backend applies — purely cosmetic (instant UI
  // unlock without waiting on the network round trip) since every gated backend route enforces
  // it independently regardless of what this client believes.
  const overridden = !!user?.email && FULL_ACCESS_EMAILS.includes(user.email.toLowerCase().trim());
  const effective: BillingStatus = overridden
    ? { tier: "pro", hasAI: true, aiCredits: null, isFullAccessOverride: true, tierExpiresAt: null, itemScans: status.itemScans ?? 0, wardrobeScans: status.wardrobeScans ?? 0 }
    : status;

  return (
    <EntitlementsContext.Provider value={{ ...effective, loading, ready: overridden || (isLoaded && (!isSignedIn || fetched)), refresh, redeemKey }}>
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements() {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error("useEntitlements must be used within EntitlementsProvider");
  return ctx;
}
