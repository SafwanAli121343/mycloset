import { createClient } from "@supabase/supabase-js";

// Service-role client: garment rows are per-user data behind app-level session checks in
// app/api/garments/route.ts (POST/DELETE/PATCH), not Supabase Auth — RLS policies keyed on
// auth.uid() can never match here, so this table is locked to service-role-only access
// (see supabase/lock_tables_to_service_role.sql) and the anon key can no longer read/write it.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type Garment = {
  id: string;
  title: string;
  price: string;
  source: string;
  link: string;
  image: string;
  user_id: string;
  category: string;
  brand: string | null;
  sub_type: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  fit: string | null;
  pattern: string | null;
  design_complexity: number | null;
  logo_prominence: number | null;
  material: string | null;
  aesthetic_tags: string[] | null;
  // Distinguishes a user's own AestheticPicker choice from an AI guess — both free and paid
  // users can set aesthetic_tags themselves (see app/api/garments/route.ts's manual-add branch),
  // so AI_GATED_FIELDS stripping it for a free/lapsed user must not also erase a manual pick.
  // null for garments predating this column, or for anything never explicitly tagged either way.
  aesthetic_source: "manual" | "ai" | null;
  formality: string | null;
  pros: string[] | null;
  cons: string[] | null;
  color_pairings: string[] | null;
  color_clashes: string[] | null;
  style_pairings: string[] | null;
  tags: Record<string, string[]> | null;
  confidence: Record<string, string>;
  measurements: Record<string, number>;
  created_at: string;
};

export type NewGarment = Pick<
  Garment,
  "title" | "price" | "source" | "link" | "image" | "user_id" | "category"
> &
  Partial<
    Pick<
      Garment,
      | "brand"
      | "sub_type"
      | "color_primary"
      | "color_secondary"
      | "fit"
      | "pattern"
      | "material"
      | "design_complexity"
      | "logo_prominence"
      | "aesthetic_tags"
      | "aesthetic_source"
      | "formality"
      | "pros"
      | "cons"
      | "color_pairings"
      | "color_clashes"
      | "style_pairings"
      | "tags"
      | "confidence"
    >
  >;


export async function insertGarment(garment: NewGarment): Promise<Garment> {
  const { data, error } = await supabase.from("garments").insert([garment]).select();
  if (error) throw new Error(error.message);
  return data[0];
}

export async function getGarmentsByUser(userId: string): Promise<Garment[]> {
  const { data, error } = await supabase
    .from("garments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteGarment(id: string): Promise<void> {
  const { error } = await supabase.from("garments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateGarment(id: string, updates: Partial<Garment>): Promise<Garment> {
  const { data, error } = await supabase.from("garments").update(updates).eq("id", id).select();
  if (error) throw new Error(error.message);
  return data[0];
}
