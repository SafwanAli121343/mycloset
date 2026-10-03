"use client";

// The website's one loading indicator — the same three dots as the app
// (native/components/LoadingDots.tsx): 6px #555 dots, 6px apart, each fading 0→1→0 on a 1.2s loop,
// staggered 0.2s. Every load on the site uses this (via ReadyGate for full-page loads).
const KEYFRAMES = `
@keyframes mcDotFade { 0%,80%,100% { opacity: 0; } 40% { opacity: 1; } }
.mc-dot { width: 6px; height: 6px; border-radius: 50%; background: #555; opacity: 0; animation: mcDotFade 1.2s infinite ease-in-out; }
.mc-dot:nth-child(2) { animation-delay: 0.2s; }
.mc-dot:nth-child(3) { animation-delay: 0.4s; }
`;

export function LoadingDots() {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }} aria-label="Loading">
      <style suppressHydrationWarning>{KEYFRAMES}</style>
      <span className="mc-dot" /><span className="mc-dot" /><span className="mc-dot" />
    </div>
  );
}
