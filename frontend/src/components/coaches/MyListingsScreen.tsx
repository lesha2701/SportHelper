// frontend/src/components/coaches/MyListingsScreen.tsx
import { useEffect, useState } from "react";
import { deleteListing, listMyListings } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { ListingEditScreen } from "./ListingEditScreen";
import type { CoachListing } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; listings: CoachListing[] };

type View = { screen: "list" } | { screen: "edit"; listing: CoachListing | null };

export function MyListingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setState({ status: "loading" });
    listMyListings(token)
      .then((listings) => setState({ status: "ready", listings }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить объявления" }),
      );
  };

  useEffect(load, [token]);

  if (view.screen === "edit") {
    return (
      <ListingEditScreen
        token={token}
        listing={view.listing}
        onBack={() => {
          setView({ screen: "list" });
          load();
        }}
      />
    );
  }

  const handleDelete = async (listingId: string) => {
    setDeleteError(null);
    setDeletingId(listingId);
    try {
      await deleteListing(token, listingId);
      load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.code === "listing_has_active_booking"
          ? "Нельзя удалить объявление с активной бронью — сначала отклоните заявку или дождитесь завершения тренировки."
          : err instanceof ApiError
            ? err.message
            : "Не удалось удалить объявление",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Мои объявления</h1>

        {deleteError && <p className={profileStyles.error}>{deleteError}</p>}

        {state.status === "loading" && <StateScreen kind="loading" title="Загрузка объявлений…" />}
        {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить объявления" description={state.message} />}
        {state.status === "ready" && state.listings.length === 0 && (
          <p className={profileStyles.subtitle}>У вас пока нет объявлений.</p>
        )}
        {state.status === "ready" &&
          state.listings.map((listing) => (
            <div className={styles.bookingRow} key={listing.id}>
              <div>
                <p className={profileStyles.rowValue}>{listing.title}</p>
                <p className={profileStyles.subtitle}>
                  {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Цена не указана"}
                  {" · "}
                  {listing.isListed ? "Опубликовано" : "Черновик"}
                </p>
              </div>
              <div className={styles.incomingActions}>
                <button
                  type="button"
                  className={profileStyles.buttonSecondary}
                  onClick={() => setView({ screen: "edit", listing })}
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  className={styles.removeRowButton}
                  disabled={deletingId === listing.id}
                  onClick={() => void handleDelete(listing.id)}
                  aria-label="Удалить"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          ))}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => setView({ screen: "edit", listing: null })}>
            <Icon name="plus" size={16} />
            Новое объявление
          </button>
        </div>
      </div>
    </div>
  );
}
