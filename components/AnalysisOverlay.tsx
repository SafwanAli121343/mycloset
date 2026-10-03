"use client";
import { useEffect, useState } from "react";
import { LoadingDots } from "./LoadingDots";

// Full-screen loading for a purchased analysis — the website's twin of
// native/components/AnalysisOverlay.tsx: three dots with the analysis stages cycling underneath,
// covering the whole page (navbar and mobile tab bar included) so there's nowhere to click away
// to mid-way. Closing the tab is still possible; the job keeps running on the server and this
// comes back when the page is opened again.
export function AnalysisOverlay({ visible, stages }: { visible: boolean; stages: string[] }) {
  const [i, setI] = useState(0);
  const [fade, setFade] = useState(1);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setFade(0);
      setTimeout(() => { setI(n => (n + 1) % stages.length); setFade(1); }, 220);
    }, 2200);
    return () => clearInterval(id);
  }, [visible, stages.length]);
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", inset: 0, zIndex: 10000, background: "#fff",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32,
      }}
    >
      <LoadingDots />
      <p style={{ fontFamily: "Arial, sans-serif", fontSize: 13, color: "#555", marginTop: 18, textAlign: "center", opacity: fade, transition: "opacity 220ms ease" }}>
        {stages[i % stages.length]}
      </p>
    </div>
  );
}
