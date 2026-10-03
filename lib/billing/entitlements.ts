import { FULL_ACCESS_EMAILS, type TierId } from "./plans";
import type { User } from "@/lib/db/users";

export type Entitlement = {
  tier: TierId;
  hasAI: boolean;
  aiCredits: number;
  isFullAccessOverride: boolean;
  /** True when tier_expires_at is in the past — the DB row is left untouched (see route
   *  comments), this just means "read it back as free" for the current request. */
  lapsed: boolean;
};

const KNOWN_TIERS: TierId[] = ["free", "pro"];

// The single place that decides what a user can actually do right now. Every route that gates
// an AI-dependent feature should call this rather than reading user.tier directly — it's the
// only function that knows about the full-access override and expiry-without-deletion rule.
export function resolveEntitlement(user: Pick<User, "email" | "tier" | "tier_expires_at" | "ai_credits">): Entitlement {
  if (FULL_ACCESS_EMAILS.includes(user.email.toLowerCase().trim())) {
    return { tier: "pro", hasAI: true, aiCredits: Infinity, isFullAccessOverride: true, lapsed: false };
  }

  const rawTier = (user.tier ?? "free") as TierId;
  const tierValid = KNOWN_TIERS.includes(rawTier) ? rawTier : "free";
  const expiresAt = user.tier_expires_at ? new Date(user.tier_expires_at).getTime() : null;
  const lapsed = tierValid !== "free" && expiresAt !== null && expiresAt < Date.now();

  const effectiveTier: TierId = lapsed ? "free" : tierValid;
  const aiCredits = user.ai_credits ?? 0;

  // hasAI = the Pro feature set (scores, wardrobe analysis, AI comparisons, outfit notes…), and
  // only Pro has it. One-time purchases are deliberately narrower: a "Single Item Analysis"
  // (ai_credits) scores ONE item via "Use score?", a "Full Wardrobe Analysis"
  // (wardrobe_scan_credits) produces the Wardrobe tab report — both run as jobs that only spend
  // the credit once the result is saved (lib/analysisJobs.ts). What they unlock stays visible on
  // the free tier: garments.ai_unlocked, wardrobe_analysis_state.purchased.
  const hasAI = effectiveTier === "pro";

  return { tier: effectiveTier, hasAI, aiCredits, isFullAccessOverride: false, lapsed };
}

// Real-dollar ceiling on Pro's AI usage: $4.98 per rolling 30 days (1 cent under the $4.99
// subscription, so a maxed-out month is never a loss), computed from each call's real token cost.
// Enforced as a HARD limit by lib/aiGateway.ts — the only code that calls OpenAI — which reserves
// each call's worst-case cost atomically in the database before sending it and settles to the
// real cost afterwards, so no call (or burst of parallel calls) can ever take a user past it.
// consumeAiCredit below is only the early "is there budget left at all" check routes use to show
// the friendly message without starting work.
export const PRO_MONTHLY_CAP_CENTS = 498;
const PRO_RESET_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export type ConsumeResult = { allowed: boolean; reason?: "cap_reached" | "no_credits" | "no_consent" };

// Early check for an AI-calling route (the real enforcement is lib/aiGateway.ts). Pro: is any
// of this month's budget left. Free: refused — a free user's purchased credits are spent only
// through "Use score?" / "Perform analysis?" (lib/analysisJobs.ts), never by an ordinary route.
export async function consumeAiCredit(
  user: Pick<User, "id" | "email" | "tier" | "tier_expires_at" | "ai_credits" | "ai_cost_cents_used" | "ai_cost_reset_at">,
): Promise<ConsumeResult> {
  const ent = resolveEntitlement(user);
  if (ent.tier !== "pro") return { allowed: false, reason: "no_credits" };
  if (ent.isFullAccessOverride) return { allowed: true };
  const resetAtMs = user.ai_cost_reset_at ? new Date(user.ai_cost_reset_at).getTime() : 0;
  if (Date.now() - resetAtMs > PRO_RESET_INTERVAL_MS) return { allowed: true }; // window rolled over
  // Needs room for at least a small call; the gateway's reservation is the exact check.
  if (Number(user.ai_cost_cents_used ?? 0) + 1 > PRO_MONTHLY_CAP_CENTS) return { allowed: false, reason: "cap_reached" };
  return { allowed: true };
}

// The client-facing message for a refused consumeAiCredit call — one place so every route's error
// text stays consistent, and the client can just render it as-is (in red) rather than each route
// writing its own wording.
export function consumeErrorMessage(reason: ConsumeResult["reason"]): string {
  if (reason === "no_consent") {
    return "AI analysis is turned off. Turn it on in Settings to use this.";
  }
  if (reason === "cap_reached") {
    return "You've reached this month's AI usage limit for Pro. It resets in about a month — thanks for using the app so much!";
  }
  return "You're out of AI credits. Upgrade to Pro or buy a one-time analysis to continue.";
}
