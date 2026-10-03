// Mirror of lib/constants/attributes.ts's KNOWN_AESTHETICS on the web/backend repo — kept in
// sync by hand, same convention as billing/plans.ts and garmentSlots.ts. Single source of truth
// for what a user can pick from the Add Item aesthetic picker (see components/AestheticPicker.tsx),
// same list the AI itself is instructed to classify into, so a manually-picked aesthetic and an
// AI-derived one are always comparable values.
export const KNOWN_AESTHETICS = [
  // Foundation
  "streetwear", "minimalist", "old money", "preppy", "techwear",
  "workwear", "athleisure", "formal", "business casual", "vintage",
  // Edge / subculture
  "grunge", "punk", "goth", "skate", "normcore",
  "gorpcore", "western", "y2k",
  "90s retro", "hip-hop", "surf",
  // Elevated / niche
  "quiet luxury", "avant-garde", "maximalist", "dark academia",
  "coastal", "military", "ivy league", "retro",
];
