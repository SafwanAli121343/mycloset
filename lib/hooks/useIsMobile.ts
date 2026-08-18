"use client";
import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 700;

// Below this width, dense desktop layouts (calendar grids full of thumbnails, drag-and-drop
// slot boards) get restructured into mobile-appropriate alternatives rather than just scaled
// down — see app/calendar/page.tsx and app/builder/page.tsx. Starts `false` (matching desktop
// SSR output) and corrects on mount via matchMedia, same hydration-safe pattern used
// elsewhere in this app for client-only state (geolocation, localStorage caches).
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
