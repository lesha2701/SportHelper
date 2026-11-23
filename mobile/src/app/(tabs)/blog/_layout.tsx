import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { TabHeader } from "@/ui/TabHeader";

export const unstable_settings = { initialRouteName: "index" };

export default function BlogLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{
      contentStyle: { backgroundColor: colors.bg },
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { fontFamily: fonts.bodySemi },
    }}>
      <Stack.Screen name="index" options={{ header: () => <TabHeader title="Статьи" /> }} />
    </Stack>
  );
}
