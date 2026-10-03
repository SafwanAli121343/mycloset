// Mirror of ../../lib/billing/plans.ts on the web/backend repo — kept in sync by hand, same
// convention as native/lib/garmentSlots.ts and colorGroups.ts. Product IDs here must exactly
// match what's configured in App Store Connect / Google Play Console / RevenueCat, since these
// strings are what purchases.ts passes to the store.
//
// Collapsed from a 3-tier Free/Lite/Pro structure to Free/Pro (see plans.ts's own comment on the
// web side) — one $4.99/mo unlimited plan, plus the one-time consumables below for users who
// want AI without subscribing.

export type TierId = "free" | "pro";

export type SubscriptionPlan = {
  id: TierId;
  name: string;
  priceUsd: number;
  aiCreditsPerMonth: number | null;
  description: string;
  features: string[];
  productId: { ios: string; android: string } | null;
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "free",
    name: "Free",
    priceUsd: 0,
    aiCreditsPerMonth: 0,
    description: "Closet organization and browsing, no AI.",
    features: [
      "Unlimited closet organization",
      "Color pairing suggestions",
      "Every possible outfit combination",
      "Filter by piece and color",
    ],
    productId: null,
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 4.99,
    aiCreditsPerMonth: null,
    description: "Everything, unlimited.",
    features: [
      "Everything in Free",
      "Unlimited AI analysis",
      "Full wardrobe scoring & insights",
      "Priority support",
    ],
    productId: { ios: "mycloset_pro_monthly", android: "mycloset_pro_monthly" },
  },
];

export type ConsumableProduct = {
  id: string;
  name: string;
  priceUsd: number;
  aiCredits: number;
  description: string;
  productId: { ios: string; android: string };
};

export const CONSUMABLE_PRODUCTS: ConsumableProduct[] = [
  {
    id: "item_scan",
    name: "Single Item Analysis",
    priceUsd: 0.29,
    aiCredits: 1,
    description: "AI analysis for one item.",
    productId: { ios: "mycloset_item_scan", android: "mycloset_item_scan" },
  },
  {
    id: "wardrobe_scan",
    name: "Full Wardrobe Analysis",
    priceUsd: 0.69,
    aiCredits: 0,
    description: "AI analysis for every unanalyzed item in your closet, right now.",
    productId: { ios: "mycloset_wardrobe_scan", android: "mycloset_wardrobe_scan" },
  },
];

export const FULL_ACCESS_EMAILS = ["safwan200817@gmail.com"];
