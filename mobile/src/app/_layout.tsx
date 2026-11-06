import { Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { Oswald_600SemiBold } from "@expo-google-fonts/oswald";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { UnreadProvider } from "@/notifications/UnreadProvider";
import { ProfileProvider } from "@/profile/ProfileProvider";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { LoadingView } from "@/ui/StateViews";
import { ToastProvider } from "@/ui/Toast";

function Routes() {
  const { status } = useAuth();
  const { colors, dark } = useTheme();
  const signedIn = status === "signedIn";
  // Until the saved sign-in is checked, no route can be matched: mounting the navigator now would drop a deep link
  // (a notification, an invitation) onto the start page. Wait, then open exactly what was asked for.
  if (status === "loading") return <LoadingView />;
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.bodySemi },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="legal/[key]" />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="profile-edit" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="guide" />
          <Stack.Screen name="account" />
          <Stack.Screen name="delete-account" />
          <Stack.Screen name="join" />
          <Stack.Screen name="team/new" />
          <Stack.Screen name="team/[id]" />
          <Stack.Screen name="team/[id]/[section]" />
          <Stack.Screen name="training/new" />
          <Stack.Screen name="training/[id]" />
          <Stack.Screen name="workout/[id]" />
          <Stack.Screen name="task/new" />
          <Stack.Screen name="task/[id]" />
          <Stack.Screen name="match/new" />
          <Stack.Screen name="match/[id]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="stats" />
          <Stack.Screen name="metric-new" />
          <Stack.Screen name="search" />
          <Stack.Screen name="my-tasks" />
          <Stack.Screen name="listing/[id]" />
          <Stack.Screen name="coach/[id]" />
          <Stack.Screen name="player/[id]" />
          <Stack.Screen name="bookings" />
          <Stack.Screen name="finance" />
          <Stack.Screen name="library" />
          <Stack.Screen name="listing/new" />
          <Stack.Screen name="library/template/new" />
          <Stack.Screen name="library/template/[id]" />
          <Stack.Screen name="my-listings" />
          <Stack.Screen name="library/exercise/new" />
          <Stack.Screen name="library/exercise/[id]" />
          <Stack.Screen name="library/plan/new" />
          <Stack.Screen name="library/plan/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="check-email" />
          <Stack.Screen name="verify" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Oswald_600SemiBold,
  });
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <ProfileProvider>
              <UnreadProvider>{fontsLoaded || fontError ? <Routes /> : <LoadingView />}</UnreadProvider>
            </ProfileProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
