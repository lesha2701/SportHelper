import { Switch, type SwitchProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

/** The app's on/off switch, in the brand's red instead of the system's green. */
export function Toggle(props: SwitchProps) {
  const { colors } = useTheme();
  return <Switch trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor="#ffffff" {...props} />;
}
