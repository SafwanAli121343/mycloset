import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../lib/api";
import { useNavBarVisibility } from "../lib/NavBarVisibility";
import { measureTargetInStage, openSettingsPage, setTour, type Rect, type TutorialStage } from "../lib/tutorial";
import { BAR_CONTENT_H, BAR_BOTTOM_GAP } from "./BottomNavBar";
import { colors, spacing } from "../theme/theme";
import type { MainTabParamList } from "../navigation/MainTabs";

// The first-run tutorial (same steps and wording as the website's components/Tutorial.tsx).
// Offered once per new account right after ENTER ("TUTORIAL?" YES / NO — /api/user/tutorial).
// Each step opens a page, greys it out, cuts a clear window around the feature being shown and
// points an arrow at it with a line of text. The nav bar stays hidden until the last step, which
// brings it back and explains it.

type Zone = { x: number; y: number; w: number; h: number }; // fractions of the screen
type Step = {
  tab: keyof MainTabParamList;
  title: string;
  text: string;
  target?: string;     // a tutorialTarget() id — measured for an exact fit
  zone?: Zone;         // fallback / fixed region when there's no target
  settingsPage?: string;
  navbar?: boolean;
  where?: string; // where to open this feature yourself
};

const STEPS: Step[] = [
  { tab: "Closet", target: "closet.main", zone: { x: 0.06, y: 0.16, w: 0.88, h: 0.4 }, title: "MY CLOSET", where: "Open it any time with CLOSET in the nav bar.",
    text: "Every piece you own lives here; flip through with a swipe or the arrows. The score, pros and cons and pairings on each piece are AI analysis, part of MyCloset Pro." },
  { tab: "Add", target: "add.main", zone: { x: 0.08, y: 0.08, w: 0.84, h: 0.1 }, title: "ADD ITEMS", where: "Open it with ADD in the nav bar.",
    text: "Add pieces by taking a photo or pasting a product link. The details get filled in for you." },
  { tab: "Calendar", zone: { x: 0.04, y: 0.13, w: 0.92, h: 0.5 }, title: "CALENDAR", where: "Open it with CAL in the nav bar.",
    text: "An outfit planned for every day of the month, matched to your weather. Tap a day to see it." },
  { tab: "Outfits", zone: { x: 0.04, y: 0.12, w: 0.92, h: 0.55 }, title: "OUTFITS", where: "Open it with OUTFITS in the nav bar.",
    text: "Every outfit your closet can make, best first. Tap a stack to spread it out. Outfit scores and analysis are part of MyCloset Pro." },
  { tab: "Builder", zone: { x: 0.06, y: 0.14, w: 0.88, h: 0.5 }, title: "BUILD", where: "Open it with BUILD in the nav bar.",
    text: "Put together your own outfit, piece by piece, and see how it scores." },
  { tab: "Preview", zone: { x: 0.06, y: 0.14, w: 0.88, h: 0.5 }, title: "PREVIEW", where: "Open it with PREVIEW in the nav bar.",
    text: "Thinking of buying something? See how it would fit your wardrobe before you buy it." },
  { tab: "Wardrobe", zone: { x: 0.08, y: 0.1, w: 0.84, h: 0.45 }, title: "WARDROBE", where: "Open it with WARDROBE in the nav bar.",
    text: "Your wardrobe report: an overall score, plus the gaps, missing colors and weaknesses to work on next. The report needs MyCloset Pro (or a one-time Full Wardrobe Analysis)." },
  { tab: "Upgrade", zone: { x: 0.06, y: 0.16, w: 0.88, h: 0.42 }, title: "UPGRADE", where: "Open it with UPGRADE in the nav bar, or Settings → Plan.",
    text: "Go Pro for every AI feature, or buy a single item score or one full wardrobe analysis." },
  { tab: "Settings", settingsPage: "FEEDBACK", target: "settings.feedback", zone: { x: 0.08, y: 0.18, w: 0.84, h: 0.4 }, title: "FEEDBACK", where: "Open SETTINGS in the nav bar, then flip to FEEDBACK with the arrows.",
    text: "Found a bug or have an idea? Send it from Settings → Feedback. Every message gets read." },
  { tab: "Closet", navbar: true, title: "NAVIGATION",
    text: "This bar takes you to every page. It tucks away while you browse. Tap the arrow in the top-right corner to bring it back." },
];

const { width: W, height: H } = Dimensions.get("window");
const DIM = "rgba(0,0,0,0.55)"; // only behind the "TUTORIAL?" question card

export function TutorialOverlay({ navigate }: { navigate: (tab: keyof MainTabParamList) => void }) {
  const insets = useSafeAreaInsets();
  const { show, hide, setSuppressed } = useNavBarVisibility();
  const [prompt, setPrompt] = useState(false);
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const suppressedRef = useRef(false);

  // Offered once, right after ENTER, to accounts created with the prompt pending.
  useEffect(() => {
    apiJson<{ pending: boolean }>("/api/user/tutorial").then(r => { if (r.pending) setPrompt(true); }).catch(() => {});
  }, []);

  const answer = useCallback((yes: boolean) => {
    setPrompt(false);
    apiJson("/api/user/tutorial", { method: "POST" }).catch(() => {});
    if (yes) {
      hide();
      if (!suppressedRef.current) { setSuppressed(true); suppressedRef.current = true; }
      setTour({ demo: true });
      setStepIdx(0);
    }
  }, [hide, setSuppressed]);

  const release = useCallback(() => {
    if (suppressedRef.current) { setSuppressed(false); suppressedRef.current = false; }
  }, [setSuppressed]);
  useEffect(() => () => release(), [release]);

  // Layout of the tour on screen: SKIP row on top, then the page shrunk into a preview card, then
  // the tutorial text in the space left below it — so the text can never overlap the page. The
  // card's size is worked out per step so the text always fits (the last step also leaves room
  // for the nav bar it's showing).
  const topBand = insets.top + 46;
  const barSpace = BAR_CONTENT_H + insets.bottom + BAR_BOTTOM_GAP + 8;
  function stageFor(step: Step): NonNullable<TutorialStage> {
    const textRoom = 268;
    const bottomRoom = step.navbar ? barSpace : insets.bottom + 8;
    const scale = Math.max(0.36, Math.min(0.62, (H - topBand - textRoom - bottomRoom) / H));
    return { scale, top: topBand };
  }

  // Each step: open its page (shrunk into the card), let it settle, then find what to point at.
  useEffect(() => {
    if (stepIdx === null) return;
    const step = STEPS[stepIdx];
    const stage = stageFor(step);
    let cancelled = false;
    fade.setValue(0);
    setRect(null);
    setTour({ stage });
    navigate(step.tab);
    if (step.settingsPage) openSettingsPage(step.settingsPage);
    if (step.navbar) { release(); show(); }
    const t = setTimeout(async () => {
      let r: Rect | null = null;
      if (step.navbar) {
        r = { x: 10, y: H - insets.bottom - BAR_BOTTOM_GAP - BAR_CONTENT_H, width: W - 20, height: BAR_CONTENT_H };
      } else {
        if (step.target) r = await measureTargetInStage(step.target, stage, W);
        if (!r && step.zone) {
          const z = step.zone;
          r = {
            x: W / 2 + stage.scale * (z.x * W - W / 2), y: stage.top + stage.scale * z.y * H,
            width: z.w * W * stage.scale, height: z.h * H * stage.scale,
          };
        }
      }
      if (cancelled) return;
      setRect(r);
      Animated.timing(fade, { toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    }, 520);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  const finish = useCallback(() => {
    setStepIdx(null);
    setTour({ demo: false, stage: null });
    release();
    show();
    navigate("Closet");
  }, [release, show, navigate]);

  if (prompt) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.dimFull]}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>TUTORIAL?</Text>
          <Text style={styles.cardBody}>A quick walk through everything the app can do.</Text>
          <View style={{ flexDirection: "row", gap: 36, marginTop: spacing.lg }}>
            <TouchableOpacity onPress={() => answer(false)} hitSlop={12}><Text style={[styles.btn, { color: colors.textFaint }]}>NO</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => answer(true)} hitSlop={12}><Text style={[styles.btn, { color: colors.text }]}>YES</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }
  if (stepIdx === null) return null;

  const step = STEPS[stepIdx];
  const last = stepIdx === STEPS.length - 1;
  const stage = stageFor(step);
  const cardBottom = stage.top + stage.scale * H;
  // Text area: from just under the card to just above the nav bar (last step) or screen bottom.
  const areaTop = cardBottom + 6;
  const areaBottom = step.navbar ? barSpace : insets.bottom + 8;
  // The arrow sits in the gap between the card and the text, lined up with what it points at —
  // never on top of the page itself.
  const arrowX = Math.max(24, Math.min(W - 24, rect ? rect.x + rect.width / 2 : W / 2));

  const nextBtn = (
    <TouchableOpacity onPress={() => (last ? finish() : setStepIdx(i => (i ?? 0) + 1))} hitSlop={14} style={{ alignSelf: "center", marginTop: 16 }}>
      <Text style={[styles.btn, { color: colors.text }]}>{last ? "DONE" : "NEXT"}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Touches on the page itself are blocked so the tour can't be wandered out of mid-way. */}
      <View style={StyleSheet.absoluteFill} />

      <Animated.View style={[styles.textBlock, { top: areaTop, bottom: areaBottom, opacity: fade }]} pointerEvents="box-none">
        {!step.navbar && (
          <View style={{ height: 40, width: "100%" }}>
            <Ionicons name="arrow-up" size={32} color={colors.text} style={{ position: "absolute", left: arrowX - 16, top: 2 }} />
          </View>
        )}
        <View style={{ flex: 1, justifyContent: step.navbar ? "flex-end" : "flex-start" }}>
          <TextBody step={step} />
          {nextBtn}
        </View>
        {step.navbar && (
          <View style={{ height: 40, width: "100%" }}>
            <Ionicons name="arrow-down" size={32} color={colors.text} style={{ position: "absolute", left: arrowX - 16, top: 4 }} />
          </View>
        )}
      </Animated.View>

      <View style={[styles.controls, { top: insets.top + 12 }]}>
        <TouchableOpacity onPress={finish} hitSlop={12}><Text style={[styles.btn, { color: colors.textFaint }]}>{last ? "" : "SKIP"}</Text></TouchableOpacity>
        <Text style={styles.counter}>{stepIdx + 1} / {STEPS.length}</Text>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );
}

function TextBody({ step }: { step: Step }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: spacing.xl }}>
      <Text style={styles.stepTitle}>{step.title}</Text>
      <Text style={styles.stepText}>{step.text}</Text>
      {step.where && <Text style={styles.stepWhere}>{step.where}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  dimFull: { backgroundColor: DIM, alignItems: "center", justifyContent: "center" },
  textBlock: { position: "absolute", left: 0, right: 0 },
  stepTitle: { color: colors.text, fontSize: 13, fontWeight: "700", letterSpacing: 2, marginBottom: 6 },
  stepWhere: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textAlign: "center", marginTop: 10 },
  stepText: { color: colors.text, fontSize: 15, fontWeight: "600", lineHeight: 22, textAlign: "center" },
  controls: { position: "absolute", left: 22, right: 22, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  counter: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5 },
  btn: { color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  card: { backgroundColor: colors.bg, paddingVertical: 28, paddingHorizontal: 32, alignItems: "center", width: 300 },
  cardTitle: { fontSize: 16, fontWeight: "700", letterSpacing: 2, color: colors.text },
  cardBody: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 8 },
});
