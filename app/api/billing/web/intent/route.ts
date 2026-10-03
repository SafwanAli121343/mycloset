// POST /api/billing/web/intent { product } → { clientSecret, amountCents, kind: "payment" | "subscription" }
// Starts a website purchase. The browser then confirms it with Stripe's embedded card fields on
// the site's own Upgrade page. Nothing is granted here — only the webhook grants a purchase,
// once Stripe confirms the payment actually went through.
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserById } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";
import { stripe, webPaymentsEnabled, ensureCustomer, proPrice, WEB_PRODUCTS, type WebProductId } from "@/lib/billing/stripe";

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "billing:web-intent", 20, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = stripe();
  if (!s || !webPaymentsEnabled()) return NextResponse.json({ error: "Payments aren't set up on the website yet." }, { status: 503 });

  const body = await req.json().catch(() => null) as { product?: string } | null;
  const productId = body?.product as WebProductId | undefined;
  if (!productId || !(productId in WEB_PRODUCTS)) return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  const product = WEB_PRODUCTS[productId];

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const customer = await ensureCustomer(s, user);

    if (productId === "pro") {
      // Already Pro (from the app, a key, or the website): a second subscription would just
      // charge twice for the same thing.
      if (resolveEntitlement(user).hasAI) return NextResponse.json({ error: "You already have MyCloset Pro." }, { status: 409 });
      // Drop any earlier unfinished checkout so there's only ever one pending subscription.
      const pending = await s.subscriptions.list({ customer, status: "incomplete", limit: 10 });
      for (const sub of pending.data) await s.subscriptions.cancel(sub.id).catch(() => {});
      const sub = await s.subscriptions.create({
        customer,
        items: [{ price: await proPrice(s) }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: { userId: user.id },
        expand: ["latest_invoice.confirmation_secret"],
      });
      const invoice = sub.latest_invoice as { confirmation_secret?: { client_secret?: string } | null } | null;
      const clientSecret = invoice?.confirmation_secret?.client_secret;
      if (!clientSecret) throw new Error("no confirmation secret on the subscription's first invoice");
      return NextResponse.json({ clientSecret, amountCents: product.cents, kind: "subscription" });
    }

    const pi = await s.paymentIntents.create({
      amount: product.cents,
      currency: "usd",
      customer,
      automatic_payment_methods: { enabled: true },
      description: product.name,
      metadata: { userId: user.id, product: productId, kind: product.kind!, qty: String(product.qty!) },
    });
    return NextResponse.json({ clientSecret: pi.client_secret, amountCents: product.cents, kind: "payment" });
  } catch (e) {
    console.error("[billing/web/intent]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't start checkout. You haven't been charged — please try again." }, { status: 500 });
  }
}
