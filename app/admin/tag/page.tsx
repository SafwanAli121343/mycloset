"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const FONT = { fontFamily: "Arial, sans-serif" } as const;

const NAMED_COLORS = [
  "Black","Charcoal","Slate Gray","Gray","Heather Gray","Light Gray","Ash Gray",
  "Off-White","Ivory","Cream","White","Stone","Espresso","Chocolate","Brown",
  "Chestnut","Camel","Tan","Khaki","Sand","Beige","Taupe","Crimson","Red",
  "Brick Red","Maroon","Burgundy","Wine","Rust","Terracotta","Coral","Salmon",
  "Blush","Pink","Hot Pink","Fuchsia","Magenta","Mauve","Purple","Violet",
  "Plum","Eggplant","Lavender","Lilac","Silver","Rose Gold","Platinum","Bronze",
  "Orange","Burnt Orange","Amber","Honey","Wheat","Caramel","Peach","Apricot",
  "Yellow","Mustard","Gold","Butter","Lime","Green","Kelly Green","Emerald",
  "Forest Green","Hunter Green","Olive","Army Green","Sage","Mint","Seafoam",
  "Teal","Turquoise","Sky Blue","Baby Blue","Periwinkle","Blue","Royal Blue",
  "Cobalt","Steel Blue","Denim Blue","Navy","Multicolor",
];

const AESTHETICS = [
  "streetwear","skate","old-money","preppy","quiet-luxury","minimalist",
  "gorpcore","techwear","workwear","athleisure","vintage","90s","y2k",
  "grunge","punk","goth","indie-sleaze","normcore","maximalist","high-fashion",
  "hype-streetwear","skate-streetwear","athletic-prep","workwear-utility",
  "punk-goth","mall-core","cottagecore","western","boho","mob-wife",
];

const FITS = ["slim","skinny","straight","regular","relaxed","oversized","baggy","wide","boxy","tapered","cropped","n/a"];
const PATTERNS = ["solid","striped","plaid","camo","floral","checkered","graphic","color-block","tie-dye","abstract","animal print","houndstooth","paisley","geometric"];
const FORMALITIES = ["casual","smart-casual","business-casual","formal","athletic"];

const COMMON_FEATURES = [
  "kangaroo pocket","chest pocket","side pockets","cargo pockets","zip pockets",
  "drawstring hem","drawstring hood","adjustable hood","ribbed cuffs","ribbed hem",
  "full-length zip","half-zip","button closure","snap closure","elastic waistband",
  "embroidered logo","printed graphic","tonal branding","washed finish","distressed",
  "garment dyed","stonewash","selvedge","raw hem","cropped length","oversized fit",
  "quilted lining","sherpa lining","fleece lining","water-resistant","reflective detail",
];

const SUB_TYPES_FLAT = [
  "T-Shirt","Graphic Tee","Long Sleeve Tee","Oversized Tee","Baby Tee","Thermal Tee",
  "Tank Top","Camisole","Crop Top","Tube Top","Bralette",
  "Polo","Rugby Shirt","Henley",
  "Oxford Shirt","Dress Shirt","Flannel Shirt","Chambray Shirt","Denim Shirt",
  "Linen Shirt","Camp Collar Shirt","Work Shirt","Western Shirt","Bowling Shirt",
  "Printed Shirt","Silk Shirt","Blouse","Knit Top",
  "Pullover Hoodie","Zip-Up Hoodie","Half-Zip Hoodie",
  "Crewneck Sweatshirt","Zip-Up Sweatshirt",
  "Crewneck Sweater","V-Neck Sweater","Turtleneck","Cable Knit Sweater",
  "Ribbed Sweater","Chunky Knit Sweater","Knitwear","Polo Sweater",
  "Cardigan","Quarter Zip","Fleece Pullover",
  "Straight Leg Jeans","Slim Jeans","Skinny Jeans","Wide Leg Jeans","Baggy Jeans",
  "Relaxed Jeans","Cargo Jeans","Flared Jeans",
  "Cargo Pants","Chinos","Trousers","Wide Leg Trousers","Tailored Trousers",
  "Track Pants","Sweatpants","Joggers","Utility Pants","Work Pants","Carpenter Pants",
  "Shorts","Cargo Shorts","Denim Shorts","Swim Shorts","Board Shorts",
  "Gym Shorts","Track Shorts","Work Shorts",
  "Coach Jacket","Windbreaker","Harrington Jacket","Blouson",
  "Track Jacket","Bomber Jacket","Varsity Jacket","MA-1",
  "Denim Jacket","Overshirt","Shacket","Chore Coat","Workwear Jacket","Waxed Jacket",
  "Leather Jacket","Moto Jacket","Sherpa Jacket",
  "Field Jacket","Mountain Jacket","Shell Jacket","Puffer Jacket","Down Jacket",
  "Quilted Jacket","Rain Jacket","Raincoat","Anorak","Parka","Tech Jacket",
  "Blazer","Sport Coat","Suit Jacket",
  "Overcoat","Trench Coat","Wool Coat","Peacoat","Car Coat",
  "Vest","Sweater Vest","Puffer Vest",
  "Low-Top Sneakers","High-Top Sneakers","Trail Runners","Running Shoes","Slip-On Sneakers",
  "Boots","Chelsea Boots","Combat Boots","Work Boots","Western Boots","Ankle Boots",
  "Loafers","Sandals","Mules","Slides",
  "Dress","Mini Dress","Midi Dress","Jumpsuit","Overalls","Skirt",
].sort();

// ── Types ────────────────────────────────────────────────────────────────────

type Item = {
  id: string;
  brand: string;
  title: string;
  price_text: string;
  image_url: string;
  color_primary: string;
  sub_type: string;
  aesthetic_tags: string[];
  tags: Record<string, unknown> | null;
  category: string;
};

type Form = {
  sub_type: string;
  color_primary: string;
  color_secondary: string;
  material: string;
  fit: string;
  pattern: string;
  pattern_detail: string;
  formality: string;
  aesthetic_tags: string[];
  features: string[];
  colors: string[];
};

const DEFAULT_FORM: Form = {
  sub_type: "", color_primary: "", color_secondary: "", material: "",
  fit: "", pattern: "solid", pattern_detail: "", formality: "",
  aesthetic_tags: [], features: [], colors: [],
};

function formFromItem(item: Item): Form {
  const tags = item.tags as Record<string, unknown> | null;
  return {
    ...DEFAULT_FORM,
    sub_type: item.sub_type || "",
    color_primary: item.color_primary || "",
    aesthetic_tags: item.aesthetic_tags || [],
    features: (tags?.features as string[]) || [],
    colors: (tags?.colors as string[]) || (item.color_primary ? [item.color_primary] : []),
    pattern_detail: (tags?.pattern_detail as string) || "",
  };
}

// ── Simple input styles ───────────────────────────────────────────────────────

const INPUT: React.CSSProperties = {
  ...FONT, width: "100%", padding: "8px 10px", fontSize: 13,
  border: "1px solid #000", background: "#fff", color: "#000",
  outline: "none", boxSizing: "border-box",
};

const SELECT: React.CSSProperties = { ...INPUT, cursor: "pointer" };

const LABEL: React.CSSProperties = {
  ...FONT, display: "block", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4, color: "#000",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function TagPage() {
  const [pin, setPin]       = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState(false);

  const [items, setItems]     = useState<Item[]>([]);
  const [index, setIndex]     = useState(0);
  const [total, setTotal]     = useState(0);
  const [brands, setBrands]   = useState<{ brand: string; count: number }[]>([]);
  const [brandFilter, setBrandFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [form, setForm]               = useState<Form>(DEFAULT_FORM);
  const [featureInput, setFeatureInput] = useState("");

  const imgRef = useRef<HTMLImageElement>(null);

  // ── Auth ───────────────────────────────────────────────────────────────────

  const tryAuth = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/tag", { headers: { "x-admin-pin": pin } });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
      setBrands(data.brands);
      setAuthed(true);
      if (data.items[0]) setForm(formFromItem(data.items[0]));
    } else {
      setAuthError(true);
    }
    setLoading(false);
  };

  // ── Load more items ────────────────────────────────────────────────────────

  const loadItems = useCallback(async (brand: string) => {
    setLoading(true);
    const params = new URLSearchParams({ offset: "0" });
    if (brand) params.set("brand", brand);
    const res = await fetch(`/api/admin/tag?${params}`, { headers: { "x-admin-pin": pin } });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
      setBrands(data.brands);
      setIndex(0);
      if (data.items[0]) setForm(formFromItem(data.items[0]));
    }
    setLoading(false);
  }, [pin]);

  useEffect(() => { if (authed) loadItems(brandFilter); }, [brandFilter, authed, loadItems]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goTo = (i: number) => {
    const next = items[i];
    if (!next) return;
    setIndex(i);
    setForm(formFromItem(next));
    setFeatureInput("");
    setSaveMsg(null);
    window.scrollTo(0, 0);
  };

  const skip = () => {
    if (items.length <= 1) return;
    const next = [...items];
    const [removed] = next.splice(index, 1);
    next.push(removed);
    setItems(next);
    const targetIndex = index >= next.length - 1 ? 0 : index;
    const targetItem = next[targetIndex];
    if (!targetItem) return;
    setIndex(targetIndex);
    setForm(formFromItem(targetItem));
    setFeatureInput("");
    setSaveMsg(null);
    window.scrollTo(0, 0);
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const item = items[index];
    if (!item || !form.formality || !form.color_primary || !form.sub_type || !form.material || !form.fit) {
      setSaveMsg("Fill in: color, sub type, material, fit, and formality before saving.");
      return;
    }

    setSaving(true);
    const payload = {
      id: item.id,
      sub_type: form.sub_type,
      color_primary: form.color_primary,
      color_secondary: form.color_secondary || null,
      material: form.material,
      fit: form.fit,
      pattern: form.pattern,
      formality: form.formality,
      aesthetic_tags: form.aesthetic_tags,
      pattern_detail: form.pattern_detail || null,
      features: form.features,
      colors: form.colors.length ? form.colors : [form.color_primary],
    };

    const res = await fetch("/api/admin/tag", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (res.ok) {
      setSessionDone(n => n + 1);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 600);
      skip();
    } else {
      const err = await res.json();
      setSaveMsg(err.error || "Error saving");
    }
  };

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ── Tag helpers ─────────────────────────────────────────────────────────────

  const addFeature = (val: string) => {
    const v = val.trim();
    if (!v || form.features.includes(v)) return;
    setForm(f => ({ ...f, features: [...f.features, v] }));
    setFeatureInput("");
  };

  const toggleAesthetic = (tag: string) => {
    setForm(f => ({
      ...f,
      aesthetic_tags: f.aesthetic_tags.includes(tag)
        ? f.aesthetic_tags.filter(t => t !== tag)
        : [...f.aesthetic_tags, tag],
    }));
  };

  // ── Auth screen ───────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <main style={{ minHeight: "100vh", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", ...FONT }}>
        <div style={{ border: "1px solid #000", width: 260 }}>
          <div style={{ borderBottom: "1px solid #000", padding: "16px 20px" }}>
            <p style={{ ...FONT, margin: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em" }}>
              Manual Tagging
            </p>
          </div>
          <div style={{ padding: "20px" }}>
            <input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setAuthError(false); }}
              onKeyDown={e => e.key === "Enter" && tryAuth()}
              placeholder="Admin PIN"
              style={{ ...INPUT, marginBottom: 12 }}
            />
            {authError && (
              <p style={{ ...FONT, margin: "0 0 10px", fontSize: 11, color: "#000" }}>Wrong PIN</p>
            )}
            <button
              onClick={tryAuth}
              disabled={loading}
              style={{ ...FONT, width: "100%", padding: "10px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", background: "#000", color: "#fff", border: "none", cursor: "pointer" }}
            >
              {loading ? "…" : "Enter"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const item = items[index];

  if (!item && !loading) {
    return (
      <main style={{ minHeight: "100vh", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", ...FONT }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ ...FONT, margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>All done</p>
          <p style={{ ...FONT, margin: 0, fontSize: 12, color: "#888" }}>{sessionDone} tagged this session</p>
          {brandFilter && (
            <button onClick={() => setBrandFilter("")}
              style={{ ...FONT, marginTop: 16, fontSize: 11, textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>
              Clear brand filter
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#fff", ...FONT }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20, background: "#fff",
        borderBottom: "1px solid #000", padding: "10px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ ...FONT, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em" }}>
            TAG
          </span>
          <span style={{ ...FONT, fontSize: 11, color: "#888" }}>
            {index + 1} / {items.length} &nbsp;·&nbsp; {sessionDone} saved
          </span>
        </div>

        <select
          value={brandFilter}
          onChange={e => setBrandFilter(e.target.value)}
          style={{ ...FONT, fontSize: 11, padding: "4px 8px", border: "1px solid #000", background: "#fff", cursor: "pointer" }}
        >
          <option value="">All brands</option>
          {brands.map(b => (
            <option key={b.brand} value={b.brand}>{b.brand} ({b.count})</option>
          ))}
        </select>
      </div>

      {/* ── Save message ─────────────────────────────────────────────────── */}
      {saveMsg && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          zIndex: 50, background: "#000", color: "#fff", padding: "8px 18px",
          fontSize: 12, ...FONT, whiteSpace: "nowrap",
        }}>
          {saveMsg}
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {item && (
        <div style={{ maxWidth: 540, margin: "0 auto", padding: "32px 24px 120px" }}>

          {/* Image */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <img
              ref={imgRef}
              src={item.image_url}
              alt={item.title}
              style={{ height: 280, width: "auto", maxWidth: "100%", mixBlendMode: "multiply", objectFit: "contain" }}
              onError={() => { if (imgRef.current) imgRef.current.style.display = "none"; }}
            />
          </div>

          {/* Item info */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <p style={{ ...FONT, margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#888" }}>
              {item.brand}
            </p>
            <p style={{ ...FONT, margin: "4px 0 0", fontSize: 13, color: "#000" }}>{item.title}</p>
            {item.price_text && (
              <p style={{ ...FONT, margin: "2px 0 0", fontSize: 11, color: "#aaa" }}>{item.price_text}</p>
            )}
          </div>

          {/* ── Form fields ────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>

            {/* Sub type — full width */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={LABEL}>Sub Type *</label>
              <input
                list="subtypes-list"
                value={form.sub_type}
                onChange={e => setForm(f => ({ ...f, sub_type: e.target.value }))}
                placeholder="e.g. Pullover Hoodie"
                style={INPUT}
              />
              <datalist id="subtypes-list">
                {SUB_TYPES_FLAT.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>

            {/* Color primary */}
            <div>
              <label style={LABEL}>Primary Color *</label>
              <input
                list="colors-list"
                value={form.color_primary}
                onChange={e => setForm(f => ({ ...f, color_primary: e.target.value }))}
                placeholder="e.g. Olive"
                style={INPUT}
              />
              <datalist id="colors-list">
                {NAMED_COLORS.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            {/* Color secondary */}
            <div>
              <label style={LABEL}>Secondary Color</label>
              <input
                list="colors-list"
                value={form.color_secondary}
                onChange={e => setForm(f => ({ ...f, color_secondary: e.target.value }))}
                placeholder="e.g. Cream"
                style={INPUT}
              />
            </div>

            {/* Material */}
            <div>
              <label style={LABEL}>Material *</label>
              <input
                value={form.material}
                onChange={e => setForm(f => ({ ...f, material: e.target.value }))}
                placeholder="e.g. Cotton Canvas"
                style={INPUT}
              />
            </div>

            {/* Fit */}
            <div>
              <label style={LABEL}>Fit *</label>
              <select value={form.fit} onChange={e => setForm(f => ({ ...f, fit: e.target.value }))} style={SELECT}>
                <option value="">Select…</option>
                {FITS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            {/* Pattern */}
            <div>
              <label style={LABEL}>Pattern</label>
              <select value={form.pattern} onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))} style={SELECT}>
                {PATTERNS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Formality */}
            <div>
              <label style={LABEL}>Formality *</label>
              <select value={form.formality} onChange={e => setForm(f => ({ ...f, formality: e.target.value }))} style={SELECT}>
                <option value="">Select…</option>
                {FORMALITIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            {/* Pattern detail — only when non-solid */}
            {form.pattern !== "solid" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={LABEL}>Pattern Detail</label>
                <input
                  value={form.pattern_detail}
                  onChange={e => setForm(f => ({ ...f, pattern_detail: e.target.value }))}
                  placeholder="e.g. thin black pinstripes on cream background"
                  style={INPUT}
                />
              </div>
            )}
          </div>

          {/* ── Aesthetics ─────────────────────────────────────────────── */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ ...FONT, margin: "0 0 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Aesthetics
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {AESTHETICS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleAesthetic(tag)}
                  style={{
                    ...FONT, padding: "4px 10px", fontSize: 11, cursor: "pointer",
                    border: "1px solid #000",
                    background: form.aesthetic_tags.includes(tag) ? "#000" : "#fff",
                    color: form.aesthetic_tags.includes(tag) ? "#fff" : "#000",
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* ── Features ───────────────────────────────────────────────── */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ ...FONT, margin: "0 0 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Features
            </p>
            {form.features.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {form.features.map(f => (
                  <span key={f} style={{ ...FONT, display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", border: "1px solid #000", fontSize: 11 }}>
                    {f}
                    <button
                      onClick={() => setForm(fm => ({ ...fm, features: fm.features.filter(x => x !== f) }))}
                      style={{ ...FONT, background: "none", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              list="features-list"
              value={featureInput}
              onChange={e => setFeatureInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addFeature(featureInput); }
              }}
              onBlur={() => featureInput.trim() && addFeature(featureInput)}
              placeholder="Type feature, press Enter to add…"
              style={INPUT}
            />
            <datalist id="features-list">
              {COMMON_FEATURES.map(f => <option key={f} value={f} />)}
            </datalist>
          </div>

        </div>
      )}

      {/* ── Bottom action bar ─────────────────────────────────────────────── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
        background: "#fff", borderTop: "1px solid #000",
        display: "flex", gap: 0,
      }}>
        <button
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          style={{
            ...FONT, flex: 1, padding: "16px", fontSize: 12, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: ".08em",
            background: "#fff", color: "#000", border: "none", borderRight: "1px solid #000",
            cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? 0.3 : 1,
          }}
        >
          ← Back
        </button>
        <button
          onClick={skip}
          style={{
            ...FONT, flex: 1, padding: "16px", fontSize: 12, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: ".08em",
            background: "#fff", color: "#000", border: "none", borderRight: "1px solid #000",
            cursor: "pointer",
          }}
        >
          Skip
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...FONT, flex: 2, padding: "16px", fontSize: 12, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: ".08em",
            background: "#000", color: "#fff", border: "none",
            cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save & Next →"}
        </button>
      </div>
    </main>
  );
}
