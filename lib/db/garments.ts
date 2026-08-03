import { supabase } from "@/lib/supabase";

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
