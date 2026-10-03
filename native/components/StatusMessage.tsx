import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleProp, TextStyle } from "react-native";
import { colors, type as t } from "../theme/theme";

export type Status = { text: string; kind: "good" | "bad" } | null;

// Replaces native Alert.alert() for pure notifications (success/failure confirmations that just
// need to be seen, not decided on) — a real iOS/Android system alert is a jarring, modal
// interruption for something as routine as "item added." Genuine yes/no confirmations (delete
// account, sign out, remove item) still use Alert.alert on purpose: those need a real blocking
// choice, which a self-dismissing message can't provide.
//
// A generation counter (not just clearing/resetting a timeout) guards against a slow-arriving
// message extending or cutting short a newer one that already showed — e.g. two rapid taps each
// scheduling their own 3s dismissal shouldn't let the first tap's timer clear a message the
// second tap just set.
export function useStatusMessage(durationMs = 3000) {
  const [status, setStatus] = useState<Status>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);

  const showStatus = useCallback((text: string, kind: "good" | "bad" = "good") => {
    const myGen = ++genRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus({ text, kind });
    timerRef.current = setTimeout(() => {
      if (myGen === genRef.current) setStatus(null);
    }, durationMs);
  }, [durationMs]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { status, showStatus };
}

// Fades in over the same 200ms used elsewhere in this app for a quick UI reveal (see
// PreviewScreen's chromeOpacity fades) — pops out at the end of its 3s window rather than fading
// out, which is a deliberate simplicity trade-off, not an oversight: fading a view out cleanly
// requires keeping it mounted (with declining opacity) past the moment its content is already
// gone, which is real extra state for a message that's already been read in full by then.
export function StatusMessage({ status, style }: { status: Status; style?: StyleProp<TextStyle> }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status) {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [status, opacity]);

  if (!status) return null;
  return (
    // Plain type.body, no bold override — matches every other inline status/error/success text
    // already in the app (SettingsScreen's PASSWORD UPDATED/redeem message, AddItemScreen's own
    // urlError/fieldError, etc.), all of which just recolor the same normal body text rather than
    // bolding it. An earlier version added fontWeight:"700" here, which made this look like a
    // different, heavier font from everything else using the same pattern — not intentional.
    <Animated.Text
      style={[
        t.body,
        { textAlign: "center", color: status.kind === "good" ? colors.good : colors.bad, opacity },
        style,
      ]}
    >
      {status.text}
    </Animated.Text>
  );
}
