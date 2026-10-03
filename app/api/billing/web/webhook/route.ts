// POST /api/billing/web/webhook — Stripe → server. The ONLY place a website purchase is granted.
// Verified with STRIPE_WEBHOOK_SECRET; every event is recorded in `purchases` and a repeat of the
// same event is ignored, so a retried delivery can never grant anything twice.
//   payment_intent.succeeded       → one-time purchase: add its credits
//   charge.refunded                → one-time purchase refunded: take back unused credits
//   invoice.paid                   → subscription paid / renewed: Pro until the period ends
//   customer.subscription.deleted  → subscription over: back to free (if the website owns Pro)
import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe, userIdForCustomer, WEB_PRODUCTS, type WebProductId } from "@/lib/billing/stripe";
import { setUserTier, getUserById } from "@/lib/db/users";
import { auditLog } from "@/lib/security/auditLog";
import { maybeStartProBackfill, runJob } from "@/lib/analysisJobs";

export const maxDuration = 300; // Pro's catch-up analysis runs after the response

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function alreadyHandled(eventId: string): Promise<boolean> {
  const { data } = await sb.from("purchases").select("id").eq("transaction_id", eventId).limit(1);
  return !!data?.length;
}
async function record(userId: string, productId: string, event: Stripe.Event) {
  await sb.from("purchases").insert({
    user_id: userId, product_id: productId, platform: "web", event_type: event.type,
    transaction_id: event.id, raw_event: event,
  });
}

export async function POST(req: NextRequest) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return NextResponse.json({ error: "Not configured" }, { status: 501 });

  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  if (await alreadyHandled(event.id)) return NextResponse.json({ ok: true, duplicate: true });

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const product = pi.metadata?.product as WebProductId | undefined;
        if (!product || product === "pro" || !(product in WEB_PRODUCTS)) break; // subscription payments are handled by invoice.paid
        const userId = pi.metadata.userId;
        const { kind, qty } = WEB_PRODUCTS[product];
        await record(userId, product, event);
        const { error } = await sb.rpc("add_purchase_credit", { p_user: userId, p_kind: kind, p_n: qty });
        if (error) {
          // Let Stripe retry rather than acknowledge a purchase that wasn't granted.
          await sb.from("purchases").delete().eq("transaction_id", event.id);
          throw new Error(`credit grant failed: ${error.message}`);
        }
        auditLog("tier_changed", userId, null, { webCreditAdded: kind, qty });
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        if (!charge.payment_intent) break;
        const pi = await s.paymentIntents.retrieve(typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id);
        const product = pi.metadata?.product as WebProductId | undefined;
        if (!product || product === "pro" || !(product in WEB_PRODUCTS)) break;
        const { kind, qty } = WEB_PRODUCTS[product];
        await record(pi.metadata.userId, product, event);
        await sb.rpc("add_purchase_credit", { p_user: pi.metadata.userId, p_kind: kind, p_n: -qty! });
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.parent?.subscription_details?.subscription;
        if (!subId || !invoice.customer) break;
        const userId = await userIdForCustomer(typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id);
        if (!userId) break;
        const periodEnd = Math.max(...invoice.lines.data.map(l => l.period?.end ?? 0));
        // A day's grace past the period end, so a renewal that's a little late never drops access.
        const expiresAt = new Date((periodEnd + 24 * 3600) * 1000).toISOString();
        const before = await getUserById(userId);
        await record(userId, "pro", event);
        await setUserTier(userId, "pro", expiresAt, "web");
        await sb.from("users").update({ stripe_subscription_id: typeof subId === "string" ? subId : subId.id }).eq("id", userId);
        auditLog("tier_changed", userId, null, { tier: "pro", source: "web", expiresAt });
        // Free → Pro: catch up on everything added while free (same as an app purchase).
        if (before && before.tier !== "pro") {
          try {
            after(async () => {
              const job = await maybeStartProBackfill(userId).catch(() => null);
              if (job) await runJob(job);
            });
          } catch { /* the app re-checks on next launch (billing/status) */ }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await userIdForCustomer(typeof sub.customer === "string" ? sub.customer : sub.customer.id);
        if (!userId) break;
        const user = await getUserById(userId);
        await record(userId, "pro", event);
        // Only end Pro if the website is what gave it — never cut off an App Store / Play
        // subscription or a redeemed key because a website one ended.
        if (user && (user as { tier_source?: string | null }).tier_source === "web") {
          await setUserTier(userId, "pro", new Date().toISOString(), "web");
          auditLog("tier_changed", userId, null, { tier: "free", source: "web" });
        }
        await sb.from("users").update({ stripe_subscription_id: null }).eq("id", userId).eq("stripe_subscription_id", sub.id);
        break;
      }
    }
  } catch (e) {
    console.error("[billing/web/webhook]", event.type, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
