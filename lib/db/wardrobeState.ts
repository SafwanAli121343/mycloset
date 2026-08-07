import type { SupabaseClient } from "@supabase/supabase-js";
import { computeGapProgress, getFunctionalSlot, type CrossedEntry } from "@/lib/wardrobeAnalysis";
import { sameColorGroup } from "@/lib/constants/colors";

export type GarmentIdentityFields = {
  sub_type?: string | null;
  category?: string | null;
  color_primary?: string | null;
  aesthetic_tags?: string[] | null;
};

// When a garment's crossing-relevant attributes change (color, category, sub_type, or aesthetic
// tags — via manual edit or AI reanalysis), any wardrobe-analysis crossing it earned under its
// OLD attributes may no longer be valid. Re-validates every crossing this item contributed
// against its NEW attributes and drops or updates whatever no longer holds, so the level display
// and score never keep credit for something the item doesn't actually have anymore. Cons are left
// untouched — they aren't derived from a single attribute the same deterministic way.
export async function revalidateGarmentCrossings(
  sb: SupabaseClient,
  userId: string,
  garmentId: string,
  newAttrs: GarmentIdentityFields,
): Promise<void> {
  const { data } = await sb
    .from("wardrobe_analysis_state")
    .select("crossed")
    .eq("user_id", userId)
    .single();
  if (!data) return;

  const crossed = (data.crossed as CrossedEntry[]) ?? [];
  if (!crossed.some(e => e.garmentId === garmentId)) return;

  const newColor   = newAttrs.color_primary ?? null;
  const newCat     = (newAttrs.category ?? "").toLowerCase();
  const newSubType = newAttrs.sub_type ?? null;
  const newSlot    = getFunctionalSlot(newSubType);
  const newAesNorm = new Set((newAttrs.aesthetic_tags ?? []).map(t => t.toLowerCase().replace(/[^a-z0-9]/g, "")));

  const updated: CrossedEntry[] = [];
  for (const e of crossed) {
    if (e.garmentId !== garmentId) { updated.push(e); continue; }
    if (e.category === "color") {
      if (newColor && sameColorGroup(newColor, e.key)) updated.push(e);
      continue;
    }
    if (e.category === "aesthetic") {
      const nk = e.key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (newAesNorm.has(nk)) updated.push(e);
      continue;
    }
    if (e.category === "gap") {
      const progress = computeGapProgress(e.key, newSubType, newCat, newSlot);
      if (progress > 0) updated.push({ ...e, progress });
      continue;
    }
    updated.push(e); // cons pass through unchanged
  }

  await sb.from("wardrobe_analysis_state").update({
    crossed:    updated,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
}
