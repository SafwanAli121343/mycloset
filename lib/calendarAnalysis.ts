// Scores and AI analysis for a Pro user's calendar outfits (the outfit's styleScore plus its
// pros / cons / tags, stored in outfits.notes). Every calendar outfit a Pro user has gets them:
//   • right after a month is generated (app/api/outfits/generate)
//   • right after a day is set or edited by hand (app/api/outfits POST / PUT)
//   • as a catch-up whenever a month is viewed (app/api/outfits GET) — months generated while
//     on the free plan, or days whose analysis failed earlier
//   • as part of Pro's catch-up right after upgrading (lib/analysisJobs.ts)
// The score is the app's own deterministic scoring; the analysis goes through the AI gateway, so
// it counts toward the Pro monthly cap and identical outfits reuse a stored answer at no cost.
import { createClient } from "@supabase/supabase-js";
import { analyzeOutfit, deriveOutfitAesthetic } from "@/lib/outfitInference";
import { scoreOutfit, type GarmentForScoring } from "@/lib/scoring";
import { AiNotAllowedError } from "@/lib/aiGateway";
import { resolveEntitlement } from "@/lib/billing/entitlements";
import type { User } from "@/lib/db/users";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GARMENT_COLS = "id, title, brand, category, sub_type, material, color_primary, color_secondary, pattern, formality, aesthetic_tags, pros, cons, color_pairings, color_clashes, tags, image";
const PARALLEL = 4;

type Row = { id: string; date: string; notes: string | null; outfit_items: { garments: GarmentForScoring | null }[] };

function parseNotes(notes: string | null): Record<string, unknown> {
  try { return JSON.parse(notes ?? "{}") ?? {}; } catch { return {}; }
}

// Has the score and a real analysis (pros/cons arrays) — nothing to do.
export function hasCalendarAnalysis(notes: string | null): boolean {
  const n = parseNotes(notes);
  return typeof n.styleScore === "number" && Array.isArray(n.pros) && Array.isArray(n.cons);
}

// Outfits being analyzed right now — two requests never analyze the same day at once, but they
// don't block each other on different days.
const inProgress = new Set<string>();

// Analyzes the user's calendar outfits matching the filter that don't have analysis yet.
// Returns how many were completed. Stops early (keeping what's done) if the Pro monthly budget is
// used up or the deadline passes.
export async function analyzeCalendarOutfits(
  user: User,
  filter: { ids?: string[]; dates?: string[]; from?: string; to?: string },
  deadline = Date.now() + 100_000,
): Promise<number> {
  if (!resolveEntitlement(user).hasAI) return 0;
  const mine: string[] = [];
  try {
    let q = sb.from("outfits").select(`id, date, notes, outfit_items(garments(${GARMENT_COLS}))`).eq("user_id", user.id);
    if (filter.ids) q = q.in("id", filter.ids);
    if (filter.dates) q = q.in("date", filter.dates);
    if (filter.from) q = q.gte("date", filter.from);
    if (filter.to) q = q.lte("date", filter.to);
    const { data, error } = await q;
    if (error) return 0;
    const queue = ((data ?? []) as unknown as Row[]).filter(o => !hasCalendarAnalysis(o.notes) && !inProgress.has(o.id));
    for (const o of queue) { inProgress.add(o.id); mine.push(o.id); }
    let done = 0;
    let stop = false;

    const worker = async () => {
      for (let o = queue.shift(); o && !stop && Date.now() < deadline; o = queue.shift()) {
        const items = o.outfit_items.map(oi => oi.garments).filter((g): g is GarmentForScoring => !!g);
        if (!items.length) continue;
        const notes = parseNotes(o.notes);
        const styleScore = typeof notes.styleScore === "number" ? notes.styleScore : scoreOutfit(items);
        const configName = typeof notes.configName === "string" ? notes.configName : "outfit";
        try {
          const analysis = await analyzeOutfit(items, { score: styleScore, configName, aesthetic: deriveOutfitAesthetic(items) }, user);
          // Only write if the outfit wasn't changed meanwhile (same notes as when read).
          let upd = sb.from("outfits")
            .update({ notes: JSON.stringify({ ...notes, styleScore, ...analysis }) })
            .eq("id", o.id).eq("user_id", user.id);
          upd = o.notes === null ? upd.is("notes", null) : upd.eq("notes", o.notes);
          const { data: saved } = await upd.select("id");
          if (saved?.length) done++;
        } catch (e) {
          if (e instanceof AiNotAllowedError) stop = true; // monthly budget used up
          else console.error("[calendarAnalysis]", o.id, e instanceof Error ? e.message : e);
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return done;
  } finally {
    for (const id of mine) inProgress.delete(id);
  }
}
