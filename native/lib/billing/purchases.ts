// Thin wrapper around RevenueCat (react-native-purchases). Every screen that sells something
// (UpgradeScreen) calls only these functions, never the SDK directly.
//
// Purchases are granted by the server, not here: RevenueCat calls
// ../../../app/api/billing/revenuecat-webhook/route.ts on every purchase / renewal /
// cancellation, matching the buyer by appUserID = this account's id. After a purchase the
// caller refreshes entitlements (useEntitlements().refresh) to pick the change up.
//
// Off entirely while PAYMENTS_ENABLED is false (lib/config.ts) — the SDK is never configured,
// and every call below throws PurchasesNotConfiguredError. In Expo Go the SDK runs in its own
// "Preview API Mode" (mocked, no real purchases); real purchases need an EAS / dev build.
import { Platform } from "react-native";
import Purchases, { PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, type PurchasesError } from "react-native-purchases";
import { PAYMENTS_ENABLED, REVENUECAT_IOS_API_KEY, REVENUECAT_ANDROID_API_KEY } from "../config";
import { SUBSCRIPTION_PLANS } from "./plans";

export class PurchasesNotConfiguredError extends Error {
  constructor() {
    super("Purchases aren't connected to the App Store / Play Store yet.");
    this.name = "PurchasesNotConfiguredError";
  }
}

// The buyer closed the store sheet — not an error worth showing.
export class PurchaseCancelledError extends Error {
  constructor() {
    super("Purchase cancelled.");
    this.name = "PurchaseCancelledError";
  }
}

const apiKey = Platform.OS === "ios" ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;
export const purchasesAvailable = PAYMENTS_ENABLED && !!apiKey;

let configuredFor: string | null = null;

// Called whenever the signed-in account changes (lib/billing/Entitlements.tsx). appUserID must be
// the account id — with RevenueCat's default anonymous id the webhook couldn't credit anyone.
export async function initPurchases(userId: string | null): Promise<void> {
  if (!purchasesAvailable || configuredFor === userId) return;
  try {
    if (!userId) {
      if (configuredFor) await Purchases.logOut();
    } else if (configuredFor === null && !(await Purchases.isConfigured())) {
      Purchases.configure({ apiKey, appUserID: userId });
    } else {
      await Purchases.logIn(userId);
    }
    configuredFor = userId;
  } catch (e) {
    console.warn("[purchases] init failed", e);
  }
}

function ready() {
  if (!purchasesAvailable || !configuredFor) throw new PurchasesNotConfiguredError();
}

const SUBSCRIPTION_IDS = new Set(SUBSCRIPTION_PLANS.flatMap(p => (p.productId ? [p.productId.ios, p.productId.android] : [])));
const categoryOf = (productId: string) =>
  SUBSCRIPTION_IDS.has(productId) ? PRODUCT_CATEGORY.SUBSCRIPTION : PRODUCT_CATEGORY.NON_SUBSCRIPTION;

// Store-localized prices ("$4.99", "4,99 €") by product id. Apple wants the store's own price
// shown; missing ids fall back to the USD prices in plans.ts.
export async function getLocalizedPrices(productIds: string[]): Promise<Record<string, string>> {
  if (!purchasesAvailable || !configuredFor) return {};
  const out: Record<string, string> = {};
  try {
    const subs = productIds.filter(id => categoryOf(id) === PRODUCT_CATEGORY.SUBSCRIPTION);
    const others = productIds.filter(id => categoryOf(id) !== PRODUCT_CATEGORY.SUBSCRIPTION);
    const lists = await Promise.all([
      subs.length ? Purchases.getProducts(subs, PRODUCT_CATEGORY.SUBSCRIPTION) : [],
      others.length ? Purchases.getProducts(others, PRODUCT_CATEGORY.NON_SUBSCRIPTION) : [],
    ]);
    for (const p of lists.flat()) out[p.identifier] = p.priceString;
  } catch (e) {
    console.warn("[purchases] price lookup failed", e);
  }
  return out;
}

export async function purchaseProduct(productId: string): Promise<void> {
  ready();
  const [product] = await Purchases.getProducts([productId], categoryOf(productId));
  if (!product) throw new Error(`Product ${productId} isn't available in the store.`);
  try {
    await Purchases.purchaseStoreProduct(product);
  } catch (e) {
    const err = e as PurchasesError;
    if (err?.userCancelled || err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) throw new PurchaseCancelledError();
    throw e;
  }
}

export async function restorePurchases(): Promise<void> {
  ready();
  await Purchases.restorePurchases();
}
