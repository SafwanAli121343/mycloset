import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setUserTier, getUserByRcAppUserId, getUserById } from "@/lib/db/users";
import { maybeStartProBackfill, runJob } from "@/lib/analysisJobs";
import { auditLog } from "@/lib/security/auditLog";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Maps a RevenueCat product identifier (see native/lib/billing/plans.ts) to the tier it grants.
// Consumables (item_scan/wardrobe_scan) are handled separately below since they add credits
// instead of changing tier.
const PRODUCT_TO_TIER: Record<string, string> = {
  mycloset_pro_monthly: "pro",
};
// One-time purchases, each its own balance (lib/billing/purchaseCredits.ts):
//   item_scan     → +1 users.ai_credits            ("Single Item Analysis")
//   wardrobe_scan → +1 users.wardrobe_scan_credits ("Full Wardrobe Analysis")
// wardrobe_scan used to add 9,999 generic AI credits — effectively unlimited AI for one payment.
const CONSUMABLE_KIND: Record<string, "item" | "wardrobe"> = {
  mycloset_item_scan: "item",
  mycloset_wardrobe_scan: "wardrobe",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Events that mean "the subscription is currently active" — INITIAL_PURCHASE/RENEWAL both
// arrive with an `expiration_at_ms` we trust as the new tier_expires_at. CANCELLATION alone
// does NOT end access immediately (the user paid through the end of the period — Apple/Google
// both require this); only EXPIRATION (sent once that period actually elapses) should drop
// access back to free. We still record CANCELLATION for the audit trail.
const ACTIVE_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION"]);
const EXPIRY_EVENTS = new Set(["EXPIRATION"]);

type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  product_id: string;
  store: string; // "APP_STORE" | "PLAY_STORE"
  expiration_at_ms?: number;
  transaction_id?: string;
};

// POST /api/billing/revenuecat-webhook
// Configure this URL + REVENUECAT_WEBHOOK_SECRET in the RevenueCat dashboard once a RevenueCat
// project exists (Project Settings → Integrations → Webhooks). This is the ONLY place tier
// upgrades from a real purchase are ever applied server-side — the client never gets to declare
// its own entitlement, it only reflects what this endpoint already wrote to the DB, which is
// what actually makes the purchase flow trustworthy rather than a client-side toggle an attacker
// could flip for themselves.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET not configured — refusing all events");
    return NextResponse.json({ error: "Not configured" }, { status: 501 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event: RevenueCatEvent | undefined = body?.event;
  if (!event?.app_user_id || !event?.type) {
    return NextResponse.json({ error: "Malformed event" }, { status: 400 });
  }

  // The app logs in to RevenueCat with the user's own account id (native/lib/billing/purchases.ts),
  // so app_user_id IS users.id; rc_app_user_id stays as a fallback for any other mapping. Before,
  // only rc_app_user_id was checked — and nothing ever set it, so every purchase was dropped.
  const user =
    (await getUserByRcAppUserId(event.app_user_id).catch(() => null)) ??
    (UUID_RE.test(event.app_user_id) ? await getUserById(event.app_user_id).catch(() => null) : null);
  if (!user) {
    // Not necessarily an error — RevenueCat sandbox/test events can reference app_user_ids we
    // never saw a login for. Ack with 200 so RevenueCat doesn't retry forever.
    console.warn("[revenuecat-webhook] no user for app_user_id", event.app_user_id);
    return NextResponse.json({ ok: true, skipped: true });
  }

  // RevenueCat retries deliveries — a repeat of an already-recorded transaction must not grant
  // anything twice (double credits).
  if (event.transaction_id) {
    const { data: dupe } = await adminClient.from("purchases").select("id")
      .eq("transaction_id", event.transaction_id).eq("event_type", event.type).limit(1);
    if (dupe?.length) return NextResponse.json({ ok: true, duplicate: true });
  }

  await adminClient.from("purchases").insert({
    user_id: user.id,
    product_id: event.product_id,
    platform: event.store === "APP_STORE" ? "ios" : event.store === "PLAY_STORE" ? "android" : null,
    event_type: event.type,
    transaction_id: event.transaction_id ?? null,
    raw_event: event,
  });

  const tier = PRODUCT_TO_TIER[event.product_id];

  if (tier && ACTIVE_EVENTS.has(event.type)) {
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
    await setUserTier(user.id, tier, expiresAt, "purchase");
    auditLog("tier_changed", user.id, null, { tier, expiresAt, event: event.type });
    // Free → Pro: analyze everything added while free, right away (lib/analysisJobs.ts). Also
    // re-checked whenever the app loads, so a slow or failed run here still gets finished.
    after(async () => {
      const job = await maybeStartProBackfill(user.id).catch(() => null);
      if (job) await runJob(job);
    });
  } else if (tier && EXPIRY_EVENTS.has(event.type)) {
    // Still subscribed on the website (lib/billing/stripe.ts): that subscription keeps Pro going
    // — an App Store / Play subscription ending mustn't cut it off.
    const { data: webSub } = await adminClient.from("users").select("stripe_subscription_id").eq("id", user.id).maybeSingle();
    if ((webSub as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id) {
      auditLog("tier_changed", user.id, null, { appStoreExpiredButWebActive: true, event: event.type });
      return NextResponse.json({ ok: true, keptByWebSubscription: true });
    }
    // Drop the resolved tier back to free by setting expiry to now — resolveEntitlement()
    // reads this as lapsed rather than us deleting the row, so a later renewal (the user comes
    // back) just extends tier_expires_at again with everything else untouched.
    await setUserTier(user.id, tier, new Date().toISOString(), "purchase");
    auditLog("tier_changed", user.id, null, { tier: "free", event: event.type });
  } else if (CONSUMABLE_KIND[event.product_id]) {
    const kind = CONSUMABLE_KIND[event.product_id];
    // Atomic in the database (add_purchase_credit) — never a read-then-write that a concurrent
    // spend could interleave with.
    if (event.type === "NON_RENEWING_PURCHASE" || event.type === "INITIAL_PURCHASE") {
      // Consumables arrive as NON_RENEWING_PURCHASE in RevenueCat (INITIAL_PURCHASE kept for safety).
      const { error } = await adminClient.rpc("add_purchase_credit", { p_user: user.id, p_kind: kind, p_n: 1 });
      if (error) {
        // Let RevenueCat retry (non-2xx) rather than acknowledge a purchase we failed to grant —
        // and remove the dedupe row so the retry isn't skipped as a duplicate.
        if (event.transaction_id) await adminClient.from("purchases").delete().eq("transaction_id", event.transaction_id).eq("event_type", event.type);
        console.error("[revenuecat-webhook] credit grant failed:", error.message);
        return NextResponse.json({ error: "grant failed" }, { status: 500 });
      }
      auditLog("tier_changed", user.id, null, { creditAdded: kind });
    } else if (event.type === "CANCELLATION") {
      // A one-time purchase refunded by Apple/Google: take back the credit if it hasn't been used.
      await adminClient.rpc("add_purchase_credit", { p_user: user.id, p_kind: kind, p_n: -1 });
      auditLog("tier_changed", user.id, null, { creditRefunded: kind });
    }
  }

  return NextResponse.json({ ok: true });
}
