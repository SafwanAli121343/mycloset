import { NAV_ROW_TOP, NAV_ROW_H } from "../components/ShowNavButton";
import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { TextButton } from "../components/TextButton";
import { LegalModal, type LegalDocId } from "../components/LegalModal";
import { useStatusMessage, StatusMessage } from "../components/StatusMessage";
import { useEntitlements } from "../lib/billing/Entitlements";
import { useAuth } from "../lib/AuthContext";
import { purchaseProduct, restorePurchases, getLocalizedPrices, PurchasesNotConfiguredError, PurchaseCancelledError } from "../lib/billing/purchases";
import { SUBSCRIPTION_PLANS, CONSUMABLE_PRODUCTS, type SubscriptionPlan } from "../lib/billing/plans";
import { colors, type, spacing } from "../theme/theme";

const NOT_LIVE = "In-app purchases aren't available yet.";

// The server grants a purchase when RevenueCat's webhook arrives, usually within a few seconds,
// so poll entitlements briefly instead of trusting a single refresh.
async function awaitGrant(refresh: () => Promise<void>) {
  for (const ms of [1500, 3000, 5000, 8000]) {
    await new Promise(r => setTimeout(r, ms));
    await refresh();
  }
}

// Same visual language as Settings/Outfits filter panel: centered uppercase labels, plain text
// buttons (no boxed/filled buttons), hairline dividers between sections. onStatus is the parent
// screen's single shared status message (see UpgradeScreen) rather than each card owning its
// own — at most one SUBSCRIBE button is ever actionable at a time (Free has none, Pro is the
// only paid plan), so one shared message slot is simpler than duplicating the mechanism per card.
function PlanCard({ plan, current, price, onStatus }: { plan: SubscriptionPlan; current: boolean; price?: string; onStatus: (text: string, kind: "good" | "bad") => void }) {
  const [busy, setBusy] = useState(false);
  const { emailVerified } = useAuth();
  const { refresh } = useEntitlements();

  async function subscribe() {
    if (!plan.productId) return;
    if (!emailVerified) { onStatus("Verify your email before upgrading to Pro.", "bad"); return; }
    setBusy(true);
    try {
      await purchaseProduct(Platform.OS === "ios" ? plan.productId.ios : plan.productId.android);
      onStatus("Thanks! Unlocking Pro...", "good");
      await awaitGrant(refresh);
    } catch (e) {
      if (e instanceof PurchaseCancelledError) {
        // closed the store sheet: nothing to say
      } else if (e instanceof PurchasesNotConfiguredError) {
        onStatus(NOT_LIVE, "bad");
      } else {
        onStatus("Purchase failed. Please try again.", "bad");
      }
    } finally {
      setBusy(false);
    }
  }

  const isFree = plan.priceUsd === 0;
  return (
    <View style={styles.planCard}>
      {/* Free plan has nothing to name above its own price line ("FREE") — a heading here just
         repeated the same word twice, stacked. */}
      {!isFree && <Text style={[type.title, { textAlign: "center" }]}>{plan.name.toUpperCase()}</Text>}
      <Text style={[type.title, { textAlign: "center", marginTop: isFree ? 0 : 4, fontSize: 20 }]}>
        {isFree ? "FREE" : `${price ?? `$${plan.priceUsd.toFixed(2)}`}/MO`}
      </Text>
      <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm }]}>
        {plan.description}
      </Text>
      <View style={{ marginTop: spacing.md, gap: 6 }}>
        {plan.features.map(f => (
          <Text key={f} style={[type.body, { fontSize: 12, textAlign: "center", color: colors.textMuted }]}>{f}</Text>
        ))}
      </View>
      {(current || plan.productId) && (
        <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
          {current ? (
            <Text style={[type.label, { color: colors.good }]}>CURRENT PLAN</Text>
          ) : (
            <TextButton label={busy ? "PROCESSING..." : "SUBSCRIBE"} onPress={subscribe} disabled={busy} loading={busy} />
          )}
        </View>
      )}
    </View>
  );
}

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const { tier, aiCredits, refresh } = useEntitlements();
  // Store-localized prices; the USD prices in plans.ts show until (or unless) these load.
  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...SUBSCRIPTION_PLANS.flatMap(p => (p.productId ? [p.productId[Platform.OS === "ios" ? "ios" : "android"]] : [])),
      ...CONSUMABLE_PRODUCTS.map(c => c.productId[Platform.OS === "ios" ? "ios" : "android"])];
    getLocalizedPrices(ids).then(setPrices);
  }, []);
  const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
  const { emailVerified } = useAuth();
  const { status, showStatus } = useStatusMessage();

  async function onConsumable(productId: string) {
    if (!emailVerified) { showStatus("Verify your email before upgrading to Pro.", "bad"); return; }
    try {
      await purchaseProduct(productId);
      showStatus("Thanks! Adding your purchase...", "good");
      await awaitGrant(refresh);
    } catch (e) {
      if (e instanceof PurchaseCancelledError) {
        // closed the store sheet: nothing to say
      } else if (e instanceof PurchasesNotConfiguredError) {
        showStatus(NOT_LIVE, "bad");
      } else {
        showStatus("Purchase failed. Please try again.", "bad");
      }
    }
  }

  async function onRestore() {
    try {
      await restorePurchases();
      showStatus("Your purchases have been restored.", "good");
      awaitGrant(refresh);
    } catch (e) {
      if (e instanceof PurchasesNotConfiguredError) {
        showStatus(NOT_LIVE, "bad");
      } else {
        showStatus("Restore failed. Please try again.", "bad");
      }
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingTop: NAV_ROW_TOP, paddingBottom: insets.bottom + spacing.xl }}>
        {/* Same fix as Settings: SafeAreaView already applies insets.top (this was doubling it).
           Title on the nav chevron's exact center line. */}
        <View style={{ height: NAV_ROW_H, justifyContent: "center" }}>
          <Text style={[type.title, { textAlign: "center" }]}>UPGRADE</Text>
        </View>
        <Text style={[type.body, { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.xl }]}>
          {tier === "pro"
            ? "You have full Pro access."
            : (aiCredits ?? 0) > 0
            ? `You're on the Free plan with ${aiCredits} Single Item Analys${aiCredits === 1 ? "is" : "es"} left. Use them with USE SCORE? in My Closet.`
            : "You're on the Free plan: organization and browsing only, no AI."}
        </Text>

        <View style={{ minHeight: 18, justifyContent: "center", marginBottom: spacing.sm }}>
          <StatusMessage status={status} />
        </View>

        {SUBSCRIPTION_PLANS.map(p => (
          <PlanCard key={p.id} plan={p} current={p.id === tier} price={p.productId ? prices[Platform.OS === "ios" ? p.productId.ios : p.productId.android] : undefined} onStatus={showStatus} />
        ))}

        {/* Apple guideline 3.1.1 / Google Play billing policy both require auto-renewal terms
           to be stated at the point of purchase, not just in the Terms document. */}
        <Text style={[type.body, { color: colors.textFaint, fontSize: 10, textAlign: "center", lineHeight: 15 }]}>
          Subscriptions auto-renew monthly until canceled. Cancel anytime from your{" "}
          {Platform.OS === "ios" ? "App Store account settings" : "Google Play account settings"}
          ; access continues until the end of the current billing period.
        </Text>
        {/* App Store guideline 5.1.2(i): say who AI data goes to at the point of purchase. */}
        <Text style={[type.body, { color: colors.textFaint, fontSize: 10, textAlign: "center", lineHeight: 15, marginTop: spacing.xs }]}>
          AI features send your item photos and details (and your age range and style preference, if set) to OpenAI to
          generate analyses. By purchasing or using them you agree to this. See the Privacy Policy.
        </Text>
        {/* App Store guideline 3.1.2: the purchase screen itself must link to the Terms of Use
           (EULA) and Privacy Policy. */}
        <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.lg, marginTop: spacing.sm }}>
          <TextButton label="TERMS OF USE (EULA)" size={9} color={colors.textMuted} onPress={() => setLegalDoc("eula")} />
          <TextButton label="PRIVACY POLICY" size={9} color={colors.textMuted} onPress={() => setLegalDoc("privacy")} />
        </View>

        <View style={styles.section}>
          <Text style={[type.label, { textAlign: "center", color: colors.text }]}>ONE-TIME PURCHASES</Text>
          {CONSUMABLE_PRODUCTS.map(c => (
            <View key={c.id} style={styles.consumableRow}>
              <Text style={[type.body, { flex: 1, fontWeight: "700", color: colors.text }]}>{c.name}</Text>
              <TextButton
                label={prices[Platform.OS === "ios" ? c.productId.ios : c.productId.android] ?? `$${c.priceUsd.toFixed(2)}`}
                size={11}
                onPress={() => onConsumable(Platform.OS === "ios" ? c.productId.ios : c.productId.android)}
              />
            </View>
          ))}
        </View>


        <TouchableOpacity onPress={onRestore} style={{ marginTop: spacing.md, alignItems: "center" }}>
          <Text style={[type.button, { fontSize: 10, color: colors.textFaint }]}>RESTORE PURCHASES</Text>
        </TouchableOpacity>
      </ScrollView>
      <LegalModal doc={legalDoc} visible={!!legalDoc} onClose={() => setLegalDoc(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  planCard: { borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  section: { marginTop: spacing.xl },
  consumableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
});
