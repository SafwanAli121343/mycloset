"use client";
import { useEffect, useState, useCallback } from "react";

const FONT = { fontFamily: "Arial, sans-serif" };

type SourceLink = { url: string; price_text: string | null; retailer: string };
type Item = {
  id: string;
  brand: string;
  title: string;
  price_text: string | null;
  image_url: string | null;
  product_url: string;
  category: string | null;
  sub_type: string | null;
  color_primary: string | null;
  aesthetic_tags: string[] | null;
  gender: string | null;
  brand_tier: string | null;
  analyzed: boolean;
  source_links: SourceLink[] | null;
};

type Stats = {
  total: number;
  byBrand: Record<string, number>;
  byCategory: Record<string, number>;
  page: number;
  limit: number;
  items: Item[];
};

const CATEGORY_COLORS: Record<string, string> = {
  top:       "#1a1a2e",
  bottom:    "#16213e",
  outerwear: "#0f3460",
  footwear:  "#533483",
  accessory: "#2d6a4f",
};

const TIER_COLORS: Record<string, string> = {
  budget:  "#888",
  mid:     "#555",
  premium: "#222",
  luxury:  "#b8860b",
};

export default function DatabasePage() {
  const [data,        setData]        = useState<Stats | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [brandFilter, setBrandFilter] = useState("");
  const [catFilter,   setCatFilter]   = useState("");
  const [page,        setPage]        = useState(0);
  const [hovered,     setHovered]     = useState<string | null>(null);

  const load = useCallback(async (p = 0, brand = brandFilter, cat = catFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p) });
    if (brand) params.set("brand", brand);
    if (cat)   params.set("category", cat);
    try {
      const res = await fetch(`/api/database?${params}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [brandFilter, catFilter]);

  useEffect(() => { load(0); }, []);

  function applyFilter(brand: string, cat: string) {
    setBrandFilter(brand);
    setCatFilter(cat);
    setPage(0);
    load(0, brand, cat);
  }

  function changePage(p: number) {
    setPage(p);
    load(p);
  }

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <main style={{ ...FONT, minHeight: "100vh", background: "#f8f8f8", padding: "5vh 4vw 10vh" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 28 }}>
        <p style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#bbb" }}>
          PRODUCT DATABASE
        </p>
        {data && (
          <p style={{ fontSize: 11, color: "#888" }}>
            {data.total.toLocaleString()} items
          </p>
        )}
        {(brandFilter || catFilter) && (
          <button onClick={() => applyFilter("", "")} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 9, color: "#e00", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            CLEAR FILTER
          </button>
        )}
      </div>

      {/* Stats bar */}
      {data && (
        <div style={{ marginBottom: 28, display: "flex", gap: 24, flexWrap: "wrap" }}>
          {/* By brand */}
          <div>
            <p style={{ fontSize: 8, letterSpacing: "0.16em", color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>BRANDS</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(data.byBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => (
                <button key={b} onClick={() => applyFilter(b, catFilter)} style={{
                  padding: "4px 10px", fontSize: 9, letterSpacing: "0.06em",
                  background: brandFilter === b ? "#111" : "#fff",
                  color: brandFilter === b ? "#fff" : "#555",
                  border: "1px solid #ddd", cursor: "pointer", textTransform: "uppercase",
                  fontFamily: "Arial, sans-serif",
                }}>
                  {b} ({n})
                </button>
              ))}
            </div>
          </div>

          {/* By category */}
          <div>
            <p style={{ fontSize: 8, letterSpacing: "0.16em", color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>CATEGORIES</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                <button key={c} onClick={() => applyFilter(brandFilter, c)} style={{
                  padding: "4px 10px", fontSize: 9, letterSpacing: "0.06em",
                  background: catFilter === c ? CATEGORY_COLORS[c] ?? "#111" : "#fff",
                  color: catFilter === c ? "#fff" : "#555",
                  border: "1px solid #ddd", cursor: "pointer", textTransform: "uppercase",
                  fontFamily: "Arial, sans-serif",
                }}>
                  {c} ({n})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", gap: 6, paddingTop: 40 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: "50%", background: "#ccc",
              animation: "waveDot 0.9s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }} />
          ))}
        </div>
      )}

      {/* Grid */}
      {!loading && data && (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 32,
          }}>
            {data.items.map(item => (
              <a
                key={item.id}
                href={item.product_url}
                target="_blank"
                rel="noopener noreferrer"
                onMouseEnter={() => setHovered(item.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: "block", textDecoration: "none", color: "inherit",
                  background: "#fff",
                  border: `1px solid ${hovered === item.id ? "#111" : "#e8e8e8"}`,
                  transition: "border-color 0.1s",
                }}
              >
                {/* Image */}
                <div style={{ height: 200, background: "#f5f5f5", overflow: "hidden", position: "relative" }}>
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "#eee" }} />
                  )}
                  {/* Category badge */}
                  {item.category && (
                    <span style={{
                      position: "absolute", top: 6, left: 6,
                      background: CATEGORY_COLORS[item.category] ?? "#222",
                      color: "#fff", fontSize: 7, padding: "2px 6px",
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      fontFamily: "Arial, sans-serif",
                    }}>
                      {item.category}
                    </span>
                  )}
                  {/* Analyzed badge */}
                  {item.analyzed && (
                    <span style={{
                      position: "absolute", top: 6, right: 6,
                      background: "#2d6a4f", color: "#fff",
                      fontSize: 7, padding: "2px 5px",
                      fontFamily: "Arial, sans-serif",
                    }}>
                      AI ✓
                    </span>
                  )}
                  {/* Multi-source badge */}
                  {(item.source_links?.length ?? 0) > 0 && (
                    <span style={{
                      position: "absolute", bottom: 6, right: 6,
                      background: "#1a1a2e", color: "#fff",
                      fontSize: 7, padding: "2px 6px",
                      fontFamily: "Arial, sans-serif",
                    }}>
                      +{item.source_links!.length} sites
                    </span>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: "10px 10px 12px" }}>
                  <p style={{ fontSize: 9, color: "#bbb", letterSpacing: "0.1em", marginBottom: 3, textTransform: "uppercase" }}>
                    {item.brand}
                  </p>
                  <p style={{ fontSize: 11, color: "#111", lineHeight: 1.3, marginBottom: 7 }}>
                    {item.title}
                  </p>

                  {/* Sub-type & color */}
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 5 }}>
                    {item.sub_type && (
                      <span style={{ fontSize: 8, color: "#888", background: "#f0f0f0", padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "Arial, sans-serif" }}>
                        {item.sub_type}
                      </span>
                    )}
                    {item.color_primary && (
                      <span style={{ fontSize: 8, color: "#888", background: "#f0f0f0", padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "Arial, sans-serif" }}>
                        {item.color_primary}
                      </span>
                    )}
                  </div>

                  {/* Aesthetic tags */}
                  {item.aesthetic_tags?.length ? (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                      {item.aesthetic_tags.slice(0, 3).map(t => (
                        <span key={t} style={{ fontSize: 7, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "Arial, sans-serif" }}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* Price & tier */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>
                      {item.price_text ?? "—"}
                    </p>
                    {item.brand_tier && (
                      <span style={{ fontSize: 7, color: TIER_COLORS[item.brand_tier] ?? "#888", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "Arial, sans-serif" }}>
                        {item.brand_tier}
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => changePage(Math.max(0, page - 1))} disabled={page === 0} style={{
                background: "none", border: "1px solid #ddd", padding: "6px 12px",
                fontSize: 9, cursor: page === 0 ? "default" : "pointer",
                opacity: page === 0 ? 0.3 : 1, letterSpacing: "0.1em", fontFamily: "Arial, sans-serif",
              }}>←</button>
              <span style={{ fontSize: 9, color: "#888", letterSpacing: "0.06em", fontFamily: "Arial, sans-serif" }}>
                PAGE {page + 1} / {totalPages}
              </span>
              <button onClick={() => changePage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{
                background: "none", border: "1px solid #ddd", padding: "6px 12px",
                fontSize: 9, cursor: page >= totalPages - 1 ? "default" : "pointer",
                opacity: page >= totalPages - 1 ? 0.3 : 1, letterSpacing: "0.1em", fontFamily: "Arial, sans-serif",
              }}>→</button>
            </div>
          )}

          {data.items.length === 0 && (
            <p style={{ fontSize: 11, color: "#ccc", paddingTop: 40 }}>
              No items yet. Run the scraper to populate the database.
            </p>
          )}
        </>
      )}

      <style>{`@keyframes waveDot{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-7px)}}`}</style>
    </main>
  );
}
