# Paid update checklist

Version 1 ships free-only. The purchase code is already written and installed; it's switched off by
two flags. This is everything needed to turn paid features on.

## What's already done

- `react-native-purchases` (RevenueCat) is installed. `native/lib/billing/purchases.ts` is the real
  implementation: configure with the account id, store-localized prices, purchase, restore, and
  cancel handling.
- The Upgrade screen polls entitlements after a purchase, because the server grants access when
  RevenueCat's webhook arrives.
- The server side is done:
  - `app/api/billing/revenuecat-webhook/route.ts` handles subscriptions, consumables and refunds.
  - The AI cost cap, purchase jobs and Pro backfill are all live already.
- Everything the free release hides comes back by itself once the flags flip:
  - the Upgrade tab;
  - the Wardrobe tab for free accounts;
  - the Settings → Plan purchase UI;
  - the "part of MyCloset Pro" lines in the tutorial;
  - the tutorial's Upgrade and Wardrobe steps;
  - the Builder's "Upgrade to score" message.

## 1. App Store Connect

1. In Agreements, Tax and Banking, sign the **Paid Apps** agreement and add your bank and tax
   details. Products can't be sold until this is active.
2. Create the in-app purchases under your app. The IDs must match `native/lib/billing/plans.ts`
   exactly:
   - Auto-renewable subscription `mycloset_pro_monthly`, $4.99/month, in a subscription group
     named "MyCloset Pro".
   - Consumable `mycloset_item_scan`, $0.29 (Single Item Analysis).
   - Consumable `mycloset_wardrobe_scan`, $0.69 (Full Wardrobe Analysis).
3. Give each product a display name, a description and a review screenshot of the Upgrade screen.
4. Under Users and Access → Integrations, create an **In-App Purchase key** (.p8) for RevenueCat.
5. Copy the **App-Specific Shared Secret** from the app's App Information page.

## 2. RevenueCat (free up to $2.5k/month in revenue)

1. Create a project, then add an App Store app with bundle id `com.mycloset.app`. Upload the .p8
   key and paste the shared secret.
2. Import the three products.
3. Under Integrations → Webhooks:
   - URL: `https://<your server>/api/billing/revenuecat-webhook`
   - Authorization header: a long random string.
4. Copy the **iOS public API key** (`appl_...`).

## 3. Server (Railway variables)

- `REVENUECAT_WEBHOOK_SECRET` = the same random string as the webhook's Authorization header.
- `NEXT_PUBLIC_PAYMENTS_LIVE` = `true`, so the website shows Upgrade and Pro mentions again.
  This value is read at build time, so redeploy after setting it.
- Website card payments (optional, separate from the app):
  - Run `supabase/add_web_payments.sql`.
  - Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`.
  - Point a Stripe webhook at `/api/billing/web/webhook`.

## 4. App

In `native/lib/config.ts`:

```ts
export const PAYMENTS_ENABLED = true;
export const REVENUECAT_IOS_API_KEY = "appl_...";
```

In `native/app.json`, bump `"version"` (for example to `1.1.0`).

## 5. Test before submitting

- Real purchases need an EAS build; Expo Go only runs RevenueCat's mocked preview mode.
- Run `eas build -p ios --profile production`, then `eas submit -p ios`, and install from
  TestFlight. TestFlight purchases use the sandbox and are free.
- Buy Pro and confirm, within a few seconds:
  - the Upgrade screen shows CURRENT PLAN;
  - scores appear;
  - the Wardrobe tab shows.
- Buy each consumable and confirm Settings → Plan shows the new counts.
- Delete and reinstall the app, then try **Restore Purchases**.
- In Supabase `users`, confirm the tier and credits changed. In RevenueCat's customer view, confirm
  the app user id is the account's uuid (not `$RCAnonymousID:...`).

## 6. Submit

Attach the three in-app purchases to the new version on its App Store Connect page. Apple reviews
them together with the build. In the review notes, say the demo account can buy with a sandbox
Apple ID.

## Turning on email (separate, any time)

1. Verify the sending domain in Resend.
2. Set `EMAIL_SENDING_LIVE=true` and `EMAIL_LIVE_SINCE=<today's date, e.g. 2026-11-01>` on Railway.

Turning email on brings back verification and "Forgot password?". `EMAIL_LIVE_SINCE` gives every
existing account its 7-day grace period starting from that date, instead of locking them out
immediately.
