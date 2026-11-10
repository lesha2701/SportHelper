import { Text as RNText, type TextProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";

/** Inline tappable text (use inside <Text>) or a standalone link. */
export function LinkText({ style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return <RNText accessibilityRole="link" {...rest} style={[{ color: colors.primary, fontFamily: fonts.bodySemi }, style]} />;
}
