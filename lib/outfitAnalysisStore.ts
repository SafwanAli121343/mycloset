// Stored AI analyses for the Outfits page (outfit_analyses). Pro only: an outfit's score and its
// analysis are shown together, and an outfit is only analyzed when it's actually going to be
// seen — the first screenful and the first "Show more" (analyzed up front), or a later outfit
// when it's opened. Each row carries a hash of everything the analysis was based on (every
// piece's details, the score, the user's profile), so editing a piece makes it stale rather than
// showing an analysis of the old version. The AI calls themselves also go through the shared
// response cache (lib/aiGateway.ts), so re-analyzing an unchanged outfit costs nothing.
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { generateAndRankAllOutfits } from "@/lib/wardrobeOutfitGen";
import { analyzeOutfit, deriveOutfitAesthetic, type OutfitAnalysisResult } from "@/lib/outfitInference";
import { getUserProfile, type UserProfile } from "@/lib/userAge";
import { AiNotAllowedError } from "@/lib/aiGateway";
import type { GarmentForScoring } from "@/lib/scoring";
import type { User } from "@/lib/db/users";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Same columns and ranking as GET /api/outfits/all-combos, so "the first outfits" here are
// exactly the first outfits on the page.
export const COMBO_GARMENT_COLS =
  "id, title, brand, category, sub_type, material, color_primary, color_secondary, " +
  "pattern, formality, aesthetic_tags, aesthetic_source, pros, cons, color_pairings, color_clashes, tags, image";
export const COMBO_MAX = 2000;
// Outfits below this show no score or analysis anywhere (matches both clients).
export const IDEAL_THRESHOLD = 75;
// How many top outfits Pro's catch-up analyzes ahead of time (≈ the first screenful).
const PREWARM_COUNT = 18;
const MAX_PARALLEL = 4;

export type ComboEntry = { key: string; items: GarmentForScoring[]; score: number };

export function comboKey(ids: string[]): string {
  return [...new Set(ids)].sort().join("|");
}

function inputHash(items: GarmentForScoring[], score: number, profile: UserProfile): string {
  const pieces = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return crypto.createHash("sha256").update(JSON.stringify({ v: 1, pieces, score, profile })).digest("hex");
}

export async function rankUserOutfits(userId: string): Promise<{ garments: GarmentForScoring[]; ranked: ReturnType<typeof generateAndRankAllOutfits> }> {
  const { data, error } = await sb.from("garments").select(COMBO_GARMENT_COLS).eq("user_id", userId);
  if (error) throw new Error("couldn't load garments");
  const garments = (data ?? []) as unknown as GarmentForScoring[];
  return { garments, ranked: garments.length ? generateAndRankAllOutfits(garments, { maxTotal: COMBO_MAX }) : [] };
}

// Stored analyses that still match their outfit exactly.
export async function getValidAnalyses(userId: string, entries: ComboEntry[], profile?: UserProfile): Promise<Map<string, OutfitAnalysisResult>> {
  const out = new Map<string, OutfitAnalysisResult>();
  if (!entries.length) return out;
  const p = profile ?? await getUserProfile(userId);
  const { data } = await sb.from("outfit_analyses").select("combo_key, input_hash, result").eq("user_id", userId);
  const rows = new Map((data ?? []).map(r => [r.combo_key as string, r as { input_hash: string; result: OutfitAnalysisResult }]));
  for (const e of entries) {
    const row = rows.get(e.key);
    if (row && row.input_hash === inputHash(e.items, e.score, p)) out.set(e.key, row.result);
  }
  return out;
}

// Analyzes (or reuses) each entry. Stops early — returning what it has — once the Pro budget is
// used up, reporting `capReached` so the client can say so.
export async function analyzeCombos(
  user: User, entries: ComboEntry[], deadline = Infinity,
): Promise<{ results: Map<string, OutfitAnalysisResult>; failed: string[]; capReached: boolean }> {
  const profile = await getUserProfile(user.id);
  const results = await getValidAnalyses(user.id, entries, profile);
  const queue = entries.filter(e => !results.has(e.key));
  const failed: string[] = [];
  let capReached = false;

  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      if (capReached || Date.now() > deadline) { failed.push(e.key); continue; }
      try {
        const result = await analyzeOutfit(e.items, { score: e.score, configName: "outfit", aesthetic: deriveOutfitAesthetic(e.items) }, user);
        await sb.from("outfit_analyses").upsert({
          user_id: user.id, combo_key: e.key, input_hash: inputHash(e.items, e.score, profile),
          result, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,combo_key" });
        results.set(e.key, result);
      } catch (err) {
        if (err instanceof AiNotAllowedError) capReached = true;
        else console.error("[outfitAnalysisStore] analysis failed:", e.key, err);
        failed.push(e.key);
      }
    }
  };
  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
  return { results, failed, capReached };
}

// Pro's catch-up: analyze the first screenful of top outfits ahead of time.
export async function analyzeTopOutfits(user: User, deadline: number): Promise<void> {
  const { ranked } = await rankUserOutfits(user.id);
  const entries: ComboEntry[] = ranked
    .filter(r => r.score >= IDEAL_THRESHOLD)
    .slice(0, PREWARM_COUNT)
    .map(r => ({ key: comboKey(r.items.map(i => i.id)), items: r.items, score: r.score }));
  const { capReached } = await analyzeCombos(user, entries, deadline);
  if (capReached) throw new AiNotAllowedError("cap_reached");
}
