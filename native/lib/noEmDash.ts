// Copy of lib/text/noEmDash.ts (the app is a separate bundle). The app never shows em dashes;
// this cleans text that comes from elsewhere: AI answers and data already stored in the database.
// A spaced dash between two phrases becomes a comma ("Fragile — cold wash only" → "Fragile, cold
// wash only"). Number ranges written with an en dash ("2–3") are left alone.
export function noEmDash(s: string): string {
  if (!s.includes("—") && !s.includes(" – ")) return s;
  return s
    .replace(/\s*—\s*$/g, "")            // trailing dash
    .replace(/^\s*—\s*/g, "")            // leading dash
    .replace(/\s+–\s+/g, ", ")           // spaced en dash used as a dash
    .replace(/\s*—\s*/g, ", ")           // any em dash
    .replace(/,\s*([,.;:!?)])/g, "$1")   // ", ." → "."
    .replace(/\(\s*,\s*/g, "(");
}

// Same cleanup over every string inside a JSON-like value (objects, arrays), returned as a copy.
export function noEmDashDeep<T>(value: T): T {
  if (typeof value === "string") return noEmDash(value) as unknown as T;
  if (Array.isArray(value)) return value.map(noEmDashDeep) as unknown as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = noEmDashDeep(v);
    return out as T;
  }
  return value;
}

// For an AI answer: JSON answers are cleaned value by value (so the JSON stays valid), plain
// text as a whole.
export function noEmDashText(content: string): string {
  if (!content.includes("—") && !content.includes(" – ")) return content;
  try { return JSON.stringify(noEmDashDeep(JSON.parse(content))); } catch { return noEmDash(content); }
}
