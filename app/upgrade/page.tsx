"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEntitlements } from "@/contexts/EntitlementsContext";
import { useAuth } from "@/contexts/AuthContext";
import { ReadyGate } from "@/components/ReadyGate";
import { SUBSCRIPTION_PLANS } from "@/lib/billing/plans";

// The website's Upgrade page — same layout as the app's (native/screens/UpgradeScreen.tsx): the
// plans, then one-time purchases. Checkout happens right here in the site's own style; the card
// fields inside it are Stripe's secure embedded fields, so card numbers go straight to Stripe and
// never touch our server. The purchase is added to the account by the server once Stripe
// confirms it (app/api/billing/web/webhook) — this page just waits for it to show up.

const FONT = { fontFamily: "Arial, sans-serif" } as const;
const TEXT = "#111111", MUTED = "#555555", FAINT = "#8f8f8f", GOOD = "#1d9e52", BAD = "#c83030", BORDER = "#ebebeb";

type Product = "pro" | "item_scan_2" | "wardrobe_scan";
const ONE_TIME: { id: Product; name: string; price: string; note: string }[] = [
  { id: "item_scan_2", name: "2 Single Item Analyses", price: "$0.58", note: "AI score and analysis for two items, 29¢ each. Use them with USE SCORE? in My Closet." },
  { id: "wardrobe_scan", name: "Full Wardrobe Analysis", price: "$0.69", note: "Your wardrobe report: score, gaps, colors and weaknesses. Use it from the Wardrobe page." },
];
const SUMMARY: Record<Product, string> = {
  pro: "MyCloset Pro: $4.99 a month, renews monthly until canceled",
  item_scan_2: "2 Single Item Analyses: $0.58",
  wardrobe_scan: "Full Wardrobe Analysis: $0.69",
};

// Stripe's card fields, styled to match the site (Arial, black text, hairline square boxes).
const APPEARANCE = {
  theme: "flat" as const,
  variables: {
    fontFamily: "Arial, sans-serif", fontSizeBase: "14px", colorPrimary: TEXT, colorText: TEXT,
    colorTextSecondary: MUTED, colorTextPlaceholder: "#b5b5b5", colorDanger: BAD,
    colorBackground: "#ffffff", borderRadius: "0px", spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid #d8d8d8", boxShadow: "none", padding: "12px" },
    ".Input:focus": { border: `1px solid ${TEXT}`, boxShadow: "none" },
    ".Label": { fontSize: "10px", fontWeight: "700", letterSpacing: "0.12em", textTransform: "uppercase", color: FAINT },
    ".Tab": { border: "1px solid #d8d8d8", boxShadow: "none" },
    ".Tab--selected": { border: `1px solid ${TEXT}`, boxShadow: "none" },
  },
};

function btn(color: string, disabled = false): React.CSSProperties {
  return { ...FONT, background: "none", border: "none", padding: "6px 0", cursor: disabled ? "default" : "pointer", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color, opacity: disabled ? 0.4 : 1 };
}

export default function UpgradePage() {
  const ent = useEntitlements();
  const { emailVerified } = useAuth();
  const [config, setConfig] = useState<{ enabled: boolean; publishableKey: string | null } | null>(null);
  const [checkout, setCheckout] = useState<{ product: Product; clientSecret: string } | null>(null);
  const [starting, setStarting] = useState<Product | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [webSub, setWebSub] = useState<{ active: boolean; cancelAtPeriodEnd?: boolean; renewsAt?: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/billing/web/config").then(r => r.json()).then(setConfig).catch(() => setConfig({ enabled: false, publishableKey: null }));
    fetch("/api/billing/web/subscription").then(r => r.ok ? r.json() : null).then(setWebSub).catch(() => {});
  }, []);
  const stripePromise = useMemo<Promise<StripeJs | null> | null>(
    () => (config?.publishableKey ? loadStripe(config.publishableKey) : null), [config?.publishableKey]);

  // Back from a bank's verification page (some cards require it): Stripe returns here.
  const returnedRef = useRef(false);
  useEffect(() => {
    if (returnedRef.current) return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("redirect_status") === "succeeded") {
      returnedRef.current = true;
      setMsg({ text: "Payment received. Adding it to your account…", ok: true });
      waitForPurchase().then(text => setMsg({ text, ok: true }));
      window.history.replaceState(null, "", "/upgrade");
    } else if (p.get("redirect_status") === "failed") {
      setMsg({ text: "That payment didn't go through. You haven't been charged.", ok: false });
      window.history.replaceState(null, "", "/upgrade");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server adds the purchase when Stripe confirms it — usually within a second or two.
  async function waitForPurchase(before?: { tier: string; item: number; wardrobe: number }): Promise<string> {
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const s = await fetch("/api/billing/status", { cache: "no-store" }).then(r => r.json()).catch(() => null);
      if (s && (!before || s.tier !== before.tier || s.itemScans > before.item || s.wardrobeScans > before.wardrobe)) {
        await ent.refresh();
        return s.tier === "pro" && before?.tier !== "pro" ? "You're on MyCloset Pro. Everything AI is unlocked." : "Added to your account.";
      }
    }
    await ent.refresh();
    return "Payment received. It'll show on your account in a moment.";
  }

  async function start(product: Product) {
    setMsg(null);
    if (!emailVerified) { setMsg({ text: "Verify your email before purchasing.", ok: false }); return; }
    if (!config?.enabled) { setMsg({ text: "Payments aren't set up on the website yet.", ok: false }); return; }
    setStarting(product);
    const res = await fetch("/api/billing/web/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setStarting(null);
    if (!res?.ok || !d.clientSecret) { setMsg({ text: d.error ?? "Couldn't start checkout. You haven't been charged.", ok: false }); return; }
    setCheckout({ product, clientSecret: d.clientSecret });
  }

  async function manageSub(action: "cancel" | "resume") {
    const res = await fetch("/api/billing/web/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    if (!res?.ok) { setMsg({ text: "Couldn't update your subscription. Try again.", ok: false }); return; }
    setWebSub(s => (s ? { ...s, cancelAtPeriodEnd: action === "cancel" } : s));
    setMsg({ text: action === "cancel" ? "Canceled. You keep Pro until the end of the period you've paid for." : "Your subscription will keep renewing.", ok: true });
  }

  const pro = ent.tier === "pro";
  const renews = webSub?.renewsAt ? new Date(webSub.renewsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;

  return (
    <ReadyGate ready={!!config && ent.ready}>
    <main className="nav-row-host" style={{ ...FONT, minHeight: "100dvh", background: "#fff", display: "flex", justifyContent: "center", padding: "7vh 24px 10vh" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <p className="nav-row" style={{ ...FONT, fontSize: 14, fontWeight: 700, letterSpacing: "0.07em", textAlign: "center", margin: 0, color: TEXT }}>UPGRADE</p>
        <p style={{ fontSize: 13, color: MUTED, textAlign: "center", margin: "10px 0 24px", lineHeight: "19px" }}>
          {pro ? "You have full Pro access." : (ent.itemScans ?? 0) > 0 || (ent.wardrobeScans ?? 0) > 0
            ? "You're on the Free plan, with one-time analyses to use."
            : "You're on the Free plan: organization and browsing only, no AI."}
        </p>
        <div style={{ minHeight: 18, marginBottom: 8, textAlign: "center" }}>
          {msg && <p style={{ fontSize: 12, color: msg.ok ? GOOD : BAD, margin: 0 }}>{msg.text}</p>}
        </div>

        <div data-tutorial="upgrade.plans">
        {SUBSCRIPTION_PLANS.map(plan => {
          const isFree = plan.priceUsd === 0;
          const current = (isFree && !pro) || (!isFree && pro);
          return (
            <div key={plan.id} style={{ border: `1px solid ${BORDER}`, padding: 24, marginBottom: 16, textAlign: "center" }}>
              {!isFree && <p style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.07em", margin: 0 }}>{plan.name.toUpperCase()}</p>}
              <p style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.07em", margin: isFree ? 0 : "4px 0 0" }}>{isFree ? "FREE" : `$${plan.priceUsd.toFixed(2)}/MO`}</p>
              <p style={{ fontSize: 13, color: MUTED, margin: "8px 0 0" }}>{plan.description}</p>
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.features.map(f => <p key={f} style={{ fontSize: 12, color: MUTED, margin: 0 }}>{f}</p>)}
              </div>
              <div style={{ marginTop: 20 }}>
                {current ? (
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: GOOD, margin: 0 }}>CURRENT PLAN</p>
                ) : !isFree && (
                  <button onClick={() => start("pro")} disabled={!!starting} style={btn(TEXT, !!starting)}>{starting === "pro" ? "STARTING..." : "SUBSCRIBE"}</button>
                )}
                {!isFree && pro && webSub?.active && (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 11, color: MUTED, margin: "0 0 4px" }}>
                      {webSub.cancelAtPeriodEnd ? `Canceled: Pro until ${renews ?? "the end of this period"}.` : `Renews ${renews ?? "monthly"}.`}
                    </p>
                    <button onClick={() => manageSub(webSub.cancelAtPeriodEnd ? "resume" : "cancel")} style={btn(webSub.cancelAtPeriodEnd ? TEXT : FAINT)}>
                      {webSub.cancelAtPeriodEnd ? "KEEP SUBSCRIPTION" : "CANCEL SUBSCRIPTION"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>

        {/* Same terms the app shows at the point of purchase. */}
        <p style={{ fontSize: 10, color: FAINT, textAlign: "center", lineHeight: "15px", margin: "4px 0 0" }}>
          Subscriptions renew monthly until canceled. Cancel anytime on this page; access continues until the end of the current billing period.
        </p>
        <p style={{ fontSize: 10, color: FAINT, textAlign: "center", lineHeight: "15px", margin: "6px 0 0" }}>
          AI features send your item photos and details (and your age range and style preference, if set) to OpenAI to generate analyses. By purchasing or using them you agree to this.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 8 }}>
          <Link href="/terms" style={{ ...btn(MUTED), fontSize: 9, textDecoration: "none" }}>TERMS</Link>
          <Link href="/privacy" style={{ ...btn(MUTED), fontSize: 9, textDecoration: "none" }}>PRIVACY POLICY</Link>
        </div>

        <div style={{ marginTop: 32 }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: TEXT, textAlign: "center", margin: 0 }}>ONE-TIME PURCHASES</p>
          {ONE_TIME.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: TEXT, margin: 0 }}>{c.name}</p>
                <p style={{ fontSize: 11, color: MUTED, margin: "2px 0 0", lineHeight: "16px" }}>{c.note}</p>
              </div>
              <button onClick={() => start(c.id)} disabled={!!starting} style={{ ...btn(TEXT, !!starting), fontSize: 11 }}>
                {starting === c.id ? "..." : c.price}
              </button>
            </div>
          ))}
          <p style={{ fontSize: 11, color: MUTED, textAlign: "center", margin: "18px 0 0" }}>
            You have: Single Item Analysis {ent.itemScans ?? 0} · Full Wardrobe Analysis {ent.wardrobeScans ?? 0}
          </p>
        </div>
      </div>

      {checkout && stripePromise && (
        <Elements stripe={stripePromise} options={{ clientSecret: checkout.clientSecret, appearance: APPEARANCE }}>
          <CheckoutPanel
            summary={SUMMARY[checkout.product]}
            onClose={() => setCheckout(null)}
            onPaid={async () => {
              const before = { tier: ent.tier, item: ent.itemScans ?? 0, wardrobe: ent.wardrobeScans ?? 0 };
              setCheckout(null);
              setMsg({ text: "Payment received. Adding it to your account…", ok: true });
              setMsg({ text: await waitForPurchase(before), ok: true });
              fetch("/api/billing/web/subscription").then(r => r.ok ? r.json() : null).then(setWebSub).catch(() => {});
            }}
          />
        </Elements>
      )}
    </main>
    </ReadyGate>
  );
}

// The checkout panel: our own layout around Stripe's secure card fields.
function CheckoutPanel({ summary, onClose, onPaid }: { summary: string; onClose: () => void; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements || paying) return;
    setPaying(true);
    setError(null);
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/upgrade` },
      redirect: "if_required", // only leaves the page when the bank requires its own verification step
    });
    if (err) {
      setError(err.message ?? "That payment didn't go through. You haven't been charged.");
      setPaying(false);
      return;
    }
    onPaid();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ ...FONT, background: "#fff", width: 420, maxWidth: "100%", maxHeight: "92dvh", overflowY: "auto", padding: "28px 28px 22px" }}>
        <p style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.07em", textAlign: "center", margin: 0 }}>CHECKOUT</p>
        <p style={{ fontSize: 13, color: MUTED, textAlign: "center", margin: "8px 0 20px" }}>{summary}</p>
        <div style={{ opacity: ready ? 1 : 0, transition: "opacity 200ms ease" }}>
          <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />
        </div>
        {error && <p style={{ fontSize: 12, color: BAD, textAlign: "center", margin: "12px 0 0" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "center", gap: 28, marginTop: 20 }}>
          <button onClick={onClose} disabled={paying} style={btn(FAINT, paying)}>CANCEL</button>
          <button onClick={pay} disabled={!ready || paying} style={btn(TEXT, !ready || paying)}>{paying ? "PROCESSING..." : "PAY"}</button>
        </div>
        <p style={{ fontSize: 10, color: FAINT, textAlign: "center", margin: "14px 0 0", lineHeight: "15px" }}>
          Payments are processed securely by Stripe. Your card details are never stored on MyCloset&apos;s servers.
        </p>
      </div>
    </div>
  );
}
