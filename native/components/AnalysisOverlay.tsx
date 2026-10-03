import { Modal, View, StyleSheet } from "react-native";
import { LoadingDots } from "./LoadingDots";
import { LoadingMessages } from "./LoadingMessages";
import { colors } from "../theme/theme";

// Full-screen loading for a purchased analysis ("Use score?" / "Perform analysis?"): three dots
// with the analysis stages cycling underneath, like Preview's. A Modal sits above everything —
// the nav bar and its show-nav button included — so there's nowhere to navigate to mid-way, and
// Android's back button is ignored. Leaving the app is still possible; the job keeps running on
// the server and this screen comes back when the user returns (see lib/analysisJobs.ts).
export function AnalysisOverlay({ visible, stages }: { visible: boolean; stages: string[] }) {
  return (
    <Modal visible={visible} animationType="none" transparent={false} onRequestClose={() => {}} statusBarTranslucent>
      <View style={styles.wrap}>
        <LoadingDots size={8} />
        <LoadingMessages messages={stages} interval={2200} style={{ marginTop: 18 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
});
