"use client";
import { useState } from "react";

const FONT = { fontFamily: "Arial, sans-serif" };

type ScrapeType = "all_shopify" | "shopify" | "firecrawl";

const KNOWN_SHOPIFY = [
  { label: "Stussy",     domain: "stussy.com",               collections: ["mens"] },
  { label: "HUF",        domain: "www.hufworldwide.com",      collections: ["mens"] },
  { label: "Thrasher",   domain: "www.thrashermagazine.com",  collections: ["all"] },
  { label: "Pleasures",  domain: "pleasures.us",              collections: ["mens", "all"] },
  { label: "Ripndip",    domain: "ripndip.com",               collections: ["all"] },
  { label: "Noah",       domain: "noah-ny.com",               collections: ["all"] },
];

type LogLine = { msg: string; ok: boolean };

export default function AdminPage() {
  const [pin,    setPin]    = useState("");
  const [authed, setAuthed] = useState(false);

  // Stats
  const [stats, setStats] = useState<{ total: number; byBrand: Record<string, number> } | null>(null);

  // Scrape form
  const [type,       setType]       = useState<ScrapeType>("all_shopify");
  const [domain,     setDomain]     = useState("");
  const [brand,      setBrand]      = useState("");
  const [collection, setCollection] = useState("all");
  const [fcUrl,      setFcUrl]      = useState("");
  const [running,    setRunning]    = useState(false);
  const [log,        setLog]        = useState<LogLine[]>([]);

  async function checkPin() {
    const res = await fetch("/api/admin/scrape", { headers: { "x-admin-pin": pin } });
    if (res.ok) { setAuthed(true); loadStats(); }
    else alert("Wrong PIN");
  }

  async function loadStats() {
    const res = await fetch("/api/admin/scrape", { headers: { "x-admin-pin": pin } });
    if (res.ok) setStats(await res.json());
  }

  async function runScrape() {
    setRunning(true);
    setLog([]);
    const body: Record<string, unknown> = { type };
    if (type === "shopify")   { body.domain = domain; body.brand = brand; body.collection = collection; }
    if (type === "firecrawl") { body.url = fcUrl; body.brand = brand; }

    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-pin": pin },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) {
        const lines: LogLine[] = d.log
          ? d.log.map((l: string) => ({ msg: l, ok: true }))
          : [{ msg: `Inserted ${d.inserted} products`, ok: true }];
        setLog(lines);
        await loadStats();
      } else {
        setLog([{ msg: d.error ?? "Error", ok: false }]);
      }
    } catch (e) {
      setLog([{ msg: String(e), ok: false }]);
    }
    setRunning(false);
  }

  const inp: React.CSSProperties = {
    width: "100%", border: "none", borderBottom: "1px solid #ddd",
    padding: "7px 0", fontSize: 12, outline: "none", background: "transparent", ...FONT,
  };
  const lbl: React.CSSProperties = {
    fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#bbb", display: "block", marginBottom: 6, ...FONT,
  };
  const btn = (active = true): React.CSSProperties => ({
    background: active ? "#111" : "#e0e0e0", color: active ? "#fff" : "#999",
    border: "none", padding: "9px 22px", fontSize: 9, letterSpacing: "0.14em",
    textTransform: "uppercase", cursor: active ? "pointer" : "default", ...FONT,
  });

  if (!authed) {
    return (
      <main style={{ ...FONT, minHeight: "100vh", background: "#fff", padding: "15vh 6vw" }}>
        <p style={{ fontSize: 9, letterSpacing: "0.22em", color: "#bbb", marginBottom: 24 }}>ADMIN</p>
        <div style={{ maxWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <span style={lbl}>ADMIN PIN</span>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === "Enter" && checkPin()} style={inp} placeholder="••••••" />
          </div>
          <button onClick={checkPin} style={btn()}>ENTER</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ ...FONT, minHeight: "100vh", background: "#fff", padding: "7vh 6vw 12vh" }}>
      <p style={{ fontSize: 9, letterSpacing: "0.22em", color: "#bbb", marginBottom: 32 }}>ADMIN / PRODUCT DATABASE</p>

      {/* Stats */}
      {stats && (
        <div style={{ marginBottom: 40, padding: "16px 20px", border: "1px solid #f0f0f0" }}>
          <p style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>
            {stats.total.toLocaleString()} products in database
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(stats.byBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => (
              <span key={b} style={{ fontSize: 9, color: "#888", letterSpacing: "0.06em" }}>
                {b} ({n})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quick-scrape known Shopify stores */}
      <section style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 9, letterSpacing: "0.18em", color: "#aaa", marginBottom: 14 }}>QUICK SCRAPE</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {KNOWN_SHOPIFY.map(s => (
            <button key={s.domain} onClick={async () => {
              setRunning(true); setLog([]);
              for (const col of s.collections) {
                const res = await fetch("/api/admin/scrape", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-admin-pin": pin },
                  body: JSON.stringify({ type: "shopify", domain: s.domain, brand: s.label, collection: col }),
                });
                const d = await res.json();
                setLog(prev => [...prev, { msg: `${s.label}/${col}: +${d.inserted ?? 0}`, ok: res.ok }]);
              }
              setRunning(false); loadStats();
            }} disabled={running} style={{
              padding: "6px 14px", fontSize: 9, letterSpacing: "0.1em",
              border: "1px solid #ddd", background: "#fff", cursor: running ? "default" : "pointer",
              textTransform: "uppercase", ...FONT,
            }}>
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={runScrape} disabled={running} style={btn(!running)}>
          {running ? "SCRAPING…" : "SCRAPE ALL KNOWN STORES"}
        </button>
      </section>

      {/* Custom scrape */}
      <section style={{ marginBottom: 40, maxWidth: 480 }}>
        <p style={{ fontSize: 9, letterSpacing: "0.18em", color: "#aaa", marginBottom: 14 }}>CUSTOM SCRAPE</p>

        {/* Type selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["shopify", "firecrawl"] as ScrapeType[]).map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding: "5px 12px", fontSize: 9, letterSpacing: "0.1em",
              textTransform: "uppercase", border: "1px solid",
              borderColor: type === t ? "#111" : "#ddd",
              background: type === t ? "#111" : "#fff",
              color: type === t ? "#fff" : "#888",
              cursor: "pointer", ...FONT,
            }}>
              {t === "shopify" ? "SHOPIFY STORE" : "FIRECRAWL (OTHER)"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div><span style={lbl}>BRAND NAME</span><input value={brand} onChange={e => setBrand(e.target.value)} style={inp} placeholder="e.g. Carhartt WIP" /></div>

          {type === "shopify" && (
            <>
              <div><span style={lbl}>SHOPIFY DOMAIN</span><input value={domain} onChange={e => setDomain(e.target.value)} style={inp} placeholder="carhartt-wip.com" /></div>
              <div><span style={lbl}>COLLECTION SLUG</span><input value={collection} onChange={e => setCollection(e.target.value)} style={inp} placeholder="mens (or all, mens-tops, etc.)" /></div>
            </>
          )}
          {type === "firecrawl" && (
            <div><span style={lbl}>PAGE URL TO SCRAPE</span><input value={fcUrl} onChange={e => setFcUrl(e.target.value)} style={inp} placeholder="https://ssense.com/en-us/men/..." /></div>
          )}

          <button onClick={runScrape} disabled={running} style={btn(!running)}>
            {running ? "SCRAPING…" : "RUN SCRAPE"}
          </button>
        </div>
      </section>

      {/* Log output */}
      {log.length > 0 && (
        <div style={{ padding: "12px 16px", background: "#fafafa", border: "1px solid #f0f0f0" }}>
          {log.map((l, i) => (
            <p key={i} style={{ fontSize: 10, color: l.ok ? "#2a7a2a" : "#c00", marginBottom: 4, ...FONT }}>
              {l.ok ? "✓" : "✗"} {l.msg}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
