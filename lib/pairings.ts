// "Pairs With" for one garment against the rest of the user's wardrobe — shared by
// GET /api/garments/pairings (Pro, refreshed on view) and the "Use score?" job
// (lib/analysisJobs.ts), which computes an unlocked item's AI pairings once.
import { createClient } from "@supabase/supabase-js";
import { getUserProfile, profileSystemMessage } from "@/lib/userAge";
import { getSlot } from "@/lib/outfitRules";
import { colorsPairWell } from "@/lib/colorTheory";
import { aiChat, type AiActor, type AiCallOpts } from "@/lib/aiGateway";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type GarmentRow = {
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

export type PairingsResult = { pairings: string[] } | { error: string; status: number };

// actor = null → the free, deterministic version (no AI). `persist` saves the result to
// garments.style_pairings. Throws only if the AI call fails (callers decide what that means).
export async function computePairings(
  userId: string, id: string, actor: AiActor | null, opts: { persist?: boolean; ai?: AiCallOpts } = {},
): Promise<PairingsResult> {
  const { data: allGarments, error: fetchErr } = await adminClient
    .from("garments")
    .select("id, title, brand, category, sub_type, color_primary, color_secondary, formality, aesthetic_tags")
    .eq("user_id", userId);

  if (fetchErr) return { error: "Something went wrong.", status: 500 };

  const garments = (allGarments ?? []) as GarmentRow[];
  const target = garments.find(g => g.id === id);
  if (!target) return { error: "Garment not found", status: 404 };

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
    return { pairings: [] };
  }

  if (!actor) {
    // Free tier: no OpenAI call. colorsPairWell is the same deterministic rule table the native
    // app's own free-tier preview already uses (native/lib/colorTheory.ts) — same-family or a
    // curated classic pair, neutrals always pass. A shared aesthetic tag (settable manually via
    // the Add Item aesthetic picker even without AI, or AI-derived for a Pro/credit item) is the
    // other signal a real stylist would use; either one alone is enough to surface a candidate,
    // matching how generous the "goes with" bar should be without formality/context nuance to
    // lean on. Less precise than the AI version (no "why", no formality weighing), but real and
    // free rather than an empty list.
    const pairings = candidates
      .filter(g =>
        colorsPairWell(target.color_primary, g.color_primary) ||
        (target.aesthetic_tags?.some(t => g.aesthetic_tags?.includes(t)) ?? false)
      )
      .slice(0, 6)
      .map(g => {
        const sharedAesthetic = target.aesthetic_tags?.find(t => g.aesthetic_tags?.includes(t));
        return `${g.brand ?? g.title} → ${sharedAesthetic ?? "color match"}`;
      });
    if (opts.persist) {
      try {
        await adminClient.from("garments").update({ style_pairings: pairings }).eq("id", id);
      } catch { /* non-critical — column may not exist yet */ }
    }
    return { pairings };
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
    `You are a fashion stylist. Suggest items from the wardrobe list that pair well with the FOCUS item.\n\n` +
    `FOCUS ITEM (slot: ${targetSlot}):\n${targetLine}\n\n` +
    `WARDROBE CANDIDATES:\n${candidateLines}\n\n` +
    `A pairing must work on COLOR AND AESTHETIC/STYLE together — color compatibility alone is never enough on its own:\n` +
    `• Neutral colors (black, white, grey, navy, beige, tan, olive) rarely clash on COLOR grounds, but a color match does not override an aesthetic or formality mismatch. A neutral-colored item styled for a completely different register (e.g. a tailored quiet-luxury piece vs. a loud skate/grunge piece, or technical gorpcore vs. business formal) is still a bad pairing even when the colors are both neutral.\n` +
    `• Weigh the aesthetic tags on both items. Favor pairings that share at least one aesthetic tag, or are a well-established real-world cross-aesthetic combination (e.g. a plain tee under a tailored jacket) — not just "nothing technically clashes."\n` +
    `• Match formality: a graphic tee stays casual, a dress shirt stays smart-casual or up. A real formality gap (formal piece + purely athletic piece) excludes the pairing even if the colors work.\n` +
    `• A bold/graphic piece pairs best with neutrals so it remains the focal point.\n` +
    `• Be selective, not generous. Only include a pairing a knowledgeable stylist would confidently put together and actually recommend — not every combination that merely fails to clash. It is correct and expected for some items (an aesthetic outlier relative to the rest of the wardrobe, or a very specific/formal piece) to have few or even zero strong pairings — do not pad the list to hit a target count.\n` +
    `• Format: "Item description from the list → style label" (e.g. "Carhartt WIP jeans | pants | color: indigo blue → workwear casual")\n` +
    `• Use the EXACT text from the wardrobe list for the item description\n` +
    `• Style label: 1–3 words (streetwear, casual, smart-casual, workwear, preppy, athleisure, minimalist, etc.)\n\n` +
    `Return ONLY JSON: {"pairings": ["item text → style", ...]} — 0 to 6 items, however many genuinely earn a place, not a fixed count.`;

  let pairings: string[] = [];
  {
    // The user's age + gender (Settings → GENDER & AGE) tailor the analysis — lib/userAge.ts.
    const userProfile = await getUserProfile(userId);
    const completion = await aiChat("openai:chat:pairings", {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [...profileSystemMessage(userProfile), 
        { role: "system", content: "You are an expert fashion stylist with deep knowledge of color theory, streetwear, and contemporary style. You give honest, practical pairing advice." },
        { role: "user", content: prompt },
      ],
      max_tokens: 400,
    }, actor, opts.ai);
    const raw = JSON.parse(completion.content ?? "{}");
    if (Array.isArray(raw.pairings)) {
      pairings = raw.pairings.filter((s: unknown) => typeof s === "string");
    }
  }

  // Persist fresh pairings back to DB so the closet page has them next time
  if (opts.persist) {
    try {
      await adminClient.from("garments").update({ style_pairings: pairings }).eq("id", id);
    } catch { /* non-critical — column may not exist yet */ }
  }

  return { pairings };
}
