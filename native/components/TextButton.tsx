import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { LoadingDots } from "./LoadingDots";
import { colors, fontFamily } from "../theme/theme";

// The website has moved away from boxed/filled buttons — actions read as plain uppercase
// letter-spaced text (see SCORE/CLEAR/EDIT/REMOVE ITEM/REGEN throughout the site), not
// buttons with a background fill. This is the native equivalent, used everywhere a button
// appeared as a black or grey box in the first pass of these screens.
export function TextButton({ label, onPress, color = colors.text, size = 11, disabled, loading, style }: {
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
  loading?: boolean;
  style?: object;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} style={style}>
      {loading
        ? <LoadingDots color={color} size={size * 0.4} />
        : <Text style={[styles.text, { color: disabled ? colors.textFaint : color, fontSize: size }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
});
