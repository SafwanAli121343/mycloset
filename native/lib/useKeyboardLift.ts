import { useEffect, useRef } from "react";
import { Animated, Keyboard, Platform, TextInput, type KeyboardEvent } from "react-native";

// For screens laid out to fit without scrolling (Add Item): when the keyboard opens over the
// field being typed in, slide the whole screen up just far enough to keep that field (plus
// anything registered under it, like the aesthetic suggestions) visible, and back down when the
// keyboard closes. Fields already above the keyboard don't move anything.
const GAP = 16;
const extraBelow = new WeakMap<object, number>();

// Room to keep visible beneath a field while it's focused (e.g. its dropdown).
export function setKeyboardRoomBelow(input: TextInput | null, px: number) {
  if (input) extraBelow.set(input, px);
}

export function useKeyboardLift(): Animated.Value {
  const lift = useRef(new Animated.Value(0)).current;
  const current = useRef(0);

  useEffect(() => {
    const animate = (to: number, duration = 220) => {
      current.current = to;
      Animated.timing(lift, { toValue: to, duration, useNativeDriver: true }).start();
    };
    const onShow = (e: KeyboardEvent) => {
      const input = TextInput.State.currentlyFocusedInput() as unknown as
        | (TextInput & { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void })
        | null;
      if (!input?.measureInWindow) return;
      const keyboardTop = e.endCoordinates.screenY;
      input.measureInWindow((_x, y, _w, h) => {
        // y already includes the current lift, so work out where the field sits un-lifted.
        const restingBottom = y - current.current + h + (extraBelow.get(input) ?? 0) + GAP;
        animate(Math.min(0, keyboardTop - restingBottom), e.duration || 220);
      });
    };
    const onHide = (e: KeyboardEvent) => animate(0, e.duration || 200);
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", onShow);
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", onHide);
    return () => { show.remove(); hide.remove(); };
  }, [lift]);

  return lift;
}
