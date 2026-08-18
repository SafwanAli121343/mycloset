"use client";
import { useRef, useState } from "react";

// Mobile counterpart to the desktop scroll-fade+arrow pattern used throughout this app
// (wardrobe-analysis's ScrollCol, closet's SidePanel, preview's SlideCard) — a top fade once
// scrolled past the start, a bottom fade + tap-to-scroll chevron while more content remains.
// Mobile screens need the same affordance (it's how this app signals "there's more below"
// everywhere else), just at mobile-appropriate padding instead of desktop's fixed 160px.
export function MobileScrollFade({ children, padding = "8px 20px 32px" }: {
  children: React.ReactNode;
  padding?: string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBot, setAtBot] = useState(false);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setAtTop(el.scrollTop <= 2);
    setAtBot(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
  }

  return (
    <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}>
      <div
        ref={innerRef}
        onScroll={onScroll}
        style={{
          height: "100%", overflowY: "auto", scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch", overscrollBehavior: "contain",
          textAlign: "center", padding, boxSizing: "border-box",
        }}
      >
        {children}
      </div>

      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 36,
        background: "linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)",
        pointerEvents: "none", opacity: atTop ? 0 : 1, transition: "opacity 0.3s ease",
      }} />

      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, pointerEvents: "none" }}>
        <div style={{
          height: 60, width: "100%",
          background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 55%)",
          opacity: atBot ? 0 : 1, transition: "opacity 0.3s ease",
        }} />
        <div
          onClick={() => {
            const el = innerRef.current;
            if (!el) return;
            atBot ? el.scrollTo({ top: 0, behavior: "smooth" }) : el.scrollBy({ top: 200, behavior: "smooth" });
          }}
          style={{
            background: "#fff", width: "100%", display: "flex", justifyContent: "center",
            paddingTop: 2, paddingBottom: 10, cursor: "pointer", pointerEvents: "auto",
            opacity: (atTop && atBot) ? 0 : 1, transition: "opacity 0.3s ease",
          }}
        >
          {atBot
            ? <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 7L7 1L13 7" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg width="14" height="8" viewBox="0 0 14 8" fill="none"><path d="M1 1L7 7L13 1" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
      </div>
    </div>
  );
}
