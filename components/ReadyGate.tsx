"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LoadingDots } from "./LoadingDots";

// Website counterpart to native/components/ReadyGate.tsx — the same rule for every full-page
// load: the three dots stay up until the page underneath is 100% ready (data in, rendered, every
// listed image downloaded AND decoded), then the whole page appears at once. Never a white gap
// after the dots, never the top of a page before the bottom, never text before its image.
//
// The dots are an opaque white layer OVER the real page, not a replacement for it: once `ready`
// is true the page renders underneath and is painted by the browser while the listed images are
// decoded; the layer comes off two animation frames after both, so the reveal frame shows a
// finished page. MAX_WAIT_MS keeps a dead image URL from holding the dots forever. The nav
// (z-index 9999) stays above it, same as the app's nav bar.
//
// Usage: wrap a page's every return in a ReadyGate (React keeps one instance across returns
// because the root type stays the same); pass no children while there's nothing to render yet.
const MAX_WAIT_MS = 6000;

function decodeImage(src: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => resolve()); };
    img.onerror = () => resolve();
    img.src = src;
  });
}

export function ReadyGate({ ready, images, children }: {
  ready: boolean;
  images?: (string | null | undefined)[];
  children?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  revealedRef.current = revealed;
  const imageKey = (images ?? []).filter(Boolean).join("|");

  // Fast path: a page that's ready on its very first render, with every listed image already in
  // the browser's cache (e.g. navigating back to a page), is revealed BEFORE the first paint — a
  // layout effect runs after the DOM is built but before the browser draws it. Without this,
  // every such visit flashed the dots for a couple of frames for nothing.
  useLayoutEffect(() => {
    if (!ready || revealedRef.current) return;
    const urls = (images ?? []).filter((u): u is string => !!u);
    const allCached = urls.every(u => { const img = new Image(); img.src = u; return img.complete && img.naturalWidth > 0; });
    if (allCached) setRevealed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) { setRevealed(false); return; }
    if (revealedRef.current) return;
    let cancelled = false;
    const urls = (images ?? []).filter((u): u is string => !!u);
    Promise.race([
      Promise.all(urls.map(decodeImage)),
      new Promise(res => setTimeout(res, MAX_WAIT_MS)),
    ]).then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) setRevealed(true); }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, imageKey]);

  return (
    <>
      {children}
      {!revealed && (
        <div className="center-lift" style={{ position: "fixed", inset: 0, zIndex: 9000, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingDots />
        </div>
      )}
    </>
  );
}
