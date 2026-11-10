import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { LoadingView } from "@/ui/StateViews";

export default function Index() {
  const { status } = useAuth();
  if (status === "loading") return <LoadingView />;
  return <Redirect href={status === "signedIn" ? "/home" : "/login"} />;
}
