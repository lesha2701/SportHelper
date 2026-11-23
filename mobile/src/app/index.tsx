import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { GuestHome } from "@/guest/GuestHome";
import { LoadingView } from "@/ui/StateViews";

export default function Index() {
  const { status } = useAuth();
  if (status === "loading") return <LoadingView />;
  return status === "signedIn" ? <Redirect href="/home" /> : <GuestHome />;
}
