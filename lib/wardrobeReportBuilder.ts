// Builds or advances a user's Wardrobe tab report entirely on the server and saves it — used by
// purchased "Perform analysis?" jobs and Pro's catch-up run after upgrading (lib/analysisJobs.ts),
// which must finish even if the app is closed. Mirrors exactly what the clients do on first load
// (the recovery path in app/wardrobe-analysis/page.tsx and native/screens/WardrobeScreen.tsx):
// Level 1 from a fresh analysis, deterministically auto-crossing what the wardrobe already
// covers, then straight on to Level 2 if Level 1 turns out complete.
import { createClient } from "@supabase/supabase-js";
import {
  computeGapProgress, gapTotalProgress, getFunctionalSlot, resolveSubTypeFromTitle,
  type CrossedEntry, type WABackendState, type WardrobeAnalysis,
} from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";
import { analyzeWardrobe, GARMENT_FIELDS, type RawGarment } from "@/lib/wardrobeAnalyzer";
import type { AiActor, AiCallOpts } from "@/lib/aiGateway";
import { getSlot } from "@/lib/scoring";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// "Enough pieces for a proper wardrobe analysis": at least this many items, and enough coverage
// to wear a complete outfit (a top + bottom, or a one-piece, plus shoes) — slots from lib/scoring.
export const MIN_WARDROBE_PIECES = 5;

type SlotGarment = { sub_type: string | null; category?: string | null; title?: string | null };

export function hasEnoughForWardrobeAnalysis(garments: SlotGarment[]): boolean {
  if (garments.length < MIN_WARDROBE_PIECES) return false;
  const slots = new Set(garments.map(g => getSlot(g.sub_type ?? resolveSubTypeFromTitle(g.title ?? ""))));
  const hasTop = slots.has("base") || slots.has("mid");
  const hasBottom = slots.has("bottom");
  const hasOnePiece = slots.has("onepiece");
  const hasShoes = slots.has("foot");
  return ((hasTop && hasBottom) || hasOnePiece) && hasShoes;
}

function normAesthetic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isConResolved(crossed: CrossedEntry[], links: Record<string, string> | undefined, index: number, level: number): boolean {
  const entry = crossed.find(e => e.category === "con" && e.key === String(index) && e.analysisLevel === level);
  if (!entry) return false;
  if (entry.garmentId) return true;
  const linkedGap = (links ?? {})[String(index)];
  return linkedGap ? gapTotalProgress(crossed, linkedGap, level) >= 100 : true;
}

// Same "level complete" test the clients use before asking for the next level.
export function isLevelComplete(state: WABackendState): boolean {
  const level = Math.max(1, Math.min(state.currentLevel, state.analysisHistory.length));
  const a = state.analysisHistory[level - 1];
  if (!a) return false;
  const atL = state.crossed.filter(e => e.analysisLevel === level);
  return (
    (a.gaps.length === 0 || a.gaps.every(g => gapTotalProgress(state.crossed, g.description, level) >= 100)) &&
    (a.cons.length === 0 || a.cons.every((_, i) => isConResolved(state.crossed, a.conGapLinks, i, level))) &&
    (a.colors.missing.length === 0 || a.colors.missing.every(c => atL.some(e => e.category === "color" && e.key === c))) &&
    (a.aesthetics.missing.length === 0 || a.aesthetics.missing.every(ae => atL.some(e => e.category === "aesthetic" && e.key === ae)))
  );
}

// history.length > currentLevel means the last advance found nothing new — don't offer another.
export function canAdvance(state: WABackendState): boolean {
  return state.analysisHistory.length <= state.currentLevel && isLevelComplete(state);
}

function autoCrossLevel1(freshA: WardrobeAnalysis, garments: RawGarment[]): CrossedEntry[] {
  const crossed: CrossedEntry[] = [];
  for (const gap of freshA.gaps) {
    for (const g of garments) {
      const sub = g.sub_type ?? resolveSubTypeFromTitle("");
      const progress = computeGapProgress(gap.description, sub, (g.category ?? "").toLowerCase(), getFunctionalSlot(sub));
      if (progress > 0) crossed.push({ category: "gap", key: gap.description, garmentId: g.id, analysisLevel: 1, progress });
    }
  }
  for (const missingColor of freshA.colors.missing) {
    const filler = garments.find(g => g.color_primary && sameColorGroup(g.color_primary, missingColor));
    if (filler) crossed.push({ category: "color", key: missingColor, garmentId: filler.id, analysisLevel: 1 });
  }
  for (const missingAes of freshA.aesthetics.missing) {
    const filler = garments.find(g => (g.aesthetic_tags ?? []).some(t => normAesthetic(t) === normAesthetic(missingAes)));
    if (filler) crossed.push({ category: "aesthetic", key: missingAes, garmentId: filler.id, analysisLevel: 1 });
  }
  for (let ci = 0; ci < freshA.cons.length; ci++) {
    const linkedGap = (freshA.conGapLinks ?? {})[String(ci)];
    if (!linkedGap || gapTotalProgress(crossed, linkedGap, 1) >= 100) {
      crossed.push({ category: "con", key: String(ci), garmentId: undefined as unknown as string, analysisLevel: 1 });
    }
  }
  return crossed;
}

function hasContent(a: WardrobeAnalysis): boolean {
  return a.gaps.length > 0 || a.colors.missing.length > 0 || a.aesthetics.missing.length > 0 || a.cons.length > 0;
}

export async function loadWardrobeState(userId: string): Promise<(WABackendState & { purchased: boolean }) | null> {
  const { data, error } = await sb.from("wardrobe_analysis_state")
    .select("analysis_history, crossed, current_level, purchased").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  const history = (data.analysis_history as WardrobeAnalysis[]) ?? [];
  if (!history.length) return null;
  return {
    analysisHistory: history,
    crossed: (data.crossed as CrossedEntry[]) ?? [],
    currentLevel: (data.current_level as number) ?? 1,
    purchased: !!data.purchased,
  };
}

export type ReportOutcome = "created" | "advanced" | "nothing_new" | "unlocked";

// Creates the report (no state yet) or advances a completed level. Throws if the analysis fails;
// nothing is written in that case. `purchased` marks the saved report as paid for.
export async function buildOrAdvanceReport(
  userId: string, actor: AiActor, opts: { purchased: boolean; ai?: AiCallOpts },
): Promise<ReportOutcome> {
  const { data: garmentRows, error } = await sb.from("garments").select(GARMENT_FIELDS).eq("user_id", userId);
  if (error) throw new Error("couldn't load garments");
  const garments = (garmentRows ?? []) as unknown as RawGarment[];
  if (!hasEnoughForWardrobeAnalysis(garments)) throw new Error("not enough pieces");

  const existing = await loadWardrobeState(userId);
  let next: WABackendState;
  let outcome: ReportOutcome;

  if (!existing) {
    const freshA = await analyzeWardrobe(garments, [], [], actor, opts.ai);
    const crossed = autoCrossLevel1(freshA, garments);
    next = { analysisHistory: [freshA], crossed, currentLevel: 1 };
    if (isLevelComplete(next)) {
      try {
        const freshA2 = await analyzeWardrobe(garments, [freshA], crossed, actor, opts.ai);
        next = { analysisHistory: [freshA, freshA2], crossed, currentLevel: 2 };
      } catch { /* stay at Level 1 — same as the clients */ }
    }
    outcome = "created";
  } else if (!canAdvance(existing)) {
    // A report made while subscribed (now lapsed) that isn't ready for a new level: the purchase
    // unlocks it as it stands — that IS the delivered analysis.
    if (opts.purchased && !existing.purchased) {
      const { error: upErr } = await sb.from("wardrobe_analysis_state").update({ purchased: true }).eq("user_id", userId);
      if (upErr) throw new Error("couldn't save the report");
      return "unlocked";
    }
    throw new Error("current level isn't complete");
  } else {
    const freshA = await analyzeWardrobe(garments, existing.analysisHistory, existing.crossed, actor, opts.ai);
    if (hasContent(freshA)) {
      next = { analysisHistory: [...existing.analysisHistory, freshA], crossed: existing.crossed, currentLevel: existing.currentLevel + 1 };
      outcome = "advanced";
    } else {
      // Nothing new to find: recorded (same sentinel the clients write) so it isn't offered again.
      next = { analysisHistory: [...existing.analysisHistory, freshA], crossed: existing.crossed, currentLevel: existing.currentLevel };
      outcome = "nothing_new";
    }
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    analysis_history: next.analysisHistory,
    crossed: next.crossed,
    current_level: next.currentLevel,
    updated_at: new Date().toISOString(),
  };
  if (opts.purchased) row.purchased = true; // never cleared once set
  const { error: upErr } = await sb.from("wardrobe_analysis_state").upsert(row, { onConflict: "user_id" });
  if (upErr) throw new Error("couldn't save the report");
  return outcome;
}
