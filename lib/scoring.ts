// MyCloset scoring algorithms: piece, outfit, wardrobe.
// All scores are 0–100.
//
// TypeScript port of /scripts/scoring.mjs — logic is 100% identical.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GarmentForScoring = {
  id: string;
  title: string | null;
  brand: string | null;
  category?: string | null;
  sub_type: string | null;
  material: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  pattern: string | null;
  formality: string | null;
  aesthetic_tags: string[] | null;
  pros: string[] | null;
  cons: string[] | null;
  color_pairings: string[] | null;
  color_clashes: string[] | null;
  tags: { colors?: string[]; [key: string]: unknown } | null;
  image: string | null;
};

export type OutfitResult = {
  items: GarmentForScoring[];
  score: number;
};

// ---------------------------------------------------------------------------
// Layer slots & outfit validity
// ---------------------------------------------------------------------------

export const LAYER_SLOTS = {
  BASE: "base",
  MID: "mid",
  VEST: "vest",
  OUTER: "outer",
  BOTTOM: "bottom",
  FOOT: "foot",
  ACC: "acc",
  ONEPIECE: "onepiece",
};

const SUB_TYPE_SLOT: Record<string, string> = {
  // ── BASE ─────────────────────────────────────────────────────────────────
  "T-Shirt":"base","Graphic Tee":"base","Long Sleeve Tee":"base","Pocket Tee":"base",
  "Polo":"base","Polo Shirt":"base","Rugby Shirt":"base",
  "Oxford Shirt":"base","Flannel Shirt":"base","Camp Collar Shirt":"base","Work Shirt":"base",
  "Henley":"base","Henley Shirt":"base","Linen Shirt":"base","Dress Shirt":"base",
  "Chambray Shirt":"base","Denim Shirt":"base","Printed Shirt":"base","Silk Shirt":"base",
  "Wrap Top":"base","One-Shoulder Top":"base","Asymmetric Top":"base","Sequin Top":"base",
  "Corset Top":"base","Slip Top":"base","Negligé Top":"base","Tank Top":"base","Knit Top":"base",
  "Camisole":"base","Bodysuit":"base","Baseball Tee":"base","Tank":"base","Sleeveless Top":"base",
  "Blouse":"base","Tunic":"base","Crop Top":"base","Bustier":"base","Bra Top":"base",

  // ── MID ──────────────────────────────────────────────────────────────────
  "Pullover Hoodie":"mid","Zip-Up Hoodie":"mid","Crewneck Sweatshirt":"mid","Zip-Up Sweatshirt":"mid",
  "Cardigan":"mid","Fleece Jacket":"mid",
  "Knitwear":"mid","Crewneck Sweater":"mid","V-Neck Sweater":"mid",
  "Turtleneck":"mid","Turtleneck Sweater":"mid","Mock Neck Sweater":"mid","Mock Neck":"mid",
  "Cable Knit Sweater":"mid","Ribbed Sweater":"mid","Chunky Knit Sweater":"mid","Fair Isle Sweater":"mid",
  "Fisherman Sweater":"mid","Shetland Sweater":"mid",
  "Quarter Zip":"mid","Quarter-Zip":"mid","Quarter Zip Pullover":"mid","Quarter-Zip Pullover":"mid",
  "Quarter Zip Sweater":"mid","Quarter-Zip Sweater":"mid","Half Zip":"mid","Half-Zip":"mid",

  // ── VEST ─────────────────────────────────────────────────────────────────
  "Vest":"vest","Sweater Vest":"vest","Knit Vest":"vest",
  "Puffer Vest":"vest","Down Vest":"vest","Gilet":"vest","Padded Vest":"vest","Fleece Vest":"vest",

  // ── OUTER ────────────────────────────────────────────────────────────────
  "Coach Jacket":"outer","Bomber Jacket":"outer","Track Jacket":"outer",
  "Leather Jacket":"outer","Denim Jacket":"outer","Moto Jacket":"outer","Biker Jacket":"outer",
  "Blazer":"outer","Sport Coat":"outer","Suit Jacket":"outer","Double-Breasted Blazer":"outer",
  "Overcoat":"outer","Trench Coat":"outer","Wool Coat":"outer","Wrap Coat":"outer",
  "Puffer Jacket":"outer","Down Jacket":"outer","Puffer Coat":"outer","Quilted Jacket":"outer",
  "Wrap Jacket":"outer","Workwear Jacket":"outer","Workwear jacket":"outer",
  "Field Jacket":"outer","Mountain Jacket":"outer","Shell Jacket":"outer","Varsity Jacket":"outer",
  "Windbreaker":"outer","Anorak":"outer","Parka":"outer","Cagoule":"outer",
  "Rain Jacket":"outer","Rain Coat":"outer","Raincoat":"outer","Mac":"outer",
  "Tech Jacket":"outer","Soft Shell Jacket":"outer","Hard Shell Jacket":"outer","Ski Jacket":"outer",
  "Shacket":"outer","Overshirt":"outer","Chore Coat":"outer","Barn Coat":"outer",
  "Peacoat":"outer","Sherpa Jacket":"outer","Sherpa Coat":"outer","Fleece Coat":"outer",
  "Harrington Jacket":"outer","Blouson":"outer","MA-1":"outer",

  // ── ONEPIECE ─────────────────────────────────────────────────────────────
  "Mini Dress":"onepiece","Midi Dress":"onepiece","Maxi Dress":"onepiece","Wrap Dress":"onepiece",
  "Shirt Dress":"onepiece","Sweater Dress":"onepiece","Bodycon Dress":"onepiece",
  "Slip Dress":"onepiece","Sundress":"onepiece","Shift Dress":"onepiece","A-Line Dress":"onepiece",
  "Floral Dress":"onepiece","Evening Gown":"onepiece","Cocktail Dress":"onepiece",
  "Pinafore Dress":"onepiece","Denim Dress":"onepiece","Smock Dress":"onepiece",
  "Jumpsuit":"onepiece","Wide-Leg Jumpsuit":"onepiece","Slim Jumpsuit":"onepiece",
  "Romper":"onepiece","Playsuit":"onepiece","Boilersuit":"onepiece",
  "Overalls":"onepiece","Dungarees":"onepiece","Denim Overalls":"onepiece",

  // ── BOTTOM ───────────────────────────────────────────────────────────────
  "Jeans":"bottom","Straight Leg Jeans":"bottom","Slim Jeans":"bottom","Skinny Jeans":"bottom",
  "Wide Leg Jeans":"bottom","Bootcut Jeans":"bottom","Flared Jeans":"bottom","Tapered Jeans":"bottom",
  "Relaxed Jeans":"bottom","Baggy Jeans":"bottom","Cropped Jeans":"bottom",
  "Trousers":"bottom","Tailored Trousers":"bottom","Wide Leg Trousers":"bottom",
  "Pleated Trousers":"bottom","Cropped Trousers":"bottom","Dress Pants":"bottom","Slacks":"bottom",
  "Cargo Pants":"bottom","Track Pants":"bottom","Sweatpants":"bottom","Joggers":"bottom",
  "Chinos":"bottom","Linen Pants":"bottom","Harem Pants":"bottom","Parachute Pants":"bottom",
  "Corduroy Pants":"bottom","Velvet Trousers":"bottom","Bell Bottoms":"bottom",
  "Shorts":"bottom","Cargo Shorts":"bottom","Y2K Shorts":"bottom","Denim Shorts":"bottom",
  "Jorts":"bottom","Board Shorts":"bottom","Track Shorts":"bottom","Biker Shorts":"bottom",
  "Chino Shorts":"bottom","Swim Shorts":"bottom","Running Shorts":"bottom",
  "Mini Skirt":"bottom","Midi Skirt":"bottom","Maxi Skirt":"bottom","Knee Length Skirt":"bottom",
  "Denim Skirt":"bottom","Pleated Skirt":"bottom","Wrap Skirt":"bottom","A-Line Skirt":"bottom",
  "Pencil Skirt":"bottom","Satin Skirt":"bottom","Leather Skirt":"bottom",
  "Leggings":"bottom","Culottes":"bottom","Palazzos":"bottom",

  // ── FOOT ─────────────────────────────────────────────────────────────────
  "Low-Top Sneakers":"foot","High-Top Sneakers":"foot","Running Shoes":"foot","Trail Runners":"foot",
  "Slip-On Sneakers":"foot","Dad Sneakers":"foot","Chunky Sneakers":"foot","Platform Sneakers":"foot",
  "Basketball Sneakers":"foot","Tennis Shoes":"foot","Retro Sneakers":"foot",
  "Chelsea Boots":"foot","Combat Boots":"foot","Work Boots":"foot","Ankle Boots":"foot",
  "Platform Boots":"foot","Knee-High Boots":"foot","Cowboy Boots":"foot","Hiking Boots":"foot",
  "Snow Boots":"foot","Rain Boots":"foot","Riding Boots":"foot","Desert Boots":"foot",
  "Loafers":"foot","Mules":"foot","Sandals":"foot","Slides":"foot",
  "Dress Shoes":"foot","Oxford Shoes":"foot","Derby Shoes":"foot","Monk Straps":"foot",
  "Ballet Flats":"foot","Slingbacks":"foot","Mary Janes":"foot","Brogues":"foot",
  "Moccasins":"foot","Espadrilles":"foot","Clogs":"foot","Flip Flops":"foot",
  "Heels":"foot","Pumps":"foot","Wedges":"foot","Stilettos":"foot","Block Heels":"foot",
  "Kitten Heels":"foot","Platform Heels":"foot","Approach Shoes":"foot",

  // ── ACC ──────────────────────────────────────────────────────────────────
  "Pouch":"acc","Mini Shoulder Bag":"acc","Shoulder Bag":"acc","Top Handle Bag":"acc",
  "Crossbody Bag":"acc","Tote Bag":"acc","Backpack":"acc","Belt Bag":"acc","Fanny Pack":"acc",
  "Clutch":"acc","Wristlet":"acc","Messenger Bag":"acc","Satchel":"acc","Hobo Bag":"acc",
  "Duffle Bag":"acc","Mini Bag":"acc","Micro Bag":"acc",
  "Belt":"acc","Leather Belt":"acc","Canvas Belt":"acc","Chain Belt":"acc","Suspenders":"acc",
  "Cap":"acc","Snapback":"acc","Bucket Hat":"acc","Beanie":"acc","Beret":"acc","Visor":"acc",
  "Fedora":"acc","Cowboy Hat":"acc","Balaclava":"acc","Trucker Hat":"acc","Flat Cap":"acc",
  "Watch":"acc","Ring":"acc","Necklace":"acc","Chain Necklace":"acc","Pendant Necklace":"acc",
  "Choker":"acc","Bracelet":"acc","Bangle":"acc","Cuff Bracelet":"acc",
  "Earrings":"acc","Earring":"acc","Hoop Earrings":"acc","Stud Earrings":"acc",
  "Earcuff":"acc","Brooch":"acc","Pin":"acc","Cufflinks":"acc","Hair Clip":"acc","Hair Tie":"acc",
  "Sunglasses":"acc","Glasses":"acc",
  "Tie":"acc","Necktie":"acc","Bow Tie":"acc","Silk Tie":"acc","Bolo Tie":"acc","Cravat":"acc",
  "Tie Bar":"acc","Tie Clip":"acc","Pocket Square":"acc",
  "Scarf":"acc","Silk Scarf":"acc","Bandana":"acc","Neck Scarf":"acc",
  "Gloves":"acc","Socks":"acc","Wallet":"acc",

  // ── NEW BASE ──────────────────────────────────────────────────────────────
  "Oversized Tee":"base","Baby Tee":"base","Thermal Tee":"base",
  "Tube Top":"base","Halter Top":"base","Bralette":"base",
  "Off-Shoulder Top":"base","Peplum Top":"base","Smock Top":"base",
  "Sheer Top":"base","Mesh Top":"base","Lace Top":"base",
  "Western Shirt":"base","Bowling Shirt":"base","Peasant Top":"base",

  // ── NEW MID ───────────────────────────────────────────────────────────────
  "Polo Sweater":"mid","Shrug":"mid","Bolero":"mid",

  // ── NEW OUTER ─────────────────────────────────────────────────────────────
  "Waxed Jacket":"outer","Cape":"outer","Poncho":"outer",
  "Kimono Jacket":"outer","Car Coat":"outer","Chesterfield Coat":"outer",
  "Duster":"outer","Longline Cardigan":"outer",

  // ── NEW ONEPIECE ──────────────────────────────────────────────────────────
  "Cut-Out Dress":"onepiece","Halter Dress":"onepiece","Blazer Dress":"onepiece",
  "T-Shirt Dress":"onepiece","Knit Dress":"onepiece","Ribbed Dress":"onepiece",
  "Long Romper":"onepiece","Shortalls":"onepiece",

  // ── NEW BOTTOM ────────────────────────────────────────────────────────────
  "Leather Pants":"bottom","Lounge Shorts":"bottom","Compression Shorts":"bottom",
  "Pleated Shorts":"bottom","Cargo Skirt":"bottom","Tennis Skirt":"bottom",
  "Tiered Skirt":"bottom","Asymmetric Skirt":"bottom","Kilt":"bottom",

  // ── NEW FOOT ─────────────────────────────────────────────────────────────
  "Mid-Top Sneakers":"foot","Skate Shoes":"foot",
  "Over-The-Knee Boots":"foot","Thigh-High Boots":"foot","Boat Shoes":"foot",
  "Strappy Sandals":"foot","Gladiator Sandals":"foot","Platform Sandals":"foot",
  "Birkenstock":"foot","Birkenstocks":"foot",

  // ── NEW ACC ───────────────────────────────────────────────────────────────
  "Baseball Cap":"acc","Dad Hat":"acc","Fitted Cap":"acc","Wide-Brim Hat":"acc",
  "Newsboy Cap":"acc","Durag":"acc","Headwrap":"acc",
  "Market Bag":"acc","Drawstring Bag":"acc","Barrel Bag":"acc",
  "Baguette Bag":"acc","Chest Rig":"acc",
  "Anklet":"acc","Body Chain":"acc","Neck Gaiter":"acc",
  "Ankle Socks":"acc","Crew Socks":"acc","Knee-High Socks":"acc","Fishnet Socks":"acc",
  "Fingerless Gloves":"acc","Mittens":"acc",
  "Headband":"acc","Scrunchie":"acc","Claw Clip":"acc",
};

export function getSlot(sub_type: string | null | undefined): string | null {
  if (!sub_type) return null;
  const direct = SUB_TYPE_SLOT[sub_type];
  if (direct) return direct;
  const l = sub_type.toLowerCase();

  // ── ONEPIECE first — but "dress" as an adjective for pants/trousers (e.g. "Pleated Dress Pants",
  // "Flat Front Dress Trousers") must route to bottom, not onepiece.
  if (l.includes("dress pant") || l.includes("dress trouser") || l.includes("dress short")) return "bottom";
  if (l.includes("dress") || l.includes("jumpsuit") || l.includes("romper") || l.includes("overall") || l.includes("boilersuit") || l.includes("playsuit")) return "onepiece";

  // ── VEST
  if (l.includes("vest") || l.includes("gilet")) return "vest";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("cardigan") || l.includes("pullover") || l.includes("jumper")) return "mid";
  if (l.includes("blouson")) return "outer";
  if (l.includes("fleece") && !l.includes("jacket") && !l.includes("coat")) return "mid";
  if (l.includes("sweater") || l.includes("turtleneck") || l.includes("knitwear") || l.includes("mock neck") || l.includes("mockneck")) return "mid";
  if (l.includes("crew neck") || l.includes("crewneck") || l.includes("v-neck") || l.includes("v neck")) return "mid";
  if (l.includes("quarter zip") || l.includes("quarter-zip") || l.includes("half zip") || l.includes("half-zip")) return "mid";

  // ── OUTER — "overshirt"/"shacket" BEFORE "shirt" fallback
  if (l.includes("overshirt") || l.includes("shacket")) return "outer";
  if (l.includes("jacket") || l.includes("trench") || l.includes("blazer") || l.includes("peacoat")) return "outer";
  if (l.includes("overcoat") || l.includes("raincoat") || l.includes("mackintosh")) return "outer";
  if (l.includes("parka") || l.includes("anorak") || l.includes("windbreaker") || l.includes("cagoule") || l.includes("puffer")) return "outer";
  if (l.includes(" coat") || l.startsWith("coat")) return "outer";

  // ── BASE
  if (l.includes("shirt") || l.includes("polo") || l.includes("henley") || l.includes("blouse") || l.includes("tunic")) return "base";
  if (l.includes(" tee") || l.startsWith("tee") || l.includes("t-shirt")) return "base";
  if (l.includes("camisole") || l.includes("bodysuit") || l.includes("corset") || l.includes("bustier")) return "base";
  if (l.includes("tank") || l.includes("crop top") || l.includes("bra top")) return "base";
  if ((l.includes("top") || l.includes("blouse")) && !l.includes("bag")) return "base";
  // DB items often use standalone material/texture as sub_type (e.g. "flannel", "jersey").
  // These are almost always shirts/tops — classify them as base so they're slotted correctly
  // in generation and so the directional outer-base penalty can evaluate them.
  if (l === "flannel" || (l.includes("flannel") && !l.includes("jacket") && !l.includes("coat") && !l.includes("pant"))) return "base";
  if (l === "jersey" || (l.includes("jersey") && !l.includes("short") && !l.includes("pant"))) return "base";

  // ── BOTTOM
  if (l.includes("jean") || (l.includes("denim") && (l.includes("short") || l.includes("skirt")))) return "bottom";
  if (l.includes("trouser") || l.includes("pant") || l.includes("slack") || l.includes("chino")) return "bottom";
  if (l.includes("short") || l.includes("skirt")) return "bottom";
  if (l.includes("legging") || l.includes("jogger") || l.includes("jort") || l.includes("culotte") || l.includes("palazzo") || l.includes("sweatpant")) return "bottom";

  // ── FOOT
  if (l.includes("sneaker") || l.includes("shoe") || l.includes("boot") || l.includes("loafer") || l.includes("sandal")) return "foot";
  if (l.includes("slide") || l.includes("runner") || l.includes("trainer")) return "foot";
  if (l.includes("moccasin") || l.includes("clog") || l.includes("espadrille") || l.includes("slipper") || l.includes("mule")) return "foot";
  if (l.includes("heel") || l.includes("pump") || l.includes("stiletto") || l.includes("wedge")) return "foot";
  if (l.includes("flip") || l.includes("thong")) return "foot";

  // ── ACC
  if (l.includes("bag") || l.includes("belt") || l.includes("wallet") || l.includes("pouch")) return "acc";
  if (l.includes("hat") || l.includes("cap") || l.includes("beret") || l.includes("beanie") || l.includes("visor") || l.includes("fedora")) return "acc";
  if (l.includes("watch") || l.includes("necklace") || l.includes("bracelet") || l.includes("choker") || l.includes("chain")) return "acc";
  if (l.includes("earring") || l.includes("earcuff") || l.includes("brooch") || l.includes("cufflink")) return "acc";
  if (l.includes("sunglass") || l.includes("glass") || l.includes("spectacle")) return "acc";
  if (l.includes("ring")) return "acc";
  if (l === "tie" || l.endsWith(" tie")) return "acc";
  if (l.includes("scarf") || l.includes("bandana") || l.includes("glove") || l.includes("mitten")) return "acc";
  if (l.includes("suspender") || l.includes("brace")) return "acc";
  if (l.includes("sock")) return "acc";
  if (l.includes("pocket square") || l.includes("balaclava") || l.includes("snood")) return "acc";

  return null;
}

// Category-aware slot resolver: user-selected category wins over sub_type keyword matching.
// "top" falls through to getSlot(sub_type) because it covers both base and mid.
export function resolveSlot(item: GarmentForScoring): string | null {
  const cat = (item.category ?? "").toLowerCase().trim();
  if (cat === "bottom"    || cat === "bottoms")                    return "bottom";
  if (cat === "footwear"  || cat === "shoes")                      return "foot";
  if (cat === "outerwear")                                          return "outer";
  if (cat === "sweater"   || cat === "knitwear")                   return "mid";
  if (cat === "vest"      || cat === "gilet")                      return "vest";
  if (cat === "one-piece" || cat === "onepiece" || cat === "dress") return "onepiece";
  if (cat === "accessory" || cat === "accessories")                return "acc";
  return getSlot(item.sub_type);
}

export function isValidOutfitCombination(
  items: GarmentForScoring[],
  options: { requireFoot?: boolean } = {},
): { valid: boolean; reason?: string } {
  const { requireFoot = true } = options;
  const slots = items.map(i => resolveSlot(i));
  const slotSet = new Set(slots);

  if (requireFoot && !slotSet.has("foot")) return { valid: false, reason: "Missing footwear" };

  const hasOnepiece = slotSet.has("onepiece");
  const hasRealTop = slotSet.has("base") || slotSet.has("mid") || slotSet.has("outer") || hasOnepiece;
  const hasBottom = slotSet.has("bottom") || hasOnepiece;

  if (!hasRealTop) return { valid: false, reason: "Missing top layer (vest alone is not a top)" };
  if (!hasBottom) return { valid: false, reason: "Missing bottom" };

  // base allows up to 3 layers (layering tee over long-sleeve etc); all other slots max 1
  const nonAcc = slots.filter(s => s !== null && s !== "acc") as string[];
  const counts: Record<string, number> = {};
  for (const s of nonAcc) counts[s] = (counts[s] ?? 0) + 1;
  for (const [slot, count] of Object.entries(counts)) {
    const max = slot === "base" ? 3 : 1;
    if (count > max) return { valid: false, reason: `Too many ${slot} layers (max ${max})` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Brand prestige
// ---------------------------------------------------------------------------

const LUXURY_BRANDS = new Set([
  "BALENCIAGA","GIVENCHY","PRADA","GUCCI","SAINT LAURENT","LOEWE","VALENTINO",
  "DIOR","BOTTEGA VENETA","CELINE","HERMES","FERRAGAMO","VERSACE","BURBERRY",
  "MCQUEEN","ALEXANDER MCQUEEN","MONCLER","TOM FORD","FENDI","BALMAIN",
  "LANVIN","MARNI","STELLA MCCARTNEY","GIAMBATTISTA VALLI","MISSONI",
  "ROBERTO CAVALLI","MOSCHINO","ETRO","EMILIO PUCCI",
  "THE ROW","LORO PIANA","BRUNELLO CUCINELLI","TOTEME","LEMAIRE",
  "JACQUEMUS","AMI PARIS","SANDRO","ISABEL MARANT","ROHE",
  "STUDIO NICHOLSON","AURALEE","COMOLI","MARGARET HOWELL",
  "MASSIMO ALBA","BOGLIOLI","ZEGNA","ERMENEGILDO ZEGNA",
  "COMME DES GARCONS","COMME DES GARCONS HOMME PLUS","COMME DES GARCONS PARFUMS",
  "YOHJI YAMAMOTO","ISSEY MIYAKE","UNDERCOVER","SACAI","KAPITAL",
  "NEEDLES","NANAMICA","PORTER","VISVIM","WACKO MARIA",
  "RICK OWENS","ANN DEMEULEMEESTER","RAF SIMONS","DRIES VAN NOTEN",
  "MAISON MARGIELA","MM6 MAISON MARGIELA","JIL SANDER",
  "THOM BROWNE","VIVIENNE WESTWOOD","PAUL SMITH","KENZO","OFF-WHITE",
  "MASTERMIND WORLD","HELMUT LANG","COURREGES","ACNE STUDIOS","A-COLD-WALL*",
  "FEAR OF GOD","CHROME HEARTS","PALM ANGELS","AMIRI","RHUDE","GALLERY DEPT.",
  "MAX MARA","S MAX MARA","PORT TANGER","GUIDI","ANDREA YA AQOV",
  "ROSE BURRITO","NVL GARDE","SSSTEIN","BIJULES","VALEXTRA",
  "VAQUERA","THOM KROM","BRYAN JIMENEZ","COPERNI",
  "44 LABEL GROUP","TRC","VETEMENTS","AMBUSH","1017 ALYX 9SM",
  "JOHN LOBB","EDWARD GREEN","CROCKETT & JONES","TRICKER'S","CHURCH'S",
  "ALDEN","PARABOOT","BERLUTI","SALVATORE FERRAGAMO",
  // Contemporary luxury / niche high-fashion
  "COMMON PROJECTS","OAMC","BODE","STEFAN COOKE","RANDOM IDENTITIES",
  "DRIES VAN NOTEN","MARQUES ALMEIDA","BETHANY WILLIAMS","EDWARD CRUTCHLEY",
  "BIANCA SAUNDERS","KOZABURO","S.S.DALEY","MARTINE ROSE",
  "CRAIG GREEN","ASTRID ANDERSEN","WALES BONNER","LABRUM LONDON",
]);

const PREMIUM_BRANDS = new Set([
  "Y-3","NIKE","ADIDAS","NEW BALANCE","ASICS","SAUCONY","BROOKS","ON",
  "SALOMON","HOKA","MERRELL","KEEN","COLUMBIA","MAMMUT","SCOTT",
  "UNDER ARMOUR","LULULEMON","VUORI","GYMSHARK",
  "ARC'TERYX","PATAGONIA","THE NORTH FACE","FJALLRAVEN","BARBOUR",
  "BELSTAFF","FILSON","BARACUTA","GRENSON","DR. MARTENS","RED WING",
  "VANS","CONVERSE","BIRKENSTOCK","TIMBERLAND","UGG","NEW BALANCE",
  "JORDAN BRAND","JORDAN","CLARKS","CAMPER","DREW HOUSE",
  "POLO RALPH LAUREN","TOMMY HILFIGER","LACOSTE","FRED PERRY",
  "BROOKS BROTHERS","J.CREW","BANANA REPUBLIC",
  "A.P.C.","CARHARTT WIP","OUR LEGACY","SAMSOE SAMSOE",
  "NORSE PROJECTS","FILIPPA K","COS","ARKET","& OTHER STORIES",
  "WEEKDAY","HOPE","ACNE STUDIOS",
  "STUSSY","SUPREME","PALACE","KITH","NOAH","AIME LEON DORE",
  "BAPE","A BATHING APE","ANTI SOCIAL SOCIAL CLUB","CORTEIZ","CPFM",
  "CACTUS PLANT FLEA MARKET","BRAIN DEAD","MARKET","PATTA",
  "PLEASURES","AWAKE NY","STAMPD","REPRESENT","ACRONYM",
  "HUMAN MADE","NEIGHBORHOOD","WTAPS","FRAGMENT",
  "MONCLER GENIUS","STONE ISLAND","CP COMPANY","LEVI'S","CARHARTT","DICKIES",
]);

const BUDGET_BRANDS = new Set([
  "ZARA","H&M","SHEIN","PRIMARK","BOOHOO","ASOS","FOREVER 21","FASHION NOVA",
  "TOPSHOP","UNIQLO","GAP","OLD NAVY","TARGET","WALMART","FAST FASHION",
  "PLT","PRETTY LITTLE THING","ROMWE","ZAFUL",
  "HANES","FRUIT OF THE LOOM","GILDAN","COTTON ON","COTTON:ON",
  "GEORGE","F21","PENNEYS","PEACOCKS",
]);

// Normalize accented characters so "Comme des Garçons" matches "COMME DES GARCONS"
function normalizeForLookup(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .trim();
}

export function getBrandTier(brand: string | null | undefined): number {
  if (!brand) return 2;
  const b = normalizeForLookup(brand);
  if (LUXURY_BRANDS.has(b)) return 5;
  if (PREMIUM_BRANDS.has(b)) return 3;
  if (BUDGET_BRANDS.has(b)) return 1;

  // Sub-brand containment: "Nike SB" → NIKE, "Carhartt WIP" already in premium
  const PARENT_BRANDS: [string, number][] = [
    ["COMME DES GARCONS", 5],
    ["YOHJI YAMAMOTO", 5], ["RICK OWENS", 5], ["MAISON MARGIELA", 5],
    ["BALENCIAGA", 5], ["GUCCI", 5], ["PRADA", 5], ["DIOR", 5],
    ["SAINT LAURENT", 5], ["GIVENCHY", 5],
    ["NIKE", 3], ["ADIDAS", 3], ["NEW BALANCE", 3],
    ["JORDAN", 3], ["VANS", 3], ["CONVERSE", 3],
    ["THE NORTH FACE", 3], ["PATAGONIA", 3],
    ["STONE ISLAND", 3], ["CARHARTT", 3],
  ];
  for (const [parent, tier] of PARENT_BRANDS) {
    if (b.startsWith(parent) || b.includes(parent)) return tier;
  }

  // Handle collaboration names like "Off-White x Jordan" — take the highest tier
  // of any constituent brand so luxury collabs score correctly.
  if (b.includes(" X ")) {
    let best = 2;
    for (const part of b.split(" X ")) {
      const t = getBrandTier(part.trim());
      if (t > best) best = t;
    }
    return best;
  }

  return 2;
}

// ---------------------------------------------------------------------------
// Material quality tier (1–5)
// ---------------------------------------------------------------------------

const MATERIAL_KEYWORDS: [number, string[]][] = [
  [5, [
    "cashmere","qiviut","vicuña","nappa lambskin","lambskin","naplack",
    "shell cordovan","japanese selvedge","15oz selvedge","13.5oz",
    "silk satin","mulberry silk","merino wool","superfine wool","superfine",
  ]],
  [4, [
    "merino","lambswool","wool","silk","linen","leather","suede","nubuck","nappa",
    "camel hair","mohair","alpaca","down","gore-tex","waxed cotton","tweed",
    "canvas duck","ripstop cordura","selvedge denim","boiled wool","double-face",
    "gold","silver","platinum","sterling","titanium","brass","acetate",
  ]],
  [3, [
    "cotton","oxford","twill","canvas","flannel","jersey","fleece","denim",
    "ripstop","tech fabric","woven","knit","cotton jersey","cotton poplin",
    "poplin","cotton blend","polyamide","nylon","mesh","satin","velvet","corduroy",
  ]],
  [2, ["polyester","acrylic","synthetic","performance","recycled","viscose","rayon","spandex","elastane","modal"]],
  [1, ["plastic","rubber","foam","vinyl","pu leather","vegan leather","faux"]],
];

export function getMaterialTier(material: string | null | undefined): number {
  if (!material || ["unknown","n/a","null"].includes(material?.toLowerCase())) return 2;
  const l = material.toLowerCase();
  if (l.includes("pu ") || l.includes(" pu") || l === "pu" ||
      l.includes("faux") || l.includes("vegan leather") || l.includes("bonded leather")) return 1;
  for (const [tier, keywords] of MATERIAL_KEYWORDS) {
    if (keywords.some(k => l.includes(k))) return tier;
  }
  return 2;
}


// ---------------------------------------------------------------------------
// Aesthetic tag desirability  (used by outfit + wardrobe scorers)
// ---------------------------------------------------------------------------

const TAG_SCORES: Record<string, number> = {
  "high-fashion":   5.0,
  "quiet-luxury":   5.0,
  "old-money":      4.0,
  "techwear":       3.5,
  "streetwear":     3.5,
  "gorpcore":       3.5,
  "vintage":        3.0,
  "y2k":            2.5,
  "indie-sleaze":   2.5,
  "indie-grunge":   2.0,
  "punk":           2.5,
  "goth":           2.5,
  "90s":            2.5,
  "grunge":         2.0,
  "skate":          2.0,
  "minimalist":     2.0,
  "athleisure":     2.0,
  "workwear":       2.0,
  "normcore":       1.5,
  "preppy":         1.5,
  "business-casual":1.5,
  "mall-core":      0.5,
  "maximalist":     0.5,
  "casual":         0.0,
};

function aestheticScore(tags: string[] | null | undefined, cap: number): number {
  if (!tags?.length) return 0;
  const raw = tags.reduce((s, t) => s + (TAG_SCORES[t.toLowerCase()] ?? 1.0), 0);
  return Math.min(raw, cap);
}

// ---------------------------------------------------------------------------
// Domain authority — brand prestige within a specific aesthetic context
//
// The core idea: a Stussy hoodie should be rated as "how good is this in
// streetwear?" not "how close is this to Hermès?". Each score (0–50) answers
// "how recognized/prestigious is this brand specifically within this domain?"
// ---------------------------------------------------------------------------

const DOMAIN_BRAND_SCORES: Record<string, Record<string, number>> = {
  "streetwear": {
    "SUPREME": 50, "PALACE": 48, "BAPE": 47, "A BATHING APE": 47,
    "OFF-WHITE": 46, "BRAIN DEAD": 44, "CORTEIZ": 44, "CPFM": 43, "CACTUS PLANT FLEA MARKET": 43,
    "STUSSY": 42, "KITH": 41, "AIME LEON DORE": 41, "NOAH": 40, "ANTI SOCIAL SOCIAL CLUB": 38,
    "DREW HOUSE": 37, "PLEASURES": 37, "AWAKE NY": 36, "STAMPD": 35, "MARKET": 35,
    "CARHARTT WIP": 38, "STONE ISLAND": 40, "CP COMPANY": 38, "HUMAN MADE": 40,
    "NEIGHBORHOOD": 38, "WTAPS": 38, "FRAGMENT": 40, "PATTA": 38,
    "JORDAN": 42, "JORDAN BRAND": 42, "NIKE": 36, "ADIDAS": 34, "NEW BALANCE": 34,
    "VANS": 34, "CONVERSE": 32, "JNCO": 30,
    "CHROME HEARTS": 44, "PALM ANGELS": 40, "AMIRI": 40, "RHUDE": 38, "GALLERY DEPT.": 42,
    "REPRESENT": 36, "ACRONYM": 40, "WACKO MARIA": 40,
  },
  "y2k": {
    "JNCO": 48, "ED HARDY": 44, "BABY PHAT": 43, "SEAN JOHN": 40, "ECKO UNLTD": 36,
    "BAPE": 46, "STUSSY": 40, "SUPREME": 42, "POLO RALPH LAUREN": 38,
    "AFFLICTION": 34, "JUICY COUTURE": 43, "VON DUTCH": 36, "ROCAWEAR": 36,
    "JORDAN": 40, "JORDAN BRAND": 40, "NIKE": 36, "ADIDAS": 34,
  },
  "vintage": {
    "LEVI'S": 48, "CARHARTT": 46, "WRANGLER": 44, "LEE": 42,
    "DICKIES": 40, "POLO RALPH LAUREN": 40, "RALPH LAUREN": 40,
    "JNCO": 38, "STUSSY": 42, "SUPREME": 44, "CHAMPION": 36,
  },
  "quiet-luxury": {
    "LORO PIANA": 50, "THE ROW": 50, "BRUNELLO CUCINELLI": 50, "TOTEME": 46,
    "HERMES": 50, "BOTTEGA VENETA": 48, "CELINE": 48, "LEMAIRE": 46, "JIL SANDER": 46,
    "TIFFANY & CO.": 47, "TIFFANY AND CO": 47,
    "ACNE STUDIOS": 42, "A.P.C.": 40, "COS": 36,
    "MARGARET HOWELL": 44, "STUDIO NICHOLSON": 44, "AURALEE": 44, "COMOLI": 44,
    "MASSIMO ALBA": 46, "BOGLIOLI": 44, "ZEGNA": 46, "ERMENEGILDO ZEGNA": 46,
    "PRADA": 48, "DIOR": 48, "LOEWE": 48,
    "ISSEY MIYAKE": 44, "3.1 PHILLIP LIM": 38, "COMMON PROJECTS": 42,
  },
  "old-money": {
    "POLO RALPH LAUREN": 50, "RALPH LAUREN": 50, "BROOKS BROTHERS": 48,
    "LACOSTE": 44, "FRED PERRY": 42, "TOMMY HILFIGER": 40, "J.CREW": 36,
    "TIFFANY & CO.": 46, "TIFFANY AND CO": 46,
    "BURBERRY": 46, "BARBOUR": 42, "LORO PIANA": 50, "BRUNELLO CUCINELLI": 50,
    "HERMES": 50, "VINEYARD VINES": 38,
  },
  "workwear": {
    "CARHARTT": 50, "FILSON": 50, "CARHARTT WIP": 46,
    "DICKIES": 44, "WRANGLER": 43, "LEE": 40,
    "TIMBERLAND": 42, "RED WING": 50, "WOLVERINE": 44, "THOROGOOD": 44,
    "LEVI'S": 42, "PENDLETON": 42,
  },
  "gorpcore": {
    "ARC'TERYX": 50, "SALOMON": 48, "PATAGONIA": 46, "THE NORTH FACE": 44,
    "STONE ISLAND": 42, "MAMMUT": 44, "HOKA": 40, "ON": 42,
    "BIRKENSTOCK": 42, "KEEN": 38, "MERRELL": 38, "FJALLRAVEN": 40,
    "NANAMICA": 42, "COLUMBIA": 38, "SCOTT": 40,
  },
  "high-fashion": {
    "RICK OWENS": 50, "MAISON MARGIELA": 50, "MM6 MAISON MARGIELA": 47,
    "COMME DES GARCONS": 50, "COMME DES GARCONS HOMME PLUS": 50,
    "YOHJI YAMAMOTO": 50, "RAF SIMONS": 50, "ANN DEMEULEMEESTER": 48,
    "DRIES VAN NOTEN": 48, "UNDERCOVER": 46, "SACAI": 46,
    "VETEMENTS": 44, "AMBUSH": 42, "1017 ALYX 9SM": 44, "44 LABEL GROUP": 42,
    "OFF-WHITE": 46, "GUCCI": 48, "PRADA": 50, "DIOR": 50, "BALENCIAGA": 50,
    "GIVENCHY": 46, "VALENTINO": 46, "LOEWE": 48, "MARNI": 46, "CELINE": 48,
    "A-COLD-WALL*": 44, "COPERNI": 42, "COURREGES": 44, "ROHE": 44,
    "ISSEY MIYAKE": 46, "KAPITAL": 44, "NEEDLES": 42, "WACKO MARIA": 40,
    "WALES BONNER": 44, "MARTINE ROSE": 42, "CRAIG GREEN": 44, "OAMC": 40,
    "BODE": 42, "STEFAN COOKE": 40, "COMMON PROJECTS": 40,
  },
  "techwear": {
    "ACRONYM": 50, "ARC'TERYX": 46, "STONE ISLAND": 44, "CP COMPANY": 42,
    "Y-3": 42, "NIKE": 36, "ADIDAS": 34, "SALOMON": 38, "A-COLD-WALL*": 40,
  },
  "minimalist": {
    "LEMAIRE": 50, "JIL SANDER": 50, "THE ROW": 50, "TOTEME": 48,
    "COS": 46, "ARKET": 44, "& OTHER STORIES": 40, "WEEKDAY": 36,
    "ACNE STUDIOS": 46, "A.P.C.": 46, "OUR LEGACY": 44,
    "NORSE PROJECTS": 44, "FILIPPA K": 44, "SAMSOE SAMSOE": 42,
    "CARHARTT WIP": 38, "HOPE": 44, "STUDIO NICHOLSON": 46,
  },
  "preppy": {
    "POLO RALPH LAUREN": 50, "RALPH LAUREN": 50, "BROOKS BROTHERS": 48,
    "LACOSTE": 46, "FRED PERRY": 44, "TOMMY HILFIGER": 44, "J.CREW": 42,
    "VINEYARD VINES": 40, "BARBOUR": 42, "PATAGONIA": 38,
  },
  "punk": {
    "VIVIENNE WESTWOOD": 50, "CHROME HEARTS": 48, "WASTED YOUTH": 46,
    "PLEASURES": 44, "BRAIN DEAD": 42, "GALLERY DEPT.": 42,
    "COOKIE SHIRTS": 32,
  },
  "athleisure": {
    "LULULEMON": 50, "VUORI": 48, "ON": 46, "GYMSHARK": 40,
    "NIKE": 44, "ADIDAS": 42, "UNDER ARMOUR": 36, "REEBOK": 34,
    "ARC'TERYX": 44, "PATAGONIA": 42, "THE NORTH FACE": 40, "Y-3": 44,
    "POLO RALPH LAUREN": 38, "LACOSTE": 36,
  },
  "skate": {
    "VANS": 50, "THRASHER": 50, "PALACE": 46, "BRAIN DEAD": 42,
    "STUSSY": 40, "SUPREME": 46, "CONVERSE": 42, "NIKE": 40, "NEW BALANCE": 36,
    "DICKIES": 40, "CARHARTT WIP": 38,
  },
  "grunge": {
    "LEVI'S": 44, "DICKIES": 42, "CARHARTT": 44, "WRANGLER": 40,
    "DR. MARTENS": 46, "CONVERSE": 42, "VANS": 40,
    "CHROME HEARTS": 44, "VIVIENNE WESTWOOD": 44,
  },
};

// Default domain authority by brand tier when no specific domain entry exists.
const DOMAIN_TIER_DEFAULT: Record<number, number> = { 5: 38, 3: 25, 2: 15, 1: 6 };

// How prestigious is this brand within its best aesthetic context? (0–50)
function getDomainAuthority(brand: string | null | undefined, aestheticTags: string[] | null): number {
  const b = (brand ?? "").toUpperCase().trim();
  const tags = (aestheticTags ?? []).map(t => t.toLowerCase());
  const tier = getBrandTier(brand);
  const tierDefault = DOMAIN_TIER_DEFAULT[tier] ?? 15;

  if (!tags.length) return tierDefault;

  let best = tierDefault;
  for (const aesthetic of tags) {
    const domainMap = DOMAIN_BRAND_SCORES[aesthetic];
    if (!domainMap) { best = Math.max(best, tierDefault); continue; }

    // Try full brand name first, then each part of a collab ("Off-White x Jordan")
    const candidates = [b, ...b.split(" X ").map(p => p.trim())];
    let found = false;
    for (const candidate of candidates) {
      if (domainMap[candidate] !== undefined) {
        best = Math.max(best, domainMap[candidate]);
        found = true;
        break;
      }
    }
    if (!found) best = Math.max(best, tierDefault);
  }
  return best;
}

// ---------------------------------------------------------------------------
// PIECE SCORE (0–100)
// ---------------------------------------------------------------------------

// Patterns that are nearly impossible to style well — photographic/novelty/all-over
const CHAOTIC_PATTERNS = new Set(["photo-print", "novelty-print", "all-over-graphic"]);

export function scorePiece(item: GarmentForScoring): number {
  if (!item) return 0;

  // Novelty items: score from their craft rating (1–10), not the fashion formula
  const tags = item.tags as { tier?: string[]; novelty_score?: string[] } | null;
  if (tags?.tier?.[0] === 'novelty') {
    const q = parseInt(tags.novelty_score?.[0] ?? '3', 10);
    return Math.max(1, Math.min(q, 10));
  }
  // Statement-tier: bold pattern is intentional — skip chaotic-pattern penalty & novelty backstop
  const isStatement = tags?.tier?.[0] === 'statement';

  const matTier   = getMaterialTier(item.material);
  const brandTier = getBrandTier(item.brand);

  // Material floor (0–20): physical quality of the garment itself
  const MAT_FLOOR: Record<number, number> = { 5: 20, 4: 16, 3: 12, 2: 7, 1: 2 };
  const materialFloor = MAT_FLOOR[matTier] ?? 12;

  // Domain authority (0–50): prestige of this brand within its specific aesthetic context.
  // A Stussy hoodie scores ~42 in "streetwear" context — not compared to luxury items.
  // An unknown brand falls back to a tier-based default.
  const domainAuthority = getDomainAuthority(item.brand, item.aesthetic_tags);

  // Color versatility (0–15): ratio of pairings to total signals how easily this item fits outfits
  const pairCount  = item.color_pairings?.length ?? 0;
  const clashCount = item.color_clashes?.length ?? 0;
  const colorTotal = pairCount + clashCount;
  const colorPts   = colorTotal > 0 ? Math.round((pairCount / colorTotal) * 15) : 9;

  // Aesthetic context bonus — cap scales inversely with brand tier.
  // For luxury brands (Balenciaga, Tiffany) the brand IS the statement: aesthetic cap = 4.
  // For unknown brands the aesthetics must carry the weight: cap = 12.
  // This means a well-styled unknown piece in streetwear/y2k can genuinely outscore
  // a poorly-styled premium piece — which is how outfit battles should feel.
  const AESTHETIC_CAP: Record<number, number> = { 5: 4, 3: 8, 2: 12, 1: 6 };
  const aestheticPts = Math.round(aestheticScore(item.aesthetic_tags, AESTHETIC_CAP[brandTier] ?? 8));

  // Formality flexibility (0–3): smart-casual maximizes versatility
  const FORMALITY_PTS: Record<string, number> = { "smart-casual": 3, "casual": 2, "business": 1, "formal": 1 };
  const formalityPts = FORMALITY_PTS[item.formality?.toLowerCase() ?? ""] ?? 2;

  // Chaotic pattern penalty (-20): photo/novelty/all-over prints are nearly impossible to outfit.
  // Statement-tier items are exempt — their bold pattern is the point, not a styling handicap.
  const patternPenalty = (!isStatement && CHAOTIC_PATTERNS.has((item.pattern ?? "").toLowerCase())) ? -20 : 0;

  // Color chaos penalty (-6): 5+ distinct colors fights most outfit combinations
  const distinctColors    = itemColors(item);
  const colorChaosPenalty = distinctColors.length >= 5 ? -6 : 0;

  const total_score = materialFloor + domainAuthority + aestheticPts + colorPts + formalityPts + patternPenalty + colorChaosPenalty;
  const raw = Math.max(0, Math.min(Math.round(total_score), 100));

  // Safety backstop: photo-print and novelty-print are unambiguous novelty signals.
  // If the AI missed the item_tier flag AND the brand has no real domain authority
  // (tier ≤ 2), cap the score so it can never masquerade as a legitimate fashion item.
  // Statement-tier items and premium/luxury brands with bold prints are intentional and not capped.
  const HARD_NOVELTY_PATTERNS = new Set(["photo-print", "novelty-print"]);
  if (!isStatement && HARD_NOVELTY_PATTERNS.has((item.pattern ?? "").toLowerCase()) && getBrandTier(item.brand) <= 2) {
    return Math.min(raw, 20);
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

function itemColors(item: GarmentForScoring): string[] {
  if (item.tags?.colors?.length) return item.tags.colors;
  return [item.color_primary, item.color_secondary].filter(Boolean) as string[];
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Color compatibility fallback (used when no pairing/clash data exists)
// ---------------------------------------------------------------------------

const COLOR_FAMILY_MAP: Record<string, string> = {
  black:"neutral", white:"neutral", gray:"neutral", grey:"neutral",
  ivory:"neutral", cream:"neutral", offwhite:"neutral", onyx:"neutral",
  charcoal:"neutral", silver:"neutral", stone:"neutral", ecru:"neutral",
  // These words are already treated as "neutral" by classifyColor()'s
  // NEUTRAL_KEYWORDS (used for loud-accent detection) but were missing here,
  // so colorHarmonyPts's per-pair family check fell through to "other" for
  // them and incorrectly penalized e.g. a Gray/Beige/"Natural" outfit GPT
  // called cleanly neutral — keeping the two color vocabularies in sync.
  gold:"neutral", soot:"neutral", oatmeal:"neutral", bone:"neutral",
  natural:"neutral", denim:"neutral", chalk:"neutral", pewter:"neutral",
  graphite:"neutral", heather:"neutral", melange:"neutral", linen:"neutral",
  marine:"neutral", truffle:"neutral", timber:"neutral",
  pastel:"neutral", canyon:"neutral", butter:"neutral", chocolate:"neutral",
  brown:"earth", tan:"earth", beige:"earth", taupe:"earth", camel:"earth",
  khaki:"earth", rust:"earth", carob:"earth", clay:"earth", sand:"earth",
  olive:"earth", mushroom:"earth", mocha:"earth",
  blue:"cool", navy:"cool", indigo:"cool", teal:"cool", cobalt:"cool",
  cyan:"cool", aqua:"cool", turquoise:"cool",
  slate:"cool", powder:"cool", lavender:"cool", purple:"cool",
  red:"warm", orange:"warm", yellow:"warm", coral:"warm", amber:"warm",
  burgundy:"warm", wine:"warm", rose:"warm", pink:"warm",
  green:"green", sage:"green", forest:"green", mint:"green",
  lime:"green", mantis:"green", moss:"green", emerald:"green", army:"green",
  multicolor:"multi", plaid:"multi", tie_dye:"multi",
  // Camo is an intentional military/streetwear aesthetic choice, not random color chaos.
  // Treat it as earth family (olive/khaki tones) so camo pieces don't tank color harmony.
  camo:"earth",
};

function colorFamily(color: string | null | undefined): string {
  if (!color) return "neutral";
  const n = color.toLowerCase().replace(/[-\s]+/g, "");
  if (COLOR_FAMILY_MAP[n]) return COLOR_FAMILY_MAP[n];
  for (const [key, fam] of Object.entries(COLOR_FAMILY_MAP)) {
    if (n.includes(key) || key.includes(n)) return fam;
  }
  return "other";
}

function colorCompatibilityFallback(items: GarmentForScoring[]): number {
  const wearable = items.filter(i => getSlot(i.sub_type) !== "acc");
  if (!wearable.length) return 22;
  const families = wearable.map(i => colorFamily(i.color_primary));
  const distinctNonNeutral = new Set(families.filter(f => f !== "neutral"));
  const hasMulti = families.includes("multi");
  if (hasMulti && distinctNonNeutral.size > 1) return 17; // multicolor + mismatched families — still penalized but not as harsh
  if (hasMulti)                return 18; // single multicolor piece is risky but OK
  if (distinctNonNeutral.size === 0) return 28; // all neutral = monochrome = clean
  if (distinctNonNeutral.size === 1) {
    // Within-family saturation: 3+ wearables in the same non-neutral family with 3+ distinct hues
    // means they're different shades that likely clash (orange + red + neon yellow = all "warm").
    // Monochrome is fine (navy + navy + navy = 1 unique hue), only penalize multi-hue same-family.
    const theFamily = [...distinctNonNeutral][0];
    const sameFam = wearable.filter(i => colorFamily(i.color_primary) === theFamily);
    const uniqueHues = new Set(sameFam.map(i => (i.color_primary ?? "").toLowerCase()));
    if (sameFam.length >= 3 && uniqueHues.size >= 3) return 20;
    return 24; // one accent family + neutrals = cohesive
  }
  if (distinctNonNeutral.size === 2) return 20; // two distinct non-neutral families
  return 17; // 3+ color families — R5 data showed 10 was too harsh (GPT rates these mid not bad)
}

// ---------------------------------------------------------------------------
// Weather-appropriateness penalty (0–25) — applied when tempF is provided
// ---------------------------------------------------------------------------

export function weatherPenalty(items: GarmentForScoring[], tempF: number): number {
  const slots = new Set(items.map(i => getSlot(i.sub_type)).filter(Boolean));
  const hasOuter = slots.has("outer");
  const hasMid   = slots.has("mid");
  const hasOpenFoot = items.some(i => {
    const s = (i.sub_type ?? "").toLowerCase();
    return s.includes("sandal") || s.includes("slide") || s.includes("birken")
        || s.includes("flip") || s.includes("clog") || s.includes("slipper");
  });
  const hasShorts = slots.has("bottom") && items.some(i =>
    (i.sub_type ?? "").toLowerCase().includes("short")
  );

  let penalty = 0;

  if (tempF < 32) {
    if (!hasOuter && !hasMid)  penalty += 20; // bare tee in freezing = wrong
    else if (!hasOuter)        penalty += 10; // hoodie only in freezing = borderline
    else if (!hasMid)          penalty += 4;  // jacket w/o mid = slightly under-layered
    if (hasOpenFoot)           penalty += 18; // sandals in freezing = critical fail
    if (hasShorts)             penalty += 12; // shorts in freezing
  } else if (tempF < 46) {
    if (!hasOuter && !hasMid)  penalty += 14;
    else if (!hasOuter)        penalty += 6;
    if (hasOpenFoot)           penalty += 14;
    if (hasShorts)             penalty += 8;
  } else if (tempF < 55) {
    if (!hasOuter && !hasMid)  penalty += 8;
    if (hasOpenFoot)           penalty += 8;
    if (hasShorts)             penalty += 4;
  } else if (tempF < 63) {
    if (!hasMid && !hasOuter)  penalty += 3;
    if (hasOpenFoot)           penalty += 4;
  } else if (tempF >= 82) {
    if (hasOuter)              penalty += 14; // jacket in summer heat
    if (hasMid)                penalty += 8;  // sweater/hoodie at 82°F+ is uncomfortable
    if (hasMid && tempF >= 90) penalty += 5;  // extra penalty for 90°F+ extreme heat
  } else if (tempF >= 75) {
    if (hasOuter)              penalty += 7;  // jacket at 75–81°F = too warm
    if (hasMid)                penalty += 4;  // sweater at 75–81°F = mildly warm
  }

  return Math.min(penalty, 25);
}

// ---------------------------------------------------------------------------
// OUTFIT SCORE (0–100)
// ---------------------------------------------------------------------------

export function scoreOutfit(
  items: GarmentForScoring[],
  tempF?: number,
  options: { requireFoot?: boolean } = {},
): number {
  if (!items?.length) return 0;

  const wearable = items.filter(i => getSlot(i.sub_type) !== "acc");
  if (!wearable.length) return 0;

  const validity = isValidOutfitCombination(wearable, options);
  if (!validity.valid) return 0;

  // Color harmony (30 pts)
  // When items have explicit pairing/clash data, use the pairing algorithm (starts at 30).
  // When no data exists (scraped products, etc.), use color-name compatibility scoring.
  const hasPairingData = items.some(i =>
    (i.color_pairings?.length ?? 0) > 0 || (i.color_clashes?.length ?? 0) > 0
  );
  let harmonyScore = hasPairingData ? 30 : colorCompatibilityFallback(items);
  if (hasPairingData) {
    for (let i = 0; i < items.length; i++) {
      const aPairings = new Set(items[i].color_pairings || []);
      const aClashes  = new Set(items[i].color_clashes  || []);
      for (let j = i + 1; j < items.length; j++) {
        const bColors = itemColors(items[j]);
        for (const bc of bColors) {
          if (aClashes.has(bc))        harmonyScore -= 6;
          else if (aPairings.has(bc))  harmonyScore += 1;
        }
      }
    }
  }
  const colorHarmonyPts = Math.max(0, Math.min(harmonyScore, 30));

  // Average piece quality (25 pts)
  // Exclude micro-accessories (rings, watches, necklaces) — their generic-brand versions
  // tank scores for otherwise high-quality outfits. These items are invisible styling touches.
  // Word-boundary regex for "ring"/"chain"/"watch" prevents false positives on garment names
  // that contain these substrings (e.g. "harrington", "chain stitch shirt", "watchman cap").
  const isMicroAcc = (item: GarmentForScoring) => {
    const s = (item.sub_type || '').toLowerCase();
    return /\bring\b/.test(s) || s.includes('necklace') || /\bchain\b/.test(s) ||
           s.includes('pendant') || /\bwatch\b/.test(s) || s.includes('bracelet') ||
           s.includes('anklet');
  };
  const scoringItems = items.filter(i => !isMicroAcc(i));
  const pieceScores = scoringItems.map(scorePiece);
  const avgScore = pieceScores.length > 0
    ? pieceScores.reduce((a, b) => a + b, 0) / pieceScores.length
    : 0;
  const avgQualityPts = Math.round((avgScore / 100) * 25);

  // Aesthetic cohesion (22 pts + active incoherence penalty)
  // Exclude micro-accessories — their generic 'casual' tags distort streetwear/minimalist cohesion.
  const tagSets = scoringItems.map(i => new Set((i.aesthetic_tags || []).map(t => t.toLowerCase())));
  const allOutfitTags = [...new Set(scoringItems.flatMap(i => (i.aesthetic_tags || []).map(t => t.toLowerCase())))];
  let aestheticCohesionPts = 0;
  let overlapRatio = 0;
  if (allOutfitTags.length > 0) {
    let sharedPairs = 0, totalPairs = 0;
    for (let i = 0; i < tagSets.length; i++) {
      for (let j = i + 1; j < tagSets.length; j++) {
        totalPairs++;
        if ([...tagSets[i]].some(t => tagSets[j].has(t))) sharedPairs++;
      }
    }
    overlapRatio = totalPairs > 0 ? sharedPairs / totalPairs : 0;
    const avgPrestige = allOutfitTags.reduce((s, t) => s + (TAG_SCORES[t] ?? 1.0), 0) / allOutfitTags.length;
    const prestigeScale = Math.pow(avgPrestige / 3.0, 2);
    aestheticCohesionPts = Math.min(Math.round(overlapRatio * prestigeScale * 22), 22);
  }

  // Aesthetic incoherence penalty — applied as a final multiplier.
  // Items from completely different aesthetic tribes (e.g. workwear Wrangler flannel
  // under prep Harrington) share zero tags → true tribe clash, not just mild mismatch.
  // Penalty tiers (internet-verified: FashionBeans, Art of Manliness, GQ):
  //   0% overlap  with 3+ items → ×0.55  (–45%)  true tribe clash — outright bad look
  //   < 10% overlap              → ×0.70  (–30%)  significant mismatch
  //   < 25% overlap              → ×0.82  (–18%)  mild clash
  let aestheticPenaltyMult = 1.0;
  if (scoringItems.length >= 3) {
    if (overlapRatio === 0)       aestheticPenaltyMult = 0.55;
    else if (overlapRatio < 0.10) aestheticPenaltyMult = 0.70;
    else if (overlapRatio < 0.25) aestheticPenaltyMult = 0.82;
  }

  // Directional outer-base aesthetic clash penalty.
  // Structural rule: when a jacket is present, STRUCTURED base items (polo, flannel,
  // oxford) worn under it must share aesthetic DNA with it — the jacket defines the
  // outfit's register and a collared/patterned top that contradicts it creates a
  // hard visual conflict. (FashionBeans: "opt for fitted layers that match its clean register.")
  //
  // EXCEPTION: plain tees, tanks, and henleys are intentional aesthetic neutrals.
  // A Stussy tee under a prep Harrington is a documented cross-aesthetic contrast
  // (ALD, Noah, Kith all do this); the base layer recedes and lets the jacket define
  // the look. The penalty only fires when the base is itself opinionated (structured/
  // collared/patterned) and clashes with the outer's aesthetic identity.
  const isSimpleBase = (item: GarmentForScoring): boolean => {
    const l = (item.sub_type ?? "").toLowerCase();
    return (
      l.includes("tee") || l.includes("t-shirt") ||
      l.includes("tank") || l.includes("henley") ||
      l.includes("long sleeve") || l.includes("sleeveless") ||
      l.includes("jersey")
    );
  };
  const outerLayer = scoringItems.find(i => getSlot(i.sub_type) === "outer");
  if (outerLayer) {
    const outerTags = new Set((outerLayer.aesthetic_tags ?? []).map(t => t.toLowerCase()));
    const baseLayers = scoringItems.filter(i => getSlot(i.sub_type) === "base");
    for (const baseItem of baseLayers) {
      if (isSimpleBase(baseItem)) continue; // plain tees/tanks are intentional neutrals
      const baseTags = (baseItem.aesthetic_tags ?? []).map(t => t.toLowerCase());
      const hasSharedTag = baseTags.some(t => outerTags.has(t));
      // Require both sides to have ≥2 aesthetic tags before firing — single-tag items
      // are often DB analysis artifacts (e.g. Barbour shirt tagged only [workwear] while
      // its companion Barbour jacket is tagged only [quiet-luxury]). A single contrasting
      // tag per item is too weak a signal to justify the hardest penalty.
      if (!hasSharedTag && outerTags.size >= 2 && baseTags.length >= 2) {
        aestheticPenaltyMult = Math.min(aestheticPenaltyMult, 0.60);
        break;
      }
    }
  }

  // Register mismatch: semi-formal top + athletic bottom creates a texture and
  // register conflict that no footwear can bridge. A structured piqué polo signals
  // smart-casual while track pants/sweatpants signal sportswear — the items are
  // sending contradictory dress codes. (GQ, FashionBeans: avoid mixing dressed-up
  // tops with purely athletic bottoms unless both are slim/tailored.)
  const isSmartCasualTop = (item: GarmentForScoring): boolean => {
    const st = (item.sub_type ?? "").toLowerCase();
    return (
      st.includes("polo") || st.includes("rugby shirt") ||
      st === "oxford shirt" || st === "dress shirt" ||
      st === "linen shirt" || st === "button-down shirt" ||
      st === "button-up shirt"
    );
  };
  const isAthleticBottom = (item: GarmentForScoring): boolean => {
    const st = (item.sub_type ?? "").toLowerCase();
    return st.includes("track pant") || st.includes("sweatpant") ||
           (st.includes("athletic") && st.includes("short"));
  };
  const semiTop = scoringItems.find(i => getSlot(i.sub_type) === "base" && isSmartCasualTop(i));
  const athleticBot = scoringItems.find(i => getSlot(i.sub_type) === "bottom" && isAthleticBottom(i));
  if (semiTop && athleticBot) {
    // Only penalize when the top and bottom share zero aesthetic DNA.
    // A streetwear polo + streetwear track pants = valid (same aesthetic world).
    // A preppy/quiet-luxury polo + generic athletic track pants = register clash.
    const topTags = new Set((semiTop.aesthetic_tags ?? []).map(t => t.toLowerCase()));
    const botTags = (athleticBot.aesthetic_tags ?? []).map(t => t.toLowerCase());
    const hasSharedAesthetic = botTags.some(t => topTags.has(t));
    if (!hasSharedAesthetic) {
      aestheticPenaltyMult = Math.min(aestheticPenaltyMult, 0.75);
    }
  }

  // Pattern overload: 3+ items with a multicolor primary color compete for focal
  // attention — no single element reads clearly. Internet consensus (GQ, FashionBeans):
  // max 2 bold patterns or multicolor pieces per outfit.
  const multicolorCount = scoringItems.filter(
    i => {
      const c = (i.color_primary ?? "").toLowerCase();
      return c.includes("multicolor") || c === "multi";
    }
  ).length;
  if (multicolorCount >= 3) {
    aestheticPenaltyMult = Math.min(aestheticPenaltyMult, 0.70);
  }

  // Isolated-item penalty: an item that shares ZERO aesthetic-tag overlap with EVERY
  // other item in the outfit — a general structural check, not tied to any specific
  // slot pairing like the outer/base or top/bottom checks above. This exists because
  // the overlapRatio-based penalty (line ~920) is an AVERAGE across all pairs, which
  // can stay misleadingly moderate when the rest of the outfit is tightly cohesive
  // with itself and only ONE piece is a genuine outlier: e.g. [tailored blazer(none),
  // streetwear hoodie, streetwear tee, workwear boots] has 3 cohesive pairs among the
  // non-blazer items and only 3 zero-overlap pairs involving the blazer, averaging to
  // a "mild mismatch" overlapRatio even though the blazer itself doesn't belong with
  // anything else in the outfit at all. Untagged items are skipped (no signal either
  // way), and this only applies from 3 items up — with 2 items, an isolated item IS
  // the whole outfit's overlapRatio, already covered by the check above.
  if (scoringItems.length >= 3) {
    const isIsolated = scoringItems.some(item => {
      const itemTags = (item.aesthetic_tags ?? []).map(t => t.toLowerCase());
      if (itemTags.length === 0) return false;
      const itemTagSet = new Set(itemTags);
      return !scoringItems.some(other =>
        other !== item && (other.aesthetic_tags ?? []).some(t => itemTagSet.has(t.toLowerCase()))
      );
    });
    if (isIsolated) aestheticPenaltyMult = Math.min(aestheticPenaltyMult, 0.60);
  }

  // Quality consistency (8 pts)
  const variance = pieceScores.length > 1
    ? pieceScores.reduce((v, s) => v + Math.pow(s - avgScore, 2), 0) / pieceScores.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const baseConsistency = stdDev < 8  ? 8
    : stdDev < 15 ? 6
    : stdDev < 22 ? 4
    : stdDev < 30 ? 2 : 0;
  const qualityScale = Math.min(avgScore / 70, 1);
  const qualityConsistencyPts = Math.round(baseConsistency * qualityScale);

  // Formality consistency (10 pts)
  // When items have explicit formality data, use range-based scoring.
  // When no formality data (scraped products all have null), use aesthetic cohesion as a proxy:
  // incoherent aesthetic mix → low formality score; tight cohesive aesthetic → full score.
  const FORMALITY_IDX: Record<string, number> = { "casual": 0, "smart-casual": 1, "business": 2, "formal": 3 };
  const formalities = items
    .map(i => FORMALITY_IDX[(i.formality || "").toLowerCase()])
    .filter((f): f is number => f !== undefined);
  let formalityPts: number;
  if (formalities.length > 1) {
    const range = Math.max(...formalities) - Math.min(...formalities);
    formalityPts = range === 0 ? 10 : range === 1 ? 7 : range === 2 ? 3 : 0;
  } else {
    formalityPts = aestheticCohesionPts >= 15 ? 10
      : aestheticCohesionPts >= 8 ? 7
      : aestheticCohesionPts >= 3 ? 3
      : 0;
  }

  // Pattern balance (5 pts)
  const patterns = items
    .filter(i => getSlot(i.sub_type) !== "acc")
    .map(i => (i.pattern || "solid").toLowerCase())
    .filter(p => !["solid", "solid-or-other", "other", ""].includes(p));
  const patternPts = patterns.length === 0 ? 2  // no patterns = neutral/clean, not a bonus
    : patterns.length === 1 ? 5
    : patterns.length === 2 ? 2
    : 0;

  let total = colorHarmonyPts + avgQualityPts + aestheticCohesionPts
    + qualityConsistencyPts + formalityPts + patternPts;
  if (tempF !== undefined) total -= weatherPenalty(items, tempF);
  // Aesthetic incoherence penalty (computed above with overlapRatio).
  if (aestheticPenaltyMult < 1.0) total = Math.round(total * aestheticPenaltyMult);
  // Quality-modulated floor: outfits with both very low piece quality AND color chaos
  // (3+ clashing non-neutral families = colorHarmonyPts ≤ 10) are genuinely bad —
  // multiply down so they can't ride the color-harmony floor to mid-tier scores.
  // Threshold avgScore < 35 keeps W2+ (Nike avgScore ≈ 44+) immune.
  if (avgScore < 35 && colorHarmonyPts <= 10) total = Math.round(total * 0.75);

  // Complexity ceiling — simple fits can be cohesive but can't score as high as
  // layered ones. Count intentional extra layers beyond the required base+bottom+foot.
  // This ensures a tee+jeans+sneakers (however clean) is ranked below a well-executed
  // base+mid+outer combo. Caps: 0 extra layers → 78, 1 layer → 87, acc only → 83,
  // 2+ layers or layered+acc → no cap (earns the full 100 ceiling).
  const hasOuterLayer  = wearable.some(i => getSlot(i.sub_type) === "outer");
  const hasMidLayer    = wearable.some(i => getSlot(i.sub_type) === "mid");
  const hasVestLayer   = wearable.some(i => getSlot(i.sub_type) === "vest");
  const hasAccItem     = items.some(i => getSlot(i.sub_type) === "acc");
  const numExtraLayers = (hasOuterLayer ? 1 : 0) + (hasMidLayer ? 1 : 0) + (hasVestLayer ? 1 : 0);
  const isFullyLayered = numExtraLayers >= 2 || (numExtraLayers >= 1 && hasAccItem);
  const complexityCap  =
    isFullyLayered   ? 100 :
    numExtraLayers === 1 ? 87 :
    hasAccItem       ? 83  : 78;

  return Math.max(0, Math.min(Math.round(total), complexityCap));
}

// ---------------------------------------------------------------------------
// PURE AESTHETIC SCORE (0–100) — sibling to scorePiece/scoreOutfit, but with
// all brand-prestige weighting (domainAuthority/brandTier) removed. Answers
// "does this look good on a person" rather than "how prestigious is this
// outfit" — the two are scored and compared separately by design.
// ---------------------------------------------------------------------------

export function scorePieceAesthetic(item: GarmentForScoring): number {
  if (!item) return 0;

  const tags = item.tags as { tier?: string[]; novelty_score?: string[] } | null;
  if (tags?.tier?.[0] === 'novelty') {
    const q = parseInt(tags.novelty_score?.[0] ?? '3', 10);
    return Math.max(1, Math.min(q, 10));
  }
  const isStatement = tags?.tier?.[0] === 'statement';

  const matTier = getMaterialTier(item.material);

  // Material floor (0–40): physical quality of the garment itself.
  // Doubled vs. scorePiece's material floor to fill the points freed up by
  // removing domain authority, keeping this on the same 0–100 scale.
  const MAT_FLOOR: Record<number, number> = { 5: 40, 4: 32, 3: 24, 2: 14, 1: 4 };
  const materialFloor = MAT_FLOOR[matTier] ?? 24;

  // Color versatility (0–30)
  const pairCount  = item.color_pairings?.length ?? 0;
  const clashCount = item.color_clashes?.length ?? 0;
  const colorTotal = pairCount + clashCount;
  const colorPts   = colorTotal > 0 ? Math.round((pairCount / colorTotal) * 30) : 18;

  // Aesthetic context bonus (0–24) — flat per-tag credit for having a defined
  // aesthetic identity at all, NOT weighted by TAG_SCORES genre prestige.
  // Round-2 wider-sample testing showed aestheticScore()'s prestige weighting
  // (high-fashion/quiet-luxury=5.0 vs workwear/athleisure=2.0 vs casual=0.0)
  // was leaking brand/genre-hype into a score the GPT rubric defines as
  // explicitly brand-blind — systematically over-scoring quiet-luxury/
  // high-fashion pieces and under-scoring workwear/athleisure pieces
  // regardless of whether they actually looked good. TAG_SCORES is correctly
  // still used in scorePiece (the GAME/hype score) — just not here.
  const aestheticPts = Math.min((item.aesthetic_tags?.length ?? 0) * 6, 24);

  // Formality flexibility (0–6)
  const FORMALITY_PTS: Record<string, number> = { "smart-casual": 6, "casual": 4, "business": 2, "formal": 2 };
  const formalityPts = FORMALITY_PTS[item.formality?.toLowerCase() ?? ""] ?? 4;

  // Chaotic pattern penalty (-40). Statement-tier items are exempt.
  const patternPenalty = (!isStatement && CHAOTIC_PATTERNS.has((item.pattern ?? "").toLowerCase())) ? -40 : 0;

  // Color chaos penalty (-12): 5+ distinct colors fights most outfit combinations
  const distinctColors    = itemColors(item);
  const colorChaosPenalty = distinctColors.length >= 5 ? -12 : 0;

  const total = materialFloor + colorPts + aestheticPts + formalityPts + patternPenalty + colorChaosPenalty;
  return Math.max(0, Math.min(Math.round(total), 100));
}

export function scoreOutfitAesthetic(items: GarmentForScoring[]): number {
  if (!items?.length) return 0;

  const wearable = items.filter(i => getSlot(i.sub_type) !== "acc");
  if (!wearable.length) return 0;

  const validity = isValidOutfitCombination(wearable);
  if (!validity.valid) return 0;

  // Color harmony (30 pts).
  // Precise DB pairing/clash data is checked per-pair first (specific shade-name
  // matches like "Royal Blue" vs "Royal Blue"), but round-2 testing found this
  // data is sparse: items often list specific shades that don't include the
  // plainer color name (e.g. "Blue", "Black") recorded on the rest of the
  // outfit, so a real clash GPT perceives can have zero precise matches and
  // silently pass through unscored. To stop sparse data from fully masking a
  // real clash, every pair WITHOUT a precise match also gets a lighter
  // generic family-based check (same color-family map as
  // colorCompatibilityFallback) — it downgrades the penalty severity versus a
  // confirmed DB clash (-3 vs -6) rather than replacing it.
  const hasPairingData = items.some(i =>
    (i.color_pairings?.length ?? 0) > 0 || (i.color_clashes?.length ?? 0) > 0
  );
  let harmonyScore = hasPairingData ? 30 : colorCompatibilityFallback(items);
  if (hasPairingData) {
    for (let i = 0; i < items.length; i++) {
      const aPairings = new Set(items[i].color_pairings || []);
      const aClashes  = new Set(items[i].color_clashes  || []);
      const aFamily = colorFamily(items[i].color_primary);
      // Track clash colors already penalized for this item — when multiple j items share
      // the same color (e.g. two Black items both trigger a "clashes with Black" entry),
      // the visual issue is the same one, not twice as bad, so penalize only the first hit.
      const firedClashColors = new Set<string>();
      for (let j = i + 1; j < items.length; j++) {
        const bColors = itemColors(items[j]);
        let matched = false;
        const bFamily = colorFamily(items[j].color_primary);
        for (const bc of bColors) {
          if (aClashes.has(bc)) {
            // Don't apply DB-recorded clash penalties between adjacent-family
            // colors (cool ↔ green), BUT ONLY when the entire outfit palette
            // is consistently within that adjacent zone (all items are
            // neutral/cool/green — no warm/earth/other wildcards muddying
            // the palette). When the outfit already has diverse non-adjacent
            // colors (e.g., an unclassified "Basil" alongside blue and green),
            // the cool+green pair might actually read as MORE discordant in
            // context, so the DB clash is trusted. Testing found that a
            // blue/green casual outfit with only cool+green+neutral palette
            // (gpt:75/good) was getting spurious -6 penalties from the DB,
            // while a Basil/Blue/Black/Green outfit (gpt:60/mid) correctly
            // kept its penalties even after this fix.
            // Multicolor items ("multi" family) have unknown specific hues,
            // so their presence doesn't disqualify the rest of the outfit from
            // the cool+green adjacency exemption — we can't tell if the multi
            // item "muddies" the palette without knowing its actual colors.
            const paletteIsPureCoolGreen = items.every(item => {
              const f = colorFamily(item.color_primary);
              return f === "neutral" || f === "cool" || f === "green" || f === "multi";
            });
            // Earth (brown/tan/camel) and cool (blue/navy) are a recognized
            // harmonious pairing in fashion (brown shirt + denim jeans, camel
            // coat + navy trousers), and DB clash data for these pairs is
            // frequently incorrect. However, this exemption only applies when
            // BOTH items in the pair are core garments (NOT accessories like
            // bags or caps): an earth-toned cap against denim blue jeans can
            // read as disruptive, while a brown shirt + blue jeans is a
            // classic combination. This is the key distinction that was
            // breaking the "camo hat" case (cap = acc-slot → not exempt) while
            // the "linen check shirt + denim" case (base-slot → exempt) needed
            // the fix. Verified: the camo hat's -3 comes from the unmatched-
            // pair family check (not this precise-clash path), so limiting
            // earth-cool exemption to non-acc pairs safely keeps that penalty.
            const paletteIncludesEarth = items.every(item => {
              const f = colorFamily(item.color_primary);
              return f === "neutral" || f === "cool" || f === "green" || f === "earth" || f === "multi";
            });
            const bothNonAcc = getSlot(items[i].sub_type) !== "acc" && getSlot(items[j].sub_type) !== "acc";
            const bcFamily = colorFamily(bc);
            const isAdjacentClash = (paletteIsPureCoolGreen || (paletteIncludesEarth && bothNonAcc))
              && ((aFamily === "cool" && bcFamily === "green") || (aFamily === "green" && bcFamily === "cool")
                || (bothNonAcc && ((aFamily === "earth" && bcFamily === "cool") || (aFamily === "cool" && bcFamily === "earth"))));
            // Same-family DB clashes (e.g. "cyan clashes with blue" — both
            // cool family) are almost certainly false positives: colors within
            // the same family are inherently analogous/harmonious on the color
            // wheel. The DB clash list was generated at the specific-shade
            // level and sometimes over-generalizes (cyan paired with a blue
            // item it considers "competing" at that exact shade, while GPT
            // reads it as cohesive — testing found cyan/blue/green outfit
            // was getting -18 from these DB errors). Only skip for
            // "real" color families (not neutral, other, or multi, since
            // those are too vague to make safe same-family assumptions).
            const REAL_FAMILIES = new Set(["cool", "warm", "green", "earth"]);
            const isSameFamilyClash = REAL_FAMILIES.has(aFamily) && aFamily === bcFamily;
            // A compound two-tone color_primary like "Brown/Black" means the
            // item LITERALLY contains both colors. A DB clash entry saying this
            // item "clashes with Black" is almost certainly a data error — the
            // item can't clash with a color it physically contains. This only
            // applies to explicit compound colors (slash-separated like
            // "Brown/Black", "White/Scarlet") not to shade-modifier names like
            // "Off White" or "Dark Blue" where "White"/"Blue" is a qualifier
            // not a separate color component.
            const ownComponents = (items[i].color_primary || "").toLowerCase().split("/").map(s => s.trim());
            const ownColorContainsClash = ownComponents.length > 1 && ownComponents.includes(bc.toLowerCase().trim());
            if (!isAdjacentClash && !isSameFamilyClash && !ownColorContainsClash) {
              const bcNorm = bc.toLowerCase().trim();
              if (!firedClashColors.has(bcNorm)) {
                firedClashColors.add(bcNorm);
                harmonyScore -= (bcFamily === "multi") ? 3 : 6;
              }
            }
            matched = true;
          } else if (aPairings.has(bc))  { harmonyScore += 1; matched = true; }
        }
        // Bidirectional DB clash check: also evaluate items[j].clashes against items[i]'s
        // primary color. The forward loop only checks items[i].clashes → items[j].colors;
        // when the DB records the clash on j's side for the same pair, it's silently missed.
        // Uses primary only (not itemColors secondary) to avoid false positives from neutral
        // secondaries (e.g., a "White" secondary triggering j's "clashes with White" entry).
        // Guarded by !matched so a pair already scored in the forward pass isn't double-penalized.
        // Reverse clash is only trusted when the SOURCE (j item) has a non-neutral color family.
        // Neutral-family items (gray, natural, white, black) tend to record spurious clash entries
        // for harmonious similar tones — the same conservatism already applied by the unmatched -3
        // gate (which skips non-neutral-family checks for neutral items).
        if (!matched && items[i].color_primary && bFamily !== "neutral") {
          const bClashesRev = new Set(items[j].color_clashes || []);
          const aPrimary = items[i].color_primary as string;
          if (bClashesRev.has(aPrimary)) {
            const acFamily = colorFamily(aPrimary);
            const paletteIsPureCoolGreenR = items.every(item => {
              const f = colorFamily(item.color_primary);
              return f === "neutral" || f === "cool" || f === "green" || f === "multi";
            });
            const paletteIncludesEarthR = items.every(item => {
              const f = colorFamily(item.color_primary);
              return f === "neutral" || f === "cool" || f === "green" || f === "earth" || f === "multi";
            });
            const bothNonAccR = getSlot(items[i].sub_type) !== "acc" && getSlot(items[j].sub_type) !== "acc";
            const isAdjacentClashR = (paletteIsPureCoolGreenR || (paletteIncludesEarthR && bothNonAccR))
              && ((bFamily === "cool" && acFamily === "green") || (bFamily === "green" && acFamily === "cool")
                || (bothNonAccR && ((bFamily === "earth" && acFamily === "cool") || (bFamily === "cool" && acFamily === "earth"))));
            // Includes "neutral" (unlike forward REAL_FAMILIES) so neutral+neutral reverse
            // clashes (e.g. Gray/Natural) are also exempted — neutral tones always harmonize.
            const REAL_FAMILIES_R = new Set(["cool", "warm", "green", "earth", "neutral"]);
            const isSameFamilyClashR = REAL_FAMILIES_R.has(bFamily) && bFamily === acFamily;
            const jOwnComponents = (items[j].color_primary || "").toLowerCase().split("/").map((s: string) => s.trim());
            const acTrimmed = (aPrimary as string).toLowerCase().trim();
            const ownColorContainsClashR = jOwnComponents.length > 1 && jOwnComponents.includes(acTrimmed);
            if (!isAdjacentClashR && !isSameFamilyClashR && !ownColorContainsClashR) {
              harmonyScore -= (acFamily === "multi") ? 3 : 6;
            }
            matched = true;
          }
        }
        if (!matched) {
          // "cool" (blue/navy/teal/purple) and "green" are analogous on the color
          // wheel and read as a cohesive palette together, not a clash — testing
          // found a blue/green casual outfit GPT called "cohesive" (gpt:75/good)
          // was getting penalized here on every blue-vs-green pair even though
          // neither item involved is neutral, so this combination is exempted.
          // cool+green is adjacent (already established). earth+cool (brown/tan +
          // blue/navy) is also recognized as harmonious in fashion (brown shirt +
          // denim jeans, camel coat + navy trousers) — but ONLY when both items
          // are core garments (not accessories). An earth-toned accessory (camo
          // cap, tan bag) against cool-blue pieces CAN read as disruptive, so the
          // adjacency exemption requires both items to be non-acc slot. This
          // mirrors the same constraint already applied in the precise-clash path.
          const bothNonAccUnmatched = getSlot(items[i].sub_type) !== "acc" && getSlot(items[j].sub_type) !== "acc";
          const isAdjacent = (aFamily === "cool" && bFamily === "green") || (aFamily === "green" && bFamily === "cool")
            || (bothNonAccUnmatched && ((aFamily === "earth" && bFamily === "cool") || (aFamily === "cool" && bFamily === "earth")));
          // Items with genuinely unknown colors (color_primary in the missing-value set
          // like "Various", "Unknown") can't be judged against a specific color family —
          // penalizing them for "not matching" a non-neutral family is speculative.
          // Multicolor items in the BOTTOM slot (patterned pants, printed shorts) are a
          // focal styling piece; the accentPenalty already captures their visual complexity
          // and the -3 per unmatched pair double-counts. Outer/acc/base multi items keep
          // the penalty since they interact differently with the rest of the outfit.
          const MISSING_TOKENS_HARMONY = new Set(["", "unknown", "various", "none", "n/a", "not specified", "undefined"]);
          const aColorMissing = MISSING_TOKENS_HARMONY.has((items[i].color_primary || "").toLowerCase().trim());
          const bColorMissing = MISSING_TOKENS_HARMONY.has((items[j].color_primary || "").toLowerCase().trim());
          const aIsMultiBottom = aFamily === "multi" && getSlot(items[i].sub_type) === "bottom";
          const bIsMultiBottom = bFamily === "multi" && getSlot(items[j].sub_type) === "bottom";
          // Multicolor foot items (statement sneakers) by nature blend with any color — they
          // contain many hues so "unmatched family" vs non-neutral items is not a real clash.
          const aIsMultiFoot = aFamily === "multi" && getSlot(items[i].sub_type) === "foot";
          const bIsMultiFoot = bFamily === "multi" && getSlot(items[j].sub_type) === "foot";
          if (aFamily !== "neutral" && bFamily !== "neutral" && aFamily !== bFamily && !isAdjacent
              && !aColorMissing && !bColorMissing
              && !aIsMultiBottom && !bIsMultiBottom
              && !aIsMultiFoot && !bIsMultiFoot) {
            harmonyScore -= 3;
          }
        }
      }
    }
  }
  const colorHarmonyPts = Math.max(0, Math.min(harmonyScore, 30));

  // Average piece quality (25 pts) — using the brand-agnostic piece score
  const isMicroAcc = (item: GarmentForScoring) => {
    const s = (item.sub_type || '').toLowerCase();
    return /\bring\b/.test(s) || s.includes('necklace') || /\bchain\b/.test(s) ||
           s.includes('pendant') || /\bwatch\b/.test(s) || s.includes('bracelet') ||
           s.includes('anklet');
  };
  const scoringItems = items.filter(i => !isMicroAcc(i));
  const pieceScores = scoringItems.map(scorePieceAesthetic);
  const avgScore = pieceScores.length > 0
    ? pieceScores.reduce((a, b) => a + b, 0) / pieceScores.length
    : 0;
  const avgQualityPts = Math.round((avgScore / 100) * 25);

  // Aesthetic cohesion (22 pts) — overlapRatio only, deliberately NOT scaled
  // by TAG_SCORES prestige the way scoreOutfit's game-score cohesion is.
  // Genre prestige is a GAME-score concern; scaling cohesion by it meant a
  // perfectly-matched workwear capsule scored far below a perfectly-matched
  // quiet-luxury capsule on "do these pieces belong together" alone, which
  // the GPT rubric (explicitly brand/prestige-blind) never asks for. Found
  // via round-2 wider-sample testing.
  const tagSets = scoringItems.map(i => new Set((i.aesthetic_tags || []).map(t => t.toLowerCase())));
  const allOutfitTags = [...new Set(scoringItems.flatMap(i => (i.aesthetic_tags || []).map(t => t.toLowerCase())))];
  let aestheticCohesionPts = 0;
  if (allOutfitTags.length > 0) {
    let sharedPairs = 0, totalPairs = 0;
    for (let i = 0; i < tagSets.length; i++) {
      for (let j = i + 1; j < tagSets.length; j++) {
        totalPairs++;
        if ([...tagSets[i]].some(t => tagSets[j].has(t))) sharedPairs++;
      }
    }
    const overlapRatio = totalPairs > 0 ? sharedPairs / totalPairs : 0;
    aestheticCohesionPts = Math.min(Math.round(overlapRatio * 22), 22);
    // When cohesion maxes out (all pairs share some tag) but NO pair shares a
    // genre-specific rare tag — only the ultra-common "quiet-luxury" (72% of
    // catalogue) and/or "streetwear" (59%) are bridging every pair — the
    // cohesion signal isn't actually telling us the outfit has a specific,
    // coherent identity: it just means both items happen to carry the two
    // tags that are on most things in this catalogue. A 3-point deduction is
    // applied ONLY in this narrow case (cohesion at max, no rare tag pair
    // overlap). Outfits that only partially overlap (cohesionPts < 22, e.g.
    // Rick Owens[quiet-luxury] + Kith[streetwear] share nothing — already
    // score lower) are unaffected.
    const COMMON_TAGS = new Set(["quiet-luxury", "streetwear"]);
    // The common-tag correction previously only fired at the maximum (22) but
    // R5 testing found outfits with 5/6 pairs sharing only quiet-luxury/streetwear
    // (aestheticCohesionPts=18) were over-scoring just as much as maxed-out ones.
    // Extending to >=18 catches these near-max common-tag-only overlaps while
    // still letting genuinely cohesive mid-range outfits (with rare tags) score
    // through unaffected. The cap stays at 15 — same reasoning, same limit.
    if (aestheticCohesionPts >= 18) {
      // Does any pair share a tag outside the two ultra-common ones?
      let anyRarePairOverlap = false;
      outer: for (let i = 0; i < tagSets.length; i++) {
        for (let j = i + 1; j < tagSets.length; j++) {
          for (const t of tagSets[i]) {
            if (!COMMON_TAGS.has(t) && tagSets[j].has(t)) { anyRarePairOverlap = true; break outer; }
          }
        }
      }
      // When exactly two items are multicolor-family (vibrant print + vibrant print,
      // e.g. Bode patchwork tee + Casablanca multicolor shorts) the "common-tag only"
      // correction would unfairly downgrade a genuinely eclectic, cohesive palette.
      // GPT rates these multi+multi outfits as vibrant/cohesive (gpt:75/good), not generic.
      const multiItems = scoringItems.filter(i => colorFamily(i.color_primary) === "multi");
      const onlyMultiAndNeutral = scoringItems.every(i => {
        const f = colorFamily(i.color_primary);
        return f === "multi" || f === "neutral";
      });
      const bothSatMultiForCohesion = multiItems.length === 2 && onlyMultiAndNeutral;
      if (!anyRarePairOverlap && !bothSatMultiForCohesion) aestheticCohesionPts = 15;
    }
  }

  // Quality consistency (8 pts)
  const variance = pieceScores.length > 1
    ? pieceScores.reduce((v, s) => v + Math.pow(s - avgScore, 2), 0) / pieceScores.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const baseConsistency = stdDev < 8  ? 8
    : stdDev < 15 ? 6
    : stdDev < 22 ? 4
    : stdDev < 30 ? 2 : 0;
  const qualityScale = Math.min(avgScore / 70, 1);
  const qualityConsistencyPts = Math.round(baseConsistency * qualityScale);

  // Register clash (aesthetic_tags-based) — a backstop for genre/formality whiplash
  // that the explicit `formality` field misses, since formality is null on most
  // streetwear-style pieces (sneakers, shorts, caps, sweatpants) while aesthetic_tags
  // is populated almost everywhere.
  //
  // Two distinct tiers, because a single elevated FOOTWEAR piece (a clean leather
  // boot/loafer) is normal "dress it up" styling against an otherwise casual outfit
  // — footwear is the most common deliberate register-bridging piece — whereas a
  // core garment (blazer, etc.) carrying a pure-elevated tag alongside sport-casual
  // pieces is real whiplash:
  //   SOFT clash: a non-footwear item tagged purely "core-formal" (old-money/
  //     business-casual/preppy — registers with no everyday-casual overlap)
  //     alongside a sport-casual-tagged item (athleisure/streetwear/skate/
  //     gorpcore/techwear/mall-core). Note "quiet-luxury" AND "high-fashion"
  //     are deliberately excluded from this trigger: in this dataset's
  //     tagging convention both co-occur constantly with "streetwear" on the
  //     same pieces/outfits (avant-garde/designer labels like Comme des
  //     Garçons, Maison Margiela, Rick Owens, Kith, Casablanca are tagged
  //     "high-fashion"/"quiet-luxury" but are core to "elevated streetwear,"
  //     not literal formalwear) — round-2 wider-sample testing showed GPT
  //     consistently scores these as cohesive, not clashing, so flagging
  //     either tag against streetwear was a false positive.
  //   HARD clash: any elevated-tagged item (footwear included, quiet-luxury/
  //     high-fashion included) alongside a genuinely technical/performance
  //     piece (Gore-Tex, ripstop, etc. — gear whose register no amount of
  //     "shoes/quiet-luxury can bridge anything" leniency covers).
  const CORE_FORMAL_TAGS = new Set(["old-money", "business-casual", "preppy"]);
  const ELEVATED_TAGS = new Set(["high-fashion", "quiet-luxury", "old-money", "business-casual", "preppy"]);
  const SPORT_CASUAL_TAGS = new Set(["athleisure", "streetwear", "skate", "gorpcore", "techwear", "mall-core"]);
  // Narrower sport set used ONLY for softClash's sport-side detection: excludes
  // "streetwear" because it appears on 59% of all catalogue items, making it
  // nearly as uninformative as "quiet-luxury" (72%) for register discrimination.
  // Keeping "streetwear" in softClash caused false positives on every outfit
  // with an old-money/preppy item alongside a generic "streetwear" piece (e.g.
  // an old-money cardigan + tailored streetwear trousers, GPT:82/good). The
  // genuinely sport-coded tags (athleisure 5.5%, gorpcore 0.1%, techwear 0.4%)
  // are specific enough to signal real register mismatch. SPORT_CASUAL_TAGS
  // (with "streetwear") is kept intact for athleisureClash and sportsLicense-
  // Clash where it correctly classifies items as "sport" vs "elevated."
  // "grunge"/"indie-grunge" added: a garment tagged with counter-cultural/grunge
  // aesthetic identity is a real register clash when paired with CORE_FORMAL
  // (old-money/business-casual/preppy) pieces — R4 testing confirmed S MAX MARA
  // business-casual sweater + KAPITAL indie-grunge jeans (gpt:55/mid) has the
  // same formality friction as a preppy blazer + techwear pants. Only triggers
  // softClash when there's already a CORE_FORMAL_TAGS item present, so a grunge
  // hoodie in an all-streetwear outfit (no CORE_FORMAL) stays unaffected.
  const SOFT_SPORT_TAGS = new Set(["athleisure", "skate", "gorpcore", "techwear", "mall-core", "grunge", "indie-grunge"]);
  // "ripstop"/"cordura" deliberately excluded — round-2 testing found them on
  // common mil-spec-styled casualwear (e.g. cotton ripstop shorts from a
  // workwear-revival brand), not just genuine technical/outdoor gear, so they
  // were flagging ordinary streetwear as a hard performance-gear clash.
  const TECHNICAL_KEYWORDS = ["gore-tex", "goretex", "gore tex", "ballistic nylon", "softshell", "hard shell", "hardshell"];
  const registerOf = (tags: string[] | null | undefined, elevatedSet: Set<string>): "elevated" | "sport" | "neutral" => {
    const lower = (tags || []).map(t => t.toLowerCase());
    const hasElevated = lower.some(t => elevatedSet.has(t));
    const hasSport = lower.some(t => SPORT_CASUAL_TAGS.has(t));
    if (hasElevated && !hasSport) return "elevated";
    if (hasSport && !hasElevated) return "sport";
    return "neutral";
  };
  const isTechnical = (item: GarmentForScoring) => {
    const text = `${item.title || ""} ${item.material || ""}`.toLowerCase();
    return TECHNICAL_KEYWORDS.some(k => text.includes(k));
  };
  const nonFootItems = scoringItems.filter(i => getSlot(i.sub_type) !== "foot");
  // "streetwear" on a BOTTOM garment (jeans, trousers, cargo pants) is
  // near-universal fashion tagging in this catalogue — it doesn't signal a
  // sporty register in the way a track jacket or athletic tee would. Only
  // count "streetwear" as the sport side of a softClash if the item is NOT
  // in the bottom slot; athleisure/gorpcore/etc. count regardless of slot.
  // This prevents "old-money cardigan + streetwear trousers" from triggering
  // a false softClash (GPT consistently calls those outfits cohesive
  // smart-casual, not clashing) while still catching "JIL SANDER blazer +
  // streetwear bomber jacket" where the sport register genuinely shows.
  const hasSoftSport = (item: GarmentForScoring) => {
    const lower = (item.aesthetic_tags || []).map(t => t.toLowerCase());
    if (lower.some(t => CORE_FORMAL_TAGS.has(t))) return false;
    if (lower.some(t => SOFT_SPORT_TAGS.has(t))) return true;
    // A streetwear JACKET or OUTER piece (track jacket, sport bomber) carries
    // a visually significant sport register in an otherwise elevated outfit.
    // A streetwear T-SHIRT under a luxury jacket, however, is normal fashion
    // mixing — athleisure-tagged items already capture "sport-coded tee"
    // separately. Using "outer" instead of "!== bottom" prevents base-slot
    // streetwear tees from triggering softClash against elevated pieces.
    if (lower.includes("streetwear")) return getSlot(item.sub_type) === "outer";
    return false;
  };
  const softClash = nonFootItems.some(i => registerOf(i.aesthetic_tags, CORE_FORMAL_TAGS) === "elevated")
    && nonFootItems.some(i => hasSoftSport(i));
  // hardClash requires the technical piece to also be OUTDOOR/ATHLETIC coded
  // (athleisure, gorpcore) — genuine outdoor gear (Gore-Tex hiking pants,
  // wetsuits) alongside elevated pieces is a real register clash. Fashion
  // techwear (Acronym hardshell tagged streetwear/quiet-luxury, OAMC tech
  // jacket) is intended to be mixed with elevated casual pieces and should
  // NOT trigger hardClash. Confirmed: R1 "Genre collision" items (Goldwin
  // Gore-Tex, XCEL wetsuit) carry "athleisure" tags; fashion techwear like
  // Kith Acronym J47-GT carries only "streetwear,quiet-luxury" tags. This
  // is a genuine data-backed distinction, not a brand-specific rule.
  const OUTDOOR_CODES = new Set(["athleisure", "gorpcore"]);
  const isGenuineOutdoorTech = (item: GarmentForScoring) =>
    isTechnical(item) && (item.aesthetic_tags || []).some(t => OUTDOOR_CODES.has(t.toLowerCase()));
  const hardClash = scoringItems.some(i => registerOf(i.aesthetic_tags, ELEVATED_TAGS) === "elevated")
    && scoringItems.some(isGenuineOutdoorTech);
  // Mild clash: an "athleisure"-tagged item (a genuinely athletic-coded piece —
  // running gear, track pants) against a quiet-luxury/high-fashion item, even
  // though neither softClash (CORE_FORMAL_TAGS excludes quiet-luxury) nor
  // hardClash (requires actual technical material) fires. Unlike "streetwear",
  // which co-occurs with "quiet-luxury" on the same item constantly in this
  // catalogue's tagging convention (the reason it's excluded from softClash),
  // "athleisure" co-occurs with "quiet-luxury" on the same item in only 1 of 76
  // tagged rows — making it a reliable, narrow signal rather than the broad
  // false-positive risk a sub_type-based "looks sporty" rule would carry.
  // Round-2 testing found GPT consistently calls this out as a "slight
  // formality mismatch" (a luxury pant + sports-branded tee + track jacket),
  // landing mid rather than bad — hence a lighter penalty than softClash.
  const athleisureClash = nonFootItems.some(i => registerOf(i.aesthetic_tags, ELEVATED_TAGS) === "elevated")
    && nonFootItems.some(i => (i.aesthetic_tags || []).map(t => t.toLowerCase()).includes("athleisure")
      && registerOf(i.aesthetic_tags, ELEVATED_TAGS) !== "elevated");
  // Same mild-clash pattern as athleisureClash, but for licensed sports-team
  // merchandise (caps/jerseys from New Era, Mitchell & Ness, '47, Pro
  // Standard, Starter) rather than athleisure-tagged apparel. A generic
  // sub_type check ("is this item a cap") was tested and rejected: 75 of this
  // catalogue's headwear items are tagged "streetwear," and the large
  // majority of those also carry "quiet-luxury," so flagging any cap against
  // any quiet-luxury piece reproduced the exact false-positive flood the
  // original CORE_FORMAL_TAGS bug had. These specific licensing brands are
  // categorically different — fan/team merchandise, not fashion-forward
  // headwear — and a direct catalogue count confirms it: only 3 of 50 items
  // from these brands also carry "quiet-luxury" (vs. the ~75% rate for
  // generic "cap" sub_type), so the brand check is a narrow, reliable signal
  // rather than the broad one. Round-2 testing found GPT consistently
  // describing this as a "sporty [cap/tee] clashes with the otherwise
  // [elevated] vibe" — a mild, not severe, mismatch.
  const SPORTS_LICENSE_BRANDS = ["new era", "mitchell & ness", "mitchell and ness", "pro standard", "starter"];
  const isSportsLicensed = (item: GarmentForScoring) => {
    const b = (item.brand || "").toLowerCase();
    return SPORTS_LICENSE_BRANDS.some(k => b.includes(k)) || b === "47" || b.startsWith("47 ") || b.startsWith("'47");
  };
  const sportsLicenseClash = nonFootItems.some(i => registerOf(i.aesthetic_tags, ELEVATED_TAGS) === "elevated")
    && scoringItems.some(isSportsLicensed);
  // Mild clash: an "athleisure"-tagged FOOT item (running sneakers, athletic trainer)
  // alongside a purely elevated non-foot piece (no concurrent sport tags) — a softer
  // version of athleisureClash (body items) since footwear style-bridging is more
  // common. Only fires when no other clash signal already dominates (softClash,
  // athleisureClash, sportsLicenseClash each fire first). R6: NB [athleisure,techwear]
  // with LOEWE [ql,hf] + Jil Sander [ql] — GPT 58/mid, h was 70/good.
  const athleisureClashFoot = !softClash && !athleisureClash
    && scoringItems.some(i =>
        getSlot(i.sub_type) === "foot"
        && (i.aesthetic_tags || []).some(t => t.toLowerCase() === "athleisure")
      )
    && nonFootItems.some(i => {
        const lower = (i.aesthetic_tags || []).map(t => t.toLowerCase());
        return lower.some(t => ELEVATED_TAGS.has(t)) && !lower.some(t => SPORT_CASUAL_TAGS.has(t));
      });

  // Formality consistency (10 pts) — adjacent formality levels are normal styling,
  // not a penalty; only non-adjacent ranges (e.g. formal vs. casual) cost points.
  // This mirrors the same leniency the calibrated GPT judge rubric uses.
  const FORMALITY_IDX: Record<string, number> = { "casual": 0, "smart-casual": 1, "business": 2, "formal": 3 };
  const formalities = items
    .map(i => FORMALITY_IDX[(i.formality || "").toLowerCase()])
    .filter((f): f is number => f !== undefined);
  // When the explicit `formality` field is missing (true for most streetwear-style
  // pieces) and no genuine register whiplash (softClash/hardClash) fired either,
  // there is no positive evidence of a formality conflict — round-2 testing found
  // the old fallback
  // (scaling formalityPts down whenever aestheticCohesionPts was low) was reusing
  // the same weak tag-overlap signal that aestheticCohesionPts already scores on
  // its own 22-pt budget, double-penalizing outfits that mix aesthetic *genres*
  // (workwear/streetwear/quiet-luxury) without any actual formality mismatch
  // (e.g. a polo + jeans + sneakers + bag casual outfit GPT scored 75/good was
  // landing near 48 partly from this). A flat full score here over-corrected in
  // testing (pushed several genuinely GPT-mid outfits to "good"), so the scale
  // is kept but raised — low cohesion still costs a couple points, never the
  // near-total deduction the old 0-floor scale applied.
  let formalityPts: number;
  if (formalities.length > 1) {
    const range = Math.max(...formalities) - Math.min(...formalities);
    formalityPts = range <= 1 ? 10 : range === 2 ? 5 : 0;
  } else if (softClash || hardClash) {
    formalityPts = 0;
  } else if (formalities.length === 1 && scoringItems.some(i =>
    (FORMALITY_IDX[(i.formality || "").toLowerCase()] ?? -1) >= 1 &&
    (getSlot(i.sub_type) === "acc" || getSlot(i.sub_type) === "foot" || getSlot(i.sub_type) === "bottom")
  )) {
    // A single acc-slot item (bag, belt) OR foot-slot item (boots, dress shoes)
    // with an explicit smart-casual/formal formality value among otherwise
    // unspecified-formality pieces signals the piece is dressed up relative to
    // the rest of the outfit. R4 testing: Versace smart-casual shoulder bag in
    // a casual streetwear outfit (gpt:62/mid) was hitting formalityPts=9. R1:
    // GUIDI smart-casual ankle boots in a Dickies/Gramicci/Carhartt workwear
    // outfit (gpt:72/mid) hit formalityPts=9 from cohesion despite the obvious
    // footwear-register gap. formalityPts=5 gives the correct small penalty.
    // Zero regressions across R2/R3/R4 (no other outfits have this pattern).
    formalityPts = 5;
  } else {
    formalityPts = aestheticCohesionPts >= 15 ? 10
      : aestheticCohesionPts >= 8 ? 9
      : aestheticCohesionPts >= 3 ? 7
      : 5;
  }

  // Pattern balance (5 pts)
  const patterns = items
    .filter(i => getSlot(i.sub_type) !== "acc")
    .map(i => (i.pattern || "solid").toLowerCase())
    .filter(p => !["solid", "solid-or-other", "other", ""].includes(p));
  const patternPts = patterns.length === 0 ? 2
    : patterns.length === 1 ? 5
    : patterns.length === 2 ? 2
    : 0;

  // Loud accent-color penalty: a single saturated/bright item (red, purple, etc.)
  // dropped into an otherwise neutral palette reads as visually busy even when
  // nothing technically "clashes" by color_pairings/color_clashes data — this is
  // the "one item is shouting over the rest of the outfit" effect.
  //
  // Classification is keyword-substring based (not exact-match) because the
  // source data has ~280 distinct freeform color strings (e.g. "dusty rose",
  // "olive green", "royal blue") — exact-set matching left most colors
  // unclassified as "wildcard," which silently disabled the penalty on real
  // multicolor clashes (round-2 wider-sample testing surfaced this). Saturated
  // keywords are checked first so vivid modifiers win on compounds like
  // "royal blue" / "electric blue", while plain "blue"/"green" default neutral
  // since most occurrences in this data are denim/olive/workwear tones.
  const SATURATED_KEYWORDS = ["red", "purple", "orange", "yellow", "pink", "magenta", "fuchsia", "lime", "cobalt", "violet", "coral", "turquoise", "cyan", "aqua", "crimson", "scarlet", "raspberry", "rose", "mint", "lilac", "lavender", "peach", "apricot", "plum", "teal", "royal", "electric", "neon", "bright", "vivid", "burgundy", "maroon", "mustard", "berry", "ruby", "multicolor", "multi"];
  const NEUTRAL_KEYWORDS = ["black", "white", "gray", "grey", "beige", "tan", "camel", "charcoal", "navy", "olive", "sage", "cream", "ivory", "brown", "stone", "khaki", "silver", "gold", "soot", "oatmeal", "taupe", "ecru", "bone", "natural", "denim", "chalk", "sand", "ash", "pewter", "graphite", "slate", "truffle", "timber", "heather", "melange", "linen", "marine", "moss", "clay", "blue", "green", "pastel", "canyon", "butter", "chocolate"];
  const MISSING_COLOR_TOKENS = new Set(["", "unknown", "various", "none", "n/a", "not specified", "undefined"]);
  const classifyColor = (raw: string): "saturated" | "neutral" | "wildcard" | "missing" => {
    const c = raw.toLowerCase().trim();
    if (MISSING_COLOR_TOKENS.has(c)) return "missing";
    if (SATURATED_KEYWORDS.some(k => c.includes(k))) return "saturated";
    if (NEUTRAL_KEYWORDS.some(k => c.includes(k))) return "neutral";
    return "wildcard";
  };
  // Titles in this catalogue often carry a trailing colorway the structured
  // color_primary field doesn't capture (e.g. a sneaker titled "...'Bloodline'
  // - Black/Varsity Red" recorded with color_primary "Black" only). An earlier
  // attempt to read this directly was reverted: the same pattern (a neutral
  // color_primary plus a bold accent named in the title) shows up on outfits
  // GPT calls genuinely loud (the Bloodline red against an all-white outfit)
  // AND on outfits GPT calls fine (a mostly-white sneaker with "Brilliant
  // Orange/Rush Blue" accents against an earthy oatmeal/camel outfit) — the
  // deciding factor wasn't the item, it was whether the REST of the outfit had
  // any non-neutral undertone to relate the accent to. A title accent only
  // reads as loud against a strictly neutral (black/white/gray-only) base; an
  // outfit that already has earth/cool/warm/green undertones elsewhere
  // absorbs it. So the title signal is only trusted when colorFamily() shows
  // every item's structured color is neutral — i.e. there's nothing else in
  // the outfit for the accent to contrast against.
  const structuralBaseIsNeutral = scoringItems.every(i => colorFamily(i.color_primary) === "neutral");
  const titleColorwayIsSaturated = (title: string | null | undefined): boolean => {
    const m = (title || "").match(/[-–]\s*([A-Za-z\s/]+)$/);
    if (!m) return false;
    const suffix = m[1].toLowerCase();
    return SATURATED_KEYWORDS.some(k => suffix.includes(k));
  };
  const colorClasses = scoringItems.map(i => {
    const base = classifyColor(i.color_primary || "");
    if (structuralBaseIsNeutral && (base === "neutral" || base === "wildcard") && titleColorwayIsSaturated(i.title)) {
      return "saturated";
    }
    return base;
  }).filter(c => c !== "missing");
  const saturatedCount = colorClasses.filter(c => c === "saturated").length;
  const neutralCount = colorClasses.filter(c => c === "neutral").length;
  // Two distinct failure modes: (a) a single loud item dropped into an
  // otherwise-neutral field (the original "one item is shouting" case), and
  // (b) two or more competing saturated colors regardless of what fraction
  // of the outfit they make up — round-2 testing found cases like "bright
  // green shorts + teal overshirt + burgundy bag" (3 of 5 items saturated)
  // that the original minority-only gate let through uncaught.
  // A saturated BASE-layer item (shirt, tee, tank, blouse — the primary
  // styling piece of the outfit) used as the lone accent against neutral-coded
  // supporting pieces is a recognized, intentional fashion pattern: "statement
  // shirt in a neutral fit." It reads as deliberate rather than accidental.
  // Slots like bottom (shorts, cargo pants), foot (sneakers), acc (bag), and
  // mid (sweater, hoodie) don't carry the same "focal statement piece"
  // assumption, so the penalty still applies there. Earlier attempts at
  // slot-based exemption failed because "sweater" (gpt:60 mid, correctly
  // penalized) was incorrectly assumed to be "base" slot — but
  // getSlot("sweater") = "mid", so the exemption never fires for it; only
  // explicit base-slot items (T-Shirt, Long Sleeve Tee, Polo, Shirt, etc.)
  // are eligible. Confirmed: a Bode red Long Sleeve Tee [base] against a
  // B/W/black-only outfit GPT called "cohesive black/white/red" (gpt:70 good)
  // was scored as bad(50) from this penalty — the sole wrong-verdict cause.
  const soleAccentItem = saturatedCount === 1
    ? scoringItems.find(i => classifyColor(i.color_primary || "") === "saturated"
        || (structuralBaseIsNeutral && titleColorwayIsSaturated(i.title) && (classifyColor(i.color_primary || "") === "neutral" || classifyColor(i.color_primary || "") === "wildcard")))
    : undefined;
  const soleAccentSlot = soleAccentItem ? getSlot(soleAccentItem.sub_type) : null;
  const soleAccentFamily = soleAccentItem ? colorFamily(soleAccentItem.color_primary) : null;
  const soleAccentIsBase = soleAccentSlot === "base";
  const singleAccentClash = saturatedCount === 1
    && !soleAccentIsBase
    && (colorClasses.length - saturatedCount - neutralCount) <= 1;
  const competingBrightsClash = saturatedCount >= 2;
  const loudAccentClash = colorClasses.length > 0 && (singleAccentClash || competingBrightsClash);
  // A "wildcard" color is one our keyword system can't classify (unusual
  // freeform names like "Plaster", "Argon", "Striped", "Checked"). One
  // wildcard is fine — the item might just use an unusual shade name for a
  // normal color. Two or more wildcards in the same outfit typically signals
  // visual complexity (mixed patterns, unusual colorways that may not pair
  // well) that our keyword-based family system can't otherwise detect.
  // Round-3 testing found e.g. a striped shirt + multicolor pants + checked
  // sneakers outfit GPT called "lacks cohesion in pattern and color harmony"
  // (gpt:60/mid) that had no other penalty signals and landed at h:72/good.
  const wildcardCount = colorClasses.filter(c => c === "wildcard").length;
  const preWildcardTotal = colorHarmonyPts + avgQualityPts + aestheticCohesionPts
    + qualityConsistencyPts + formalityPts + patternPts;
  // Only penalize wildcard complexity when the outfit would otherwise land
  // comfortably in the "good" band — penalizing a barely-mid outfit (preTotal
  // below 62) would wrongly push it from mid into bad.
  const wildcardComplexityPenalty = wildcardCount >= 2 && colorClasses.length >= 3 && preWildcardTotal >= 62 ? 8 : 0;
  // When the BASE-slot item (the outfit's focal anchor garment) has a wildcard
  // (unclassifiable) color, the outfit's color foundation is unknowable: we
  // cannot assess whether that anchor color works with the rest of the palette.
  // R1/R2/R3 testing found that EVERY outfit where the base layer carried a
  // wildcard color (designer colorway names like "Plaster", "Waffle", "Basil",
  // "Striped" — none classifiable by keyword) was scored mid (60) by GPT,
  // consistently regardless of other outfit quality signals. The intuition is
  // sound: the base layer IS the color story; when it's visually unknowable,
  // the outfit's palette cohesion can't be confidently assessed as "good."
  // Gate matches wildcardComplexityPenalty: only applied when the outfit would
  // otherwise land in the good band, so a low-preTotal outfit isn't pushed from
  // mid into bad.
  const baseWildcardPenalty = preWildcardTotal >= 62 && scoringItems.some(i =>
    getSlot(i.sub_type) === "base" && classifyColor(i.color_primary || "") === "wildcard"
  ) ? 10 : 0;
  // A multicolor/plaid base-layer item (colorFamily="multi") makes the outfit's
  // anchor piece visually chaotic — the base slot is the color foundation of the
  // fit, and a multicolor pattern there signals complex, unresolvable color
  // interaction that no single-family harmony score captures. Unlike a single-hue
  // saturated shirt (intentional statement), a multicolor shirt is an unpredictable
  // palette generator; R5 testing found 3 outfits with multicolor base items GPT
  // scored mid (58-62) that our zero-penalty logic rated good (70-78).
  const baseMulticolorPenalty = preWildcardTotal >= 62 && scoringItems.some(i =>
    getSlot(i.sub_type) === "base" && colorFamily(i.color_primary || "") === "multi"
  ) ? 10 : 0;
  // Pajama pants (or any sleepwear piece with "pajama" in the title) mixed into
  // a normal clothing outfit introduces a category-level style mismatch that no
  // color or register check can detect: sleepwear is not fashion garments.
  // R4 testing found two outfits featuring Bode Marina Stripe Pajama Pants scored
  // h:70/good despite GPT rating them 35/bad and 55/mid — the item has no unusual
  // color or tag profile (quiet-luxury, Multicolor), so every normal scoring
  // component fires cleanly. The "pajama" title keyword is unambiguous sleepwear.
  // Gate at preTotal≥55 so a barely-mid outfit is never pushed into bad range.
  const pajamaLoungewearPenalty = preWildcardTotal >= 55 && scoringItems.some(i =>
    (i.title || "").toLowerCase().includes("pajama")
  ) ? 12 : 0;
  // Licensed retro sports merchandise ("throwback" in title, e.g. New Era Raiders
  // Throwback Hoodie) carries a fixed team color scheme that is highly unlikely to
  // coordinate with an arbitrary outfit's palette — the item is designed to signal
  // fan identity, not fashion styling. This category-level mismatch is invisible to
  // color/register checks since the item's tags are generic streetwear/athleisure.
  // R1: Raiders Twofer Throwback Hoodie [Two Tone] + gray sweatpants + purple ON
  // sneakers scored h:64/mid despite GPT rating bad/40. "throwback" is used almost
  // exclusively for licensed team merchandise in streetwear/sports contexts.
  // Confirmed zero regressions: only 1 throwback item appears in R1/R2/R3/R4 data
  // (this exact outfit) — no other judged outfits are affected.
  // Throwback fan apparel drops the penalty based on whether the outfit has an
  // elevated anchor item (quiet-luxury/high-fashion WITHOUT concurrent sport tags).
  // GPT consistently rates elevated+throwback outfits as mid (52) vs
  // all-streetwear+throwback outfits as bad (40) — the quality of the other pieces
  // partially salvages the look. An all-streetwear throwback gets the full -25;
  // an elevated context gets -15 + sportsLicenseClash is skipped (the throwback
  // item IS the sports-licensed item, so both penalties target the same thing).
  const throwbackElevatedContext = scoringItems.some(i => {
    const lower = (i.aesthetic_tags || []).map((t: string) => t.toLowerCase());
    return lower.some(t => ELEVATED_TAGS.has(t)) && !lower.some(t => SPORT_CASUAL_TAGS.has(t));
  });
  const throwbackFanApparelPenalty = preWildcardTotal >= 60 && scoringItems.some(i =>
    (i.title || "").toLowerCase().includes("throwback")
  ) ? (throwbackElevatedContext ? 15 : 25) : 0;
  // When a throwback item already tanks the outfit via its 25-pt penalty,
  // additionally applying baseWildcardPenalty (which often fires because the
  // throwback disrupts color harmony → wildcard base reads as unknowable) and
  // the 0.75 multiplier (which fires because the same throwback-caused bad
  // harmony triggers avgScore<35 AND colorHarmonyPts≤10) is triple-counting
  // the same root cause. Skip both when throwback already fired.
  // Also skip when a loudAccentClash is already firing: a wildcard base + loud accent
  // is a color-complexity issue already captured by accentPenalty, so the base-wildcard
  // penalty double-counts the same root cause. R4: Extra Butter[Mauve/wildcard/base] +
  // Bode[Multicolor/bottom/accent] — removing the redundant 10-pt base-wildcard
  // penalty brings h from bad to mid, matching gpt:58/mid.
  const effectiveBaseWildcardPenalty = throwbackFanApparelPenalty > 0 || loudAccentClash ? 0 : baseWildcardPenalty;
  // Genre-tension: a vintage-workwear piece (e.g. COURRÈGES vintage workwear shorts)
  // alongside a quiet-luxury item creates a register mismatch GPT consistently flags
  // as "slight clash" — landing the outfit at mid even when colors are neutral.
  // Only fires when the workwear item itself doesn't carry quiet-luxury (different items).
  const vintageWorkwearItem = scoringItems.find(i => {
    const lower = (i.aesthetic_tags || []).map((t: string) => t.toLowerCase());
    return lower.includes("vintage") && (lower.includes("workwear") || lower.includes("outdoor"));
  });
  // Only applies when no saturated accent piece is present: a bright saturated color
  // creates its own color story that overrides the genre-tension signal. Wildcards
  // (pattern names like "Floral") are allowed — they don't represent competing hues.
  const noSaturatedForGenreTension = colorClasses.every(c => c !== "saturated");
  const vintageWorkwearQLTension = vintageWorkwearItem !== undefined
    && noSaturatedForGenreTension
    && scoringItems.some(i =>
      i !== vintageWorkwearItem &&
      (i.aesthetic_tags || []).some((t: string) => t.toLowerCase() === "quiet-luxury")
    )
    && !(vintageWorkwearItem.aesthetic_tags || []).some((t: string) => t.toLowerCase() === "quiet-luxury")
    ? 5 : 0;
  // Maximalist-genre tension: a maximalist item (no quiet-luxury, no streetwear)
  // alongside quiet-luxury pieces in an all-neutral outfit creates a register mismatch.
  // streetwear exclusion prevents over-penalizing intentional street-maximalist looks
  // (e.g. BALENCIAGA grunge hoodie with streetwear peers).
  const maximalistGenreItem = scoringItems.find(i => {
    const tags = (i.aesthetic_tags || []).map((t: string) => t.toLowerCase());
    return tags.includes("maximalist") && !tags.includes("quiet-luxury") && !tags.includes("streetwear");
  });
  const maximalistGenreQLTension = maximalistGenreItem !== undefined
    && noSaturatedForGenreTension
    && scoringItems.some(i =>
      i !== maximalistGenreItem &&
      (i.aesthetic_tags || []).some((t: string) => t.toLowerCase() === "quiet-luxury")
    )
    ? 8 : 0;
  // Streetwear-only outer in quiet-luxury outfit: an outer item with sport/street tags
  // but no elevated tags worn over an all-quiet-luxury base creates a register split.
  // Analogue of athleisureClashFoot but for outer slot. noSaturatedForGenreTension
  // protects outfits with a vivid color story (saturated items signal intentional mixing).
  const nonOuterScoringItems = scoringItems.filter(i => getSlot(i.sub_type) !== "outer");
  const swOnlyOuterItem = scoringItems.find(i => {
    const slot = getSlot(i.sub_type);
    if (slot !== "outer") return false;
    const tags = (i.aesthetic_tags || []).map(t => t.toLowerCase());
    return tags.some(t => SPORT_CASUAL_TAGS.has(t)) && !tags.some(t => ELEVATED_TAGS.has(t));
  });
  const swOnlyOuterInQLOutfit = swOnlyOuterItem !== undefined
    && noSaturatedForGenreTension
    && nonOuterScoringItems.length > 0
    && nonOuterScoringItems.every(i =>
      (i.aesthetic_tags || []).some((t: string) => t.toLowerCase() === "quiet-luxury")
    )
    ? 8 : 0;
  // Swimwear items (bikini bottoms, swimsuits) are inappropriate in regular styled
  // outfits. GPT consistently gives 25-35 (bad). Title keywords are specific enough
  // to avoid false positives on "Frankies Bikinis" brand-name pants or swim shorts
  // (which can double as casual shorts and GPT rates as mid for outfit purposes).
  // Sub_type "bikini"/"swimwear" catches items explicitly categorized as swimwear.
  // Zero regressions in R1-R7: these keywords matched no R1-R7 outfit items.
  const SWIMWEAR_TITLE_KW = ["bikini bottom", "bikini top", "swimsuit", "swim brief"];
  const SWIMWEAR_SUB_TYPES = new Set(["bikini", "swimwear"]);
  const hasSwimwear = scoringItems.some(i => {
    const titleLower = (i.title || "").toLowerCase();
    const subLower = (i.sub_type || "").toLowerCase();
    return SWIMWEAR_TITLE_KW.some(kw => titleLower.includes(kw)) || SWIMWEAR_SUB_TYPES.has(subLower);
  });
  const swimwearInOutfitPenalty = hasSwimwear ? 30 : 0;
  // Formal/evening wear items categorized as "top" or worn with casual pieces create
  // a severe formality mismatch GPT rates bad (25-35). A maxi dress worn with shorts
  // or athletic shoes is fundamentally wrong. A sequined blazer worn over a casual
  // workwear/vintage outfit is a style catastrophe. Neither keyword triggers on regular
  // fashion items (checked against full R1-R8 catalog — both items existed but appeared
  // in zero R1-R8 outfits). -35 is calibrated to push these outfits into the "bad" range
  // regardless of whatever color/cohesion score the rest of the outfit accumulates.
  const hasFormalwearMismatch = scoringItems.some(i => {
    const tl = (i.title || "").toLowerCase();
    const sl = (i.sub_type || "").toLowerCase();
    return tl.includes("maxi dress") || tl.includes("evening gown") || tl.includes("ball gown")
      || (tl.includes("sequin") && (sl.includes("blazer") || sl.includes("jacket")));
  });
  const formalwearInCasualPenalty = hasFormalwearMismatch ? 35 : 0;
  let total = preWildcardTotal - wildcardComplexityPenalty - effectiveBaseWildcardPenalty - baseMulticolorPenalty - pajamaLoungewearPenalty - throwbackFanApparelPenalty - vintageWorkwearQLTension - maximalistGenreQLTension - swOnlyOuterInQLOutfit - swimwearInOutfitPenalty - formalwearInCasualPenalty;
  if (avgScore < 35 && colorHarmonyPts <= 10 && throwbackFanApparelPenalty === 0) total = Math.round(total * 0.75);
  // Hard clash (technical-material whiplash) is rare and severe; soft clash
  // (core-formal + sport-casual core garments) is more common and, per GPT's
  // round-2 judgments, usually reads as "mid" rather than "bad" — so it gets
  // a lighter penalty than hard clash rather than sharing the same -30.
  // Combined deduction is capped: stacking a full clash penalty with a full
  // accent penalty (e.g. 30+20=50) over-punished outfits GPT only knocked
  // down to "mid," since both penalties are often catching the same
  // underlying disharmony rather than two independent problems.
  // hardClash penalty reduced from 30: technical gear (Gore-Tex/hardshell)
  // mixed with elevated-casual pieces is a STYLE clash but not as catastrophic
  // as the original -30 made it — GPT consistently rates even genuine tech+
  // luxury conflicts around 60-70 (mid-to-good), not below 40 (bad). With the
  // combined cap at 24 the effective deduction was already 24 regardless of
  // whether the raw penalty was 30 or 20, but the formality zeroing (below)
  // additionally punished the pre-penalty total. Keeping formality signal for
  // hardClash means the overall score better reflects GPT's "slightly off
  // genre" judgment rather than treating it like complete outfit failure.
  // When throwback penalty already fired, the throwback item IS typically the
  // sports-licensed item (a team cap, throwback jersey, fan jacket). Counting
  // sportsLicenseClash on top is double-penalizing the same item — skip it.
  const effectiveSportsLicenseClash = sportsLicenseClash && throwbackFanApparelPenalty === 0;
  const clashPenalty = hardClash ? 20 : softClash ? 15 : (athleisureClash || effectiveSportsLicenseClash) ? 12 : athleisureClashFoot ? 5 : 0;
  // Exactly 2 competing saturated colors (vs. 3+, or a single loud accent) is the
  // mildest version of this signal and was double-counting with colorHarmonyPts,
  // which already drops when those same two items don't precisely pair — testing
  // found a cyan top + blue jeans + green/white shoes + multicolor bag outfit GPT
  // called "cohesive" with one item "slightly" disruptive (gpt:70/good) was taking
  // the full -20 on top of an already-reduced colorHarmonyPts. 3+ saturated colors
  // (genuinely busy) and the single-loud-accent case keep the full penalty.
  // When exactly 2 saturated colors are present AND one of them is the base-
  // layer focal piece (shirt, tee, tank — the item that IS the color story),
  // the two together constitute an intentional outfit palette rather than two
  // competing accents; the penalty is lower. When neither saturated item is
  // in the base slot (two accessories, or shorts + bag, both shouting), the
  // 10-pt penalty stands as before.
  const isSaturatedItem = (item: GarmentForScoring) =>
    classifyColor(item.color_primary || "") === "saturated"
    || (structuralBaseIsNeutral && titleColorwayIsSaturated(item.title)
        && (classifyColor(item.color_primary || "") === "neutral" || classifyColor(item.color_primary || "") === "wildcard"));
  const anyBaseLayerSaturated = saturatedCount === 2 && scoringItems.some(i =>
    getSlot(i.sub_type) === "base" && isSaturatedItem(i)
  );
  // When exactly 2 saturated colors are present AND one is a base-layer shirt
  // AND the other is an accessory (bag, belt, etc.), it's an intentional
  // "statement-shirt + accent-piece" combination — the two aren't competing
  // loudness but rather a deliberate primary/secondary palette. GPT scores
  // these as "slightly disrupts" (not a real clash), which our -5 or -10
  // was still over-penalizing. Confirmed: cyan shirt + multicolor bag outfit
  // GPT called "cohesive" (gpt:70/good) with the bag "slightly disrupts" —
  // exactly the "minor accent, not a clash" pattern.
  const baseAndAccSaturated = saturatedCount === 2
    && scoringItems.some(i => getSlot(i.sub_type) === "base" && isSaturatedItem(i))
    && scoringItems.some(i => getSlot(i.sub_type) === "acc" && isSaturatedItem(i));
  // When exactly 2 saturated colors are present AND the base item is classified
  // as "saturated" via the "multi" keyword (e.g. "Navy Multi"), it's actually
  // a multicolor/compound base that creates more visual noise than a solid-hue
  // shirt — the base effectively contributes multiple competing hues. Increasing
  // the penalty from 5 to 7 for this sub-case reflects that.
  const baseSaturatedItemIsMulti = anyBaseLayerSaturated && scoringItems.some(i =>
    getSlot(i.sub_type) === "base" && isSaturatedItem(i) &&
    (i.color_primary || "").toLowerCase().includes("multi")
  );
  // When BOTH competing saturated items are multicolor-family (unknown mixed hues),
  // they aren't two specific clashing hues fighting each other — they're two
  // visually rich pieces that together create eclectic vibrancy. GPT consistently
  // rates multi+multi outfits as "cohesive and vibrant" (e.g. Bode patchwork tee +
  // Casablanca multicolor shorts, gpt:75/good) rather than clashing, so no penalty.
  const bothSaturatedAreMulti = saturatedCount === 2
    && scoringItems.filter(i => isSaturatedItem(i)).every(i => colorFamily(i.color_primary) === "multi");
  // Two multicolor items where one carries workwear and the other carries quiet-luxury
  // (but not workwear) — competing aesthetics within a multi+multi outfit. The base
  // bothSaturatedAreMulti gives 0 penalty assuming multi+multi = vibrant cohesion, but
  // workwear+ql tension breaks that assumption. No regressions in R1-R5 (zero outfits
  // had multi-workwear + multi-ql together).
  const multiItemsForConflict = scoringItems.filter(i => colorFamily(i.color_primary) === "multi");
  // Expanded to include athleisure-without-ql as a conflicting aesthetic:
  // On Multi Sneakers [ath,sw] + Bode Multi bomber [ql,sw] creates the same
  // register tension as workwear+ql. Zero R1-R7 outfits had this ath/ql combo.
  const multiItemsWorkwearQLConflict = bothSaturatedAreMulti
    && multiItemsForConflict.some(i => {
      const tags = (i.aesthetic_tags || []).map(t => t.toLowerCase());
      return tags.includes("workwear") || (tags.includes("athleisure") && !tags.includes("quiet-luxury"));
    })
    && multiItemsForConflict.some(i => {
      const tags = (i.aesthetic_tags || []).map(t => t.toLowerCase());
      return tags.includes("quiet-luxury") && !tags.includes("workwear") && !tags.includes("athleisure");
    });
  // A single saturated ACC-slot item (hat, bag, belt) is by definition an
  // accent piece — that's what accessories do. The "one item is shouting"
  // penalty was designed for a loud GARMENT dominating an otherwise neutral
  // outfit, not for an accent accessory which is expected to add visual
  // interest. Round-3 testing found a multicolor cap in a neutral-palette
  // outfit GPT called "good" (gpt:70) with the cap "not enough to cause a
  // major clash" was taking the full -20, crashing the score to h:50 (mid).
  const soleAccentIsAcc = soleAccentSlot === "acc";
  // A bottom-slot sole accent (colorful jeans, multicolor shorts) with NO
  // other active clash signal is lighter than one alongside a register clash.
  // Restricted to non-multi family: a MULTICOLOR bottom (patterned skirt,
  // printed shorts) adds multiple competing hues and gets the full -20.
  // R5: AYA MUSE Multicolor skirt in a neutral-rest outfit GPT scored 62/mid
  // was getting -7 (soleAccentIsBottomSolo), pushing it to h:72/good.
  const soleAccentIsBottomSolo = soleAccentSlot === "bottom" && clashPenalty === 0
    && soleAccentFamily !== "multi";
  // A MULTICOLOR bottom (jeans/denim) in an all-quiet-luxury outfit. Two tiers:
  // STRICT (10 pts): non-bottom items are PURELY quiet-luxury with no streetwear
  //   mixing — the multicolor jeans genuinely disrupts the clean ql palette.
  //   R6: Sunspel [ql] + Kith Multi Jeans + Casablanca [ql] — GPT 62/mid.
  // GENERAL (5 pts): non-bottom items mix quiet-luxury with streetwear — the
  //   multicolor jeans fits the elevated-streetwear vibe, less disruptive.
  //   R6: Filling Pieces [ql,sw] + Kith Multi Jeans + Adidas [sw,ql] → GPT 75/good;
  //   Ami Paris [ql] + Kith Multi Jeans + Converse [sw,ql] → GPT 75/good.
  const nonBottomScoringItems = scoringItems.filter(i => getSlot(i.sub_type) !== "bottom");
  const soleAccentBottomSubType = (soleAccentItem?.sub_type || "").toLowerCase();
  const soleAccentIsBottomMultiQLStrict = soleAccentSlot === "bottom"
    && soleAccentFamily === "multi"
    && clashPenalty === 0
    && (soleAccentBottomSubType.includes("jean") || soleAccentBottomSubType.includes("denim"))
    && nonBottomScoringItems.length > 0
    && nonBottomScoringItems.every(i => {
      const tags = (i.aesthetic_tags || []).map(t => t.toLowerCase());
      return tags.includes("quiet-luxury") && !tags.includes("streetwear");
    });
  const soleAccentIsBottomMultiQL = !soleAccentIsBottomMultiQLStrict
    && soleAccentSlot === "bottom"
    && soleAccentFamily === "multi"
    && clashPenalty === 0
    && (soleAccentBottomSubType.includes("jean") || soleAccentBottomSubType.includes("denim"))
    && nonBottomScoringItems.length > 0
    && nonBottomScoringItems.every(i =>
        (i.aesthetic_tags || []).map(t => t.toLowerCase()).includes("quiet-luxury")
    );
  // An outer-layer (jacket, coat) MULTICOLOR sole accent is a recognized
  // fashion pattern: a bold printed/multicolor bomber or coat is often the
  // deliberate focal layer over neutral basics. A single-hue colored jacket
  // (lime green, burgundy) reads differently — it's a "one item is shouting"
  // signal — so the reduction ONLY applies when colorFamily=multi (unknown
  // mixed hues). Testing: Bode Multicolor bomber + neutral hoodie/cargo/sneakers
  // GPT rated 70/good, taking full -20 and crashing to h:59/mid. The "Dusted
  // Lime sherpa jacket" (outer, green single-hue, gpt:60/mid) correctly keeps
  // the full penalty since its soleAccentFamily=green ≠ multi.
  const soleAccentIsOuterMulti = soleAccentSlot === "outer" && soleAccentFamily === "multi";
  // A multicolor/saturated sole foot accent (sneakers) in an outfit that already
  // has non-neutral color elsewhere (cool-family tee, earth-tone trousers, etc.)
  // contributes to an existing color story rather than shouting over a clean
  // neutral palette. The full -20 applies when the rest of the outfit is strictly
  // neutral (gray + black, gpt:65/mid for Converse multicolor — correctly mid)
  // while the lighter penalty applies when the outfit already carries warmth or
  // hue (gpt:70/good for GG multicolor sneakers in a blue-camo + denim outfit).
  const soleAccentIsFootNonNeutralBase = soleAccentSlot === "foot"
    && scoringItems.filter(i => getSlot(i.sub_type) !== "foot").some(i => {
      const f = colorFamily(i.color_primary);
      return f !== "neutral" && f !== "other" && f !== "multi";
    });
  // A multicolor/saturated sole foot accent in a consistently streetwear-coded
  // outfit (every non-foot piece carries a "streetwear" tag) is a deliberate
  // part of the aesthetic: statement sneakers over a neutral streetwear fit is
  // the genre's defining styling move. This is distinct from the same sneakers
  // in a quiet-luxury-only outfit where the accent disrupts an otherwise formal
  // palette. R4: Y-3 Multicolor Nizza High in gray hoodie + denim jeans + black
  // socks (all streetwear-tagged, gpt:75/good) got full -20, crashing to h:57.
  // Confirmed non-regression: R2 Converse Multicolor in Rick Owens + KHAITE
  // outfit (quiet-luxury only, NO streetwear in nonFoot items → rule doesn't
  // fire, correctly keeps -20, h:65=gpt:65).
  const nonFootScoringItems = scoringItems.filter(i => getSlot(i.sub_type) !== "foot");
  // Restricted to soleAccentFamily === "multi": single-hue saturated sneakers
  // (e.g. solid Red Jordan 4 in a neutral streetwear outfit, gpt:60/mid) are a
  // genuine color clash and should get the full penalty. Only MULTICOLOR statement
  // sneakers in an all-streetwear outfit qualify as "deliberate styling" that
  // warrants the lighter penalty. R1: Jordan 4 Iced Carmine [Red] in
  // Off-White+Black streetwear outfit was getting -5 here instead of the correct
  // -20, pushing h:56 → h:71 (good vs gpt:60/mid). The two R4 cases this was
  // originally written for (Y-3 Multicolor Nizza, Converse Run Star Multicolor)
  // both have soleAccentFamily=multi and are unaffected.
  const soleAccentIsFootStreetWearFit = soleAccentSlot === "foot"
    && soleAccentFamily === "multi"
    && nonFootScoringItems.length > 0
    && nonFootScoringItems.every(i =>
      (i.aesthetic_tags || []).map(t => t.toLowerCase()).includes("streetwear")
    );
  // When the outfit's COLOR story is anchored by a SATURATED MID-LAYER item
  // (hoodie, sweater, cardigan) and the only other saturated item is the FOOT
  // accent with a MULTI-COLOR (unknown mixed-hue) palette, these aren't two
  // competing colors — the hoodie IS the color statement and the multicolor
  // sneakers complement an already-colorful palette. R4: Mint hoodie (mid) +
  // Green cargo pants (neutral/bottom) + Converse Multicolor (foot) — all
  // green-family — GPT scored 75/good while the -10 competing brights penalty
  // crashed it to h:60/mid. Confirmed no regressions: zero R1/R2/R3 outfits
  // had this specific mid-saturated + foot-multi combination.
  const anyMidLayerFootMulti = saturatedCount === 2
    && scoringItems.some(i => getSlot(i.sub_type) === "mid" && isSaturatedItem(i))
    && scoringItems.some(i => getSlot(i.sub_type) === "foot" && isSaturatedItem(i)
        && colorFamily(i.color_primary) === "multi");
  // A multicolor mid-layer (e.g. Burberry check-stripe jumper) competing with a solid
  // saturated bottom (e.g. ruby shorts) in an all-ql/sw outfit is NOT two competing
  // brights — the multi mid-layer IS the intentional colour story and the saturated
  // bottom is a complementary accent. GPT rates these as good. The -10 penalty for
  // "one of two saturated items is multi" was over-penalizing this deliberate pairing.
  // Zero regressions in R1-R7 confirmed: no outfit had a multi mid-layer + solid sat
  // bottom in an all-ql/sw outfit that GPT rated differently.
  const multiMidLayerInQLSWOutfit = saturatedCount === 2
    && scoringItems.some(i =>
      getSlot(i.sub_type) === "mid" && isSaturatedItem(i) && colorFamily(i.color_primary) === "multi"
    )
    && scoringItems.every(i =>
      (i.aesthetic_tags || []).some(t => ["quiet-luxury","streetwear"].includes(t.toLowerCase()))
    );
  // A STRICTER variant: multicolor foot sole accent in an otherwise pure quiet-luxury
  // outfit (every non-foot item carries "quiet-luxury") where the earth/warm note
  // elsewhere makes the soleAccentIsFootNonNeutralBase condition fire.
  // The multicolor shoe genuinely disrupts the cohesive quiet-luxury neutral palette,
  // so a stronger 10-pt penalty (vs. 5 for the base rule) applies.
  // R6: Maison Margiela Multicolor sneakers + SIMONE ROCHA Brown blazer (earth) +
  // Filling Pieces sweatshirt [ql] + Sunspel trouser [ql] — GPT 58/mid, h was 71/good.
  // R2 Converse case (Rick Owens + KHAITE, not all ql) keeps the base -20.
  const soleAccentIsFootNonNeutralInQLOutfit = soleAccentIsFootNonNeutralBase
    && nonFootScoringItems.length > 0
    && nonFootScoringItems.every(i =>
      (i.aesthetic_tags || []).map(t => t.toLowerCase()).includes("quiet-luxury")
    );
  // A saturated mid-layer item (hoodie, sweater, cardigan) as the sole saturated item
  // in an all-streetwear outfit: the mid-layer IS the intentional color statement in
  // streetwear styling, not a clashing accent. Reduces 20→5 penalty.
  // R8: Yellow Daily Paper sweater + Black track pants + Black Alpha bomber + Cream
  // Y-3 sneakers + Kith bag (all sw-tagged) GPT:78/good was h:57/mid due to full -20.
  // Zero regressions in R1-R7 confirmed.
  const soleAccentIsMidInSWOutfit = soleAccentSlot === "mid"
    && nonFootScoringItems.length > 0
    && nonFootScoringItems.every(i =>
      (i.aesthetic_tags || []).some(t => t.toLowerCase() === "streetwear")
    );
  const accentPenalty = !loudAccentClash ? 0
    : singleAccentClash && soleAccentIsAcc && soleAccentFamily !== "multi" ? 8
    : singleAccentClash && soleAccentIsAcc ? 0
    : singleAccentClash && soleAccentIsOuterMulti ? 10
    : singleAccentClash && soleAccentIsBottomSolo ? 7
    : singleAccentClash && soleAccentIsBottomMultiQLStrict ? 10
    : singleAccentClash && soleAccentIsBottomMultiQL ? 5
    : singleAccentClash && soleAccentIsFootNonNeutralInQLOutfit ? 10
    : singleAccentClash && soleAccentIsFootNonNeutralBase ? 5
    : singleAccentClash && soleAccentIsFootStreetWearFit ? 5
    : singleAccentClash && soleAccentIsMidInSWOutfit ? 5
    : competingBrightsClash && saturatedCount === 2 && multiItemsWorkwearQLConflict ? 10
    : competingBrightsClash && saturatedCount === 2 && bothSaturatedAreMulti ? 0
    : competingBrightsClash && saturatedCount === 2 && baseAndAccSaturated ? 0
    : competingBrightsClash && saturatedCount === 2 && anyMidLayerFootMulti ? 0
    : competingBrightsClash && saturatedCount === 2 && anyBaseLayerSaturated ? (baseSaturatedItemIsMulti ? 7 : 5)
    : competingBrightsClash && saturatedCount === 2 && multiMidLayerInQLSWOutfit ? 0
    : competingBrightsClash && saturatedCount === 2 && !bothSaturatedAreMulti
        && scoringItems.some(i => isSaturatedItem(i) && colorFamily(i.color_primary) === "multi") ? 10
    : competingBrightsClash && saturatedCount === 2 ? 7
    : 20;
  total -= Math.min(clashPenalty + accentPenalty, 24);
  return Math.max(0, Math.min(Math.round(total), 100));
}

// ---------------------------------------------------------------------------
// WARDROBE SCORE (0–100)
// ---------------------------------------------------------------------------

function countValidCombos(items: GarmentForScoring[]): number {
  const bySlot: Record<string, GarmentForScoring[]> = {};
  for (const item of items) {
    const slot = getSlot(item.sub_type);
    if (!slot || slot === "acc") continue;
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(item);
  }
  const B  = (bySlot.base     || []).length;
  const M  = (bySlot.mid      || []).length;
  const V  = (bySlot.vest     || []).length;
  const O  = (bySlot.outer    || []).length;
  const Bo = (bySlot.bottom   || []).length;
  const OP = (bySlot.onepiece || []).length;
  const F  = (bySlot.foot     || []).length;
  if (!F) return 0;
  if (!Bo && !OP) return 0;

  const standardCombos = Bo > 0 ? (
    B * Bo * F * (1 + M) * (1 + V) * (1 + O) +
    M * Bo * F * (1 + V) * (1 + O) +
    O * Bo * F * (1 + V)
  ) : 0;

  const onepieceCombos = OP > 0 ? (
    OP * F * (1 + M) * (1 + V) * (1 + O)
  ) : 0;

  return standardCombos + onepieceCombos;
}

export function scoreWardrobe(items: GarmentForScoring[]): number {
  if (!items?.length) return 0;

  const pieceScores = items.map(scorePiece);
  const avgPiece = pieceScores.reduce((a, b) => a + b, 0) / pieceScores.length;

  // Average piece quality (25 pts)
  const avgQualityPts = Math.round((avgPiece / 100) * 25);

  // Category coverage (20 pts)
  const slots = new Set(items.map(i => getSlot(i.sub_type)).filter(Boolean));
  const hasTopCoverage    = slots.has("base")   || slots.has("onepiece");
  const hasBottomCoverage = slots.has("bottom") || slots.has("onepiece");
  const coverage =
    (hasTopCoverage             ? 5 : 0) +
    (hasBottomCoverage          ? 5 : 0) +
    (slots.has("onepiece")      ? 2 : 0) +
    (slots.has("foot")          ? 4 : 0) +
    (slots.has("outer")         ? 2 : 0) +
    (slots.has("mid")           ? 1 : 0) +
    (slots.has("vest")          ? 1 : 0) +
    (slots.has("acc")           ? 1 : 0);
  const categoryCoveragePts = Math.min(coverage, 20);

  // Color palette cohesion (20 pts)
  // Bidirectional pairing check: color_pairings is AI-inferred per item and not
  // guaranteed to be listed symmetrically on both sides of a pair, so a compatible
  // pair must count if EITHER item lists the other's color — checking only
  // nonAcc[i]'s pairings (as before) silently missed pairs recorded only on the
  // other item, making cohesion depend on array order rather than the wardrobe's
  // actual palette. Mirrors the bidirectional fix already applied to scoreOutfit's
  // clash check for the same underlying reason.
  const nonAcc = items.filter(i => getSlot(i.sub_type) !== "acc");
  let totalPairsW = 0, compatPairsW = 0;
  for (let i = 0; i < nonAcc.length; i++) {
    const aPairings = new Set(nonAcc[i].color_pairings || []);
    const aColors   = itemColors(nonAcc[i]);
    for (let j = i + 1; j < nonAcc.length; j++) {
      if (getSlot(nonAcc[i].sub_type) === getSlot(nonAcc[j].sub_type)) continue;
      totalPairsW++;
      const bColors   = itemColors(nonAcc[j]);
      const bPairings = new Set(nonAcc[j].color_pairings || []);
      const forwardMatch = bColors.some(bc => aPairings.has(bc));
      const reverseMatch = aColors.some(ac => bPairings.has(ac));
      if (forwardMatch || reverseMatch) compatPairsW++;
    }
  }
  const cohesionRatio = totalPairsW > 0 ? compatPairsW / totalPairsW : 0.5;
  const colorCohesionPts = Math.round(cohesionRatio * 20);

  // Outfit potential (15 pts)
  const comboCount = countValidCombos(items);
  const outfitPts = comboCount >= 30 ? 15
    : comboCount >= 20 ? 13
    : comboCount >= 10 ? 10
    : comboCount >= 5  ? 7
    : comboCount >= 2  ? 4
    : comboCount === 1 ? 2 : 0;

  // Quality distribution (10 pts)
  const heroCount     = pieceScores.filter(s => s >= 85).length;
  const workhorsCount = pieceScores.filter(s => s >= 65 && s < 85).length;
  const weakCount     = pieceScores.filter(s => s < 55).length;
  const hasHero       = heroCount >= 1;
  const hasWorkhorses = workhorsCount >= 2;
  const tooManyWeak   = weakCount > items.length * 0.3;
  const distPts = (hasHero ? 5 : 0) + (hasWorkhorses ? 4 : 0) - (tooManyWeak ? 3 : 0);
  const qualityDistPts = Math.max(0, Math.min(distPts, 10));

  // Aesthetic depth (10 pts)
  const allTags = [...new Set(items.flatMap(i => (i.aesthetic_tags || []).map(t => t.toLowerCase())))];
  const tagCounts: Record<string, number> = {};
  for (const item of items) {
    for (const t of item.aesthetic_tags || []) {
      tagCounts[t.toLowerCase()] = (tagCounts[t.toLowerCase()] || 0) + 1;
    }
  }
  const topTagCount = Math.max(...Object.values(tagCounts), 0);
  const dominanceRatio = items.length > 0 ? topTagCount / items.length : 0;
  const wardrobeAestheticScore = aestheticScore(allTags, 6);
  const identityPts = dominanceRatio >= 0.7 ? 4 : dominanceRatio >= 0.5 ? 3 : dominanceRatio >= 0.3 ? 2 : 1;
  const aestheticDepthPts = Math.round(identityPts + Math.min(wardrobeAestheticScore, 6));

  const total = avgQualityPts + categoryCoveragePts + colorCohesionPts
    + outfitPts + qualityDistPts + aestheticDepthPts;
  return Math.min(Math.round(total), 100);
}

// ---------------------------------------------------------------------------
// Outfit generator
// ---------------------------------------------------------------------------

export function generateOutfits(
  items: GarmentForScoring[],
  options: { limit?: number; minScore?: number } = {}
): OutfitResult[] {
  const { limit = 20, minScore = 0 } = options;

  const bySlot: Record<string, GarmentForScoring[]> = {};
  for (const item of items) {
    const slot = getSlot(item.sub_type);
    if (!slot || slot === "acc") continue;
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(item);
  }

  const bases     = bySlot.base     || [];
  const mids      = bySlot.mid      || [];
  const vests     = bySlot.vest     || [];
  const outers    = bySlot.outer    || [];
  const bottoms   = bySlot.bottom   || [];
  const feet      = bySlot.foot     || [];
  const onepieces = bySlot.onepiece || [];

  const outfits: OutfitResult[] = [];
  const seen = new Set<string>();

  const tryAdd = (combo: GarmentForScoring[]) => {
    if (outfits.length >= limit) return;
    const key = [...new Set(combo.map(i => i.id))].sort().join(",");
    if (seen.has(key)) return;
    const wearable = combo.filter(i => getSlot(i.sub_type) !== "acc");
    const validity = isValidOutfitCombination(wearable);
    if (!validity.valid) return;
    const s = scoreOutfit(combo);
    if (s < minScore) return;
    seen.add(key);
    outfits.push({ items: combo, score: s });
  };

  // base-led
  for (const base of shuffled(bases).slice(0, 12)) {
    for (const bottom of shuffled(bottoms).slice(0, 10)) {
      for (const foot of shuffled(feet).slice(0, 6)) {
        tryAdd([base, bottom, foot]);
        for (const mid of shuffled(mids).slice(0, 3)) {
          tryAdd([base, mid, bottom, foot]);
          for (const vest of shuffled(vests).slice(0, 2)) {
            tryAdd([base, mid, vest, bottom, foot]);
            for (const outer of shuffled(outers).slice(0, 2)) {
              tryAdd([base, mid, vest, outer, bottom, foot]);
            }
          }
          for (const outer of shuffled(outers).slice(0, 2)) {
            tryAdd([base, mid, outer, bottom, foot]);
          }
        }
        for (const vest of shuffled(vests).slice(0, 2)) {
          tryAdd([base, vest, bottom, foot]);
          for (const outer of shuffled(outers).slice(0, 2)) {
            tryAdd([base, vest, outer, bottom, foot]);
          }
        }
        for (const outer of shuffled(outers).slice(0, 3)) {
          tryAdd([base, outer, bottom, foot]);
        }
      }
    }
  }

  // mid-led
  for (const mid of shuffled(mids).slice(0, 8)) {
    for (const bottom of shuffled(bottoms).slice(0, 10)) {
      for (const foot of shuffled(feet).slice(0, 6)) {
        tryAdd([mid, bottom, foot]);
        for (const vest of shuffled(vests).slice(0, 2)) {
          tryAdd([mid, vest, bottom, foot]);
          for (const outer of shuffled(outers).slice(0, 2)) {
            tryAdd([mid, vest, outer, bottom, foot]);
          }
        }
        for (const outer of shuffled(outers).slice(0, 3)) {
          tryAdd([mid, outer, bottom, foot]);
        }
      }
    }
  }

  // outer-led
  for (const outer of shuffled(outers).slice(0, 5)) {
    for (const bottom of shuffled(bottoms).slice(0, 10)) {
      for (const foot of shuffled(feet).slice(0, 6)) {
        tryAdd([outer, bottom, foot]);
      }
    }
  }

  // onepiece-led
  for (const op of shuffled(onepieces).slice(0, 8)) {
    for (const foot of shuffled(feet).slice(0, 6)) {
      tryAdd([op, foot]);
      for (const mid of shuffled(mids).slice(0, 4)) {
        tryAdd([op, mid, foot]);
        for (const outer of shuffled(outers).slice(0, 2)) {
          tryAdd([op, mid, outer, foot]);
        }
      }
      for (const vest of shuffled(vests).slice(0, 2)) {
        tryAdd([op, vest, foot]);
      }
      for (const outer of shuffled(outers).slice(0, 3)) {
        tryAdd([op, outer, foot]);
      }
    }
  }

  outfits.sort((a, b) => b.score - a.score);
  return outfits.slice(0, limit);
}
