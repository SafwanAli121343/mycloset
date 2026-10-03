// Turns a product page's raw <title>/og:title into a clean item name. Raw page titles are
// written for search engines and browser tabs, not for a closet: they carry the store name
// ("| Stüssy", "– SSENSE"), the domain ("stussy.com"), marketing ("Free Shipping", "Shop now"),
// HTML entities ("&amp;", "&#39;"), trademark symbols and emoji, and often the colorway
// ("Kids Tee - Black"), which already has its own Color field. The free tier shows this text
// as-is (no AI to rewrite it), which is where the "weird symbols / almost a link" names came
// from. Deterministic, no AI. Falls back to the decoded raw title if cleaning removes everything.
import { COLOR_GROUPS, normalizeColorName } from "@/lib/constants/colors";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "…", trade: "", reg: "", copy: "",
  eacute: "é", egrave: "è", uuml: "ü", ouml: "ö", auml: "ä", ntilde: "ñ", ccedil: "ç",
};
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}
function safeFromCode(n: number): string {
  try { return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; } catch { return ""; }
}

// Accent/case/punctuation-insensitive form, for comparing a segment against the brand.
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COLOR_WORDS = new Set(COLOR_GROUPS.flat().map(normalizeColorName));
function isColorPhrase(seg: string): boolean {
  // "Black", "Washed Black", "Black/White", "Navy & Cream" — every word a color (or a common
  // colorway modifier).
  const words = seg.toLowerCase().split(/[\s/&,+]+/).filter(Boolean);
  const MODIFIERS = new Set(["washed", "light", "dark", "heather", "faded", "vintage", "multi", "multicolor"]);
  return words.length > 0 && words.length <= 4 &&
    words.every(w => COLOR_WORDS.has(normalizeColorName(w)) || MODIFIERS.has(w));
}

const DOMAIN_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|uk|us|ca|au|de|fr|it|jp|eu|io|shop|store|clothing|fashion)(?:\/\S*)?\b/gi;
const MARKETING_RE = /\b(free (?:shipping|delivery|returns)|shop(?:\s+now|\s+online|\s+the)?|buy(?:\s+now|\s+online)?|official(?:\s+(?:site|store|website))?|online store|sale|new arrivals?|in stock)\b/i;

export function cleanProductTitle(raw: string | null | undefined, brand?: string | null): string | null {
  if (!raw) return null;
  const decoded = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!decoded) return null;

  let s = decoded
    .replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"')   // curly quotes
    .replace(/^\s*(?:buy|shop)\s+/i, "")                                    // "Buy Levi's 501 …"
    .replace(DOMAIN_RE, " ")
    // Trademark symbols, emoji and other pictographs; zero-width characters.
    .replace(/[™®©℠]/g, "")
    .replace(/[\p{Extended_Pictographic}​-‍️]/gu, "");

  // Split on the separators page titles use between "product", "colorway", "store" and
  // "marketing" parts. " - " needs the spaces so "T-Shirt" stays whole.
  const brandKey = brand ? fold(brand) : "";
  const segments = s.split(/\s*[|–—·•»]\s*|\s+-\s+|\s*:\s+/).map(x => x.trim()).filter(Boolean);
  const kept = segments.filter((seg, i) => {
    const f = fold(seg);
    if (!f) return false;
    if (brandKey && (f === brandKey || f === `${brandKey}official`)) return false;
    if (MARKETING_RE.test(seg) && seg.split(/\s+/).length <= 5) return false;
    if (i > 0 && isColorPhrase(seg)) return false; // colorway — Color has its own field
    return true;
  });
  // Page titles almost always lead with the product; anything after the first kept segment is
  // usually store/category noise ("Men's T-Shirts", "Clothing") — but keep a second segment if
  // the first is too short to stand alone (e.g. "Kids" | "Tee").
  s = kept.length === 0 ? "" : kept[0].length >= 4 || kept.length === 1 ? kept[0] : `${kept[0]} ${kept[1]}`;

  // Leading brand ("Stüssy Kids Tee" → "Kids Tee") — the brand has its own field.
  if (brandKey && s) {
    const words = s.split(" ");
    for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
      if (fold(words.slice(0, n).join(" ")) === brandKey) { s = words.slice(n).join(" "); break; }
    }
  }

  s = s
    .replace(/[^\p{L}\p{N}\s'&\-/.()+,#]/gu, " ")   // anything else symbol-like
    .replace(/\s+/g, " ")
    .replace(/^[\s\-/.,&+]+|[\s\-/.,&+]+$/g, "")
    .trim();
  if (s.length > 80) s = s.slice(0, 80).replace(/\s+\S*$/, "");
  return s || decoded.slice(0, 80);
}
