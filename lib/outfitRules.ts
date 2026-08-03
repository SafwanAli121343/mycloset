// Comprehensive slot taxonomy and outfit validation.
// Slots encode the PHYSICAL role of each garment — what body part it covers,
// how it layers, and what other slots it conflicts with.
// All GPT prompts that build or validate outfits should import OUTFIT_SLOT_PROMPT.

// ── Slot taxonomy ────────────────────────────────────────────────────────────

export type SlotKey =
  // Upper body — single-layer items worn against skin
  | "base-top"     // t-shirt, tank, polo, henley, crop, muscle tee, long-sleeve tee, turtleneck, camisole, tube top, rugby
  // Upper body — button-up dual-use (standalone top OR open layer over a base-top)
  | "overshirt"    // flannel, denim/chambray shirt, OCBD, camp/Cuban collar, Hawaiian, linen shirt, work shirt, western, poplin, dress shirt (casual wear)
  // Upper body — pullover layer (can be sole top or over any thinner layer)
  | "mid-layer"    // hoodie, crewneck, sweater, cardigan, zip-up, fleece, quarter-zip, half-zip, thermal, waffle knit, knit top
  // Upper body — torso-only piece, always needs a sleeved item beneath
  | "vest"         // knit vest, puffer vest, fleece vest, waistcoat, down vest
  // Upper body — full outerwear, always needs a top underneath
  | "outer"        // bomber, harrington, varsity, letterman, trucker/denim jacket, moto/leather jacket, track jacket, chore coat, field jacket, M-65, coach jacket, blazer, sport coat, suit jacket, windbreaker, anorak, trench, parka, puffer/down coat, peacoat, overcoat, raincoat, duffle coat, shearling/sherpa coat
  // Lower body
  | "pants"        // jeans (all cuts), chinos, trousers, dress pants, joggers, sweatpants, cargo pants, track pants, linen pants, corduroy, leather pants, wide-leg
  | "shorts"       // athletic/gym/basketball shorts, cargo shorts, chino shorts, denim/cutoff shorts, swim/board shorts, dress shorts
  | "skirt"        // mini, midi, maxi, pleated, wrap, tennis, A-line, kilt
  // Full-body (covers both top and bottom needs)
  | "dress"        // sundress, shirt dress, wrap dress, slip dress, bodycon, mini/midi/maxi dress, gown
  | "jumpsuit"     // jumpsuit, romper, playsuit, boilersuit, coverall
  | "overalls"     // overalls, dungarees, bib overalls (bottom covered; shirt optional underneath)
  // Footwear — mutually exclusive
  | "shoes"        // sneakers (low/high), running shoes, basketball shoes, boots (Chelsea, chukka, combat, work, cowboy), loafers, dress shoes (Oxford, Derby, Brogue), monk strap, boat shoes, slip-ons
  | "sandals"      // sandals (gladiator, strappy), slides, pool slides, Birkenstocks, flip-flops, sport sandals (Teva), open-toe mules, Crocs
  // Accessories — all optional, most allow multiples
  | "hat"          // cap, baseball cap, snapback, dad hat, trucker hat, beanie, bucket hat, beret, fedora, cowboy hat, visor, newsboy, fisherman hat
  | "eyewear"      // sunglasses, glasses, frames
  | "neckwear"     // chain, necklace, pendant, choker, scarf, bandana, tie, bow tie, bolo tie
  | "wristwear"    // watch, bracelet, bangle, cuff
  | "rings"        // ring, signet ring, band
  | "bag"          // backpack, tote, crossbody, shoulder bag, duffle, messenger, briefcase, fanny pack, belt bag, clutch, satchel
  | "belt"         // belt, suspenders
  | "socks"        // visible socks used as a style choice
  | "other-acc"    // gloves, pocket square, pin/brooch, hair accessory
  | "unknown";

// ── Data-driven slot detection ────────────────────────────────────────────────
// Rules are checked in priority order — first match wins.
// For each rule: keywords are checked against (sub_type + title) lowercased.
// If `categories` is set, the garment's category must also match.

interface SlotRule {
  slot: SlotKey;
  keywords: string[];
  categories?: string[];
}

const SLOT_RULES: SlotRule[] = [
  // ── Vest — checked FIRST so "Vest" with outerwear category doesn't become "outer"
  { slot: "vest", keywords: [
    "vest", "gilet", "puffer vest", "knit vest", "fleece vest",
    "down vest", "waistcoat",
  ]},

  // ── Base-top early catch — must come BEFORE overshirt so "t-shirt", "polo shirt",
  //    "rugby shirt" etc. don't match overshirt's broad "shirt" keyword (the boundary
  //    regex treats the hyphen in "t-shirt" as a word boundary, making "shirt" match).
  //    Restricted to category "top" so button-ups in "top" category aren't caught.
  { slot: "base-top", categories: ["top"], keywords: [
    "t-shirt", "tee", "polo", "tank", "henley", "crop top",
    "longsleeve", "long sleeve", "long-sleeve", "rugby", "jersey",
    "muscle tee", "graphic tee", "v-neck", "camisole", "tube top",
  ]},

  // ── Mid-layer — checked BEFORE outer category rule so hoodies/sweaters with
  //    outerwear category don't get misclassified as jackets
  { slot: "mid-layer", keywords: [
    "hoodie", "sweatshirt", "crewneck", "sweater", "cardigan",
    "zip-up", "fleece", "pullover", "quarter-zip", "half-zip",
    "mock neck", "turtleneck", "roll neck", "thermal",
    "waffle knit", "knit sweater", "knit top", "jumper",
  ]},

  // ── Overshirt — checked before base-top to intercept dress shirts, flannels, etc.
  //    Also before outer so "flannel" doesn't accidentally match outer keywords
  { slot: "overshirt", keywords: [
    "flannel", "overshirt", "shacket", "shirt jacket",
    "denim shirt", "chambray", "camp collar", "cuban collar",
    "hawaiian shirt", "aloha shirt", "western shirt",
    "linen shirt", "work shirt", "oxford shirt", "ocbd",
    "dress shirt", "poplin shirt", "seersucker shirt",
    "button-down shirt", "button-up shirt", "shirt",
  ]},

  // ── Outer — specific keywords first, then category fallback.
  //    "denim jacket" / "trucker jacket" must be listed here explicitly so they
  //    don't accidentally match the "denim shirt" overshirt keyword.
  { slot: "outer", keywords: [
    "jacket", "coat", "blazer", "windbreaker", "bomber", "harrington",
    "anorak", "trench", "parka", "peacoat", "overcoat", "raincoat",
    "duffle coat", "shearling", "sherpa jacket", "car coat", "chore coat",
    "field jacket", "military jacket", "track jacket", "varsity jacket",
    "letterman", "moto jacket", "leather jacket", "denim jacket",
    "trucker jacket", "coach jacket", "puffer jacket", "puffer coat",
    "down jacket", "down coat",
  ]},
  // Category fallback for outerwear — catches any remaining outerwear items
  // whose sub_type didn't match any keyword above (e.g. a future sub_type we haven't listed)
  { slot: "outer", categories: ["outerwear"], keywords: [] },

  // ── Full-body: dress
  { slot: "dress", keywords: [
    "dress", "sundress", "shirt dress", "wrap dress", "slip dress",
    "bodycon dress", "mini dress", "midi dress", "maxi dress", "gown",
  ]},

  // ── Full-body: jumpsuit / romper
  { slot: "jumpsuit", keywords: [
    "jumpsuit", "romper", "playsuit", "boilersuit", "coverall",
  ]},

  // ── Overalls
  { slot: "overalls", keywords: [
    "overalls", "dungarees", "bib overall",
  ]},

  // ── Skirt
  { slot: "skirt", keywords: [
    "skirt", "mini skirt", "midi skirt", "maxi skirt",
    "pleated skirt", "wrap skirt", "tennis skirt", "a-line", "kilt",
  ]},

  // ── Shorts (before pants so "cargo shorts" doesn't match "cargo" in pants)
  { slot: "shorts", keywords: [
    "shorts", "short",
    "athletic short", "gym short", "basketball short",
    "swim short", "board short", "surf short",
    "denim short", "cutoff", "cargo short",
    "chino short", "khaki short", "dress short",
  ]},

  // ── Pants (category fallback catches most bottoms; keywords add edge cases)
  { slot: "pants", categories: ["bottom"], keywords: [
    "jean", "jeans", "pant", "pants", "trouser", "chino", "khaki",
    "jogger", "cargo pant", "sweatpant", "slack", "legging",
    "corduroy", "linen pant", "dress pant", "track pant",
    "leather pant", "wide leg", "baggy", "straight leg", "slim",
    "skinny", "flare", "bootcut",
  ]},

  // ── Open footwear (before closed to intercept "clog", "slipper", etc.)
  { slot: "sandals", keywords: [
    "sandal", "slide", "birkenstock", "flip flop", "thong sandal",
    "slipper", "clog", "teva", "sport sandal", "pool slide",
    "open toe", "croc",
  ]},

  // ── Closed footwear (category fallback)
  { slot: "shoes", categories: ["footwear"], keywords: [
    "sneaker", "boot", "shoe", "loafer", "oxford",
    "derby", "brogue", "monk strap", "boat shoe", "espadrille",
    "jordan", "dunk", "air force", "yeezy", "timberland",
    "vans", "converse", "new balance", "adidas",
    "chelsea boot", "chukka", "combat boot", "work boot",
    "cowboy boot", "dress shoe", "mule", "slip-on",
  ]},

  // ── Accessories
  { slot: "hat",       keywords: ["cap", "beanie", "bucket hat", "beret", "snapback", "trucker hat", "dad hat", "visor", "fedora", "cowboy hat", "newsboy", "fisherman hat", "hat"] },
  { slot: "eyewear",   keywords: ["glasses", "sunglasses", "sunglass", "shades", "specs", "frames", "eyewear", "sunnies"] },
  { slot: "neckwear",  keywords: ["chain", "necklace", "pendant", "choker", "scarf", "bandana", "tie", "bow tie", "bolo tie", "kerchief"] },
  { slot: "wristwear", keywords: ["watch", "bracelet", "bangle", "cuff"] },
  { slot: "rings",     keywords: ["ring", "signet", "band"] },
  { slot: "bag",       keywords: ["backpack", "bag", "tote", "crossbody", "shoulder bag", "duffle", "messenger", "briefcase", "fanny pack", "belt bag", "clutch", "satchel", "purse"] },
  { slot: "belt",      keywords: ["belt", "suspender"] },
  { slot: "socks",     keywords: ["sock", "no-show", "ankle sock", "crew sock"] },
  { slot: "other-acc", keywords: ["gloves", "pocket square", "brooch", "pin", "hair clip"] },

  // ── Base top — last; catches all remaining "top" category items
  { slot: "base-top", categories: ["top"], keywords: [
    "t-shirt", "tee", "polo", "tank", "crop top", "henley",
    "longsleeve", "long sleeve", "long-sleeve", "rugby",
    "jersey", "muscle tee", "graphic tee", "v-neck",
    "crew neck", "camisole", "tube top",
  ]},
];

// ── Public slot function ──────────────────────────────────────────────────────

export type GarmentForSlot = {
  category: string | null;
  sub_type:  string | null;
  title?:    string | null;
};

// Plain text.includes(kw) lets short keywords match inside unrelated words —
// e.g. "vest" inside the brand name "Novesta", or "tie" inside "tiered".
// Require a boundary on both sides, but allow a trailing "s" so plurals
// ("sneaker" -> "sneakers", "boot" -> "boots") still match.
function matchesKeyword(text: string, kw: string): boolean {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped}s?(?:[^a-z0-9]|$)`, "i");
  return re.test(text);
}

export function getSlot(g: GarmentForSlot): SlotKey {
  const cat  = (g.category ?? "").toLowerCase();
  const st   = (g.sub_type ?? "").toLowerCase();
  const ttl  = (g.title    ?? "").toLowerCase();
  const text = `${st} ${ttl}`.trim();

  for (const rule of SLOT_RULES) {
    // Category-only rule (no keywords)
    if (rule.keywords.length === 0 && rule.categories?.length) {
      if (rule.categories.includes(cat)) return rule.slot;
      continue;
    }
    // Category restriction check
    if (rule.categories?.length && !rule.categories.includes(cat)) continue;
    // Keyword match
    if (rule.keywords.some(kw => matchesKeyword(text, kw))) return rule.slot;
  }

  return "unknown";
}

// ── Slot groupings ────────────────────────────────────────────────────────────

const TOP_SLOTS      = new Set<SlotKey>(["base-top", "overshirt", "mid-layer"]);
const BOTTOM_SLOTS   = new Set<SlotKey>(["pants", "shorts", "skirt"]);
const FOOT_SLOTS     = new Set<SlotKey>(["shoes", "sandals"]);
const FULLBODY_SLOTS = new Set<SlotKey>(["dress", "jumpsuit"]);

// These slots should not appear more than once in an outfit
const EXCLUSIVE_SLOTS = new Set<SlotKey>([
  "base-top", "overshirt", "mid-layer", "vest", "outer",
  "pants", "shorts", "skirt", "dress", "jumpsuit", "overalls",
  "shoes", "sandals",
]);

// ── Validation ────────────────────────────────────────────────────────────────

export interface OutfitValidation {
  valid: boolean;
  hardError?: string;
  warnings: string[];
}

export function validateOutfit(slots: SlotKey[], tempF?: number): OutfitValidation {
  const warnings: string[] = [];
  const counts = new Map<SlotKey, number>();
  for (const s of slots) counts.set(s, (counts.get(s) ?? 0) + 1);
  const has   = (s: SlotKey) => (counts.get(s) ?? 0) > 0;
  const count = (s: SlotKey) =>  counts.get(s) ?? 0;

  // ── Hard rules (physically impossible) ──────────────────────────────────

  for (const slot of EXCLUSIVE_SLOTS) {
    if (count(slot) > 1)
      return { valid: false, hardError: `cannot wear two ${slot} items simultaneously`, warnings };
  }

  if (has("shoes") && has("sandals"))
    return { valid: false, hardError: "cannot wear closed shoes and sandals simultaneously", warnings };

  if (has("dress") && has("jumpsuit"))
    return { valid: false, hardError: "cannot wear a dress and jumpsuit simultaneously", warnings };

  if (has("overalls") && (has("pants") || has("shorts") || has("skirt")))
    return { valid: false, hardError: "overalls already cover the lower body — no separate bottom", warnings };

  // Outer needs a sleeved top underneath — a bare chest under a jacket is not an outfit
  if (has("outer") && !has("base-top") && !has("overshirt") && !has("mid-layer"))
    return { valid: false, hardError: "outer layer (jacket/coat/blazer) needs a shirt or hoodie underneath", warnings };

  // Vest needs a sleeved item underneath
  if (has("vest") && !has("base-top") && !has("overshirt") && !has("mid-layer"))
    return { valid: false, hardError: "vest needs a shirt, hoodie, or sweater underneath", warnings };

  // ── Required slots ───────────────────────────────────────────────────────

  const hasFullBody = [...FULLBODY_SLOTS].some(s => has(s));
  const hasAnyTop   = hasFullBody || has("overalls")
    || [...TOP_SLOTS].some(s => has(s))
    || has("vest");     // vest alone can count when validated above already confirmed sleeved item
  const hasAnyBottom = hasFullBody || has("overalls") || [...BOTTOM_SLOTS].some(s => has(s));
  const hasAnyFoot   = [...FOOT_SLOTS].some(s => has(s));

  if (!hasAnyTop)    return { valid: false, hardError: "outfit has no top", warnings };
  if (!hasAnyBottom) return { valid: false, hardError: "outfit has no bottom", warnings };
  if (!hasAnyFoot)   return { valid: false, hardError: "outfit has no footwear", warnings };

  // ── Soft / weather warnings (don't block, but GPT should avoid these) ────

  const hot  = tempF !== undefined && tempF >= 75;
  const cold = tempF !== undefined && tempF < 50;
  const cool = tempF !== undefined && tempF < 65;
  const warm = tempF !== undefined && tempF >= 60;

  if (hot  && has("outer"))               warnings.push("jacket/coat in hot weather (75°F+) — likely too warm");
  if (hot  && has("mid-layer") && !has("outer")) warnings.push("hoodie/sweater in hot weather — likely too warm");
  if (cold && has("shorts"))              warnings.push("shorts in cold weather (below 50°F) — not appropriate");
  if (warm && has("sandals") && !has("dress") && !has("skirt"))
    warnings.push("sandals with pants in warm weather is acceptable but sandals pair best with shorts/skirts/dresses");

  // Sandals below 55°F: hard reject. 55–64°F: soft warning.
  if (tempF !== undefined && tempF < 55 && has("sandals"))
    return { valid: false, hardError: `sandals at ${tempF}°F — too cold (min 65°F for sandals)`, warnings };
  if (cool && has("sandals"))
    warnings.push("sandals below 65°F — borderline too cold; prefer closed shoes");

  // Dress/jumpsuit + bottom is unusual (dress over jeans exists but is advanced)
  if (hasFullBody && (has("pants") || has("shorts") || has("skirt")))
    warnings.push("dress/jumpsuit + separate bottom is unconventional — omit unless intentional");

  return { valid: true, warnings };
}

// ── Prompt section injected into GPT calls ────────────────────────────────────
// Paste this into any system or user prompt that asks GPT to build outfits.

export const OUTFIT_SLOT_PROMPT = `
SLOT SYSTEM — every wardrobe item is labeled with its slot in brackets.
Learn what each slot means before building outfits.

[base-top]   T-shirt, tank, polo, henley, crop top, muscle tee, long-sleeve tee,
             turtleneck (when worn alone), camisole, tube top, rugby shirt.
             Worn directly against the skin. Cannot layer over any other top.

[overshirt]  Flannel, denim shirt, chambray, OCBD, oxford shirt, dress shirt,
             camp/Cuban-collar shirt, Hawaiian/aloha shirt, western shirt,
             linen shirt, work shirt, poplin shirt, seersucker shirt.
             DUAL-USE: wear buttoned as a standalone top, OR open/closed over a [base-top].
             It is NOT a jacket — it does NOT require a shirt underneath.

[mid-layer]  Hoodie, crewneck, sweater, cardigan, zip-up, fleece, quarter-zip,
             turtleneck (as layering piece), thermal, waffle-knit top.
             FASHION RULE: ALWAYS include a [base-top] underneath. The tee collar
             visible under the hoodie neckline is what finishes the outfit. A bare
             neckline under a hoodie looks incomplete. This applies even when also
             wearing an [outer] jacket — tee → hoodie → jacket, in that order.

[vest]       Knit vest, puffer vest, fleece vest, waistcoat, down vest.
             Covers torso only — NO sleeves.
             ALWAYS needs [base-top], [overshirt], or [mid-layer] underneath.
             Cannot be the only top.

[outer]      Bomber, harrington, varsity, letterman, trucker/denim jacket,
             moto/leather jacket, track jacket, chore coat, field jacket, M-65,
             coach jacket, blazer, sport coat, suit jacket,
             windbreaker, anorak, trench coat, parka, puffer/down coat/jacket,
             peacoat, overcoat, raincoat, duffle coat, shearling/sherpa coat.
             ALWAYS needs [base-top], [overshirt], or [mid-layer] underneath.
             Cannot be the only top — a bare chest under a jacket is not a valid outfit.

[pants]      Jeans (all fits: skinny, slim, straight, wide-leg, baggy, flare),
             chinos, trousers, dress pants, joggers, sweatpants, cargo pants,
             track pants, linen pants, corduroy, leather pants.

[shorts]     Athletic/gym/basketball shorts, cargo shorts, chino/khaki shorts,
             denim/cutoff shorts, swim/board shorts, dress shorts.
             ⚠ Inappropriate below 55°F.

[skirt]      Mini, midi, maxi, pleated, wrap, tennis, A-line skirt, kilt.

[dress]      Sundress, shirt dress, wrap dress, slip dress, bodycon, mini/midi/maxi dress.
             Covers BOTH top and bottom — no separate top or bottom needed.

[jumpsuit]   Jumpsuit, romper, playsuit, boilersuit, coverall.
             Covers BOTH top and bottom — no separate top or bottom needed.

[overalls]   Overalls, dungarees. Covers the bottom; [base-top] optional underneath.

[shoes]      Low/high-top sneakers, running shoes, basketball shoes,
             Chelsea boots, chukka boots, combat boots, work boots, cowboy boots,
             loafers, oxfords, Derbys, brogues, monk straps, boat shoes, slip-ons.
             Closed-toe.

[sandals]    Sandals, slides, pool slides, Birkenstocks, flip-flops,
             Tevas, open-toe mules, Crocs.
             ⚠ ONLY appropriate at 65°F or above. Below 65°F = choose [shoes] instead.

[hat]        Cap, baseball cap, snapback, dad hat, trucker hat, beanie,
             bucket hat, beret, fedora, cowboy hat.

[eyewear]    Sunglasses, glasses.

[neckwear]   Chain, necklace, pendant, choker, scarf, tie, bow tie.

[wristwear]  Watch, bracelet, bangle, cuff.

[rings]      Ring, signet ring.

[bag]        Backpack, tote, crossbody, duffle, messenger bag, fanny pack, belt bag.

[belt]       Belt, suspenders.

[socks]      Visible socks used as a style choice.

═══════════════════════════════════════════════════════
HARD RULES — physically impossible; never break these:
═══════════════════════════════════════════════════════
✗ Two [base-top] items (polo + t-shirt is physically unwearable)
✗ Two [overshirt] items simultaneously
✗ Two [mid-layer] items simultaneously
✗ Two [pants] (two pairs of pants is impossible)
✗ Two [shorts]
✗ Two [skirt]
✗ [shoes] + [sandals] simultaneously (you only have two feet)
✗ [outer] as only top — always needs [base-top], [overshirt], or [mid-layer] underneath
✗ [vest] as only top — always needs a sleeved item underneath
✗ [dress] + [pants]/[shorts]/[skirt] (dress already covers the bottom)
✗ [jumpsuit] + [pants]/[shorts]/[skirt]
✗ [overalls] + any bottom item

═══════════════════════════════════════════════════════
REQUIRED — every outfit must satisfy all three:
═══════════════════════════════════════════════════════
1. TOP   → any of: [base-top], [overshirt], [mid-layer], [dress], [jumpsuit], [overalls]
           [vest] and [outer] do NOT satisfy this alone — they need a sleeved layer below
2. BOTTOM → any of: [pants], [shorts], [skirt], [dress], [jumpsuit], [overalls]
3. FOOT   → [shoes] OR [sandals], never both

═══════════════════════════════════════════════════════
OPTIONAL — include only when they improve the outfit:
═══════════════════════════════════════════════════════
• [overshirt] over [base-top]: flannel open over a white tee, Hawaiian shirt worn loose
• [mid-layer] over [base-top] or [overshirt]: hoodie over tee, cardigan over dress shirt
• [outer] over any top combo: jacket in cool weather or as an aesthetic layer
• [vest] over any sleeved layer: adds visual interest
• Accessories ([hat], [eyewear], [neckwear], [wristwear], [rings], [bag], [belt]):
  only if they clearly fit the outfit — do not add accessories just to fill space

═══════════════════════════════════════════════════════
ALL VALID MULTI-LAYER COMBOS (physically wearable):
═══════════════════════════════════════════════════════
2-layer tops:
  base-top + overshirt (tee + flannel open, shirt over tee)
  base-top + mid-layer (tee + hoodie, tee + sweater)
  base-top + outer     (tee + jacket)
  overshirt + outer    (dress shirt + blazer, flannel + coat)
  mid-layer + outer    (hoodie + jacket)
  base-top + vest      (tee + knit vest)
  overshirt + vest     (shirt + vest)
  mid-layer + vest     (sweater + puffer vest — layered order matters visually)

3-layer tops:
  base-top + overshirt + outer   (tee → flannel → jacket)
  base-top + mid-layer + outer   (tee → hoodie → jacket)
  base-top + overshirt + mid-layer (tee → shirt → cardigan — works when cardigan is open)
  base-top + vest + outer        (tee → vest → jacket)
  overshirt + mid-layer + outer  (shirt → hoodie → jacket)

═══════════════════════════════════════════════════════
FASHION QUALITY — outfits must look genuinely good by
real menswear consensus, not just be physically possible.
If an outfit wouldn't get a positive reaction on a
reputable style platform or in real life, don't build it.
═══════════════════════════════════════════════════════

GOLD STANDARD REFERENCE LOOKS (use these as your benchmark)
  ① Tee + hoodie/zip-up + dark straight or slim jeans + sneakers or work boots
     → Universal casual streetwear. Works every time without exception.
  ② Plain tee + straight or wide-leg jeans + chunky sneakers or Timberlands
     → Minimal streetwear. No layering needed — simplicity reads as intentional.
  ③ OCBD/polo collar visibly peeking out from under a zip hoodie
     + dark jeans + Timbs, loafers, or clean sneakers
     → Prep-streetwear crossover. The visible collar IS the look — it signals deliberateness.
     Shirt must be worn casually, not stiffly buttoned to the top.
  ④ Polo + chinos or dark trousers + clean sneakers or loafers
     → Classic smart casual. Always presentable, always clean.
  ④b Polo + dark straight or slim jeans + Timberland boots or work boots
     → Prep-heritage NYC crossover (Lo-Life aesthetic). Time-tested, widely validated.
     The polo's prep signal + boot's workwear weight = intentional, not accidental.
  ⑤ Flannel or overshirt worn open over plain tee + raw/dark jeans + boots
     → Heritage/workwear. Consistently praised across menswear communities.
  ⑥ Turtleneck or mock-neck + wide or straight trousers + clean shoes
     → Elevated minimalism. Looks polished with minimal effort.
  ⑦ Earth-tone tonal palette: tan/camel trousers + olive or brown top + boots
     → Any combination from olive/tan/brown/camel is automatically cohesive.
  ⑧ Monochromatic: all-black or all-grey with texture variation
     → Zero-risk. Smooth tee + ribbed hoodie + matte denim = depth through texture.
  ⑨ Y2K/Retro cold: turtleneck or fitted tee + puffer/bomber jacket + cargo or flare jeans + chunky boots
     → Core Y2K winter formula. The puffer IS the statement piece — let it do the work.
  ⑩ Vintage cold: heavy wool coat or thick jacket + chunky knit sweater + straight jeans + leather boots
     → Classic vintage winter. A single shirt at 40-50°F is never enough — always layer.
  ⑪ Japanese layer: oversized hoodie/jacket + wide trousers + statement outer + chunky boots
     → Harajuku layering is the style itself. Always outer + at minimum one inner layer in cold.

PROVEN CROSSOVER COMBOS (consensus-approved aesthetic mixes)
  • Streetwear + prep:        tee + hoodie + OCBD collar visible + dark jeans + Timbs or loafers
  • Streetwear + heritage:    tee + hoodie + raw/selvedge denim + Timberlands
  • Heritage + casual:        flannel open over tee + raw denim + chukka or work boot
  • Prep + smart casual:      polo + chinos + loafers or clean white leather sneakers
  • Prep + heritage (NYC):    polo + dark slim/straight jeans + Timberland boots → Lo-Life, validated

AVOID — these are widely regarded as misses:
  ✗ Mid-layer (hoodie/sweater) with nothing underneath — bare neckline looks unfinished.
     The tee collar visible under the hood is what completes a hoodie outfit.
  ✗ Dress shirt stiffly buttoned all the way to the collar under a casual hoodie — looks
     stiff and awkward. Shirt-under-hoodie requires a relaxed/casual open collar.
  ✗ Cheap baggy athletic sweatpants + any smart-casual top (polo, OCBD) — formality gap is
     too wide. Fine cotton gym sweatpants read purely as loungewear, not elevated athleisure.
     NOTE: This does NOT apply to premium/slim joggers or tapered track pants — those are
     2025-validated elevated athleisure and CAN pair with polos and smart-casual tops.
     The distinction: slim-cut, premium fabric jogger = valid. Baggy cotton athletic pant = not.
  ✗ Two COMPETING non-neutral accent colors fighting each other:
     (e.g. red graphic tee + bright blue jeans, royal blue accent tee + green jeans).
     The problem is BOTH pieces demanding attention with different hues simultaneously.
     Rule: if the tee has a strong non-neutral secondary color (royal blue, crimson, orange),
     ground it with a neutral bottom (black, charcoal, dark indigo, grey).
     HOWEVER: a tee that is predominantly neutral (mostly black/white/grey) with a graphic
     IS compatible with colored bottoms (olive jeans, rust chinos) — the neutral base is the
     anchor. And analogous colors (adjacent on wheel: olive + rust, navy + teal) work fine.
     Specific clash to avoid: a tee with blue accent + blue-wash jeans = muddy, not tonal.
  ✗ T-shirt as underlayer under a structured button-up (Oxford shirt, dress shirt, silk shirt,
     printed shirt) — reads as undershirt, not intentional layering. Block this combo entirely.
  ✗ T-shirt as underlayer under a casual overshirt (flannel, chambray, camp collar, work shirt,
     western, bowling, linen shirt, denim shirt) UNLESS the tee color passes this rule:
       ALLOWED underlayer tee colors: white, off-white, cream, ivory, light grey, heather grey,
         beige, ecru, oatmeal — these are always safe under any casual overshirt color.
       ALLOWED dark tee (black, charcoal, navy, dark grey) under a casual overshirt ONLY IF
         the overshirt is also dark (black, charcoal, dark grey, dark navy, dark burgundy,
         dark olive, dark brown) — no harsh contrast band at the neckline.
       FORBIDDEN: dark tee (black, navy, charcoal) under a light or medium or colorful
         overshirt (white, light blue, plaid, red, green, tan, grey, etc.) — the dark
         underlayer creates a harsh visible band at the collar that dominates the look.
       FORBIDDEN: graphic tee as underlayer under any overshirt — logo/print visible at
         the collar/neckline looks cluttered regardless of color.
       When in doubt about the overshirt color, use a white or light grey tee.
  ✗ Heavy flannel or thick workwear shirts worn fully buttoned at or above 78°F — too warm.
     At 78°F+: only wear flannel open over a tee (never fully buttoned alone).
     At 82°F or above: skip flannel entirely.
  ✗ Oversized/baggy top AND baggy wide-leg bottom simultaneously — pick one side to relax.
  ✗ Multiple graphic or logo-heavy pieces — one statement piece, rest neutral.
  ✗ Heavy winter boots with lightweight summer shorts (seasonal incoherence).
  ✗ Sandals with dark jeans in cool or cold weather.
  ✗ Mixing three or more aesthetics without a clear dominant one.

ELEVATED ATHLEISURE — 2025 validated high-low combinations:
  ✓ Polo (fitted or oversized) + slim/tapered joggers + clean sneakers
     → High-low works because polo is structured, joggers are clean-cut, not gym-baggy.
  ✓ Crewneck/quarter-zip + slim joggers + loafers or clean sneakers
     → Quarter-zip on its own is a current statement. Slim bottoms keep it elevated.
  ✓ Hoodie/crewneck + joggers + chunky sneakers or Timberlands
     → Streetwear athleisure. Fully valid within the casual spectrum.
  ✗ Polo + baggy cotton gym sweatpants → too much formality contrast, looks sloppy.
  ✗ Dress shirt + joggers → wrong direction on the formality ladder.
  The test: do the joggers look like gym wear or fashion wear? If gym wear, avoid mixing up.

FORMALITY COHERENCE — stay within 1–2 steps maximum:
  Very casual    → graphic tee, baggy cotton sweatpants, athletic shorts, slides
  Casual         → plain tee, jeans, chinos, hoodie, flannel, sneakers, work boots
  Smart casual   → polo, slim joggers (premium), OCBD, chinos, dark jeans, loafers, blazer
  Business casual → dress shirt, dress trousers, blazer, Oxford/Derby shoes
  Formal         → suit, tie, pocket square, dress shoes

  INTENTIONAL crosses that work:
    blazer + jeans + white sneakers · polo + dark jeans + Timbs (Lo-Life)
    OCBD collar visible under hoodie · polo + slim joggers + clean sneakers (elevated athleisure)
    chinos + crewneck sweater · flannel open over tee + raw denim + work boots
  MISTAKES: athletic shorts + blazer · dress shirt + baggy sweatpants · suit pants + graphic tee

AESTHETIC COHERENCE
  Streetwear   → graphic/plain tee, hoodie/zip-up, cargo pants, baggy or wide-leg jeans,
                 chunky sneakers (Jordan/Dunk/NB/AF1), cap, oversized silhouette
  Heritage     → flannel/overshirt, raw/selvedge denim, Timberlands/chukka/work boots,
                 earth tones (olive, tan, brown, camel), workwear proportions
  Prep/Ivy     → OCBD, polo, rugby shirt, chinos, boat shoes, loafers, navy blazer,
                 slim joggers (elevated), clean white leather sneakers
  Minimalist   → plain neutral tee or turtleneck, straight or wide trousers,
                 clean white/cream sneakers or simple leather shoe, tonal palette
  Elevated     → polo or quarter-zip + slim premium joggers + clean sneakers or loafers
  athleisure     → validates 2025 high-low trend; slim cut is non-negotiable here

  Within one aesthetic = always safe.
  Crossovers: one aesthetic leads, the other provides a single accent piece.
  Heritage + streetwear: Timbs CAN go with slim joggers (one workwear element grounds the look).

COLOR FORMULAS (what reliably looks good)
  SAFEST — all neutrals, varied shades:
    black + white + grey · navy + grey + white · olive + tan + brown
  CLEAN — one non-neutral + two-or-more neutrals:
    burgundy tee + black jeans + black shoes · forest green jacket + grey tee + black pants
  TONAL — same color family, varied lightness:
    light grey tee + mid-grey hoodie + charcoal pants → always reads as intentional
  EARTH PALETTE — any combination within this set works:
    camel · tan · olive · brown · rust · cream
  AVOID:
    Two different non-neutral colors competing (red top + blue bottom + green shoes).
    More than one graphic/logo piece at once — visual noise, no focal point.
    Random color assortment with no unifying theme — looks accidental.

SILHOUETTE BALANCE
  ✅ Oversized/relaxed top + slim or tapered bottom → balanced, on-trend
  ✅ Fitted or slim top + wide/straight bottom → clean counterbalance
  ✅ Oversized top + straight jeans → streetwear; anchor with a quality chunky shoe
  ⚠ Oversized top + very baggy bottom → only works with intentional streetwear + great shoe
  ✗ Very fitted top + very fitted bottom in casual context → wrong unless athleisure/formal

ACCESSORY QUALITY
  Rings and watches are DAILY wear — people don't remove them. Include in EVERY outfit.
  Necklace/chain: Include in most outfits (minimum 3 out of 4 days). One chain elevates
  any casual or streetwear look without effort.
  Hat (cap/beanie/bucket): Natural fit with streetwear, heritage, and casual outfits.
  Bag: Include when the aesthetic calls for it — backpack with streetwear, crossbody
  with smart casual, tote with heritage.
  The standard elevated stack that always works: ring + watch + chain.
  Ceiling: Don't layer four or more distinct accessory categories unless intentionally maximalist.
`.trim();
