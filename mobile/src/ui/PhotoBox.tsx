import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { AuthImage } from "./AuthImage";
import { Text } from "./Text";

/** The picture of an offer (or an exercise): the photo when there is one, otherwise a calm placeholder of the same
 * size, so every card keeps its shape and it is clear where a photo would go. */
export function PhotoBox({ fileId, height = 180, hint }: { fileId: string | null; height?: number; hint?: string }) {
  const { colors } = useTheme();
  if (fileId) return <AuthImage fileId={fileId} height={height} />;
  return (
    <View style={[styles.box, { height, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} accessibilityLabel="Фото пока нет">
      <Ionicons name="image-outline" size={34} color={colors.textTertiary} />
      {hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%", borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 6 },
});
