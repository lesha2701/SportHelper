// frontend/src/components/coaches/BookingFlow.tsx
import { useState } from "react";
import { useEffect, useRef } from "react";
import { getListingOpenSlots } from "../../api/coachListings";
import { createBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { CoachListingProfile, OpenSlot } from "../../types/coachListing";
import type { Booking } from "../../types/booking";
import { localDateKey } from "../../lib/localDate";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";
import { TitleWithBack } from "../shared/BackArrow";
import { ProBadge } from "../shared/ProBadge";

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

// The day strip is the device's calendar days (see lib/localDate.ts); a slot's own time stays on the UTC label it came with.
const toDateKey = localDateKey;

/** A «YYYY-MM-DD» day as a Date of the device's calendar. */
function dateOfKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const SEARCH_AHEAD_DAYS = 90; // the slots endpoint answers for at most this many days at once
const NEAREST_DAYS_SHOWN = 4;
const longDay = (key: string) => dateOfKey(key).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });

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
  const today = toDateKey(days[0] ?? new Date());
  const lastPickable = toDateKey(nextNDays(367)[366] ?? new Date());
  const [selectedDay, setSelectedDay] = useState(today);
  // The nearest days after the chosen one that have free time, shown when the chosen day has none (null = not looked up yet).
  const [nearestDays, setNearestDays] = useState<string[] | null>(null);
  const [emptyDay, setEmptyDay] = useState<string | null>(null); // the day whose slots came back empty
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);
  const [format, setFormat] = useState<"online" | "offline">(listing.offersOnline ? "online" : "offline");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const daySessionIdRef = useRef(0);
  const pickedChipRef = useRef<HTMLButtonElement | null>(null);
  // A day picked in the calendar may lie beyond the visible part of the strip: bring its chip into view.
  useEffect(() => {
    pickedChipRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [selectedDay]);

  useEffect(() => {
    daySessionIdRef.current += 1;
    setSlots(null);
    setSelectedSlot(null);
    setBookError(null);
    setSlotsError(null);
    setNearestDays(null);
    setEmptyDay(null);
    let stale = false; // a slow answer for a day the person has already left must not overwrite the current one
    getListingOpenSlots(token, listing.id, selectedDay, selectedDay)
      .then((loaded) => {
        if (stale) return;
        setSlots(loaded);
        if (loaded.length === 0) setEmptyDay(selectedDay);
      })
      .catch((err: unknown) => {
        if (!stale) setSlotsError(err instanceof ApiError ? err.message : "Не удалось загрузить слоты");
      });
    return () => {
      stale = true;
    };
  }, [token, listing.id, selectedDay]);

  useEffect(() => {
    if (emptyDay === null) return;
    let stale = false;
    const next = dateOfKey(emptyDay);
    next.setDate(next.getDate() + 1);
    const to = new Date(next);
    to.setDate(to.getDate() + SEARCH_AHEAD_DAYS - 1);
    getListingOpenSlots(token, listing.id, toDateKey(next), toDateKey(to))
      .then((found) => {
        if (stale) return;
        // a slot's date is the UTC label it came with (the platform's wall-clock day), not the device's day
        const keys = [...new Set(found.map((s) => s.startsAt.slice(0, 10)))];
        setNearestDays(keys.slice(0, NEAREST_DAYS_SHOWN));
      })
      .catch(() => {
        if (!stale) setNearestDays([]); // the hint is a bonus: without it the message above still stands
      });
    return () => {
      stale = true;
    };
  }, [emptyDay, token, listing.id]);

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
      <div className={profileStyles.card}>
        <TitleWithBack onBack={onBack}>
          <h1 className={profileStyles.pageHeading}>Запись: {listing.title}</h1>
        </TitleWithBack>
        <p className={profileStyles.subtitle}>
          {listing.coachFullName}
          {listing.coachIsPro && <ProBadge />}
        </p>

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
          {!days.some((d) => toDateKey(d) === selectedDay) && (
            <button type="button" ref={pickedChipRef} className={styles.dateChipActive}>
              {dateOfKey(selectedDay).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
            </button>
          )}
        </div>

        <label className={styles.pickDate}>
          <span className={profileStyles.label}>Нужна другая дата?</span>
          <input
            className={styles.dateInput}
            type="date"
            aria-label="Выбрать дату"
            min={today}
            max={lastPickable}
            value={selectedDay}
            onChange={(e) => {
              if (e.target.value && e.target.value >= today && e.target.value <= lastPickable) setSelectedDay(e.target.value);
            }}
          />
        </label>

        {slotsError && <p className={profileStyles.error}>{slotsError}</p>}
        {slots === null && !slotsError && <StateScreen kind="loading" title="Загрузка слотов…" />}
        {slots !== null && slots.length === 0 && (
          <>
            <p className={profileStyles.subtitle}>На {longDay(selectedDay)} нет свободных слотов.</p>
            {nearestDays !== null && nearestDays.length > 0 && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Ближайшие дни со свободным временем</span>
                <div className={styles.dateStrip}>
                  {nearestDays.map((key) => (
                    <button key={key} type="button" className={styles.dateChip} onClick={() => setSelectedDay(key)}>
                      {longDay(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {nearestDays !== null && nearestDays.length === 0 && (
              <p className={profileStyles.subtitle}>В ближайшие три месяца свободного времени у тренера нет.</p>
            )}
          </>
        )}
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
              <span className={profileStyles.rowValue}>
                {listing.coachFullName}
                {listing.coachIsPro && <ProBadge />}
              </span>
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
