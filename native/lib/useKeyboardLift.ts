import { useEffect, useRef } from "react";
import { Animated, Keyboard, Platform, TextInput, type KeyboardEvent } from "react-native";

// App-wide (App.tsx's ScreenArea): when the keyboard covers the field being typed in, slide the
// whole screen up just far enough to keep that field (plus anything registered under it, like the
// aesthetic suggestions) visible, and back down when the keyboard closes. Fields already above the
// keyboard don't move anything.
//
// The focused field is looked up a moment AFTER the keyboard event, and re-checked while the
// keyboard stays open: iOS can report the keyboard opening before the app hears which field took
// focus, and switching fields with the keyboard already up sends no new "opening" event at all —
// the first version of this read the focused field on that event alone and so never moved.
// Clear space kept between the field and the keyboard — roomy enough that a line under the
// field (e.g. Preview's CANCEL) isn't jammed against the keyboard either.
const GAP = 56;
const extraBelow = new WeakMap<object, number>();
let optOuts = 0;

// Room to keep visible beneath a field while it's focused (e.g. its dropdown).
export function setKeyboardRoomBelow(input: TextInput | null, px: number) {
  if (input) extraBelow.set(input, px);
}

// For a screen that keeps its own fields in view (Settings scrolls them): while it's showing,
// the app-wide lift stays at rest. Returns the undo.
export function optOutOfKeyboardLift(): () => void {
  optOuts++;
  return () => { optOuts--; };
}

type Measurable = TextInput & { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };

export function useKeyboardLift(enabled: boolean): Animated.Value {
  const lift = useRef(new Animated.Value(0)).current;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let target = 0;
    let animating = false;
    let keyboardTop: number | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const animate = (to: number, duration = 220) => {
      if (Math.abs(to - target) < 2) return;
      target = to;
      animating = true;
      Animated.timing(lift, { toValue: to, duration, useNativeDriver: true }).start(() => { animating = false; });
    };

    const update = () => {
      if (keyboardTop === null || animating) return;
      if (!enabledRef.current || optOuts > 0) { animate(0); return; }
      const input = TextInput.State.currentlyFocusedInput() as unknown as Measurable | null;
      if (!input?.measureInWindow) return;
      const top = keyboardTop;
      input.measureInWindow((_x, y, _w, h) => {
        if (keyboardTop === null || animating) return;
        // y includes the current lift, so work out where the field sits at rest first.
        const restingBottom = y - target + h + (extraBelow.get(input) ?? 0) + GAP;
        animate(Math.min(0, top - restingBottom));
      });
    };

    const onShow = (e: KeyboardEvent) => {
      keyboardTop = e.endCoordinates.screenY;
      setTimeout(update, 40);
      if (!poll) poll = setInterval(update, 200);
    };
    const onHide = (e: KeyboardEvent) => {
      keyboardTop = null;
      if (poll) { clearInterval(poll); poll = null; }
      animating = false;
      animate(0, e?.duration || 200);
    };

    const ios = Platform.OS === "ios";
    const subs = [
      Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", onShow),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", onHide),
      // Switching to the number pad (Price) changes the keyboard's height without a new "show".
      Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidShow", (e: KeyboardEvent) => {
        if (keyboardTop !== null) keyboardTop = e.endCoordinates.screenY;
      }),
    ];
    return () => { subs.forEach(s => s.remove()); if (poll) clearInterval(poll); };
  }, [lift]);

  return lift;
}
