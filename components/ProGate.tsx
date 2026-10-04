"use client";
import { PAYMENTS_LIVE } from "@/lib/client/paidFeatures";
import type { ReactNode } from "react";
import { useEntitlements } from "@/contexts/EntitlementsContext";

// Wraps a page whose whole purpose is a Pro feature (scores or AI analysis). A free user sees a
// plain explanation instead of a page that renders their scores anyway or fails against routes
// the server already refuses for them. Renders nothing until entitlements are known, so a Pro
// user never flashes the locked state.
export function ProGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { hasAI, ready } = useEntitlements();
  if (!ready) return null;
  if (hasAI) return <>{children}</>;
  return (
    <main className="center-lift" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontFamily: "Arial, sans-serif" }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", margin: 0 }}>{PAYMENTS_LIVE ? `${feature} is a Pro feature` : `${feature} isn't available on your account`}</p>
      {PAYMENTS_LIVE && <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>Upgrade in the MyCloset app to unlock it.</p>}
    </main>
  );
}
