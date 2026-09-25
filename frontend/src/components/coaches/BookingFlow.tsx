// frontend/src/components/coaches/BookingFlow.tsx
import { useState } from "react";
import { useEffect, useRef } from "react";
import { getListingOpenSlots } from "../../api/coachListings";
import { createBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { CoachListingProfile, OpenSlot } from "../../types/coachListing";
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
  listing,
  onBack,
  onBooked,
}: {
  token: string;
  listing: CoachListingProfile;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
}) {
  const days = nextNDays(14);
  const [selectedDay, setSelectedDay] = useState(toDateKey(days[0] ?? new Date()));
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);
  const [format, setFormat] = useState<"online" | "offline">(listing.offersOnline ? "online" : "offline");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const daySessionIdRef = useRef(0);

  useEffect(() => {
    daySessionIdRef.current += 1;
    setSlots(null);
    setSelectedSlot(null);
    setBookError(null);
    setSlotsError(null);
    getListingOpenSlots(token, listing.id, selectedDay, selectedDay)
      .then(setSlots)
      .catch((err: unknown) => setSlotsError(err instanceof ApiError ? err.message : "Не удалось загрузить слоты"));
  }, [token, listing.id, selectedDay]);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    const dayAtRequestTime = selectedDay;
    const sessionIdAtRequestTime = daySessionIdRef.current;
    setBooking(true);
    setBookError(null);
    try {
      const created = await createBooking(token, {
        listing_id: listing.id,
        starts_at: selectedSlot.startsAt,
        format,
        athlete_notes: notes.trim() || null,
      });
      onBooked(created);
    } catch (err) {
      if (daySessionIdRef.current === sessionIdAtRequestTime) {
        setBookError(
          err instanceof ApiError && err.code === "slot_unavailable"
            ? "Этот слот уже заняли — выберите другое время."
            : err instanceof ApiError && err.code === "self_booking"
              ? "Нельзя забронировать собственное объявление."
              : err instanceof ApiError
                ? err.message
                : "Не удалось создать бронь",
        );
        setSelectedSlot(null);
      }
      getListingOpenSlots(token, listing.id, dayAtRequestTime, dayAtRequestTime)
        .then((refreshed) => {
          if (daySessionIdRef.current === sessionIdAtRequestTime) {
            setSlots(refreshed);
          }
        })
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
        <h1 className={profileStyles.pageHeading}>Запись: {listing.title}</h1>
        <p className={profileStyles.subtitle}>{listing.coachFullName}</p>

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
                {d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" })}
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
                onClick={() => {
                  setSelectedSlot(slot);
                  setBookError(null);
                }}
              >
                {new Date(slot.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
              </button>
            ))}
          </div>
        )}

        {bookError && <p className={profileStyles.error}>{bookError}</p>}

        {listing.offersOnline && listing.offersOffline && (
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
              <span className={profileStyles.rowLabel}>Объявление</span>
              <span className={profileStyles.rowValue}>{listing.title}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Тренер</span>
              <span className={profileStyles.rowValue}>{listing.coachFullName}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Когда</span>
              <span className={profileStyles.rowValue}>
                {new Date(selectedSlot.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
              </span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Формат</span>
              <span className={profileStyles.rowValue}>{format === "online" ? "Онлайн" : `Очно${listing.location ? `, ${listing.location}` : ""}`}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Стоимость</span>
              <span className={profileStyles.rowValue}>
                {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Не указана"}
              </span>
            </div>
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>Пожелания к тренировке (необязательно)</span>
              <textarea
                className={profileStyles.textarea}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                placeholder="Например: хочу поработать над подачей"
                disabled={booking}
              />
            </label>

            <p className={profileStyles.subtitle}>Заявка уйдёт тренеру на подтверждение — она появится в календаре, как только он её примет.</p>

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
