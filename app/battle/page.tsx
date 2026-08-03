"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const FONT = { fontFamily: "Arial, sans-serif" };

type OutfitItem = {
  id: string;
  title: string | null;
  image: string | null;
  sub_type: string | null;
  brand?: string | null;
  color_primary?: string | null;
};

type Outfit = {
  score: number;
  items: OutfitItem[];
};

type BattlePair = { a: Outfit; b: Outfit };
type Mode = "select" | "wardrobe" | "bot-select" | "bot";
type BattleState = "loading" | "voting" | "revealed" | "done" | "error";

type BotInfo = {
  id: string;
  name: string;
  bio: string;
  pieceCount: number;
  bestOutfitScore: number;
};

export default function BattlePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("select");

  // ── Wardrobe battle state ────────────────────────────────────────────────
  const [state, setState] = useState<BattleState>("loading");
  const [battles, setBattles] = useState<BattlePair[]>([]);
  const [battleIdx, setBattleIdx] = useState(0);
  const [voted, setVoted] = useState<"a" | "b" | null>(null);

  // ── Bot battle state ─────────────────────────────────────────────────────
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [botBattle, setBotBattle] = useState<{ user: Outfit; bot: Outfit; botName: string } | null>(null);
  const [botState, setBotState] = useState<BattleState>("voting");

  // Load wardrobe outfits on mount (for wardrobe mode)
  useEffect(() => {
    fetch("/api/scoring")
      .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); })
      .then(data => {
        const outfits: Outfit[] = data.topOutfits ?? [];
        if (outfits.length < 2) { setState("done"); return; }
        const pairs: BattlePair[] = [];
        for (let i = 0; i + 1 < outfits.length; i += 2) {
          pairs.push({ a: outfits[i], b: outfits[i + 1] });
        }
        setBattles(pairs);
        setState("voting");
      })
      .catch(() => setState("error"));
  }, []);

  function startBotSelect() {
    setMode("bot-select");
    if (bots.length === 0) {
      setBotsLoading(true);
      fetch("/api/bots")
        .then(r => r.json())
        .then(d => setBots(d.bots ?? []))
        .catch(() => {})
        .finally(() => setBotsLoading(false));
    }
  }

  async function challengeBot(botId: string, botName: string) {
    setMode("bot");
    setBotState("loading");
    setBotBattle(null);

    try {
      const [scoringRes, botRes] = await Promise.all([
        fetch("/api/scoring").then(r => r.json()),
        fetch("/api/bots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botId }),
        }).then(r => r.json()),
      ]);

      const userOutfits: Outfit[] = scoringRes.topOutfits ?? [];
      const userBest = userOutfits[0];
      if (!userBest) { setBotState("error"); return; }

      setBotBattle({ user: userBest, bot: botRes.outfit, botName });
      setBotState("voting");
    } catch {
      setBotState("error");
    }
  }

  function voteWardrobe(side: "a" | "b") { setVoted(side); setState("revealed"); }

  function nextBattle() {
    const next = battleIdx + 1;
    if (next >= battles.length) setState("done");
    else { setBattleIdx(next); setVoted(null); setState("voting"); }
  }

  // ── Mode: select ──────────────────────────────────────────────────────────
  if (mode === "select") {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center" style={FONT}>
        <div className="max-w-sm w-full px-4 text-center">
          <button onClick={() => router.push("/dashboard")} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-12 inline-block" style={{ ...FONT, letterSpacing: "0.08em" }}>← BACK</button>
          <h1 className="text-2xl font-bold uppercase tracking-[0.06em] mb-2" style={FONT}>OUTFIT BATTLE</h1>
          <p className="text-xs uppercase tracking-widest text-gray-400 mb-10" style={FONT}>CHOOSE YOUR OPPONENT</p>
          <div className="border border-black divide-y divide-black">
            <button onClick={() => setMode("wardrobe")} className="w-full py-4 bg-white text-black font-bold uppercase text-sm hover:bg-black hover:text-white transition-colors" style={FONT}>VS MY WARDROBE</button>
            <button onClick={startBotSelect} className="w-full py-4 bg-white text-black font-bold uppercase text-sm hover:bg-black hover:text-white transition-colors" style={FONT}>VS A BOT</button>
          </div>
        </div>
      </main>
    );
  }

  // ── Mode: bot-select ──────────────────────────────────────────────────────
  if (mode === "bot-select") {
    return (
      <main className="min-h-screen bg-white text-black" style={FONT}>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <button onClick={() => setMode("select")} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-8 inline-block" style={{ ...FONT, letterSpacing: "0.08em" }}>← BACK</button>
          <h1 className="text-xl font-bold uppercase tracking-[0.06em] mb-8" style={FONT}>CHOOSE A BOT</h1>
          {botsLoading ? (
            <p className="text-xs uppercase tracking-widest text-gray-400" style={FONT}>LOADING BOTS…</p>
          ) : (
            <div className="border border-black divide-y divide-black">
              {bots.map(bot => (
                <button key={bot.id} onClick={() => challengeBot(bot.id, bot.name)} className="w-full px-4 py-4 bg-white text-left hover:bg-black hover:text-white transition-colors group" style={FONT}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold uppercase" style={FONT}>{bot.name}</p>
                      <p className="text-xs uppercase text-gray-400 group-hover:text-gray-300 mt-0.5" style={FONT}>{bot.bio}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="text-xs uppercase tracking-widest text-gray-400 group-hover:text-gray-300" style={FONT}>BEST SCORE</p>
                      <p className="text-sm font-bold" style={FONT}>{bot.bestOutfitScore} / 100</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  // ── Mode: bot battle ──────────────────────────────────────────────────────
  if (mode === "bot") {
    if (botState === "loading") {
      return <main className="min-h-screen bg-white flex items-center justify-center" style={FONT}><p className="text-xs uppercase tracking-widest text-gray-400">LOADING…</p></main>;
    }
    if (botState === "error" || !botBattle) {
      return (
        <main className="min-h-screen bg-white flex flex-col items-center justify-center" style={FONT}>
          <p className="text-xs uppercase tracking-widest text-gray-400 mb-6">FAILED TO LOAD</p>
          <button onClick={() => setMode("select")} className="border border-black px-4 py-2 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors" style={FONT}>BACK</button>
        </main>
      );
    }

    const { user, bot, botName } = botBattle;
    const userWins = user.score >= bot.score;

    return (
      <main className="min-h-screen bg-white text-black" style={FONT}>
        <div className="max-w-3xl mx-auto px-4 py-8">
          <button onClick={() => setMode("bot-select")} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-8 inline-block" style={{ ...FONT, letterSpacing: "0.08em" }}>← BACK</button>
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-xl font-bold uppercase tracking-[0.06em]" style={FONT}>VS {botName}</h1>
          </div>
          <div className="flex flex-col md:flex-row gap-4 items-stretch">
            <BotOutfitPanel outfit={user} label="YOUR BEST" state={botState} isWinner={botState === "revealed" && userWins} onVote={() => setBotState("revealed")} isBotPanel={false} />
            <div className="flex items-center justify-center py-2 md:py-0">
              <span className="text-xl font-bold text-gray-300 tracking-widest" style={FONT}>VS</span>
            </div>
            <BotOutfitPanel outfit={bot} label={botName} state={botState} isWinner={botState === "revealed" && !userWins} onVote={() => setBotState("revealed")} isBotPanel />
          </div>
          {botState === "revealed" && (
            <div className="flex justify-center mt-8 gap-4">
              <button onClick={() => setMode("bot-select")} className="border border-black px-8 py-3 text-sm uppercase font-bold hover:bg-black hover:text-white transition-colors" style={FONT}>BATTLE AGAIN</button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ── Mode: wardrobe battle ─────────────────────────────────────────────────
  if (state === "loading") return <main className="min-h-screen bg-white flex items-center justify-center" style={FONT}><p className="text-xs uppercase tracking-widest text-gray-400">LOADING…</p></main>;

  if (state === "error") {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center" style={FONT}>
        <p className="text-xs uppercase tracking-widest text-gray-400 mb-6">FAILED TO LOAD</p>
        <button onClick={() => setMode("select")} className="border border-black px-4 py-2 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors" style={FONT}>BACK</button>
      </main>
    );
  }

  if (state === "done") {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center" style={FONT}>
        <div className="max-w-md w-full px-4 text-center">
          <button onClick={() => setMode("select")} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-10 inline-block" style={{ ...FONT, letterSpacing: "0.08em" }}>← BACK</button>
          <h1 className="text-xl font-bold uppercase tracking-[0.06em] mb-6" style={FONT}>BATTLE COMPLETE</h1>
          {battles.length < 1
            ? <p className="text-xs uppercase tracking-widest text-gray-500" style={FONT}>ADD MORE ITEMS TO YOUR CLOSET</p>
            : <p className="text-xs uppercase tracking-widest text-gray-500" style={FONT}>ALL {battles.length} BATTLES DONE</p>}
          <button onClick={() => { setBattleIdx(0); setVoted(null); setState(battles.length >= 2 ? "voting" : "done"); }} className="mt-8 border border-black px-6 py-3 text-xs uppercase font-bold hover:bg-black hover:text-white transition-colors" style={FONT}>PLAY AGAIN</button>
        </div>
      </main>
    );
  }

  const currentBattle = battles[battleIdx];
  if (!currentBattle) return null;
  const { a, b } = currentBattle;
  const scoreWinnerA = a.score >= b.score;

  return (
    <main className="min-h-screen bg-white text-black" style={FONT}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button onClick={() => setMode("select")} className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity mb-8 inline-block" style={{ ...FONT, letterSpacing: "0.08em" }}>← BACK</button>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-bold uppercase tracking-[0.06em]" style={FONT}>OUTFIT BATTLE</h1>
          <span className="text-xs uppercase tracking-widest text-gray-400" style={FONT}>{battleIdx + 1} / {battles.length}</span>
        </div>
        <div className="flex flex-col md:flex-row gap-4 items-stretch">
          <OutfitPanel outfit={a} side="A" state={state} isWinner={state === "revealed" && scoreWinnerA} onVote={() => voteWardrobe("a")} />
          <div className="flex items-center justify-center py-2 md:py-0">
            <span className="text-xl font-bold text-gray-300 tracking-widest" style={FONT}>VS</span>
          </div>
          <OutfitPanel outfit={b} side="B" state={state} isWinner={state === "revealed" && !scoreWinnerA} onVote={() => voteWardrobe("b")} />
        </div>
        {state === "revealed" && (
          <div className="flex justify-center mt-8">
            <button onClick={nextBattle} className="border border-black px-8 py-3 text-sm uppercase font-bold hover:bg-black hover:text-white transition-colors" style={FONT}>
              {battleIdx + 1 < battles.length ? "NEXT BATTLE" : "FINISH"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function OutfitPanel({ outfit, side, state, isWinner, onVote }: {
  outfit: Outfit; side: "A" | "B"; state: string; isWinner: boolean; onVote: () => void;
}) {
  return (
    <div className="flex-1 border border-black flex flex-col" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="border-b border-black px-3 py-2 flex items-center justify-between">
        <span className="text-xs uppercase font-bold tracking-widest">OUTFIT {side}</span>
        {state === "revealed" && isWinner && <span className="bg-black text-white text-xs font-bold px-2 py-0.5 tracking-widest">WIN</span>}
      </div>
      <div className="flex border-b border-black">
        {outfit.items.map(item => (
          <div key={item.id} className="flex-1 bg-gray-50" style={{ aspectRatio: "1/1", minWidth: 0 }}>
            {item.image
              ? <img src={item.image} alt={item.title ?? ""} className="w-full h-full object-cover" style={{ display: "block" }} />
              : <div className="w-full h-full flex items-center justify-center"><span className="text-gray-200" style={{ fontSize: 8 }}>NO IMG</span></div>}
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-b border-black flex-1">
        {outfit.items.map(item => (
          <p key={item.id} className="text-xs uppercase truncate text-gray-600" style={{ fontFamily: "Arial, sans-serif" }}>{item.title ?? item.sub_type ?? "ITEM"}</p>
        ))}
      </div>
      {state === "revealed"
        ? <div className="px-3 py-3 text-center"><span className="text-sm font-bold">{outfit.score} / 100</span></div>
        : <button onClick={onVote} className="w-full py-3 text-xs font-bold uppercase tracking-widest bg-white text-black border-t border-black hover:bg-black hover:text-white transition-colors" style={{ fontFamily: "Arial, sans-serif" }}>VOTE</button>}
    </div>
  );
}

// Bot panel — color swatches instead of images
function BotOutfitPanel({ outfit, label, state, isWinner, onVote, isBotPanel }: {
  outfit: Outfit; label: string; state: string; isWinner: boolean; onVote: () => void; isBotPanel: boolean;
}) {
  return (
    <div className="flex-1 border border-black flex flex-col" style={{ fontFamily: "Arial, sans-serif" }}>
      <div className="border-b border-black px-3 py-2 flex items-center justify-between">
        <span className="text-xs uppercase font-bold tracking-widest">{label}</span>
        {state === "revealed" && isWinner && <span className="bg-black text-white text-xs font-bold px-2 py-0.5 tracking-widest">WIN</span>}
      </div>
      <div className="flex border-b border-black">
        {outfit.items.map(item => (
          <div key={item.id} className="flex-1" style={{
            aspectRatio: "1/1", minWidth: 0,
            background: isBotPanel ? colorToHex(item.color_primary) : "#f9f9f9",
          }}>
            {!isBotPanel && (item.image
              ? <img src={item.image} alt={item.title ?? ""} className="w-full h-full object-cover" style={{ display: "block" }} />
              : <div className="w-full h-full flex items-center justify-center"><span className="text-gray-200" style={{ fontSize: 8 }}>NO IMG</span></div>)}
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-b border-black flex-1">
        {outfit.items.map(item => (
          <p key={item.id} className="text-xs uppercase truncate text-gray-600" style={{ fontFamily: "Arial, sans-serif" }}>
            {isBotPanel ? `${item.brand ?? ""} ${item.sub_type ?? "ITEM"}`.trim() : (item.title ?? item.sub_type ?? "ITEM")}
          </p>
        ))}
      </div>
      {state === "revealed"
        ? <div className="px-3 py-3 text-center"><span className="text-sm font-bold">{outfit.score} / 100</span></div>
        : <button onClick={onVote} className="w-full py-3 text-xs font-bold uppercase tracking-widest bg-white text-black border-t border-black hover:bg-black hover:text-white transition-colors" style={{ fontFamily: "Arial, sans-serif" }}>VOTE</button>}
    </div>
  );
}

const COLOR_HEX: Record<string, string> = {
  black:"#111",white:"#f5f5f5",grey:"#888",gray:"#888",charcoal:"#3a3a3a",
  navy:"#1a2a4a",blue:"#3b6eb5",red:"#c0392b",burgundy:"#722f37",
  green:"#2d6a4f",olive:"#6b7a3a",camel:"#c19a6b",tan:"#d2b48c",
  brown:"#795548",beige:"#d4c5a9",cream:"#f5f0e8",orange:"#e67e22",
  yellow:"#f1c40f",pink:"#f48fb1","hot pink":"#ff69b4",purple:"#7d3c98",
  silver:"#c0c0c0",gold:"#d4af37",indigo:"#3c3c8c",rust:"#b7410e",
  khaki:"#c3b091","light blue":"#87ceeb",
};

function colorToHex(color: string | null | undefined): string {
  if (!color) return "#e0e0e0";
  return COLOR_HEX[color.toLowerCase()] ?? "#e0e0e0";
}
