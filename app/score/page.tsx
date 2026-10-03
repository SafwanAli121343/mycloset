"use client";
import { ProGate } from "@/components/ProGate";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const FONT = { fontFamily: "Arial, sans-serif" };

type Piece = {
  id: string;
  title: string | null;
  image: string | null;
  score: number;
  sub_type: string | null;
  brand: string | null;
};

type ScoringData = {
  wardrobeScore: number | null;
  pieceCount: number;
  pieces: Piece[];
};

function ScorePageInner() {
  const router = useRouter();
  const [data, setData] = useState<ScoringData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/scoring")
      .then(r => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center center-lift" style={FONT}>
        <p className="text-xs uppercase tracking-widest text-gray-400">FAILED TO LOAD</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-6 border border-black px-4 py-2 text-xs uppercase tracking-widest hover:bg-black hover:text-white transition-colors"
          style={FONT}
        >
          BACK
        </button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center center-lift" style={FONT}>
        <p className="text-xs uppercase tracking-widest text-gray-400">ANALYZING...</p>
      </main>
    );
  }

  const sorted = [...data.pieces].sort((a, b) => b.score - a.score);
  const top5 = sorted.slice(0, 5);
  const bottom3 = sorted.slice(-3).reverse();

  return (
    <main className="min-h-screen bg-white text-black" style={FONT}>
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back */}
        <button
          onClick={() => router.push("/dashboard")}
          className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-10 inline-block"
          style={{ ...FONT, letterSpacing: "0.08em" }}
        >
          ← BACK
        </button>

        {/* Score hero */}
        <div className="flex flex-col items-center mb-8">
          <p className="text-xs uppercase tracking-[0.1em] text-gray-500 mb-2" style={FONT}>
            WARDROBE SCORE
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-8xl font-bold text-black leading-none">{data.wardrobeScore ?? "—"}</span>
            <span className="text-2xl text-gray-400 font-bold">/ 100</span>
          </div>
          <p className="mt-3 text-xs uppercase tracking-widest text-gray-400" style={FONT}>
            {data.pieceCount} PIECES ANALYZED
          </p>
        </div>

        <div className="border-t border-black mb-8" />

        {/* Top pieces */}
        <section className="mb-10">
          <p className="text-xs uppercase tracking-[0.1em] font-bold mb-4" style={FONT}>
            TOP PIECES
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {top5.map(piece => (
              <PieceCard key={piece.id} piece={piece} />
            ))}
          </div>
        </section>

        {/* Needs work */}
        <section>
          <p className="text-xs uppercase tracking-[0.1em] font-bold mb-4" style={FONT}>
            NEEDS WORK
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {bottom3.map(piece => (
              <PieceCard key={piece.id} piece={piece} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function PieceCard({ piece }: { piece: Piece }) {
  return (
    <div className="border border-black flex flex-col" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="relative bg-gray-50" style={{ aspectRatio: "1/1" }}>
        {piece.image ? (
          <img
            src={piece.image}
            alt={piece.title ?? ""}
            className="w-full h-full object-cover"
            style={{ display: "block" }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs text-gray-300 uppercase tracking-widest">NO IMG</span>
          </div>
        )}
        {/* Score badge */}
        <span
          className="absolute bottom-1 right-1 bg-black text-white text-xs font-bold px-2 py-0.5"
          style={{ fontFamily: "Arial, sans-serif" }}
        >
          {piece.score}
        </span>
      </div>
      <div className="p-2">
        <p className="text-xs font-bold uppercase truncate" style={{ fontFamily: "Arial, sans-serif" }}>
          {piece.title ?? "UNTITLED"}
        </p>
        {piece.brand && (
          <p className="text-xs text-gray-400 uppercase truncate" style={{ fontFamily: "Arial, sans-serif" }}>
            {piece.brand}
          </p>
        )}
      </div>
    </div>
  );
}

// Scores/AI are Pro-only — see components/ProGate.tsx.
export default function ScorePage() {
  return <ProGate feature="Wardrobe scoring"><ScorePageInner /></ProGate>;
}
