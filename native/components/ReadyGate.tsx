import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ScreenCenter } from "./ScreenCenter";
import { LoadingDots } from "./LoadingDots";

// The one rule every full-screen load in this app follows: the three dots stay up until the
// page underneath is 100% ready — data in, laid out, and every listed image already decoded —
// and then the WHOLE page appears at once. Never a white gap after the dots, never the top of a
// page showing before the bottom, never text before its image.
//
// How: the dots are an OPAQUE layer drawn on top of the real content, not a replacement for it.
// As soon as `ready` is true the real content renders underneath (fully opaque, so the native
// side genuinely lays it out and paints it), its images are prefetched into memory, and only
// once its layout has landed AND those images are in does the dots layer come off — on a frame
// after both, so what's revealed is already on screen. MAX_WAIT_MS is a safety valve: a dead
// image URL can't hold the dots up forever.
//
// Usage — wrap EVERY return of a screen in a ReadyGate (React keeps the same instance across
// returns because the root element type stays the same), passing no children while there's no
// data to render yet:
//   if (loading) return <ReadyGate ready={false} />;
//   return <ReadyGate ready images={[item.image]}>…page…</ReadyGate>;
// A screen whose content is always mounted (Calendar) passes children with ready={false}; the
// content just stays hidden under the dots until ready.
const MAX_WAIT_MS = 6000;

export function ReadyGate({ ready, images, children }: {
  ready: boolean;
  images?: (string | null | undefined)[];
  children?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const laidOutRef = useRef(false);
  const imagesReadyRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const hasChildren = children != null && children !== false;
  if (!hasChildren) laidOutRef.current = false;

  function tryReveal() {
    if (!readyRef.current || !laidOutRef.current || !imagesReadyRef.current) return;
    // Two frames: the first lets the native side commit the content's paint, the second
    // removes the dots — so the reveal frame never shows a half-drawn page.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (readyRef.current && laidOutRef.current && imagesReadyRef.current) setRevealed(true);
    }));
  }

  const imageKey = (images ?? []).filter(Boolean).join("|");
  useEffect(() => {
    if (!ready) { setRevealed(false); imagesReadyRef.current = false; return; }
    if (revealed) return;
    let cancelled = false;
    imagesReadyRef.current = false;
    const urls = (images ?? []).filter((u): u is string => !!u);
    const prefetch = urls.length ? Image.prefetch(urls, "memory-disk").catch(() => false) : Promise.resolve(true);
    const timeout = new Promise(res => setTimeout(res, MAX_WAIT_MS));
    Promise.race([prefetch, timeout]).then(() => {
      if (cancelled) return;
      imagesReadyRef.current = true;
      tryReveal();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, imageKey]);

  return (
    <View style={styles.fill}>
      {hasChildren && (
        <View
          style={styles.fill}
          collapsable={false}
          pointerEvents={revealed ? "auto" : "none"}
          onLayout={() => { laidOutRef.current = true; tryReveal(); }}
        >
          {children}
        </View>
      )}
      {!revealed && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <ScreenCenter>
            <LoadingDots />
          </ScreenCenter>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
