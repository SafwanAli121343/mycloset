import { View, Image, StyleSheet, Dimensions } from "react-native";
import { colors } from "../theme/theme";
import { bucketOf, sortTops, type SlotGarment } from "../lib/garmentSlots";

const { width: SCREEN_W } = Dimensions.get("window");
const GAP = 6;
const BOX = Math.floor((SCREEN_W - 48 - GAP * 2) / 3);

function Box({ g, wide }: { g?: SlotGarment; wide?: boolean }) {
  return (
    <View style={[styles.box, { width: wide ? BOX : BOX, height: BOX }]}>
      {g?.image ? <Image source={{ uri: g.image }} style={styles.img} resizeMode="contain" /> : null}
    </View>
  );
}

// Read-only version of the website's outfit slot grid (app/calendar/page.tsx): hat centered on
// its own row, outer/top/mid sharing one row (mirroring the desktop's 5-col row 2), then pants
// and shoes each centered on their own row below, with accessories in a wrapped row at the
// bottom. Every slot type always renders a box — even empty — matching the desktop reference
// (S(...) there always draws a box with an EmptyTip when nothing fills it), rather than only
// showing up once something occupies it. No drag/drop here — Builder is where an outfit
// actually gets edited.
export function OutfitSlotGrid({ garments }: { garments: SlotGarment[] }) {
  const heads = garments.filter(g => bucketOf(g) === "head");
  const outers = garments.filter(g => bucketOf(g) === "outer");
  // Sorted so a true base layer (tee, henley) always lands in tops[0] — the base/center slot —
  // rather than whichever top happened to be added first, matching the website's outfit grid.
  const tops = sortTops(garments.filter(g => bucketOf(g) === "top"));
  const mids = garments.filter(g => bucketOf(g) === "mid");
  const bottoms = garments.filter(g => bucketOf(g) === "bottom");
  const shoes = garments.filter(g => bucketOf(g) === "shoes");
  const accs = garments.filter(g => bucketOf(g) === "accessory");

  return (
    <View style={{ alignItems: "center", gap: GAP }}>
      <Box g={heads[0]} />
      <View style={{ flexDirection: "row", gap: GAP }}>
        <Box g={outers[0]} />
        <Box g={tops[0]} />
        <Box g={mids[0]} />
      </View>
      {tops.slice(1).length + outers.slice(1).length > 0 && (
        <View style={{ flexDirection: "row", gap: GAP, flexWrap: "wrap", justifyContent: "center" }}>
          {[...outers.slice(1), ...tops.slice(1)].map(g => <Box key={g.id} g={g} />)}
        </View>
      )}
      <Box g={bottoms[0]} />
      <Box g={shoes[0]} />
      <View style={{ flexDirection: "row", gap: GAP, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
        {accs.length > 0 ? accs.map(g => <Box key={g.id} g={g} />) : <Box />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  img: { width: "80%", height: "80%" },
});
