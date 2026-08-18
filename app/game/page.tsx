"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const FONT = { fontFamily: "Arial, sans-serif" };
const TIMER_SECONDS = 60;

type Piece = {
  id: string;
  title: string | null;
  image: string | null;
  score: number;
  sub_type: string | null;
  brand: string | null;
};

type GameState = "loading" | "idle" | "playing" | "done" | "error";

// Derive slot label from sub_type for slot enforcement
function getSlotLabel(sub_type: string | null): string | null {
  if (!sub_type) return null;
  const l = sub_type.toLowerCase();
  if (l.includes("dress") || l.includes("jumpsuit") || l.includes("romper") || l.includes("overall")) return "onepiece";
  if (l.includes("vest") && !l.includes("sweater vest")) return "vest";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("cardigan") || l.includes("sweater") || l.includes("pullover")) return "mid";
  if (l.includes("jacket") || l.includes("blazer") || l.includes("coat") || l.includes("parka") || l.includes("trench") || l.includes("puffer")) return "outer";
  if (l.includes("shirt") || l.includes("tee") || l.includes("top") || l.includes("blouse") || l.includes("polo") || l.includes("tank") || l.includes("bodysuit")) return "base";
  if (l.includes("jeans") || l.includes("trouser") || l.includes("pant") || l.includes("short") || l.includes("skirt") || l.includes("legging")) return "bottom";
  if (l.includes("sneaker") || l.includes("shoe") || l.includes("boot") || l.includes("loafer") || l.includes("sandal") || l.includes("heel")) return "foot";
  if (l.includes("bag") || l.includes("hat") || l.includes("watch") || l.includes("belt") || l.includes("scarf") || l.includes("necklace")) return "acc";
  return null;
}

export default function GamePage() {
  const router = useRouter();
  const [gameState, setGameState] = useState<GameState>("loading");
  const [allPieces, setAllPieces] = useState<Piece[]>([]);
  const [selected, setSelected] = useState<Piece[]>([]);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [scoreFactor, setScoreFactor] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/scoring")
      .then(r => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then(data => {
        setAllPieces(data.pieces ?? []);
        setGameState("idle");
      })
      .catch(() => setGameState("error"));
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const submitOutfit = useCallback(async (items: Piece[]) => {
    stopTimer();
    if (items.length === 0) {
      setFinalScore(null);
      setScoreFactor("No items selected — outfit didn't count.");
      setGameState("done");
      return;
    }
    try {
      const res = await fetch("/api/scoring/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmentIds: items.map(i => i.id) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFinalScore(null);
        setScoreFactor("Could not calculate score — try again.");
        setGameState("done");
        return;
      }

      if (!data.valid) {
        // Invalid outfit — did not count
        setFinalScore(null);
        const reason: string = data.reason ?? "missing required layers";
        setScoreFactor(`Outfit invalid — ${reason}. Needs a top, bottom, and footwear.`);
        setGameState("done");
        return;
      }

      const score: number = data.score ?? 0;
      setFinalScore(score);
      if (score >= 80) {
        setScoreFactor("Excellent — strong pieces, cohesive aesthetic, great color harmony.");
      } else if (score >= 65) {
        setScoreFactor("Solid — good piece quality with minor clashes or formality gaps.");
      } else if (score >= 50) {
        setScoreFactor("Decent — some color or aesthetic tension pulling the score down.");
      } else {
        setScoreFactor("Low score — color clashes, mismatched formality, or weak piece quality.");
      }
    } catch {
      setFinalScore(null);
      setScoreFactor("Could not calculate score.");
    }
    setGameState("done");
  }, [stopTimer]);

  function startGame() {
    setSelected([]);
    setTimeLeft(TIMER_SECONDS);
    setFinalScore(null);
    setScoreFactor("");
    setGameState("playing");

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Time's up — submit current selection (captured via ref below)
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  // When timer hits 0, auto-submit
  useEffect(() => {
    if (gameState === "playing" && timeLeft === 0) {
      submitOutfit(selected);
    }
  }, [timeLeft, gameState, selected, submitOutfit]);

  // Cleanup on unmount
  useEffect(() => () => stopTimer(), [stopTimer]);

  function togglePiece(piece: Piece) {
    setSelected(prev => {
      const alreadyIn = prev.find(p => p.id === piece.id);
      if (alreadyIn) {
        // Remove it
        return prev.filter(p => p.id !== piece.id);
      }
      // Add it — enforce one-per-slot
      const newSlot = getSlotLabel(piece.sub_type);
      if (newSlot && newSlot !== "acc") {
        // Replace existing item in same slot
        const filtered = prev.filter(p => getSlotLabel(p.sub_type) !== newSlot);
        return [...filtered, piece];
      }
      return [...prev, piece];
    });
  }

  const isSelected = (piece: Piece) => selected.some(p => p.id === piece.id);

  if (gameState === "loading") {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center" style={FONT}>
        <p className="text-xs uppercase tracking-widest text-gray-400">LOADING...</p>
      </main>
    );
  }

  if (gameState === "error") {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center" style={FONT}>
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-6">FAILED TO LOAD</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="border border-black px-4 py-2 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors"
          style={FONT}
        >
          BACK
        </button>
      </main>
    );
  }

  if (gameState === "idle") {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center" style={FONT}>
        <div className="max-w-sm w-full px-4 text-center">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-12 inline-block"
            style={{ ...FONT, letterSpacing: "0.08em" }}
          >
            ← BACK
          </button>
          <h1 className="text-2xl font-bold uppercase tracking-[0.06em] mb-4" style={FONT}>
            OUTFIT BUILDER
          </h1>
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-10" style={FONT}>
            BUILD THE HIGHEST-SCORING OUTFIT IN {TIMER_SECONDS} SECONDS
          </p>
          {allPieces.length < 3 ? (
            <div>
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-6" style={FONT}>
                ADD MORE ITEMS TO PLAY
              </p>
              <button
                onClick={() => router.push("/add-item")}
                className="border border-black px-6 py-3 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors"
                style={FONT}
              >
                ADD ITEMS
              </button>
            </div>
          ) : (
            <button
              onClick={startGame}
              className="border border-black px-10 py-4 text-sm uppercase font-bold hover:bg-black hover:text-white transition-colors"
              style={FONT}
            >
              START
            </button>
          )}
        </div>
      </main>
    );
  }

  if (gameState === "done") {
    return (
      <main className="min-h-screen bg-white text-black" style={FONT}>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-10 inline-block"
            style={{ ...FONT, letterSpacing: "0.08em" }}
          >
            ← BACK
          </button>

          <h1 className="text-xl font-bold uppercase tracking-[0.06em] mb-8" style={FONT}>
            RESULT
          </h1>

          {/* Big score or invalid message */}
          <div className="flex flex-col items-center mb-8">
            {finalScore === null ? (
              <>
                <p className="text-xs uppercase tracking-widest text-gray-400 mb-4" style={FONT}>
                  OUTFIT INVALID
                </p>
                <p className="text-sm font-bold uppercase tracking-wide text-center max-w-xs" style={FONT}>
                  DID NOT COUNT
                </p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-widest text-gray-400 mb-2" style={FONT}>
                  YOUR SCORE
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-7xl font-bold leading-none">{finalScore}</span>
                  <span className="text-2xl text-gray-400 font-bold">/ 100</span>
                </div>
              </>
            )}
            <p className="mt-4 text-xs uppercase tracking-widest text-gray-500 text-center max-w-xs" style={FONT}>
              {scoreFactor}
            </p>
          </div>

          <div className="border-t border-black mb-6" />

          {/* Outfit items */}
          {selected.length > 0 && (
            <div className="mb-8">
              <p className="text-xs uppercase tracking-widest font-bold mb-3" style={FONT}>
                YOUR OUTFIT
              </p>
              <div className="flex flex-wrap gap-2">
                {selected.map(piece => (
                  <div key={piece.id} className="border border-black" style={{ width: 72 }}>
                    <div className="bg-gray-50" style={{ width: 72, height: 72 }}>
                      {piece.image ? (
                        <img src={piece.image} alt={piece.title ?? ""} className="w-full h-full object-cover" style={{ display: "block" }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span style={{ fontSize: 8, color: "#ccc" }}>NO IMG</span>
                        </div>
                      )}
                    </div>
                    <p className="text-center truncate px-1 py-0.5" style={{ fontSize: 8, fontFamily: "Arial, sans-serif", textTransform: "uppercase" }}>
                      {piece.sub_type ?? "ITEM"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={startGame}
              className="border border-black px-6 py-3 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors"
              style={FONT}
            >
              PLAY AGAIN
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="border border-black px-6 py-3 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors"
              style={FONT}
            >
              BACK
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Playing state
  return (
    <main className="min-h-screen bg-white text-black" style={FONT}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header row */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-base font-bold uppercase tracking-[0.06em]" style={FONT}>
            OUTFIT BUILDER
          </h1>
          {/* Timer */}
          <div className="flex items-baseline gap-1">
            <span
              className="font-bold tabular-nums"
              style={{ fontSize: 36, color: timeLeft <= 10 ? "#ef4444" : "#000", fontFamily: "Arial, sans-serif" }}
            >
              {timeLeft}
            </span>
            <span className="text-xs uppercase text-gray-400" style={FONT}>SEC</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          {/* Left: Your Closet */}
          <div className="flex-1 border border-black flex flex-col" style={{ minWidth: 0 }}>
            <div className="border-b border-black px-3 py-2">
              <p className="text-xs uppercase font-bold tracking-widest" style={FONT}>
                YOUR CLOSET ({allPieces.length})
              </p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-0">
                {allPieces.map(piece => {
                  const sel = isSelected(piece);
                  return (
                    <button
                      key={piece.id}
                      onClick={() => togglePiece(piece)}
                      className="relative border-b border-r border-black focus:outline-none"
                      style={{
                        aspectRatio: "1/1",
                        background: sel ? "#000" : "#fafafa",
                        fontFamily: "Arial, sans-serif",
                      }}
                    >
                      {piece.image ? (
                        <img
                          src={piece.image}
                          alt={piece.title ?? ""}
                          className="w-full h-full object-cover"
                          style={{ display: "block", opacity: sel ? 0.4 : 1 }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span style={{ fontSize: 7, color: sel ? "#fff" : "#ccc", fontFamily: "Arial, sans-serif", textTransform: "uppercase" }}>
                            {piece.sub_type ?? "?"}
                          </span>
                        </div>
                      )}
                      {sel && (
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: "rgba(0,0,0,0.4)" }}
                        >
                          <span style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>✓</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Your Outfit */}
          <div className="w-full sm:w-56 border border-black flex flex-col flex-shrink-0">
            <div className="border-b border-black px-3 py-2">
              <p className="text-xs uppercase font-bold tracking-widest" style={FONT}>
                YOUR OUTFIT
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {selected.length === 0 ? (
                <div className="flex items-center justify-center h-24">
                  <p className="text-xs uppercase text-gray-300 tracking-widest text-center px-2" style={FONT}>
                    TAP PIECES TO ADD
                  </p>
                </div>
              ) : (
                selected.map(piece => (
                  <button
                    key={piece.id}
                    onClick={() => togglePiece(piece)}
                    className="w-full flex items-center gap-2 px-2 py-2 border-b border-black hover:bg-gray-50 focus:outline-none"
                    style={{ fontFamily: "Arial, sans-serif" }}
                  >
                    <div className="flex-shrink-0 border border-black bg-gray-50" style={{ width: 36, height: 36 }}>
                      {piece.image ? (
                        <img src={piece.image} alt="" className="w-full h-full object-cover" style={{ display: "block" }} />
                      ) : (
                        <div className="w-full h-full bg-gray-100" />
                      )}
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="text-xs uppercase truncate font-bold" style={{ fontFamily: "Arial, sans-serif" }}>
                        {piece.sub_type ?? "ITEM"}
                      </p>
                      <p className="text-xs uppercase truncate text-gray-400" style={{ fontFamily: "Arial, sans-serif", fontSize: 9 }}>
                        {piece.title ?? ""}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Submit */}
            <button
              onClick={() => submitOutfit(selected)}
              disabled={selected.length === 0}
              className="w-full py-3 text-xs uppercase font-bold border-t border-black hover:bg-black hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ fontFamily: "Arial, sans-serif" }}
            >
              SUBMIT
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
