import { useState, type ReactNode } from "react";
import { completeOnboarding } from "../../api/users";
import { isOnboardingDue, type User } from "../../types/user";
import { toast } from "../../toast";
import { WelcomeGuide } from "./WelcomeGuide";

/** Shows the welcome guide INSTEAD of the app while it's due, so there is no
 * flash of the main interface before it. Finishing or skipping lets the user
 * straight in; saving that on the account happens in the background and a
 * failure never blocks them. */
export function OnboardingGate({
  token,
  user,
  onUserUpdated,
  children,
}: {
  token: string;
  user: User;
  onUserUpdated: (user: User) => void;
  children: ReactNode;
}) {
  // Local so the guide closes at once and stays closed this session even if saving fails.
  const [dismissed, setDismissed] = useState(false);

  if (!isOnboardingDue(user) || dismissed) {
    return <>{children}</>;
  }

  const finish = () => {
    setDismissed(true);
    completeOnboarding(token)
      .then(onUserUpdated)
      .catch(() => {
        toast.error("Не удалось сохранить, что знакомство пройдено: оно может показаться снова при следующем входе.");
      });
  };

  return <WelcomeGuide onFinish={finish} />;
}
