// AI-analyzes one EXISTING garment row — the work behind "Use score?" (lib/analysisJobs.ts) and
// Pro's catch-up analysis after upgrading. Same inference + field mapping as /api/garments/reanalyze:
// vision when the item has an image, text-only otherwise. Returns the column updates to write,
// or null if the model produced nothing usable. Never overwrites a user's own manual aesthetic.
import { inferGarmentAttributes, inferGarmentAttributesTextOnly } from "@/lib/aiInference";
import type { AiActor, AiCallOpts } from "@/lib/aiGateway";

export type GarmentRowForAnalysis = {
  id: string; title: string; brand: string | null; category: string | null; sub_type: string | null;
  material: string | null; color_primary: string | null; color_secondary: string | null;
  fit: string | null; formality: string | null; image: string | null; aesthetic_source?: string | null;
};

const FIELDS = ["aesthetic_tags", "pros", "cons", "color_pairings", "color_clashes", "formality", "pattern"];

export async function aiAnalyzeGarmentRow(
  g: GarmentRowForAnalysis,
  billingUser: AiActor,
  ai: AiCallOpts = {},
): Promise<Record<string, unknown> | null> {
  const values = g.image
    ? (await inferGarmentAttributes({
        title: g.title, category: g.category ?? "top", subType: g.sub_type ?? null, brand: g.brand ?? null,
        colorPrimary: g.color_primary ?? null, colorSecondary: g.color_secondary ?? null,
        fit: g.fit ?? null, material: g.material ?? null, image: g.image,
      }, FIELDS, billingUser, ai)).values
    : (await inferGarmentAttributesTextOnly({
        title: g.title, category: g.category ?? "top", subType: g.sub_type ?? null, brand: g.brand ?? null,
        colorPrimary: g.color_primary ?? null, material: g.material ?? null, formality: g.formality ?? null,
      }, billingUser, ai)).values;

  // The model must actually have answered: no pros AND no cons field at all means an empty or
  // malformed reply — return null so nothing is saved (and a purchased analysis isn't charged).
  if (!Array.isArray(values.pros) && !Array.isArray(values.cons)) return null;

  const updates: Record<string, unknown> = {};
  if (values.aesthetic_tags && g.aesthetic_source !== "manual") { updates.aesthetic_tags = values.aesthetic_tags; updates.aesthetic_source = "ai"; }
  // Arrays even when empty — null means "not analyzed yet" everywhere in the clients.
  updates.pros = (values.pros as string[] | undefined) ?? [];
  updates.cons = (values.cons as string[] | undefined) ?? [];
  if (values.color_pairings) updates.color_pairings = values.color_pairings;
  if (values.color_clashes)  updates.color_clashes  = values.color_clashes;
  if (values.formality)      updates.formality      = values.formality;
  if (values.pattern)        updates.pattern        = values.pattern;
  return updates;
}
