import { Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { Oswald_600SemiBold } from "@expo-google-fonts/oswald";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { ProfileProvider } from "@/profile/ProfileProvider";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { fonts } from "@/theme/tokens";
import { LoadingView } from "@/ui/StateViews";
import { ToastProvider } from "@/ui/Toast";

function Routes() {
  const { status } = useAuth();
  const { colors, dark } = useTheme();
  const signedIn = status === "signedIn";
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
            <ProfileProvider>{fontsLoaded || fontError ? <Routes /> : <LoadingView />}</ProfileProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
