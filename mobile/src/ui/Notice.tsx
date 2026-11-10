import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

/** An inline message box: an error, a success note or plain information. */
export function Notice({ kind = "info", children }: { kind?: "info" | "danger" | "success"; children: React.ReactNode }) {
  const { colors } = useTheme();
  const tone = { info: [colors.surfaceAlt, colors.text], danger: [colors.dangerBg, colors.danger], success: [colors.successBg, colors.success] }[kind];
  return (
    <View accessibilityRole={kind === "danger" ? "alert" : undefined} style={[styles.box, { backgroundColor: tone[0] }]}>
      <Text variant="label" style={{ color: tone[1] }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: 12 },
});
