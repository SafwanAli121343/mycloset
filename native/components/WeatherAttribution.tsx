import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Linking } from "react-native";
import { Image } from "expo-image";
import { apiJsonCached } from "../lib/api";
import { colors } from "../theme/theme";

type Source = {
  weatherKit: boolean;
  appleLogoLight: string | null;
  appleLogoDark: string | null;
  appleLegalUrl: string | null;
  openMeteoUrl: string;
};

// Credit line under the calendar for where the temperatures come from. With WeatherKit live
// (see GET /api/weather/source) Apple requires the Apple Weather mark plus a link to its legal
// data-sources page; Open-Meteo still fills days past Apple's forecast, so it's credited too.
export function WeatherAttribution() {
  const [src, setSrc] = useState<Source | null>(null);
  useEffect(() => {
    apiJsonCached<Source>("/api/weather/source", 3_600_000).then(setSrc).catch(() => {});
  }, []);
  // Fixed-height row, rendered even before the source loads, so the calendar's measured layout
  // never shifts when it arrives.
  const row = { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, marginTop: 10, height: 14 };
  if (!src) return <View style={row} />;

  const link = (url: string | null) => () => { if (url) Linking.openURL(url).catch(() => {}); };
  const textStyle = { fontSize: 9, color: colors.textFaint };
  return (
    <View style={row}>
      {src.weatherKit && src.appleLogoLight && (
        <>
          <TouchableOpacity onPress={link(src.appleLegalUrl)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {/* Apple's own logo image (231×42 at 3x). */}
            <Image source={{ uri: src.appleLogoLight }} style={{ width: 55, height: 10 }} contentFit="contain" accessibilityLabel="Apple Weather" />
            <Text style={[textStyle, { textDecorationLine: "underline" }]}>Data sources</Text>
          </TouchableOpacity>
          <Text style={textStyle}>·</Text>
        </>
      )}
      <TouchableOpacity onPress={link(src.openMeteoUrl)} hitSlop={8}>
        <Text style={textStyle}>Open-Meteo</Text>
      </TouchableOpacity>
    </View>
  );
}
