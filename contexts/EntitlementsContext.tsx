"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { invalidateClientCache } from "@/lib/clientCache";
import { useAuth } from "./AuthContext";
import { FULL_ACCESS_EMAILS, type TierId } from "@/lib/billing/plans";

type BillingStatus = {
  tier: TierId;
  hasAI: boolean;
  aiCredits: number | null; // null = unlimited (Pro)
  // One-time purchase balances by type (Settings → Plan).
  itemScans: number;
  wardrobeScans: number;
  isFullAccessOverride: boolean;
  tierExpiresAt: string | null;
};

type EntitlementsContextType = BillingStatus & {
  loading: boolean;
  // True once auth has loaded and, if signed in, the first status fetch has settled. Before
  // that, tier/hasAI are only the "free" placeholder — anything whose behavior differs by tier
  // waits on this so a Pro user is never briefly treated as free.
  ready: boolean;
  refresh: () => Promise<void>;
};

const DEFAULT_STATUS: BillingStatus = {
  tier: "free", hasAI: false, aiCredits: 0, isFullAccessOverride: false, tierExpiresAt: null, itemScans: 0, wardrobeScans: 0,
};

const EntitlementsContext = createContext<EntitlementsContextType | null>(null);

// Web-side counterpart to native/lib/billing/Entitlements.tsx (native can't import across the
// repo boundary into a separate Metro bundle) — same shape, same /api/billing/status source of
// truth, kept in sync by hand like every other native/web pair in this codebase. Web previously
// had NO client-side entitlement awareness at all — nothing called /api/billing/status — which is
// exactly why free-tier gating on web had no visual "locked" state to show, only silent
// null/empty data from routes that were already correctly gated server-side.
export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { user, isSignedIn, isLoaded } = useAuth();
  const [status, setStatus] = useState<BillingStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSignedIn) { setStatus(DEFAULT_STATUS); setFetched(false); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/billing/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // Network failure — keep whatever we last had rather than yanking access away offline.
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [isSignedIn]);

  useEffect(() => { refresh(); }, [refresh]);

  // Free ⇄ Pro: cached page data was shaped for the old plan — drop it so every page refetches
  // what the new plan shows (same as the app's Entitlements provider).
  const lastHasAI = useRef<boolean | null>(null);
  useEffect(() => {
    if (!fetched) return;
    if (lastHasAI.current !== null && lastHasAI.current !== status.hasAI) {
      invalidateClientCache();
      try { localStorage.removeItem("wa_cache_v20"); } catch {}
    }
    lastHasAI.current = status.hasAI;
  }, [status.hasAI, fetched]);

  // Re-checked whenever the tab comes back into view: a subscription bought, renewed or lapsed
  // elsewhere (e.g. in the app) is picked up without a reload.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // Client-side mirror of the same override the backend applies — purely cosmetic (instant UI
  // unlock without waiting on the network round trip) since every gated backend route enforces
  // it independently regardless of what this client believes.
  const overridden = !!user?.email && FULL_ACCESS_EMAILS.includes(user.email.toLowerCase().trim());
  const effective: BillingStatus = overridden
    ? { tier: "pro", hasAI: true, aiCredits: null, isFullAccessOverride: true, tierExpiresAt: null, itemScans: status.itemScans ?? 0, wardrobeScans: status.wardrobeScans ?? 0 }
    : status;

  return (
    <EntitlementsContext.Provider value={{ ...effective, loading, ready: overridden || (isLoaded && (!isSignedIn || fetched)), refresh }}>
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements() {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error("useEntitlements must be used within EntitlementsProvider");
  return ctx;
}
