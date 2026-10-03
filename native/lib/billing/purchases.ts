// Thin wrapper around the real in-app-purchase SDK. Isolated behind this one module boundary
// on purpose: every screen that needs to sell something (UpgradeScreen) calls only these
// functions, never a native purchases library directly, so wiring up the real SDK later is a
// change to this one file.
//
// STATUS: not yet connected to a real store. Making it real requires, in order:
//   1. An Apple Developer Program account ($99/yr) and a Google Play Console account ($25
//      one-time) — both are account-holder actions no amount of code can substitute for.
//   2. In App Store Connect / Google Play Console, create subscription products with IDs
//      matching native/lib/billing/plans.ts exactly (mycloset_pro_monthly, mycloset_item_scan,
//      mycloset_wardrobe_scan).
//   3. A RevenueCat project (free up to $2.5k MTR) — recommended over hand-rolling StoreKit /
//      Play Billing receipt verification, since RevenueCat handles cross-platform receipt
//      validation and calls ../../../app/api/billing/revenuecat-webhook/route.ts automatically
//      on every purchase/renewal/cancellation event.
//   4. `npx expo install react-native-purchases` + `pod install`, then replace the body of each
//      function below with the real Purchases.* calls (configure/getOfferings/purchasePackage/
//      restorePurchases) per https://www.revenuecat.com/docs/getting-started/installation/expo.
// Deliberately not installed automatically in this pass — adding a new native module means a
// pod install + full rebuild cycle, which is a real risk to take blind on someone else's working
// build without being able to verify the result interactively right after.

export type Offering = {
  productId: string;
  priceString: string; // store-localized, e.g. "$9.99"
};

export class PurchasesNotConfiguredError extends Error {
  constructor() {
    super("Purchases aren't connected to the App Store / Play Store yet.");
    this.name = "PurchasesNotConfiguredError";
  }
}

// When wiring the real SDK: configure RevenueCat with appUserID = this user's account id
// (Purchases.configure({ apiKey, appUserID: userId }) or Purchases.logIn(userId)). The purchase
// webhook (app/api/billing/revenuecat-webhook/route.ts) matches buyers by exactly that id — with
// RevenueCat's default anonymous id, no purchase could ever be credited to the right account.
export async function initPurchases(_userId: string): Promise<void> {
  // no-op until react-native-purchases is installed and configured (see header comment)
}

export async function getOfferings(): Promise<Offering[]> {
  throw new PurchasesNotConfiguredError();
}

export async function purchaseProduct(_productId: string): Promise<void> {
  throw new PurchasesNotConfiguredError();
}

export async function restorePurchases(): Promise<void> {
  throw new PurchasesNotConfiguredError();
}
