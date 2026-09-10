// frontend/src/components/coaches/IncomingBookingsScreen.tsx
import { useEffect, useState } from "react";
import { confirmBooking, declineBooking, listCoachPendingBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { PendingBooking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bookings: PendingBooking[] };

export function IncomingBookingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    listCoachPendingBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить заявки" }),
      );
  };

  useEffect(load, [token]);

  const respond = async (bookingId: string, action: "confirm" | "decline") => {
    setBusyId(bookingId);
    setActionError(null);
    try {
      if (action === "confirm") {
        await confirmBooking(token, bookingId);
      } else {
        await declineBooking(token, bookingId);
      }
      if (state.status === "ready") {
        setState({ status: "ready", bookings: state.bookings.filter((b) => b.id !== bookingId) });
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось обработать заявку");
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка заявок…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить заявки" description={state.message} />;

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Входящие заявки</h1>

        {actionError && <p className={profileStyles.error}>{actionError}</p>}

        {state.bookings.length === 0 && <p className={profileStyles.subtitle}>Нет заявок, ожидающих ответа.</p>}

        {state.bookings.map((b) => (
          <div className={styles.incomingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
              <p className={profileStyles.subtitle}>
                {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
              </p>
            </div>
            <div className={styles.incomingActions}>
              <button
                type="button"
                className={profileStyles.buttonPrimary}
                disabled={busyId === b.id}
                onClick={() => void respond(b.id, "confirm")}
              >
                Подтвердить
              </button>
              <button
                type="button"
                className={profileStyles.buttonSecondary}
                disabled={busyId === b.id}
                onClick={() => void respond(b.id, "decline")}
              >
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
