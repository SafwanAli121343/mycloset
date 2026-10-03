import { createClient } from "@supabase/supabase-js";

// Server-only admin client — never import this in client components
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type User = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  tier?: string;
  tier_expires_at?: string | null;
  tier_source?: string | null;
  ai_credits?: number;
  ai_cost_cents_used?: number;
  ai_cost_reset_at?: string;
  email_verified?: boolean;
};

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const { data, error } = await adminSupabase
    .from("users")
    .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash })
    .select()
    .single();
  if (error) throw error;
  return data as User;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await adminSupabase
    .from("users")
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .single();
  if (error || !data) return null;
  return data as User;
}

// This is called from every /api/auth/me request — i.e. on every app launch/foreground — so it
// must never hard-fail just because supabase/add_billing_entitlements.sql hasn't been run yet in
// a given environment. If the billing columns don't exist, fall back to the pre-billing column
// set (same "retry without the new column" pattern /api/outfits/route.ts already uses for
// ai_garment_ids/notes) rather than erroring the whole session check — resolveEntitlement()
// already treats a User with no `tier` field as free tier, so the fallback degrades safely.
export async function getUserById(id: string): Promise<User | null> {
  let { data, error } = await adminSupabase
    .from("users")
    .select("id, email, created_at, tier, tier_expires_at, tier_source, ai_credits, ai_cost_cents_used, ai_cost_reset_at, email_verified")
    .eq("id", id)
    .single();
  if (error?.message?.includes("email_verified")) {
    ({ data, error } = await adminSupabase
      .from("users")
      .select("id, email, created_at, tier, tier_expires_at, tier_source, ai_credits, ai_cost_cents_used, ai_cost_reset_at")
      .eq("id", id)
      .single());
  }
  if (error?.message?.includes("ai_cost")) {
    ({ data, error } = await adminSupabase
      .from("users")
      .select("id, email, created_at, tier, tier_expires_at, tier_source, ai_credits")
      .eq("id", id)
      .single());
  }
  if (error?.message?.includes("tier") || error?.message?.includes("ai_credits")) {
    ({ data, error } = await adminSupabase.from("users").select("id, email, created_at").eq("id", id).single());
  }
  if (error || !data) return null;
  return data as User;
}

// Only route handlers that already re-verify identity some other way (current password for
// change-password, an emailed one-time code for reset-password) should ever call this — it's a
// raw hash overwrite with no auth check of its own.
export async function updateUserPasswordHash(id: string, passwordHash: string): Promise<void> {
  const { error } = await adminSupabase.from("users").update({ password_hash: passwordHash }).eq("id", id);
  if (error) throw error;
}

export async function setEmailVerified(id: string): Promise<void> {
  const { error } = await adminSupabase.from("users").update({ email_verified: true }).eq("id", id);
  if (error) throw error;
}

export async function setUserTier(
  id: string,
  tier: string,
  expiresAt: string | null,
  source: "purchase" | "key" | "grant" | "web"
): Promise<void> {
  const { error } = await adminSupabase
    .from("users")
    .update({ tier, tier_expires_at: expiresAt, tier_source: source })
    .eq("id", id);
  if (error) throw error;
}

export async function adjustAiCredits(id: string, delta: number): Promise<void> {
  const { data, error: readErr } = await adminSupabase.from("users").select("ai_credits").eq("id", id).single();
  if (readErr || !data) return;
  const next = Math.max(0, (data.ai_credits ?? 0) + delta);
  await adminSupabase.from("users").update({ ai_credits: next }).eq("id", id);
}

// Used by lib/billing/aiCost.ts — a plain write, no policy decision here, matching
// adjustAiCredits' own division of labor. `resetAt` is only passed when the caller has determined
// the 30-day window has rolled over, so this can both bump a running total AND perform a reset in
// one write.
export async function setAiCostUsage(id: string, centsUsed: number, resetAt?: string): Promise<void> {
  const updates: Record<string, unknown> = { ai_cost_cents_used: centsUsed };
  if (resetAt) updates.ai_cost_reset_at = resetAt;
  await adminSupabase.from("users").update(updates).eq("id", id);
}

export async function setRevenueCatAppUserId(id: string, rcAppUserId: string): Promise<void> {
  await adminSupabase.from("users").update({ rc_app_user_id: rcAppUserId }).eq("id", id).then(() => {});
}

export async function getUserByRcAppUserId(rcAppUserId: string): Promise<User | null> {
  const { data, error } = await adminSupabase
    .from("users")
    .select("id, email, created_at, tier, tier_expires_at, tier_source, ai_credits")
    .eq("rc_app_user_id", rcAppUserId)
    .single();
  // No fallback here (unlike getUserById): this is only reachable via the RevenueCat webhook,
  // which is meaningless without the billing columns anyway — a clear failure here is more
  // useful than pretending the lookup worked.
  if (error || !data) return null;
  return data as User;
}
