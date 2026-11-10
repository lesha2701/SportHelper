import { Text as RNText, type TextProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";

type Variant = "title" | "heading" | "body" | "label" | "caption";

const styles = {
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, textTransform: "uppercase" as const },
  heading: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, textTransform: "uppercase" as const },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
};

export function Text({ variant = "body", muted, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean }) {
  const { colors } = useTheme();
  return <RNText {...rest} style={[styles[variant], { color: muted ? colors.textSecondary : colors.text }, style]} />;
}
