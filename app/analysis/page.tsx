"use client";
import { ProGate } from "@/components/ProGate";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const FONT = { fontFamily: "Arial, sans-serif" };

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: "#aaa",
  display: "block",
  marginBottom: 6,
  fontFamily: "Arial, sans-serif",
};

type Mode = "wardrobe" | "fit" | "compare";

type Garment = {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  color_primary: string | null;
  image: string | null;
};

function AnalysisPageInner() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("wardrobe");
  const [garments, setGarments] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fit-check state
  const [fitImageDataUrl, setFitImageDataUrl] = useState<string>("");
  const [fitUrl, setFitUrl] = useState<string>("");

  // Compare state
  const [cmpA, setCmpA] = useState<string>("");
  const [cmpB, setCmpB] = useState<string>("");
  const [cmpAUrl, setCmpAUrl] = useState<string>("");
  const [cmpBUrl, setCmpBUrl] = useState<string>("");

  useEffect(() => {
    if (!user?.id) return;
    fetch("/api/garments", { credentials: "include" })
      .then(r => r.json())
      .then(data => setGarments(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [user?.id]);

  function reset() { setResult(null); setError(null); }

  async function runWardrobeAnalysis() {
    if (!user?.id) return;
    setLoading(true); reset();
    const res = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Analysis failed"); }
    else { setResult(data.analysis ?? data); }
    setLoading(false);
  }

  async function runFitCheck() {
    if (!user?.id || (!fitImageDataUrl && !fitUrl)) return;
    setLoading(true); reset();
    const res = await fetch("/api/analysis/fit-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        imageDataUrl: fitImageDataUrl || undefined,
        productUrl: fitUrl || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Analysis failed"); }
    else { setResult(data); }
    setLoading(false);
  }

  async function runComparison() {
    if (!user?.id) return;
    const hasA = cmpA || cmpAUrl;
    const hasB = cmpB || cmpBUrl;
    if (!hasA || !hasB) return;
    setLoading(true); reset();
    const res = await fetch("/api/analysis/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        itemAId: cmpA || undefined,
        itemBId: cmpB || undefined,
        itemAUrl: cmpAUrl || undefined,
        itemBUrl: cmpBUrl || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Analysis failed"); }
    else { setResult(data); }
    setLoading(false);
  }

  function tabBtn(m: Mode, label: string) {
    const active = mode === m;
    return (
      <button
        key={m}
        onClick={() => { setMode(m); reset(); }}
        style={{
          background: "none", border: "none",
          borderBottom: active ? "1px solid #111" : "1px solid transparent",
          cursor: "pointer", fontSize: 9, letterSpacing: "0.18em",
          textTransform: "uppercase", color: active ? "#111" : "#bbb",
          paddingBottom: 6, paddingLeft: 0, paddingRight: 0, marginRight: 28,
          fontFamily: "Arial, sans-serif",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <main className="min-h-screen bg-white" style={{ ...FONT, padding: "6vh 5vw 12vh" }}>
      <div style={{ display: "flex", marginBottom: 40, borderBottom: "1px solid #f0f0f0", paddingBottom: 0 }}>
        {tabBtn("wardrobe", "WARDROBE ANALYSIS")}
        {tabBtn("fit", "DOES IT FIT MY WARDROBE?")}
        {tabBtn("compare", "COMPARE TWO ITEMS")}
      </div>

      <div style={{ maxWidth: 600 }}>

        {/* ── WARDROBE ANALYSIS ─────────────────────────────────────────────── */}
        {mode === "wardrobe" && (
          <div>
            <p style={{ fontSize: 11, color: "#bbb", marginBottom: 28, lineHeight: 1.7, letterSpacing: "0.03em" }}>
              AI analyzes your entire closet — brand diversity, color balance, style coherence,
              what pairs well, and what&apos;s missing.
            </p>
            <button onClick={runWardrobeAnalysis} disabled={loading} style={primaryBtn(!loading)}>
              {loading ? "ANALYZING…" : "ANALYZE MY WARDROBE"}
            </button>

            {error && <p style={{ color: "#c00", fontSize: 11, marginTop: 20 }}>{error}</p>}

            {result && (
              <div style={{ marginTop: 36 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 28 }}>
                  <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>
                    {result.overallScore as number}
                  </span>
                  <span style={{ fontSize: 11, color: "#aaa", letterSpacing: "0.1em" }}>/100</span>
                </div>

                <Section title="OVERALL">{result.overallCritique as string}</Section>
                <Section title="STYLE IDENTITY">{result.styleConsistency as string}</Section>
                <Section title="COLOR PALETTE">{result.colorAnalysis as string}</Section>
                <Section title="BRAND MIX">{result.brandAnalysis as string}</Section>
                <Section title="COORDINATION">{result.coordinationAnalysis as string}</Section>

                {Array.isArray(result.gaps) && (result.gaps as unknown[]).length > 0 && (
                  <div style={{ marginTop: 28 }}>
                    <span style={labelStyle}>GAPS TO FILL</span>
                    {(result.gaps as { priority: number; gap: string; why: string; recommendation: string }[])
                      .sort((a, b) => a.priority - b.priority)
                      .map((g, i) => (
                        <div key={i} style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 16, marginBottom: 16 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{g.gap}</p>
                          <p style={{ fontSize: 11, color: "#666", marginBottom: 4, lineHeight: 1.5 }}>{g.why}</p>
                          <p style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>{g.recommendation}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── FIT CHECK ─────────────────────────────────────────────────────── */}
        {mode === "fit" && (
          <div>
            <p style={{ fontSize: 11, color: "#bbb", marginBottom: 28, lineHeight: 1.7, letterSpacing: "0.03em" }}>
              Upload a photo or paste a URL of an item you&apos;re considering. AI will tell you
              whether it works with your existing wardrobe and why.
            </p>

            <div style={{ marginBottom: 20 }}>
              <span style={labelStyle}>UPLOAD PHOTO</span>
              <input
                type="file" accept="image/*"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => { setFitImageDataUrl(reader.result as string); setFitUrl(""); };
                  reader.readAsDataURL(f);
                }}
                style={{ fontSize: 11, color: "#666" }}
              />
              {fitImageDataUrl && (
                <img src={fitImageDataUrl} alt="preview"
                  style={{ marginTop: 10, maxHeight: 160, objectFit: "contain", display: "block" }} />
              )}
            </div>

            <div style={{ marginBottom: 24 }}>
              <span style={labelStyle}>OR PASTE PRODUCT URL</span>
              <input
                type="url" value={fitUrl}
                onChange={e => { setFitUrl(e.target.value); setFitImageDataUrl(""); }}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>

            <button
              onClick={runFitCheck}
              disabled={loading || (!fitImageDataUrl && !fitUrl)}
              style={primaryBtn(!loading && !!(fitImageDataUrl || fitUrl))}
            >
              {loading ? "ANALYZING…" : "CHECK FIT"}
            </button>

            {error && <p style={{ color: "#c00", fontSize: 11, marginTop: 20 }}>{error}</p>}

            {result && (
              <div style={{ marginTop: 36 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, letterSpacing: "0.08em",
                    color: result.verdict === "YES" ? "#2e7d32" : result.verdict === "NO" ? "#c00" : "#996600",
                  }}>
                    {result.verdict as string}
                  </span>
                  <span style={{ fontSize: 11, color: "#999" }}>— {result.summary as string}</span>
                </div>
                <Section title="WHY">{result.reasoning as string}</Section>
                {Array.isArray(result.pairsWith) && (result.pairsWith as string[]).length > 0 && (
                  <Section title="PAIRS BEST WITH">{(result.pairsWith as string[]).join(", ")}</Section>
                )}
                {Array.isArray(result.conflicts) && (result.conflicts as string[]).length > 0 && (
                  <Section title="CONFLICTS WITH">{(result.conflicts as string[]).join(", ")}</Section>
                )}
                {!!result.stylingTip && (
                  <Section title="STYLING TIP">{String(result.stylingTip)}</Section>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── COMPARE TWO ITEMS ─────────────────────────────────────────────── */}
        {mode === "compare" && (
          <div>
            <p style={{ fontSize: 11, color: "#bbb", marginBottom: 28, lineHeight: 1.7, letterSpacing: "0.03em" }}>
              Can&apos;t decide between two items? Pick from your closet or paste URLs.
              AI tells you which is the better buy for your wardrobe.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
              {/* Item A */}
              <div>
                <span style={labelStyle}>ITEM A</span>
                {garments.length > 0 && (
                  <select
                    value={cmpA}
                    onChange={e => { setCmpA(e.target.value); setCmpAUrl(""); }}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  >
                    <option value="">— from closet —</option>
                    {garments.map(g => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </select>
                )}
                <input
                  type="url" placeholder="or paste URL…" value={cmpAUrl}
                  onChange={e => { setCmpAUrl(e.target.value); setCmpA(""); }}
                  style={inputStyle}
                />
                {(cmpA ? garments.find(g => g.id === cmpA)?.image : cmpAUrl) && (
                  <img
                    src={(cmpA ? garments.find(g => g.id === cmpA)?.image : cmpAUrl) ?? undefined}
                    alt="A"
                    style={{ marginTop: 10, height: 120, objectFit: "contain", display: "block", width: "100%" }}
                  />
                )}
              </div>

              {/* Item B */}
              <div>
                <span style={labelStyle}>ITEM B</span>
                {garments.length > 0 && (
                  <select
                    value={cmpB}
                    onChange={e => { setCmpB(e.target.value); setCmpBUrl(""); }}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  >
                    <option value="">— from closet —</option>
                    {garments.map(g => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </select>
                )}
                <input
                  type="url" placeholder="or paste URL…" value={cmpBUrl}
                  onChange={e => { setCmpBUrl(e.target.value); setCmpB(""); }}
                  style={inputStyle}
                />
                {(cmpB ? garments.find(g => g.id === cmpB)?.image : cmpBUrl) && (
                  <img
                    src={(cmpB ? garments.find(g => g.id === cmpB)?.image : cmpBUrl) ?? undefined}
                    alt="B"
                    style={{ marginTop: 10, height: 120, objectFit: "contain", display: "block", width: "100%" }}
                  />
                )}
              </div>
            </div>

            <button
              onClick={runComparison}
              disabled={loading || !(cmpA || cmpAUrl) || !(cmpB || cmpBUrl)}
              style={primaryBtn(!loading && !!(cmpA || cmpAUrl) && !!(cmpB || cmpBUrl))}
            >
              {loading ? "COMPARING…" : "COMPARE"}
            </button>

            {error && <p style={{ color: "#c00", fontSize: 11, marginTop: 20 }}>{error}</p>}

            {result && (
              <div style={{ marginTop: 36 }}>
                <div style={{ marginBottom: 24 }}>
                  <span style={labelStyle}>WINNER</span>
                  <p style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.04em" }}>
                    {result.winner as string}
                  </p>
                </div>
                <Section title="WHY">{result.reasoning as string}</Section>
                {Array.isArray(result.winnerPros) && (
                  <Section title={`${result.winner as string} STRENGTHS`}>
                    {(result.winnerPros as string[]).join(" · ")}
                  </Section>
                )}
                {Array.isArray(result.loserCons) && (
                  <Section title="WHY NOT THE OTHER">
                    {(result.loserCons as string[]).join(" · ")}
                  </Section>
                )}
                {!!result.caveat && (
                  <Section title="CAVEAT">{String(result.caveat)}</Section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <span style={{
        fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase" as const,
        color: "#aaa", display: "block", marginBottom: 6, fontFamily: "Arial, sans-serif",
      }}>
        {title}
      </span>
      <p style={{ fontSize: 12, color: "#333", lineHeight: 1.65, fontFamily: "Arial, sans-serif" }}>
        {children}
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  borderBottom: "1px solid #ddd",
  padding: "8px 0",
  fontSize: 11,
  outline: "none",
  background: "transparent",
  fontFamily: "Arial, sans-serif",
};

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    background: enabled ? "#111" : "#ccc",
    color: "#fff",
    border: "none",
    padding: "11px 28px",
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    cursor: enabled ? "pointer" : "default",
    fontFamily: "Arial, sans-serif",
  };
}

// Scores/AI are Pro-only — see components/ProGate.tsx.
export default function AnalysisPage() {
  return <ProGate feature="AI analysis"><AnalysisPageInner /></ProGate>;
}
