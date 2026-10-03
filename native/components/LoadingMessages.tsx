import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { colors, type } from "../theme/theme";

const DEFAULT_MESSAGES = [
  "Generating this month...",
  "Creating new outfits...",
  "Optimizing variety...",
  "Matching your pieces...",
];

// Cycles through a list of short status phrases, cross-fading between them. For loading states
// that can run a few seconds (e.g. generating a full month of outfits) where a plain spinner
// with no context reads as "stuck" — not meant for anything under ~1s, where LoadingDots alone
// is the right call.
export function LoadingMessages({
  messages = DEFAULT_MESSAGES,
  interval = 1800,
  color = colors.textMuted,
  style,
}: { messages?: string[]; interval?: number; color?: string; style?: object }) {
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
        .start(() => {
          setIndex(i => (i + 1) % messages.length);
          Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
        });
    }, interval);
    return () => clearInterval(id);
  }, [messages, interval, opacity]);

  return (
    <Animated.Text style={[type.body, { color, opacity, textAlign: "center" }, style]}>
      {messages[index]}
    </Animated.Text>
  );
}
