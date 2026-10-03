import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Image, StyleSheet } from "react-native";

// Same 20 garment cutouts the website scatters on its dashboard (public/scatter/piece21-40.png),
// copied in locally since this is a separate app bundle. Metro needs static require() calls,
// so the list is spelled out rather than built from a path string.
const SOURCES = [
  require("../assets/scatter/piece21.png"), require("../assets/scatter/piece22.png"),
  require("../assets/scatter/piece23.png"), require("../assets/scatter/piece24.png"),
  require("../assets/scatter/piece25.png"), require("../assets/scatter/piece26.png"),
  require("../assets/scatter/piece27.png"), require("../assets/scatter/piece28.png"),
  require("../assets/scatter/piece29.png"), require("../assets/scatter/piece30.png"),
  require("../assets/scatter/piece31.png"), require("../assets/scatter/piece32.png"),
  require("../assets/scatter/piece33.png"), require("../assets/scatter/piece34.png"),
  require("../assets/scatter/piece35.png"), require("../assets/scatter/piece36.png"),
  require("../assets/scatter/piece37.png"), require("../assets/scatter/piece38.png"),
  require("../assets/scatter/piece39.png"), require("../assets/scatter/piece40.png"),
];

function rand(a: number, b: number) { return Math.random() * (b - a) + a; }
function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

type Rect = { x: number; y: number; width: number; height: number };
type Ball = { x: number; y: number; vx: number; vy: number; w: number; h: number };

// Sweeps forward along the ball's current straight-line trajectory and finds the soonest
// collision — either a screen edge or (if given) one of the avoid-rect's 4 faces — returning
// how long until that collision and which axis to reflect. Used to drive one native Animated.timing
// leg at a time instead of recomputing position every frame on the JS thread (see startLeg below).
function nextCollision(b: Ball, width: number, height: number, rect: Rect | null) {
  let tX = Infinity, tY = Infinity;
  if (b.vx > 0) tX = (width - b.w - b.x) / b.vx;
  else if (b.vx < 0) tX = (0 - b.x) / b.vx;
  if (b.vy > 0) tY = (height - b.h - b.y) / b.vy;
  else if (b.vy < 0) tY = (0 - b.y) / b.vy;

  let t = Math.min(tX, tY);
  let reflectX = tX <= tY;
  let reflectY = tY <= tX;

  if (rect) {
    const pad = 10;
    const ml = rect.x - pad, mr = rect.x + rect.width + pad, mt = rect.y - pad, mb = rect.y + rect.height + pad;
    const candidates: { t: number; axis: "x" | "y" }[] = [];
    if (b.vx > 0) {
      const ct = (ml - b.w - b.x) / b.vx;
      if (ct > 0.001) { const y = b.y + b.vy * ct; if (y + b.h > mt && y < mb) candidates.push({ t: ct, axis: "x" }); }
    } else if (b.vx < 0) {
      const ct = (mr - b.x) / b.vx;
      if (ct > 0.001) { const y = b.y + b.vy * ct; if (y + b.h > mt && y < mb) candidates.push({ t: ct, axis: "x" }); }
    }
    if (b.vy > 0) {
      const ct = (mt - b.h - b.y) / b.vy;
      if (ct > 0.001) { const x = b.x + b.vx * ct; if (x + b.w > ml && x < mr) candidates.push({ t: ct, axis: "y" }); }
    } else if (b.vy < 0) {
      const ct = (mb - b.y) / b.vy;
      if (ct > 0.001) { const x = b.x + b.vx * ct; if (x + b.w > ml && x < mr) candidates.push({ t: ct, axis: "y" }); }
    }
    for (const c of candidates) {
      if (c.t < t) { t = c.t; reflectX = c.axis === "x"; reflectY = c.axis === "y"; }
    }
  }

  if (!Number.isFinite(t) || t < 0) t = 0.5;
  return { t, endX: b.x + b.vx * t, endY: b.y + b.vy * t, reflectX, reflectY };
}

// Screensaver-style physics, mirroring the website's dashboard exactly (app/dashboard/page.tsx
// tick()): constant speed, straight-line motion, reflect off whichever edge/rect face is hit
// nearest. Unlike a naive port of that per-frame tick() loop, each straight-line leg here runs
// as a single native-driven Animated.timing — the JS thread only wakes up briefly at each
// bounce to compute the next leg, instead of calling setValue() on the JS thread every single
// frame. That per-frame JS-thread churn (especially multiplied across several pieces, running
// on every screen that uses this component) was the main source of the app-wide jank/dropped-
// scroll-gesture reports — moving the animation itself onto the native thread fixes that at
// the source, not just for the screens where it was most visible.
export function BouncingPieces({
  width, height, count = 4, avoidRect, speed = 55, pieceHeightRange = [42, 62], remoteUris, active = true,
}: {
  width: number; height: number; count?: number; avoidRect?: Rect | null;
  speed?: number; pieceHeightRange?: [number, number];
  // Real garment photos (e.g. the user's own closet, for Wardrobe) instead of the generic
  // decorative scatter pieces used on Dashboard. Remote images don't have a synchronously-known
  // size the way a require()'d local asset does (Image.resolveAssetSource only works for
  // those), so each piece falls back to a fixed aspect ratio close to a typical garment photo's
  // rather than a measured one — close enough for a bouncing decoration, and resizeMode
  // "contain" absorbs the rest.
  remoteUris?: string[];
  // Whether the physics loop should actually be running — pass the screen's own focus state.
  // Tabs stay mounted for the whole session once visited (that's the point of the app's
  // lazy-tab setup), so without this the recursive startLeg()→.start(callback)→startLeg() chain
  // below never stops just because the user switched away: every leg completion still runs its
  // JS-thread callback indefinitely, for every piece, for the rest of the session, compounding
  // with every other screen doing the same. That background churn was very likely a real
  // contributor to "every switch feels slower than the last" — not just this screen's own first
  // load — since the JS thread stays busier the longer the session runs and the more of these
  // loops have quietly piled up. Defaults to true so any other, non-tab caller keeps working
  // unchanged.
  active?: boolean;
}) {
  const pieces = useMemo(() => {
    if (remoteUris && remoteUris.length > 0) {
      // Unlike the decorative-scatter case below, real garment photos are never capped down to
      // `count` — the website's dashboard (app/wardrobe-analysis/page.tsx) bounces every piece
      // the wardrobe has, uncapped, so this matches that instead of arbitrarily hiding items.
      return shuffle(remoteUris).map(uri => {
        const h = rand(pieceHeightRange[0], pieceHeightRange[1]);
        return { src: { uri }, w: h * 0.78, h };
      });
    }
    return shuffle(SOURCES).slice(0, count).map(src => {
      const size = Image.resolveAssetSource(src);
      const h = rand(pieceHeightRange[0], pieceHeightRange[1]);
      const w = size?.width && size?.height ? h * (size.width / size.height) : h;
      return { src, w, h };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, remoteUris]);

  const positions = useRef(pieces.map(() => new Animated.ValueXY({ x: 0, y: 0 }))).current;
  const balls = useRef<Ball[]>([]);
  const anims = useRef<(Animated.CompositeAnimation | null)[]>([]);
  const avoidRef = useRef(avoidRect);
  avoidRef.current = avoidRect;

  useEffect(() => {
    if (width <= 0 || height <= 0 || !active) return;
    let cancelled = false;

    // Resume from existing positions when toggling active (tab focus/blur) — avoids the
    // visual "reset to corners" jump that looks like a refresh. Only start from corners on
    // the first load or when the piece set changes (pieces dep changes).
    const isResume = balls.current.length === pieces.length;
    if (!isResume) {
      const corners = [
        { x: 4, y: 4 }, { x: width - pieces[1]?.w - 4, y: 4 },
        { x: 4, y: height - (pieces[2]?.h ?? 0) - 4 }, { x: width - (pieces[3]?.w ?? 0) - 4, y: height - (pieces[3]?.h ?? 0) - 4 },
      ];
      const signs = [{ sx: 1, sy: 1 }, { sx: -1, sy: 1 }, { sx: 1, sy: -1 }, { sx: -1, sy: -1 }];
      balls.current = pieces.map((p, i) => {
        const corner = corners[i % 4];
        const sign = signs[i % 4];
        return {
          x: Math.max(0, corner.x + rand(-10, 10)),
          y: Math.max(0, corner.y + rand(-10, 10)),
          vx: speed * sign.sx * rand(0.7, 1.3),
          vy: speed * sign.sy * rand(0.7, 1.3),
          w: p.w, h: p.h,
        };
      });
      balls.current.forEach((b, i) => positions[i].setValue({ x: b.x, y: b.y }));
    }

    function startLeg(i: number) {
      if (cancelled) return;
      const b = balls.current[i];
      const leg = nextCollision(b, width, height, avoidRef.current ?? null);
      const durationMs = Math.min(6000, Math.max(80, leg.t * 1000));
      const anim = Animated.timing(positions[i], {
        toValue: { x: leg.endX, y: leg.endY },
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      anims.current[i] = anim;
      anim.start(({ finished }) => {
        if (!finished || cancelled) return;
        b.x = leg.endX; b.y = leg.endY;
        if (leg.reflectX) b.vx = -b.vx;
        if (leg.reflectY) b.vy = -b.vy;
        startLeg(i);
      });
    }

    balls.current.forEach((_, i) => startLeg(i));

    return () => {
      cancelled = true;
      anims.current.forEach(a => a?.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, pieces, speed, active]);

  if (width <= 0 || height <= 0) return null;

  return (
    <>
      {pieces.map((p, i) => (
        <Animated.Image
          key={i}
          source={p.src}
          resizeMode="contain"
          style={[
            styles.piece,
            { width: p.w, height: p.h, transform: positions[i].getTranslateTransform() },
          ]}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute", left: 0, top: 0 },
});
