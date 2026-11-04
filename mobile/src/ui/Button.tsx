import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Text } from "./Text";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({ title, onPress, variant = "primary", loading, disabled, style, testID }: Props) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.primaryText, border: "transparent" },
    secondary: { bg: colors.surface, pressed: colors.surfaceAlt, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: "transparent", pressed: colors.surfaceAlt, fg: colors.primary, border: "transparent" },
    danger: { bg: colors.danger, pressed: colors.danger, fg: "#ffffff", border: "transparent" },
  }[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border, opacity: inactive ? 0.55 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text variant="label" style={{ color: palette.fg, fontFamily: fonts.bodyBold, fontSize: 15 }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
