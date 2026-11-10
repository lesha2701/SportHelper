import { router } from "expo-router";
import { useProfile } from "@/profile/ProfileProvider";
import { WelcomeGuide } from "@/welcome/WelcomeGuide";

/** The welcome guide opened again from the settings: same tour, only a close button. */
export default function GuideScreen() {
  const { state } = useProfile();
  const roles = state.status === "ready" ? { player: !!state.data.player, coach: !!state.data.coach } : undefined;
  return <WelcomeGuide manual roles={roles} onFinish={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />;
}
