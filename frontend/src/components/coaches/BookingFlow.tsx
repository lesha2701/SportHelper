// frontend/src/components/coaches/BookingFlow.tsx
import { useState } from "react";
import { useEffect } from "react";
import { getCoachOpenSlots } from "../../api/coaches";
import { createBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { CoachPublicProfile, OpenSlot } from "../../types/coach";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

function nextNDays(n: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function BookingFlow({
  token,
  coach,
  onBack,
  onBooked,
}: {
  token: string;
  coach: CoachPublicProfile;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
}) {
  const days = nextNDays(14);
  const [selectedDay, setSelectedDay] = useState(toDateKey(days[0]));
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);
  const [format, setFormat] = useState<"online" | "offline">(coach.offersOnline ? "online" : "offline");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  useEffect(() => {
    setSlots(null);
    setSelectedSlot(null);
    getCoachOpenSlots(token, coach.userId, selectedDay, selectedDay)
      .then(setSlots)
      .catch((err: unknown) => setSlotsError(err instanceof ApiError ? err.message : "Не удалось загрузить слоты"));
  }, [token, coach.userId, selectedDay]);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setBooking(true);
    setBookError(null);
    try {
      const created = await createBooking(token, {
        coach_user_id: coach.userId,
        starts_at: selectedSlot.startsAt,
        format,
      });
      onBooked(created);
    } catch (err) {
      setBookError(
        err instanceof ApiError && err.code === "slot_unavailable"
          ? "Этот слот уже заняли — выберите другое время."
          : err instanceof ApiError
            ? err.message
            : "Не удалось создать бронь",
      );
      setSelectedSlot(null);
      // The slot list may now be stale (e.g. someone else just took the
      // slot we tried to book) — refresh it so the grid reflects reality.
      getCoachOpenSlots(token, coach.userId, selectedDay, selectedDay)
        .then(setSlots)
        .catch(() => {
          /* keep the existing (stale) list rather than losing it on a transient refresh error */
        });
    } finally {
      setBooking(false);
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
        <h1 className={profileStyles.pageHeading}>Запись к {coach.fullName}</h1>

        <div className={styles.dateStrip}>
          {days.map((d) => {
            const key = toDateKey(d);
            return (
              <button
                key={key}
                type="button"
                className={key === selectedDay ? styles.dateChipActive : styles.dateChip}
                onClick={() => setSelectedDay(key)}
              >
                {d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
              </button>
            );
          })}
        </div>

        {slotsError && <p className={profileStyles.error}>{slotsError}</p>}
        {slots === null && !slotsError && <StateScreen kind="loading" title="Загрузка слотов…" />}
        {slots !== null && slots.length === 0 && <p className={profileStyles.subtitle}>На этот день нет свободных слотов.</p>}
        {slots !== null && slots.length > 0 && (
          <div className={styles.slotGrid}>
            {slots.map((slot) => (
              <button
                key={slot.startsAt}
                type="button"
                className={selectedSlot?.startsAt === slot.startsAt ? styles.slotButtonActive : styles.slotButton}
                onClick={() => setSelectedSlot(slot)}
              >
                {new Date(slot.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
        )}

        {bookError && <p className={profileStyles.error}>{bookError}</p>}

        {coach.offersOnline && coach.offersOffline && (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Формат</span>
            <div className={styles.dateStrip}>
              <button
                type="button"
                className={format === "online" ? styles.dateChipActive : styles.dateChip}
                onClick={() => setFormat("online")}
              >
                Онлайн
              </button>
              <button
                type="button"
                className={format === "offline" ? styles.dateChipActive : styles.dateChip}
                onClick={() => setFormat("offline")}
              >
                Очно
              </button>
            </div>
          </div>
        )}

        {selectedSlot && (
          <div className={styles.confirmSummary}>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Тренер</span>
              <span className={profileStyles.rowValue}>{coach.fullName}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Когда</span>
              <span className={profileStyles.rowValue}>
                {new Date(selectedSlot.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Формат</span>
              <span className={profileStyles.rowValue}>{format === "online" ? "Онлайн" : `Очно${coach.location ? `, ${coach.location}` : ""}`}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Стоимость</span>
              <span className={profileStyles.rowValue}>
                {coach.pricePerSession !== null ? `${coach.pricePerSession} ${coach.currency}` : "Не указана"}
              </span>
            </div>
            <p className={profileStyles.subtitle}>После подтверждения бронь появится в вашем календаре.</p>

            <div className={profileStyles.formActions}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleConfirm()} disabled={booking}>
                {booking ? "Бронируем…" : "Подтвердить запись"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
