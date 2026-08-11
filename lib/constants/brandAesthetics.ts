// Maps curated brands to their typical aesthetic identity (1-3 tags from
// AESTHETIC_TAGS). This is a free, brand-grounded signal — generally more
// reliable than guessing from a single product photo, and skips that field
// in the AI call entirely when available.
//
// Brands with no strong cohesive identity (e.g. Shein) are intentionally
// omitted so aesthetic_tags falls through to the AI's visual judgment.
export const BRAND_AESTHETICS: Record<string, string[]> = {
  // Streetwear
  "Supreme": ["streetwear", "skate"],
  "Stussy": ["streetwear", "skate", "vintage"],
  "Stüssy": ["streetwear", "skate", "vintage"],
  "Carhartt WIP": ["streetwear", "workwear"],
  "Carhartt": ["workwear", "streetwear"],
  "Palace": ["streetwear", "skate"],
  "BAPE": ["streetwear", "y2k"],
  "A Bathing Ape": ["streetwear", "y2k"],
  "Kith": ["streetwear", "minimalist"],
  "Fear of God": ["streetwear", "minimalist", "quiet-luxury"],
  "Fear of God Essentials": ["streetwear", "minimalist", "normcore"],
  "Essentials": ["streetwear", "minimalist", "normcore"],
  "Off-White": ["streetwear", "maximalist"],
  "Vlone": ["streetwear", "grunge"],
  "Anti Social Social Club": ["streetwear"],
  "The Hundreds": ["streetwear", "skate"],
  "Brain Dead": ["streetwear", "grunge"],
  "Online Ceramics": ["streetwear", "vintage", "90s"],
  "Aimé Leon Dore": ["streetwear", "preppy", "old-money"],
  "Corteiz": ["streetwear"],
  "Hellstar": ["streetwear", "grunge", "goth"],
  "Sp5der": ["streetwear", "y2k", "maximalist"],
  "Gallery Dept": ["streetwear", "vintage", "grunge"],
  "Denim Tears": ["streetwear", "vintage"],
  "Chrome Hearts": ["streetwear", "goth", "maximalist"],
  "Born X Raised": ["streetwear"],
  "Awake NY": ["streetwear"],
  "Noah": ["streetwear", "preppy", "old-money"],



  // Athletic / sportswear
  "Nike": ["athleisure", "streetwear"],
  "Jordan": ["athleisure", "streetwear"],
  "Adidas": ["athleisure", "streetwear", "90s"],
  "New Balance": ["athleisure", "normcore", "minimalist"],
  "Puma": ["athleisure"],
  "Reebok": ["athleisure", "90s", "vintage"],
  "Under Armour": ["athleisure"],
  "Champion": ["athleisure", "streetwear", "90s"],
  "Asics": ["athleisure", "normcore"],
  "Fila": ["athleisure", "90s", "vintage"],
  "Kappa": ["athleisure", "90s", "vintage"],

  // Denim / workwear
  "Levi's": ["vintage", "workwear", "90s"],
  "Levis": ["vintage", "workwear", "90s"],
  "Dickies": ["workwear", "streetwear", "skate"],
  "Wrangler": ["workwear", "western", "vintage"],
  "Lee": ["workwear", "vintage"],
  "RRL": ["vintage", "workwear", "western"],
  "Naked & Famous": ["workwear", "minimalist"],
  "Filson": ["workwear", "gorpcore"],
  "Red Wing": ["workwear", "vintage"],

  // Designer / luxury
  "Gucci": ["formal", "maximalist"],
  "Louis Vuitton": ["formal", "old-money"],
  "Prada": ["formal", "minimalist", "quiet-luxury"],
  "Balenciaga": ["streetwear", "maximalist"],
  "Saint Laurent": ["formal", "grunge", "punk"],
  "Burberry": ["old-money", "preppy", "formal"],
  "Versace": ["formal", "maximalist"],
  "Dior": ["formal", "old-money"],
  "Givenchy": ["formal"],
  "Moncler": ["old-money", "gorpcore"],
  "Canada Goose": ["gorpcore"],
  "Acne Studios": ["minimalist", "quiet-luxury"],
  "Rick Owens": ["goth", "grunge", "minimalist"],
  "Comme des Garçons": ["minimalist", "punk", "goth"],
  "Maison Margiela": ["goth", "grunge", "minimalist"],
  "Bottega Veneta": ["quiet-luxury", "minimalist"],
  "Loewe": ["quiet-luxury", "minimalist"],
  "Amiri": ["streetwear", "grunge"],

  // Heritage / prep / old money
  "Ralph Lauren": ["old-money", "preppy"],
  "Polo Ralph Lauren": ["old-money", "preppy"],
  "Brooks Brothers": ["old-money", "preppy", "business-casual"],
  "Tommy Hilfiger": ["preppy", "90s"],
  "Lacoste": ["preppy", "old-money", "business-casual"],
  "J.Crew": ["preppy", "business-casual", "old-money"],
  "Vineyard Vines": ["preppy", "old-money"],
  "Barbour": ["old-money", "workwear"],

  // Fast fashion / general
  "Zara": ["business-casual", "minimalist"],
  "H&M": ["business-casual", "normcore"],
  "Uniqlo": ["minimalist", "normcore"],
  "PacSun": ["streetwear", "skate", "y2k"],
  "Forever 21": ["streetwear", "y2k"],
  "Gap": ["normcore", "business-casual"],
  "Old Navy": ["normcore", "business-casual"],
  "American Eagle": ["streetwear", "y2k", "athleisure"],
  "Abercrombie & Fitch": ["preppy", "minimalist"],
  "Hollister": ["y2k", "athleisure"],

  // Outdoor
  "The North Face": ["gorpcore", "streetwear"],
  "Patagonia": ["gorpcore", "workwear"],
  "Arc'teryx": ["techwear", "gorpcore"],
  "Columbia": ["gorpcore", "workwear"],
  "Marmot": ["gorpcore"],
  "Mammut": ["gorpcore", "techwear"],

  // Footwear
  "Vans": ["skate", "streetwear", "grunge"],
  "Converse": ["grunge", "punk", "streetwear"],
  "Birkenstock": ["normcore", "gorpcore"],
  "Crocs": ["normcore", "athleisure"],
  "Timberland": ["workwear", "streetwear", "90s"],
  "Dr. Martens": ["punk", "grunge", "goth"],
  "Salomon": ["gorpcore", "techwear", "athleisure"],
  "On Running": ["athleisure", "minimalist"],
  "Hoka": ["athleisure", "normcore"],
};
