import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { GuestHome } from "@/guest/GuestHome";
import { LoadingView } from "@/ui/StateViews";

export default function Index() {
  const { status, user } = useAuth();
  if (status === "loading") return <LoadingView />;
  const candidate = user?.preferredRole === "coach" && !!user.coachApplicationStatus && user.coachApplicationStatus !== "approved" && !user.isAdmin;
  return status === "signedIn" ? <Redirect href={candidate ? "/coach-application" : "/home"} /> : <GuestHome />;
}
