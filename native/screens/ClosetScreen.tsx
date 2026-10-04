import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View, Text, Animated, Easing, StyleSheet, TouchableOpacity, Alert,
  PanResponder, Dimensions, type PanResponderGestureState,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { apiJson, apiJsonCached, invalidateCache, ApiError } from "../lib/api";
import { getCached, subscribeCached } from "../lib/dataCache";
import { FocusScrollList, type FocusItem } from "../components/FocusScrollList";
import { ScreenCenter } from "../components/ScreenCenter";
import { ReadyGate } from "../components/ReadyGate";
import { TextButton } from "../components/TextButton";
import { UnderlineField } from "../components/UnderlineField";
import { useStatusMessage, StatusMessage } from "../components/StatusMessage";
import { chunk3 } from "../lib/chunk";
import { describeColorPairing } from "../lib/colorTheory";
import { useEntitlements } from "../lib/billing/Entitlements";
import { AestheticPicker } from "../components/AestheticPicker";
import { NAV_ROW_TOP, NAV_ROW_H } from "../components/ShowNavButton";
import { PAYMENTS_ENABLED } from "../lib/config";
import { colors, type, spacing, scoreColor } from "../theme/theme";
import { AnalysisOverlay } from "../components/AnalysisOverlay";
import { tutorialTarget, useTutorialDemo } from "../lib/tutorial";
import { sampleCloset, SAMPLE_IMAGES } from "../lib/tutorialSamples";
import {
  fetchJobs, startJob, waitForJob, ackJobs, jobFailureMessage, startErrorMessage, ITEM_STAGES, type JobsStatus,
} from "../lib/analysisJobs";

type Garment = {
  id: string; title: string; brand: string | null; sub_type: string | null;
  category: string | null; color_primary: string | null; image: string | null;
  pros: string[] | null; cons: string[] | null;
  color_pairings: string[] | null; color_clashes: string[] | null;
  style_pairings: string[] | null;
  aesthetic_tags?: string[] | null;
  // AI analysis paid for with a one-time purchase — visible on free tier (score stays Pro-only).
  ai_unlocked?: boolean;
};

type EditState = { id: string; title: string; brand: string; color_primary: string; category: string; aesthetic: string };
type EditUpdate = { title?: string; brand: string | null; color_primary: string | null; category?: string; aesthetic?: string };
const EDIT_CATEGORIES = ["top", "bottom", "footwear", "outerwear", "accessory"];
const SLIDE_TRAVEL = 340;
// skipOutfits=1 — this screen only ever reads `pieces` from the response; the endpoint's
// topOutfits field (only consumed by the website's /battle page) requires a combinatorial
// search over the whole wardrobe to build, by far the most expensive part of the route, and
// was the real reason scores visibly took multiple seconds to show up even after the loading
// gate below was already waiting for them correctly.
const SCORING_PATH = "/api/scoring?skipOutfits=1";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
// Bigger than the old fixed 180 (per user request), but bounded by both screen dimensions so
// it can never bleed past the edges: capped by width minus the two arrow buttons' touch targets,
// and by a fraction of screen height so there's still real room left for the picker-wheel body
// text below it.
const ARROW_TOUCH_W = 22 + spacing.md * 2;
const IMAGE_CARD_SIZE = Math.round(Math.min(SCREEN_W - ARROW_TOUCH_W * 2 - spacing.lg, SCREEN_H * 0.3, 260));
const SWIPE_THRESHOLD = 40;

// Same section set and order as the website's mobile view: Pros, Pairs With, Colors, Cons,
// Avoid, then Overdone only when this item's sub_type is currently overrepresented. Section
// labels are marked header:true — FocusScrollList gives header rows a fixed, shorter height
// than body text rows, deterministically by kind rather than by measuring the actual text.
//
// Free tier (no AI) gets only what the free plan actually includes (see plans.ts): Pairs With
// (/api/garments/pairings' deterministic color/aesthetic match for free users) and Colors from
// the same non-AI color rules Preview's free tier uses. No Pros/Cons/Avoid — those are AI-only,
// and showing their headers with "analyzing…"/"none" under them read as broken, since for a free
// item they're never coming.
function buildFocusItems(item: Garment, pairingsForItem: string[], overdoneMap: Record<string, string>, hasAI: boolean): FocusItem[] {
  if (!hasAI) {
    const free: FocusItem[] = [];
    free.push({ key: "h-pairs", text: "PAIRS WITH", color: colors.textFaint, header: true });
    if (pairingsForItem.length > 0) {
      pairingsForItem.forEach((p, i) => free.push({ key: `pairs-${i}`, text: p, color: colors.textMuted }));
    } else {
      free.push({ key: "pairs-empty", text: "nothing in your wardrobe pairs well with this yet, add more items", color: colors.textFaint });
    }
    const colorMatches = item.color_primary ? describeColorPairing(item.color_primary) : [];
    if (colorMatches.length > 0) {
      free.push({ key: "h-colors", text: "COLORS", color: colors.textFaint, header: true });
      chunk3(colorMatches).forEach((c, i) => free.push({ key: `colors-${i}`, words: c, color: colors.textMuted }));
    }
    return free;
  }
  const overdoneSuggestion = item.sub_type ? overdoneMap[item.sub_type.toLowerCase()] : undefined;
  const focusItems: FocusItem[] = [];
  if (item.pros?.length) {
    focusItems.push({ key: "h-pros", text: "PROS", color: colors.textFaint, header: true });
    item.pros.forEach((p, i) => focusItems.push({ key: `pros-${i}`, text: p, color: colors.good }));
  } else {
    focusItems.push({ key: "h-pros", text: "PROS", color: colors.textFaint, header: true });
    focusItems.push({ key: "pros-empty", text: item.pros === null ? "analyzing…" : "none", color: colors.textFaint });
  }
  focusItems.push({ key: "h-pairs", text: "PAIRS WITH", color: colors.textFaint, header: true });
  if (pairingsForItem.length > 0) {
    pairingsForItem.forEach((p, i) => focusItems.push({ key: `pairs-${i}`, text: p, color: colors.textMuted }));
  } else {
    focusItems.push({
      key: "pairs-empty",
      text: item.pros === null ? "analyzing…" : "nothing in your wardrobe pairs well with this yet, add more items",
      color: colors.textFaint,
    });
  }
  // COLORS/CONS/AVOID all now match the website's own closet page exactly (app/closet/page.tsx):
  // the section header always shows, with a "none"/"no cons" placeholder when there's nothing to
  // list, rather than hiding the whole section — a real, previously-shipped difference where
  // native silently dropped these three sections whenever they were genuinely empty (not just
  // still analyzing) instead of saying so.
  focusItems.push({ key: "h-colors", text: "COLORS", color: colors.textFaint, header: true });
  if (item.color_pairings?.length) {
    chunk3(item.color_pairings).forEach((c, i) => focusItems.push({ key: `colors-${i}`, words: c, color: colors.textMuted }));
  } else {
    focusItems.push({ key: "colors-empty", text: "none", color: colors.textFaint });
  }
  focusItems.push({ key: "h-cons", text: "CONS", color: colors.textFaint, header: true });
  if (item.cons?.length) {
    item.cons.forEach((c, i) => focusItems.push({ key: `cons-${i}`, text: c, color: colors.bad }));
  } else {
    focusItems.push({ key: "cons-empty", text: item.cons === null ? "analyzing…" : "no cons", color: colors.textFaint });
  }
  focusItems.push({ key: "h-avoid", text: "AVOID", color: colors.textFaint, header: true });
  if (item.color_clashes?.length) {
    chunk3(item.color_clashes).forEach((c, i) => focusItems.push({ key: `avoid-${i}`, words: c, color: colors.bad }));
  } else {
    focusItems.push({ key: "avoid-empty", text: "none", color: colors.textFaint });
  }
  if (overdoneSuggestion) {
    focusItems.push({ key: "h-overdone", text: "OVERDONE", color: colors.textFaint, header: true });
    focusItems.push({ key: "overdone-0", text: overdoneSuggestion, color: colors.mid });
  }
  return focusItems;
}

// Direct port of app/closet/page.tsx's mobile view: same section set/order (Pros, Pairs With,
// Colors, Cons, Avoid, Overdone), same edit/remove actions and their side effects (calendar
// regen for affected months, wardrobe-leveling cleanup), same live pairings refresh and
// pending-analysis poll. The slide transition (native's own Animated implementation, matching
// the site's slideOut/slideIn keyframes) and the picker-wheel body text are native's format
// adaptations of the same underlying data and actions.
function EditModal({ initial, onSave, onClose }: {
  initial: EditState;
  onSave: (updated: EditUpdate) => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({
      title: fields.title.trim() || undefined,
      brand: fields.brand.trim() || null,
      color_primary: fields.color_primary.trim() || null,
      category: fields.category || undefined,
      // Only sent when changed, so saving other fields never touches an AI-derived aesthetic.
      ...(fields.aesthetic !== initial.aesthetic ? { aesthetic: fields.aesthetic.trim() } : {}),
    });
    setSaving(false);
    setSaveDone(true);
    setTimeout(onClose, 2000);
  }

  return (
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.modalCard}>
        <TouchableOpacity onPress={onClose} style={styles.modalClose} hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        <View style={{ gap: spacing.md }}>
          <UnderlineField value={fields.title} onChangeText={t => setFields(f => ({ ...f, title: t }))} hint="Title" hintWidth={50} />
          <UnderlineField value={fields.brand} onChangeText={t => setFields(f => ({ ...f, brand: t }))} hint="Brand" hintWidth={45} />
          <UnderlineField value={fields.color_primary} onChangeText={t => setFields(f => ({ ...f, color_primary: t }))} hint="Primary Color" hintWidth={90} />
          {/* Same picker as Add Item — available to every tier (a manual aesthetic is the one
             "AI" field a free user can set themselves). */}
          <AestheticPicker value={fields.aesthetic} onChange={a => setFields(f => ({ ...f, aesthetic: a }))} />
        </View>

        <View style={[styles.catRow, { marginTop: spacing.lg }]}>
          {EDIT_CATEGORIES.map(c => (
            <TextButton
              key={c}
              label={c}
              size={10}
              color={fields.category === c ? colors.text : colors.textFaint}
              onPress={() => setFields(f => ({ ...f, category: c }))}
            />
          ))}
        </View>

        {saveDone ? (
          <Text style={[type.label, { color: colors.good, alignSelf: "center", marginTop: spacing.lg }]}>DONE!</Text>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg }}>
            <TextButton label="CANCEL" size={10} color={colors.bad} onPress={onClose} />
            <TextButton label={saving ? "SAVING..." : "SAVE"} size={10} color={colors.good} onPress={handleSave} disabled={saving} loading={saving} />
          </View>
        )}
      </View>
    </View>
  );
}

export default function ClosetScreen() {
  const insets = useSafeAreaInsets();
  const { hasAI, ready: entitlementsReady, refresh: refreshEntitlements } = useEntitlements();
  const [garments, setGarments] = useState<Garment[]>(() => getCached<Garment[]>("/api/garments") ?? []);
  // Seeded from the last saved scores (any age) — stale-while-revalidate: the screen opens
  // instantly with what's on the device, and loadScores() quietly refreshes it.
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const cached = getCached<{ pieces?: { id: string; score: number }[] }>(SCORING_PATH);
    const map: Record<string, number> = {};
    for (const p of cached?.pieces ?? []) map[p.id] = p.score;
    return map;
  });
  // Gates the initial loading screen alongside `loading` (below) so the screen never shows a
  // grey "—" placeholder that later pops in with the real number — the first paint waits for
  // scores too, not just garments. Only affects the FIRST load: like `loading`, this is never
  // reset back to true on a later tab-focus refetch, so a background score refresh never
  // re-triggers the blocking spinner once the screen has already shown real content once.
  //
  // getCached(SCORING_PATH) here MUST pass the same ttl apiJsonCached(SCORING_PATH) below
  // actually uses (its own default, DEFAULT_TTL in lib/api.ts) — calling it with no ttl treats
  // ANY previously-cached entry, however old, as still fresh, which is exactly the bug already
  // found and fixed in Calendar/Outfits/Builder earlier this session but missed here. Since
  // AsyncStorage persists this cache across app launches, a scoring entry from a much earlier
  // session still counted as "already loaded," so scoresLoading initialized to false the moment
  // ANY prior score data existed at all — even though `scores` itself (a few lines up) always
  // starts as a fresh empty {} on every mount, regardless of cache. The screen would render
  // immediately with every item's score genuinely missing, showing the grey "-" placeholder
  // (scoreColor(undefined) is colors.textFaint) for every single item until the real fetch below
  // resolved — on almost any fresh app launch, since the real TTL is only 45s. Matching the ttl
  // here to the fetch's own means this check actually reflects whether SCORING_PATH's cached
  // data is still usable, not just whether it once existed.
  // Any saved copy counts (scores above are seeded from it) — the 45s TTL only decides when to
  // refetch, not whether the screen may open with what it already has.
  const [scoresLoading, setScoresLoading] = useState(!getCached(SCORING_PATH));
  const [overdoneMap, setOverdoneMap] = useState<Record<string, string>>({});
  const [freshPairings, setFreshPairings] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const { status, showStatus } = useStatusMessage();
  // Same ttl-matching fix as scoresLoading above — garments itself (a few lines up) DOES read
  // its initial value from this same cache, so this specific omission was less visible (a stale
  // list briefly shown instead of a wrong empty one), but it's the identical bug.
  const [loading, setLoading] = useState(!getCached("/api/garments"));
  const [error, setError] = useState(false);
  const [editItem, setEditItem] = useState<EditState | null>(null);
  const slideX = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const refreshedRef = useRef(new Set<string>());
  const retryCount = useRef(0);
  // Purchased "Use score?" (free tier): available credits + any job that ran while the app was
  // closed. scoringId = the item whose score is being worked out right now (full-screen loading).
  // First-run tutorial: show the sample closet (lib/tutorialSamples.ts) instead of this account's
  // own — usually still empty for a new account. Display only; nothing is saved or fetched for it.
  const demo = useTutorialDemo();
  // Free-only release (PAYMENTS_ENABLED false): the samples show what this account gets — no AI.
  const sample = useMemo(() => {
    const c = sampleCloset(SAMPLE_IMAGES);
    return PAYMENTS_ENABLED || hasAI ? c : { ...c, garments: c.garments.map(g => ({ ...g, ai_unlocked: false })) };
  }, [hasAI]);
  const shownGarments = demo ? (sample.garments as Garment[]) : garments;
  const shownScores = demo ? sample.scores : scores;
  useEffect(() => { setIndex(0); }, [demo]);
  const [jobs, setJobs] = useState<JobsStatus | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

  // Scoring is fetched on its own, outside the main Promise.all, with the same cold-start
  // retry backoff used elsewhere (see WardrobeScreen/CalendarScreen) — previously a single
  // failed /api/scoring request (e.g. a dev-server cold start compiling that route) was
  // swallowed permanently via .catch(() => null), leaving every item's score stuck on the
  // "—" placeholder for the rest of the session with no way to recover short of a full reload.
  // Kept separate from the garments/wardrobe-state fetch above so a slow or retrying scoring
  // call never delays the wardrobe itself from showing.
  const loadScores = useCallback(async () => {
    // Same total retry budget as WardrobeScreen/CalendarScreen's cold-start handling (up to
    // ~9.5s across 4 attempts) — the previous 0/1500/3000 budget (~4.5s) was too short for a
    // slow dev-server cold compile of this specific route, so scores would still be missing
    // after every retry gave up, only showing up once a later screen focus gave it a fresh
    // (and by then warmed-up) attempt.
    for (const delay of [0, 1500, 3000, 5000]) {
      if (delay) await new Promise(r => setTimeout(r, delay));
      try {
        const scoring = await apiJsonCached<{ pieces?: { id: string; score: number }[] }>(SCORING_PATH);
        if (scoring?.pieces) {
          const map: Record<string, number> = {};
          for (const p of scoring.pieces) map[p.id] = p.score;
          setScores(map);
        }
        setScoresLoading(false);
        return;
      } catch { /* retry */ }
    }
    setScoresLoading(false);
  }, []);

  const load = useCallback(async () => {
    let willRetry = false;
    loadScores();
    try {
      const [data, waState] = await Promise.all([
        apiJsonCached<Garment[]>("/api/garments"),
        apiJsonCached<{ analysisHistory?: { overdone: { description: string; suggestion: string }[] }[]; currentLevel?: number } | null>("/api/wardrobe/state").catch(() => null),
      ]);
      setGarments(data);
      if (waState?.analysisHistory?.length && (waState.currentLevel ?? 0) >= 1) {
        const level = Math.max(1, Math.min(waState.currentLevel ?? 1, waState.analysisHistory.length));
        const analysis = waState.analysisHistory[level - 1];
        // Re-checked against the CURRENT wardrobe (just fetched), not the frozen count from
        // whenever this level's analysis was generated.
        const liveSubTypeCounts: Record<string, number> = {};
        for (const g of data) if (g.sub_type) liveSubTypeCounts[g.sub_type] = (liveSubTypeCounts[g.sub_type] ?? 0) + 1;
        const omap: Record<string, string> = {};
        for (const o of analysis?.overdone ?? []) {
          if ((liveSubTypeCounts[o.description] ?? 0) >= 3) omap[o.description.toLowerCase()] = o.suggestion;
        }
        setOverdoneMap(omap);
      }
      const seed: Record<string, string[]> = {};
      for (const g of data) {
        seed[g.id] = g.style_pairings ?? [];
        if (g.style_pairings?.length) refreshedRef.current.add(g.id);
      }
      // Merge rather than replace: load() now also runs on every tab focus (below), and a
      // flat replace would clobber any item's already-fetched fresh pairings back down to the
      // (older) seed value — spread seed first, prev second, so anything prev already has wins.
      setFreshPairings(prev => ({ ...seed, ...prev }));
      retryCount.current = 0;
      setError(false);
    } catch {
      // Retry with backoff before giving up — same cold-start handling as Wardrobe/Calendar/
      // Outfits. A single transient failure shouldn't blow away whatever content is already on
      // screen (from cache); only surface the failure once retries are actually exhausted.
      if (retryCount.current < 3) {
        const delay = [1500, 3000, 5000][retryCount.current] ?? 5000;
        retryCount.current += 1;
        willRetry = true;
        setTimeout(load, delay);
        return;
      }
      setError(true);
    } finally {
      if (!willRetry) setLoading(false);
    }
  }, [loadScores]);

  // useFocusEffect, not a plain mount-only useEffect: no screen in this app currently refetches
  // on tab focus (only ever at mount) — the bottom tabs stay mounted for the whole app session
  // (lazy:false, no unmountOnBlur), so without this, an item added or scored while on another
  // tab would sit in Closet's state forever, however long the session runs, regardless of
  // whether its client-side cache had already been invalidated elsewhere. This closes that gap
  // and covers the initial visit too (focus fires then as well) — apiJsonCached still respects
  // its TTL, so this is a no-op network-wise on a quick tab switch, but the moment the cache for
  // /api/garments or /api/scoring HAS been invalidated (e.g. after adding an item), the very
  // next time this tab is actually looked at, it's guaranteed fresh — not "whenever the TTL
  // happens to lapse on its own."
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Once the score is ready: pull the item's new details, score and pairings, and its image
  // into memory WHILE the loading screen is still up, so it all appears at once when it lifts.
  const revealScored = useCallback(async (garmentId: string) => {
    invalidateCache("/api/garments");
    invalidateCache(SCORING_PATH);
    invalidateCache(`/api/garments/pairings?id=${garmentId}`);
    const [fresh, scoring, pairs] = await Promise.all([
      apiJsonCached<Garment[]>("/api/garments").catch(() => null),
      apiJsonCached<{ pieces?: { id: string; score: number }[] }>(SCORING_PATH).catch(() => null),
      apiJsonCached<{ pairings?: string[] }>(`/api/garments/pairings?id=${garmentId}`, 10 * 60_000).catch(() => null),
    ]);
    const img = fresh?.find(g => g.id === garmentId)?.image;
    if (img) await Image.prefetch(img, "memory-disk").catch(() => {});
    if (unmounted.current) return;
    if (fresh) setGarments(fresh);
    if (scoring?.pieces) {
      const map: Record<string, number> = {};
      for (const p of scoring.pieces) map[p.id] = p.score;
      setScores(map);
    }
    if (pairs?.pairings) setFreshPairings(prev => ({ ...prev, [garmentId]: pairs.pairings! }));
    refreshedRef.current.add(garmentId);
  }, []);

  const followingRef = useRef<string | null>(null);
  const followJob = useCallback(async (jobId: string, garmentId: string) => {
    // One watcher per job — revisiting the tab while it runs must not start a second one.
    if (followingRef.current === jobId) return;
    followingRef.current = jobId;
    setScoringId(garmentId);
    const job = await waitForJob(jobId, () => unmounted.current);
    if (unmounted.current) return;
    if (job.status === "done") await revealScored(garmentId);
    else if (job.status === "failed") showStatus(jobFailureMessage(job), "bad");
    ackJobs([jobId]);
    followingRef.current = null;
    refreshEntitlements();
    fetchJobs().then(s => { if (!unmounted.current) setJobs(s); }).catch(() => {});
    if (!unmounted.current) setScoringId(null);
  }, [revealScored, showStatus, refreshEntitlements]);

  // Free tier: credits, plus picking up a score that was running (or finished/failed) while
  // the app was closed. Re-checked on every visit to this tab.
  useFocusEffect(useCallback(() => {
    if (!entitlementsReady || hasAI) return;
    let cancelled = false;
    fetchJobs().then(async s => {
      if (cancelled) return;
      setJobs(s);
      const items = s.jobs.filter(j => j.kind === "item");
      const running = items.find(j => j.status === "running");
      if (running?.targetId && !scoringId) {
        const at = garments.findIndex(g => g.id === running.targetId);
        if (at >= 0) setIndex(at);
        followJob(running.id, running.targetId);
      }
      const finished = items.filter(j => j.status !== "running");
      if (finished.some(j => j.status === "done")) {
        for (const j of finished) if (j.status === "done" && j.targetId) await revealScored(j.targetId);
      }
      const failed = finished.find(j => j.status === "failed");
      if (failed) showStatus(jobFailureMessage(failed), "bad");
      ackJobs(finished.map(j => j.id));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlementsReady, hasAI]));

  async function spendScore(item: Garment) {
    if (scoringId) return;
    setScoringId(item.id);
    try {
      const job = await startJob("item", item.id);
      await followJob(job.id, item.id);
    } catch (e) {
      setScoringId(null);
      showStatus(startErrorMessage(e), "bad");
      fetchJobs().then(setJobs).catch(() => {});
    }
  }

  useEffect(() => {
    garments.forEach(g => { if (g.image) Image.prefetch(g.image, "memory-disk").catch(() => {}); });
  }, [garments]);

  // Live updates from other screens' writes to the shared cache — Add Item re-warms
  // /api/garments and scores right after saving, and this tab is always mounted, so Closet is
  // already showing the new item (jumped to it, since it's newest-first) before the user even
  // switches over, instead of painting its old state and then catching up on focus.
  useEffect(() => {
    const unsubGarments = subscribeCached<Garment[]>("/api/garments", data => {
      setGarments(prev => {
        const known = new Set(prev.map(g => g.id));
        if (data.some(g => !known.has(g.id))) setIndex(0);
        return data;
      });
      setLoading(false);
    });
    const unsubScores = subscribeCached<{ pieces?: { id: string; score: number }[] }>(SCORING_PATH, data => {
      if (!data?.pieces) return;
      const map: Record<string, number> = {};
      for (const p of data.pieces) map[p.id] = p.score;
      setScores(map);
      setScoresLoading(false);
    });
    return () => { unsubGarments(); unsubScores(); };
  }, []);

  // Items just added may still be mid-analysis (pros === null) — poll for the completed result
  // instead of leaving those sections permanently blank until the next full reload. Bounded to a
  // handful of attempts per pending set: an item whose analysis genuinely never completes (a
  // failed AI call, e.g.) would otherwise keep this refetching every 3.5s forever — each refetch
  // is a brand new garments array, so every screen consumer re-renders (and any in-flight
  // animation reading stale state via closures) on an endless loop.
  const pollAttemptsRef = useRef(0);
  const lastPendingKeyRef = useRef("");
  useEffect(() => {
    // Free-tier items are never analyzed (pros stays null by design) — nothing to wait for.
    if (!hasAI) return;
    const pending = garments.filter(g => g.pros === null);
    if (pending.length === 0) { pollAttemptsRef.current = 0; lastPendingKeyRef.current = ""; return; }
    const pendingKey = pending.map(g => g.id).sort().join(",");
    if (pendingKey !== lastPendingKeyRef.current) { lastPendingKeyRef.current = pendingKey; pollAttemptsRef.current = 0; }
    if (pollAttemptsRef.current >= 4) return;
    pollAttemptsRef.current += 1;
    const timer = setTimeout(async () => {
      try {
        const fresh = await apiJson<Garment[]>("/api/garments");
        setGarments(fresh);
      } catch {}
    }, 3500);
    return () => clearTimeout(timer);
  }, [garments, hasAI]);

  // Silent background refresh of "Pairs With" for the item currently in view — once per item,
  // no loading state, matches the website's own quiet refresh-on-view behavior.
  useEffect(() => {
    const item = garments[index];
    if (!item || refreshedRef.current.has(item.id)) return;
    refreshedRef.current.add(item.id);
    apiJson<{ pairings: string[] }>(`/api/garments/pairings?id=${item.id}`)
      .then(data => { if (data?.pairings?.length) setFreshPairings(prev => ({ ...prev, [item.id]: data.pairings })); })
      .catch(() => {});
  }, [index, garments]);

  // The slide-IN half used to run inside the slide-OUT callback, immediately after calling
  // setIndex — but setIndex doesn't commit synchronously, so the slide-in animation was
  // starting (and native-thread-animating into view) BEFORE React had actually re-rendered
  // with the new index. For a frame or two it was sliding in the item you were already on
  // (whatever was last committed), only swapping to the correct next item once the state
  // update caught up mid-animation. Moving the slide-in into an effect keyed on `index`
  // guarantees it only ever starts after that commit has already happened.
  const pendingDirRef = useRef<"left" | "right" | null>(null);
  useEffect(() => {
    const dir = pendingDirRef.current;
    if (!dir) return;
    pendingDirRef.current = null;
    slideX.setValue(dir === "right" ? SLIDE_TRAVEL : -SLIDE_TRAVEL);
    Animated.timing(slideX, { toValue: 0, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(() => {
      busy.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function navigate(dir: "left" | "right") {
    if (busy.current || shownGarments.length < 2) return;
    busy.current = true;
    const outTo = dir === "right" ? -SLIDE_TRAVEL : SLIDE_TRAVEL;
    Animated.timing(slideX, { toValue: outTo, duration: 180, easing: Easing.in(Easing.ease), useNativeDriver: true }).start(() => {
      pendingDirRef.current = dir;
      setIndex(i => (dir === "right" ? (i + 1) % shownGarments.length : (i - 1 + shownGarments.length) % shownGarments.length));
    });
  }

  // Swipe left/right on the item to navigate, same as tapping the arrows. Only claims the
  // gesture once the movement is clearly horizontal (and past a small threshold), so it
  // doesn't steal simple taps on the arrow buttons or accidental small finger jitter.
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture: PanResponderGestureState) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_evt, gesture: PanResponderGestureState) => {
        if (gesture.dx <= -SWIPE_THRESHOLD) navigate("right");
        else if (gesture.dx >= SWIPE_THRESHOLD) navigate("left");
      },
    })
  ).current;

  function confirmRemove() {
    const item = garments[index];
    if (!item) return;
    Alert.alert("Remove item?", `${item.brand ?? item.title} will be removed from your closet.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeItem(item.id) },
    ]);
  }

  async function removeItem(id: string) {
    try {
      const data = await apiJson<{ affectedMonths?: string[] }>(`/api/garments?id=${id}`, { method: "DELETE" });
      invalidateCache("/api/garments");
      invalidateCache(SCORING_PATH);
      invalidateCache("/api/outfits");
      // Fire-and-forget: regenerate any calendar months whose outfits included this item, and
      // clean up its wardrobe-leveling crossings — native reads live state (no local cache to
      // mirror the deletion into), so this DELETE is the direct equivalent of the website's
      // cache-mutation-then-eventual-resync approach.
      for (const monthKey of data.affectedMonths ?? []) {
        const [y, m] = monthKey.split("-").map(Number);
        apiJson("/api/outfits/generate", { method: "POST", body: JSON.stringify({ year: y, month: m, overwrite: false }) })
          // Invalidated again once the regen lands — a Calendar fetch in between would otherwise
          // cache the blanked-out month for its full 5-minute TTL.
          .then(() => invalidateCache("/api/outfits"))
          .catch(() => {});
      }
      apiJson(`/api/wardrobe/state/cross?garmentId=${id}`, { method: "DELETE" })
        .then(() => invalidateCache("/api/wardrobe/state"))
        .catch(() => {});
      const updated = garments.filter(g => g.id !== id);
      setGarments(updated);
      setIndex(prev => Math.min(prev, Math.max(updated.length - 1, 0)));
    } catch (e) {
      showStatus(e instanceof ApiError ? e.message : "Couldn't remove that item. Try again.", "bad");
    }
  }

  function openEdit() {
    const item = garments[index];
    if (!item) return;
    setEditItem({ id: item.id, title: item.title, brand: item.brand ?? "", color_primary: item.color_primary ?? "", category: item.category ?? "", aesthetic: item.aesthetic_tags?.[0] ?? "" });
  }

  async function saveEdit(updated: EditUpdate) {
    if (!editItem) return;
    try {
      await apiJson("/api/garments", { method: "PATCH", body: JSON.stringify({ id: editItem.id, ...updated }) });
      // Color/category edits change scores, outfit combos and calendar display too, not just
      // the garment list.
      invalidateCache("/api/garments");
      invalidateCache(SCORING_PATH);
      invalidateCache("/api/outfits");
      // The server re-validates this item's wardrobe crossings on category/color/aesthetic edits.
      invalidateCache("/api/wardrobe/state");
      const { aesthetic, ...rest } = updated;
      setGarments(prev => prev.map(g => (g.id !== editItem.id ? g : {
        ...g, ...rest,
        ...(aesthetic !== undefined ? { aesthetic_tags: aesthetic ? [aesthetic] : null } : {}),
      } as Garment)));
    } catch {
      // modal shows DONE! regardless of a transient failure here, matching the website; a
      // stale field is corrected on next full reload
    }
  }

  // Scores are a Pro feature — a free user's first paint doesn't wait on them (they're never
  // shown). Waits on entitlementsReady instead so the layout is right from the first frame.
  // Every return below is wrapped in ReadyGate (see components/ReadyGate.tsx): the dots stay up
  // until the page underneath — item image included — is fully drawn, then it all appears at once.
  if (!demo && (loading || !entitlementsReady || (hasAI && scoresLoading))) {
    return <ReadyGate ready={false} />;
  }

  // Only replace the whole screen with the failure state when there's genuinely nothing to
  // show. If cached garments are already on screen, a failed background reload shouldn't blow
  // them away — keep showing the real content and surface the failure inline instead (below).
  if (!demo && error && garments.length === 0) {
    return (
      <ReadyGate ready>
      <ScreenCenter>
        <Text style={[type.body, styles.retryFailedText]}>RETRY FAILED. WAIT SOME TIME AND TRY AGAIN.</Text>
        <TouchableOpacity onPress={load} style={{ marginTop: spacing.md }}>
          <Text style={[type.button, { color: colors.text }]}>RETRY</Text>
        </TouchableOpacity>
      </ScreenCenter>
      </ReadyGate>
    );
  }

  if (shownGarments.length === 0) {
    return (
      <ReadyGate ready>
      <ScreenCenter>
        <View ref={tutorialTarget("closet.main")} collapsable={false} style={{ alignItems: "center" }}>
        <Ionicons name="shirt-outline" size={64} color={colors.textFaint} />
        <Text style={[type.label, { marginTop: spacing.md, fontSize: 12 }]}>YOUR CLOSET IS EMPTY</Text>
        </View>
      </ScreenCenter>
      </ReadyGate>
    );
  }

  const item = shownGarments[index % shownGarments.length];
  // Falls back to the pairings Add Item already fetched and cached for a just-added item, so its
  // Pairs With is there on first view instead of popping in after this screen's own refresh.
  const pairingsForItem = demo ? item.style_pairings ?? [] : freshPairings[item.id]?.length
    ? freshPairings[item.id]
    : getCached<{ pairings?: string[] }>(`/api/garments/pairings?id=${item.id}`)?.pairings ?? freshPairings[item.id] ?? [];
  const focusItems = buildFocusItems(item, pairingsForItem, overdoneMap, hasAI || !!item.ai_unlocked);

  return (
    <ReadyGate ready images={[item.image]}>
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {!demo && error && (
        <Text style={styles.retryFailedBanner}>RETRY FAILED. WAIT SOME TIME AND TRY AGAIN.</Text>
      )}
      <View style={{ alignItems: "center", paddingBottom: spacing.sm }}>
        {/* On the nav chevron's exact center line (see ShowNavButton's NAV_ROW_*). */}
        <View style={{ marginTop: NAV_ROW_TOP, height: NAV_ROW_H, justifyContent: "center" }}>
          <Text style={type.title}>{item.brand ?? item.title}</Text>
        </View>
        {(hasAI || item.ai_unlocked) && (
          <Text style={{ fontSize: 30, fontWeight: "700", color: scoreColor(shownScores[item.id]), marginTop: 2 }}>
            {shownScores[item.id] != null ? shownScores[item.id] : "-"}
          </Text>
        )}
        {/* Free tier with a purchased Single Item Analysis: score THIS item (lib/analysisJobs.ts). */}
        {!hasAI && !item.ai_unlocked && (jobs?.credits.item ?? 0) > 0 && (
          <TouchableOpacity onPress={() => spendScore(item)} disabled={!!scoringId} hitSlop={8} style={{ marginTop: 6 }}>
            <Text style={[type.button, { color: colors.good }]}>USE SCORE?</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.imageRow} {...swipeResponder.panHandlers} ref={tutorialTarget("closet.main")} collapsable={false}>
        <TouchableOpacity onPress={() => navigate("left")} disabled={shownGarments.length < 2} style={styles.arrowBtn}>
          <Ionicons name="chevron-back" size={22} color={shownGarments.length < 2 ? colors.border : colors.text} />
        </TouchableOpacity>

        <View style={styles.imageCard}>
          <Animated.View style={{ transform: [{ translateX: slideX }], width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            {item.image ? (
              // Plain Image, not Animated.Image — the animation here (translateX on swipe) lives
              // entirely on the parent Animated.View above; this image never had an animated
              // prop of its own, so it doesn't need the Animated wrapper (which expo-image
              // doesn't provide out of the box the way core Image did).
              <Image source={{ uri: item.image }} style={styles.itemImage} contentFit="contain" cachePolicy="memory-disk" />
            ) : (
              <View style={styles.itemImagePlaceholder} />
            )}
          </Animated.View>
        </View>

        <TouchableOpacity onPress={() => navigate("right")} disabled={shownGarments.length < 2} style={styles.arrowBtn}>
          <Ionicons name="chevron-forward" size={22} color={shownGarments.length < 2 ? colors.border : colors.text} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.lg, justifyContent: "center", marginTop: spacing.xs }}>
        <TextButton label="EDIT" size={10} color={colors.textFaint} onPress={openEdit} />
        <TextButton label="REMOVE ITEM" size={10} color={colors.textFaint} onPress={confirmRemove} />
      </View>

      <View style={{ minHeight: 16, justifyContent: "center", marginTop: spacing.xs }}>
        <StatusMessage status={status} style={{ fontSize: 11 }} />
      </View>

      {focusItems.length > 0 && (
        <View style={{ flex: 1, marginTop: spacing.sm, marginBottom: insets.bottom + spacing.sm }}>
          <FocusScrollList items={focusItems} />
        </View>
      )}

      {editItem && <EditModal initial={editItem} onSave={saveEdit} onClose={() => setEditItem(null)} />}
      <AnalysisOverlay visible={!!scoringId} stages={ITEM_STAGES} />
    </SafeAreaView>
    </ReadyGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  retryFailedText: { color: "#ff6b6b" },
  retryFailedBanner: {
    color: "#ff6b6b", fontSize: 11, textAlign: "center", textTransform: "uppercase",
    letterSpacing: 0.5, paddingTop: spacing.sm,
  },
  imageRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  arrowBtn: { padding: spacing.md },
  imageCard: {
    width: IMAGE_CARD_SIZE, height: IMAGE_CARD_SIZE, overflow: "hidden",
    alignItems: "center", justifyContent: "center", backgroundColor: colors.bg,
  },
  itemImage: { width: "88%", height: "88%" },
  itemImagePlaceholder: { width: "60%", height: "60%", backgroundColor: colors.fill },
  modalOverlay: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", zIndex: 2000 },
  modalCard: { backgroundColor: colors.bg, padding: spacing.xl, paddingTop: spacing.xl + spacing.sm, width: 320, maxWidth: "90%" },
  modalClose: { position: "absolute", top: 12, right: 14 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
});
