import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useProfile } from "@/profile/ProfileProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { ErrorView, LoadingView } from "@/ui/StateViews";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { state, reload } = useProfile();

  if (state.status === "idle" || state.status === "loading") return <LoadingView />;
  if (state.status === "error") return <ErrorView message={state.message} onRetry={reload} />;

  // First run: nobody gets into the app before filling in the profile of the role chosen at sign-up.
  const { player, coach } = state.data;
  if (!player && !coach) {
    const mode = user?.preferredRole ?? "player";
    return <Redirect href={{ pathname: "/profile-edit", params: { mode, first: "1" } }} />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Главная", tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Профиль", tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
