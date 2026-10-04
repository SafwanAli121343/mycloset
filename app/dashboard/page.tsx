"use client";
import { useHiddenPages } from "@/lib/client/paidFeatures";
import { ReadyGate } from "@/components/ReadyGate";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const FONT = { fontFamily: "Arial, sans-serif" };

const NAV = [
  { label: "MY CLOSET", href: "/closet" },
  { label: "ADD ITEM", href: "/add-item" },
  { label: "CALENDAR", href: "/calendar" },
  { label: "OUTFITS", href: "/outfits" },
  { label: "BUILDER", href: "/builder" },
  { label: "PREVIEW", href: "/preview" },
  { label: "WARDROBE", href: "/wardrobe-analysis" },
  { label: "UPGRADE", href: "/upgrade" },
  { label: "SETTINGS", href: "/settings" },
];

const SCATTER_SRCS = Array.from({ length: 42 }, (_, i) => `/scatter/piece${i + 21}.png`);
const SPEED  = 84; // px per second — consistent regardless of frame rate
const COUNT  = 4;

function rand(a: number, b: number) { return Math.random() * (b - a) + a; }

type Piece = { src: string; h: number };

const NO_PIECES: Piece[] = [];
let picked: Piece[] | null = null;
function clientPieces(): Piece[] {
  picked ??= [...SCATTER_SRCS]
    .sort(() => Math.random() - 0.5)
    .slice(0, COUNT)
    .map(src => ({ src, h: Math.round(rand(120, 175)) }));
  return picked;
}
const noopSubscribe = () => () => {};
type Ball  = { x: number; y: number; vx: number; vy: number };

export default function DashboardPage() {
  const router    = useRouter();
  const { signOut } = useAuth();
  const hiddenPages = useHiddenPages();
  const menuRef   = useRef<HTMLDivElement>(null);
  const imgRefs   = useRef<(HTMLImageElement | null)[]>([]);
  const balls     = useRef<Ball[]>([]);
  const rafId     = useRef(0);


  // Pieces are picked at random in the browser only (the server renders none), so the page the
  // server sends and the browser's first render agree — picking on both sides gave each a
  // different random set (a hydration mismatch). Picked once per visit, then stable.
  const pieces = useSyncExternalStore(noopSubscribe, clientPieces, () => NO_PIECES);

  // useLayoutEffect (not useEffect) so the starting corner positions are applied
  // BEFORE the browser paints, and the animation loop starts on the very next
  // frame with no artificial delay - otherwise every piece renders stacked at
  // its default left:0/top:0 (from the JSX below) and sits there visibly static
  // until the first tick() call finally moves it, instead of already being in
  // motion the instant the page appears.
  useLayoutEffect(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Place each piece near a corner, moving diagonally inward
    const corners = [
      { x: 40,       y: 40 },
      { x: W - 200,  y: 40 },
      { x: 40,       y: H - 200 },
      { x: W - 200,  y: H - 200 },
    ];
    const signs = [
      { sx:  1, sy:  1 },
      { sx: -1, sy:  1 },
      { sx:  1, sy: -1 },
      { sx: -1, sy: -1 },
    ];

    balls.current = pieces.map((_, i) => ({
      x:  corners[i].x,
      y:  corners[i].y,
      vx: SPEED * signs[i].sx,
      vy: SPEED * signs[i].sy,
    }));

    // Apply the starting positions synchronously, right now, before paint -
    // this is what actually eliminates the "stacked in the corner" flash.
    balls.current.forEach((b, i) => {
      const el = imgRefs.current[i];
      if (el) { el.style.left = `${b.x}px`; el.style.top = `${b.y}px`; }
    });

    let lastTime = 0;

    function tick(now: number) {
      // Delta time in seconds; cap at 3 frames worth to avoid large jumps after tab switch
      const dt = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, 3 / 60);
      lastTime = now;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const menu = menuRef.current?.getBoundingClientRect() ?? null;

      balls.current.forEach((b, i) => {
        const el = imgRefs.current[i];
        if (!el) return;
        const pw = el.offsetWidth  || 100;
        const ph = el.offsetHeight || pieces[i].h;

        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Screen edges
        if (b.x <= 0)        { b.x = 0;      b.vx =  Math.abs(b.vx); }
        if (b.x + pw >= W)   { b.x = W - pw; b.vx = -Math.abs(b.vx); }
        if (b.y <= 0)        { b.y = 0;      b.vy =  Math.abs(b.vy); }
        if (b.y + ph >= H)   { b.y = H - ph; b.vy = -Math.abs(b.vy); }

        // Menu block — reflect off whichever face was penetrated least
        if (menu) {
          const pad = 20;
          const ml = menu.left  - pad;
          const mr = menu.right + pad;
          const mt = menu.top   - pad;
          const mb = menu.bottom + pad;

          if (b.x + pw > ml && b.x < mr && b.y + ph > mt && b.y < mb) {
            const dLeft   = b.x + pw - ml;
            const dRight  = mr - b.x;
            const dTop    = b.y + ph - mt;
            const dBottom = mb - b.y;
            const min = Math.min(dLeft, dRight, dTop, dBottom);

            if (min === dLeft)        { b.x = ml - pw; b.vx = -Math.abs(b.vx); }
            else if (min === dRight)  { b.x = mr;      b.vx =  Math.abs(b.vx); }
            else if (min === dTop)    { b.y = mt - ph; b.vy = -Math.abs(b.vy); }
            else                      { b.y = mb;      b.vy =  Math.abs(b.vy); }
          }
        }

        // Re-normalize to exact speed after all collision resolution
        b.vx = SPEED * Math.sign(b.vx);
        b.vy = SPEED * Math.sign(b.vy);

        el.style.left = `${b.x}px`;
        el.style.top  = `${b.y}px`;
      });

      rafId.current = requestAnimationFrame(tick);
    }

    // No startup delay - tick() already falls back to sane default dimensions
    // (pw/ph above) for any frame before offsetWidth/offsetHeight are measurable,
    // and self-corrects on the next frame once they are.
    rafId.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafId.current); };
  }, [pieces]);

  // Gated on the floating pieces' images (components/ReadyGate.tsx) so the page appears complete
  // instead of pieces popping in one by one as they download.
  return (
    <ReadyGate ready images={pieces.map(p => p.src)}>
    <main className="relative min-h-screen bg-white flex flex-col items-center justify-center overflow-hidden">
      {pieces.map((p, i) => (
        <img
          key={i}
          ref={el => { imgRefs.current[i] = el; }}
          src={p.src}
          alt=""
          draggable={false}
          className="absolute pointer-events-none select-none"
          style={{ position: "absolute", height: p.h, width: "auto", left: 0, top: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ))}

      <div
        ref={menuRef}
        className="relative z-10 flex flex-col items-center"
        style={{ transform: "translateY(-4vh)" }}
      >
        <p
          className="text-3xl font-bold uppercase tracking-[0.04em] mb-2 text-black"
          style={FONT}
        >
          MYCLOSET
        </p>

        <div className="border border-black divide-y divide-black w-64">
          {NAV.filter(n => !hiddenPages.has(n.href)).map(({ label, href }) => (
            <button
              key={label}
              onClick={() => router.push(href)}
              className="w-full py-4 bg-white text-black font-bold uppercase text-sm transition-colors duration-150 hover:bg-black hover:text-white"
              style={FONT}
            >
              {label}
            </button>
          ))}
          <button
            onClick={signOut}
            className="w-full py-4 bg-white text-black font-bold uppercase text-sm transition-colors duration-150 hover:bg-black hover:text-white"
            style={FONT}
          >
            SIGN OUT
          </button>
        </div>
      </div>
    </main>
    </ReadyGate>
  );
}
