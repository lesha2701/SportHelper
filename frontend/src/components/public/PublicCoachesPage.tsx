import { useCallback } from "react";
import { loginUrl, navigate, useLocation } from "../../router";
import { CoachMarketplaceScreen } from "../coaches/CoachMarketplaceScreen";
import { PublicShell } from "./PublicShell";
import styles from "./public.module.css";

/** The coach catalogue for guests. Browsing, profiles, reviews and free slots
 * are open; the moment someone tries to book, they are sent to sign in and
 * brought back to that very listing afterwards. */
export function PublicCoachesPage() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const listingId = params.get("listing");
  const coachId = params.get("coach");

  const requireLogin = useCallback((chosenListingId: string) => {
    navigate(loginUrl(`/?book=${encodeURIComponent(chosenListingId)}`));
  }, []);

  return (
    <PublicShell>
      <div className={styles.page}>
        <CoachMarketplaceScreen
          key={`${listingId ?? ""}|${coachId ?? ""}`}
          token=""
          guest
          onRequireLogin={requireLogin}
          initialCoachUserId={coachId}
          initialListingId={listingId}
        />
      </div>
    </PublicShell>
  );
}
