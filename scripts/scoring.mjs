// MyCloset scoring algorithms: piece, outfit, wardrobe.
// All scores are 0–100.
//
// Design philosophy: "100 streetwear/fashion experts rating this."
// Experts consider: material quality, brand prestige, design specificity
// (pros depth vs cons severity), color versatility, aesthetic identity,
// wearability, and how pieces work together in context.
//
// Everything is algorithmic (no GPT calls) — consistent and reproducible.
//
// Usage:
//   import { scorePiece, scoreOutfit, scoreWardrobe, generateOutfits } from "./scoring.mjs";

// ---------------------------------------------------------------------------
// Layer slots & outfit validity  (unchanged from v1)
// ---------------------------------------------------------------------------

export const LAYER_SLOTS = {
  BASE: "base",     // shirts, tees (worn against skin)
  MID: "mid",       // sweaters, hoodies, cardigans (over base, under vest/outer)
  VEST: "vest",     // sleeveless vest layer (over mid, under outer — shirt+sweater+vest+coat is valid)
  OUTER: "outer",   // jackets, coats (outermost shell)
  BOTTOM: "bottom", // pants, shorts, skirts
  FOOT: "foot",     // shoes, boots, sandals
  ACC: "acc",       // accessories (stack freely)
  ONEPIECE: "onepiece", // dresses, jumpsuits — provide both top and bottom coverage
};

const SUB_TYPE_SLOT = {
  // ── BASE (tops worn closest to skin — shirts, tees, blouses) ─────────────
  "T-Shirt":"base","Graphic Tee":"base","Long Sleeve Tee":"base","Pocket Tee":"base",
  "Polo":"base","Polo Shirt":"base","Rugby Shirt":"base",
  "Oxford Shirt":"base","Flannel Shirt":"base","Camp Collar Shirt":"base","Work Shirt":"base",
  "Henley":"base","Henley Shirt":"base","Linen Shirt":"base","Dress Shirt":"base",
  "Chambray Shirt":"base","Denim Shirt":"base","Printed Shirt":"base","Silk Shirt":"base",
  "Wrap Top":"base","One-Shoulder Top":"base","Asymmetric Top":"base","Sequin Top":"base",
  "Corset Top":"base","Slip Top":"base","Negligé Top":"base","Tank Top":"base","Knit Top":"base",
  "Camisole":"base","Bodysuit":"base","Baseball Tee":"base","Tank":"base","Sleeveless Top":"base",
  "Blouse":"base","Tunic":"base","Crop Top":"base","Bustier":"base","Bra Top":"base",

  // ── MID (worn over base or alone as top — sweaters, hoodies, cardigans) ──
  "Pullover Hoodie":"mid","Zip-Up Hoodie":"mid","Crewneck Sweatshirt":"mid","Zip-Up Sweatshirt":"mid",
  "Cardigan":"mid","Fleece Jacket":"mid",
  // Sweaters — MID: shirts layer underneath, jackets layer over
  "Knitwear":"mid","Crewneck Sweater":"mid","V-Neck Sweater":"mid",
  "Turtleneck":"mid","Turtleneck Sweater":"mid","Mock Neck Sweater":"mid","Mock Neck":"mid",
  "Cable Knit Sweater":"mid","Ribbed Sweater":"mid","Chunky Knit Sweater":"mid","Fair Isle Sweater":"mid",
  "Fisherman Sweater":"mid","Shetland Sweater":"mid",
  // Quarter/half zip
  "Quarter Zip":"mid","Quarter-Zip":"mid","Quarter Zip Pullover":"mid","Quarter-Zip Pullover":"mid",
  "Quarter Zip Sweater":"mid","Quarter-Zip Sweater":"mid","Half Zip":"mid","Half-Zip":"mid",

  // ── VEST (sleeveless mid-layer — own slot so shirt+sweater+vest+coat is valid) ─
  "Vest":"vest","Sweater Vest":"vest","Knit Vest":"vest",
  "Puffer Vest":"vest","Down Vest":"vest","Gilet":"vest","Padded Vest":"vest","Fleece Vest":"vest",

  // ── OUTER (worn over everything — shell/statement layer) ─────────────────
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

  // ── ONEPIECE (replaces both top + bottom — dresses, jumpsuits, etc.) ─────
  "Mini Dress":"onepiece","Midi Dress":"onepiece","Maxi Dress":"onepiece","Wrap Dress":"onepiece",
  "Shirt Dress":"onepiece","Sweater Dress":"onepiece","Bodycon Dress":"onepiece",
  "Slip Dress":"onepiece","Sundress":"onepiece","Shift Dress":"onepiece","A-Line Dress":"onepiece",
  "Floral Dress":"onepiece","Evening Gown":"onepiece","Cocktail Dress":"onepiece",
  "Pinafore Dress":"onepiece","Denim Dress":"onepiece","Smock Dress":"onepiece",
  "Jumpsuit":"onepiece","Wide-Leg Jumpsuit":"onepiece","Slim Jumpsuit":"onepiece",
  "Romper":"onepiece","Playsuit":"onepiece","Boilersuit":"onepiece",
  "Overalls":"onepiece","Dungarees":"onepiece","Denim Overalls":"onepiece",

  // ── BOTTOM ───────────────────────────────────────────────────────────────
  // Jeans
  "Jeans":"bottom","Straight Leg Jeans":"bottom","Slim Jeans":"bottom","Skinny Jeans":"bottom",
  "Wide Leg Jeans":"bottom","Bootcut Jeans":"bottom","Flared Jeans":"bottom","Tapered Jeans":"bottom",
  "Relaxed Jeans":"bottom","Baggy Jeans":"bottom","Cropped Jeans":"bottom",
  // Trousers & pants
  "Trousers":"bottom","Tailored Trousers":"bottom","Wide Leg Trousers":"bottom",
  "Pleated Trousers":"bottom","Cropped Trousers":"bottom","Dress Pants":"bottom","Slacks":"bottom",
  "Cargo Pants":"bottom","Track Pants":"bottom","Sweatpants":"bottom","Joggers":"bottom",
  "Chinos":"bottom","Linen Pants":"bottom","Harem Pants":"bottom","Parachute Pants":"bottom",
  "Corduroy Pants":"bottom","Velvet Trousers":"bottom","Bell Bottoms":"bottom",
  // Shorts
  "Shorts":"bottom","Cargo Shorts":"bottom","Y2K Shorts":"bottom","Denim Shorts":"bottom",
  "Jorts":"bottom","Board Shorts":"bottom","Track Shorts":"bottom","Biker Shorts":"bottom",
  "Chino Shorts":"bottom","Swim Shorts":"bottom","Running Shorts":"bottom",
  // Skirts & legwear
  "Mini Skirt":"bottom","Midi Skirt":"bottom","Maxi Skirt":"bottom","Knee Length Skirt":"bottom",
  "Denim Skirt":"bottom","Pleated Skirt":"bottom","Wrap Skirt":"bottom","A-Line Skirt":"bottom",
  "Pencil Skirt":"bottom","Satin Skirt":"bottom","Leather Skirt":"bottom",
  "Leggings":"bottom","Culottes":"bottom","Palazzos":"bottom",

  // ── FOOT ─────────────────────────────────────────────────────────────────
  // Sneakers
  "Low-Top Sneakers":"foot","High-Top Sneakers":"foot","Running Shoes":"foot","Trail Runners":"foot",
  "Slip-On Sneakers":"foot","Dad Sneakers":"foot","Chunky Sneakers":"foot","Platform Sneakers":"foot",
  "Basketball Sneakers":"foot","Tennis Shoes":"foot","Retro Sneakers":"foot",
  // Boots
  "Chelsea Boots":"foot","Combat Boots":"foot","Work Boots":"foot","Ankle Boots":"foot",
  "Platform Boots":"foot","Knee-High Boots":"foot","Cowboy Boots":"foot","Hiking Boots":"foot",
  "Snow Boots":"foot","Rain Boots":"foot","Riding Boots":"foot","Desert Boots":"foot",
  // Dress shoes
  "Loafers":"foot","Mules":"foot","Sandals":"foot","Slides":"foot",
  "Dress Shoes":"foot","Oxford Shoes":"foot","Derby Shoes":"foot","Monk Straps":"foot",
  "Ballet Flats":"foot","Slingbacks":"foot","Mary Janes":"foot","Brogues":"foot",
  // Casual & specialty
  "Moccasins":"foot","Espadrilles":"foot","Clogs":"foot","Flip Flops":"foot",
  "Heels":"foot","Pumps":"foot","Wedges":"foot","Stilettos":"foot","Block Heels":"foot",
  "Kitten Heels":"foot","Platform Heels":"foot","Approach Shoes":"foot",

  // ── ACC (accessories — stack freely with any valid outfit) ────────────────
  // Bags
  "Pouch":"acc","Mini Shoulder Bag":"acc","Shoulder Bag":"acc","Top Handle Bag":"acc",
  "Crossbody Bag":"acc","Tote Bag":"acc","Backpack":"acc","Belt Bag":"acc","Fanny Pack":"acc",
  "Clutch":"acc","Wristlet":"acc","Messenger Bag":"acc","Satchel":"acc","Hobo Bag":"acc",
  "Duffle Bag":"acc","Mini Bag":"acc","Micro Bag":"acc",
  // Belts & straps
  "Belt":"acc","Leather Belt":"acc","Canvas Belt":"acc","Chain Belt":"acc","Suspenders":"acc",
  // Hats
  "Cap":"acc","Snapback":"acc","Bucket Hat":"acc","Beanie":"acc","Beret":"acc","Visor":"acc",
  "Fedora":"acc","Cowboy Hat":"acc","Balaclava":"acc","Trucker Hat":"acc","Flat Cap":"acc",
  // Watches & jewelry
  "Watch":"acc","Ring":"acc","Necklace":"acc","Chain Necklace":"acc","Pendant Necklace":"acc",
  "Choker":"acc","Bracelet":"acc","Bangle":"acc","Cuff Bracelet":"acc",
  "Earrings":"acc","Earring":"acc","Hoop Earrings":"acc","Stud Earrings":"acc",
  "Earcuff":"acc","Brooch":"acc","Pin":"acc","Cufflinks":"acc","Hair Clip":"acc","Hair Tie":"acc",
  // Eyewear
  "Sunglasses":"acc","Glasses":"acc",
  // Ties & scarves
  "Tie":"acc","Necktie":"acc","Bow Tie":"acc","Silk Tie":"acc","Bolo Tie":"acc","Cravat":"acc",
  "Tie Bar":"acc","Tie Clip":"acc","Pocket Square":"acc",
  "Scarf":"acc","Silk Scarf":"acc","Bandana":"acc","Neck Scarf":"acc",
  // Misc
  "Gloves":"acc","Socks":"acc","Wallet":"acc",
};

export function getSlot(sub_type) {
  if (!sub_type) return null;
  const direct = SUB_TYPE_SLOT[sub_type];
  if (direct) return direct;
  const l = sub_type.toLowerCase();

  // ── ONEPIECE first — catches "Sweater Dress", "Shirt Dress" before sweater/shirt fallbacks
  if (l.includes("dress") || l.includes("jumpsuit") || l.includes("romper") || l.includes("overall") || l.includes("boilersuit") || l.includes("playsuit")) return "onepiece";

  // ── VEST — own slot; check before "puffer"/"jacket" so "Puffer Vest" → vest, not outer
  if (l.includes("vest")) return "vest";
  if (l.includes("hoodie") || l.includes("sweatshirt") || l.includes("cardigan") || l.includes("pullover")) return "mid";
  if (l.includes("sweater") || l.includes("turtleneck") || l.includes("knitwear") || l.includes("mock neck") || l.includes("mockneck")) return "mid";
  if (l.includes("quarter zip") || l.includes("quarter-zip") || l.includes("half zip") || l.includes("half-zip")) return "mid";

  // ── OUTER — "overshirt"/"shacket" BEFORE "shirt" fallback below
  if (l.includes("overshirt") || l.includes("shacket")) return "outer";
  if (l.includes("jacket") || l.includes("trench") || l.includes("blazer") || l.includes("peacoat")) return "outer";
  if (l.includes("overcoat") || l.includes("raincoat") || l.includes("mackintosh")) return "outer";
  if (l.includes("parka") || l.includes("anorak") || l.includes("windbreaker") || l.includes("cagoule") || l.includes("puffer")) return "outer";
  if (l.includes(" coat") || l.startsWith("coat")) return "outer"; // "wool coat", "barn coat", etc.

  // ── BASE — "shirt" safely after overshirt/shacket already caught above
  if (l.includes("shirt") || l.includes("polo") || l.includes("henley") || l.includes("blouse") || l.includes("tunic")) return "base";
  if (l.includes(" tee") || l.startsWith("tee") || l.includes("t-shirt")) return "base";
  if (l.includes("camisole") || l.includes("bodysuit") || l.includes("corset") || l.includes("bustier")) return "base";
  if (l.includes("tank") || l.includes("crop top") || l.includes("bra top")) return "base";
  if ((l.includes("top") || l.includes("blouse")) && !l.includes("bag")) return "base"; // "Wrap Top", "Knit Top" — exclude "Top Handle Bag"

  // ── BOTTOM
  if (l.includes("jeans") || l.includes("denim") && (l.includes("short") || l.includes("skirt"))) return "bottom";
  if (l.includes("trouser") || l.includes("pant") || l.includes("slack") || l.includes("chino")) return "bottom";
  if (l.includes("short") || l.includes("skirt")) return "bottom";
  if (l.includes("legging") || l.includes("jogger") || l.includes("jort") || l.includes("culotte") || l.includes("palazzo") || l.includes("sweatpant")) return "bottom";

  // ── FOOT
  if (l.includes("sneaker") || l.includes("shoe") || l.includes("boot") || l.includes("loafer") || l.includes("sandal")) return "foot";
  if (l.includes("slide") || l.includes("runner") || l.includes("trainer")) return "foot";
  if (l.includes("moccasin") || l.includes("clog") || l.includes("espadrille") || l.includes("slipper") || l.includes("mule")) return "foot";
  if (l.includes("heel") || l.includes("pump") || l.includes("stiletto") || l.includes("wedge")) return "foot";
  if (l.includes("flip") || l.includes("thong")) return "foot"; // flip-flops

  // ── ACC
  if (l.includes("bag") || l.includes("belt") || l.includes("wallet") || l.includes("pouch")) return "acc";
  if (l.includes("hat") || l.includes("cap") || l.includes("beret") || l.includes("beanie") || l.includes("visor") || l.includes("fedora")) return "acc";
  if (l.includes("watch") || l.includes("necklace") || l.includes("bracelet") || l.includes("choker")) return "acc";
  if (l.includes("earring") || l.includes("earcuff") || l.includes("brooch") || l.includes("cufflink")) return "acc";
  if (l.includes("sunglass") || l.includes("glass") || l.includes("spectacle")) return "acc";
  if (l.includes("ring")) return "acc";
  if (l === "tie" || l.endsWith(" tie")) return "acc"; // "bow tie", "bolo tie" — NOT "tie-dye t-shirt"
  if (l.includes("scarf") || l.includes("bandana") || l.includes("glove") || l.includes("mitten")) return "acc";
  if (l.includes("suspender") || l.includes("brace")) return "acc";
  if (l.includes("sock")) return "acc";
  if (l.includes("pocket square") || l.includes("balaclava") || l.includes("snood")) return "acc";

  return null;
}

export function isValidOutfitCombination(items) {
  const slots = items.map(i => getSlot(i.sub_type));
  const slotSet = new Set(slots);

  if (!slotSet.has("foot")) return { valid: false, reason: "Missing footwear" };

  // onepiece provides BOTH top and bottom coverage (dress, jumpsuit, romper, overalls)
  const hasOnepiece = slotSet.has("onepiece");

  // vest alone is not a valid top — requires base, mid, or outer alongside it
  const hasRealTop = slotSet.has("base") || slotSet.has("mid") || slotSet.has("outer") || hasOnepiece;
  const hasBottom = slotSet.has("bottom") || hasOnepiece;

  if (!hasRealTop) return { valid: false, reason: "Missing top layer (vest alone is not a top)" };
  if (!hasBottom) return { valid: false, reason: "Missing bottom" };

  // No duplicate slots — two jackets, two sweaters, etc. is invalid
  // ACC stacks freely; all other slots must appear at most once
  const nonAcc = slots.filter(s => s !== null && s !== "acc");
  const seen = new Set();
  for (const s of nonAcc) {
    if (seen.has(s)) return { valid: false, reason: `Duplicate ${s} layer` };
    seen.add(s);
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Brand prestige (by brand name — DB brand_tier column is unpopulated)
// ---------------------------------------------------------------------------

const LUXURY_BRANDS = new Set([
  // French / Italian heritage houses
  "BALENCIAGA","GIVENCHY","PRADA","GUCCI","SAINT LAURENT","LOEWE","VALENTINO",
  "DIOR","BOTTEGA VENETA","CELINE","HERMÈS","FERRAGAMO","VERSACE","BURBERRY",
  "MCQUEEN","ALEXANDER MCQUEEN","MONCLER","TOM FORD","FENDI","BALMAIN",
  "LANVIN","MARNI","STELLA MCCARTNEY","GIAMBATTISTA VALLI","MISSONI",
  "ROBERTO CAVALLI","MOSCHINO","ETRO","EMILIO PUCCI",
  // Quiet luxury / contemporary luxury
  "THE ROW","LORO PIANA","BRUNELLO CUCINELLI","TOTEME","LEMAIRE",
  "JACQUEMUS","AMI PARIS","SANDRO","ISABEL MARANT","ROHE",
  "STUDIO NICHOLSON","AURALEE","COMOLI","MARGARET HOWELL",
  "MASSIMO ALBA","BOGLIOLI","ZEGNA","ERMENEGILDO ZEGNA",
  // Japanese avant-garde / designer
  "COMME DES GARCONS","COMME DES GARCONS HOMME PLUS","COMME DES GARCONS PARFUMS",
  "YOHJI YAMAMOTO","ISSEY MIYAKE","UNDERCOVER","SACAI","KAPITAL",
  "NEEDLES","NANAMICA","PORTER","VISVIM","WACKO MARIA",
  // Western avant-garde / designer
  "RICK OWENS","ANN DEMEULEMEESTER","RAF SIMONS","DRIES VAN NOTEN",
  "MAISON MARGIELA","MM6 MAISON MARGIELA","JIL SANDER",
  "THOM BROWNE","VIVIENNE WESTWOOD","PAUL SMITH","KENZO","OFF-WHITE",
  "MASTERMIND WORLD","HELMUT LANG","COURRÈGES","ACNE STUDIOS","A-COLD-WALL*",
  // Luxury streetwear / contemporary
  "FEAR OF GOD","CHROME HEARTS","PALM ANGELS","AMIRI","RHUDE","GALLERY DEPT.",
  "MAX MARA","S MAX MARA","PORT TANGER","GUIDI","ANDREA YA AQOV",
  "ROSE BURRITO","NVL GARDE","SSSTEIN","BIJULES","VALEXTRA",
  "VAQUERA","THOM KROM","BRYAN JIMENEZ","COPERNI",
  "44 LABEL GROUP","TRC","VETEMENTS","AMBUSH","1017 ALYX 9SM",
  // Luxury footwear
  "JOHN LOBB","EDWARD GREEN","CROCKETT & JONES","TRICKER'S","CHURCH'S",
  "ALDEN","PARABOOT","BERLUTI","SALVATORE FERRAGAMO",
]);
const PREMIUM_BRANDS = new Set([
  // Athletic / performance
  "Y-3","NIKE","ADIDAS","NEW BALANCE","ASICS","SAUCONY","BROOKS","ON",
  "SALOMON","HOKA","MERRELL","KEEN","COLUMBIA","MAMMUT","SCOTT",
  "UNDER ARMOUR","LULULEMON","VUORI","GYMSHARK",
  // Heritage / outdoor
  "ARC'TERYX","PATAGONIA","THE NORTH FACE","FJÄLLRÄVEN","BARBOUR",
  "BELSTAFF","FILSON","BARACUTA","GRENSON","DR. MARTENS","RED WING",
  // Classic / lifestyle footwear
  "VANS","CONVERSE","BIRKENSTOCK","TIMBERLAND","UGG","NEW BALANCE", // NB already above
  "JORDAN BRAND","CLARKS","CAMPER",
  // Prep / tailored heritage
  "POLO RALPH LAUREN","TOMMY HILFIGER","LACOSTE","FRED PERRY",
  "BROOKS BROTHERS","J.CREW","BANANA REPUBLIC",
  // Contemporary / Scandinavian
  "A.P.C.","CARHARTT WIP","OUR LEGACY","SAMSØE SAMSØE",
  "NORSE PROJECTS","FILIPPA K","COS","ARKET","& OTHER STORIES",
  "WEEKDAY","HOPE","ACNE STUDIOS", // acne is borderline; luxury handles it too
  // Streetwear
  "STÜSSY","SUPREME","PALACE","KITH","NOAH","AIME LEON DORE",
  "BAPE","A BATHING APE","ANTI SOCIAL SOCIAL CLUB","CORTEIZ","CPFM",
  "CACTUS PLANT FLEA MARKET","BRAIN DEAD","MARKET","PATTA",
  "PLEASURES","AWAKE NY","STAMPD","REPRESENT","ACRONYM",
  "HUMAN MADE","NEIGHBORHOOD","WTAPS","FRAGMENT",
  "MONCLER GENIUS","STONE ISLAND","CP COMPANY","LEVI'S","CARHARTT","DICKIES",
]);

// Fast fashion / mass-market brands that should be penalized (not just unknown)
const BUDGET_BRANDS = new Set([
  "ZARA","H&M","SHEIN","PRIMARK","BOOHOO","ASOS","FOREVER 21","FASHION NOVA",
  "TOPSHOP","UNIQLO","GAP","OLD NAVY","TARGET","WALMART","FAST FASHION",
  "PLT","PRETTY LITTLE THING","ROMWE","ZAFUL",
]);

// Returns 1–5 tier
// Tier 2 = UNKNOWN — not penalized, not rewarded. Brand contribution is neutral.
// This is the correct behavior for niche/foreign/indie brands we don't recognize.
// Only explicitly listed budget/fast-fashion brands score tier 1.
export function getBrandTier(brand) {
  if (!brand) return 2;
  const b = brand.toUpperCase().trim();
  if (LUXURY_BRANDS.has(b)) return 5;
  if (PREMIUM_BRANDS.has(b)) return 3;
  if (BUDGET_BRANDS.has(b)) return 1;
  return 2; // unknown: neutral, not penalized
}

// ---------------------------------------------------------------------------
// Material quality tier (1–5)
// ---------------------------------------------------------------------------

const MATERIAL_KEYWORDS = [
  // tier 5 — rarest, most precious materials
  [5, [
    "cashmere","qiviut","vicuña","nappa lambskin","lambskin","naplack",
    "shell cordovan","japanese selvedge","15oz selvedge","13.5oz",
    "silk satin","mulberry silk","merino wool","superfine wool","superfine",
  ]],
  // tier 4 — high-quality naturals and technical premium materials
  [4, [
    "merino","lambswool","wool","silk","linen","leather","suede","nubuck","nappa",
    "camel hair","mohair","alpaca","down","gore-tex","waxed cotton","tweed",
    "canvas duck","ripstop cordura","selvedge denim","boiled wool","double-face",
  ]],
  // tier 3 — quality everyday materials
  [3, [
    "cotton","oxford","twill","canvas","flannel","jersey","fleece","denim",
    "ripstop","tech fabric","woven","knit","cotton jersey","cotton poplin",
    "poplin","cotton blend","polyamide","nylon","mesh","satin","velvet","corduroy",
  ]],
  // tier 2 — synthetic mid-tier
  [2, ["polyester","acrylic","synthetic","performance","recycled","viscose","rayon","spandex","elastane","modal"]],
  // tier 1 — low quality or artificial materials
  [1, ["plastic","rubber","foam","vinyl","pu leather","vegan leather","faux"]],
];

export function getMaterialTier(material) {
  if (!material || ["unknown","n/a","null"].includes(material?.toLowerCase())) return 2;
  const l = material.toLowerCase();
  // Pre-check synthetic leather — must come before the "leather" keyword in tier 4
  if (l.includes("pu ") || l.includes(" pu") || l === "pu" ||
      l.includes("faux") || l.includes("vegan leather") || l.includes("bonded leather")) return 1;
  for (const [tier, keywords] of MATERIAL_KEYWORDS) {
    if (keywords.some(k => l.includes(k))) return tier;
  }
  return 2;
}

// ---------------------------------------------------------------------------
// Aesthetic tag desirability
// Fashion experts rank aesthetics — "high-fashion" signals more than "normcore"
// ---------------------------------------------------------------------------

const TAG_SCORES = {
  "high-fashion":   3.0,
  "quiet-luxury":   3.0,
  "old-money":      2.5,
  "techwear":       2.5,
  "streetwear":     2.5,
  "gorpcore":       2.5,
  "vintage":        2.0,
  "y2k":            2.0,
  "maximalist":     2.0,
  "indie-sleaze":   2.0,
  "punk":           2.0,
  "goth":           2.0,
  "90s":            2.0,
  "grunge":         1.8,
  "skate":          1.8,
  "minimalist":     1.5,
  "athleisure":     1.5,
  "workwear":       1.5,
  "normcore":       1.0,
  "preppy":         1.0,
  "business-casual":1.0,
};

function aestheticScore(tags, cap) {
  if (!tags?.length) return 0;
  const raw = tags.reduce((s, t) => s + (TAG_SCORES[t.toLowerCase()] ?? 1.0), 0);
  return Math.min(raw, cap);
}

// ---------------------------------------------------------------------------
// Pros/cons quality scoring
//
// Pros depth (0–14):
//   We check for QUALITY SIGNALS in the text — specific material mentions,
//   trend references, styling depth, cultural cache, construction details.
//   More signals + more specific (longer) sentences = higher score.
//
// Cons severity (0–8):
//   Categorize each con as generic (price), moderate (care/seasonal),
//   or severe (limited styling range, uncomfortable, hard to style).
//   Fewer and milder cons = higher score.
// ---------------------------------------------------------------------------

// Keywords that indicate a HIGH-QUALITY pro (specific, expert-level).
// These are checked across ALL pros text as a set — each word counts once.
const PRO_QUALITY_SIGNALS = [
  // Material/construction depth
  "cashmere","merino","lambskin","selvedge","gore-tex","crafted","construction",
  "nappa","premium","superior","quality","luxurious","drape","texture",
  "craftsmanship","hardware","stitching","reinforced","double-needle","flatlock",
  // Styling/versatility depth
  "versatile","layering","layers","styling","pairs","outfit","elevated",
  "transitions","seasons","dress up","dress down","monochromatic","color story",
  "effortlessly","multiple ways","year-round",
  // Cultural/trend awareness
  "2025","2026","on-trend","timeless","heritage","legacy","iconic","archive",
  "limited","resale","collector","cultural","collab","aesthetic","investment",
  // Fit/silhouette specificity
  "silhouette","proportion","oversized","relaxed","slim","wide-leg","drapes",
  "elongates","structured","unstructured","dropped shoulder","cropped",
];

// Severe cons signal real design/usability problems
const SEVERE_CON_SIGNALS = [
  "hard to style","difficult to style","limited styling","limited versatility",
  "very specific","narrow styling","limited occasion","only works with",
  "styling challenge","won't transition","looks best only",
  "won't work with","can't pair","fragile","uncomfortable","stiff","poor quality",
  "falls apart","not durable","runs small","runs large","sizing inconsistent",
  "difficult to wear","hard to wear","too bold","too statement",
];

// Moderate cons (care burden, weather limitations, minor usability)
const MODERATE_CON_SIGNALS = [
  "dry clean","hand wash","delicate care","high maintenance","suede in rain",
  "warm weather only","cold weather only","seasonal","limited to","specific to",
  "not for","can't wear in","requires ironing","requires conditioning","careful storage",
  "upkeep","prone to","shows wear","scuffs easily","wrinkles easily",
  "requires alteration","not for everyone","niche",
];


function computeProsConsScore(pros, cons) {
  if (!pros?.length && !cons?.length) return 11; // neutral if no data

  // ── Pros depth (0–14) ──
  let prosScore = 0;
  if (pros?.length) {
    // Count quality signals across ALL pros text
    const allProsText = pros.join(" ").toLowerCase();
    const signalHits = PRO_QUALITY_SIGNALS.filter(s => allProsText.includes(s)).length;

    // Count: ideal is 10+ specific pros
    const countScore = Math.min(pros.length / 10, 1) * 5;
    // Signal density: how many expert signals appear
    const signalScore = Math.min(signalHits / 8, 1) * 6;
    // Avg specificity: longer sentences = more specific detail.
    // Real DB pros average 60-75 chars. 100+ chars = expert-level specificity.
    const avgLen = pros.reduce((s, p) => s + p.length, 0) / pros.length;
    const specificityScore = Math.min(avgLen / 100, 1) * 3;

    prosScore = Math.min(Math.round(countScore + signalScore + specificityScore), 14);
  }

  // ── Cons severity (0–8) ──
  let consScore = 8; // start at max, deduct for cons
  if (cons?.length) {
    let penalty = 0;
    // Severe cons: real design/usability flaws
    const severeCons = cons.filter(c => SEVERE_CON_SIGNALS.some(s => c.toLowerCase().includes(s))).length;
    // Moderate cons: care/seasonal
    const moderateCons = cons.filter(c =>
      !SEVERE_CON_SIGNALS.some(s => c.toLowerCase().includes(s)) &&
      MODERATE_CON_SIGNALS.some(s => c.toLowerCase().includes(s))
    ).length;
    // Generic cons: don't penalize much (every luxury item has price mentions)
    const genericCons = cons.length - severeCons - moderateCons;

    penalty = Math.min(severeCons * 2.0 + moderateCons * 1.0 + genericCons * 0.3, 8);
    consScore = Math.max(0, Math.round(8 - penalty));
  }

  return prosScore + consScore; // 0–22
}

// ---------------------------------------------------------------------------
// ████  PIECE SCORE  (0–100)  ████
//
// Weights calibrated so a perfect luxury item (cashmere, top-tier brand,
// 10 specific pros, 0 severe cons, 20+ pairings, high-fashion tags) = 100.
//
// ┌─────────────────────────────────┬──────┐
// │ Material quality                │  22  │ tier 1→4, 2→8, 3→14, 4→18, 5→22
// │ Brand prestige                  │  18  │ tier 1→3, 2→7, 3→11, 4→15, 5→18
// │ Design quality (pros/cons)      │  22  │ pros depth 14 + cons severity 8
// │ Color versatility               │  20  │ pairings/(pairings+clashes) ratio
// │ Aesthetic desirability          │  14  │ TAG_SCORES sum, capped at 14
// │ Formality utility               │   4  │ smart-casual=4, casual=3, else=2
// └─────────────────────────────────┴──────┘
//                                    = 100
// ---------------------------------------------------------------------------

export function scorePiece(item) {
  if (!item) return 0;

  // Material quality (22 pts)
  const matTier = getMaterialTier(item.material);
  const matPts = [0, 4, 8, 14, 18, 22][Math.min(matTier, 5)];

  // Brand prestige (18 pts)
  // tier 2 = unknown brand = neutral (8pts), not penalized as budget.
  // Only explicitly listed fast-fashion brands (BUDGET_BRANDS) score tier 1 = 2pts.
  const brandTier = getBrandTier(item.brand);
  const brandPts = { 5: 18, 4: 14, 3: 10, 2: 8, 1: 2 }[brandTier] ?? 8;

  // Design quality — pros depth + cons severity (22 pts)
  const designPts = computeProsConsScore(item.pros, item.cons);

  // Color versatility (20 pts)
  // Use stored color_pairings/color_clashes if available (already computed by algorithm)
  const pairCount = item.color_pairings?.length ?? 0;
  const clashCount = item.color_clashes?.length ?? 0;
  const total = pairCount + clashCount;
  const colorPts = total > 0
    ? Math.round((pairCount / total) * 20)
    : 12; // neutral default

  // Aesthetic desirability (14 pts)
  const aestheticPts = Math.round(aestheticScore(item.aesthetic_tags, 14));

  // Formality utility (4 pts) — smart-casual is most versatile, scores highest.
  // Unknown formality defaults to casual (3pts) — a generous neutral, not penalized.
  const formalityPts = { "smart-casual": 4, "casual": 3, "business": 2, "formal": 1 }[
    item.formality?.toLowerCase()
  ] ?? 3;

  const total_score = matPts + brandPts + designPts + colorPts + aestheticPts + formalityPts;
  return Math.min(Math.round(total_score), 100);
}

// ---------------------------------------------------------------------------
// ████  OUTFIT SCORE  (0–100)  ████
//
// "100 fashionistas rating this outfit" weigh:
//   — Do the colors work together? (color harmony)
//   — Are these all quality pieces, and do they complement each other's strengths?
//   — Do they belong to the same aesthetic family?
//   — Is the formality consistent?
//   — Is pattern mixing done tastefully?
//   — Are the proportions/layers done right?
//
// ┌──────────────────────────────────┬──────┐
// │ Color harmony                    │  30  │ stored pairings/clashes between items
// │ Avg piece quality                │  25  │ avg scorePiece() across items
// │ Aesthetic cohesion               │  22  │ tag overlap between items
// │ Quality consistency              │   8  │ low std dev in piece scores = same tier
// │ Formality consistency            │  10  │ same or adjacent formality = no clash
// │ Pattern balance                  │   5  │ 1 hero pattern ideal; 0+ solid is safe
// └──────────────────────────────────┴──────┘
//                                     = 100
// ---------------------------------------------------------------------------

export function scoreOutfit(items) {
  if (!items?.length) return 0;

  const wearable = items.filter(i => getSlot(i.sub_type) !== "acc");
  if (!wearable.length) return 0;

  const validity = isValidOutfitCombination(wearable);
  if (!validity.valid) return 0;

  // ── Color harmony (30 pts) ──
  // For each pair of items, check if their colors clash or pair using stored data
  let harmonyScore = 30;
  for (let i = 0; i < items.length; i++) {
    const aPairings = new Set(items[i].color_pairings || []);
    const aClashes  = new Set(items[i].color_clashes  || []);

    for (let j = i + 1; j < items.length; j++) {
      const bColors = itemColors(items[j]);
      for (const bc of bColors) {
        if (aClashes.has(bc))   harmonyScore -= 6; // color clash between worn items
        else if (aPairings.has(bc)) harmonyScore += 1; // confirmed pair bonus
      }
    }
  }
  const colorHarmonyPts = Math.max(0, Math.min(harmonyScore, 30));

  // ── Average piece quality (25 pts) ──
  // Fashion experts notice quality levels — a great outfit has great pieces
  const pieceScores = items.map(scorePiece);
  const avgScore = pieceScores.reduce((a, b) => a + b, 0) / pieceScores.length;
  // Scale: avg piece score 0-100 → map to 0-25 pts
  const avgQualityPts = Math.round((avgScore / 100) * 25);

  // ── Aesthetic cohesion (22 pts) ──
  // Formula: overlapRatio × (avgPrestige / 3.0)² × 22
  //
  // This means BOTH factors must be high to score well:
  //   – 100% overlap in normcore (1.0 prestige) = 1.0 × 0.11 × 22 = 2pts (low prestige aesthetic)
  //   – 33% overlap in quiet-luxury (3.0 prestige) = 0.33 × 1.0 × 22 = 7pts (high prestige aesthetic)
  //   – 100% overlap in high-fashion (3.0 prestige) = 1.0 × 1.0 × 22 = 22pts (perfect)
  // This prevents normcore uniformity from scoring the same as luxury partial overlap.
  const tagSets = items.map(i => new Set((i.aesthetic_tags || []).map(t => t.toLowerCase())));
  const allOutfitTags = [...new Set(items.flatMap(i => (i.aesthetic_tags || []).map(t => t.toLowerCase())))];
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
    // Average prestige of all unique aesthetic tags across the whole outfit
    const avgPrestige = allOutfitTags.reduce((s, t) => s + (TAG_SCORES[t] ?? 1.0), 0) / allOutfitTags.length;
    const prestigeScale = Math.pow(avgPrestige / 3.0, 2); // non-linear: low prestige = heavy penalty
    aestheticCohesionPts = Math.min(Math.round(overlapRatio * prestigeScale * 22), 22);
  }

  // ── Quality consistency (8 pts) ──
  // Measures how uniform the quality level is — but uniformly LOW quality is NOT a bonus.
  // Scale consistency bonus by quality level so only high-quality uniform outfits score well.
  // Example: Budget items [28,31,20] have low std dev but avg=26 → scale 0.37 → low pts
  //          Luxury items [85,71,56] have higher std dev but avg=71 → scale 1.0 → full pts
  const variance = pieceScores.length > 1
    ? pieceScores.reduce((v, s) => v + Math.pow(s - avgScore, 2), 0) / pieceScores.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const baseConsistency = stdDev < 8  ? 8
    : stdDev < 15 ? 6
    : stdDev < 22 ? 4
    : stdDev < 30 ? 2 : 0;
  // qualityScale: items need avg 70+ to get full consistency bonus; below that it's scaled
  const qualityScale = Math.min(avgScore / 70, 1);
  const qualityConsistencyPts = Math.round(baseConsistency * qualityScale);

  // ── Formality consistency (10 pts) ──
  const FORMALITY_IDX = { "casual": 0, "smart-casual": 1, "business": 2, "formal": 3 };
  const formalities = items
    .map(i => FORMALITY_IDX[(i.formality || "casual").toLowerCase()])
    .filter(f => f !== undefined);
  let formalityPts = 10;
  if (formalities.length > 1) {
    const range = Math.max(...formalities) - Math.min(...formalities);
    formalityPts = range === 0 ? 10 : range === 1 ? 7 : range === 2 ? 3 : 0;
  }

  // ── Pattern balance (5 pts) ──
  // Only count wearable non-acc pieces — a patterned bag/scarf shouldn't limit the hero pattern slot
  const patterns = items
    .filter(i => getSlot(i.sub_type) !== "acc")
    .map(i => (i.pattern || "solid").toLowerCase())
    .filter(p => !["solid", "solid-or-other", "other", ""].includes(p));
  const patternPts = patterns.length === 0 ? 4   // all solid: clean, slight deduction vs hero pattern
    : patterns.length === 1 ? 5                   // one hero pattern: ideal
    : patterns.length === 2 ? 2                   // two patterns: risky
    : 0;                                           // 3+ patterns: chaos

  const total = colorHarmonyPts + avgQualityPts + aestheticCohesionPts
    + qualityConsistencyPts + formalityPts + patternPts;
  return Math.min(Math.round(total), 100);
}

// ---------------------------------------------------------------------------
// ████  WARDROBE SCORE  (0–100)  ████
//
// ┌──────────────────────────────────┬──────┐
// │ Average piece quality            │  25  │ avg scorePiece() of all items
// │ Category coverage                │  20  │ tops / bottoms / shoes / outerwear / acc
// │ Color palette cohesion           │  20  │ items share color pairings (can mix+match)
// │ Outfit potential                 │  15  │ # of valid outfit combos generateable
// │ Quality distribution             │  10  │ has hero pieces (85+) + everyday versatiles
// │ Aesthetic depth                  │  10  │ focused identity OR intentional breadth
// └──────────────────────────────────┴──────┘
//                                     = 100
// ---------------------------------------------------------------------------

export function scoreWardrobe(items) {
  if (!items?.length) return 0;

  const pieceScores = items.map(scorePiece);
  const avgPiece = pieceScores.reduce((a, b) => a + b, 0) / pieceScores.length;

  // ── Average piece quality (25 pts) ──
  const avgQualityPts = Math.round((avgPiece / 100) * 25);

  // ── Category coverage (20 pts) ──
  const slots = new Set(items.map(i => getSlot(i.sub_type)).filter(Boolean));
  // onepiece (dress/jumpsuit) provides credit for both tops and bottoms
  const hasTopCoverage    = slots.has("base")   || slots.has("onepiece");
  const hasBottomCoverage = slots.has("bottom") || slots.has("onepiece");
  const coverage =
    (hasTopCoverage             ? 5 : 0) +
    (hasBottomCoverage          ? 5 : 0) +
    (slots.has("onepiece")      ? 2 : 0) + // bonus: dress/jumpsuit versatility
    (slots.has("foot")          ? 4 : 0) +
    (slots.has("outer")         ? 2 : 0) +
    (slots.has("mid")           ? 1 : 0) +
    (slots.has("vest")          ? 1 : 0) +
    (slots.has("acc")           ? 1 : 0);
  const categoryCoveragePts = Math.min(coverage, 20);

  // ── Color palette cohesion (20 pts) ──
  // How well do the wardrobe colors cross-pair?
  // Use stored color_pairings to check compatibility across items.
  // Bidirectional: color_pairings is AI-inferred per item and not guaranteed to be
  // listed symmetrically, so a pair counts as compatible if EITHER item lists the
  // other's color — checking only nonAcc[i]'s pairings made cohesion depend on
  // array order rather than the wardrobe's actual palette.
  const nonAcc = items.filter(i => getSlot(i.sub_type) !== "acc");
  let totalPairs = 0, compatPairs = 0;
  for (let i = 0; i < nonAcc.length; i++) {
    const aPairings = new Set(nonAcc[i].color_pairings || []);
    const aColors   = itemColors(nonAcc[i]);
    for (let j = i + 1; j < nonAcc.length; j++) {
      if (getSlot(nonAcc[i].sub_type) === getSlot(nonAcc[j].sub_type)) continue; // same slot = can't pair
      totalPairs++;
      const bColors   = itemColors(nonAcc[j]);
      const bPairings = new Set(nonAcc[j].color_pairings || []);
      const forwardMatch = bColors.some(bc => aPairings.has(bc));
      const reverseMatch = aColors.some(ac => bPairings.has(ac));
      if (forwardMatch || reverseMatch) compatPairs++;
    }
  }
  const cohesionRatio = totalPairs > 0 ? compatPairs / totalPairs : 0.5;
  const colorCohesionPts = Math.round(cohesionRatio * 20);

  // ── Outfit potential (15 pts) ──
  // Count valid slot combinations deterministically (no random ordering).
  // More items per slot × more slots covered = exponentially more outfits.
  const comboCount = countValidCombos(items);
  const outfitPts = comboCount >= 30 ? 15
    : comboCount >= 20 ? 13
    : comboCount >= 10 ? 10
    : comboCount >= 5  ? 7
    : comboCount >= 2  ? 4
    : comboCount === 1 ? 2 : 0;

  // ── Quality distribution (10 pts) ──
  // Best wardrobes have hero pieces (85+) AND everyday workhorses (60-80)
  // Mono-quality (all 90+ or all 50-60) is less interesting
  const heroCount     = pieceScores.filter(s => s >= 85).length;
  const workhorsCount = pieceScores.filter(s => s >= 65 && s < 85).length;
  const weakCount     = pieceScores.filter(s => s < 55).length;
  const hasHero       = heroCount >= 1;
  const hasWorkhorses = workhorsCount >= 2;
  const tooManyWeak   = weakCount > items.length * 0.3;
  const distPts = (hasHero ? 5 : 0) + (hasWorkhorses ? 4 : 0) - (tooManyWeak ? 3 : 0);
  const qualityDistPts = Math.max(0, Math.min(distPts, 10));

  // ── Aesthetic depth (10 pts) ──
  // Focused (1-2 clear aesthetics) = strong identity
  // Broad but cohesive (3-4 aesthetics that share DNA) = curated
  // Scattered (6+ unrelated aesthetics) = no identity
  const allTags = [...new Set(items.flatMap(i => (i.aesthetic_tags || []).map(t => t.toLowerCase())))];
  // Count items with the most common tag — if 80%+ share one tag, that's strong identity
  const tagCounts = {};
  for (const item of items) {
    for (const t of item.aesthetic_tags || []) {
      tagCounts[t.toLowerCase()] = (tagCounts[t.toLowerCase()] || 0) + 1;
    }
  }
  const topTagCount = Math.max(...Object.values(tagCounts), 0);
  const dominanceRatio = items.length > 0 ? topTagCount / items.length : 0;
  // Prestige-weighted aesthetic score
  const wardrobeAestheticScore = aestheticScore(allTags, 6);
  const identityPts = dominanceRatio >= 0.7 ? 4 : dominanceRatio >= 0.5 ? 3 : dominanceRatio >= 0.3 ? 2 : 1;
  const aestheticDepthPts = Math.round(identityPts + Math.min(wardrobeAestheticScore, 6));

  const total = avgQualityPts + categoryCoveragePts + colorCohesionPts
    + outfitPts + qualityDistPts + aestheticDepthPts;
  return Math.min(Math.round(total), 100);
}

// ---------------------------------------------------------------------------
// Outfit generator (random combinations, ranked by outfit score)
// ---------------------------------------------------------------------------
// Deterministic combination counter for wardrobe outfit potential.
// Counts how many distinct valid base+bottom+foot combinations exist,
// including optional mid/outer layering. No randomness.
// ---------------------------------------------------------------------------

function countValidCombos(items) {
  const bySlot = {};
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

  // Standard outfits — any combination of (base? + mid? + vest? + outer?) with bottom + foot.
  // Valid if at least one of base/mid/outer is present (vest alone is not a top).
  // Formula: enumerate all (±base) × (±mid) × (±vest) × (±outer) combos that have ≥1 real top.
  // = (1+B)(1+M)(1+V)(1+O) - cases with NO base/mid/outer (only vest, or nothing)
  //
  // But vest requires a real top, so subtract vest-only cases:
  // All combos = (1+B)(1+M)(1+V)(1+O) per (bottom, foot) pair
  // Invalid top combos = those with 0 base, 0 mid, 0 outer = (1)(1)(1+V)(1) = 1 + V
  // Valid combos per (bottom, foot) = (1+B)(1+M)(1+V)(1+O) - (1+V) - 1 (the no-top-at-all case)
  // Simpler: base-led + mid-led + outer-led
  const standardCombos = Bo > 0 ? (
    B * Bo * F * (1 + M) * (1 + V) * (1 + O) +  // base as primary top (±mid, ±vest, ±outer)
    M * Bo * F * (1 + V) * (1 + O) +              // mid as sole top (±vest, ±outer)
    O * Bo * F * (1 + V)                           // outer as sole top (±vest beneath)
  ) : 0;

  // One-piece outfits — dress/jumpsuit provides top+bottom; layer mid/vest/outer optionally
  const onepieceCombos = OP > 0 ? (
    OP * F * (1 + M) * (1 + V) * (1 + O)
  ) : 0;

  return standardCombos + onepieceCombos;
}

// ---------------------------------------------------------------------------

export function generateOutfits(items, options = {}) {
  const { limit = 20, minScore = 0 } = options;

  const bySlot = {};
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

  const outfits = [];
  const seen = new Set();

  const tryAdd = (combo) => {
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

  // ── base-led: shirt/tee as primary, ±mid, ±vest, ±outer
  for (const base of shuffled(bases).slice(0, 12)) {
    for (const bottom of shuffled(bottoms).slice(0, 10)) {
      for (const foot of shuffled(feet).slice(0, 6)) {
        tryAdd([base, bottom, foot]);
        for (const mid of shuffled(mids).slice(0, 3)) {
          tryAdd([base, mid, bottom, foot]);
          for (const vest of shuffled(vests).slice(0, 2)) {
            tryAdd([base, mid, vest, bottom, foot]);              // shirt + sweater + vest
            for (const outer of shuffled(outers).slice(0, 2)) {
              tryAdd([base, mid, vest, outer, bottom, foot]);     // shirt + sweater + vest + jacket
            }
          }
          for (const outer of shuffled(outers).slice(0, 2)) {
            tryAdd([base, mid, outer, bottom, foot]);
          }
        }
        for (const vest of shuffled(vests).slice(0, 2)) {
          tryAdd([base, vest, bottom, foot]);                     // shirt + vest (no sweater)
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

  // ── mid-led: sweater/hoodie as sole top (no base showing), ±vest, ±outer
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

  // ── outer-led: jacket/coat as sole top (open-chest look)
  for (const outer of shuffled(outers).slice(0, 5)) {
    for (const bottom of shuffled(bottoms).slice(0, 10)) {
      for (const foot of shuffled(feet).slice(0, 6)) {
        tryAdd([outer, bottom, foot]);
      }
    }
  }

  // ── onepiece-led: dress/jumpsuit/romper as foundation, ±mid, ±vest, ±outer
  for (const op of shuffled(onepieces).slice(0, 8)) {
    for (const foot of shuffled(feet).slice(0, 6)) {
      tryAdd([op, foot]);
      for (const mid of shuffled(mids).slice(0, 4)) {
        tryAdd([op, mid, foot]);                                  // dress + cardigan
        for (const outer of shuffled(outers).slice(0, 2)) {
          tryAdd([op, mid, outer, foot]);                         // dress + sweater + coat
        }
      }
      for (const vest of shuffled(vests).slice(0, 2)) {
        tryAdd([op, vest, foot]);                                 // dress + gilet
      }
      for (const outer of shuffled(outers).slice(0, 3)) {
        tryAdd([op, outer, foot]);                                // dress + jacket
      }
    }
  }

  outfits.sort((a, b) => b.score - a.score);
  return outfits.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemColors(item) {
  if (item.tags?.colors?.length) return item.tags.colors;
  return [item.color_primary, item.color_secondary].filter(Boolean);
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
