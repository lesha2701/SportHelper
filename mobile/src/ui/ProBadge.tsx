import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export function ProBadge() {
  const { colors } = useTheme();
  return <Text accessibilityLabel="Тренер PRO" variant="caption" style={{ color: colors.primary, fontWeight: "700" }}>PRO</Text>;
}
