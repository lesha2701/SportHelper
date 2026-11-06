import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useState } from "react";
import { completeOnboarding } from "@/api/users";
import { useAuth } from "@/auth/AuthProvider";
import { useProfile } from "@/profile/ProfileProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { TabHeader } from "@/ui/TabHeader";
import { useToast } from "@/ui/Toast";
import { WelcomeGuide } from "@/welcome/WelcomeGuide";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: unknown; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

/** The main sections, in the website's order: home, teams, calendar, coaches, profile. Tasks live inside teams. */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { user, refreshUser } = useAuth();
  const { state, reload } = useProfile();
  const toast = useToast();
  // Closed at once and for this session even if saving it on the account fails.
  const [guideDone, setGuideDone] = useState(false);

  if (state.status === "idle" || state.status === "loading") return <LoadingView />;
  if (state.status === "error") return <ErrorView message={state.message} onRetry={reload} />;

  // First run: nobody gets into the app before filling in the profile of the role chosen at sign-up.
  const { player, coach } = state.data;
  if (!player && !coach) {
    const mode = user?.preferredRole ?? "player";
    return <Redirect href={{ pathname: "/profile-edit", params: { mode, first: "1" } }} />;
  }

  // Then, as on the website, the welcome guide until it is finished or skipped once.
  if (user && user.completedOnboardingVersion < user.currentOnboardingVersion && !guideDone) {
    return (
      <WelcomeGuide
        roles={{ player: !!player, coach: !!coach }}
        onFinish={() => {
          setGuideDone(true);
          completeOnboarding()
            .then(() => refreshUser())
            .catch(() => toast.error("Не удалось сохранить, что знакомство пройдено: оно может показаться снова при следующем входе."));
        }}
      />
    );
  }

  return (
    <Tabs
      screenOptions={{
        header: ({ options }) => <TabHeader title={options.headerTitle && typeof options.headerTitle === "string" ? options.headerTitle : (options.title ?? "")} />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 10 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Главная", headerTitle: "SportArena", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="teams" options={{ title: "Команды", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen name="calendar" options={{ title: "Календарь", tabBarIcon: icon("calendar-outline") }} />
      <Tabs.Screen name="coaches" options={{ title: "Тренеры", tabBarIcon: icon("barbell-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Профиль", tabBarIcon: icon("person-outline") }} />
    </Tabs>
  );
}
