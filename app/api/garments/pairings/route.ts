import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { getSlot } from "@/lib/outfitRules";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type GarmentRow = {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  sub_type: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  formality: string | null;
  aesthetic_tags: string[] | null;
};

// Slot families used to enforce cross-category pairing
const SLOT_FAMILIES: Record<string, string[]> = {
  top:      ["base-top", "overshirt", "mid-layer", "vest", "outer"],
  bottom:   ["pants", "shorts", "skirt"],
  fullbody: ["dress", "jumpsuit", "overalls"],
  foot:     ["shoes", "sandals"],
  acc:      ["hat", "eyewear", "neckwear", "wristwear", "rings", "bag", "belt", "socks", "other-acc"],
};

function getFamily(slot: string): string {
  for (const [family, slots] of Object.entries(SLOT_FAMILIES)) {
    if (slots.includes(slot)) return family;
  }
  return "other";
}

// GET /api/garments/pairings?id=GARMENT_ID
// Computes fresh style_pairings for one garment against the current wardrobe,
// saves the result back to DB, and returns it.
export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: allGarments, error: fetchErr } = await adminClient
    .from("garments")
    .select("id, title, brand, category, sub_type, color_primary, color_secondary, formality, aesthetic_tags")
    .eq("user_id", session.userId);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const garments = (allGarments ?? []) as GarmentRow[];
  const target = garments.find(g => g.id === id);
  if (!target) return NextResponse.json({ error: "Garment not found" }, { status: 404 });

  const targetSlot   = getSlot(target);
  const targetFamily = getFamily(targetSlot);

  // Only send garments from different slot families (can't pair top+top, shoe+shoe, etc.)
  const candidates = garments.filter(g => {
    if (g.id === id) return false;
    const family = getFamily(getSlot(g));
    // Accessories can pair with everything except other accessories
    if (targetFamily === "acc" && family === "acc") return false;
    if (targetFamily !== "acc" && family === targetFamily) return false;
    // Full-body items cover both top+bottom, so they pair with foot/acc only
    if (targetFamily === "fullbody" && (family === "top" || family === "bottom")) return false;
    if (family === "fullbody" && (targetFamily === "top" || targetFamily === "bottom")) return false;
    return true;
  });

  if (candidates.length === 0) {
    return NextResponse.json({ pairings: [] });
  }

  const targetLine = [
    `${target.brand ?? target.title}`,
    target.sub_type ?? target.category,
    target.color_primary && `color: ${target.color_primary}`,
    target.formality && `formality: ${target.formality}`,
    target.aesthetic_tags?.length && `aesthetic: ${target.aesthetic_tags.join("/")}`,
  ].filter(Boolean).join(" | ");

  const candidateLines = candidates.map((g, i) => {
    const line = [
      `${g.brand ?? g.title}`,
      g.sub_type ?? g.category,
      g.color_primary && `color: ${g.color_primary}`,
      g.formality && `formality: ${g.formality}`,
      g.aesthetic_tags?.length && `aesthetic: ${g.aesthetic_tags.join("/")}`,
    ].filter(Boolean).join(" | ");
    return `${i + 1}. ${line}`;
  }).join("\n");

  const prompt =
    `You are a fashion stylist. Suggest 2–4 items from the wardrobe list that pair well with the FOCUS item.\n\n` +
    `FOCUS ITEM (slot: ${targetSlot}):\n${targetLine}\n\n` +
    `WARDROBE CANDIDATES:\n${candidateLines}\n\n` +
    `Rules:\n` +
    `• Neutral colors (black, white, grey, navy, beige, tan, olive) pair with almost anything — never say they clash\n` +
    `• A bold/graphic piece pairs best with neutrals so it remains the focal point\n` +
    `• Match formality: graphic tee stays casual, dress shirt stays smart-casual or up\n` +
    `• Classic combos always work: black + any neutral, white + anything, navy + grey, olive + tan\n` +
    `• Be generous with suggestions — if it's a reasonable real-world combination, include it\n` +
    `• Format: "Item description from the list → style label" (e.g. "Carhartt WIP jeans | pants | color: indigo blue → workwear casual")\n` +
    `• Use the EXACT text from the wardrobe list for the item description\n` +
    `• Style label: 1–3 words (streetwear, casual, smart-casual, workwear, preppy, athleisure, minimalist, etc.)\n\n` +
    `Return ONLY JSON: {"pairings": ["item text → style", ...]}`;

  let pairings: string[] = [];
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are an expert fashion stylist with deep knowledge of color theory, streetwear, and contemporary style. You give honest, practical pairing advice." },
        { role: "user", content: prompt },
      ],
      max_tokens: 400,
    });
    const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
    if (Array.isArray(raw.pairings)) {
      pairings = raw.pairings.filter((s: unknown) => typeof s === "string");
    }
  } catch (e) {
    console.error("Pairings AI call failed:", e);
    return NextResponse.json({ pairings: [] });
  }

  // Persist fresh pairings back to DB so the closet page has them next time
  try {
    await adminClient.from("garments").update({ style_pairings: pairings }).eq("id", id);
  } catch { /* non-critical — column may not exist yet */ }

  return NextResponse.json({ pairings });
}
