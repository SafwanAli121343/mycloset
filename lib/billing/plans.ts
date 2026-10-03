// Single source of truth for pricing/plan metadata — read by the billing API routes on the
// web/backend side. The native app keeps its own copy (native/lib/billing/plans.ts) since it's
// a separate Metro bundle that can't import from this repo; keep the two in sync by hand.
//
// Pricing rationale (so a future change doesn't have to re-derive this from scratch): a GPT-4o
// vision "analyze one item" call costs roughly $0.01–0.03 in OpenAI usage; a full wardrobe
// re-scan for a real closet (~40-80 items) costs roughly $0.50–2.00. A moderately active user
// analyzing on the order of 10-30 items/month plus generating outfit scores routinely (cheap —
// scoring itself is deterministic, not an LLM call; only the per-item vision analysis is) still
// leaves comfortable margin at $4.99/mo for unlimited access. Previously split into a
// credit-capped "Lite" tier and an unlimited "Pro" tier; collapsed to one paid plan since Lite's
// 30-credit cap wasn't earning its own complexity — a user who wants AI at all almost always
// wants it uncapped, and the one-time consumables below already cover the "just this once"
// case without a subscription.

export type TierId = "free" | "pro";

export type SubscriptionPlan = {
  id: TierId;
  name: string;
  priceUsd: number; // per month
  aiCreditsPerMonth: number | null; // null = unlimited
  description: string;
  features: string[]; // same lines the app's Upgrade screen lists (native/lib/billing/plans.ts)
  productId: { ios: string; android: string } | null; // RevenueCat/store product identifiers
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

// One-time purchases for users who don't want a subscription. Priced above the raw per-call AI
// cost by a wide enough margin to cover payment-processor fees (~30% on app stores) and still
// profit on a single use.
export const CONSUMABLE_PRODUCTS: ConsumableProduct[] = [
  {
    id: "item_scan",
    name: "Single Item Analysis",
    priceUsd: 0.29,
    aiCredits: 1,
    description: "AI analysis for one item — category, material, fit, and color pairings.",
    productId: { ios: "mycloset_item_scan", android: "mycloset_item_scan" },
  },
  {
    id: "wardrobe_scan",
    name: "Full Wardrobe Analysis",
    priceUsd: 0.69,
    aiCredits: 0, // not item credits — grants one wardrobe_scan_credits use (analyze the whole closet once)
    description: "AI analysis for every unanalyzed item currently in your closet, in one pass.",
    productId: { ios: "mycloset_wardrobe_scan", android: "mycloset_wardrobe_scan" },
  },
];

export const FULL_ACCESS_EMAILS = ["safwan200817@gmail.com"];
