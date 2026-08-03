"use client";
import { useEffect, useState } from "react";

const FONT = { fontFamily: "Arial, sans-serif" };
const PREF_KEY = "mc_prefs";

type Prefs = {
  gender: "male" | "female" | "unisex" | null;
};

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Prefs;
  } catch { return { gender: null }; }
}

function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

const GENDER_OPTIONS: { value: Prefs["gender"]; label: string; sub: string }[] = [
  { value: "male",   label: "MALE",    sub: "menswear, streetwear, men's accessories" },
  { value: "female", label: "FEMALE",  sub: "womenswear, street style, women's accessories" },
  { value: "unisex", label: "UNISEX",  sub: "gender-neutral and unisex pieces only" },
];

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>({ gender: null });
  const [saved,  setSaved]  = useState(false);
  const [fixStatus, setFixStatus] = useState<string | null>(null);
  const [fixRunning, setFixRunning] = useState(false);

  async function fixImages() {
    setFixRunning(true);
    setFixStatus("Scanning...");
    try {
      const res = await fetch("/api/garments/fix-images", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setFixStatus(`Error: ${d.error}`); return; }
      if (d.total === 0) {
        setFixStatus("All images are already on Supabase Storage.");
      } else {
        setFixStatus(`Fixed ${d.processed} of ${d.total} items.${d.remaining > 0 ? ` Run again for ${d.remaining} remaining.` : ""}`);
      }
    } catch (e) {
      setFixStatus(`Failed: ${String(e)}`);
    } finally {
      setFixRunning(false);
    }
  }

  useEffect(() => { setPrefs(loadPrefs()); }, []);

  function setGender(g: Prefs["gender"]) {
    const next = { ...prefs, gender: g };
    setPrefs(next);
    savePrefs(next);
    // Bust the shopping rec cache so next visit re-generates with the new gender
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith("mycloset_shopping"))
        .forEach(k => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const row = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 16,
    padding: "14px 16px",
    border: `1px solid ${active ? "#111" : "#e8e8e8"}`,
    background: active ? "#111" : "#fff",
    cursor: "pointer",
    marginBottom: 8,
  });

  return (
    <main style={{ ...FONT, minHeight: "100vh", background: "#fff", padding: "7vh 6vw 10vh" }}>
      <p style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#bbb", marginBottom: 32 }}>
        SETTINGS
      </p>

      {/* Gender */}
      <section style={{ marginBottom: 48 }}>
        <p style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#aaa", marginBottom: 16 }}>
          YOUR GENDER
        </p>
        <p style={{ fontSize: 11, color: "#999", marginBottom: 20, lineHeight: 1.6, maxWidth: 400 }}>
          Used to tailor shopping recommendations — menswear vs. womenswear, accessories, and cuts.
        </p>

        {GENDER_OPTIONS.map(opt => {
          const active = prefs.gender === opt.value;
          return (
            <div key={opt.value} onClick={() => setGender(opt.value)} style={row(active)}>
              <div style={{
                width: 14, height: 14, borderRadius: "50%",
                border: `2px solid ${active ? "#fff" : "#ccc"}`,
                background: active ? "#fff" : "transparent",
                flexShrink: 0,
              }} />
              <div>
                <p style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
                  color: active ? "#fff" : "#111",
                  textTransform: "uppercase", marginBottom: 2,
                }}>
                  {opt.label}
                </p>
                <p style={{ fontSize: 9, color: active ? "#ccc" : "#bbb", letterSpacing: "0.04em" }}>
                  {opt.sub}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      {saved && (
        <p style={{ fontSize: 9, color: "#2a7a2a", letterSpacing: "0.16em", textTransform: "uppercase" }}>
          SAVED
        </p>
      )}

      {/* Image repair */}
      <section style={{ marginTop: 48, borderTop: "1px solid #f0f0f0", paddingTop: 40 }}>
        <p style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#aaa", marginBottom: 12 }}>
          FIX ITEM IMAGES
        </p>
        <p style={{ fontSize: 11, color: "#999", marginBottom: 20, lineHeight: 1.6, maxWidth: 400 }}>
          Some items may have broken images in the outfits gallery. This re-uploads
          them to our storage so they load correctly. Run it once — repeat if any
          remain (processes 50 at a time).
        </p>
        <button
          onClick={fixImages}
          disabled={fixRunning}
          style={{
            padding: "12px 20px", background: fixRunning ? "#f5f5f5" : "#111",
            color: fixRunning ? "#aaa" : "#fff", border: "none",
            fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
            textTransform: "uppercase", cursor: fixRunning ? "default" : "pointer",
            ...FONT,
          }}
        >
          {fixRunning ? "PROCESSING..." : "FIX IMAGES"}
        </button>
        {fixStatus && (
          <p style={{ fontSize: 10, color: "#888", letterSpacing: "0.06em", marginTop: 12 }}>
            {fixStatus}
          </p>
        )}
      </section>

      <p style={{ fontSize: 9, color: "#ddd", letterSpacing: "0.1em", marginTop: 40, lineHeight: 1.8 }}>
        PREFERENCES ARE STORED ON THIS DEVICE.<br />
        SHOPPING RECOMMENDATIONS REFRESH ON NEXT VISIT.
      </p>
    </main>
  );
}
