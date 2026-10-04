// What the free-only release (PAYMENTS_ENABLED false, lib/config.ts) leaves out. Nothing here
// is shown that a user couldn't actually get: no Upgrade tab, and no Wardrobe tab for accounts
// without AI (the whole tab is the AI wardrobe report). With payments on, everything shows and
// the locked states point to Upgrade as before.
import { PAYMENTS_ENABLED } from "../config";
import { useEntitlements } from "./Entitlements";
import type { MainTabParamList } from "../../navigation/MainTabs";

export function useHiddenTabs(): Set<keyof MainTabParamList> {
  const { ready, hasAI, wardrobeScans } = useEntitlements();
  const hidden = new Set<keyof MainTabParamList>();
  if (PAYMENTS_ENABLED) return hidden;
  hidden.add("Upgrade");
  if (ready && !hasAI && !(wardrobeScans > 0)) hidden.add("Wardrobe");
  return hidden;
}
