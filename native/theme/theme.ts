import { Platform } from "react-native";

// Design tokens lifted directly from the website's visual language (see app/globals.css and
// the FONT/color constants repeated across app/**/page.tsx) so the native app reads as the
// same product, not a reskin. Minimalist black/white, bold uppercase letter-spaced labels,
// thin hairline borders, no color except score/status feedback (green=good, amber=mid, red=bad).

export const colors = {
  bg: "#ffffff",
  text: "#111111",
  // Darker than a typical "muted" gray on purpose — this is used for actual content (color
  // names, section labels) on phone screens viewed at arm's length in varying light, not just
  // decorative hints, so it needs to stay legible rather than just subtle.
  textMuted: "#555555",
  textFaint: "#8f8f8f",
  border: "#ebebeb",
  borderStrong: "#d8d8d8",
  fill: "#f3f3f3",
  good: "#1d9e52",
  mid: "#c88800",
  bad: "#c83030",
  gold: "#c8a800",
  // Used for the Outfits PIECES filter's "all of these together" (AND) mode.
  blue: "#2563eb",
};

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return colors.textFaint;
  if (score >= 75) return colors.good;
  if (score >= 50) return colors.mid;
  return colors.bad;
}

// Arial isn't bundled on iOS; Helvetica is its closest, effectively-identical system
// equivalent (same metrics family) and is always available. Android's default sans-serif
// reads the same way in practice for this style of UI.
export const fontFamily = Platform.select({ ios: "Helvetica", android: "sans-serif", default: undefined });

export const type = {
  label: { fontFamily, fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.2, textTransform: "uppercase" as const, color: colors.textFaint },
  title: { fontFamily, fontSize: 14, fontWeight: "700" as const, letterSpacing: 1, textTransform: "uppercase" as const, color: colors.text },
  body: { fontFamily, fontSize: 13, color: colors.text, lineHeight: 19 },
  button: { fontFamily, fontSize: 12, fontWeight: "700" as const, letterSpacing: 1.4, textTransform: "uppercase" as const },
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
