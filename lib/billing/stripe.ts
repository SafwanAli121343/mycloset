// Website purchases (the app uses Apple / Google through RevenueCat — see the RevenueCat
// webhook). The checkout is the site's own page (app/upgrade); the card fields inside it are
// Stripe's secure embedded fields, so card numbers go straight to Stripe and never touch this
// server. Purchases are only ever granted by the webhook (/api/billing/web/webhook) once Stripe
// confirms the payment — never by the browser saying it paid.
//
// Setup (until then the Upgrade page shows "payments aren't set up yet"):
//   STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
//   + run supabase/add_web_payments.sql
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let client: Stripe | null = null;
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}

export function webPaymentsEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

// What the website sells. Single Item Analysis is a 2-pack here: card processors have a 50¢
// minimum charge, so one 29¢ score can't be sold on its own (same 29¢ each as the app).
export type WebProductId = "pro" | "item_scan_2" | "wardrobe_scan";
export const WEB_PRODUCTS: Record<WebProductId, { name: string; cents: number; kind?: "item" | "wardrobe"; qty?: number }> = {
  pro:           { name: "MyCloset Pro (monthly)", cents: 499 },
  item_scan_2:   { name: "2 Single Item Analyses", cents: 58, kind: "item", qty: 2 },
  wardrobe_scan: { name: "Full Wardrobe Analysis", cents: 69, kind: "wardrobe", qty: 1 },
};

// The account's Stripe customer — created on first purchase and remembered.
export async function ensureCustomer(s: Stripe, user: { id: string; email: string }): Promise<string> {
  const { data } = await sb.from("users").select("stripe_customer_id").eq("id", user.id).single();
  const existing = (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (existing) return existing;
  const c = await s.customers.create({ email: user.email, metadata: { userId: user.id } }, { idempotencyKey: `customer-${user.id}` });
  const { error } = await sb.from("users").update({ stripe_customer_id: c.id }).eq("id", user.id);
  if (error) throw new Error("couldn't save the Stripe customer (has supabase/add_web_payments.sql been run?)");
  return c.id;
}

// The Pro monthly price, found by its lookup key (created once if it doesn't exist yet), so no
// manual product setup is needed in the Stripe dashboard.
const PRO_LOOKUP_KEY = "mycloset_pro_monthly_web";
let proPriceId: string | null = null;
export async function proPrice(s: Stripe): Promise<string> {
  if (proPriceId) return proPriceId;
  const found = await s.prices.list({ lookup_keys: [PRO_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) return (proPriceId = found.data[0].id);
  const product = await s.products.create({ name: WEB_PRODUCTS.pro.name });
  const price = await s.prices.create({
    product: product.id, currency: "usd", unit_amount: WEB_PRODUCTS.pro.cents,
    recurring: { interval: "month" }, lookup_key: PRO_LOOKUP_KEY,
  });
  return (proPriceId = price.id);
}

export async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await sb.from("users").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}
