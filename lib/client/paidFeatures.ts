"use client";
// Website side of the free-only release (same rules as native/lib/billing/paidFeatures.ts).
// NEXT_PUBLIC_PAYMENTS_LIVE is read at build time: set it to "true" on Railway and redeploy when
// paid features launch. Until then: no UPGRADE page in the menus, no "Pro" mentions, and no
// Wardrobe page for accounts without AI (the whole page is the AI wardrobe report).
import { useEntitlements } from "@/contexts/EntitlementsContext";

export const PAYMENTS_LIVE = process.env.NEXT_PUBLIC_PAYMENTS_LIVE === "true";

export function useHiddenPages(): Set<string> {
  const { ready, hasAI, wardrobeScans } = useEntitlements();
  const hidden = new Set<string>();
  if (PAYMENTS_LIVE) return hidden;
  hidden.add("/upgrade");
  if (ready && !hasAI && !(wardrobeScans > 0)) hidden.add("/wardrobe-analysis");
  return hidden;
}
