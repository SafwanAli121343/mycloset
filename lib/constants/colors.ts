// Groups of semantically equivalent colors for gap-filling purposes.
// If an item's color falls in the same group as a missing color it counts as a fill.
export const COLOR_GROUPS: string[][] = [
  // Muted yellow-greens — camo/camouflage is predominantly olive/army green in tone
  ["olive", "moss", "army green", "military green", "dark olive", "olive green", "khaki green", "camo", "camouflage", "woodland camo", "desert camo"],
  // Sage / dusty greens (lighter, greyer)
  ["sage", "sage green", "dusty sage", "celadon", "mint green"],
  // Dark greens
  ["forest green", "hunter green", "dark green", "bottle green"],
  // Burgundy family
  ["burgundy", "wine", "maroon", "oxblood", "merlot", "claret", "bordeaux", "crimson"],
  // Navy family
  ["navy", "navy blue", "midnight blue", "dark navy", "deep navy"],
  // Warm neutrals — cream through camel (all one spectrum; beige/khaki/tan cover camel and cream)
  ["cream", "off-white", "ivory", "bone", "eggshell", "ecru", "butter", "beige", "sand", "tan", "camel", "khaki", "wheat", "fawn", "biscuit", "oatmeal", "linen"],
  // Charcoal / dark grey
  ["charcoal", "dark grey", "dark gray", "anthracite", "graphite"],
  // Mid grey
  ["grey", "gray", "slate gray", "slate grey", "heather gray", "heather grey", "medium gray"],
  // Brown family
  ["brown", "chocolate", "chestnut", "walnut", "mocha", "espresso", "mahogany", "cognac", "tobacco"],
  // Rust / terracotta
  ["rust", "brick red", "terracotta", "burnt sienna", "burnt orange", "clay"],
  // Mustard / gold
  ["mustard", "gold", "golden", "amber", "ochre", "honey"],
  // Cobalt / deep blue
  ["cobalt", "royal blue", "sapphire", "deep blue", "electric blue"],
  // Blush / rose
  ["blush", "dusty rose", "rose", "mauve", "pink beige", "petal"],
  // Teal family
  ["teal", "dark teal", "teal blue", "petrol blue"],
  // Taupe / greige
  ["taupe", "greige", "stone", "mushroom", "warm gray", "warm grey"],
  // Purple family
  ["purple", "violet", "plum", "eggplant", "deep purple", "grape"],
];

/** Returns true if colors a and b should be considered equivalent for gap-filling. */
export function sameColorGroup(a: string, b: string): boolean {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return COLOR_GROUPS.some(g => g.includes(na) && g.includes(nb));
}

export const NAMED_COLORS: { name: string; rgb: [number, number, number] }[] = [
  // Neutrals
  { name: "Black", rgb: [20, 20, 20] },
  { name: "Charcoal", rgb: [55, 58, 62] },
  { name: "Slate Gray", rgb: [90, 98, 105] },
  { name: "Gray", rgb: [128, 128, 128] },
  { name: "Heather Gray", rgb: [158, 160, 165] },
  { name: "Light Gray", rgb: [190, 190, 190] },
  { name: "Ash Gray", rgb: [205, 203, 200] },
  { name: "Off-White", rgb: [222, 220, 214] },
  { name: "Ivory", rgb: [248, 246, 232] },
  { name: "Cream", rgb: [245, 235, 205] },
  { name: "White", rgb: [250, 250, 250] },
  { name: "Stone", rgb: [196, 188, 175] },

  // Browns / tans
  { name: "Espresso", rgb: [58, 38, 28] },
  { name: "Chocolate", rgb: [85, 55, 38] },
  { name: "Brown", rgb: [120, 75, 45] },
  { name: "Chestnut", rgb: [125, 80, 50] },
  { name: "Camel", rgb: [196, 160, 110] },
  { name: "Tan", rgb: [195, 165, 120] },
  { name: "Khaki", rgb: [180, 175, 130] },
  { name: "Sand", rgb: [225, 205, 170] },
  { name: "Beige", rgb: [220, 200, 170] },
  { name: "Taupe", rgb: [150, 135, 125] },

  // Reds / pinks
  { name: "Crimson", rgb: [180, 20, 40] },
  { name: "Red", rgb: [200, 30, 30] },
  { name: "Brick Red", rgb: [150, 55, 45] },
  { name: "Maroon", rgb: [110, 30, 40] },
  { name: "Burgundy", rgb: [85, 25, 45] },
  { name: "Wine", rgb: [100, 30, 55] },
  { name: "Rust", rgb: [165, 75, 45] },
  { name: "Terracotta", rgb: [195, 95, 70] },
  { name: "Coral", rgb: [255, 127, 110] },
  { name: "Salmon", rgb: [250, 170, 160] },
  { name: "Blush", rgb: [235, 195, 195] },
  { name: "Pink", rgb: [240, 150, 180] },

  // Magenta / purple
  { name: "Hot Pink", rgb: [255, 90, 160] },
  { name: "Fuchsia", rgb: [220, 30, 150] },
  { name: "Magenta", rgb: [200, 30, 140] },
  { name: "Mauve", rgb: [185, 145, 155] },
  { name: "Purple", rgb: [120, 60, 150] },
  { name: "Violet", rgb: [145, 90, 200] },
  { name: "Plum", rgb: [110, 65, 100] },
  { name: "Eggplant", rgb: [70, 40, 65] },
  { name: "Lavender", rgb: [200, 180, 225] },
  { name: "Lilac", rgb: [210, 185, 220] },

  // Metallics
  { name: "Silver", rgb: [180, 182, 186] },
  { name: "Rose Gold", rgb: [210, 155, 135] },
  { name: "Platinum", rgb: [215, 215, 218] },
  { name: "Bronze", rgb: [160, 115, 65] },

  // Orange / yellow / warm amber
  { name: "Orange", rgb: [255, 140, 0] },
  { name: "Burnt Orange", rgb: [200, 90, 30] },
  { name: "Amber", rgb: [210, 145, 55] },
  { name: "Honey", rgb: [215, 165, 80] },
  { name: "Wheat", rgb: [210, 170, 105] },
  { name: "Caramel", rgb: [190, 130, 65] },
  { name: "Peach", rgb: [255, 200, 170] },
  { name: "Apricot", rgb: [250, 190, 130] },
  { name: "Yellow", rgb: [240, 220, 60] },
  { name: "Mustard", rgb: [200, 165, 50] },
  { name: "Gold", rgb: [215, 175, 55] },
  { name: "Butter", rgb: [250, 230, 160] },

  // Greens
  { name: "Lime", rgb: [170, 210, 60] },
  { name: "Green", rgb: [55, 135, 65] },
  { name: "Kelly Green", rgb: [45, 165, 75] },
  { name: "Emerald", rgb: [0, 140, 90] },
  { name: "Forest Green", rgb: [30, 80, 50] },
  { name: "Hunter Green", rgb: [20, 60, 40] },
  { name: "Olive", rgb: [115, 115, 60] },
  { name: "Army Green", rgb: [90, 95, 65] },
  { name: "Sage", rgb: [158, 169, 142] },
  { name: "Mint", rgb: [180, 220, 200] },
  { name: "Seafoam", rgb: [150, 210, 185] },

  // Blues / teals
  { name: "Teal", rgb: [25, 130, 130] },
  { name: "Turquoise", rgb: [60, 180, 175] },
  { name: "Sky Blue", rgb: [135, 195, 230] },
  { name: "Baby Blue", rgb: [180, 215, 240] },
  { name: "Periwinkle", rgb: [140, 150, 225] },
  { name: "Blue", rgb: [50, 100, 200] },
  { name: "Royal Blue", rgb: [40, 75, 180] },
  { name: "Cobalt", rgb: [25, 65, 170] },
  { name: "Steel Blue", rgb: [95, 130, 165] },
  { name: "Denim Blue", rgb: [70, 95, 130] },
  { name: "Navy", rgb: [25, 35, 75] },
];


